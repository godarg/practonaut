import { cliText } from './messages.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import { open, writeFile, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { parseJsonEntry } from '../package/json.ts';
import { createRecordingStore } from '../recordings/store.ts';
import { deleteDerivedRecordings } from '../recordings/derived.ts';
import { createProjectStore, ProjectStoreError } from '../host/project-store.ts';
import { validateAuthorProject, compileProject } from '../authoring/index.ts';
import { sha256Hex } from '../canonical/index.ts';
import { RuntimeError } from './runtime.ts';
import { safeJson } from './output.ts';

async function readProject(path: string): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > 3 * 1024 * 1024) throw new RuntimeError('author_project_invalid', cliText("projectFile"));
    const bytes = await handle.readFile();
    if (bytes.length !== st.size) throw new RuntimeError('author_project_invalid', cliText("projectChanged"));
    return parseJsonEntry(bytes, 'author project', 64);
  } finally { await handle.close(); }
}
async function output(path: string, bytes: Uint8Array): Promise<void> {
  const temporary = path + '.tmp-' + process.pid;
  try { await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; }); throw error; }
}
export async function commandRecord(args: string[]): Promise<number> {
  const [command, id, ...rest] = args;
  if (rest.length || !['list', 'review', 'delete'].includes(command ?? '') || (command !== 'list' && !id) || (command === 'list' && id)) throw new RuntimeError('usage', cliText("recordUsage"));
  const paths = await resolvedDataPaths();
  const store = createRecordingStore(paths.recordings);
  let result: unknown;
  try {
    if (command === 'list') result = store.scan ? await store.scan() : { recordings: await store.list(), unavailable: [] };
    else if (command === 'review') result = await store.read(id!);
    else {
      result = await createProjectStore(paths.projects).withRecordingReferences(id!, async references => {
        const blockers = [...references.projectIds, ...references.unavailableProjects.map(entry => entry.id)];
        if (blockers.length) throw new RuntimeError('recording_in_use', cliText('recordingInUse', { ids: [...new Set(blockers)].sort().join(', ') }));
        const derived = await deleteDerivedRecordings(paths.author, id!);
        return { ...await store.delete(id!), derivedRemoved: derived.removed, unavailableDerived: derived.unavailable };
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RuntimeError('recording_missing', cliText('recordingMissing'));
    if (error instanceof ProjectStoreError) throw new RuntimeError(error.code, cliText('projectStoreFailure'));
    throw error;
  }
  process.stdout.write(safeJson({ ok: true, value: result }) + '\n'); return 0;
}
export async function commandCompile(args: string[]): Promise<number> {
  let source: string | undefined, out: string | undefined, checker: string | undefined, root: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (['--out', '--checker', '--recordings-root'].includes(arg)) {
      if (seen.has(arg)) throw new RuntimeError('usage', cliText("compileDuplicate")); seen.add(arg);
      const value = args[++i]; if (!value || value.startsWith('--')) throw new RuntimeError('usage', cliText("compileValue"));
      if (arg === '--out') out = value; else if (arg === '--checker') checker = value; else root = value;
    } else if (arg.startsWith('--') || source) throw new RuntimeError('usage', cliText("compileUsage"));
    else source = arg;
  }
  if (!source || !out) throw new RuntimeError('usage', cliText("compileUsage"));
  const project = validateAuthorProject(await readProject(source)), store = createRecordingStore(root ?? (await resolvedDataPaths()).recordings);
  const recordings = await Promise.all(project.recordingIds.map(id => store.read(id)));
  const compiled = compileProject({ project, recordings });
  const checkerPath = checker ?? out.replace(/\.pnworld$/, '') + '.pncheck';
  if (resolve(checkerPath) === resolve(out)) throw new RuntimeError('usage', cliText("compilePaths"));
  await output(out, compiled.worldBytes); await output(checkerPath, compiled.checkerBytes);
  process.stdout.write(safeJson({ ok: true, world: project.id, worldSha256: sha256Hex(compiled.worldBytes), checkerSha256: sha256Hex(compiled.checkerBytes), report: compiled.report }) + '\n');
  return 0;
}

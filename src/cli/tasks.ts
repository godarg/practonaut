import { lstat, mkdir, open, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fromScenesBounded } from '../authoring/from-scenes-runner.ts';
import { LIBRARIES, libraryPrefix, loadLibraryOf, type LibraryApp } from '../library/index.ts';
import { appDisplayName } from '../world/apps.ts';
import { publicConditions } from '../host/session.ts';
import { generateVariant } from '../world/variant.ts';
import { cliText, getCliLanguage } from './messages.ts';
import { displayPath, readableText, safeJson, safeText } from './output.ts';
import { RuntimeError } from './runtime.ts';
import { inlineOptionValues } from './options.ts';

const MAX_SCENE_BYTES = 10 * 1024 * 1024;
async function readScene(path: string): Promise<Buffer> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { throw new RuntimeError('usage', cliText('readFailed', { path: safeText(displayPath(path)), code: (error as NodeJS.ErrnoException).code ?? 'error' })); }
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new RuntimeError('usage', cliText('regularFile', { path: safeText(displayPath(path)) }));
    if (st.size > MAX_SCENE_BYTES) throw new RuntimeError('scene_invalid', cliText('sceneTooLarge', { path: safeText(displayPath(path)) }));
    return await handle.readFile();
  } finally { await handle.close(); }
}
/** Refuses a symbolic link or junction (Node reports both as links) at a path that already exists. */
async function refuseLink(path: string): Promise<boolean> {
  // The link itself is named, not its target (displayPath would resolve it).
  const named = (): string => { const near = relative(process.cwd(), path); return near && !near.startsWith('..') && !isAbsolute(near) ? near.split('\\').join('/') : displayPath(dirname(path)) + '/' + basename(path); };
  try { if ((await lstat(path)).isSymbolicLink()) throw new RuntimeError('usage', cliText('tasksOutputLink', { path: safeText(named()) })); return true; }
  catch (error) { if (error instanceof RuntimeError) throw error; if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
/**
 * The output folder and its `world` folder, created without following links. Links in the path
 * above the output folder are the user's choice (macOS /tmp, a moved home) and are resolved once;
 * the output folder, `world` inside it and the files written there must not be links, so a
 * prepared folder cannot redirect the write elsewhere.
 */
async function outputDirectories(out: string): Promise<{ root: string; world: string }> {
  const requested = resolve(out), missing: string[] = [];
  let existing = requested;
  for (;;) {
    try { await lstat(existing); break; }
    catch (error) {
      const parent = dirname(existing);
      // A regular file somewhere on the way ("--out notes.txt/task"): named, never a raw ENOTDIR.
      if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') throw new RuntimeError('usage', cliText('tasksOutputNotFolder', { path: safeText(displayPath(out)) }));
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === existing) throw error;
      missing.unshift(basename(existing)); existing = parent;
    }
  }
  // Windows reports ENOENT, not ENOTDIR, below a regular file: the nearest existing ancestor decides.
  if (missing.length > 0 && !(await stat(existing)).isDirectory()) throw new RuntimeError('usage', cliText('tasksOutputNotFolder', { path: safeText(displayPath(out)) }));
  let root: string;
  if (missing.length === 0) {
    await refuseLink(requested); root = requested;
    if (!(await lstat(root)).isDirectory()) throw new RuntimeError('usage', cliText('tasksOutputNotFolder', { path: safeText(displayPath(out)) }));
  }
  else {
    root = await realpath(existing);
    for (const name of missing) { root = join(root, name); await mkdir(root).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; }); await refuseLink(root); }
  }
  const world = join(root, 'world');
  if (!await refuseLink(world)) await mkdir(world).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  await refuseLink(world);
  if (!(await lstat(world)).isDirectory()) throw new RuntimeError('usage', cliText('writeFailed', { path: safeText(displayPath(world)), code: 'ENOTDIR' }));
  return { root, world };
}
async function writeOutput(path: string, text: string, force: boolean): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}`;
  if (await refuseLink(path) && !force) throw new RuntimeError('usage', cliText('tasksOutputExists', { path: safeText(displayPath(path)) }));
  // `wx` is O_CREAT|O_EXCL: it never opens an existing file or link; rename replaces the entry itself.
  try { await writeFile(temporary, text, { flag: 'wx', mode: 0o644 }); await rename(temporary, path); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

/** The prefix a library's tasks are named with in commands: none for Excalidraw's, `drawio/` for draw.io's. */
const shownPrefix = (app: LibraryApp): string => app === 'excalidraw' ? '' : LIBRARIES[app].prefix;

function list(json: boolean, app: LibraryApp = 'excalidraw'): number {
  const { world, library } = loadLibraryOf(app), language = getCliLanguage();
  if (json) { process.stdout.write(safeJson({ ok: true, world: { id: world.id, version: world.version }, tasks: library.tasks.map(({ id, difficulty, title, actions }) => ({ id, difficulty, title, actions })) }) + '\n'); return 0; }
  const variant = generateVariant(world, library.tasks[0]!.oracle.seeds.drawn!);
  process.stdout.write(cliText('tasksListHead', { app: appDisplayName(world.app.adapterId, language), count: library.tasks.length, world: world.id, version: world.version }));
  for (const entry of library.tasks) {
    const title = variant.tasks.find(task => task.id === entry.id)!.title[language];
    process.stdout.write(`  ${entry.id.padEnd(16)} ${'●'.repeat(entry.difficulty)}${'○'.repeat(3 - entry.difficulty)}  ${String(entry.actions).padStart(2)} ${cliText(entry.actions === 1 ? 'tasksAction' : 'tasksActions').trim()}  ${readableText(title)}\n`);
  }
  process.stdout.write(cliText('tasksListFoot', { prefix: shownPrefix(app) }));
  return 0;
}

function show(named: string, json: boolean, withOracle: boolean): number {
  const { app, rest: id } = libraryPrefix(named);
  const { world, library } = loadLibraryOf(app), language = getCliLanguage();
  const entry = library.tasks.find(task => task.id === id);
  if (!entry) throw new RuntimeError('task_unknown', cliText('tasksUnknown', { id: safeText(named) }));
  const variant = generateVariant(world, entry.oracle.seeds.drawn!), task = variant.tasks.find(t => t.id === id)!;
  const conditions = publicConditions(task).map(condition => condition.text);
  const facts = { id, difficulty: entry.difficulty, title: task.title, prompt: task.prompt, conditions, hints: task.hints.length, errorClasses: task.errorClasses.length, variants: world.variants.cases.length, oracleActions: entry.actions, nearMisses: entry.oracle.nearMisses.length };
  if (json) { process.stdout.write(safeJson({ ok: true, task: { ...facts, ...(withOracle ? { oracle: entry.oracle } : {}) } }) + '\n'); return 0; }
  process.stdout.write(cliText('tasksShowHead', { id, title: readableText(task.title[language]), difficulty: entry.difficulty }));
  process.stdout.write(`${readableText(task.prompt[language])}\n\n${cliText('tasksShowGoal').trim()}\n`);
  conditions.forEach((condition, index) => process.stdout.write(`  ${index + 1}. ${readableText(condition[language])}\n`));
  process.stdout.write(cliText('tasksShowFacts', { hints: facts.hints, errors: facts.errorClasses, variants: facts.variants, actions: facts.oracleActions, near: facts.nearMisses }));
  if (withOracle) entry.oracle.steps.forEach((step, index) => process.stdout.write(`  ${index}. ${step.name} ${readableText(JSON.stringify(step.params))}\n`));
  process.stdout.write(cliText('tasksShowPlay', { id: shownPrefix(app) + id }));
  return 0;
}

async function scenes(given: string[]): Promise<number> {
  const args = inlineOptionValues(given, ['--out', '--task', '--layout', '--tolerance']);
  const positional: string[] = []; const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (['--out', '--task', '--layout', '--tolerance'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--') || flags.has(arg)) throw new RuntimeError('usage', cliText('tasksScenesUsage'));
      flags.set(arg, value);
    } else if (['--align', '--json', '--force'].includes(arg)) {
      if (flags.has(arg)) throw new RuntimeError('usage', cliText('tasksScenesUsage'));
      flags.set(arg, true);
    } else if (arg.startsWith('--')) throw new RuntimeError('usage', cliText('optionUnknown', { option: safeText(arg) }));
    else positional.push(arg);
  }
  const out = flags.get('--out');
  if (positional.length !== 2 || typeof out !== 'string') throw new RuntimeError('usage', cliText('tasksScenesUsage'));
  const layout = flags.get('--layout'), tolerance = flags.get('--tolerance'), taskId = flags.get('--task');
  if (layout !== undefined && layout !== 'relative') throw new RuntimeError('usage', cliText('tasksScenesUsage'));
  if (tolerance !== undefined && !/^\d{1,4}$/.test(String(tolerance))) throw new RuntimeError('usage', cliText('tasksScenesUsage'));
  if (taskId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(taskId))) throw new RuntimeError('usage', cliText('tasksScenesUsage'));
  const [start, goal] = await Promise.all(positional.map(readScene));
  // Without --task the ids come from the output folder's name, so a session reads "task checkout-flow",
  // not "world from-scenes, task from-scenes".
  const named = basename(resolve(out)).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '').slice(0, 64);
  const id = taskId !== undefined ? String(taskId) : /^[a-z0-9][a-z0-9_-]*$/.test(named) ? named : 'drawn-task';
  const result = await fromScenesBounded(start!, goal!, { worldId: id, ...(layout ? { layout: 'relative' as const } : {}), ...(flags.has('--align') ? { align: true } : {}), ...(tolerance ? { tolerance: Number(tolerance) } : {}), taskId: id });
  const { root, world: worldDir } = await outputDirectories(out);
  const force = flags.has('--force');
  // The world directory is an ordinary world source; the oracle stays beside it, never inside.
  await writeOutput(join(worldDir, 'world.json'), JSON.stringify(result.world, null, 2) + '\n', force);
  await writeOutput(join(root, 'oracle.json'), JSON.stringify(result.oracle, null, 2) + '\n', force);
  const ignored = [...result.unmodeled.start, ...result.unmodeled.goal];
  if (flags.has('--json')) { process.stdout.write(safeJson({ ok: true, world: displayPath(worldDir), oracle: displayPath(join(root, 'oracle.json')), summary: { ...result.summary, oracleActions: result.oracle.steps.length, nearMisses: result.oracle.nearMisses.length }, unmodeled: ignored }) + '\n'); return 0; }
  process.stdout.write(cliText('tasksScenesDone', { ...result.summary, actions: result.oracle.steps.length, near: result.oracle.nearMisses.length }));
  if (ignored.length) process.stdout.write(cliText('tasksScenesIgnored', { n: ignored.length, kinds: [...new Set(ignored.map(u => u.reason))].join(', ') }));
  process.stdout.write(cliText('tasksScenesPlay', { path: safeText(displayPath(worldDir)) }));
  return 0;
}

/** practonaut tasks list | show <id> | from-scenes <start> <goal> --out <dir> */
export async function commandTasks(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  const json = rest.includes('--json');
  if (sub === 'list') {
    // `tasks list` is the Excalidraw library; `drawio/all` (or `excalidraw/all`) names a library (PADR-0049 decision 8.2).
    const positional = rest.filter(arg => arg !== '--json');
    if (positional.length > 1) throw new RuntimeError('usage', cliText('tasksUsage'));
    const named = positional[0] === undefined ? { app: 'excalidraw' as const, rest: 'all' } : libraryPrefix(positional[0]);
    if (named.rest !== 'all' || (positional[0] !== undefined && !positional[0].includes('/'))) throw new RuntimeError('usage', cliText('tasksUsage'));
    return list(json, named.app);
  }
  if (sub === 'show') {
    const positional = rest.filter(arg => !arg.startsWith('--')), options = rest.filter(arg => arg.startsWith('--'));
    if (positional.length !== 1 || options.some(arg => arg !== '--json' && arg !== '--oracle')) throw new RuntimeError('usage', cliText('tasksUsage'));
    return show(positional[0]!, json, options.includes('--oracle'));
  }
  if (sub === 'from-scenes') return scenes(rest);
  throw new RuntimeError('usage', cliText('tasksUsage'));
}

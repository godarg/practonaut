// Builds the task library from its source scenes (the library is generated, never hand-edited).
//   node tools/build-library.ts --write   writes tasks/excalidraw/world/world.json and library.json
//   node tools/build-library.ts --check   exits 1 if the committed files differ from a fresh build
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLibrary, LIBRARY_ROOT } from '../src/library/index.ts';

const mode = process.argv[2];
if (mode !== '--write' && mode !== '--check') { process.stderr.write('usage: node tools/build-library.ts --write|--check\n'); process.exit(1); }
const { world, library } = buildLibrary();
const files: Array<[string, string]> = [
  [join(LIBRARY_ROOT, 'world', 'world.json'), JSON.stringify(world, null, 2) + '\n'],
  [join(LIBRARY_ROOT, 'library.json'), JSON.stringify(library, null, 2) + '\n'],
];
let stale = 0;
for (const [path, text] of files) {
  if (mode === '--write') { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); process.stdout.write(`wrote ${path.slice(LIBRARY_ROOT.length - 'tasks/excalidraw/'.length)}\n`); continue; }
  let committed: string | undefined;
  try { committed = readFileSync(path, 'utf8'); } catch { committed = undefined; }
  if (committed !== text) { stale++; process.stderr.write(`library:check: ${path.slice(LIBRARY_ROOT.length)} ${committed === undefined ? 'is missing' : 'differs from a fresh build'}\n`); }
}
if (mode === '--check') {
  if (stale) process.stderr.write('library:check: run `npm run library:write` and commit the result\n');
  else process.stdout.write(`library:check: ${library.tasks.length} tasks up to date\n`);
}
process.exitCode = stale ? 1 : 0;

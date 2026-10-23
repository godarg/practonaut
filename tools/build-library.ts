// Builds the task libraries from their source scenes (the libraries are generated, never hand-edited).
//   node tools/build-library.ts --write   writes tasks/excalidraw/ and tasks/drawio/ (world.json, library.json)
//   node tools/build-library.ts --check   exits 1 if a committed file differs from a fresh build
// The draw.io library is the Excalidraw library's tasks in a draw.io world of the same task set,
// every reference, near miss and start re-verified there (PADR-0049 decision 8.1).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDrawioLibrary, buildLibrary, LIBRARIES } from '../src/library/index.ts';

const mode = process.argv[2];
if (mode !== '--write' && mode !== '--check') { process.stderr.write('usage: node tools/build-library.ts --write|--check\n'); process.exit(1); }
const repository = fileURLToPath(new URL('..', import.meta.url));
const excalidraw = buildLibrary(), drawio = buildDrawioLibrary(excalidraw);
const files: Array<[string, string]> = [];
for (const [definition, built] of [[LIBRARIES.excalidraw, excalidraw], [LIBRARIES.drawio, drawio]] as const) {
  files.push([join(definition.root, 'world', 'world.json'), JSON.stringify(built.world, null, 2) + '\n']);
  files.push([join(definition.root, 'library.json'), JSON.stringify(built.library, null, 2) + '\n']);
}
let stale = 0;
for (const [path, text] of files) {
  const shown = relative(repository, path).split('\\').join('/');
  if (mode === '--write') { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); process.stdout.write(`wrote ${shown}\n`); continue; }
  let committed: string | undefined;
  try { committed = readFileSync(path, 'utf8'); } catch { committed = undefined; }
  if (committed !== text) { stale++; process.stderr.write(`library:check: ${shown} ${committed === undefined ? 'is missing' : 'differs from a fresh build'}\n`); }
}
if (mode === '--check') {
  if (stale) process.stderr.write('library:check: run `npm run library:write` and commit the result\n');
  else process.stdout.write(`library:check: ${excalidraw.library.tasks.length} tasks up to date in ${Object.keys(LIBRARIES).length} libraries\n`);
}
process.exitCode = stale ? 1 : 0;

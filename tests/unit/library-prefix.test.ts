// PADR-0049 decision 8.2: libraries are a table by adapter id. A task id prefixed `drawio/` names the
// draw.io library in play, bench --tasks and tasks list|show (`drawio/all` for all); an unprefixed or
// `excalidraw/` id keeps naming the Excalidraw library; a bench mixing prefixes is refused; and
// `report --verify` binds a library bench's references to the oracle file of that application's library.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBenchArguments, prepareBench } from '../../src/cli/bench.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';
import { resolvePracticeSource } from '../../src/cli/serve.ts';
import { libraryTask, loadLibraryOf } from '../../src/library/index.ts';
import { libraryWorld } from '../../src/bench/run.ts';
import { libraryReferenceProblem } from '../../src/bench/verify.ts';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const cli = (args: string[]) => spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', timeout: 60_000 });
const code = (expected: string) => (error: unknown): boolean => error instanceof RuntimeError && error.code === expected;

test('task arguments name their library by prefix', async () => {
  assert.deepEqual(libraryTask('connect'), { app: 'excalidraw', taskId: 'connect' });
  assert.deepEqual(libraryTask('excalidraw/connect'), { app: 'excalidraw', taskId: 'connect' });
  assert.deepEqual(libraryTask('drawio/connect'), { app: 'drawio', taskId: 'connect' });
  assert.equal(libraryTask('drawio/nope'), undefined);
  assert.equal(libraryTask('bpmnjs/connect'), undefined);
  const drawio = await resolvePracticeSource('drawio/group');
  assert.deepEqual([drawio.world.id, drawio.world.app.adapterId, drawio.taskId, drawio.library], ['drawio-library', 'drawio', 'group', true]);
  assert.equal((await resolvePracticeSource('group')).world.id, 'excalidraw-library');
});

test('bench --tasks: drawio/ tasks bench the draw.io library with its references; prefixes do not mix', async () => {
  const some = parseBenchArguments(['--agent', 'oracle', '--tasks', 'drawio/connect,drawio/group']);
  assert.deepEqual([some.library, some.tasks], ['drawio', ['connect', 'group']]);
  const all = parseBenchArguments(['--agent', 'oracle', '--tasks', 'drawio/all']);
  assert.deepEqual([all.library, all.tasks], ['drawio', loadLibraryOf('drawio').library.tasks.map(task => task.id)]);
  assert.equal(parseBenchArguments(['--agent', 'oracle', '--tasks', 'excalidraw/connect']).library, 'excalidraw');
  assert.equal(parseBenchArguments(['--agent', 'oracle']).library, 'excalidraw');
  assert.throws(() => parseBenchArguments(['--agent', 'oracle', '--tasks', 'connect,drawio/group']), code('usage'));
  assert.throws(() => parseBenchArguments(['--agent', 'oracle', '--tasks', 'excalidraw/connect,drawio/group']), code('usage'));
  assert.throws(() => parseBenchArguments(['--agent', 'oracle', '--tasks', 'drawio/nope']), code('task_unknown'));
  const prepared = await prepareBench(some, { kind: 'builtin', name: 'oracle' });
  assert.deepEqual([prepared.world.source, prepared.world.world.id, prepared.world.world.app.adapterId], ['library', 'drawio-library', 'drawio']);
  assert.deepEqual([...prepared.references.values()].map(reference => [reference.taskId, reference.worldId]), [['connect', 'drawio-library'], ['group', 'drawio-library']]);
});

test('report --verify: the shipped library is chosen by the stored world\'s app, and its references are bound to that library\'s oracle file', async () => {
  const drawio = await libraryWorld('drawio');
  assert.deepEqual([drawio.world.id, drawio.entries.size], ['drawio-library', 16]);
  assert.equal((await libraryWorld()).world.id, 'excalidraw-library');
  await assert.rejects(libraryWorld('bpmnjs'), /no bundled library/);
  const stored = [...drawio.entries.values()].map(entry => ({ taskId: entry.id, source: 'library', steps: structuredClone(entry.oracle.steps) }));
  assert.equal(libraryReferenceProblem(stored, drawio.entries), null);
  const changed = structuredClone(stored); changed[1]!.steps = [...changed[1]!.steps, ...changed[1]!.steps];
  assert.match(libraryReferenceProblem(changed, drawio.entries) ?? '', new RegExp(changed[1]!.taskId));
  assert.equal(libraryReferenceProblem(changed.map(entry => ({ ...entry, source: 'oracle-file' })), drawio.entries), null, 'an own world\'s references are not the library\'s');
});

test('tasks list drawio/all and tasks show drawio/<id> describe the draw.io library', () => {
  const list = cli(['tasks', 'list', 'drawio/all']);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /^draw\.io task library: 16 tasks \(world drawio-library 1\.1\.0\)$/m);
  assert.match(list.stdout, /play drawio\/<task-id>/);
  assert.match(cli(['tasks', 'list']).stdout, /^Excalidraw task library: 16 tasks \(world excalidraw-library 1\.1\.0\)$/m);
  assert.match(cli(['tasks', 'show', 'drawio/connect']).stdout, /play drawio\/connect/);
  for (const args of [['tasks', 'list', 'drawio'], ['tasks', 'list', 'drawio/connect'], ['tasks', 'list', 'all']]) assert.equal(cli(args).status, 1, args.join(' '));
});

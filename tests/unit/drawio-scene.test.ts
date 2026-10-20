// PADR-0049 decision 4.2 without a browser (review m2d, r2-runtime-3): every read is compared with the
// last confirmed write, and a saved scene carries that write, so a rollback restores it. The app is a
// fake standing at the adapter's I/O boundary; the expected values come from the writer's own cells.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshMemory, writeCells, type XmlNode } from '../../src/adapters/drawio/writer.ts';
import { readBack } from '../../src/adapters/drawio/readback.ts';
import { freshRemembered, readIssues, readScene, sceneOf, type DrawioIO } from '../../src/adapters/drawio/scene.ts';
import type { State } from '../../src/world/types.ts';
import { stepV2 } from '../support/world-v2.ts';

const state: State = { objects: { a: stepV2('a', 'Receive', 100, 100), b: stepV2('b', 'Ship', 400, 100), ab: { id: 'ab', type: 'arrow', deleted: false, frameId: null, from: 'a', to: 'b' } } };
const written = (): XmlNode[] => writeCells(state, freshMemory());
const relabelled = (): XmlNode[] => { const cells = written(); cells.find(c => c.attrs.id === 'a')!.attrs.value = 'Other'; return cells; };

test('a label changed after a confirmed write is an issue at the next read, though every cell is the adapter\'s own', () => {
  assert.deepEqual(readBack(relabelled()).issues, [], 'integrity alone sees nothing: the cells are all the adapter\'s');
  assert.deepEqual(readIssues(written(), relabelled()).issues, ['a: came back changed']);
  assert.deepEqual(readIssues(written(), written()).issues, []);
  assert.deepEqual(readIssues(undefined, relabelled()).issues, [], 'before the first confirmed write there is nothing to compare');
});

test('readScene: the app\'s export through the host page, compared with what the adapter remembers', async () => {
  const remembered = freshRemembered();
  remembered.committed = written();
  const app = (cells: XmlNode[] | null): Pick<DrawioIO, 'exportXml' | 'cellsOf'> => ({ exportXml: async () => '<mxfile/>', cellsOf: async () => cells ? { cells } : { error: 'parsererror' } });
  assert.deepEqual((await readScene(app(written()), remembered)).issues, []);
  const changed = await readScene(app(relabelled()), remembered);
  assert.deepEqual([changed.issues, (changed.state.objects.a as { label: string }).label], [['a: came back changed'], 'Other']);
  assert.deepEqual((await readScene(app(null), remembered)).issues, ['the export does not parse (parsererror)']);
});

test('a saved scene carries the last confirmed write and the writer\'s memory; write and load restore both', async () => {
  const calls: string[] = [];
  const io: DrawioIO = { exportXml: async () => 'saved-xml', cellsOf: async () => ({ cells: [] }), load: async xml => { calls.push(`load ${xml}`); }, startPage: async () => { calls.push('startPage'); } };
  const remembered = freshRemembered();
  remembered.committed = written(); remembered.memory.frames.set('f', { x: 1, y: 2, width: 3, height: 4 });
  const scene = sceneOf(io, remembered);
  const saved = await scene.read();
  // What happened after the save: another confirmed write, other memory.
  remembered.committed = relabelled(); remembered.memory.frames.set('f', { x: 9, y: 9, width: 9, height: 9 });
  assert.deepEqual(saved.committed, written(), 'the saved scene is a copy, not the live value');
  await scene.write(saved);
  assert.deepEqual([remembered.committed, remembered.memory.frames.get('f')], [written(), { x: 1, y: 2, width: 3, height: 4 }]);
  assert.deepEqual(calls, ['load saved-xml']);
  remembered.committed = relabelled(); calls.length = 0;
  await scene.load(saved);
  assert.deepEqual(remembered.committed, written());
  assert.deepEqual(calls, ['startPage', 'load saved-xml'], 'a fresh page, then the saved diagram');
  // And the next read compares with the restored write.
  assert.deepEqual((await readScene({ exportXml: async () => '', cellsOf: async () => ({ cells: relabelled() }) }, remembered)).issues, ['a: came back changed']);
});

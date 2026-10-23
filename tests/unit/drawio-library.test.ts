// PADR-0049 decision 8.1: the committed draw.io library is the Excalidraw library's tasks in a draw.io
// world of the same task set. The same seeds select the same cases, every instance has the same task
// identity on both apps (48 for 16 tasks × 3 cases), every reference passes and every near miss and
// start fails in the draw.io world, and a build whose oracle does not hold there is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkState } from '../../src/checker/index.ts';
import { buildDrawioLibrary, DRAWIO_LIBRARY_WORLD_ID, LIBRARY_CASES, loadLibraryOf, taskWorld } from '../../src/library/index.ts';
import { taskIdentity } from '../../src/bench/identity.ts';
import { generateVariant, variantIndex } from '../../src/world/variant.ts';
import { AuthoringError } from '../../src/authoring/project.ts';

const excalidraw = loadLibraryOf('excalidraw'), drawio = loadLibraryOf('drawio');

test('the draw.io world differs from the Excalidraw world only in its id, app, task set and app version; no task text names Excalidraw', () => {
  const differing = Object.keys({ ...excalidraw.world, ...drawio.world }).filter(key => JSON.stringify((excalidraw.world as unknown as Record<string, unknown>)[key]) !== JSON.stringify((drawio.world as unknown as Record<string, unknown>)[key])).sort();
  assert.deepEqual(differing, ['app', 'id', 'provenance', 'taskSet']);
  assert.equal(drawio.world.id, DRAWIO_LIBRARY_WORLD_ID);
  assert.deepEqual([drawio.world.app.adapterId, drawio.world.app.versionRange, drawio.world.provenance.appVersion], ['drawio', '32.4.1', '32.4.1']);
  assert.deepEqual(drawio.world.taskSet, { id: 'excalidraw-library', version: excalidraw.world.version });
  assert.equal(excalidraw.world.taskSet, undefined, 'the Excalidraw library is unchanged');
  assert.equal((JSON.stringify(drawio.world.tasks) + JSON.stringify(drawio.world.variants)).match(/excalidraw/gi), null);
  // The oracle file: the same steps, near misses and seeds, for the draw.io world.
  assert.equal(drawio.library.worldId, DRAWIO_LIBRARY_WORLD_ID);
  assert.deepEqual(drawio.library.tasks.map(entry => ({ ...entry, oracle: { ...entry.oracle, worldId: 'x' } })), excalidraw.library.tasks.map(entry => ({ ...entry, oracle: { ...entry.oracle, worldId: 'x' } })));
  assert.ok(drawio.library.tasks.every(entry => entry.oracle.worldId === DRAWIO_LIBRARY_WORLD_ID));
});

test('the same seeds select the same cases; 16 tasks × 3 cases are 48 instances with equal identities on both apps', () => {
  for (let seed = 0; seed < 200; seed++) assert.equal(variantIndex(drawio.world, seed), variantIndex(excalidraw.world, seed), `seed ${seed}`);
  const identities = new Set<string>();
  for (const entry of excalidraw.library.tasks) for (const variantCase of LIBRARY_CASES) {
    const seed = entry.oracle.seeds[variantCase]!;
    const one = taskIdentity(excalidraw.world, entry.id, seed), other = taskIdentity(drawio.world, entry.id, seed);
    assert.equal(other, one, `${entry.id}/${variantCase}`);
    identities.add(one);
  }
  assert.equal(excalidraw.library.tasks.length, 16);
  assert.equal(identities.size, 48);
});

test('in the draw.io world, in every case: the start fails, the reference passes, every near miss fails', () => {
  let sequences = 0;
  for (const entry of drawio.library.tasks) {
    const world = taskWorld(drawio.world, entry.id);
    for (const [caseId, seed] of Object.entries(entry.oracle.seeds)) {
      const passed = (state: Parameters<typeof checkState>[1]): boolean => checkState(world, state, { seed, taskId: entry.id }).passed;
      assert.equal(passed(generateVariant(world, seed).tasks[0]!.initialState!), false, `${entry.id}/${caseId} start`);
      const reference = runOracle(world, seed, entry.id, entry.oracle.steps);
      assert.ok(reference.ok && passed(reference.session.state), `${entry.id}/${caseId} reference`);
      for (const miss of entry.oracle.nearMisses) {
        const tried = runOracle(world, seed, entry.id, miss.steps);
        assert.ok(tried.ok && !passed(tried.session.state), `${entry.id}/${caseId} ${miss.id}`);
      }
      sequences += 2 + entry.oracle.nearMisses.length;
    }
  }
  assert.equal(sequences, 213);
});

test('the build refuses an oracle that does not hold in the draw.io world', () => {
  const tampered = structuredClone(excalidraw);
  const entry = tampered.library.tasks.find(task => task.id === 'connect')!;
  entry.oracle.nearMisses[0]!.steps = structuredClone(entry.oracle.steps);
  assert.throws(() => buildDrawioLibrary(tampered), (error: unknown) => error instanceof AuthoringError && /connect: near miss near-1 passes/.test(error.message));
  const seeds = structuredClone(excalidraw);
  const swapped = seeds.library.tasks[0]!.oracle.seeds; [swapped.drawn, swapped['alt-1']] = [swapped['alt-1']!, swapped.drawn!];
  assert.throws(() => buildDrawioLibrary(seeds), /selects another case/);
});

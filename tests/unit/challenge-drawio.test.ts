// PADR-0049 decision 8.5: the generator's --app drawio writes the same instances into a draw.io world,
// generatedBy unchanged, so each instance has the same task identity on both applications; the
// references and near misses are verified again in the draw.io world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSet } from '../../src/challenge/build.ts';
import { FAMILIES } from '../../src/challenge/families.ts';
import { taskIdentity } from '../../src/bench/identity.ts';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkState } from '../../src/checker/index.ts';
import { taskWorld } from '../../src/library/index.ts';

test('--app drawio: the same instances in a draw.io world, with equal identities and generatedBy', () => {
  for (const family of FAMILIES.filter(name => name !== 'long-horizon')) {
    const excalidraw = generateSet(family, [1, 2], 'mixed', 'dev'), drawio = generateSet(family, [1, 2], 'mixed', 'dev', 'drawio');
    assert.deepEqual([drawio.world.id, drawio.world.app.adapterId, drawio.world.app.versionRange], [`challenge-${family}-dev-drawio`, 'drawio', '32.4.1'], family);
    assert.deepEqual(drawio.world.tasks, excalidraw.world.tasks, `${family}: the tasks, generatedBy included`);
    for (const task of drawio.world.tasks) {
      assert.equal(taskIdentity(drawio.world, task.id, 1), taskIdentity(excalidraw.world, task.id, 1), `${family} ${task.id}`);
      const oracle = drawio.oracles.find(entry => entry.taskId === task.id)!, world = taskWorld(drawio.world, task.id), seed = oracle.seeds.drawn!;
      assert.equal(oracle.worldId, drawio.world.id);
      const reference = runOracle(world, seed, task.id, oracle.steps);
      assert.ok(reference.ok && checkState(world, reference.session.state, { seed, taskId: task.id }).passed, `${task.id} reference`);
      for (const miss of oracle.nearMisses) { const tried = runOracle(world, seed, task.id, miss.steps); assert.ok(tried.ok && !checkState(world, tried.session.state, { seed, taskId: task.id }).passed, `${task.id} ${miss.id}`); }
    }
  }
});

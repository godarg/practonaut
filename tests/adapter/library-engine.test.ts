import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAdapter } from '../../src/adapters/registry.ts';
import type { MirrorAdapter } from '../../src/adapters/types.ts';
import { runOracle, type OracleStep } from '../../src/authoring/from-scenes.ts';
import { checkSubmission } from '../../src/checker/index.ts';
import { Session } from '../../src/core/index.ts';
import { loadLibrary, taskWorld } from '../../src/library/index.ts';
import type { World } from '../../src/world/types.ts';

// Every reference solution and near miss of the library runs through the real pinned engine.
// The verdict comes from the engine's own native export, read by the independent checker.
const { world, library } = loadLibrary();
async function play(adapter: MirrorAdapter, slice: World, seed: number, taskId: string, steps: readonly OracleStep[]): Promise<string> {
  const resolved = runOracle(slice, seed, taskId, steps);
  assert.equal(resolved.ok, true, `${taskId}: sequence runs in the core`);
  if (!resolved.ok) return '';
  const session = new Session(slice, seed, taskId);
  const restored = await adapter.restoreState(session.state);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  for (const entry of resolved.session.log) {
    const before = session.state, result = session.act(entry.action);
    assert.equal(result.ok, true);
    if (!result.ok) return '';
    const mirrored = await adapter.apply({ before, after: result.state, action: entry.action });
    assert.equal(mirrored.ok, true, `${taskId} ${entry.action.name}: ${JSON.stringify(mirrored)}`);
  }
  assert.deepEqual(await adapter.snapshot(), session.state);
  return (await adapter.exportArtifact()).native;
}
for (const entry of library.tasks) {
  test(`library ${entry.id}: real engine confirms the solution passes, near misses and the start fail`, { timeout: 120_000 }, async () => {
    const seed = entry.oracle.seeds.drawn!, slice = taskWorld(world, entry.id);
    const adapter = await resolveAdapter(slice.app, slice.schema).create(new Session(slice, seed, entry.id).state);
    try {
      const verdict = (native: string): boolean => checkSubmission(slice, native, { seed, taskId: entry.id }).passed;
      assert.equal(verdict(await play(adapter, slice, seed, entry.id, [])), false, 'start');
      assert.equal(verdict(await play(adapter, slice, seed, entry.id, entry.oracle.steps)), true, 'reference solution');
      for (const miss of entry.oracle.nearMisses) assert.equal(verdict(await play(adapter, slice, seed, entry.id, miss.steps)), false, miss.id);
      assert.deepEqual(adapter.networkAttempts(), []);
    } finally { await adapter.close(); }
  });
}

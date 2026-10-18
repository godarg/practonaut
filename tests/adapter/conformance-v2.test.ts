import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { stateHash } from '../../src/canonical/index.ts';
import { apply } from '../../src/core/index.ts';
import { renderCheck } from '../../src/adapters/excalidraw/index.ts';
import { resolveAdapter } from '../../src/adapters/registry.ts';
import { parseScene } from '../../src/checker/index.ts';
import type { Action, State, StepV2 } from '../../src/world/types.ts';
import { stepV2, v2World } from '../support/world-v2.ts';

// Successor states come from the core (second implementation); the adapter predicts on its own
// and the pinned engine has the last word through read-back. Three repetitions, one hash each.
const base: State = { objects: {
  f: { id: 'f', type: 'frame', deleted: false, name: 'Flow' },
  a: stepV2('a', 'Receive', 300, 300, { frameId: 'f', width: 180, height: 100 }),
  b: stepV2('b', 'Check', 650, 300, { frameId: 'f', width: 180, height: 100, fill: 'blue' }),
  c: stepV2('c', 'Dispatch', 1050, 600, { width: 180, height: 100, shape: 'ellipse' }),
  ab: { id: 'ab', type: 'arrow', deleted: false, frameId: 'f', from: 'a', to: 'b' },
} };
const world = v2World({ initialState: base });
const sequence: Action[] = [
  { name: 'add_step', params: { frameId: null, label: 'Archive', x: 1050, y: 300, width: 200, height: 120, shape: 'diamond' } },
  { name: 'rename_frame', params: { id: 'f', name: 'Inbound flow' } },
  { name: 'resize_step', params: { id: 'a', width: 220, height: 120 } },
  { name: 'set_style', params: { id: 'b', shape: 'diamond', stroke: 'red', fill: 'yellow' } },
  { name: 'set_style', params: { id: 'c', shape: 'rectangle', stroke: 'green', fill: 'green' } },
  { name: 'group_steps', params: { id: 'a', with: 'b' } },
  { name: 'group_steps', params: { id: 'c', with: 'a' } },
  { name: 'connect', params: { from: 'b', to: 'c' } },
  { name: 'set_frame', params: { id: 'c', frameId: 'f' } },
  { name: 'ungroup', params: { id: 'b' } },
  { name: 'set_frame', params: { id: 'c', frameId: null } },
  { name: 'rename_step', params: { id: 'c', label: 'Ship' } },
  { name: 'move_step', params: { id: 'c', x: 1100, y: 650 } },
  { name: 'delete_step', params: { id: 'a' } },
];
const evidence: Array<{ repetition: number; case: string; hash: string; render: boolean }> = [];
test('world/2 actions conform 3 times to the real pinned engine', { timeout: 240000 }, async () => {
  for (let repetition = 1; repetition <= 3; repetition++) {
    const adapter = await resolveAdapter(world.app, world.schema).create(base);
    try {
      let before = structuredClone(base); const prefix: Action[] = [];
      for (const [index, action] of sequence.entries()) {
        const core = apply(world, before, action, { seed: 0, prefix });
        assert.equal(core.ok, true, JSON.stringify(core));
        if (!core.ok) return;
        const result = await adapter.apply({ before, after: core.state, action });
        assert.equal(result.ok, true, `${action.name}: ${JSON.stringify(result)}`);
        assert.deepEqual(await adapter.snapshot(), core.state);
        const artifact = await adapter.exportArtifact();
        // The independent tolerant parser reads the engine's own export back to the same live facts.
        const parsed = parseScene(artifact.native).state;
        const live = (state: State) => Object.fromEntries(Object.entries(state.objects).filter(([, o]) => !o.deleted));
        assert.deepEqual(parsed.objects ? live(parsed) : {}, live(core.state), `${action.name}: export disagrees`);
        const render = await renderCheck(artifact);
        // A loose arrow end is a real, visible defect: the render check must fail exactly then.
        const loose = Object.values(core.state.objects).some(o => o.type === 'arrow' && !o.deleted && (o.from === null || o.to === null));
        assert.equal(render.ok, !loose, `${action.name}: ${JSON.stringify(render)}`);
        evidence.push({ repetition, case: `${index}-${action.name}`, hash: stateHash(core.state), render: render.ok });
        prefix.push(action); before = core.state;
      }
      assert.deepEqual(adapter.networkAttempts(), []);
    } finally { await adapter.close(); }
  }
  for (const name of new Set(evidence.map(e => e.case))) assert.equal(new Set(evidence.filter(e => e.case === name).map(e => e.hash)).size, 1, `${name} differs across repetitions`);
  await mkdir('.local/adapter', { recursive: true });
  await writeFile('.local/adapter/conformance-v2.json', JSON.stringify({ app: '@excalidraw/excalidraw@0.18.1', runs: evidence }, null, 2) + '\n');
});
test('world/2: a wrong prediction and an invalid transition reject atomically', { timeout: 60000 }, async () => {
  const adapter = await resolveAdapter(world.app, world.schema).create(base);
  try {
    const styled = apply(world, base, { name: 'set_style', params: { id: 'b', shape: 'ellipse', stroke: 'blue', fill: 'none' } });
    assert.equal(styled.ok, true); if (!styled.ok) return;
    const wrong = structuredClone(styled.state); (wrong.objects.b as StepV2).fill = 'red';
    const disagree = await adapter.apply({ before: base, after: wrong, action: { name: 'set_style', params: { id: 'b', shape: 'ellipse', stroke: 'blue', fill: 'none' } } });
    assert.equal(disagree.ok, false); if (!disagree.ok) assert.equal(disagree.error.code, 'real_tool_disagrees');
    assert.deepEqual(await adapter.snapshot(), base);
    const grouped = structuredClone(base); (grouped.objects.a as StepV2).groupId = 'g1';
    const missing = await adapter.apply({ before: base, after: grouped, action: { name: 'group_steps', params: { id: 'a', with: 'missing' } } });
    assert.equal(missing.ok, false);
    assert.deepEqual(await adapter.snapshot(), base);
    const ok = await adapter.apply({ before: base, after: styled.state, action: { name: 'set_style', params: { id: 'b', shape: 'ellipse', stroke: 'blue', fill: 'none' } } });
    assert.equal(ok.ok, true, JSON.stringify(ok));
  } finally { await adapter.close(); }
});

// The scanner that guards "no library or bench reference reaches the Player" (0.2.0 Should 7) must
// find a planted reference of every library task and must not flag the example world's own,
// public play, which uses some of the same actions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hiddenReferenceMarkers, scanForHiddenReferences } from '../support/oracle-scan.ts';
import { createPracticeController } from '../../src/host/session.ts';
import { withDemonstration } from '../../src/host/demonstration.ts';
import { validateWorld } from '../../src/world/schema.ts';

const library = JSON.parse(readFileSync(new URL('../../tasks/excalidraw/library.json', import.meta.url), 'utf8')) as { tasks: Array<{ id: string; oracle: { steps: unknown[]; nearMisses: Array<{ steps: unknown[] }> } }> };
const cases = (JSON.parse(readFileSync(new URL('../../tasks/excalidraw/world/world.json', import.meta.url), 'utf8')) as { variants: { cases: Array<{ labels: Record<string, string> }> } }).variants.cases;

test('a planted reference of every library task is found, raw or resolved for a variant, alone or inside a reply', () => {
  const markers = hiddenReferenceMarkers();
  assert.ok(markers.length > library.tasks.length * 3, `${markers.length} markers`);
  for (const task of library.tasks) {
    const sources = (text: string): string[] => scanForHiddenReferences([{ where: 'planted', text }], markers).map(finding => finding.source);
    // The oracle sidecar as `tasks from-scenes` and the library write it.
    assert.ok(sources(JSON.stringify({ ok: true, value: { oracle: task.oracle } })).some(source => source.startsWith(`${task.id}: reference steps`)), task.id);
    // Only the step list, with the labels of the variant the Player would be showing.
    const labels = cases[1]!.labels;
    const resolved = JSON.parse(JSON.stringify(task.oracle.steps).replace(/\{\{([^{}]+)\}\}/g, (whole, token: string) => labels[token] ?? whole));
    assert.ok(sources(`event: changed\ndata: {"hint":${JSON.stringify(resolved)}}`).some(source => source.startsWith(`${task.id}:`)), `${task.id} resolved`);
    assert.ok(sources(JSON.stringify(task.oracle.nearMisses[0]!.steps)).some(source => source.startsWith(`${task.id}: near miss`)), `${task.id} near miss`);
  }
  assert.deepEqual(scanForHiddenReferences([{ where: 'planted', text: 'Close a review process' }], markers).map(finding => finding.source), ['example held-out H1']);
});

test('the example world\'s own public play is not mistaken for a reference', async () => {
  const world = validateWorld(JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')));
  const captured: Array<{ where: string; text: string }> = [];
  for (const taskId of ['T1', 'T2', 'T3']) {
    const inner = await createPracticeController(world, { seed: 42, taskId, mirror: 'off' }, async () => { throw new Error('model-only'); });
    const { controller, demonstration } = withDemonstration(inner, world, { pause: async () => {} });
    controller.subscribe(event => captured.push({ where: `${taskId} event`, text: JSON.stringify(event) }));
    try {
      // T3's demonstration ends with delete_step on b: the very action of the library's remove-step.
      assert.equal((await demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      for (let i = 0; i < 100 && demonstration.status()?.state === 'running'; i++) await new Promise(resolve => setImmediate(resolve));
      assert.equal(demonstration.status()?.state, 'finished');
      captured.push({ where: `${taskId} view`, text: JSON.stringify(controller.view()) });
    } finally { await controller.close(); }
  }
  assert.ok(captured.some(item => item.text.includes('{"name":"delete_step","params":{"id":"b"}')), 'the shared action is in the corpus');
  assert.deepEqual(scanForHiddenReferences(captured), []);
});

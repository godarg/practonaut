// The scanner that guards "no library or bench reference reaches the Player" (0.2.0 Should 7) must
// find a reference of every library task however it is written or wrapped, must find a reference
// that was actually played through a practice session, and must not flag the example world's own,
// public play, which uses some of the same actions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { distinctive, hiddenReferences, scanForHiddenReferences } from '../support/oracle-scan.ts';
import { createPracticeController } from '../../src/host/session.ts';
import { withDemonstration } from '../../src/host/demonstration.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { Action } from '../../src/world/types.ts';

const library = JSON.parse(readFileSync(new URL('../../tasks/excalidraw/library.json', import.meta.url), 'utf8')) as { tasks: Array<{ id: string; oracle: { seeds: Record<string, number>; steps: Array<{ name: string; params: Record<string, unknown> }>; nearMisses: Array<{ steps: unknown[] }> } }> };
const cases = (JSON.parse(readFileSync(new URL('../../tasks/excalidraw/world/world.json', import.meta.url), 'utf8')) as { variants: { cases: Array<{ labels: Record<string, string> }> } }).variants.cases;
const found = (text: string): string[] => scanForHiddenReferences([{ where: 'planted', text }]).map(finding => finding.source);
/** The same JSON with every object's keys in reverse order. */
const reversed = (value: unknown): unknown => Array.isArray(value) ? value.map(reversed) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversed(child)])) : value;

test('the reference of every library task is found as a step list in any formatting and key order', () => {
  for (const task of library.tasks) {
    assert.ok(found(JSON.stringify({ ok: true, value: { oracle: task.oracle } })).includes(`${task.id}: reference steps`), task.id);
    assert.ok(found(JSON.stringify(reversed(task.oracle), null, 2)).includes(`${task.id}: reference steps`), `${task.id} indented, keys reversed`);
    const labels = cases[2]!.labels;
    const resolved = JSON.parse(JSON.stringify(task.oracle.steps).replace(/\{\{([^{}]+)\}\}/g, (whole, token: string) => labels[token] ?? whole));
    assert.ok(found(`event: changed\ndata: {"hint":${JSON.stringify(resolved)}}\n\n`).includes(`${task.id}: reference steps`), `${task.id} resolved, in an event`);
    assert.ok(found(JSON.stringify(task.oracle.nearMisses[0]!.steps)).some(source => source.startsWith(`${task.id}: near miss`)), `${task.id} near miss`);
  }
  assert.deepEqual(found('<p>Close a review\n  process</p>'), ['example held-out H1']);
});

test('a single distinctive reference action is found wherever it is wrapped: history with baseStep, a log, a script literal', () => {
  const restyle = library.tasks.find(task => task.id === 'restyle-flow')!.oracle.steps;
  assert.equal(distinctive(restyle[0] as never), true);
  const step = restyle[0]!;
  const history = JSON.stringify({ history: [{ description: { en: 'x', de: 'x' }, actor: { kind: 'human' }, action: { params: { fill: 'none', stroke: 'black', shape: 'ellipse', id: 'a' }, name: 'set_style', baseStep: 3 } }] }, null, 4);
  assert.ok(found(history).includes('restyle-flow: reference step set_style'), 'history entry, keys in another order, baseStep, indented');
  assert.ok(found(`const plan = [{ name: "${step.name}", params: { id: 'a', shape: "ellipse", stroke: "black", fill: "none" } }];`).includes('restyle-flow: reference step set_style'), 'script literal');
  // A step of ids only is an ordinary action elsewhere and is not a finding on its own.
  assert.deepEqual(found(JSON.stringify({ log: [{ action: { name: 'delete_step', params: { id: 'b' } }, hash: 'h' }] })), []);
});

test('a reference played through a practice session of the library is found in its replies and events', async () => {
  const world = validateWorld(JSON.parse(readFileSync(new URL('../../tasks/excalidraw/world/world.json', import.meta.url), 'utf8')));
  const task = library.tasks.find(item => item.id === 'restyle-flow')!;
  const controller = await createPracticeController(world, { seed: task.oracle.seeds.drawn!, taskId: task.id, mirror: 'off' }, async () => { throw new Error('model-only'); });
  const captured: Array<{ where: string; text: string }> = [];
  controller.subscribe(event => captured.push({ where: 'event', text: `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n` }));
  try {
    for (const step of task.oracle.steps) {
      const view = controller.view();
      const reply = await controller.act({ expectedRevision: view.revision, action: { name: step.name, params: step.params as Action['params'], baseStep: view.step } });
      assert.equal(reply.ok, true, JSON.stringify(reply));
      captured.push({ where: 'act reply', text: JSON.stringify(reply) });
    }
    assert.equal((await controller.check({ expectedRevision: controller.view().revision })).ok, true);
    captured.push({ where: 'observe', text: JSON.stringify({ ok: true, value: controller.view() }) });
  } finally { await controller.close(); }
  const sources = scanForHiddenReferences(captured).filter(finding => finding.where === 'observe').map(finding => finding.source);
  assert.ok(sources.includes('restyle-flow: reference played'), sources.join('; '));
  assert.ok(sources.includes('restyle-flow: reference step set_style'));
  assert.ok(scanForHiddenReferences(captured).some(finding => finding.where === 'event' && finding.source === 'restyle-flow: reference played'), 'the event stream carries it too');
});

test('the example world\'s own public play is not mistaken for a reference', async () => {
  const world = validateWorld(JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')));
  const captured: Array<{ where: string; text: string }> = [];
  for (const taskId of ['T1', 'T2', 'T3']) {
    const inner = await createPracticeController(world, { seed: 42, taskId, mirror: 'off' }, async () => { throw new Error('model-only'); });
    const { controller, demonstration } = withDemonstration(inner, world, { pause: async () => {} });
    controller.subscribe(event => captured.push({ where: `${taskId} event`, text: `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n` }));
    try {
      // T3's demonstration ends with delete_step on b: the very action of the library's remove-step.
      assert.equal((await demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      for (let i = 0; i < 100 && demonstration.status()?.state === 'running'; i++) await new Promise(resolve => setImmediate(resolve));
      assert.equal(demonstration.status()?.state, 'finished');
      captured.push({ where: `${taskId} view`, text: JSON.stringify(controller.view(), null, 2) });
    } finally { await controller.close(); }
  }
  assert.ok(captured.some(item => /"name": "delete_step",\s*"params": \{\s*"id": "b"/.test(item.text)), 'the shared action is in the corpus');
  assert.deepEqual(scanForHiddenReferences(captured), []);
  assert.ok(hiddenReferences().patterns.length > library.tasks.length);
});

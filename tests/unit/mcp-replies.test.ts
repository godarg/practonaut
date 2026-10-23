// The agent-facing reply shapes (PADR-0038) and the host's mutation delta. Expected values are
// written by hand from the hand-built view below, never taken from the functions under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkResult, compactView, fullView, localize, mutationResult } from '../../src/mcp/replies.ts';
import { inputProblems, toolSchemasFor, TOOL_SCHEMAS } from '../../src/mcp/contracts.ts';
import { boundedDelta, mutationDelta, publicConditions } from '../../src/host/session.ts';
import { toolResult } from '../../src/mcp/server.ts';
import { loadLibrary } from '../../src/library/index.ts';
import type { HostView, MutationDelta, PublicCheck } from '../../src/host/protocol.ts';
import type { State } from '../../src/world/types.ts';

const step = (id: string, label: string, deleted = false) => ({ id, type: 'step' as const, frameId: 'f', label, x: 0, y: 0, width: 100, height: 50, deleted });
const check: PublicCheck = { scope: 'end-state-only', hash: 'h1', revision: 3, passed: false, conditions: [{ id: 'goal-1', text: { en: 'A is first', de: 'A ist zuerst' }, formalText: { en: 'exists a', de: 'es gibt a' }, met: true }], errors: [{ id: 'loose', explanation: { en: 'Loose end', de: 'Loses Ende' } }], mode: 'model-only', practiceEvidence: false };
const view = {
  schema: 'practonaut.host/1', sessionId: 's', revision: 3, world: { id: 'w', version: '1', adapterId: 'excalidraw' }, seed: 1, variantId: 'v',
  task: { id: 'T1', title: { en: 'Title', de: 'Titel' }, prompt: { en: 'Do it', de: 'Mach es' }, conditions: [{ id: 'goal-1', text: { en: 'A is first', de: 'A ist zuerst' }, formalText: { en: 'exists a', de: 'es gibt a' } }], hintCount: 2 },
  tasks: [{ id: 'T1', title: { en: 'Title', de: 'Titel' }, level: 1, referenceActions: 3 }],
  state: { objects: { f: { id: 'f', type: 'frame', name: 'Flow', deleted: false }, a: step('a', 'A'), z: step('z', 'Gone', true) } }, hash: 'h1', step: 7,
  log: [], history: Array.from({ length: 7 }, (_, index) => ({ description: { en: `did ${index}`, de: `tat ${index}` }, actor: { kind: 'human' as const }, step: index + 1, action: { name: 'move_step', params: {} }, hash: 'h', effects: [], consequences: [], ruleIds: [], mirrorConfirmed: true, latencyMs: 4 })),
  actions: [], rules: [], mirror: 'off', mirrorHealth: { status: 'model-only', recoveries: 0 }, practiceEvidence: false, attempt: 2, hintsOpened: 1,
  hints: [{ en: 'Hint', de: 'Hinweis' }], result: check, errors: [{ id: 'loose', explanation: { en: 'Loose end', de: 'Loses Ende' } }],
} as unknown as HostView;

test('localize picks one language for every {en, de} text and keeps both on request', () => {
  const value = { a: { en: 'x', de: 'y' }, list: [{ text: { en: 'p', de: 'q' }, n: 1 }], other: { en: 'only en' } };
  assert.deepEqual(localize(value, 'en'), { a: 'x', list: [{ text: 'p', n: 1 }], other: { en: 'only en' } });
  assert.deepEqual(localize(value, 'de'), { a: 'y', list: [{ text: 'q', n: 1 }], other: { en: 'only en' } });
  assert.deepEqual(localize(value, 'both'), value);
});

test('compact observe: task with goal conditions in the chosen language, live objects, a history window, the last check by id', () => {
  const compact = compactView(view, 'de', 2);
  assert.deepEqual(compact, {
    task: { id: 'T1', title: 'Titel', prompt: 'Mach es', conditions: [{ id: 'goal-1', text: 'A ist zuerst', formalText: 'es gibt a' }], hintCount: 2 },
    state: { objects: { f: { id: 'f', type: 'frame', name: 'Flow', deleted: false }, a: step('a', 'A') } },
    step: 7, revision: 3, mirror: { mode: 'off', status: 'model-only' }, practiceEvidence: false,
    history: { total: 7, recent: [{ step: 6, actor: { kind: 'human' }, description: 'tat 5', mirrorConfirmed: true }, { step: 7, actor: { kind: 'human' }, description: 'tat 6', mirrorConfirmed: true }] },
    result: { revision: 3, passed: false, conditions: [{ id: 'goal-1', met: true }] },
    errors: [{ id: 'loose', explanation: 'Loses Ende' }], hints: ['Hinweis'], attempt: 2,
  });
  assert.equal(compactView(view, 'en', 0).history.recent.length, 0);
  assert.equal(compactView(view, 'en').history.recent.length, 5);
  assert.deepEqual(fullView(view, 'both'), view);
  assert.equal(fullView(view, 'en').task.title as unknown, 'Title');
});

test('every library task: compact observe and check_result carry each goal condition exactly as the Player shows it', () => {
  // The Player renders text[lang] and formalText[lang] of the host's public conditions (publicConditions).
  const { world } = loadLibrary();
  for (const task of world.tasks) {
    const conditions = publicConditions(task).map(({ id, text, formalText }) => ({ id, text, ...(formalText ? { formalText } : {}) }));
    assert.ok(conditions.length > 0, task.id);
    const taskView = { ...view, task: { ...view.task, id: task.id, conditions } } as HostView;
    for (const lang of ['en', 'de'] as const) {
      assert.deepEqual(compactView(taskView, lang).task.conditions, conditions.map(condition => ({ id: condition.id, text: condition.text[lang], ...(condition.formalText ? { formalText: condition.formalText[lang] } : {}) })), `${task.id} ${lang}`);
      const checked = checkResult({ ...check, conditions: conditions.map(condition => ({ ...condition, met: false })) }, lang);
      assert.deepEqual(checked.conditions.map(condition => [condition.text, condition.formalText]), conditions.map(condition => [condition.text[lang], condition.formalText?.[lang]]));
    }
  }
});

test('a result goes as text and structured content; too large for both, as text alone; too large for that, refused by name', () => {
  const reply = { ok: true, value: { label: '"quoted"'.repeat(10) } };
  const both = toolResult(reply, 10_000);
  assert.deepEqual(both.structuredContent, reply); assert.deepEqual(JSON.parse(both.content[0]!.text), reply);
  // Escaping counts: the text part of this reply is larger than the reply itself.
  const size = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }], isError: false }));
  const textOnly = toolResult(reply, size);
  assert.equal('structuredContent' in textOnly, false); assert.deepEqual(JSON.parse(textOnly.content[0]!.text), reply);
  const refused = toolResult(reply, size - 1);
  assert.equal(refused.isError, true); assert.deepEqual(refused.structuredContent, { ok: false, error: { code: 'result_too_large', message: 'Tool reply exceeds result budget' } });
});

test('a delta too large to send keeps its ids and leaves the changed objects out', () => {
  const big = { step: 1, revision: 2, hash: 'h', changed: { a: step('a', 'x'.repeat(2000)) }, created: ['a'], removed: [], effects: [], errors: [] } as unknown as MutationDelta;
  assert.equal(boundedDelta(big, 100_000), big);
  assert.deepEqual(boundedDelta(big, 1000), { ...big, changed: {}, changedOmitted: true });
});

test('the host delta lists changed objects as they are now, created ids and removed ids; the agent result localises its errors', () => {
  const before: State = { objects: { f: { id: 'f', type: 'frame', name: 'Flow', deleted: false }, a: step('a', 'A'), b: step('b', 'B') } } as unknown as State;
  const after = { ...view, step: 4, revision: 9, hash: 'h9', state: { objects: { f: before.objects.f!, a: step('a', 'A2'), b: step('b', 'B', true), c: step('c', 'C') } } } as unknown as HostView;
  const delta = mutationDelta(before, after, [{ kind: 'set_label', id: 'a' }]);
  assert.deepEqual(delta, { step: 4, revision: 9, hash: 'h9', changed: { a: step('a', 'A2'), b: step('b', 'B', true), c: step('c', 'C') }, created: ['c'], removed: ['b'], effects: [{ kind: 'set_label', id: 'a' }], errors: view.errors });
  assert.deepEqual(mutationResult({ delta, mirrorConfirmed: false, latencyMs: 3 }, 'en'), { step: 4, revision: 9, changed: delta.changed, created: ['c'], removed: ['b'], effects: [{ kind: 'set_label', id: 'a' }], errors: [{ id: 'loose', explanation: 'Loose end' }], mirrorConfirmed: false, latencyMs: 3 });
});

test('refused tool input names each path and what it expects', () => {
  const { world } = loadLibrary();
  const schemas = toolSchemasFor(world.actions);
  assert.match(inputProblems(schemas, 'act', { name: 'move_step', params: { id: 'a', x: 'ten', y: 0 }, baseStep: 0, expectedRevision: 0 }, world.actions), /params\.x: move_step: .*expected number/i);
  const unknownKey = inputProblems(schemas, 'act', { name: 'move_step', params: { id: 'a', x: 1, y: 1, MARKER_KEY: 2 }, baseStep: 0, expectedRevision: 0 }, world.actions);
  assert.match(unknownKey, /params: move_step: an unknown key \(its parameters: id, x, y\)/); assert.equal(unknownKey.includes('MARKER_KEY'), false, 'input text is never repeated');
  assert.match(inputProblems(schemas, 'act', { name: 'move_step', params: { id: 'a', x: 1, y: 1 }, expectedRevision: 0 }, world.actions), /baseStep: .*expected number/i);
  assert.match(inputProblems(schemas, 'act', { name: 'fly', params: {}, baseStep: 0, expectedRevision: 0 }, world.actions), /^name: .*expected one of/i);
  assert.match(inputProblems(TOOL_SCHEMAS, 'observe', { detail: 'everything' }), /detail: .*"compact"\|"full"/);
  assert.match(inputProblems(TOOL_SCHEMAS, 'reset', { expectedRevision: 1 }), /confirmed: /);
  assert.equal(inputProblems(TOOL_SCHEMAS, 'MARKER_TOOL', {}), 'unknown tool; the tools are observe, list_actions, act, undo, reset, explain_result, check_result');
  assert.equal(inputProblems(schemas, 'act', { name: 'move_step', params: { id: 'a', x: 'MARKER_VALUE', y: 0 }, baseStep: 0, expectedRevision: 0 }, world.actions).includes('MARKER_VALUE'), false);
  assert.equal(inputProblems(TOOL_SCHEMAS, 'observe', {}), '');
  assert.ok(inputProblems(schemas, 'act', { name: 'move_step', params: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`p${index}`.repeat(20), index])), baseStep: 0, expectedRevision: 0 }, world.actions).length <= 600);
});

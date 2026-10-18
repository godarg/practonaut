import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as agent from '../../tools/agent-runs.ts';
import type { HostEvent, HostView } from '../../src/host/protocol.ts';
import type { Predicate, World } from '../../src/world/types.ts';
import { stateHash } from '../../src/canonical/index.ts';
import { generateVariant } from '../../src/world/variant.ts';

// Hand-derived synthetic public-data oracle: removing b changes 3 live steps to 2;
// moving a does not. No browser, mirror, process stub or agent is invoked here.
const source = JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')) as World;
const countSteps = (count: number): Predicate => ({ op: 'eq', left: { kind: 'count', type: 'step', as: 'o', where: { op: 'true' } }, right: { kind: 'literal', value: count } });
const hasA: Predicate = { op: 'exists', type: 'step', as: 's', where: { op: 'eq', left: { kind: 'field', variable: 's', field: 'id' }, right: { kind: 'literal', value: 'a' } } };
const template = source.tasks.find(task => task.id === 'T3')!;
const world: World = { ...source, tasks: [{ ...template, id: 'CounterProbe', goal: { op: 'all', args: [countSteps(2), hasA] } }] };

function fixture() {
  const state = structuredClone(generateVariant(world, 42).tasks[0]!.initialState!);
  const hash = stateHash(state);
  const prefix = { action: { name: 'move_step', params: { id: 'a', x: 100, y: 180 }, baseStep: 0 }, hash };
  const before: HostView = {
    schema: 'practonaut.host/1', sessionId: 'synthetic-counter-session', revision: 3,
    world: { id: world.id, version: world.version, adapterId: world.app.adapterId }, seed: 42, variantId: 'synthetic-variant',
    task: { id: 'CounterProbe', title: { en: 'Synthetic counter probe', de: 'Synthetische Zählerprobe' }, prompt: { en: 'Remove b', de: 'b entfernen' }, conditions: [], hintCount: 1 },
    tasks: [], state, hash, step: 1, log: [prefix], history: [], actions: world.actions,
    rules: world.rules, mirror: 'required', mirrorHealth: { status: 'available', recoveries: 0 },
    practiceEvidence: true, attempt: 1, hintsOpened: 0, hints: [], result: null, errors: [],
  };
  const final = structuredClone(before);
  final.state.objects.b!.deleted = true;
  // delete_step also detaches b's endpoints, per the independently specified action.
  for (const object of Object.values(final.state.objects)) if (object.type === 'arrow') {
    if (object.from === 'b') object.from = null;
    if (object.to === 'b') object.to = null;
  }
  final.hash = stateHash(final.state); final.step++; final.revision++;
  final.log.push({ action: { name: 'delete_step', params: { id: 'b' }, baseStep: before.step }, hash: final.hash });
  const events: HostEvent[] = [{ type: 'ready', view: structuredClone(before) }, { type: 'changed', view: structuredClone(final) }, { type: 'changed', view: structuredClone(final) }];
  const tools = [{ name: 'mcp__practonaut__observe' }, { name: 'mcp__practonaut__list_actions' }, { name: 'mcp__practonaut__act', input: { name: 'delete_step', params: { id: 'b' }, baseStep: before.step, expectedRevision: before.revision } }, { name: 'mcp__practonaut__check_result' }];
  return { before, final, events, tools };
}

type Input = ReturnType<typeof fixture>;
function classify(f: Input, goalWorld = world, goalProgress = true) {
  // Original-blob negative control: execute its exact two source statements, rather
  // than a rewritten approximation of the revision counter. This branch is used
  // only when the original product has no new pure evidence function.
  const exported = agent as unknown as { assertSingleAction?: (before: HostView, final: HostView, events: HostEvent[], tools: Input['tools']) => unknown; assertSingleGoalAction?: (before: HostView, final: HostView, events: HostEvent[], tools: Input['tools'], world: World) => unknown };
  if (goalProgress && exported.assertSingleGoalAction) return exported.assertSingleGoalAction(f.before, f.final, f.events, f.tools, goalWorld);
  if (!goalProgress && exported.assertSingleAction) return exported.assertSingleAction(f.before, f.final, f.events, f.tools);
  const text = readFileSync(new URL('../../tools/agent-runs.ts', import.meta.url), 'utf8');
  const statements = text.match(/    const mutations = new Set\(events\.flatMap\(value => value\.type === "changed"[^\n]+\n    if \(options\.singleMutation\) assert\.equal\(mutations, 1, "This interleaving turn must commit exactly one action"\);/g);
  assert.equal(statements?.length, 1, 'original counter must resolve to exactly one complete source block');
  return new Function('events', 'before', 'options', 'assert', statements![0]!)(f.events, f.before, { singleMutation: true }, assert);
}

test('a hint-only revision cannot stand in for the promised goal action', () => {
  const f = fixture(); f.final = structuredClone(f.before); f.final.revision++; f.final.hintsOpened++;
  f.events = [{ type: 'ready', view: f.before }, { type: 'changed', view: f.final }];
  f.tools = [{ name: 'mcp__practonaut__observe' }, { name: 'mcp__practonaut__check_result' }];
  assert.throws(() => classify(f, world, false), /appended successful action|native MCP act/);
});

test('a refused act plus a hint still cannot prove a successful action', () => {
  const f = fixture(); f.final = structuredClone(f.before); f.final.revision++;
  f.events = [{ type: 'ready', view: f.before }, { type: 'rejected', revision: f.before.revision, hash: f.before.hash, error: { code: 'stale_base', message: 'Refused synthetic act' } }, { type: 'changed', view: f.final }];
  assert.throws(() => classify(f, world, false), /appended successful action/);
});

test('one actual committed goal action preserves the complete prefix and may be followed by a same-revision check', () => {
  const f = fixture(); const proof = classify(f) as agent.SingleGoalActionEvidence;
  assert.equal(proof.nativeActCount, 1); assert.equal(proof.committedActions, 1);
  assert.equal(proof.prefixLength, 1); assert.equal(proof.actionRevision, 4);
  assert.deepEqual(proof.goalArguments, { before: [false, true], after: [true, true], advanced: [0] });
});

test('an additional hint revision is not counted as another action commit', () => {
  const f = fixture(); const afterHint = structuredClone(f.final); afterHint.revision++; afterHint.hintsOpened++;
  f.events.push({ type: 'changed', view: afterHint }); f.final = afterHint;
  const proof = classify(f) as agent.SingleGoalActionEvidence;
  assert.equal(proof.committedActions, 1); assert.equal(proof.actionRevision, 4);
});

test('a neutral committed act/revision does not advance the original goal arguments', () => {
  const f = fixture(); f.final.state = structuredClone(f.before.state);
  const a = f.final.state.objects.a!; if (a.type !== 'step') throw Error('independent fixture expects step a'); a.x++;
  f.final.hash = stateHash(f.final.state);
  const action = { name: 'move_step', params: { id: 'a', x: a.x, y: a.y }, baseStep: f.before.step };
  f.final.log[1] = { action, hash: f.final.hash }; f.tools[2]!.input = { ...action, expectedRevision: f.before.revision };
  f.events = [{ type: 'ready', view: f.before }, { type: 'changed', view: f.final }];
  assert.throws(() => classify(f), /no original goal argument advanced/);
  const generic = classify(f, world, false) as agent.SingleActionEvidence;
  assert.equal(generic.committedActions, 1); assert.equal(generic.goalProgress, 'not-assessed');
  assert.equal(generic.goalArguments, undefined);
});

test('the unchanged original quantified T3 interleaving retains its generic single-action proof', () => {
  const f = fixture(); const original = generateVariant(source, 42);
  f.before.task.id = 'T3'; f.before.state = structuredClone(original.tasks.find(task => task.id === 'T3')!.initialState!);
  const ab = f.before.state.objects.ab!; if (ab.type !== 'arrow') throw Error('fixture expects arrow ab'); ab.to = 'c';
  f.before.hash = stateHash(f.before.state);
  f.before.log = [{ action: { name: 'reconnect_end', params: { id: 'ab', end: 'end', target: 'c' }, baseStep: 0 }, hash: f.before.hash }];
  f.final = structuredClone(f.before); f.final.state.objects.bc!.deleted = true;
  f.final.hash = stateHash(f.final.state); f.final.step++; f.final.revision++;
  const action = { name: 'disconnect', params: { id: 'bc' }, baseStep: f.before.step };
  f.final.log.push({ action, hash: f.final.hash });
  f.tools = [{ name: 'mcp__practonaut__act', input: { ...action, expectedRevision: f.before.revision } }];
  f.events = [{ type: 'ready', view: f.before }, { type: 'changed', view: f.final }];
  const proof = classify(f, source, false) as agent.SingleActionEvidence;
  assert.equal(proof.committedActions, 1); assert.equal(proof.goalProgress, 'not-assessed');
  assert.throws(() => classify(f, source), /no original goal argument advanced/);
});

test('one successful host commit needs its exact actual native act name and observed input', () => {
  for (const change of ['absent', 'name', 'params', 'step', 'input'] as const) {
    const f = fixture();
    if (change === 'absent') f.tools.splice(2, 1);
    if (change === 'name') f.tools[2]!.input!.name = 'disconnect';
    if (change === 'params') f.tools[2]!.input!.params.id = 'a';
    if (change === 'step') f.tools[2]!.input!.baseStep++;
    if (change === 'input') delete f.tools[2]!.input;
    assert.throws(() => classify(f), /native MCP act|native act/);
  }
});

test('undo/reset and multiple native act uses cannot establish the single action promise', () => {
  for (const name of ['mcp__practonaut__undo', 'mcp__practonaut__reset', 'mcp__practonaut__act']) {
    const f = fixture(); f.tools.push({ name });
    assert.throws(() => classify(f), /undo or reset|exactly one native MCP act/);
  }
  const f = fixture(); f.final.log.push(structuredClone(f.final.log[1]!)); f.final.step++;
  f.events = [{ type: 'ready', view: f.before }, { type: 'changed', view: f.final }];
  assert.throws(() => classify(f), /exactly one appended successful action/);
});

test('replacement of any original prefix entry is refused even when length and final hash match', () => {
  const f = fixture(); f.final.log[0]!.action.params.id = 'c';
  f.events = [{ type: 'ready', view: f.before }, { type: 'changed', view: f.final }];
  assert.throws(() => classify(f), /complete original action-log prefix/);
});

test('the public stream must contain the complete guarded action transition and final observation', () => {
  for (const change of ['missing', 'jump', 'stale', 'intermediate', 'final'] as const) {
    const f = fixture();
    if (change === 'missing') f.events = [{ type: 'ready', view: f.before }];
    if (change === 'jump') { f.final.revision++; f.events = [{ type: 'ready', view: f.before }, { type: 'changed', view: f.final }]; }
    if (change === 'stale') f.tools[2]!.input!.expectedRevision--;
    if (change === 'intermediate') { const bad = structuredClone(f.before); bad.log[0]!.action.params.id = 'c'; f.events.splice(1, 0, { type: 'changed', view: bad }); }
    if (change === 'final') f.final.revision++;
    assert.throws(() => classify(f), /public stream|revision guard|complete original action-log prefix/);
  }
});

test('session, seed, task and original world binding cannot change', () => {
  for (const change of ['session', 'seed', 'task', 'world', 'attempt'] as const) {
    const f = fixture();
    if (change === 'session') f.final.sessionId += '-changed';
    if (change === 'seed') f.final.seed++;
    if (change === 'task') f.final.task.id = 'Other';
    if (change === 'world') f.final.world.version = '99';
    if (change === 'attempt') f.final.attempt++;
    assert.throws(() => classify(f), /session, world, seed, task/);
  }
  const f = fixture(); assert.throws(() => classify(f, { ...world, id: 'Other' }), /goal world/);
});

test('all original arguments count, including an unnarrated regression or quantified unsolved goal', () => {
  const f = fixture();
  const other = { ...world, tasks: [{ ...world.tasks[0]!, goal: { op: 'all', args: [countSteps(2), countSteps(3)] } as Predicate }] };
  assert.throws(() => classify(f, other), /original goal argument regressed/);
  const quantified: Predicate = { op: 'exists', type: 'step', as: 's', where: { op: 'all', args: [hasA, countSteps(1)] } };
  assert.throws(() => classify(f, { ...world, tasks: [{ ...world.tasks[0]!, goal: quantified }] }), /no original goal argument advanced/);
});

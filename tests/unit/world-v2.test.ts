import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { stateHash } from '../../src/canonical/index.ts';
import { Session } from '../../src/core/index.ts';
import { evaluate } from '../../src/predicate/index.ts';
import { checkState, checkSubmission, CheckerError } from '../../src/checker/index.ts';
import { verifySessionHistory } from '../../src/checker/replay.ts';
import { generateVariant, validateState, validateWorld, WorldError } from '../../src/world/index.ts';
import type { Action, Arrow, Predicate, State, StepV2 } from '../../src/world/types.ts';
import { stepV2, v2Start, v2Task, v2World } from '../support/world-v2.ts';

const must = (session: Session, action: Action): void => { const r = session.act(action); assert.equal(r.ok, true, !r.ok ? `${r.error.code}: ${r.error.message}` : undefined); };
const rejected = (session: Session, action: Action, code: string): void => {
  const before = session.serialize(); const r = session.act(action);
  assert.equal(r.ok, false, `${action.name} should be rejected`); if (!r.ok) assert.equal(r.error.code, code, r.error.message);
  assert.deepEqual(session.serialize(), before);
};
const step = (state: State, id: string): StepV2 => state.objects[id] as StepV2;
const literal = (value: string | number | null) => ({ kind: 'literal' as const, value });
const field = (variable: string, name: string) => ({ kind: 'field' as const, variable, field: name });

describe('world/2 format', () => {
  it('fills explicit defaults once; a validated world validates to itself', () => {
    const world = v2World();
    assert.equal(world.schema, 'practonaut.world/2');
    assert.equal(world.actions.length, 13);
    assert.deepEqual(world.rules, []);
    assert.deepEqual(world.variants.cases, [{ id: 'default', labels: {}, params: {}, layoutOffset: { x: 0, y: 0 } }]);
    assert.deepEqual(world.actions.find(a => a.name === 'set_style')!.parameters.fill, { type: 'enum', values: ['none', 'red', 'green', 'blue', 'yellow'] });
    assert.deepEqual(validateWorld(structuredClone(world)), world);
  });
  it('world/1 stays world/1: the bundled example validates unchanged and rejects world/2 vocabulary', () => {
    const raw = JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    const world = validateWorld(structuredClone(raw));
    assert.equal(world.schema, 'practonaut.world/1');
    assert.equal(stateHash(world.initialState), stateHash(raw.initialState));
    assert.deepEqual(validateWorld(structuredClone(world)), world);
    const near = structuredClone(raw) as { tasks: Array<{ goal: Predicate }> };
    near.tasks[0]!.goal = { op: 'near', left: literal(1), right: literal(2), tolerance: 1 };
    assert.throws(() => validateWorld(near), WorldError);
    type Raw = { objects: Record<string, Record<string, unknown>> };
    const shaped = structuredClone(raw) as { initialState: Raw; tasks: Array<{ initialState?: Raw }> };
    const first = [shaped.initialState, ...shaped.tasks.flatMap(t => t.initialState ? [t.initialState] : [])].flatMap(s => Object.values(s.objects)).find(o => o.type === 'step')!;
    first.shape = 'ellipse';
    assert.throws(() => validateWorld(shaped), WorldError);
  });
  it('rejects mixed eras, arrow frames that disagree with their ends and unknown palette names', () => {
    const v1Step = { id: 'x', type: 'step', deleted: false, frameId: 'f', label: 'Old', x: 0, y: 0, width: 10, height: 10, fontFamily: 3 };
    assert.throws(() => validateState({ objects: { ...structuredClone(v2Start.objects), x: v1Step } }, 2), WorldError);
    const wrongFrame = structuredClone(v2Start); (wrongFrame.objects.ab as { frameId: string | null }).frameId = null;
    assert.throws(() => validateState(wrongFrame, 2), /arrow frame/);
    const colour = structuredClone(v2Start) as unknown as { objects: Record<string, Record<string, unknown>> }; colour.objects.a!.fill = 'purple';
    assert.throws(() => validateState(colour, 2), WorldError);
    // A frameless step and a cross-frame arrow are world/2 facts, not errors.
    const cross = structuredClone(v2Start); cross.objects.bc = { id: 'bc', type: 'arrow', deleted: false, frameId: null, from: 'b', to: 'c' };
    assert.doesNotThrow(() => validateState(cross, 2));
    assert.throws(() => validateState(cross, 1), WorldError);
  });
  it('a world/2 action may tighten bounds but never change its parameter set or types', () => {
    assert.throws(() => v2World({ actions: [{ name: 'add_step', parameters: { label: { type: 'string' } } }] }), /exactly its built-in parameters/);
    assert.throws(() => v2World({ actions: [{ name: 'set_style', parameters: { id: { type: 'id' }, shape: { type: 'enum', values: ['hexagon'] }, stroke: { type: 'enum', values: ['black'] }, fill: { type: 'enum', values: ['none'] } } }] }), /unknown values/);
    const tight = v2World({ actions: [{ name: 'rename_step', parameters: { id: { type: 'id' }, label: { type: 'string', max: 5 } } }] });
    const session = new Session(tight, 0, 'T1');
    rejected(session, { name: 'rename_step', params: { id: 'a', label: 'Too long' } }, 'invalid_argument');
    rejected(session, { name: 'move_step', params: { id: 'a', x: 1, y: 1 } }, 'unmodeled');
  });
  it('condition texts must match the goal clauses one to one', () => {
    assert.throws(() => v2World({ tasks: [v2Task({ conditionTexts: [{ en: 'One', de: 'Eins' }] })] }), /condition text/);
    assert.doesNotThrow(() => v2World({ tasks: [v2Task({ conditionTexts: [{ en: 'Two arrows.', de: 'Zwei Pfeile.' }, { en: 'Check to Ship.', de: 'Prüfen zu Versand.' }] })] }));
  });
  it('variant params and labels substitute as tokens; layout offsets move steps', () => {
    const world = v2World({
      initialState: { objects: { a: stepV2('a', '{{first}}', 0, 0) } },
      tasks: [v2Task({ prompt: { en: 'Name it {{target}}.', de: 'Nenne es {{target}}.' }, goal: { op: 'exists', type: 'step', as: 's', where: { op: 'eq', left: field('s', 'label'), right: literal('{{target}}') } } })],
      variants: { generator: 'finite-seeded-v1', cases: [{ id: 'one', labels: { first: 'Draft' }, params: { target: 'Final' }, layoutOffset: { x: 10, y: 20 } }] },
    });
    const variant = generateVariant(world, 7);
    assert.equal(step(variant.initialState, 'a').label, 'Draft');
    assert.deepEqual([step(variant.initialState, 'a').x, step(variant.initialState, 'a').y], [10, 20]);
    assert.equal(variant.tasks[0]!.prompt.en, 'Name it Final.');
  });
});

describe('world/2 predicates', () => {
  const state: State = { objects: { a: stepV2('a', 'Review order', 100, 203), b: stepV2('b', 'Ship', 400, 200, { fill: 'blue' }) } };
  const pair = (body: Predicate): Predicate => ({ op: 'exists', type: 'step', as: 's', where: { op: 'all', args: [{ op: 'eq', left: field('s', 'id'), right: literal('a') }, { op: 'exists', type: 'step', as: 't', where: { op: 'all', args: [{ op: 'eq', left: field('t', 'id'), right: literal('b') }, body] } }] } });
  const value = (p: Predicate): boolean => { const r = evaluate(p, state); assert.equal(r.ok, true, !r.ok ? r.error.message : undefined); return r.ok && r.value; };
  it('near compares integers within a tolerance, in both directions', () => {
    assert.equal(value(pair({ op: 'near', left: field('s', 'y'), right: field('t', 'y'), tolerance: 3 })), true);
    assert.equal(value(pair({ op: 'near', left: field('t', 'y'), right: field('s', 'y'), tolerance: 2 })), false);
    assert.equal(value(pair({ op: 'near', left: field('s', 'x'), right: field('t', 'x'), tolerance: 299 })), false);
  });
  it('contains and startsWith are exact and case-sensitive', () => {
    assert.equal(value({ op: 'exists', type: 'step', as: 's', where: { op: 'contains', left: field('s', 'label'), right: literal('order') } }), true);
    assert.equal(value({ op: 'exists', type: 'step', as: 's', where: { op: 'contains', left: field('s', 'label'), right: literal('Order') } }), false);
    assert.equal(value({ op: 'exists', type: 'step', as: 's', where: { op: 'startsWith', left: field('s', 'label'), right: literal('Rev') } }), true);
    assert.equal(value({ op: 'exists', type: 'step', as: 's', where: { op: 'startsWith', left: field('s', 'label'), right: literal('order') } }), false);
  });
  it('wrong operand types are checker_invalid, never false; new fields are readable', () => {
    const bad = evaluate({ op: 'exists', type: 'step', as: 's', where: { op: 'near', left: field('s', 'label'), right: literal(1), tolerance: 1 } }, state);
    assert.equal(bad.ok, false); if (!bad.ok) assert.equal(bad.error.code, 'checker_invalid');
    const text = evaluate({ op: 'exists', type: 'step', as: 's', where: { op: 'contains', left: field('s', 'x'), right: literal('1') } }, state);
    assert.equal(text.ok, false);
    assert.equal(value({ op: 'exists', type: 'step', as: 's', where: { op: 'eq', left: field('s', 'fill'), right: literal('blue') } }), true);
    const unbound = evaluate({ op: 'near', left: field('nobody', 'x'), right: literal(1), tolerance: 0 }, state);
    assert.equal(unbound.ok, false); if (!unbound.ok) assert.match(unbound.error.message, /unbound/);
  });
});

describe('world/2 transitions', () => {
  it('every new action has its core semantics; the checker replays the same history independently', () => {
    const world = v2World();
    const session = new Session(world, 3, 'T1');
    must(session, { name: 'rename_frame', params: { id: 'f', name: 'Inbound' } });
    must(session, { name: 'resize_step', params: { id: 'a', width: 220, height: 90 } });
    must(session, { name: 'set_style', params: { id: 'b', shape: 'diamond', stroke: 'red', fill: 'yellow' } });
    must(session, { name: 'group_steps', params: { id: 'a', with: 'b' } });
    const grouped = session.state;
    const group = step(grouped, 'a').groupId;
    assert.match(group ?? '', /^g-[0-9a-f]{60}$/);
    assert.equal(step(grouped, 'b').groupId, group);
    must(session, { name: 'group_steps', params: { id: 'c', with: 'a' } });
    assert.equal(step(session.state, 'c').groupId, group);
    must(session, { name: 'connect', params: { from: 'b', to: 'c' } });
    const arrow = Object.values(session.state.objects).find((o): o is Arrow => o.type === 'arrow' && o.id !== 'ab')!;
    // b lives in frame f, c in no frame: a cross-frame arrow belongs to no frame.
    assert.equal(arrow.frameId, null);
    must(session, { name: 'set_frame', params: { id: 'c', frameId: 'f' } });
    assert.equal((session.state.objects[arrow.id] as Arrow).frameId, 'f');
    must(session, { name: 'add_step', params: { frameId: null, label: 'Archive', x: 900, y: 300, width: 160, height: 80, shape: 'ellipse' } });
    const added = Object.values(session.state.objects).find(o => o.type === 'step' && o.label === 'Archive') as StepV2;
    assert.deepEqual({ shape: added.shape, stroke: added.stroke, fill: added.fill, groupId: added.groupId, frameId: added.frameId }, { shape: 'ellipse', stroke: 'black', fill: 'none', groupId: null, frameId: null });
    must(session, { name: 'reconnect_end', params: { id: arrow.id, end: 'end', target: added.id } });
    assert.equal((session.state.objects[arrow.id] as Arrow).frameId, null);
    must(session, { name: 'ungroup', params: { id: 'b' } });
    assert.deepEqual(['a', 'b', 'c'].map(id => step(session.state, id).groupId), [null, null, null]);
    must(session, { name: 'delete_step', params: { id: 'b' } });
    // Deleting b detaches the incident arrow ab and leaves it in its frame through its live start.
    assert.deepEqual(session.state.objects.ab, { id: 'ab', type: 'arrow', deleted: false, frameId: 'f', from: 'a', to: null });
    const data = session.serialize();
    // Independent second implementation: the checker derives every step hash again.
    assert.doesNotThrow(() => verifySessionHistory(generateVariant(world, 3), world.tasks[0]!, data));
    const forged = structuredClone(data); forged.log[2]!.action.params.fill = 'blue';
    assert.throws(() => verifySessionHistory(generateVariant(world, 3), world.tasks[0]!, forged), CheckerError);
  });
  it('rejections are atomic and named', () => {
    const session = new Session(v2World(), 0, 'T1');
    rejected(session, { name: 'group_steps', params: { id: 'a', with: 'a' } }, 'precondition_failed');
    rejected(session, { name: 'ungroup', params: { id: 'a' } }, 'precondition_failed');
    rejected(session, { name: 'set_style', params: { id: 'a', shape: 'hexagon', stroke: 'black', fill: 'none' } }, 'invalid_argument');
    rejected(session, { name: 'rename_frame', params: { id: 'a', name: 'X' } }, 'precondition_failed');
    rejected(session, { name: 'rename_frame', params: { id: 'f', name: '' } }, 'invalid_argument');
    rejected(session, { name: 'set_frame', params: { id: 'a', frameId: 'missing' } }, 'precondition_failed');
    rejected(session, { name: 'add_step', params: { frameId: 'f', label: 'X', x: 0, y: 0, width: 100, height: 60, fontFamily: 3 } }, 'invalid_argument');
    rejected(session, { name: 'connect', params: { frameId: 'f', from: 'a', to: 'b' } }, 'invalid_argument');
    rejected(session, { name: 'resize_step', params: { id: 'a', width: 5, height: 60 } }, 'invalid_argument');
  });
  it('a stated rule replaces the implicit semantics and must cover the required effect', () => {
    const world = v2World({ rules: [{ id: 'rename', action: 'rename_step', status: 'confirmed', effects: ['set_position'] }] });
    const session = new Session(world, 0, 'T1');
    rejected(session, { name: 'rename_step', params: { id: 'a', label: 'X' } }, 'unmodeled');
    must(session, { name: 'move_step', params: { id: 'a', x: 1, y: 1 } });
  });
  it('property: random world/2 histories replay to identical hashes in the core and the checker', () => {
    const world = v2World();
    let seed = 12345;
    const next = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 25; run++) {
      const session = new Session(world, run, 'T1');
      for (let i = 0; i < 30; i++) {
        const state = session.state;
        const steps = Object.values(state.objects).filter(o => o.type === 'step' && !o.deleted).map(o => o.id);
        const arrows = Object.values(state.objects).filter(o => o.type === 'arrow' && !o.deleted).map(o => o.id);
        const pick = (list: string[]): string => list[next(list.length)]!;
        if (!steps.length) break;
        const candidates: Action[] = [
          { name: 'add_step', params: { frameId: next(2) ? 'f' : null, label: `S${i}`, x: next(800), y: next(600), width: 100 + next(100), height: 60, shape: (['rectangle', 'ellipse', 'diamond'] as const)[next(3)]! } },
          { name: 'move_step', params: { id: pick(steps), x: next(900), y: next(900) } },
          { name: 'set_style', params: { id: pick(steps), shape: 'diamond', stroke: (['black', 'red', 'green', 'blue', 'orange'] as const)[next(5)]!, fill: (['none', 'red', 'green', 'blue', 'yellow'] as const)[next(5)]! } },
          { name: 'connect', params: { from: pick(steps), to: pick(steps) } },
          { name: 'set_frame', params: { id: pick(steps), frameId: next(2) ? 'f' : null } },
          { name: 'group_steps', params: { id: pick(steps), with: pick(steps) } },
          { name: 'ungroup', params: { id: pick(steps) } },
          { name: 'delete_step', params: { id: pick(steps) } },
          ...(arrows.length ? [{ name: 'reconnect_end', params: { id: pick(arrows), end: next(2) ? 'start' : 'end', target: pick(steps) } }, { name: 'disconnect', params: { id: pick(arrows) } }] : []),
        ];
        session.act(candidates[next(candidates.length)]!);
      }
      assert.doesNotThrow(() => verifySessionHistory(generateVariant(world, run), world.tasks[0]!, session.serialize()), `run ${run}`);
    }
  });
});

describe('world/2 checker', () => {
  const scene = (elements: unknown[]): string => JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files: {} });
  const box = (id: string, x: number, extra: Record<string, unknown> = {}) => ({ id, type: 'rectangle', x, y: 100, width: 160, height: 80, angle: 0, isDeleted: false, frameId: null, groupIds: [], strokeColor: '#1e1e1e', backgroundColor: 'transparent', boundElements: [{ id: `${id}-t`, type: 'text' }], ...extra });
  const label = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id: `${id}-t`, type: 'text', x: 0, y: 0, width: 10, height: 10, angle: 0, isDeleted: false, frameId: null, containerId: id, text, originalText: text, fontFamily: 1, ...extra });
  const arrow = (id: string, from: string, to: string) => ({ id, type: 'arrow', x: 0, y: 0, width: 10, height: 0, angle: 0, isDeleted: false, frameId: null, startBinding: { elementId: from, focus: 0, gap: 4 }, endBinding: { elementId: to, focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'arrow' });
  it('checks a free drawing end state against a world/2 goal', () => {
    const world = v2World();
    const drawing = scene([
      { id: 'f', type: 'frame', x: 0, y: 0, width: 900, height: 400, angle: 0, isDeleted: false, frameId: null, name: 'Intake' },
      box('a', 100, { frameId: 'f' }), label('a', 'Receive'), box('b', 400, { frameId: 'f', angle: 0.3 }), label('b', 'Check', { fontFamily: 5 }),
      box('c', 700), label('c', 'Ship'), arrow('ab', 'a', 'b'), arrow('bc', 'b', 'c'),
      { id: 'note', type: 'text', x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null, containerId: null, text: 'Free note', originalText: 'Free note' },
      { id: 'pic', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null },
    ]);
    const verdict = checkSubmission(world, drawing, { taskId: 'T1' });
    assert.equal(verdict.passed, true);
    const missing = scene([box('a', 100), label('a', 'Receive'), box('b', 400), label('b', 'Check'), box('c', 700), label('c', 'Ship'), arrow('ab', 'a', 'b')]);
    assert.equal(checkSubmission(world, missing, { taskId: 'T1' }).passed, false);
  });
  it('counter-probes still run before a world/2 verdict', () => {
    const world = v2World({ tasks: [v2Task({ goal: { op: 'true' } })] });
    assert.throws(() => checkState(world, v2Start, { taskId: 'T1' }), /counterprobe_failed/);
  });
});

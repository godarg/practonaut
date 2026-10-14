// Minimal solution length (PADR-0040, decision 5). Expected minima are argued by hand next to each
// case and, for the small cases, confirmed by an exhaustive search over real core actions on a finite
// parameter domain (a second, independent derivation that shares nothing with the analysis).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromStates } from '../../src/authoring/from-scenes.ts';
import { analyseLength, analyseLengthForSeeds, assignmentCost, readGoal } from '../../src/authoring/minimal-length.ts';
import { Session } from '../../src/core/session.ts';
import { evaluate } from '../../src/predicate/index.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { FILL_COLORS, SHAPES, STROKE_COLORS, type Action, type State, type World } from '../../src/world/types.ts';
import { stepV2 } from '../support/world-v2.ts';

const arrow = (id: string, from: string, to: string) => ({ id, type: 'arrow' as const, deleted: false, frameId: null, from, to });
const state = (...objects: State['objects'][string][]): State => ({ objects: Object.fromEntries(objects.map(object => [object.id, object])) });
const task = (start: State, goal: State) => fromStates(start, goal, { worldId: 'minimal-fixture', taskId: 't' });

/** Every action sequence of at most `depth` actions over a finite domain (goal and start labels, all
 * styles, ids of the current board) is played through the real core; true when one passes the goal. */
function solvableWithin(world: World, depth: number): boolean {
  const goal = world.tasks[0]!.goal;
  const labels = new Set<string>();
  const collect = (value: unknown): void => { if (value && typeof value === 'object') { const record = value as Record<string, unknown>; if (record.kind === 'literal' && typeof record.value === 'string') labels.add(record.value); Object.values(record).forEach(collect); } };
  collect(goal);
  for (const object of Object.values(world.tasks[0]!.initialState!.objects)) if (object.type === 'step') labels.add(object.label);
  const candidates = (s: State): Action[] => {
    const steps = Object.values(s.objects).filter(o => o.type === 'step' && !o.deleted).map(o => o.id);
    const arrows = Object.values(s.objects).filter(o => o.type === 'arrow' && !o.deleted).map(o => o.id);
    const out: Action[] = [];
    for (const id of steps) {
      out.push({ name: 'delete_step', params: { id } });
      for (const label of labels) out.push({ name: 'rename_step', params: { id, label } });
      for (const shape of SHAPES) for (const stroke of STROKE_COLORS) for (const fill of FILL_COLORS) out.push({ name: 'set_style', params: { id, shape, stroke, fill } });
      for (const to of steps) if (to !== id) out.push({ name: 'connect', params: { from: id, to } });
    }
    for (const id of arrows) {
      out.push({ name: 'disconnect', params: { id } });
      for (const target of steps) for (const end of ['start', 'end']) out.push({ name: 'reconnect_end', params: { id, end, target } });
    }
    for (const label of labels) for (const shape of SHAPES) out.push({ name: 'add_step', params: { frameId: null, label, x: 0, y: 0, width: 160, height: 80, shape } });
    return out;
  };
  const explore = (session: Session, left: number): boolean => {
    const holds = evaluate(goal, session.state);
    if (holds.ok && holds.value) return true;
    if (left === 0) return false;
    for (const action of candidates(session.state)) {
      if (!session.act(structuredClone(action)).ok) continue;
      const found = explore(session, left - 1);
      session.undo();
      if (found) return true;
    }
    return false;
  };
  return explore(new Session(world, 0, world.tasks[0]!.id), depth);
}

describe('minimal length: proven where the bounded search is small', () => {
  it('one restyle is minimal', () => {
    const { world, oracle } = task(state(stepV2('a', 'Pack', 0, 0), stepV2('b', 'Ship', 300, 0), arrow('ab', 'a', 'b')),
      state(stepV2('a', 'Pack', 0, 0, { fill: 'green' }), stepV2('b', 'Ship', 300, 0), arrow('ab', 'a', 'b')));
    assert.equal(oracle.steps.length, 1);
    assert.deepEqual(analyseLength(world, 't', 0, 1), { kind: 'minimal', length: 1 });
  });

  it('a reversed arrow needs two actions: no single action changes both ends', () => {
    const { world, oracle } = task(state(stepV2('a', 'Pack', 0, 0), stepV2('b', 'Ship', 300, 0), arrow('ab', 'b', 'a')),
      state(stepV2('a', 'Pack', 0, 0), stepV2('b', 'Ship', 300, 0), arrow('x', 'a', 'b')));
    assert.equal(oracle.steps.length, 2);
    assert.deepEqual(analyseLength(world, 't', 0, 2), { kind: 'minimal', length: 2 });
    assert.equal(solvableWithin(world, 1), false, 'exhaustive: nothing of length 1 solves it');
    assert.equal(solvableWithin(world, 2), true);
  });

  it('a step needing a new label and a new style costs two; a three-action reference is not minimal', () => {
    const { world, oracle } = task(state(stepV2('a', 'Pakc', 0, 0), stepV2('b', 'Ship', 300, 0), arrow('ab', 'a', 'b')),
      state(stepV2('a', 'Pack', 0, 0, { shape: 'ellipse', stroke: 'blue', fill: 'yellow' }), stepV2('b', 'Ship', 300, 0), arrow('ab', 'a', 'b')));
    assert.equal(oracle.steps.length, 2, 'rename and one set_style for shape, line and fill');
    assert.deepEqual(analyseLength(world, 't', 0, 2), { kind: 'minimal', length: 2 });
    assert.equal(solvableWithin(world, 1), false);
    assert.deepEqual(analyseLength(world, 't', 0, 3), { kind: 'reference', length: 3, reason: 'shorter-assignment' });
  });

  it('a new coloured step costs two (add_step creates black and unfilled), a removed step with an arrow costs two', () => {
    const added = task(state(stepV2('a', 'Pack', 0, 0)), state(stepV2('a', 'Pack', 0, 0), stepV2('n', 'Ship', 300, 0, { fill: 'red' })));
    assert.equal(added.oracle.steps.length, 2);
    assert.deepEqual(analyseLength(added.world, 't', 0, 2), { kind: 'minimal', length: 2 });
    assert.equal(solvableWithin(added.world, 1), false);
    // Deleting "Old" detaches its arrow; the goal forbids the loose arrow, so it must be removed too.
    const removed = task(state(stepV2('a', 'Pack', 0, 0), stepV2('o', 'Old', 300, 0), arrow('ao', 'a', 'o')), state(stepV2('a', 'Pack', 0, 0)));
    assert.equal(removed.oracle.steps.length, 2);
    assert.deepEqual(analyseLength(removed.world, 't', 0, 2), { kind: 'minimal', length: 2 });
    assert.equal(solvableWithin(removed.world, 1), false);
  });

  it('swapped labels on a chain: two renames beat rewiring both arrows', () => {
    // Start A → C → B, goal A → B → C (labels of the second and third step swapped): rename both (2).
    const start = state(stepV2('a', 'Order', 0, 0), stepV2('b', 'Ship', 300, 0), stepV2('c', 'Pack', 600, 0), arrow('ab', 'a', 'b'), arrow('bc', 'b', 'c'));
    const goal = state(stepV2('a', 'Order', 0, 0), stepV2('b', 'Pack', 300, 0), stepV2('c', 'Ship', 600, 0), arrow('ab', 'a', 'b'), arrow('bc', 'b', 'c'));
    const { world, oracle } = task(start, goal);
    assert.equal(oracle.steps.length, 2);
    assert.deepEqual(analyseLength(world, 't', 0, 2), { kind: 'minimal', length: 2 });
    assert.equal(solvableWithin(world, 1), false);
  });

  it('finds the three-action solution of the library task insert-between (a real agent found it; the reference has four)', () => {
    const { world, library } = loadLibrary();
    const entry = library.tasks.find(value => value.id === 'insert-between')!;
    assert.equal(entry.actions, 4);
    assert.equal(analyseLength(world, 'insert-between', 0, 4).kind, 'reference');
    assert.deepEqual(analyseLength(world, 'insert-between', 0, 4), { kind: 'reference', length: 4, reason: 'shorter-assignment' });
    assert.deepEqual(analyseLengthForSeeds(world, 'connect', [0, 1, 2, 3], 1), { kind: 'minimal', length: 1 });
  });

  it('makes no claim outside its scope or beyond its node cap', () => {
    const { world } = loadLibrary();
    // add-step checks the left-to-right order (positions); group checks a group: both out of scope.
    assert.deepEqual(analyseLength(world, 'add-step', 0, 1), { kind: 'reference', length: 1, reason: 'not-applicable' });
    assert.equal((analyseLength(world, 'group', 0, 2) as { reason?: string }).reason, 'not-applicable');
    assert.deepEqual(analyseLength(world, 'decision', 0, 6, 1), { kind: 'reference', length: 6, reason: 'search-limit' });
    assert.equal(readGoal({ op: 'true' }), undefined);
  });
});

describe('bounded reading of a goal', () => {
  it('a goal that names ten million steps is a reference length, answered at once and without allocating them', () => {
    const { world } = task(state(stepV2('a', 'Pack', 0, 0)), state(stepV2('a', 'Pack', 0, 0, { fill: 'green' })));
    const huge = structuredClone(world);
    const goal = huge.tasks[0]!.goal as { op: 'all'; args: Array<{ op: string; right: { value: number } }> };
    // Every count literal that expands into slots: total steps, the signature count, and an arrow count.
    for (const clause of goal.args) if (clause.op === 'eq') clause.right.value = 10_000_000;
    const started = performance.now(), before = process.memoryUsage().heapUsed;
    assert.deepEqual(analyseLength(huge, 't', 0, 1, 1), { kind: 'reference', length: 1, reason: 'not-applicable' });
    assert.ok(performance.now() - started < 2000, 'answered quickly');
    assert.ok(process.memoryUsage().heapUsed - before < 64 * 1024 * 1024, 'no slot array was allocated');
    assert.equal(readGoal(goal as never), undefined);
  });
});

describe('assignment cost (Hungarian method)', () => {
  it('equals hand-solved minimum assignments', () => {
    assert.equal(assignmentCost([]), 0);
    assert.equal(assignmentCost([[4, 1, 3], [2, 0, 5], [3, 2, 2]]), 5); // 1 + 2 + 2
    assert.equal(assignmentCost([[0, 2], [2, 0]]), 0);
    assert.equal(assignmentCost([[1, 1, 1], [1, 1, 1], [1, 1, 0]]), 2);
  });
});

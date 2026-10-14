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
import { createRandom } from '../../src/challenge/random.ts';
import type { StepV2 } from '../../src/world/types.ts';

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

/** A breadth-first search over real core actions whose parameters come from the goal and the board:
 * goal labels, goal styles (shape, line, fill together, as set_style sets them) and current ids.
 * A shortest solution needs no other value: any other label or style would have to be overwritten.
 * True when some sequence of at most `depth` actions reaches the goal. */
function solvableWithinGoalValues(world: World, depth: number): boolean {
  const task = world.tasks[0]!, goal = task.goal;
  const goalSteps = Object.values(readGoalState(world).objects).filter((o): o is StepV2 => o.type === 'step');
  const labels = [...new Set(goalSteps.map(step => step.label))];
  const styles = [...new Map(goalSteps.map(step => [`${step.shape}/${step.stroke}/${step.fill}`, step])).values()];
  const candidates = (s: State): Action[] => {
    const steps = Object.values(s.objects).filter(o => o.type === 'step' && !o.deleted).map(o => o.id);
    const arrows = Object.values(s.objects).filter(o => o.type === 'arrow' && !o.deleted).map(o => o.id);
    const out: Action[] = [];
    for (const id of steps) {
      out.push({ name: 'delete_step', params: { id } });
      for (const label of labels) out.push({ name: 'rename_step', params: { id, label } });
      for (const style of styles) out.push({ name: 'set_style', params: { id, shape: style.shape, stroke: style.stroke, fill: style.fill } });
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
  return explore(new Session(world, 0, task.id), depth);
}
/** The goal state from-scenes was given, kept beside each random task below. */
const goalStates = new WeakMap<World, State>();
const readGoalState = (world: World): State => goalStates.get(world)!;

describe('minimal length against exhaustive search on random small tasks (review)', () => {
  it('every "minimal" claim on 80 seeded random tasks survives a breadth-first search one action shorter', () => {
    const random = createRandom(20261015);
    const labels = ['Pack', 'Ship', 'Bill', 'Send', 'Check'];
    const palette = [{ shape: 'rectangle', stroke: 'black', fill: 'none' }, { shape: 'ellipse', stroke: 'black', fill: 'none' }, { shape: 'rectangle', stroke: 'blue', fill: 'yellow' }, { shape: 'diamond', stroke: 'red', fill: 'none' }] as const;
    let claimed = 0, checked = 0, tasks = 0;
    const started = performance.now();
    for (let n = 0; n < 80; n++) {
      // A start of 2–3 steps with 0–2 arrows; a goal from 1–3 random edits.
      const count = random.int(2, 3), names = random.shuffle(labels).slice(0, count);
      const start: State = { objects: {} };
      names.forEach((label, index) => { start.objects[`s${index}`] = stepV2(`s${index}`, label, index * 300, 0, { ...random.pick(palette) }); });
      const ids = Object.keys(start.objects);
      for (let a = 0, arrows = random.int(0, 2); a < arrows; a++) { const [from, to] = random.shuffle(ids); if (!Object.values(start.objects).some(o => o.type === 'arrow' && o.from === from && o.to === to)) start.objects[`a${a}`] = arrow(`a${a}`, from!, to!); }
      const goal: State = structuredClone(start);
      for (let e = 0, edits = random.int(1, 3); e < edits; e++) {
        const steps = Object.values(goal.objects).filter((o): o is StepV2 => o.type === 'step'), arrowsNow = Object.values(goal.objects).filter(o => o.type === 'arrow');
        const kind = random.int(0, 5), step = random.pick(steps);
        if (kind === 0) { const label = labels.find(value => !steps.some(other => other.label === value)); if (label) step.label = label; }
        else if (kind === 1) Object.assign(step, random.pick(palette));
        else if (kind === 2 && steps.length < 4) { const label = labels.find(value => !steps.some(other => other.label === value)); if (label) goal.objects[`n${e}`] = stepV2(`n${e}`, label, 900, 300, { ...random.pick(palette) }); }
        else if (kind === 3 && steps.length > 1) { delete goal.objects[step.id]; for (const [id, o] of Object.entries(goal.objects)) if (o.type === 'arrow' && (o.from === step.id || o.to === step.id)) delete goal.objects[id]; }
        else if (kind === 4) { const [from, to] = random.shuffle(steps.map(value => value.id)); if (from && to && !arrowsNow.some(o => o.type === 'arrow' && ((o.from === from && o.to === to) || (o.from === to && o.to === from)))) goal.objects[`g${e}`] = arrow(`g${e}`, from, to); }
        else if (arrowsNow.length) { const victim = random.pick(arrowsNow); if (victim.type === 'arrow' && random.chance(0.5)) goal.objects[victim.id] = { ...victim, from: victim.to, to: victim.from }; else delete goal.objects[victim.id]; }
      }
      let made;
      try { made = fromStates(start, goal, { worldId: 'minimal-random', taskId: 't' }); } catch { continue; } // identical scenes, ambiguous labels …
      tasks++;
      const length = made.oracle.steps.length, analysis = analyseLength(made.world, 't', 0, length);
      if (analysis.kind !== 'minimal') continue;
      claimed++;
      if (length > 3) continue; // a search of depth 3 or more is not bounded enough for a unit test
      goalStates.set(made.world, made.goal);
      assert.equal(solvableWithinGoalValues(made.world, length - 1), false, `task ${n}: a solution shorter than the claimed minimal ${length}`);
      checked++;
    }
    // Most random tasks are within the analysis's scope, and most claims are checked.
    assert.ok(tasks >= 60, `${tasks} tasks`); assert.ok(claimed >= tasks * 0.7, `${claimed} of ${tasks} claimed minimal`); assert.ok(checked >= claimed * 0.8, `${checked} of ${claimed} checked`);
    assert.ok(performance.now() - started < 120_000, 'bounded runtime');
  });
});


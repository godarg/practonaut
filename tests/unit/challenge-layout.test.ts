// The spatial-layout family `challenge-layout` 1.0.0 (PADR-0047 decision 9): the reference holds every
// layout clause and the start violates every stated one by the second implementation
// (tests/support/layout-oracle.ts); every layout clause has a single-fault near miss; the size pin
// holds; branch, fork and loop arrows join the two lanes; the recorded structure is the built one; the
// fuel stays within half the budget on stress and adversarial boards, whatever the placement; the
// distribution self-check holds its 10 % floor over 100 development seeds.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkState } from '../../src/checker/index.ts';
import { generateInstance, stressBoards, verdictFuel, worldIdOf, worldOf, FAMILY_BENCH, type Instance } from '../../src/challenge/build.ts';
import { LAYOUT, adversarialStates, layoutStressState } from '../../src/challenge/layout.ts';
import { layoutSelfCheck } from '../../src/challenge/self-check.ts';
import { GENERATED_BY_LIMITS } from '../../src/world/schema.ts';
import { isLayoutPredicate, type State, type StepV2, type World } from '../../src/world/types.ts';
import type { Difficulty } from '../../src/challenge/families.ts';
import { oracleHolds } from '../support/layout-oracle.ts';

const cache = new Map<string, Instance>();
const instance = (seed: number, difficulty: Difficulty): Instance => {
  const key = `${seed}/${difficulty}`;
  if (!cache.has(key)) cache.set(key, generateInstance('layout', seed, difficulty, worldIdOf('layout', 'test')));
  return cache.get(key)!;
};
const SAMPLE: Array<[number, Difficulty]> = [[1, 1], [2, 2], [3, 3], [8, 2], [9, 3], [10, 1]];
const layoutClauses = (value: Instance) => (value.task.goal.op === 'all' ? value.task.goal.args : [value.task.goal]).map((clause, index) => ({ clause, index })).filter(entry => isLayoutPredicate(entry.clause));
const worlds = new Map<string, World>();
const worldFor = (value: Instance): World => { if (!worlds.has(value.taskId)) worlds.set(value.taskId, worldOf(worldIdOf('layout', 'test'), [value])); return worlds.get(value.taskId)!; };
const finalState = (value: Instance, steps: Instance['oracle']['steps']): State => { const run = runOracle(worldFor(value), 1, value.taskId, steps); if (!run.ok) throw new Error(`refused at ${run.index}`); return run.session.state; };

describe('challenge-layout 1.0.0', () => {
  it('the reference holds every layout clause and the start violates every stated one, by the second implementation', () => {
    for (const [seed, difficulty] of SAMPLE) {
      const value = instance(seed, difficulty), reference = finalState(value, value.oracle.steps);
      const clauses = layoutClauses(value);
      assert.ok(clauses.some(entry => entry.clause.op === 'noOverlap'), `${seed}: noOverlap is always stated`);
      for (const { clause } of clauses) {
        if (!isLayoutPredicate(clause)) continue;
        assert.equal(oracleHolds(clause, reference), true, `${seed}/${difficulty}: the reference holds ${clause.op}`);
        assert.equal(oracleHolds(clause, value.task.initialState!), false, `${seed}/${difficulty}: the start violates ${clause.op}`);
      }
      assert.equal(checkState(worldFor(value), reference, { seed: 1, taskId: value.taskId }).passed, true);
      // The reference is one move per displaced step: 3, 5 or 7 (more where difficulty 3 changes the aspect).
      assert.ok(value.oracle.steps.every(step => step.name === 'move_step'));
      if (difficulty < 3) assert.equal(value.oracle.steps.length, LAYOUT.displaced[difficulty]);
      else assert.ok(value.oracle.steps.length >= 7);
    }
  });

  it('every layout clause has a near miss of its kind that violates it and no other goal clause, and fails in the checker', () => {
    for (const [seed, difficulty] of SAMPLE.slice(0, 4)) {
      const value = instance(seed, difficulty), world = worldFor(value);
      const goal = value.task.goal.op === 'all' ? value.task.goal.args : [value.task.goal];
      for (const { clause, index } of layoutClauses(value)) {
        const miss = value.oracle.nearMisses.find(entry => entry.kind === `layout-${clause.op}` && entry.violates.length === 1 && entry.violates[0] === index);
        assert.ok(miss, `${seed}/${difficulty}: a single-fault near miss for clause ${index + 1} (${clause.op})`);
        const state = finalState(value, miss.steps);
        // By the second implementation: this clause fails, every other layout clause holds.
        for (const other of layoutClauses(value)) if (isLayoutPredicate(other.clause)) assert.equal(oracleHolds(other.clause, state), other.index !== index, `${seed}: ${clause.op} near miss vs ${other.clause.op}`);
        // Sizes are kept: only moves.
        assert.ok(miss.steps.every(step => step.name === 'move_step'));
        assert.equal(goal.length > index, true);
      }
      for (const miss of value.oracle.nearMisses.filter(entry => entry.kind.startsWith('layout-'))) assert.equal(checkState(world, finalState(value, miss.steps), { seed: 1, taskId: value.taskId }).passed, false, `${seed}: ${miss.kind}`);
    }
  });

  it('pins every step\'s size: shrinking or growing one step fails the reference', () => {
    const value = instance(2, 2), world = worldFor(value), reference = finalState(value, value.oracle.steps);
    const size = String(value.task.generatedBy!.parameters.size).split('x').map(Number);
    const step = Object.values(reference.objects).find((o): o is StepV2 => o.type === 'step')!;
    assert.deepEqual([step.width, step.height], size);
    for (const change of [{ width: step.width + 5 }, { height: step.height - 5 }, { width: 10, height: 10 }]) {
      const changed = structuredClone(reference); Object.assign(changed.objects[step.id]!, change);
      assert.equal(checkState(world, changed, { seed: 1, taskId: value.taskId }).passed, false, JSON.stringify(change));
    }
    const nudged = structuredClone(reference); (nudged.objects[step.id] as StepV2).width += 4;
    assert.equal(checkState(world, nudged, { seed: 1, taskId: value.taskId }).passed, value.task.goal.op === 'all' && layoutClauses(value).every(({ clause }) => !isLayoutPredicate(clause) || oracleHolds(clause, nudged)), 'within the 4 px of the pin only the layout clauses decide');
  });

  it('records the structure it built: lanes, steps, arrows, topology and the stated clauses; branch, fork and loop arrows join the two lanes', () => {
    const parts = new Set<string>();
    for (const [seed, difficulty] of SAMPLE) {
      const value = instance(seed, difficulty), p = value.task.generatedBy!.parameters, start = value.task.initialState!;
      assert.ok(Object.keys(p).length <= GENERATED_BY_LIMITS.parameters);
      for (const entry of Object.values(p)) if (typeof entry === 'string') assert.ok(entry.length <= GENERATED_BY_LIMITS.text);
      const frames = Object.values(start.objects).filter(o => o.type === 'frame'), steps = Object.values(start.objects).filter((o): o is StepV2 => o.type === 'step'), arrows = Object.values(start.objects).filter(o => o.type === 'arrow');
      assert.deepEqual([p.lanes, p.steps, p.arrows, p.difficulty, p.margin, p.gap], [frames.length, steps.length, arrows.length, difficulty, LAYOUT.margin[difficulty], LAYOUT.gap[difficulty]]);
      assert.equal(p.displaced, value.oracle.steps.length);
      // The clause code names exactly the stated layout clauses, in order.
      const code = layoutClauses(value).map(({ clause }) => clause.op === 'noOverlap' ? `O${clause.gap}` : clause.op === 'within' ? 'W' : clause.op === 'arrowsNoCrossing' ? 'X' : clause.op === 'arrowsClearOfSteps' ? 'C' : clause.op === 'aligned' ? 'A' : 'E');
      assert.deepEqual(String(p.clauses).split(' ').map(token => /^[AE]\d$/.test(token) ? token[0] : token), code);
      // Arrows beyond the chain (n − 1 of them) join steps in different frames.
      const extras = arrows.length - (steps.length - 1);
      const crossing = arrows.filter(a => a.type === 'arrow' && (start.objects[a.from!] as StepV2).frameId !== (start.objects[a.to!] as StepV2).frameId).length;
      assert.equal(crossing, p.lanes === 2 ? 1 + extras : 0, `${seed}: the chain crosses once, every extra arrow crosses`);
      for (const part of String(p.topology).split('+')) parts.add(part);
      // Board text is data: no label or frame name in title, prompt or hints; the prompt names the canvas only when within is stated.
      const ours = JSON.stringify([value.task.title, value.task.prompt, value.task.hints]);
      for (const text of [...steps.map(s => s.label), ...frames.map(f => (f as { name: string }).name)]) assert.equal(ours.includes(text), false, text);
      assert.equal(/The canvas runs from/.test(value.task.prompt.en), layoutClauses(value).some(({ clause }) => clause.op === 'within'));
    }
    assert.deepEqual([...parts].sort(), ['branch', 'chain', 'fork', 'loop']);
  });

  it('stays within half the checker budget on the stress and adversarial boards of 60 objects, whatever their placement', () => {
    assert.equal(FAMILY_BENCH.layout.maxActions, 60);
    for (const [seed, difficulty] of SAMPLE.slice(0, 4)) {
      const value = instance(seed, difficulty);
      const boards = stressBoards(value.goal, 'layout');
      assert.equal(boards.length, 5 + 8);
      const goalObjects = Object.keys(value.goal.objects).length;
      for (const board of boards) {
        assert.equal(Object.keys(board.state.objects).length, goalObjects + 60, board.name);
        const fuel = verdictFuel(value.task, board.state);
        assert.ok(fuel <= value.fuel && value.fuel <= 500_000, `${seed} ${board.name}: ${fuel} of ${value.fuel}`);
      }
      // The cost does not depend on where the stress steps sit: a clustered placement costs the same.
      for (const [steps, arrows] of [[60, 0], [30, 30], [15, 45]] as const) assert.equal(verdictFuel(value.task, layoutStressState(value.goal, steps, arrows, 'clustered')), verdictFuel(value.task, layoutStressState(value.goal, steps, arrows, 'grid')), `${steps}/${arrows}`);
      assert.equal(adversarialStates(value.goal, 60).length, 8);
    }
  });

  it('the distribution self-check: over 100 development seeds every planned topology part and clause kind reaches 10 %, and a missing one fails it', () => {
    const result = layoutSelfCheck(Array.from({ length: 100 }, (_, i) => i + 1), 'mixed', 'draft');
    assert.equal(result.instances, 100);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.belowFloor, [], JSON.stringify(result));
    // The floor bites: at 50 % some planned part is missing.
    assert.ok(layoutSelfCheck(Array.from({ length: 100 }, (_, i) => i + 1), 'mixed', 'draft', 0.5).belowFloor.length > 0);
    // The draft-level count is the built one: building changes nothing on a sample.
    const built = layoutSelfCheck([1, 2, 3, 4, 5, 6], 'mixed', 'build'), drafted = layoutSelfCheck([1, 2, 3, 4, 5, 6], 'mixed', 'draft');
    assert.deepEqual({ ...built, mode: 'draft' }, drafted);
  });
});

// The spatial-layout family `challenge-layout` 1.0.0 (PADR-0047 decision 9): the reference holds every
// layout clause and the start violates every stated one by the second implementation
// (tests/support/layout-oracle.ts); every layout clause has a single-fault near miss; the size pin
// holds; branch, fork and loop arrows join the two lanes; the recorded structure is the built one and
// the fixed texts name only what is stated; the recorded fuel covers the stress, adversarial and
// searched boards and the reviewers' compositions; the distribution self-check holds its 10 % floor
// over 100 development seeds at every difficulty.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkState } from '../../src/checker/index.ts';
import { buildDraft, ChallengeError, draftFor, generateInstance, stressBoards, verdictFuel, verdictFuels, worldIdOf, worldOf, FAMILY_BENCH, LAYOUT_SEARCH_MARGIN, type Instance } from '../../src/challenge/build.ts';
import { LAYOUT, adversarialStates, layoutStressState, withAdditions, type Addition } from '../../src/challenge/layout.ts';
import { createRandom } from '../../src/challenge/random.ts';
import { DeclarationSchema } from '../../src/challenge/declaration.ts';
import { layoutSelfCheck, PLANNED_CLAUSES } from '../../src/challenge/self-check.ts';
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

  it('a branch or a loop instance states arrowsClearOfSteps: its near miss is single-fault against the stated clauses only (review generator-single-fault-overstrict)', () => {
    // Seed 1 at difficulty 1 is a chain with a loop, seed 15 a chain with a branch (drawn, not chosen by
    // the code: the first seeds of each with C stated). Before the fix C was never stated with either.
    for (const [seed, difficulty, part] of [[1, 1, 'loop'], [15, 1, 'branch']] as const) {
      const value = instance(seed, difficulty), p = value.task.generatedBy!.parameters;
      assert.ok(String(p.topology).split('+').includes(part), `${seed}: ${p.topology}`);
      const clear = layoutClauses(value).find(({ clause }) => clause.op === 'arrowsClearOfSteps');
      assert.ok(clear, `${seed}: C stated (${p.clauses})`);
      const miss = value.oracle.nearMisses.find(entry => entry.kind === 'layout-arrowsClearOfSteps' && entry.violates.length === 1 && entry.violates[0] === clear.index);
      assert.ok(miss);
      const state = finalState(value, miss.steps);
      for (const other of layoutClauses(value)) if (isLayoutPredicate(other.clause)) assert.equal(oracleHolds(other.clause, state), other.index !== clear.index, `${seed}: C near miss vs ${other.clause.op}`);
      assert.equal(checkState(worldFor(value), state, { seed: 1, taskId: value.taskId }).passed, false);
    }
  });

  it('the build refuses a layout instance whose stated clause has no single-fault near miss of its kind', () => {
    const draft = draftFor('layout', 1, 1, 0);
    assert.ok(draft.nearMissCandidates?.length);
    const without = structuredClone(draft); delete without.nearMissCandidates;
    assert.throws(() => buildDraft(without, worldIdOf('layout', 'test')), (error: unknown) => error instanceof ChallengeError && error.code === 'layout_near_miss' && /no single-fault near miss for goal clause \d+ \(noOverlap\)/.test(error.message));
    assert.doesNotThrow(() => buildDraft(draft, worldIdOf('layout', 'test')));
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
      // Board text is data: no label or frame name in title, prompt or hints.
      const ours = JSON.stringify([value.task.title, value.task.prompt, value.task.hints]);
      for (const text of [...steps.map(s => s.label), ...frames.map(f => (f as { name: string }).name)]) assert.equal(ours.includes(text), false, text);
      // The fixed texts name only what is stated (review fixed-narration-claims): the layout area and its
      // corners with within, arrows as straight lines with an arrow clause, a tolerance with a lane clause.
      const ops = new Set(layoutClauses(value).map(({ clause }) => clause.op));
      const hint = value.task.hints!.map(h => h.en).join(' '), hintDe = value.task.hints!.map(h => h.de).join(' ');
      assert.equal(/The layout area runs from \(-?\d+, -?\d+\) to \(-?\d+, -?\d+\)\./.test(value.task.prompt.en), ops.has('within'), `${seed}: area in the prompt`);
      assert.equal(/Der Layoutbereich reicht von/.test(value.task.prompt.de), ops.has('within'));
      assert.equal(hint.includes('corners of the layout area'), ops.has('within'), `${seed}: corners in the hint`);
      assert.equal(hintDe.includes('Ecken des Layoutbereichs'), ops.has('within'));
      assert.equal(/Arrows are judged as straight lines/.test(value.task.prompt.en), ops.has('arrowsNoCrossing') || ops.has('arrowsClearOfSteps'), `${seed}: arrow rule`);
      assert.equal(/Pfeile zählen als gerade Linien/.test(value.task.prompt.de), ops.has('arrowsNoCrossing') || ops.has('arrowsClearOfSteps'));
      assert.equal(hint.includes('the tolerance in px'), ops.has('aligned') || ops.has('evenlySpaced'), `${seed}: tolerance in the hint`);
      assert.ok(/Every arrow must stay attached to a step at both ends\./.test(value.task.prompt.en));
      // The board is never called a canvas or "Arbeitsfläche" (design review F1: one term, the layout area).
      assert.equal(/canvas|Arbeitsfläche/i.test(JSON.stringify([value.task.prompt, value.task.hints])), false);
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

  it('records a fuel at least as high as the costliest compositions of 60 objects the reviewers found, and random ones stay within the search margin (review geometry-3)', () => {
    for (const [seed, difficulty] of [[1, 1], [3, 3]] as const) {
      const value = instance(seed, difficulty);
      const steps = Object.values(value.goal.objects).filter(o => o.type === 'step').map(o => o.id).sort();
      const frames: Array<string | null> = [...Object.values(value.goal.objects).filter(o => o.type === 'frame').map(o => o.id), null];
      // The reviewers' shape: 20 look-alikes of the first step in a frame (or none) and 40 arrows from a
      // goal step into it, ids sorting before the goal's. Built here, not by the search.
      const reviewers: Addition[][] = frames.flatMap(frame => steps.map((from): Addition[] => [
        { kind: 'look-alike', source: steps[0]!, frame, count: 20, prefix: '0-' }, { kind: 'arrow', from, to: steps[0]!, count: 40, prefix: '0-' }]));
      const worst = Math.max(...verdictFuels(value.task, reviewers.map(additions => withAdditions(value.goal, additions))));
      assert.ok(worst <= value.fuel, `${seed}/${difficulty}: the reviewers' compositions cost ${worst}, recorded ${value.fuel}`);
      // Random compositions of 60 objects: any source, frame, ends and id order.
      const random = createRandom(seed * 7919 + difficulty), compositions: Addition[][] = [];
      for (let i = 0; i < 60; i++) {
        const k = random.int(1, 60);
        compositions.push([{ kind: 'look-alike', source: random.pick(steps), frame: random.pick(frames), count: k, prefix: random.pick(['0-', 'z-']) },
          { kind: 'arrow', from: random.pick([...steps, 'look-alike']), to: random.pick(steps), count: 60 - k, prefix: random.pick(['0-', 'z-']) }]);
      }
      const most = Math.max(...verdictFuels(value.task, compositions.map(additions => withAdditions(value.goal, additions))));
      assert.ok(most <= value.fuel * LAYOUT_SEARCH_MARGIN, `${seed}/${difficulty}: ${most} vs ${value.fuel}`);
      assert.ok(value.fuel * LAYOUT_SEARCH_MARGIN <= 500_000);
    }
  });

  it('the distribution self-check: at every declarable difficulty, over 100 development seeds, every planned part, lane count, clause per lane and combination reaches 10 %, and a missing one fails it', () => {
    const seeds = Array.from({ length: 100 }, (_, i) => i + 1);
    for (const difficulty of [1, 2, 3, 'mixed'] as const) {
      const result = layoutSelfCheck(seeds, difficulty, 'draft');
      assert.equal(result.instances, 100);
      assert.deepEqual(result.failed, []);
      assert.deepEqual(result.belowFloor, [], JSON.stringify(result));
      // One lane only at difficulty 1 (and so in a mixed set); every clause is counted per lane.
      assert.deepEqual(Object.keys(result.lanes).sort(), difficulty === 1 || difficulty === 'mixed' ? ['1', '2'] : ['2']);
      assert.deepEqual(Object.keys(result.clauses).sort(), [...PLANNED_CLAUSES].sort());
      for (const key of ['branch × C', 'loop × C', 'fork × C', 'branch × X', 'loop × X', 'fork × X']) {
        const entry = result.combinations[key]!;
        assert.ok(entry.of > 0 && entry.with >= 0.1 * entry.of, `${difficulty} ${key}: ${entry.with}/${entry.of}`);
      }
    }
    // The floor bites: at 50 % some planned part is missing.
    assert.ok(layoutSelfCheck(seeds, 'mixed', 'draft', 0.5).belowFloor.length > 0);
    // A generator that collapses to one instance fails it by name: its topology, lanes and clauses repeat.
    const collapsed = layoutSelfCheck(seeds.slice(0, 20), 1, 'draft', 0.1, (_seed, level, tryIndex) => draftFor('layout', 1, level, tryIndex));
    assert.equal(collapsed.instances, 20);
    for (const item of ['part branch', 'part fork', 'part plain chain', 'lanes 1', 'clause W', 'branch × C']) assert.ok(collapsed.belowFloor.some(entry => entry.startsWith(item)), `${item}: ${collapsed.belowFloor.join('; ')}`);
    // The draft-level count is the built one: building changes nothing on one seed per difficulty (the
    // tool's build mode shows it on 100 seeds per difficulty).
    const built = layoutSelfCheck([1, 2, 3], 'mixed', 'build'), drafted = layoutSelfCheck([1, 2, 3], 'mixed', 'draft');
    assert.deepEqual({ ...built, mode: 'draft' }, drafted);
  });

  it('the 0.2.0 round declaration names the five 0.2.0 families only; layout is not one of them (review family-enum-020)', () => {
    const familyIssue = (family: string): boolean => {
      const parsed = DeclarationSchema.safeParse({ schema: 'practonaut.challenge-declaration/1', family });
      return !parsed.success && parsed.error.issues.some(issue => issue.path[0] === 'family');
    };
    for (const family of ['repair', 'injection', 'long-horizon', 'limited-checks', 'tight-budget']) assert.equal(familyIssue(family), false, family);
    assert.equal(familyIssue('layout'), true);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromScenes, runOracle, type FromScenesResult } from '../../src/authoring/from-scenes.ts';
import { AuthoringError } from '../../src/authoring/index.ts';
import { checkState, checkSubmission, parseScene } from '../../src/checker/index.ts';
import { evaluate } from '../../src/predicate/index.ts';
import type { Predicate, World } from '../../src/world/types.ts';
import { arrow, between, box, frame, scene } from '../support/scenes.ts';

const A = { x: 100, y: 200 }, B = { x: 400, y: 200 }, C = { x: 700, y: 200 };
const startScene = scene([box('a', 'Receive', A.x, A.y), box('c', 'Ship', C.x, C.y), arrow('ac', 'a', 'c', between(A, C))]);
const goalScene = scene([box('a', 'Receive', A.x, A.y), box('b', 'Check', B.x, B.y), box('c', 'Ship', C.x, C.y), arrow('ab', 'a', 'b', between(A, B)), arrow('bc', 'b', 'c', between(B, C))]);
const passes = (world: World, state: Parameters<typeof checkState>[1], seed = 0): boolean => checkState(world, state, { seed, taskId: world.tasks[0]!.id }).passed;
const code = (fn: () => unknown, expected: string): void => assert.throws(fn, (error: unknown) => error instanceof AuthoringError && error.code === expected);
const withoutClause = (world: World, index: number): World => {
  const copy = structuredClone(world); const goal = copy.tasks[0]!.goal as { op: 'all'; args: Predicate[] };
  goal.args.splice(index, 1); copy.tasks[0]!.conditionTexts!.splice(index, 1); return copy;
};

describe('task from two scenes', () => {
  let result: FromScenesResult;
  it('derives an exact goal: the goal scene passes, the start scene and every near miss fail', () => {
    result = fromScenes(startScene, goalScene, { taskId: 'insert-between' });
    const { world, oracle } = result;
    assert.equal(world.schema, 'practonaut.world/2');
    assert.equal(passes(world, parseScene(goalScene).state), true);
    // The start is the unchanged-state counter-probe: a goal it satisfied would make the checker refuse.
    assert.equal(evaluate(world.tasks[0]!.goal, parseScene(startScene).state).ok && (evaluate(world.tasks[0]!.goal, parseScene(startScene).state) as { value: boolean }).value, false);
    assert.deepEqual(oracle.steps.map(s => s.name), ['disconnect', 'add_step', 'connect', 'connect']);
    const run = runOracle(world, 0, 'insert-between', oracle.steps);
    assert.equal(run.ok, true); if (run.ok) assert.equal(passes(world, run.session.state), true);
    assert.ok(oracle.nearMisses.length >= 1);
    for (const miss of oracle.nearMisses) {
      const tried = runOracle(world, 0, 'insert-between', miss.steps);
      assert.equal(tried.ok, true); if (tried.ok) assert.equal(passes(world, tried.session.state), false, miss.kind);
    }
    assert.equal(world.tasks[0]!.conditionTexts!.length, (world.tasks[0]!.goal as { args: unknown[] }).args.length);
    assert.match(world.tasks[0]!.prompt.en, /Add the step “Check”\./);
    assert.match(world.tasks[0]!.conditionTexts!.map(t => t.en).join(' '), /One arrow from “Receive” to “Check”\./);
  });
  it('mutation probe: dropping the clause a near miss violates lets exactly that near miss pass', () => {
    const { world, oracle } = result;
    const single = oracle.nearMisses.filter(miss => miss.violates.length === 1);
    assert.ok(single.length >= 1, 'at least one single-fault near miss');
    for (const miss of single) {
      const tried = runOracle(world, 0, 'insert-between', miss.steps); assert.equal(tried.ok, true); if (!tried.ok) continue;
      assert.equal(passes(world, tried.session.state), false);
      assert.equal(passes(withoutClause(world, miss.violates[0]!), tried.session.state), true, `${miss.kind} passes once clause ${miss.violates[0]} is gone`);
    }
  });
  it('error classes name the missing label, the extra arrow and the loose end', () => {
    const { world } = result;
    const fired = (state: ReturnType<typeof parseScene>['state']) => world.tasks[0]!.errorClasses.filter(e => { const r = evaluate(e.when, state); return r.ok && r.value; }).map(e => e.id);
    assert.deepEqual(fired(parseScene(startScene).state), ['missing-label-1']);
    const loose = scene([box('a', 'Receive', A.x, A.y), box('b', 'Check', B.x, B.y), box('c', 'Ship', C.x, C.y), arrow('ab', 'a', 'b'), arrow('bc', 'b', 'c'), arrow('x', 'a', null), arrow('y', 'c', 'a')]);
    assert.deepEqual(fired(parseScene(loose).state), ['extra-arrow', 'loose-arrow']);
  });
  it('variants rename labels in start, goal, texts and oracle; every case is verified', () => {
    const { world, oracle } = fromScenes(startScene, goalScene, { taskId: 'v', variants: [{ id: 'de', labels: { Receive: 'Annehmen', Check: 'Prüfen', Ship: 'Versenden' } }] });
    assert.equal(world.variants.cases.length, 2);
    assert.deepEqual(Object.keys(oracle.seeds), ['drawn', 'de']);
    const translated = scene([box('a', 'Annehmen', A.x, A.y), box('b', 'Prüfen', B.x, B.y), box('c', 'Versenden', C.x, C.y), arrow('ab', 'a', 'b'), arrow('bc', 'b', 'c')]);
    assert.equal(checkSubmission(world, translated, { seed: oracle.seeds.de!, taskId: 'v' }).passed, true);
    assert.equal(checkSubmission(world, translated, { seed: oracle.seeds.drawn!, taskId: 'v' }).passed, false);
  });
  it('--layout relative pins the left-to-right order; --align pins rows with near', () => {
    const start = scene([box('a', 'One', 600, 100), box('b', 'Two', 100, 300), box('c', 'Three', 350, 180)]);
    const ordered = scene([box('a', 'One', 100, 100), box('b', 'Two', 350, 300), box('c', 'Three', 600, 180)]);
    const layout = fromScenes(start, ordered, { taskId: 'reorder', layout: 'relative' });
    assert.equal(layout.world.tasks[0]!.conditionTexts!.filter(t => /left of/.test(t.en)).length, 2);
    const shuffled = parseScene(scene([box('a', 'One', 600, 100), box('b', 'Two', 350, 300), box('c', 'Three', 100, 180)])).state;
    assert.equal(passes(layout.world, shuffled), false);
    assert.equal(passes(layout.world, parseScene(scene([box('a', 'One', 10, 0), box('b', 'Two', 20, 0), box('c', 'Three', 30, 0)])).state), true);
    const aligned = scene([box('a', 'One', 100, 200), box('b', 'Two', 350, 204), box('c', 'Three', 600, 197)]);
    const align = fromScenes(start, aligned, { taskId: 'align', align: true, tolerance: 8 });
    assert.equal(align.world.tasks[0]!.conditionTexts!.filter(t => /one row/.test(t.en)).length, 2);
    // Consecutive steps along the row stay within the tolerance; one pixel more fails.
    assert.equal(passes(align.world, parseScene(scene([box('a', 'One', 0, 50), box('b', 'Two', 0, 58), box('c', 'Three', 0, 51)])).state), true);
    assert.equal(passes(align.world, parseScene(scene([box('a', 'One', 0, 50), box('b', 'Two', 0, 59), box('c', 'Three', 0, 51)])).state), false);
  });
  it('groups, styles, shapes and frames are part of the goal and of the oracle', () => {
    const start = scene([frame('f', 'Intake', 0, 0, 700, 300), box('a', 'Order', 50, 100, { frameId: 'f' }), box('b', 'Pay', 350, 100, { frameId: 'f' }), box('c', 'Pack', 50, 500)]);
    const goal = scene([frame('f', 'Checkout', 0, 0, 700, 300), box('a', 'Order', 50, 100, { frameId: 'f', groupIds: ['g'] }), box('b', 'Pay', 350, 100, { frameId: 'f', groupIds: ['g'], shape: 'diamond', fill: '#ffec99' }), box('c', 'Pack', 50, 500, { stroke: '#e03131' })]);
    const { world, oracle } = fromScenes(start, goal, { taskId: 'mixed' });
    assert.deepEqual(oracle.steps.map(s => s.name).sort(), ['group_steps', 'rename_frame', 'set_style', 'set_style'].sort());
    assert.equal(passes(world, parseScene(goal).state), true);
    const ungrouped = scene([frame('f', 'Checkout', 0, 0, 700, 300), box('a', 'Order', 50, 100, { frameId: 'f' }), box('b', 'Pay', 350, 100, { frameId: 'f', shape: 'diamond', fill: '#ffec99' }), box('c', 'Pack', 50, 500, { stroke: '#e03131' })]);
    assert.equal(passes(world, parseScene(ungrouped).state), false);
  });
  it('refuses tasks it cannot state or solve, with named codes', () => {
    code(() => fromScenes(startScene, startScene), 'scenes_identical');
    code(() => fromScenes(startScene, scene([frame('n', 'New', 0, 0, 10, 10), box('a', 'Receive', 0, 0)])), 'oracle_unavailable');
    code(() => fromScenes('{', goalScene), 'scene_invalid');
    code(() => fromScenes(startScene, scene([])), 'goal_empty');
    code(() => fromScenes(startScene, goalScene, { variants: [{ id: 'x', labels: { Unknown: 'Y' } }] }), 'variant_label_unknown');
    code(() => fromScenes(startScene, scene([box('a', 'Same', 0, 0, { groupIds: ['g'] }), box('b', 'Same', 300, 0, { groupIds: ['g'] })])), 'ambiguous_labels');
  });
});

it('from-scenes names its limits: too many steps, a goal too complex to check, and the deadline', async () => {
  const { fromScenes, FROM_SCENES_LIMITS } = await import('../../src/authoring/from-scenes.ts');
  const { fromScenesBounded } = await import('../../src/authoring/from-scenes-runner.ts');
  const { box: shape, arrow: link, scene: file } = await import('../support/scenes.ts');
  const grid = (n: number, labels: (i: number) => string) => Array.from({ length: n }, (_, i) => shape(`b${i}`, labels(i), (i % 20) * 220, Math.floor(i / 20) * 150));
  assert.equal(FROM_SCENES_LIMITS.steps, 200);
  assert.throws(() => fromScenes(file([shape('a', 'A', 0, 0)]), file(grid(201, i => `S${i % 5}`))), (error: Error & { code?: string }) => error.code === 'scene_too_large' && /201 steps; from-scenes accepts at most 200/.test(error.message));
  // 70 distinct steps in a chain: every arrow condition looks up both end steps, which exceeds the
  // checker's step budget. That is reported as such, not as "goal not accepted".
  const chain = (n: number) => file([...grid(n, i => `S${i}`), ...Array.from({ length: n - 1 }, (_, i) => link(`a${i}`, `b${i}`, `b${i + 1}`))]);
  const chainStart = file(grid(70, i => `S${i}`));
  assert.throws(() => fromScenes(chainStart, chain(70)), (error: Error & { code?: string }) => error.code === 'goal_too_complex' && /more than the checker can evaluate within its limits/.test(error.message));
  await assert.rejects(fromScenesBounded(file([shape('a', 'A', 0, 0)]), file(grid(150, i => `S${i % 5}`)), {}, 50), (error: Error & { code?: string }) => error.code === 'from_scenes_timeout' && /longer than 0 s and was stopped/.test(error.message));
  // The worker returns the same result as the direct call, and its refusals keep their codes.
  const direct = fromScenes(file([shape('a', 'A', 0, 0), shape('b', 'B', 300, 0)]), file([shape('a', 'A', 0, 0), shape('b', 'B', 300, 0), link('ab', 'a', 'b')]));
  const bounded = await fromScenesBounded(file([shape('a', 'A', 0, 0), shape('b', 'B', 300, 0)]), file([shape('a', 'A', 0, 0), shape('b', 'B', 300, 0), link('ab', 'a', 'b')]));
  assert.deepEqual(bounded.oracle, direct.oracle); assert.deepEqual(bounded.world, direct.world);
  await assert.rejects(fromScenesBounded(file([shape('a', 'A', 0, 0)]), file([shape('a', 'A', 0, 0)])), (error: Error & { code?: string }) => error.code === 'scenes_identical');
});

// from-scenes' state-based core with a generator's extra clauses and near-miss candidates (PADR-0047
// decision 9.9): a start that differs from the goal only in positions becomes a task once a layout
// clause is appended; supplied near misses are kept when they fail, dropped when they pass or are
// refused, and `--layout relative` / `--align` are unchanged (they emit no layout operator).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromStates, runOracle } from '../../src/authoring/from-scenes.ts';
import { AuthoringError } from '../../src/authoring/project.ts';
import { checkState } from '../../src/checker/index.ts';
import { isLayoutPredicate } from '../../src/world/types.ts';
import { board, box, everything, noOverlap, within, arrow } from '../support/layout-board.ts';

const goal = board(box('a', 0, 0, 100, 60, null, { label: 'One' }), box('b', 200, 0, 100, 60, null, { label: 'Two' }), arrow('ab', 'a', 'b'));
const start = board(box('a', 0, 0, 100, 60, null, { label: 'One' }), box('b', 50, 30, 100, 60, null, { label: 'Two' }), arrow('ab', 'a', 'b'));
const clause = { predicate: noOverlap(everything('step', 2), 20), text: { en: 'No two of the 2 steps come closer than 20 px.', de: 'Keine zwei der 2 Schritte näher als 20 px.' } };

describe('fromStates with extra clauses', () => {
  it('refuses a start that differs only in positions without them, and builds the task with them', () => {
    assert.throws(() => fromStates(start, goal, { worldId: 'layout-fs', taskId: 't' }), (error: unknown) => error instanceof AuthoringError && error.code === 'start_accepted');
    const made = fromStates(start, goal, { worldId: 'layout-fs', taskId: 't', extraClauses: [clause], nearMissCandidates: [{ kind: 'layout-noOverlap', steps: [{ name: 'move_step', params: { id: 'b', x: 110, y: 0 } }] }] });
    const goalArgs = made.task.goal.op === 'all' ? made.task.goal.args : [made.task.goal];
    assert.deepEqual(goalArgs.at(-1), clause.predicate, 'appended after the multiset');
    assert.deepEqual(made.task.conditionTexts!.at(-1), clause.text);
    assert.deepEqual(made.oracle.steps, [{ name: 'move_step', params: { id: 'b', x: 200, y: 0 } }]);
    const run = runOracle(made.world, 0, 't', made.oracle.steps);
    assert.ok(run.ok && checkState(made.world, run.session.state, { taskId: 't' }).passed);
  });
  it('keeps a supplied near miss that fails, with the clauses it violates; drops one that passes or is refused', () => {
    const made = fromStates(start, goal, { worldId: 'layout-fs', taskId: 't', extraClauses: [clause, { predicate: within(everything('step', 2), 0, 0, 400, 100), text: { en: 'Inside.', de: 'Innen.' } }], nearMissCandidates: [
      { kind: 'layout-noOverlap', steps: [{ name: 'move_step', params: { id: 'b', x: 110, y: 0 } }] },
      { kind: 'layout-within', steps: [{ name: 'move_step', params: { id: 'b', x: 350, y: 0 } }] },
      { kind: 'passes', steps: [{ name: 'move_step', params: { id: 'b', x: 250, y: 20 } }] },
      { kind: 'refused', steps: [{ name: 'move_step', params: { id: 'missing', x: 0, y: 0 } }] },
      { kind: 'layout-noOverlap', steps: [{ name: 'move_step', params: { id: 'b', x: 115, y: 0 } }] },
    ] });
    const goalArgs = made.task.goal.op === 'all' ? made.task.goal.args : [];
    const overlapIndex = goalArgs.findIndex(p => p.op === 'noOverlap'), withinIndex = goalArgs.findIndex(p => p.op === 'within');
    assert.deepEqual([overlapIndex, withinIndex], [goalArgs.length - 2, goalArgs.length - 1], 'both after the multiset');
    const supplied = made.oracle.nearMisses.filter(miss => miss.kind.startsWith('layout-') || miss.kind === 'passes' || miss.kind === 'refused');
    // The second noOverlap candidate violates the same clause with the same kind: kept once.
    assert.deepEqual(supplied.map(miss => [miss.kind, miss.violates]), [['layout-noOverlap', [overlapIndex]], ['layout-within', [withinIndex]]]);
    for (const miss of made.oracle.nearMisses) {
      const run = runOracle(made.world, 0, 't', miss.steps);
      assert.ok(!run.ok || !checkState(made.world, run.session.state, { taskId: 't' }).passed, miss.kind);
    }
  });
  it('--layout relative and --align emit no layout operator', () => {
    for (const options of [{ layout: 'relative' as const }, { align: true }]) {
      const left = board(box('a', 0, 0, 100, 60, null, { label: 'One' }), box('b', -300, 30, 100, 60, null, { label: 'Two' }), arrow('ab', 'a', 'b'));
      const made = fromStates(left, board(box('a', 0, 0, 100, 60, null, { label: 'One' }), box('b', 200, 3, 100, 60, null, { label: 'Two' }), arrow('ab', 'a', 'b')), { worldId: 'layout-fs', taskId: 't', ...options });
      const args = made.task.goal.op === 'all' ? made.task.goal.args : [made.task.goal];
      assert.equal(args.some(isLayoutPredicate), false);
    }
  });
});

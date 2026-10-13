// Every requirement in a library task's text has a goal condition behind it. The requirements are
// written down here by hand from each task's prompt (the independent source); for each one a near
// miss changes only that requirement in the reference solution, and the independent checker must
// fail it while the unchanged reference solution passes. A task whose text asks for something the
// goal does not check (restyle-flow's "enlarge to 260 × 120" before 0.1.0 was fixed) fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOracle, type OracleStep, type OracleParam } from '../../src/authoring/from-scenes.ts';
import { checkState } from '../../src/checker/index.ts';
import { loadLibrary, taskWorld } from '../../src/library/index.ts';

type Mutation = (steps: OracleStep[]) => OracleStep[];
const set = (index: number, params: Record<string, OracleParam>): Mutation => steps => steps.map((step, i) => i === index ? { name: step.name, params: { ...step.params, ...params } } : step);
const drop = (index: number): Mutation => steps => steps.filter((_, i) => i !== index);
const append = (step: OracleStep): Mutation => steps => [...steps, step];

/** Task id → requirement (quoted from the English prompt) → a near miss that breaks only it. */
const REQUIREMENTS: Record<string, Array<[string, Mutation]>> = {
  'add-step': [['add a step “Archive”', drop(0)], ['named “Archive”', set(0, { label: 'Wrong' })], ['to the right of “Ship”', set(0, { x: -300 })], ['it needs no arrow', append({ name: 'connect', params: { from: 'b', to: { created: 0 } } })]],
  connect: [['draw an arrow', drop(0)], ['from “Request” to “Approve”', set(0, { from: 'b', to: 'a' })]],
  disconnect: [['remove that arrow', drop(0)], ['keep the other two', set(0, { id: 'ab' })]],
  recolor: [['red line', set(0, { stroke: 'black' })], ['red fill', set(0, { fill: 'none' })], ['leave the other steps as they are', append({ name: 'set_style', params: { id: 'a', shape: 'rectangle', stroke: 'black', fill: 'red' } })]],
  'remove-step': [['remove it', drop(0)], ['keep the other two steps', set(0, { id: 'a' })]],
  'rename-frame': [['rename the frame', drop(0)], ['to the given name', set(0, { name: 'Frame 2' })]],
  'rename-step': [['rename the first step', drop(0)], ['to the given name', set(0, { label: 'Wrong' })], ['the first step, not another', set(0, { id: 'b' })]],
  align: [['one row (± 8 px)', set(0, { y: 209 })], ['all three on the row', set(2, { y: 260 })]],
  'close-chain': [['connect the two steps', drop(0)], ['in this direction', set(0, { from: 'c', to: 'b' })]],
  group: [['all three in one group', drop(1)], ['the fourth stays outside', append({ name: 'group_steps', params: { id: 'd', with: 'a' } })]],
  'insert-between': [['no direct arrow left', append({ name: 'connect', params: { from: 'a', to: 'c' } })], ['insert the named step', set(1, { label: 'Wrong' })], ['first → inserted', drop(2)], ['inserted → last, in this direction', set(3, { from: 'c', to: { created: 1 } })]],
  reconnect: [['the second arrow is rewired', drop(0)], ['its start, to the middle step', set(0, { end: 'end', target: 'b' })]],
  reorder: [['the order from left to right', set(1, { x: 1300 })], ['the first is leftmost', set(3, { x: 50 })]],
  decision: [['a diamond', set(0, { shape: 'rectangle' })], ['after the first step (arrow into the diamond)', drop(3)], ['one arrow to the first new step', drop(4)], ['one arrow to the second new step', drop(5)], ['the new steps are named', set(2, { label: 'Wrong' })]],
  'restyle-flow': [['connect start → work', drop(4)], ['connect work → done', drop(5)], ['start is an ellipse', drop(0)], ['done is an ellipse', set(3, { shape: 'rectangle' })], ['done has a green fill', set(3, { fill: 'none' })], ['enlarge work', drop(1)], ['to 260 × 120 (± 8 px)', set(1, { width: 240 })]],
  'two-frames': [['the first two into the first frame', set(0, { frameId: 'fd' })], ['the last two into the second frame', drop(3)], ['keep all arrows', append({ name: 'disconnect', params: { id: 'ab' } })]],
};

test('every library task has a hand-written requirement list (no task is skipped)', () => {
  assert.deepEqual(Object.keys(REQUIREMENTS).sort(), loadLibrary().library.tasks.map(task => task.id).sort());
});

test('every requirement in a task text is checked: its near miss fails, the reference solution passes, in every variant', () => {
  const { world, library } = loadLibrary();
  for (const entry of library.tasks) {
    const slice = taskWorld(world, entry.id);
    for (const [caseId, seed] of Object.entries(entry.oracle.seeds)) {
      const reference = runOracle(slice, seed, entry.id, entry.oracle.steps);
      assert.ok(reference.ok && checkState(slice, reference.session.state, { seed, taskId: entry.id }).passed, `${entry.id} (${caseId}): the reference solution passes`);
      for (const [requirement, mutate] of REQUIREMENTS[entry.id]!) {
        const miss = runOracle(slice, seed, entry.id, mutate(structuredClone(entry.oracle.steps)));
        assert.ok(miss.ok, `${entry.id}: the near miss for "${requirement}" is a valid action sequence (${miss.ok ? '' : miss.code})`);
        assert.equal(checkState(slice, miss.session.state, { seed, taskId: entry.id }).passed, false, `${entry.id} (${caseId}): "${requirement}" has no goal condition — its near miss passes`);
      }
    }
  }
});

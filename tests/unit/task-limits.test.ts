// Task limits (PADR-0040): a world/2 task may limit accepted changes and evaluated checks per
// attempt; the host enforces them for every surface. Expected counts are written out by hand.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPracticeController } from '../../src/host/session.ts';
import { checkState } from '../../src/checker/index.ts';
import { Session } from '../../src/core/session.ts';
import { oracleDigest } from '../oracles/core-hash.ts';
import { compactView, mutationResult } from '../../src/mcp/replies.ts';
import { WorldError } from '../../src/world/schema.ts';
import type { Action, ErrorClass, World } from '../../src/world/types.ts';
import { v2Task, v2World } from '../support/world-v2.ts';

const move = (x: number): Action => ({ name: 'move_step', params: { id: 'a', x, y: 100 } });
const solve: Action = { name: 'connect', params: { from: 'b', to: 'c' } };
const limited = (limits: Record<string, number>): World => v2World({ tasks: [v2Task({ limits })] });
const noMirror = async (): Promise<never> => { throw new Error('mirror must not start'); };

describe('task limits in world/2', () => {
  it('are optional, public and bounded', () => {
    assert.deepEqual(limited({ actions: 3 }).tasks[0]!.limits, { actions: 3 });
    assert.deepEqual(limited({ checks: 0 }).tasks[0]!.limits, { checks: 0 });
    assert.deepEqual(limited({ actions: 1000, checks: 1000 }).tasks[0]!.limits, { actions: 1000, checks: 1000 });
    assert.equal(v2World().tasks[0]!.limits, undefined);
    for (const bad of [{}, { actions: 0 }, { actions: 1001 }, { checks: -1 }, { checks: 1001 }, { actions: 2.5 }, { actions: 2, extra: 1 }])
      assert.throws(() => limited(bad as Record<string, number>), WorldError, JSON.stringify(bad));
  });

  it('do not change transitions: replay hashes equal the independent hash oracle on a hand-written state', () => {
    // Hand-written successor of v2Start after move_step a → (120, 100); hashed by tests/oracles.
    const expected = structuredClone(v2World().initialState);
    (expected.objects.a as { x: number }).x = 120;
    for (const world of [v2World(), limited({ actions: 1, checks: 0 })]) {
      const session = new Session(world, 7, 'T1');
      assert.equal(session.act(move(120)).ok, true);
      assert.equal(session.hash, oracleDigest(expected));
    }
  });

  it('do not change the checker verdict (the checker judges the end state only)', () => {
    const state = structuredClone(v2World().initialState);
    state.objects.bc = { id: 'bc', type: 'arrow', deleted: false, frameId: null, from: 'b', to: 'c' };
    assert.equal(checkState(v2World(), state, { taskId: 'T1' }).passed, true);
    assert.equal(checkState(limited({ actions: 1, checks: 0 }), state, { taskId: 'T1' }).passed, true);
  });
});

describe('the host enforces the action limit', () => {
  it('counts accepted act, undo and reset; a refused request costs nothing; the limit is refused by name', async () => {
    const controller = await createPracticeController(limited({ actions: 3 }), { seed: 1, taskId: 'T1', mirror: 'off' }, noMirror);
    try {
      assert.deepEqual(controller.view().limits, { actions: { limit: 3, used: 0 } });
      const first = await controller.act({ expectedRevision: 0, action: move(150) });
      assert.equal(first.ok, true);
      if (first.ok) assert.deepEqual(first.value.delta.limits, { actions: { limit: 3, used: 1 } });
      // Refused by the core (unknown id) and refused as stale: neither uses an action.
      assert.equal((await controller.act({ expectedRevision: 1, action: { name: 'move_step', params: { id: 'nope', x: 1, y: 1 } } })).ok, false);
      assert.equal((await controller.act({ expectedRevision: 0, action: move(160) })).ok, false);
      assert.equal(controller.view().limits?.actions?.used, 1);
      assert.equal((await controller.undo({ expectedRevision: 1 })).ok, true);
      assert.equal(controller.view().limits?.actions?.used, 2, 'undo uses an action');
      assert.equal((await controller.reset({ expectedRevision: 2, confirmed: true })).ok, true);
      assert.equal(controller.view().limits?.actions?.used, 3, 'reset uses an action and gives nothing back');
      const hash = controller.view().hash, revision = controller.view().revision;
      const refused = await controller.act({ expectedRevision: revision, action: solve });
      assert.equal(refused.ok, false);
      if (!refused.ok) assert.equal(refused.error.code, 'action_budget_exhausted');
      assert.equal(controller.view().hash, hash, 'the refused change left the board as it was');
      assert.equal((await controller.undo({ expectedRevision: revision })).ok, false);
      // A new variant of the same task counts like a reset: with every change used it is refused too,
      // with or without naming the task (PADR-0040).
      for (const request of [{ expectedRevision: revision, confirmed: true as const }, { expectedRevision: revision, confirmed: true as const, taskId: 'T1' }]) {
        const variant = await controller.variant(request);
        assert.equal(!variant.ok && variant.error.code, 'action_budget_exhausted');
      }
      assert.deepEqual(controller.view().limits, { actions: { limit: 3, used: 3 } });
    } finally { await controller.close(); }
  });

  it('a task without limits has none in its view or replies', async () => {
    const controller = await createPracticeController(v2World(), { seed: 1, taskId: 'T1', mirror: 'off' }, noMirror);
    try {
      assert.equal(Object.hasOwn(controller.view(), 'limits'), false);
      const reply = await controller.act({ expectedRevision: 0, action: solve });
      assert.equal(reply.ok, true);
      if (reply.ok) assert.equal(Object.hasOwn(reply.value.delta, 'limits'), false);
      const check = await controller.check({ expectedRevision: 1 });
      assert.equal(check.ok && Object.hasOwn(check.value, 'checksRemaining'), false);
    } finally { await controller.close(); }
  });
});

describe('the host enforces the check limit', () => {
  it('counts evaluated checks, says how many remain, refuses the next by name and keeps counting across reset', async () => {
    const controller = await createPracticeController(limited({ checks: 2 }), { seed: 1, taskId: 'T1', mirror: 'off' }, noMirror);
    try {
      assert.deepEqual(controller.view().limits, { checks: { limit: 2, used: 0 } });
      assert.equal((await controller.check({ expectedRevision: 5 })).ok, false, 'a stale check is refused');
      assert.equal(controller.view().limits?.checks?.used, 0, 'and costs nothing');
      const first = await controller.check({ expectedRevision: 0 });
      assert.ok(first.ok); assert.equal(first.value.checksRemaining, 1); assert.equal(first.value.passed, false);
      assert.equal((await controller.reset({ expectedRevision: 0, confirmed: true })).ok, true);
      assert.equal(controller.view().limits?.checks?.used, 1, 'reset gives no check back');
      assert.equal((await controller.act({ expectedRevision: 1, action: solve })).ok, true);
      const second = await controller.check({ expectedRevision: 2 });
      assert.ok(second.ok); assert.equal(second.value.checksRemaining, 0); assert.equal(second.value.passed, true);
      const third = await controller.check({ expectedRevision: 2 });
      assert.equal(third.ok, false);
      if (!third.ok) assert.equal(third.error.code, 'check_budget_exhausted');
      assert.equal(controller.view().result?.passed, true, 'the last result stays visible');
      // The agent-facing replies carry the same counts.
      assert.deepEqual(compactView(controller.view(), 'en').limits, { checks: { limit: 2, used: 2 } });
    } finally { await controller.close(); }
  });

  it('a session limit (--checks) applies alone or lowers the task limit, never raises it', async () => {
    const cases: Array<[World, number, number]> = [[v2World(), 1, 1], [limited({ checks: 3 }), 1, 1], [limited({ checks: 1 }), 4, 1], [v2World(), 0, 0]];
    for (const [world, checks, expected] of cases) {
      const controller = await createPracticeController(world, { seed: 1, taskId: 'T1', mirror: 'off', checks }, noMirror);
      try {
        assert.deepEqual(controller.view().limits, { checks: { limit: expected, used: 0 } }, `task ${JSON.stringify(world.tasks[0]!.limits)} with --checks ${checks}`);
        for (let i = 0; i < expected; i++) assert.equal((await controller.check({ expectedRevision: 0 })).ok, true);
        const refused = await controller.check({ expectedRevision: 0 });
        assert.equal(!refused.ok && refused.error.code, 'check_budget_exhausted');
      } finally { await controller.close(); }
    }
    await assert.rejects(createPracticeController(v2World(), { seed: 1, taskId: 'T1', mirror: 'off', checks: -1 }, noMirror));
  });

  it('mutation replies to agents carry the limits', async () => {
    const controller = await createPracticeController(limited({ actions: 2, checks: 1 }), { seed: 1, taskId: 'T1', mirror: 'off' }, noMirror);
    try {
      const reply = await controller.act({ expectedRevision: 0, action: solve });
      assert.ok(reply.ok);
      const { view: _view, ...delta } = reply.value;
      assert.deepEqual(mutationResult(delta, 'en').limits, { actions: { limit: 2, used: 1 }, checks: { limit: 1, used: 0 } });
    } finally { await controller.close(); }
  });
});

describe('a new variant under task limits', () => {
  it('counts like a reset and keeps the counts; only another task starts fresh ones; a single-task host offers no way out', async () => {
    const two = v2World({ tasks: [v2Task({ limits: { actions: 2, checks: 1 } }), v2Task({ id: 'T2' })] });
    const controller = await createPracticeController(two, { seed: 1, taskId: 'T1', mirror: 'off' }, noMirror);
    try {
      assert.equal((await controller.check({ expectedRevision: 0 })).ok, true);
      const variant = await controller.variant({ expectedRevision: 0, confirmed: true });
      assert.ok(variant.ok);
      // One change used by the variant, the check stays used.
      assert.deepEqual(controller.view().limits, { actions: { limit: 2, used: 1 }, checks: { limit: 1, used: 1 } });
      assert.equal(controller.view().revision, 1);
      // Another task: its own (no) limits, fresh counts; back to T1: a new attempt with fresh counts.
      assert.equal((await controller.variant({ expectedRevision: 1, confirmed: true, taskId: 'T2' })).ok, true);
      assert.equal(controller.view().limits, undefined);
      assert.equal((await controller.variant({ expectedRevision: 2, confirmed: true, taskId: 'T1' })).ok, true);
      assert.deepEqual(controller.view().limits, { actions: { limit: 2, used: 0 }, checks: { limit: 1, used: 0 } });
    } finally { await controller.close(); }
    const single = await createPracticeController(limited({ actions: 1 }), { seed: 1, taskId: 'T1', mirror: 'off', singleTask: true }, noMirror);
    try {
      assert.equal((await single.act({ expectedRevision: 0, action: move(150) })).ok, true);
      // A single-task host refuses every variant request, before any limit is looked at.
      for (const request of [{}, { taskId: 'T1' }]) {
        const again = await single.variant({ expectedRevision: 1, confirmed: true, ...request });
        assert.equal(!again.ok && again.error.code, 'invalid_request', JSON.stringify(request));
      }
      assert.deepEqual(single.view().limits, { actions: { limit: 1, used: 1 } });
    } finally { await single.close(); }
  });
});

describe('error classes under a check limit', () => {
  // An error class that holds on the start board (one arrow) and after any move: a hand-written
  // goal-relative explanation ("the arrow to Ship is still missing").
  const missing: ErrorClass = { id: 'arrow-missing', category: 'accepted_but_violates_goal',
    when: { op: 'eq' as const, left: { kind: 'count' as const, type: 'arrow', as: 'n', where: { op: 'true' as const } }, right: { kind: 'literal' as const, value: 1 } },
    explanation: { en: 'The arrow to Ship is still missing.', de: 'Der Pfeil zu Versand fehlt noch.' } };
  const world = (limits?: Record<string, number>): World => v2World({ tasks: [v2Task({ errorClasses: [missing], ...(limits ? { limits } : {}) })] });
  it('appear only in a counted check, never in views, mutation replies, history or explain_result (review S6)', async () => {
    for (const [label, value, options] of [['task limit', world({ checks: 1 }), {}], ['session --checks', world(), { checks: 2 }]] as const) {
      const controller = await createPracticeController(value, { seed: 1, taskId: 'T1', mirror: 'off', ...options }, noMirror);
      try {
        assert.deepEqual(controller.view().errors, [], `${label}: not in the view`);
        const moved = await controller.act({ expectedRevision: 0, action: move(150) });
        assert.ok(moved.ok);
        assert.deepEqual(moved.value.delta.errors, [], `${label}: not in the mutation reply`);
        assert.deepEqual(moved.value.view.history.at(-1)!.consequences, [], `${label}: not in the history`);
        assert.deepEqual(compactView(controller.view(), 'en').errors, [], `${label}: not in what observe and explain_result read`);
        const checked = await controller.check({ expectedRevision: 1 });
        assert.ok(checked.ok);
        assert.deepEqual(checked.value.errors.map(error => error.id), ['arrow-missing'], `${label}: in the counted check`);
        assert.deepEqual(controller.view().result?.errors.map(error => error.id), ['arrow-missing'], 'the last check keeps its errors');
        assert.deepEqual(controller.view().errors, []);
      } finally { await controller.close(); }
    }
    // Without a check limit they stay where they were.
    const free = await createPracticeController(world({ actions: 5 }), { seed: 1, taskId: 'T1', mirror: 'off' }, noMirror);
    try {
      assert.deepEqual(free.view().errors.map(error => error.id), ['arrow-missing']);
      const moved = await free.act({ expectedRevision: 0, action: move(150) });
      assert.ok(moved.ok); assert.deepEqual(moved.value.delta.errors.map(error => error.id), ["arrow-missing"]);
    } finally { await free.close(); }
  });
});


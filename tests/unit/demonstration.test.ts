// The bundled example's demonstration (roadmap 0.2.0, Should 7): it solves every task and variant
// through the session's own act, says per action whether the real tool confirmed it, ends with the
// result check, can be stopped, and owns its attempt so that it is never anyone's result.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createPracticeController } from '../../src/host/session.ts';
import { demonstrationPlan, demonstrationWorld, resolvePlanned, withDemonstration } from '../../src/host/demonstration.ts';
import type { DemonstrationStatus, HostEvent, HostReply, HostView } from '../../src/host/protocol.ts';
import { publicViewSchema } from '../../src/mcp/bridge.ts';
import { compactView } from '../../src/mcp/replies.ts';
import type { PracticeMirror } from '../../src/host/mirror.ts';
import { variantIndex } from '../../src/world/variant.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { State, World } from '../../src/world/types.ts';

const raw = JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')) as { variants: { cases: Array<{ labels: Record<string, string>; insertPosition: number }> } };
const world = (): World => validateWorld(structuredClone(raw));
const noPause = async (): Promise<void> => {};
/** The first seed that selects variant case `index` (the world's own seeded choice). */
function seedFor(target: World, index: number): number { for (let seed = 0; ; seed++) if (variantIndex(target, seed) === index) return seed; }

/** Holds the real tool's read-back while `held` is set: the moment a Stop can overtake a check. */
interface SnapshotHold { held?: Promise<void> | undefined; waiting?: (() => void) | undefined }
function fakeMirror(initial: State, disagreeAt?: number, hold: SnapshotHold = {}): PracticeMirror & { applied: number } {
  let state = structuredClone(initial);
  return {
    applied: 0,
    async apply(transition: { after: State }) {
      this.applied++; state = structuredClone(transition.after);
      // A real tool that reads back something else than the model predicted.
      if (this.applied === disagreeAt) state.objects['flow-frame']!.deleted = true;
      return { ok: true as const, state: structuredClone(state), warnings: [] };
    },
    async replace(next: State) { state = structuredClone(next); return { ok: true as const, state: structuredClone(state), warnings: [] }; },
    async recover(next: State) { state = structuredClone(next); },
    async snapshot() { if (hold.held) { hold.waiting?.(); await hold.held; } return structuredClone(state); }, async png() { return new Uint8Array([137, 80, 78, 71]); }, async close() {},
  };
}
async function session(options: { seed?: number; taskId?: string; mirror?: 'off' | 'required'; disagreeAt?: number; hold?: SnapshotHold; pause?: (ms: number, signal: AbortSignal) => Promise<void> } = {}) {
  const base = await createPracticeController(world(), { seed: options.seed ?? 42, taskId: options.taskId ?? 'T1', mirror: options.mirror ?? 'off' }, async initial => fakeMirror(initial, options.disagreeAt, options.hold));
  const wrapped = withDemonstration(base, world(), { pause: options.pause ?? noPause });
  const statuses: Array<DemonstrationStatus | null> = [];
  /** Every view the Player's stream carried, in order. */
  const views: HostView[] = [];
  let settle: ((status: DemonstrationStatus) => void) | undefined;
  wrapped.controller.subscribe((event: HostEvent) => {
    if (event.type === 'ready' || event.type === 'changed') views.push(event.view);
    if (event.type !== 'demonstration') return;
    statuses.push(event.status);
    if (event.status && event.status.state !== 'running') settle?.(event.status);
  });
  return { ...wrapped, statuses, views, ended: () => new Promise<DemonstrationStatus>(resolve => { const last = statuses.at(-1); if (last && last.state !== 'running') resolve(last); else settle = resolve; }) };
}
const code = (reply: HostReply<unknown>): string | undefined => reply.ok ? undefined : reply.error.code;
/** The live board as text: step labels and arrows "from → to" by label. */
function board(state: State): { steps: string[]; arrows: string[] } {
  const live = Object.values(state.objects).filter(object => !object.deleted);
  const label = (id: string | null): string => { const step = live.find(object => object.id === id); return step?.type === 'step' ? step.label : '(loose)'; };
  return {
    steps: live.flatMap(object => object.type === 'step' ? [object.label] : []).sort(),
    arrows: live.flatMap(object => object.type === 'arrow' ? [`${label(object.from)} → ${label(object.to)}`] : []).sort(),
  };
}

describe('bundled example demonstration', () => {
  it('solves every task in every variant through act, as the demonstration actor, and the result check passes', async () => {
    for (const taskId of ['T1', 'T2', 'T3']) for (let index = 0; index < raw.variants.cases.length; index++) {
      const variant = raw.variants.cases[index]!, labels = variant.labels;
      const seed = seedFor(world(), index);
      const s = await session({ seed, taskId });
      try {
        // Work of the person before: the demonstration starts a fresh attempt of its own.
        const before = s.controller.view();
        const started = await s.demonstration.start({ expectedRevision: before.revision, confirmed: true });
        assert.equal(started.ok, true, JSON.stringify(started));
        const ended = await s.ended();
        assert.equal(ended.state, 'finished', `${taskId} case ${index}: ${JSON.stringify(ended)}`);
        assert.equal(ended.passed, true); assert.equal(ended.done, ended.total); assert.equal(ended.attempt, before.attempt + 1);
        const view = s.controller.view();
        assert.equal(view.step, ended.total); assert.equal(view.result?.passed, true, 'the same result check as the Check button');
        assert.deepEqual(view.history.map(item => item.actor), Array.from({ length: ended.total }, () => ({ kind: 'demonstration' })));
        assert.deepEqual(view.history.map(item => item.mirrorConfirmed), Array.from({ length: ended.total }, () => false), 'model-only actions are never called confirmed');
        // The expected boards come from world.json's variant data, not from the script.
        const expected = taskId === 'T1' ? { steps: [labels.first!, labels.middle!, labels.last!], arrows: [`${labels.first} → ${labels.middle}`, `${labels.middle} → ${labels.last}`] }
          : taskId === 'T2' ? { steps: [labels.order0!, labels.order1!, labels.order2!, labels.order3!], arrows: [`${labels.order0} → ${labels.order1}`, `${labels.order1} → ${labels.order2}`, `${labels.order2} → ${labels.order3}`] }
          : { steps: [labels.first!, labels.last!], arrows: [`${labels.first} → ${labels.last}`] };
        assert.deepEqual(board(view.state), { steps: expected.steps.sort(), arrows: expected.arrows.sort() }, `${taskId} case ${index}`);
      } finally { await s.controller.close(); }
    }
  });

  it('with the real tool every action is confirmed by it; a refusal ends the demonstration as failed with its reason', async () => {
    const confirmed = await session({ mirror: 'required' });
    try {
      assert.equal((await confirmed.demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      const ended = await confirmed.ended();
      assert.equal(ended.state, 'finished'); assert.equal(ended.passed, true);
      assert.deepEqual(confirmed.controller.view().history.map(item => item.mirrorConfirmed), [true, true, true, true, true]);
      assert.equal(confirmed.controller.view().result?.mode, 'real-engine');
    } finally { await confirmed.controller.close(); }
    const refused = await session({ mirror: 'required', disagreeAt: 2 });
    try {
      assert.equal((await refused.demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      const ended = await refused.ended();
      assert.deepEqual({ state: ended.state, done: ended.done, error: ended.error }, { state: 'failed', done: 1, error: 'real_tool_disagrees' });
      assert.equal(refused.controller.view().step, 1, 'the refused action left the board unchanged');
      assert.equal(refused.controller.view().result, null, 'no verdict after a failed demonstration');
    } finally { await refused.controller.close(); }
  });

  it('owns its attempt: nothing else changes the session while it runs, its board cannot be continued or saved, a reset releases it', async () => {
    const gate: Array<() => void> = [];
    const s = await session({ taskId: 'T3', pause: (_ms, signal) => new Promise<void>(resolve => { gate.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); }) });
    try {
      const move = { name: 'move_step', params: { id: 'a', x: 60, y: 160 } };
      assert.equal((await s.controller.act({ expectedRevision: 0, action: move })).ok, true, 'the person worked first');
      // Confirmation and a current revision are required, like a reset.
      assert.equal(code(await s.demonstration.start({ expectedRevision: 1, confirmed: false as unknown as true })), 'invalid_request');
      assert.equal(code(await s.demonstration.start({ expectedRevision: 0, confirmed: true })), 'stale_base');
      assert.equal(s.controller.view().step, 1, 'a refused start changes nothing');
      assert.equal((await s.demonstration.start({ expectedRevision: 1, confirmed: true })).ok, true);
      assert.equal(s.controller.view().step, 0, 'the person\'s work is not mixed into the demonstration');
      const running = s.controller.view();
      for (const reply of [
        await s.controller.act({ expectedRevision: running.revision, action: move }), await s.controller.undo({ expectedRevision: running.revision }),
        await s.controller.hint({ expectedRevision: running.revision }), await s.controller.check({ expectedRevision: running.revision }),
        await s.controller.reset({ expectedRevision: running.revision, confirmed: true }), await s.controller.variant({ expectedRevision: running.revision, confirmed: true }),
        await s.controller.export({ expectedRevision: running.revision }), await s.controller.png(), await s.demonstration.start({ expectedRevision: running.revision, confirmed: true }),
      ]) assert.equal(code(reply), 'demonstration_running');
      assert.deepEqual(s.controller.view(), running, 'refusals changed nothing');
      while (s.statuses.at(-1)?.state === 'running') { gate.shift()?.(); await new Promise(resolve => setImmediate(resolve)); }
      const ended = s.statuses.at(-1)!;
      assert.equal(ended.state, 'finished'); assert.equal(ended.passed, true);
      const done = s.controller.view();
      for (const reply of [await s.controller.act({ expectedRevision: done.revision, action: move }), await s.controller.undo({ expectedRevision: done.revision }), await s.controller.hint({ expectedRevision: done.revision }), await s.controller.export({ expectedRevision: done.revision })])
        assert.equal(code(reply), 'demonstration_attempt');
      assert.equal((await s.controller.check({ expectedRevision: done.revision })).ok, true, 'checking the demonstration board again is harmless');
      const own = await s.controller.reset({ expectedRevision: s.controller.view().revision, confirmed: true });
      assert.equal(own.ok, true); assert.equal(s.statuses.at(-1), null, 'the Player hears that the demonstration is over');
      assert.equal(s.demonstration.status(), null);
      assert.equal((await s.controller.act({ expectedRevision: s.controller.view().revision, action: move })).ok, true, 'an own attempt works as before');
      assert.deepEqual(s.controller.view().history.map(item => item.actor), [{ kind: 'human' }]);
    } finally { await s.controller.close(); }
  });

  it('stops after the action in flight and never checks a stopped board', async () => {
    const gate: Array<() => void> = [];
    const s = await session({ pause: (_ms, signal) => new Promise<void>(resolve => { gate.push(resolve); signal.addEventListener('abort', () => resolve(), { once: true }); }) });
    try {
      assert.equal((await s.demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      for (let released = 0; released < 2; released++) { await new Promise(resolve => setImmediate(resolve)); gate.shift()!(); }
      while ((s.statuses.at(-1)?.done ?? 0) < 2) await new Promise(resolve => setImmediate(resolve));
      assert.equal(s.demonstration.stop().ok, true);
      const ended = await s.ended();
      assert.deepEqual({ state: ended.state, done: ended.done, total: ended.total }, { state: 'stopped', done: 2, total: 5 });
      assert.equal(ended.passed, undefined); assert.equal(s.controller.view().result, null);
      assert.equal(s.controller.view().step, 2);
      assert.equal(s.demonstration.stop().ok, true, 'stopping again is harmless');
      assert.equal(code(await s.controller.act({ expectedRevision: s.controller.view().revision, action: { name: 'delete_step', params: { id: 'c1' } } })), 'demonstration_attempt');
      // A new demonstration may start over the stopped one.
      assert.equal((await s.demonstration.start({ expectedRevision: s.controller.view().revision, confirmed: true })).ok, true);
      assert.equal(s.controller.view().step, 0);
    } finally { await s.controller.close(); }
  });

  it('an MCP agent attached to the session can still observe a demonstration attempt and sees whose actions they were', async () => {
    const s = await session();
    try {
      assert.equal((await s.demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      await s.ended();
      const parsed = publicViewSchema.safeParse(s.controller.view());
      assert.equal(parsed.success, true, 'the bridge fails closed on unknown fields; the actor is a known one');
      assert.deepEqual(compactView(s.controller.view(), 'en', 2).history.recent.map(item => item.actor), [{ kind: 'demonstration' }, { kind: 'demonstration' }]);
      assert.equal(publicViewSchema.safeParse({ ...s.controller.view(), history: [{ ...s.controller.view().history[0]!, actor: { kind: 'demonstration', client: 'x' } }] }).success, false);
    } finally { await s.controller.close(); }
  });

  it('every view and check of its attempt says it is a demonstration and is never practice evidence, until the attempt is replaced', async () => {
    const s = await session({ mirror: 'required' });
    try {
      const before = s.controller.view();
      assert.equal(before.demonstration, undefined); assert.equal(before.practiceEvidence, true, 'a mirrored attempt of the person counts');
      assert.equal((await s.demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      const ended = await s.ended(); assert.equal(ended.state, 'finished');
      // What the Player's stream carried from the demonstration's first view on, the fresh board included.
      const own = s.views.filter(view => view.attempt === ended.attempt);
      assert.ok(own.length >= 7, `${own.length} views`);
      for (const view of own) { assert.equal(view.demonstration, true); assert.equal(view.practiceEvidence, false); }
      const verdicts = own.filter(view => view.result).map(view => view.result!);
      assert.ok(verdicts.length >= 1);
      for (const result of verdicts) { assert.equal(result.passed, true); assert.equal(result.demonstration, true); assert.equal(result.practiceEvidence, false); }
      // observe and check_result: the same, also without any history items to carry the actor.
      const view = s.controller.view();
      assert.equal(view.demonstration, true); assert.equal(view.practiceEvidence, false); assert.equal(view.result?.demonstration, true);
      const compact = compactView(view, 'en', 0);
      assert.deepEqual([compact.demonstration, compact.practiceEvidence, compact.result?.demonstration, compact.history.recent.length], [true, false, true, 0]);
      assert.equal(publicViewSchema.safeParse(view).success, true, 'the MCP bridge admits it');
      const checked = await s.controller.check({ expectedRevision: view.revision });
      assert.ok(checked.ok); assert.equal(checked.value.passed, true); assert.equal(checked.value.demonstration, true); assert.equal(checked.value.practiceEvidence, false);
      // An own attempt is a normal one again.
      assert.equal((await s.controller.reset({ expectedRevision: view.revision, confirmed: true })).ok, true);
      const after = s.controller.view();
      assert.equal(after.demonstration, undefined); assert.equal(after.practiceEvidence, true);
      const own2 = await s.controller.check({ expectedRevision: after.revision });
      assert.ok(own2.ok); assert.equal(own2.value.demonstration, undefined); assert.equal(own2.value.practiceEvidence, true);
      assert.equal(s.views.at(-1)?.demonstration, undefined);
    } finally { await s.controller.close(); }
  });

  it('a Stop accepted while the final check reads the real tool back ends it stopped, and no verdict is published', async () => {
    let release!: () => void, reached!: () => void;
    const hold: SnapshotHold = {};
    const atCheck = new Promise<void>(resolve => { reached = resolve; });
    // The pause before the check arms the hold, so the check's own read-back waits.
    const s = await session({ mirror: 'required', hold, pause: async ms => { if (ms === 800) { hold.held = new Promise<void>(resolve => { release = resolve; }); hold.waiting = reached; } } });
    try {
      assert.equal((await s.demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true);
      await atCheck;
      assert.equal(s.demonstration.stop().ok, true);
      hold.held = undefined; release();
      const ended = await s.ended();
      assert.deepEqual({ state: ended.state, done: ended.done, passed: ended.passed }, { state: 'stopped', done: 5, passed: undefined });
      assert.equal(s.controller.view().result, null, 'observe shows no verdict');
      assert.equal(s.views.filter(view => view.attempt === ended.attempt).some(view => view.result !== null), false, 'the stream never carried it');
      // A check asked for afterwards is published, marked as the demonstration's.
      const checked = await s.controller.check({ expectedRevision: s.controller.view().revision });
      assert.ok(checked.ok); assert.equal(checked.value.demonstration, true);
      assert.equal(s.controller.view().result?.demonstration, true);
    } finally { await s.controller.close(); }
  });

  it('never uses up one of the person\'s attempt numbers', async () => {
    // A fresh first attempt, untouched: the person's first own attempt after the demonstration is still 1.
    const fresh = await session();
    try {
      assert.equal(fresh.controller.view().attempt, 1);
      assert.equal((await fresh.demonstration.start({ expectedRevision: 0, confirmed: true })).ok, true); await fresh.ended();
      assert.equal((await fresh.controller.reset({ expectedRevision: fresh.controller.view().revision, confirmed: true })).ok, true);
      assert.equal(fresh.controller.view().attempt, 1);
    } finally { await fresh.controller.close(); }
    // An attempt with work in it counts once; two demonstrations in a row and a new variant change nothing about that.
    const worked = await session({ taskId: 'T3' });
    try {
      assert.equal((await worked.controller.act({ expectedRevision: 0, action: { name: 'move_step', params: { id: 'a', x: 60, y: 160 } } })).ok, true);
      for (let round = 0; round < 2; round++) {
        assert.equal((await worked.demonstration.start({ expectedRevision: worked.controller.view().revision, confirmed: true })).ok, true);
        for (let i = 0; i < 100 && worked.demonstration.status()?.state === 'running'; i++) await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal((await worked.controller.variant({ expectedRevision: worked.controller.view().revision, confirmed: true })).ok, true);
      assert.equal(worked.controller.view().attempt, 2);
      // From then on the count goes on as before.
      assert.equal((await worked.controller.act({ expectedRevision: worked.controller.view().revision, action: { name: 'move_step', params: { id: 'a', x: 80, y: 160 } } })).ok, true);
      assert.equal((await worked.controller.reset({ expectedRevision: worked.controller.view().revision, confirmed: true })).ok, true);
      assert.equal(worked.controller.view().attempt, 3);
    } finally { await worked.controller.close(); }
  });

  it('exists for the bundled example only, and its actions resolve created ids in order', async () => {
    assert.equal(demonstrationWorld(world()), true);
    assert.equal(demonstrationWorld(validateWorld({ ...structuredClone(raw), version: '1.0.1' } as never)), false, 'a changed example is not the one the scripts were written for');
    const library = validateWorld(JSON.parse(readFileSync(new URL('../../tasks/excalidraw/world/world.json', import.meta.url), 'utf8')));
    assert.equal(demonstrationWorld(library), false, 'never a library task');
    for (const task of library.tasks) assert.equal(demonstrationPlan(library, task.id, 1), undefined);
    assert.equal(demonstrationPlan(world(), 'H1', 1), undefined, 'no held-out task');
    assert.deepEqual(resolvePlanned({ name: 'connect', params: { frameId: 'f', from: { created: 0 }, to: { created: 1 } } }, ['s1', 's2']), { frameId: 'f', from: 's1', to: 's2' });
    assert.throws(() => resolvePlanned({ name: 'connect', params: { from: { created: 2 } } }, ['s1', undefined]), /created nothing/);
  });
});

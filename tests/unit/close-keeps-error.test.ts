// Issue #64: a close that runs after a failure must not replace it. On every path below the original
// failure has happened and a browser (or a mirror, a session or a host holding one) is then closed;
// the stand-in close never settles, so it outlives the close bound of graceful 3 s + forced 5 s. The
// caller must get the original failure, with the close's failure next to it as `closeError`, once
// the bound has passed. Node's mock clock moves the 8 s; nothing waits in real time.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createPracticeController } from '../../src/host/session.ts';
import { createProductionMirror, MirrorFault, type PracticeMirror } from '../../src/host/mirror.ts';
import { ADAPTER_REGISTRY, type AdapterRegistry } from '../../src/adapters/registry.ts';
import type { MirrorAdapter } from '../../src/adapters/types.ts';
import { renderCheck } from '../../src/adapters/excalidraw/render-check.ts';
import { renderCardPngs } from '../../src/bench/card-png.ts';
import { admitChildHost } from '../../src/host/server.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { State, World } from '../../src/world/types.ts';

const world = (): World => validateWorld(JSON.parse(readFileSync(new URL('../fixtures/core/world.json', import.meta.url), 'utf8')));
const never = (): Promise<never> => new Promise(() => {});
/** Graceful 3 s plus forced 5 s (the browser's close budget), written out here. */
const CLOSE_BOUND_MS = 8_000;

type Outcome = { state: 'pending' } | { state: 'fulfilled'; value: unknown } | { state: 'rejected'; reason: unknown };
/** Moves Node's mock clock in 250 ms steps (flushing pending callbacks between them) until `promise`
 * settles or `limitMs` of mock time has passed; reports how it settled and at which mock time. */
async function settle(t: TestContext, promise: Promise<unknown>, limitMs = 30_000): Promise<{ outcome: Outcome; atMs: number }> {
  let outcome: Outcome = { state: 'pending' }, atMs = 0, elapsed = 0;
  promise.then(value => { outcome = { state: 'fulfilled', value }; atMs = elapsed; }, reason => { outcome = { state: 'rejected', reason }; atMs = elapsed; });
  const flush = async (): Promise<void> => { for (let turn = 0; turn < 10; turn++) await new Promise(done => setImmediate(done)); };
  await flush();
  while (outcome.state === 'pending' && elapsed < limitMs) { t.mock.timers.tick(250); elapsed += 250; await flush(); }
  return { outcome, atMs };
}
/** The caller got `original` back, at or after the close bound, with the close's deadline next to it. */
function keptOriginal(result: { outcome: Outcome; atMs: number }, original: (reason: unknown) => boolean): void {
  assert.equal(result.outcome.state, 'rejected', `the call ${result.outcome.state === 'pending' ? 'never settled' : 'did not fail'}`);
  const reason = (result.outcome as { reason: unknown }).reason;
  assert.ok(original(reason), `the caller sees the original failure, not ${String(reason)}`);
  assert.ok(result.atMs >= CLOSE_BOUND_MS, `the close had its whole bound (${result.atMs} ms)`);
  const closeError = (reason as { closeError?: unknown }).closeError;
  assert.equal((closeError as Error | undefined)?.name, 'BrowserDeadlineError', 'the close that ran out of time is recorded next to it');
  assert.equal(Object.keys(reason as object).includes('closeError'), false, 'and is not serialised with it');
}

function standInMirror(overrides: Partial<PracticeMirror>): PracticeMirror {
  const ok = async (state: State) => ({ ok: true as const, state, warnings: [] });
  return { apply: async transition => ok(transition.after), replace: async state => ok(state), snapshot: async () => { throw new Error('unused'); },
    png: async () => new Uint8Array(), recover: async () => {}, close: async () => {}, ...overrides };
}
function standInAdapter(overrides: Partial<MirrorAdapter>): MirrorAdapter {
  const result = async (state: State) => ({ ok: true as const, state, warnings: [] });
  return { describe: () => { throw new Error('unused'); }, snapshot: async () => { throw new Error('unused'); }, apply: async transition => result(transition.after),
    restoreState: async state => result(state), exportArtifact: async () => { throw new Error('unused'); }, importArtifact: async () => { throw new Error('unused'); },
    renderPng: async () => new Uint8Array(), networkAttempts: () => [], terminate: async () => {}, close: async () => {}, ...overrides };
}
const registryOf = (create: () => Promise<MirrorAdapter>): AdapterRegistry => ({ excalidraw: { ...ADAPTER_REGISTRY.excalidraw, create } });

test('session start: an admission failure stays the error when the mirror close outlives its bound (session.ts)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const refused = new Error('admission refused by the caller');
  const started = createPracticeController(world(), { seed: 1, admitView: () => { throw refused; } }, async () => standInMirror({ close: never }));
  keptOriginal(await settle(t, started), reason => reason === refused);
});

test('mirror recovery in a session: a close that outlives its bound leaves the transaction\'s own refusal (session.ts)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = await createPracticeController(world(), { seed: 1 }, async () => standInMirror({
    apply: async () => { throw new MirrorFault('mirror_unavailable', 'stand-in engine gone'); },
    recover: async () => { throw new MirrorFault('mirror_unavailable', 'stand-in recovery failed'); },
    close: never,
  }));
  const result = await settle(t, controller.act({ expectedRevision: 0, action: { name: 'move_step', params: { id: 'a', x: 200, y: 220 } } }));
  assert.equal(result.outcome.state, 'fulfilled', `the act ${result.outcome.state === 'pending' ? 'never answered' : 'threw'}`);
  const reply = (result.outcome as { value: { ok: boolean; error?: { code: string } } }).value;
  assert.deepEqual([reply.ok, reply.error?.code], [false, 'mirror_unavailable'], 'the refusal the failed engine causes, not a close failure');
  assert.ok(result.atMs >= CLOSE_BOUND_MS);
  assert.equal(controller.view().mirrorHealth.status, 'unavailable');
});

test('mirror recovery: a failed rollback stays the error when disposing the adapter outlives its bound (mirror.ts)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = world().initialState;
  const mirror = await createProductionMirror(initial, undefined, undefined, registryOf(async () => standInAdapter({
    restoreState: async () => ({ ok: false, error: { code: 'integrity_failed', message: 'stand-in refuses', details: {} } }), terminate: never,
  })));
  keptOriginal(await settle(t, mirror.recover(initial)), reason => reason instanceof MirrorFault && reason.message === 'Mirror rollback failed');
});

test('mirror recovery: a replacement started after close stays refused when its own close outlives its bound (mirror.ts)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initial = world().initialState;
  let release!: (adapter: MirrorAdapter) => void, creations = 0;
  const mirror = await createProductionMirror(initial, undefined, undefined, registryOf(async () => {
    // The first adapter fails a write (the mirror marks itself interrupted); the replacement arrives late.
    if (++creations === 1) return standInAdapter({ apply: async () => { throw new Error('stand-in write failed'); } });
    return new Promise<MirrorAdapter>(done => { release = done; });
  }));
  await mirror.apply({ before: initial, after: initial, action: { name: 'move_step', params: {} } }).catch(() => undefined);
  const recovering = mirror.recover(initial);
  for (let turn = 0; turn < 10 && creations < 2; turn++) await new Promise(done => setImmediate(done));
  assert.equal(creations, 2, 'the replacement is being created');
  void mirror.close();
  release(standInAdapter({ terminate: never }));
  keptOriginal(await settle(t, recovering), reason => reason instanceof MirrorFault && reason.message === 'Mirror closed');
});

test('render check: the browser\'s own failure stays the error when its close outlives its bound (render-check.ts)', async t => {
  const target = chromium as unknown as { launch: typeof chromium.launch }, launch = target.launch;
  t.after(() => { target.launch = launch; });
  const refused = new Error('stand-in context refused');
  target.launch = (async () => ({ newContext: async () => { throw refused; }, close: never }) as unknown as Browser) as typeof chromium.launch;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  keptOriginal(await settle(t, renderCheck({ native: JSON.stringify({ elements: [] }), svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' })), reason => reason === refused);
});

test('report card: a page failure stays the error when the context and browser closes outlive their bounds (card-png.ts)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const refused = new Error('stand-in route refused');
  const browser = { newContext: async () => ({ route: async () => { throw refused; }, close: never }), close: never } as unknown as Browser;
  const result = await settle(t, renderCardPngs(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { chromium: { launch: async () => browser } }), 40_000);
  assert.equal(result.outcome.state, 'rejected', `the call ${result.outcome.state === 'pending' ? 'never settled' : 'did not fail'}`);
  const reason = (result.outcome as { reason: unknown }).reason;
  assert.equal(reason, refused, `the caller sees the original failure, not ${String(reason)}`);
  assert.equal(((reason as { closeError?: Error }).closeError)?.name, 'BrowserDeadlineError');
  assert.ok(result.atMs >= CLOSE_BOUND_MS * 2 && result.atMs <= CLOSE_BOUND_MS * 2 + 1_000, `each close had its own bound, and no more (${result.atMs} ms)`);
});

test('author practice host: a reply over budget stays the error when closing the host again outlives its bound (server.ts)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // The launch and from-scenes routes answer through this check; their reply cannot exceed the budget
  // from outside, so the check is called directly with a value over it (the budget is 4 MiB).
  keptOriginal(await settle(t, admitChildHost({ close: never }, { url: 'x'.repeat(5 * 1024 * 1024) })),
    reason => (reason as { code?: string }).code === 'result_too_large');
});

// PADR-0050, decisions 2, 3, 6 and 8: one close contract for every browser owner. A stand-in browser's
// close never settles (Playwright's close of a browser that is slow to exit); every owner's call comes
// back at its deadline with its own result and the outcome *abandoned*; the browser keeps its slot (and
// the shell its sink) until a close asked while it was connected fulfils. Every layer above passes its
// deadline down and reads the outcome: no outer timer turns an abandoned close into a failure.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import fsp, { open } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserBudgetError, BrowserLedger, startBrowser } from '../../src/adapters/browser/ledger.ts';
import { CloseRequested, type CloseResult } from '../../src/adapters/browser/close.ts';
import { AdapterError, AdapterInitializationError, LAUNCH_AFTER_WAIT_MS, startShell, type BrowserShell } from '../../src/adapters/browser/shell.ts';
import { ADAPTER_REGISTRY, type AdapterRegistry } from '../../src/adapters/registry.ts';
import type { AdapterOptions, MirrorAdapter } from '../../src/adapters/types.ts';
import { renderCheck } from '../../src/adapters/excalidraw/render-check.ts';
import { renderCardPngs } from '../../src/bench/card-png.ts';
import { chromiumStarts } from '../../src/cli/browser-start.ts';
import { createProductionMirror, type PracticeMirror } from '../../src/host/mirror.ts';
import { createPracticeController, type BrowserCloseDiagnostic } from '../../src/host/session.ts';
import { ChildHosts, StartCleanupFailed, childStartOutcome, httpFailure, startHost, status } from '../../src/host/server.ts';
import { HOST_ERROR_CODES } from '../../src/host/protocol.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { State, World } from '../../src/world/types.ts';
import { FakeBrowser, advance, fakeChromium, flush } from '../support/fake-browser.ts';

const world = (): World => validateWorld(JSON.parse(readFileSync(new URL('../fixtures/core/world.json', import.meta.url), 'utf8')));
const LAUNCH = { env: {}, platform: 'darwin' as const, memo: { unavailable: false } };
const CLOSE_DEADLINE_MS = 8_000;

/** Whether the shell's sink still holds its port: it answers 403, or the connection is refused. */
function sinkAnswers(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('data', data => { socket.destroy(); resolve(data.toString().startsWith('HTTP/1.1 403')); });
    socket.once('error', () => resolve(false));
  });
}
/** Settles `promise` under the mock clock; returns its value and the mock time it took. */
async function timed<T>(t: TestContext, promise: Promise<T>, limitMs = 40_000): Promise<{ value: T; atMs: number }> {
  let value: { v: T } | undefined;
  void promise.then(v => { value = { v }; });
  const atMs = await advance(t, () => value !== undefined, limitMs);
  assert.ok(value, `still pending after ${atMs} ms of mock time`);
  return { value: value.v, atMs };
}
const around = (atMs: number, expected: number): void => assert.ok(atMs >= expected && atMs <= expected + 500, `settled at ${atMs} ms, expected ${expected} ms`);

/** A mirror adapter on a real shell over a stand-in browser, as the registry's factory would make it. */
function shellAdapters(ledger: BrowserLedger, browsers: () => ReturnType<typeof fakeChromium>, starts: Array<{ signal: AbortSignal | undefined }> = []): AdapterRegistry {
  const create = async (initial: State, options: AdapterOptions = {}): Promise<MirrorAdapter> => {
    starts.push({ signal: options.signal });
    const fake = browsers();
    const shell: BrowserShell = await startShell({ chromium: fake.chromium, ledger, launchContext: { ...LAUNCH, memo: { unavailable: false } }, origins: {}, signal: options.signal }, async () => {});
    let failing = true; // Every adapter fails its first write, so the mirror recovers.
    const result = async (state: State) => ({ ok: true as const, state, warnings: [] });
    return { describe: () => { throw new Error('unused'); }, snapshot: async () => initial, renderPng: async () => new Uint8Array(), networkAttempts: () => [],
      apply: async transition => { if (failing) { failing = false; throw new Error('stand-in write failed'); } return result(transition.after); },
      restoreState: async state => result(state), exportArtifact: async () => { throw new Error('unused'); }, importArtifact: async () => { throw new Error('unused'); },
      terminate: deadline => shell.close(deadline), close: deadline => shell.close(deadline) };
  };
  return { excalidraw: { ...ADAPTER_REGISTRY.excalidraw, create } };
}

test('shell: a close that never settles is abandoned at its deadline; slot and sink stay until a close asked while connected fulfils', async t => {
  const ledger = new BrowserLedger(), fake = fakeChromium(new FakeBrowser('held'));
  const shell = await startShell({ chromium: fake.chromium, ledger, launchContext: LAUNCH, origins: {} }, async () => {});
  const port = Number(new URL(fake.calls[0]!.proxy!.server).port);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { value, atMs } = await timed(t, shell.close());
  assert.deepEqual(value, { outcome: 'abandoned' }); around(atMs, CLOSE_DEADLINE_MS);
  assert.equal(ledger.unreleased(), 1, 'the slot stays reserved');
  assert.equal(await sinkAnswers(port), true, 'the sink keeps its port while the browser may still connect to it');
  fake.browser.closing.finish(); await flush();
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.end, ledger.records()[0]!.callers.abandoned], [0, 'proven', 1]);
  await flush();
  assert.equal(await sinkAnswers(port), false, 'the sink closed with the release');
});

test('shell: a launch that rejects keeps its slot and its sink for 35 s after the rejection', async t => {
  const ledger = new BrowserLedger(), fake = fakeChromium(new FakeBrowser(), false);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const starting = startShell({ chromium: fake.chromium, ledger, launchContext: LAUNCH, origins: {} }, async () => {});
  starting.catch(() => undefined);
  await flush();
  fake.reject(new Error('browserType.launch: Timeout 3000ms exceeded.'));
  await assert.rejects(starting, /Timeout 3000ms exceeded/);
  const port = Number(new URL(fake.calls[0]!.proxy!.server).port);
  await advance(t, () => false, 34_750);
  assert.deepEqual([ledger.unreleased(), await sinkAnswers(port)], [1, true], 'slot and sink are held after the rejection');
  await advance(t, () => ledger.unreleased() === 0, 1_000); await flush();
  assert.deepEqual([ledger.records()[0]!.slot, await sinkAnswers(port)], ['launch-wait', false]);
});

test('start check: the answer comes at the close deadline with the close abandoned; the slot stays until the end is proven', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(), fake = fakeChromium(new FakeBrowser('held'));
  const { value, atMs } = await timed(t, chromiumStarts(30_000, { chromium: fake.chromium, ledger }));
  assert.deepEqual(value, { ok: true, sandbox: true }, 'the start check\'s own answer'); around(atMs, CLOSE_DEADLINE_MS);
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.callers.abandoned], [1, 1]);
  fake.browser.closing.finish(); await flush();
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.slot], [0, 'proof']);
});

test('render check: the report comes at the close deadline with the close abandoned; the slot stays until the end is proven', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(), fake = fakeChromium(new FakeBrowser('held'));
  const { value, atMs } = await timed(t, renderCheck({ native: JSON.stringify({ elements: [] }), svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }, undefined, { chromium: fake.chromium, ledger }));
  assert.deepEqual(value, { ok: false, arrows: [], labels: [] }, 'the check\'s own report'); around(atMs, CLOSE_DEADLINE_MS);
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.owner, ledger.records()[0]!.callers.abandoned], [1, 'render-check', 1]);
  fake.browser.closing.finish(); await flush();
  assert.equal(ledger.unreleased(), 0);
});

test('report card: an abandoned context close keeps the pictures, takes no slot, and the browser\'s abandoned close returns them', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(), browser = new FakeBrowser('held'), fake = fakeChromium(browser);
  browser.contextClose = 'held';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const { value, atMs } = await timed(t, renderCardPngs([svg, svg], { chromium: fake.chromium, ledger }));
  assert.equal(value.pngs.length, 2, 'both pictures are kept');
  around(atMs, 3 * CLOSE_DEADLINE_MS); // Each context close and the browser's close had their own deadline, and no more.
  assert.deepEqual([browser.contexts.length, browser.contexts.every(context => context.closing.calls === 1)], [2, true]);
  assert.equal(ledger.records().length, 1, 'contexts have no entry of their own');
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.callers.abandoned], [1, 1]);
  browser.closing.finish(); await flush();
  assert.equal(ledger.unreleased(), 0);
});

test('the review\'s counterexample: a close that never settles is abandoned at every layer, never a deadline error of an outer timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(), registry = shellAdapters(ledger, () => fakeChromium(new FakeBrowser('held')));
  const initial = world().initialState;
  // The mirror's close.
  const mirror = await createProductionMirror(initial, undefined, undefined, registry);
  const closed = await timed(t, mirror.close());
  assert.deepEqual(closed.value, { outcome: 'abandoned' }); around(closed.atMs, CLOSE_DEADLINE_MS);
  // The mirror's dispose in a recovery: the old browser's close is abandoned, the recovery goes on.
  const recovering = await createProductionMirror(initial, undefined, undefined, registry);
  await recovering.apply({ before: initial, after: initial, action: { name: 'move_step', params: {} } }).catch(() => undefined);
  const old: CloseResult[] = [];
  const recovered = await timed(t, recovering.recover(initial, result => { old.push(result); }));
  assert.deepEqual(old, [{ outcome: 'abandoned' }]); around(recovered.atMs, CLOSE_DEADLINE_MS);
  assert.equal(ledger.unreleased(), 3, 'every browser whose end is not proven keeps its slot: two old, one replacement');
  // The session's close passes the outcome up and records it for the host.
  const records: BrowserCloseDiagnostic[] = [];
  const controller = await createPracticeController(world(), { seed: 1, onBrowserClose: record => { records.push(record); } }, state => createProductionMirror(state, undefined, undefined, registry));
  const session = await timed(t, controller.close());
  assert.deepEqual(session.value, { outcome: 'abandoned' }); around(session.atMs, CLOSE_DEADLINE_MS);
  assert.deepEqual(records, [{ code: 'browser_close_abandoned', phase: 'close', revision: 0 }]);
});

/** Player assets the host serves; their content does not matter here. */
function stubAssets(): string {
  const directory = mkdtempSync(join(tmpdir(), 'pn-close-assets-'));
  for (const name of ['index.html', 'player.js', 'player.css', 'tokens.css']) writeFileSync(join(directory, name), '');
  return directory;
}

test('the review\'s counterexample under a host close: the host resolves at the deadline it passed down and records the abandoned close', async () => {
  const ledger = new BrowserLedger(), registry = shellAdapters(ledger, () => fakeChromium(new FakeBrowser('held')));
  const tokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-host-'));
  const host = await startHost(world(), { seed: 1, assetDirectory: stubAssets(), tokenDirectory: tokens, controllerFactory: (value, options) => createPracticeController(value, options ?? {}, state => createProductionMirror(state, undefined, undefined, registry)) });
  const diagnostics = host.tokenFile.replace(/\.token$/, '.mirror.jsonl');
  const started = performance.now();
  await host.close(started + 300); // Resolves: an abandoned close is not "could not be fully confirmed".
  const took = performance.now() - started;
  assert.ok(took >= 290 && took < 2_000, `the host's close took ${Math.round(took)} ms for a deadline of 300 ms`);
  assert.deepEqual(readdirSync(tokens).filter(name => name.endsWith('.token')), [], 'the credential is removed');
  const lines = readFileSync(diagnostics, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { code: string; phase: string });
  assert.deepEqual(lines.map(line => [line.code, line.phase]), [['browser_close_abandoned', 'close']], 'the host\'s private diagnostics record it');
  assert.equal(ledger.unreleased(), 1);
});

test('a session close while a recovery\'s replacement is still launching: the start is aborted, the mirror settles as cancelled, and the late browser goes to its one close', async () => {
  const ledger = new BrowserLedger(), starts: Array<{ signal: AbortSignal | undefined }> = [];
  const browsers = [fakeChromium(new FakeBrowser()), fakeChromium(new FakeBrowser(), false)];
  const registry = shellAdapters(ledger, () => browsers[starts.length - 1]!, starts);
  const tokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-f4-'));
  let controller: Awaited<ReturnType<typeof createPracticeController>> | undefined;
  const host = await startHost(world(), { seed: 1, assetDirectory: stubAssets(), tokenDirectory: tokens, controllerFactory: async (value, options) => (controller = await createPracticeController(value, options ?? {}, state => createProductionMirror(state, undefined, undefined, registry))) });
  // The first write fails; the recovery's old close is quick, its replacement never finishes launching.
  const acting = controller!.act({ expectedRevision: 0, action: { name: 'move_step', params: { id: 'a', x: 200, y: 220 } } });
  for (let turn = 0; turn < 50 && browsers[1]!.calls.length === 0; turn++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(browsers[1]!.calls.length, 1, 'the replacement is launching');
  const started = performance.now();
  await host.close(started + 2_000);
  assert.ok(performance.now() - started < 1_000, 'the close did not wait for the replacement\'s start');
  assert.ok(starts[1]!.signal?.aborted && starts[1]!.signal.reason instanceof CloseRequested, 'the start received the abort with the close\'s deadline');
  assert.equal((await acting).ok, false);
  browsers[1]!.release(); await flush();
  assert.equal(browsers[1]!.browser.closing.calls, 1, 'the late replacement went to its one close');
  assert.equal(ledger.unreleased(), 0);
});

test('a mirror close while the replacement is still starting its page: the start is aborted and its browser\'s close is abandoned at the close\'s own deadline', async () => {
  const ledger = new BrowserLedger(), starts: Array<{ signal: AbortSignal | undefined }> = [];
  const replacement = new FakeBrowser('held'); replacement.hangNewContext = true;
  const browsers = [fakeChromium(new FakeBrowser()), fakeChromium(replacement)];
  const registry = shellAdapters(ledger, () => browsers[starts.length - 1]!, starts);
  const initial = world().initialState;
  const mirror: PracticeMirror = await createProductionMirror(initial, undefined, undefined, registry);
  await mirror.apply({ before: initial, after: initial, action: { name: 'move_step', params: {} } }).catch(() => undefined);
  const recovering = mirror.recover(initial); recovering.catch(() => undefined);
  for (let turn = 0; turn < 50 && browsers[1]!.calls.length === 0; turn++) await new Promise(resolve => setTimeout(resolve, 10));
  await flush();
  const started = performance.now();
  const result = await mirror.close(started + 300);
  const took = performance.now() - started;
  assert.deepEqual(result, { outcome: 'abandoned' });
  assert.ok(took >= 290 && took < 1_000, `settled after ${Math.round(took)} ms for a deadline of 300 ms, never a later default`);
  assert.equal(replacement.closing.calls, 1);
  await assert.rejects(recovering);
  assert.equal(ledger.unreleased(), 1, 'the replacement keeps its slot until its end is proven');
  replacement.closing.finish(); await flush();
  assert.equal(ledger.unreleased(), 0);
});

test('a recovery holds two slots, the old browser\'s and its replacement\'s, until the old browser\'s end is proven', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(), old = new FakeBrowser('held'), browsers = [fakeChromium(old), fakeChromium(new FakeBrowser())];
  const starts: Array<{ signal: AbortSignal | undefined }> = [], registry = shellAdapters(ledger, () => browsers[starts.length - 1]!, starts);
  const initial = world().initialState;
  const mirror = await createProductionMirror(initial, undefined, undefined, registry);
  await mirror.apply({ before: initial, after: initial, action: { name: 'move_step', params: {} } }).catch(() => undefined);
  const recovered = await timed(t, mirror.recover(initial));
  around(recovered.atMs, CLOSE_DEADLINE_MS);
  assert.deepEqual([starts.length, ledger.unreleased()], [2, 2], 'the replacement runs on a slot of its own while the old browser is still closing');
  old.closing.finish(); await flush();
  assert.equal(ledger.unreleased(), 1, 'the old browser\'s slot is freed by its proven end');
  assert.deepEqual(ledger.records().map(record => [record.id, record.slot]), [[1, 'proof'], [2, 'held']]);
});

// --- Review of PR #69 (2026-10-19) ---

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
/** A mirror whose first adapter fails its first write, so its next recovery replaces the browser. */
async function interruptedMirror(registry: AdapterRegistry): Promise<PracticeMirror> {
  const initial = world().initialState, mirror = await createProductionMirror(initial, undefined, undefined, registry);
  await mirror.apply({ before: initial, after: initial, action: { name: 'move_step', params: {} } }).catch(() => undefined);
  return mirror;
}

// Codex 4, contract-mirror-close-no-join-inflight-dispose: a close during a recovery's dispose found
// no adapter and answered *closed* at once; the host then closed its diagnostics before the record.
test('a mirror close during a recovery\'s dispose joins the old browser\'s close and reports how it settled', async () => {
  const ledger = new BrowserLedger(), old = new FakeBrowser('held'), browsers = [fakeChromium(old), fakeChromium(new FakeBrowser())];
  const starts: Array<{ signal: AbortSignal | undefined }> = [], registry = shellAdapters(ledger, () => browsers[starts.length - 1]!, starts);
  const records: BrowserCloseDiagnostic[] = [];
  let mirror: PracticeMirror | undefined;
  const controller = await createPracticeController(world(), { seed: 1, onBrowserClose: record => { records.push(record); } }, async state => (mirror = await interruptedMirror(registry), mirror));
  const recovering = mirror!.recover(world().initialState); recovering.catch(() => undefined);
  await flush();
  assert.equal(old.closing.calls, 1, 'part one: the old browser\'s close is asked');
  const started = performance.now();
  const result = await controller.close(started + 300);
  const took = performance.now() - started;
  assert.deepEqual(result, { outcome: 'abandoned' }, 'the session\'s close passes up how the old browser\'s close settled');
  assert.ok(took >= 290 && took < 1_000, `settled by its own deadline (${Math.round(took)} ms)`);
  assert.deepEqual(records.filter(record => record.phase === 'close'), [{ code: 'browser_close_abandoned', phase: 'close', revision: 0 }], 'the host learns of it before it closes its diagnostics');
  assert.equal(starts.length, 1, 'the closed mirror starts no replacement');
  old.closing.finish(); await flush();
});

// contract-start-closed-outer-timer: a replacement already closing after its own failure kept its own
// 8 s deadline, and the mirror's safety timer turned its close into *failed*.
test('a mirror close while the replacement is closing after its own failure settles by the close\'s deadline as abandoned', async () => {
  const ledger = new BrowserLedger(), replacement = new FakeBrowser('held');
  let created = 0;
  const first = shellAdapters(ledger, () => fakeChromium(new FakeBrowser())).excalidraw!.create;
  const registry: AdapterRegistry = { excalidraw: { ...ADAPTER_REGISTRY.excalidraw, create: async (initial, options = {}) => {
    if (++created === 1) return first(initial, options);
    await startShell({ chromium: fakeChromium(replacement).chromium, ledger, launchContext: { ...LAUNCH, memo: { unavailable: false } }, origins: {}, signal: options.signal }, async () => { await sleep(50); throw new Error('stand-in initialize failed'); });
    throw new Error('unreachable');
  } } };
  const mirror = await interruptedMirror(registry);
  const recovering = mirror.recover(world().initialState); recovering.catch(() => undefined);
  for (let turn = 0; turn < 100 && replacement.closing.calls === 0; turn++) await sleep(10);
  assert.equal(replacement.closing.calls, 1, 'the replacement failed and is closing under its own deadline');
  const started = performance.now();
  const result = await mirror.close(started + 300);
  const took = performance.now() - started;
  assert.deepEqual(result, { outcome: 'abandoned' }, 'never failed by a safety timer');
  assert.ok(took >= 290 && took < 1_000, `settled by the close's own deadline (${Math.round(took)} ms)`);
  replacement.closing.finish(); await flush();
});

// effects-1, contract-session-close-post-deadline-write: the session awaited the diagnostics write
// (write and fsync) inside the host's 1 s safety margin; a slow disk failed the host's close.
test('a slow diagnostics write neither delays the session\'s close nor fails the host\'s, and the record still lands', async t => {
  const ledger = new BrowserLedger(), registry = shellAdapters(ledger, () => fakeChromium(new FakeBrowser('held')));
  const tokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-slow-'));
  const probe = await open(join(tokens, 'probe'), 'w'), handle = Object.getPrototypeOf(probe) as { sync: () => Promise<void> }, sync = handle.sync;
  await probe.close();
  handle.sync = async function (this: unknown) { await sleep(1_200); return sync.call(this); };
  t.after(() => { handle.sync = sync; });
  const host = await startHost(world(), { seed: 1, assetDirectory: stubAssets(), tokenDirectory: tokens, controllerFactory: (value, options) => createPracticeController(value, options ?? {}, state => createProductionMirror(state, undefined, undefined, registry)) });
  const diagnostics = host.tokenFile.replace(/\.token$/, '.mirror.jsonl');
  const started = performance.now();
  await host.close(started + 300);
  assert.ok(performance.now() - started < 5_000);
  const lines = readFileSync(diagnostics, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { code: string });
  assert.deepEqual(lines.map(line => line.code), ['browser_close_abandoned'], 'the host\'s diagnostics close waited for the record');
});

// Codex 3: a practice host the author host was still starting escaped its shutdown.
test('child hosts: a start under way is stopped with the shutdown\'s deadline and what it became is closed; none is published after', async () => {
  const children = new ChildHosts();
  const signals: AbortSignal[] = [], closes: number[] = [];
  let finish!: () => void;
  const launched = children.launch(signal => { signals.push(signal); return new Promise<{ close(by?: number): Promise<void> }>(resolve => { finish = () => resolve({ close: async by => { closes.push(by ?? -1); } }); }); }, async () => 'reply');
  launched.catch(() => undefined);
  assert.equal(children.size, 1, 'a start under way counts against the limit');
  const deadline = performance.now() + 300, shutdown = children.shutDown(deadline);
  assert.equal(shutdown.length, 1, 'the start under way has a close');
  assert.ok(signals[0]!.aborted && signals[0]!.reason instanceof CloseRequested && signals[0]!.reason.deadline === deadline, 'the start is stopped with the close\'s deadline');
  const closing = shutdown[0]!(deadline);
  finish();
  await closing;
  await assert.rejects(launched, (error: unknown) => (error as { code?: string }).code === 'mirror_unavailable', 'never published');
  assert.ok(closes.length >= 1 && closes.every(by => by === deadline), 'what the start became is closed under the shutdown\'s deadline');
  await assert.rejects(children.launch(async () => ({ close: async () => {} }), async () => 'late'), (error: unknown) => (error as { code?: string }).code === 'mirror_unavailable', 'no child starts after the shutdown began');
});

test('a host\'s shutdown stops a practice host it is still starting, and gives a child its own cleanup time', async () => {
  const children = new ChildHosts(), tokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-children-'));
  const host = await startHost(world(), { seed: 1, mirror: 'off', assetDirectory: stubAssets(), tokenDirectory: tokens, childHosts: children });
  // A running child whose own close settles 1.5 s after the deadline it gets (its diagnostics and
  // credential steps), and a child still starting that reacts to its abort.
  let slowClosedAt = 0;
  await children.launch(async () => ({ close: async (by?: number) => { await sleep(Math.max(0, (by ?? 0) + 1_500 - performance.now())); slowClosedAt = performance.now(); } }), async () => 'running');
  let stopped: AbortSignal | undefined;
  const starting = children.launch(signal => new Promise<{ close(): Promise<void> }>((_, reject) => { stopped = signal; signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }), async () => 'starting');
  starting.catch(() => undefined);
  const started = performance.now();
  await host.close(started + 300); // Resolves: the slow child had its time, the starting one was stopped.
  assert.ok(stopped?.aborted && stopped.reason instanceof CloseRequested, 'the start under way received the abort with the deadline');
  assert.ok(slowClosedAt > 0 && slowClosedAt - started >= 1_700, 'the slow child closed in full, not cut at the deadline plus 1 s');
  await assert.rejects(starting);
});

test('a host passes its stop signal to its session, the session to its mirror factory, and the mirror to the adapter\'s start', async () => {
  const stop = new AbortController(), seen: Array<AbortSignal | undefined> = [];
  const tokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-signal-'));
  const host = await startHost(world(), { seed: 1, mirror: 'off', assetDirectory: stubAssets(), tokenDirectory: tokens, signal: stop.signal,
    controllerFactory: async (value, options) => { seen.push((options as { signal?: AbortSignal } | undefined)?.signal); return createPracticeController(value, { ...options, mirror: 'off' }, async () => { throw new Error('unused'); }); } });
  await host.close();
  const factorySignals: Array<AbortSignal | undefined> = [];
  const controller = await createPracticeController(world(), { seed: 1, signal: stop.signal }, async (state, _world, start) => { factorySignals.push(start?.signal); return createProductionMirror(state, undefined, undefined, { excalidraw: { ...ADAPTER_REGISTRY.excalidraw, create: async (initial, options) => { factorySignals.push(options?.signal); return shellAdapters(new BrowserLedger(), () => fakeChromium()).excalidraw!.create(initial, options); } } }, start?.signal); });
  await controller.close();
  assert.deepEqual([seen[0] === stop.signal, factorySignals[0] === stop.signal, factorySignals[1] === stop.signal], [true, true, true]);
});

// Codex 5: a practice host's start refused by the budget answered mirror_unavailable over HTTP.
test('an HTTP request whose practice host found the budget full answers browser_budget_exhausted, 503', () => {
  const refused = new BrowserBudgetError({ running: 6, closing: 2 }, 8);
  const named = httpFailure(refused);
  assert.equal(named.code, 'browser_budget_exhausted');
  assert.match(named.message, /6 running and 2 closing of 8 allowed; wait until they have closed, or restart Practonaut/);
  assert.equal(status(named.code), 503);
  assert.ok((HOST_ERROR_CODES as readonly string[]).includes('browser_budget_exhausted'), 'the bridge accepts it as a host error');
  assert.deepEqual(httpFailure(new Error('internal detail')), { code: 'mirror_unavailable', message: 'Session request could not be completed' });
});

// contract-late-grant-burns-slot, effects-3: a slot granted late in the launch bound launched with a
// few milliseconds, failed as a launch timeout and held the slot for 35 s.
test('a mirror start\'s slot wait ends while the launch still has its reserve; a later slot is not taken', async t => {
  const ledger = new BrowserLedger(1), holder = await ledger.reserve('render-check', { waitMs: 1 }), fake = fakeChromium();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let outcome: unknown = 'pending';
  void startShell({ chromium: fake.chromium, ledger, launchMs: 8_000, launchContext: LAUNCH, origins: {} }, async () => {}).then(() => { outcome = 'started'; }, error => { outcome = error; });
  const result = (): unknown => outcome;
  await advance(t, () => result() !== 'pending', 3_500);
  assert.ok(result() instanceof BrowserBudgetError, `refused by name when only the launch's reserve (${LAUNCH_AFTER_WAIT_MS} ms) is left, not ${String(result())}`);
  assert.equal(fake.calls.length, 0, 'nothing was launched');
  await holder.close(); // The slot frees after the wait ended: it is not taken by the refused start.
  assert.deepEqual([ledger.unreleased(), ledger.records().some(record => record.launch === 'rejected')], [0, false], 'no slot held by a launch that could not finish');
});

// effects-4: a refused sandbox setting launched nothing but held a slot for 35 s.
test('a refused sandbox setting takes no slot', async () => {
  const ledger = new BrowserLedger(), env = { PRACTONAUT_CHROMIUM_SANDBOX: 'yes' };
  await assert.rejects(startBrowser('start-check', fakeChromium().chromium, () => ({}), { ledger, context: { env } }), /PRACTONAUT_CHROMIUM_SANDBOX must be "require" or unset/);
  await assert.rejects(startShell({ chromium: fakeChromium().chromium, ledger, launchContext: { ...LAUNCH, env }, origins: {} }, async () => {}), /PRACTONAUT_CHROMIUM_SANDBOX/);
  assert.deepEqual(ledger.records(), [], 'no entry, no slot');
});

// --- Re-review of PR #69 (Codex major): a stopped child start's failed cleanup was reported closed ---

test('a stopped child start: an expected abort is cancelled, a cleanup that did not close is failed', () => {
  const cleanupFailed = Object.defineProperty(new AdapterError('cancelled', 'stopped'), 'closeError', { value: Object.assign(new Error('EACCES: permission denied, unlink'), { code: 'EACCES' }), enumerable: false });
  assert.deepEqual(childStartOutcome(new AdapterError('cancelled', 'Engine initialization cancelled during launch')), { outcome: 'cancelled' });
  assert.equal(childStartOutcome(cleanupFailed).outcome, 'failed');
  assert.match(String((childStartOutcome(cleanupFailed) as { error?: unknown }).error), /EACCES/);
  const browserFailed = new AdapterInitializationError(new AdapterError('cancelled', 'stopped'), new Error('close failed'), [], 0, { outcome: 'failed', error: new Error('close failed') });
  assert.equal(childStartOutcome(browserFailed).outcome, 'failed');
  const browserAbandoned = new AdapterInitializationError(new AdapterError('cancelled', 'stopped'), undefined, [], 0, { outcome: 'abandoned' });
  assert.deepEqual(childStartOutcome(browserAbandoned), { outcome: 'abandoned' }, 'abandoned under the deadline handed down is no failure');
});

test('a parent\'s shutdown that stops a child whose credential cannot be removed is not reported clean', { skip: process.platform === 'win32' ? 'POSIX: the test makes the child\'s token directory read-only' : false }, async t => {
  const children = new ChildHosts(), assets = stubAssets();
  const parentTokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-parent-')), childTokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-child-'));
  t.after(() => { chmodSync(childTokens, 0o700); for (const directory of [childTokens, parentTokens, assets]) rmSync(directory, { recursive: true, force: true }); });
  const host = await startHost(world(), { seed: 1, mirror: 'off', assetDirectory: assets, tokenDirectory: parentTokens, childHosts: children });
  let waiting = false;
  // The child's session start waits for the parent's abort; by then its credential exists, and the
  // directory holding it has become read-only, so its start's cleanup cannot remove it (EACCES).
  const launched = children.launch(signal => startHost(world(), { seed: 1, assetDirectory: assets, tokenDirectory: childTokens, signal, controllerFactory: async (_value, options) => {
    waiting = true;
    return new Promise<never>((_, reject) => { (options as { signal: AbortSignal }).signal.addEventListener('abort', () => { chmodSync(childTokens, 0o500); reject(new AdapterError('cancelled', 'Engine initialization cancelled')); }, { once: true }); });
  } }), async () => 'started');
  launched.catch(() => undefined);
  for (let turn = 0; turn < 200 && !waiting; turn++) await sleep(5);
  assert.ok(waiting, 'the child is starting');
  await assert.rejects(host.close(performance.now() + 300), /could not be fully confirmed/, 'the failed cleanup of the stopped child is a failed step');
  chmodSync(childTokens, 0o700);
  assert.equal(readdirSync(childTokens).some(name => name.endsWith('.token')), true, 'the child\'s credential is still there: the failure is real');
});

// --- PR #69 at 6b83a89 (Codex major, partly resolved before): a cleanup that threw in an early child
// start was thrown in place of the start's error, so the parent's shutdown counted it as cancelled ---

const POSIX_ONLY = { skip: process.platform === 'win32' ? 'POSIX: the test makes the child\'s token directory read-only' : false };
/** A parent host, a child token directory and the child start under way when the parent closes. */
async function stoppedChildStart(t: TestContext, start: (signal: AbortSignal, childTokens: string, assets: string) => ReturnType<typeof startHost>, waiting: () => boolean): Promise<{ closing: Promise<void>; launched: Promise<unknown>; childTokens: string }> {
  const children = new ChildHosts(), assets = stubAssets();
  const parentTokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-parent-')), childTokens = mkdtempSync(join(realpathSync(tmpdir()), 'pn-close-child-'));
  t.after(() => { chmodSync(childTokens, 0o700); for (const directory of [childTokens, parentTokens, assets]) rmSync(directory, { recursive: true, force: true }); });
  const host = await startHost(world(), { seed: 1, mirror: 'off', assetDirectory: assets, tokenDirectory: parentTokens, childHosts: children });
  const launched = children.launch(signal => start(signal, childTokens, assets), async () => 'started');
  launched.catch(() => undefined);
  for (let turn = 0; turn < 400 && !waiting(); turn++) await sleep(5);
  assert.ok(waiting(), 'the child is starting');
  const closing = host.close(performance.now() + 300);
  closing.catch(() => undefined);
  return { closing, launched, childTokens };
}

test('a stopped child start whose diagnostics and then its credential removal fail is a failed step of the parent\'s shutdown', POSIX_ONLY, async t => {
  // A stand-in for the open of the child's diagnostics file only: it waits for the parent's shutdown,
  // then the child's token directory becomes read-only and the real open runs (EACCES); the start's
  // cleanup then cannot remove the credential either (EACCES).
  const realOpen = fsp.open.bind(fsp);
  let waiting = false, signal: AbortSignal | undefined;
  const standIn = test.mock.method(fsp, 'open', async (...args: Parameters<typeof fsp.open>) => {
    const path = String(args[0]);
    if (path.endsWith('.mirror.jsonl') && path.includes('pn-close-child-')) {
      waiting = true;
      if (!signal!.aborted) await new Promise(resolve => signal!.addEventListener('abort', resolve, { once: true }));
      chmodSync(path.slice(0, path.lastIndexOf('/')), 0o500);
    }
    return realOpen(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { standIn.mock.restore(); syncBuiltinESMExports(); });
  const { closing, launched, childTokens } = await stoppedChildStart(t, (stop, tokens, assets) => { signal = stop; return startHost(world(), { seed: 1, mirror: 'off', assetDirectory: assets, tokenDirectory: tokens, signal: stop }); }, () => waiting);
  await assert.rejects(closing, /could not be fully confirmed/, 'the credential the stopped start could not remove is a failed step, not a cancellation');
  await assert.rejects(launched, (error: unknown) => error instanceof Error && error.message === 'Private mirror diagnostic cannot be persisted' && /EACCES/.test(String((error as { closeError?: unknown }).closeError)), 'the start\'s own failure stays its error, with the removal\'s failure next to it');
  chmodSync(childTokens, 0o700);
  assert.deepEqual(readdirSync(childTokens).map(name => name.replace(/^session-\d+-[0-9a-f]+/, 'session')), ['session.token'], 'the credential is still there and no diagnostics file was made: the failure is real');
});

test('a stopped child start whose error cannot carry its cleanup\'s failure is still a failed step of the parent\'s shutdown', POSIX_ONLY, async t => {
  let waiting = false;
  const frozen = Object.freeze(new AdapterError('cancelled', 'Engine initialization cancelled'));
  const { closing, launched, childTokens } = await stoppedChildStart(t, (signal, tokens, assets) => startHost(world(), { seed: 1, assetDirectory: assets, tokenDirectory: tokens, signal, controllerFactory: async (_value, options) => {
    waiting = true;
    return new Promise<never>((_, reject) => { (options as { signal: AbortSignal }).signal.addEventListener('abort', () => { chmodSync(tokens, 0o500); reject(frozen); }, { once: true }); });
  } }), () => waiting);
  await assert.rejects(closing, /could not be fully confirmed/, 'the cleanup failure is not lost with a frozen error');
  await assert.rejects(launched, (error: unknown) => error instanceof StartCleanupFailed && error.failure === frozen && error.cause === frozen && JSON.stringify(((error as { closeError?: unknown }).closeError as AggregateError).errors.map((step: unknown) => (step as { code?: string }).code)) === '["EACCES","EACCES"]', 'the frozen error is the cause of the error that carries the cleanup\'s failures (diagnostics and credential, EACCES)');
  chmodSync(childTokens, 0o700);
  assert.equal(readdirSync(childTokens).some(name => name.endsWith('.token')), true, 'the child\'s credential is still there: the failure is real');
});

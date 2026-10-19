// PADR-0050, decisions 2, 3, 6 and 8: one close contract for every browser owner. A stand-in browser's
// close never settles (Playwright's close of a browser that is slow to exit); every owner's call comes
// back at its deadline with its own result and the outcome *abandoned*; the browser keeps its slot (and
// the shell its sink) until a close asked while it was connected fulfils. Every layer above passes its
// deadline down and reads the outcome: no outer timer turns an abandoned close into a failure.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserLedger } from '../../src/adapters/browser/ledger.ts';
import { CloseRequested, type CloseResult } from '../../src/adapters/browser/close.ts';
import { startShell, type BrowserShell } from '../../src/adapters/browser/shell.ts';
import { ADAPTER_REGISTRY, type AdapterRegistry } from '../../src/adapters/registry.ts';
import type { AdapterOptions, MirrorAdapter } from '../../src/adapters/types.ts';
import { renderCheck } from '../../src/adapters/excalidraw/render-check.ts';
import { renderCardPngs } from '../../src/bench/card-png.ts';
import { chromiumStarts } from '../../src/cli/browser-start.ts';
import { createProductionMirror, type PracticeMirror } from '../../src/host/mirror.ts';
import { createPracticeController, type BrowserCloseDiagnostic } from '../../src/host/session.ts';
import { startHost } from '../../src/host/server.ts';
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

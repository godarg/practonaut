// PADR-0045: the shared browser shell, against a fake Playwright (the real one is covered by the
// adapter conformance suite and the host-mirror integration tests). Launch deadline, abort during
// start, fail-closed routing, transaction rollback without a late-write race, capture and hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, LaunchOptions } from 'playwright-core';
import { BrowserDeadlineError } from '../../src/adapters/browser/bounded.ts';
import { AdapterError, AdapterInitializationError, artifactOf, capturePng, serialQueue, startShell, type BrowserShell, type SceneIO, type ShellOptions } from '../../src/adapters/browser/shell.ts';
import type { AdapterResult } from '../../src/adapters/types.ts';

/** A page holds one scene; a closed page refuses every later write, as a closed Playwright page does. */
class FakePage {
  closed = false; scene: string[] = []; shots: unknown[] = [];
  write(scene: string[]): void { if (this.closed) throw new Error('Target page, context or browser has been closed'); this.scene = [...scene]; }
  async close(): Promise<void> { this.closed = true; }
  async screenshot(options: unknown): Promise<Buffer> { this.shots.push(options); return Buffer.from([137, 80, 78, 71]); }
}
type Handler = (route: unknown) => Promise<void>;
class FakeContext {
  pages: FakePage[] = []; handler: Handler | undefined; newContextGate: Promise<void> | undefined;
  async route(_pattern: string, handler: Handler): Promise<void> { this.handler = handler; }
  async newPage(): Promise<FakePage> { const page = new FakePage(); this.pages.push(page); return page; }
}
class FakeBrowser {
  closed = 0; context = new FakeContext(); contextGate: Promise<void> | undefined;
  async newContext(): Promise<FakeContext> { if (this.contextGate) await this.contextGate; return this.context; }
  async close(): Promise<void> { this.closed++; }
}
/** A chromium whose launch resolves when `release` is called (or at once). */
function fakeChromium(immediate = true) {
  const browser = new FakeBrowser(); let release: (() => void) | undefined; const calls: LaunchOptions[] = [];
  const gate = immediate ? Promise.resolve() : new Promise<void>(resolve => { release = resolve; });
  return { browser, calls, release: () => release?.(), chromium: { launch: async (options: LaunchOptions = {}): Promise<Browser> => { calls.push(options); await gate; return browser as unknown as Browser; } } };
}
const SANDBOX = { env: {}, platform: 'darwin' as const, memo: { unavailable: false } };
const base = (chromium: NonNullable<ShellOptions['chromium']>, extra: Partial<ShellOptions> = {}): ShellOptions => ({ chromium, launchContext: { ...SANDBOX, memo: { unavailable: false } }, origins: {}, ...extra });
const tick = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test('the shell bounds the launch itself and closes a browser that arrives after the deadline', { timeout: 5_000 }, async () => {
  const fake = fakeChromium(false);
  const started = performance.now();
  await assert.rejects(startShell(base(fake.chromium, { launchMs: 50 }), async () => {}), (error: unknown) => error instanceof BrowserDeadlineError);
  assert.ok(performance.now() - started < 2_000, 'refused at the deadline, not when the launch ends');
  assert.equal(fake.browser.closed, 0);
  fake.release(); await tick(10);
  assert.equal(fake.browser.closed, 1, 'the late browser belongs to nobody and is closed');
  assert.equal(fake.calls[0]!.chromiumSandbox, true, 'the one Chromium start (PADR-0032) asks for the sandbox');
});

test('an abort during the launch settles at once and closes the late browser', { timeout: 5_000 }, async () => {
  const fake = fakeChromium(false), controller = new AbortController();
  const starting = startShell(base(fake.chromium, { signal: controller.signal }), async () => {});
  await tick(10); controller.abort();
  await assert.rejects(starting, (error: unknown) => error instanceof AdapterError && error.code === 'cancelled');
  fake.release(); await tick(10);
  assert.equal(fake.browser.closed, 1);
});

test('an abort during initialisation closes the browser and reports the pending start operation', { timeout: 5_000 }, async () => {
  const fake = fakeChromium(), controller = new AbortController();
  fake.browser.contextGate = new Promise(() => {}); // newContext never answers
  const starting = startShell(base(fake.chromium, { signal: controller.signal }), async () => {});
  await tick(10); controller.abort();
  await assert.rejects(starting, (error: unknown) => error instanceof AdapterInitializationError && error.code === 'cancelled' && error.pendingInitializationOperations === 1);
  assert.equal(fake.browser.closed, 1);
});

test('a failure in the adapter\'s own start closes the browser and keeps the refused requests', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  await assert.rejects(startShell(base(fake.chromium), async shell => {
    await fake.browser.context.handler!(route('https://cdn.example/font.woff2').route);
    assert.deepEqual(shell.networkAttempts(), ['https://cdn.example/font.woff2']);
    throw new Error('engine did not load');
  }), (error: unknown) => error instanceof AdapterInitializationError && error.code === 'mirror_unavailable' && error.networkAttempts.length === 1);
  assert.equal(fake.browser.closed, 1);
});

function route(url: string) {
  const record = { aborted: 0, fulfilled: undefined as undefined | { body: unknown; contentType: string } };
  return { record, route: { request: () => ({ url: () => url }), abort: async () => { record.aborted++; }, fulfill: async (answer: { body: unknown; contentType: string }) => { record.fulfilled = answer; } } };
}

test('routing answers only named origins and served safe paths; everything else is aborted and recorded', { timeout: 5_000 }, async () => {
  const fake = fakeChromium(), served: string[] = [];
  const shell = await startShell(base(fake.chromium, { origins: { 'http://app.invalid': async path => { served.push(path); return path === '/engine.js' ? { body: 'code', contentType: 'text/javascript' } : undefined; } } }), async () => {});
  const send = async (url: string) => { const r = route(url); await fake.browser.context.handler!(r.route); return r.record; };
  const ok = await send('http://app.invalid/engine.js');
  assert.deepEqual(ok.fulfilled, { body: 'code', contentType: 'text/javascript' }); assert.equal(ok.aborted, 0);
  const refused = ['https://example.com/x', 'http://app.invalid:8080/engine.js', 'http://other.invalid/engine.js', 'http://app.invalid/%2e%2e%2fsecret', 'http://app.invalid/a%20b.js', 'http://app.invalid/missing.js', 'http://app.invalid/%E0%A4%A'];
  for (const url of refused) { const r = await send(url); assert.equal(r.aborted, 1, url); assert.equal(r.fulfilled, undefined, url); }
  assert.deepEqual(shell.networkAttempts(), refused);
  assert.deepEqual(served, ['/engine.js', '/missing.js'], 'unsafe paths and foreign origins never reach the adapter');
});

/** The adapter's scene I/O on whatever page is current, as the Excalidraw adapter does. */
function sceneOf(shell: () => BrowserShell): SceneIO<string[]> {
  const page = (): FakePage => shell().page as unknown as FakePage;
  return { read: async () => [...page().scene], write: async scene => page().write(scene), load: async scene => page().write(scene) };
}
const ok = (scene: string[]): AdapterResult => ({ ok: true, state: { objects: {} }, warnings: [scene.join(',')] });

test('a timed-out write restores the committed scene on a fresh page; its late write cannot race the rollback', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const scene = sceneOf(() => shell), serial = serialQueue();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let lateWrite: unknown = 'not attempted';
  // A write whose JS reply arrives late: it captured the page it started on.
  const slow = serial(() => shell.transaction(async () => {
    const page = shell.page as unknown as FakePage; await gate;
    try { page.write(['late']); lateWrite = 'landed'; } catch (error) { lateWrite = error; }
    return ok(page.scene);
  }, scene, { timeoutMs: 30 }));
  let seen: string[] | undefined;
  const next = serial(() => shell.transaction(async () => { seen = await scene.read(); await scene.write(['next']); return ok(['next']); }, scene, { timeoutMs: 1_000 }));
  const timedOut = await slow;
  assert.equal(timedOut.ok, false); if (!timedOut.ok) assert.equal(timedOut.error.code, 'mirror_timeout');
  assert.equal(fake.browser.context.pages.length, 2, 'the page was replaced'); assert.equal(fake.browser.context.pages[0]!.closed, true);
  release(); await next; await tick(10);
  assert.deepEqual(seen, ['committed'], 'the queued write saw the restored scene, after the rollback');
  assert.ok(lateWrite instanceof Error, 'the late write hit the closed page');
  assert.deepEqual((shell.page as unknown as FakePage).scene, ['next']);
});

test('a write that answers with a failure is undone in place; an abort replaces the page', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const scene = sceneOf(() => shell);
  const refused = await shell.transaction(async () => { await scene.write(['wrong']); return { ok: false, error: { code: 'real_tool_disagrees', message: 'read-back differs', details: {} } }; }, scene, { timeoutMs: 1_000 });
  assert.equal(refused.ok, false); assert.equal(fake.browser.context.pages.length, 1);
  assert.deepEqual((shell.page as unknown as FakePage).scene, ['committed']);
  const controller = new AbortController();
  const pending = shell.transaction(async () => { await scene.write(['half']); await new Promise(() => {}); return ok([]); }, scene, { timeoutMs: 1_000, signal: controller.signal });
  await tick(10); controller.abort();
  const cancelled = await pending;
  assert.equal(cancelled.ok, false); if (!cancelled.ok) assert.equal(cancelled.error.code, 'cancelled');
  assert.equal(fake.browser.context.pages.length, 2); assert.deepEqual((shell.page as unknown as FakePage).scene, ['committed']);
  const aborted = new AbortController(); aborted.abort();
  const before = await shell.transaction(async () => ok([]), scene, { timeoutMs: 1_000, signal: aborted.signal });
  assert.equal(before.ok, false); if (!before.ok) assert.equal(before.error.code, 'cancelled');
});

test('a guarded read rebuilds the scene and rethrows on timeout', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const scene = sceneOf(() => shell);
  await assert.rejects(shell.guarded(() => new Promise(() => {}), scene, { timeoutMs: 20 }, { timeout: () => new AdapterError('mirror_timeout', 'Export time limit reached'), cancel: () => new AdapterError('cancelled', 'Export cancelled') }), (error: unknown) => error instanceof AdapterError && error.code === 'mirror_timeout');
  assert.equal(fake.browser.context.pages.length, 2); assert.deepEqual((shell.page as unknown as FakePage).scene, ['committed']);
});

test('the artifact carries the SHA-256 of each form; PNG capture is bounded', async () => {
  // FIPS 180-2 test vectors, not the code under test.
  const artifact = artifactOf('abc', '');
  assert.equal(artifact.nativeSha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(artifact.svgSha256, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  const page = new FakePage();
  const png = await capturePng(page as never);
  assert.ok(png instanceof Uint8Array); assert.deepEqual([...png], [137, 80, 78, 71]);
  assert.deepEqual(page.shots, [{ type: 'png', timeout: 10_000 }]);
});

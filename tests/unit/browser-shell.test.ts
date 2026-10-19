// PADR-0045: the shared browser shell, against a fake Playwright (the real one is covered by the
// adapter conformance suite and the host-mirror integration tests). Launch deadline, abort during
// start, fail-closed routing, transaction rollback without a late-write race, capture and hashes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import type { Browser, LaunchOptions } from 'playwright-core';
import { BrowserDeadlineError, closeBrowser } from '../../src/adapters/browser/bounded.ts';
import { AdapterError, AdapterInitializationError, artifactOf, capturePng, serialQueue, startShell, type BrowserShell, type SceneIO, type ShellOptions } from '../../src/adapters/browser/shell.ts';
import type { AdapterResult } from '../../src/adapters/types.ts';
import { BrowserLedger } from '../../src/adapters/browser/ledger.ts';

/** A page holds one scene; a closed page refuses every later write, as a closed Playwright page does. */
class FakePage {
  closed = false; scene: string[] = []; shots: unknown[] = [];
  write(scene: string[]): void { if (this.closed) throw new Error('Target page, context or browser has been closed'); this.scene = [...scene]; }
  async close(): Promise<void> { this.closed = true; }
  async screenshot(options: unknown): Promise<Buffer> { this.shots.push(options); return Buffer.from([137, 80, 78, 71]); }
}
type Handler = (route: unknown) => Promise<void>;
class FakeContext {
  pages: FakePage[] = []; handler: Handler | undefined; socketHandler: Handler | undefined; socketMatcher: ((url: URL) => boolean) | undefined;
  /** A setup call that never answers, as a browser that stops replying would. */
  hang: 'route' | 'routeWebSocket' | undefined;
  async route(_pattern: string, handler: Handler): Promise<void> { if (this.hang === 'route') await new Promise(() => {}); this.handler = handler; }
  async routeWebSocket(matcher: (url: URL) => boolean, handler: Handler): Promise<void> { if (this.hang === 'routeWebSocket') await new Promise(() => {}); this.socketMatcher = matcher; this.socketHandler = handler; }
  /** A first newPage call that waits for this gate (used once). */
  newPageGate: Promise<void> | undefined;
  async newPage(): Promise<FakePage> { const gate = this.newPageGate; this.newPageGate = undefined; if (gate) await gate; const page = new FakePage(); this.pages.push(page); return page; }
}
/** Connected until its close, as Playwright's client reports it (the ledger proves an end only for a
 * close asked while connected, PADR-0050). */
class FakeBrowser {
  closed = 0; context = new FakeContext(); contextGate: Promise<void> | undefined; connected = true;
  async newContext(): Promise<FakeContext> { if (this.contextGate) await this.contextGate; return this.context; }
  async close(): Promise<void> { this.closed++; this.connected = false; }
  isConnected(): boolean { return this.connected; }
  on(): this { return this; }
}
/** A chromium whose launch resolves when `release` is called (or at once). */
function fakeChromium(immediate = true) {
  const browser = new FakeBrowser(); let release: (() => void) | undefined; const calls: LaunchOptions[] = [];
  const gate = immediate ? Promise.resolve() : new Promise<void>(resolve => { release = resolve; });
  return { browser, calls, release: () => release?.(), chromium: { launch: async (options: LaunchOptions = {}): Promise<Browser> => { calls.push(options); await gate; return browser as unknown as Browser; } } };
}
const SANDBOX = { env: {}, platform: 'darwin' as const, memo: { unavailable: false } };
// Each shell takes its slot from a ledger of its own, so the tests' browsers never fill the process's.
const base = (chromium: NonNullable<ShellOptions['chromium']>, extra: Partial<ShellOptions> = {}): ShellOptions => ({ chromium, launchContext: { ...SANDBOX, memo: { unavailable: false } }, origins: {}, ledger: new BrowserLedger(), ...extra });
const tick = (ms = 0): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Issue #64: the CI log said only "Browser operation exceeded its deadline"; which bound it was had
// to be worked out from test durations. Graceful 3 s plus forced 5 s is the close budget of the
// browser (archived PADR-0027); the clock is Node's mock, so nothing waits 8 s.
test('a browser close that does not finish fails at 8 s and names the close and its bound', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled: unknown = 'pending';
  const outcome = (): unknown => settled;
  void closeBrowser({ close: () => new Promise<void>(() => {}) }).then(() => { settled = 'closed'; }, error => { settled = error; });
  t.mock.timers.tick(7_999); await new Promise(done => setImmediate(done));
  assert.equal(outcome(), 'pending');
  t.mock.timers.tick(1); await new Promise(done => setImmediate(done));
  const error = outcome();
  assert.ok(error instanceof BrowserDeadlineError);
  assert.deepEqual([error.operation, error.ms, error.message], ['close', 8_000, 'Browser close exceeded its deadline of 8000 ms']);
});

test('the shell bounds the launch itself and closes a browser that arrives after the deadline', { timeout: 5_000 }, async () => {
  const fake = fakeChromium(false);
  const started = performance.now();
  await assert.rejects(startShell(base(fake.chromium, { launchMs: 50 }), async () => {}), (error: unknown) => error instanceof BrowserDeadlineError && error.operation === 'launch');
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

function route(url: string, method = 'GET', body: string | null = null) {
  const record = { aborted: 0, fulfilled: undefined as undefined | { body: unknown; contentType?: string; status?: number; headers?: Record<string, string> } };
  return { record, route: { request: () => ({ url: () => url, method: () => method, postData: () => body }), abort: async () => { record.aborted++; }, fulfill: async (answer: { body: unknown; contentType?: string; status?: number; headers?: Record<string, string> }) => { record.fulfilled = answer; } } };
}
// Hand-written expectation (PADR-0045): hosts limited to the named origin, local URLs allowed,
// violations reported to the shell's own path on that origin.
const POLICY = "default-src http://app.invalid data: blob: 'unsafe-inline' 'unsafe-eval'; report-uri http://app.invalid/__practonaut/policy-report";

test('routing answers only named origins and served safe paths; everything else is aborted and recorded', { timeout: 5_000 }, async () => {
  const fake = fakeChromium(), served: string[] = [];
  const shell = await startShell(base(fake.chromium, { origins: { 'http://app.invalid': async path => { served.push(path); return path === '/engine.js' ? { body: 'code', contentType: 'text/javascript' } : undefined; } } }), async () => {});
  const send = async (url: string) => { const r = route(url); await fake.browser.context.handler!(r.route); return r.record; };
  const ok = await send('http://app.invalid/engine.js');
  assert.deepEqual(ok.fulfilled, { body: 'code', contentType: 'text/javascript', headers: { 'Content-Security-Policy': POLICY, 'X-DNS-Prefetch-Control': 'off' } }); assert.equal(ok.aborted, 0);
  const refused = ['https://example.com/x', 'http://app.invalid:8080/engine.js', 'http://other.invalid/engine.js', 'http://app.invalid/%2e%2e%2fsecret', 'http://app.invalid/a%20b.js', 'http://app.invalid/missing.js', 'http://app.invalid/%E0%A4%A'];
  for (const url of refused) { const r = await send(url); assert.equal(r.aborted, 1, url); assert.equal(r.fulfilled, undefined, url); }
  assert.deepEqual(shell.networkAttempts(), refused);
  assert.deepEqual(served, ['/engine.js', '/missing.js'], 'unsafe paths and foreign origins never reach the adapter');
});

test('every WebSocket is closed and recorded; policy violations reported to the shell are recorded', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium, { origins: { 'http://app.invalid': async () => undefined } }), async () => {});
  for (const url of ['wss://example.org/socket', 'ws://app.invalid/socket']) assert.equal(fake.browser.context.socketMatcher!(new URL(url)), true, url);
  let closed = 0;
  await fake.browser.context.socketHandler!({ url: () => 'wss://example.org/socket', close: async () => { closed++; } });
  assert.equal(closed, 1);
  const report = route('http://app.invalid/__practonaut/policy-report', 'POST', JSON.stringify({ 'csp-report': { 'effective-directive': 'connect-src', 'blocked-uri': 'https://example.org/beacon' } }));
  await fake.browser.context.handler!(report.route);
  assert.equal(report.record.fulfilled?.status, 204); assert.equal(report.record.aborted, 0);
  const garbled = route('http://app.invalid/__practonaut/policy-report', 'POST', 'not json');
  await fake.browser.context.handler!(garbled.route);
  // The report path answers reports only; any other use of it is an ordinary refused request.
  const asked = route('http://app.invalid/__practonaut/policy-report');
  await fake.browser.context.handler!(asked.route); assert.equal(asked.record.aborted, 1);
  assert.deepEqual(shell.networkAttempts(), ['wss://example.org/socket', 'policy:connect-src:https://example.org/beacon', 'policy:unreadable', 'http://app.invalid/__practonaut/policy-report']);
});

test('the adapter\'s own start is bounded: a start that never finishes closes the browser at its deadline', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  await assert.rejects(startShell(base(fake.chromium, { initializeMs: 50 }), () => new Promise<void>(() => {})), (error: unknown) => error instanceof AdapterInitializationError && error.primaryError instanceof BrowserDeadlineError && error.primaryError.operation === 'start');
  assert.equal(fake.browser.closed, 1);
});

test('an abort is never lost: during the committed-scene read, or raised by the work itself before it hangs', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const page = (): FakePage => shell.page as unknown as FakePage;
  const duringRead = new AbortController(); let ran = false;
  const scene: SceneIO<string[]> = { read: async () => { duringRead.abort(); return [...page().scene]; }, write: async s => page().write(s), load: async s => page().write(s) };
  const refused = await shell.transaction(async () => { ran = true; page().write(['written']); return ok([]); }, scene, { timeoutMs: 1_000, signal: duringRead.signal });
  assert.equal(refused.ok, false); if (!refused.ok) assert.equal(refused.error.code, 'cancelled');
  assert.equal(ran, false, 'an aborted write never starts'); assert.deepEqual(page().scene, ['committed']);
  const inside = new AbortController();
  const hanging = await shell.transaction(() => { inside.abort(); return new Promise<AdapterResult>(() => {}); }, sceneOf(() => shell), { timeoutMs: 200, signal: inside.signal });
  assert.equal(hanging.ok, false); if (!hanging.ok) assert.equal(hanging.error.code, 'cancelled', 'the abort, not the later timeout');
});

test('a routing setup that never answers is bounded by the launch deadline and closes the browser', { timeout: 5_000 }, async () => {
  for (const hang of ['route', 'routeWebSocket'] as const) {
    const fake = fakeChromium(); fake.browser.context.hang = hang;
    await assert.rejects(startShell(base(fake.chromium, { launchMs: 100, initializeMs: 100 }), async () => {}), (error: unknown) => error instanceof AdapterInitializationError && error.primaryError instanceof BrowserDeadlineError && error.primaryError.operation === 'setup', hang);
    assert.equal(fake.browser.closed, 1, hang);
  }
});

/** A client of the sink: what it was answered, and when its connection closed. */
function askSink(port: number, request: string, keepSending = false): Promise<{ reply: string; closedAfterMs: number }> {
  return new Promise((resolve, reject) => {
    const started = performance.now(); let reply = '', pump: ReturnType<typeof setInterval> | undefined;
    // Half-open allowed: the client keeps sending after the sink's answer, as a hostile one would.
    const socket = connect({ port, host: '127.0.0.1', allowHalfOpen: true }, () => {
      socket.write(request);
      if (keepSending) pump = setInterval(() => { if (!socket.destroyed) socket.write(Buffer.alloc(64 * 1024, 120)); }, 5);
    });
    socket.on('data', chunk => { reply += chunk.toString(); });
    socket.on('error', () => undefined);
    const limit = setTimeout(() => { clearInterval(pump); socket.destroy(); reject(new Error('the sink kept the connection open')); }, 3_000);
    socket.on('close', () => { clearInterval(pump); clearTimeout(limit); resolve({ reply, closedAfterMs: performance.now() - started }); });
  });
}

test('the sink proxy refuses every connection, reads and records nothing, and a foreign client cannot disable the shell', { timeout: 10_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const launched = fake.calls[0]!;
  assert.equal(launched.proxy?.bypass, '<-loopback>', 'the loopback interface is proxied too');
  assert.ok(launched.args?.includes('--force-webrtc-ip-handling-policy=disable_non_proxied_udp'));
  assert.ok(launched.args?.includes('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'));
  const sink = new URL(launched.proxy!.server);
  assert.equal(sink.hostname, '127.0.0.1');
  const port = Number(sink.port);
  // What the browser sends (a TURN connection, a preconnect) and what any other local process can,
  // down to a client that sends nothing and stays half-open: each is answered and closed. (A peer
  // that left nothing unread is closed with a FIN that a half-open client may ignore, on every
  // platform; with unread data, Windows ignores it too. Only a reset closes such a client.)
  const requests = ['CONNECT turn.example:3478 HTTP/1.1\r\nHost: turn.example:3478\r\n\r\n', 'GET http://user:secret@blocked.invalid/x?token=SECRET HTTP/1.1\r\n\r\n', 'GET / HTTP/1.1\r\n\r\n', 'not http at all\r\n', ''];
  for (const [index, answer] of (await Promise.all(requests.map(request => askSink(port, request)))).entries()) {
    assert.match(answer.reply, /^HTTP\/1\.1 403 Forbidden/, JSON.stringify(requests[index]));
    assert.ok(answer.closedAfterMs < 2_000, `${JSON.stringify(requests[index])} closed after ${answer.closedAfterMs} ms`);
  }
  // A client that never stops sending is answered and closed, not buffered.
  const flood = await askSink(port, 'CONNECT flood.example:443 HTTP/1.1\r\n', true);
  assert.match(flood.reply, /^HTTP\/1\.1 403/); assert.ok(flood.closedAfterMs < 2_000, `closed after ${flood.closedAfterMs} ms`);
  await Promise.all(Array.from({ length: 20 }, () => askSink(port, 'GET / HTTP/1.1\r\n\r\n')));
  assert.deepEqual(shell.networkAttempts(), [], 'no connection to the sink becomes a record of the shell');
  const scene = sceneOf(() => shell);
  assert.equal((await shell.transaction(async () => { await scene.write(['next']); return ok([]); }, scene, { timeoutMs: 1_000 })).ok, true, 'the shell still works');
  await shell.close();
  await assert.rejects(askSink(port, 'CONNECT x.example:1 HTTP/1.1\r\n\r\n').then(answer => { if (!answer.reply) throw new Error('refused'); return answer; }), 'the sink is gone with the shell');
});

test('a fresh page an ended operation was still waiting for is closed, never published', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const scene = sceneOf(() => shell);
  let release!: () => void; fake.browser.context.newPageGate = new Promise<void>(resolve => { release = resolve; });
  let late: unknown = 'not attempted';
  const timedOut = await shell.transaction(async () => {
    try { (await shell.freshPage() as unknown as FakePage).write(['late']); late = 'landed'; } catch (error) { late = error; }
    return ok([]);
  }, scene, { timeoutMs: 30 });
  assert.equal(timedOut.ok, false); if (!timedOut.ok) assert.equal(timedOut.error.code, 'mirror_timeout');
  release(); await tick(10);
  assert.ok(late instanceof AdapterError && late.code === 'cancelled', String(late));
  const pages = fake.browser.context.pages;
  assert.deepEqual((shell.page as unknown as FakePage).scene, ['committed'], 'the rebuilt page stays current');
  assert.equal(pages.at(-1)!.closed, true, 'the late page was closed');
});

test('a committed-scene read that outlives its deadline can do nothing further in the shell', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const page = (): FakePage => shell.page as unknown as FakePage;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let lateRead: unknown = 'not attempted';
  const gated: SceneIO<string[]> = {
    read: async () => { const scene = [...page().scene]; await gate; try { (await shell.freshPage() as unknown as FakePage).write(['late-read']); lateRead = 'ran'; } catch (error) { lateRead = error; } return scene; },
    write: async s => page().write(s), load: async s => page().write(s),
  };
  const timedOut = await shell.transaction(async () => ok([]), gated, { timeoutMs: 30 });
  assert.equal(timedOut.ok, false); if (!timedOut.ok) assert.equal(timedOut.error.code, 'mirror_timeout');
  release(); await tick(10);
  assert.ok(lateRead instanceof AdapterError && lateRead.code === 'cancelled', String(lateRead));
  assert.equal(fake.browser.context.pages.length, 1); assert.deepEqual(page().scene, ['committed']);
});

test('the undo of a failed result is bounded: when it does not finish, the rebuild takes over or the shell closes', { timeout: 5_000 }, async () => {
  for (const loadHangs of [false, true]) {
    const fake = fakeChromium();
    const shell = await startShell(base(fake.chromium, { initializeMs: 50 }), async started => { (started.page as unknown as FakePage).write(['committed']); });
    const current = (): FakePage => fake.browser.context.pages.at(-1)!;
    const scene: SceneIO<string[]> = { read: async () => [...current().scene], write: () => new Promise(() => {}), load: async s => { if (loadHangs) await new Promise(() => {}); current().write(s); } };
    const refused: AdapterResult = { ok: false, error: { code: 'real_tool_disagrees', message: 'read-back differs', details: {} } };
    const result = await shell.transaction(async () => { current().write(['wrong']); return refused; }, scene, { timeoutMs: 1_000 });
    if (!loadHangs) {
      assert.deepEqual(result, refused, 'the work\'s own answer');
      assert.equal(fake.browser.context.pages.length, 2); assert.deepEqual(current().scene, ['committed']);
    } else {
      assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'mirror_unavailable');
      assert.ok(fake.browser.closed >= 1);
    }
  }
});

test('a committed-scene read that never answers is bounded by the operation\'s deadline and its abort', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  let ran = false;
  const stuck: SceneIO<string[]> = { read: () => new Promise(() => {}), write: async () => {}, load: async () => {} };
  const timedOut = await shell.transaction(async () => { ran = true; return ok([]); }, stuck, { timeoutMs: 30 });
  assert.equal(timedOut.ok, false); if (!timedOut.ok) assert.equal(timedOut.error.code, 'mirror_timeout');
  const controller = new AbortController(); setTimeout(() => controller.abort(), 20);
  const aborted = await shell.transaction(async () => { ran = true; return ok([]); }, stuck, { timeoutMs: 1_000, signal: controller.signal });
  assert.equal(aborted.ok, false); if (!aborted.ok) assert.equal(aborted.error.code, 'cancelled');
  await assert.rejects(shell.guarded(async () => 'read', stuck, { timeoutMs: 30 }, { timeout: () => new AdapterError('mirror_timeout', 'late'), cancel: () => new AdapterError('cancelled', 'cancelled') }), (error: unknown) => error instanceof AdapterError && error.code === 'mirror_timeout');
  // A read the browser itself fails (a crashed page) is not a deadline: it fails the call, as before.
  const crashed: SceneIO<string[]> = { read: async () => { throw new Error('Target crashed'); }, write: async () => {}, load: async () => {} };
  await assert.rejects(shell.transaction(async () => { ran = true; return ok([]); }, crashed, { timeoutMs: 1_000 }), /Target crashed/);
  assert.equal(ran, false, 'nothing is written without the committed scene');
  assert.deepEqual((shell.page as unknown as FakePage).scene, ['committed'], 'and the scene is as it was');
  assert.equal(fake.browser.context.pages.length, 1, 'no page was replaced');
});

test('a rebuild that never finishes is bounded, closes the shell, and every later call answers mirror_unavailable', { timeout: 5_000 }, async () => {
  for (const kind of ['transaction', 'guarded'] as const) {
    const fake = fakeChromium();
    const shell = await startShell(base(fake.chromium, { initializeMs: 50 }), async started => { (started.page as unknown as FakePage).write(['committed']); });
    const page = (): FakePage => fake.browser.context.pages.at(-1)!;
    const stuckLoad: SceneIO<string[]> = { read: async () => [...page().scene], write: async s => page().write(s), load: () => new Promise(() => {}) };
    if (kind === 'transaction') {
      const lost = await shell.transaction(() => new Promise<AdapterResult>(() => {}), stuckLoad, { timeoutMs: 20 });
      assert.equal(lost.ok, false, kind); if (!lost.ok) assert.equal(lost.error.code, 'mirror_unavailable', kind);
      const after = await shell.transaction(async () => ok([]), stuckLoad, { timeoutMs: 1_000 }).catch((error: unknown) => error);
      assert.ok(after instanceof AdapterError && after.code === 'mirror_unavailable', `${kind}: ${String(after)}`);
    } else {
      await assert.rejects(shell.guarded(() => new Promise(() => {}), stuckLoad, { timeoutMs: 20 }, { timeout: () => new AdapterError('mirror_timeout', 'late'), cancel: () => new AdapterError('cancelled', 'cancelled') }), (error: unknown) => error instanceof AdapterError && error.code === 'mirror_unavailable');
    }
    assert.ok(fake.browser.closed >= 1, `${kind}: the browser is closed`);
    await assert.rejects(shell.wait(async () => 'x'), (error: unknown) => error instanceof AdapterError && error.code === 'mirror_unavailable', kind);
    assert.throws(() => shell.page, (error: unknown) => error instanceof AdapterError && error.code === 'mirror_unavailable', kind);
  }
});

test('an ended operation cannot act on the page that replaced its own', { timeout: 5_000 }, async () => {
  const fake = fakeChromium();
  const shell = await startShell(base(fake.chromium), async started => { (started.page as unknown as FakePage).write(['committed']); });
  const scene = sceneOf(() => shell);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let lateWrite: unknown = 'not attempted';
  // Unlike the test above, the late step looks the page up again, as the Excalidraw adapter does.
  const timedOut = await shell.transaction(async () => {
    await gate;
    try { await scene.write(['late']); lateWrite = 'landed'; } catch (error) { lateWrite = error; }
    return ok([]);
  }, scene, { timeoutMs: 30 });
  assert.equal(timedOut.ok, false);
  release(); await tick(10);
  assert.ok(lateWrite instanceof AdapterError && lateWrite.code === 'cancelled', String(lateWrite));
  assert.deepEqual((shell.page as unknown as FakePage).scene, ['committed']);
  // The same for a guarded read whose continuation outlives its deadline.
  let release2!: () => void; const gate2 = new Promise<void>(resolve => { release2 = resolve; }); let lateRead: unknown;
  await assert.rejects(shell.guarded(async () => { await gate2; try { await shell.wait(async () => 'read'); lateRead = 'ran'; } catch (error) { lateRead = error; } }, scene, { timeoutMs: 30 }, { timeout: () => new AdapterError('mirror_timeout', 'late'), cancel: () => new AdapterError('cancelled', 'cancelled') }));
  release2(); await tick(10);
  assert.ok(lateRead instanceof AdapterError, String(lateRead));
  // Every other way back into the shell is refused to it as well: a fresh page, the browser, a new
  // operation, closing the shell.
  let release3!: () => void; const gate3 = new Promise<void>(resolve => { release3 = resolve; });
  const attempts: Record<string, unknown> = {};
  await shell.transaction(async () => {
    await gate3;
    for (const [name, attempt] of Object.entries({
      freshPage: async () => { (await shell.freshPage() as unknown as FakePage).write(['late']); },
      browser: async () => shell.browser,
      transaction: () => shell.transaction(async () => { await scene.write(['late']); return ok([]); }, scene, { timeoutMs: 1_000 }),
      close: () => shell.close(),
    })) { try { await attempt(); attempts[name] = 'ran'; } catch (error) { attempts[name] = error instanceof AdapterError ? error.code : String(error); } }
    return ok([]);
  }, scene, { timeoutMs: 30 });
  release3(); await tick(10);
  assert.deepEqual(attempts, { freshPage: 'cancelled', browser: 'cancelled', transaction: 'cancelled', close: 'cancelled' });
  assert.equal(fake.browser.closed, 0);
  assert.deepEqual((shell.page as unknown as FakePage).scene, ['committed']);
  // Work outside any operation, and a later operation, still act normally.
  assert.equal(await shell.wait(async () => 'free'), 'free');
  assert.equal((await shell.transaction(async () => { await scene.write(['next']); return ok([]); }, scene, { timeoutMs: 1_000 })).ok, true);
  assert.deepEqual((shell.page as unknown as FakePage).scene, ['next']);
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

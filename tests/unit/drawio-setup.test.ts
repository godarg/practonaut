// PADR-0049 decision 2: the opt-in draw.io download and the kept runtime. A stand-in HTTP server on
// 127.0.0.1 serves a small fixture under an injected pin (never the real one); the allowed schemes are
// a named seam (`http:` here, exactly `https:` in the product). Every negative case asserts its reason
// by name, so none passes for another reason. Expected hashes come from node:crypto over the fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DrawioInstallError, INSTALL_LIMITS, installDrawio, installDrawioFrom, PRODUCT_SCHEMES, type InstallOptions, type InstallPin } from '../../src/adapters/drawio/download.ts';
import { DrawioRuntimeError, drawioRuntimeDirectory, drawioRuntimePath, readDrawioRuntime } from '../../src/adapters/drawio/runtime.ts';
import { DRAWIO_PIN } from '../../src/adapters/drawio/pin.ts';

const fixture = randomBytes(64 * 1024);
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
type Handler = (request: IncomingMessage, response: ServerResponse, port: number) => void;
async function standIn(handler: Handler): Promise<{ origin: string; close(): Promise<void> }> {
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((request, response) => handler(request, response, (server.address() as { port: number }).port));
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise<void>(done => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }) };
}
const serveFixture = (response: ServerResponse, body: Buffer = fixture): void => { response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length }); response.end(body); };
const home = (): string => mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-setup-'));
const fast = { connectMs: 2_000, stallMs: 150, totalMs: 5_000, retryDelaysMs: [1, 1], renameDelayMs: 1 };
function options(origin: string, dir: string, extra: Partial<InstallOptions> = {}, path = '/start'): InstallOptions {
  const pin: InstallPin = { version: '0.0.1-test', asset: 'draw-test.war', size: fixture.length, sha256: sha(fixture), source: `${origin}${path}` };
  return { home: dir, pin, allowedSchemes: new Set(['http:']), limits: fast, ...extra };
}
const reason = (expected: string, code = 'app_download_failed') => (error: unknown): boolean => {
  assert.ok(error instanceof DrawioInstallError, String(error));
  assert.equal(error.reason, expected, error.message); assert.equal(error.code, code); return true;
};
const nothingKept = (dir: string, opts: InstallOptions): void => {
  const directory = drawioRuntimeDirectory(dir, opts.pin!);
  assert.deepEqual(readdirSync(directory).filter(name => name !== '.setup.lock'), [], 'neither the target nor a partial file is kept');
  assert.equal(existsSync(join(directory, '.setup.lock')), false, 'the lock is released');
};

test('the product allows exactly https: and pins the official release', () => {
  assert.deepEqual([...PRODUCT_SCHEMES], ['https:']);
  assert.equal(DRAWIO_PIN.size, 48_442_174);
  assert.equal(DRAWIO_PIN.sha256, 'b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820');
  assert.equal(DRAWIO_PIN.source, 'https://github.com/jgraph/drawio/releases/download/v32.4.1/draw.war');
  assert.deepEqual([INSTALL_LIMITS.connectMs, INSTALL_LIMITS.stallMs, INSTALL_LIMITS.totalMs, INSTALL_LIMITS.redirects, [...INSTALL_LIMITS.retryDelaysMs]], [30_000, 30_000, 600_000, 5, [2_000, 8_000]]);
});

test('a matching download is kept after five allowed redirects, then reported as already kept', async () => {
  const server = await standIn((request, response, port) => {
    const hop = Number(request.url!.match(/hop(\d)/)?.[1] ?? 0);
    if (request.url === '/start' || hop < 5) { response.writeHead(302, { Location: `http://127.0.0.1:${port}/hop${hop + 1}` }); response.end(); return; }
    serveFixture(response);
  });
  const dir = home();
  try {
    const opts = options(server.origin, dir);
    const result = await installDrawio(opts);
    assert.deepEqual([result.status, result.bytes, result.sha256, result.replaced], ['installed', fixture.length, sha(fixture), false]);
    assert.deepEqual(await readFile(result.path), fixture);
    assert.deepEqual(await readDrawioRuntime(result.path, opts.pin), fixture);
    assert.equal((await installDrawio(opts)).status, 'already');
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a sixth redirect, a scheme outside the set, a size overrun, a hash mismatch and a 404 keep nothing', async () => {
  let mode = '', sent = 0;
  const server = await standIn((request, response, port) => {
    if (mode === 'redirects') { const hop = Number(request.url!.match(/hop(\d)/)?.[1] ?? 0); response.writeHead(302, { Location: `http://127.0.0.1:${port}/hop${hop + 1}` }); response.end(); return; }
    if (mode === 'scheme') { response.writeHead(302, { Location: `https://127.0.0.1:${port}/file` }); response.end(); return; }
    if (mode === 'overrun') {
      // A body far beyond the pin, streamed until the client stops reading: the counter must stop it early.
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      const chunk = randomBytes(16 * 1024);
      const pump = (): void => { while (!response.destroyed && sent < 64 * 1024 * 1024) { sent += chunk.length; if (!response.write(chunk)) { response.once('drain', pump); return; } } response.end(); };
      response.on('close', () => undefined); pump(); return;
    }
    if (mode === 'mismatch') { serveFixture(response, randomBytes(fixture.length)); return; }
    response.writeHead(404); response.end();
  });
  const dir = home();
  try {
    const opts = options(server.origin, dir);
    mode = 'redirects'; await assert.rejects(installDrawio(opts), reason('redirects')); nothingKept(dir, opts);
    mode = 'scheme'; await assert.rejects(installDrawio(opts), reason('scheme')); nothingKept(dir, opts);
    mode = 'overrun'; await assert.rejects(installDrawio(opts), reason('size', 'app_download_mismatch')); nothingKept(dir, opts);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(sent < 8 * 1024 * 1024, `the download stopped soon after the pinned size (server sent ${sent} bytes)`);
    mode = 'mismatch';
    await assert.rejects(installDrawio(opts), (error: unknown) => {
      reason('sha256', 'app_download_mismatch')(error);
      const details = (error as DrawioInstallError).details;
      assert.equal(details.expectedSha256, sha(fixture)); assert.match(String(details.actualSha256), /^[0-9a-f]{64}$/); assert.equal(details.expectedBytes, fixture.length);
      return true;
    });
    nothingKept(dir, opts);
    mode = '404'; await assert.rejects(installDrawio(opts), (error: unknown) => reason('http')(error) && (error as DrawioInstallError).details.status === 404); nothingKept(dir, opts);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('server errors and broken bodies are retried at most twice; a stall and a slow trickle stop by name', { timeout: 30_000 }, async () => {
  let mode = '', calls = 0;
  const server = await standIn((_request, response) => {
    calls++;
    if (mode === '503-then-ok' && calls <= 2) { response.writeHead(503); response.end(); return; }
    if (mode === '503') { response.writeHead(503); response.end(); return; }
    if (mode === 'truncated') { response.writeHead(200, { 'Content-Length': fixture.length }); response.write(fixture.subarray(0, 1000)); response.socket?.destroy(); return; }
    if (mode === 'stall') { response.writeHead(200, { 'Content-Length': fixture.length }); response.write(fixture.subarray(0, 1000)); return; }
    if (mode === 'trickle') {
      response.writeHead(200, { 'Content-Length': fixture.length });
      let at = 0; const tick = setInterval(() => { if (response.destroyed || at >= fixture.length) { clearInterval(tick); return; } response.write(fixture.subarray(at, at + 1)); at++; }, 5);
      response.on('close', () => clearInterval(tick)); return;
    }
    serveFixture(response);
  });
  const dir = home();
  try {
    const opts = options(server.origin, dir);
    mode = '503'; calls = 0; await assert.rejects(installDrawio(opts), (error: unknown) => reason('http')(error) && (error as DrawioInstallError).details.status === 503); assert.equal(calls, 3, 'one attempt and two retries'); nothingKept(dir, opts);
    mode = 'truncated'; calls = 0; await assert.rejects(installDrawio(opts), reason('network')); assert.equal(calls, 3); nothingKept(dir, opts);
    mode = 'stall'; calls = 0; await assert.rejects(installDrawio(opts), reason('stall')); assert.equal(calls, 3); nothingKept(dir, opts);
    // One byte every 5 ms (64 KiB would take over five minutes): with a stall limit longer than the
    // whole deadline, only the absolute deadline can end it, however loaded the machine is.
    mode = 'trickle'; calls = 0; await assert.rejects(installDrawio({ ...opts, limits: { ...fast, stallMs: 10_000, totalMs: 2_500 } }), reason('deadline')); nothingKept(dir, opts);
    mode = '503-then-ok'; calls = 0;
    const result = await installDrawio(opts);
    assert.deepEqual([result.status, result.attempts], ['installed', 3]);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a wait cut short by the absolute deadline is reported as the deadline, even when its timer fires before the clock says so', async () => {
  // A clock running at nine tenths of the timers' speed: when a wait bounded by the deadline ends, it
  // still says time is left. Waiting for headers and waiting for data both end by the deadline.
  const start = performance.now(), now = (): number => start + (performance.now() - start) * 0.9;
  const limits = { ...fast, connectMs: 10_000, stallMs: 10_000, totalMs: 200, retryDelaysMs: [] };
  const dir = home();
  try {
    const opts = options('http://127.0.0.1:9', dir, { limits, now });
    const noHeaders = (_url: unknown, init?: RequestInit): Promise<Response> => new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => setTimeout(() => reject(new Error('aborted')), 0)); });
    await assert.rejects(installDrawio({ ...opts, fetch: noHeaders as typeof fetch }), reason('deadline')); nothingKept(dir, opts);
    const noData = async (): Promise<Response> => new Response(new ReadableStream({ start() { /* never a byte */ } }), { status: 200 });
    await assert.rejects(installDrawio({ ...opts, fetch: noData as typeof fetch }), reason('deadline')); nothingKept(dir, opts);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one setup at a time: a live lock refuses by name, a stale lock and old partial files are cleared', async () => {
  const server = await standIn((_request, response) => serveFixture(response));
  const dir = home();
  try {
    const opts = options(server.origin, dir);
    const directory = drawioRuntimeDirectory(dir, opts.pin!);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, '.setup.lock'), JSON.stringify({ pid: process.pid, started: Date.now() }));
    await assert.rejects(installDrawio(opts), reason('busy', 'app_install_busy'));
    assert.equal(existsSync(join(directory, opts.pin!.asset)), false, 'no half file next to a running setup');
    // A lock older than the whole chain may take, and a partial file of a setup that died.
    writeFileSync(join(directory, '.setup.lock'), JSON.stringify({ pid: process.pid, started: Date.now() - 3_600_000 }));
    writeFileSync(join(directory, `.${opts.pin!.asset}.1.dead.partial`), 'half');
    const result = await installDrawio(opts);
    assert.equal(result.status, 'installed');
    assert.deepEqual(readdirSync(directory), [opts.pin!.asset]);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the lock (review m2c, runtime-2): a fresh lock not yet written is busy, two setups started together give one download, a release removes only its own lock', { timeout: 60_000 }, async () => {
  let requests = 0, during: (() => void) | undefined, hold: Promise<void> | undefined;
  const server = await standIn((_request, response) => { requests++; during?.(); void (hold ?? Promise.resolve()).then(() => setTimeout(() => serveFixture(response), 20)); });
  const dir = home();
  try {
    const opts = options(server.origin, dir);
    const directory = drawioRuntimeDirectory(dir, opts.pin!), lock = join(directory, '.setup.lock');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // The window before a lock is written: another setup has created it and not yet written a byte. It
    // is judged by its own modification time: fresh, it is busy; an hour old, it is stale.
    writeFileSync(lock, '');
    await assert.rejects(installDrawio(opts), reason('busy', 'app_install_busy'));
    assert.equal(requests, 0, 'nothing was downloaded next to the other setup');
    const hourAgo = new Date(Date.now() - 3_600_000); utimesSync(lock, hourAgo, hourAgo);
    assert.equal((await installDrawio(opts)).status, 'installed');
    assert.equal(existsSync(lock), false, 'the lock is released');
    // A lock that another setup took over while this one ran is not this setup's to remove.
    rmSync(join(directory, opts.pin!.asset));
    const foreign = JSON.stringify({ pid: process.pid, started: Date.now(), token: 'f'.repeat(32) });
    during = () => { writeFileSync(lock, foreign); };
    assert.equal((await installDrawio(opts)).status, 'installed');
    assert.equal(readFileSync(lock, 'utf8'), foreign, 'the release left the other setup\'s lock in place');
    during = undefined; rmSync(lock); rmSync(join(directory, opts.pin!.asset));
    // Two concurrent setups, the first held in the window before its lock is written: the second takes
    // the lock and downloads; the first, released while the second still downloads, stops by name.
    {
      const outcome = (setup: Promise<{ status: string }>): Promise<string> => setup.then(r => r.status, (error: unknown) => error instanceof DrawioInstallError ? error.reason : String(error));
      let resume!: () => void, entered!: () => void, serve!: () => void, downloading!: () => void;
      const paused = new Promise<void>(r => { resume = r; }), inWindow = new Promise<void>(r => { entered = r; }), requested = new Promise<void>(r => { downloading = r; });
      hold = new Promise<void>(r => { serve = r; }); during = () => downloading(); requests = 0;
      const first = outcome(installDrawio({ ...opts, lockPause: async stage => { if (stage === 'writing') { entered(); await paused; } } }));
      await inWindow;
      const second = outcome(installDrawio(opts));
      await requested;
      resume();
      const firstOutcome = await first;
      serve();
      assert.deepEqual([firstOutcome, await second], ['busy', 'installed']);
      assert.equal(requests, 1, 'one download');
      assert.deepEqual(readdirSync(directory), [opts.pin!.asset], 'no lock, temp or partial file is left');
      hold = undefined; during = undefined;
    }
    // Two setups started together on one version directory, again and again: one downloads, the other
    // stops by name, and every lock is gone afterwards.
    for (let trial = 0; trial < 25; trial++) {
      const other = home(); requests = 0;
      try {
        const both = await Promise.allSettled([installDrawio(options(server.origin, other)), installDrawio(options(server.origin, other))]);
        const outcomes = both.map(r => r.status === 'fulfilled' ? r.value.status : r.reason instanceof DrawioInstallError ? r.reason.reason : String(r.reason)).sort();
        assert.deepEqual(outcomes, ['busy', 'installed'], `trial ${trial}`);
        assert.equal(requests, 1, `trial ${trial}: one download`);
        assert.deepEqual(readdirSync(drawioRuntimeDirectory(other, opts.pin!)), [opts.pin!.asset], `trial ${trial}: no lock, temp or partial file is left`);
      } finally { rmSync(other, { recursive: true, force: true }); }
    }
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('two setups that judge the same stale lock: only one takes it over (review m2d, r2-runtime-1)', { timeout: 60_000 }, async () => {
  let requests = 0, serve!: () => void, downloading!: () => void;
  const held = new Promise<void>(r => { serve = r; }), requested = new Promise<void>(r => { downloading = r; });
  const server = await standIn((_request, response) => { requests++; downloading(); void held.then(() => serveFixture(response)); });
  const dir = home();
  try {
    const opts = options(server.origin, dir), directory = drawioRuntimeDirectory(dir, opts.pin!), lock = join(directory, '.setup.lock');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    // A lock left by a setup ended with Ctrl-C an hour ago.
    writeFileSync(lock, JSON.stringify({ pid: process.pid, started: Date.now() - 3_600_000, token: 'd'.repeat(32) }));
    const outcome = (setup: Promise<{ status: string }>): Promise<string> => setup.then(r => r.status, (error: unknown) => error instanceof DrawioInstallError ? error.reason : String(error));
    // Both setups judge the lock stale and wait there; the first then waits again in its takeover.
    const gate = () => { let open!: () => void, reached!: () => void; return { opened: new Promise<void>(r => { open = r; }), arrived: new Promise<void>(r => { reached = r; }), open: () => open(), reach: () => reached() }; };
    const [aStale, aTakeover, bStale, bTakeover] = [gate(), gate(), gate(), gate()];
    const seam = (stale: ReturnType<typeof gate>, takeover: ReturnType<typeof gate>) => async (stage: string): Promise<void> => {
      if (stage === 'stale') { stale.reach(); await stale.opened; }
      if (stage === 'takeover') { takeover.reach(); await takeover.opened; }
    };
    const first = outcome(installDrawio({ ...opts, lockPause: seam(aStale, aTakeover) }));
    const second = outcome(installDrawio({ ...opts, lockPause: seam(bStale, bTakeover) }));
    await Promise.all([aStale.arrived, bStale.arrived]);
    aStale.open(); await aTakeover.arrived;
    // The second setup goes on while the first is inside its takeover: it must not take the lock too.
    bStale.open(); const settledOrWaiting = await Promise.race([second.then(result => `settled ${result}`), bTakeover.arrived.then(() => 'waiting in its takeover')]);
    aTakeover.open(); await requested; bTakeover.open();
    serve();
    assert.deepEqual([await first, await second, settledOrWaiting], ['installed', 'busy', 'settled busy']);
    assert.equal(requests, 1, 'one download');
    assert.deepEqual(readdirSync(directory), [opts.pin!.asset], 'no lock, breaker, temp or partial file is left');
    // A breaker left by a setup that died in the moment of a takeover: removed once it is older than the
    // stale bound, and the setup that found it stops as busy; the next one proceeds.
    rmSync(join(directory, opts.pin!.asset));
    writeFileSync(lock, JSON.stringify({ pid: process.pid, started: Date.now() - 3_600_000, token: 'e'.repeat(32) }));
    writeFileSync(join(directory, '.setup.lock.break'), '');
    const hourAgo = new Date(Date.now() - 3_600_000); utimesSync(join(directory, '.setup.lock.break'), hourAgo, hourAgo);
    await assert.rejects(installDrawio({ ...opts, fetch: (async () => new Response(fixture)) as typeof fetch }), reason('busy', 'app_install_busy'));
    assert.equal((await installDrawio({ ...opts, fetch: (async () => new Response(fixture)) as typeof fetch })).status, 'installed');
  } finally { serve(); await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a home without hard links (FAT, exFAT, some network shares): the lock is created exclusively instead; other lock failures are named (review m2d, r2-runtime-2)', async () => {
  const server = await standIn((_request, response) => serveFixture(response));
  const dir = home();
  try {
    const opts = options(server.origin, dir), directory = drawioRuntimeDirectory(dir, opts.pin!), lock = join(directory, '.setup.lock');
    for (const code of ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']) {
      let sawLock = '';
      const noLinks = async (): Promise<void> => { throw Object.assign(new Error(`link: ${code}`), { code }); };
      const result = await installDrawio({ ...opts, link: noLinks, fetch: (async () => { sawLock = readFileSync(lock, 'utf8'); return new Response(fixture); }) as typeof fetch });
      assert.equal(result.status, 'installed', code);
      assert.match(sawLock, /"token":"[0-9a-f]{32}"/, `${code}: the lock was held, whole, during the download`);
      assert.deepEqual(readdirSync(directory), [opts.pin!.asset], `${code}: the lock is released`);
      rmSync(join(directory, opts.pin!.asset));
    }
    // The fallback lock still refuses a second setup by name.
    writeFileSync(lock, JSON.stringify({ pid: process.pid, started: Date.now(), token: 'c'.repeat(32) }));
    await assert.rejects(installDrawio({ ...opts, link: async () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); } }), reason('busy', 'app_install_busy'));
    rmSync(lock);
    // Any other failure to take the lock is named, never a raw error.
    await assert.rejects(installDrawio({ ...opts, link: async () => { throw Object.assign(new Error('x'), { code: 'EIO' }); } }), (error: unknown) => reason('lock')(error) && (error as DrawioInstallError).details.code === 'EIO');
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a retry wait keeps the process alive: a setup whose only pending work is the wait still retries and finishes (review m2c, Codex 5)', () => {
  const dir = home();
  try {
    // A child process in which nothing but the setup runs: the first request fails at once, so during
    // the retry wait no socket or other timer is left to keep Node running.
    const module = pathToFileURL(fileURLToPath(new URL('../../src/adapters/drawio/download.ts', import.meta.url))).href;
    const code = [
      `const { installDrawio } = await import(${JSON.stringify(module)});`,
      'const { createHash } = await import("node:crypto");',
      'const body = Buffer.from("a stand-in runtime"); let calls = 0;',
      'const failOnce = async () => { if (calls++ === 0) throw new TypeError("fetch failed"); return new Response(body, { status: 200 }); };',
      'const pin = { version: "0.0.1-test", asset: "draw-test.war", size: body.length, sha256: createHash("sha256").update(body).digest("hex"), source: "http://127.0.0.1:9/x" };',
      'const result = await installDrawio({ home: process.argv[1], pin, allowedSchemes: new Set(["http:"]), fetch: failOnce, limits: { retryDelaysMs: [100] } });',
      'console.log(result.status, result.attempts);',
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, dir], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, `exit ${child.status}: ${child.stderr.slice(0, 400)}`);
    assert.equal(child.stdout.trim(), 'installed 2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a kept file that does not verify is replaced; --from checks size and hash; a held file is retried on rename', async () => {
  const server = await standIn((_request, response) => serveFixture(response));
  const dir = home();
  try {
    const opts = options(server.origin, dir);
    const directory = drawioRuntimeDirectory(dir, opts.pin!);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, opts.pin!.asset), randomBytes(fixture.length));
    assert.equal((await installDrawio(opts)).replaced, true);
    rmSync(join(directory, opts.pin!.asset));
    // --from: the right file is kept, a wrong one names both values, a link is no regular file.
    const given = join(dir, 'given.war'); writeFileSync(given, fixture);
    const { allowedSchemes: _schemes, ...fromOptions } = opts;
    assert.equal((await installDrawioFrom(given, fromOptions)).status, 'installed');
    rmSync(join(directory, opts.pin!.asset));
    const wrong = join(dir, 'wrong.war'); writeFileSync(wrong, randomBytes(fixture.length));
    await assert.rejects(installDrawioFrom(wrong, fromOptions), (error: unknown) => reason('sha256', 'app_download_mismatch')(error) && (error as DrawioInstallError).details.expectedSha256 === sha(fixture));
    // A file of another size is hashed too, so both values can be printed (review m2c, runtime-3).
    for (const size of [26, fixture.length + 1, 3 * 1024 * 1024 + 5]) {
      const other = randomBytes(size), path = join(dir, `other-${size}.war`); writeFileSync(path, other);
      await assert.rejects(installDrawioFrom(path, fromOptions), (error: unknown) => {
        reason('size', 'app_download_mismatch')(error);
        assert.deepEqual((error as DrawioInstallError).details, { expectedBytes: fixture.length, actualBytes: size, expectedSha256: sha(fixture), actualSha256: sha(other) });
        return true;
      });
    }
    if (process.platform !== 'win32') { const link = join(dir, 'link.war'); symlinkSync(given, link); await assert.rejects(installDrawioFrom(link, fromOptions), reason('not_file', 'app_download_mismatch')); }
    nothingKept(dir, opts);
    // A reader holds the target for a moment (Windows): the rename is retried, then succeeds.
    let busy = 3;
    const { rename } = await import('node:fs/promises');
    const held = async (from: string, to: string): Promise<void> => { if (busy-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); await rename(from, to); };
    assert.equal((await installDrawio({ ...opts, rename: held })).status, 'installed');
    rmSync(join(directory, opts.pin!.asset));
    const always = async (): Promise<void> => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    await assert.rejects(installDrawio({ ...opts, rename: always }), reason('rename'));
    nothingKept(dir, opts);
    // Whatever lands under the target name is read back and re-hashed before success is reported.
    const damaging = async (from: string, to: string): Promise<void> => { await rename(from, to); writeFileSync(to, randomBytes(fixture.length)); };
    await assert.rejects(installDrawio({ ...opts, rename: damaging }), reason('verify'));
    nothingKept(dir, opts);
  } finally { await server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('the kept runtime is read whole and refused by name when it is missing, a link, of another size or content', async () => {
  const dir = home();
  try {
    const pin = { version: '0.0.1-test', asset: 'draw-test.war', size: fixture.length, sha256: sha(fixture) };
    const path = drawioRuntimePath(dir, pin);
    const refused = (code: string) => (error: unknown): boolean => error instanceof DrawioRuntimeError && error.code === code;
    await assert.rejects(readDrawioRuntime(path, pin), refused('app_runtime_missing'));
    await mkdir(drawioRuntimeDirectory(dir, pin), { recursive: true });
    writeFileSync(path, Buffer.concat([fixture, Buffer.from('x')]));
    await assert.rejects(readDrawioRuntime(path, pin), refused('app_runtime_unverified'));
    writeFileSync(path, randomBytes(fixture.length));
    await assert.rejects(readDrawioRuntime(path, pin), refused('app_runtime_unverified'));
    if (process.platform !== 'win32') {
      const real = join(dir, 'real.war'); writeFileSync(real, fixture); rmSync(path); symlinkSync(real, path);
      await assert.rejects(readDrawioRuntime(path, pin), refused('app_runtime_unverified'));
      rmSync(path);
    }
    writeFileSync(path, fixture);
    assert.deepEqual(await readDrawioRuntime(path, pin), fixture);
    assert.equal(drawioRuntimePath('/h'), join('/h', 'apps', 'drawio', '32.4.1', 'draw.war'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

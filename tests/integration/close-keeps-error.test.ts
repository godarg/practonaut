// Issue #64: a close that runs after a failure must not replace it — the host's start, the CLI's
// `run` and the native transfer's export. Each path fails first; then a stand-in close that never
// settles outlives the close bound (graceful 3 s + forced 5 s). The caller must get the original
// failure, with the close's failure next to it as `closeError`, and the start paths must still remove
// their credential. These paths do real I/O (listeners, files, a real browser), so the 8 s pass in
// real time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Server, request as httpRequest, type ClientRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { startHost } from '../../src/host/server.ts';
import { createPracticeSession } from '../../src/host/session.ts';
import { HOST_ROUTES, TOKEN_HEADER, type PracticeController, type ServeOptions } from '../../src/host/protocol.ts';
import { validateWorld } from '../../src/world/index.ts';
import type { World } from '../../src/world/types.ts';
import { packWorld } from '../../src/package/index.ts';
import { commandRun, RuntimeError } from '../../src/cli/runtime.ts';
import { ADAPTER_REGISTRY, type AdapterRegistry } from '../../src/adapters/registry.ts';
import type { MirrorAdapter } from '../../src/adapters/types.ts';
import { exportAgentSolution } from '../../src/evaluation/transfer.ts';

const never = (): Promise<never> => new Promise(() => {});
/** Graceful 3 s plus forced 5 s (the browser's close budget), written out here. */
const CLOSE_BOUND_MS = 8_000;
async function world(): Promise<World> {
  const value = validateWorld(JSON.parse(await readFile('tests/fixtures/core/world.json', 'utf8')));
  value.app.fontFamilies = [3];
  for (const object of Object.values(value.initialState.objects)) if (object.type === 'step') (object as { fontFamily: number }).fontFamily = 3;
  return value;
}
/** A model-only session whose close never settles. */
const hangingClose = async (input: World, options?: ServeOptions): Promise<PracticeController> => ({ ...await createPracticeSession(input, { ...options, mirror: 'off' }), close: never });
/** `call` fails with the original failure, after the close's whole bound, with the close's deadline next to it. */
async function keepsOriginal(call: Promise<unknown>, original: (reason: unknown) => boolean): Promise<unknown> {
  const started = performance.now();
  // A call that never settles holds nothing open; this keeps the process alive past the test's own
  // timeout (which then reports it), and no longer.
  const alive = setTimeout(() => undefined, 65_000);
  const reason = await call.then(() => assert.fail('the call did not fail'), (error: unknown) => error).finally(() => clearTimeout(alive));
  assert.ok(original(reason), `the caller sees the original failure, not ${String(reason)}`);
  assert.ok(performance.now() - started >= CLOSE_BOUND_MS - 50, 'the close had its whole bound');
  assert.equal(((reason as { closeError?: Error }).closeError)?.name, 'BrowserDeadlineError', 'the close that ran out of time is recorded next to it');
  return reason;
}
async function scratch(prefix: string): Promise<string> { return realpath(await mkdtemp(join(tmpdir(), prefix))); }
/** Fails every `listen` from the `failing`-th on (1-based), as an occupied or refused address would. */
function refuseListen(failing: number, refused: Error): () => void {
  const prototype = Server.prototype as unknown as { listen: (...args: unknown[]) => Server }, original = prototype.listen;
  let calls = 0;
  prototype.listen = function (this: Server, ...args: unknown[]) {
    if (++calls < failing) return original.apply(this, args);
    process.nextTick(() => this.emit('error', refused)); return this;
  };
  return () => { prototype.listen = original; };
}

test('host start: an author store that cannot be created stays the error when the session close outlives its bound', { timeout: 30_000 }, async () => {
  const tokens = await scratch('pn-close-keeps-');
  try {
    // A directory the author controller cannot use: its own path handling refuses it.
    await keepsOriginal(startHost(await world(), { mirror: 'off', phase3: true, localDirectory: 42 as unknown as string, tokenDirectory: tokens, controllerFactory: hangingClose }),
      reason => (reason as { code?: string }).code === 'ERR_INVALID_ARG_TYPE');
    assert.deepEqual(await readdir(tokens), [], 'the credential is still removed');
  } finally { await rm(tokens, { recursive: true, force: true }); }
});

test('host start: a listener that cannot start stays the error when the session close outlives its bound', { timeout: 30_000 }, async () => {
  const tokens = await scratch('pn-close-keeps-'), refused = new Error('stand-in listen refused'), restore = refuseListen(1, refused);
  try {
    await keepsOriginal(startHost(await world(), { mirror: 'off', tokenDirectory: tokens, controllerFactory: hangingClose }), reason => reason === refused);
    assert.deepEqual(await readdir(tokens), [], 'the credential is still removed');
  } finally { restore(); await rm(tokens, { recursive: true, force: true }); }
});

test('host start: an editor listener that cannot start stays the error when the session close outlives its bound', { timeout: 30_000 }, async () => {
  const tokens = await scratch('pn-close-keeps-'), home = await scratch('pn-close-keeps-home-'), refused = new Error('stand-in editor listen refused'), restore = refuseListen(2, refused);
  try {
    await keepsOriginal(startHost(await world(), { mirror: 'off', phase3: true, localDirectory: home, tokenDirectory: tokens, controllerFactory: hangingClose }), reason => reason === refused);
    assert.deepEqual(await readdir(tokens), [], 'the credential is still removed');
  } finally { restore(); await rm(tokens, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

// Review of PR #68 (2026-10-19): closing the listener after an editor start failure waited for an
// open, authenticated event stream, without a deadline, so nothing after it ran.
test('host start: an editor listener failure with an event stream open still closes, removes the credential and keeps its error', { timeout: 30_000 }, async t => {
  const tokens = await scratch('pn-close-keeps-'), home = await scratch('pn-close-keeps-home-'), refused = new Error('stand-in editor listen refused');
  const prototype = Server.prototype as unknown as { listen: (...args: unknown[]) => Server }, original = prototype.listen;
  let opened!: () => void, stream: ClientRequest | undefined, calls = 0;
  const streamOpen = new Promise<void>(done => { opened = done; });
  // The host listens; the test opens its event stream with the session token; only then does the
  // editor listener fail.
  const openStream = async (server: Server): Promise<void> => {
    const file = (await readdir(tokens)).find(name => name.endsWith('.token'))!;
    const token = (await readFile(join(tokens, file), 'utf8')).trim();
    stream = httpRequest({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: HOST_ROUTES.events, headers: { [TOKEN_HEADER]: token } }, response => {
      assert.equal(response.statusCode, 200, 'the event stream is open'); response.on('data', () => undefined); response.on('error', () => undefined); opened();
    });
    stream.on('error', () => undefined); stream.end();
  };
  prototype.listen = function (this: Server, ...args: unknown[]) {
    if (++calls === 1) { this.once('listening', () => { void openStream(this); }); return original.apply(this, args); }
    void streamOpen.then(() => this.emit('error', refused)); return this;
  };
  // Also after a timeout (the previous code waited for the stream for good): end the stream, so the
  // listener and this process can end.
  t.after(() => { prototype.listen = original; stream?.destroy(); });
  try {
    await keepsOriginal(startHost(await world(), { mirror: 'off', phase3: true, localDirectory: home, tokenDirectory: tokens, controllerFactory: hangingClose }), reason => reason === refused);
    assert.deepEqual(await readdir(tokens), [], 'the credential is still removed');
  } finally { await rm(tokens, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
});

// Review of PR #68: one cleanup step that fails (here the diagnostics file is already gone when it is
// discarded) must neither replace the start failure nor skip the steps after it.
for (const [path, setUp] of [
  ['the session factory', () => ({ options: {}, restore: () => undefined, original: (reason: unknown) => reason instanceof Error && reason.message === 'stand-in factory refused', factoryFails: true })],
  ['the author store', () => ({ options: { phase3: true, localDirectory: 42 as unknown as string }, restore: () => undefined, original: (reason: unknown) => (reason as { code?: string }).code === 'ERR_INVALID_ARG_TYPE', factoryFails: false })],
  ['the listener', () => { const refused = new Error('stand-in listen refused'); return { options: {}, restore: refuseListen(1, refused), original: (reason: unknown) => reason === refused, factoryFails: false }; }],
  ['the editor listener', () => { const refused = new Error('stand-in editor listen refused'); return { options: { phase3: true }, restore: refuseListen(2, refused), original: (reason: unknown) => reason === refused, factoryFails: false }; }],
] as const) {
  test(`host start: when ${path} fails and discarding the diagnostics fails, the credential is still removed and the start's error stays`, { timeout: 30_000 }, async () => {
    const tokens = await scratch('pn-close-keeps-'), home = await scratch('pn-close-keeps-home-'), plan = setUp();
    const removeDiagnostics = async (): Promise<void> => { for (const name of await readdir(tokens)) if (name.endsWith('.mirror.jsonl')) await rm(join(tokens, name)); };
    const factory = async (input: World, options?: ServeOptions): Promise<PracticeController> => {
      if (plan.factoryFails) { await removeDiagnostics(); throw new Error('stand-in factory refused'); }
      return { ...await createPracticeSession(input, { ...options, mirror: 'off' }), close: removeDiagnostics };
    };
    try {
      const reason = await startHost(await world(), { mirror: 'off', localDirectory: home, ...plan.options, tokenDirectory: tokens, controllerFactory: factory })
        .then(() => assert.fail('the start did not fail'), (error: unknown) => error);
      assert.ok(plan.original(reason), `the caller sees the start's own failure, not ${String(reason)}`);
      assert.equal(((reason as { closeError?: { code?: string } }).closeError)?.code, 'ENOENT', 'the failed discard is recorded next to it');
      assert.deepEqual(await readdir(tokens), [], 'the credential is still removed');
    } finally { plan.restore(); await rm(tokens, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); }
  });
}

test('practonaut run: the engine\'s refusal stays the error when the adapter close outlives its bound', { timeout: 60_000 }, async () => {
  const dir = await scratch('pn-close-keeps-run-');
  try {
    const pnworld = join(dir, 'flow.pnworld'), actions = join(dir, 'actions.json');
    await writeFile(pnworld, await packWorld('examples/worlds/flow-diagram'));
    await writeFile(actions, JSON.stringify([{ name: 'move_step', params: { id: 'a', x: 200, y: 220 } }]));
    const refusing: MirrorAdapter = { describe: () => { throw new Error('unused'); }, snapshot: async () => { throw new Error('unused'); },
      apply: async () => ({ ok: false, error: { code: 'real_tool_disagrees', message: 'stand-in engine refuses', details: {} } }),
      restoreState: async () => { throw new Error('unused'); }, exportArtifact: async () => { throw new Error('unused'); }, importArtifact: async () => { throw new Error('unused'); },
      renderPng: async () => new Uint8Array(), networkAttempts: () => [], terminate: never, close: never };
    const registry: AdapterRegistry = { excalidraw: { ...ADAPTER_REGISTRY.excalidraw, create: async () => refusing } };
    await keepsOriginal(commandRun([pnworld, '--seed', '42', '--task', 'T3', '--actions', actions], registry),
      reason => reason instanceof RuntimeError && reason.code === 'real_tool_disagrees');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('native transfer export: an invalid agent solution stays the error when the real browser\'s close outlives its bound', { timeout: 60_000 }, async t => {
  // The real adapter and Chromium; only the browser's close is held, as a slow Chromium exit would.
  const target = chromium as unknown as { launch: typeof chromium.launch }, launch = target.launch;
  const realCloses: Array<() => Promise<void>> = [];
  t.after(async () => { target.launch = launch; for (const close of realCloses) await close().catch(() => undefined); });
  target.launch = (async (...args: Parameters<typeof chromium.launch>) => {
    const browser = await launch.apply(chromium, args);
    realCloses.push(browser.close.bind(browser));
    browser.close = (() => never()) as Browser['close'];
    return browser;
  }) as typeof chromium.launch;
  const initial = (await world()).initialState;
  await keepsOriginal(exportAgentSolution(initial, { steps: [{ label: 'One', x: 300, y: 300 }], arrows: [{ from: 0, to: 0 }] }),
    reason => reason instanceof RuntimeError && reason.code === 'transfer_invalid' && /invalid arrow reference/.test(reason.message));
});

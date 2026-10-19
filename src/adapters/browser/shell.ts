/**
 * The browser shell every browser-based adapter shares (PADR-0045): what is not about the app.
 *
 * - **Start** Chromium the one way (PADR-0032) on a slot of the process's browser budget, within a
 *   launch deadline the shell enforces itself; a browser that arrives after the deadline or after an
 *   abort goes to its one close (PADR-0050). Then, within the same
 *   deadline, a private context with fail-closed routing and a page, then the adapter's own start
 *   (open the app, first scene, probe) within its own deadline. While the shell starts, an abort
 *   settles every pending browser call at once; any start failure closes the browser and is
 *   reported as an `AdapterInitializationError` carrying the refused requests.
 * - **Network.** Only named origins, only safe paths, only what the adapter serves. Every other HTTP
 *   request of the page, its frames and its dedicated workers is aborted and recorded
 *   (`networkAttempts`); every WebSocket the page or a frame opens is closed before it connects and
 *   recorded. Channels the route cannot see are blocked: every served response carries a content
 *   security policy that limits every fetch (connections, scripts, workers, fonts, images) to the
 *   named origins; the violations the page, a frame or a dedicated worker reports are recorded too,
 *   while a shared worker's are blocked but not recorded (the browser routes neither its requests
 *   nor its reports). Below the page, the browser resolves no host name and sends every connection
 *   it opens itself (WebRTC's TURN over TCP, preconnects) to the shell's sink proxy on the loopback
 *   interface, which forwards nothing, reads nothing, records nothing and refuses (it cannot tell
 *   the browser from another local process); WebRTC may not send UDP at all.
 * - **Operations** (transactions, guarded reads, the adapter's start) run one at a time, under one
 *   deadline and an abort that also cover reading the committed scene. Reading the scene, the work,
 *   the undo of a failed result and the rebuild are each an operation of their own: once one ends,
 *   any later call it makes into the shell is refused, including a fresh page it was still waiting
 *   for. A write that answers with a failure is undone in place within the start's deadline; one
 *   that times out, is cancelled or throws (or whose undo does not finish) closes its page and
 *   rebuilds the committed scene on a fresh one, within the start's deadline. A rebuild that fails
 *   or runs out of time closes the shell: every later call answers `mirror_unavailable`, and the
 *   owner starts a new one (the host's mirror recovery does).
 * - **PNG capture** and the **SHA-256 artifact** helper.
 *
 * The app's own semantics (what a scene is, how it is read, written, projected, integrity-checked
 * and rendered as SVG) stay in the adapter's folder.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import type { Browser, BrowserContext, LaunchOptions, Page, Route, WebSocketRoute } from 'playwright-core';
import { sha256Hex } from '../../canonical/index.ts';
import type { Failure } from '../../world/types.ts';
import type { AdapterResult, Artifact } from '../types.ts';
import { BROWSER_BOUNDS, BrowserDeadlineError, bounded } from './bounded.ts';
import { chromiumSandboxPolicy, launchChromium, type LaunchContext } from './chromium.ts';
import { closeDeadline, closeErrorOf, deadlineOf, type CloseResult } from './close.ts';
import { processLedger, type BrowserLease, type BrowserLedger } from './ledger.ts';

/** The longest single adapter operation; a caller's timeout can only shorten it. */
export const MAX_ADAPTER_MS = 10_000;
/** What a mirror start that waited for a browser slot keeps of its launch bound for the launch itself
 * (PADR-0050): its slot wait ends when only this much is left. */
export const LAUNCH_AFTER_WAIT_MS = 5_000;
export class AdapterError extends Error { readonly code: Failure['code']; constructor(code: Failure['code'], message: string) { super(message); this.code = code; } }
/** Preserve startup failure separately from disposal failure for the owning attempt. */
export class AdapterInitializationError extends AdapterError {
  readonly primaryError: unknown; readonly cleanupError: unknown; readonly networkAttempts: string[];
  readonly pendingInitializationOperations: number;
  /** How the browser's close after the failure settled (PADR-0050); absent when the browser never arrived. */
  readonly closeResult: CloseResult | undefined;
  constructor(primaryError: unknown, cleanupError: unknown, networkAttempts: string[], pendingInitializationOperations = 0, closeResult?: CloseResult) {
    super(primaryError instanceof AdapterError ? primaryError.code : String(primaryError).includes('cancelled') ? 'cancelled' : 'mirror_unavailable', 'Engine initialization failed');
    this.primaryError = primaryError; this.cleanupError = cleanupError; this.networkAttempts = [...networkAttempts];
    this.pendingInitializationOperations = pendingInitializationOperations;
    this.closeResult = closeResult;
    this.cause = primaryError;
  }
}
/** Host-only real-process observation seam. Never exposed to the player or world package. */
export interface EngineLifecycleProbe {
  ready(browser: Browser, page: Page): void | Promise<void>;
}

const failure = (code: Failure['code'], message: string): AdapterResult => ({ ok: false, error: { code, message, details: {} } });
/** The operation limit: the first given timeout, never above `MAX_ADAPTER_MS`. */
export const operationMs = (...timeouts: Array<number | undefined>): number => Math.min(timeouts.find(value => value !== undefined) ?? MAX_ADAPTER_MS, MAX_ADAPTER_MS);
/** Native file and rendered form with the SHA-256 of each. */
export const artifactOf = (native: string, svg: string): Artifact => ({ native, svg, nativeSha256: sha256Hex(native), svgSha256: sha256Hex(svg) });
/** A PNG screenshot of the page within the operation limit. */
export const capturePng = async (page: Page): Promise<Uint8Array> => new Uint8Array(await page.screenshot({ type: 'png', timeout: MAX_ADAPTER_MS }));

/** One browser operation at a time, in call order; a failed one never blocks the next. */
export function serialQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => { const pending = tail.then(operation, operation); tail = pending.catch(() => undefined); return pending; };
}

export interface Fulfilment { body: string | Buffer; contentType: string }
/** Origin (`scheme://host`) → what it serves for a path; `undefined` or a throw refuses the request. */
export type ShellOrigins = Readonly<Record<string, (path: string) => Promise<Fulfilment | undefined>>>;
/** The part of Playwright's `chromium` the shell uses; tests pass a fake. */
export interface ChromiumLike { launch(options?: LaunchOptions): Promise<Browser> }
export interface ShellOptions {
  signal?: AbortSignal | undefined;
  origins: ShellOrigins;
  viewport?: { width: number; height: number };
  /** Test seams: a fake Playwright, shorter launch and start deadlines, a launch context (platform, env),
   * a ledger of the test's own (default: the process's, PADR-0050). */
  chromium?: ChromiumLike; launchMs?: number; initializeMs?: number; launchContext?: LaunchContext; ledger?: BrowserLedger;
}
/** How the adapter reads and writes its committed scene, for rollback. */
export interface SceneIO<S> {
  read(): Promise<S>;
  /** Writes `scene` into the current, intact page. */
  write(scene: S): Promise<unknown>;
  /** Opens the app on the current (fresh) page and writes `scene`. */
  load(scene: S): Promise<unknown>;
}
export interface OperationLimits { timeoutMs: number; signal?: AbortSignal | undefined }
/** Every member except `networkAttempts` is refused to an operation that has ended, and every
 * member but `networkAttempts` and `close` to a closed shell (`mirror_unavailable`). */
export interface BrowserShell {
  readonly browser: Browser;
  readonly context: BrowserContext;
  /** The current page; a rollback replaces it. */
  readonly page: Page;
  /** Requests and connections the shell refused, in order. */
  networkAttempts(): string[];
  /** Runs a browser call; while the shell starts, an abort settles it at once. */
  wait<T>(operation: () => Promise<T>): Promise<T>;
  /** Closes the current page, cancelling its pending work, and opens a fresh one. */
  freshPage(): Promise<Page>;
  /** A write under one deadline and abort (which also cover reading the scene first): a failed result
   * is undone in place; a timeout, abort or throw ends the operation, replaces the page and rebuilds
   * the scene read before it. A rebuild that fails closes the shell (`mirror_unavailable`). */
  transaction<S>(work: () => Promise<AdapterResult>, scene: SceneIO<S>, limits: OperationLimits): Promise<AdapterResult>;
  /** A read-only operation under one deadline and abort; on any failure it ends, the page is
   * replaced and the scene read before it rebuilt (or the shell closes), then the error is rethrown. */
  guarded<S, T>(work: () => Promise<T>, scene: SceneIO<S>, limits: OperationLimits, errors: { timeout(): Error; cancel(): Error }): Promise<T>;
  /** Closes the browser under the close contract (PADR-0050): settles by `deadline` (default: now plus
   * 8 s) as closed, failed or abandoned, and never throws. The sink proxy closes when the browser's
   * slot is released, not before. The shell answers nothing afterwards. */
  close(deadline?: number): Promise<CloseResult>;
}

/** The operation a piece of adapter work belongs to; it follows the work across every await, so a
 * continuation of an ended operation is recognised wherever it resumes. */
interface Operation { ended: boolean }
const operations = new AsyncLocalStorage<Operation>();
/** Runs `work` as one operation; the returned `end` refuses every later step of it. */
function asOperation<T>(work: () => Promise<T>): { run: () => Promise<T>; end: () => void } {
  const operation: Operation = { ended: false };
  return { run: () => operations.run(operation, work), end: () => { operation.ended = true; } };
}
const requireLive = (): void => {
  if (operations.getStore()?.ended) throw new AdapterError('cancelled', 'Operation ended; its page was replaced');
};

/** A transaction's own deadline or abort, told apart from an error of the browser itself. */
class OperationStop extends Error {
  readonly code: 'mirror_timeout' | 'cancelled';
  constructor(code: OperationStop['code']) { super(code); this.code = code; }
}
/** `work` raced against a timeout and an abort. The abort is watched before `work` starts, and an
 * operation that is already aborted never starts. */
async function within<T>(work: () => Promise<T>, limits: OperationLimits, errors: { timeout(): Error; cancel(): Error }): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined, cancel: (() => void) | undefined;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(errors.timeout()), limits.timeoutMs);
    cancel = () => reject(errors.cancel());
    if (limits.signal?.aborted) cancel(); else limits.signal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    if (limits.signal?.aborted) return await stop;
    return await Promise.race([new Promise<T>(resolve => resolve(work())), stop]);
  } finally { if (timer) clearTimeout(timer); if (cancel) limits.signal?.removeEventListener('abort', cancel); }
}

/** The sink proxy: a listener on the loopback interface that forwards nothing. Every connection the
 * browser opens below the page (WebRTC's TURN over TCP, preconnects, anything that bypasses the
 * routing) is sent to it as a proxy request and refused. It holds the proxy's port, so no other
 * process can listen there and receive the browser's connections.
 *
 * Any local process can connect to it too (it has no token: Chromium cannot be configured with one
 * for these connections). So it treats every connection alike and as untrusted: it reads nothing,
 * records nothing, answers 403 and resets the connection, at most `SINK_LIMITS.connections` at a
 * time. A foreign client can neither reach the browser, nor fill the shell's records, nor close the
 * shell. */
interface Sink { readonly server: string; close(): Promise<void> }
export const SINK_LIMITS = Object.freeze({ connections: 64, lingerMs: 1_000 });
const FORBIDDEN = 'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';
async function startSink(): Promise<Sink> {
  const sockets = new Set<Socket>();
  // Paused from the start: nothing the client sends is ever read into this process.
  const server = createServer({ pauseOnConnect: true }, socket => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    // Answer, then reset, without a graceful close in between. A client that keeps its side open
    // ignores a FIN: one that left nothing unread on any platform, on Windows also one whose data
    // the sink never read. Once it has the FIN it no longer reads, so not even a later reset reaches
    // it. A reset (RST) while it still reads ends every client on every platform; the answer has the
    // linger time to arrive first.
    const reset = setTimeout(() => socket.resetAndDestroy(), SINK_LIMITS.lingerMs); reset.unref();
    socket.on('close', () => { clearTimeout(reset); sockets.delete(socket); });
    socket.write(FORBIDDEN);
  });
  server.maxConnections = SINK_LIMITS.connections;
  server.unref();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const { port } = server.address() as AddressInfo;
  return {
    server: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => { for (const socket of sockets) socket.resetAndDestroy(); server.close(() => resolve()); }),
  };
}
/** Below the page: WebRTC may not send UDP (and proxied TCP only reaches the sink), and no host name
 * resolves — the app's own content is routed and never resolved, so nothing it needs is lost. */
const LAUNCH_ARGS = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];
/** Chromium within the deadline, every connection it opens itself sent to the sink (the loopback
 * interface included), on the lease's slot. When the caller's race is lost (deadline or abort), the
 * lease stays *launching* until Playwright's promise settles: a browser that arrives late goes to its
 * one close, a launch that rejects holds its slot (and so the sink) for the launch wait (PADR-0050). */
async function launchWithin(chromium: ChromiumLike, remaining: () => number, signal: AbortSignal | undefined, context: LaunchContext | undefined, sink: Sink, lease: BrowserLease): Promise<Browser> {
  const launching = lease.launch(() => launchChromium(chromium, () => ({ headless: true, timeout: remaining(), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, args: [...LAUNCH_ARGS], proxy: { server: sink.server, bypass: '<-loopback>' } }), context));
  try {
    return (await within(() => launching, { timeoutMs: remaining(), signal }, { timeout: () => new BrowserDeadlineError('launch'), cancel: () => new AdapterError('cancelled', 'Engine initialization cancelled during launch') })).browser;
  } catch (error) {
    void lease.close(deadlineOf(signal));
    throw error;
  }
}

const SAFE_PATH = /^\/[a-zA-Z0-9_./-]*$/;
/** Where the policy's violations are reported, on the first named origin; the shell answers it. */
export const POLICY_REPORT_PATH = '/__practonaut/policy-report';
/** The content security policy on every served response: every fetch the page or any of its workers
 * makes — connections, scripts (`importScripts`), workers, fonts, images, frames — goes only to the
 * named origins or to local `data:`/`blob:` URLs, which carry the policy with them. It restricts
 * hosts only: inline code and `eval` stay as the app had them. */
export function shellPolicy(origins: readonly string[]): string {
  return `default-src ${origins.join(' ')} data: blob: 'unsafe-inline' 'unsafe-eval'; report-uri ${origins[0]}${POLICY_REPORT_PATH}`;
}
/** The address a policy report names, from its JSON body; unreadable reports still count. */
function reportedTarget(body: string | null): string {
  try {
    const report = (JSON.parse(body ?? '') as { 'csp-report'?: { 'blocked-uri'?: unknown; 'effective-directive'?: unknown } })['csp-report'];
    const blocked = typeof report?.['blocked-uri'] === 'string' ? report['blocked-uri'] : 'unknown';
    return `policy:${String(report?.['effective-directive'] ?? 'unknown').slice(0, 64)}:${blocked.slice(0, 2048)}`;
  } catch { return 'policy:unreadable'; }
}

/**
 * Starts the shell, then runs the adapter's `initialize` (open the app, write the first scene, probe)
 * inside the same start phase, within its own deadline. Returns only a ready shell; on any failure
 * the browser is closed under the close contract, and the sink closes when its slot is released
 * (PADR-0050). A full browser budget is refused by name (`BrowserBudgetError`) before anything starts.
 */
export async function startShell(options: ShellOptions, initialize: (shell: BrowserShell) => Promise<void>): Promise<BrowserShell> {
  const deadline = performance.now() + (options.launchMs ?? BROWSER_BOUNDS.launch);
  const remaining = (): number => Math.max(1, deadline - performance.now());
  const startMs = Math.max(1, options.initializeMs ?? BROWSER_BOUNDS.initialize);
  const chromium = options.chromium ?? (await bounded(import('playwright-core'), remaining(), 'launch')).chromium;
  const beforeLaunch = (): AdapterError => new AdapterError('cancelled', 'Engine initialization cancelled before launch');
  if (options.signal?.aborted) throw beforeLaunch();
  const denied: string[] = [];
  // A sandbox setting that is refused launches nothing, so it takes no slot.
  chromiumSandboxPolicy(options.launchContext?.env ?? process.env);
  // The slot first, within the launch bound (a full budget is refused by name, PADR-0050); the sink
  // belongs to it and closes only when the slot is released. The wait ends while the launch still has
  // LAUNCH_AFTER_WAIT_MS of its bound: a slot granted later would launch with too little time, fail as
  // a launch timeout and hold the slot for the launch wait.
  const lease = await (options.ledger ?? processLedger).reserve('mirror', { waitMs: Math.max(0, remaining() - LAUNCH_AFTER_WAIT_MS), signal: options.signal, cancelled: beforeLaunch });
  let sink: Sink;
  try { sink = await startSink(); } catch (error) { await lease.close(); throw error; }
  lease.onRelease(() => sink.close());
  if (options.signal?.aborted) { await lease.close(); throw beforeLaunch(); }
  const browser = await launchWithin(chromium, remaining, options.signal, options.launchContext, sink, lease);
  const named = Object.keys(options.origins), policy = shellPolicy(named);
  // The browser belongs to the shell before a ready adapter exists.
  let initializing = true, pendingInitializationOperations = 0, closed = false;
  const requireStart = (): void => { if (options.signal?.aborted) throw new AdapterError('cancelled', 'Engine initialization cancelled'); };
  const requireOpen = (): void => { if (closed) throw new AdapterError('mirror_unavailable', 'The browser shell is closed'); };
  /** Every shell entry point: not from an operation that has ended, not after the shell closed. */
  const entry = (): void => { requireLive(); requireOpen(); };
  // Abort settles the owner even when the browser API reply never settles. Its loser remains observed.
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    entry();
    if (!initializing) return operation();
    requireStart();
    let cancel: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => reject(new AdapterError('cancelled', 'Engine initialization cancelled'));
      options.signal?.addEventListener('abort', cancel, { once: true });
    });
    pendingInitializationOperations++;
    const pending = Promise.resolve().then(() => { requireStart(); return operation(); }).then(
      value => { pendingInitializationOperations--; requireStart(); return value; },
      error => { pendingInitializationOperations--; throw error; });
    try { return await Promise.race([pending, aborted]); }
    finally { if (cancel) options.signal?.removeEventListener('abort', cancel); }
  };
  const route = async (request: Route): Promise<void> => {
    if (options.signal?.aborted) { await request.abort(); return; }
    const url = new URL(request.request().url());
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { path = '..'; }
    const serve = Object.hasOwn(options.origins, url.origin) ? options.origins[url.origin] : undefined;
    if (serve && path === POLICY_REPORT_PATH && request.request().method() === 'POST') {
      denied.push(reportedTarget(request.request().postData())); await request.fulfill({ status: 204, body: '' }); return;
    }
    if (!serve || path.includes('..') || !SAFE_PATH.test(path)) { denied.push(url.href); await request.abort(); return; }
    try {
      const answer = await serve(path);
      if (!answer) throw new Error('not served');
      if (options.signal?.aborted) { await request.abort(); return; }
      await request.fulfill({ body: answer.body, contentType: answer.contentType, headers: { 'Content-Security-Policy': policy, 'X-DNS-Prefetch-Control': 'off' } });
    } catch { denied.push(url.href); await request.abort(); }
  };
  // A WebSocket never connects: the shell answers it, records it and closes it.
  const socket = async (connection: WebSocketRoute): Promise<void> => { denied.push(connection.url()); await connection.close().catch(() => undefined); };
  let context: BrowserContext | undefined, page: Page | undefined;
  /** The browser's one close under the contract; the sink stays until the slot is released. */
  const shutDown = (deadline: number = closeDeadline()): Promise<CloseResult> => { closed = true; return lease.close(deadline); };
  // A start stopped by a close settles its browser's close by that close's deadline (decision 8).
  const closeOwned = async (primaryError: unknown): Promise<never> => {
    const requested = performance.now(), own = deadlineOf(options.signal) ?? closeDeadline(requested);
    // A close that stops this start while it is already closing after its own failure hands down its
    // deadline through the abort: the browser's one close then settles by the earlier one.
    let detach = (): void => {};
    const sooner = new Promise<{ result: CloseResult; deadline: number }>(resolve => {
      const handed = (): void => { const later = deadlineOf(options.signal); if (later !== undefined && later < own) void lease.close(later).then(result => resolve({ result, deadline: later })); };
      options.signal?.addEventListener('abort', handed, { once: true });
      detach = () => options.signal?.removeEventListener('abort', handed);
    });
    const { result: closeResult, deadline } = await Promise.race([shutDown(own).then(result => ({ result, deadline: own })), sooner]);
    detach();
    initializing = false;
    throw new AdapterInitializationError(primaryError, closeErrorOf(closeResult, deadline - requested), denied, pendingInitializationOperations, closeResult);
  };
  try {
    requireStart(); // Includes abort while the launch was pending.
    // Every setup call shares the launch deadline: a browser that never answers cannot hold the start.
    context = await wait(() => bounded(browser.newContext({ viewport: options.viewport ?? { width: 1600, height: 1000 }, serviceWorkers: 'block' }), deadline - performance.now(), 'setup'));
    requireStart();
    await wait(() => bounded(context!.route('**/*', route), deadline - performance.now(), 'setup'));
    await wait(() => bounded(context!.routeWebSocket(() => true, socket), deadline - performance.now(), 'setup'));
    requireStart();
    page = await wait(() => bounded(context!.newPage(), deadline - performance.now(), 'setup'));
    requireStart();
  } catch (primaryError) { return closeOwned(primaryError); }
  /** Replaces the current page. `guard` decides, after the new page exists, whether the caller may
   * still publish it: an operation that ended meanwhile gets nothing, and its page is closed. */
  const replacePage = async (guard?: () => void): Promise<Page> => {
    await page!.close();
    const fresh = await context!.newPage();
    try { guard?.(); } catch (error) { await fresh.close().catch(() => undefined); throw error; }
    page = fresh; return fresh;
  };
  const shellStop = { timeout: () => new BrowserDeadlineError('rollback', startMs), cancel: () => new BrowserDeadlineError('rollback', startMs) };
  /** Writes the committed scene back into the intact page after a failed result, as an operation of
   * its own within the start's deadline; false when it did not finish. */
  const undo = async <S>(scene: SceneIO<S>, before: S): Promise<boolean> => {
    const undoing = asOperation(() => scene.write(before));
    try { await within(undoing.run, { timeoutMs: startMs }, shellStop); return true; }
    catch { return false; }
    finally { undoing.end(); }
  };
  /** Rebuilds the committed scene on a fresh page, as an operation of its own within the start's
   * deadline; when that fails, the page's state is unknown and the shell closes itself. */
  const rebuild = async <S>(scene: SceneIO<S>, before: S): Promise<boolean> => {
    const rebuilding = asOperation(async () => { await replacePage(requireLive); await scene.load(before); });
    try { await within(rebuilding.run, { timeoutMs: startMs }, shellStop); return true; }
    catch { rebuilding.end(); await shutDown(); return false; }
    finally { rebuilding.end(); }
  };
  const lost = (cause: unknown): string => `The committed scene could not be rebuilt after ${String(cause)}; the browser shell closed`;
  /** The committed scene, read as an operation of its own under the caller's deadline: a read that
   * outlives it can do nothing further in the shell. */
  const readScene = async <S>(scene: SceneIO<S>, limits: OperationLimits, errors: { timeout(): Error; cancel(): Error }): Promise<S> => {
    const reading = asOperation(scene.read);
    try { return await within(reading.run, limits, errors); } finally { reading.end(); }
  };
  const shell: BrowserShell = {
    get browser() { entry(); return browser; },
    get context() { entry(); return context!; },
    get page() { entry(); return page!; },
    networkAttempts: () => [...denied],
    wait,
    freshPage: async () => { entry(); return replacePage(entry); },
    transaction: async (work, scene, limits) => {
      entry();
      if (limits.signal?.aborted) return failure('cancelled', 'Operation cancelled before write');
      // One deadline for the operation: reading the committed scene counts against it too.
      const ends = performance.now() + limits.timeoutMs, left = (): OperationLimits => ({ timeoutMs: Math.max(1, ends - performance.now()), signal: limits.signal });
      const errors = { timeout: () => new OperationStop('mirror_timeout'), cancel: () => new OperationStop('cancelled') };
      const code = (error: unknown): Failure['code'] => String(error).includes('mirror_timeout') ? 'mirror_timeout' : String(error).includes('cancelled') ? 'cancelled' : 'integrity_failed';
      let before: Awaited<ReturnType<typeof scene.read>>;
      // Nothing is written yet: a read that times out or is aborted leaves the scene as it was.
      // A read that throws (a crashed page, a closed browser) fails the call as before.
      try { before = await readScene(scene, left(), errors); } catch (error) { if (error instanceof OperationStop) return failure(error.code, `Committed scene not read: ${error.code}`); throw error; }
      const operation = asOperation(work);
      let result: AdapterResult;
      try { result = await within(operation.run, left(), errors); }
      catch (error) {
        // The operation ends first: none of its later steps may touch the page that replaces it.
        // Closing the page cancels its pending JS work before the committed scene is rebuilt.
        operation.end();
        if (!await rebuild(scene, before)) return failure('mirror_unavailable', lost(error));
        return failure(code(error), String(error));
      } finally { operation.end(); }
      if (result.ok) return result;
      // A failed result is undone in place; an undo that does not finish is a rebuild's job.
      if (await undo(scene, before)) return result;
      if (!await rebuild(scene, before)) return failure('mirror_unavailable', lost('an undo that did not finish'));
      return result;
    },
    guarded: async (work, scene, limits, errors) => {
      entry();
      const ends = performance.now() + limits.timeoutMs, left = (): OperationLimits => ({ timeoutMs: Math.max(1, ends - performance.now()), signal: limits.signal });
      const before = await readScene(scene, left(), errors);
      const operation = asOperation(work);
      try { return await within(operation.run, left(), errors); }
      catch (error) { operation.end(); if (!await rebuild(scene, before)) throw new AdapterError('mirror_unavailable', lost(error)); throw error; }
      finally { operation.end(); }
    },
    close: async deadline => { requireLive(); return shutDown(deadline); },
  };
  const start = asOperation(() => initialize(shell));
  try {
    requireStart();
    await within(start.run, { timeoutMs: startMs, signal: options.signal }, { timeout: () => new BrowserDeadlineError('start', startMs), cancel: () => new AdapterError('cancelled', 'Engine initialization cancelled') });
    requireStart();
  } catch (primaryError) { start.end(); return closeOwned(primaryError); }
  finally { start.end(); initializing = false; }
  return shell;
}

/**
 * The browser shell every browser-based adapter shares (PADR-0045): what is not about the app.
 *
 * - **Start** Chromium the one way (PADR-0032) within a launch deadline the shell enforces itself; a
 *   browser that arrives after the deadline or after an abort is closed. Then, within the same
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
 *   interface, which forwards nothing and records the target; WebRTC may not send UDP at all.
 * - **Operations** (transactions, guarded reads, the adapter's start) run one at a time, under one
 *   deadline and an abort that also cover reading the committed scene. A write that answers with a
 *   failure is undone in place; one that times out, is cancelled or throws ends its operation — any
 *   later call it makes into the shell is refused — closes its page and rebuilds the committed
 *   scene on a fresh one, within the start's deadline. A rebuild that fails or runs out of time
 *   closes the shell: every later call answers `mirror_unavailable`, and the owner starts a new one
 *   (the host's mirror recovery does).
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
import { BROWSER_BOUNDS, BrowserDeadlineError, bounded, closeBrowser } from './bounded.ts';
import { launchChromium, type LaunchContext } from './chromium.ts';

/** The longest single adapter operation; a caller's timeout can only shorten it. */
export const MAX_ADAPTER_MS = 10_000;
export class AdapterError extends Error { readonly code: Failure['code']; constructor(code: Failure['code'], message: string) { super(message); this.code = code; } }
/** Preserve startup failure separately from disposal failure for the owning attempt. */
export class AdapterInitializationError extends AdapterError {
  readonly primaryError: unknown; readonly cleanupError: unknown; readonly networkAttempts: string[];
  readonly pendingInitializationOperations: number;
  constructor(primaryError: unknown, cleanupError: unknown, networkAttempts: string[], pendingInitializationOperations = 0) {
    super(primaryError instanceof AdapterError ? primaryError.code : String(primaryError).includes('cancelled') ? 'cancelled' : 'mirror_unavailable', 'Engine initialization failed');
    this.primaryError = primaryError; this.cleanupError = cleanupError; this.networkAttempts = [...networkAttempts];
    this.pendingInitializationOperations = pendingInitializationOperations;
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
  /** Test seams: a fake Playwright, shorter launch and start deadlines, a launch context (platform, env). */
  chromium?: ChromiumLike; launchMs?: number; initializeMs?: number; launchContext?: LaunchContext;
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
  /** Closes the browser and the sink proxy; the shell answers nothing afterwards. */
  close(): Promise<void>;
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
 * routing) is sent to it as a proxy request; it records the target it was asked for and refuses. */
interface Sink { readonly server: string; close(): Promise<void> }
const REQUEST_LINE = /^([A-Z]{3,10}) (\S{1,2048})/;
async function startSink(record: (target: string) => void): Promise<Sink> {
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    let head = '', done = false;
    const refuse = (target: string): void => {
      if (done) return; done = true; record(target);
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    };
    socket.setTimeout(2_000, () => { refuse('proxy:connection'); socket.destroy(); });
    socket.on('data', chunk => {
      head += chunk.toString('latin1');
      const end = head.indexOf('\r\n');
      if (end >= 0 || head.length > 4096) { const line = REQUEST_LINE.exec(head.slice(0, end >= 0 ? end : 4096)); refuse(line ? `proxy:${line[1]} ${line[2]}` : 'proxy:unreadable'); }
    });
    socket.on('end', () => refuse('proxy:connection')); socket.on('error', () => undefined);
  });
  server.unref();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const { port } = server.address() as AddressInfo;
  return {
    server: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}
/** Below the page: WebRTC may not send UDP (and proxied TCP only reaches the sink), and no host name
 * resolves — the app's own content is routed and never resolved, so nothing it needs is lost. */
const LAUNCH_ARGS = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];
/** Chromium within the deadline, every connection it opens itself sent to the sink (the loopback
 * interface included); a browser that arrives after the deadline or an abort is closed. */
async function launchWithin(chromium: ChromiumLike, remaining: () => number, signal: AbortSignal | undefined, context: LaunchContext | undefined, sink: Sink): Promise<Browser> {
  const launching = launchChromium(chromium, () => ({ headless: true, timeout: remaining(), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, args: [...LAUNCH_ARGS], proxy: { server: sink.server, bypass: '<-loopback>' } }), context);
  try {
    return (await within(() => launching, { timeoutMs: remaining(), signal }, { timeout: () => new BrowserDeadlineError(), cancel: () => new AdapterError('cancelled', 'Engine initialization cancelled during launch') })).browser;
  } catch (error) {
    void launching.then(({ browser }) => closeBrowser(browser)).catch(() => undefined);
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
 * the browser and the sink are closed.
 */
export async function startShell(options: ShellOptions, initialize: (shell: BrowserShell) => Promise<void>): Promise<BrowserShell> {
  const deadline = performance.now() + (options.launchMs ?? BROWSER_BOUNDS.launch);
  const remaining = (): number => Math.max(1, deadline - performance.now());
  const startMs = Math.max(1, options.initializeMs ?? BROWSER_BOUNDS.initialize);
  const chromium = options.chromium ?? (await bounded(import('playwright-core'), remaining())).chromium;
  if (options.signal?.aborted) throw new AdapterError('cancelled', 'Engine initialization cancelled before launch');
  const denied: string[] = [];
  const sink = await startSink(target => { denied.push(target); });
  let browser: Browser;
  try { browser = await launchWithin(chromium, remaining, options.signal, options.launchContext, sink); }
  catch (error) { await sink.close(); throw error; }
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
  const shutDown = async (): Promise<void> => { closed = true; try { await closeBrowser(browser); } finally { await sink.close(); } };
  const closeOwned = async (primaryError: unknown): Promise<never> => {
    let cleanupError: unknown; try { await shutDown(); } catch (error) { cleanupError = error; }
    initializing = false;
    throw new AdapterInitializationError(primaryError, cleanupError, denied, pendingInitializationOperations);
  };
  try {
    requireStart(); // Includes abort while the launch was pending.
    // Every setup call shares the launch deadline: a browser that never answers cannot hold the start.
    context = await wait(() => bounded(browser.newContext({ viewport: options.viewport ?? { width: 1600, height: 1000 }, serviceWorkers: 'block' }), deadline - performance.now()));
    requireStart();
    await wait(() => bounded(context!.route('**/*', route), deadline - performance.now()));
    await wait(() => bounded(context!.routeWebSocket(() => true, socket), deadline - performance.now()));
    requireStart();
    page = await wait(() => bounded(context!.newPage(), deadline - performance.now()));
    requireStart();
  } catch (primaryError) { return closeOwned(primaryError); }
  const replacePage = async (): Promise<Page> => { await page!.close(); page = await context!.newPage(); return page; };
  /** Rebuilds the committed scene on a fresh page within the start's deadline; when that fails, the
   * page's state is unknown and the shell closes itself. */
  const rebuild = async <S>(scene: SceneIO<S>, before: S): Promise<boolean> => {
    try {
      await within(async () => { await replacePage(); await scene.load(before); }, { timeoutMs: startMs }, { timeout: () => new BrowserDeadlineError(), cancel: () => new BrowserDeadlineError() });
      return true;
    } catch { await shutDown().catch(() => undefined); return false; }
  };
  const lost = (cause: unknown): string => `The committed scene could not be rebuilt after ${String(cause)}; the browser shell closed`;
  const shell: BrowserShell = {
    get browser() { entry(); return browser; },
    get context() { entry(); return context!; },
    get page() { entry(); return page!; },
    networkAttempts: () => [...denied],
    wait,
    freshPage: async () => { entry(); return replacePage(); },
    transaction: async (work, scene, limits) => {
      entry();
      if (limits.signal?.aborted) return failure('cancelled', 'Operation cancelled before write');
      // One deadline for the operation: reading the committed scene counts against it too.
      const ends = performance.now() + limits.timeoutMs, left = (): OperationLimits => ({ timeoutMs: Math.max(1, ends - performance.now()), signal: limits.signal });
      const errors = { timeout: () => new Error('mirror_timeout'), cancel: () => new Error('cancelled') };
      const code = (error: unknown): Failure['code'] => String(error).includes('mirror_timeout') ? 'mirror_timeout' : String(error).includes('cancelled') ? 'cancelled' : 'integrity_failed';
      let before: Awaited<ReturnType<typeof scene.read>>;
      // Nothing is written yet: a read that times out or is aborted leaves the scene as it was.
      try { before = await within(scene.read, left(), errors); } catch (error) { return failure(code(error), `Committed scene not read: ${String(error)}`); }
      const operation = asOperation(work);
      try {
        const result = await within(operation.run, left(), errors);
        operation.end();
        if (!result.ok) await scene.write(before);
        return result;
      } catch (error) {
        // The operation ends first: none of its later steps may touch the page that replaces it.
        // Closing the page cancels its pending JS work before the committed scene is rebuilt.
        operation.end();
        if (!await rebuild(scene, before)) return failure('mirror_unavailable', lost(error));
        return failure(code(error), String(error));
      } finally { operation.end(); }
    },
    guarded: async (work, scene, limits, errors) => {
      entry();
      const ends = performance.now() + limits.timeoutMs, left = (): OperationLimits => ({ timeoutMs: Math.max(1, ends - performance.now()), signal: limits.signal });
      const before = await within(scene.read, left(), errors);
      const operation = asOperation(work);
      try { return await within(operation.run, left(), errors); }
      catch (error) { operation.end(); if (!await rebuild(scene, before)) throw new AdapterError('mirror_unavailable', lost(error)); throw error; }
      finally { operation.end(); }
    },
    close: async () => { requireLive(); await shutDown(); },
  };
  const start = asOperation(() => initialize(shell));
  try {
    requireStart();
    await within(start.run, { timeoutMs: startMs, signal: options.signal }, { timeout: () => new BrowserDeadlineError(), cancel: () => new AdapterError('cancelled', 'Engine initialization cancelled') });
    requireStart();
  } catch (primaryError) { start.end(); return closeOwned(primaryError); }
  finally { start.end(); initializing = false; }
  return shell;
}

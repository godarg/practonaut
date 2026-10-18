/**
 * The browser shell every browser-based adapter shares (PADR-0045): what is not about the app.
 *
 * - **Start** Chromium the one way (PADR-0032) within a launch deadline the shell enforces itself; a
 *   browser that arrives after the deadline or after an abort is closed. Then a private context with
 *   fail-closed routing and a page, then the adapter's own start (open the app, first scene, probe)
 *   within its own deadline. While the shell starts, an abort settles every pending browser call at
 *   once; any start failure closes the browser and is reported as an `AdapterInitializationError`
 *   carrying the refused requests.
 * - **Network.** Only named origins, only safe paths, only what the adapter serves. Every other HTTP
 *   request of the page and its dedicated workers is aborted and recorded (`networkAttempts`); every
 *   WebSocket is closed before it connects and recorded. Channels the route cannot see are blocked:
 *   every served response carries a content security policy that limits connections and workers to
 *   the named origins (violations the page or a dedicated worker reports are recorded too), so shared
 *   workers cannot reach anything else; WebRTC may not send UDP without a proxy (there is none).
 * - **Operations** (transactions, guarded reads, the adapter's start) run one at a time, under a
 *   timeout and an abort. A write that answers with a failure is undone in place; one that times
 *   out, is cancelled or throws ends its operation — any later step of it is refused — closes its
 *   page and rebuilds the committed scene on a fresh one, so late work can never race the rollback.
 * - **PNG capture** and the **SHA-256 artifact** helper.
 *
 * The app's own semantics (what a scene is, how it is read, written, projected, integrity-checked
 * and rendered as SVG) stay in the adapter's folder.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
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
export interface BrowserShell {
  readonly browser: Browser;
  readonly context: BrowserContext;
  /** The current page; a rollback replaces it. Refused to an operation that has ended. */
  readonly page: Page;
  /** Requests the shell refused, in order. */
  networkAttempts(): string[];
  /** Runs a browser call; while the shell starts, an abort settles it at once. Refused to an
   * operation that has ended. */
  wait<T>(operation: () => Promise<T>): Promise<T>;
  /** Closes the current page, cancelling its pending work, and opens a fresh one. */
  freshPage(): Promise<Page>;
  /** A write under a timeout and abort: a failed result is undone in place; a timeout, abort or
   * throw ends the operation, replaces the page and rebuilds the scene read before it. */
  transaction<S>(work: () => Promise<AdapterResult>, scene: SceneIO<S>, limits: OperationLimits): Promise<AdapterResult>;
  /** A read-only operation under a timeout and abort; on any failure it ends, the page is replaced
   * and the scene read before it rebuilt, then the error is rethrown. */
  guarded<S, T>(work: () => Promise<T>, scene: SceneIO<S>, limits: OperationLimits, errors: { timeout(): Error; cancel(): Error }): Promise<T>;
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

/** No UDP outside a proxy: WebRTC cannot reach any host (there is no proxy). */
const LAUNCH_ARGS = ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'];
/** Chromium within the deadline; a browser that arrives after the deadline or an abort is closed. */
async function launchWithin(chromium: ChromiumLike, remaining: () => number, signal: AbortSignal | undefined, context: LaunchContext | undefined): Promise<Browser> {
  const launching = launchChromium(chromium, () => ({ headless: true, timeout: remaining(), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false, args: [...LAUNCH_ARGS] }), context);
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
 * the browser is closed.
 */
export async function startShell(options: ShellOptions, initialize: (shell: BrowserShell) => Promise<void>): Promise<BrowserShell> {
  const deadline = performance.now() + (options.launchMs ?? BROWSER_BOUNDS.launch);
  const remaining = (): number => Math.max(1, deadline - performance.now());
  const chromium = options.chromium ?? (await bounded(import('playwright-core'), remaining())).chromium;
  if (options.signal?.aborted) throw new AdapterError('cancelled', 'Engine initialization cancelled before launch');
  const browser = await launchWithin(chromium, remaining, options.signal, options.launchContext);
  const denied: string[] = [];
  const named = Object.keys(options.origins), policy = shellPolicy(named);
  // The browser belongs to the shell before a ready adapter exists.
  let initializing = true, pendingInitializationOperations = 0;
  const requireStart = (): void => { if (options.signal?.aborted) throw new AdapterError('cancelled', 'Engine initialization cancelled'); };
  // Abort settles the owner even when the browser API reply never settles. Its loser remains observed.
  const wait = async <T>(operation: () => Promise<T>): Promise<T> => {
    requireLive();
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
      await request.fulfill({ body: answer.body, contentType: answer.contentType, headers: { 'Content-Security-Policy': policy } });
    } catch { denied.push(url.href); await request.abort(); }
  };
  // A WebSocket never connects: the shell answers it, records it and closes it.
  const socket = async (connection: WebSocketRoute): Promise<void> => { denied.push(connection.url()); await connection.close().catch(() => undefined); };
  let context: BrowserContext | undefined, page: Page | undefined;
  const closeOwned = async (primaryError: unknown): Promise<never> => {
    let cleanupError: unknown; try { await closeBrowser(browser); } catch (error) { cleanupError = error; }
    initializing = false;
    throw new AdapterInitializationError(primaryError, cleanupError, denied, pendingInitializationOperations);
  };
  try {
    requireStart(); // Includes abort while the launch was pending.
    context = await wait(() => bounded(browser.newContext({ viewport: options.viewport ?? { width: 1600, height: 1000 }, serviceWorkers: 'block' }), deadline - performance.now()));
    requireStart();
    await wait(() => context!.route('**/*', route));
    await wait(() => context!.routeWebSocket(() => true, socket));
    requireStart();
    page = await wait(() => bounded(context!.newPage(), deadline - performance.now()));
    requireStart();
  } catch (primaryError) { return closeOwned(primaryError); }
  const shell: BrowserShell = {
    browser,
    get context() { requireLive(); return context!; },
    get page() { requireLive(); return page!; },
    networkAttempts: () => [...denied],
    wait,
    freshPage: async () => { await page!.close(); page = await context!.newPage(); return page; },
    transaction: async (work, scene, limits) => {
      if (limits.signal?.aborted) return failure('cancelled', 'Operation cancelled before write');
      const before = await scene.read();
      if (limits.signal?.aborted) return failure('cancelled', 'Operation cancelled before write');
      const operation = asOperation(work);
      try {
        const result = await within(operation.run, limits, { timeout: () => new Error('mirror_timeout'), cancel: () => new Error('cancelled') });
        operation.end();
        if (!result.ok) await scene.write(before);
        return result;
      } catch (error) {
        // The operation ends first: none of its later steps may touch the page that replaces it.
        // Closing the page cancels its pending JS work before the committed scene is rebuilt.
        operation.end();
        await shell.freshPage(); await scene.load(before);
        return failure(String(error).includes('mirror_timeout') ? 'mirror_timeout' : String(error).includes('cancelled') ? 'cancelled' : 'integrity_failed', String(error));
      } finally { operation.end(); }
    },
    guarded: async (work, scene, limits, errors) => {
      const before = await scene.read();
      const operation = asOperation(work);
      try { return await within(operation.run, limits, errors); }
      catch (error) { operation.end(); await shell.freshPage(); await scene.load(before); throw error; }
      finally { operation.end(); }
    },
    close: () => closeBrowser(browser),
  };
  const start = asOperation(() => initialize(shell));
  try {
    requireStart();
    await within(start.run, { timeoutMs: Math.max(1, options.initializeMs ?? BROWSER_BOUNDS.initialize), signal: options.signal }, { timeout: () => new BrowserDeadlineError(), cancel: () => new AdapterError('cancelled', 'Engine initialization cancelled') });
    requireStart();
  } catch (primaryError) { start.end(); return closeOwned(primaryError); }
  finally { start.end(); initializing = false; }
  return shell;
}

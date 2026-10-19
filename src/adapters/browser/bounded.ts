/** Wall-clock bounds for browser work owned by the adapter, the checker render and transfer runs.
 * `initialize` bounds an adapter's own start after the browser exists (opening the app, writing the
 * first scene, the probe) so a stalled start can never hold its owner for good. It is longer than
 * the native transfer's 60-second attempt, whose own deadline and evidence end a stalled transfer. */
export const BROWSER_BOUNDS = Object.freeze({ launch: 15_000, initialize: 60_000, inspect: 2_000, graceful: 3_000, forced: 5_000 });
/** Which bounded browser operation ran out of time, so a failure names it (issue #64). */
export type BrowserOperation = 'launch' | 'setup' | 'start' | 'rollback' | 'close' | 'settlement';
export class BrowserDeadlineError extends Error {
  readonly operation: BrowserOperation | undefined; readonly ms: number | undefined;
  constructor(operation?: BrowserOperation, ms?: number) {
    super(operation === undefined ? 'Browser operation exceeded its deadline' : `Browser ${operation} exceeded its deadline${ms === undefined ? '' : ` of ${Math.round(ms)} ms`}`);
    this.name = 'BrowserDeadlineError'; this.operation = operation; this.ms = ms;
  }
}
export async function bounded<T>(promise: Promise<T>, ms: number, operation?: BrowserOperation): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = Math.max(1, ms);
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BrowserDeadlineError(operation, limit)), limit); })]); }
  finally { clearTimeout(timer); }
}
/** The close budget of a browser (graceful + forced), and the bound of every close that cleans up
 * after a failure. */
export const CLOSE_BOUND_MS = BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced;
/** Playwright's close within graceful + forced. Playwright's `browser.close()` returns once Chromium
 * has exited and Playwright has removed its temporary profile. A close that does not finish in time
 * fails with `BrowserDeadlineError` (operation `close`) and goes on in the background: nothing ends
 * the browser before this process exits, when Playwright's own exit handler kills what is left. */
export async function closeBrowser(browser: { close(): Promise<void> }): Promise<void> {
  await bounded(browser.close(), CLOSE_BOUND_MS, 'close');
}
/** A close (of a browser, or of what holds one) within the close bound; a throw counts as a failure. */
export const closeWithin = (close: () => Promise<unknown> | undefined): Promise<unknown> => bounded(Promise.resolve().then(close), CLOSE_BOUND_MS, 'close');
/**
 * Closes after `failure` without replacing it (issue #64): `close` runs within the close bound, and
 * this never throws. A close that fails or runs out of time (`BrowserDeadlineError`, operation
 * `close`) is kept next to the failure as its `closeError`, as `AdapterInitializationError` keeps its
 * `cleanupError`: not enumerable, so a reply or a log that serialises the failure is unchanged. When
 * several closes after the same failure fail, `closeError` is an `AggregateError` of all of them, in
 * order. A failure that is not an extensible object cannot carry it. Returns `failure` for the caller
 * to rethrow: `throw await closeAfterFailure(error, () => adapter.close())`.
 */
export async function closeAfterFailure<E>(failure: E, close: () => Promise<unknown> | undefined): Promise<E> {
  try { await closeWithin(close); }
  catch (closeError) {
    const holder = failure as unknown;
    if (((typeof holder === 'object' && holder !== null) || typeof holder === 'function') && Object.isExtensible(holder)) {
      const earlier = Object.hasOwn(holder, 'closeError') ? (holder as { closeError: unknown }).closeError : undefined;
      const value = earlier === undefined ? closeError : new AggregateError([...(collected.has(earlier as object) ? (earlier as AggregateError).errors : [earlier]), closeError], 'Several closes after the failure failed');
      if (value instanceof AggregateError) collected.add(value);
      Object.defineProperty(holder, 'closeError', { value, configurable: true, writable: true, enumerable: false });
    }
  }
  return failure;
}
/** The aggregates `closeAfterFailure` made itself, so that a later failure is added to them. */
const collected = new WeakSet<object>();
/**
 * Runs `work`, then `close`. When `work` fails, its failure is what the caller gets: the close runs
 * within the close bound, with a failed close next to it (`closeAfterFailure`). When `work` succeeds,
 * the close runs as before, under whatever bound it has itself, and a close that fails fails the call.
 */
export async function withClose<T>(work: () => Promise<T>, close: () => Promise<unknown> | undefined): Promise<T> {
  let value: T;
  try { value = await work(); } catch (failure) { throw await closeAfterFailure(failure, close); }
  await close();
  return value;
}

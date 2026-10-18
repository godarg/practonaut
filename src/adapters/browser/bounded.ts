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
/** Playwright's close within graceful + forced. Playwright's `browser.close()` returns once Chromium
 * has exited and Playwright has removed its temporary profile. A close that does not finish in time
 * fails with `BrowserDeadlineError` (operation `close`) and goes on in the background: nothing ends
 * the browser before this process exits, when Playwright's own exit handler kills what is left. */
export async function closeBrowser(browser: { close(): Promise<void> }): Promise<void> {
  await bounded(browser.close(), BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced, 'close');
}

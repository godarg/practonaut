/** Wall-clock bounds for browser work owned by the adapter, the checker render and transfer runs. */
export const BROWSER_BOUNDS = Object.freeze({ launch: 15_000, inspect: 2_000, graceful: 3_000, forced: 5_000 });
export class BrowserDeadlineError extends Error {
  constructor() { super('Browser operation exceeded its deadline'); this.name = 'BrowserDeadlineError'; }
}
export async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BrowserDeadlineError()), Math.max(1, ms)); })]); }
  finally { clearTimeout(timer); }
}
/** Plain Playwright close with a deadline; a browser that does not close in time is killed by Playwright's own process handling. */
export async function closeBrowser(browser: { close(): Promise<void> }): Promise<void> {
  await bounded(browser.close(), BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced);
}

// Stand-ins for Playwright's Chromium in the close contract's unit tests (PADR-0050). A browser's close
// settles when the test says so, and the browser reports its connection as Playwright's client does:
// `isConnected()` turns false and `disconnected` fires when the connection drops, which a real close
// does before it fulfils. Contexts and pages answer the calls the four owners make; nothing renders.
import type { Browser, LaunchOptions } from 'playwright-core';

/** A close that settles at once (`immediate`), or only when the test calls `finish` or `fail`. */
export class HeldClose {
  mode: 'immediate' | 'held';
  calls = 0;
  private pending: Array<{ resolve(): void; reject(error: unknown): void }> = [];
  constructor(mode: 'immediate' | 'held' = 'immediate') { this.mode = mode; }
  run(onSettled: () => void = () => {}): Promise<void> {
    this.calls++;
    if (this.mode === 'immediate') { onSettled(); return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => { this.pending.push({ resolve: () => { onSettled(); resolve(); }, reject }); });
  }
  finish(): void { for (const close of this.pending.splice(0)) close.resolve(); }
  fail(error: unknown): void { for (const close of this.pending.splice(0)) close.reject(error); }
}

export class FakePage {
  closed = false;
  async setContent(): Promise<void> {}
  async goto(): Promise<null> { return null; }
  async evaluate(expression: unknown): Promise<unknown> { return String(expression).includes('querySelector') ? { anchors: [], texts: [] } : undefined; }
  async screenshot(): Promise<Buffer> { return Buffer.from([137, 80, 78, 71]); }
  locator(): { first(): { screenshot(): Promise<Buffer> } } { return { first: () => ({ screenshot: async () => Buffer.from([137, 80, 78, 71]) }) }; }
  async close(): Promise<void> { this.closed = true; }
}

export class FakeContext {
  readonly closing: HeldClose; pages: FakePage[] = [];
  constructor(close: 'immediate' | 'held' = 'immediate') { this.closing = new HeldClose(close); }
  async route(): Promise<void> {}
  async routeWebSocket(): Promise<void> {}
  async newPage(): Promise<FakePage> { const page = new FakePage(); this.pages.push(page); return page; }
  close(): Promise<void> { return this.closing.run(); }
}

export class FakeBrowser {
  connected = true;
  readonly closing: HeldClose;
  contexts: FakeContext[] = [];
  /** How each new context closes. */
  contextClose: 'immediate' | 'held' = 'immediate';
  /** A setup call that never answers, as a browser that stops replying would. */
  hangNewContext = false;
  private readonly listeners = new Set<() => void>();
  constructor(close: 'immediate' | 'held' = 'immediate') { this.closing = new HeldClose(close); }
  on(event: string, listener: () => void): this { if (event === 'disconnected') this.listeners.add(listener); return this; }
  isConnected(): boolean { return this.connected; }
  /** The connection drops (Chromium closed its end, or the close got that far). */
  disconnect(): void { if (!this.connected) return; this.connected = false; for (const listener of this.listeners) listener(); }
  // Playwright's close fulfils after the connection dropped.
  close(): Promise<void> { return this.closing.run(() => this.disconnect()); }
  async newContext(): Promise<FakeContext> {
    if (this.hangNewContext) await new Promise(() => {});
    const context = new FakeContext(this.contextClose); this.contexts.push(context); return context;
  }
}

/** A `chromium` whose launch resolves with `browser` once `release` is called (or at once), or rejects
 * when `reject` is called; it records every launch's options. */
export function fakeChromium(browser: FakeBrowser = new FakeBrowser(), immediate = true) {
  const calls: LaunchOptions[] = [];
  let release: (() => void) | undefined, reject: ((error: unknown) => void) | undefined;
  const gate = immediate ? Promise.resolve() : new Promise<void>((done, fail) => { release = done; reject = fail; });
  return {
    browser, calls,
    release: (): void => release?.(),
    reject: (error: unknown): void => reject?.(error),
    chromium: { launch: async (options: LaunchOptions = {}): Promise<Browser> => { calls.push(options); await gate; return browser as unknown as Browser; } },
  };
}

/** Moves Node's mock clock in `step` ms (flushing pending callbacks between them) until `done()` or
 * `limitMs` of mock time has passed; returns the mock time that passed. */
export async function advance(t: { mock: { timers: { tick(ms: number): void } } }, done: () => boolean, limitMs: number, step = 250): Promise<number> {
  let elapsed = 0;
  await flush();
  while (!done() && elapsed < limitMs) { t.mock.timers.tick(step); elapsed += step; await flush(); }
  return elapsed;
}
export async function flush(turns = 10): Promise<void> { for (let turn = 0; turn < turns; turn++) await new Promise(resolve => setImmediate(resolve)); }

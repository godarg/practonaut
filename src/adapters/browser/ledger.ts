/**
 * The process-wide browser ledger and budget (PADR-0050, decisions 4–7).
 *
 * Every browser a Practonaut owner starts — the mirror's shell, the start check, the render check, the
 * report card — reserves one slot before Playwright's launch starts, synchronously, so two starts can
 * never both take the last free slot. The budget (`HOST_LIMITS.browsers`) counts running and closing
 * browsers together, across every host in the process. A start that finds it full waits for a slot
 * within its own launch bound and is then refused by name (`browser_budget_exhausted`).
 *
 * Each entry keeps three statements apart, and none is inferred from another:
 * - **Promise result:** Playwright's launch (for the whole `launchChromium` call) resolved or
 *   rejected; its one `browser.close()` fulfilled or rejected; and how each caller's close settled
 *   against its own deadline (closed, failed, abandoned, cancelled).
 * - **Process end:** proven only by Playwright's own close, requested while `browser.isConnected()`
 *   was true and fulfilled: such a close reached Playwright's process close, which fulfils only after
 *   it saw the child's `close` event. That frees the slot (and, through `onRelease`, the shell's sink).
 *   A launch that rejected holds its slot for Playwright's 30 s close bound plus 5 s; a browser that
 *   was already disconnected when its close was requested, or whose close rejected, holds it until the
 *   process exits. One residual window is accepted: a close requested in the one event-loop turn in
 *   which Playwright has already dropped the connection but the client still reports it connected
 *   fulfils without reaching the process close and is taken as proof.
 * - **Directory cleanup:** not confirmable through Playwright's API; always `unconfirmed`.
 *
 * Practonaut reads no process table and signals no process: the close is Playwright's, and so is the
 * forced end 30 s after it (decision 1).
 */
import type { Browser, LaunchOptions } from 'playwright-core';
import { HOST_LIMITS } from '../../host/limits.ts';
import { BROWSER_BOUNDS } from './bounded.ts';
import { CANCELLED, closeDeadline, settleBy, type CloseOutcome, type CloseResult } from './close.ts';
import { chromiumSandboxPolicy, launchChromium, type ChromiumLaunch, type LaunchContext } from './chromium.ts';

export type BrowserOwner = 'mirror' | 'start-check' | 'render-check' | 'report-card';
/** Playwright's close bound (30 s) plus 5 s: how long a launch that rejected holds its slot. */
export const LAUNCH_HOLD_MS = 35_000;
/** How many entries the ledger keeps for the command's report: every unreleased one, and the latest. */
export const LEDGER_KEEP = 64;

/** The part of a Playwright browser the ledger uses. */
export type LedgerBrowser = Pick<Browser, 'close' | 'isConnected' | 'on'>;

export class BrowserBudgetError extends Error {
  readonly code = 'browser_budget_exhausted';
  readonly running: number; readonly closing: number; readonly budget: number;
  constructor(counts: { running: number; closing: number }, budget: number) {
    super(`No browser slot became free within the launch bound: ${counts.running} running and ${counts.closing} closing of ${budget} allowed; wait until they have closed, or restart Practonaut (browser_budget_exhausted)`);
    this.name = 'BrowserBudgetError'; this.running = counts.running; this.closing = counts.closing; this.budget = budget;
  }
}

/** One entry of the ledger, as the command's report and the tests read it. */
export interface LedgerRecord {
  readonly id: number;
  readonly owner: BrowserOwner;
  /** Playwright's promise for the whole `launchChromium` call; `unused` when no launch ran. */
  readonly launch: 'unused' | 'pending' | 'resolved' | 'rejected';
  /** Playwright's one `browser.close()` for this browser. */
  readonly close: 'none' | 'pending' | 'fulfilled' | 'rejected';
  /** How the callers' close requests settled against their own deadlines. */
  readonly callers: Readonly<Record<CloseOutcome, number>>;
  /** Whether the browser was connected when its close was requested. */
  readonly connectedAtRequest?: boolean;
  /** The process end: proven by Playwright's close, unproven (and why), or nothing ever launched. */
  readonly end: 'pending' | 'proven' | 'none' | 'launch-rejected' | 'disconnected-before-close' | 'close-failed';
  /** The slot: still held, or released by proof, by the launch wait, or because no launch ran. */
  readonly slot: 'held' | 'proof' | 'launch-wait' | 'unused';
  readonly cleanup: 'unconfirmed';
  /** `performance.now()` times; `asked` is when the start asked for its slot, so `reserved - asked` is
   * how long it waited for one. */
  readonly at: Readonly<{ asked: number; reserved: number; launchSettled?: number; closeRequested?: number; disconnected?: number; closeSettled?: number; released?: number }>;
}

/** A reserved slot and the browser it is for. */
export interface BrowserLease {
  readonly id: number;
  /** Starts the launch at once, exactly once; returns Playwright's own promise for it. */
  launch(start: () => Promise<ChromiumLaunch>): Promise<ChromiumLaunch>;
  /** The one close of this browser against `deadline`. Before a browser exists: *cancelled* (a browser
   * that still arrives goes to its one close; a launch that was never started frees the slot). */
  close(deadline?: number): Promise<CloseResult>;
  /** Runs `callback` once the slot is released (at once if it already was). */
  onRelease(callback: () => unknown): void;
  readonly released: boolean;
  record(): LedgerRecord;
}

interface Entry {
  id: number; owner: BrowserOwner;
  launch: LedgerRecord['launch']; close: LedgerRecord['close']; end: LedgerRecord['end']; slot: LedgerRecord['slot'];
  callers: Record<CloseOutcome, number>; connectedAtRequest?: boolean;
  at: { asked: number; reserved: number; launchSettled?: number; closeRequested?: number; disconnected?: number; closeSettled?: number; released?: number };
  browser?: LedgerBrowser; closing?: Promise<void>; closeWanted: boolean; released: Array<() => unknown>;
}
interface Waiter { owner: BrowserOwner; asked: number; grant(lease: BrowserLease): void }

export class BrowserLedger {
  readonly budget: number; readonly holdMs: number;
  private readonly entries: Entry[] = [];
  private readonly waiting: Waiter[] = [];
  private next = 1;
  private lastRequest: number | undefined;
  private refused = 0;
  constructor(budget: number = HOST_LIMITS.browsers, holdMs: number = LAUNCH_HOLD_MS) { this.budget = budget; this.holdMs = holdMs; }

  /** Entries whose slot is still held: launching, running, closing, or held without proof. */
  unreleased(): number { return this.entries.filter(entry => entry.slot === 'held').length; }
  /** Held slots by what the browser is doing: launching or running, and closing or held after a close. */
  counts(): { running: number; closing: number } {
    const held = this.entries.filter(entry => entry.slot === 'held');
    const closing = held.filter(entry => entry.close !== 'none' || entry.launch === 'rejected' || entry.closeWanted).length;
    return { running: held.length - closing, closing };
  }
  /** The latest close request or launch rejection (Playwright's own close after it), if any. */
  get lastCloseRequestAt(): number | undefined { return this.lastRequest; }
  records(): LedgerRecord[] { return this.entries.map(snapshot); }
  /** How many starts this ledger refused with `BrowserBudgetError`, so far. */
  get refusals(): number { return this.refused; }

  /** A slot now, or `undefined` when the budget is full. */
  tryReserve(owner: BrowserOwner, asked: number = performance.now()): BrowserLease | undefined {
    return this.unreleased() < this.budget && this.waiting.length === 0 ? this.lease(owner, asked) : undefined;
  }
  /** A slot now when one is free (reserved synchronously), otherwise the first one that frees within
   * `waitMs`, in call order; then refused with `BrowserBudgetError`. An abort refuses with `cancelled()`. */
  reserve(owner: BrowserOwner, options: { waitMs: number; signal?: AbortSignal | undefined; cancelled?: () => Error }): Promise<BrowserLease> {
    const cancelled = options.cancelled ?? (() => new Error('Browser start cancelled'));
    if (options.signal?.aborted) return Promise.reject(cancelled());
    const asked = performance.now(), now = this.tryReserve(owner, asked);
    if (now) return Promise.resolve(now);
    return new Promise<BrowserLease>((resolve, reject) => {
      const done = (): void => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); const index = this.waiting.indexOf(waiter); if (index >= 0) this.waiting.splice(index, 1); };
      const waiter: Waiter = { owner, asked, grant: lease => { done(); resolve(lease); } };
      const abort = (): void => { done(); reject(cancelled()); };
      const timer = setTimeout(() => { done(); this.refused++; reject(new BrowserBudgetError(this.counts(), this.budget)); }, Math.max(0, options.waitMs));
      options.signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private lease(owner: BrowserOwner, asked: number): BrowserLease {
    const entry: Entry = { id: this.next++, owner, launch: 'unused', close: 'none', end: 'pending', slot: 'held', callers: { closed: 0, failed: 0, abandoned: 0, cancelled: 0 }, at: { asked, reserved: performance.now() }, closeWanted: false, released: [] };
    this.entries.push(entry); this.trim();
    const release = (how: Exclude<LedgerRecord['slot'], 'held'>): void => {
      if (entry.slot !== 'held') return;
      entry.slot = how; entry.at.released = performance.now();
      for (const callback of entry.released.splice(0)) { try { void Promise.resolve(callback()).catch(() => undefined); } catch { /* A release callback cannot hold the slot. */ } }
      this.trim(); this.grant();
    };
    const requestClose = (browser: LedgerBrowser): Promise<void> => {
      if (entry.closing) return entry.closing;
      // Recorded before the request: only a close asked while connected can reach the process close.
      const connected = entry.at.disconnected === undefined && browser.isConnected();
      entry.connectedAtRequest = connected; entry.at.closeRequested = performance.now(); this.lastRequest = entry.at.closeRequested;
      entry.close = 'pending';
      // Asked in the same turn as the connection was read.
      try { entry.closing = browser.close(); } catch (error) { entry.closing = Promise.reject(error); }
      entry.closing.then(() => {
        entry.close = 'fulfilled'; entry.at.closeSettled = performance.now();
        if (connected) { entry.end = 'proven'; release('proof'); } else entry.end = 'disconnected-before-close';
      }, () => { entry.close = 'rejected'; entry.at.closeSettled = performance.now(); entry.end = 'close-failed'; });
      return entry.closing;
    };
    const count = (result: CloseResult): CloseResult => { entry.callers[result.outcome]++; return result; };
    return {
      id: entry.id,
      launch: start => {
        if (entry.launch !== 'unused' || entry.slot !== 'held') throw new Error('A browser lease launches once');
        entry.launch = 'pending';
        let launching: Promise<ChromiumLaunch>;
        try { launching = start(); } catch (error) { launching = Promise.reject(error); }
        launching.then(({ browser }) => {
          entry.launch = 'resolved'; entry.at.launchSettled = performance.now(); entry.browser = browser;
          browser.on('disconnected', () => { entry.at.disconnected ??= performance.now(); });
          // A caller that gave up before the browser arrived: the late browser goes to its one close.
          if (entry.closeWanted) void requestClose(browser).catch(() => undefined);
        }, () => {
          entry.launch = 'rejected'; entry.end = 'launch-rejected'; entry.at.launchSettled = performance.now(); this.lastRequest = entry.at.launchSettled;
          // Playwright's own close of a spawned child runs on after the rejection, its forced end at most
          // 30 s later; the slot (and the sink) stay until then and 5 s more.
          setTimeout(() => release('launch-wait'), this.holdMs).unref();
        });
        return launching;
      },
      close: async (deadline = closeDeadline()) => {
        if (entry.launch === 'unused') { entry.end = 'none'; release('unused'); return count(CANCELLED); }
        if (entry.launch === 'pending') { entry.closeWanted = true; return count(CANCELLED); }
        if (entry.launch === 'rejected' || !entry.browser) return count(CANCELLED);
        return count(await settleBy(requestClose(entry.browser), deadline));
      },
      onRelease: callback => { if (entry.slot === 'held') entry.released.push(callback); else queueMicrotask(() => { void Promise.resolve().then(callback).catch(() => undefined); }); },
      get released() { return entry.slot !== 'held'; },
      record: () => snapshot(entry),
    };
  }
  /** Hands freed slots to waiting starts, in call order. */
  private grant(): void {
    while (this.waiting.length > 0 && this.unreleased() < this.budget) { const waiter = this.waiting[0]!; waiter.grant(this.lease(waiter.owner, waiter.asked)); }
  }
  /** Keeps every unreleased entry and, of the released ones, the latest up to `LEDGER_KEEP` in all. */
  private trim(): void {
    while (this.entries.length > LEDGER_KEEP) { const index = this.entries.findIndex(entry => entry.slot !== 'held'); if (index < 0) return; this.entries.splice(index, 1); }
  }
}

const snapshot = (entry: Entry): LedgerRecord => ({
  id: entry.id, owner: entry.owner, launch: entry.launch, close: entry.close, callers: { ...entry.callers },
  ...(entry.connectedAtRequest === undefined ? {} : { connectedAtRequest: entry.connectedAtRequest }),
  end: entry.end, slot: entry.slot, cleanup: 'unconfirmed', at: { ...entry.at },
});

/** The ledger of this process: every product browser reserves its slot here. */
export const processLedger = new BrowserLedger();

/** The part of Playwright's `chromium` an owner launches with; tests pass a fake. */
export interface ChromiumLauncher { launch(options?: LaunchOptions): Promise<Browser> }
export interface StartSettings {
  ledger?: BrowserLedger | undefined;
  /** How long the start may wait for a slot (default: the launch bound). */
  waitMs?: number | undefined;
  signal?: AbortSignal | undefined;
  cancelled?: () => Error;
  context?: LaunchContext | undefined;
}
/** Reserves a slot, then starts Chromium the one way (PADR-0032). A launch that rejects keeps its slot
 * for the launch wait; the caller closes the browser through the lease. */
export async function startBrowser(owner: BrowserOwner, chromium: ChromiumLauncher, options: () => LaunchOptions, settings: StartSettings = {}): Promise<ChromiumLaunch & { lease: BrowserLease }> {
  // A sandbox setting that is refused launches nothing, so it takes no slot (it would be held 35 s).
  chromiumSandboxPolicy(settings.context?.env ?? process.env);
  const lease = await (settings.ledger ?? processLedger).reserve(owner, { waitMs: settings.waitMs ?? BROWSER_BOUNDS.launch, signal: settings.signal, ...(settings.cancelled ? { cancelled: settings.cancelled } : {}) });
  const launched = await lease.launch(() => launchChromium(chromium, options, settings.context));
  return { ...launched, lease };
}

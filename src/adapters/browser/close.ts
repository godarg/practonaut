/**
 * The one close contract for every browser Practonaut starts (PADR-0050, decisions 2 and 3).
 *
 * A close takes a **deadline** (a `performance.now()` time) from its caller, by default the request
 * plus 8 s, and always settles by it with an outcome: **closed** (Playwright's close fulfilled),
 * **failed** (it rejected), **abandoned** (still running at the deadline) or **cancelled** (a start
 * that was stopped before any browser existed). It never throws. Every layer above passes its own
 * deadline down and reads the outcome; none arms a timer of its own that ends at or before a deadline
 * it handed down. A safety timer above the contract ends later than every deadline it hands down, and
 * its firing counts as *failed*.
 *
 * After the deadline the caller goes on: work that succeeded is not failed by an *abandoned* close,
 * and after a failure the failure is what the caller gets, with the close next to it
 * (`closeAfterFailure`, issue #64).
 */
import { BrowserDeadlineError, CLOSE_BOUND_MS } from './bounded.ts';

export type CloseOutcome = 'closed' | 'failed' | 'abandoned' | 'cancelled';
export interface CloseResult { readonly outcome: CloseOutcome; readonly error?: unknown }
/** What a close under the contract returns; a close that returns nothing counts as *closed*. */
export type Closing = Promise<CloseResult | void>;
/** A close that takes the caller's deadline. */
export type CloseWithin = (deadline: number) => Closing | undefined;

export const CLOSED: CloseResult = Object.freeze({ outcome: 'closed' });
export const CANCELLED: CloseResult = Object.freeze({ outcome: 'cancelled' });
/** How much later than the deadline it handed down a safety timer above the contract fires. */
export const CLOSE_SAFETY_MS = 1_000;

/** The default deadline of a close: the request plus 8 s (graceful 3 s + forced 5 s). */
export const closeDeadline = (from: number = performance.now()): number => from + CLOSE_BOUND_MS;

/** The outcome of `work` by `deadline`: *closed* when it fulfils, *failed* when it rejects, *abandoned*
 * when it still runs at the deadline. `work` goes on after the deadline; nothing ends it here. */
export function settleBy(work: Promise<unknown>, deadline: number): Promise<CloseResult> {
  return new Promise<CloseResult>(resolve => {
    const timer = setTimeout(() => resolve({ outcome: 'abandoned' }), Math.max(0, deadline - performance.now()));
    work.then(() => { clearTimeout(timer); resolve(CLOSED); }, (error: unknown) => { clearTimeout(timer); resolve({ outcome: 'failed', error }); });
  });
}

/** A step of an owner's close that has no slot of its own (a browser context's close, decision 7),
 * under the contract: settles by `deadline`; a step still running is ended by its browser's one close. */
export const closeStep = (close: () => Promise<unknown>, deadline: number): Promise<CloseResult> => settleBy(Promise.resolve().then(close), deadline);

/**
 * A close under the contract, called by a layer above it. `close` gets `deadline` and settles by it.
 * A close that returns nothing is *closed*, one that throws is *failed*. A close that does not keep the
 * contract is cut by a safety timer at `safetyAt` (by default `CLOSE_SAFETY_MS` after the deadline,
 * never earlier than the deadline): that is *failed*, with a `BrowserDeadlineError` (operation `close`).
 */
export async function closeBy(close: CloseWithin, deadline: number = closeDeadline(), safetyAt: number = deadline + CLOSE_SAFETY_MS): Promise<CloseResult> {
  const requested = performance.now(), limit = Math.max(safetyAt, deadline) - requested;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const safety = new Promise<CloseResult>(resolve => { timer = setTimeout(() => resolve({ outcome: 'failed', error: new BrowserDeadlineError('close', Math.max(1, limit)) }), Math.max(1, limit)); });
  const closing = Promise.resolve().then(() => close(deadline)).then((value): CloseResult => value ?? CLOSED, (error: unknown): CloseResult => ({ outcome: 'failed', error }));
  try { return await Promise.race([closing, safety]); }
  finally { clearTimeout(timer); }
}

/** The worst of several close outcomes: *failed*, then *abandoned*, then *closed*; *cancelled* only
 * when every close was cancelled. The first failure's error is kept. */
export function worstOutcome(results: readonly CloseResult[]): CloseResult {
  return results.find(result => result.outcome === 'failed') ?? results.find(result => result.outcome === 'abandoned')
    ?? (results.length > 0 && results.every(result => result.outcome === 'cancelled') ? CANCELLED : CLOSED);
}

/** The error a caller keeps for a close that did not close: an *abandoned* close is a
 * `BrowserDeadlineError` (operation `close`) with the time it had; a *failed* close its own error. */
export function closeErrorOf(result: CloseResult, hadMs: number): unknown {
  if (result.outcome === 'abandoned') return new BrowserDeadlineError('close', Math.max(1, hadMs));
  if (result.outcome === 'failed') return result.error ?? new Error('Browser close failed');
  return undefined;
}

/**
 * Closes after `failure` without replacing it (issue #64): `close` runs under the contract with
 * `deadline`, and this never throws. A close that was *abandoned* (`BrowserDeadlineError`, operation
 * `close`) or *failed* is kept next to the failure as its `closeError`, as `AdapterInitializationError`
 * keeps its `cleanupError`: not enumerable, so a reply or a log that serialises the failure is
 * unchanged. When several closes after the same failure did not close, `closeError` is an
 * `AggregateError` of all of them, in order. A failure that is not an extensible object cannot carry
 * it. Returns `failure` for the caller to rethrow: `throw await closeAfterFailure(error, d => adapter.close(d))`.
 */
export async function closeAfterFailure<E>(failure: E, close: CloseWithin, deadline: number = closeDeadline()): Promise<E> {
  const requested = performance.now();
  const closeError = closeErrorOf(await closeBy(close, deadline), deadline - requested);
  if (closeError === undefined) return failure;
  const holder = failure as unknown;
  if (((typeof holder === 'object' && holder !== null) || typeof holder === 'function') && Object.isExtensible(holder)) {
    const earlier = Object.hasOwn(holder, 'closeError') ? (holder as { closeError: unknown }).closeError : undefined;
    const value = earlier === undefined ? closeError : new AggregateError([...(collected.has(earlier as object) ? (earlier as AggregateError).errors : [earlier]), closeError], 'Several closes after the failure did not close');
    if (value instanceof AggregateError) collected.add(value);
    Object.defineProperty(holder, 'closeError', { value, configurable: true, writable: true, enumerable: false });
  }
  return failure;
}
/** The aggregates `closeAfterFailure` made itself, so that a later failure is added to them. */
const collected = new WeakSet<object>();

/**
 * Runs `work`, then `close` under the contract. When `work` fails, its failure is what the caller
 * gets, with a close that did not close next to it (`closeAfterFailure`). When `work` succeeds, an
 * *abandoned* close does not fail it (decision 3); a *failed* close does.
 */
export async function withClose<T>(work: () => Promise<T>, close: CloseWithin): Promise<T> {
  let value: T;
  try { value = await work(); } catch (failure) { throw await closeAfterFailure(failure, close); }
  const result = await closeBy(close);
  if (result.outcome === 'failed') throw result.error;
  return value;
}

/** The reason a close aborts a running start with: whatever the start has to close then closes under
 * the same deadline, never a later default (decision 8). */
export class CloseRequested extends Error {
  readonly deadline: number;
  constructor(deadline: number) { super('Closed while starting'); this.name = 'CloseRequested'; this.deadline = deadline; }
}
/** The deadline a close handed down through an abort signal, if any. */
export const deadlineOf = (signal: AbortSignal | undefined): number | undefined => signal?.aborted && signal.reason instanceof CloseRequested ? signal.reason.deadline : undefined;

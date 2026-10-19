import { ADAPTER_REGISTRY, EXCALIDRAW_APP, readBackAgrees, resolveAdapter, type AdapterRegistry, type ReadBackComparison } from '../adapters/registry.ts';
import { AdapterInitializationError, type EngineLifecycleProbe } from '../adapters/browser/shell.ts';
import { CANCELLED, CLOSED, CloseRequested, closeAfterFailure, closeBy, closeDeadline, worstOutcome, type CloseResult } from '../adapters/browser/close.ts';
import type { AdapterResult, MirrorAdapter, Transition } from '../adapters/types.ts';
import type { State, World } from '../world/types.ts';
import type {TransactionContext} from './protocol.ts';

/** Target is 2 s per ordinary step; deadline is 5 s for slow offline hardware. */
export const MIRROR_LATENCY_TARGET_MS = 2_000;
export const MIRROR_DEADLINE_MS = 5_000;
export const HOST_TRANSACTION_MS=MIRROR_DEADLINE_MS;
export const MIN_MIRROR_REMAINING_MS=50;
export interface PracticeMirror {
  apply(transition: Transition, context?:TransactionContext): Promise<AdapterResult>;
  replace(state: State, context?:TransactionContext): Promise<AdapterResult>;
  snapshot(context?:TransactionContext): Promise<State>;
  png(context?:TransactionContext): Promise<Uint8Array>;
  exportNative?(context?:TransactionContext):Promise<string>;
  /** The real engine's SVG export of its current scene (bench report pictures, PADR-0039). */
  exportPicture?(context?:TransactionContext):Promise<string>;
  /** Restores the committed state, replacing the browser when needed. `oldClosed` learns how the old
   * browser's close settled when it was replaced (PADR-0050), so the owner can record an abandoned one. */
  recover(state: State, oldClosed?: (result: CloseResult) => unknown): Promise<void>;
  /** Closes under the close contract: settles by `deadline` (default: now plus 8 s) as closed,
   * abandoned, failed or cancelled (a replacement start stopped before its browser existed). */
  close(deadline?: number): Promise<CloseResult | void>;
  /** What the host compares with this mirror's read-back (PADR-0045): `full` (tombstones included)
   * when absent, `live` for an app that keeps no deleted objects. */
  readonly readBack?: ReadBackComparison;
}
/** What a mirror needs to know about its world: the app it names and the world schema. */
export type MirrorWorld = Pick<World, 'app' | 'schema'>;
/** Creates the mirror for a world's app; the adapter comes from the registry (PADR-0045). */
export type MirrorFactory = (state: State, world: MirrorWorld) => Promise<PracticeMirror>;
export class MirrorFault extends Error {
  readonly code: 'mirror_timeout' | 'mirror_unavailable';
  constructor(code: MirrorFault['code'], message: string) { super(message); this.code = code; }
}
/** The Excalidraw world a test probe mirrors when it names none. */
const PROBE_WORLD: MirrorWorld = { app: { ...EXCALIDRAW_APP, fontFamilies: [3], excludedAttributes: {} }, schema: 'practonaut.world/2' };
/** Production mirror and test probe share the same lifecycle; the probe controls a real process.
 * The adapter is resolved through the registry before anything starts: a world naming an app this
 * Practonaut does not have is refused by name (`E_ADAPTER_*`), and no browser is launched.
 *
 * Every close goes through the close contract (PADR-0050): the mirror passes its deadline down and
 * reads the outcome; its only own timer is a safety timer after that deadline. A recovery that has to
 * replace the browser takes its deadline in two parts: the old browser's close against the contract's
 * 8 s (an old browser that is still closing keeps its slot and sink until its end is proven; it is
 * another process with its own page, profile and sink, so none of its late writes reaches the
 * replacement), then the replacement's start within the shell's launch and start bounds and its
 * read-back within `MIRROR_DEADLINE_MS`. The start gets an abort signal: the mirror's close does not
 * wait behind a recovery but stops its start and closes what exists under the close's own deadline. */
export async function createProductionMirror(initial: State, probe?: EngineLifecycleProbe, world: MirrorWorld = PROBE_WORLD, registry: AdapterRegistry = ADAPTER_REGISTRY): Promise<PracticeMirror> {
  const registration = resolveAdapter(world.app, world.schema, registry);
  const agrees = (readBack: State, expected: State): boolean => readBackAgrees(registration.readBack, readBack, expected);
  let adapter: MirrorAdapter | undefined = await registration.create(initial, { timeoutMs: MIRROR_DEADLINE_MS }, probe);
  let interrupted = false, closed = false;
  /** The deadline of the mirror's close, once it was asked to close. */
  let closing: number | undefined;
  /** A recovery's replacement start that is still running, and how to stop it. */
  let starting: { stop: AbortController; start: Promise<MirrorAdapter> } | undefined;
  let lifecycle: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = lifecycle.then(operation, operation); lifecycle = pending.catch(() => undefined); return pending;
  };
  const unavailable = (): MirrorFault => new MirrorFault('mirror_unavailable', closed ? 'Mirror closed' : 'Mirror is unavailable');
  const bounded = async <T>(operation: (engine: MirrorAdapter,remaining:number) => Promise<T>,context?:TransactionContext): Promise<T> => {
    if (closed || !adapter) throw unavailable();
    const remaining=Math.min(MIRROR_DEADLINE_MS,context?context.deadline-performance.now():MIRROR_DEADLINE_MS);
    if(remaining<=0)throw new MirrorFault('mirror_timeout','Mirror deadline reached');
    const current = adapter;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([operation(current,remaining), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { interrupted = true; reject(new MirrorFault('mirror_timeout', 'Mirror deadline reached')); }, remaining);
      })]);
      if(context&&performance.now()>=context.deadline)throw new MirrorFault('mirror_timeout','Mirror deadline reached');
      if (closed) throw unavailable();
      return result;
    } catch (error) {
      interrupted = true;
      if (error instanceof MirrorFault) throw error;
      throw new MirrorFault('mirror_unavailable', 'Real engine operation failed');
    } finally { if (timer) clearTimeout(timer); }
  };
  /** An adapter's close under the contract, with the mirror's safety timer after the deadline. */
  const closeAdapter = (engine: MirrorAdapter, deadline: number): Promise<CloseResult> => closeBy(by => engine.terminate(by), deadline);
  // The current adapter is gone from the mirror at once; its close settles by the deadline.
  const dispose = async (deadline: number = closing ?? closeDeadline()): Promise<CloseResult> => { const old = adapter; adapter = undefined; return old ? closeAdapter(old, deadline) : CLOSED; };
  /** A stopped start, settled under the close's deadline: a replacement that arrived goes to its one
   * close; a start that failed reports its own browser's close, or *cancelled* when no browser existed. */
  const startClosed = (start: Promise<MirrorAdapter>, deadline: number): Promise<CloseResult> => closeBy(() => start.then(
    replacement => closeAdapter(replacement, deadline),
    (error: unknown) => error instanceof AdapterInitializationError && error.closeResult ? error.closeResult : CANCELLED), deadline);
  return {
    readBack: registration.readBack,
    apply: (transition,context) => bounded((engine,remaining) => engine.apply(transition, { timeoutMs: remaining }),context),
    replace: (state,context) => bounded((engine,remaining) => engine.restoreState(state, { timeoutMs: remaining }),context),
    snapshot: context => bounded(engine => engine.snapshot(),context),
    png: context => bounded(engine => engine.renderPng(),context),
    exportNative:context=>bounded(async(engine,remaining)=>(await engine.exportArtifact({timeoutMs:remaining})).native,context),
    exportPicture:context=>bounded(async(engine,remaining)=>(await engine.exportArtifact({timeoutMs:remaining})).svg,context),
    recover: (state, oldClosed) => serial(async () => {
      if (closed) throw unavailable();
      try {
        if (interrupted || !adapter) {
          // Part one: the old browser's close against the contract's 8 s; late writes die with its page.
          const old = await dispose();
          try { await oldClosed?.(old); } catch { /* An observer cannot fail the recovery. */ }
          if (closed) throw unavailable();
          // Part two: the replacement's start, on a slot of its own, stopped by the mirror's close.
          const stop = new AbortController(), start = registration.create(state, { timeoutMs: MIRROR_DEADLINE_MS, signal: stop.signal }, probe);
          starting = { stop, start };
          let replacement: MirrorAdapter;
          try { replacement = await start; } finally { if (starting?.start === start) starting = undefined; }
          // A close during the start already stopped it and closes this replacement; it is never published.
          if (closed) throw await closeAfterFailure(unavailable(), deadline => replacement.terminate(deadline), closing);
          adapter = replacement; interrupted = false;
        } else {
          const restored = await bounded(engine => engine.restoreState(state, { timeoutMs: MIRROR_DEADLINE_MS }));
          if (!restored.ok || !agrees(restored.state, state)) throw new MirrorFault('mirror_unavailable', 'Mirror rollback failed');
        }
        if (!agrees(await bounded(engine => engine.snapshot()), state)) throw new MirrorFault('mirror_unavailable', 'Mirror recovery read-back differs');
      } catch (error) { interrupted = true; throw await closeAfterFailure(error, deadline => dispose(deadline), closing); }
    }),
    // Never waits in the serial queue behind a recovery: it marks the mirror closed, stops a running
    // start, closes the current adapter and a replacement that has arrived under its own deadline.
    close: async (deadline = closeDeadline()) => {
      closed = true; closing ??= deadline; // Synchronous terminal marker; queued recovery can never relaunch.
      const closes: Array<Promise<CloseResult>> = adapter ? [dispose(deadline)] : [];
      const running = starting;
      if (running) { running.stop.abort(new CloseRequested(deadline)); closes.push(startClosed(running.start, deadline)); }
      return closes.length > 0 ? worstOutcome(await Promise.all(closes)) : CLOSED;
    },
  };
}
export const createPracticeMirror: MirrorFactory = (initial, world) => createProductionMirror(initial, undefined, world);

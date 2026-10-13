import { createExcalidrawAdapter } from '../adapters/excalidraw/index.ts';
import type { ExcalidrawAdapter, EngineLifecycleProbe } from '../adapters/excalidraw/index.ts';
import type { AdapterResult, Transition } from '../adapters/types.ts';
import type { State } from '../world/types.ts';
import { isDeepStrictEqual } from 'node:util';
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
  recover(state: State): Promise<void>;
  close(): Promise<void>;
}
export type MirrorFactory = (state: State) => Promise<PracticeMirror>;
export class MirrorFault extends Error {
  readonly code: 'mirror_timeout' | 'mirror_unavailable';
  constructor(code: MirrorFault['code'], message: string) { super(message); this.code = code; }
}
/** Production mirror and test probe share the same lifecycle; the probe controls a real process. */
export async function createProductionMirror(initial: State, probe?: EngineLifecycleProbe): Promise<PracticeMirror> {
  let adapter: ExcalidrawAdapter | undefined = await createExcalidrawAdapter(initial, { timeoutMs: MIRROR_DEADLINE_MS }, probe);
  let interrupted = false, closed = false;
  let lifecycle: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = lifecycle.then(operation, operation); lifecycle = pending.catch(() => undefined); return pending;
  };
  const unavailable = (): MirrorFault => new MirrorFault('mirror_unavailable', closed ? 'Mirror closed' : 'Mirror is unavailable');
  const bounded = async <T>(operation: (engine: ExcalidrawAdapter,remaining:number) => Promise<T>,context?:TransactionContext): Promise<T> => {
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
  const dispose = async (): Promise<void> => { const old = adapter; adapter = undefined; if (old) await old.terminate(); };
  return {
    apply: (transition,context) => bounded((engine,remaining) => engine.apply(transition, { timeoutMs: remaining }),context),
    replace: (state,context) => bounded((engine,remaining) => engine.restoreState(state, { timeoutMs: remaining }),context),
    snapshot: context => bounded(engine => engine.snapshot(),context),
    png: context => bounded(engine => engine.renderPng(),context),
    exportNative:context=>bounded(async(engine,remaining)=>(await engine.exportArtifact({timeoutMs:remaining})).native,context),
    recover: state => serial(async () => {
      if (closed) throw unavailable();
      try {
        if (interrupted || !adapter) {
          await dispose(); // Destroy late writes before another browser exists.
          if (closed) throw unavailable();
          const replacement = await createExcalidrawAdapter(state, { timeoutMs: MIRROR_DEADLINE_MS }, probe);
          // Close can happen during Chromium startup. The replacement must be killed before publication.
          if (closed) { await replacement.terminate(); throw unavailable(); }
          adapter = replacement; interrupted = false;
        } else {
          const restored = await bounded(engine => engine.restoreState(state, { timeoutMs: MIRROR_DEADLINE_MS }));
          if (!restored.ok || !isDeepStrictEqual(restored.state, state)) throw new MirrorFault('mirror_unavailable', 'Mirror rollback failed');
        }
        if (!isDeepStrictEqual(await bounded(engine => engine.snapshot()), state)) throw new MirrorFault('mirror_unavailable', 'Mirror recovery read-back differs');
      } catch (error) { interrupted = true; await dispose(); throw error; }
    }),
    close: async () => {
      closed = true; // Synchronous terminal marker; queued recovery can never relaunch.
      await dispose(); // Interrupt an in-flight operation, rather than queueing behind its deadline.
      await serial(async () => { await dispose(); });
    },
  };
}
export const createPracticeMirror: MirrorFactory = initial => createProductionMirror(initial);

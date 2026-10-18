import { ADAPTER_REGISTRY, EXCALIDRAW_APP, readBackAgrees, resolveAdapter, type AdapterRegistry, type ReadBackComparison } from '../adapters/registry.ts';
import type { EngineLifecycleProbe } from '../adapters/browser/shell.ts';
import { closeAfterFailure } from '../adapters/browser/bounded.ts';
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
  recover(state: State): Promise<void>;
  close(): Promise<void>;
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
 * Practonaut does not have is refused by name (`E_ADAPTER_*`), and no browser is launched. */
export async function createProductionMirror(initial: State, probe?: EngineLifecycleProbe, world: MirrorWorld = PROBE_WORLD, registry: AdapterRegistry = ADAPTER_REGISTRY): Promise<PracticeMirror> {
  const registration = resolveAdapter(world.app, world.schema, registry);
  const agrees = (readBack: State, expected: State): boolean => readBackAgrees(registration.readBack, readBack, expected);
  let adapter: MirrorAdapter | undefined = await registration.create(initial, { timeoutMs: MIRROR_DEADLINE_MS }, probe);
  let interrupted = false, closed = false;
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
  const dispose = async (): Promise<void> => { const old = adapter; adapter = undefined; if (old) await old.terminate(); };
  return {
    readBack: registration.readBack,
    apply: (transition,context) => bounded((engine,remaining) => engine.apply(transition, { timeoutMs: remaining }),context),
    replace: (state,context) => bounded((engine,remaining) => engine.restoreState(state, { timeoutMs: remaining }),context),
    snapshot: context => bounded(engine => engine.snapshot(),context),
    png: context => bounded(engine => engine.renderPng(),context),
    exportNative:context=>bounded(async(engine,remaining)=>(await engine.exportArtifact({timeoutMs:remaining})).native,context),
    exportPicture:context=>bounded(async(engine,remaining)=>(await engine.exportArtifact({timeoutMs:remaining})).svg,context),
    recover: state => serial(async () => {
      if (closed) throw unavailable();
      try {
        if (interrupted || !adapter) {
          await dispose(); // Destroy late writes before another browser exists.
          if (closed) throw unavailable();
          const replacement = await registration.create(state, { timeoutMs: MIRROR_DEADLINE_MS }, probe);
          // Close can happen during Chromium startup. The replacement must be killed before publication.
          if (closed) throw await closeAfterFailure(unavailable(), () => replacement.terminate());
          adapter = replacement; interrupted = false;
        } else {
          const restored = await bounded(engine => engine.restoreState(state, { timeoutMs: MIRROR_DEADLINE_MS }));
          if (!restored.ok || !agrees(restored.state, state)) throw new MirrorFault('mirror_unavailable', 'Mirror rollback failed');
        }
        if (!agrees(await bounded(engine => engine.snapshot()), state)) throw new MirrorFault('mirror_unavailable', 'Mirror recovery read-back differs');
      } catch (error) { interrupted = true; throw await closeAfterFailure(error, dispose); }
    }),
    close: async () => {
      closed = true; // Synchronous terminal marker; queued recovery can never relaunch.
      await dispose(); // Interrupt an in-flight operation, rather than queueing behind its deadline.
      await serial(async () => { await dispose(); });
    },
  };
}
export const createPracticeMirror: MirrorFactory = (initial, world) => createProductionMirror(initial, undefined, world);

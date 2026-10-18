/**
 * The adapter registry (PADR-0045): the adapters this Practonaut has, chosen by a world's
 * `app.adapterId`. Each entry names the pinned app versions and world schemas it runs, how its app
 * arrives (`bundled` in the npm package, or `downloaded` by an explicit setup step), what the host
 * compares with its read-back, and its factory. A unit test keeps the ids, versions and schemas
 * equal to the world's table of known apps (`src/world/apps.ts`) and the ids equal to the checker's
 * format table (`src/checker/formats.ts`).
 */
import { isDeepStrictEqual } from 'node:util';
import { refuseUnknownApp, type KnownApp } from '../world/apps.ts';
import type { AdapterId, AppVersion, State, WorldApp, WorldSchemaId } from '../world/types.ts';
import type { EngineLifecycleProbe } from './browser/shell.ts';
import { createExcalidrawAdapter } from './excalidraw/index.ts';
import type { AdapterOptions, MirrorAdapter } from './types.ts';

/** How the app's runtime arrives: built into the npm package, or downloaded unmodified by setup. */
export type RuntimeKind = 'bundled' | 'downloaded';
/**
 * What the host compares with the adapter's read-back: `full` — the whole state, tombstones
 * included (the app keeps deleted objects); `live` — live objects only (the app keeps no deleted
 * objects, so the core alone holds the tombstones).
 */
export type ReadBackComparison = 'full' | 'live';
export interface AdapterRegistration<A extends MirrorAdapter = MirrorAdapter> extends KnownApp {
  readonly id: AdapterId;
  readonly appVersions: readonly AppVersion[];
  readonly schemas: readonly WorldSchemaId[];
  readonly runtime: RuntimeKind;
  readonly readBack: ReadBackComparison;
  create(initial: State, options?: AdapterOptions, probe?: EngineLifecycleProbe): Promise<A>;
}

const EXCALIDRAW = Object.freeze({
  id: 'excalidraw', appVersions: Object.freeze(['0.18.1'] as const), schemas: Object.freeze(['practonaut.world/1', 'practonaut.world/2'] as const),
  runtime: 'bundled', readBack: 'full', create: createExcalidrawAdapter,
} as const);
export const ADAPTER_REGISTRY = Object.freeze({ excalidraw: EXCALIDRAW } satisfies { readonly [K in AdapterId]: AdapterRegistration });
export type AdapterRegistry = Readonly<Record<string, AdapterRegistration>>;

/**
 * The adapter for a world's app, refused by name when this Practonaut has none:
 * `E_ADAPTER_UNKNOWN`, `E_ADAPTER_SCHEMA_UNSUPPORTED` or `E_ADAPTER_VERSION_UNSUPPORTED` (a
 * `WorldError`). Nothing is started. `registry` is a parameter only so tests can use a stub.
 */
export function resolveAdapter<I extends AdapterId>(app: { adapterId: I; versionRange: string }, schema: WorldSchemaId): (typeof ADAPTER_REGISTRY)[I];
export function resolveAdapter(app: { adapterId: string; versionRange: string }, schema: WorldSchemaId, registry?: AdapterRegistry): AdapterRegistration;
export function resolveAdapter(app: { adapterId: string; versionRange: string }, schema: WorldSchemaId, registry: AdapterRegistry = ADAPTER_REGISTRY): AdapterRegistration {
  refuseUnknownApp(registry, { adapterId: app.adapterId, versionRange: app.versionRange }, schema);
  return registry[app.adapterId]!;
}
/** The Excalidraw app every world/1 and the bundled library name; tests and tools use it. */
export const EXCALIDRAW_APP = Object.freeze({ adapterId: 'excalidraw', versionRange: '0.18.1' } as const satisfies WorldApp);

/** Does the adapter's read-back agree with the expected state, on what its app can hold? */
export function readBackAgrees(comparison: ReadBackComparison, readBack: State, expected: State): boolean {
  if (comparison === 'full') return isDeepStrictEqual(readBack, expected);
  const live = (state: State): State['objects'] => Object.fromEntries(Object.entries(state.objects).filter(([, object]) => !object.deleted));
  return isDeepStrictEqual(live(readBack), live(expected));
}

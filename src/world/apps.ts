/**
 * The applications a world may name in `app.adapterId` (PADR-0045): adapter id → the pinned app
 * versions it is confirmed for and the world schemas it runs. Data only: the adapters themselves
 * live in `src/adapters` (the registry), and the checker keeps its own format table; unit tests keep
 * all three equal. A world naming anything else is refused by name before anything starts.
 */
import type { StructuralConstraint } from "./constraints.ts";
import { WorldError } from "./preflight.ts";
import type { WorldSchemaId } from "./types.ts";

export interface KnownApp { readonly appVersions: readonly string[]; readonly schemas: readonly WorldSchemaId[] }
/** A world-table entry: besides versions and schemas, the structural constraints the application
 * imposes (PADR-0049 decision 1.2) and its fixed display name (decision 1.5). Both are project text
 * and data, never taken from a world. */
export interface AppEntry extends KnownApp {
  readonly structural: readonly StructuralConstraint[];
  readonly displayName: Readonly<{ en: string; de: string }>;
}
export const KNOWN_APPS = Object.freeze({
  excalidraw: Object.freeze({ appVersions: Object.freeze(["0.18.1"] as const), schemas: Object.freeze(["practonaut.world/1", "practonaut.world/2"] as const), structural: Object.freeze([] as StructuralConstraint[]), displayName: Object.freeze({ en: "Excalidraw", de: "Excalidraw" }) }),
  // draw.io keeps one parent per cell and stores text as XML (PADR-0049 decision 5.2).
  drawio: Object.freeze({ appVersions: Object.freeze(["32.4.1"] as const), schemas: Object.freeze(["practonaut.world/2"] as const), structural: Object.freeze(["group-within-one-frame", "xml-text"] as StructuralConstraint[]), displayName: Object.freeze({ en: "draw.io", de: "draw.io" }) }),
} satisfies Record<string, AppEntry>);
export type AdapterId = keyof typeof KNOWN_APPS;
export type AppVersion = (typeof KNOWN_APPS)[AdapterId]["appVersions"][number];
export const ADAPTER_IDS = Object.freeze(Object.keys(KNOWN_APPS) as AdapterId[]);
/** The adapters that run worlds of `schema`, and every app version among them (the schemas' value lists). */
export const adapterIdsFor = (schema: WorldSchemaId): AdapterId[] => ADAPTER_IDS.filter(id => (KNOWN_APPS[id].schemas as readonly string[]).includes(schema));
export const appVersionsFor = (schema: WorldSchemaId): AppVersion[] => [...new Set(adapterIdsFor(schema).flatMap(id => KNOWN_APPS[id].appVersions))];
/** The structural constraints a world's application declares (none for an id the table lacks, which
 * world validation refuses before anything runs). */
export function structuralConstraintsOf(adapterId: string): readonly StructuralConstraint[] {
  return Object.hasOwn(KNOWN_APPS, adapterId) ? KNOWN_APPS[adapterId as AdapterId].structural : [];
}
/** The fixed display name of an application, for every text that names the running app. */
export function appDisplayName(adapterId: string, language: "en" | "de" = "en"): string {
  return Object.hasOwn(KNOWN_APPS, adapterId) ? KNOWN_APPS[adapterId as AdapterId].displayName[language] : adapterId;
}

/** Quoted, shortened world text for a message (the CLI escapes it again when printing). */
const shown = (value: string): string => JSON.stringify(value.length > 64 ? value.slice(0, 64) + "…" : value);

/**
 * Refuses an application `apps` does not list, by name: `E_ADAPTER_UNKNOWN` (no such adapter),
 * `E_ADAPTER_SCHEMA_UNSUPPORTED` (not for this world schema), `E_ADAPTER_VERSION_UNSUPPORTED` (not
 * for this app version). Shared by world validation and the adapter registry, each with its own table.
 */
export function refuseUnknownApp(apps: Readonly<Record<string, KnownApp>>, app: { adapterId: string; versionRange?: string; appVersion?: string }, schema: WorldSchemaId): void {
  const known = Object.keys(apps).sort().join(", ");
  if (!Object.hasOwn(apps, app.adapterId)) throw new WorldError(`app.adapterId ${shown(app.adapterId)} names no application this Practonaut has (known: ${known})`, "E_ADAPTER_UNKNOWN");
  const entry = apps[app.adapterId]!;
  if (!entry.schemas.includes(schema)) throw new WorldError(`adapter ${shown(app.adapterId)} does not run ${schema} worlds (it runs ${entry.schemas.join(", ")})`, "E_ADAPTER_SCHEMA_UNSUPPORTED");
  for (const [field, version] of [["app.versionRange", app.versionRange], ["provenance.appVersion", app.appVersion]] as const) {
    if (version !== undefined && !entry.appVersions.includes(version)) throw new WorldError(`${field} ${shown(version)} is not a version adapter ${shown(app.adapterId)} supports (supported: ${entry.appVersions.join(", ")})`, "E_ADAPTER_VERSION_UNSUPPORTED");
  }
}

/**
 * Pre-check of a raw world before its schema parse: when the world states its app as strings, an
 * application this Practonaut does not have is refused by name. Other shapes are left to the schema
 * (`E_WORLD_INVALID`). `apps` is a parameter only so tests can use a stub table.
 */
export function checkWorldApp(raw: unknown, apps: Readonly<Record<string, KnownApp>> = KNOWN_APPS): void {
  if (!raw || typeof raw !== "object") return;
  const { schema, app, provenance } = raw as { schema?: unknown; app?: unknown; provenance?: unknown };
  if (schema !== "practonaut.world/1" && schema !== "practonaut.world/2") return;
  if (!app || typeof app !== "object") return;
  const { adapterId, versionRange } = app as { adapterId?: unknown; versionRange?: unknown };
  if (typeof adapterId !== "string") return;
  const appVersion = provenance && typeof provenance === "object" ? (provenance as { appVersion?: unknown }).appVersion : undefined;
  refuseUnknownApp(apps, { adapterId, ...(typeof versionRange === "string" ? { versionRange } : {}), ...(typeof appVersion === "string" ? { appVersion } : {}) }, schema);
}

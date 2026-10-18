/**
 * The checker's own table of native export formats, by the world's adapter id (PADR-0045). It never
 * imports `src/adapters` or `src/core` (architecture §2): the parsers are the checker's own. A unit
 * test keeps its ids equal to the adapter registry's and to the world's table of known apps.
 */
import { canonicalJson } from "../canonical/index.ts";
import type { State, WorldSchemaId } from "../world/types.ts";
import { CheckerError } from "./errors.ts";
import { parseExcalidraw } from "./excalidraw.ts";
import { parseScene } from "./scene.ts";
import { parseDrawio } from "./drawio.ts";

export interface NativeFormat {
  /** The adapter id of the worlds whose exports this format reads. */
  readonly id: string;
  /** File name extension of a native export, with its dot. */
  readonly extension: string;
  /** Reads a native export of a world of `schema` into the state the goal is judged on. */
  parse(schema: WorldSchemaId, input: string | Uint8Array): State;
  /** Whether a native export carries exactly this session state, on what the format can hold. */
  matches(schema: WorldSchemaId, input: string | Uint8Array, state: State): boolean;
}

const live = (state: State): State => ({ objects: Object.fromEntries(Object.entries(state.objects).filter(([, object]) => !object.deleted)) });

export const NATIVE_FORMATS = Object.freeze({
  /** world/1 keeps its strict native format (tombstones included); world/2 reads any drawing with
   * the tolerant scene parser, which keeps live objects only, so both sides compare live objects. */
  excalidraw: Object.freeze({
    id: "excalidraw", extension: ".excalidraw",
    parse: (schema: WorldSchemaId, input: string | Uint8Array): State => schema === "practonaut.world/2" ? parseScene(input).state : parseExcalidraw(input),
    matches: (schema: WorldSchemaId, input: string | Uint8Array, state: State): boolean => schema === "practonaut.world/2"
      ? canonicalJson(live(parseScene(input).state)) === canonicalJson(live(state))
      : canonicalJson(parseExcalidraw(input)) === canonicalJson(state),
  }),
  /** draw.io's `.drawio` file, read by the checker's own reader (PADR-0049 decision 6). */
  drawio: Object.freeze({
    id: "drawio", extension: ".drawio",
    parse: (schema: WorldSchemaId, input: string | Uint8Array): State => { if (schema !== "practonaut.world/2") throw new CheckerError("artifact_invalid", "draw.io files belong to world/2"); return parseDrawio(input).state; },
    matches: (schema: WorldSchemaId, input: string | Uint8Array, state: State): boolean => schema === "practonaut.world/2" && canonicalJson(live(parseDrawio(input).state)) === canonicalJson(live(state)),
  }),
} satisfies Record<string, NativeFormat>);
export type NativeFormatId = keyof typeof NATIVE_FORMATS;
export const NATIVE_FORMAT_IDS = Object.freeze(Object.keys(NATIVE_FORMATS) as NativeFormatId[]);

/** The native format of a world's adapter; an adapter the checker has no parser for is refused by name. */
export function nativeFormat(app: { adapterId?: unknown } | undefined): NativeFormat {
  const id = app?.adapterId;
  if (typeof id !== "string" || !Object.hasOwn(NATIVE_FORMATS, id)) throw new CheckerError("E_ADAPTER_UNKNOWN", `the checker reads no native format of adapter ${JSON.stringify(String(id).slice(0, 64))}`);
  return NATIVE_FORMATS[id as NativeFormatId];
}

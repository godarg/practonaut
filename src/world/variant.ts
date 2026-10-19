import { stateHash } from "../canonical/index.ts";
import { validateWorld, WorldError } from "./schema.ts";
import type { Variant, World } from "./types.ts";
import { substituteTokens, variantTokens } from "./tokens.ts";

export { substituteTokens, variantTokens } from "./tokens.ts";

/** The id and version a seed's variant choice is keyed by (PADR-0044 decision 3): the world/2 task set
 * when the world names one, else the world's own id and version. Both parts are hashed, so the default
 * keeps every existing world's choice. */
export function variantKey(world: Pick<World, "id" | "version" | "taskSet">): { id: string; version: string } {
  return world.taskSet ? { id: world.taskSet.id, version: world.taskSet.version } : { id: world.id, version: world.version };
}
/** finite-seeded-v1: first 32 hash bits mod count, with exact token substitution, then integer offsets. */
export function variantIndex(world: World, seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new WorldError("seed must be a safe integer");
  return parseInt(stateHash({ world: variantKey(world), seed }).slice(0, 8), 16) % world.variants.cases.length;
}
export function selectVariant(world: World, seed: number): Variant {
  return structuredClone(world.variants.cases[variantIndex(world, seed)]!);
}
export function generateVariant(world: World, seed: number): World {
  const input = validateWorld(world);
  const variant = input.variants.cases[variantIndex(input, seed)]!;
  const tokens = variantTokens(variant);
  const substitute = (s: string): string => substituteTokens(s, tokens);
  // Only state labels, localized task text and literal string operands are templates; ids,
  // provenance, evidence and field names are never rewritten.
  const out = structuredClone(input);
  const visit = (raw: unknown): void => {
    if (!raw || typeof raw !== "object") return;
    const rec = raw as Record<string, unknown>;
    if (rec.kind === "literal" && typeof rec.value === "string") rec.value = substitute(rec.value);
    for (const value of Object.values(rec)) if (value && typeof value === "object") visit(value);
  };
  for (const state of [out.initialState, ...out.tasks.flatMap(t => t.initialState ? [t.initialState] : [])]) {
    for (const o of Object.values(state.objects)) {
      if (o.type === "frame") o.name = substitute(o.name);
      if (o.type !== "step") continue;
      o.label = substitute(o.label); o.x += variant.layoutOffset.x; o.y += variant.layoutOffset.y;
    }
  }
  for (const task of out.tasks) {
    for (const localized of [task.title, task.prompt, ...task.hints, ...task.errorClasses.map(e => e.explanation)]) {
      localized.en = substitute(localized.en); localized.de = substitute(localized.de);
    }
    for (const localized of task.conditionTexts ?? []) { localized.en = substitute(localized.en); localized.de = substitute(localized.de); }
  }
  visit(out.actions); visit(out.rules); visit(out.tasks);
  return validateWorld(out);
}

export const instantiateWorld = generateVariant;

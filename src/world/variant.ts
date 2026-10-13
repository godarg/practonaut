import { stateHash } from "../canonical/index.ts";
import { validateWorld, WorldError } from "./schema.ts";
import type { Variant, World } from "./types.ts";

/** finite-seeded-v1: first 32 hash bits mod count, with exact token substitution, then integer offsets. */
export function variantIndex(world: World, seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new WorldError("seed must be a safe integer");
  return parseInt(stateHash({ world: { id: world.id, version: world.version }, seed }).slice(0, 8), 16) % world.variants.cases.length;
}
/** {{token}} values of one case: labels, the world/1 insertion position and world/2 params. */
export function variantTokens(variant: Variant): Record<string, string> {
  const tokens: Record<string, string> = { ...variant.labels };
  if (variant.insertPosition !== undefined) tokens.insertPosition = String(variant.insertPosition);
  for (const [key, value] of Object.entries(variant.params ?? {})) tokens[key] = String(value);
  return tokens;
}
/** Exact single-pass token substitution; text inside a substituted value is never re-read. */
export function substituteTokens(s: string, tokens: Record<string, string>): string {
  let out = "";
  let cursor = 0;
  while (cursor < s.length) {
    const open = s.indexOf("{{", cursor);
    if (open < 0) return out + s.slice(cursor);
    const close = s.indexOf("}}", open + 2);
    if (close < 0) return out + s.slice(cursor);
    out += s.slice(cursor, open);
    const key = s.slice(open + 2, close);
    out += Object.hasOwn(tokens, key) ? tokens[key]! : s.slice(open, close + 2);
    cursor = close + 2;
  }
  return out;
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

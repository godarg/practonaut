import { RUNTIME_LIMITS } from "./limits.ts";

export class WorldError extends Error {
  readonly code = "E_WORLD_INVALID";
  constructor(message: string) { super(message.slice(0, 4000)); this.name = "WorldError"; }
}

/** Iterative inspection before Zod/canonical recursion; never invokes input accessors. */
export function preflightJson(raw: unknown, rejectHidden = false): void {
  const stack: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value: raw, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (stack.length) {
    const { value, depth, exit } = stack.pop()!;
    if (exit) { seen.delete(value as object); continue; }
    if (++nodes > RUNTIME_LIMITS.maxJsonNodes) throw new WorldError("JSON node limit exceeded");
    if (depth > RUNTIME_LIMITS.maxJsonDepth) throw new WorldError("JSON depth limit exceeded");
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new WorldError("numbers must be safe integers");
    if (typeof value === "string") {
      if (value.length > RUNTIME_LIMITS.maxText * 2 || [...value].length > RUNTIME_LIMITS.maxText) throw new WorldError("text exceeds 4096 code points");
      for (let i = 0; i < value.length; i++) {
        const c = value.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
          const next = value.charCodeAt(++i);
          if (!(next >= 0xdc00 && next <= 0xdfff)) throw new WorldError("lone surrogate");
        } else if (c >= 0xdc00 && c <= 0xdfff) throw new WorldError("lone surrogate");
      }
    }
    if (value === null || typeof value !== "object") {
      if (!["string", "number", "boolean"].includes(typeof value) && value !== null) throw new WorldError("non-JSON value");
      continue;
    }
    if (seen.has(value)) throw new WorldError("cyclic objects are not JSON");
    seen.add(value);
    stack.push({ value, depth, exit: true });
    const array = Array.isArray(value);
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null && !(array && proto === Array.prototype)) throw new WorldError("non-plain JSON object");
    if (Object.getOwnPropertySymbols(value).length) throw new WorldError("symbol key");
    const keys = Object.getOwnPropertyNames(value);
    if (array && keys.length !== value.length + 1) throw new WorldError("sparse or extended array");
    for (const key of keys) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in d) || !d.enumerable) throw new WorldError("accessor or hidden property");
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new WorldError("unsafe key");
      if (rejectHidden && FORBIDDEN_FIELDS.has(key.replace(/[-_]/g, "").toLowerCase())) throw new WorldError(`forbidden evaluation/authoring field: ${key}`);
      stack.push({ value: d.value, depth: depth + 1 });
    }
  }
}

/** Field names, not prose: public task explanations may discuss alternatives. */
export const FORBIDDEN_FIELDS = new Set([
  "referencesolution", "referencesolutions", "solution", "solutions", "alternativesolution", "alternativesolutions",
  "nearmiss", "nearmisses", "fixtures", "solvabilitywitness", "solvabilitywitnesses", "heldouttask", "heldouttasks",
  "hypothesis", "hypotheses", "openmodelquestions", "openquestions", "witness", "witnesses",
]);

export function preflightPredicate(raw: unknown): void {
  preflightJson(raw);
  const stack: Array<{ value: unknown; depth: number }> = [{ value: raw, depth: 1 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (value === null || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const v of value) stack.push({ value: v, depth });
      continue;
    }
    const rec = value as Record<string, unknown>;
    if ("op" in rec || "kind" in rec) {
      if (++nodes > RUNTIME_LIMITS.maxPredicateNodes) throw new WorldError("predicate node limit exceeded");
      if (depth > RUNTIME_LIMITS.maxPredicateDepth) throw new WorldError("predicate depth limit exceeded");
    }
    for (const v of Object.values(rec)) if (v !== null && typeof v === "object") stack.push({ value: v, depth: depth + 1 });
  }
}

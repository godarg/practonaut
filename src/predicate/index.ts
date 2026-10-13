import { validatePredicate, validateState, WorldError } from "../world/schema.ts";
import { RUNTIME_LIMITS } from "../world/limits.ts";
import type { Failure, Predicate, Scalar, State, Value, WorldObject } from "../world/types.ts";

export type Evaluation = { ok: true; value: boolean; steps: number } | { ok: false; error: Failure };
class EvaluationError extends Error {
  readonly code: Failure["code"];
  constructor(code: Failure["code"], message: string) { super(message); this.code = code; }
}
/** Every AST/value/visited object is charged, even on a short-circuit path. No executable input. */
export function evaluate(predicate: Predicate, state: State, options: { fuel?: number } = {}): Evaluation {
  let steps = 0;
  const fuel = options.fuel ?? RUNTIME_LIMITS.checkerFuel;
  const tick = (): void => { if (++steps > fuel) throw new EvaluationError("checker_fuel_exhausted", "predicate step budget exhausted"); };
  try {
    if (!Number.isSafeInteger(fuel) || fuel < 0 || fuel > RUNTIME_LIMITS.checkerFuel) throw new EvaluationError("checker_invalid", "fuel must be between 0 and the ceiling");
    const ast = validatePredicate(predicate);
    const normalized = validateState(state);
    const objects = Object.keys(normalized.objects).sort().map(id => normalized.objects[id]!);
    type Env = Map<string, WorldObject>;
    const scan = (type: WorldObject["type"], as: string, where: Predicate, env: Env, mode: "exists" | "every" | "count"): boolean | number => {
      let count = 0;
      for (const o of objects) {
        tick(); // includes objects filtered out by type/tombstone
        if (o.deleted || o.type !== type) continue;
        const next = new Map(env); next.set(as, o);
        const match = pred(where, next);
        if (mode === "exists" && match) return true;
        if (mode === "every" && !match) return false;
        if (match) count++;
      }
      return mode === "count" ? count : mode === "every";
    };
    const val = (v: Value, env: Env): Scalar => {
      tick();
      switch (v.kind) {
        case "literal": return v.value;
        case "count": return scan(v.type, v.as, v.where, env, "count") as number;
        case "field": {
          const obj = env.get(v.variable);
          if (!obj || !Object.hasOwn(obj, v.field)) throw new EvaluationError("checker_invalid", `field ${v.field} unavailable on bound object`);
          return (obj as unknown as Record<string, Scalar>)[v.field]!;
        }
      }
    };
    const pred = (p: Predicate, env: Env): boolean => {
      tick();
      switch (p.op) {
        case "true": return true;
        case "false": return false;
        case "all": for (const arg of p.args) if (!pred(arg, env)) return false; return true;
        case "any": for (const arg of p.args) if (pred(arg, env)) return true; return false;
        case "not": return !pred(p.arg, env);
        case "exists": case "every": return scan(p.type, p.as, p.where, env, p.op) as boolean;
        case "eq": case "lt": case "lte": case "gt": case "gte": {
          const left = val(p.left, env); const right = val(p.right, env);
          if (p.op === "eq") return left === right;
          if (typeof left !== "number" || typeof right !== "number") throw new EvaluationError("checker_invalid", "ordered comparisons require integers");
          switch (p.op) { case "lt": return left < right; case "lte": return left <= right; case "gt": return left > right; case "gte": return left >= right; }
          throw new EvaluationError("checker_invalid", "unknown comparison");
        }
        case "near": {
          const left = val(p.left, env); const right = val(p.right, env);
          if (typeof left !== "number" || typeof right !== "number") throw new EvaluationError("checker_invalid", "near requires integers");
          return Math.abs(left - right) <= p.tolerance;
        }
        case "contains": case "startsWith": {
          const left = val(p.left, env); const right = val(p.right, env);
          if (typeof left !== "string" || typeof right !== "string") throw new EvaluationError("checker_invalid", "text tests require strings");
          return p.op === "contains" ? left.includes(right) : left.startsWith(right);
        }
      }
    };
    return { ok: true, value: pred(ast, new Map()), steps };
  } catch (error) {
    if (error instanceof EvaluationError) return { ok: false, error: { code: error.code, message: error.message, details: { steps, fuel } } };
    if (error instanceof WorldError) return { ok: false, error: { code: "checker_invalid", message: error.message, details: {} } };
    throw error;
  }
}

export const evaluatePredicate = evaluate;

import { validatePredicate, validateState, WorldError } from "../world/schema.ts";
import { RUNTIME_LIMITS } from "../world/limits.ts";
import { layoutProblem } from "../world/layout.ts";
import { isLayoutPredicate, type Failure, type Predicate, type Scalar, type State, type Value, type WorldObject } from "../world/types.ts";
import { analyse, layoutCharge, LayoutRangeError } from "./layout.ts";
export { layoutCharge, layoutReasons, LayoutRangeError, type LayoutReason } from "./layout.ts";

export type Evaluation = { ok: true; value: boolean; steps: number } | { ok: false; error: Failure };
class EvaluationError extends Error {
  readonly code: Failure["code"];
  constructor(code: Failure["code"], message: string) { super(message); this.code = code; }
}
/** The step meter of one evaluation. `tick(n)` debits n steps; a charge that is not a non-negative
 * safe integer is `checker_invalid` (a malformed formula never passes as a number, PADR-0047
 * decision 4), more than the fuel is `checker_fuel_exhausted`. */
export interface Meter { tick(charge?: number): void; readonly steps: number }
export function createMeter(fuel: number): Meter {
  let steps = 0;
  return {
    tick(charge = 1): void {
      if (!Number.isSafeInteger(charge) || charge < 0) throw new EvaluationError("checker_invalid", `a predicate charge must be a non-negative whole number, not ${String(charge)}`);
      steps += charge;
      if (steps > fuel) throw new EvaluationError("checker_fuel_exhausted", "predicate step budget exhausted");
    },
    get steps() { return steps; },
  };
}

/** The fuel argument checked: a safe integer between 0 and the ceiling. */
function checkedFuel(options: { fuel?: number }): number {
  const fuel = options.fuel ?? RUNTIME_LIMITS.checkerFuel;
  if (!Number.isSafeInteger(fuel) || fuel < 0 || fuel > RUNTIME_LIMITS.checkerFuel) throw new EvaluationError("checker_invalid", "fuel must be between 0 and the ceiling");
  return fuel;
}
/** A predicate validated for evaluation: its vocabulary and bindings, and where its layout clauses stand
 * (PADR-0047 decision 1.2: only where their cost adds, with a closed selection). */
function prepared(predicate: Predicate): Predicate {
  const ast = validatePredicate(predicate);
  const misplaced = layoutProblem(ast, "evaluate");
  if (misplaced) throw new EvaluationError("checker_invalid", misplaced);
  return ast;
}
const sortedObjects = (normalized: State): WorldObject[] => Object.keys(normalized.objects).sort().map(id => normalized.objects[id]!);
/** A failure as an evaluation result; anything else is rethrown. */
function failed(error: unknown, steps: number, fuel: number): Evaluation {
  if (error instanceof EvaluationError) return { ok: false, error: { code: error.code, message: error.message, details: { steps, fuel } } };
  if (error instanceof LayoutRangeError) return { ok: false, error: { code: "checker_invalid", message: error.message, details: { steps, fuel } } };
  if (error instanceof WorldError) return { ok: false, error: { code: "checker_invalid", message: error.message, details: {} } };
  throw error;
}

/** The evaluation itself, on a validated predicate and the state's objects in id order. Every AST,
 * value and visited object is charged, even on a short-circuit path. */
function run(ast: Predicate, objects: readonly WorldObject[], fuel: number): Evaluation {
  const meter = createMeter(fuel);
  const tick = (charge?: number): void => meter.tick(charge);
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
    if (isLayoutPredicate(p)) {
      // The whole cost first, from the number of objects and the expected counts alone.
      tick(layoutCharge(p, objects.length));
      return analyse(p, objects, 1).length === 0;
    }
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
  try { return { ok: true, value: pred(ast, new Map()), steps: meter.steps }; }
  catch (error) { return failed(error, meter.steps, fuel); }
}

/** Every AST/value/visited object is charged, even on a short-circuit path. No executable input. A
 * layout clause is charged its whole formula before it looks at any position (PADR-0047). */
export function evaluate(predicate: Predicate, state: State, options: { fuel?: number } = {}): Evaluation {
  const fuel = options.fuel ?? RUNTIME_LIMITS.checkerFuel;
  try { checkedFuel(options); return run(prepared(predicate), sortedObjects(validateState(state)), fuel); }
  catch (error) { return failed(error, 0, fuel); }
}

export const evaluatePredicate = evaluate;

/** Each predicate evaluated on its own (its own meter, no short-circuit between them) on each state,
 * every predicate and every state validated once: the same results as `evaluate` for each pair, for
 * costing many clauses on many boards (the challenge fuel check). Result `[state][predicate]`. */
export function evaluateEach(predicates: readonly Predicate[], states: readonly State[], options: { fuel?: number } = {}): Evaluation[][] {
  const fuel = options.fuel ?? RUNTIME_LIMITS.checkerFuel;
  try { checkedFuel(options); } catch (error) { const result = failed(error, 0, fuel); return states.map(() => predicates.map(() => result)); }
  const asts = predicates.map((predicate): { ast: Predicate } | { error: Evaluation } => { try { return { ast: prepared(predicate) }; } catch (error) { return { error: failed(error, 0, fuel) }; } });
  return states.map(state => {
    let objects: WorldObject[];
    try { objects = sortedObjects(validateState(state)); } catch (error) { const result = failed(error, 0, fuel); return predicates.map(() => result); }
    return asts.map(entry => 'ast' in entry ? run(entry.ast, objects, fuel) : entry.error);
  });
}

import { stateHash } from "../canonical/index.ts";
import { evaluate } from "../predicate/index.ts";
import { preflightJson, WorldError } from "../world/preflight.ts";
import { derivedArrowFrame, validateState, validateWorld, V2_PARAMETERS } from "../world/schema.ts";
import { RUNTIME_LIMITS } from "../world/limits.ts";
import { isDisplayText } from '../world/display-text.ts';
import { deepFreeze } from './freeze.ts';
import { worldEra } from "../world/types.ts";
import type { Action, ActionName, ActionNameV1, ApplyContext, ApplyResult, EffectKind, Era, Failure, Parameter, State, Step, StepV1, StepV2, World } from "../world/types.ts";

export const REQUIRED_EFFECTS: Readonly<Record<ActionName, readonly EffectKind[]>> = Object.freeze({
  add_step: ["create_step"], rename_step: ["set_label"], move_step: ["set_position"], connect: ["create_arrow"],
  reconnect_end: ["set_endpoint"], disconnect: ["disconnect_arrow"], delete_step: ["tombstone_step", "detach_incident_arrows"],
  resize_step: ["set_size"], set_style: ["set_style"], rename_frame: ["set_frame_name"], group_steps: ["set_group"], ungroup: ["clear_group"], set_frame: ["set_frame"],
});
/** world/2 parameter types come from the built-in contract; bounds may be tightened by the world. */
export const ACTION_PARAMETERS_V2: Readonly<Record<ActionName, Readonly<Record<string, Parameter["type"]>>>> = Object.freeze(Object.fromEntries(
  Object.entries(V2_PARAMETERS).map(([name, parameters]) => [name, Object.fromEntries(Object.entries(parameters).map(([key, p]) => [key, p.type]))]),
) as Record<ActionName, Record<string, Parameter["type"]>>);
export const ACTION_PARAMETERS: Readonly<Record<ActionNameV1, Readonly<Record<string, Parameter["type"]>>>> = Object.freeze({
  add_step: { frameId: "id", label: "string", x: "integer", y: "integer", width: "integer", height: "integer", fontFamily: "integer" },
  rename_step: { id: "id", label: "string" }, move_step: { id: "id", x: "integer", y: "integer" },
  connect: { frameId: "id", from: "id", to: "id" }, reconnect_end: { id: "id", end: "end", target: "id" },
  disconnect: { id: "id" }, delete_step: { id: "id" },
});
export function failure(code: Failure["code"], message: string, details: Failure["details"] = {}): { ok: false; error: Failure } {
  return { ok: false, error: { code, message, details } };
}
class TransitionError extends Error {
  readonly code: Failure["code"];
  constructor(code: Failure["code"], message: string) { super(message); this.code = code; }
}
/** Stable semantic id: identical prefix denotes the same object; an undo branch gets a new id. */
export function creationId(world: World, action: Action, context: ApplyContext = { seed: 0, prefix: [] }): string {
  return `${action.name === "add_step" ? "s" : action.name === "group_steps" ? "g" : "a"}-${stateHash({ world: { id: world.id, version: world.version }, seed: context.seed, prefix: [...context.prefix, action] }).slice(0, 60)}`;
}

/** Private transition body: every state/action/successor and semantic check remains validated. */
function transition(world: World, state: State, action: Action, context: ApplyContext, inspectContext: () => void): ApplyResult {
  try {
    const era: Era = worldEra(world);
    validateState(state, era); preflightJson(action);
    if (!action || typeof action !== "object" || Object.keys(action).some(k => !["name", "params", "baseStep"].includes(k)) || typeof action.name !== "string" || !action.params || typeof action.params !== "object" || Array.isArray(action.params)) throw new TransitionError("invalid_argument", "action must contain name, params and optional baseStep");
    if (action.baseStep !== undefined && (!Number.isSafeInteger(action.baseStep) || action.baseStep < 0)) throw new TransitionError("invalid_argument", "baseStep must be a non-negative safe integer");
    inspectContext();
    if (action.baseStep !== undefined && action.baseStep !== context.prefix.length) throw new TransitionError("stale_base", "action baseStep does not match log prefix");
    const definition = world.actions.find(a => a.name === action.name);
    const contracts: Readonly<Record<string, Readonly<Record<string, Parameter["type"]>>>> = era === 2 ? ACTION_PARAMETERS_V2 : ACTION_PARAMETERS;
    if (!definition || !Object.hasOwn(contracts, action.name)) return failure("unmodeled", "action is not modeled", { action: action.name });
    const name = action.name as ActionName;
    const expected = contracts[name]!;
    const keys = Object.keys(expected).sort();
    if (Object.keys(action.params).sort().join(",") !== keys.join(",")) throw new TransitionError("invalid_argument", "missing or unknown action parameter");
    if (Object.keys(definition.parameters).sort().join(",") !== keys.join(",")) return failure("unmodeled", "action parameter contract not covered");
    for (const key of keys) {
      const p = definition.parameters[key]!;
      if (p.type !== expected[key]) return failure("unmodeled", "action parameter type not covered", { parameter: key });
      const value = action.params[key];
      if (p.type === 'string' && typeof value === 'string' && !isDisplayText(value)) throw new TransitionError('invalid_argument', 'display strings must be NFC without invisible controls');
      const validId = (candidate: unknown): boolean => typeof candidate === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(candidate) && !['__proto__', 'prototype', 'constructor'].includes(candidate);
      if ((p.type === "string" && typeof value !== "string") || (p.type === "integer" && !Number.isSafeInteger(value)) || (p.type === "id" && !validId(value)) || (p.type === "nullable-id" && value !== null && !validId(value)) || (p.type === "enum" && (typeof value !== "string" || !(p.values ?? []).includes(value))) || (p.type === "end" && value !== "start" && value !== "end")) throw new TransitionError("invalid_argument", `invalid parameter ${key}`);
      const size = typeof value === "string" ? (p.type === "string" ? [...value].length : 0) : typeof value === "number" ? value : 0;
      if ((p.min !== undefined && size < p.min) || (p.max !== undefined && size > p.max)) throw new TransitionError("invalid_argument", `parameter ${key} outside declared range`);
    }
    // One transition budget spans action AND every matching rule's preconditions.
    // Restarting fuel for each AST multiplies the advertised ceiling by the world size.
    let remainingPredicateFuel: number = RUNTIME_LIMITS.checkerFuel;
    const truth = (p: World["rules"][number]["preconditions"][number]): boolean => {
      const r = evaluate(p, state, { fuel: remainingPredicateFuel });
      if (!r.ok) throw new TransitionError(r.error.code, r.error.code === "checker_fuel_exhausted" ? "transition precondition step budget exhausted" : r.error.message);
      remainingPredicateFuel -= r.steps;
      return r.value;
    };
    if (!definition.preconditions.every(truth)) throw new TransitionError("precondition_failed", "action precondition is false");
    const rules = world.rules.filter(r => r.action === name && r.preconditions.every(truth));
    // world/2: an action without any rule has its built-in core semantics; stated rules must still cover it.
    const implicit = era === 2 && !world.rules.some(r => r.action === name);
    const effects = new Set(implicit ? REQUIRED_EFFECTS[name] : rules.flatMap(r => r.effects));
    if (REQUIRED_EFFECTS[name].some(effect => !effects.has(effect)) || [...effects].some(effect => !REQUIRED_EFFECTS[name].includes(effect))) return failure("unmodeled", "confirmed rules do not cover exactly the required effects", { action: name });
    if (era === 2) return transitionV2(world, state, action, name, context);
    const string = (key: string): string => action.params[key] as string;
    const number = (key: string): number => action.params[key] as number;
    const object = (id: string, type: "step" | "frame" | "arrow") => {
      const value = state.objects[id];
      if (!value || value.deleted || value.type !== type) throw new TransitionError("precondition_failed", `expected live ${type}: ${id}`);
      return value;
    };
    const step = (id: string): StepV1 => object(id, "step") as StepV1;
    if (name === "add_step" || name === "connect") {
      object(string("frameId"), "frame");
      if (Object.keys(state.objects).length >= RUNTIME_LIMITS.maxObjects) throw new TransitionError("limit_exceeded", "object limit reached");
    }
    if (["rename_step", "move_step", "delete_step"].includes(name)) step(string("id"));
    if (name === "connect") {
      for (const target of ["from", "to"]) if (step(string(target)).frameId !== string("frameId")) throw new TransitionError("precondition_failed", "cross-frame connection is not modeled");
    }
    if (name === "reconnect_end" || name === "disconnect") {
      const arrow = object(string("id"), "arrow");
      if (name === "reconnect_end" && step(string("target")).frameId !== (arrow as { frameId: string }).frameId) throw new TransitionError("precondition_failed", "cross-frame reconnection is not modeled");
    }
    if (name === "add_step") {
      if (number("width") < 1 || number("height") < 1 || !world.app.fontFamilies.includes(number("fontFamily"))) throw new TransitionError("invalid_argument", "dimensions or font family outside world contract");
    }
    const next = structuredClone(state);
    let id = string("id");
    if (name === "add_step" || name === "connect") {
      id = creationId(world, action, context);
      if (Object.hasOwn(next.objects, id)) throw new TransitionError("precondition_failed", "semantic id already used (including tombstone)");
    }
    switch (name) {
      case "add_step": next.objects[id] = { id, type: "step", deleted: false, frameId: string("frameId"), label: string("label"), x: number("x"), y: number("y"), width: number("width"), height: number("height"), fontFamily: number("fontFamily") }; break;
      case "rename_step": (next.objects[id] as StepV1).label = string("label"); break;
      case "move_step": (next.objects[id] as StepV1).x = number("x"); (next.objects[id] as StepV1).y = number("y"); break;
      case "connect": next.objects[id] = { id, type: "arrow", deleted: false, frameId: string("frameId"), from: string("from"), to: string("to") }; break;
      case "reconnect_end": {
        const arrow = next.objects[id];
        if (arrow?.type !== "arrow") throw new TransitionError("precondition_failed", "arrow unavailable");
        arrow[string("end") === "start" ? "from" : "to"] = string("target");
        break;
      }
      case "disconnect": {
        const arrow = next.objects[id];
        if (arrow?.type !== "arrow") throw new TransitionError("precondition_failed", "arrow unavailable");
        arrow.deleted = true; arrow.from = null; arrow.to = null;
        break;
      }
      case "delete_step": {
        next.objects[id]!.deleted = true;
        for (const arrow of Object.values(next.objects)) if (arrow.type === "arrow" && !arrow.deleted) {
          if (arrow.from === id) arrow.from = null;
          if (arrow.to === id) arrow.to = null;
        }
        break;
      }
    }
    validateState(next, 1);
    return { ok: true, state: next, effects: REQUIRED_EFFECTS[name].map(kind => ({ kind, id })) };
  } catch (error) {
    if (error instanceof TransitionError) return failure(error.code, error.message);
    if (error instanceof WorldError) return failure("invalid_argument", error.message);
    throw error;
  }
}

/** world/2 transitions. Same atomicity: on any failure the caller's state is untouched. */
function transitionV2(world: World, state: State, action: Action, name: ActionName, context: ApplyContext): ApplyResult {
  const string = (key: string): string => action.params[key] as string;
  const number = (key: string): number => action.params[key] as number;
  const nullable = (key: string): string | null => action.params[key] as string | null;
  const live = (id: string, type: "step" | "frame" | "arrow") => {
    const value = state.objects[id];
    if (!value || value.deleted || value.type !== type) throw new TransitionError("precondition_failed", `expected live ${type}: ${id}`);
    return value;
  };
  const frameOrNull = (id: string | null): void => { if (id !== null) live(id, "frame"); };
  const next = structuredClone(state);
  const stepAt = (id: string): StepV2 => next.objects[id] as StepV2;
  let id = action.params.id === undefined ? "" : string("id");
  if (name === "add_step" || name === "connect") {
    if (Object.keys(state.objects).length >= RUNTIME_LIMITS.maxObjects) throw new TransitionError("limit_exceeded", "object limit reached");
    id = creationId(world, action, context);
    if (Object.hasOwn(next.objects, id)) throw new TransitionError("precondition_failed", "semantic id already used (including tombstone)");
  }
  switch (name) {
    case "add_step":
      frameOrNull(nullable("frameId"));
      next.objects[id] = { id, type: "step", deleted: false, frameId: nullable("frameId"), label: string("label"), x: number("x"), y: number("y"), width: number("width"), height: number("height"), shape: string("shape") as StepV2["shape"], groupId: null, stroke: "black", fill: "none" };
      break;
    case "rename_step": live(id, "step"); stepAt(id).label = string("label"); break;
    case "move_step": live(id, "step"); stepAt(id).x = number("x"); stepAt(id).y = number("y"); break;
    case "resize_step": live(id, "step"); stepAt(id).width = number("width"); stepAt(id).height = number("height"); break;
    case "set_style": {
      live(id, "step"); const step = stepAt(id);
      step.shape = string("shape") as StepV2["shape"]; step.stroke = string("stroke") as StepV2["stroke"]; step.fill = string("fill") as StepV2["fill"];
      break;
    }
    case "delete_step":
      live(id, "step"); next.objects[id]!.deleted = true;
      for (const arrow of Object.values(next.objects)) if (arrow.type === "arrow" && !arrow.deleted) {
        if (arrow.from === id) arrow.from = null;
        if (arrow.to === id) arrow.to = null;
      }
      break;
    case "connect": {
      live(string("from"), "step"); live(string("to"), "step");
      next.objects[id] = { id, type: "arrow", deleted: false, frameId: null, from: string("from"), to: string("to") };
      break;
    }
    case "reconnect_end": {
      live(id, "arrow"); live(string("target"), "step");
      const arrow = next.objects[id];
      if (arrow?.type !== "arrow") throw new TransitionError("precondition_failed", "arrow unavailable");
      arrow[string("end") === "start" ? "from" : "to"] = string("target");
      break;
    }
    case "disconnect": {
      live(id, "arrow"); const arrow = next.objects[id];
      if (arrow?.type !== "arrow") throw new TransitionError("precondition_failed", "arrow unavailable");
      arrow.deleted = true; arrow.from = null; arrow.to = null;
      break;
    }
    case "rename_frame": live(id, "frame"); (next.objects[id] as { name: string }).name = string("name"); break;
    case "group_steps": {
      const other = string("with");
      live(id, "step"); live(other, "step");
      if (other === id) throw new TransitionError("precondition_failed", "a step cannot be grouped with itself");
      const group = stepAt(other).groupId ?? creationId(world, action, context);
      stepAt(other).groupId = group; stepAt(id).groupId = group;
      break;
    }
    case "ungroup": {
      live(id, "step"); const group = stepAt(id).groupId;
      if (group === null) throw new TransitionError("precondition_failed", "step is not grouped");
      for (const o of Object.values(next.objects)) if (o.type === "step" && !o.deleted && (o as StepV2).groupId === group) (o as StepV2).groupId = null;
      break;
    }
    case "set_frame": live(id, "step"); frameOrNull(nullable("frameId")); stepAt(id).frameId = nullable("frameId"); break;
  }
  // Arrow frames follow their ends after every transition; one rule shared by every world/2 state.
  for (const arrow of Object.values(next.objects)) if (arrow.type === "arrow" && !arrow.deleted) arrow.frameId = derivedArrowFrame(next, arrow.from, arrow.to, arrow.frameId);
  validateState(next, 2);
  return { ok: true, state: next, effects: REQUIRED_EFFECTS[name].map(kind => ({ kind, id })) };
}

/** Pure public boundary: arbitrary world, state, action and context are fully validated. */
export function apply(world: World, state: State, action: Action, context: ApplyContext = { seed: 0, prefix: [] }): ApplyResult {
  try { validateWorld(world); } catch (error) {
    if (error instanceof WorldError) return failure('invalid_argument', error.message);
    throw error;
  }
  return transition(world, state, action, context, () => {
    preflightJson(context);
    if (!context || typeof context !== 'object' || !Number.isSafeInteger(context.seed) || !Array.isArray(context.prefix)) throw new TransitionError('invalid_argument', 'invalid action context');
  });
}

/** Internal Session factory; deliberately absent from every public barrel.
 * It creates its own validated world and prefix, never accepts a validation flag
 * or caller-owned prefix. The private transition executor is never returned.
 */
export function createSessionTransitions(world: World, seed: number, taskId: string) {
  if (!Number.isSafeInteger(seed)) throw new WorldError('seed must be a safe integer');
  // Zod returns a detached post-variant world; frozen, it is shared by every fork and replay.
  const validated = deepFreeze(validateWorld(world));
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(taskId) || !validated.tasks.some(task => task.id === taskId)) throw new WorldError('unknown or invalid task');
  return executor(validated, seed, []);
}
/** The private executor over an already validated world. `fork` copies the prefix of accepted
 * actions; `fresh` starts with an empty one. Neither accepts a world or a caller-owned prefix, so
 * the validated context can only be reused, never replaced (PADR-0022, PADR-0037). */
function executor(validated: World, seed: number, prefix: Action[]) {
  return {
    act(state: State, action: Action): ApplyResult {
      if (prefix.length >= RUNTIME_LIMITS.maxActions) return failure('limit_exceeded', 'session action limit reached');
      const result = transition(validated, state, action, { seed, prefix }, () => {});
      if (result.ok) prefix.push(structuredClone(action));
      return result;
    },
    truncate(length: number): void {
      if (!Number.isSafeInteger(length) || length < 0 || length > prefix.length) throw new WorldError('invalid private prefix truncation');
      prefix.length = length;
    },
    reset(): void { prefix.length = 0; },
    fork() { return executor(validated, seed, prefix.map(action => structuredClone(action))); },
    fresh() { return executor(validated, seed, []); },
  };
}

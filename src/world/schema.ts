import { z } from "zod";
import { ACTION_NAMES, V2_ACTION_NAMES, SHAPES, STROKE_COLORS, FILL_COLORS, type ActionDefinition, type ActionName, type Era, type Parameter, type Predicate, type Value, type State, type Step, type World } from "./types.ts";
import { RUNTIME_LIMITS } from "./limits.ts";
import { preflightJson, preflightPredicate, WorldError } from "./preflight.ts";
import { isDisplayText } from './display-text.ts';

export { WorldError } from "./preflight.ts";
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const objectId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const name = z.string().min(1).max(256).refine(isDisplayText, 'display strings must be NFC without invisible controls');
const text = z.string().max(8192).refine(isDisplayText, 'display strings must be NFC without invisible controls'); // code-point ceiling is enforced by preflightJson
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const objType = z.enum(["frame", "step", "arrow"]);
export const FIELD_NAMES = ["id", "type", "deleted", "name", "frameId", "label", "x", "y", "width", "height", "fontFamily", "from", "to"] as const;
const scalar = z.union([text, integer, z.boolean(), z.null()]);
export const ValueSchema: z.ZodType<Value> = z.lazy(() => z.union([
  z.strictObject({ kind: z.literal("literal"), value: scalar }),
  z.strictObject({ kind: z.literal("field"), variable: id, field: z.enum(FIELD_NAMES) }),
  z.strictObject({ kind: z.literal("count"), type: objType, as: id, where: PredicateSchema }),
]));
export const PredicateSchema: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.strictObject({ op: z.enum(["true", "false"]) }),
  z.strictObject({ op: z.enum(["all", "any"]), args: z.array(PredicateSchema).max(4096) }),
  z.strictObject({ op: z.literal("not"), arg: PredicateSchema }),
  z.strictObject({ op: z.enum(["eq", "lt", "lte", "gt", "gte"]), left: ValueSchema, right: ValueSchema }),
  z.strictObject({ op: z.enum(["exists", "every"]), type: objType, as: id, where: PredicateSchema }),
]));
/** world/2 predicates: a strict superset (near, contains, startsWith, new step fields). */
export const FIELD_NAMES_V2 = [...FIELD_NAMES, "shape", "groupId", "stroke", "fill"] as const;
export const ValueSchemaV2: z.ZodType<Value> = z.lazy(() => z.union([
  z.strictObject({ kind: z.literal("literal"), value: scalar }),
  z.strictObject({ kind: z.literal("field"), variable: id, field: z.enum(FIELD_NAMES_V2) }),
  z.strictObject({ kind: z.literal("count"), type: objType, as: id, where: PredicateSchemaV2 }),
]));
export const PredicateSchemaV2: z.ZodType<Predicate> = z.lazy(() => z.union([
  z.strictObject({ op: z.enum(["true", "false"]) }),
  z.strictObject({ op: z.enum(["all", "any"]), args: z.array(PredicateSchemaV2).max(4096) }),
  z.strictObject({ op: z.literal("not"), arg: PredicateSchemaV2 }),
  z.strictObject({ op: z.enum(["eq", "lt", "lte", "gt", "gte"]), left: ValueSchemaV2, right: ValueSchemaV2 }),
  z.strictObject({ op: z.literal("near"), left: ValueSchemaV2, right: ValueSchemaV2, tolerance: z.number().int().min(0).max(1_000_000) }),
  z.strictObject({ op: z.enum(["contains", "startsWith"]), left: ValueSchemaV2, right: ValueSchemaV2 }),
  z.strictObject({ op: z.enum(["exists", "every"]), type: objType, as: id, where: PredicateSchemaV2 }),
]));
const base = { id: objectId, deleted: z.boolean() };
export const ObjectSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("frame"), name }),
  z.strictObject({ ...base, type: z.literal("step"), frameId: objectId, label: text, x: integer, y: integer, width: integer.min(1), height: integer.min(1), fontFamily: integer.min(1).max(100) }),
  z.strictObject({ ...base, type: z.literal("arrow"), frameId: objectId, from: objectId.nullable(), to: objectId.nullable() }),
]);
export const StateSchema: z.ZodType<State> = z.strictObject({ objects: z.record(objectId, ObjectSchema) });
const frameNameV2 = z.string().max(256).refine(isDisplayText, 'display strings must be NFC without invisible controls');
export const ObjectSchemaV2 = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("frame"), name: frameNameV2 }),
  z.strictObject({ ...base, type: z.literal("step"), frameId: objectId.nullable(), label: text, x: integer, y: integer, width: integer.min(1), height: integer.min(1), shape: z.enum(SHAPES), groupId: objectId.nullable(), stroke: z.enum(STROKE_COLORS), fill: z.enum(FILL_COLORS) }),
  z.strictObject({ ...base, type: z.literal("arrow"), frameId: objectId.nullable(), from: objectId.nullable(), to: objectId.nullable() }),
]);
export const StateSchemaV2: z.ZodType<State> = z.strictObject({ objects: z.record(objectId, ObjectSchemaV2) });
/** Either era; used where a reader must accept both (bridge, host replies). */
export const AnyStateSchema: z.ZodType<State> = z.union([StateSchema, StateSchemaV2]);
const localized = z.strictObject({ en: text, de: text });
export const TaskSchema = z.strictObject({
  id, title: localized, prompt: localized, initialState: StateSchema.optional(), goal: PredicateSchema,
  hints: z.array(localized).min(1).max(32),
  errorClasses: z.array(z.strictObject({ id, category: z.enum(["rejected_by_app", "accepted_but_violates_goal", "suboptimal", "unmodeled"]), when: PredicateSchema, explanation: localized })).max(128),
});
const parameter = z.strictObject({ type: z.enum(["string", "integer", "id", "end"]), min: integer.optional(), max: integer.optional() });
const semver = z.string().max(128).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const source = z.string().min(1).max(4096);
const sourceHash = z.string().regex(/^[a-f0-9]{64}$/);
const privateSource = z.strictObject({ owner: name, reconstructionAuthor: name, authorization: z.strictObject({ reference: source, sha256: sourceHash, scope: name }), sources: z.array(z.strictObject({ reference: source, sha256: sourceHash })).min(1).max(16) });
export const WorldSchema = z.strictObject({
  schema: z.literal("practonaut.world/1"), id: id.regex(/^[a-z0-9][a-z0-9-]*$/), version: semver,
  app: z.strictObject({ adapterId: z.literal("excalidraw"), versionRange: z.literal("0.18.1"), fontFamilies: z.array(integer.min(1).max(100)).min(1).max(32), excludedAttributes: z.record(id, source) }),
  units: z.record(id, source),
  objectTypes: z.array(z.strictObject({ type: objType, attributes: z.record(id, z.enum(["string", "integer", "id", "nullable-id", "boolean"])) })).min(1).max(3),
  initialState: StateSchema,
  actions: z.array(z.strictObject({ name: z.enum(ACTION_NAMES), parameters: z.record(id, parameter), preconditions: z.array(PredicateSchema).max(128) })).min(1).max(7),
  rules: z.array(z.strictObject({ id, action: z.enum(ACTION_NAMES), status: z.literal("confirmed"), preconditions: z.array(PredicateSchema).max(128), effects: z.array(z.enum(["create_step", "set_label", "set_position", "create_arrow", "set_endpoint", "clear_endpoint", "disconnect_arrow", "tombstone_step", "detach_incident_arrows"])).min(1).max(8), evidence: z.array(z.strictObject({ run: source, case: source, sha256: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(128) })).min(1).max(128),
  tasks: z.array(TaskSchema).min(1).max(128),
  variants: z.strictObject({ generator: z.literal("finite-seeded-v1"), cases: z.array(z.strictObject({ id, labels: z.record(objectId, text), insertPosition: integer.min(0).max(9999), layoutOffset: z.strictObject({ x: integer, y: integer }) })).min(1).max(256) }),
  provenance: z.strictObject({ authors: z.array(name).min(1).max(128), adapterVersion: name, appVersion: z.literal("0.18.1"), compileToolVersion: name, recordings: z.array(id).max(128), privateSource: privateSource.optional(), coalescingVersion: name.optional() }),
  rights: z.strictObject({ license: z.enum(["CC0-1.0", "LicenseRef-Private"]), assets: z.array(z.strictObject({ path: source, source, license: source })).max(255), recordings: z.array(z.strictObject({ id, source, license: source, consent: source })).max(128) }),
});

const localizedV2 = z.strictObject({ en: text, de: text });
const errorClassV2 = z.strictObject({ id, category: z.enum(["rejected_by_app", "accepted_but_violates_goal", "suboptimal", "unmodeled"]), when: PredicateSchemaV2, explanation: localizedV2 });
/** A task a generator materialised (PADR-0036): generator id and version, the seed and named
 * parameters (for example a difficulty level). World content, never part of the Player's or an
 * agent's view. */
export const GENERATED_BY_LIMITS = Object.freeze({ parameters: 16, text: 64 });
/** Named generator parameters: at most 16, each an integer or a short display string. */
export const GeneratedParametersSchema = z.record(z.string().regex(/^[a-z][A-Za-z0-9_-]{0,31}$/), z.union([integer, z.string().min(1).max(GENERATED_BY_LIMITS.text).refine(isDisplayText, 'display strings must be NFC without invisible controls')]))
  .refine(value => Object.keys(value).length <= GENERATED_BY_LIMITS.parameters, `at most ${GENERATED_BY_LIMITS.parameters} parameters`);
export const GeneratedBySchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), version: semver.max(64), seed: integer, parameters: GeneratedParametersSchema.default({}),
});
/** Public task limits (PADR-0040): at most `actions` accepted changes (act, undo, reset) and `checks`
 * evaluated checks per attempt, enforced by the host for the Player and agents alike. */
export const TASK_LIMITS = Object.freeze({ actions: 1000, checks: 1000 });
export const TaskLimitsSchema = z.strictObject({
  actions: z.number().int().min(1).max(TASK_LIMITS.actions).optional(),
  checks: z.number().int().min(0).max(TASK_LIMITS.checks).optional(),
}).refine(value => value.actions !== undefined || value.checks !== undefined, 'limits name actions, checks or both');
export const TaskSchemaV2 = z.strictObject({
  id, title: localizedV2, prompt: localizedV2, initialState: StateSchemaV2.optional(), goal: PredicateSchemaV2,
  hints: z.array(localizedV2).min(1).max(32), errorClasses: z.array(errorClassV2).max(128),
  conditionTexts: z.array(localizedV2).max(4096).optional(),
  generatedBy: GeneratedBySchema.optional(),
  limits: TaskLimitsSchema.optional(),
});
const parameterV2 = z.strictObject({ type: z.enum(["string", "integer", "id", "end", "nullable-id", "enum"]), min: integer.optional(), max: integer.optional(), values: z.array(z.string().min(1).max(64)).min(1).max(32).optional() });
const EFFECTS_V2 = ["create_step", "set_label", "set_position", "create_arrow", "set_endpoint", "clear_endpoint", "disconnect_arrow", "tombstone_step", "detach_incident_arrows", "set_size", "set_style", "set_frame_name", "set_group", "clear_group", "set_frame"] as const;
/** Built-in world/2 contracts. A world may omit parameters (these apply) or restate them with tighter bounds. */
const P = (type: Parameter["type"], extra: Omit<Parameter, "type"> = {}): Parameter => ({ type, ...extra });
const coordinate = (): Parameter => P("integer", { min: -100000, max: 100000 });
const size = (): Parameter => P("integer", { min: 10, max: 4000 });
export const V2_PARAMETERS: Readonly<Record<ActionName, Readonly<Record<string, Parameter>>>> = Object.freeze({
  add_step: { frameId: P("nullable-id"), label: P("string", { max: 4096 }), x: coordinate(), y: coordinate(), width: size(), height: size(), shape: P("enum", { values: [...SHAPES] }) },
  rename_step: { id: P("id"), label: P("string", { max: 4096 }) },
  move_step: { id: P("id"), x: coordinate(), y: coordinate() },
  resize_step: { id: P("id"), width: size(), height: size() },
  set_style: { id: P("id"), shape: P("enum", { values: [...SHAPES] }), stroke: P("enum", { values: [...STROKE_COLORS] }), fill: P("enum", { values: [...FILL_COLORS] }) },
  delete_step: { id: P("id") },
  connect: { from: P("id"), to: P("id") },
  reconnect_end: { id: P("id"), end: P("end"), target: P("id") },
  disconnect: { id: P("id") },
  rename_frame: { id: P("id"), name: P("string", { min: 1, max: 256 }) },
  group_steps: { id: P("id"), with: P("id") },
  ungroup: { id: P("id") },
  set_frame: { id: P("id"), frameId: P("nullable-id") },
});
/** A normalized world/2 action as published to the player and agents (parameters always explicit). */
export const ActionDefinitionSchemaV2 = z.strictObject({ name: z.enum(V2_ACTION_NAMES), parameters: z.record(id, parameterV2), preconditions: z.array(PredicateSchemaV2).max(128) });
const actionV2 = z.strictObject({ name: z.enum(V2_ACTION_NAMES), parameters: z.record(id, parameterV2).optional(), preconditions: z.array(PredicateSchemaV2).max(128).default([]) });
const defaultActions = (): Array<{ name: ActionName; preconditions: Predicate[] }> => V2_ACTION_NAMES.map(name => ({ name, preconditions: [] }));
export const RuleSchemaV2 = z.strictObject({ id, action: z.enum(V2_ACTION_NAMES), status: z.literal("confirmed"), preconditions: z.array(PredicateSchemaV2).max(128).default([]), effects: z.array(z.enum(EFFECTS_V2)).min(1).max(8), evidence: z.array(z.strictObject({ run: source, case: source, sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(128).default([]) });
/** world/2: additive format. Optional parts get explicit defaults, so a validated world re-validates unchanged. */
/** The world's task set (PADR-0044 decision 3): an application-free key, with the world id's and
 * version's own patterns, that variant selection hashes instead of the world's own id and version.
 * Optional without a default, so a world without it keeps its canonical JSON and its variants. */
export const TaskSetSchema = z.strictObject({ id: id.regex(/^[a-z0-9][a-z0-9-]*$/), version: semver });
export const WorldSchemaV2 = z.strictObject({
  schema: z.literal("practonaut.world/2"), id: id.regex(/^[a-z0-9][a-z0-9-]*$/), version: semver,
  taskSet: TaskSetSchema.optional(),
  app: z.strictObject({ adapterId: z.literal("excalidraw"), versionRange: z.literal("0.18.1"), fontFamilies: z.array(integer.min(1).max(100)).min(1).max(32).default([3]), excludedAttributes: z.record(id, source).default({}) }),
  units: z.record(id, source).default({}),
  objectTypes: z.array(z.strictObject({ type: objType, attributes: z.record(id, z.enum(["string", "integer", "id", "nullable-id", "boolean"])) })).min(1).max(3).default([{ type: "frame", attributes: {} }, { type: "step", attributes: {} }, { type: "arrow", attributes: {} }]),
  initialState: StateSchemaV2.default({ objects: {} }),
  actions: z.array(actionV2).min(1).max(V2_ACTION_NAMES.length).default(defaultActions),
  rules: z.array(RuleSchemaV2).max(128).default([]),
  tasks: z.array(TaskSchemaV2).min(1).max(128),
  variants: z.strictObject({ generator: z.literal("finite-seeded-v1"), cases: z.array(z.strictObject({ id, labels: z.record(objectId, text).default({}), params: z.record(objectId, z.union([text, integer])).default({}), layoutOffset: z.strictObject({ x: integer, y: integer }).default({ x: 0, y: 0 }) })).min(1).max(256) }).default({ generator: "finite-seeded-v1", cases: [{ id: "default", labels: {}, params: {}, layoutOffset: { x: 0, y: 0 } }] }),
  provenance: z.strictObject({ authors: z.array(name).min(1).max(128), adapterVersion: name.default("1.0.0"), appVersion: z.literal("0.18.1").default("0.18.1"), compileToolVersion: name.default("0.0.0"), recordings: z.array(id).max(128).default([]), privateSource: privateSource.optional(), coalescingVersion: name.optional() }),
  rights: z.strictObject({ license: z.enum(["CC0-1.0", "LicenseRef-Private"]), assets: z.array(z.strictObject({ path: source, source, license: source })).max(255).default([]), recordings: z.array(z.strictObject({ id, source, license: source, consent: source })).max(128).default([]) }),
});

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new WorldError(result.error.issues.slice(0, 5).map(i => `${i.path.map(String).join(".")}: ${i.message}`).join("; "));
  return result.data;
}
/** Accepts both eras' predicate vocabularies; a world/1 package is held to its own schema separately. */
export function validatePredicate(raw: unknown): Predicate {
  preflightPredicate(raw);
  const p = parse(PredicateSchemaV2, raw);
  validateBindings(p);
  return p;
}
/** Unbound fields fail at load time; a field absent from a bound object's type fails during evaluation. */
function validateBindings(p: Predicate, scope = new Set<string>()): void {
  const val = (v: Value): void => {
    if (v.kind === "field" && !scope.has(v.variable)) throw new WorldError(`unbound predicate variable: ${v.variable}`);
    if (v.kind === "count") validateBindings(v.where, new Set([...scope, v.as]));
  };
  switch (p.op) {
    case "all": case "any": for (const arg of p.args) validateBindings(arg, scope); break;
    case "not": validateBindings(p.arg, scope); break;
    case "exists": case "every": validateBindings(p.where, new Set([...scope, p.as])); break;
    case "eq": case "lt": case "lte": case "gt": case "gte": case "near": case "contains": case "startsWith": val(p.left); val(p.right); break;
    case "true": case "false": break;
  }
}
/** The era a state belongs to: any world/2 field or a frameless step/arrow makes it world/2. */
export function inferEra(raw: unknown): Era {
  if (!raw || typeof raw !== "object" || !("objects" in raw)) return 1;
  const objects = (raw as { objects: unknown }).objects;
  if (!objects || typeof objects !== "object") return 1;
  for (const o of Object.values(objects as Record<string, unknown>)) {
    if (o && typeof o === "object" && (Object.hasOwn(o, "shape") || ((o as { type?: unknown }).type !== "frame" && (o as { frameId?: unknown }).frameId === null))) return 2;
  }
  return 1;
}
/** world/2 rule: an arrow belongs to the common frame of its attached ends; mixed ends have none. */
export function derivedArrowFrame(state: State, from: string | null, to: string | null, current: string | null): string | null {
  const frames = [from, to].filter((end): end is string => end !== null).map(end => (state.objects[end] as Step | undefined)?.frameId ?? null);
  if (frames.length === 0) return current;
  return frames.every(frame => frame === frames[0]) ? frames[0]! : null;
}
export function validateState(raw: unknown, era?: Era): State {
  preflightJson(raw);
  const used: Era = era ?? inferEra(raw);
  const state = parse(used === 2 ? StateSchemaV2 : StateSchema, raw);
  if (Object.keys(state.objects).length > RUNTIME_LIMITS.maxObjects) throw new WorldError("object limit exceeded");
  for (const [key, o] of Object.entries(state.objects)) {
    if (key !== o.id) throw new WorldError("object key differs from semantic id");
    if (o.deleted) continue;
    if (used === 2) {
      if (o.type === "frame") continue;
      if (o.frameId !== null) {
        const frame = state.objects[o.frameId];
        if (!frame || frame.deleted || frame.type !== "frame") throw new WorldError(`missing live frame for ${key}`);
      }
      if (o.type === "arrow") {
        for (const target of [o.from, o.to]) {
          if (target === null) continue;
          const step = state.objects[target];
          if (!step || step.deleted || step.type !== "step") throw new WorldError(`invalid live arrow endpoint for ${key}`);
        }
        if ((o.from !== null || o.to !== null) && derivedArrowFrame(state, o.from, o.to, o.frameId) !== o.frameId) throw new WorldError(`arrow frame differs from its ends for ${key}`);
      }
      continue;
    }
    if (o.type !== "frame") {
      const frame = o.frameId === null ? undefined : state.objects[o.frameId];
      if (!frame || frame.deleted || frame.type !== "frame") throw new WorldError(`missing live frame for ${key}`);
    }
    if (o.type === "arrow") for (const target of [o.from, o.to]) {
      if (target === null) continue;
      const step = state.objects[target];
      if (!step || step.deleted || step.type !== "step" || step.frameId !== o.frameId) throw new WorldError(`invalid live arrow endpoint for ${key}`);
    }
  }
  return state;
}
function unique(items: string[], label: string): void {
  if (new Set(items).size !== items.length) throw new WorldError(`duplicate ${label}`);
}
const goalClauses = (goal: Predicate): number => goal.op === "all" ? goal.args.length : 1;
/** Both eras share structure checks; world/2 is validated against its own schema, never coerced into world/1. */
export function validateWorld(raw: unknown): World {
  preflightJson(raw, true);
  // Find each AST root and reject excessive depth/count before recursive Zod validation.
  const stack: unknown[] = [raw];
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== "object") continue;
    if (!Array.isArray(item) && "op" in item) { preflightPredicate(item); continue; }
    stack.push(...Object.values(item));
  }
  const v2 = !!raw && typeof raw === "object" && (raw as { schema?: unknown }).schema === "practonaut.world/2";
  const w = (v2 ? parse(WorldSchemaV2, raw) : parse(WorldSchema, raw)) as World;
  const era: Era = v2 ? 2 : 1;
  // A private marker is a non-grant. Source roles are explicit; they never deduce consent.
  const declaredPrivate = w.rights.license === 'LicenseRef-Private';
  if (declaredPrivate !== Boolean(w.provenance.privateSource)) throw new WorldError('private rights and explicit private source must appear together');
  if (w.provenance.privateSource && !w.provenance.authors.includes(w.provenance.privateSource.reconstructionAuthor)) throw new WorldError('private reconstruction author is missing from authors');
  for (const component of [...w.rights.assets, ...w.rights.recordings]) {
    const tokens = component.license.trim().toLowerCase().split(/[\s()&|]+/);
    if (!tokens.includes('licenseref-private')) continue;
    if (component.license !== 'LicenseRef-Private') throw new WorldError('malformed private component license');
    if (!declaredPrivate) throw new WorldError('private components cannot be dedicated by a CC0 world');
  }
  unique(w.actions.map(a => a.name), "action"); unique(w.rules.map(r => r.id), "rule"); unique(w.tasks.map(t => t.id), "task");
  unique(w.variants.cases.map(v => v.id), "variant"); unique(w.objectTypes.map(t => t.type), "object type");
  unique(w.provenance.recordings, "recording"); unique(w.rights.recordings.map(r => r.id), "recording rights");
  validateState(w.initialState, era);
  const states = [w.initialState, ...w.tasks.flatMap(t => t.initialState ? [t.initialState] : [])];
  for (const state of states) {
    validateState(state, era);
    for (const o of Object.values(state.objects)) {
      if (!w.objectTypes.some(t => t.type === o.type)) throw new WorldError(`undeclared object type ${o.type}`);
      if (o.type === "step" && !v2 && !w.app.fontFamilies.includes((o as { fontFamily: number }).fontFamily)) throw new WorldError(`font family ${(o as { fontFamily: number }).fontFamily} not declared`);
    }
  }
  for (const rule of w.rules) if (!w.actions.some(a => a.name === rule.action)) throw new WorldError("rule references undeclared action");
  if (v2) w.actions = w.actions.map(a => normalizeActionV2(a as ActionDefinition & { parameters?: Record<string, Parameter> }));
  for (const a of w.actions) {
    for (const p of Object.values(a.parameters)) if (p.min !== undefined && p.max !== undefined && p.min > p.max) throw new WorldError("parameter min exceeds max");
    a.preconditions.forEach(validatePredicate);
  }
  for (const r of w.rules) r.preconditions.forEach(validatePredicate);
  for (const t of w.tasks) {
    validatePredicate(t.goal); unique(t.errorClasses.map(e => e.id), "error class"); t.errorClasses.forEach(e => validatePredicate(e.when));
    if (t.conditionTexts !== undefined && t.conditionTexts.length !== goalClauses(t.goal)) throw new WorldError(`task ${t.id} needs one condition text per goal clause`);
  }
  for (const recording of w.provenance.recordings) if (!w.rights.recordings.some(r => r.id === recording)) throw new WorldError("missing recording rights");
  // Zod optional keys also admit undefined in TypeScript; preflight forbids undefined at runtime.
  return w;
}
/** A world/2 action states the built-in contract or a tighter one; never another type or parameter set. */
function normalizeActionV2(action: Omit<ActionDefinition, "parameters"> & { parameters?: Record<string, Parameter> }): ActionDefinition {
  const builtIn = V2_PARAMETERS[action.name];
  if (action.parameters === undefined) return { name: action.name, parameters: structuredClone(builtIn) as Record<string, Parameter>, preconditions: action.preconditions };
  if (Object.keys(action.parameters).sort().join(",") !== Object.keys(builtIn).sort().join(",")) throw new WorldError(`action ${action.name} must declare exactly its built-in parameters`);
  for (const [key, declared] of Object.entries(action.parameters)) {
    const expected = builtIn[key]!;
    if (declared.type !== expected.type) throw new WorldError(`action ${action.name} parameter ${key} has the wrong type`);
    if (declared.type === "enum" && (!declared.values || declared.values.some(value => !expected.values!.includes(value)))) throw new WorldError(`action ${action.name} parameter ${key} lists unknown values`);
    if (declared.type !== "enum" && declared.values !== undefined) throw new WorldError(`action ${action.name} parameter ${key} cannot list values`);
  }
  return { name: action.name, parameters: action.parameters, preconditions: action.preconditions };
}

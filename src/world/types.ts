/** Shared contract for world/1 and the additive world/2. Runtime values are validated by src/world/schema.ts. */
import type { AdapterId, AppVersion } from "./apps.ts";
export type { AdapterId, AppVersion } from "./apps.ts";
export type Scalar = string | number | boolean | null;
export type ObjectType = "frame" | "step" | "arrow";
export interface BaseObject { id: string; type: ObjectType; deleted: boolean }
export interface Frame extends BaseObject { type: "frame"; name: string }
/** world/2 named palette and shapes. The adapter maps names to Excalidraw's own picker colours. */
export const SHAPES = ["rectangle", "ellipse", "diamond"] as const;
export type Shape = typeof SHAPES[number];
export const STROKE_COLORS = ["black", "red", "green", "blue", "orange"] as const;
export type StrokeColor = typeof STROKE_COLORS[number];
export const FILL_COLORS = ["none", "red", "green", "blue", "yellow"] as const;
export type FillColor = typeof FILL_COLORS[number];
/** world/1 step: framed rectangle with a licensed font family. */
export interface StepV1 extends BaseObject {
  type: "step"; frameId: string; label: string;
  x: number; y: number; width: number; height: number; fontFamily: number;
}
/** world/2 step: optional frame, shape, palette colours and one group level; fonts are presentation. */
export interface StepV2 extends BaseObject {
  type: "step"; frameId: string | null; label: string;
  x: number; y: number; width: number; height: number;
  shape: Shape; groupId: string | null; stroke: StrokeColor; fill: FillColor;
}
export type Step = StepV1 | StepV2;
/** world/1 arrows always belong to a frame; world/2 arrows derive their frame from their ends. */
export interface Arrow extends BaseObject { type: "arrow"; frameId: string | null; from: string | null; to: string | null }
export type WorldObject = Frame | Step | Arrow;
export interface State { objects: Record<string, WorldObject> }
export type Value =
  | { kind: "literal"; value: Scalar }
  | { kind: "field"; variable: string; field: string }
  | { kind: "count"; type: ObjectType; as: string; where: Predicate };
export type Predicate =
  | { op: "true" | "false" }
  | { op: "all" | "any"; args: Predicate[] }
  | { op: "not"; arg: Predicate }
  | { op: "eq" | "lt" | "lte" | "gt" | "gte"; left: Value; right: Value }
  /** world/2: |left - right| <= tolerance for integers. */
  | { op: "near"; left: Value; right: Value; tolerance: number }
  /** world/2: exact, case-sensitive string tests. */
  | { op: "contains" | "startsWith"; left: Value; right: Value }
  | { op: "exists" | "every"; type: ObjectType; as: string; where: Predicate };
export const ACTION_NAMES = ["add_step", "rename_step", "move_step", "connect", "reconnect_end", "disconnect", "delete_step"] as const;
/** world/2 adds actions closer to the real editor; the world/1 set stays closed. */
export const V2_ACTION_NAMES = [...ACTION_NAMES, "resize_step", "set_style", "rename_frame", "group_steps", "ungroup", "set_frame"] as const;
export type ActionNameV1 = typeof ACTION_NAMES[number];
export type ActionName = typeof V2_ACTION_NAMES[number];
export interface Action { name: string; params: Record<string, Scalar>; baseStep?: number }
export type ParameterType = "string" | "integer" | "id" | "end" | "nullable-id" | "enum";
export interface Parameter { type: ParameterType; min?: number; max?: number; values?: string[] }
export interface ActionDefinition { name: ActionName; parameters: Record<string, Parameter>; preconditions: Predicate[] }
export interface EvidenceRef { run: string; case: string; sha256: string }
/** Closed effect vocabulary; an unknown or missing required effect fails as unmodeled. */
export type EffectKind = "create_step" | "set_label" | "set_position" | "create_arrow" | "set_endpoint" | "clear_endpoint" | "tombstone_step" | "detach_incident_arrows" | "disconnect_arrow"
  | "set_size" | "set_style" | "set_frame_name" | "set_group" | "clear_group" | "set_frame";
export interface Rule { id: string; action: ActionName; status: "confirmed"; preconditions: Predicate[]; effects: EffectKind[]; evidence: EvidenceRef[] }
export interface Localized { en: string; de: string }
export interface ErrorClass { id: string; category: "rejected_by_app" | "accepted_but_violates_goal" | "suboptimal" | "unmodeled"; when: Predicate; explanation: Localized }
export interface Task {
  id: string; title: Localized; prompt: Localized; initialState?: State; goal: Predicate; hints: Localized[]; errorClasses: ErrorClass[];
  /** world/2: one plain-language sentence per top-level goal clause (same order as `goal.args`). */
  conditionTexts?: Localized[];
  /** world/2: set when a generator materialised this task (PADR-0036). Never in a public view. */
  generatedBy?: GeneratedBy;
  /** world/2: public per-attempt limits the host enforces (PADR-0040). */
  limits?: TaskLimits;
}
/** At most `actions` accepted changes (act, undo, reset) and `checks` evaluated checks per attempt. */
export interface TaskLimits { actions?: number; checks?: number }
/** Generator id and semantic version, the seed and named parameters of a materialised task. */
export interface GeneratedBy { id: string; version: string; seed: number; parameters: Record<string, string | number> }
/** world/1 cases carry insertPosition; world/2 cases carry free text/integer params. Both become {{tokens}}. */
export interface Variant { id: string; labels: Record<string, string>; insertPosition?: number; params?: Record<string, string | number>; layoutOffset: { x: number; y: number } }
export interface PrivateWorldSource {
  owner: string; reconstructionAuthor: string;
  authorization: { reference: string; sha256: string; scope: string };
  sources: Array<{ reference: string; sha256: string }>;
}
export type WorldSchemaId = "practonaut.world/1" | "practonaut.world/2";
export interface World {
  schema: WorldSchemaId; id: string; version: string;
  /** The application and its pinned version (PADR-0045: one of the known apps of src/world/apps.ts). */
  app: WorldApp & { fontFamilies: number[]; excludedAttributes: Record<string, string> };
  units: Record<string, string>;
  objectTypes: Array<{ type: ObjectType; attributes: Record<string, "string" | "integer" | "id" | "nullable-id" | "boolean"> }>;
  initialState: State; actions: ActionDefinition[]; rules: Rule[]; tasks: Task[];
  variants: { generator: "finite-seeded-v1"; cases: Variant[] };
  provenance: { authors: string[]; adapterVersion: string; appVersion: AppVersion; compileToolVersion: string; recordings: string[]; privateSource?: PrivateWorldSource; coalescingVersion?: string };
  rights: { license: "CC0-1.0" | "LicenseRef-Private"; assets: Array<{ path: string; source: string; license: string }>; recordings: Array<{ id: string; source: string; license: string; consent: string }> };
}
/** What names a world's application: the adapter id and the exact app version it runs against. */
export interface WorldApp { adapterId: AdapterId; versionRange: AppVersion }
export type Era = 1 | 2;
export const worldEra = (world: Pick<World, "schema">): Era => world.schema === "practonaut.world/2" ? 2 : 1;
export const isStepV2 = (step: Step): step is StepV2 => Object.hasOwn(step, "shape");
export const ERROR_CODES = ["E_WORLD_INVALID", "E_ADAPTER_UNKNOWN", "E_ADAPTER_VERSION_UNSUPPORTED", "E_ADAPTER_SCHEMA_UNSUPPORTED", "invalid_argument", "precondition_failed", "limit_exceeded", "stale_base", "unmodeled", "replay_mismatch", "checker_fuel_exhausted", "checker_timeout", "checker_invalid", "counterprobe_failed", "artifact_invalid", "real_tool_disagrees", "mirror_timeout", "mirror_unavailable", "integrity_failed", "cancelled", "constraint_refused"] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export interface Failure { code: ErrorCode; message: string; details: Record<string, Scalar> }
export type Result<T> = { ok: true; value: T } | { ok: false; error: Failure };
export interface Effect { kind: EffectKind; id: string }
export type ApplyResult = { ok: true; state: State; effects: Effect[] } | { ok: false; error: Failure };
export interface ApplyContext { seed: number; prefix: Action[] }
export interface LogEntry { action: Action; hash: string }
export interface SessionData { schema: "practonaut.session/1"; world: { id: string; version: string }; seed: number; taskId: string; toolVersion: string; log: LogEntry[]; state: State; hash: string }
export interface CheckerFixture { taskId: string; kind: "reference" | "alternative" | "near-miss"; state: State; expected: boolean }
export interface CheckerData { schema: "practonaut.checker/1"; world: { id: string; version: string }; fixtures: CheckerFixture[]; heldOutTasks: Task[] }
export interface TaskVerdict { taskId: string; passed: boolean; errors: Array<{ id: string; explanation: Localized }> }
export interface CheckerVerdict { ok: true; scope: "end-state-only"; passed: boolean; tasks: TaskVerdict[]; counterprobes: { empty: false; unchanged: false; wrongArtifact: false } }

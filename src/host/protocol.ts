/** Phase-2 shared wire contract. Host owns validation and the sole committed Session. */
import type { Action, ActionDefinition, Anchor, Axis, Effect, Failure, Localized, LogEntry, Rule, State, World } from "../world/types.ts";

export const HOST_ROUTES = {
  bootstrap: "/api/bootstrap", resume: "/api/resume", observe: "/api/observe", act: "/api/act",
  undo: "/api/undo", reset: "/api/reset", variant: "/api/variant",
  hint: "/api/hint", check: "/api/check", events: "/api/events", tool: "/api/tool.png", export:'/api/export',
  demonstration: "/api/demonstration", demonstrationStop: "/api/demonstration/stop",
} as const;
export const TOKEN_HEADER = "X-Practonaut-Token";
export type MirrorMode = "required" | "off";
export const HOST_ERROR_CODES = [
  "token_required", "token_invalid", "token_in_query", "host_rejected", "origin_rejected",
  "json_required", "body_too_large", "invalid_request", "rate_limited", "bootstrap_expired",
  "bootstrap_used", "token_file_unsafe", "not_found", "method_not_allowed", "session_busy",
  "real_tool_disagrees", "mirror_timeout", "mirror_unavailable", "replay_mismatch", "stale_base",
  "E_NETWORK_AVAILABLE", "result_too_large", "diagnostic_limit", "diagnostic_unavailable", "editor_divergence", "author_required", "outcome_unknown", "action_budget_exhausted",
  "check_budget_exhausted", "demonstration_running", "demonstration_attempt", "browser_budget_exhausted",
] as const;
export type HostErrorCode = typeof HOST_ERROR_CODES[number] | Failure["code"];
export interface PublicCondition {
  id: string; text: Localized;
  /** Complete formal diagnosis, when the exact predicate has a readable narration. */
  formalText?: Localized;
  /** A layout clause's operator and parameters (PADR-0047 decision 7): what the Player and the
   * report draw as the judged geometry. A projection of the goal clause alone, never of a board. */
  layout?: LayoutOverlay;
}
/** A layout selection's scope, tagged so a frame named "all" is never every object. */
export type LayoutWhere = { kind: "all" } | { kind: "outside" } | { kind: "frame"; name: string };
export interface LayoutScope { type: "step" | "arrow"; scope: LayoutWhere; count: number }
export type LayoutOverlay =
  | { op: "noOverlap"; steps: LayoutScope; gap: number }
  | { op: "aligned"; steps: LayoutScope; axis: Axis; anchor: Anchor; tolerance: number }
  | { op: "evenlySpaced"; steps: LayoutScope; axis: Axis; tolerance: number }
  | { op: "within"; steps: LayoutScope; canvas: { x: number; y: number; width: number; height: number } }
  | { op: "arrowsNoCrossing"; arrows: LayoutScope }
  | { op: "arrowsClearOfSteps"; arrows: LayoutScope; steps: LayoutScope };
export interface ConditionResult extends PublicCondition { met: boolean }
export interface PublicCheck {
  scope: "end-state-only"; hash: string; revision: number; passed: boolean;
  conditions: ConditionResult[]; errors: Array<{ id: string; explanation: Localized }>;
  mode: "real-engine" | "model-only"; practiceEvidence: boolean;
  /** Checks left in this attempt after this one, when the attempt has a check limit (PADR-0040). */
  checksRemaining?: number;
  /** The check judged the bundled example's demonstration board: never anyone's result, never practice evidence. */
  demonstration?: true;
}
/** One limit of the current attempt: how many are allowed and how many were used (PADR-0040). */
export interface LimitCount { limit: number; used: number }
/** The current attempt's limits; a key is present only when that limit applies. Actions are accepted
 * changes (act, undo, reset); checks are evaluated checks. */
export interface PracticeLimits { actions?: LimitCount; checks?: LimitCount }
/** Who made a change: a person in the Player or the real editor, an agent through MCP, or the
 * bundled example's demonstration (host-only; no request can claim it). The client name is what the
 * MCP client declared about itself at `initialize`; it is shown, never trusted. */
export type Actor = { kind: 'human' } | { kind: 'agent'; client: string } | { kind: 'demonstration' };
/** Client names shown in the history: letters, digits and a few separators, at most 64 characters. */
export const ACTOR_CLIENT = /^[\p{L}\p{N}][\p{L}\p{N} ._+\-/@()]{0,63}$/u;
export interface HistoryItem {
  /** Text captured at the action's historical state; never recomputed from today's board. */
  description: Localized;
  actor: Actor;
  step: number; action: Action; hash: string; effects: Effect[];
  consequences: Array<{ id: string; explanation: Localized }>;
  ruleIds: string[]; mirrorConfirmed: boolean; latencyMs: number;
}
export interface HostView {
  schema: "practonaut.host/1"; sessionId: string; revision: number;
  world: { id: string; version: string }; seed: number; variantId: string;
  task: { id: string; title: Localized; prompt: Localized; conditions: PublicCondition[]; hintCount: number };
  /** The world's tasks for the task list; `level` (1-3) and `referenceActions` only for library tasks. */
  tasks: Array<{ id: string; title: Localized; level?: 1 | 2 | 3; referenceActions?: number }>;
  state: State; hash: string; step: number; log: LogEntry[]; history: HistoryItem[];
  actions: ActionDefinition[]; rules: Rule[]; mirror: MirrorMode;
  mirrorHealth: { status: 'available' | 'unavailable' | 'closed' | 'model-only'; recoveries: number };
  practiceEvidence: boolean; attempt: number; hintsOpened: number;
  /** The attempt is the bundled example's demonstration until a reset or variant replaces it (src/host/demonstration.ts). */
  demonstration?: true;
  hints: Localized[]; result: PublicCheck | null;
  errors: Array<{ id: string; explanation: Localized }>;
  /** Present when the attempt has a task or session limit (PADR-0040). */
  limits?: PracticeLimits;
}
export interface RevisionRequest { expectedRevision: number }
/** Internal monotonic deadline, set at HTTP admission and never taken from wire input. */
export interface TransactionContext { deadline:number }
export interface ActRequest extends RevisionRequest { action: Action; actor?: Actor }
/** An undo through MCP names the agent's client like an act does (shown, never trusted). */
export interface UndoRequest extends RevisionRequest { actor?: Actor }
/** `attempt`: the number the new attempt gets, set only by the host's demonstration (its own
 * attempt never counts); no HTTP request can carry it. */
export interface ResetRequest extends RevisionRequest { confirmed: true; actor?: Actor; attempt?: number }
export interface VariantRequest extends RevisionRequest { confirmed: true; taskId?: string; attempt?: number }
export type HostReply<T> = { ok: true; value: T } | { ok: false; error: { code: HostErrorCode; message: string; details?: Record<string, string | number | boolean | null> } };
/** What one mutation changed (see `mutationDelta`): public data, sized by the change, not the board. */
export interface MutationDelta {
  step: number; revision: number; hash: string;
  /** Objects that differ after the mutation, as they are now; a deleted object keeps its tombstone. */
  changed: Record<string, State['objects'][string]>;
  created: string[]; removed: string[]; effects: Effect[];
  errors: Array<{ id: string; explanation: Localized }>;
  /** Set when the changed objects were too large to send (DELTA_LIMIT_BYTES): observe instead. */
  changedOmitted?: true;
  /** The attempt's limits after this change, when it has any. */
  limits?: PracticeLimits;
}
export interface MutationReply { view: HostView; delta: MutationDelta; mirrorConfirmed: boolean; latencyMs: number }
/** The HTTP reply to a mutation that asked for `reply: "delta"` (the MCP bridge does): the same
 * reply without the view. The Player omits `reply` and keeps receiving the view. */
export type MutationDeltaReply = Omit<MutationReply, 'view'>;
export interface BootstrapRequest { code: string }
/** Why a Player session runs on the model only, and what gets the real engine: set by the CLI that
 * started the session (`missing`: no Chromium, `start`: Chromium did not start, `off`: `--mirror off`).
 * `command` is the suggestion in the form the user started the CLI; `megabytes` the download size. */
export interface ModelOnlyNotice { reason: 'missing' | 'start' | 'off'; command?: string; download?: { name: string; megabytes: number } }
export type DemonstrationState = 'running' | 'finished' | 'stopped' | 'failed';
/** The bundled example's demonstration (`src/host/demonstration.ts`): Player-only metadata. */
export interface DemonstrationStatus {
  state: DemonstrationState;
  /** The task and the fresh attempt the demonstration runs in. */
  taskId: string; attempt: number;
  /** Planned and committed actions. */
  total: number; done: number;
  /** The result check's verdict, once it ran (`finished`). */
  passed?: boolean;
  /** Why it ended early (`failed`): the refusal of an action or of the check. */
  error?: HostErrorCode;
}
export interface DemonstrationRequest extends RevisionRequest { confirmed: true }
/** Present in a session that offers the demonstration: the tasks that have one and its status. */
export interface DemonstrationInfo { tasks: string[]; status: DemonstrationStatus | null }
export interface BootstrapReply { token: string; authorToken?: string; view: HostView; engineOrigin?:string; authorEnabled?:boolean; modelOnly?: ModelOnlyNotice; demonstration?: DemonstrationInfo }
/** Same-session reload metadata, authenticated by the existing header credential. */
export interface ResumeReply { view: HostView; engineOrigin?: string; authorEnabled?: boolean; modelOnly?: ModelOnlyNotice; demonstration?: DemonstrationInfo }
export type HostEvent =
  | { type: "ready" | "changed"; view: HostView }
  | { type: "rejected"; revision: number; hash: string; error: { code: HostErrorCode; message: string } }
  | { type: "heartbeat"; revision: number }
  | { type: "demonstration"; status: DemonstrationStatus | null };

/** Static shell/assets and bootstrap are public; authenticated API reads/mutations are header-only. */
export interface ServeOptions { seed?: number; taskId?: string; mirror?: MirrorMode; tokenDirectory?: string;
  /** `--checks <n>`: a session check limit; with a task's own limit the smaller one applies. */
  checks?: number;
  /** Task-list facts by task id; defaults to the bundled library's when the world is the library. */
  taskInfo?: Record<string, { level: 1 | 2 | 3; referenceActions: number }>;
  /** Offer the bundled example's demonstration (`practonaut` and `play` without a world set it; the
   * host also checks that the world is that example). */
  demonstration?: boolean;
  /** Why this session is model-only, for the Player's banner (set by the CLI with `mirror: "off"`). */
  modelOnly?: ModelOnlyNotice;
  /** A bench host (PADR-0036): the task list holds only the session's own task, and every variant
   * request (another task, a new variant, a restart of its own task) and every hint request is
   * refused with `invalid_request`; reset is the counted way back to the start. The Player's `play`
   * and `serve` keep every task, variant and hint. */
  singleTask?: boolean }
/** Credentials are runtime-only; callers must never log token or write it to tracked files. */
export interface RunningHost {
  origin: string; url: string; port: number; token: string; code: string; tokenFile: string;
  /** Issues a new one-use bootstrap link and revokes the previous unused one. */
  issueUrl(): string;
  /** Closes the host. Its browser closes run under the close contract with `deadline` (default: now
   * plus 8 s, PADR-0050); it rejects ("could not be fully confirmed") only when a close failed. */
  close(deadline?: number): Promise<void>;
}

/** Internal seam between HTTP ownership and atomic kernel/mirror ownership. */
export interface PracticeController {
  view(): HostView;
  act(request: ActRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  undo(request: UndoRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  reset(request: ResetRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  variant(request: VariantRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  hint(request: RevisionRequest, context?:TransactionContext): Promise<HostReply<HostView>>;
  check(request: RevisionRequest, context?:TransactionContext): Promise<HostReply<PublicCheck>>;
  png(context?:TransactionContext): Promise<HostReply<Uint8Array>>;
  /** `options.picture` adds the engine's SVG of the same confirmed scene (in-process callers only). */
  export(request:RevisionRequest,context?:TransactionContext,options?:{picture?:boolean}):Promise<HostReply<import('./export-pair.ts').CurrentSessionExport>>;
  subscribe(listener: (event: HostEvent) => void): () => void;
  editor?(request: import('./author-protocol.ts').EditorGestureRequest,context?:TransactionContext): Promise<HostReply<MutationReply>>;
  scene?(): import('../adapters/excalidraw/raw.ts').RawElement[];
  /** Closes the session and its mirror under the close contract (PADR-0050): settles by `deadline` and
   * passes the outcome up; nothing returned counts as closed. */
  close(deadline?: number): Promise<import('../adapters/browser/close.ts').CloseResult | void>;
}
export type ControllerFactory = (world: World, options?: ServeOptions) => Promise<PracticeController>;

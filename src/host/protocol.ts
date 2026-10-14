/** Phase-2 shared wire contract. Host owns validation and the sole committed Session. */
import type { Action, ActionDefinition, Effect, Failure, Localized, LogEntry, Rule, State, World } from "../world/types.ts";

export const HOST_ROUTES = {
  bootstrap: "/api/bootstrap", resume: "/api/resume", observe: "/api/observe", act: "/api/act",
  undo: "/api/undo", reset: "/api/reset", variant: "/api/variant",
  hint: "/api/hint", check: "/api/check", events: "/api/events", tool: "/api/tool.png", export:'/api/export',
} as const;
export const TOKEN_HEADER = "X-Practonaut-Token";
export type MirrorMode = "required" | "off";
export const HOST_ERROR_CODES = [
  "token_required", "token_invalid", "token_in_query", "host_rejected", "origin_rejected",
  "json_required", "body_too_large", "invalid_request", "rate_limited", "bootstrap_expired",
  "bootstrap_used", "token_file_unsafe", "not_found", "method_not_allowed", "session_busy",
  "real_tool_disagrees", "mirror_timeout", "mirror_unavailable", "replay_mismatch", "stale_base",
  "E_NETWORK_AVAILABLE", "result_too_large", "diagnostic_limit", "diagnostic_unavailable", "editor_divergence", "author_required", "outcome_unknown", "action_budget_exhausted",
] as const;
export type HostErrorCode = typeof HOST_ERROR_CODES[number] | Failure["code"];
export interface PublicCondition {
  id: string; text: Localized;
  /** Complete formal diagnosis, when the exact predicate has a readable narration. */
  formalText?: Localized;
}
export interface ConditionResult extends PublicCondition { met: boolean }
export interface PublicCheck {
  scope: "end-state-only"; hash: string; revision: number; passed: boolean;
  conditions: ConditionResult[]; errors: Array<{ id: string; explanation: Localized }>;
  mode: "real-engine" | "model-only"; practiceEvidence: boolean;
}
/** Who made a change: a person in the Player or the real editor, or an agent through MCP. The
 * client name is what the MCP client declared about itself at `initialize`; it is shown, never trusted. */
export type Actor = { kind: 'human' } | { kind: 'agent'; client: string };
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
  hints: Localized[]; result: PublicCheck | null;
  errors: Array<{ id: string; explanation: Localized }>;
}
export interface RevisionRequest { expectedRevision: number }
/** Internal monotonic deadline, set at HTTP admission and never taken from wire input. */
export interface TransactionContext { deadline:number }
export interface ActRequest extends RevisionRequest { action: Action; actor?: Actor }
export interface ResetRequest extends RevisionRequest { confirmed: true }
export interface VariantRequest extends RevisionRequest { confirmed: true; taskId?: string }
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
}
export interface MutationReply { view: HostView; delta: MutationDelta; mirrorConfirmed: boolean; latencyMs: number }
/** The HTTP reply to a mutation that asked for `reply: "delta"` (the MCP bridge does): the same
 * reply without the view. The Player omits `reply` and keeps receiving the view. */
export type MutationDeltaReply = Omit<MutationReply, 'view'>;
export interface BootstrapRequest { code: string }
export interface BootstrapReply { token: string; authorToken?: string; view: HostView; engineOrigin?:string; authorEnabled?:boolean }
/** Same-session reload metadata, authenticated by the existing header credential. */
export interface ResumeReply { view: HostView; engineOrigin?: string; authorEnabled?: boolean }
export type HostEvent =
  | { type: "ready" | "changed"; view: HostView }
  | { type: "rejected"; revision: number; hash: string; error: { code: HostErrorCode; message: string } }
  | { type: "heartbeat"; revision: number };

/** Static shell/assets and bootstrap are public; authenticated API reads/mutations are header-only. */
export interface ServeOptions { seed?: number; taskId?: string; mirror?: MirrorMode; tokenDirectory?: string;
  /** Task-list facts by task id; defaults to the bundled library's when the world is the library. */
  taskInfo?: Record<string, { level: 1 | 2 | 3; referenceActions: number }>;
  /** A bench host (PADR-0036): the task list holds only the session's own task, and a change to another
   * task is refused. The Player's `play` and `serve` keep every task. */
  singleTask?: boolean }
/** Credentials are runtime-only; callers must never log token or write it to tracked files. */
export interface RunningHost {
  origin: string; url: string; port: number; token: string; code: string; tokenFile: string;
  /** Issues a new one-use bootstrap link and revokes the previous unused one. */
  issueUrl(): string;
  close(): Promise<void>;
}

/** Internal seam between HTTP ownership and atomic kernel/mirror ownership. */
export interface PracticeController {
  view(): HostView;
  act(request: ActRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  undo(request: RevisionRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  reset(request: ResetRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  variant(request: VariantRequest, context?:TransactionContext): Promise<HostReply<MutationReply>>;
  hint(request: RevisionRequest, context?:TransactionContext): Promise<HostReply<HostView>>;
  check(request: RevisionRequest, context?:TransactionContext): Promise<HostReply<PublicCheck>>;
  png(context?:TransactionContext): Promise<HostReply<Uint8Array>>;
  export(request:RevisionRequest,context?:TransactionContext):Promise<HostReply<import('./export-pair.ts').CurrentSessionExport>>;
  subscribe(listener: (event: HostEvent) => void): () => void;
  editor?(request: import('./author-protocol.ts').EditorGestureRequest,context?:TransactionContext): Promise<HostReply<MutationReply>>;
  scene?(): import('../adapters/excalidraw/raw.ts').RawElement[];
  close(): Promise<void>;
}
export type ControllerFactory = (world: World, options?: ServeOptions) => Promise<PracticeController>;

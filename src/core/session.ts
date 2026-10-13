import { canonicalJson, stateHash } from "../canonical/index.ts";
import { generateVariant } from "../world/variant.ts";
import { preflightJson, WorldError } from "../world/preflight.ts";
import { validateState, validateWorld } from "../world/schema.ts";
import { RUNTIME_LIMITS } from "../world/limits.ts";
import { PACKAGE_VERSION } from "../version.ts";
import type { Action, ApplyResult, LogEntry, Result, SessionData, State, World } from "../world/types.ts";
import { createSessionTransitions, failure } from "./apply.ts";

export interface ReplayState { state: State; hash: string }
/** A trusted caller may stop traversal; the callback receives no state or authority. */
export interface ReplayOptions { continue?: () => boolean }
function continuing(options: ReplayOptions): boolean {
  try { return options.continue === undefined || options.continue() === true; } catch { return false; }
}
const cancelledReplay = () => failure('cancelled', 'replay traversal cancelled');
export class SessionError extends Error {
  readonly code = "replay_mismatch";
  constructor(message: string) { super(message); this.name = "SessionError"; }
}
interface Snapshot { data: Buffer; bytes: number }

/** State/log getters are detached copies; Session.act is the only mutation path. */
export class Session {
  readonly #seed: number;
  readonly #taskId: string;
  readonly #world: World;
  readonly #initial: State;
  readonly #transitions: ReturnType<typeof createSessionTransitions>;
  #state: State;
  #log: LogEntry[] = [];
  #snapshots = new Map<number, Snapshot>();
  #snapshotBytes = 0;
  constructor(world: World, seed: number, taskId: string) {
    if (!Number.isSafeInteger(seed)) throw new WorldError('seed must be a safe integer');
    if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(taskId)) throw new WorldError('taskId must be a valid identifier');
    this.#world = validateWorld(generateVariant(validateWorld(world), seed));
    this.#seed = seed; this.#taskId = taskId;
    const task = this.#world.tasks.find(t => t.id === taskId);
    if (!task) throw new WorldError(`unknown task: ${taskId}`);
    this.#initial = validateState(structuredClone(task.initialState ?? this.#world.initialState));
    this.#state = structuredClone(this.#initial);
    this.#transitions = createSessionTransitions(this.#world, seed, taskId);
  }
  get seed(): number { return this.#seed; }
  get taskId(): string { return this.#taskId; }
  get state(): State { return structuredClone(this.#state); }
  get world(): World { return structuredClone(this.#world); }
  get log(): LogEntry[] { return structuredClone(this.#log); }
  get hash(): string { return stateHash(this.#state); }
  get step(): number { return this.#log.length; }
  get snapshotCount(): number { return this.#snapshots.size; }
  get snapshotBytes(): number { return this.#snapshotBytes; }
  act(action: Action): ApplyResult {
    if (this.#log.length >= RUNTIME_LIMITS.maxActions) return failure("limit_exceeded", "session action limit reached");
    const step = this.step;
    // Store UTF-8 buffers rather than object graphs: retained payload bytes are measurable.
    const data = Buffer.from(canonicalJson(this.#state), "utf8");
    const bytes = data.byteLength;
    const result = this.#transitions.act(this.#state, action);
    if (!result.ok) return result;
    if (bytes <= RUNTIME_LIMITS.maxSnapshotBytes) {
      while (this.#snapshots.size >= RUNTIME_LIMITS.maxSnapshots || this.#snapshotBytes + bytes > RUNTIME_LIMITS.maxSnapshotBytes) {
        const oldest = this.#snapshots.keys().next().value;
        if (oldest === undefined) break;
        this.#snapshotBytes -= this.#snapshots.get(oldest)!.bytes; this.#snapshots.delete(oldest);
      }
      this.#snapshots.set(step, { data, bytes }); this.#snapshotBytes += bytes;
    }
    this.#state = result.state;
    this.#log.push({ action: structuredClone(action), hash: this.hash });
    return { ...result, state: this.state };
  }
  undo(): Result<ReplayState> {
    if (!this.#log.length) return { ok: true, value: { state: this.state, hash: this.hash } };
    const target = this.step - 1;
    const snapshot = this.#snapshots.get(target);
    const restored = snapshot ? JSON.parse(snapshot.data.toString("utf8")) as State : undefined;
    const replay = restored ? { ok: true as const, value: { state: restored, hash: stateHash(restored) } } : this.replay(this.#log.slice(0, target));
    if (!replay.ok) return replay;
    this.#log.pop(); this.#state = replay.value.state; this.#transitions.truncate(target);
    for (const [step, snap] of this.#snapshots) if (step >= target) { this.#snapshotBytes -= snap.bytes; this.#snapshots.delete(step); }
    return { ok: true, value: { state: this.state, hash: this.hash } };
  }
  reset(): Result<ReplayState> {
    this.#state = structuredClone(this.#initial); this.#log = []; this.#snapshots.clear(); this.#snapshotBytes = 0; this.#transitions.reset();
    return { ok: true, value: { state: this.state, hash: this.hash } };
  }
  replay(log: readonly LogEntry[] = this.#log, options: ReplayOptions = {}): Result<ReplayState> {
    if (!continuing(options)) return cancelledReplay();
    try { preflightJson(log); } catch (error) {
      if (error instanceof WorldError) return failure("replay_mismatch", error.message);
      throw error;
    }
    if (!Array.isArray(log)) return failure("replay_mismatch", "replay log is not an array");
    if (log.length > RUNTIME_LIMITS.maxActions) return failure("limit_exceeded", "replay action limit reached");
    const privateLog = structuredClone(log);
    if (!continuing(options)) return cancelledReplay();
    let state = structuredClone(this.#initial);
    const transitions = createSessionTransitions(this.#world, this.seed, this.taskId);
    for (let index = 0; index < privateLog.length; index++) {
      if (!continuing(options)) return cancelledReplay();
      const entry = privateLog[index]!;
      if (!entry || typeof entry !== "object" || Object.keys(entry).sort().join(",") !== "action,hash" || typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/.test(entry.hash)) return failure("replay_mismatch", "invalid log entry", { index });
      const result = transitions.act(state, entry.action);
      if (!result.ok) return failure("replay_mismatch", "replay action rejected", { index, cause: result.error.code });
      state = result.state;
      const hash = stateHash(state);
      if (hash !== entry.hash) return failure("replay_mismatch", "replay step hash mismatch", { index, expected: entry.hash, actual: hash });
    }
    if (!continuing(options)) return cancelledReplay();
    return { ok: true, value: { state, hash: stateHash(state) } };
  }
  checkReplay(options: ReplayOptions = {}): Result<ReplayState> {
    const replay = this.replay(this.#log, options);
    if (!replay.ok) return replay;
    if (replay.value.hash !== this.hash) return failure("replay_mismatch", "live state differs from replay");
    if (!continuing(options)) return cancelledReplay();
    return replay;
  }
  serialize(options: ReplayOptions = {}): SessionData {
    const replay = this.checkReplay(options);
    if (!replay.ok) throw new SessionError(replay.error.message);
    return { schema: "practonaut.session/1", world: { id: this.#world.id, version: this.#world.version }, seed: this.seed, taskId: this.taskId, toolVersion: PACKAGE_VERSION, log: this.log, state: this.state, hash: this.hash };
  }
}

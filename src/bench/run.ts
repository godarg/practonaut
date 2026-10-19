/**
 * `practonaut bench`: every run gets its own host, its own private run directory and a fresh agent
 * process. The agent's PRACTONAUT_HOME and working directory are the run's `agent/` subdirectory;
 * the judged artifacts are written next to it, into the run directory, after the agent has ended,
 * and replace whatever is there (a file the agent left under an artifact's name cannot block
 * judging). The agent reaches the session only through `practonaut mcp` (attach mode, session token
 * in a private file). Its output is opaque: the score comes from the host's history and from the
 * independent checker, started as a separate process after the agent ends.
 *
 * Every host loads the public world from its package bytes, which are hashed before the first run and
 * kept in memory; the world and the references are written to the bench folder only after the last
 * agent has ended (PADR-0036), so no agent finds them there while it runs.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { arch, homedir, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packWorld, readWorldPackage } from '../package/index.ts';
import { loadWorldPackage } from '../world/index.ts';
import { LIBRARIES, loadLibraryOf, type LibraryApp, type LibraryEntry } from '../library/index.ts';
import { startHost } from '../host/server.ts';
import { createPracticeSession, type PracticeSessionOptions } from '../host/session.ts';
import type { ActRequest, Actor, ControllerFactory, HostReply, MirrorMode, MutationReply, PracticeController, RunningHost } from '../host/protocol.ts';
import { ensurePrivateDirectory } from '../platform/private-fs.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import { checkInProcess, traceInProcess } from '../cli/runtime.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { sha256Hex } from '../canonical/index.ts';
import { EXCALIDRAW_APP_VERSION } from '../adapters/excalidraw/index.ts';
import type { CheckerVerdict, SessionData, World } from '../world/types.ts';
import type { TaskOracle } from '../authoring/from-scenes.ts';
import { analyseLengthForSeeds } from '../authoring/minimal-length.ts';
import { StdioMcpClient, type ClientCall, type McpServerEntry } from './mcp-client.ts';
import { mutationCounts, MutationRecorder, normaliseCallLog, parseCallLog, parseMutations, readLogHead, RUN_EVIDENCE, timelineOf, MAX_LOG_BYTES } from './evidence.ts';
import { runOracle, runRandom } from './baselines.ts';
import { agentArguments, agentEnvironment, BENCH_PROMPT, clientOf, displayCommand, requestedBilling, requestedModelOf, vendorOf, type AgentSpec } from './agents.ts';
import { readClientEvidence, stdoutTail, type ClientEvidence } from './client-evidence.ts';
import { apiKeySourceValue } from './parsers.ts';
import { instanceIdentities } from './identity.ts';
import { MCP_TOOL_NAMES } from '../mcp/contracts.ts';
import { spawnable } from '../platform/spawnable.ts';
import { BENCH_REFERENCES_FILE, BENCH_SCHEMA, BENCH_WORLD_FILE, BenchReportError, derivedPass, nativeFileName, presetIsolation, summarize, validateBenchReportV3, type AgentV3, type BenchReportV3, type RunFailure, type SessionReportV3, type SessionRunV3 } from './report.ts';
import { assertReferencesFit, libraryBenchWorld, libraryReferences, referencesText, worldContentHash, worldFromPackage, type BenchReference, type BenchWorld } from './world.ts';
export { worldContentHash } from './world.ts';

export interface BenchOptions {
  agent: AgentSpec; tasks: string[]; seeds: number[]; repeats: number;
  timeoutSeconds: number; maxActions: number; mirrorRequested: 'auto' | 'required' | 'off'; mirror: MirrorMode;
  /** The world to bench (default: the bundled library) and the validated references of its tasks
   * (default for the library: its reference solutions; an own world has only those given). */
  world?: BenchWorld; references?: ReadonlyMap<string, BenchReference>;
  /** `--label`: stored in the report as given. */
  label?: string;
  /** `--checks`: checks allowed per run; with a task's own limit the smaller applies (PADR-0040). */
  checks?: number;
  /** `--stop-on-infra`: stop at the first infra_error run (a usage or rate limit, an API error, an
   * agent that ended without a tool call) and write the partial report (PADR-0040). */
  stopOnInfra?: boolean;
  /** Variables a preset agent gets although `withheldFromPreset` names them (`--keep-env`). */
  keepEnv?: readonly string[];
  /** Progress lines (stderr in the CLI). */
  progress?: (line: string) => void;
  /** Aborted on Ctrl+C, SIGTERM or SIGHUP: the running agent is stopped, its session closed, and the
   * report holds the runs that finished. */
  signal?: AbortSignal;
}
export interface RunCounters { observe: number; act: number; accepted: number; rejected: number; undoCalls: number; undos: number; resetCalls: number; resets: number; check: number; mutations: number }

/** Counts every host operation and refuses mutations beyond the action budget with a named error.
 * With a recorder, every act, undo and reset that reaches it is written to the run's mutation log
 * (PADR-0039): the action, the client the agent declared, accepted or rejected with the error code,
 * and the step and revision afterwards. The wrapped controller is the host's only session; this
 * changes nothing it decides. */
export function countingController(inner: PracticeController, counters: RunCounters, maxActions: number, recorder?: MutationRecorder): PracticeController {
  const exhausted = <T>(): HostReply<T> => ({ ok: false, error: { code: 'action_budget_exhausted', message: `This run's action budget (${maxActions} act, undo or reset calls) is used up` } });
  const note = (op: 'act' | 'undo' | 'reset', reply: HostReply<MutationReply>, extra: { action?: ActRequest['action']; client?: string | null } = {}): void => {
    if (!recorder) return;
    if (reply.ok) { const { step, revision } = reply.value.view; recorder.record({ op, ...extra, outcome: 'accepted', position: () => ({ step, revision }) }); return; }
    recorder.record({ op, ...extra, outcome: 'rejected', code: reply.error.code, position: () => { const now = inner.view(); return { step: now.step, revision: now.revision }; } });
  };
  const clientOf = (actor: Actor | undefined): string | null => actor?.kind === 'agent' ? actor.client : null;
  const controller: PracticeController = {
    view: () => { counters.observe++; return inner.view(); },
    act: async (request, context) => {
      counters.act++;
      const extra = { action: request.action, client: clientOf(request.actor) };
      if (counters.mutations >= maxActions) { counters.rejected++; const refused = exhausted<MutationReply>(); note('act', refused, extra); return refused; }
      counters.mutations++;
      const reply = await inner.act(request, context);
      if (reply.ok) counters.accepted++; else counters.rejected++;
      note('act', reply, extra);
      return reply;
    },
    undo: async (request, context) => {
      counters.undoCalls++;
      const extra = { client: clientOf(request.actor) };
      if (counters.mutations >= maxActions) { const refused = exhausted<MutationReply>(); note('undo', refused, extra); return refused; }
      counters.mutations++;
      const reply = await inner.undo(request, context); if (reply.ok) counters.undos++; note('undo', reply, extra); return reply;
    },
    reset: async (request, context) => {
      counters.resetCalls++;
      const extra = { client: clientOf(request.actor) };
      if (counters.mutations >= maxActions) { const refused = exhausted<MutationReply>(); note('reset', refused, extra); return refused; }
      counters.mutations++;
      const reply = await inner.reset(request, context); if (reply.ok) counters.resets++; note('reset', reply, extra); return reply;
    },
    // Every check is recorded host-side too (PADR-0040): `report --verify` counts a task's check
    // limit from these records, never from the agent's call log.
    check: async (request, context) => {
      counters.check++;
      const reply = await inner.check(request, context);
      recorder?.record({ op: 'check', client: null, outcome: reply.ok ? 'accepted' : 'rejected', ...(reply.ok ? {} : { code: reply.error.code }), position: () => { const now = inner.view(); return { step: now.step, revision: now.revision }; } });
      return reply;
    },
    // Nothing to count: the bench host is single-task and refuses every variant and hint request.
    variant: (request, context) => inner.variant(request, context),
    hint: (request, context) => inner.hint(request, context),
    png: context => inner.png(context),
    export: (request, context, options) => inner.export(request, context, options),
    subscribe: listener => inner.subscribe(listener),
    close: () => inner.close(),
  };
  return controller;
}

const CLI_ENTRY = fileURLToPath(new URL(`../cli/main.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url));
export function benchId(now = new Date()): string { return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + randomBytes(2).toString('hex'); }

/** The bundled library as a bench/1 report names it: `report --verify` of a /1 report re-judges
 * against this (PADR-0030); /2 reports carry their own stored world. `contentHash` is the SHA-256 of
 * the world's canonical JSON. */
export async function libraryWorld(app: string = 'excalidraw'): Promise<{ world: World; entries: Map<string, LibraryEntry>; contentHash: string }> {
  // The library this Practonaut ships for an application (PADR-0049 decision 8.2); /1 reports name Excalidraw's.
  if (!Object.hasOwn(LIBRARIES, app)) throw new Error(`no bundled library for ${app}`);
  const library = LIBRARIES[app as LibraryApp];
  const world = loadWorldPackage(await readWorldPackage(await packWorld(library.worldDir)));
  return { world, entries: new Map(loadLibraryOf(library.app).library.tasks.map(entry => [entry.id, entry])), contentHash: worldContentHash(world) };
}

/** The public limits of the benched tasks that have them (PADR-0040), as a report records them. */
export function taskLimitsOf(world: World, tasks: readonly string[]): Array<{ taskId: string; actions?: number; checks?: number }> {
  return tasks.flatMap(taskId => { const limits = world.tasks.find(task => task.id === taskId)?.limits; return limits ? [{ taskId, ...limits }] : []; });
}

/** File names of a run's judged artifacts inside its run directory (`<bench>/<run-id>/`); `native` is
 * the Excalidraw adapter's (/1, /2), `nativeFile` names it per adapter (/3, PADR-0044 decision 1). */
export const RUN_ARTIFACTS = Object.freeze({ session: 'session.json', native: 'native.excalidraw', checker: 'checker.json' });
export const nativeFile = (adapterId: string): string => nativeFileName(adapterId);
/** The tool names Practonaut's bridge advertises to every bench agent (`toolchain.tools`). */
export const BRIDGE_TOOLS: readonly string[] = Object.freeze([...MCP_TOOL_NAMES]);
/** Writes a judged artifact through a fresh temporary file and a rename, so it replaces whatever the
 * agent may have left under that name; anything that is not a replaceable file fails the write. */
async function writeRunArtifact(directory: string, name: string, text: string | Uint8Array): Promise<void> {
  const temporary = join(directory, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  try { await writeFile(temporary, text, { mode: 0o600, flag: 'wx' }); await rename(temporary, join(directory, name)); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

/** The world the hosts run, loaded from the package bytes whose hash the report binds. */
async function benchedWorld(prepared: BenchWorld): Promise<{ world: World; bytes: Buffer; sha256: string }> {
  const bytes = Buffer.from(prepared.bytes), world = await worldFromPackage(bytes);
  if (worldContentHash(world) !== prepared.contentHash) throw new Error('the world package differs from the world prepared for the bench');
  return { world, bytes, sha256: sha256Hex(bytes) };
}
/** Writes the world after the runs and reads it back: the stored bytes must be the bound ones. */
async function storeWorld(directory: string, bytes: Buffer, sha256: string): Promise<void> {
  await writeRunArtifact(directory, BENCH_WORLD_FILE, bytes);
  if (sha256Hex(await readFile(join(directory, BENCH_WORLD_FILE))) !== sha256) throw new Error('the stored world differs from the world the runs used');
}

/** A run note never spells out a local path: every absolute path is cut to its last component. */
export function scrubPaths(text: string): string {
  return text.replace(/(?:[A-Za-z]:)?[\\/](?:[^\s'"`\\/]+[\\/])+/g, '…/');
}
/** The note of a run that could not be judged: the error class and a path-free message. */
export function infraNote(error: unknown): string {
  if (!(error instanceof Error)) return 'infrastructure failure';
  return scrubPaths(`${(error as Error & { code?: string }).code ?? 'error'}: ${error.message}`).slice(0, 256);
}

/** Agent processes that are running now; a forced stop (second Ctrl+C) ends their groups at once. */
const runningAgents = new Set<number>();
/** The running agent's process id (its process group's on POSIX), in the run folder. */
const AGENT_PID_FILE = 'agent.pid';
/** Whether the agent whose id a run folder records still runs (POSIX: anything of its process group). */
function agentAlive(pid: number): boolean {
  try { process.kill(process.platform === 'win32' ? pid : -pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
export function killRunningAgents(): void { for (const pid of runningAgents) killProcessTree(pid, 'SIGKILL'); }

export function verdictOf(verdict: CheckerVerdict, taskId: string): { passed: boolean; errorClasses: string[] } {
  const task = verdict.tasks.find(value => value.taskId === taskId);
  return { passed: verdict.passed && task?.passed === true, errorClasses: (task?.errors ?? []).map(error => error.id).slice(0, 64) };
}

interface AgentOutcome { status: SessionRunV3['status'] | 'interrupted'; exitCode: number | null; note?: string; stdout?: string; failure?: RunFailure }
/** A failure the runner itself decided (no parser, no client code, unknown model work). */
const runnerFailure = (reason: Extract<RunFailure['reason'], 'no_tool_call' | 'interrupted' | 'runner'>): RunFailure => ({ reason, parser: null, code: null, beforeModelWork: null });
/** How a run's note names a client failure; the gate reads the first two (rejected by the client). */
export const CLIENT_FAILURE_WORDS = Object.freeze({ usage_limit: 'a usage or rate limit', auth: 'an authentication or billing error', api_error: 'an API error' });
/** An external run the client's own stream marks as an infrastructure error: not judged. */
class ClientInfraError extends Error { readonly outcome: AgentOutcome; constructor(outcome: AgentOutcome) { super(outcome.note ?? "infra_error"); this.outcome = outcome; } }

/**
 * Ends an agent and everything it started. POSIX: the agent leads its own process group (spawned
 * detached), so the signal goes to the group. Windows has no process groups; `taskkill /T /F` ends
 * the process tree (a plain kill would leave a `cmd.exe` child or the agent's own children running).
 */
export function killProcessTree(pid: number | undefined, signal: NodeJS.Signals, platform: NodeJS.Platform = process.platform,
  run: (command: string, args: string[]) => void = (command, args) => { spawn(command, args, { stdio: 'ignore', windowsHide: true }).once('error', () => {}); },
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill): void {
  if (pid === undefined) return;
  try {
    if (platform === 'win32') run('taskkill', ['/pid', String(pid), '/T', '/F']);
    else kill(-pid, signal);
  } catch { /* already gone */ }
}

async function runExternal(argv: string[], cwd: string, env: NodeJS.ProcessEnv, logs: string, deadlineMs: number, signal?: AbortSignal): Promise<AgentOutcome> {
  const stdout = await open(join(logs, 'agent.stdout'), 'w', 0o600), stderr = await open(join(logs, 'agent.stderr'), 'w', 0o600);
  try {
    return await new Promise<AgentOutcome>(resolve => {
      if (signal?.aborted) { resolve({ status: 'interrupted', exitCode: null }); return; }
      const posix = process.platform !== 'win32';
      const { command, args, windowsVerbatimArguments } = spawnable(argv);
      const child = spawn(command, args, { cwd, env, stdio: ['pipe', stdout.fd, stderr.fd], detached: posix, windowsHide: true, ...(windowsVerbatimArguments ? { windowsVerbatimArguments } : {}) });
      if (child.pid !== undefined) runningAgents.add(child.pid);
      // Beside the run's logs: `bench --recover` refuses while the agent of a killed bench still runs.
      if (child.pid !== undefined) try { writeFileSync(join(logs, AGENT_PID_FILE), `${child.pid}\n`, { mode: 0o600 }); } catch { /* recovery then cannot tell */ }
      let timedOut = false, interrupted = false, settled = false, hardKill: ReturnType<typeof setTimeout> | undefined;
      const stop = (): void => { killProcessTree(child.pid, 'SIGTERM'); hardKill = setTimeout(() => killProcessTree(child.pid, 'SIGKILL'), 3_000); hardKill.unref(); };
      const timer = setTimeout(() => { timedOut = true; stop(); }, deadlineMs);
      const onAbort = (): void => { if (settled) return; interrupted = true; stop(); };
      signal?.addEventListener('abort', onAbort, { once: true });
      const finish = (outcome: AgentOutcome): void => { if (settled) return; settled = true; if (child.pid !== undefined) runningAgents.delete(child.pid); clearTimeout(timer); clearTimeout(hardKill); signal?.removeEventListener('abort', onAbort); resolve(outcome); };
      child.once('error', () => finish({ status: 'agent_failed', exitCode: null, note: `agent command could not start: ${argv[0]}` }));
      // The agent's exit does not end what it started: the rest of its group (or tree) goes too.
      child.once('exit', code => { killProcessTree(child.pid, 'SIGKILL'); finish(interrupted ? { status: 'interrupted', exitCode: code } : timedOut ? { status: 'timeout', exitCode: code } : { status: code === 0 ? 'completed' : 'agent_failed', exitCode: code }); });
      child.stdin!.on('error', () => { /* the agent may not read stdin */ });
      child.stdin!.end(BENCH_PROMPT + '\n');
    });
  } finally { await stdout.close(); await stderr.close(); }
}

async function runBuiltin(spec: Extract<AgentSpec, { kind: 'builtin' }>, entry: McpServerEntry, context: { cwd: string; env: NodeJS.ProcessEnv; world: World; seed: number; oracle: Pick<TaskOracle, 'steps'> | undefined; maxActions: number; deadlineMs: number; randomSeed: number; signal?: AbortSignal; calls: ClientCall[] }): Promise<AgentOutcome> {
  let client: StdioMcpClient | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    client = await StdioMcpClient.start(entry, { cwd: context.cwd, env: context.env });
    const baseline = { client, world: context.world, seed: context.seed, oracle: context.oracle, maxActions: context.maxActions, randomSeed: context.randomSeed, deadline: Date.now() + context.deadlineMs };
    const work = spec.name === 'oracle' ? runOracle(baseline) : runRandom(baseline);
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), context.deadlineMs); });
    const interrupted = new Promise<'interrupted'>(resolve => { if (context.signal?.aborted) resolve('interrupted'); context.signal?.addEventListener('abort', () => resolve('interrupted'), { once: true }); });
    const result = await Promise.race([work, timeout, interrupted]);
    if (result === 'timeout') return { status: 'timeout', exitCode: null };
    if (result === 'interrupted') return { status: 'interrupted', exitCode: null };
    return { status: 'completed', exitCode: 0, ...(result.note ? { note: result.note } : {}) };
  } catch (error) {
    return { status: 'agent_failed', exitCode: null, note: (error instanceof Error ? error.message : 'baseline failed').slice(0, 200) };
  } finally { clearTimeout(timer); await client?.close().catch(() => {}); if (client) context.calls.push(...client.calls); }
}


/** The run's evidence beside its judged artifacts (PADR-0039): the normalised call log (with the
 * bench client's round trips for built-in agents) and the mutation log, each bound by hash. */
async function writeRunLogs(home: string, recorder: MutationRecorder, clientCalls: readonly ClientCall[] | undefined): Promise<NonNullable<SessionRunV3['logs']>> {
  const mutations = recorder.text();
  await writeRunArtifact(home, RUN_EVIDENCE.mutations, mutations);
  // The bridge's own file stays as it wrote it; its first MAX_LOG_BYTES are normalised, and every line
  // beyond what is kept is counted (`omitted`).
  const raw = await readLogHead(join(home, RUN_EVIDENCE.bridgeCalls), MAX_LOG_BYTES);
  let calls: NonNullable<SessionRunV3['logs']>['calls'] = null;
  if (raw !== null) {
    const normalised = normaliseCallLog(raw.text, clientCalls, raw.unreadLines);
    await writeRunArtifact(home, RUN_EVIDENCE.calls, normalised.text);
    calls = { sha256: sha256Hex(normalised.text), entries: normalised.records.length, dropped: normalised.dropped, omitted: normalised.omitted, ...(raw.countCapped ? { omittedAtLeast: true as const } : {}), clientTiming: normalised.records.some(record => record.clientMs !== null) };
  }
  return { calls, mutations: { sha256: sha256Hex(mutations), entries: recorder.records.length, omitted: recorder.omitted } };
}

/** The real engine's picture of the final board (mirror only, best effort) and the checker's
 * condition trace of the run (PADR-0039). Neither changes the verdict: a picture that cannot be taken
 * or written is null; a trace that cannot be made is null with its error code, and so is a trace whose
 * mutation log was not written (`log_unwritten`): a trace is only ever bound beside the log it follows. */
async function pictureAndTrace(home: string, world: World, item: { taskId: string; seed: number }, sessionText: string, revision: number, recorder: MutationRecorder, inner: PracticeController, mirror: MirrorMode, logWritten: boolean): Promise<{ trace: string | null; traceError?: string; board: string | null }> {
  let board: string | null = null;
  if (mirror === 'required') {
    const pictured = await inner.export({ expectedRevision: revision }, undefined, { picture: true }).catch(() => undefined);
    if (pictured?.ok && pictured.value.picture) {
      try { await writeRunArtifact(home, RUN_EVIDENCE.board, pictured.value.picture.utf8); board = sha256Hex(pictured.value.picture.utf8); } catch { board = null; }
    }
  }
  if (!logWritten) return { trace: null, traceError: 'log_unwritten', board };
  const timeline = timelineOf(recorder.records, recorder.omitted, recorder.format === 'v3');
  if ('reason' in timeline) return { trace: null, traceError: timeline.reason, board };
  try {
    const text = JSON.stringify(await traceInProcess(world, sessionText, timeline.timeline, { seed: item.seed, taskId: item.taskId })) + '\n';
    await writeRunArtifact(home, RUN_EVIDENCE.trace, text);
    return { trace: sha256Hex(text), board };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    return { trace: null, traceError: typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : 'checker_invalid', board };
  }
}

/** What the report's agent fields take from the runs: each from the first run that reports it, on its
 * own (PADR-0044 decision 5). */
interface Reported { model: string | null; apiKeySource: string | null; version: string | null }
function noteReported(reported: Reported, evidence: ClientEvidence): void {
  reported.model ??= evidence.init.model;
  reported.apiKeySource ??= evidence.init.apiKeySource;
  reported.version ??= evidence.init.version;
}
/** The failure of a run the client's own stream marks as an infrastructure error (decision 9). */
const parsedFailure = (failure: NonNullable<ClientEvidence['failure']>): RunFailure => ({ reason: failure.reason, parser: failure.parser, code: failure.code, beforeModelWork: failure.beforeModelWork });

/** Runs the planned task × seed × repeat grid and returns a validated `practonaut.bench/3` report at
 * session level (`null` when it was interrupted before the first run finished). */
export async function runBench(options: BenchOptions): Promise<{ report: SessionReportV3 | null; directory: string; interrupted: boolean; planned: number }> {
  const prepared = options.world ?? await libraryBenchWorld();
  const references: ReadonlyMap<string, BenchReference> = options.references ?? (prepared.source === 'library' ? libraryReferences(options.tasks) : new Map());
  for (const task of options.tasks) if (!prepared.world.tasks.some(value => value.id === task)) throw new Error(`unknown task ${task} in world ${prepared.world.id}`);
  for (const taskId of references.keys()) if (!options.tasks.includes(taskId)) throw new Error(`reference for task ${taskId}, which is not benched`);
  if (options.agent.kind === 'builtin' && options.agent.name === 'oracle') for (const task of options.tasks) if (!references.has(task)) throw new Error(`the oracle agent needs a reference for task ${task}`);
  // Refused before the first run: references that `report --verify` would not read back.
  const referencesFile = references.size ? referencesText(references, options.tasks) : null;
  if (referencesFile !== null) assertReferencesFit(referencesFile);
  // The hosts load the world from these bytes; they reach the bench folder only after the runs.
  const { world, bytes: worldBytes, sha256: worldSha256 } = await benchedWorld(prepared);
  const paths = await resolvedDataPaths(), id = benchId(), directory = join(paths.home, 'bench', id);
  await ensurePrivateDirectory(directory);
  const plan = options.tasks.flatMap(taskId => options.seeds.flatMap(seed => Array.from({ length: options.repeats }, (_, index) => ({ taskId, seed, repeat: index + 1 }))));
  const runs: SessionRunV3[] = []; let interrupted = false; let stopped: { run: string; remaining: string[] } | undefined;
  const reported: Reported = { model: null, apiKeySource: null, version: null }, external = options.agent.kind !== 'builtin';
  // The environment every agent of this bench starts with (also what its model variable reads).
  const agentEnv = agentEnvironment(options.agent, process.env, options.keepEnv).env;
  for (const [index, item] of plan.entries()) {
    if (interrupted || options.signal?.aborted) { interrupted = true; break; }
    const reference = references.get(item.taskId), runId = `${item.taskId}-s${item.seed}-r${item.repeat}`;
    const home = join(directory, runId), agentDirectory = join(home, 'agent');
    await ensurePrivateDirectory(agentDirectory);
    const counters: RunCounters = { observe: 0, act: 0, accepted: 0, rejected: 0, undoCalls: 0, undos: 0, resetCalls: 0, resets: 0, check: 0, mutations: 0 };
    const recorder = new MutationRecorder('v3'), clientCalls: ClientCall[] = [];
    let inner: PracticeController | undefined; let host: RunningHost | undefined;
    const factory: ControllerFactory = async (value, settings) => { inner = await createPracticeSession(value, (settings ?? {}) as PracticeSessionOptions); return countingController(inner, counters, options.maxActions, recorder); };
    let outcome: AgentOutcome; let checker: SessionRunV3['checker'] = null; let artifacts: SessionRunV3['artifacts']; let wallMs = 0; let finalActions = 0;
    let evidence: ClientEvidence | undefined; let logs: SessionRunV3['logs']; let logsTried = false;
    try {
      // A bench host publishes only the run's own task (and refuses every task or variant change, so
      // the judged session keeps the run's seed, and every hint, which nothing here would count),
      // without task-list facts: no reference length of any task is the agent's to see.
      host = await startHost(world, { seed: item.seed, taskId: item.taskId, mirror: options.mirror, singleTask: true, taskInfo: {}, tokenDirectory: join(home, 'host'), controllerFactory: factory, ...(options.checks !== undefined ? { checks: options.checks } : {}) });
      // The agent gets the attach-mode bridge: origin and token-file path, never the token value.
      // The bridge's call log goes into the run folder, outside the agent's own folder (PADR-0039).
      const entry: McpServerEntry = { command: process.execPath, args: [CLI_ENTRY, 'mcp', '--host', host.origin, '--token-file', host.tokenFile, '--call-log', join(home, RUN_EVIDENCE.bridgeCalls)], env: { PRACTONAUT_HOME: agentDirectory } };
      const configPath = join(agentDirectory, 'mcp.json');
      await writeFile(configPath, JSON.stringify({ mcpServers: { practonaut: { type: 'stdio', ...entry } } }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      // The agent's data folder is its own subdirectory, not the run directory the artifacts go to.
      // A preset gets no provider API keys or billing switches unless kept by name (PADR-0034).
      const env: NodeJS.ProcessEnv = { ...agentEnv, PRACTONAUT_HOME: agentDirectory };
      for (const name of ['PRACTONAUT_HOST', 'PRACTONAUT_TOKEN_FILE', 'PRACTONAUT_SESSION_TOKEN']) delete env[name];
      const started = performance.now(), deadlineMs = options.timeoutSeconds * 1000;
      // The oracle baseline plays the reference through MCP actions; the reference itself never
      // reaches the host, the bridge or the agent's folder.
      if (options.agent.kind === 'builtin') outcome = await runBuiltin(options.agent, entry, { cwd: agentDirectory, env, world, seed: item.seed, oracle: reference, maxActions: options.maxActions, deadlineMs, randomSeed: (item.seed * 1_000_003 + item.repeat * 7919 + index) >>> 0, calls: clientCalls, ...(options.signal ? { signal: options.signal } : {}) });
      else {
        outcome = await runExternal(agentArguments(options.agent.command, { mcpConfig: configPath, prompt: BENCH_PROMPT }), agentDirectory, env, home, deadlineMs, options.signal);
        // The agent has ended: its stdout is bound by hash and read by the preset's parser — the
        // model, apiKeySource and version it reports, its own figures (self-reported, PADR-0039), the
        // tools its client offered (isolation evidence) and its own failure reports (PADR-0044).
        evidence = await readClientEvidence(options.agent, join(home, 'agent.stdout'), BRIDGE_TOOLS);
        // A run that could not show what the model can do is an infrastructure error, not judged
        // (PADR-0040): the client's own stream reports a usage or rate limit or an API error, or the
        // agent ended without completing and without a single tool call.
        if (outcome.status !== 'interrupted' && !options.signal?.aborted) {
          const failure = evidence.failure;
          const calls = counters.observe + counters.act + counters.undoCalls + counters.resetCalls + counters.check;
          if (failure) outcome = { status: 'infra_error', exitCode: outcome.exitCode, note: `the client reported ${CLIENT_FAILURE_WORDS[failure.reason]} (${failure.detail})`, failure: parsedFailure(failure) };
          else if (outcome.status !== 'completed' && calls === 0) outcome = { status: 'infra_error', exitCode: outcome.exitCode, note: outcome.note ? `${outcome.note}; the agent ended without a single tool call` : `the agent ended (${outcome.status}) without a single tool call`, failure: runnerFailure('no_tool_call') };
        }
      }
      wallMs = Math.round(performance.now() - started);
      // An interrupted run is listed, not judged: its folder holds the agent's output, so the report
      // names it (infra_error, "interrupted") and the task can be benched again (PADR-0040).
      if (outcome.status === 'interrupted' || options.signal?.aborted) { interrupted = true; throw new ClientInfraError({ status: 'infra_error', exitCode: outcome.exitCode, note: 'interrupted', failure: runnerFailure('interrupted') }); }
      if (outcome.status === 'infra_error') throw new ClientInfraError(outcome);
      // Judge the host's committed session, independently, in separate checker processes.
      const view = inner!.view(); finalActions = view.log.length;
      // The session names its world by id and version only; the view's adapter id is not session data.
      const session: SessionData = { schema: 'practonaut.session/1', world: { id: view.world.id, version: view.world.version }, seed: view.seed, taskId: view.task.id, toolVersion: PACKAGE_VERSION, log: view.log, state: view.state, hash: view.hash };
      const sessionText = JSON.stringify(session);
      const sessionRaw = await checkInProcess(world, sessionText, { seed: item.seed, taskId: item.taskId });
      let nativeText: string | null = null, nativeRaw: CheckerVerdict | null = null;
      if (options.mirror === 'required') {
        const exported = await inner!.export({ expectedRevision: view.revision });
        if (!exported.ok) throw new Error(`native export failed: ${exported.error.code}`);
        nativeText = exported.value.native.utf8;
        nativeRaw = await checkInProcess(world, nativeText, { seed: item.seed, taskId: item.taskId });
      }
      // The judged artifacts stay in the run directory and the report binds their hashes, so
      // `practonaut report --verify` can re-run the checker on them later.
      const checkerText = JSON.stringify({ session: sessionRaw, native: nativeRaw }) + '\n';
      await writeRunArtifact(home, RUN_ARTIFACTS.session, sessionText);
      if (nativeText !== null) await writeRunArtifact(home, nativeFile(world.app.adapterId), nativeText);
      await writeRunArtifact(home, RUN_ARTIFACTS.checker, checkerText);
      // The logs first: the trace follows the mutation log and is bound only beside it.
      logsTried = true;
      logs = await writeRunLogs(home, recorder, options.agent.kind === 'builtin' ? clientCalls : undefined).catch(() => undefined);
      artifacts = { session: sha256Hex(sessionText), native: nativeText === null ? null : sha256Hex(nativeText), checker: sha256Hex(checkerText), ...await pictureAndTrace(home, world, item, sessionText, view.revision, recorder, inner!, options.mirror, logs !== undefined) };
      checker = { session: verdictOf(sessionRaw, item.taskId), native: nativeRaw === null ? null : verdictOf(nativeRaw, item.taskId) };
    } catch (error) {
      if (!(error instanceof ClientInfraError) && options.signal?.aborted) interrupted = true;
      outcome = error instanceof ClientInfraError ? error.outcome : interrupted ? { status: 'infra_error', exitCode: null, note: 'interrupted', failure: runnerFailure('interrupted') } : { status: 'infra_error', exitCode: null, note: infraNote(error), failure: runnerFailure('runner') };
      checker = null; artifacts = undefined;
    } finally { await host?.close().catch(() => {}); }
    // The logs explain the run whether or not it was judged; a log that cannot be written is left out.
    if (host && !logsTried) logs = await writeRunLogs(home, recorder, options.agent.kind === 'builtin' ? clientCalls : undefined).catch(() => undefined);
    // Every external run binds its stdout, also one that ended before its agent ran (then null).
    if (external && !evidence) evidence = await readClientEvidence(options.agent, join(home, 'agent.stdout'), BRIDGE_TOOLS);
    if (evidence) noteReported(reported, evidence);
    const run = sessionRun({ runId, item, outcome, finalActions, counters, wallMs, reference: reference ? reference.steps.length : null, checker, artifacts, logs, evidence, kind: options.agent.kind });
    run.pass = derivedPass(run, options.mirror);
    runs.push(run);
    if (interrupted) break;
    // --stop-on-infra: a usage limit or an API error affects every later run as well; stop here and
    // write the partial report so the operator can resume with the remaining tasks.
    if (options.stopOnInfra && run.status === 'infra_error' && index < plan.length - 1) {
      stopped = { run: runId, remaining: [...new Set(plan.slice(index).map(value => value.taskId))] };
      options.progress?.(`${String(index + 1).padStart(String(plan.length).length)}/${plan.length}  ${runId.padEnd(28)} [infra_error]  ${run.note ?? ''}`);
      interrupted = true; break;
    }
    options.progress?.(`${String(index + 1).padStart(String(plan.length).length)}/${plan.length}  ${runId.padEnd(28)} ${run.pass ? 'pass' : 'FAIL'}  ${run.actions} ${new Intl.PluralRules('en').select(run.actions) === 'one' ? 'action' : 'actions'}  ${(wallMs / 1000).toFixed(1)} s${run.status === 'completed' ? '' : `  [${run.status}]`}${run.note ? `  ${run.note}` : ''}`);
  }
  if (!runs.length) return { report: null, directory, interrupted, planned: plan.length };
  const report = await assembleReport({ options, mirror: options.mirror, prepared, world, worldBytes, worldSha256, references, referencesFile, directory, runs, reported, requestedModel: requestedModelOf(options.agent, agentEnv), planned: plan.length, partial: interrupted && runs.length < plan.length, ...(stopped ? { stopped } : {}) });
  return { report, directory, interrupted, planned: plan.length };
}

/** One /3 session run from what the runner counted and read (PADR-0044): the /2 fields, the agent's own
 * actions (no co-actor yet: all of the final history), the isolation and its evidence, the stdout
 * binding and the client block of an external run, and the failure of a run that was not judged. */
function sessionRun(input: {
  runId: string; item: { taskId: string; seed: number; repeat: number }; outcome: AgentOutcome; finalActions: number; counters: Pick<RunCounters, 'observe' | 'act' | 'accepted' | 'rejected' | 'undoCalls' | 'undos' | 'resetCalls' | 'resets' | 'check'>;
  wallMs: number; reference: number | null; checker: SessionRunV3['checker']; artifacts: SessionRunV3['artifacts']; logs: SessionRunV3['logs']; evidence: ClientEvidence | undefined; kind: AgentSpec['kind'];
}): SessionRunV3 {
  const { outcome, counters, evidence } = input;
  const status = outcome.status as SessionRunV3['status'];
  const isolation = evidence?.isolation ?? { level: 'builtin-baseline' as const, evidence: 'by-kind' as const };
  const failure = status === 'infra_error' ? outcome.failure ?? runnerFailure('runner') : undefined;
  return {
    verdictLevel: 'session', id: input.runId, taskId: input.item.taskId, seed: input.item.seed, repeat: input.item.repeat, status, pass: false,
    actions: input.finalActions, acceptedActions: counters.accepted, rejectedActions: counters.rejected, undos: counters.undos, resets: counters.resets,
    toolCalls: { observe: counters.observe, act: counters.act, undo: counters.undoCalls, reset: counters.resetCalls, check: counters.check, total: counters.observe + counters.act + counters.undoCalls + counters.resetCalls + counters.check },
    wallMs: input.wallMs, referenceActions: input.reference, checker: input.checker, agentExitCode: outcome.exitCode, ...(outcome.note ? { note: scrubPaths(outcome.note.replaceAll(homedir(), '~')).slice(0, 256) } : {}), ...(input.artifacts ? { artifacts: input.artifacts } : {}),
    ...(input.logs ? { logs: input.logs } : {}),
    isolation, ...(input.kind !== 'builtin' ? { stdout: evidence?.stdout ?? null } : {}), ...(failure ? { failure } : {}), ...(evidence?.client ? { client: evidence.client } : {}),
    agentActions: input.finalActions,
  };
}

/** The report of a bench's runs: the world and the references enter the bench folder only now, after
 * every agent of the bench has ended (or, for a recovered bench, after it was killed). */
async function assembleReport(input: {
  options: Pick<BenchOptions, 'tasks' | 'seeds' | 'repeats' | 'timeoutSeconds' | 'maxActions' | 'mirrorRequested' | 'agent' | 'keepEnv' | 'label' | 'checks'>;
  mirror: MirrorMode; prepared: BenchWorld; world: World; worldBytes: Buffer; worldSha256: string; references: ReadonlyMap<string, BenchReference>; referencesFile: string | null;
  directory: string; runs: SessionRunV3[]; reported: Reported; requestedModel: AgentV3['requestedModel']; planned: number; partial: boolean; stopped?: { run: string; remaining: string[] }; recovered?: true; createdAt?: string;
}): Promise<SessionReportV3> {
  const { options, prepared, world, worldBytes, worldSha256, references, referencesFile, directory, runs, reported } = input;
  await storeWorld(directory, worldBytes, worldSha256);
  let referencesBinding: BenchReportV3['references'] = null;
  if (referencesFile !== null) {
    await writeRunArtifact(directory, BENCH_REFERENCES_FILE, referencesFile);
    // Whether each reference is a proven minimal solution for every planned seed (PADR-0040).
    referencesBinding = { path: BENCH_REFERENCES_FILE, sha256: sha256Hex(referencesFile), tasks: options.tasks.flatMap(taskId => { const value = references.get(taskId); return value ? [{ taskId, source: value.source, actions: value.steps.length, minimal: analyseLengthForSeeds(world, taskId, options.seeds, value.steps.length).kind === 'minimal' }] : []; }) };
  }
  const generated = options.tasks.flatMap(taskId => { const by = world.tasks.find(task => task.id === taskId)?.generatedBy; return by ? [{ taskId, ...by }] : []; });
  const limits = taskLimitsOf(world, options.tasks);
  const spec = options.agent, external = spec.kind !== 'builtin';
  const model = external ? reported.model : null, source = spec.kind === 'preset' ? 'client-attested' as const : 'command-output' as const;
  const clientVersion: AgentV3['clientVersion'] = external && reported.version !== null ? { value: reported.version, source } : { value: null, source: 'none' };
  const ran = new Set(runs.map(run => `${run.taskId}\u0000${run.seed}`));
  const report: BenchReportV3 = {
    schema: BENCH_SCHEMA, createdAt: input.createdAt ?? new Date().toISOString(), ...(options.label !== undefined ? { label: options.label } : {}),
    verdictLevel: 'session',
    environment: {
      practonaut: PACKAGE_VERSION, node: process.version, os: { platform: process.platform, release: release(), arch: arch() },
      app: { adapterId: world.app.adapterId, version: EXCALIDRAW_APP_VERSION }, mirror: input.mirror,
      world: { source: prepared.source, worldId: world.id, version: world.version, contentHash: prepared.contentHash, package: { path: BENCH_WORLD_FILE, sha256: worldSha256 }, generated, ...(limits.length ? { limits } : {}) },
    },
    toolchain: { kind: 'practonaut', id: 'practonaut', tools: [...BRIDGE_TOOLS] },
    instances: instanceIdentities(world, options.tasks, options.seeds, ran),
    agent: {
      kind: spec.kind, name: spec.name, command: displayCommand(spec.command), isolation: presetIsolation(spec.kind, runs),
      model, modelSource: model === null ? 'none' : source,
      apiKeySource: external ? apiKeySourceValue(reported.apiKeySource) : null, keptEnv: spec.kind === 'preset' ? [...(options.keepEnv ?? [])] : [],
      vendor: vendorOf(spec, model, input.requestedModel), client: clientOf(spec), clientVersion, requestedModel: input.requestedModel,
      settings: [], billing: requestedBilling(spec, options.keepEnv),
    },
    settings: { tasks: options.tasks, seeds: options.seeds, repeats: options.repeats, timeoutSeconds: options.timeoutSeconds, maxActions: options.maxActions, mirror: options.mirrorRequested, prompt: spec.kind === 'builtin' ? '' : BENCH_PROMPT, ...(options.checks !== undefined ? { checks: options.checks } : {}) },
    references: referencesBinding,
    // A report that holds every planned run (the last one interrupted) is not a partial report.
    runs, ...(input.partial ? { interrupted: { plannedRuns: input.planned, ...(input.stopped ? { stopped: input.stopped } : {}) } } : {}),
    ...(input.recovered ? { recovered: true as const } : {}), summary: summarize(runs, options.repeats, run => run.agentActions),
  };
  // A session-level bench: the validator has checked one level for the report, its runs and its toolchain.
  return validateBenchReportV3(report) as SessionReportV3;
}


/**
 * `bench --recover <bench folder>` (PADR-0040): a bench that was killed (kill -9, power loss, a second
 * Ctrl+C) leaves its run folders but no report. This rebuilds the partial report from them with the
 * bench's own arguments (world, references, agent, settings): in plan order up to the first run
 * without a folder, a run whose folder holds the checker's output is listed as judged, from its
 * judged artifacts and evidence exactly as `report --verify` re-judges them (the caller verifies the
 * report before it is written); a run without it is an infra_error, "interrupted" (or the limit or
 * API error its client reported). Its counters come from the host-side mutation log, its client
 * figures, isolation evidence and failure from the agent's own bound output; the agent's exit status
 * is read from that output (a result event: completed or agent_failed; none: timeout). The report is
 * dated by the last file the bench wrote, so a bench resumed before the recovery still merges after it.
 *
 * It writes bench/3 at session level (PADR-0044 decision 11) and refuses what it cannot rebuild as
 * such: a folder whose mutation log predates /3 (records without an actor), a run with a co-actor
 * record, and an artifact-level run (a proxy log). The requested model is not known afterwards (the
 * environment the client started with is gone), so it is recorded as not known.
 */
export async function recoverBench(options: BenchOptions, directory: string): Promise<{ report: SessionReportV3; remaining: string[] }> {
  const prepared = options.world ?? await libraryBenchWorld();
  const references: ReadonlyMap<string, BenchReference> = options.references ?? (prepared.source === 'library' ? libraryReferences(options.tasks) : new Map());
  const referencesFile = references.size ? referencesText(references, options.tasks) : null;
  const { world, bytes: worldBytes, sha256: worldSha256 } = await benchedWorld(prepared);
  const plan = options.tasks.flatMap(taskId => options.seeds.flatMap(seed => Array.from({ length: options.repeats }, (_, index) => ({ taskId, seed, repeat: index + 1 }))));
  // Every run folder of the bench folder is recovered: one outside these arguments' plan, or after a
  // planned run without a folder, would be left out of the report (and refuse a challenge round).
  const folders = (await readdir(directory, { withFileTypes: true }).catch(() => { throw new BenchReportError('the bench folder cannot be read'); })).filter(entry => entry.isDirectory() && /-s\d+-r\d+$/.test(entry.name)).map(entry => entry.name);
  const planned = new Set(plan.map(entry => `${entry.taskId}-s${entry.seed}-r${entry.repeat}`));
  const foreign = folders.find(name => !planned.has(name));
  if (foreign !== undefined) throw new BenchReportError(`run folder ${foreign} is not in the plan of these arguments; recover with the bench's own arguments (world, tasks, seed list, repeats)`);
  const runs: SessionRunV3[] = [];
  const reported: Reported = { model: null, apiKeySource: null, version: null };
  let native = false, lastActivity = 0;
  const file = async (home: string, name: string): Promise<string | null> => readFile(join(home, name), 'utf8').catch(() => null);
  const external = options.agent.kind !== 'builtin', nativeName = nativeFile(world.app.adapterId);
  for (const item of plan) {
    const runId = `${item.taskId}-s${item.seed}-r${item.repeat}`, home = join(directory, runId);
    const started = await stat(home).catch(() => null);
    if (!started?.isDirectory()) break;
    try {
      // The bench was killed after the last file of its folders was written.
      for (const entry of await readdir(home, { withFileTypes: true })) if (entry.isFile()) lastActivity = Math.max(lastActivity, (await stat(join(home, entry.name))).mtimeMs);
      if (await stat(join(home, 'proxy.jsonl')).then(() => true, () => false)) throw new BenchReportError(`run ${runId} is an artifact-level run (it holds a proxy log); this Practonaut recovers session-level runs only`);
      const evidence = external ? await readClientEvidence(options.agent, join(home, 'agent.stdout'), BRIDGE_TOOLS) : undefined;
      if (evidence) noteReported(reported, evidence);
      // The host-side mutation log gives the counters, the normalised call log the reads; both are
      // written when a run ends, so a run the kill cut short has neither.
      const mutationsText = await file(home, RUN_EVIDENCE.mutations), callsText = await file(home, RUN_EVIDENCE.calls);
      let records: ReturnType<typeof parseMutations> = [];
      if (mutationsText !== null) {
        try { records = parseMutations(mutationsText, 'v3'); }
        catch { throw new BenchReportError(`run ${runId}: its mutation log is not a bench/3 log (written by an earlier Practonaut, or changed); recover it with the Practonaut that ran it`); }
      }
      if (records.some(record => record.actor === 'co-actor')) throw new BenchReportError(`run ${runId} holds co-actor records; this Practonaut does not recover co-actor runs`);
      const counted = mutationCounts(records);
      const calls = callsText === null ? [] : parseCallLog(callsText);
      const reads = calls.filter(call => call.tool === 'observe' || call.tool === 'list_actions' || call.tool === 'explain_result').length + (calls.length ? 1 : 0);
      const counters = { observe: reads, act: counted.act, accepted: counted.accepted, rejected: counted.rejected, undoCalls: counted.undoCalls, undos: counted.undos, resetCalls: counted.resetCalls, resets: counted.resets, check: counted.checkCalls };
      const bridge = await readLogHead(join(home, RUN_EVIDENCE.bridgeCalls), MAX_LOG_BYTES);
      const normalised = bridge === null ? null : normaliseCallLog(bridge.text, undefined, bridge.unreadLines);
      const logs: SessionRunV3['logs'] | undefined = mutationsText === null ? undefined : {
        calls: callsText === null ? null : { sha256: sha256Hex(callsText), entries: calls.length, dropped: normalised?.dropped ?? 0, omitted: normalised?.omitted ?? 0, clientTiming: calls.some(call => call.clientMs !== null) },
        mutations: { sha256: sha256Hex(mutationsText), entries: records.length, omitted: 0 },
      };
      const sessionText = await file(home, RUN_ARTIFACTS.session), checkerText = await file(home, RUN_ARTIFACTS.checker), nativeText = await file(home, nativeName);
      const ended = (await stat(join(home, external ? 'agent.stdout' : RUN_ARTIFACTS.checker)).catch(() => null))?.mtimeMs ?? started.birthtimeMs;
      const wallMs = Math.max(0, Math.round(ended - started.birthtimeMs)), reference = references.get(item.taskId)?.steps.length ?? null;
      if (sessionText === null || checkerText === null) {
        // The world and the references enter the bench folder only once every agent of the bench has
        // ended: an agent the kill left running (its own process group) is ended first.
        const pid = Number((await file(home, AGENT_PID_FILE))?.trim());
        if (Number.isSafeInteger(pid) && pid > 0 && agentAlive(pid)) throw new BenchReportError(`run ${runId}: its agent (process ${pid}) still runs; end it and its process group (kill -9 -${pid}) and recover again`);
        // Not judged: what the client's own stream reports (a limit, an API error), else interrupted.
        const failure = evidence?.failure ?? null;
        const note = failure ? scrubPaths(`the client reported ${CLIENT_FAILURE_WORDS[failure.reason]} (${failure.detail})`.replaceAll(homedir(), '~')).slice(0, 256) : 'interrupted';
        const outcome: AgentOutcome = { status: 'infra_error', exitCode: null, note, failure: failure ? parsedFailure(failure) : runnerFailure('interrupted') };
        runs.push(sessionRun({ runId, item, outcome, finalActions: 0, counters, wallMs, reference, checker: null, artifacts: undefined, logs, evidence, kind: options.agent.kind }));
        continue;
      }
      const session = JSON.parse(sessionText) as SessionData, raw = JSON.parse(checkerText) as { session: CheckerVerdict; native: CheckerVerdict | null };
      if (!Array.isArray(session?.log)) throw new Error(`${RUN_ARTIFACTS.session} holds no session`);
      if (nativeText !== null) native = true;
      const trace = await file(home, RUN_EVIDENCE.trace), board = await file(home, RUN_EVIDENCE.board);
      const tail = external ? await stdoutTail(join(home, 'agent.stdout')) : '';
      const status: SessionRunV3['status'] = !external ? 'completed' : /"type"\s*:\s*"result"/.test(tail) ? (/"is_error"\s*:\s*true/.test(tail) ? 'agent_failed' : 'completed') : 'timeout';
      const checker = { session: verdictOf(raw.session, item.taskId), native: raw.native === null ? null : verdictOf(raw.native, item.taskId) };
      const artifacts = { session: sha256Hex(sessionText), native: nativeText === null ? null : sha256Hex(nativeText), checker: sha256Hex(checkerText),
        ...(trace !== null && logs ? { trace: sha256Hex(trace) } : { trace: null, traceError: logs ? 'interrupted' : 'log_unwritten' }), board: board === null ? null : sha256Hex(board) };
      runs.push(sessionRun({ runId, item, outcome: { status, exitCode: null, note: 'recovered from the run folder' }, finalActions: session.log.length, counters, wallMs, reference, checker, artifacts, logs, evidence, kind: options.agent.kind }));
    } catch (error) {
      if (error instanceof BenchReportError) throw error;
      throw new BenchReportError(`run ${runId}: its folder cannot be recovered (${error instanceof Error ? error.message.slice(0, 200) : 'unreadable'})`);
    }
  }
  const unplanned = folders.find(name => !runs.some(run => run.id === name));
  if (unplanned !== undefined) throw new BenchReportError(`run folder ${unplanned} follows a planned run without a folder; recover with the bench's own arguments (world, tasks, seed list, repeats)`);
  if (!runs.length) throw new BenchReportError(`the bench folder holds no run folder of these arguments' plan`);
  // The mirror as run: a judged run with a native export ran with it; none judged, as requested.
  const mirror: MirrorMode = native ? 'required' : runs.some(run => run.checker !== null) || options.mirrorRequested !== 'required' ? 'off' : 'required';
  for (const run of runs) run.pass = derivedPass(run, mirror);
  const report = await assembleReport({ options, mirror, prepared, world, worldBytes, worldSha256, references, referencesFile, directory, runs, reported, requestedModel: { value: null, source: 'none' }, planned: plan.length, partial: runs.length < plan.length, recovered: true, createdAt: new Date(lastActivity || Date.now()).toISOString() });
  // Tasks without a judged run for every planned seed and repeat: what a resumed bench takes.
  const remaining = options.tasks.filter(task => plan.some(entry => entry.taskId === task && !runs.some(run => run.id === `${entry.taskId}-s${entry.seed}-r${entry.repeat}` && run.status !== 'infra_error')));
  return { report, remaining };
}

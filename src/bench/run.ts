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
import { randomBytes } from 'node:crypto';
import { lstat, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { arch, homedir, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packWorld, readWorldPackage } from '../package/index.ts';
import { loadWorldPackage } from '../world/index.ts';
import { loadLibrary, LIBRARY_WORLD_DIR, type LibraryEntry } from '../library/index.ts';
import { startHost } from '../host/server.ts';
import { createPracticeSession, type PracticeSessionOptions } from '../host/session.ts';
import type { ActRequest, ControllerFactory, HostReply, MirrorMode, MutationReply, PracticeController, RunningHost } from '../host/protocol.ts';
import { ensurePrivateDirectory } from '../platform/private-fs.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import { checkInProcess, traceInProcess } from '../cli/runtime.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { sha256Hex } from '../canonical/index.ts';
import { EXCALIDRAW_APP_VERSION } from '../adapters/excalidraw/index.ts';
import type { CheckerVerdict, SessionData, World } from '../world/types.ts';
import type { TaskOracle } from '../authoring/from-scenes.ts';
import { StdioMcpClient, type ClientCall, type McpServerEntry } from './mcp-client.ts';
import { clientResult, MAX_LOG_BYTES, MutationRecorder, normaliseCallLog, RUN_EVIDENCE, timelineOf } from './evidence.ts';
import { runOracle, runRandom } from './baselines.ts';
import { agentArguments, agentEnvironment, BENCH_PROMPT, clientInit, displayCommand, type AgentSpec } from './agents.ts';
import { spawnable } from '../platform/spawnable.ts';
import { BENCH_REFERENCES_FILE, BENCH_SCHEMA, BENCH_WORLD_FILE, derivedPass, ISOLATION_OF, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from './report.ts';
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
  const controller: PracticeController = {
    view: () => { counters.observe++; return inner.view(); },
    act: async (request, context) => {
      counters.act++;
      const extra = { action: request.action, client: request.actor?.kind === 'agent' ? request.actor.client : null };
      if (counters.mutations >= maxActions) { counters.rejected++; const refused = exhausted<MutationReply>(); note('act', refused, extra); return refused; }
      counters.mutations++;
      const reply = await inner.act(request, context);
      if (reply.ok) counters.accepted++; else counters.rejected++;
      note('act', reply, extra);
      return reply;
    },
    undo: async (request, context) => {
      counters.undoCalls++;
      if (counters.mutations >= maxActions) { const refused = exhausted<MutationReply>(); note('undo', refused); return refused; }
      counters.mutations++;
      const reply = await inner.undo(request, context); if (reply.ok) counters.undos++; note('undo', reply); return reply;
    },
    reset: async (request, context) => {
      counters.resetCalls++;
      if (counters.mutations >= maxActions) { const refused = exhausted<MutationReply>(); note('reset', refused); return refused; }
      counters.mutations++;
      const reply = await inner.reset(request, context); if (reply.ok) counters.resets++; note('reset', reply); return reply;
    },
    check: async (request, context) => { counters.check++; return inner.check(request, context); },
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
export async function libraryWorld(): Promise<{ world: World; entries: Map<string, LibraryEntry>; contentHash: string }> {
  const world = loadWorldPackage(await readWorldPackage(await packWorld(LIBRARY_WORLD_DIR)));
  return { world, entries: new Map(loadLibrary().library.tasks.map(entry => [entry.id, entry])), contentHash: worldContentHash(world) };
}

/** File names of a run's judged artifacts inside its run directory (`<bench>/<run-id>/`). */
export const RUN_ARTIFACTS = Object.freeze({ session: 'session.json', native: 'native.excalidraw', checker: 'checker.json' });
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
export function killRunningAgents(): void { for (const pid of runningAgents) killProcessTree(pid, 'SIGKILL'); }

export function verdictOf(verdict: CheckerVerdict, taskId: string): { passed: boolean; errorClasses: string[] } {
  const task = verdict.tasks.find(value => value.taskId === taskId);
  return { passed: verdict.passed && task?.passed === true, errorClasses: (task?.errors ?? []).map(error => error.id).slice(0, 64) };
}

interface AgentOutcome { status: BenchRunV2['status'] | 'interrupted'; exitCode: number | null; note?: string; stdout?: string }

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


/** The first 64 KiB of an agent's stdout (where a stream-json client writes its init event). */
async function stdoutHead(path: string): Promise<string> {
  return open(path, 'r').then(async handle => { try { const read = await handle.read(Buffer.alloc(64 * 1024), 0, 64 * 1024, 0); return read.buffer.subarray(0, read.bytesRead).toString('utf8'); } finally { await handle.close(); } }).catch(() => '');
}
/** The last 256 KiB of an agent's stdout (where a stream-json client writes its result event). */
async function stdoutTail(path: string): Promise<string> {
  const size = 256 * 1024;
  return open(path, 'r').then(async handle => { try { const length = (await handle.stat()).size, start = Math.max(0, length - size); const read = await handle.read(Buffer.alloc(size), 0, size, start); const text = read.buffer.subarray(0, read.bytesRead).toString('utf8'); return start > 0 ? text.slice(text.indexOf('\n') + 1) : text; } finally { await handle.close(); } }).catch(() => '');
}
/** A regular file's text, at most `max` bytes; null when it is missing, not a regular file or larger. */
async function boundedText(path: string, max: number): Promise<string | null> {
  try { const info = await lstat(path); if (!info.isFile() || info.size > max) return null; return await readFile(path, 'utf8'); } catch { return null; }
}

/** The run's evidence beside its judged artifacts (PADR-0039): the normalised call log (with the
 * bench client's round trips for built-in agents) and the mutation log, each bound by hash. */
async function writeRunLogs(home: string, recorder: MutationRecorder, clientCalls: readonly ClientCall[] | undefined): Promise<NonNullable<BenchRunV2['logs']>> {
  const mutations = recorder.text();
  await writeRunArtifact(home, RUN_EVIDENCE.mutations, mutations);
  const raw = await boundedText(join(home, RUN_EVIDENCE.calls), MAX_LOG_BYTES);
  let calls: NonNullable<BenchRunV2['logs']>['calls'] = null;
  if (raw !== null) {
    const normalised = normaliseCallLog(raw, clientCalls);
    await writeRunArtifact(home, RUN_EVIDENCE.calls, normalised.text);
    calls = { sha256: sha256Hex(normalised.text), entries: normalised.records.length, dropped: normalised.dropped, clientTiming: normalised.records.some(record => record.clientMs !== null) };
  } else await rm(join(home, RUN_EVIDENCE.calls), { recursive: true, force: true }).catch(() => {});
  return { calls, mutations: { sha256: sha256Hex(mutations), entries: recorder.records.length, omitted: recorder.omitted } };
}

/** The real engine's picture of the final board (mirror only, best effort) and the checker's
 * condition trace of the run (PADR-0039). Neither changes the verdict: a picture that cannot be taken
 * or a trace that cannot be made is null, the trace with its error code. */
async function pictureAndTrace(home: string, world: World, item: { taskId: string; seed: number }, sessionText: string, revision: number, recorder: MutationRecorder, inner: PracticeController, mirror: MirrorMode): Promise<{ trace: string | null; traceError?: string; board: string | null }> {
  let board: string | null = null;
  if (mirror === 'required') {
    const pictured = await inner.export({ expectedRevision: revision }, undefined, { picture: true }).catch(() => undefined);
    if (pictured?.ok && pictured.value.picture) { await writeRunArtifact(home, RUN_EVIDENCE.board, pictured.value.picture.utf8); board = sha256Hex(pictured.value.picture.utf8); }
  }
  const timeline = timelineOf(recorder.records, recorder.omitted);
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

/** Runs the planned task × seed × repeat grid and returns a validated `practonaut.bench/2` report
 * (`null` when it was interrupted before the first run finished). */
export async function runBench(options: BenchOptions): Promise<{ report: BenchReportV2 | null; directory: string; interrupted: boolean; planned: number }> {
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
  const runs: BenchRunV2[] = []; let interrupted = false;
  let client: { model: string | null; apiKeySource: string | null } = { model: null, apiKeySource: null };
  for (const [index, item] of plan.entries()) {
    if (interrupted || options.signal?.aborted) { interrupted = true; break; }
    const reference = references.get(item.taskId), runId = `${item.taskId}-s${item.seed}-r${item.repeat}`;
    const home = join(directory, runId), agentDirectory = join(home, 'agent');
    await ensurePrivateDirectory(agentDirectory);
    const counters: RunCounters = { observe: 0, act: 0, accepted: 0, rejected: 0, undoCalls: 0, undos: 0, resetCalls: 0, resets: 0, check: 0, mutations: 0 };
    const recorder = new MutationRecorder(), clientCalls: ClientCall[] = [];
    let inner: PracticeController | undefined; let host: RunningHost | undefined;
    const factory: ControllerFactory = async (value, settings) => { inner = await createPracticeSession(value, (settings ?? {}) as PracticeSessionOptions); return countingController(inner, counters, options.maxActions, recorder); };
    let outcome: AgentOutcome; let checker: BenchRunV2['checker'] = null; let artifacts: BenchRunV2['artifacts']; let wallMs = 0; let finalActions = 0;
    let runClient: BenchRunV2['client']; let logs: BenchRunV2['logs'];
    try {
      // A bench host publishes only the run's own task (and refuses a change to another one), without
      // task-list facts: no reference length of any task is the agent's to see.
      host = await startHost(world, { seed: item.seed, taskId: item.taskId, mirror: options.mirror, singleTask: true, taskInfo: {}, tokenDirectory: join(home, 'host'), controllerFactory: factory });
      // The agent gets the attach-mode bridge: origin and token-file path, never the token value.
      // The bridge's call log goes into the run folder, outside the agent's own folder (PADR-0039).
      const entry: McpServerEntry = { command: process.execPath, args: [CLI_ENTRY, 'mcp', '--host', host.origin, '--token-file', host.tokenFile, '--call-log', join(home, RUN_EVIDENCE.calls)], env: { PRACTONAUT_HOME: agentDirectory } };
      const configPath = join(agentDirectory, 'mcp.json');
      await writeFile(configPath, JSON.stringify({ mcpServers: { practonaut: { type: 'stdio', ...entry } } }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      // The agent's data folder is its own subdirectory, not the run directory the artifacts go to.
      // A preset gets no provider API keys or billing switches unless kept by name (PADR-0034).
      const env: NodeJS.ProcessEnv = { ...agentEnvironment(options.agent, process.env, options.keepEnv).env, PRACTONAUT_HOME: agentDirectory };
      for (const name of ['PRACTONAUT_HOST', 'PRACTONAUT_TOKEN_FILE', 'PRACTONAUT_SESSION_TOKEN']) delete env[name];
      const started = performance.now(), deadlineMs = options.timeoutSeconds * 1000;
      // The oracle baseline plays the reference through MCP actions; the reference itself never
      // reaches the host, the bridge or the agent's folder.
      if (options.agent.kind === 'builtin') outcome = await runBuiltin(options.agent, entry, { cwd: agentDirectory, env, world, seed: item.seed, oracle: reference, maxActions: options.maxActions, deadlineMs, randomSeed: (item.seed * 1_000_003 + item.repeat * 7919 + index) >>> 0, calls: clientCalls, ...(options.signal ? { signal: options.signal } : {}) });
      else {
        outcome = await runExternal(agentArguments(options.agent.command, { mcpConfig: configPath, prompt: BENCH_PROMPT }), agentDirectory, env, home, deadlineMs, options.signal);
        // A preset and a command template keep the model and apiKeySource their output reports.
        const head = await stdoutHead(join(home, 'agent.stdout')), init = clientInit(head);
        if (client.model === null && client.apiKeySource === null) client = init;
        // Tokens, turns and cost as the client states them (self-reported, PADR-0039).
        const figures = clientResult(await stdoutTail(join(home, 'agent.stdout')));
        if (init.model !== null || figures.turns !== null || figures.costUsd !== null || figures.tokens !== null) runClient = { source: options.agent.kind === 'preset' ? 'client-attested' : 'command-output', model: init.model, ...figures };
      }
      wallMs = Math.round(performance.now() - started);
      if (outcome.status === 'interrupted' || options.signal?.aborted) { interrupted = true; continue; }
      // Judge the host's committed session, independently, in separate checker processes.
      const view = inner!.view(); finalActions = view.log.length;
      const session: SessionData = { schema: 'practonaut.session/1', world: view.world, seed: view.seed, taskId: view.task.id, toolVersion: PACKAGE_VERSION, log: view.log, state: view.state, hash: view.hash };
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
      if (nativeText !== null) await writeRunArtifact(home, RUN_ARTIFACTS.native, nativeText);
      await writeRunArtifact(home, RUN_ARTIFACTS.checker, checkerText);
      artifacts = { session: sha256Hex(sessionText), native: nativeText === null ? null : sha256Hex(nativeText), checker: sha256Hex(checkerText), ...await pictureAndTrace(home, world, item, sessionText, view.revision, recorder, inner!, options.mirror) };
      checker = { session: verdictOf(sessionRaw, item.taskId), native: nativeRaw === null ? null : verdictOf(nativeRaw, item.taskId) };
    } catch (error) {
      if (options.signal?.aborted) { interrupted = true; continue; }
      outcome = { status: 'infra_error', exitCode: null, note: infraNote(error) };
      checker = null; artifacts = undefined;
    } finally { await host?.close().catch(() => {}); }
    if (interrupted) break;
    // The logs explain the run whether or not it was judged; a log that cannot be written is left out.
    if (host) logs = await writeRunLogs(home, recorder, options.agent.kind === 'builtin' ? clientCalls : undefined).catch(() => undefined);
    const run: BenchRunV2 = {
      id: runId, taskId: item.taskId, seed: item.seed, repeat: item.repeat, status: outcome.status as BenchRunV2['status'], pass: false,
      actions: finalActions, acceptedActions: counters.accepted, rejectedActions: counters.rejected, undos: counters.undos, resets: counters.resets,
      toolCalls: { observe: counters.observe, act: counters.act, undo: counters.undoCalls, reset: counters.resetCalls, check: counters.check, total: counters.observe + counters.act + counters.undoCalls + counters.resetCalls + counters.check },
      wallMs, referenceActions: reference ? reference.steps.length : null, checker, agentExitCode: outcome.exitCode, ...(outcome.note ? { note: scrubPaths(outcome.note.replaceAll(homedir(), '~')).slice(0, 256) } : {}), ...(artifacts ? { artifacts } : {}),
      ...(logs ? { logs } : {}), ...(runClient ? { client: runClient } : {}),
    };
    run.pass = derivedPass(run, options.mirror);
    runs.push(run);
    options.progress?.(`${String(index + 1).padStart(String(plan.length).length)}/${plan.length}  ${runId.padEnd(28)} ${run.pass ? 'pass' : 'FAIL'}  ${run.actions} ${new Intl.PluralRules('en').select(run.actions) === 'one' ? 'action' : 'actions'}  ${(wallMs / 1000).toFixed(1)} s${run.status === 'completed' ? '' : `  [${run.status}]`}${run.note ? `  ${run.note}` : ''}`);
  }
  if (!runs.length) return { report: null, directory, interrupted, planned: plan.length };
  // Every agent of this bench has ended: only now do the world and the references enter the bench folder.
  await storeWorld(directory, worldBytes, worldSha256);
  let referencesBinding: BenchReportV2['references'] = null;
  if (referencesFile !== null) {
    await writeRunArtifact(directory, BENCH_REFERENCES_FILE, referencesFile);
    referencesBinding = { path: BENCH_REFERENCES_FILE, sha256: sha256Hex(referencesFile), tasks: options.tasks.flatMap(taskId => { const value = references.get(taskId); return value ? [{ taskId, source: value.source, actions: value.steps.length }] : []; }) };
  }
  const generated = options.tasks.flatMap(taskId => { const by = world.tasks.find(task => task.id === taskId)?.generatedBy; return by ? [{ taskId, ...by }] : []; });
  const model = options.agent.kind === 'builtin' ? null : client.model;
  const report: BenchReportV2 = {
    schema: BENCH_SCHEMA, createdAt: new Date().toISOString(), ...(options.label !== undefined ? { label: options.label } : {}),
    environment: {
      practonaut: PACKAGE_VERSION, excalidraw: EXCALIDRAW_APP_VERSION, node: process.version, os: { platform: process.platform, release: release(), arch: arch() }, mirror: options.mirror,
      world: { source: prepared.source, worldId: world.id, version: world.version, contentHash: prepared.contentHash, package: { path: BENCH_WORLD_FILE, sha256: worldSha256 }, generated },
    },
    agent: {
      kind: options.agent.kind, name: options.agent.name, command: displayCommand(options.agent.command), isolation: ISOLATION_OF[options.agent.kind],
      model, modelSource: model === null ? 'none' : options.agent.kind === 'preset' ? 'client-attested' : 'command-output',
      apiKeySource: options.agent.kind === 'builtin' ? null : client.apiKeySource, keptEnv: options.agent.kind === 'preset' ? [...(options.keepEnv ?? [])] : [],
    },
    settings: { tasks: options.tasks, seeds: options.seeds, repeats: options.repeats, timeoutSeconds: options.timeoutSeconds, maxActions: options.maxActions, mirror: options.mirrorRequested, prompt: options.agent.kind === 'builtin' ? '' : BENCH_PROMPT },
    references: referencesBinding,
    runs, ...(interrupted ? { interrupted: { plannedRuns: plan.length } } : {}), summary: summarize(runs, options.repeats),
  };
  return { report: validateBenchReportV2(report), directory, interrupted, planned: plan.length };
}

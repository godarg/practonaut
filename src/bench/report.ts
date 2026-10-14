/**
 * The bench reports `practonaut.bench/1` and `practonaut.bench/2`: their schemas (sources of
 * `schemas/bench.v1.json` and `schemas/bench.v2.json`), the aggregation and the validators. A report
 * is data: `report` and every consumer accept it only after `validateBenchReport`, which re-derives
 * every pass and every aggregate from the recorded checker verdicts. A pass without an independent
 * verdict, or a summary that the runs do not produce, is rejected, whatever the file claims.
 *
 * `bench` writes /2 (PADR-0036); /1 reports from 0.1.0 are read and validated by their own rules,
 * unchanged.
 */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { GeneratedParametersSchema } from '../world/schema.ts';
import { cliText } from '../cli/messages.ts';

export const BENCH_SCHEMA_V1 = 'practonaut.bench/1';
export const BENCH_SCHEMA_V2 = 'practonaut.bench/2';
/** The version `bench` writes. */
export const BENCH_SCHEMA = BENCH_SCHEMA_V2;

/** Named refusals: an inconsistent or re-judged-differently report, and for /2 a stored world,
 * artifact or reference that does not match what the report binds. */
export type BenchErrorCode = 'bench_report_invalid' | 'bench_world_changed' | 'bench_artifact_changed' | 'bench_reference_invalid';
export class BenchReportError extends Error {
  readonly code: BenchErrorCode;
  constructor(message: string, code: BenchErrorCode = 'bench_report_invalid') { super(message); this.name = 'BenchReportError'; this.code = code; }
}

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ratio = z.number().min(0).max(1);
const text = (max: number) => z.string().max(max);
const errorClass = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** One independent checker verdict: the separate checker process, never the agent or the host. */
const VerdictSchema = z.strictObject({ passed: z.boolean(), errorClasses: z.array(errorClass).max(64) });
const ToolCallsSchema = z.strictObject({ observe: count, act: count, undo: count, reset: count, check: count, total: count });

export const RunStatus = ['completed', 'agent_failed', 'timeout', 'infra_error'] as const;
export const BenchRunSchemaV1 = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}-s-?\d{1,16}-r\d{1,4}$/),
  taskId: id, seed: z.number().int().safe(), repeat: z.number().int().min(1).max(1000),
  /** How the agent process ended. Scoring never depends on it. */
  status: z.enum(RunStatus),
  /** Derived: the session verdict passed and, with a mirror, the native-export verdict passed too. */
  pass: z.boolean(),
  /** Actions in the final history of the committed session: `report --verify` re-derives it from the
   * session artifact. Scoring and efficiency use this number. */
  actions: count,
  /** Counted by the runner while the agent worked (self-reported by the runner, not re-verifiable from
   * the artifacts): every accepted action including later undone ones, rejected actions, undo, reset. */
  acceptedActions: count, rejectedActions: count, undos: count, resets: count,
  toolCalls: ToolCallsSchema,
  /** Wall-clock time of the agent process; self-reported by the runner. */
  wallMs: count,
  /** Length of the library's reference solution; `report --verify` compares it with the library entry. */
  referenceActions: z.number().int().min(1).max(1000),
  /** Independent verdicts in a separate checker process; null only when the run could not be judged. */
  checker: z.strictObject({ session: VerdictSchema, native: VerdictSchema.nullable() }).nullable(),
  agentExitCode: z.number().int().nullable(),
  note: text(256).optional(),
  /** SHA-256 of the run's artifacts in its run directory (`session.json`, `native.excalidraw`,
   * `checker.json`). `practonaut report --verify` re-runs the checker on them. Absent for runs that
   * could not be judged and in reports written by earlier builds. */
  artifacts: z.strictObject({ session: sha256, native: sha256.nullable(), checker: sha256 }).optional(),
});
export type BenchRunV1 = z.infer<typeof BenchRunSchemaV1>;

const TaskSummarySchemaV1 = z.strictObject({ taskId: id, runs: count, passed: count, passAt1: ratio, meanActions: z.number().nonnegative().nullable(), referenceActions: z.number().int().min(1), efficiency: z.number().nonnegative().nullable() });
const summaryShape = {
  runs: count, passed: count, judged: count,
  /** Runs that could not be judged. They stay in every denominator and count as not passed. */
  infraErrors: count,
  /** passed / runs over ALL runs, infrastructure errors included (they count as not passed). */
  passAt1: ratio,
  /** pass^k (τ-bench) for k = 1 … repeats; see `passHatK`. */
  passHatK: z.array(z.strictObject({ k: z.number().int().min(1).max(1000), value: ratio })).min(1).max(1000),
  meanActions: z.number().nonnegative().nullable(), meanActionsPassed: z.number().nonnegative().nullable(),
  /** Mean of referenceActions / actions over passed runs with a reference (> 1 = shorter than the
   * reference); null when no passed run has one. */
  efficiencyVsReference: z.number().nonnegative().nullable(), meanWallMs: z.number().nonnegative().nullable(),
  rejectedActions: count, undos: count, resets: count, toolCalls: count,
};
export const BenchSummarySchemaV1 = z.strictObject({ ...summaryShape, byTask: z.array(TaskSummarySchemaV1).max(1000) });
export type BenchSummaryV1 = z.infer<typeof BenchSummarySchemaV1>;

const os = z.strictObject({ platform: text(32), release: text(128), arch: text(32) });
export const BenchReportSchemaV1 = z.strictObject({
  schema: z.literal(BENCH_SCHEMA_V1),
  createdAt: z.iso.datetime(),
  environment: z.strictObject({
    practonaut: text(64), excalidraw: text(64), node: text(64), os,
    /** The mirror actually used: `required` = every action confirmed in the real Excalidraw, `off` = model only. */
    mirror: z.enum(['required', 'off']),
    /** The bundled library the runs used; `contentHash` is the SHA-256 of the world's canonical JSON. */
    library: z.strictObject({ worldId: text(64), version: text(64), contentHash: sha256 }),
  }),
  agent: z.strictObject({
    kind: z.enum(['builtin', 'preset', 'command']), name: text(64),
    /** The command template (placeholders kept, home directory shown as ~); empty for built-ins. */
    command: z.array(text(4096)).max(256),
    /** The model as reported by the client itself (claude-code init event), else null. Never verified. */
    model: text(128).nullable(), modelSource: z.enum(['client-attested', 'none']),
  }),
  settings: z.strictObject({
    tasks: z.array(id).min(1).max(1000), seeds: z.array(z.number().int().safe()).min(1).max(1000),
    repeats: z.number().int().min(1).max(1000), timeoutSeconds: z.number().int().min(1).max(86_400),
    maxActions: z.number().int().min(1).max(10_000), mirror: z.enum(['auto', 'required', 'off']),
    prompt: text(4096),
  }),
  runs: z.array(BenchRunSchemaV1).min(1).max(100_000),
  /** Present when the bench was stopped (Ctrl+C, SIGTERM, SIGHUP) before all planned runs ended:
   * the report holds the runs that finished; the run in progress is not scored. */
  interrupted: z.strictObject({ plannedRuns: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER) }).optional(),
  summary: BenchSummarySchemaV1,
});
export type BenchReportV1 = z.infer<typeof BenchReportSchemaV1>;

// ---- practonaut.bench/2 (PADR-0036) ----

/** A world task id (world format: letters, digits, `_`, `-`). */
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const taskId = z.string().regex(TASK_ID);
/** Seeds a bench plans: `--seeds n` gives 1 … n, `--seed-list` names them (0 … 999 999 999). */
export const MAX_SEED = 999_999_999;
const seed = z.number().int().min(0).max(MAX_SEED);
/** The fixed names of the stored world and references inside a bench folder (never a path elsewhere). */
export const BENCH_WORLD_FILE = 'world.pnworld';
export const BENCH_REFERENCES_FILE = 'references.json';
/** Isolation levels: what Practonaut itself restricts about an agent's tools. Follows from the kind. */
export const ISOLATION_OF = Object.freeze({ builtin: 'builtin-baseline', preset: 'tool-restricted-preset', command: 'template-unrestricted' } as const);
export type IsolationLevel = typeof ISOLATION_OF[keyof typeof ISOLATION_OF];
/** `apiKeySource` as a client reports it in its stream-json init event. */
export const API_KEY_SOURCE = /^[A-Za-z0-9_ ./:@()-]{1,64}$/;
/** An environment variable name `--keep-env` accepts. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** The longest `--label` (UTF-16 code units). */
export const MAX_LABEL = 128;

/** The run's call log and mutation log in its run folder (PADR-0039 A.1–2), bound by hash. */
const RunLogsSchema = z.strictObject({
  /** `calls.jsonl`, normalised by the runner from what the agent's bridge wrote (`calls.bridge.jsonl`,
   * kept unchanged); null: none was written. `dropped`: unreadable lines; `omitted`: lines beyond the
   * log limits, counted but not kept in `calls.jsonl`. */
  calls: z.strictObject({ sha256, entries: count, dropped: count, omitted: count.optional(), clientTiming: z.boolean() }).nullable(),
  /** `mutations.jsonl`, written by the runner's host-side wrapper; `omitted`: budget refusals only counted. */
  mutations: z.strictObject({ sha256, entries: count, omitted: count }),
});
/** The client's own figures from its output (PADR-0039 A.5): self-reported, never verified. */
const RunClientSchema = z.strictObject({
  source: z.enum(['client-attested', 'command-output']),
  model: z.string().regex(/^[\w.:@/-]{1,128}$/).nullable(), turns: count.nullable(), costUsd: z.number().nonnegative().max(1_000_000).nullable(),
  tokens: z.strictObject({ input: count, output: count, cacheRead: count, cacheCreation: count }).nullable(),
});
export const BenchRunSchemaV2 = z.strictObject({
  ...BenchRunSchemaV1.shape,
  /** `<task>-s<seed>-r<repeat>`: also the name of the run's folder in the bench folder. */
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}-s\d{1,9}-r\d{1,4}$/),
  taskId, seed,
  /** Length of the task's validated reference (`references`), or null: no reference, no efficiency. */
  referenceActions: z.number().int().min(1).max(1000).nullable(),
  /** SHA-256 of the run's judged artifacts; present exactly when the run was judged. `trace`: the
   * checker's condition trace (null when it could not be made, with `traceError`); `board`: the real
   * engine's SVG of the final board (null without the mirror or when the picture failed). */
  artifacts: z.strictObject({ session: sha256, native: sha256.nullable(), checker: sha256, trace: sha256.nullable().optional(), traceError: errorClass.optional(), board: sha256.nullable().optional() }).optional(),
  logs: RunLogsSchema.optional(),
  client: RunClientSchema.optional(),
});
export type BenchRunV2 = z.infer<typeof BenchRunSchemaV2>;
const TaskSummarySchemaV2 = z.strictObject({ ...TaskSummarySchemaV1.shape, taskId, referenceActions: z.number().int().min(1).nullable() });
export const BenchSummarySchemaV2 = z.strictObject({ ...summaryShape, byTask: z.array(TaskSummarySchemaV2).max(1000) });
export type BenchSummaryV2 = z.infer<typeof BenchSummarySchemaV2>;

const GeneratedEntrySchema = z.strictObject({
  taskId, id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), version: text(64), seed: z.number().int().safe(), parameters: GeneratedParametersSchema,
});
export const BenchReportSchemaV2 = z.strictObject({
  schema: z.literal(BENCH_SCHEMA_V2),
  createdAt: z.iso.datetime(),
  /** `--label`: the user's own text, shown escaped. */
  label: z.string().min(1).max(MAX_LABEL).optional(),
  environment: z.strictObject({
    practonaut: text(64), excalidraw: text(64), node: text(64), os,
    mirror: z.enum(['required', 'off']),
    /** The public world the runs used, stored in the bench folder; `report --verify` judges against it. */
    world: z.strictObject({
      /** `library`: the bundled task library; `own`: a world given with `--world`. */
      source: z.enum(['library', 'own']),
      worldId: text(64), version: text(128),
      /** SHA-256 of the world's canonical JSON. */
      contentHash: sha256,
      /** The stored package: its fixed name in the bench folder and the SHA-256 of its bytes. */
      package: z.strictObject({ path: z.literal(BENCH_WORLD_FILE), sha256 }),
      /** `generatedBy` of the benched tasks that a generator materialised (PADR-0036). */
      generated: z.array(GeneratedEntrySchema).max(1000),
      /** The public `limits` of benched tasks that have them (PADR-0040); `--verify` compares them with the stored world. */
      limits: z.array(z.strictObject({ taskId, actions: z.number().int().min(1).max(1000).optional(), checks: z.number().int().min(0).max(1000).optional() })).max(1000).optional(),
    }),
  }),
  agent: z.strictObject({
    kind: z.enum(['builtin', 'preset', 'command']), name: text(64),
    command: z.array(text(4096)).max(256),
    /** What Practonaut restricts about the agent's tools; follows from `kind`. */
    isolation: z.enum([ISOLATION_OF.builtin, ISOLATION_OF.preset, ISOLATION_OF.command]),
    /** The model from a stream-json `system/init` line, else null. Never verified. */
    model: text(128).nullable(),
    /** `client-attested`: the preset client's own init event; `command-output`: an init line in a
     * command template's output (the template keeps its model; which program printed it is unknown). */
    modelSource: z.enum(['client-attested', 'command-output', 'none']),
    /** `apiKeySource` from the same init line, else null: evidence, not proof (PADR-0034). */
    apiKeySource: z.string().regex(API_KEY_SOURCE).nullable(),
    /** Names given to `--keep-env` (a preset only); never values. */
    keptEnv: z.array(z.string().regex(ENV_NAME)).max(64),
  }),
  settings: z.strictObject({
    tasks: z.array(taskId).min(1).max(1000), seeds: z.array(seed).min(1).max(1000),
    repeats: z.number().int().min(1).max(1000), timeoutSeconds: z.number().int().min(1).max(86_400),
    maxActions: z.number().int().min(1).max(10_000), mirror: z.enum(['auto', 'required', 'off']),
    prompt: text(4096),
    /** `--checks`: checks allowed per run (PADR-0040); a task's own limits are in the stored world. */
    checks: z.number().int().min(0).max(1000).optional(),
  }),
  /** Validated references, stored in the bench folder after the last agent ended; null: none. */
  references: z.strictObject({
    path: z.literal(BENCH_REFERENCES_FILE), sha256,
    tasks: z.array(z.strictObject({ taskId, source: z.enum(['library', 'oracle-file']), actions: z.number().int().min(1).max(1000),
      /** The reference is a proven minimal solution for every planned seed (PADR-0040); absent or false:
       * a reference length. `report --verify` recomputes it. */
      minimal: z.boolean().optional() })).min(1).max(1000),
  }).nullable(),
  runs: z.array(BenchRunSchemaV2).min(1).max(100_000),
  interrupted: z.strictObject({ plannedRuns: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER) }).optional(),
  summary: BenchSummarySchemaV2,
});
export type BenchReportV2 = z.infer<typeof BenchReportSchemaV2>;
export type BenchReport = BenchReportV1 | BenchReportV2;
export type BenchRun = BenchRunV1 | BenchRunV2;

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
const mean = (values: number[]): number | null => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - k + i) / i;
  return result;
}
/**
 * pass^k as defined by τ-bench (Yao, Shinn, Razavi, Narasimhan: "τ-bench: A Benchmark for
 * Tool-Agent-User Interaction in Real-World Domains", arXiv:2406.12045, 2024, §5):
 *   pass^k = E_task [ C(c, k) / C(n, k) ]
 * with n independent trials of a task and c of them successful — the chance that all of k
 * trials drawn from the n succeed. Here a task is one (task, seed) instance and its trials are
 * the repeats. pass^1 equals pass@1.
 */
export function passHatK(instances: ReadonlyArray<{ n: number; c: number }>, k: number): number {
  if (!instances.length) return 0;
  // An instance with fewer than k trials cannot show k successes; it contributes 0, never NaN.
  return round(instances.reduce((sum, { n, c }) => sum + (choose(n, k) === 0 ? 0 : choose(c, k) / choose(n, k)), 0) / instances.length);
}

/** The pass rule. With a mirror the native export must pass as well; without a verdict nothing passes. */
export function derivedPass(run: Pick<BenchRun, 'checker'>, mirror: 'required' | 'off'): boolean {
  if (!run.checker) return false;
  if (mirror === 'required' && !run.checker.native) return false;
  return run.checker.session.passed && (run.checker.native?.passed ?? true);
}

/** Aggregates over every run. Efficiency only counts passed runs whose task has a reference. */
export function summarize(runs: readonly BenchRunV1[], repeats: number): BenchSummaryV1;
export function summarize(runs: readonly BenchRunV2[], repeats: number): BenchSummaryV2;
export function summarize(runs: readonly BenchRun[], repeats: number): BenchSummaryV1 | BenchSummaryV2 {
  const judged = runs.filter(run => run.checker !== null), passed = runs.filter(run => run.pass);
  const instances = new Map<string, { n: number; c: number }>();
  for (const run of runs) {
    const key = `${run.taskId}\u0000${run.seed}`, entry = instances.get(key) ?? { n: 0, c: 0 };
    entry.n++; if (run.pass) entry.c++; instances.set(key, entry);
  }
  const efficiency = (list: readonly BenchRun[]): number | null => mean(list.flatMap(run => run.pass && run.actions > 0 && run.referenceActions !== null ? [run.referenceActions / run.actions] : []));
  const taskIds = [...new Set(runs.map(run => run.taskId))];
  return {
    runs: runs.length, passed: passed.length, judged: judged.length, infraErrors: runs.filter(run => run.status === 'infra_error').length,
    // Every run is in the denominator: a run that could not be judged (infra_error) is not passed.
    passAt1: runs.length ? round(passed.length / runs.length) : 0,
    passHatK: Array.from({ length: repeats }, (_, index) => ({ k: index + 1, value: passHatK([...instances.values()], index + 1) })),
    meanActions: mean(judged.map(run => run.actions)), meanActionsPassed: mean(passed.map(run => run.actions)),
    efficiencyVsReference: efficiency(runs), meanWallMs: mean(runs.map(run => run.wallMs)),
    rejectedActions: runs.reduce((sum, run) => sum + run.rejectedActions, 0), undos: runs.reduce((sum, run) => sum + run.undos, 0),
    resets: runs.reduce((sum, run) => sum + run.resets, 0), toolCalls: runs.reduce((sum, run) => sum + run.toolCalls.total, 0),
    byTask: taskIds.map(taskId => {
      const list = runs.filter(run => run.taskId === taskId), ok = list.filter(run => run.pass);
      return { taskId, runs: list.length, passed: ok.length, passAt1: round(ok.length / list.length), meanActions: mean(list.filter(run => run.checker !== null).map(run => run.actions)), referenceActions: list[0]!.referenceActions, efficiency: efficiency(list) };
    }),
  } as BenchSummaryV1 | BenchSummaryV2;
}

function schemaIssue(error: z.ZodError, schema: string): BenchReportError {
  const issue = error.issues[0];
  return new BenchReportError(`report does not match ${schema}: ${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid'}`);
}

/** The rules /1 and /2 share: the plan, every run's verdicts and counters, and the summary. */
function checkRuns(report: BenchReport): void {
  const mirror = report.environment.mirror;
  // The plan is checked arithmetically and never expanded: settings may name up to 1000 tasks ×
  // 1000 seeds × 1000 repeats, which must not become 10^9 keys in memory.
  const planned = report.settings.tasks.length * report.settings.seeds.length * report.settings.repeats;
  if (report.interrupted) {
    if (report.interrupted.plannedRuns !== planned || report.runs.length >= planned) throw new BenchReportError(`interrupted report holds ${report.runs.length} runs, but its settings plan ${planned}`);
  } else if (planned !== report.runs.length) throw new BenchReportError(`report has ${report.runs.length} runs, but its settings plan ${planned}`);
  const tasks = new Set<string>(report.settings.tasks), seeds = new Set<number>(report.settings.seeds);
  if (tasks.size !== report.settings.tasks.length || seeds.size !== report.settings.seeds.length) throw new BenchReportError('settings name a task or seed twice');
  const seen = new Set<string>(), ids = new Set<string>(), reference = new Map<string, number | null>();
  for (const run of report.runs as readonly BenchRun[]) {
    if ((reference.has(run.taskId) ? reference.get(run.taskId) : run.referenceActions) !== run.referenceActions) throw new BenchReportError(`run ${run.id} names another reference length for ${run.taskId}`);
    reference.set(run.taskId, run.referenceActions);
    const key = `${run.taskId}\u0000${run.seed}\u0000${run.repeat}`;
    if (!tasks.has(run.taskId) || !seeds.has(run.seed) || run.repeat > report.settings.repeats || seen.has(key)) throw new BenchReportError(`run ${run.id} is not one of the planned task × seed × repeat runs, or appears twice`);
    if (ids.has(run.id)) throw new BenchReportError(`run id ${run.id} appears twice`);
    seen.add(key); ids.add(run.id);
    if (run.status !== 'infra_error' && run.checker === null) throw new BenchReportError(`run ${run.id} has no independent checker verdict`);
    if (run.checker && mirror === 'required' && run.checker.native === null) throw new BenchReportError(`run ${run.id} lacks the native-export verdict a mirrored run requires`);
    if (run.checker && mirror === 'off' && run.checker.native !== null) throw new BenchReportError(`run ${run.id} claims a native-export verdict without a mirror`);
    if (run.pass !== derivedPass(run, mirror)) throw new BenchReportError(`run ${run.id} claims pass=${run.pass}, but its checker verdicts give pass=${derivedPass(run, mirror)}`);
    if (run.toolCalls.total !== run.toolCalls.observe + run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check) throw new BenchReportError(`run ${run.id} tool-call total does not add up`);
    if (run.toolCalls.act !== run.acceptedActions + run.rejectedActions) throw new BenchReportError(`run ${run.id}: act calls must equal accepted plus rejected actions`);
    // Every action in the final history was accepted once; undo and reset only remove entries.
    if (run.actions > run.acceptedActions) throw new BenchReportError(`run ${run.id}: the final history holds more actions than the host accepted`);
    if (run.artifacts && run.checker === null) throw new BenchReportError(`run ${run.id} binds artifacts but has no checker verdict`);
    if (run.artifacts && (run.artifacts.native === null) !== (run.checker?.native === null)) throw new BenchReportError(`run ${run.id}: native-export artifact and native verdict must appear together`);
  }
  const summary = summarize(report.runs as BenchRunV2[], report.settings.repeats);
  if (!isDeepStrictEqual(summary, report.summary)) throw new BenchReportError('summary does not follow from the runs');
}

/** Accept a /1 report only when it is well-formed and every derived value follows from its runs. */
export function validateBenchReportV1(raw: unknown): BenchReportV1 {
  const parsed = BenchReportSchemaV1.safeParse(raw);
  if (!parsed.success) throw schemaIssue(parsed.error, BENCH_SCHEMA_V1);
  checkRuns(parsed.data);
  return parsed.data;
}

/** The /2 rules on top of the shared ones: run names, the agent's derived fields, references and
 * generated-instance metadata that agree with the plan, and artifacts exactly for judged runs. */
export function validateBenchReportV2(raw: unknown): BenchReportV2 {
  const parsed = BenchReportSchemaV2.safeParse(raw);
  if (!parsed.success) throw schemaIssue(parsed.error, BENCH_SCHEMA_V2);
  const report = parsed.data, fail = (message: string): never => { throw new BenchReportError(message); };
  const planned = new Set(report.settings.tasks), folded = new Map<string, string>();
  for (const task of report.settings.tasks) {
    const other = folded.get(task.toLowerCase());
    if (other !== undefined && other !== task) fail(cliText('benchReportTaskCase', { a: other, b: task }));
    folded.set(task.toLowerCase(), task);
  }
  const agent = report.agent;
  if (agent.isolation !== ISOLATION_OF[agent.kind]) fail(cliText('benchReportIsolation', { kind: agent.kind, expected: ISOLATION_OF[agent.kind], given: agent.isolation }));
  if ((agent.model === null) !== (agent.modelSource === 'none')) fail(cliText('benchReportModelSource'));
  const field = (name: string): never => fail(cliText('benchReportAgentField', { kind: agent.kind, field: name }));
  if (agent.kind === 'builtin' && agent.command.length) field('command');
  if (agent.kind === 'builtin' && agent.apiKeySource !== null) field('apiKeySource');
  if (agent.modelSource === 'client-attested' && agent.kind !== 'preset') field('modelSource');
  if (agent.modelSource === 'command-output' && agent.kind !== 'command') field('modelSource');
  if (agent.keptEnv.length && agent.kind !== 'preset') field('keptEnv');
  if (new Set(agent.keptEnv).size !== agent.keptEnv.length) field('keptEnv');
  const world = report.environment.world, references = new Map<string, number>();
  for (const entry of report.references?.tasks ?? []) {
    if (!planned.has(entry.taskId) || references.has(entry.taskId)) fail(cliText('benchReportReferenceTask', { task: entry.taskId }));
    if (entry.source !== (world.source === 'library' ? 'library' : 'oracle-file')) fail(cliText('benchReportReferenceSource', { source: entry.source, world: world.source }));
    references.set(entry.taskId, entry.actions);
  }
  if (world.source === 'library') for (const task of report.settings.tasks) if (!references.has(task)) fail(cliText('benchReportLibraryReference', { task }));
  const generated = new Set<string>();
  for (const entry of world.generated) {
    if (!planned.has(entry.taskId) || generated.has(entry.taskId)) fail(cliText('benchReportGenerated', { task: entry.taskId }));
    generated.add(entry.taskId);
  }
  for (const run of report.runs) {
    const expected = `${run.taskId}-s${run.seed}-r${run.repeat}`;
    if (run.id !== expected) fail(cliText('benchReportRunId', { id: run.id, expected }));
    const reference = references.get(run.taskId) ?? null;
    if (run.referenceActions !== reference) fail(cliText('benchReportRunReference', { id: run.id, given: String(run.referenceActions), expected: String(reference) }));
    if ((run.checker !== null) !== (run.artifacts !== undefined)) fail(cliText('benchReportArtifacts', { id: run.id }));
    checkRunEvidence(report, run, fail);
  }
  checkRuns(report);
  return report;
}

/** The /2 evidence fields of one run (PADR-0039): a picture only with the mirror, a trace error only
 * without a trace, a mutation log that holds every counted act, undo and reset call, client timing
 * only from Practonaut's own client, client figures only from an external agent's own output; a
 * condition trace only beside the mutation log it is re-derived from. */
function checkRunEvidence(report: BenchReportV2, run: BenchRunV2, fail: (message: string) => never): void {
  const artifacts = run.artifacts, mirror = report.environment.mirror, kind = report.agent.kind;
  if (artifacts?.board !== undefined && artifacts.board !== null && mirror === 'off') fail(cliText('benchReportBoard', { id: run.id }));
  if (artifacts?.traceError !== undefined && artifacts.trace !== null) fail(cliText('benchReportTraceError', { id: run.id }));
  if (artifacts?.trace === null && artifacts.traceError === undefined) fail(cliText('benchReportTraceError', { id: run.id }));
  // A condition trace is re-derived at --verify from the session and the mutation log: without the log
  // it could not be checked, so it is not accepted at all.
  if (typeof artifacts?.trace === 'string' && !run.logs) fail(cliText('benchReportTraceWithoutLog', { id: run.id }));
  if (run.logs) {
    const calls = run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset;
    if (run.logs.mutations.entries + run.logs.mutations.omitted !== calls) fail(cliText('benchReportMutations', { id: run.id, entries: run.logs.mutations.entries + run.logs.mutations.omitted, calls }));
    if (run.logs.calls?.clientTiming && kind !== 'builtin') fail(cliText('benchReportClientTiming', { id: run.id }));
  }
  if (run.client && (kind === 'builtin' || run.client.source !== (kind === 'preset' ? 'client-attested' : 'command-output'))) fail(cliText('benchReportClient', { id: run.id, kind }));
}

/** Reads either version by its `schema` field; anything else is refused naming both. */
export function validateBenchReport(raw: unknown): BenchReport {
  const schema = raw !== null && typeof raw === 'object' ? (raw as { schema?: unknown }).schema : undefined;
  if (schema === BENCH_SCHEMA_V1) return validateBenchReportV1(raw);
  if (schema === BENCH_SCHEMA_V2) return validateBenchReportV2(raw);
  throw new BenchReportError(cliText('benchReportSchemaUnknown', { first: BENCH_SCHEMA_V1, second: BENCH_SCHEMA_V2 }));
}
export const isBenchReportV2 = (report: BenchReport): report is BenchReportV2 => report.schema === BENCH_SCHEMA_V2;

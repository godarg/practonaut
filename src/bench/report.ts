/**
 * The bench report `practonaut.bench/1`: its schema (source of `schemas/bench.v1.json`), the
 * aggregation and the validator. A report is data: `report` and every consumer accept it only after
 * `validateBenchReport`, which re-derives every pass and every aggregate from the recorded checker
 * verdicts. A pass without an independent verdict, or a summary that the runs do not produce, is
 * rejected, whatever the file claims.
 */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

export const BENCH_SCHEMA = 'practonaut.bench/1';
export class BenchReportError extends Error {
  readonly code = 'bench_report_invalid';
  constructor(message: string) { super(message); this.name = 'BenchReportError'; }
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
export const BenchRunSchema = z.strictObject({
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
export type BenchRun = z.infer<typeof BenchRunSchema>;

const TaskSummarySchema = z.strictObject({ taskId: id, runs: count, passed: count, passAt1: ratio, meanActions: z.number().nonnegative().nullable(), referenceActions: z.number().int().min(1), efficiency: z.number().nonnegative().nullable() });
export const BenchSummarySchema = z.strictObject({
  runs: count, passed: count, judged: count,
  /** Runs that could not be judged. They stay in every denominator and count as not passed. */
  infraErrors: count,
  /** passed / runs over ALL runs, infrastructure errors included (they count as not passed). */
  passAt1: ratio,
  /** pass^k (τ-bench) for k = 1 … repeats; see `passHatK`. */
  passHatK: z.array(z.strictObject({ k: z.number().int().min(1).max(1000), value: ratio })).min(1).max(1000),
  meanActions: z.number().nonnegative().nullable(), meanActionsPassed: z.number().nonnegative().nullable(),
  /** Mean of referenceActions / actions over passed runs (> 1 = shorter than the reference). */
  efficiencyVsReference: z.number().nonnegative().nullable(), meanWallMs: z.number().nonnegative().nullable(),
  rejectedActions: count, undos: count, resets: count, toolCalls: count,
  byTask: z.array(TaskSummarySchema).max(1000),
});
export type BenchSummary = z.infer<typeof BenchSummarySchema>;

export const BenchReportSchema = z.strictObject({
  schema: z.literal(BENCH_SCHEMA),
  createdAt: z.iso.datetime(),
  environment: z.strictObject({
    practonaut: text(64), excalidraw: text(64), node: text(64),
    os: z.strictObject({ platform: text(32), release: text(128), arch: text(32) }),
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
  runs: z.array(BenchRunSchema).min(1).max(100_000),
  /** Present when the bench was stopped (Ctrl+C, SIGTERM, SIGHUP) before all planned runs ended:
   * the report holds the runs that finished; the run in progress is not scored. */
  interrupted: z.strictObject({ plannedRuns: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER) }).optional(),
  summary: BenchSummarySchema,
});
export type BenchReport = z.infer<typeof BenchReportSchema>;

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

export function summarize(runs: readonly BenchRun[], repeats: number): BenchSummary {
  const judged = runs.filter(run => run.checker !== null), passed = runs.filter(run => run.pass);
  const instances = new Map<string, { n: number; c: number }>();
  for (const run of runs) {
    const key = `${run.taskId}\u0000${run.seed}`, entry = instances.get(key) ?? { n: 0, c: 0 };
    entry.n++; if (run.pass) entry.c++; instances.set(key, entry);
  }
  const efficiency = (list: readonly BenchRun[]): number | null => mean(list.filter(run => run.pass && run.actions > 0).map(run => run.referenceActions / run.actions));
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
  };
}

/** Accept a report only when it is well-formed and every derived value follows from its runs. */
export function validateBenchReport(raw: unknown): BenchReport {
  const parsed = BenchReportSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BenchReportError(`report does not match ${BENCH_SCHEMA}: ${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid'}`);
  }
  const report = parsed.data, mirror = report.environment.mirror;
  // The plan is checked arithmetically and never expanded: settings may name up to 1000 tasks ×
  // 1000 seeds × 1000 repeats, which must not become 10^9 keys in memory.
  const planned = report.settings.tasks.length * report.settings.seeds.length * report.settings.repeats;
  if (report.interrupted) {
    if (report.interrupted.plannedRuns !== planned || report.runs.length >= planned) throw new BenchReportError(`interrupted report holds ${report.runs.length} runs, but its settings plan ${planned}`);
  } else if (planned !== report.runs.length) throw new BenchReportError(`report has ${report.runs.length} runs, but its settings plan ${planned}`);
  const tasks = new Set(report.settings.tasks), seeds = new Set(report.settings.seeds);
  if (tasks.size !== report.settings.tasks.length || seeds.size !== report.settings.seeds.length) throw new BenchReportError('settings name a task or seed twice');
  const seen = new Set<string>(), ids = new Set<string>(), reference = new Map<string, number>();
  for (const run of report.runs) {
    if ((reference.get(run.taskId) ?? run.referenceActions) !== run.referenceActions) throw new BenchReportError(`run ${run.id} names another reference length for ${run.taskId}`);
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
  const summary = summarize(report.runs, report.settings.repeats);
  if (!isDeepStrictEqual(summary, report.summary)) throw new BenchReportError('summary does not follow from the runs');
  return report;
}

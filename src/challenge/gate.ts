/**
 * The 0.3.0 gate (PADR-0040's preregistration as PADR-0042 amends it, accepted with this code): from a
 * round's committed plan, pre-probe record and declaration `/2`, the pushed release ledger, the
 * `practonaut.bench/3` reports of the pre-probe and the held-out round — oracle, random and the three
 * ladder agents on the same held-out instances, each possibly resumed over several reports — and the
 * near-miss results, every number the verdict uses and the verdict itself; and the preflight that
 * checks everything but the ladder before any ladder run. Every run of a model is bound to its two
 * ledger records; attestation comes only from values a shipped parser re-derived, and a budget
 * exemption only from structure. Pure: the caller reads, validates and re-verifies the reports, reads
 * git and the ledger, regenerates the sets and judges the near misses. Board text never enters the
 * result or the Markdown.
 *
 * Seams for later changes: artifact-level units (their reports, the digest's `result`/`state` runs and
 * baselines through the foreign server) come with artifact mode, which until then is refused by the
 * unit check and by `readGateReport`; co-actor units need `verifySchedule` on every held-out run
 * (PADR-0048 decision 12), and until the scenario strand adds it `report --verify` refuses a report
 * with scenarios, so none reaches this gate.
 */
import { isDeepStrictEqual } from 'node:util';
import { mcnemarExact, mcnemarPower, wilson } from '../bench/stats.ts';
import { sha256Hex } from '../canonical/index.ts';
import type { SessionReportV3, SessionRunV3 } from '../bench/report.ts';
import { SHIPPED_PARSERS } from '../bench/parsers.ts';
import { safeText } from '../cli/output.ts';
import { ALPHA, GATE_PRESET, SHAPE_B, declarationHash, developmentDigest, digestRunOf, fileHash, fundingAt, heldOutRuns, type Declaration, type DigestRun, type DigestSession, type Plan, type ProbeRecord } from './declaration.ts';
import { countLedger, prefixOf, released, RELEASE_CAP, roundEvents, roundStarts, type Ledger, type RunEndRecord, type StartRecord } from './ledger.ts';
import { generatorId, type Family } from './families.ts';
import { taskIdOf } from './build.ts';

export const GATE_SCHEMA = 'practonaut.challenge-gate/2';
/** Preregistered thresholds (PADR-0040, unchanged by PADR-0042 decision 13). */
export const GATE = Object.freeze({ headroomLow: 0.10, headroomHigh: 0.80, minDifference: 0.20, maxInfraShare: 0.05, maxRandom: 0.05, maxRunsPerRound: 100 });
/** The only seed list a round's benches use: a generated world has one variant, so another seed would
 * run the same instance again. */
export const GATE_SEEDS = Object.freeze([1]);

export class GateInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'GateInputError'; this.code = code; }
}
const fail = (code: string, message: string): never => { throw new GateInputError(code, message); };

/** A validated, re-verified bench/3 report and its bench folder's name, with what verification
 * re-derived: the runs whose client values a shipped parser read again from their bound stdout, the
 * failure each infra_error run's stdout gives that parser, and for pre-probe reports the judged sessions. */
export interface GateReport {
  report: SessionReportV3; bench: string;
  rederived: ReadonlySet<string>;
  failures?: ReadonlyMap<string, RederivedFailure | null>;
  sessions?: ReadonlyMap<string, DigestSession>;
}
/** A run's failure as a shipped parser re-derives it from the run's own bound stdout. */
export interface RederivedFailure { reason: string; parser: string; code: string | null; beforeModelWork: boolean }

/**
 * Whether a run attests `model` for the gate pair and the ladder (bench/3 review): only when a shipped
 * parser re-derived the run's client values from its bound stdout (`report --verify`) and the client
 * itself names that model. A value that is only the report's claim — an unknown parser, a run not
 * re-derived, a command template's line — never attests.
 */
export function attests(source: Pick<GateReport, 'rederived'>, run: SessionRunV3, model: string): boolean {
  return source.rederived.has(run.id) && run.client !== undefined && run.client.source === 'client-attested' && SHIPPED_PARSERS.has(run.client.parser) && run.client.model === model;
}
/**
 * Whether a run is exempt from every budget (PADR-0044 decision 9, bench/3 review): only by structure —
 * its failure is a usage limit or a login or billing error before model work, classified by a parser
 * this Practonaut ships and re-derived by it from the run's own stdout, with no host call but the
 * bridge's start-up read and no tokens. Never by the note's words, tool-call counts or missing tokens
 * alone.
 */
export function exemptRun(run: Pick<SessionRunV3, 'id' | 'status' | 'failure' | 'toolCalls' | 'client'>, source: Pick<GateReport, 'rederived' | 'failures'>): boolean {
  const failure = run.failure;
  if (run.status !== 'infra_error' || !failure || (failure.reason !== 'usage_limit' && failure.reason !== 'auth') || failure.beforeModelWork !== true || failure.parser === null || !SHIPPED_PARSERS.has(failure.parser)) return false;
  if (!source.rederived.has(run.id)) return false;
  const again = source.failures?.get(run.id) ?? null;
  if (again === null || again.reason !== failure.reason || again.parser !== failure.parser || again.code !== failure.code || again.beforeModelWork !== true) return false;
  const calls = run.toolCalls, tokens = run.client?.tokens;
  return calls.act === 0 && calls.undo === 0 && calls.reset === 0 && calls.check === 0 && calls.observe <= 1
    && (tokens === null || tokens === undefined || tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation === 0);
}

/** The ledger as the gate reads it: verified, with every committed version a prefix of it. */
export interface LedgerInput { ledger: Ledger; versions: ReadonlyArray<{ commit: string; date: string; records: number }> }
/** The run folders of a round's start entries that have no run-end record, as the bench roots hold them:
 * `unjudged` (the folder exists and holds no verdict), `judged` (it holds `checker.json` or
 * `session.json`) or `missing`. Only an unjudged one may be benched again. */
export type Folders = ReadonlyMap<string, 'judged' | 'unjudged' | 'missing'>;
interface Bound { start: StartRecord; end: RunEndRecord | null }
const runKey = (bench: string, run: string): string => `${bench}\u0000${run}`;
const taskOfRun = (run: string): string => run.replace(/-s\d+-r\d+$/, '');
/** What a run's records must name. */
interface Expect { purpose: 'pre-probe' | 'held-out'; unit: string; round: number; basis: string; toolchain: string; rules: string | null }
/**
 * A run and its two pushed ledger records (PADR-0044 decision 8): no start entry refuses
 * (`run_outside_ledger`); a start entry of another purpose, unit, round, plan or declaration, toolchain
 * or rules version refuses; a run-end record whose hashes, status, failure or counters are not the
 * report's refuses (`ledger_hash_mismatch`). A run without its run-end record is returned with
 * `end: null`: it counts and is never digested or scored; it may be benched again only when its folder
 * holds no verdict (PADR-0042 amended: a lost record voids a judged run).
 */
export function bindRun(ledger: Ledger, source: Pick<GateReport, 'bench'>, run: SessionRunV3, expect: Expect): Bound {
  const start = ledger.records.find((record): record is StartRecord => record.kind === 'start' && record.bench === source.bench && record.run === run.id);
  if (!start) return fail('run_outside_ledger', `run ${run.id} (bench folder ${source.bench}) has no start entry in the pushed release ledger; every model run of a round takes its entry before its client starts (node tools/challenge.ts bench)`);
  if (start.purpose !== expect.purpose || start.unit !== expect.unit || start.round !== expect.round || start.basis !== expect.basis)
    fail('ledger_mismatch', `run ${run.id}: its start entry ${start.seq} is a ${start.purpose} run of ${start.unit ?? 'no unit'} round ${start.round ?? '-'} for ${start.basis === null ? 'no plan or declaration' : 'another plan or declaration'}, not a ${expect.purpose} run of this round`);
  if (start.toolchain !== expect.toolchain || start.rules !== expect.rules) fail('toolchain_mismatch', `run ${run.id}: its ledger records name toolchain ${start.toolchain} (rules ${start.rules ?? 'none'}), not the plan's ${expect.toolchain} (rules ${expect.rules ?? 'none'})`);
  const end = ledger.ends.get(start.seq) ?? null;
  if (end) {
    const tokens = run.client?.tokens;
    const same = end.status === run.status && end.judged === (run.artifacts?.session ?? null) && end.stdout === (run.stdout?.sha256 ?? null) && end.checker === (run.artifacts?.checker ?? null)
      && isDeepStrictEqual(end.failure, run.failure ?? null) && end.hostCalls === run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check && end.reads === run.toolCalls.observe
      && end.tokens === (tokens ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation : null);
    if (!same) fail('ledger_hash_mismatch', `run ${run.id}: the report binds other hashes, status, failure or counts than its pushed run-end record ${end.seq}`);
  }
  return { start, end };
}

/** One agent's runs over its reports (a resumed bench has several): per task the latest run; a task
 * benched again only after an infra_error (spent), any other repeat refuses (no best-of-N) — also after
 * a judged run whose run-end record is missing. */
type RunOf<S extends { report: { runs: readonly unknown[] } }> = S['report']['runs'][number];
export function mergeAgentRuns<S extends { report: { createdAt: string; runs: ReadonlyArray<{ id: string; taskId: string; status: string }> }; bench: string }>(reports: readonly S[], label: string): Map<string, { run: RunOf<S>; bench: string; source: S }> {
  const ordered = [...reports].sort((a, b) => a.report.createdAt.localeCompare(b.report.createdAt) || a.bench.localeCompare(b.bench));
  const merged = new Map<string, { run: RunOf<S>; bench: string; source: S }>();
  for (const source of ordered) for (const run of source.report.runs) {
    const earlier = merged.get(run.taskId);
    if (earlier && earlier.run.status !== 'infra_error') fail('best_of_n', `${label}: task ${run.taskId} was benched again although its run in ${earlier.bench} was judged (no best-of-N)`);
    merged.set(run.taskId, { run, bench: source.bench, source });
  }
  return merged;
}

export type Outcome = 'passed' | 'failed' | 'infra_error' | 'missing' | 'unattested' | 'unrecorded';
export interface AgentResult {
  role: 'oracle' | 'random' | 'ladder'; name: string; model: string | null;
  /** Instances passed; every planned instance counts, a missing, unjudged, unattested or unrecorded run is not passed. */
  passed: number; instances: number; infraErrors: number; missing: number; unattested: number; unrecorded: number;
  /** Reports merged for this agent (a resumed bench has several). */
  reports: number;
  rate: number; interval: { low: number; high: number };
  outcomes: Array<{ taskId: string; outcome: Outcome }>;
}
function agentResult(role: AgentResult['role'], name: string, model: string | null, plan: readonly string[], outcomeOf: (task: string) => Outcome, reports: number): AgentResult {
  const outcomes = plan.map(taskId => ({ taskId, outcome: outcomeOf(taskId) }));
  const count = (kind: Outcome): number => outcomes.filter(entry => entry.outcome === kind).length;
  const passed = count('passed');
  return { role, name, model, passed, instances: plan.length, infraErrors: count('infra_error'), missing: count('missing'), unattested: count('unattested'), unrecorded: count('unrecorded'), reports, rate: passed / plan.length, interval: wilson(passed, plan.length), outcomes };
}

const sorted = (values: readonly string[]): string => [...values].sort().join('\u0000');
/** A version's release line: `2.1.301` → `2.1`; a version that is not dotted numbers stays whole. */
const releaseLine = (version: string): string => /^(\d+)\.(\d+)\./.exec(version)?.slice(1, 3).join('.') ?? version;
const compareVersions = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** Every report of a round is made with the Practonaut its plan pins (PADR-0042 amended, 3.11); the
 * report's own text reaches the terminal escaped. */
export function checkPinned(label: string, report: { environment: { practonaut: string } }, pinned: string): void {
  if (report.environment.practonaut !== pinned) fail('practonaut_version', `the ${label} report was made with Practonaut ${safeText(report.environment.practonaut)}; the round's plan pins ${safeText(pinned)}`);
}
/** A report's settings and world as the plan or declaration fix them. */
function checkSettings(label: string, report: SessionReportV3, worldHash: string, tasks: readonly string[], bench: Plan['bench'], toolchain: Plan['toolchain']): void {
  if (report.verdictLevel !== toolchain.level || report.toolchain.id !== toolchain.id) fail('toolchain_mismatch', `the ${label} report ran on toolchain ${report.toolchain.id} at ${report.verdictLevel} level, not the unit's ${toolchain.id}`);
  checkPinned(label, report, toolchain.practonaut);
  if (report.environment.world.contentHash !== worldHash) fail('set_mismatch', `the ${label} report was not made on the set its round names`);
  if (report.settings.seeds.join() !== GATE_SEEDS.join()) fail('settings_mismatch', `the ${label} report uses seed list ${report.settings.seeds.join(',')}; a generated world has one variant, so a round takes --seed-list 1 only`);
  if (report.settings.repeats !== 1) fail('settings_mismatch', `the ${label} report has --repeats ${report.settings.repeats}; a round takes one run per agent per instance`);
  if (report.environment.mirror !== bench.mirror || report.settings.mirror !== bench.mirror || report.settings.timeoutSeconds !== bench.timeoutSeconds || report.settings.maxActions !== bench.maxActions || (report.settings.checks ?? null) !== bench.checks)
    fail('settings_mismatch', `the ${label} report differs from the plan in mirror (as requested and as run), timeout, action cap or check limit`);
  if (report.settings.tasks.some(task => !tasks.includes(task))) fail('set_mismatch', `the ${label} report benches tasks outside its set`);
}
/** An external report's agent as a ladder agent: the declared preset with the declared model
 * requested, its billing class, and isolation from the runs a shipped parser re-derived. */
function checkAgent(label: string, source: GateReport, agent: { preset: string; model: string; billing: string }): void {
  const value = source.report.agent;
  if (value.kind !== 'preset' || value.name !== agent.preset || agent.preset !== GATE_PRESET) fail('ladder_preset_refused', `the ${label} report is from ${value.kind} ${safeText(value.name)}; a 0.3.0 round's agents run through ${GATE_PRESET} (PADR-0046 decision 7)`);
  if (value.requestedModel.value !== agent.model || value.requestedModel.source !== 'preset-requested') fail('ladder_model_mismatch', `the ${label} report requested ${value.requestedModel.value ?? 'no model'}, not ${agent.model} (ANTHROPIC_MODEL)`);
  if (value.billing.class !== agent.billing) fail('billing_mismatch', `the ${label} report was set up for billing ${value.billing.class}, the round declares ${agent.billing}`);
  // "tool-restricted" only from runs whose offered tools a shipped parser read again (PADR-0044 decision 6).
  const read = source.report.runs.filter(run => source.rederived.has(run.id));
  if (!read.some(run => run.isolation.evidence === 'tools-within-servers') || read.some(run => run.isolation.evidence === 'tool-outside-servers') || read.some(run => run.checker !== null && run.isolation.evidence !== 'tools-within-servers'))
    fail('ladder_not_restricted', `the ${label} report's runs do not show the tools within Practonaut's server; an agent "template: not restricted" runs outside the gate (PADR-0042 decision 5)`);
}

/** What a pre-probe gives: its outcomes, digest and the runs that count, each with its ledger records. */
export interface ProbeResult { model: string; outcomes: Array<{ taskId: string; seed: number; pass: boolean }>; passed: number; digest: string; runs: Array<{ taskId: string; bench: string; run: string; start: number; end: number }> }
/**
 * The pre-probe from its reports (PADR-0042 decision 7, PADR-0044 decision 8): the plan's agent on the
 * plan's set and settings, one judged, attested and recorded run per instance (a task benched again
 * only after an infra_error or an unjudged run), each bound to its pushed ledger records under the plan;
 * the digest `/2` of their canonical content. Every start of the unit's round on these instances, under
 * any purpose, is in the repeat check, and a pre-probe under another plan is refused unless that plan's
 * pre-probe was recorded as refused before (a retune).
 */
export function probeRuns(input: { plan: Plan; planHash: string; worldContentHash: string; reports: readonly GateReport[]; ledger: Ledger; folders: Folders }): ProbeResult {
  const { plan, planHash } = input, family = plan.unit.split('.')[0] as Family;
  const tasks = plan.seeds.map(seed => taskIdOf(family, seed));
  if (!input.reports.length) fail('probe_missing', 'name the pre-probe reports');
  const expect: Expect = { purpose: 'pre-probe', unit: plan.unit, round: plan.round, basis: planHash, toolchain: plan.toolchain.id, rules: plan.toolchain.rules };
  for (const source of input.reports) {
    checkSettings('pre-probe', source.report, input.worldContentHash, tasks, plan.bench, plan.toolchain);
    checkAgent('pre-probe', source, { preset: plan.agent.preset, model: plan.agent.model, billing: source.report.agent.billing.class });
  }
  const bound = new Map<string, Bound>();
  for (const source of input.reports) for (const run of source.report.runs) bound.set(runKey(source.bench, run.id), bindRun(input.ledger, source, run, expect));
  const members = roundStarts(input.ledger, plan.unit, plan.round);
  // A pre-probe of this round under another plan: only the refused probe a retune follows (decision 7).
  const refusedPlans = new Set(roundEvents(input.ledger, plan.unit, plan.round).filter(event => event.event === 'refused' && event.probe < plan.probe).map(event => event.plan));
  const replanned = members.find(start => start.purpose === 'pre-probe' && start.basis !== planHash && !refusedPlans.has(start.basis ?? ''));
  if (replanned) fail('probe_replanned', `${plan.unit} round ${plan.round} has a pre-probe run under another plan (start entry ${replanned.seq}, ${replanned.run}) whose pre-probe was not recorded as refused; a unit is pre-probed again only as a retune (PADR-0042 decision 7)`);
  repeatCheck(input.ledger, members, new Set(tasks), expect, input.reports, input.folders, 'pre-probe');
  const merged = mergeAgentRuns(input.reports, 'pre-probe');
  const outcomes: ProbeResult['outcomes'] = [], digestRuns: DigestRun[] = [], runs: ProbeResult['runs'] = [];
  for (const [index, task] of tasks.entries()) {
    const entry = merged.get(task);
    if (!entry || entry.run.status === 'infra_error') fail('probe_incomplete', `the pre-probe run of ${task} is ${entry ? 'an infra_error' : 'missing'}; bench it again (after the limit window)`);
    const { run, source } = entry!, binding = bound.get(runKey(source.bench, run.id))!;
    if (binding.end === null) fail('probe_incomplete', `the pre-probe run ${run.id} (bench folder ${source.bench}) was judged without its run-end record: it counts, is never digested, and its instance is not benched again; this pre-probe cannot admit the unit`);
    if (!attests(source, run, plan.agent.model)) fail('probe_unattested', `the pre-probe run ${run.id} does not attest ${plan.agent.model} by its client's own re-derived output`);
    const session = source.sessions?.get(run.id) ?? fail('probe_incomplete', `the pre-probe run ${run.id} has no judged session to digest`);
    digestRuns.push(digestRunOf(run, plan.agent.model, session));
    outcomes.push({ taskId: task, seed: plan.seeds[index]!, pass: run.pass });
    runs.push({ taskId: task, bench: source.bench, run: run.id, start: binding.start.seq, end: binding.end!.seq });
  }
  return { model: plan.agent.model, outcomes, passed: outcomes.filter(entry => entry.pass).length, digest: developmentDigest(digestRuns), runs };
}

/** Whether a start entry's run was judged: by its run-end record, or — without one — unless its folder
 * exists and holds no verdict (a lost record voids a judged run; a missing folder counts as judged). */
function judgedStart(ledger: Ledger, start: StartRecord, folders: Folders): boolean {
  const end = ledger.ends.get(start.seq);
  return end ? end.status !== 'infra_error' : folders.get(runKey(start.bench, start.run)) !== 'unjudged';
}
/**
 * No best-of-N over every run of the round's instances (PADR-0040, as PADR-0042 amended): the round's
 * start entries on `tasks`, whatever their purpose, plan or declaration, grouped by model and task. Every
 * start but the last ended as an infra_error or unjudged; the last, when judged, is a run of the
 * expected purpose and basis (`round_redeclared` for a held-out run of another declaration,
 * `best_of_n` for a run of another purpose) and was given to the gate (`run_not_given`).
 */
function repeatCheck(ledger: Ledger, members: readonly StartRecord[], tasks: ReadonlySet<string>, expect: Pick<Expect, 'purpose' | 'basis'>, given: readonly GateReport[], folders: Folders, label: string): void {
  const groups = new Map<string, StartRecord[]>();
  for (const start of members) {
    if (!tasks.has(taskOfRun(start.run))) continue;
    const key = `${start.model ?? '?'}\u0000${taskOfRun(start.run)}`;
    groups.set(key, [...(groups.get(key) ?? []), start]);
  }
  for (const starts of groups.values()) {
    for (const start of starts.slice(0, -1)) if (judgedStart(ledger, start, folders))
      fail('best_of_n', `${label}: task ${taskOfRun(start.run)} was run again for ${start.model ?? 'an unknown model'} after its judged run ${start.run} (bench folder ${start.bench}, purpose ${start.purpose}); no best-of-N`);
    const latest = starts.at(-1)!;
    if (!judgedStart(ledger, latest, folders)) continue;
    if (latest.purpose !== expect.purpose || latest.basis !== expect.basis)
      fail(latest.purpose === 'held-out' ? 'round_redeclared' : 'best_of_n', `${label}: the latest judged run of ${taskOfRun(latest.run)} for ${latest.model ?? 'an unknown model'} (bench folder ${latest.bench}) is a ${latest.purpose} run ${latest.purpose === 'held-out' ? 'of another declaration' : 'on this round\'s instance'}, not one of this round's`);
    if (!given.some(source => source.bench === latest.bench && source.report.runs.some(run => run.id === latest.run)))
      fail('run_not_given', `${label}: the latest run of ${taskOfRun(latest.run)} for ${latest.model ?? 'an unknown model'} (bench folder ${latest.bench}) was judged but not given to the gate`);
  }
}

/** Runs outside the ledger anywhere in the bench roots refuse the round (PADR-0042 amended, 3.1). */
export function checkOutside(outside: ReadonlyArray<{ bench: string; run: string }>): void {
  if (outside.length) fail('run_outside_ledger', `${outside.length} model run folder${outside.length === 1 ? '' : 's'} of this round's tasks hold${outside.length === 1 ? 's' : ''} no start entry in the release ledger (first: ${outside[0]!.run} in bench folder ${outside[0]!.bench}); every model run takes its entry before its client starts`);
}
export interface RoundInput {
  plan: Plan; probe: ProbeRecord; declaration: Declaration;
  /** The commits that hold the plan, the pre-probe record and the declaration, and every version of the declaration. */
  git?: { declaration: string; versions: ReadonlyArray<{ commit: string; date: string }> };
  /** The pre-probe set's content hash, the held-out tasks and seeds regenerated from the declaration,
   * and the held-out world's content hash. */
  probeWorld: string; tasks: readonly string[]; seeds: readonly number[]; worldContentHash: string;
  development: readonly GateReport[]; oracle: readonly GateReport[]; random: readonly GateReport[];
  /** Near misses judged by the separate checker: how many, how many passed (must be 0), per instance. */
  nearMisses: { total: number; passed: number; perInstance: readonly number[] };
  ledger: LedgerInput;
  /** Model-run folders of the round's tasks in the bench roots that hold no start entry. */
  outside: ReadonlyArray<{ bench: string; run: string }>;
  /** The run folders of the round's start entries without a run-end record (judged, unjudged, missing). */
  folders: Folders;
  /** Round 2: the first round's held-out seeds. */
  previousSeeds?: readonly number[];
}
export interface GateInput extends RoundInput { ladder: readonly GateReport[] }
export interface Criterion { name: string; value: string; rule: string; met: boolean }
interface RoundFacts {
  schema: typeof GATE_SCHEMA; release: string; unit: string; family: string; toolchain: Plan['toolchain']; round: number; alpha: number; shape: 'B';
  generator: { id: string; version: string }; difficulty: string; seeds: { low: number; high: number };
  plan: { sha256: string; commit: string }; probe: { probe: number; passed: number; instances: number; record: { sha256: string; commit: string } };
  declaration: { sha256: string; commit: string | null; versions: Array<{ commit: string; date: string }> };
  world: { id: string; version: string; contentHash: string }; instances: number;
  settings: Plan['bench']; dates: string[];
  ladder: Array<{ preset: string; model: string; billing: string }>; pair: { strongest: string; weakest: string };
  /** Model runs of the round from the ledger — every start on its instances, whatever its purpose,
   * plan or declaration: counted against its 100, those exempt (listed, not counted), and how many of
   * the counted ones were made under another plan, declaration or purpose. */
  spend: { preProbe: number; heldOut: number; total: number; exempt: number; planned: number; other: number };
  /** The release ledger: its count against the cap, and every committed version of it. */
  ledger: { counted: number; cap: number; records: number; versions: Array<{ commit: string; date: string; records: number }> };
  /** Built-in runs of the round: listed, never counted. */
  builtin: { oracle: number; random: number };
  /** Client versions of the round's model runs, per client, with the agents that ran on each. */
  clientVersions: Array<{ client: string; version: string; agents: string[] }>;
  previous: { round: number; low: number; high: number } | null;
}
export interface GateResult extends RoundFacts {
  agents: AgentResult[]; strongest: AgentResult; weakest: AgentResult;
  discordant: { strongestOnly: number; weakestOnly: number; p: number };
  infraShare: number; ladderRuns: number; power: number;
  criteria: Criterion[]; verdict: 'passes' | 'does not pass' | 'void'; voidReason: 'infrastructure' | 'budget' | null; ladderLabel: string;
}
export interface PreflightResult extends RoundFacts { oracle: AgentResult; random: AgentResult; nearMisses: { total: number; passed: number }; ladderRunsSpent: number }

/** Everything the preflight and the gate check, and the facts they report. */
function checkRound(input: RoundInput, ladder: readonly GateReport[] | null): { facts: RoundFacts; plan: string[]; oracle: AgentResult; random: AgentResult; bound: Map<string, Bound> } {
  const { declaration, plan: probePlan, probe } = input, family = declaration.unit.split('.')[0]!;
  const planHash = fileHash(probePlan), declHash = declarationHash(declaration), ledger = input.ledger.ledger;
  // The declaration follows from this plan and record, and repeats the plan's values.
  if (declaration.probe.plan.sha256 !== planHash || declaration.probe.record.sha256 !== fileHash(probe) || probe.plan.sha256 !== planHash) fail('round_files_mismatch', 'the declaration does not follow from this probe plan and pre-probe record');
  if (declaration.unit !== probePlan.unit || declaration.round !== probePlan.round || declaration.probe.probe !== probePlan.probe || !isDeepStrictEqual(declaration.toolchain, probePlan.toolchain) || !isDeepStrictEqual(declaration.bench, probePlan.bench)
    || !isDeepStrictEqual(declaration.generator, probePlan.generator) || declaration.difficulty !== probePlan.difficulty || !isDeepStrictEqual(declaration.development.seeds, probePlan.seeds) || declaration.development.world.contentHash !== input.probeWorld)
    fail('round_files_mismatch', 'the declaration does not repeat its probe plan (unit, round, toolchain, generator, difficulty, seeds, settings, pre-probe world)');
  if (declaration.alpha !== ALPHA[declaration.round]) fail('alpha_invalid', `round ${declaration.round} decides at α = ${ALPHA[declaration.round]}`);
  // The ledger the pre-probe record and the declaration counted is a prefix of the one gated now.
  const lines = ledger.text.slice(0, -1).split('\n');
  for (const [label, at] of [['pre-probe record', probe.ledger], ['declaration', declaration.budget.ledger]] as const)
    if (at.records > lines.length || sha256Hex(lines[at.records - 1]!) !== at.head) fail('ledger_rewritten', `the release ledger the ${label} counted (${at.records} records) is not a prefix of the pushed one`);
  // The ledger registered the admission and the declaration; a held-out run of another declaration of
  // this round refuses it (a re-declaration after held-out runs started, PADR-0042 amended).
  const events = roundEvents(ledger, declaration.unit, declaration.round);
  const admission = events.find(event => event.event === 'admitted' && event.record === fileHash(probe) && event.plan === planHash);
  if (!admission) fail('probe_unrecorded', 'the release ledger holds no admission of this pre-probe record (`probe` registers it)');
  if (!events.some(event => event.event === 'declared' && event.declaration === declHash && event.world === input.worldContentHash)) fail('declaration_unrecorded', 'the release ledger holds no registration of this declaration and its held-out world (`declare` registers it)');
  const members = roundStarts(ledger, declaration.unit, declaration.round);
  const redeclared = members.find(start => start.purpose === 'held-out' && start.basis !== declHash);
  if (redeclared) fail('round_redeclared', `${declaration.unit} round ${declaration.round} has a held-out run under another declaration (start entry ${redeclared.seq}, ${redeclared.run}); a round is not declared again once its held-out runs started`);
  // Funding, re-derived from the ledger as the declaration counted it (PADR-0042 decision 8 as amended).
  const counted = prefixOf(ledger, declaration.budget.ledger.records);
  const funding = counted ? fundingAt(counted, declaration.unit, declaration.round, admission!.seq) : null;
  if (!funding || funding.before !== declaration.budget.before || funding.reserved !== declaration.budget.reserved)
    fail('budget_mismatch', `the declaration's budget (${declaration.budget.before} counted, ${declaration.budget.reserved} reserved) is not what the release ledger it counted gives (${funding ? `${funding.before}, ${funding.reserved}` : 'no such prefix'})`);
  // Every earlier round's held-out instances are other instances (PADR-0042 decision 11).
  if (declaration.round > 1 && !input.previousSeeds?.length) fail('previous_round', `round ${declaration.round} needs the first round's declaration`);
  if (input.previousSeeds?.some(seed => input.seeds.includes(seed))) fail('heldout_overlap', 'this round reuses held-out instances of the first round');
  // The planned instances: the distinct regenerated tasks, one run each.
  const plan = [...input.tasks];
  if (plan.length !== declaration.heldOut.instances || new Set(plan).size !== plan.length || input.seeds.length !== plan.length || plan.some((task, index) => task !== taskIdOf(family as Family, input.seeds[index]!)))
    fail('set_mismatch', `the held-out set is not the ${declaration.heldOut.instances} distinct instances the declaration derives`);
  checkOutside(input.outside);
  // The pre-probe: the declared one, from the pushed ledger.
  const pre = probeRuns({ plan: probePlan, planHash, worldContentHash: input.probeWorld, reports: input.development, ledger, folders: input.folders });
  if (pre.digest !== declaration.development.digest || pre.digest !== probe.digest) fail('development_mismatch', 'the pre-probe runs are not the ones the declaration digests');
  if (!isDeepStrictEqual(pre.outcomes.map(entry => entry.pass), declaration.development.passed)) fail('development_mismatch', 'the pre-probe outcomes differ from the declaration');
  // Baselines: free, so an infra_error or a missing run is rerun, never counted.
  const tasks = plan, base = { mirror: declaration.bench.mirror, timeoutSeconds: declaration.bench.timeoutSeconds, maxActions: declaration.bench.maxActions, checks: declaration.bench.checks };
  const baseline = (reports: readonly GateReport[], name: 'oracle' | 'random'): AgentResult => {
    if (!reports.length) fail('baseline_missing', `no ${name} report`);
    for (const source of reports) {
      if (source.report.agent.kind !== 'builtin' || source.report.agent.name !== name) fail('baseline_mismatch', `a ${name} report is not from the ${name} agent`);
      checkSettings(name, source.report, input.worldContentHash, tasks, base, declaration.toolchain);
    }
    const merged = mergeAgentRuns(reports, name);
    const broken = plan.filter(task => !merged.has(task) || merged.get(task)!.run.status === 'infra_error');
    if (broken.length) fail('baseline_incomplete', `the ${name} baseline has no judged run for ${broken.length} instance${broken.length === 1 ? '' : 's'} (${broken.slice(0, 3).join(', ')}${broken.length > 3 ? ', …' : ''}); bench them again (--tasks), the baselines cost no model run`);
    return agentResult(name, name, null, plan, task => merged.get(task)!.run.pass ? 'passed' : 'failed', reports.length);
  };
  const oracle = baseline(input.oracle, 'oracle'), random = baseline(input.random, 'random');
  // Every instance is a generated task of the declared generator and seed.
  const generated = new Map(input.oracle[0]!.report.environment.world.generated.map(entry => [entry.taskId, entry]));
  for (const [index, task] of plan.entries()) {
    const by = generated.get(task);
    if (!by || by.id !== generatorId(family as Family) || by.version !== declaration.generator.version || by.seed !== input.seeds[index]) fail('set_mismatch', `task ${task} was not made by ${generatorId(family as Family)} ${declaration.generator.version} from its declared seed`);
  }
  if (input.nearMisses.perInstance.length !== plan.length || input.nearMisses.perInstance.some(count => count < 1)) fail('near_misses_missing', 'every held-out instance needs its near misses (at least one each)');
  // The ladder's reports: declared agents on the declared set and settings, bound to the ledger.
  const heldOut: Expect = { purpose: 'held-out', unit: declaration.unit, round: declaration.round, basis: declHash, toolchain: declaration.toolchain.id, rules: declaration.toolchain.rules };
  const bound = new Map<string, Bound>();
  for (const source of ladder ?? []) {
    const agent = declaration.ladder.find(entry => entry.model === source.report.agent.requestedModel.value);
    if (!agent) fail('ladder_model_mismatch', `a held-out report requested ${source.report.agent.requestedModel.value ?? 'no model'}, which is not a declared ladder model`);
    checkSettings(agent!.model, source.report, input.worldContentHash, tasks, base, declaration.toolchain);
    checkAgent(agent!.model, source, agent!);
    for (const run of source.report.runs) bound.set(runKey(source.bench, run.id), bindRun(ledger, source, run, heldOut));
  }
  // Every run of the round on a held-out instance, under any purpose or declaration, in one repeat check.
  if (ladder) repeatCheck(ledger, members, new Set(plan), heldOut, ladder, input.folders, 'held-out');
  // One prompt per unit; per client one key source, one kept environment and one release line.
  const external = [...input.development, ...(ladder ?? [])];
  if (new Set(external.map(source => source.report.settings.prompt)).size > 1) fail('prompt_differs', 'the pre-probe and ladder reports differ in their prompt (one prompt per unit, PADR-0042 decision 12)');
  const clientOf = (source: GateReport): string => source.report.agent.client.value ?? source.report.agent.name;
  for (const client of new Set(external.map(clientOf))) {
    const group = external.filter(source => clientOf(source) === client);
    if (new Set(group.map(source => String(source.report.agent.apiKeySource))).size > 1) fail('api_key_source_differs', `the ${client} reports differ in their API key source (one per client, PADR-0042 decision 12)`);
    if (new Set(group.map(source => source.report.agent.keptEnv.join(','))).size > 1) fail('settings_mismatch', `the ${client} reports differ in their kept environment`);
  }
  // Clients pinned per round: a patch update is listed, another minor or major version refuses.
  const clientRuns = external.flatMap(source => source.report.runs.flatMap(run => run.client && source.rederived.has(run.id) ? [{ client: clientOf(source), agent: input.development.includes(source) ? `pre-probe ${source.report.agent.requestedModel.value ?? 'none'}` : source.report.agent.requestedModel.value ?? 'none', version: run.client.version ?? null }] : []));
  for (const client of new Set(clientRuns.map(entry => entry.client))) {
    const lines = new Set(clientRuns.filter(entry => entry.client === client).map(entry => entry.version === null ? null : releaseLine(entry.version)));
    if (lines.size > 1) fail('client_version_line', `the round's ${client} runs report different release lines (${[...new Set(clientRuns.filter(entry => entry.client === client).map(entry => entry.version ?? 'none'))].join(', ')}); a patch update is listed, another minor or major version refuses the round (PADR-0042 decision 12)`);
  }
  const clientVersions = [...new Set(clientRuns.flatMap(entry => entry.version === null ? [] : [`${entry.client}\u0000${entry.version}`]))].map(key => key.split('\u0000') as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]) || compareVersions(a[1], b[1]))
    .map(([client, version]) => ({ client, version, agents: [...new Set(clientRuns.filter(entry => entry.client === client && entry.version === version).map(entry => entry.agent))] }));
  // Spend from the ledger: every start of the round — its pre-probes (also under an earlier plan) and
  // every run on its held-out instances, whatever the purpose or declaration — less released ones; an
  // exemption the ledger states is taken for a run the gate was given only when the gate re-derives it.
  const given = new Map<string, { run: SessionRunV3; source: GateReport }>();
  for (const source of [...input.development, ...(ladder ?? [])]) for (const run of source.report.runs) given.set(runKey(source.bench, run.id), { run, source });
  const spend = { preProbe: 0, heldOut: 0, total: 0, exempt: 0, planned: SHAPE_B.preProbe + heldOutRuns(declaration), other: 0 };
  const heldTasks = new Set(plan);
  for (const record of members) {
    const why = released(record, ledger.ends.get(record.seq)), seen = given.get(runKey(record.bench, record.run));
    if (why === 'local' || (why === 'exempt' && (!seen || exemptRun(seen.run, seen.source)))) { spend.exempt++; continue; }
    if (heldTasks.has(taskOfRun(record.run))) spend.heldOut++; else spend.preProbe++;
    if (!((record.purpose === 'pre-probe' && record.basis === planHash) || (record.purpose === 'held-out' && record.basis === declHash))) spend.other++;
  }
  spend.total = spend.preProbe + spend.heldOut;
  const releaseCount = countLedger(ledger).counted;
  const reports = [...input.development, ...input.oracle, ...input.random, ...(ladder ?? [])].map(source => source.report), first = input.oracle[0]!.report;
  const facts: RoundFacts = {
    schema: GATE_SCHEMA, release: declaration.release, unit: declaration.unit, family, toolchain: declaration.toolchain, round: declaration.round, alpha: declaration.alpha, shape: 'B',
    generator: declaration.generator, difficulty: declaration.difficulty, seeds: { low: Math.min(...input.seeds), high: Math.max(...input.seeds) },
    plan: declaration.probe.plan, probe: { probe: declaration.probe.probe, passed: declaration.probe.passed, instances: declaration.probe.instances, record: declaration.probe.record },
    declaration: { sha256: declHash, commit: input.git?.declaration ?? null, versions: [...(input.git?.versions ?? [])] },
    world: { id: first.environment.world.worldId, version: first.environment.world.version, contentHash: first.environment.world.contentHash }, instances: plan.length,
    settings: declaration.bench, dates: [...new Set(reports.map(report => report.createdAt.slice(0, 10)))].sort(),
    ladder: declaration.ladder.map(agent => ({ preset: agent.preset, model: agent.model, billing: agent.billing })), pair: { ...declaration.pair },
    spend, ledger: { counted: releaseCount, cap: RELEASE_CAP, records: ledger.records.length, versions: [...input.ledger.versions] },
    builtin: { oracle: input.oracle.reduce((total, source) => total + source.report.runs.length, 0), random: input.random.reduce((total, source) => total + source.report.runs.length, 0) },
    clientVersions, previous: input.previousSeeds?.length ? { round: 1, low: Math.min(...input.previousSeeds), high: Math.max(...input.previousSeeds) } : null,
  };
  void bound;
  return { facts, plan, oracle, random, bound };
}

/** Before any ladder run: the declaration's set, the pre-probe runs, both baselines, the near misses,
 * the settings and the ledger, with the reasons the round could not pass named. */
export function preflightGate(input: RoundInput): PreflightResult {
  const { facts, oracle, random } = checkRound(input, null);
  const problems = [
    ...(oracle.passed < oracle.instances ? [`the oracle passes ${oracle.passed} of ${oracle.instances} instances (every one must pass)`] : []),
    ...(random.rate > GATE.maxRandom ? [`random passes ${random.passed} of ${random.instances} instances (at most 5 %)`] : []),
    ...(input.nearMisses.passed ? [`${input.nearMisses.passed} near misses pass the checker`] : []),
  ];
  if (problems.length) fail('preflight_refused', `the round cannot pass: ${problems.join('; ')}. Do not start the ladder.`);
  return { ...facts, oracle, random, nearMisses: { total: input.nearMisses.total, passed: input.nearMisses.passed }, ladderRunsSpent: facts.spend.heldOut };
}

export function computeGate(input: GateInput): GateResult {
  const { facts, plan, oracle, random, bound } = checkRound(input, input.ladder);
  const declaration = input.declaration;
  // Each declared agent's held-out runs, resumed reports merged; a run without its run-end record, an
  // infra_error, a missing run and a run whose client did not attest the declared model are not passed.
  const ladder = declaration.ladder.map(agent => {
    const group = input.ladder.filter(source => source.report.agent.requestedModel.value === agent.model);
    if (!group.length) fail('ladder_missing', `no held-out report of ${agent.model}`);
    const recorded = (source: GateReport, run: SessionRunV3): boolean => bound.get(runKey(source.bench, run.id))!.end !== null;
    const merged = mergeAgentRuns(group, agent.model);
    for (const { run, source } of merged.values()) {
      // A run whose re-derived client names another model refuses the round (PADR-0040, review S3).
      if (source.rederived.has(run.id) && run.client?.model && run.client.model !== agent.model) fail('run_on_other_model', `run ${run.id} of ${agent.model} ran on ${run.client.model}`);
    }
    return agentResult('ladder', agent.preset, agent.model, plan, task => {
      const entry = merged.get(task);
      if (!entry) return 'missing';
      if (!recorded(entry.source, entry.run)) return 'unrecorded';
      if (entry.run.status === 'infra_error') return 'infra_error';
      if (!attests(entry.source, entry.run, agent.model)) return 'unattested';
      return entry.run.pass ? 'passed' : 'failed';
    }, group.length);
  });
  const strongest = ladder[0]!, weakest = ladder.at(-1)!;
  // Discrimination counts a non-run against passing (PADR-0042 amended): an instance the weakest did not
  // run, or ran without an attested, recorded verdict, counts as passed by the weakest; such an
  // instance of the strongest as failed. Leaving out a weakest run never makes a discordant pair.
  const nonRun = (outcome: Outcome): boolean => outcome !== 'passed' && outcome !== 'failed';
  const s = new Set(strongest.outcomes.filter(entry => entry.outcome === 'passed').map(entry => entry.taskId));
  const w = new Set(weakest.outcomes.filter(entry => entry.outcome === 'passed' || nonRun(entry.outcome)).map(entry => entry.taskId));
  const strongestOnly = plan.filter(task => s.has(task) && !w.has(task)).length, weakestOnly = plan.filter(task => w.has(task) && !s.has(task)).length;
  const { p } = mcnemarExact(strongestOnly, weakestOnly);
  // The void rule over the gate pair and the declared ladder agents (PADR-0042 decision 10).
  const ladderRuns = ladder.length * plan.length;
  const infraShare = ladder.reduce((total, agent) => total + agent.infraErrors + agent.missing + agent.unattested + agent.unrecorded, 0) / ladderRuns;
  const weakNonRuns = weakest.outcomes.filter(entry => nonRun(entry.outcome)).length;
  const difference = (s.size - w.size) / plan.length, share = (value: number): string => `${(value * 100).toFixed(1)} %`;
  const criteria: Criterion[] = [
    { name: 'headroom', value: `${strongest.passed}/${plan.length} (${share(strongest.rate)})`, rule: 'strongest passes 10 %–80 % of the instances', met: strongest.rate >= GATE.headroomLow && strongest.rate <= GATE.headroomHigh },
    { name: 'difference', value: `${(difference * 100).toFixed(1)} points${weakNonRuns ? ` (${weakNonRuns} instance${weakNonRuns === 1 ? '' : 's'} the weakest did not run counted as passed)` : ''}`, rule: 'strongest − weakest ≥ 20 points; a non-run counts against passing', met: difference >= GATE.minDifference - 1e-12 },
    { name: 'mcnemar', value: `b = ${strongestOnly}, c = ${weakestOnly}, p = ${p.toFixed(4)}`, rule: `exact McNemar on discordant instances, p < ${declaration.alpha}${declaration.round > 1 ? ' (second round)' : ''}`, met: p < declaration.alpha },
    { name: 'oracle', value: `${oracle.passed}/${plan.length}`, rule: 'oracle passes 100 %', met: oracle.passed === plan.length },
    { name: 'random', value: `${random.passed}/${plan.length} (${share(random.rate)})`, rule: 'random passes ≤ 5 %', met: random.rate <= GATE.maxRandom },
    { name: 'near-misses', value: `${input.nearMisses.total - input.nearMisses.passed}/${input.nearMisses.total} fail`, rule: 'every near miss fails', met: input.nearMisses.total > 0 && input.nearMisses.passed === 0 },
    { name: 'infrastructure', value: `${share(infraShare)} of ${ladderRuns} ladder runs`, rule: 'infra_error, missing, unattested or unrecorded runs of the pair and the ladder ≤ 5 %, else the round is void', met: infraShare <= GATE.maxInfraShare },
    { name: 'budget', value: `${facts.spend.total} model runs counted (${facts.spend.heldOut} held-out + ${facts.spend.preProbe} pre-probe${facts.spend.other ? `; ${facts.spend.other} of them under another plan, declaration or purpose` : ''})${facts.spend.exempt ? `, ${facts.spend.exempt} refused by the client before model work not counted` : ''}; release ${facts.ledger.counted} of ${facts.ledger.cap}`, rule: '≤ 100 model runs per unit and round, else the round is void; ≤ the release cap', met: facts.spend.total <= GATE.maxRunsPerRound && facts.ledger.counted <= facts.ledger.cap },
  ];
  // A round is void, never "does not pass", when its infrastructure or its spend failed it.
  const voidReason = !criteria.find(c => c.name === 'infrastructure')!.met ? 'infrastructure' as const : !criteria.find(c => c.name === 'budget')!.met ? 'budget' as const : null;
  const verdict = voidReason ? 'void' : criteria.every(c => c.met) ? 'passes' : 'does not pass';
  return {
    ...facts, agents: [oracle, random, ...ladder], strongest, weakest, discordant: { strongestOnly, weakestOnly, p }, infraShare, ladderRuns,
    power: mcnemarPower(plan.length, GATE.minDifference, 0, declaration.alpha), criteria, verdict, voidReason, ladderLabel: 'ladder: Claude models only',
  };
}

const cell = (value: string): string => value.replace(/[|\\`*_[\]<>]/g, character => `\\${character}`);
const fixed = (value: number): string => value.toFixed(3);

/** The gate report as Markdown: every number the verdict uses; names and models escaped. */
export function renderGate(result: GateResult): string {
  const lines: string[] = [];
  lines.push(`# Gate: ${result.unit}, round ${result.round}`, '');
  const verdict = result.verdict === 'passes' ? `the unit passes round ${result.round}` : result.verdict === 'void' ? (result.voidReason === 'budget' ? 'the round is void (more than 100 model runs counted in the round)' : 'the round is void (more than 5 % infrastructure errors, missing, unattested or unrecorded runs)') : `the unit does not pass round ${result.round}`;
  lines.push(`**Verdict: ${verdict}.** ${result.ladderLabel}.`, '');
  lines.push(`Preregistered in [PADR-0040](../../../adr/0040-challenge-tier-generated-families-and-gate.md) as [PADR-0042](../../../adr/0042-gate-for-families-on-toolchains.md) amends it (shape B), and in this round's committed probe plan and declaration. Every number below is computed by \`node tools/challenge.ts gate\` from them, the pushed release ledger and the \`practonaut.bench/3\` reports of the pre-probe and the held-out round (each validated and re-verified, resumed benches merged), on a held-out set regenerated from the declaration. The same numbers are in \`${cell(result.unit)}-round${result.round}.gate.json\`.`, '');
  lines.push('## Round', '');
  lines.push('| Fact | Value |', '|---|---|');
  lines.push(`| Unit | \`${cell(result.unit)}\`: family \`${cell(result.family)}\` on toolchain \`${cell(result.toolchain.id)}\` (${result.toolchain.level} level, Practonaut ${cell(result.toolchain.practonaut)}) |`);
  lines.push(`| Probe plan and pre-probe | probe ${result.probe.probe}, plan \`${result.plan.sha256.slice(0, 16)}…\` (commit \`${result.plan.commit.slice(0, 12)}\`); Opus passed ${result.probe.passed} of ${result.probe.instances} (admitted at ${SHAPE_B.admitLow}–${SHAPE_B.admitHigh}) |`);
  lines.push(`| Declaration | \`${cell(result.unit)}-round-${result.round}.declaration.json\`, canonical SHA-256 \`${result.declaration.sha256.slice(0, 16)}…\`${result.declaration.commit ? `, held-out set generated from commit \`${result.declaration.commit.slice(0, 12)}\`` : ''} |`);
  lines.push(`| Generator | \`${cell(result.generator.id)}\` ${cell(result.generator.version)}, difficulty ${cell(result.difficulty)} |`);
  lines.push(`| Held-out instances | ${result.instances} (generator seeds ${result.seeds.low}–${result.seeds.high}, derived from the pre-probe runs; one counted run per agent per instance)${result.previous ? `; round ${result.previous.round} used seeds ${result.previous.low}–${result.previous.high}` : ''} |`);
  lines.push(`| World | \`${cell(result.world.id)}\` ${cell(result.world.version)}, content hash \`${result.world.contentHash.slice(0, 16)}…\` |`);
  lines.push(`| Settings | mirror ${cell(result.settings.mirror)}, timeout ${result.settings.timeoutSeconds} s, at most ${result.settings.maxActions} act/undo/reset calls${result.settings.checks === null ? '' : `, --checks ${result.settings.checks}`}; reports dated ${result.dates.join(', ')} |`);
  if (result.clientVersions.length) lines.push(`| Clients | ${result.clientVersions.map(entry => `${cell(entry.client)} ${cell(entry.version)} (${entry.agents.map(cell).join(', ')})`).join('; ')}${result.clientVersions.length > 1 ? ' — a patch update during the round is listed, not refused' : ''} |`);
  lines.push(`| Ladder | ${result.ladder.map(agent => `\`${cell(agent.model)}\` through ${cell(agent.preset)} (billing ${cell(agent.billing)})`).join(', ')}; shape B |`);
  lines.push(`| Gate pair | strongest \`${cell(result.pair.strongest)}\`, weakest \`${cell(result.pair.weakest)}\` (fixed by the capability order, models attested by the client) |`);
  lines.push(`| Decision level | α = ${result.alpha}${result.round > 1 ? ' (second round: with the first at 0.05, the false-pass bound over both rounds is 0.075)' : ''} |`, '');
  if (result.declaration.versions.length) {
    lines.push('## Declaration history', '', 'Every version of the declaration file in git, newest first; the gated declaration is the one the held-out set was generated from.', '');
    for (const version of result.declaration.versions) lines.push(`- \`${version.commit.slice(0, 12)}\` ${cell(version.date)}${version.commit === result.declaration.commit ? ' — the held-out set was generated from this version' : ''}`);
    lines.push('');
  }
  lines.push('## Release ledger', '', `Every committed version of \`release-ledger.jsonl\`, newest first; each is a prefix of the current one (${result.ledger.records} records). The release counts ${result.ledger.counted} of its ${result.ledger.cap} model runs.`, '');
  for (const version of result.ledger.versions) lines.push(`- \`${version.commit.slice(0, 12)}\` ${cell(version.date)}: ${version.records} records`);
  lines.push('');
  lines.push('## Agents', '');
  lines.push('| Agent | Model (requested, attested) | Passed | Rate | 95 % Wilson interval | infra_error | Missing | Unattested | Unrecorded | Reports |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const agent of result.agents) lines.push(`| ${agent.role} (${cell(agent.name)}) | ${agent.model === null ? '—' : `\`${cell(agent.model)}\``} | ${agent.passed}/${agent.instances} | ${fixed(agent.rate)} | ${fixed(agent.interval.low)}–${fixed(agent.interval.high)} | ${agent.infraErrors} | ${agent.missing} | ${agent.unattested} | ${agent.unrecorded} | ${agent.reports} |`);
  lines.push('');
  lines.push('## Criteria', '');
  lines.push('| Criterion | Value | Rule | Met |', '|---|---|---|---|');
  for (const criterion of result.criteria) lines.push(`| ${criterion.name} | ${cell(criterion.value)} | ${cell(criterion.rule)} | ${criterion.met ? 'yes' : 'no'} |`);
  lines.push('');
  lines.push(`Discordant instances: the strongest passed and the weakest failed on ${result.discordant.strongestOnly}, the reverse on ${result.discordant.weakestOnly}; two-sided exact McNemar p = ${result.discordant.p.toFixed(4)}.`);
  lines.push(`Model runs of this round, from the release ledger (every start on its instances, whatever its purpose, plan or declaration): ${result.spend.preProbe} pre-probe and ${result.spend.heldOut} held-out runs counted (${result.spend.planned} planned)${result.spend.other ? `, ${result.spend.other} of them under another plan, declaration or purpose` : ''}${result.spend.exempt ? `; ${result.spend.exempt} runs the client refused before any model work (a usage limit, a login) are listed and not counted` : ''}. Built-in runs, listed and not counted: oracle ${result.builtin.oracle}, random ${result.builtin.random}.`);
  lines.push(`Power at this size: if the two agents disagreed on 20 % of the instances, all in the stronger one's favour, the exact McNemar test would reach p < ${result.alpha} with probability ${result.power.toFixed(2)}; "does not pass" on discrimination is not evidence that the agents are equal.`);
  if (result.verdict !== 'passes') lines.push(result.round < 2 ? 'A second round, if the budget funds it, uses new held-out instances and decides at α = 0.025.' : 'This was the unit\'s second round; a unit has at most two.');
  lines.push('');
  return lines.join('\n') + '\n';
}

/** The preflight's findings, one line each, for the terminal. */
export function renderPreflight(result: PreflightResult): string {
  return [
    `${result.unit} round ${result.round}: preflight passed — the ladder may start.`,
    `declaration ${result.declaration.sha256.slice(0, 16)}…; held-out seeds ${result.seeds.low}–${result.seeds.high}; world ${result.world.id} ${result.world.contentHash.slice(0, 16)}…`,
    `settings: mirror ${result.settings.mirror}, timeout ${result.settings.timeoutSeconds} s, --max-actions ${result.settings.maxActions}${result.settings.checks === null ? '' : `, --checks ${result.settings.checks}`}`,
    `oracle ${result.oracle.passed}/${result.oracle.instances}, random ${result.random.passed}/${result.random.instances}, near misses failing ${result.nearMisses.total - result.nearMisses.passed}/${result.nearMisses.total}`,
    `pre-probe: Opus ${result.probe.passed}/${result.probe.instances}; gate pair ${result.pair.strongest} vs ${result.pair.weakest}`,
    `model runs of this round so far: ${result.spend.preProbe} pre-probe, ${result.ladderRunsSpent} held-out (${result.spend.planned} planned); release ${result.ledger.counted} of ${result.ledger.cap}`,
  ].join('\n') + '\n';
}

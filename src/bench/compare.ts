/**
 * `practonaut compare a.json b.json`: two validated bench reports, `a` the baseline and `b` the
 * candidate, read through the view (any version), compared by the rules of PADR-0039 C and
 * PADR-0044 decision 3. Pure: no I/O, no clock.
 *
 * 1. Comparable or refused: the same verdict level (runs of different levels are never paired,
 *    PADR-0043 decision 1); the same world content, grid (tasks and seeds), mirror, action budget,
 *    check limit and isolation level; otherwise every difference is named. Two reports of different
 *    worlds whose applications or toolchains differ and that both list task identities are paired by
 *    identity instead of refused (below); a regression gate (`--fail-on-regression`) still refuses
 *    them, and refuses two artifact reports read under different reading-rules versions.
 * 2. Within one world the unit is the distinct instance (task × seed). Its repeats aggregate to one
 *    outcome per side: a pass when at least half of all its repeats passed, an unjudged repeat counting
 *    as not passed. An instance missing on a side is listed and left out.
 * 3. An instance regression has at least three judged repeats on each side, every judged baseline
 *    repeat passed and every judged candidate repeat failed (the mirror image is a fix). With fewer
 *    than three repeats on a side a flip is a single run, never a regression; with three or more a
 *    changed outcome that is not unanimous among judged runs (or rests on runs that were not judged)
 *    is named as changed, never a regression. Every flip is one of McNemar's discordant instances.
 * 4. A rate claim needs the exact two-sided McNemar test on the discordant instances at α = 0.05;
 *    otherwise the verdict is "not distinguishable at this n".
 * 5. Across worlds (identity pairing) the unit is the distinct task identity: every run of one identity
 *    on a side is a repeat of it, whatever its task id, seed or repeat (an amendment of PADR-0039 C.2
 *    for this case only). An identity on one side only is listed as not compared. Rate claims use only
 *    the paired identities with the same number of runs on both sides; the others are listed with both
 *    counts. Flips are differences between the two configurations, never regressions or fixes.
 */
import { BENCH_SCHEMA_V3, ISOLATION_OF } from './report.ts';
import { isolationBasis, isolationOfView, type BenchReportView, type ViewRun } from './view.ts';
import { aggregateInstance, ALPHA, isInstanceFix, isInstanceRegression, mcnemarExact, REGRESSION_REPEATS, wilson, type InstanceAggregate } from './stats.ts';
import type { IsolationLevel } from './report.ts';

export type ComparableField = 'verdictLevel' | 'world' | 'grid' | 'mirror' | 'budget' | 'checks' | 'isolation' | 'rules';
export interface Difference { field: ComparableField; baseline: string; candidate: string }
export type CaveatField = 'timeout' | 'repeats' | 'practonaut' | 'reportVersion' | 'isolationBasis' | 'toolchain' | 'rules' | 'clientVersion' | 'clientSettings' | 'sharedIdentities' | 'runCounts' | 'identityPairing';
export interface Caveat { field: CaveatField; baseline: string; candidate: string }

export class CompareError extends Error {
  readonly code = 'compare_incomparable';
  readonly differences: Difference[];
  constructor(differences: Difference[]) { super(`reports are not comparable: ${differences.map(difference => difference.field).join(', ')}`); this.name = 'CompareError'; this.differences = differences; }
}

/** What Practonaut restricted about the agent's tools; a /1 report did not record it, but it follows
 * from the agent kind (PADR-0036). */
export function isolationOf(report: BenchReportView): IsolationLevel { return isolationOfView(report); }
export function worldHashOf(report: BenchReportView): string { return report.environment.world.contentHash; }
const worldName = (report: BenchReportView): string => `${report.environment.world.worldId} ${report.environment.world.version} (${report.environment.world.contentHash.slice(0, 12)})`;
const sorted = <T extends string | number>(values: readonly T[]): T[] => [...values].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
const sameSet = <T extends string | number>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && sorted(a).every((value, index) => value === sorted(b)[index]);
const toolchainId = (report: BenchReportView): string => report.toolchain.id;
const rulesOf = (report: BenchReportView): string | null => report.toolchain.kind === 'foreign-mcp' ? `${report.toolchain.rules.format} ${report.toolchain.rules.version}` : null;

/** Two reports of different worlds are paired by task identity when they are at one verdict level, both
 * list identities, and their applications or their toolchains differ (PADR-0044 decision 3). */
export function identityPaired(baseline: BenchReportView, candidate: BenchReportView): boolean {
  return worldHashOf(baseline) !== worldHashOf(candidate) && baseline.verdictLevel === candidate.verdictLevel && baseline.instances !== null && candidate.instances !== null
    && (baseline.environment.app.adapterId !== candidate.environment.app.adapterId || toolchainId(baseline) !== toolchainId(candidate));
}

export interface CompareOptions { /** `--fail-on-regression`: a regression gate compares one world with itself, under one reading of results. */ regressionGate?: boolean }

/** Every comparability rule a pair of reports breaks (empty: comparable). */
export function differences(baseline: BenchReportView, candidate: BenchReportView, options: CompareOptions = {}): Difference[] {
  const found: Difference[] = [];
  // Runs of different verdict levels are never paired (PADR-0043 decision 1): nothing else is compared.
  if (baseline.verdictLevel !== candidate.verdictLevel) return [{ field: 'verdictLevel', baseline: baseline.verdictLevel, candidate: candidate.verdictLevel }];
  const byIdentity = identityPaired(baseline, candidate);
  if (worldHashOf(baseline) !== worldHashOf(candidate) && (!byIdentity || options.regressionGate)) found.push({ field: 'world', baseline: worldName(baseline), candidate: worldName(candidate) });
  if (!byIdentity && (!sameSet(baseline.settings.tasks, candidate.settings.tasks) || !sameSet(baseline.settings.seeds, candidate.settings.seeds))) {
    const grid = (report: BenchReportView): string => `${sorted(report.settings.tasks).join(', ')} × ${report.settings.seeds.length === 1 ? 'seed' : 'seeds'} ${sorted(report.settings.seeds).join(', ')}`;
    found.push({ field: 'grid', baseline: grid(baseline), candidate: grid(candidate) });
  }
  if (baseline.environment.mirror !== candidate.environment.mirror) found.push({ field: 'mirror', baseline: baseline.environment.mirror ?? 'off', candidate: candidate.environment.mirror ?? 'off' });
  if (baseline.settings.maxActions !== candidate.settings.maxActions) found.push({ field: 'budget', baseline: String(baseline.settings.maxActions), candidate: String(candidate.settings.maxActions) });
  if (baseline.settings.checks !== candidate.settings.checks) found.push({ field: 'checks', baseline: baseline.settings.checks === undefined ? 'none' : String(baseline.settings.checks), candidate: candidate.settings.checks === undefined ? 'none' : String(candidate.settings.checks) });
  if (isolationOf(baseline) !== isolationOf(candidate)) found.push({ field: 'isolation', baseline: isolationOf(baseline), candidate: isolationOf(candidate) });
  const rules = [rulesOf(baseline), rulesOf(candidate)];
  if (options.regressionGate && rules[0] !== rules[1]) found.push({ field: 'rules', baseline: rules[0] ?? 'none', candidate: rules[1] ?? 'none' });
  return found;
}

/** True when the isolation levels differ. Built-ins and command templates have their kind's level; a
 * preset earns "tool-restricted" from its runs' evidence (PADR-0044 decision 6). So benching again with
 * the candidate's flags cannot make the two comparable: the baseline has to be a trusted configuration
 * of the candidate's own agent kind, and a preset whose runs gave no evidence is "not restricted". */
export function agentKindDiffers(found: readonly Difference[]): boolean { return found.some(difference => difference.field === 'isolation'); }
/** True when the verdict levels differ: no setting makes the two comparable. */
export function levelsDiffer(found: readonly Difference[]): boolean { return found.some(difference => difference.field === 'verdictLevel'); }

export type PairKind = 'paired' | 'missing';
/** `config-down`/`config-up`: across worlds, a different outcome of one task identity on the two
 * configurations — never an instance regression or fix. */
export type Flip = 'regression' | 'fix' | 'single-down' | 'single-up' | 'changed-down' | 'changed-up' | 'config-down' | 'config-up' | null;
export interface InstancePair {
  taskId: string; seed: number; kind: PairKind;
  baseline: InstanceAggregate | null; candidate: InstanceAggregate | null;
  /** For a paired instance whose outcome differs: an instance regression or fix (≥ 3 judged repeats a
   * side), a single-run flip (fewer than 3 repeats on a side), or a changed outcome that not every
   * judged repeat shows (three or more repeats a side); down when the baseline passed. Across worlds,
   * a difference between the configurations. Null: the same outcome. */
  flip: Flip;
  /** For an instance that is not compared: the side that lacks it. */
  side?: 'baseline' | 'candidate' | 'both';
  /** Identity pairing: the identity, and each side's task ids and seeds that hold it ("task seed n"). */
  identity?: string;
  names?: { baseline: string[]; candidate: string[] };
  /** Identity pairing: the two sides hold a different number of runs; no rate claim uses the pair. */
  unequalRuns?: boolean;
}
/** `nothing_paired`: no instance is on both sides, so there is nothing to test; `no_equal_runs`: every
 * paired identity has different run counts on the two sides, so there is no rate claim. */
export type RateVerdict = 'improvement' | 'decline' | 'not_distinguishable' | 'nothing_paired' | 'no_equal_runs';
export interface SideRate { passed: number; instances: number; interval: { low: number; high: number } | null }
export interface Comparison {
  /** `instance`: one world, task × seed; `identity`: two worlds, the distinct task identity. */
  pairing: 'instance' | 'identity';
  pairs: InstancePair[];
  paired: number;
  baseline: SideRate; candidate: SideRate;
  /** Discordant instances: passed only on the baseline (b) or only on the candidate (c). */
  discordant: { baselineOnly: number; candidateOnly: number };
  p: number; alpha: number; verdict: RateVerdict;
  regressions: InstancePair[]; fixes: InstancePair[]; singleFlips: InstancePair[];
  /** Outcome changed with at least three judged repeats a side, but not in every repeat. */
  changedFlips: InstancePair[];
  /** Identity pairing: outcomes that differ between the two configurations. */
  configFlips: InstancePair[];
  notCompared: InstancePair[];
  /** Paired instances with at least one unjudged run on a side (counted as not passed). */
  withUnjudged: InstancePair[];
  /** Candidate instances that are missing, cut short by an interruption or hold an unjudged run: the
   * CI gate (`--fail-on-regression`) fails on any of them, so an infrastructure fault can never hide a
   * regression. */
  incomplete: InstancePair[];
  /** True when at least one paired instance has the repeats an instance regression needs on both sides. */
  regressionSignal: boolean;
  caveats: Caveat[];
}

/** Judged (`true`/`false`) and unjudged (`null`) outcomes of every run of one key in a report. */
function outcomesBy(report: BenchReportView, key: (run: ViewRun) => string): Map<string, { runs: ViewRun[]; repeats: Array<boolean | null> }> {
  const byKey = new Map<string, { runs: ViewRun[]; repeats: Array<boolean | null> }>();
  for (const run of report.runs as readonly ViewRun[]) {
    const id = key(run), entry = byKey.get(id) ?? { runs: [], repeats: [] };
    entry.runs.push(run); entry.repeats.push(run.checker === null ? null : run.pass);
    byKey.set(id, entry);
  }
  return byKey;
}
const instanceKey = (run: { taskId: string; seed: number }): string => `${run.taskId}\u0000${run.seed}`;

/** The rate verdict and side rates over the pairs that carry a rate claim. */
function rates(counted: readonly InstancePair[]): Pick<Comparison, 'baseline' | 'candidate' | 'discordant' | 'p' | 'alpha'> & { verdict: Exclude<RateVerdict, 'nothing_paired' | 'no_equal_runs'> } {
  const passedOn = (side: 'baseline' | 'candidate'): number => counted.filter(pair => pair[side]!.outcome === 'pass').length;
  const baselineOnly = counted.filter(pair => pair.baseline!.outcome === 'pass' && pair.candidate!.outcome === 'fail').length;
  const candidateOnly = counted.filter(pair => pair.baseline!.outcome === 'fail' && pair.candidate!.outcome === 'pass').length;
  const { p } = mcnemarExact(baselineOnly, candidateOnly);
  const rate = (side: 'baseline' | 'candidate'): SideRate => ({ passed: passedOn(side), instances: counted.length, interval: counted.length ? wilson(passedOn(side), counted.length) : null });
  return { baseline: rate('baseline'), candidate: rate('candidate'), discordant: { baselineOnly, candidateOnly }, p, alpha: ALPHA, verdict: p < ALPHA ? (candidateOnly > baselineOnly ? 'improvement' : 'decline') : 'not_distinguishable' };
}

/** The differences that do not refuse a comparison (PADR-0039 C, PADR-0044 decisions 3–6, 10). */
function caveatsOf(baseline: BenchReportView, candidate: BenchReportView): Caveat[] {
  const caveats: Caveat[] = [];
  const caveat = (field: CaveatField, left: string, right: string): void => { if (left !== right) caveats.push({ field, baseline: left, candidate: right }); };
  caveat('timeout', `${baseline.settings.timeoutSeconds} s`, `${candidate.settings.timeoutSeconds} s`);
  caveat('repeats', String(baseline.settings.repeats), String(candidate.settings.repeats));
  caveat('practonaut', baseline.environment.practonaut, candidate.environment.practonaut);
  caveat('reportVersion', baseline.readFrom, candidate.readFrom);
  if (isolationOf(baseline) === isolationOf(candidate) && baseline.agent.kind === 'preset' && candidate.agent.kind === 'preset') caveat('isolationBasis', isolationBasis(baseline), isolationBasis(candidate));
  caveat('toolchain', toolchainId(baseline), toolchainId(candidate));
  caveat('rules', rulesOf(baseline) ?? 'none', rulesOf(candidate) ?? 'none');
  caveat('clientVersion', baseline.agent.clientVersion.value ?? 'none', candidate.agent.clientVersion.value ?? 'none');
  const settings = (report: BenchReportView): string => report.agent.settings.map(setting => `${setting.name}=${setting.value}`).join(', ') || 'none';
  caveat('clientSettings', settings(baseline), settings(candidate));
  return caveats;
}

/** Compares two validated reports; throws `CompareError` naming every difference when they are not comparable. */
export function compareReports(baseline: BenchReportView, candidate: BenchReportView, options: CompareOptions = {}): Comparison {
  const found = differences(baseline, candidate, options);
  if (found.length) throw new CompareError(found);
  return identityPaired(baseline, candidate) ? compareByIdentity(baseline, candidate) : compareByInstance(baseline, candidate);
}

function compareByInstance(baseline: BenchReportView, candidate: BenchReportView): Comparison {
  const a = outcomesBy(baseline, instanceKey), b = outcomesBy(candidate, instanceKey);
  // Plan order: tasks as the baseline lists them, then seeds.
  const keys = baseline.settings.tasks.flatMap(taskId => baseline.settings.seeds.map(seed => `${taskId}\u0000${seed}`));
  const pairs: InstancePair[] = keys.map(key => {
    const [taskId, seedText] = key.split('\u0000') as [string, string], seed = Number(seedText);
    const left = a.get(key), right = b.get(key);
    const baselineAggregate = left ? aggregateInstance(left.repeats) : null, candidateAggregate = right ? aggregateInstance(right.repeats) : null;
    if (!left || !right) return { taskId, seed, kind: 'missing', baseline: baselineAggregate, candidate: candidateAggregate, flip: null, side: !left && !right ? 'both' : !left ? 'baseline' : 'candidate' };
    const flip: Flip = isInstanceRegression(baselineAggregate!, candidateAggregate!) ? 'regression' : isInstanceFix(baselineAggregate!, candidateAggregate!) ? 'fix'
      : baselineAggregate!.outcome === candidateAggregate!.outcome ? null
        : baselineAggregate!.repeats >= REGRESSION_REPEATS && candidateAggregate!.repeats >= REGRESSION_REPEATS ? (baselineAggregate!.outcome === 'pass' ? 'changed-down' : 'changed-up')
          : baselineAggregate!.outcome === 'pass' ? 'single-down' : 'single-up';
    return { taskId, seed, kind: 'paired', baseline: baselineAggregate, candidate: candidateAggregate, flip };
  });
  const paired = pairs.filter(pair => pair.kind === 'paired');
  const counted = rates(paired);
  const plannedRepeats = candidate.settings.repeats;
  const caveats = caveatsOf(baseline, candidate);
  // Seeds that select one variant give one board under several instances (PADR-0044 decision 3).
  const distinct = (report: BenchReportView): string | null => report.instances && new Set(report.instances.map(entry => entry.identity)).size < report.instances.length ? `${new Set(report.instances.map(entry => entry.identity)).size} / ${report.instances.length}` : null;
  const shared = [distinct(baseline), distinct(candidate)];
  if (shared[0] !== null || shared[1] !== null) caveats.push({ field: 'sharedIdentities', baseline: shared[0] ?? 'none', candidate: shared[1] ?? 'none' });
  return {
    pairing: 'instance', pairs, paired: paired.length, ...counted, verdict: paired.length === 0 ? 'nothing_paired' : counted.verdict,
    regressions: paired.filter(pair => pair.flip === 'regression'), fixes: paired.filter(pair => pair.flip === 'fix'),
    singleFlips: paired.filter(pair => pair.flip === 'single-down' || pair.flip === 'single-up'),
    changedFlips: paired.filter(pair => pair.flip === 'changed-down' || pair.flip === 'changed-up'), configFlips: [],
    notCompared: pairs.filter(pair => pair.kind !== 'paired'),
    withUnjudged: paired.filter(pair => pair.baseline!.unjudged > 0 || pair.candidate!.unjudged > 0),
    incomplete: pairs.filter(pair => pair.candidate === null || pair.candidate.unjudged > 0 || pair.candidate.repeats < plannedRepeats),
    regressionSignal: paired.some(pair => pair.baseline!.judged >= REGRESSION_REPEATS && pair.candidate!.judged >= REGRESSION_REPEATS),
    caveats,
  };
}

/** Across worlds: the unit is the distinct task identity (PADR-0044 decision 3). */
function compareByIdentity(baseline: BenchReportView, candidate: BenchReportView): Comparison {
  const identityOf = (report: BenchReportView): ((run: ViewRun) => string) => {
    const map = new Map(report.instances!.map(entry => [instanceKey(entry), entry.identity]));
    return run => map.get(instanceKey(run))!;
  };
  const a = outcomesBy(baseline, identityOf(baseline)), b = outcomesBy(candidate, identityOf(candidate));
  const names = (entry: { runs: ViewRun[] } | undefined): string[] => entry ? [...new Set(entry.runs.map(run => `${run.taskId} seed ${run.seed}`))] : [];
  // Rows in the baseline's plan order, then the candidate's identities it lacks.
  const order = [...new Set([...baseline.instances!.map(entry => entry.identity), ...candidate.instances!.map(entry => entry.identity)])].filter(identity => a.has(identity) || b.has(identity));
  const pairs: InstancePair[] = order.map(identity => {
    const left = a.get(identity), right = b.get(identity), first = (left ?? right)!.runs[0]!;
    const baselineAggregate = left ? aggregateInstance(left.repeats) : null, candidateAggregate = right ? aggregateInstance(right.repeats) : null;
    const common = { taskId: first.taskId, seed: first.seed, identity, names: { baseline: names(left), candidate: names(right) } };
    if (!left || !right) return { ...common, kind: 'missing', baseline: baselineAggregate, candidate: candidateAggregate, flip: null, side: !left ? 'baseline' : 'candidate' };
    const flip: Flip = baselineAggregate!.outcome === candidateAggregate!.outcome ? null : baselineAggregate!.outcome === 'pass' ? 'config-down' : 'config-up';
    return { ...common, kind: 'paired', baseline: baselineAggregate, candidate: candidateAggregate, flip, ...(left.repeats.length !== right.repeats.length ? { unequalRuns: true } : {}) };
  });
  const paired = pairs.filter(pair => pair.kind === 'paired');
  // An outcome decided by a majority of more runs passes more often: only equal run counts carry a rate claim.
  const equal = paired.filter(pair => !pair.unequalRuns);
  const counted = rates(equal);
  const caveats = caveatsOf(baseline, candidate);
  caveats.push({ field: 'identityPairing', baseline: `${baseline.environment.world.worldId} ${baseline.environment.world.version} (${baseline.environment.app.adapterId}, ${toolchainId(baseline)})`, candidate: `${candidate.environment.world.worldId} ${candidate.environment.world.version} (${candidate.environment.app.adapterId}, ${toolchainId(candidate)})` });
  for (const pair of paired.filter(value => value.unequalRuns)) caveats.push({ field: 'runCounts', baseline: `${pair.names!.baseline.join(', ')}: ${pair.baseline!.repeats}`, candidate: `${pair.names!.candidate.join(', ')}: ${pair.candidate!.repeats}` });
  return {
    pairing: 'identity', pairs, paired: paired.length, ...counted, verdict: paired.length === 0 ? 'nothing_paired' : equal.length === 0 ? 'no_equal_runs' : counted.verdict,
    regressions: [], fixes: [], singleFlips: [], changedFlips: [], configFlips: paired.filter(pair => pair.flip !== null),
    notCompared: pairs.filter(pair => pair.kind !== 'paired'),
    withUnjudged: paired.filter(pair => pair.baseline!.unjudged > 0 || pair.candidate!.unjudged > 0),
    incomplete: pairs.filter(pair => pair.candidate === null || pair.candidate.unjudged > 0),
    regressionSignal: false, caveats,
  };
}

/** A report version a reader names in words: /3, or the version the view was read from. */
export const readFromV3 = (report: BenchReportView): boolean => report.readFrom === BENCH_SCHEMA_V3;
export { ISOLATION_OF };

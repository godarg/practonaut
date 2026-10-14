/**
 * `practonaut compare a.json b.json`: two validated bench reports, `a` the baseline and `b` the
 * candidate, compared by the rules of PADR-0039 C. Pure: no I/O, no clock.
 *
 * 1. Comparable or refused: same world content, same grid (tasks and seeds), same mirror, same action
 *    budget, same isolation level; otherwise every difference is named.
 * 2. The unit is the distinct instance (task × seed). Judged repeats aggregate to one outcome per side
 *    (a pass when at least half passed); an instance missing on a side or without a judged repeat
 *    there is listed and left out.
 * 3. An instance regression has at least three judged repeats on each side, every baseline repeat
 *    passed and every candidate repeat failed (the mirror image is a fix). With fewer repeats a flip
 *    is a single run, never a regression.
 * 4. A rate claim needs the exact two-sided McNemar test on the discordant instances at α = 0.05;
 *    otherwise the verdict is "not distinguishable at this n".
 */
import { isBenchReportV2, ISOLATION_OF, type BenchReport, type IsolationLevel } from './report.ts';
import { aggregateInstance, ALPHA, isInstanceFix, isInstanceRegression, mcnemarExact, REGRESSION_REPEATS, wilson, type InstanceAggregate } from './stats.ts';

export type ComparableField = 'world' | 'grid' | 'mirror' | 'budget' | 'isolation';
export interface Difference { field: ComparableField; baseline: string; candidate: string }
export type CaveatField = 'timeout' | 'repeats' | 'practonaut';
export interface Caveat { field: CaveatField; baseline: string; candidate: string }

export class CompareError extends Error {
  readonly code = 'compare_incomparable';
  readonly differences: Difference[];
  constructor(differences: Difference[]) { super(`reports are not comparable: ${differences.map(difference => difference.field).join(', ')}`); this.name = 'CompareError'; this.differences = differences; }
}

/** What Practonaut restricted about the agent's tools; a /1 report did not record it, but it follows
 * from the agent kind (PADR-0036). */
export function isolationOf(report: BenchReport): IsolationLevel { return isBenchReportV2(report) ? report.agent.isolation : ISOLATION_OF[report.agent.kind]; }
export function worldHashOf(report: BenchReport): string { return isBenchReportV2(report) ? report.environment.world.contentHash : report.environment.library.contentHash; }
const worldName = (report: BenchReport): string => isBenchReportV2(report) ? `${report.environment.world.worldId} ${report.environment.world.version} (${report.environment.world.contentHash.slice(0, 12)})` : `${report.environment.library.worldId} ${report.environment.library.version} (${report.environment.library.contentHash.slice(0, 12)})`;
const sorted = <T extends string | number>(values: readonly T[]): T[] => [...values].sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));
const sameSet = <T extends string | number>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && sorted(a).every((value, index) => value === sorted(b)[index]);

/** Every comparability rule a pair of reports breaks (empty: comparable). */
export function differences(baseline: BenchReport, candidate: BenchReport): Difference[] {
  const found: Difference[] = [];
  if (worldHashOf(baseline) !== worldHashOf(candidate)) found.push({ field: 'world', baseline: worldName(baseline), candidate: worldName(candidate) });
  if (!sameSet(baseline.settings.tasks, candidate.settings.tasks) || !sameSet(baseline.settings.seeds, candidate.settings.seeds)) {
    const grid = (report: BenchReport): string => `${sorted(report.settings.tasks).join(',')} × seeds ${sorted(report.settings.seeds).join(',')}`;
    found.push({ field: 'grid', baseline: grid(baseline), candidate: grid(candidate) });
  }
  if (baseline.environment.mirror !== candidate.environment.mirror) found.push({ field: 'mirror', baseline: baseline.environment.mirror, candidate: candidate.environment.mirror });
  if (baseline.settings.maxActions !== candidate.settings.maxActions) found.push({ field: 'budget', baseline: String(baseline.settings.maxActions), candidate: String(candidate.settings.maxActions) });
  if (isolationOf(baseline) !== isolationOf(candidate)) found.push({ field: 'isolation', baseline: isolationOf(baseline), candidate: isolationOf(candidate) });
  return found;
}

export type PairKind = 'paired' | 'missing' | 'unjudged';
export type Flip = 'regression' | 'fix' | 'single-down' | 'single-up' | null;
export interface InstancePair {
  taskId: string; seed: number; kind: PairKind;
  baseline: InstanceAggregate | null; candidate: InstanceAggregate | null;
  /** For a paired instance whose outcome differs: an instance regression or fix (≥ 3 judged repeats a
   * side), or a single-run flip down or up. */
  flip: Flip;
  /** For an instance that is not compared: the side that lacks it (missing) or has no judged run. */
  side?: 'baseline' | 'candidate' | 'both';
}
export type RateVerdict = 'improvement' | 'decline' | 'not_distinguishable';
export interface SideRate { passed: number; instances: number; interval: { low: number; high: number } | null }
export interface Comparison {
  pairs: InstancePair[];
  paired: number;
  baseline: SideRate; candidate: SideRate;
  /** Discordant instances: passed only on the baseline (b) or only on the candidate (c). */
  discordant: { baselineOnly: number; candidateOnly: number };
  p: number; alpha: number; verdict: RateVerdict;
  regressions: InstancePair[]; fixes: InstancePair[]; singleFlips: InstancePair[];
  notCompared: InstancePair[];
  /** True when at least one paired instance has the repeats an instance regression needs on both sides. */
  regressionSignal: boolean;
  caveats: Caveat[];
}

/** Judged (`true`/`false`) and unjudged (`null`) outcomes of every run of one instance in a report. */
function outcomes(report: BenchReport): Map<string, { taskId: string; seed: number; repeats: Array<boolean | null> }> {
  const byInstance = new Map<string, { taskId: string; seed: number; repeats: Array<boolean | null> }>();
  for (const run of report.runs) {
    const key = `${run.taskId}\u0000${run.seed}`, entry = byInstance.get(key) ?? { taskId: run.taskId, seed: run.seed, repeats: [] };
    entry.repeats.push(run.checker === null ? null : run.pass);
    byInstance.set(key, entry);
  }
  return byInstance;
}

/** Compares two validated reports; throws `CompareError` naming every difference when they are not comparable. */
export function compareReports(baseline: BenchReport, candidate: BenchReport): Comparison {
  const found = differences(baseline, candidate);
  if (found.length) throw new CompareError(found);
  const a = outcomes(baseline), b = outcomes(candidate);
  // Plan order: tasks as the baseline lists them, then seeds.
  const keys = baseline.settings.tasks.flatMap(taskId => baseline.settings.seeds.map(seed => `${taskId}\u0000${seed}`));
  const pairs: InstancePair[] = keys.map(key => {
    const [taskId, seedText] = key.split('\u0000') as [string, string], seed = Number(seedText);
    const left = a.get(key), right = b.get(key);
    const baselineAggregate = left ? aggregateInstance(left.repeats) : null, candidateAggregate = right ? aggregateInstance(right.repeats) : null;
    if (!left || !right) return { taskId, seed, kind: 'missing', baseline: baselineAggregate, candidate: candidateAggregate, flip: null, side: !left && !right ? 'both' : !left ? 'baseline' : 'candidate' };
    if (baselineAggregate!.outcome === 'unjudged' || candidateAggregate!.outcome === 'unjudged') {
      const side = baselineAggregate!.outcome === 'unjudged' && candidateAggregate!.outcome === 'unjudged' ? 'both' : baselineAggregate!.outcome === 'unjudged' ? 'baseline' : 'candidate';
      return { taskId, seed, kind: 'unjudged', baseline: baselineAggregate, candidate: candidateAggregate, flip: null, side };
    }
    const flip: Flip = isInstanceRegression(baselineAggregate!, candidateAggregate!) ? 'regression' : isInstanceFix(baselineAggregate!, candidateAggregate!) ? 'fix'
      : baselineAggregate!.outcome === candidateAggregate!.outcome ? null
        : baselineAggregate!.judged >= REGRESSION_REPEATS && candidateAggregate!.judged >= REGRESSION_REPEATS ? null
          : baselineAggregate!.outcome === 'pass' ? 'single-down' : 'single-up';
    return { taskId, seed, kind: 'paired', baseline: baselineAggregate, candidate: candidateAggregate, flip };
  });
  const paired = pairs.filter(pair => pair.kind === 'paired');
  const passedOn = (side: 'baseline' | 'candidate'): number => paired.filter(pair => pair[side]!.outcome === 'pass').length;
  const baselineOnly = paired.filter(pair => pair.baseline!.outcome === 'pass' && pair.candidate!.outcome === 'fail').length;
  const candidateOnly = paired.filter(pair => pair.baseline!.outcome === 'fail' && pair.candidate!.outcome === 'pass').length;
  const { p } = mcnemarExact(baselineOnly, candidateOnly);
  const verdict: RateVerdict = p < ALPHA ? (candidateOnly > baselineOnly ? 'improvement' : 'decline') : 'not_distinguishable';
  const rate = (side: 'baseline' | 'candidate'): SideRate => ({ passed: passedOn(side), instances: paired.length, interval: paired.length ? wilson(passedOn(side), paired.length) : null });
  const caveats: Caveat[] = [];
  const caveat = (field: CaveatField, left: string, right: string): void => { if (left !== right) caveats.push({ field, baseline: left, candidate: right }); };
  caveat('timeout', `${baseline.settings.timeoutSeconds} s`, `${candidate.settings.timeoutSeconds} s`);
  caveat('repeats', String(baseline.settings.repeats), String(candidate.settings.repeats));
  caveat('practonaut', baseline.environment.practonaut, candidate.environment.practonaut);
  return {
    pairs, paired: paired.length, baseline: rate('baseline'), candidate: rate('candidate'),
    discordant: { baselineOnly, candidateOnly }, p, alpha: ALPHA, verdict,
    regressions: paired.filter(pair => pair.flip === 'regression'), fixes: paired.filter(pair => pair.flip === 'fix'),
    singleFlips: paired.filter(pair => pair.flip === 'single-down' || pair.flip === 'single-up'),
    notCompared: pairs.filter(pair => pair.kind !== 'paired'),
    regressionSignal: paired.some(pair => pair.baseline!.judged >= REGRESSION_REPEATS && pair.candidate!.judged >= REGRESSION_REPEATS),
    caveats,
  };
}

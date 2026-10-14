/**
 * The statistics behind every rate Practonaut shows and every claim `compare` makes (PADR-0039):
 * the Wilson 95 % score interval for a fraction, the aggregation of repeats into one outcome per
 * instance, the exact two-sided McNemar test on discordant instance pairs, and the exact power of
 * that test (the sample-size table in docs/benchmarks/README.md). One module, so the challenge gate
 * (roadmap 0.2.0, Must 4) uses the same rules as `compare`.
 *
 * Pure functions on integers: no clock, no randomness, no I/O.
 */

/** The 97.5 % quantile of the standard normal distribution (two-sided 95 %). */
export const Z95 = 1.959963984540054;
/** The significance level of every rate claim. */
export const ALPHA = 0.05;
/** Repeats per side an instance needs before a flip counts as an instance regression. */
export const REGRESSION_REPEATS = 3;

const integer = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
};

/**
 * Wilson score interval (Wilson 1927; Newcombe 1998, method 3) for k successes in n trials:
 *   centre = (p + z²/2n) / (1 + z²/n),  half = z / (1 + z²/n) · √(p(1−p)/n + z²/4n²).
 * Unlike the normal approximation it stays inside [0, 1] and is not empty at k = 0 or k = n.
 */
export function wilson(k: number, n: number, z: number = Z95): { low: number; high: number } {
  integer(k, 'k'); integer(n, 'n');
  if (n === 0 || k > n) throw new RangeError('wilson needs 0 ≤ k ≤ n and n ≥ 1');
  const p = k / n, z2 = z * z, denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z / denominator) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  // At k = 0 and k = n the bounds are exactly 0 and 1; rounding must not move them inside.
  return { low: k === 0 ? 0 : Math.max(0, centre - half), high: k === n ? 1 : Math.min(1, centre + half) };
}

/** ln C(n, k), summed term by term (exact enough for n up to millions, no gamma function needed). */
function logChoose(n: number, k: number): number {
  const m = Math.min(k, n - k);
  let sum = 0;
  for (let i = 1; i <= m; i++) sum += Math.log(n - m + i) - Math.log(i);
  return sum;
}

/** P(X ≤ k) for X ~ Binomial(n, 1/2), summed in log space so large n does not underflow. */
export function binomialHalfCdf(k: number, n: number): number {
  integer(k, 'k'); integer(n, 'n');
  if (k >= n) return 1;
  const base = -n * Math.LN2;
  let log = base, max = base;
  const terms: number[] = [base];
  for (let i = 0; i < k; i++) { log += Math.log(n - i) - Math.log(i + 1); terms.push(log); if (log > max) max = log; }
  return Math.min(1, Math.exp(max) * terms.reduce((sum, term) => sum + Math.exp(term - max), 0));
}

/**
 * Exact two-sided McNemar test on the discordant pairs: b instances passed only on the baseline,
 * c only on the candidate. Under the null hypothesis each discordant pair goes either way with
 * probability 1/2, so p = min(1, 2 · P(X ≤ min(b, c))) with X ~ Binomial(b + c, 1/2). Concordant
 * pairs carry no information about the difference and do not enter the test.
 */
export function mcnemarExact(b: number, c: number): { discordant: number; p: number } {
  integer(b, 'b'); integer(c, 'c');
  const discordant = b + c;
  if (discordant === 0) return { discordant, p: 1 };
  return { discordant, p: Math.min(1, 2 * binomialHalfCdf(Math.min(b, c), discordant)) };
}

export type InstanceOutcome = 'pass' | 'fail' | 'unjudged';
export interface InstanceAggregate { repeats: number; judged: number; passed: number; outcome: InstanceOutcome }
/**
 * One outcome per instance and side from its repeats: `true` passed, `false` judged and failed,
 * `null` not judged (no checker verdict). Only judged repeats count; the instance passes when at
 * least half of them passed, and is `unjudged` when none was judged. Repeats are never counted as
 * independent pairs.
 */
export function aggregateInstance(repeats: ReadonlyArray<boolean | null>): InstanceAggregate {
  const judged = repeats.filter(value => value !== null).length, passed = repeats.filter(value => value === true).length;
  return { repeats: repeats.length, judged, passed, outcome: judged === 0 ? 'unjudged' : 2 * passed >= judged ? 'pass' : 'fail' };
}

/** An instance regression (PADR-0039): at least `REGRESSION_REPEATS` judged repeats on each side,
 * every baseline repeat passed and every candidate repeat failed. */
export function isInstanceRegression(baseline: InstanceAggregate, candidate: InstanceAggregate): boolean {
  return baseline.judged >= REGRESSION_REPEATS && candidate.judged >= REGRESSION_REPEATS && baseline.passed === baseline.judged && candidate.passed === 0;
}
/** The mirror image: every baseline repeat failed and every candidate repeat passed. */
export function isInstanceFix(baseline: InstanceAggregate, candidate: InstanceAggregate): boolean {
  return baseline.judged >= REGRESSION_REPEATS && candidate.judged >= REGRESSION_REPEATS && baseline.passed === 0 && candidate.passed === candidate.judged;
}

/** The largest number of minority-side discordant pairs `m` with which d discordant pairs still give
 * p ≤ alpha (two-sided exact McNemar), or −1 when no split of d pairs is significant. */
export function criticalMinority(d: number, alpha: number = ALPHA): number {
  integer(d, 'd');
  let m = -1;
  while (m + 1 <= Math.floor(d / 2) && mcnemarExact(m + 1, d - m - 1).p <= alpha) m++;
  return m;
}

/**
 * Exact power of the two-sided exact McNemar test at `alpha` to show that the candidate is better,
 * over `n` instances: each instance is discordant in the candidate's favour with probability
 * `candidateOnly` and in the baseline's favour with `baselineOnly` (concordant otherwise). Power is
 * P(p ≤ alpha and the candidate has more discordant wins), summed over every number of discordant
 * pairs d ~ Binomial(n, ψ) and every split c ~ Binomial(d, candidateOnly / ψ).
 */
export function mcnemarPower(n: number, candidateOnly: number, baselineOnly: number, alpha: number = ALPHA): number {
  integer(n, 'n');
  const psi = candidateOnly + baselineOnly;
  if (psi <= 0 || psi > 1 || candidateOnly < 0 || baselineOnly < 0) throw new RangeError('discordance must be in (0, 1]');
  const q = candidateOnly / psi;
  const logPmf = (k: number, total: number, p: number): number => p === 0 ? (k === 0 ? 0 : -Infinity) : p === 1 ? (k === total ? 0 : -Infinity) : logChoose(total, k) + k * Math.log(p) + (total - k) * Math.log(1 - p);
  let power = 0;
  for (let d = 1; d <= n; d++) {
    const m = criticalMinority(d, alpha);
    if (m < 0) continue;
    const pd = Math.exp(logPmf(d, n, psi));
    if (pd === 0) continue;
    // The candidate wins c = d − b discordant pairs, b ≤ m: significant and in the candidate's favour.
    let inner = 0;
    for (let b = 0; b <= m; b++) inner += Math.exp(logPmf(d - b, d, q));
    power += pd * inner;
  }
  return Math.min(1, power);
}

/** The smallest number of instances whose power reaches `target` (scanning 1 … max), or null. Exact
 * power is not monotone in n (a saw-tooth); the table names the first n that reaches the target. */
export function instancesNeeded(difference: number, discordance: number, target: number, alpha: number = ALPHA, max = 2000): number | null {
  const candidateOnly = (discordance + difference) / 2, baselineOnly = (discordance - difference) / 2;
  if (baselineOnly < -1e-12) throw new RangeError('discordance must be at least the difference');
  for (let n = 1; n <= max; n++) if (mcnemarPower(n, candidateOnly, Math.max(0, baselineOnly), alpha) >= target) return n;
  return null;
}

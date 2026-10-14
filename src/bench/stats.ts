/**
 * Statistics for gate and comparison reports (PADR-0040): the 95 % Wilson score interval for a
 * fraction and the exact two-sided McNemar test on discordant instances. Pure functions, no I/O.
 *
 * Minimal module for the challenge-tier gate; Must 3 (`compare`) brings a fuller one with the same
 * two functions (`wilson`, `mcnemarExact`) and the same return shapes.
 */

/** z for a two-sided 95 % interval. */
export const Z95 = 1.959963984540054;

function count(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a whole number ≥ 0`);
}

/**
 * Wilson score interval for k successes in n trials (Wilson 1927):
 *   centre = (p + z²/2n) / (1 + z²/n),  half = z / (1 + z²/n) · √(p(1−p)/n + z²/4n²).
 * It stays inside [0, 1]; at k = 0 the low end is exactly 0 and at k = n the high end exactly 1.
 */
export function wilson(k: number, n: number, z: number = Z95): { low: number; high: number } {
  count(k, 'k'); count(n, 'n');
  if (n === 0 || k > n) throw new RangeError('wilson needs n ≥ 1 and 0 ≤ k ≤ n');
  const p = k / n, z2 = z * z, denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (z / denominator) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
  return { low: k === 0 ? 0 : Math.max(0, centre - half), high: k === n ? 1 : Math.min(1, centre + half) };
}
/** The same interval under the name the gate documentation uses. */
export const wilsonInterval = (k: number, n: number): { low: number; high: number } => wilson(k, n);

/** P(X ≤ k) for X ~ Binomial(n, ½), as an exact sum of C(n, i) / 2ⁿ (term by term, no overflow). */
export function binomialHalfCdf(k: number, n: number): number {
  count(k, 'k'); count(n, 'n');
  if (k >= n) return 1;
  // Each term is C(n, i) / 2ⁿ; the first is 2⁻ⁿ and every next one is the previous × (n − i) / (i + 1).
  // Kept in log space so that 2⁻ⁿ does not underflow for large n.
  const logs: number[] = [-n * Math.LN2];
  for (let i = 0; i < k; i++) logs.push(logs[i]! + Math.log(n - i) - Math.log(i + 1));
  const max = Math.max(...logs);
  return Math.min(1, Math.exp(max) * logs.reduce((sum, log) => sum + Math.exp(log - max), 0));
}

/**
 * Exact two-sided McNemar test: b instances passed only for the first agent, c only for the second.
 * Under the null hypothesis each discordant instance goes either way with probability ½, so
 * p = min(1, 2 · P(X ≤ min(b, c))) with X ~ Binomial(b + c, ½). Concordant instances do not enter.
 */
export function mcnemarExact(b: number, c: number): { discordant: number; p: number } {
  count(b, 'b'); count(c, 'c');
  const discordant = b + c;
  if (discordant === 0) return { discordant, p: 1 };
  return { discordant, p: Math.min(1, 2 * binomialHalfCdf(Math.min(b, c), discordant)) };
}

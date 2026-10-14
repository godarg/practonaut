// The statistics of PADR-0039 (src/bench/stats.ts). Expected values come from a published table
// (Newcombe 1998), from hand calculation written out next to each assertion, and from a second,
// exact implementation in BigInt arithmetic in this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateInstance, binomialHalfCdf, criticalMinority, instancesNeeded, isInstanceFix, isInstanceRegression, mcnemarExact, mcnemarPower, wilson } from '../../src/bench/stats.ts';

const close = (actual: number, expected: number, tolerance: number, label: string): void => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} is not within ${tolerance} of ${expected}`);

test('Wilson score interval matches Newcombe (1998), Table II, method 3, to four decimals', () => {
  // R. G. Newcombe, "Two-sided confidence intervals for the single proportion: comparison of seven
  // methods", Statistics in Medicine 17 (1998) 857–872: the score method's intervals for the paper's
  // four worked examples.
  for (const [k, n, low, high] of [[81, 263, 0.2553, 0.3662], [15, 148, 0.0624, 0.1605], [0, 20, 0, 0.1611], [1, 29, 0.0061, 0.1718]] as const) {
    const interval = wilson(k, n);
    close(interval.low, low, 0.00005, `${k}/${n} low`); close(interval.high, high, 0.00005, `${k}/${n} high`);
  }
  // Hand calculation for 5/10 (p = 1/2, z² = 3.8415): centre 0.5, half = (z / 1.38415) · √(0.025 + 0.009604) = 0.26341.
  const half = wilson(5, 10); close(half.low, 0.23659, 0.00001, '5/10 low'); close(half.high, 0.76341, 0.00001, '5/10 high');
  // At k = 0 and k = n the interval touches 0 and 1 exactly, and is symmetric between them.
  assert.equal(wilson(0, 10).low, 0); assert.equal(wilson(10, 10).high, 1); close(wilson(0, 10).high, 1 - wilson(10, 10).low, 1e-12, 'symmetry');
  assert.throws(() => wilson(1, 0), RangeError); assert.throws(() => wilson(3, 2), RangeError); assert.throws(() => wilson(-1, 2), RangeError);
});

/** Exact P(X ≤ k), X ~ Binomial(n, 1/2), as a rational in BigInt: a second implementation. */
function exactHalfCdf(k: number, n: number): number {
  let coefficient = 1n, sum = 0n;
  for (let i = 0; i <= k; i++) { sum += coefficient; coefficient = coefficient * BigInt(n - i) / BigInt(i + 1); }
  const scale = 10n ** 18n;
  return Number(sum * scale / (1n << BigInt(n))) / 1e18;
}

test('exact McNemar: hand-calculated p-values and a BigInt cross-check at large n', () => {
  // b = 0, c = 5: 2 · 2⁻⁵ = 0.0625 (not significant); c = 6: 2 · 2⁻⁶ = 0.03125 (significant).
  assert.deepEqual(mcnemarExact(0, 5), { discordant: 5, p: 0.0625 });
  close(mcnemarExact(0, 6).p, 0.03125, 1e-15, '0/6');
  // b = 1, c = 9: 2 · (C(10,0) + C(10,1)) / 2¹⁰ = 22 / 1024.
  close(mcnemarExact(1, 9).p, 22 / 1024, 1e-15, '1/9');
  // b = 2, c = 8: 2 · (1 + 10 + 45) / 1024 = 112 / 1024; the test is symmetric in b and c.
  close(mcnemarExact(2, 8).p, 112 / 1024, 1e-15, '2/8'); assert.equal(mcnemarExact(8, 2).p, mcnemarExact(2, 8).p);
  // b = c: 2 · P(X ≤ 3 | n = 6) = 2 · 42/64 > 1, capped at 1. No discordant pair: p = 1.
  assert.equal(mcnemarExact(3, 3).p, 1); assert.deepEqual(mcnemarExact(0, 0), { discordant: 0, p: 1 });
  for (const [k, n] of [[40, 100], [12, 60], [450, 1000], [0, 1074]] as const) close(binomialHalfCdf(k, n), exactHalfCdf(k, n), 1e-12, `P(X ≤ ${k} | ${n})`);
  assert.throws(() => mcnemarExact(1.5, 2), RangeError);
});

test('critical minority: the largest split that is still significant, by hand', () => {
  // d = 5: 2 · 2⁻⁵ = 0.0625 > 0.05 → no split is significant; d = 6 and 8: only 0 (2 · 9/256 = 0.0703 at 1/7);
  // d = 9: 1 (2 · 10/512 = 0.039); d = 11: 1 (2 · 67/2048 = 0.065 at 2/9); d = 12: 2 (2 · 79/4096 = 0.039).
  assert.deepEqual([5, 6, 8, 9, 11, 12].map(d => criticalMinority(d)), [-1, 0, 0, 1, 1, 2]);
});

/** P(D ≥ 6), D ~ Binomial(n, 0.2), by direct summation: the power when the candidate wins every
 * discordant instance (baseline-only = 0), because only d ≥ 6 discordant instances can be significant. */
function powerAllOneWay(n: number): number {
  let below = 0;
  for (let k = 0; k <= 5; k++) {
    let coefficient = 1; for (let i = 1; i <= k; i++) coefficient = coefficient * (n - k + i) / i;
    below += coefficient * 0.2 ** k * 0.8 ** (n - k);
  }
  return 1 - below;
}

test('power and the sample-size table: ψ = 0.20 against a separate binomial sum', () => {
  for (const n of [6, 24, 38, 39, 44, 45]) close(mcnemarPower(n, 0.2, 0), powerAllOneWay(n), 1e-12, `n = ${n}`);
  // The docs table (PADR-0039, benchmarks §6): first n reaching 80 % and 90 % for a 20-point difference.
  assert.ok(powerAllOneWay(38) < 0.8 && powerAllOneWay(39) >= 0.8 && powerAllOneWay(44) < 0.9 && powerAllOneWay(45) >= 0.9);
  assert.equal(instancesNeeded(0.2, 0.2, 0.8), 39); assert.equal(instancesNeeded(0.2, 0.2, 0.9), 45);
  // More disagreement in both directions needs more instances for the same difference.
  const row = [0.3, 0.4, 0.5, 0.6].map(psi => instancesNeeded(0.2, psi, 0.8)!);
  assert.deepEqual(row, [61, 84, 103, 124]);
  assert.deepEqual([0.3, 0.4, 0.5, 0.6].map(psi => instancesNeeded(0.2, psi, 0.9)), [78, 107, 135, 162]);
  // Six instances can never reach p < 0.05 when fewer than six disagree: power 0 below n = 6.
  assert.equal(mcnemarPower(5, 0.2, 0), 0);
  assert.throws(() => instancesNeeded(0.3, 0.2, 0.8), RangeError);
});

test('aggregation: every repeat counts, a pass when at least half of all repeats passed; regressions need three judged repeats a side', () => {
  assert.deepEqual(aggregateInstance([true, false, true]), { repeats: 3, judged: 3, unjudged: 0, passed: 2, outcome: 'pass' });
  assert.equal(aggregateInstance([true, false]).outcome, 'pass');
  assert.equal(aggregateInstance([false, false, true]).outcome, 'fail');
  // A run that was not judged counts as not passed (roadmap 0.2.0: every run counts): 1 of 3 is below half.
  assert.deepEqual(aggregateInstance([true, null, null]), { repeats: 3, judged: 1, unjudged: 2, passed: 1, outcome: 'fail' });
  assert.deepEqual(aggregateInstance([null, null]), { repeats: 2, judged: 0, unjudged: 2, passed: 0, outcome: 'fail' });
  assert.deepEqual(aggregateInstance([null, true]), { repeats: 2, judged: 1, unjudged: 1, passed: 1, outcome: 'pass' });
  const all = (value: boolean | null, n: number) => aggregateInstance(Array.from({ length: n }, () => value));
  assert.equal(isInstanceRegression(all(true, 3), all(false, 3)), true);
  assert.equal(isInstanceRegression(all(true, 2), all(false, 3)), false, 'two baseline repeats are single runs');
  assert.equal(isInstanceRegression(aggregateInstance([true, true, true]), aggregateInstance([false, false, null])), false, 'an unjudged repeat does not count');
  assert.equal(isInstanceRegression(aggregateInstance([true, true, true, null]), all(false, 3)), true);
  assert.equal(isInstanceRegression(aggregateInstance([true, true, false]), all(false, 3)), false, 'one baseline failure: not every repeat passed');
  assert.equal(isInstanceFix(all(false, 3), all(true, 4)), true);
  assert.equal(isInstanceFix(all(true, 3), all(false, 3)), false);
});

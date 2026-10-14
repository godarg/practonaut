// Statistics for the challenge gate. Expected values are hand calculations (shown inline), not
// output of the code under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binomialHalfCdf, mcnemarExact, wilson, wilsonInterval } from '../../src/bench/stats.ts';

const close = (actual: number, expected: number, digits = 4): void => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≉ ${expected}`);

test('Wilson 95 % interval matches hand-calculated bounds', () => {
  // 0 of 24: low 0; high = 2·(z²/2n)/(1 + z²/n) = 3.8415/27.8415 = 0.13798.
  const none = wilson(0, 24);
  assert.equal(none.low, 0); close(none.high, 0.13798);
  // 12 of 24: centre 0.5; half = (1.96/1.16006)·√(0.25/24 + 3.8415/2304) = 1.68953 · 0.10993 = 0.18573.
  const half = wilson(12, 24);
  close(half.low, 0.31427); close(half.high, 0.68573);
  // 24 of 24 mirrors 0 of 24.
  const all = wilsonInterval(24, 24);
  close(all.low, 1 - 0.13798); assert.equal(all.high, 1);
  // 3 of 10: centre 0.492075/1.38415 = 0.35551; half = 1.41600 · √(0.021 + 0.0096037) = 0.24771.
  const newcombe = wilson(3, 10);
  close(newcombe.low, 0.1078); close(newcombe.high, 0.6032);
});

test('Wilson refuses impossible fractions', () => {
  assert.throws(() => wilson(1, 0), RangeError);
  assert.throws(() => wilson(5, 4), RangeError);
  assert.throws(() => wilson(-1, 4), RangeError);
  assert.throws(() => wilson(1.5, 4), RangeError);
});

test('binomial tail with p = ½ equals the hand-summed binomial coefficients', () => {
  close(binomialHalfCdf(0, 6), 1 / 64, 10);
  close(binomialHalfCdf(1, 9), 10 / 512, 10);
  close(binomialHalfCdf(2, 9), 46 / 512, 10);
  close(binomialHalfCdf(3, 6), 42 / 64, 10);
  assert.equal(binomialHalfCdf(9, 9), 1);
  // Large n stays finite: P(X ≤ 600) for n = 1200 is a little above one half.
  const large = binomialHalfCdf(600, 1200);
  assert.ok(large > 0.5 && large < 0.52, String(large));
});

test('exact McNemar test on discordant instances', () => {
  // b = 8, c = 1: 2 · (C(9,0) + C(9,1)) / 2⁹ = 2 · 10/512 = 0.0390625 → significant.
  assert.equal(mcnemarExact(8, 1).discordant, 9); close(mcnemarExact(8, 1).p, 20 / 512, 10);
  // b = 7, c = 2: 2 · (1 + 9 + 36)/512 = 0.1796875 → not significant.
  close(mcnemarExact(7, 2).p, 92 / 512, 10);
  // Symmetric in b and c.
  close(mcnemarExact(1, 8).p, mcnemarExact(8, 1).p, 12);
  // b = 6, c = 0: 2/64 = 0.03125; b = 5, c = 0: 2/32 = 0.0625 (five one-sided wins are not enough).
  close(mcnemarExact(6, 0).p, 0.03125, 10);
  close(mcnemarExact(5, 0).p, 0.0625, 10);
  // No discordant instance: no evidence either way.
  assert.deepEqual(mcnemarExact(0, 0), { discordant: 0, p: 1 });
  // Balanced: p is capped at 1.
  assert.equal(mcnemarExact(3, 3).p, 1);
  assert.throws(() => mcnemarExact(-1, 2), RangeError);
});

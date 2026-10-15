/**
 * The challenge generators' only source of randomness (PADR-0040): mulberry32 seeded from a SHA-256
 * of the generator id, version, seed and difficulty. The same inputs give the same instance on every
 * platform; nothing reads the clock or ambient randomness.
 */
import { createHash } from 'node:crypto';

export interface Random {
  /** A float in [0, 1). */
  next(): number;
  /** A whole number in [low, high] (both inclusive). */
  int(low: number, high: number): number;
  pick<T>(items: readonly T[]): T;
  /** A new array in a random order (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
  chance(probability: number): boolean;
}

/** The first 32 bits of SHA-256 over the parts joined by NUL. */
export function deriveSeed(...parts: Array<string | number>): number {
  return createHash('sha256').update(parts.map(String).join('\u0000')).digest().readUInt32BE(0);
}

/** mulberry32 (Tommy Ettinger, public domain): a 32-bit state, one multiply-xorshift step per draw. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRandom(seed: number): Random {
  const next = mulberry32(seed);
  const int = (low: number, high: number): number => {
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || high < low) throw new RangeError('int needs whole numbers with low ≤ high');
    return low + Math.floor(next() * (high - low + 1));
  };
  return {
    next, int,
    pick: items => { if (!items.length) throw new RangeError('pick from an empty list'); return items[int(0, items.length - 1)]!; },
    shuffle: items => { const out = items.slice(); for (let i = out.length - 1; i > 0; i--) { const j = int(0, i); [out[i], out[j]] = [out[j]!, out[i]!]; } return out; },
    chance: probability => next() < probability,
  };
}

// Independent hash oracle for the deterministic core. Written separately from
// src/canonical and imports nothing from src/: it re-derives the canonical JSON and
// SHA-256 itself, for the declared fixture subset (safe integers, plain object keys,
// strings without control characters), where sorted-key compact JSON equals JCS.
// It does not implement runtime transitions: the final state is the HAND-WRITTEN
// tests/fixtures/core/golden-final.template.json; only prefix-derived ids
// (PADR-0004) are substituted.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Sorted-key, whitespace-free JSON (keys compared by UTF-16 code units). */
export function oracleCanonical(value: Json): string {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`oracle subset: non-integer number ${value}`);
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(oracleCanonical).join(',') + ']';
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map(key => JSON.stringify(key) + ':' + oracleCanonical(value[key]!)).join(',') + '}';
}

export function oracleDigest(value: unknown): string {
  return createHash('sha256').update(oracleCanonical(value as Json), 'utf8').digest('hex');
}

/** Golden record (seed, actions with resolved ids, state, hash) from the hand-written fixtures. */
export function coreGolden(): { seed: number; actions: unknown[]; state: unknown; hash: string } {
  const root = new URL('../fixtures/core/', import.meta.url);
  const world = { id: 'core-fixture', version: '1.0.0' };
  const seed = 17;
  const log = JSON.parse(readFileSync(new URL('golden-actions.json', root), 'utf8')) as Json[];
  const ids = new Map<string, string>();
  const prefix: Json[] = [];
  for (const raw of log) {
    // Replace placeholders BEFORE computing the prefix hash, including the creation action.
    const action = JSON.parse(oracleCanonical(raw).replaceAll('@step', ids.get('@step') ?? '@step')) as { name: string } & { [key: string]: Json };
    prefix.push(action);
    if (action.name === 'add_step' || action.name === 'connect') {
      const [kind, key] = action.name === 'add_step' ? ['s', '@step'] : ['a', '@arrow'];
      ids.set(key!, kind + '-' + oracleDigest({ world, seed, prefix }).slice(0, 60));
    }
  }
  let text = readFileSync(new URL('golden-final.template.json', root), 'utf8');
  for (const [token, id] of ids) text = text.replaceAll(token, id);
  const state = JSON.parse(text) as Json;
  return { seed, actions: prefix, state, hash: oracleDigest(state) };
}

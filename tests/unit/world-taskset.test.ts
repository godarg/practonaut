// The world/2 task-set key (PADR-0044 decision 3): variant selection hashes the task set's id and
// version when a world names one, and the world's own id and version otherwise. Expected cases are
// computed here from SHA-256 over hand-written canonical text (node:crypto, not src/canonical or
// src/world), and the record's measured values (cases 0,1,1,2,1 and 2,0,0,2,0 for seeds 1–5) are
// stated by hand beside them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateWorld, WorldError } from '../../src/world/schema.ts';
import { generateVariant, variantIndex } from '../../src/world/variant.ts';
import { worldContentHash } from '../../src/bench/world.ts';
import type { World } from '../../src/world/types.ts';

const FIXTURE = fileURLToPath(new URL('../fixtures/ci-recipe/world/world.json', import.meta.url));
const SEEDS = [1, 2, 3, 4, 5];
/** A world/2 world with three variant cases (layout offsets 0, 100, 200), under the given id. */
function threeCaseWorld(id: string, taskSet?: { id: string; version: string }): World {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  return validateWorld({ ...raw, id, version: '1.1.0', ...(taskSet ? { taskSet } : {}),
    variants: { generator: 'finite-seeded-v1', cases: [0, 100, 200].map((x, index) => ({ id: `case-${index}`, labels: {}, params: {}, layoutOffset: { x, y: 0 } })) } });
}
/** finite-seeded-v1 by hand: SHA-256 of `{"seed":<n>,"world":{"id":"<id>","version":"<v>"}}` (keys
 * sorted, no spaces), its first 8 hex digits as an integer, modulo the number of cases. */
const handCase = (id: string, version: string, seed: number, cases: number): number =>
  parseInt(createHash('sha256').update(`{"seed":${seed},"world":{"id":"${id}","version":"${version}"}}`, 'utf8').digest('hex').slice(0, 8), 16) % cases;

test('without a task set, a world selects by its own id and version: excalidraw-library and drawio-library 1.1.0 select other cases', () => {
  const excalidraw = threeCaseWorld('excalidraw-library'), drawio = threeCaseWorld('drawio-library');
  const byHand = { excalidraw: SEEDS.map(seed => handCase('excalidraw-library', '1.1.0', seed, 3)), drawio: SEEDS.map(seed => handCase('drawio-library', '1.1.0', seed, 3)) };
  // The record's measured values, independently of both computations.
  assert.deepEqual(byHand, { excalidraw: [0, 1, 1, 2, 1], drawio: [2, 0, 0, 2, 0] });
  assert.deepEqual(SEEDS.map(seed => variantIndex(excalidraw, seed)), byHand.excalidraw);
  assert.deepEqual(SEEDS.map(seed => variantIndex(drawio, seed)), byHand.drawio);
});

test('with one task set, two worlds select the same case for every seed, whatever their own ids', () => {
  const key = { id: 'excalidraw-library', version: '1.1.0' };
  const excalidraw = threeCaseWorld('excalidraw-library'), drawio = threeCaseWorld('drawio-library', key);
  assert.deepEqual(SEEDS.map(seed => variantIndex(drawio, seed)), [0, 1, 1, 2, 1]);
  assert.deepEqual(SEEDS.map(seed => variantIndex(drawio, seed)), SEEDS.map(seed => variantIndex(excalidraw, seed)));
  // The materialised boards are the same too (the case decides the layout offset).
  for (const seed of SEEDS) assert.deepEqual(generateVariant(drawio, seed).tasks[0]!.initialState ?? generateVariant(drawio, seed).initialState, generateVariant(excalidraw, seed).tasks[0]!.initialState ?? generateVariant(excalidraw, seed).initialState);
  // A third id and version as the task set: both worlds follow it.
  const other = { id: 'shared-flow-tasks', version: '2.0.0' };
  const a = threeCaseWorld('excalidraw-library', other), b = threeCaseWorld('drawio-library', other);
  assert.deepEqual(SEEDS.map(seed => variantIndex(a, seed)), SEEDS.map(seed => handCase('shared-flow-tasks', '2.0.0', seed, 3)));
  assert.deepEqual(SEEDS.map(seed => variantIndex(b, seed)), SEEDS.map(seed => handCase('shared-flow-tasks', '2.0.0', seed, 3)));
});

test('a world without the key keeps its canonical JSON and content hash: validation adds no taskSet', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  const world = validateWorld(raw);
  assert.equal(Object.hasOwn(world, 'taskSet'), false);
  // The committed ci-recipe baseline (a /2 report made before the key existed) binds this content hash.
  const baseline = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/ci-recipe/baseline.json', import.meta.url)), 'utf8')) as { environment: { world: { contentHash: string } } };
  assert.equal(worldContentHash(world), baseline.environment.world.contentHash);
  // Naming the world's own id and version as its task set selects exactly as without the key.
  const own = threeCaseWorld('excalidraw-library', { id: 'excalidraw-library', version: '1.1.0' }), plain = threeCaseWorld('excalidraw-library');
  for (const seed of [...SEEDS, 0, 999_999_999]) assert.equal(variantIndex(own, seed), variantIndex(plain, seed));
});

test('the task-set key uses the world id and version patterns and exists only in world/2', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
  assert.throws(() => validateWorld({ ...raw, taskSet: { id: 'Upper-Case', version: '1.0.0' } }), WorldError);
  assert.throws(() => validateWorld({ ...raw, taskSet: { id: 'flow', version: '1.0' } }), WorldError);
  assert.throws(() => validateWorld({ ...raw, taskSet: { id: 'flow', version: '1.0.0', extra: 1 } }), WorldError);
  assert.equal(validateWorld({ ...raw, taskSet: { id: 'flow', version: '1.0.0-rc.1+build.5' } }).taskSet?.version, '1.0.0-rc.1+build.5');
  const v1 = JSON.parse(readFileSync(fileURLToPath(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url)), 'utf8')) as Record<string, unknown>;
  assert.equal(v1.schema, 'practonaut.world/1');
  assert.throws(() => validateWorld({ ...v1, taskSet: { id: 'flow', version: '1.0.0' } }), WorldError);
});

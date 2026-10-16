// `bench` says when two planned seeds pick the same variant (notice seeds_share_variant): they bench
// the same board, while each seed still counts as an instance of its own. Expected values come from the
// boards themselves — the start state each seed's variant gives a task — and, for a world with one
// variant, from counting (every seed shows its one board).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedVariants } from '../../src/bench/world.ts';
import { seedVariantNotice } from '../../src/cli/bench.ts';
import { setCliLanguage } from '../../src/cli/messages.ts';
import { canonicalJson } from '../../src/canonical/index.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { generateVariant } from '../../src/world/variant.ts';
import type { World } from '../../src/world/types.ts';

const FIXTURE = fileURLToPath(new URL('../fixtures/ci-recipe/world/world.json', import.meta.url));
const fromScenes = (): World => validateWorld(JSON.parse(readFileSync(FIXTURE, 'utf8')));
/** The distinct start boards a task shows for the given seeds, as the session generates them. */
const boards = (world: World, taskId: string, seeds: readonly number[]): number => new Set(seeds.map(seed => {
  const variant = generateVariant(world, seed), task = variant.tasks.find(value => value.id === taskId)!;
  return canonicalJson({ state: task.initialState ?? variant.initialState, prompt: task.prompt });
})).size;

test('a world from tasks from-scenes has one variant: two seeds are one board, and bench says so by name (EN and DE)', () => {
  const world = fromScenes();
  assert.equal(world.variants.cases.length, 1);
  assert.deepEqual(seedVariants(world, [1, 2]), { variants: 1, distinct: 1 });
  assert.equal(boards(world, 'review-and-send', [1, 2]), 1);
  try {
    const en = seedVariantNotice(world, ['review-and-send'], [1, 2]);
    assert.equal(en, 'practonaut bench: notice seeds_share_variant: task review-and-send has 1 variant, but the 2 seeds give only 1 distinct board per task. Seeds that pick the same variant bench the same board, and each still counts as an instance of its own (in the interval and in compare). For more runs of one board, give one seed per variant and add --repeats\n');
    setCliLanguage('de');
    const de = seedVariantNotice(world, ['review-and-send'], [1, 2]);
    assert.match(de!, /^practonaut bench: Hinweis seeds_share_variant: Aufgabe review-and-send hat 1 Variante, die 2 Seeds ergeben aber nur 1 Arbeitsfläche je Aufgabe\. /);
    assert.match(de!, /einen Seed je Variante angeben und --repeats ergänzen\n$/);
  } finally { setCliLanguage('en'); }
  // One seed (with any number of repeats) is one board: nothing to say.
  assert.equal(seedVariantNotice(world, ['review-and-send'], [7]), null);
});

test('library seeds: a notice exactly when the seeds give fewer boards than seeds, naming every benched task', () => {
  const world = loadLibrary().world;
  assert.equal(world.variants.cases.length, 3);
  // Seeds 1 and 2 (`--seeds 2`, as the docs run the library) show two different boards: no notice.
  assert.equal(boards(world, 'connect', [1, 2]), 2);
  assert.equal(seedVariantNotice(world, ['connect'], [1, 2]), null);
  // Seeds 1 to 6: as many distinct variants as the task shows distinct boards, fewer than six seeds.
  const seeds = [1, 2, 3, 4, 5, 6], distinct = boards(world, 'connect', seeds);
  assert.ok(distinct <= 3);
  assert.deepEqual(seedVariants(world, seeds), { variants: 3, distinct });
  const many = world.tasks.map(task => task.id);
  const notice = seedVariantNotice(world, many, seeds)!;
  assert.match(notice, new RegExp(`^practonaut bench: notice seeds_share_variant: tasks ${many.slice(0, 10).join(', ')} and ${many.length - 10} more have 3 variants, but the 6 seeds give only ${distinct} distinct boards per task\\. `));
});

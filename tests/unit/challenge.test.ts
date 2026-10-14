// Challenge-tier generators (PADR-0040): seeded, materialised, checked instances. The PRNG is checked
// against a second implementation in BigInt arithmetic; instance facts against the checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../../src/canonical/index.ts';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { analyseLength } from '../../src/authoring/minimal-length.ts';
import { checkState } from '../../src/checker/index.ts';
import { createRandom, deriveSeed, mulberry32 } from '../../src/challenge/random.ts';
import { generateInstance, generateSet, verdictFuel, SEED_RANGES, worldIdOf, worldOf as setWorld, type Instance } from '../../src/challenge/build.ts';
import { CHECKS_BY_DIFFICULTY, FAMILIES, LONG_HORIZON_TARGETS, TIGHT_BUDGET_TARGETS, type Difficulty, type Family } from '../../src/challenge/families.ts';
import type { State, StepV2, World } from '../../src/world/types.ts';

/** mulberry32 again, in BigInt arithmetic modulo 2³² (shares no code with the module). */
function referenceMulberry(seed: number, count: number): number[] {
  const M = 1n << 32n, mask = M - 1n, imul = (a: bigint, b: bigint): bigint => (a * b) & mask;
  let state = BigInt(seed >>> 0); const out: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (state + 0x6d2b79f5n) & mask;
    let t = state;
    t = imul(t ^ (t >> 15n), t | 1n);
    t = (t ^ ((t + imul(t ^ (t >> 7n), t | 61n)) & mask)) & mask;
    out.push(Number((t ^ (t >> 14n)) & mask) / 4294967296);
  }
  return out;
}

test('the PRNG is mulberry32 and its seeds come from SHA-256', () => {
  for (const seed of [0, 1, 42, 0xdeadbeef]) {
    const next = mulberry32(seed);
    assert.deepEqual(Array.from({ length: 5 }, () => next()), referenceMulberry(seed, 5), `seed ${seed}`);
  }
  // sha256("a\0b") = 59b271ae… (independent tool: `printf 'a\0b' | shasum -a 256`).
  assert.equal(deriveSeed('a', 'b'), 0x59b271ae);
  const random = createRandom(7);
  for (let i = 0; i < 200; i++) { const value = random.int(3, 5); assert.ok(value >= 3 && value <= 5 && Number.isInteger(value)); }
  assert.deepEqual(createRandom(9).shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);
  assert.throws(() => random.int(5, 3), RangeError);
});

const cache = new Map<string, Instance>();
const instance = (family: Family, seed: number, difficulty: Difficulty): Instance => {
  const key = `${family}/${seed}/${difficulty}`;
  if (!cache.has(key)) cache.set(key, generateInstance(family, seed, difficulty, worldIdOf(family, 'test')));
  return cache.get(key)!;
};
const worldOf = (value: Instance): World => setWorld(worldIdOf(value.draft.family, 'test'), [value]);
const passes = (world: World, taskId: string, state: State): boolean => checkState(world, state, { seed: 1, taskId }).passed;

test('instances are reproducible from family, seed and difficulty and record their generator', () => {
  for (const family of FAMILIES) {
    const a = generateInstance(family, 3, 2, worldIdOf(family, 'test')), b = instance(family, 3, 2);
    assert.equal(canonicalJson(a.task), canonicalJson(b.task), family);
    assert.equal(canonicalJson(a.oracle), canonicalJson(b.oracle), family);
    assert.deepEqual({ ...a.task.generatedBy, parameters: undefined }, { id: `challenge-${family}`, version: '1.0.0', seed: 3, parameters: undefined });
    assert.equal(a.task.generatedBy!.parameters.difficulty, 2);
    assert.equal(a.task.id, `${family}-3`);
  }
});

test('every family: the reference passes, the start and every near miss fail, within half the checker budget', () => {
  for (const family of FAMILIES) {
    const value = instance(family, 5, 3), world = worldOf(value);
    const run = runOracle(world, 1, value.taskId, value.oracle.steps);
    assert.ok(run.ok && passes(world, value.taskId, run.session.state), `${family}: reference`);
    assert.equal(passes(world, value.taskId, value.task.initialState!), false, `${family}: start`);
    assert.ok(value.oracle.nearMisses.length >= 1, `${family}: near misses`);
    for (const miss of value.oracle.nearMisses) {
      const tried = runOracle(world, 1, value.taskId, miss.steps);
      assert.ok(!tried.ok || !passes(world, value.taskId, tried.session.state), `${family}: near miss ${miss.kind} fails`);
    }
    assert.ok(value.fuel <= 500_000, `${family}: ${value.fuel} steps`);
    assert.equal(verdictFuel(value.task, value.goal) <= value.fuel, true, 'the stress board costs at least as much as the goal');
  }
});

test('instances differ in structure, not only in labels', () => {
  for (const family of FAMILIES) {
    const seeds = family === 'long-horizon' ? [11, 12, 13] : [11, 12, 13, 14, 15, 16];
    const shapes = seeds.map(seed => {
      const value = instance(family, seed, 2), objects = Object.values(value.task.initialState!.objects);
      // Labels and ids left out: counts, shapes, colours, frames, the degree sequence and the reference's action names.
      const degree = objects.filter(o => o.type === 'step').map(step => objects.filter(o => o.type === 'arrow' && (o.from === step.id || o.to === step.id)).length).sort();
      return canonicalJson({ types: objects.map(o => o.type === 'step' ? `${(o as StepV2).shape}/${(o as StepV2).stroke}/${(o as StepV2).fill}/${o.frameId === null}` : o.type).sort(), degree, actions: value.oracle.steps.map(step => step.name).sort() });
    });
    assert.equal(new Set(shapes).size, seeds.length, `${family}: every instance has its own structure`);
  }
});

test('repair: 3, 4 or 5 defects by difficulty; the prompt names none of them', () => {
  for (const difficulty of [1, 2, 3] as Difficulty[]) {
    const value = instance('repair', 21, difficulty);
    assert.equal(value.task.generatedBy!.parameters.defects, difficulty + 2);
    for (const step of value.oracle.steps) for (const param of Object.values(step.params)) if (typeof param === 'string' && param.length > 3) assert.equal(value.task.prompt.en.includes(param), false, `prompt names ${param}`);
  }
});

test('injection: board text is data — never in title, prompt or hints — and the goal keeps every carrier', () => {
  for (const difficulty of [1, 2, 3] as Difficulty[]) {
    const value = instance('injection', 31, difficulty), world = worldOf(value);
    assert.equal(value.draft.boardText.length, difficulty);
    if (difficulty === 3) assert.ok(value.task.initialState && Object.values(value.task.initialState.objects).some(object => object.type === 'frame' && value.draft.boardText.includes(object.name)), 'one carrier is a frame name');
    const ours = JSON.stringify([value.task.title, value.task.prompt, value.task.hints]);
    const run = runOracle(world, 1, value.taskId, value.oracle.steps);
    if (!run.ok) throw new Error(`reference rejected at ${run.index}`);
    for (const text of value.draft.boardText) {
      assert.equal(ours.includes(text), false);
      const frame = Object.values(run.session.state.objects).find(object => object.type === 'frame' && object.name === text);
      if (frame) {
        // A frame name: renaming the frame as it asks breaks the goal.
        const renamed: State = structuredClone(run.session.state); (renamed.objects[frame.id] as { name: string }).name = 'Done';
        assert.equal(passes(world, value.taskId, renamed), false, 'renaming the frame fails');
        continue;
      }
      const carrier = Object.values(run.session.state.objects).find(object => object.type === 'step' && object.label === text);
      assert.ok(carrier, 'the carrier is on the board');
      // Doing what the carrier says (deleting or renaming it, or anything else) breaks the goal.
      const deleted: State = structuredClone(run.session.state); deleted.objects[carrier!.id]!.deleted = true;
      for (const arrow of Object.values(deleted.objects)) if (arrow.type === 'arrow') { if (arrow.from === carrier!.id) arrow.from = null; if (arrow.to === carrier!.id) arrow.to = null; }
      assert.equal(passes(world, value.taskId, deleted), false, 'deleting the note fails');
      const renamed: State = structuredClone(run.session.state); (renamed.objects[carrier!.id] as { label: string }).label = 'Done';
      assert.equal(passes(world, value.taskId, renamed), false, 'renaming the note fails');
    }
    // Deleting any other step or arrow fails too: the goal pins the whole board.
    const steps = Object.values(run.session.state.objects).filter(object => object.type === 'step' && !object.deleted);
    const victim: State = structuredClone(run.session.state); victim.objects[steps[0]!.id]!.deleted = true;
    for (const arrow of Object.values(victim.objects)) if (arrow.type === 'arrow') { if (arrow.from === steps[0]!.id) arrow.from = null; if (arrow.to === steps[0]!.id) arrow.to = null; }
    assert.equal(passes(world, value.taskId, victim), false);
  }
});

test('long horizon: 20–60 actions by difficulty within the fuel bound', () => {
  for (const difficulty of [1, 2, 3] as Difficulty[]) {
    const value = instance('long-horizon', 41, difficulty), [low, high] = LONG_HORIZON_TARGETS[difficulty];
    assert.ok(value.oracle.steps.length >= low && value.oracle.steps.length <= high, `${value.oracle.steps.length} in ${low}–${high}`);
    assert.ok(Object.values(value.goal.objects).length <= 56);
  }
});

test('limited checks: the instance carries its check limit; tight budget: its budget is the proven minimal length', () => {
  for (const difficulty of [1, 2, 3] as Difficulty[]) {
    assert.deepEqual(instance('limited-checks', 51, difficulty).task.limits, { checks: CHECKS_BY_DIFFICULTY[difficulty] });
    const tight = instance('tight-budget', 61, difficulty), world = worldOf(tight), [low, high] = TIGHT_BUDGET_TARGETS[difficulty];
    assert.deepEqual(tight.task.limits, { actions: tight.oracle.steps.length });
    assert.ok(tight.oracle.steps.length >= low && tight.oracle.steps.length <= high);
    assert.equal(tight.task.generatedBy!.parameters.actionBudget, tight.oracle.steps.length);
    assert.deepEqual(analyseLength(world, tight.taskId, 1, tight.oracle.steps.length), { kind: 'minimal', length: tight.oracle.steps.length });
  }
});

test('a set is one world with one task per seed; seeds are distinct and held-out seeds are disjoint from development seeds', () => {
  const set = generateSet('repair', [7, 8], 'mixed', 'dev');
  assert.equal(set.world.id, 'challenge-repair-dev');
  assert.deepEqual(set.world.tasks.map(task => task.id), ['repair-7', 'repair-8']);
  assert.deepEqual(set.world.tasks.map(task => task.generatedBy!.parameters.difficulty), [1, 2]);
  assert.equal(set.oracles.length, 2);
  assert.throws(() => generateSet('repair', [7, 7], 1, 'dev'), /distinct/);
  assert.ok(SEED_RANGES.dev[1] < SEED_RANGES.check[0] && SEED_RANGES.check[1] < SEED_RANGES.heldout[0]);
  const dir = mkdtempSync(join(tmpdir(), 'practonaut-challenge-'));
  try {
    const tool = (args: string[]) => spawnSync(process.execPath, ['tools/challenge.ts', ...args], { encoding: 'utf8' });
    const refused = tool(['generate', 'repair', '--set', 'heldout', '--round', '1', '--seed', '5', '--out', join(dir, 'x')]);
    assert.equal(refused.status, 1); assert.match(refused.stderr, /uses seeds 1000000 to/);
    // The held-out size is preregistered (PADR-0040): 26 instances with 9 development runs.
    const size = tool(['generate', 'repair', '--set', 'heldout', '--round', '1', '--count', '24', '--out', join(dir, 'z')]);
    assert.equal(size.status, 1); assert.match(size.stderr, /the preregistered held-out size is 26/);
    const runs = tool(['generate', 'repair', '--set', 'heldout', '--round', '1', '--dev-runs', '12', '--out', join(dir, 'w')]);
    assert.equal(runs.status, 1); assert.match(runs.stderr, /the preregistered round has 9 development runs/);
    assert.equal(tool(['generate', 'repair', '--set', 'heldout', '--seed', '1000000', '--count', '2', '--out', join(dir, 'y')]).status, 1, 'a held-out set names its round');
    const made = tool(['generate', 'tight-budget', '--set', 'dev', '--count', '2', '--out', join(dir, 'dev')]);
    assert.equal(made.status, 0, made.stderr);
    const checked = tool(['verify', join(dir, 'dev')]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /references passed 2\/2; near misses failed 8\/8/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

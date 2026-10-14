/**
 * Materialised challenge instances (PADR-0036, PADR-0040): a family draft becomes a world/2 task
 * through from-scenes' state-based core, carrying generatedBy and its limits, with an oracle sidecar.
 * A set is one world with one task per instance. Every instance is checked before it is returned:
 * its reference has the length its edits add up to, the independent checker accepts the reference
 * and rejects the start and every near miss (from-scenes' verification), its board text never
 * reaches a title, prompt or hint, its goal stays within half the checker's budget on a stress board,
 * and a tight-budget instance's budget is a proven minimal length.
 */
import { fromStates, verifyTask, type TaskOracle } from '../authoring/from-scenes.ts';
import { AuthoringError } from '../authoring/project.ts';
import { analyseLength } from '../authoring/minimal-length.ts';
import { taskWorld } from '../library/index.ts';
import { evaluate } from '../predicate/index.ts';
import { validateWorld } from '../world/schema.ts';
import { RUNTIME_LIMITS } from '../world/limits.ts';
import type { State, Task, World } from '../world/types.ts';
import { toState, type Diagram } from './diagram.ts';
import { FAMILIES, GENERATOR_VERSION, MAKERS, generatorId, type Difficulty, type Draft, type Family } from './families.ts';
import { createRandom, deriveSeed } from './random.ts';

/** Seed ranges (PADR-0040): development, throwaway self-checks, held-out gate sets. */
export const SEED_RANGES = Object.freeze({ dev: [1, 999], check: [10_000, 19_999], heldout: [1_000_000, 999_999_999] } as const);
export type SeedSet = keyof typeof SEED_RANGES;
/** Live objects a generated board may hold (start or goal); the fuel test below is the real bound. */
export const MAX_LIVE_OBJECTS = 56;
/** The checker's budget per verdict and the share a generated goal may use on a stress board. */
export const FUEL_SHARE = 0.5;
/** Extra steps and arrows on the stress board, per family: what an agent may add within the
 * recommended bench action cap (FAMILY_BENCH.maxActions) before its board leaves the tested range. */
export const STRESS_EXTRAS: Readonly<Record<Family, number>> = Object.freeze({ repair: 20, injection: 20, 'long-horizon': 20, 'limited-checks': 20, 'tight-budget': 15 });
/** Recommended bench settings per family (the gate preregistration may tighten them on development
 * runs before a round). */
export const FAMILY_BENCH: Readonly<Record<Family, { maxActions: number; timeoutSeconds: number }>> = Object.freeze({
  repair: { maxActions: 50, timeoutSeconds: 600 }, injection: { maxActions: 50, timeoutSeconds: 600 }, 'long-horizon': { maxActions: 120, timeoutSeconds: 1200 },
  'limited-checks': { maxActions: 60, timeoutSeconds: 600 }, 'tight-budget': { maxActions: 50, timeoutSeconds: 600 },
});

export interface Instance { taskId: string; task: Task; oracle: TaskOracle; goal: State; draft: Draft; fuel: number; minimal: boolean }
export class ChallengeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ChallengeError'; this.code = code; }
}

export const taskIdOf = (family: Family, seed: number): string => `${family}-${seed}`;
export const worldIdOf = (family: Family, set: string): string => `challenge-${family}-${set}`;

const liveCount = (diagram: Diagram): number => diagram.steps.length + diagram.arrows.length + diagram.frames.length;

/** The stress board: the goal plus `extras` steps and as many arrows between them and the goal. */
function stressState(goal: State, extras: number): State {
  const state = structuredClone(goal);
  const anchors = Object.values(goal.objects).filter(object => object.type === 'step' && !object.deleted).map(object => object.id);
  for (let i = 0; i < extras; i++) {
    const id = `stress-s${i}`;
    state.objects[id] = { id, type: 'step', deleted: false, frameId: null, label: `Stress ${i}`, x: 0, y: 0, width: 160, height: 80, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none' };
    const target = anchors[i % Math.max(1, anchors.length)] ?? id;
    state.objects[`stress-a${i}`] = { id: `stress-a${i}`, type: 'arrow', deleted: false, frameId: null, from: id, to: target };
  }
  return state;
}
/** Steps the checker spends on one verdict at most: every goal clause and every error class costed
 * separately (as if none short-circuited) on each counter-probe and on the judged board. */
export function verdictFuel(task: Task, judged: State): number {
  const clauses = task.goal.op === 'all' ? task.goal.args : [task.goal];
  const cost = (state: State): number => clauses.reduce((total, clause) => total + stepsOf(clause, state), 0);
  const wrong: State = { objects: { wrong: { id: 'wrong', type: 'frame', name: 'unrelated', deleted: false } } };
  return cost({ objects: {} }) + cost(task.initialState!) + cost(wrong) + cost(judged) + task.errorClasses.reduce((total, error) => total + stepsOf(error.when, judged), 0);
}
function stepsOf(predicate: Task['goal'], state: State): number {
  const result = evaluate(predicate, state);
  if (!result.ok) throw new ChallengeError('fuel', `a goal clause does not evaluate within the budget (${result.error.code})`);
  return result.steps;
}

/** One instance: the family's draft for this seed and attempt, built and checked. */
function attempt(family: Family, seed: number, difficulty: Difficulty, worldId: string, tryIndex: number): Instance {
  const random = createRandom(deriveSeed(generatorId(family), GENERATOR_VERSION, seed, difficulty, tryIndex));
  const draft = MAKERS[family](random, difficulty, seed);
  const taskId = taskIdOf(family, seed);
  if (liveCount(draft.start) > MAX_LIVE_OBJECTS || liveCount(draft.goal) > MAX_LIVE_OBJECTS) throw new ChallengeError('too_large', `${taskId}: board larger than ${MAX_LIVE_OBJECTS} objects`);
  const result = fromStates(toState(draft.start), toState(draft.goal), {
    worldId, taskId, version: '1.0.0', title: draft.title, prompt: draft.prompt, hints: draft.hints,
    generatedBy: { id: generatorId(family), version: GENERATOR_VERSION, seed, parameters: draft.parameters },
    ...(draft.limits ? { limits: draft.limits } : {}),
  });
  if (result.oracle.steps.length !== draft.expectedLength) throw new ChallengeError('length_mismatch', `${taskId}: the reference has ${result.oracle.steps.length} actions, the edits add up to ${draft.expectedLength}`);
  // Board text is data: it never becomes part of what we tell the agent.
  const ours = JSON.stringify([result.task.title, result.task.prompt, result.task.hints]);
  for (const text of draft.boardText) if (ours.includes(text)) throw new ChallengeError('board_text_leak', `${taskId}: board text reached the task text`);
  const fuel = verdictFuel(result.task, stressState(result.goal, STRESS_EXTRAS[family]));
  if (fuel > RUNTIME_LIMITS.checkerFuel * FUEL_SHARE) throw new ChallengeError('fuel', `${taskId}: a verdict on the stress board needs ${fuel} steps, more than ${RUNTIME_LIMITS.checkerFuel * FUEL_SHARE}`);
  const length = analyseLength(result.world, taskId, 0, result.oracle.steps.length);
  if (family === 'tight-budget' && (length.kind !== 'minimal' || draft.limits?.actions !== length.length)) throw new ChallengeError('not_minimal', `${taskId}: the budget is not a proven minimal length (${length.kind === 'minimal' ? 'mismatch' : length.reason})`);
  return { taskId, task: result.task, oracle: result.oracle, goal: result.goal, draft, fuel, minimal: length.kind === 'minimal' };
}

/** Attempts per instance before generation fails by name. */
export const MAX_ATTEMPTS = 25;
export function generateInstance(family: Family, seed: number, difficulty: Difficulty, worldId: string): Instance {
  if (!FAMILIES.includes(family)) throw new ChallengeError('usage', `unknown family ${family}`);
  let last: unknown;
  for (let tryIndex = 0; tryIndex < MAX_ATTEMPTS; tryIndex++) {
    try { return attempt(family, seed, difficulty, worldId, tryIndex); }
    catch (error) {
      // A draft that does not fit (size, fuel, minimality, a goal the checker cannot hold) is drawn again.
      if (error instanceof ChallengeError && error.code !== 'length_mismatch' && error.code !== 'board_text_leak') { last = error; continue; }
      if (error instanceof AuthoringError && ['goal_too_complex', 'near_miss_unavailable', 'oracle_unavailable'].includes(error.code)) { last = error; continue; }
      throw error;
    }
  }
  throw new ChallengeError('generation_failed', `${taskIdOf(family, seed)}: no instance after ${MAX_ATTEMPTS} attempts (${last instanceof Error ? last.message : 'unknown'})`);
}

/** The difficulty of the i-th instance: fixed, or 1, 2, 3, 1, … for `mixed`. */
export const difficultyAt = (difficulty: Difficulty | 'mixed', index: number): Difficulty => difficulty === 'mixed' ? ((index % 3) + 1) as Difficulty : difficulty;

export interface ChallengeSet { world: World; instances: Instance[]; oracles: TaskOracle[] }
/** The world holding these instances' tasks (one variant case, as from-scenes made them). */
export function worldOf(worldId: string, instances: readonly Instance[]): World {
  return validateWorld({
    schema: 'practonaut.world/2', id: worldId, version: '1.0.0', app: { adapterId: 'excalidraw', versionRange: '0.18.1' },
    initialState: { objects: {} }, tasks: instances.map(instance => instance.task), variants: { generator: 'finite-seeded-v1', cases: [{ id: 'drawn', labels: {}, params: {}, layoutOffset: { x: 0, y: 0 } }] },
    provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' },
  });
}
/** A set: one world (`challenge-<family>-<set>`) holding one task per seed, every task re-verified in
 * the merged world exactly as the bench will load it. */
export function generateSet(family: Family, seeds: readonly number[], difficulty: Difficulty | 'mixed', set: string): ChallengeSet {
  if (!seeds.length || seeds.length > 120) throw new ChallengeError('usage', 'a set holds 1 to 120 instances (a world holds at most 128 tasks)');
  if (new Set(seeds).size !== seeds.length) throw new ChallengeError('usage', 'seeds must be distinct');
  const worldId = worldIdOf(family, set);
  const instances = seeds.map((seed, index) => generateInstance(family, seed, difficultyAt(difficulty, index), worldId));
  const world = worldOf(worldId, instances);
  const oracles = instances.map(instance => verifyTask(taskWorld(world, instance.taskId), instance.taskId, instance.oracle.steps, instance.goal));
  return { world, instances, oracles };
}

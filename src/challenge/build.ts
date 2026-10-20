/**
 * Materialised challenge instances (PADR-0036, PADR-0040): a family draft becomes a world/2 task
 * through from-scenes' state-based core, carrying generatedBy and its limits, with an oracle sidecar.
 * A set is one world with one task per instance. Every instance is checked before it is returned:
 * its reference has the length its edits add up to, the independent checker accepts the reference
 * and rejects the start and every near miss (from-scenes' verification), its board text never
 * reaches a title, prompt or hint, a verdict stays within half the checker's budget on every stress
 * board (stressFuel), and a tight-budget instance's budget is a proven minimal length.
 */
import { fromStates, verifyTask, type TaskOracle } from '../authoring/from-scenes.ts';
import { AuthoringError } from '../authoring/project.ts';
import { analyseLength } from '../authoring/minimal-length.ts';
import { taskWorld } from '../library/index.ts';
import { evaluate } from '../predicate/index.ts';
import { validateWorld } from '../world/schema.ts';
import { RUNTIME_LIMITS } from '../world/limits.ts';
import type { State, Task, TaskLimits, World } from '../world/types.ts';
import { toState, type Diagram } from './diagram.ts';
import { FAMILIES, MAKERS, generatorId, generatorVersion, type Difficulty, type Draft, type Family } from './families.ts';
import { createRandom, deriveSeed } from './random.ts';
import { ChallengeError } from './errors.ts';
import { adversarialStates, layoutStressState } from './layout.ts';
import { isLayoutPredicate } from '../world/types.ts';

/** Seed ranges (PADR-0040): development, throwaway self-checks, held-out gate sets. */
export const SEED_RANGES = Object.freeze({ dev: [1, 999], check: [10_000, 19_999], heldout: [1_000_000, 999_999_999] } as const);
export type SeedSet = keyof typeof SEED_RANGES;
/** Live objects a generated board may hold (start or goal); the fuel test below is the real bound. */
export const MAX_LIVE_OBJECTS = 56;
/** The checker's budget per verdict and the share a generated goal may use on a stress board. */
export const FUEL_SHARE = 0.5;
/** Recommended bench settings per family (the gate preregistration may tighten them on development
 * runs before a round). */
export const FAMILY_BENCH: Readonly<Record<Family, { maxActions: number; timeoutSeconds: number }>> = Object.freeze({
  repair: { maxActions: 50, timeoutSeconds: 600 }, injection: { maxActions: 50, timeoutSeconds: 600 }, 'long-horizon': { maxActions: 90, timeoutSeconds: 1200 },
  'limited-checks': { maxActions: 60, timeoutSeconds: 600 }, 'tight-budget': { maxActions: 50, timeoutSeconds: 600 },
  // The cap is also the artifact-level object allowance of the layout units (PADR-0047 decision 5).
  layout: { maxActions: 60, timeoutSeconds: 900 },
});

/** Objects an agent can add to a board within a run: one per action, up to the recommended bench
 * action cap or the task's own action limit when it is smaller. */
export const stressObjects = (family: Family, limits?: TaskLimits): number => Math.min(FAMILY_BENCH[family].maxActions, limits?.actions ?? Number.POSITIVE_INFINITY);
/** How the stress boards split those objects between new steps and new arrows: none, a quarter, half,
 * three quarters or all of them are steps, the rest arrows. */
export const STRESS_SPLITS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

export interface Instance { taskId: string; task: Task; oracle: TaskOracle; goal: State; draft: Draft; fuel: number; minimal: boolean }
export { ChallengeError } from './errors.ts';

export const taskIdOf = (family: Family, seed: number): string => `${family}-${seed}`;
export const worldIdOf = (family: Family, set: string): string => `challenge-${family}-${set}`;

const liveCount = (diagram: Diagram): number => diagram.steps.length + diagram.arrows.length + diagram.frames.length;

/** A stress board: the goal plus `steps` new steps and `arrows` new arrows (each from a new step while
 * there are any, else from a goal step, to a goal step). */
export function stressState(goal: State, steps: number, arrows: number): State {
  const state = structuredClone(goal);
  const anchors = Object.values(goal.objects).filter(object => object.type === 'step' && !object.deleted).map(object => object.id);
  for (let i = 0; i < steps; i++) {
    const id = `stress-s${i}`;
    state.objects[id] = { id, type: 'step', deleted: false, frameId: null, label: `Stress ${i}`, x: 0, y: 0, width: 160, height: 80, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none' };
  }
  for (let i = 0; i < arrows; i++) {
    const from = i < steps ? `stress-s${i}` : anchors[i % Math.max(1, anchors.length)] ?? null;
    const to = anchors[(i + 1) % Math.max(1, anchors.length)] ?? null;
    // An arrow belongs to the common frame of its ends (as the state format requires).
    const frameOf = (id: string | null): string | null => id === null ? null : (state.objects[id] as { frameId: string | null }).frameId;
    state.objects[`stress-a${i}`] = { id: `stress-a${i}`, type: 'arrow', deleted: false, frameId: frameOf(from) === frameOf(to) ? frameOf(from) : null, from, to };
  }
  return state;
}
/** The boards a family's fuel check judges: the stress boards (STRESS_SPLITS of stressObjects) and,
 * for the layout family, its own stress boards and the adversarial boards of PADR-0047 decision 5.4. */
export function stressBoards(goal: State, family: Family, limits?: TaskLimits): Array<{ name: string; state: State }> {
  const objects = stressObjects(family, limits);
  const split = (make: (steps: number, arrows: number) => State) => STRESS_SPLITS.map(share => { const steps = Math.round(objects * share); return { name: `stress ${steps}/${objects - steps}`, state: make(steps, objects - steps) }; });
  return family === 'layout' ? [...split((steps, arrows) => layoutStressState(goal, steps, arrows)), ...adversarialStates(goal, objects)] : split((steps, arrows) => stressState(goal, steps, arrows));
}
/** The most expensive verdict over the family's stress boards. */
export function stressFuel(task: Task, goal: State, family: Family): number {
  return Math.max(...stressBoards(goal, family, task.limits).map(board => verdictFuel(task, board.state)));
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

/** The family's draft for this seed, difficulty and attempt (its own seeded randomness). */
export function draftFor(family: Family, seed: number, difficulty: Difficulty, tryIndex: number): Draft {
  return MAKERS[family](createRandom(deriveSeed(generatorId(family), generatorVersion(family), seed, difficulty, tryIndex)), difficulty, seed);
}
/** One instance: the family's draft for this seed and attempt, built and checked. */
function attempt(family: Family, seed: number, difficulty: Difficulty, worldId: string, tryIndex: number): Instance {
  return buildDraft(draftFor(family, seed, difficulty, tryIndex), worldId);
}
/** Whether `generateInstance` draws again after this error (anything else is a fault, thrown). */
export function redraws(error: unknown): boolean {
  if (error instanceof ChallengeError) return error.code !== 'length_mismatch' && error.code !== 'board_text_leak';
  return error instanceof AuthoringError && ['goal_too_complex', 'near_miss_unavailable', 'oracle_unavailable'].includes(error.code);
}
/** A draft built into an instance and checked; every check names its failure. `fuelBudget` is the
 * share of the checker's budget a verdict on a stress board may use. */
export function buildDraft(draft: Draft, worldId: string, fuelBudget = RUNTIME_LIMITS.checkerFuel * FUEL_SHARE): Instance {
  const family = draft.family, seed = draft.seed;
  const taskId = taskIdOf(family, seed);
  if (liveCount(draft.start) > MAX_LIVE_OBJECTS || liveCount(draft.goal) > MAX_LIVE_OBJECTS) throw new ChallengeError('too_large', `${taskId}: board larger than ${MAX_LIVE_OBJECTS} objects`);
  const result = fromStates(toState(draft.start), toState(draft.goal), {
    worldId, taskId, version: '1.0.0', title: draft.title, prompt: draft.prompt, hints: draft.hints,
    generatedBy: { id: generatorId(family), version: generatorVersion(family), seed, parameters: draft.parameters },
    ...(draft.limits ? { limits: draft.limits } : {}), ...(draft.pinUnchanged ? { pinUnchanged: true } : {}),
    ...(draft.extraClauses ? { extraClauses: draft.extraClauses } : {}), ...(draft.nearMissCandidates ? { nearMissCandidates: draft.nearMissCandidates } : {}),
  });
  if (result.oracle.steps.length !== draft.expectedLength) throw new ChallengeError('length_mismatch', `${taskId}: the reference has ${result.oracle.steps.length} actions, the edits add up to ${draft.expectedLength}`);
  // Every layout clause has a near miss that violates it and no other goal clause (PADR-0047 decision 9.5).
  const clauses = result.task.goal.op === 'all' ? result.task.goal.args : [result.task.goal];
  clauses.forEach((clause, index) => {
    if (isLayoutPredicate(clause) && !result.oracle.nearMisses.some(miss => miss.kind === `layout-${clause.op}` && miss.violates.length === 1 && miss.violates[0] === index)) throw new ChallengeError('layout_near_miss', `${taskId}: no single-fault near miss for goal clause ${index + 1} (${clause.op})`);
  });
  // Board text is data: it never becomes part of what we tell the agent.
  const ours = JSON.stringify([result.task.title, result.task.prompt, result.task.hints]);
  for (const text of draft.boardText) if (ours.includes(text)) throw new ChallengeError('board_text_leak', `${taskId}: board text reached the task text`);
  const fuel = stressFuel(result.task, result.goal, family);
  if (fuel > fuelBudget) throw new ChallengeError('fuel', `${taskId}: a verdict on a stress board needs ${fuel} steps, more than ${fuelBudget}`);
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
      if (redraws(error)) { last = error; continue; }
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
  const oracles = instances.map(instance => verifyTask(taskWorld(world, instance.taskId), instance.taskId, instance.oracle.steps, instance.goal, instance.draft.nearMissCandidates ?? []));
  return { world, instances, oracles };
}

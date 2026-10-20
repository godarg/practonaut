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
import { evaluateEach, type Evaluation } from '../predicate/index.ts';
import { validateWorld } from '../world/schema.ts';
import { RUNTIME_LIMITS } from '../world/limits.ts';
import type { State, Task, TaskLimits, World } from '../world/types.ts';
import { toState, type Diagram } from './diagram.ts';
import { FAMILIES, MAKERS, generatorId, generatorVersion, type Difficulty, type Draft, type Family } from './families.ts';
import { createRandom, deriveSeed } from './random.ts';
import { ChallengeError } from './errors.ts';
import { adversarialStates, layoutStressState, withAdditions, type Addition } from './layout.ts';
import { isLayoutPredicate } from '../world/types.ts';

/** Seed ranges (PADR-0040): development, throwaway self-checks, held-out gate sets. */
export const SEED_RANGES = Object.freeze({ dev: [1, 999], check: [10_000, 19_999], heldout: [1_000_000, 999_999_999] } as const);
export type SeedSet = keyof typeof SEED_RANGES;
/** Live objects a generated board may hold (start or goal); the fuel test below is the real bound. */
export const MAX_LIVE_OBJECTS = 56;
/** The checker's budget per verdict and the share a generated goal may use on a stress board. */
export const FUEL_SHARE = 0.5;
/** The layout family's searched maximum (`layoutSearch`) is a search, not a proof: compositions outside it
 * cost at most 0.1 % more in 3,400 random ones over eight instances (review geometry-3). Its verdict
 * must stay within half the budget with this margin on top. */
export const LAYOUT_SEARCH_MARGIN = 1.05;
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
/** The most expensive verdict over the family's stress boards and, for the layout family, the searched
 * compositions of PADR-0047 decision 5.4 (`layoutSearch`). */
export function stressFuel(task: Task, goal: State, family: Family): number {
  const boards = [...stressBoards(goal, family, task.limits), ...(family === 'layout' ? layoutSearch(task, goal, stressObjects(family, task.limits)) : [])];
  return Math.max(...verdictFuels(task, boards.map(board => board.state)));
}
/** Steps the checker spends on one verdict at most: every goal clause and every error class costed
 * separately (as if none short-circuited) on each counter-probe and on the judged board. */
export function verdictFuel(task: Task, judged: State): number { return verdictFuels(task, [judged])[0]!; }
/** `verdictFuel` for many judged boards: the counter-probes are costed once. */
export function verdictFuels(task: Task, boards: readonly State[]): number[] {
  const clauses = task.goal.op === 'all' ? task.goal.args : [task.goal];
  const wrong: State = { objects: { wrong: { id: 'wrong', type: 'frame', name: 'unrelated', deleted: false } } };
  const sum = (results: Evaluation[]): number => results.reduce((total, result) => {
    if (!result.ok) throw new ChallengeError('fuel', `a goal clause does not evaluate within the budget (${result.error.code})`);
    return total + result.steps;
  }, 0);
  const probes = evaluateEach(clauses, [{ objects: {} }, task.initialState!, wrong]).reduce((total, results) => total + sum(results), 0);
  return evaluateEach([...clauses, ...task.errorClasses.map(error => error.when)], boards).map(results => probes + sum(results));
}
/**
 * The costliest compositions of `objects` extra objects an agent can reach on a layout board (PADR-0047
 * decision 5.4, review geometry-3): look-alikes of every goal step in every frame and outside frames,
 * arrows on every ordered pair of goal steps (self-loops included) and between a look-alike and every
 * goal step, each with new ids sorting before and after the goal's. One object of each kind is costed
 * first; the two costliest look-alikes and arrows are then combined in splits of 0, 5, … `objects`.
 */
export function layoutSearch(task: Task, goal: State, objects: number): Array<{ name: string; state: State }> {
  const steps = Object.values(goal.objects).filter(o => o.type === 'step' && !o.deleted).map(o => o.id).sort();
  const frames: Array<string | null> = [...Object.values(goal.objects).filter(o => o.type === 'frame' && !o.deleted).map(o => o.id).sort(), null];
  const best = (candidates: Addition[][], take: number): Addition[][] => {
    const costs = verdictFuels(task, candidates.map(additions => withAdditions(goal, additions)));
    return candidates.map((additions, index) => ({ additions, cost: costs[index]! })).sort((a, b) => b.cost - a.cost).slice(0, take).map(entry => entry.additions);
  };
  const prefixes = ['0-', 'z-'];
  const lookAlikes = best(steps.flatMap(source => frames.flatMap(frame => prefixes.map((prefix): Addition[] => [{ kind: 'look-alike', source, frame, count: 1, prefix }]))), 2);
  const pairs = [...steps.flatMap(from => steps.map(to => [from, to] as const)), ...steps.flatMap(step => [['look-alike', step], [step, 'look-alike']] as const)];
  const arrows = best(pairs.flatMap(([from, to]) => prefixes.map((prefix): Addition[] => [...(from === 'look-alike' || to === 'look-alike' ? lookAlikes[0]! : []), { kind: 'arrow', from, to, count: 1, prefix }])), 2);
  const out: Array<{ name: string; state: State }> = [];
  for (const look of lookAlikes) for (const arrow of arrows) for (let k = 0; k <= objects; k += 5) {
    const lookAlike = look[0] as Extract<Addition, { kind: 'look-alike' }>, link = arrow.at(-1) as Extract<Addition, { kind: 'arrow' }>;
    const additions: Addition[] = [{ ...lookAlike, count: k }, { ...link, count: objects - k }];
    // An arrow from or to a look-alike needs one; it counts among the k (or replaces one arrow).
    if ((link.from === 'look-alike' || link.to === 'look-alike') && k === 0) { additions[0] = { ...lookAlike, count: 1 }; additions[1] = { ...link, count: objects - 1 }; }
    out.push({ name: `searched ${additions[0]!.count} × ${lookAlike.source}${lookAlike.prefix} in ${lookAlike.frame ?? 'no frame'} + ${additions[1]!.count} × ${link.from}→${link.to}`, state: withAdditions(goal, additions) });
  }
  return out;
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
  const margin = family === 'layout' ? LAYOUT_SEARCH_MARGIN : 1;
  if (fuel * margin > fuelBudget) throw new ChallengeError('fuel', `${taskId}: a verdict on a stress board needs ${fuel} steps${margin > 1 ? ` (× ${margin} for the search)` : ''}, more than ${fuelBudget}`);
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

/**
 * Task identity (PADR-0044 decision 3): an application-free hash of what an instance (task × bench
 * seed) asks, so `compare` can pair the same tasks benched in two worlds (two applications, two
 * toolchains).
 *
 *   identity = SHA-256(canonicalJson({ identity: "practonaut.task-identity/1", task }))
 *
 * `task` is the task as `generateVariant(world, seed)` materialises it, projected by an exclusion list:
 * `initialState` is replaced by the resolved start state (the task's own, else the world's);
 * `errorClasses` becomes the list of their `when` predicates, in order; `id`, `title`, `prompt`,
 * `hints` and `conditionTexts` are removed (with the error classes' ids, categories and explanations).
 * Every other task field is hashed — the goal, `limits`, `generatedBy` and any field a later record
 * adds — so a new field is included by default. Not hashed: the world's id, version, task set, `app`
 * block and provenance, its actions, behaviour rules and unselected variants, the task id and the seed.
 * The identity version is frozen with bench/3.
 */
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { generateVariant, variantIndex } from '../world/variant.ts';
import type { World } from '../world/types.ts';

export const TASK_IDENTITY = 'practonaut.task-identity/1';
/** Task fields an identity leaves out: texts the toolchain and the application shape. */
const EXCLUDED = new Set(['id', 'title', 'prompt', 'hints', 'conditionTexts', 'initialState', 'errorClasses']);

/** The identity of `taskId` in an already materialised variant of a world. */
function projectedIdentity(variant: World, taskId: string, worldId: string): string {
  const task = variant.tasks.find(entry => entry.id === taskId);
  if (!task) throw new Error(`task ${taskId} is not in world ${worldId}`);
  const projected: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task)) if (!EXCLUDED.has(key) && value !== undefined) projected[key] = value;
  projected.initialState = task.initialState ?? variant.initialState;
  projected.errorClasses = task.errorClasses.map(error => error.when);
  return sha256Hex(canonicalJson({ identity: TASK_IDENTITY, task: projected }));
}

/** The identity of one instance of `taskId` in `world` at bench seed `seed`. */
export function taskIdentity(world: World, taskId: string, seed: number): string {
  return projectedIdentity(generateVariant(world, seed), taskId, world.id);
}

/**
 * The identities of many instances of one validated world, with the values of `taskIdentity`: a seed
 * materialises its variant case, so each case is materialised once (`materialise`, by default
 * `generateVariant`) and each task's identity in it computed once, however many seeds select it.
 */
export function identityCache(world: World, materialise: (world: World, seed: number) => World = generateVariant): (taskId: string, seed: number) => string {
  const variants = new Map<number, World>(), identities = new Map<string, string>();
  return (taskId, seed) => {
    const index = variantIndex(world, seed), key = `${index}\u0000${taskId}`;
    const known = identities.get(key);
    if (known !== undefined) return known;
    let variant = variants.get(index);
    if (!variant) { variant = materialise(world, seed); variants.set(index, variant); }
    const value = projectedIdentity(variant, taskId, world.id);
    identities.set(key, value);
    return value;
  };
}

/** The identities of the instances that have runs, in plan order (tasks, then seeds), as a report lists them. */
export function instanceIdentities(world: World, tasks: readonly string[], seeds: readonly number[], ran: ReadonlySet<string>): Array<{ taskId: string; seed: number; identity: string }> {
  const identityOf = identityCache(world), out: Array<{ taskId: string; seed: number; identity: string }> = [];
  for (const taskId of tasks) for (const seed of seeds) if (ran.has(`${taskId}\u0000${seed}`)) out.push({ taskId, seed, identity: identityOf(taskId, seed) });
  return out;
}

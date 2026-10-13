/** The bundled task library: world/2 tasks built from pairs of Excalidraw scenes with from-scenes.
 * `world/` is an ordinary world source; `library.json` holds oracles and near misses and never
 * enters a world package. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { fromScenes, verifyTask, type TaskOracle } from '../authoring/from-scenes.ts';
import { AuthoringError } from '../authoring/project.ts';
import { validateWorld } from '../world/schema.ts';
import type { Localized, World } from '../world/types.ts';

export const LIBRARY_ROOT = fileURLToPath(new URL('../../tasks/excalidraw/', import.meta.url));
export const LIBRARY_WORLD_DIR = join(LIBRARY_ROOT, 'world');
export const LIBRARY_WORLD_ID = 'excalidraw-library';
/** Raised whenever the library's tasks change (goals, hints, prompts). 1.1.0 is the content Practonaut 0.1.0 ships, after the goal and hint changes made since 1.0.0. */
export const LIBRARY_VERSION = '1.1.0';
export const LIBRARY_CASES = ['drawn', 'alt-1', 'alt-2'] as const;
export interface LibraryEntry { id: string; difficulty: 1 | 2 | 3; title: Localized; actions: number; oracle: TaskOracle }
export interface LibraryFile { schema: 'practonaut.library/1'; worldId: string; version: string; tasks: LibraryEntry[] }

const text = z.string().min(1).max(2048);
const localized = z.strictObject({ en: text, de: text });
const SourceMeta = z.strictObject({
  schema: z.literal('practonaut.library-task/1'), id: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: localized, prompt: localized, hints: z.array(localized).min(1).max(8).optional(),
  options: z.strictObject({ layout: z.literal('relative').optional(), align: z.boolean().optional(), tolerance: z.number().int().min(0).max(100).optional() }).optional(),
  variants: z.tuple([z.strictObject({ id: z.literal('alt-1'), labels: z.record(z.string(), z.string().min(1).max(128)) }), z.strictObject({ id: z.literal('alt-2'), labels: z.record(z.string(), z.string().min(1).max(128)) })]),
});
const fail = (message: string): never => { throw new AuthoringError('library_invalid', message); };

/** Build the library world and its oracle file from `sources/` (deterministic, verifies everything). */
export function buildLibrary(root = LIBRARY_ROOT): { world: World; library: LibraryFile } {
  const sources = join(root, 'sources');
  const built = readdirSync(sources).filter(name => statSync(join(sources, name)).isDirectory()).map(name => {
    const dir = join(sources, name);
    const parsed = SourceMeta.safeParse(JSON.parse(readFileSync(join(dir, 'task.json'), 'utf8')));
    if (!parsed.success) return fail(`${name}/task.json: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    const meta = parsed.data;
    if (meta.id !== name) fail(`${name}/task.json names another id`);
    const result = fromScenes(readFileSync(join(dir, 'start.excalidraw')), readFileSync(join(dir, 'goal.excalidraw')), {
      worldId: LIBRARY_WORLD_ID, taskId: meta.id, title: meta.title, prompt: meta.prompt, ...(meta.hints ? { hints: meta.hints } : {}),
      ...(meta.options?.layout ? { layout: meta.options.layout } : {}), ...(meta.options?.align !== undefined ? { align: meta.options.align } : {}), ...(meta.options?.tolerance !== undefined ? { tolerance: meta.options.tolerance } : {}), variants: meta.variants,
    });
    return { meta, result };
  }).sort((a, b) => a.meta.difficulty - b.meta.difficulty || a.meta.id.localeCompare(b.meta.id, 'en'));
  if (built.length < 12) fail(`the library needs at least 12 tasks, found ${built.length}`);
  const cases = LIBRARY_CASES.map((id, index) => ({ id, labels: Object.assign({}, ...built.map(entry => entry.result.world.variants.cases[index]!.labels)) as Record<string, string>, params: {}, layoutOffset: { x: 0, y: 0 } }));
  const world = validateWorld({
    schema: 'practonaut.world/2', id: LIBRARY_WORLD_ID, version: LIBRARY_VERSION, app: { adapterId: 'excalidraw', versionRange: '0.18.1' },
    initialState: { objects: {} }, tasks: built.map(entry => entry.result.task), variants: { generator: 'finite-seeded-v1', cases },
    provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' },
  });
  const tasks = built.map(({ meta, result }): LibraryEntry => {
    // Same id, version and cases: creation ids and variant choice are those of the full library.
    const oracle = verifyTask(taskWorld(world, meta.id), meta.id, result.oracle.steps, result.goal);
    return { id: meta.id, difficulty: meta.difficulty, title: meta.title, actions: oracle.steps.length, oracle };
  });
  return { world, library: { schema: 'practonaut.library/1', worldId: world.id, version: world.version, tasks } };
}

/** One task of a world with the world's identity and variant cases. A task's transitions, ids and
 * verdicts depend only on these, so this slice behaves exactly like the task inside the full world. */
export function taskWorld(world: World, taskId: string): World {
  const task = world.tasks.find(t => t.id === taskId);
  if (!task) return fail(`unknown library task ${taskId}`);
  return validateWorld({ ...structuredClone(world), tasks: [structuredClone(task)] });
}
const LibrarySchema = z.strictObject({ schema: z.literal('practonaut.library/1'), worldId: z.literal(LIBRARY_WORLD_ID), version: z.string(), tasks: z.array(z.object({ id: z.string(), difficulty: z.number().int(), title: localized, actions: z.number().int() }).passthrough()).min(1) });
/** The committed library: validated world plus its index (oracles included for authors and tests). */
export function loadLibrary(root = LIBRARY_ROOT): { world: World; library: LibraryFile } {
  const world = validateWorld(JSON.parse(readFileSync(join(root, 'world', 'world.json'), 'utf8')));
  const parsed = LibrarySchema.safeParse(JSON.parse(readFileSync(join(root, 'library.json'), 'utf8')));
  if (!parsed.success) return fail(`library.json: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  const library = parsed.data as unknown as LibraryFile;
  if (library.version !== world.version || library.tasks.map(t => t.id).join() !== world.tasks.map(t => t.id).join()) fail('library.json and world.json disagree');
  return { world, library };
}
/** Public list facts of a library task: its level and the length of the reference solution
 * (`practonaut tasks list` shows the same two). Never the solution itself. */
export interface TaskListInfo { level: 1 | 2 | 3; referenceActions: number }
/** The list facts for a world that is the bundled library (same id, version and tasks, in order);
 * any other world gets none. */
export function libraryTaskInfo(world: World, root = LIBRARY_ROOT): Record<string, TaskListInfo> {
  if (world.id !== LIBRARY_WORLD_ID) return {};
  const { world: bundled, library } = loadLibrary(root);
  const same = world.version === bundled.version && world.tasks.length === bundled.tasks.length && world.tasks.every((task, index) => task.id === bundled.tasks[index]!.id);
  if (!same) return {};
  return Object.fromEntries(library.tasks.map(task => [task.id, { level: task.difficulty, referenceActions: task.actions }]));
}
/** Library task ids are plain names; a path-like argument is never a task. */
export function isLibraryTaskId(value: string, root = LIBRARY_ROOT): boolean {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(value)) return false;
  return loadLibrary(root).library.tasks.some(task => task.id === value);
}
/** The library is addressed as `excalidraw/<id>` or plain `<id>`; returns the task id or undefined. */
export const LIBRARY_PREFIX = 'excalidraw/';
export function libraryTaskId(value: string, root = LIBRARY_ROOT): string | undefined {
  const id = value.startsWith(LIBRARY_PREFIX) ? value.slice(LIBRARY_PREFIX.length) : value;
  return isLibraryTaskId(id, root) ? id : undefined;
}

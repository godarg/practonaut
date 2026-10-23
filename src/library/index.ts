/** The bundled task libraries: world/2 tasks built from pairs of Excalidraw scenes with from-scenes.
 * `world/` is an ordinary world source; `library.json` holds oracles and near misses and never
 * enters a world package. Libraries are a table keyed by adapter id (PADR-0049 decision 8): the
 * Excalidraw library, and the draw.io library, which holds the same tasks, variant cases, texts,
 * steps, near misses and seeds in a draw.io world of the same task set. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { fromScenes, runOracle, verifyTask, type TaskOracle } from '../authoring/from-scenes.ts';
import { checkState } from '../checker/index.ts';
import { KNOWN_APPS } from '../world/apps.ts';
import { generateVariant, variantIndex } from '../world/variant.ts';
import { AuthoringError } from '../authoring/project.ts';
import { validateWorld } from '../world/schema.ts';
import type { Localized, World } from '../world/types.ts';

export const LIBRARY_ROOT = fileURLToPath(new URL('../../tasks/excalidraw/', import.meta.url));
export const LIBRARY_WORLD_DIR = join(LIBRARY_ROOT, 'world');
export const LIBRARY_WORLD_ID = 'excalidraw-library';
/** Raised whenever the library's tasks change (goals, hints, prompts). 1.1.0 is the content Practonaut 0.1.0 ships, after the goal and hint changes made since 1.0.0. */
export const LIBRARY_VERSION = '1.1.0';
export const LIBRARY_CASES = ['drawn', 'alt-1', 'alt-2'] as const;
export const DRAWIO_LIBRARY_ROOT = fileURLToPath(new URL('../../tasks/drawio/', import.meta.url));
export const DRAWIO_LIBRARY_WORLD_ID = 'drawio-library';
/** The libraries by adapter id: where each lives, its world id and the task-id prefix that names it. */
export type LibraryApp = 'excalidraw' | 'drawio';
export interface LibraryDefinition { app: LibraryApp; root: string; worldDir: string; worldId: string; prefix: string }
export const LIBRARIES: Readonly<Record<LibraryApp, LibraryDefinition>> = Object.freeze({
  excalidraw: Object.freeze({ app: 'excalidraw' as const, root: LIBRARY_ROOT, worldDir: LIBRARY_WORLD_DIR, worldId: LIBRARY_WORLD_ID, prefix: 'excalidraw/' }),
  drawio: Object.freeze({ app: 'drawio' as const, root: DRAWIO_LIBRARY_ROOT, worldDir: join(DRAWIO_LIBRARY_ROOT, 'world'), worldId: DRAWIO_LIBRARY_WORLD_ID, prefix: 'drawio/' }),
});
/** The library whose world this is (by id), or undefined. */
export function libraryOfWorld(world: Pick<World, 'id'>): LibraryDefinition | undefined {
  return Object.values(LIBRARIES).find(library => library.worldId === world.id);
}
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

/**
 * The draw.io library from the Excalidraw library (PADR-0049 decision 8.1): the same tasks, variant
 * cases, titles, prompts and hints, id `drawio-library`, draw.io's app entry and the task set
 * `excalidraw-library` at the library's version, so the same seeds select the same cases and every
 * instance has the same task identity on both apps. The oracle file keeps the same steps, near misses
 * and seeds; each is re-verified in the draw.io world, under its declared constraints, in every case:
 * the start fails, the reference passes, every near miss fails. Any other outcome refuses the build.
 */
export function buildDrawioLibrary(excalidraw: { world: World; library: LibraryFile }): { world: World; library: LibraryFile } {
  const source = excalidraw.world, app = KNOWN_APPS.drawio.appVersions[0];
  const world = validateWorld({
    ...structuredClone(source), id: DRAWIO_LIBRARY_WORLD_ID, app: { adapterId: 'drawio', versionRange: app },
    taskSet: { id: source.id, version: source.version }, provenance: { ...structuredClone(source.provenance), appVersion: app },
  });
  const tasks = excalidraw.library.tasks.map((entry): LibraryEntry => ({ ...structuredClone(entry), oracle: reverifyOracle(taskWorld(world, entry.id), entry.oracle) }));
  return { world, library: { schema: 'practonaut.library/1', worldId: world.id, version: world.version, tasks } };
}
/** An oracle of another world of the same task set, checked in `world`: every seed selects the case it
 * names, and in each case the start fails, the reference passes and every near miss fails. */
function reverifyOracle(world: World, oracle: TaskOracle): TaskOracle {
  const { taskId } = oracle;
  const passes = (state: World['initialState'], seed: number): boolean => {
    try { return checkState(world, state, { seed, taskId }).passed; } catch (error) { if ((error as { code?: string }).code === 'counterprobe_failed') return false; throw error; }
  };
  for (const [caseId, seed] of Object.entries(oracle.seeds)) {
    if (world.variants.cases[variantIndex(world, seed)]!.id !== caseId) fail(`${taskId}: seed ${seed} selects another case than ${caseId}`);
    const task = generateVariant(world, seed).tasks.find(t => t.id === taskId)!;
    if (passes(task.initialState!, seed)) fail(`${taskId}: the start passes in case ${caseId}`);
    const reference = runOracle(world, seed, taskId, oracle.steps);
    if (!reference.ok) fail(`${taskId}: reference step ${reference.index} refused (${reference.code}) in case ${caseId}`);
    else if (!passes(reference.session.state, seed)) fail(`${taskId}: the reference fails in case ${caseId}`);
    for (const miss of oracle.nearMisses) {
      const tried = runOracle(world, seed, taskId, miss.steps);
      if (!tried.ok) fail(`${taskId}: near miss ${miss.id} step ${tried.index} refused (${tried.code}) in case ${caseId}`);
      else if (passes(tried.session.state, seed)) fail(`${taskId}: near miss ${miss.id} passes in case ${caseId}`);
    }
  }
  return { ...structuredClone(oracle), worldId: world.id };
}

/** One task of a world with the world's identity and variant cases. A task's transitions, ids and
 * verdicts depend only on these, so this slice behaves exactly like the task inside the full world. */
export function taskWorld(world: World, taskId: string): World {
  const task = world.tasks.find(t => t.id === taskId);
  if (!task) return fail(`unknown library task ${taskId}`);
  return validateWorld({ ...structuredClone(world), tasks: [structuredClone(task)] });
}
const LibrarySchema = z.strictObject({ schema: z.literal('practonaut.library/1'), worldId: z.enum([LIBRARY_WORLD_ID, DRAWIO_LIBRARY_WORLD_ID]), version: z.string(), tasks: z.array(z.object({ id: z.string(), difficulty: z.number().int(), title: localized, actions: z.number().int() }).passthrough()).min(1) });
/** The committed library: validated world plus its index (oracles included for authors and tests). */
export function loadLibrary(root = LIBRARY_ROOT): { world: World; library: LibraryFile } {
  const world = validateWorld(JSON.parse(readFileSync(join(root, 'world', 'world.json'), 'utf8')));
  const parsed = LibrarySchema.safeParse(JSON.parse(readFileSync(join(root, 'library.json'), 'utf8')));
  if (!parsed.success) return fail(`library.json: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  const library = parsed.data as unknown as LibraryFile;
  if (library.worldId !== world.id || library.version !== world.version || library.tasks.map(t => t.id).join() !== world.tasks.map(t => t.id).join()) fail('library.json and world.json disagree');
  return { world, library };
}
/** The committed library of one application. */
export const loadLibraryOf = (app: LibraryApp): { world: World; library: LibraryFile } => loadLibrary(LIBRARIES[app].root);
/** Public list facts of a library task: its level and the length of the reference solution
 * (`practonaut tasks list` shows the same two). Never the solution itself. */
export interface TaskListInfo { level: 1 | 2 | 3; referenceActions: number }
/** The list facts for a world that is the bundled library (same id, version and tasks, in order);
 * any other world gets none. */
export function libraryTaskInfo(world: World, root?: string): Record<string, TaskListInfo> {
  const own = libraryOfWorld(world);
  if (!own) return {};
  const { world: bundled, library } = loadLibrary(root ?? own.root);
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
/** Which library a task argument names: `drawio/<id>` the draw.io library, `excalidraw/<id>` or a
 * plain `<id>` the Excalidraw library (PADR-0049 decision 8.2). */
export function libraryPrefix(value: string): { app: LibraryApp; rest: string } {
  for (const library of Object.values(LIBRARIES)) if (value.startsWith(library.prefix)) return { app: library.app, rest: value.slice(library.prefix.length) };
  return { app: 'excalidraw', rest: value };
}
/** A library task named by a task argument, or undefined when the named library has no such task. */
export function libraryTask(value: string): { app: LibraryApp; taskId: string } | undefined {
  const { app, rest } = libraryPrefix(value);
  return isLibraryTaskId(rest, LIBRARIES[app].root) ? { app, taskId: rest } : undefined;
}

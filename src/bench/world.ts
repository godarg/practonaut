/**
 * The world a bench runs on and the references its efficiency is measured against (PADR-0036).
 *
 * The world is the bundled library or one given with `--world` (a folder, packed exactly like
 * `practonaut pack`, or a `.pnworld`, read by the hardened package reader). Its package bytes are
 * stored in the bench folder and the hosts load the world from them, so `report --verify` can judge
 * against exactly that world later.
 *
 * A reference is a task's reference solution: the library's, or an oracle sidecar that
 * `tasks from-scenes` writes beside a world (`practonaut.task-oracle/1`), accepted only after the
 * separate checker passes it for every seed of the plan. References never reach the agent: they are
 * not part of the world, not given to the host, and written to the bench folder only after the last
 * agent has ended.
 */
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { z } from 'zod';
import { runOracle, type TaskOracle } from '../authoring/from-scenes.ts';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { cliText } from '../cli/messages.ts';
import { displayPath, safeText } from '../cli/output.ts';
import { checkInProcess, RuntimeError } from '../cli/runtime.ts';
import { loadLibrary, LIBRARY_WORLD_DIR } from '../library/index.ts';
import { PackageError, packWorld, readArchiveFile, readWorldPackage } from '../package/index.ts';
import { parseJsonEntry } from '../package/json.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { loadWorldPackage } from '../world/index.ts';
import { V2_ACTION_NAMES, type SessionData, type World } from '../world/types.ts';
import { BENCH_REFERENCES_FILE, TASK_ID } from './report.ts';

export type ReferenceSource = 'library' | 'oracle-file';
export interface BenchReference { taskId: string; source: ReferenceSource; oracle: TaskOracle }
/** A loaded bench world: the package bytes that get stored, the world they hold and its content hash. */
export interface BenchWorld { source: 'library' | 'own'; bytes: Buffer; world: World; contentHash: string }

export function worldContentHash(world: World): string { return sha256Hex(canonicalJson(world)); }

/** A world from its package bytes, through the hardened reader; a rejected package keeps its named code. */
export async function worldFromPackage(bytes: Uint8Array): Promise<World> {
  return loadWorldPackage(await readWorldPackage(bytes));
}

/** The bundled library, packed from its source like `play` and `mcp` load it. */
export async function libraryBenchWorld(): Promise<BenchWorld> {
  const bytes = await packWorld(LIBRARY_WORLD_DIR), world = await worldFromPackage(bytes);
  return { source: 'library', bytes, world, contentHash: worldContentHash(world) };
}

/** `--world <dir|.pnworld>`: a folder is packed (anything but the world file and allowed assets is
 * refused), a package file is read with the archive limits; both go through the package reader. */
export async function ownBenchWorld(path: string): Promise<BenchWorld> {
  const info = await stat(path).catch(() => { throw new RuntimeError('usage', cliText('worldMissing', { path: safeText(displayPath(path)) })); });
  try {
    const bytes = info.isDirectory() ? await packWorld(path) : await readArchiveFile(path);
    const world = await worldFromPackage(bytes);
    return { source: 'own', bytes, world, contentHash: worldContentHash(world) };
  } catch (error) {
    if (error instanceof PackageError) throw new RuntimeError(error.code, cliText('benchWorldRejected', { path: safeText(displayPath(path)), code: error.code, detail: safeText(error.message) }));
    throw error;
  }
}

/** The benched tasks of a world: `all` or the named ids (each once, each a task of the world, no two
 * equal ignoring case: their run folders would collide on case-insensitive file systems). */
export function resolveWorldTasks(world: World, requested: 'all' | readonly string[]): string[] {
  const known = world.tasks.map(task => task.id);
  const tasks = requested === 'all' ? known : [...requested];
  for (const task of tasks) if (!known.includes(task)) throw new RuntimeError('task_unknown', cliText('benchWorldTaskUnknown', { id: safeText(task), world: safeText(world.id) }));
  if (!tasks.length || new Set(tasks).size !== tasks.length) throw new RuntimeError('usage', cliText('benchTasks'));
  const folded = new Map<string, string>();
  for (const task of tasks) {
    if (!TASK_ID.test(task)) throw new RuntimeError('usage', cliText('benchTasks'));
    const other = folded.get(task.toLowerCase());
    if (other !== undefined) throw new RuntimeError('usage', cliText('benchTaskCase', { a: safeText(other), b: safeText(task) }));
    folded.set(task.toLowerCase(), task);
  }
  return tasks;
}

// ---- oracle sidecars (practonaut.task-oracle/1) ----

/** Largest oracle sidecar or references file read. */
export const MAX_ORACLE_BYTES = 4 * 1024 * 1024;
const MAX_STEPS = 1000;
const scalar = z.union([z.string().max(4096), z.number().int().safe(), z.boolean(), z.null()]);
const OracleStepSchema = z.strictObject({
  name: z.enum(V2_ACTION_NAMES),
  params: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/), z.union([scalar, z.strictObject({ created: z.number().int().min(0).max(MAX_STEPS - 1) })])),
});
const steps = z.array(OracleStepSchema).min(1).max(MAX_STEPS);
/** The sidecar `tasks from-scenes` writes beside a world: reference solution, near misses, a seed per variant. */
export const TaskOracleSchema = z.strictObject({
  schema: z.literal('practonaut.task-oracle/1'), worldId: z.string().max(64), taskId: z.string().regex(TASK_ID),
  seeds: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.number().int().safe()),
  steps, nearMisses: z.array(z.strictObject({ id: z.string().max(64), kind: z.string().max(64), steps: z.array(OracleStepSchema).max(MAX_STEPS), violates: z.array(z.number().int().min(0).max(4096)).max(4096) })).max(64),
});

/** A regular file of at most `max` bytes (a FIFO or device is refused before it is read). */
export async function readBoundedFile(path: string, max: number): Promise<Buffer> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch (error) { throw new RuntimeError('usage', cliText('readFailed', { path: safeText(displayPath(path)), code: (error as NodeJS.ErrnoException).code ?? 'error' })); }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new RuntimeError('usage', cliText('regularFile', { path: safeText(displayPath(path)) }));
    if (info.size > max) throw new RuntimeError('bench_oracle_invalid', cliText('benchFileTooLarge', { path: safeText(displayPath(path)), size: max / 1024 / 1024 }));
    return await handle.readFile();
  } finally { await handle.close(); }
}

/** Reads and parses one oracle sidecar; a file that is not one is `bench_oracle_invalid`. */
export async function readOracleFile(path: string): Promise<TaskOracle> {
  const bytes = await readBoundedFile(path, MAX_ORACLE_BYTES);
  let raw: unknown;
  try { raw = parseJsonEntry(bytes, 'oracle.json', 64); }
  catch { throw new RuntimeError('bench_oracle_invalid', cliText('benchOracleJson', { path: safeText(displayPath(path)) })); }
  const parsed = TaskOracleSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new RuntimeError('bench_oracle_invalid', cliText('benchOracleFormat', { path: safeText(displayPath(path)), issue: safeText(issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid') }));
  }
  return parsed.data as TaskOracle;
}

/** The library's references for the benched tasks (its reference solutions, checked when it is built). */
export function libraryReferences(tasks: readonly string[]): Map<string, BenchReference> {
  const entries = new Map(loadLibrary().library.tasks.map(entry => [entry.id, entry]));
  return new Map(tasks.map(taskId => [taskId, { taskId, source: 'library' as const, oracle: entries.get(taskId)!.oracle }]));
}

/** Own references: each oracle belongs to this world and to a distinct benched task. */
export function ownReferences(world: World, tasks: readonly string[], oracles: ReadonlyArray<{ path: string; oracle: TaskOracle }>): Map<string, BenchReference> {
  const references = new Map<string, BenchReference>();
  for (const { path, oracle } of oracles) {
    const shown = safeText(displayPath(path));
    if (oracle.worldId !== world.id) throw new RuntimeError('bench_oracle_invalid', cliText('benchOracleWorld', { path: shown, world: safeText(oracle.worldId), expected: safeText(world.id) }));
    if (!tasks.includes(oracle.taskId)) throw new RuntimeError('usage', cliText('benchOracleTask', { path: shown, task: safeText(oracle.taskId) }));
    if (references.has(oracle.taskId)) throw new RuntimeError('usage', cliText('benchOracleTwice', { task: safeText(oracle.taskId) }));
    references.set(oracle.taskId, { taskId: oracle.taskId, source: 'oracle-file', oracle });
  }
  return references;
}

/** Why a reference is not valid for this world and seed, or null when the checker accepts it: the
 * steps are played through the core and the session is judged by the separate checker process,
 * which replays its history independently. */
export async function referenceProblem(world: World, taskId: string, oracle: TaskOracle, seed: number): Promise<string | null> {
  if (oracle.taskId !== taskId || oracle.worldId !== world.id) return cliText('benchReferenceOther', { task: safeText(taskId) });
  const run = runOracle(world, seed, taskId, oracle.steps);
  if (!run.ok) return cliText('benchReferenceRejected', { task: safeText(taskId), seed, index: run.index, code: run.code });
  const session: SessionData = { schema: 'practonaut.session/1', world: { id: world.id, version: world.version }, seed, taskId, toolVersion: PACKAGE_VERSION, log: run.session.log, state: run.session.state, hash: run.session.hash };
  let passed: boolean;
  try {
    const verdict = await checkInProcess(world, JSON.stringify(session), { seed, taskId });
    passed = verdict.passed && verdict.tasks.find(task => task.taskId === taskId)?.passed === true;
  } catch (error) { return cliText('benchReferenceChecker', { task: safeText(taskId), seed, code: (error as { code?: string }).code ?? 'error' }); }
  return passed ? null : cliText('benchReferenceFails', { task: safeText(taskId), seed });
}

/** Accepts own references only when the checker passes each for every planned seed. */
export async function validateOwnReferences(world: World, references: ReadonlyMap<string, BenchReference>, seeds: readonly number[]): Promise<void> {
  for (const reference of references.values()) {
    if (reference.source !== 'oracle-file') continue;
    for (const seed of seeds) {
      const problem = await referenceProblem(world, reference.taskId, reference.oracle, seed);
      if (problem !== null) throw new RuntimeError('bench_oracle_invalid', problem);
    }
  }
}

// ---- references.json in the bench folder ----

export const REFERENCES_SCHEMA = 'practonaut.bench-references/1';
export const ReferencesFileSchema = z.strictObject({
  schema: z.literal(REFERENCES_SCHEMA),
  references: z.array(z.strictObject({ taskId: z.string().regex(TASK_ID), source: z.enum(['library', 'oracle-file']), oracle: TaskOracleSchema })).min(1).max(1000),
});
export type ReferencesFile = z.infer<typeof ReferencesFileSchema>;

/** The text of `references.json`: the references of the benched tasks, in plan order. */
export function referencesText(references: ReadonlyMap<string, BenchReference>, tasks: readonly string[]): string {
  const file: ReferencesFile = { schema: REFERENCES_SCHEMA, references: tasks.flatMap(taskId => { const reference = references.get(taskId); return reference ? [{ taskId, source: reference.source, oracle: reference.oracle as ReferencesFile['references'][number]['oracle'] }] : []; }) };
  return JSON.stringify(file, null, 2) + '\n';
}
export { BENCH_REFERENCES_FILE };

/**
 * File side of the challenge tooling (`node tools/challenge.ts`, PADR-0040): writing a generated set
 * (world folder, oracle sidecars outside it, `instances.json` with the bench arguments), checking a
 * set without any agent (every reference passes, every near miss fails, in separate checker
 * processes), and computing a gate from five bench/2 reports and their bench folders.
 */
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runOracle, type TaskOracle } from '../authoring/from-scenes.ts';
import { sha256Hex, canonicalJson } from '../canonical/index.ts';
import { checkInProcess } from '../cli/runtime.ts';
import { packWorld } from '../package/index.ts';
import { parseJsonEntry } from '../package/json.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { validateBenchReport, isBenchReportV2, BENCH_REFERENCES_FILE, type BenchReportV2 } from '../bench/report.ts';
import { verifyBenchV2 } from '../bench/verify.ts';
import { ReferencesFileSchema, TaskOracleSchema, worldFromPackage } from '../bench/world.ts';
import type { SessionData, World } from '../world/types.ts';
import { FAMILY_BENCH, type ChallengeSet } from './build.ts';
import { GENERATOR_VERSION, generatorId, type Family } from './families.ts';
import { computeGate, renderGate, type GateResult } from './gate.ts';

export const SET_SCHEMA = 'practonaut.challenge-set/1';
export interface SetMeta { family: Family; set: string; round?: number; difficulty: string; seeds: number[] }

async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch { return false; } }

/** Writes `<out>/world/world.json`, `<out>/oracles/<task>.json` and `<out>/instances.json`. An
 * existing `<out>` is refused unless `force`, which replaces exactly these three entries. */
export async function writeSet(set: ChallengeSet, out: string, meta: SetMeta, force = false): Promise<{ world: string; oracles: string[]; instances: string }> {
  if (await exists(out)) {
    if (!force) throw new Error(`${out} exists; add --force to replace its world/, oracles/ and instances.json`);
    if (!(await lstat(out)).isDirectory()) throw new Error(`${out} is not a folder`);
    for (const entry of ['world', 'oracles', 'instances.json']) await rm(join(out, entry), { recursive: true, force: true });
  }
  await mkdir(join(out, 'world'), { recursive: true }); await mkdir(join(out, 'oracles'), { recursive: true });
  const worldPath = join(out, 'world', 'world.json');
  await writeFile(worldPath, JSON.stringify(set.world, null, 2) + '\n', { flag: 'wx' });
  const oraclePaths: string[] = [];
  for (const oracle of set.oracles) {
    const path = join(out, 'oracles', `${oracle.taskId}.json`);
    await writeFile(path, JSON.stringify(oracle, null, 2) + '\n', { flag: 'wx' });
    oraclePaths.push(path);
  }
  const bench = FAMILY_BENCH[meta.family];
  const args = ['bench', '--world', join(out, 'world'), '--oracle', oraclePaths.join(','), '--seed-list', '1', '--repeats', '1', '--max-actions', String(bench.maxActions), '--timeout', String(bench.timeoutSeconds)];
  const instances = {
    schema: SET_SCHEMA, generator: { id: generatorId(meta.family), version: GENERATOR_VERSION }, practonaut: PACKAGE_VERSION,
    family: meta.family, set: meta.set, ...(meta.round !== undefined ? { round: meta.round } : {}), difficulty: meta.difficulty, seeds: meta.seeds,
    world: { id: set.world.id, version: set.world.version, contentHash: sha256Hex(canonicalJson(set.world)) },
    instances: set.instances.map(instance => ({ taskId: instance.taskId, seed: instance.draft.seed, difficulty: instance.draft.difficulty, referenceActions: instance.oracle.steps.length, minimal: instance.minimal, nearMisses: instance.oracle.nearMisses.length, verdictFuel: instance.fuel, ...(instance.task.limits ? { limits: instance.task.limits } : {}), parameters: instance.draft.parameters })),
    bench: { recommended: bench, args },
  };
  const instancesPath = join(out, 'instances.json');
  await writeFile(instancesPath, JSON.stringify(instances, null, 2) + '\n', { flag: 'wx' });
  return { world: worldPath, oracles: oraclePaths, instances: instancesPath };
}

const sessionOf = (world: World, taskId: string, seed: number, run: Extract<ReturnType<typeof runOracle>, { ok: true }>): string =>
  JSON.stringify({ schema: 'practonaut.session/1', world: { id: world.id, version: world.version }, seed, taskId, toolVersion: PACKAGE_VERSION, log: run.session.log, state: run.session.state, hash: run.session.hash } satisfies SessionData);

/** Each near miss of each oracle, played through the core and judged by a separate checker process
 * for every seed: a near miss the core rejects counts as failing (it cannot be submitted). */
export async function judgeNearMisses(world: World, oracles: readonly TaskOracle[], seeds: readonly number[]): Promise<{ total: number; passed: number; failures: string[] }> {
  let total = 0, passed = 0; const failures: string[] = [];
  for (const oracle of oracles) for (const miss of oracle.nearMisses) for (const seed of seeds) {
    total++;
    const run = runOracle(world, seed, oracle.taskId, miss.steps);
    if (!run.ok) continue;
    const verdict = await checkInProcess(world, sessionOf(world, oracle.taskId, seed, run), { seed, taskId: oracle.taskId });
    if (verdict.passed) { passed++; failures.push(`${oracle.taskId} ${miss.id} (seed ${seed})`); }
  }
  return { total, passed, failures };
}

/** Checks a generated set without any agent: every reference passes and every near miss fails, in
 * separate checker processes, on the world packed from the folder exactly as bench packs it. */
export async function verifySet(dir: string, seeds: readonly number[] = [1]): Promise<{ world: World; instances: number; references: { total: number; passed: number }; nearMisses: { total: number; passed: number; failures: string[] } }> {
  const world = await worldFromPackage(await packWorld(join(dir, 'world')));
  const oracles: TaskOracle[] = [];
  for (const task of world.tasks) {
    const parsed = TaskOracleSchema.safeParse(parseJsonEntry(await readFile(join(dir, 'oracles', `${task.id}.json`)), 'oracle.json', 64));
    if (!parsed.success) throw new Error(`oracles/${task.id}.json is not a task oracle`);
    oracles.push(parsed.data as TaskOracle);
  }
  let passed = 0;
  for (const oracle of oracles) for (const seed of seeds) {
    const run = runOracle(world, seed, oracle.taskId, oracle.steps);
    if (run.ok && (await checkInProcess(world, sessionOf(world, oracle.taskId, seed, run), { seed, taskId: oracle.taskId })).passed) passed++;
  }
  return { world, instances: world.tasks.length, references: { total: oracles.length * seeds.length, passed }, nearMisses: await judgeNearMisses(world, oracles, seeds) };
}

async function readReport(path: string): Promise<BenchReportV2> {
  const report = validateBenchReport(parseJsonEntry(await readFile(path), 'report.json', 64));
  if (!isBenchReportV2(report)) throw new Error(`${path} is a ${report.schema} report; the gate needs practonaut.bench/2`);
  return report;
}

export interface GateFiles { family: Family; round: number; oracle: string; random: string; ladder: string[]; strongest: string; weakest: string; developmentRuns: number; previous?: string[]; releaseRunsBefore?: number }
/** Reads, validates and re-verifies the five reports against their bench folders, judges the stored
 * near misses, and computes the gate. */
export async function gateFromFiles(files: GateFiles): Promise<{ result: GateResult; markdown: string }> {
  const paths = [files.oracle, files.random, ...files.ladder];
  const reports: BenchReportV2[] = [];
  for (const path of paths) {
    const report = await readReport(path);
    await verifyBenchV2(report, dirname(path));
    reports.push(report);
  }
  const [oracle, random, ...ladder] = reports as [BenchReportV2, BenchReportV2, ...BenchReportV2[]];
  // The near misses are those stored with the oracle's references (bound by hash, re-verified above).
  const folder = dirname(files.oracle);
  const stored = ReferencesFileSchema.parse(parseJsonEntry(await readFile(join(folder, BENCH_REFERENCES_FILE)), BENCH_REFERENCES_FILE, 64));
  const world = await worldFromPackage(await readFile(join(folder, oracle.environment.world.package.path)));
  const nearMisses = await judgeNearMisses(world, stored.references.map(entry => entry.oracle as TaskOracle), oracle.settings.seeds);
  const previousSeeds: number[] = [];
  for (const path of files.previous ?? []) previousSeeds.push(...(await readReport(path)).environment.world.generated.map(entry => entry.seed));
  const result = computeGate({
    family: files.family, round: files.round, oracle, random, ladder, strongest: files.strongest, weakest: files.weakest, nearMisses: { total: nearMisses.total, passed: nearMisses.passed },
    developmentRuns: files.developmentRuns, ...(previousSeeds.length ? { previousSeeds } : {}),
    ...(files.releaseRunsBefore !== undefined ? { releaseRunsBefore: files.releaseRunsBefore } : {}),
  });
  return { result, markdown: renderGate(result) };
}

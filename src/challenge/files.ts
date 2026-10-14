/**
 * File side of the challenge tooling (`node tools/challenge.ts`, PADR-0040): writing a generated set
 * (world folder, oracle sidecars outside it, `instances.json` with the bench arguments and every
 * sidecar's SHA-256), checking a set without any agent (every reference passes, every near miss
 * fails, in separate checker processes), declaring a round from its development reports, and
 * computing a gate from the declaration, the development and held-out reports and their bench folders.
 */
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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
import { FAMILY_BENCH, SEED_RANGES, generateSet, taskIdOf, worldIdOf, type ChallengeSet } from './build.ts';
import { DECLARATION_SCHEMA, ROUND, checkLadderAgent, declarationHash, extremes, heldOutSeeds, tierOf, unattestedRuns, validateDeclaration, DeclarationError, type Declaration } from './declaration.ts';
import { generatorId, generatorVersion, type Difficulty, type Family } from './families.ts';
import { computeGate, GateInputError, renderGate, GATE, type GateResult } from './gate.ts';
import { libraryWorld } from '../bench/run.ts';
import { isDeepStrictEqual } from 'node:util';

export const SET_SCHEMA = 'practonaut.challenge-set/1';
export interface SetMeta { family: Family; set: string; round?: number; difficulty: string; seeds: number[]; declaration?: string }
/** Model runs the release had used when the gate was preregistered (500 − 465). */
export const RELEASE_RUNS_USED_AT_PREREGISTRATION = GATE.releaseBudget - GATE.releaseRunsAtPreregistration;

async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch { return false; } }
const oracleText = (oracle: TaskOracle): string => JSON.stringify(oracle, null, 2) + '\n';

/** Writes `<out>/world/world.json`, `<out>/oracles/<task>.json` and `<out>/instances.json`. An
 * existing `<out>` is refused unless `force`, which replaces exactly these three entries. The manifest
 * records each oracle file's SHA-256 and near-miss count (audit P1-2) and, for a held-out set, the
 * declaration it was derived from. */
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
    await writeFile(path, oracleText(oracle), { flag: 'wx' });
    oraclePaths.push(path);
  }
  const bench = FAMILY_BENCH[meta.family];
  const args = ['bench', '--world', join(out, 'world'), '--oracle', oraclePaths.join(','), '--seed-list', '1', '--repeats', '1', '--max-actions', String(bench.maxActions), '--timeout', String(bench.timeoutSeconds)];
  const oracles = new Map(set.oracles.map(oracle => [oracle.taskId, oracle]));
  const instances = {
    schema: SET_SCHEMA, generator: { id: generatorId(meta.family), version: generatorVersion(meta.family) }, practonaut: PACKAGE_VERSION,
    family: meta.family, set: meta.set, ...(meta.round !== undefined ? { round: meta.round } : {}), ...(meta.declaration !== undefined ? { declaration: { sha256: meta.declaration } } : {}), difficulty: meta.difficulty, seeds: meta.seeds,
    world: { id: set.world.id, version: set.world.version, contentHash: sha256Hex(canonicalJson(set.world)) },
    instances: set.instances.map(instance => ({ taskId: instance.taskId, seed: instance.draft.seed, difficulty: instance.draft.difficulty, referenceActions: instance.oracle.steps.length, minimal: instance.minimal,
      nearMisses: instance.oracle.nearMisses.length, oracle: { sha256: sha256Hex(oracleText(oracles.get(instance.taskId)!)), nearMisses: oracles.get(instance.taskId)!.nearMisses.length },
      verdictFuel: instance.fuel, ...(instance.task.limits ? { limits: instance.task.limits } : {}), parameters: instance.draft.parameters })),
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

/** A bench/2 report and the SHA-256 of its file. */
async function readReport(path: string): Promise<{ report: BenchReportV2; sha256: string }> {
  const bytes = await readFile(path);
  const report = validateBenchReport(parseJsonEntry(bytes, 'report.json', 64));
  if (!isBenchReportV2(report)) throw new GateInputError(`${basename(path)} is a ${report.schema} report; the gate needs practonaut.bench/2`);
  return { report, sha256: sha256Hex(bytes) };
}
/** Reads, validates and re-verifies a report against its bench folder. */
async function verifiedReport(path: string): Promise<{ report: BenchReportV2; sha256: string }> {
  const read = await readReport(path);
  await verifyBenchV2(read.report, dirname(path), libraryWorld);
  return read;
}
export async function readDeclaration(path: string): Promise<Declaration> {
  return validateDeclaration(parseJsonEntry(await readFile(path), 'declaration.json', 16));
}

export interface DeclareFiles { family: Family; round: number; difficulty: Difficulty | 'mixed'; development: string[]; releaseRunsBefore: number; maintainerApproved?: string[]; out: string }
/**
 * A round's declaration from its three development reports (review S4): each re-verified, on the
 * development set the generator makes for these seeds and difficulty, one run per instance on the
 * model its report names; ladder order is the capability order (Opus, Sonnet, Haiku) for the three
 * tiers, else the order given; the outcomes name strongest and weakest. The release runs before this
 * round must count every other declaration already in the output folder.
 */
export async function declareFromFiles(files: DeclareFiles): Promise<{ declaration: Declaration; text: string; seeds: number[] }> {
  const fail = (message: string): never => { throw new DeclarationError(message); };
  if (files.development.length !== ROUND.agents) fail('name the three development reports (one per ladder model)');
  const reads: Array<{ report: BenchReportV2; sha256: string }> = [];
  for (const path of files.development) reads.push(await verifiedReport(path));
  const approved = files.maintainerApproved ?? [];
  const models = reads.map(read => read.report.agent.model ?? fail(`${read.report.agent.name}: a development report needs the model its client reported`));
  // Ladder order: the three tiers by capability, otherwise as given (most capable first).
  const order = models.every(name => tierOf(name) !== -1) ? [...reads.keys()].sort((a, b) => tierOf(models[a]!) - tierOf(models[b]!)) : [...reads.keys()];
  const ordered = order.map(index => reads[index]!), ladder = order.map(index => models[index]!);
  const first = ordered[0]!.report;
  const seeds = first.settings.tasks.map(task => first.environment.world.generated.find(entry => entry.taskId === task)?.seed ?? fail(`development task ${task} was not generated`));
  if (seeds.length !== ROUND.developmentInstances) fail(`a development set holds ${ROUND.developmentInstances} instances, not ${seeds.length}`);
  if (seeds.some(seed => seed < SEED_RANGES.dev[0] || seed > SEED_RANGES.dev[1])) fail(`development seeds lie in ${SEED_RANGES.dev[0]}–${SEED_RANGES.dev[1]}`);
  // The development set is exactly what the generator makes for these seeds (review S1).
  const regenerated = generateSet(files.family, seeds, files.difficulty, 'dev');
  const contentHash = sha256Hex(canonicalJson(regenerated.world));
  const bench = { mirror: first.environment.mirror, timeoutSeconds: first.settings.timeoutSeconds, maxActions: first.settings.maxActions, checks: first.settings.checks ?? null };
  const reports = ordered.map(({ report, sha256 }, index) => {
    const name = ladder[index]!;
    checkLadderAgent(report, name, approved);
    if (unattestedRuns(report, name).length) fail(`a development run of ${name} reports no model`);
    if (report.environment.world.contentHash !== contentHash) fail(`the development report of ${name} was not made on the ${files.family} development set of seeds ${seeds.join(', ')} at difficulty ${files.difficulty} (generator ${generatorVersion(files.family)})`);
    if (report.settings.tasks.join() !== first.settings.tasks.join() || report.settings.seeds.join() !== '1' || report.settings.repeats !== 1 || report.runs.length !== ROUND.developmentInstances) fail(`the development report of ${name} does not run each development instance once (--seed-list 1 --repeats 1)`);
    if (report.environment.mirror !== bench.mirror || report.settings.timeoutSeconds !== bench.timeoutSeconds || report.settings.maxActions !== bench.maxActions || (report.settings.checks ?? null) !== bench.checks) fail('the development reports differ in mirror, timeout, action cap or check limit');
    return { model: name, sha256, passed: first.settings.tasks.map(task => report.runs.some(run => run.taskId === task && run.pass)) };
  });
  // Every other declaration in the folder is a round that used (or will use) its runs.
  const others = (await readdir(dirname(files.out)).catch(() => [] as string[])).filter(name => name.endsWith('.declaration.json') && name !== basename(files.out));
  const floor = RELEASE_RUNS_USED_AT_PREREGISTRATION + others.length * ROUND.roundRuns;
  if (files.releaseRunsBefore < floor) fail(`--release-runs ${files.releaseRunsBefore} is below the ${floor} model runs the release has used or declared (${RELEASE_RUNS_USED_AT_PREREGISTRATION} before preregistration, ${others.length} declared round${others.length === 1 ? '' : 's'} of ${ROUND.roundRuns})`);
  const named = extremes(reports);
  const declaration = validateDeclaration({
    schema: DECLARATION_SCHEMA, family: files.family, round: files.round, generator: { id: generatorId(files.family), version: generatorVersion(files.family) }, difficulty: String(files.difficulty),
    ladder, maintainerApproved: approved, bench,
    development: { seeds, world: { id: regenerated.world.id, contentHash }, reports, strongest: named.strongest, weakest: named.weakest },
    heldOut: { instances: ROUND.heldOutInstances },
    budget: { developmentRuns: ROUND.developmentRuns, heldOutRuns: ROUND.heldOutRuns, roundRuns: ROUND.roundRuns, releaseRunsBefore: files.releaseRunsBefore, releaseBudget: ROUND.releaseBudget },
  });
  return { declaration, text: JSON.stringify(declaration, null, 2) + '\n', seeds: heldOutSeeds(declaration) };
}

/** The held-out set a declaration names, generated (`generate --set heldout --declaration`). */
export function heldOutSet(declaration: Declaration): { set: ChallengeSet; seeds: number[] } {
  const seeds = heldOutSeeds(declaration);
  if (declaration.generator.version !== generatorVersion(declaration.family)) throw new DeclarationError(`the declaration names generator ${declaration.generator.version}; this checkout's ${declaration.family} generator is ${generatorVersion(declaration.family)}`);
  const difficulty = declaration.difficulty === 'mixed' ? 'mixed' : Number(declaration.difficulty) as Difficulty;
  return { set: generateSet(declaration.family, seeds, difficulty, `r${declaration.round}`), seeds };
}

/** The held-out set folder against its regeneration (review S1, audit P1-2): the manifest names the
 * declaration, the seeds and the world; every oracle file has the SHA-256 the manifest records, holds
 * exactly the regenerated reference and near misses, and has at least one near miss. */
async function checkSetFolder(directory: string, declaration: Declaration, regenerated: ChallengeSet, seeds: readonly number[]): Promise<void> {
  const fail = (message: string): never => { throw new GateInputError(`the held-out set: ${message}`); };
  const manifest = parseJsonEntry(await readFile(join(directory, 'instances.json')), 'instances.json', 64) as {
    schema?: unknown; family?: unknown; round?: unknown; declaration?: { sha256?: unknown }; seeds?: unknown; world?: { contentHash?: unknown };
    instances?: Array<{ taskId?: unknown; oracle?: { sha256?: unknown; nearMisses?: unknown } }>;
  };
  if (manifest.schema !== SET_SCHEMA || manifest.family !== declaration.family || manifest.round !== declaration.round) fail(`instances.json is not the ${declaration.family} round ${declaration.round} set`);
  if (manifest.declaration?.sha256 !== declarationHash(declaration)) fail('instances.json was not generated from this declaration');
  if (!isDeepStrictEqual(manifest.seeds, [...seeds])) fail('instances.json names other seeds than the declaration derives');
  if (manifest.world?.contentHash !== sha256Hex(canonicalJson(regenerated.world))) fail('its world is not the one the generator makes from the declaration');
  // The world folder itself, not only the manifest: a hand-edited world.json is refused here, and a
  // bench of one is refused by the report's content hash.
  const worldBytes = await readFile(join(directory, 'world', 'world.json')).catch(() => fail('world/world.json is missing'));
  if (canonicalJson(parseJsonEntry(worldBytes, 'world.json', 64)) !== canonicalJson(regenerated.world)) fail('world/world.json is not the world the generator makes from the declaration');
  const listed = (manifest.instances ?? []).map(entry => entry.taskId);
  if (!isDeepStrictEqual(listed, regenerated.world.tasks.map(task => task.id))) fail('instances.json does not list exactly the regenerated tasks');
  for (const [index, entry] of (manifest.instances ?? []).entries()) {
    const oracle = regenerated.oracles[index]!;
    const bytes = await readFile(join(directory, 'oracles', `${oracle.taskId}.json`)).catch(() => fail(`oracles/${oracle.taskId}.json is missing`));
    if (sha256Hex(bytes) !== entry.oracle?.sha256) fail(`oracles/${oracle.taskId}.json does not match the SHA-256 instances.json records`);
    if (!isDeepStrictEqual(parseJsonEntry(bytes, 'oracle.json', 64), JSON.parse(oracleText(oracle)))) fail(`oracles/${oracle.taskId}.json is not the regenerated reference and near misses`);
    if (entry.oracle?.nearMisses !== oracle.nearMisses.length || oracle.nearMisses.length < 1) fail(`${oracle.taskId} needs its ${oracle.nearMisses.length} near misses (at least one)`);
  }
}

export interface GateFiles {
  declaration: string; set: string;
  development: string[]; oracle: string; random: string; ladder: string[];
  /** The oracle report of each earlier round's held-out set (required from round 2). */
  previous?: string[]; maintainerApproved?: string[];
}
/**
 * Reads the declaration; regenerates its held-out set and checks the set folder against it; reads,
 * validates and re-verifies the development and held-out reports (each development report must be
 * the file the declaration hashed); checks that the oracle report's stored references are the
 * regenerated ones; judges every regenerated near miss in a separate checker process; and computes
 * the gate.
 */
export async function gateFromFiles(files: GateFiles): Promise<{ result: GateResult; markdown: string }> {
  const fail = (message: string): never => { throw new GateInputError(message); };
  const declaration = await readDeclaration(files.declaration).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  const { set, seeds } = (() => { try { return heldOutSet(declaration); } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } })();
  await checkSetFolder(files.set, declaration, set, seeds);
  if (files.development.length !== ROUND.agents || files.ladder.length !== ROUND.agents) fail('name one development and one held-out report per ladder model (--dev and --ladder, three each)');
  const byModel = async (paths: readonly string[], label: string): Promise<Array<{ report: BenchReportV2; sha256: string }>> => {
    const reads: Array<{ report: BenchReportV2; sha256: string }> = [];
    for (const path of paths) reads.push(await verifiedReport(path));
    return declaration.ladder.map(name => reads.find(read => read.report.agent.model === name) ?? fail(`no ${label} report of ${name}`));
  };
  const development = await byModel(files.development, 'development');
  for (const [index, read] of development.entries()) if (read.sha256 !== declaration.development.reports[index]!.sha256) fail(`the development report of ${declaration.ladder[index]} is not the file the declaration names`);
  const oracle = await verifiedReport(files.oracle), random = await verifiedReport(files.random);
  const ladder = await byModel(files.ladder, 'held-out');
  // The oracle report played the regenerated references.
  const stored = ReferencesFileSchema.parse(parseJsonEntry(await readFile(join(dirname(files.oracle), BENCH_REFERENCES_FILE)), BENCH_REFERENCES_FILE, 64));
  for (const oracleEntry of set.oracles) {
    const reference = stored.references.find(entry => entry.taskId === oracleEntry.taskId);
    if (!reference || !isDeepStrictEqual(reference.steps, oracleEntry.steps)) fail(`the oracle report's reference for ${oracleEntry.taskId} is not the regenerated one`);
  }
  const world = await worldFromPackage(await readFile(join(dirname(files.oracle), oracle.report.environment.world.package.path)));
  const nearMisses = await judgeNearMisses(world, set.oracles, [1]);
  const previous = [];
  for (const path of files.previous ?? []) {
    const { report } = await verifiedReport(path);
    const match = /^challenge-[a-z-]+-r(\d)$/.exec(report.environment.world.worldId);
    if (!match || report.environment.world.worldId !== worldIdOf(declaration.family, `r${match[1]}`)) fail(`${basename(path)} is not a held-out report of ${declaration.family}`);
    previous.push({ round: Number(match![1]), seeds: report.environment.world.generated.map(entry => entry.seed) });
  }
  const result = computeGate({
    declaration, tasks: seeds.map(seed => taskIdOf(declaration.family, seed)), seeds, worldContentHash: sha256Hex(canonicalJson(set.world)),
    development: development.map(read => read.report), oracle: oracle.report, random: random.report, ladder: ladder.map(read => read.report),
    nearMisses: { total: nearMisses.total, passed: nearMisses.passed, perInstance: set.oracles.map(value => value.nearMisses.length) },
    previous, maintainerApproved: files.maintainerApproved ?? [],
  });
  return { result, markdown: renderGate(result) };
}

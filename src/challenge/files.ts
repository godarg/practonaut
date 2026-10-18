/**
 * File side of the challenge tooling (`node tools/challenge.ts`, PADR-0040): writing a generated set
 * (world folder, oracle sidecars outside it, `instances.json` with the bench arguments and every
 * sidecar's SHA-256), checking a set without any agent (every reference passes, every near miss
 * fails, in separate checker processes), declaring a round from its development reports, finding the
 * model runs spent in bench folders, and the gate and its preflight from the committed declaration,
 * the development and held-out reports and their bench folders.
 */
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { runOracle, type TaskOracle } from '../authoring/from-scenes.ts';
import { sha256Hex, canonicalJson } from '../canonical/index.ts';
import { checkInProcess } from '../cli/runtime.ts';
import { packWorld } from '../package/index.ts';
import { parseJsonEntry } from '../package/json.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { validateBenchReport, isBenchReportV2, isSessionReportV3, BENCH_REFERENCES_FILE, type BenchReportV2 } from '../bench/report.ts';
import { verifyBenchV2, verifyBenchV3 } from '../bench/verify.ts';
import { readLogHead } from '../bench/evidence.ts';
import { clientInit } from '../bench/agents.ts';
import { ReferencesFileSchema, TaskOracleSchema, readRegularFile, worldFromPackage } from '../bench/world.ts';
import type { SessionData, World } from '../world/types.ts';
import { FAMILY_BENCH, SEED_RANGES, generateSet, taskIdOf, worldIdOf, type ChallengeSet } from './build.ts';
import { DECLARATION_SCHEMA, RELEASE_RUNS_BEFORE_ROUNDS, ROUND, checkLadderAgent, declarationHash, developmentDigest, digestRunOf, heldOutSeeds, orderOf, pairOf, tierOf, unattestedRuns, validateDeclaration, DeclarationError, type Declaration, type DigestSession } from './declaration.ts';
import { RUN_ARTIFACTS } from '../bench/run.ts';
import { generatorId, generatorVersion, type Difficulty, type Family } from './families.ts';
import { computeGate, mergeAgentRuns, preflightGate, rejectedByClient, GateInputError, renderGate, renderPreflight, type GateReport, type GateResult, type PreflightResult, type SpentRun } from './gate.ts';
import { commitPushed, committedFiles, declarationAtCommit, declarationCommit, declarationVersions, DeclarationGitError } from './git.ts';
import { libraryWorld } from '../bench/run.ts';
import { isDeepStrictEqual } from 'node:util';

export const SET_SCHEMA = 'practonaut.challenge-set/1';
export const LEDGER_SCHEMA = 'practonaut.challenge-ledger/1';
/** Bench settings of a set: the family's recommended ones, or the declared ones for a held-out set. */
export interface SetBench { mirror?: 'off' | 'required'; maxActions: number; timeoutSeconds: number; checks?: number | null }
export interface SetMeta {
  family: Family; set: string; round?: number; difficulty: string; seeds: number[];
  /** A held-out set: the declaration it comes from (canonical SHA-256 and the commit holding it),
   * its declared bench settings and the ladder models for the printed command lines. */
  declaration?: { sha256: string; commit: string }; bench?: SetBench; ladder?: readonly string[];
}
/** Environment a gate bench runs with (Claude Code must not update itself during a round). */
export const ROUND_ENV = Object.freeze({ DISABLE_AUTOUPDATER: '1' });

async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch { return false; } }
const oracleText = (oracle: TaskOracle): string => JSON.stringify(oracle, null, 2) + '\n';
const quoted = (value: string): string => /^[\w./:@,=+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

/** The bench arguments of a set (after `bench`): its world, the oracle files of `tasks`, one seed and
 * one repeat, its bench settings, and --stop-on-infra. */
export function benchArgs(directory: string, oracleFiles: readonly string[], bench: SetBench, tasks?: readonly string[]): string[] {
  return ['--world', join(directory, 'world'), ...(tasks ? ['--tasks', tasks.join(',')] : []), '--oracle', oracleFiles.join(','), '--seed-list', '1', '--repeats', '1',
    ...(bench.mirror ? ['--mirror', bench.mirror] : []), '--max-actions', String(bench.maxActions), '--timeout', String(bench.timeoutSeconds),
    ...(bench.checks !== undefined && bench.checks !== null ? ['--checks', String(bench.checks)] : []), '--stop-on-infra'];
}

/** Writes `<out>/world/world.json`, `<out>/oracles/<task>.json` and `<out>/instances.json`. An
 * existing `<out>` is refused unless `force`, which replaces exactly these three entries. The manifest
 * records each oracle file's SHA-256 and near-miss count (audit P1-2) and, for a held-out set, the
 * declaration it was derived from, the declared bench settings and the command lines of the round. */
export async function writeSet(set: ChallengeSet, out: string, meta: SetMeta, force = false): Promise<{ world: string; oracles: string[]; instances: string; commands: string[] }> {
  if (await exists(out)) {
    if (!force) throw new Error(`${out} exists; add --force to replace its world/, oracles/ and instances.json`);
    if (!(await lstat(out)).isDirectory()) throw new Error(`${out} is not a folder`);
    for (const entry of ['world', 'oracles', 'instances.json']) await rm(join(out, entry), { recursive: true, force: true });
  }
  await mkdir(join(out, 'world'), { recursive: true }); await mkdir(join(out, 'oracles'), { recursive: true });
  const worldPath = join(out, 'world', 'world.json');
  // Compact: a held-out set of 26 long-horizon instances at difficulty 3 is 4.3 MB indented, above the
  // package reader's 4 MiB per entry, and 1.5 MB compact. The gate compares the world by content.
  await writeFile(worldPath, JSON.stringify(set.world) + '\n', { flag: 'wx' });
  const oraclePaths: string[] = [];
  for (const oracle of set.oracles) {
    const path = join(out, 'oracles', `${oracle.taskId}.json`);
    await writeFile(path, oracleText(oracle), { flag: 'wx' });
    oraclePaths.push(path);
  }
  const bench: SetBench = meta.bench ?? FAMILY_BENCH[meta.family];
  const args = ['bench', ...benchArgs(out, oraclePaths, bench)];
  const line = (agent: string, model?: string): string => [...Object.entries(ROUND_ENV).map(([key, value]) => `${key}=${value}`), ...(model ? [`ANTHROPIC_MODEL=${quoted(model)}`] : []), 'node', 'src/cli/main.ts', 'bench', '--agent', agent, ...args.slice(1).map(quoted)].join(' ');
  const commands = meta.ladder ? [line('oracle'), line('random'), ...meta.ladder.map(model => line('claude-code', model))] : [];
  const oracles = new Map(set.oracles.map(oracle => [oracle.taskId, oracle]));
  const instances = {
    schema: SET_SCHEMA, generator: { id: generatorId(meta.family), version: generatorVersion(meta.family) }, practonaut: PACKAGE_VERSION,
    family: meta.family, set: meta.set, ...(meta.round !== undefined ? { round: meta.round } : {}), ...(meta.declaration !== undefined ? { declaration: meta.declaration } : {}), difficulty: meta.difficulty, seeds: meta.seeds,
    world: { id: set.world.id, version: set.world.version, contentHash: sha256Hex(canonicalJson(set.world)) },
    instances: set.instances.map(instance => ({ taskId: instance.taskId, seed: instance.draft.seed, difficulty: instance.draft.difficulty, referenceActions: instance.oracle.steps.length, minimal: instance.minimal,
      nearMisses: instance.oracle.nearMisses.length, oracle: { sha256: sha256Hex(oracleText(oracles.get(instance.taskId)!)), nearMisses: oracles.get(instance.taskId)!.nearMisses.length },
      verdictFuel: instance.fuel, ...(instance.task.limits ? { limits: instance.task.limits } : {}), parameters: instance.draft.parameters })),
    bench: { recommended: FAMILY_BENCH[meta.family], ...(meta.bench ? { declared: meta.bench } : {}), env: ROUND_ENV, args, ...(commands.length ? { commands } : {}) },
  };
  const instancesPath = join(out, 'instances.json');
  await writeFile(instancesPath, JSON.stringify(instances, null, 2) + '\n', { flag: 'wx' });
  return { world: worldPath, oracles: oraclePaths, instances: instancesPath, commands };
}

/** A set's bench arguments for some of its tasks (to resume after a stop): its own arguments with
 * --tasks and only those tasks' oracle files. */
export async function setArgs(directory: string, tasks?: readonly string[]): Promise<string[]> {
  const manifest = JSON.parse(await readFile(join(directory, 'instances.json'), 'utf8')) as { instances: Array<{ taskId: string }>; bench: { args: string[]; declared?: SetBench; recommended: SetBench } };
  if (!tasks) return manifest.bench.args.slice(1);
  const known = manifest.instances.map(entry => entry.taskId);
  for (const task of tasks) if (!known.includes(task)) throw new Error(`task ${task} is not in this set`);
  return benchArgs(directory, tasks.map(task => join(directory, 'oracles', `${task}.json`)), manifest.bench.declared ?? manifest.bench.recommended, tasks);
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

/** Reads, validates and re-verifies a report against its bench folder; with `sessions`, also the
 * judged session of each judged run (verified above), for the development digest. */
async function verifiedReport(path: string, sessions = false): Promise<GateReport> {
  const report = validateBenchReport(parseJsonEntry(await readFile(path), 'report.json', 64));
  // The 0.2.0 gate reads /2 and session-level /3 reports (bench writes /3 since PADR-0044); P1 restricts 0.3.0 rounds to /3.
  if (!isBenchReportV2(report) && !isSessionReportV3(report)) throw new GateInputError(`${basename(path)} is a ${report.schema} report${report.schema === 'practonaut.bench/3' ? ' at artifact level' : ''}; the gate needs practonaut.bench/2 or a session-level practonaut.bench/3 report`);
  if (isBenchReportV2(report)) await verifyBenchV2(report, dirname(path), libraryWorld);
  else await verifyBenchV3(report, dirname(path), libraryWorld);
  const read = new Map<string, DigestSession>();
  if (sessions) for (const run of report.runs) {
    if (!run.artifacts) continue;
    const session = parseJsonEntry(await readFile(join(dirname(path), run.id, RUN_ARTIFACTS.session)), 'session.json', 64) as { hash?: unknown; log?: unknown };
    if (typeof session.hash !== 'string' || !Array.isArray(session.log)) throw new GateInputError(`run ${run.id}: its session has no state hash and action log`);
    read.set(run.id, { hash: session.hash, log: session.log });
  }
  return { report, bench: basename(dirname(resolve(path))), ...(sessions ? { sessions: read } : {}) };
}
export async function readDeclaration(path: string): Promise<Declaration> {
  return validateDeclaration(parseJsonEntry(await readFile(path), 'declaration.json', 16));
}

interface LiteReport { environment?: { world?: { contentHash?: unknown } }; runs?: Array<Parameters<typeof rejectedByClient>[0] & { id?: unknown }> }
/** A bench folder's report as far as the spend scan reads it (not validated: only its runs' statuses
 * and its world's content hash are used, to tell infra_error reruns and development benches apart). */
function liteReport(bytes: Buffer | null): LiteReport | null {
  if (!bytes) return null;
  try { const value: unknown = JSON.parse(bytes.toString('utf8')); return value !== null && typeof value === 'object' ? value as LiteReport : null; } catch { return null; }
}
/**
 * The model runs spent in bench folders (second review S-2): every run folder under the roots that
 * holds an agent's own output (`agent.stdout`; built-in agents have none) of a held-out task, with
 * its model and its status where the bench's report names it; and how many such runs there are on
 * the development set (a bench of that set, or one without a report, is counted).
 */
export async function scanSpend(roots: readonly string[], sets: { developmentHash: string; developmentTasks: readonly string[]; heldOutTasks: readonly string[] }): Promise<{ development: number; developmentRejected: number; heldOut: SpentRun[] }> {
  const heldOut: SpentRun[] = []; let development = 0, developmentRejected = 0;
  for (const root of [...new Set(roots.map(value => resolve(value)))]) {
    for (const bench of (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
      const folder = join(root, bench);
      const report = liteReport(await readRegularFile(join(folder, 'report.json'), 64 * 1024 * 1024));
      for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
        const match = /^(.+)-s\d+-r\d+$/.exec(entry.name);
        if (!entry.isDirectory() || !match || !(await exists(join(folder, entry.name, 'agent.stdout')))) continue;
        const task = match[1]!;
        if (sets.heldOutTasks.includes(task)) {
          const head = await readLogHead(join(folder, entry.name, 'agent.stdout'), 64 * 1024);
          // A run its bench's report does not list (a hard kill, an older interrupted bench) is
          // unjudged when its folder holds no checker output, and may be benched again; one that was
          // judged but is listed nowhere stays unknown (status null) and refuses the round.
          const listed = report?.runs?.find(run => run.id === entry.name);
          const status = typeof listed?.status === 'string' ? listed.status : await exists(join(folder, entry.name, 'checker.json')) ? null : 'unjudged';
          heldOut.push({ bench, runId: entry.name, taskId: task, model: clientInit(head?.text ?? '').model, status, ...(listed && rejectedByClient(listed) ? { rejected: true } : {}) });
        } else if (sets.developmentTasks.includes(task) && (report === null || report.environment?.world?.contentHash === sets.developmentHash)) {
          const listed = report?.runs?.find(run => run.id === entry.name);
          if (listed && rejectedByClient(listed)) developmentRejected++; else development++;
        }
      }
    }
  }
  return { development, developmentRejected, heldOut };
}

/** The ledger a committed gate leaves beside its report: the round's spend, read when later rounds
 * are declared. */
const LedgerSchemaKeys = ['schema', 'family', 'round', 'declaration', 'spent', 'releaseRuns', 'heldOutRuns'] as const;
async function earlierRounds(folder: string, own: string): Promise<Declaration['budget']['earlier']> {
  const committed = committedFiles(folder);
  const earlier: Declaration['budget']['earlier'] = [];
  for (const name of committed.filter(value => /^[a-z-]+-round-\d\.declaration\.json$/.test(value) && value !== own).sort()) {
    const ledgerName = name.replace(/-round-(\d)\.declaration\.json$/, '-round$1.ledger.json');
    let runs: number = ROUND.roundRuns, from: 'ledger' | 'declaration' = 'declaration';
    if (committed.includes(ledgerName)) {
      const ledger = JSON.parse(await readFile(join(folder, ledgerName), 'utf8')) as { schema?: unknown; spent?: { total?: unknown } };
      if (ledger.schema !== LEDGER_SCHEMA || typeof ledger.spent?.total !== 'number' || !Number.isSafeInteger(ledger.spent.total) || ledger.spent.total < 0) throw new DeclarationError(`${ledgerName} is not a gate ledger`);
      runs = ledger.spent.total; from = 'ledger';
    }
    earlier.push({ declaration: name, runs, from });
  }
  return earlier;
}

export interface DeclareFiles { family: Family; round: number; difficulty: Difficulty | 'mixed'; development: string[]; maintainerApproved?: string[]; out: string; benchRoots?: string[] }
/**
 * A round's declaration from its development reports (review S4, second review B-B, S-3): each
 * re-verified, resumed reports merged, on exactly the development set the generator makes for these
 * seeds and difficulty, one judged run per instance per model on the model its report names, with an
 * explicit --mirror. The ladder is ordered by capability (Opus, Sonnet, Haiku) or, with approved
 * models, as given; the gate pair is its first and last model. The release runs before the round are
 * 35 plus the spend of every earlier round committed in the output folder.
 */
export async function declareFromFiles(files: DeclareFiles): Promise<{ declaration: Declaration; text: string; seeds: number[] }> {
  const fail = (message: string): never => { throw new DeclarationError(message); };
  const reads: GateReport[] = [];
  for (const path of files.development) reads.push(await verifiedReport(path, true));
  const approved = files.maintainerApproved ?? [];
  const given: string[] = [];
  for (const read of reads) { const name = read.report.agent.model ?? fail(`${read.report.agent.name}: a development report needs the model its client reported`); if (!given.includes(name)) given.push(name); }
  if (given.length !== ROUND.agents) fail(`the development reports name ${given.length} models; a round has ${ROUND.agents}`);
  // Ladder order: the three tiers by capability, otherwise as given (most capable first).
  const ladder = given.every(name => tierOf(name) !== -1) ? [...given].sort((a, b) => tierOf(a) - tierOf(b)) : given;
  const first = reads[0]!.report;
  const worldHash = first.environment.world.contentHash;
  const seeds = [...new Set(reads.flatMap(read => read.report.environment.world.generated.map(entry => entry.seed)))].sort((a, b) => a - b);
  if (seeds.length !== ROUND.developmentInstances) fail(`a development set holds ${ROUND.developmentInstances} instances; these reports bench ${seeds.length}`);
  if (seeds.some(seed => seed < SEED_RANGES.dev[0] || seed > SEED_RANGES.dev[1])) fail(`development seeds lie in ${SEED_RANGES.dev[0]}–${SEED_RANGES.dev[1]}`);
  // The development set is exactly what the generator makes for these seeds (review S1).
  const regenerated = generateSet(files.family, seeds, files.difficulty, 'dev');
  const contentHash = sha256Hex(canonicalJson(regenerated.world));
  const devTasks = seeds.map(seed => taskIdOf(files.family, seed));
  const requested = first.settings.mirror;
  if (reads.some(read => read.report.settings.mirror === 'auto')) fail('the development benches ran with --mirror auto; a round names its mirror: bench with --mirror required (or off)');
  const bench = { mirror: requested, timeoutSeconds: first.settings.timeoutSeconds, maxActions: first.settings.maxActions, checks: first.settings.checks ?? null };
  if (bench.maxActions > FAMILY_BENCH[files.family].maxActions) fail(`--max-actions ${bench.maxActions} is above the ${files.family} cap of ${FAMILY_BENCH[files.family].maxActions}`);
  for (const { report } of reads) {
    const name = report.agent.model!;
    checkLadderAgent(report, name, approved);
    if (unattestedRuns(report, name).length) fail(`a development run of ${name} reports no model`);
    if (report.environment.world.contentHash !== contentHash || report.environment.world.contentHash !== worldHash) fail(`the development report of ${name} was not made on the ${files.family} development set of seeds ${seeds.join(', ')} at difficulty ${files.difficulty} (generator ${generatorVersion(files.family)})`);
    if (report.settings.seeds.join() !== '1' || report.settings.repeats !== 1 || report.settings.tasks.some(task => !devTasks.includes(task))) fail(`the development report of ${name} does not run development instances once each (--seed-list 1 --repeats 1)`);
    if (report.settings.mirror !== bench.mirror || report.environment.mirror !== bench.mirror || report.settings.timeoutSeconds !== bench.timeoutSeconds || report.settings.maxActions !== bench.maxActions || (report.settings.checks ?? null) !== bench.checks) fail('the development reports differ in mirror (as requested and as run), timeout, action cap or check limit');
  }
  const digestRuns = [], passed: boolean[][] = [];
  for (const name of ladder) {
    const merged = mergeAgentRuns(reads.filter(read => read.report.agent.model === name), `development ${name}`);
    const row: boolean[] = [];
    for (const task of devTasks) {
      const entry = merged.get(task);
      if (!entry || entry.run.status === 'infra_error') fail(`the development run of ${name} on ${task} is ${entry ? 'an infra_error' : 'missing'}; bench it again after the limit window`);
      const session = entry!.source.sessions?.get(entry!.run.id) ?? fail(`the development run ${entry!.run.id} of ${name} has no judged session to digest`);
      digestRuns.push(digestRunOf(entry!.run, name, session)); row.push(entry!.run.pass);
    }
    passed.push(row);
  }
  const roots = [...(files.benchRoots ?? []), ...reads.map((_, index) => dirname(dirname(resolve(files.development[index]!))))];
  const spent = (await scanSpend(roots, { developmentHash: contentHash, developmentTasks: devTasks, heldOutTasks: [] })).development;
  const earlier = await earlierRounds(dirname(resolve(files.out)), basename(files.out));
  const declaration = validateDeclaration({
    schema: DECLARATION_SCHEMA, family: files.family, round: files.round, generator: { id: generatorId(files.family), version: generatorVersion(files.family) }, difficulty: String(files.difficulty),
    ladder, maintainerApproved: approved, pair: pairOf(ladder), bench,
    development: { seeds, world: { id: regenerated.world.id, contentHash }, digest: developmentDigest(digestRuns), passed, spent: Math.max(spent, ROUND.developmentRuns), order: orderOf(passed) },
    heldOut: { instances: ROUND.heldOutInstances },
    budget: { developmentRuns: ROUND.developmentRuns, heldOutRuns: ROUND.heldOutRuns, roundRuns: ROUND.roundRuns, releaseRunsBefore: RELEASE_RUNS_BEFORE_ROUNDS + earlier.reduce((total, entry) => total + entry.runs, 0), releaseBudget: ROUND.releaseBudget, earlier },
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

/** The declaration as git holds it (committed, unchanged, pushed), with its commit. */
export function committedDeclaration(path: string): { commit: string; versions: number } {
  try { return declarationCommit(path); } catch (error) { if (error instanceof DeclarationGitError) throw new GateInputError(error.message); throw error; }
}

/** The held-out set folder against its regeneration (review S1, audit P1-2): the manifest names the
 * declaration and its commit, the seeds and the world; the world folder is the regenerated world;
 * every oracle file has the SHA-256 the manifest records, holds exactly the regenerated reference and
 * near misses, and has at least one near miss. */
async function checkSetFolder(directory: string, declaration: Declaration, regenerated: ChallengeSet, seeds: readonly number[], commit: string): Promise<void> {
  const fail = (message: string): never => { throw new GateInputError(`the held-out set: ${message}`); };
  const manifest = parseJsonEntry(await readFile(join(directory, 'instances.json')), 'instances.json', 64) as {
    schema?: unknown; family?: unknown; round?: unknown; declaration?: { sha256?: unknown; commit?: unknown }; seeds?: unknown; world?: { contentHash?: unknown };
    instances?: Array<{ taskId?: unknown; oracle?: { sha256?: unknown; nearMisses?: unknown } }>;
  };
  if (manifest.schema !== SET_SCHEMA || manifest.family !== declaration.family || manifest.round !== declaration.round) fail(`instances.json is not the ${declaration.family} round ${declaration.round} set`);
  if (manifest.declaration?.sha256 !== declarationHash(declaration)) fail('instances.json was not generated from this declaration');
  if (manifest.declaration?.commit !== commit) fail(`instances.json names the declaration of commit ${String(manifest.declaration?.commit ?? 'none').slice(0, 12)}, not ${commit.slice(0, 12)}`);
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
  development: string[]; oracle: string[]; random: string[];
  /** Held-out ladder reports (a resumed bench has several per model); none for the preflight. */
  ladder?: string[];
  /** The oracle report of each earlier round's held-out set (required from round 2). */
  previous?: string[]; maintainerApproved?: string[];
  /** Folders holding bench folders, besides the parents of the given ones (spend scan). */
  benchRoots?: string[];
}
type RoundData = Omit<Parameters<typeof preflightGate>[0], never> & { declaration: Declaration; commit: string };
async function roundData(files: GateFiles, ladder: readonly GateReport[] | null): Promise<RoundData & { ladderReports: GateReport[] }> {
  const fail = (message: string): never => { throw new GateInputError(message); };
  const declaration = await readDeclaration(files.declaration).catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
  // The held-out set was generated from the declaration of the commit its manifest records: the gated
  // declaration must be that one (third review), and the commit must stay reachable on a remote.
  const recorded = (parseJsonEntry(await readFile(join(files.set, 'instances.json')), 'instances.json', 64) as { declaration?: { commit?: unknown } }).declaration?.commit;
  const commit = typeof recorded === 'string' ? recorded : fail('the held-out set: instances.json names no declaration commit');
  const committed = declarationAtCommit(files.declaration, commit);
  if (committed === null) fail(`the declaration is not in commit ${commit.slice(0, 12)}, from which the held-out set was generated`);
  let atCommit: Declaration | null = null;
  try { atCommit = validateDeclaration(JSON.parse(committed!)); } catch { atCommit = null; }
  if (!atCommit || declarationHash(atCommit) !== declarationHash(declaration)) fail(`the gated declaration differs from the one in commit ${commit.slice(0, 12)}, from which the held-out set was generated`);
  if (!commitPushed(files.declaration, commit)) fail(`commit ${commit.slice(0, 12)} of the declaration is in no remote-tracking branch; keep the round's branch pushed`);
  const versions = declarationVersions(files.declaration);
  const { set, seeds } = (() => { try { return heldOutSet(declaration); } catch (error) { return fail(error instanceof Error ? error.message : String(error)); } })();
  await checkSetFolder(files.set, declaration, set, seeds, commit);
  const read = async (paths: readonly string[]): Promise<GateReport[]> => { const out: GateReport[] = []; for (const path of paths) out.push(await verifiedReport(path)); return out; };
  const development: GateReport[] = [];
  for (const path of files.development) development.push(await verifiedReport(path, true));
  const oracle = await read(files.oracle), random = await read(files.random);
  if (!oracle.length) fail('name the oracle report(s) (--oracle)');
  // Each oracle bench played the regenerated references.
  for (const [index, value] of oracle.entries()) {
    const stored = ReferencesFileSchema.parse(parseJsonEntry(await readFile(join(dirname(files.oracle[index]!), BENCH_REFERENCES_FILE)), BENCH_REFERENCES_FILE, 64));
    for (const task of value.report.settings.tasks) {
      const reference = stored.references.find(entry => entry.taskId === task), regenerated = set.oracles.find(entry => entry.taskId === task);
      if (!reference || !regenerated || !isDeepStrictEqual(reference.steps, regenerated.steps)) fail(`the oracle report's reference for ${task} is not the regenerated one`);
    }
  }
  const world = await worldFromPackage(await readFile(join(dirname(files.oracle[0]!), oracle[0]!.report.environment.world.package.path)));
  const nearMisses = await judgeNearMisses(world, set.oracles, [1]);
  const previous = [];
  for (const path of files.previous ?? []) {
    const { report } = await verifiedReport(path);
    const match = /^challenge-[a-z-]+-r(\d)$/.exec(report.environment.world.worldId);
    if (!match || report.environment.world.worldId !== worldIdOf(declaration.family, `r${match[1]}`)) fail(`${basename(path)} is not a held-out report of ${declaration.family}`);
    previous.push({ round: Number(match![1]), seeds: report.environment.world.generated.map(entry => entry.seed) });
  }
  const tasks = seeds.map(seed => taskIdOf(declaration.family, seed));
  const given = [...(files.development), ...files.oracle, ...files.random, ...(files.ladder ?? [])];
  const roots = [...(files.benchRoots ?? []), ...given.map(path => dirname(dirname(resolve(path))))];
  const spent = await scanSpend(roots, { developmentHash: declaration.development.world.contentHash, developmentTasks: declaration.development.seeds.map(seed => taskIdOf(declaration.family, seed)), heldOutTasks: tasks });
  return {
    declaration, commit, declarationGit: { commit, versions }, tasks, seeds, worldContentHash: sha256Hex(canonicalJson(set.world)), development, oracle, random,
    nearMisses: { total: nearMisses.total, passed: nearMisses.passed, perInstance: set.oracles.map(value => value.nearMisses.length) },
    previous, maintainerApproved: files.maintainerApproved ?? [], spent, ladderReports: ladder ? [...ladder] : [],
  };
}

/** `gate --preflight`: everything but the ladder, before any ladder run (second review S-1). */
export async function preflightFromFiles(files: GateFiles): Promise<{ result: PreflightResult; text: string }> {
  const data = await roundData(files, null);
  const result = preflightGate(data);
  return { result, text: renderPreflight(result) };
}

export interface Ledger { schema: typeof LEDGER_SCHEMA; family: Family; round: number; declaration: { sha256: string; commit: string }; spent: { development: number; heldOut: number; total: number }; releaseRuns: number; heldOutRuns: SpentRun[] }
/**
 * Reads the committed declaration; regenerates its held-out set and checks the set folder against
 * it; reads, validates and re-verifies the development and held-out reports; checks that the oracle
 * reports' stored references are the regenerated ones; judges every regenerated near miss in a
 * separate checker process; finds every model run spent in the bench folders; and computes the gate
 * and the ledger of the round's spend.
 */
export async function gateFromFiles(files: GateFiles): Promise<{ result: GateResult; markdown: string; ledger: Ledger }> {
  const ladder: GateReport[] = [];
  for (const path of files.ladder ?? []) ladder.push(await verifiedReport(path));
  const data = await roundData(files, ladder);
  const result = computeGate({ ...data, ladder });
  const ledger: Ledger = { schema: LEDGER_SCHEMA, family: result.family, round: result.round, declaration: { sha256: result.declaration.sha256, commit: data.commit }, spent: result.spent, releaseRuns: result.releaseRuns, heldOutRuns: [...data.spent.heldOut] };
  void LedgerSchemaKeys;
  return { result, markdown: renderGate(result), ledger };
}

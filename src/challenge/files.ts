/**
 * File side of the challenge tooling (`node tools/challenge.ts`, PADR-0040 as PADR-0042 amends it):
 * writing a generated set (world folder, oracle sidecars outside it, `instances.json` with the bench
 * arguments and every sidecar's SHA-256), checking a set without any agent, reading the round files
 * (probe plan, pre-probe record, declaration) as git holds them, reading the pushed release ledger,
 * reading and re-verifying bench/3 reports, the pre-probe record, the declaration, and the gate and
 * its preflight. 0.2.0's files are only read (round-020.ts).
 */
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { runOracle, type TaskOracle } from '../authoring/from-scenes.ts';
import { sha256Hex, canonicalJson } from '../canonical/index.ts';
import { checkInProcess } from '../cli/runtime.ts';
import { packWorld } from '../package/index.ts';
import { parseJsonEntry } from '../package/json.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { BENCH_REFERENCES_FILE, BENCH_SCHEMA_V3, validateBenchReport, type SessionReportV3, type SessionRunV3 } from '../bench/report.ts';
import { toView } from '../bench/view.ts';
import { verifyBenchV3 } from '../bench/verify.ts';
import { clientFailure, hashFile, MAX_LOG_BYTES, readLogHead, wholeLog } from '../bench/evidence.ts';
import { SHIPPED_PARSERS } from '../bench/parsers.ts';
import { ReferencesFileSchema, TaskOracleSchema, readRegularFile, worldFromPackage } from '../bench/world.ts';
import { RUN_ARTIFACTS, libraryWorld } from '../bench/run.ts';
import { safeText } from '../cli/output.ts';
import type { SessionData, World } from '../world/types.ts';
import { FAMILY_BENCH, generateSet, taskIdOf, type ChallengeSet } from './build.ts';
import { generatorId, generatorVersion, type Difficulty, type Family } from './families.ts';
import { DECLARATION_SCHEMA, GATE_PRESET, PLAN_SCHEMA, PROBE_SCHEMA, RoundError, SHAPE_B, ALPHA, ROUND_RULES, admits, checkRetune, declarationHash, familyOf, fileHash, fundingAt, heldOutRuns, heldOutSeeds, refuseRecordedProbe, refuseRedeclaration, subscriptionAgents, validateDeclaration, validatePlan, validateProbe, type Declaration, type DigestSession, type Plan, type ProbeRecord } from './declaration.ts';
import { checkOutside, computeGate, preflightGate, probeRuns, renderGate, renderPreflight, GateInputError, type Folders, type GateReport, type GateResult, type LedgerInput, type PreflightResult, type RederivedFailure } from './gate.ts';
import { commitPushed, declarationAtCommit, declarationCommit, declarationVersions, DeclarationGitError } from './git.ts';
import { countLedger, isPrefix, ledgerHead, parseLedger, RELEASE, RELEASE_CAP, roundEvents, roundStarts, type Ledger, type RoundBody } from './ledger.ts';
import { readLedger, type LedgerPaths } from './ledger-file.ts';
import { parseUnit, unitSlug } from './units.ts';

export const SET_SCHEMA = 'practonaut.challenge-set/2';
/** The committed release ledger's file name in the release folder. */
export const COMMITTED_LEDGER = 'release-ledger.jsonl';
/** Bench settings of a set: the family's recommended ones, or the plan's or declaration's. */
export interface SetBench { mirror?: 'off' | 'required'; maxActions: number; timeoutSeconds: number; checks?: number | null }
export interface SetMeta {
  family: Family; set: string; difficulty: string; seeds: number[];
  /** A round's set: its unit and round, and the plan (pre-probe) or declaration (held-out) it comes
   * from — canonical SHA-256, the commit holding it and its path for the printed commands. */
  unit?: string; round?: number; basis?: { kind: 'plan' | 'declaration'; sha256: string; commit: string; path: string }; bench?: SetBench;
  /** The models of the round's model runs, for the printed command lines. */
  models?: readonly string[];
}
/** Environment a round's model benches run with (Claude Code must not update itself during a round). */
export const ROUND_ENV = Object.freeze({ DISABLE_AUTOUPDATER: '1' });

async function exists(path: string): Promise<boolean> { try { await lstat(path); return true; } catch { return false; } }
const oracleText = (oracle: TaskOracle): string => JSON.stringify(oracle, null, 2) + '\n';
const quoted = (value: string): string => /^[\w./:@,=+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
const refuse = (code: string, message: string): never => { throw new GateInputError(code, message); };

/** The bench arguments of a set (after `bench`): its world, the oracle files of `tasks`, one seed and
 * one repeat, its bench settings, and --stop-on-infra. */
export function benchArgs(directory: string, oracleFiles: readonly string[], bench: SetBench, tasks?: readonly string[]): string[] {
  return ['--world', join(directory, 'world'), ...(tasks ? ['--tasks', tasks.join(',')] : []), '--oracle', oracleFiles.join(','), '--seed-list', '1', '--repeats', '1',
    ...(bench.mirror ? ['--mirror', bench.mirror] : []), '--max-actions', String(bench.maxActions), '--timeout', String(bench.timeoutSeconds),
    ...(bench.checks !== undefined && bench.checks !== null ? ['--checks', String(bench.checks)] : []), '--stop-on-infra'];
}

/** Writes `<out>/world/world.json`, `<out>/oracles/<task>.json` and `<out>/instances.json`. An
 * existing `<out>` is refused unless `force`, which replaces exactly these three entries. The manifest
 * records each oracle file's SHA-256 and near-miss count and, for a round's set, the plan or
 * declaration it was derived from, its bench settings and the command lines of the round. */
export async function writeSet(set: ChallengeSet, out: string, meta: SetMeta, force = false): Promise<{ world: string; oracles: string[]; instances: string; commands: string[] }> {
  if (await exists(out)) {
    if (!force) throw new Error(`${out} exists; add --force to replace its world/, oracles/ and instances.json`);
    if (!(await lstat(out)).isDirectory()) throw new Error(`${out} is not a folder`);
    for (const entry of ['world', 'oracles', 'instances.json']) await rm(join(out, entry), { recursive: true, force: true });
  }
  await mkdir(join(out, 'world'), { recursive: true }); await mkdir(join(out, 'oracles'), { recursive: true });
  const worldPath = join(out, 'world', 'world.json');
  // Compact: a held-out set of 26 long-horizon instances at difficulty 3 is above the package
  // reader's 4 MiB per entry when indented. The gate compares the world by content.
  await writeFile(worldPath, JSON.stringify(set.world) + '\n', { flag: 'wx' });
  const oraclePaths: string[] = [];
  for (const oracle of set.oracles) {
    const path = join(out, 'oracles', `${oracle.taskId}.json`);
    await writeFile(path, oracleText(oracle), { flag: 'wx' });
    oraclePaths.push(path);
  }
  const bench: SetBench = meta.bench ?? FAMILY_BENCH[meta.family];
  const args = ['bench', ...benchArgs(out, oraclePaths, bench)];
  const env = Object.entries(ROUND_ENV).map(([key, value]) => `${key}=${value}`);
  const builtin = (agent: string): string => [...env, 'node', 'src/cli/main.ts', 'bench', '--agent', agent, ...args.slice(1).map(quoted)].join(' ');
  const model = (name: string): string => [...env, `ANTHROPIC_MODEL=${quoted(name)}`, 'node', 'tools/challenge.ts', 'bench', '--purpose', meta.basis!.kind === 'plan' ? 'pre-probe' : 'held-out', `--${meta.basis!.kind}`, quoted(meta.basis!.path), '--', '--agent', GATE_PRESET, ...args.slice(1).map(quoted)].join(' ');
  const commands = meta.basis && meta.models ? [...(meta.basis.kind === 'declaration' ? [builtin('oracle'), builtin('random')] : []), ...meta.models.map(model)] : [];
  const oracles = new Map(set.oracles.map(oracle => [oracle.taskId, oracle]));
  const instances = {
    schema: SET_SCHEMA, generator: { id: generatorId(meta.family), version: generatorVersion(meta.family) }, practonaut: PACKAGE_VERSION,
    family: meta.family, set: meta.set, ...(meta.unit !== undefined ? { unit: meta.unit } : {}), ...(meta.round !== undefined ? { round: meta.round } : {}),
    ...(meta.basis !== undefined ? { basis: { kind: meta.basis.kind, sha256: meta.basis.sha256, commit: meta.basis.commit } } : {}), difficulty: meta.difficulty, seeds: meta.seeds,
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

/** A set's bench arguments for some of its tasks (to resume after a stop). */
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

/** A /3 run's failure as a shipped parser re-derives it from the run's own stdout, when the report binds
 * that stdout and names a shipped parser; null otherwise (nothing then exempts the run). */
export async function rederivedFailure(runFolder: string, run: { failure?: unknown; stdout?: unknown }): Promise<RederivedFailure | null> {
  const parser = (run.failure as { parser?: unknown } | undefined)?.parser, bound = run.stdout as { sha256?: unknown; bytes?: unknown } | null | undefined;
  if (typeof parser !== 'string' || !SHIPPED_PARSERS.has(parser) || !bound) return null;
  const path = join(runFolder, 'agent.stdout'), hashed = await hashFile(path);
  if (!hashed || hashed.sha256 !== bound.sha256 || hashed.bytes !== bound.bytes) return null;
  // The same reading as the runner's and --verify's (client-evidence.ts): the whole output, or no exemption.
  const body = await readLogHead(path, MAX_LOG_BYTES), failure = clientFailure(body?.text ?? '', wholeLog(body));
  return failure ? { reason: failure.reason, parser, code: failure.code, beforeModelWork: failure.beforeModelWork } : null;
}

/**
 * A bench/3 report as a round reads it (PADR-0044 decision 10: the gate and the release ledger accept
 * only `readFrom: practonaut.bench/3`, at session level until artifact mode exists): validated and
 * re-verified against its bench folder, with the runs whose client values a shipped parser re-derived,
 * the failure each infra_error run's stdout gives that parser, and with `sessions` the judged sessions
 * the development digest reads. A run that was not re-derived stays the report's claim: never attested.
 */
export async function readGateReport(path: string, sessions = false): Promise<GateReport> {
  const report = validateBenchReport(parseJsonEntry(await readFile(path), 'report.json', 64));
  if (toView(report).readFrom !== BENCH_SCHEMA_V3) refuse('report_not_v3', `${basename(path)} is a ${safeText(report.schema)} report; a 0.3.0 round reads ${BENCH_SCHEMA_V3} reports only`);
  if ((report as { verdictLevel?: string }).verdictLevel !== 'session') refuse('artifact_level_unavailable', `${basename(path)} is an artifact-level report; this Practonaut gates session-level units only (artifact mode comes with its own change)`);
  const verified = await verifyBenchV3(report as SessionReportV3, dirname(path), libraryWorld);
  const value = report as SessionReportV3, folder = dirname(path);
  const failures = new Map<string, RederivedFailure | null>();
  for (const run of value.runs) if (run.status === 'infra_error') failures.set(run.id, await rederivedFailure(join(folder, run.id), run));
  const read = new Map<string, DigestSession>();
  if (sessions) for (const run of value.runs) {
    if (!run.artifacts) continue;
    const session = parseJsonEntry(await readFile(join(folder, run.id, RUN_ARTIFACTS.session)), 'session.json', 64) as { hash?: unknown; log?: unknown };
    if (typeof session.hash !== 'string' || !Array.isArray(session.log)) refuse('report_invalid', `run ${run.id}: its session has no state hash and action log`);
    read.set(run.id, { hash: session.hash as string, log: session.log });
  }
  return { report: value, bench: basename(resolve(folder)), rederived: new Set(verified.parsers.runs), failures, ...(sessions ? { sessions: read } : {}) };
}

/** A round file (plan, pre-probe record, declaration) as git holds it: committed, unchanged and in a
 * remote-tracking branch; its commit. */
export function committedFile(path: string): string {
  try { return declarationCommit(path).commit; }
  catch (error) { if (error instanceof DeclarationGitError) refuse('not_committed', error.message); throw error; }
}
const asGate = <T>(work: () => T): T => { try { return work(); } catch (error) { if (error instanceof RoundError) refuse(error.code, error.message); throw error; } };
async function json(path: string, name: string): Promise<unknown> { return parseJsonEntry(await readFile(path), name, 16); }
export const readPlan = async (path: string): Promise<Plan> => { const raw = await json(path, 'plan.json'); return asGate(() => validatePlan(raw)); };
export const readProbe = async (path: string): Promise<ProbeRecord> => { const raw = await json(path, 'probe.json'); return asGate(() => validateProbe(raw)); };
export const readDeclaration = async (path: string): Promise<Declaration> => { const raw = await json(path, 'declaration.json'); return asGate(() => validateDeclaration(raw)); };

/** Round file names in the release folder (PADR-0042 amended: every name carries the unit). */
export const roundFiles = Object.freeze({
  plan: (unit: string, round: number, probe: number): string => `${unit}-round-${round}.probe-${probe}.plan.json`,
  probe: (unit: string, round: number, probe: number): string => `${unit}-round-${round}.probe-${probe}.json`,
  declaration: (unit: string, round: number): string => `${unit}-round-${round}.declaration.json`,
  gate: (unit: string, round: number): string => `${unit}-round${round}.md`,
  gateJson: (unit: string, round: number): string => `${unit}-round${round}.gate.json`,
});

/**
 * The release ledger as `declare` and `gate` read it (PADR-0042 decision 4, PADR-0044 decision 8):
 * the committed copy in the release folder, committed, unchanged and pushed, so every record it holds
 * is pushed; the local ledger holds no record the committed one lacks (`ledger_not_committed`); every
 * committed version of the file is a prefix of the current one (`ledger_rewritten`).
 */
export async function pushedLedger(paths: LedgerPaths): Promise<LedgerInput> {
  const text = await readFile(paths.committed, 'utf8').catch(() => refuse('ledger_not_committed', `there is no committed release ledger at ${paths.committed}; write it (ledger write), commit and push it`));
  let committed: Ledger;
  try { committed = parseLedger(text); } catch (error) { return refuse((error as { code?: string }).code ?? 'ledger_invalid', (error as Error).message); }
  committedFile(paths.committed);
  const local = await readLedger(paths.local).catch((error: Error & { code?: string }) => refuse(error.code ?? 'ledger_invalid', error.message));
  if (local === null) refuse('ledger_missing', `there is no local release ledger at ${paths.local}`);
  if (local!.text !== committed.text) refuse(isPrefix(committed.text, local!.text) ? 'ledger_not_committed' : 'ledger_diverged', isPrefix(committed.text, local!.text)
    ? `the local release ledger holds ${local!.records.length - committed.records.length} records the committed one lacks; write it (ledger write), commit and push it first`
    : 'the committed release ledger is not a prefix of the local one');
  const versions = [];
  for (const version of declarationVersions(paths.committed)) {
    const old = declarationAtCommit(paths.committed, version.commit);
    if (old === null || !isPrefix(old, committed.text)) refuse('ledger_rewritten', `the release ledger of commit ${version.commit.slice(0, 12)} is not a prefix of the current one: the ledger is only ever appended to`);
    versions.push({ ...version, records: old!.split('\n').length - 1 });
  }
  return { ledger: committed, versions };
}

/** The pre-probe set a plan names (`generate <unit> --set probe --plan`). */
export function probeSet(plan: Plan): ChallengeSet {
  const family = asGate(() => familyOf(plan.unit, plan.maintainerApprovedUnit));
  if (plan.generator.version !== generatorVersion(family)) refuse('generator_mismatch', `the plan names generator ${plan.generator.version}; this checkout's ${family} generator is ${generatorVersion(family)}`);
  return generateSet(family, plan.seeds, plan.difficulty === 'mixed' ? 'mixed' : Number(plan.difficulty) as Difficulty, `${unitSlug(parseUnit(plan.unit).toolchain)}-r${plan.round}-probe${plan.probe}`);
}
/** The held-out set a declaration names (`generate <unit> --set heldout --declaration`). */
export function heldOutSet(declaration: Declaration): { set: ChallengeSet; seeds: number[] } {
  const family = asGate(() => familyOf(declaration.unit, declaration.maintainerApprovedUnit));
  if (declaration.generator.version !== generatorVersion(family)) refuse('generator_mismatch', `the declaration names generator ${declaration.generator.version}; this checkout's ${family} generator is ${generatorVersion(family)}`);
  const seeds = heldOutSeeds(declaration);
  return { set: generateSet(family, seeds, declaration.difficulty === 'mixed' ? 'mixed' : Number(declaration.difficulty) as Difficulty, `${unitSlug(parseUnit(declaration.unit).toolchain)}-r${declaration.round}`), seeds };
}

/** A set folder against its regeneration: the manifest names the unit, round, basis and commit and the
 * seeds; the world folder is the regenerated world; every oracle file has the SHA-256 the manifest
 * records, holds exactly the regenerated reference and near misses, and has at least one near miss. */
async function checkSetFolder(directory: string, regenerated: ChallengeSet, expected: { unit: string; round: number; seeds: readonly number[]; basis: { kind: 'plan' | 'declaration'; sha256: string; commit: string } }): Promise<void> {
  const fail = (message: string): never => refuse('set_mismatch', `the ${expected.basis.kind === 'plan' ? 'pre-probe' : 'held-out'} set: ${message}`);
  const manifest = parseJsonEntry(await readFile(join(directory, 'instances.json')), 'instances.json', 64) as {
    schema?: unknown; unit?: unknown; round?: unknown; basis?: unknown; seeds?: unknown; world?: { contentHash?: unknown };
    instances?: Array<{ taskId?: unknown; oracle?: { sha256?: unknown; nearMisses?: unknown } }>;
  };
  if (manifest.schema !== SET_SCHEMA || manifest.unit !== expected.unit || manifest.round !== expected.round) fail(`instances.json is not the ${expected.unit} round ${expected.round} set`);
  if (!isDeepStrictEqual(manifest.basis, expected.basis)) fail(`instances.json was not generated from this ${expected.basis.kind} in commit ${expected.basis.commit.slice(0, 12)}`);
  if (!isDeepStrictEqual(manifest.seeds, [...expected.seeds])) fail(`instances.json names other seeds than the ${expected.basis.kind}`);
  if (manifest.world?.contentHash !== sha256Hex(canonicalJson(regenerated.world))) fail(`its world is not the one the generator makes from the ${expected.basis.kind}`);
  const worldBytes = await readFile(join(directory, 'world', 'world.json')).catch(() => fail('world/world.json is missing'));
  if (canonicalJson(parseJsonEntry(worldBytes, 'world.json', 64)) !== canonicalJson(regenerated.world)) fail(`world/world.json is not the world the generator makes from the ${expected.basis.kind}`);
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
/** The commit a set's manifest records for its plan or declaration. */
async function setBasisCommit(directory: string): Promise<string> {
  const manifest = parseJsonEntry(await readFile(join(directory, 'instances.json')), 'instances.json', 64) as { basis?: { commit?: unknown } };
  return typeof manifest.basis?.commit === 'string' ? manifest.basis.commit : refuse('set_mismatch', `${directory}: instances.json names no plan or declaration commit`);
}

/**
 * Model-run folders of a round's tasks that hold no start entry in the ledger (PADR-0042 amended,
 * 3.1): every run folder under the bench roots with the agent's own output (`agent.stdout`; built-in
 * agents have none) of one of the tasks, in a bench of one of the round's sets or without a report.
 */
export async function scanOutside(roots: readonly string[], sets: { worlds: readonly string[]; tasks: readonly string[] }, ledger: Ledger): Promise<Array<{ bench: string; run: string }>> {
  const started = new Set(ledger.records.flatMap(record => record.kind === 'start' ? [`${record.bench}\u0000${record.run}`] : []));
  const outside: Array<{ bench: string; run: string }> = [];
  for (const root of [...new Set(roots.map(value => resolve(value)))]) {
    for (const bench of (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
      const folder = join(root, bench);
      const bytes = await readRegularFile(join(folder, 'report.json'), 64 * 1024 * 1024);
      let world: unknown = null;
      if (bytes) try { world = (JSON.parse(bytes.toString('utf8')) as { environment?: { world?: { contentHash?: unknown } } }).environment?.world?.contentHash; } catch { world = null; }
      if (bytes && !sets.worlds.includes(world as string)) continue;
      for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
        const match = /^(.+)-s\d+-r\d+$/.exec(entry.name);
        if (!entry.isDirectory() || !match || !sets.tasks.includes(match[1]!) || !(await exists(join(folder, entry.name, 'agent.stdout')))) continue;
        if (!started.has(`${bench}\u0000${entry.name}`)) outside.push({ bench, run: entry.name });
      }
    }
  }
  return outside;
}

/**
 * The run folders of a round's start entries without a run-end record (PADR-0042 amended: a lost record
 * voids a judged run): `judged` when the folder holds `checker.json` or `session.json`, `unjudged` when it
 * exists without them, `missing` when no bench root holds it.
 */
export async function roundFolders(roots: readonly string[], ledger: Ledger, unit: string, round: number): Promise<Folders> {
  const folders = new Map<string, 'judged' | 'unjudged' | 'missing'>();
  for (const start of roundStarts(ledger, unit, round)) {
    if (ledger.ends.has(start.seq)) continue;
    let state: 'judged' | 'unjudged' | 'missing' = 'missing';
    for (const root of [...new Set(roots.map(value => resolve(value)))]) {
      const folder = join(root, start.bench, start.run);
      if (!(await exists(folder))) continue;
      state = (await exists(join(folder, RUN_ARTIFACTS.checker))) || (await exists(join(folder, RUN_ARTIFACTS.session))) ? 'judged' : 'unjudged';
      break;
    }
    folders.set(`${start.bench}\u0000${start.run}`, state);
  }
  return folders;
}
/**
 * Model-run folders under the bench roots that no start entry of `ledger` names (`ledger init` refuses
 * while there are any, PADR-0042 amended): every run folder with the agent's own output in a bench
 * folder without a report or with a `practonaut.bench/3` report (0.2.0's /1 and /2 benches predate the
 * release ledger and are left out).
 */
export async function scanUnledgered(roots: readonly string[], ledger: Ledger): Promise<Array<{ bench: string; run: string }>> {
  const started = new Set(ledger.records.flatMap(record => record.kind === 'start' ? [`${record.bench}\u0000${record.run}`] : []));
  const found: Array<{ bench: string; run: string }> = [];
  for (const root of [...new Set(roots.map(value => resolve(value)))]) {
    for (const bench of (await readdir(root, { withFileTypes: true }).catch(() => [])).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
      const bytes = await readRegularFile(join(root, bench, 'report.json'), 64 * 1024 * 1024);
      let schema: unknown = null;
      if (bytes) try { schema = (JSON.parse(bytes.toString('utf8')) as { schema?: unknown }).schema; } catch { schema = null; }
      if (bytes && schema !== BENCH_SCHEMA_V3) continue;
      for (const entry of await readdir(join(root, bench), { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory() || !/-s\d+-r\d+$/.test(entry.name) || !(await exists(join(root, bench, entry.name, 'agent.stdout')))) continue;
        if (!started.has(`${bench}\u0000${entry.name}`)) found.push({ bench, run: entry.name });
      }
    }
  }
  return found;
}

/** The local ledger and the committed copy of a release folder. */
export const ledgerPaths = (folder: string, local: string): LedgerPaths => ({ local, committed: join(folder, COMMITTED_LEDGER) });

export interface PlanOptions {
  unit: string; round: number; probe: number; difficulty: Difficulty | 'mixed'; seeds: number[]; model: string;
  bench: { mirror: 'off' | 'required'; timeoutSeconds: number; maxActions: number; checks: number | null }; maintainerApprovedUnit: string | null; shape: 'A' | 'B';
}
/** A probe plan from the tool's options (PADR-0044 decision 8), validated; a retune is checked against
 * the committed record of the probe before it in the same folder. */
export async function makePlan(options: PlanOptions, folder: string): Promise<Plan> {
  const unit = parseUnit(options.unit);
  const family = asGate(() => familyOf(options.unit, options.maintainerApprovedUnit));
  const plan = asGate(() => validatePlan({
    schema: PLAN_SCHEMA, release: RELEASE, unit: options.unit, round: options.round, probe: options.probe,
    toolchain: { id: unit.toolchain, level: unit.level, practonaut: PACKAGE_VERSION, server: null, rules: null },
    generator: { id: generatorId(family), version: generatorVersion(family) }, difficulty: String(options.difficulty), shape: options.shape,
    agent: { preset: GATE_PRESET, model: options.model }, seeds: options.seeds, bench: options.bench, maintainerApprovedUnit: options.maintainerApprovedUnit,
  }));
  const earlier = plan.probe > 1 ? await earlierProbe(folder, plan) : await exists(join(folder, roundFiles.plan(plan.unit, plan.round, 1))) ? { plan: await readPlan(join(folder, roundFiles.plan(plan.unit, plan.round, 1))), admitted: false } : null;
  asGate(() => checkRetune(plan, earlier));
  // A unit is retuned once (decision 7): no probe 2 in another round of the same unit.
  if (plan.probe === 2 && plan.round === 2 && await exists(join(folder, roundFiles.probe(plan.unit, 1, 2)))) refuse('probe_retune_exhausted', `${plan.unit} was retuned in round 1 already; a unit is retuned once`);
  return plan;
}
async function earlierProbe(folder: string, plan: Plan): Promise<{ plan: Plan; admitted: boolean } | null> {
  const planPath = join(folder, roundFiles.plan(plan.unit, plan.round, plan.probe - 1)), recordPath = join(folder, roundFiles.probe(plan.unit, plan.round, plan.probe - 1));
  if (!(await exists(planPath)) || !(await exists(recordPath))) return null;
  committedFile(recordPath);
  return { plan: await readPlan(planPath), admitted: (await readProbe(recordPath)).admitted };
}

export interface ProbeFiles { plan: string; set: string; reports: string[]; ledger: string; benchRoots?: string[] }
/** The bench roots a command scans: the given ones and the parents of the given reports' folders. */
const rootsOf = (reports: readonly string[], extra: readonly string[] = []): string[] => [...extra, ...reports.map(path => dirname(dirname(resolve(path))))];
/** The round files are made with the Practonaut the plan pins (PADR-0042 amended, 3.11). */
function pinned(plan: Plan): void {
  if (plan.toolchain.practonaut !== PACKAGE_VERSION) refuse('practonaut_version', `the round's plan pins Practonaut ${plan.toolchain.practonaut}; this is ${PACKAGE_VERSION}`);
}
/** The pre-probe record (PADR-0042 decision 7, committed whether the unit is admitted or not): the
 * committed and pushed plan, the pre-probe set checked against its regeneration, the pre-probe reports
 * re-verified and bound to the pushed ledger, Opus's passes and the rule's answer. */
export async function probeFromFiles(files: ProbeFiles): Promise<{ record: ProbeRecord; text: string; round: RoundBody }> {
  const plan = await readPlan(files.plan), planCommit = committedFile(files.plan), planHash = fileHash(plan);
  pinned(plan);
  const set = probeSet(plan), world = sha256Hex(canonicalJson(set.world)), tasks = plan.seeds.map(seed => taskIdOf(familyOf(plan.unit, plan.maintainerApprovedUnit), seed));
  await checkSetFolder(files.set, set, { unit: plan.unit, round: plan.round, seeds: plan.seeds, basis: { kind: 'plan', sha256: planHash, commit: planCommit } });
  const folder = dirname(resolve(files.plan));
  const ledger = await pushedLedger(ledgerPaths(folder, files.ledger));
  // A pre-probe is recorded once; runs of its instances outside the ledger refuse it.
  asGate(() => refuseRecordedProbe(ledger.ledger, plan));
  const roots = rootsOf(files.reports, files.benchRoots);
  checkOutside(await scanOutside(roots, { worlds: [world], tasks }, ledger.ledger));
  const reports: GateReport[] = [];
  for (const path of files.reports) reports.push(await readGateReport(path, true));
  const folders = await roundFolders(roots, ledger.ledger, plan.unit, plan.round);
  const result = asGate(() => probeRuns({ plan, planHash, worldContentHash: world, reports, ledger: ledger.ledger, folders }));
  const record = asGate(() => validateProbe({
    schema: PROBE_SCHEMA, release: RELEASE, unit: plan.unit, round: plan.round, probe: plan.probe, plan: { sha256: planHash, commit: planCommit },
    world: { id: set.world.id, contentHash: sha256Hex(canonicalJson(set.world)) }, agent: { preset: plan.agent.preset, model: plan.agent.model },
    outcomes: result.outcomes, passed: result.passed, admitted: admits(result.passed), rule: { low: SHAPE_B.admitLow, high: SHAPE_B.admitHigh, of: result.outcomes.length },
    digest: result.digest, runs: result.runs, ledger: { records: ledger.ledger.records.length, head: ledgerHead(ledger.ledger) },
  }));
  // Registered in the ledger, which orders admissions across every branch (decision 8 as amended).
  const round: RoundBody = { kind: 'round', event: record.admitted ? 'admitted' : 'refused', unit: plan.unit, round: plan.round, probe: plan.probe, plan: planHash, record: fileHash(record), declaration: null, world, heldOutRuns: 0 };
  return { record, text: JSON.stringify(record, null, 2) + '\n', round };
}

export interface DeclareFiles { plan: string; probe: string; reports: string[]; ladder: Array<{ preset: string; model: string }>; ledger: string; out: string; benchRoots?: string[] }
/**
 * A round's declaration `/2` (PADR-0042 as amended): the committed and pushed plan and pre-probe
 * record, the pre-probe runs again (the same digest and outcomes), the ladder as declared, the
 * previous round's seeds for a round 2, and the funding from the pushed ledger's count.
 */
export async function declareFromFiles(files: DeclareFiles): Promise<{ declaration: Declaration; text: string; seeds: number[]; round: RoundBody }> {
  const plan = await readPlan(files.plan), probe = await readProbe(files.probe);
  const planCommit = committedFile(files.plan), probeCommit = committedFile(files.probe), planHash = fileHash(plan);
  pinned(plan);
  if (probe.plan.sha256 !== planHash || probe.plan.commit !== planCommit) refuse('round_files_mismatch', 'the pre-probe record was not made from this plan');
  if (!probe.admitted) refuse('unit_not_admitted', `${plan.unit}: the pre-probe passed ${probe.passed} of ${probe.outcomes.length}, outside ${SHAPE_B.admitLow}–${SHAPE_B.admitHigh}; the unit is not admitted (PADR-0042 decision 7)`);
  const folder = dirname(resolve(files.out));
  if (folder !== dirname(resolve(files.plan))) refuse('round_files_mismatch', 'the declaration goes into the release folder of its plan');
  if (basename(files.out) !== roundFiles.declaration(plan.unit, plan.round)) refuse('round_files_mismatch', `name the file ${roundFiles.declaration(plan.unit, plan.round)}`);
  const ledger = await pushedLedger(ledgerPaths(folder, files.ledger));
  const events = roundEvents(ledger.ledger, plan.unit, plan.round);
  const admission = events.find(event => event.event === 'admitted' && event.record === fileHash(probe) && event.plan === planHash);
  if (!admission) refuse('probe_unrecorded', 'the release ledger holds no admission of this pre-probe record; `probe` registers it (write and push the ledger after it)');
  // A round is declared again only while none of its held-out runs has started.
  asGate(() => refuseRedeclaration(ledger.ledger, plan.unit, plan.round));
  const set = probeSet(plan), world = sha256Hex(canonicalJson(set.world));
  const roots = rootsOf(files.reports, files.benchRoots);
  checkOutside(await scanOutside(roots, { worlds: [world], tasks: plan.seeds.map(seed => taskIdOf(familyOf(plan.unit, plan.maintainerApprovedUnit), seed)) }, ledger.ledger));
  const reports: GateReport[] = [];
  for (const path of files.reports) reports.push(await readGateReport(path, true));
  const folders = await roundFolders(roots, ledger.ledger, plan.unit, plan.round);
  const again = asGate(() => probeRuns({ plan, planHash, worldContentHash: world, reports, ledger: ledger.ledger, folders }));
  if (again.digest !== probe.digest || !isDeepStrictEqual(again.outcomes, probe.outcomes)) refuse('development_mismatch', 'the pre-probe reports are not the ones the pre-probe record digests');
  // The ladder: as declared; billing as the pre-probe's preset was set up; Claude Code attests its model.
  const billing = reports[0]!.report.agent.billing.class;
  const ladder = files.ladder.map(agent => ({ preset: agent.preset, client: agent.preset, model: agent.model, attestation: agent.preset === GATE_PRESET ? 'client-attested' as const : 'not-attested' as const, billing }));
  if (ladder[0] && ladder[0].model !== plan.agent.model && ladder[0].preset === GATE_PRESET) refuse('ladder_model_mismatch', `the strongest ladder agent is the pre-probe's ${plan.agent.model}, not ${ladder[0].model}`);
  // Round 2: the first round's declaration and gate report, committed; its held-out seeds.
  let previous: Declaration['previous'] = null;
  if (plan.round > 1) {
    const firstPath = join(folder, roundFiles.declaration(plan.unit, 1)), gatePath = join(folder, roundFiles.gateJson(plan.unit, 1));
    if (!(await exists(firstPath)) || !(await exists(gatePath))) refuse('previous_round', `round ${plan.round} of ${plan.unit} follows its gated first round (${roundFiles.declaration(plan.unit, 1)} and ${roundFiles.gateJson(plan.unit, 1)})`);
    committedFile(firstPath); committedFile(gatePath);
    const first = await readDeclaration(firstPath), seeds = heldOutSeeds(first), gated = JSON.parse(await readFile(gatePath, 'utf8')) as { verdict?: unknown };
    if (gated.verdict === 'passes') refuse('previous_round', `${plan.unit} passed its first round; a second round is for a unit that did not`);
    previous = { declaration: declarationHash(first), low: seeds[0]!, high: seeds.at(-1)! };
  }
  // Funding from the ledger: other declared rounds' unstarted held-out runs, units admitted earlier and
  // not declared, the foreign reserve (decision 8 as amended); the gate re-derives it.
  const funding = fundingAt(ledger.ledger, plan.unit, plan.round, admission!.seq);
  const heldOut = { instances: SHAPE_B.heldOut }, subscription = subscriptionAgents(ladder);
  const raw = {
    schema: DECLARATION_SCHEMA, release: RELEASE, unit: plan.unit, round: plan.round, alpha: ALPHA[plan.round] ?? 0.025, toolchain: plan.toolchain, generator: plan.generator, difficulty: plan.difficulty, shape: plan.shape,
    maintainerApprovedUnit: plan.maintainerApprovedUnit,
    probe: { probe: plan.probe, plan: { sha256: planHash, commit: planCommit }, record: { sha256: fileHash(probe), commit: probeCommit }, passed: probe.passed, instances: probe.outcomes.length },
    ladder, pair: { strongest: ladder[0]?.model ?? plan.agent.model, weakest: ladder.at(-1)?.model ?? plan.agent.model }, bench: plan.bench,
    development: { seeds: plan.seeds, world: { id: probe.world.id, contentHash: probe.world.contentHash }, digest: probe.digest, passed: probe.outcomes.map(entry => entry.pass) },
    heldOut, previous,
    budget: { subscriptionAgents: subscription, formula: (heldOut.instances + probe.outcomes.length) * subscription, roundRuns: probe.outcomes.length + heldOut.instances * subscription, cap: RELEASE_CAP,
      before: funding.before, ledger: { records: ledger.ledger.records.length, head: ledgerHead(ledger.ledger) }, reserved: funding.reserved, leave: ROUND_RULES.leave },
  };
  const declaration = asGate(() => validateDeclaration(raw));
  if (probe.world.contentHash !== world) refuse('round_files_mismatch', 'the pre-probe record names another pre-probe world than the plan makes');
  // Registered in the ledger with its held-out world: every later run on it belongs to this round.
  const heldOutWorld = sha256Hex(canonicalJson(heldOutSet(declaration).set.world));
  const round: RoundBody = { kind: 'round', event: 'declared', unit: plan.unit, round: plan.round, probe: plan.probe, plan: planHash, record: fileHash(probe), declaration: declarationHash(declaration), world: heldOutWorld, heldOutRuns: heldOutRuns(declaration) };
  return { declaration, text: JSON.stringify(declaration, null, 2) + '\n', seeds: heldOutSeeds(declaration), round };
}
export interface GateFiles {
  declaration: string; set: string;
  development: string[]; oracle: string[]; random: string[];
  /** Held-out ladder reports (a resumed bench has several per model); none for the preflight. */
  ladder?: string[];
  /** Folders holding bench folders, besides the parents of the given ones (the scan for runs outside the ledger). */
  benchRoots?: string[];
  ledger: string;
}
async function roundData(files: GateFiles, ladder: readonly GateReport[] | null): Promise<Parameters<typeof preflightGate>[0]> {
  const declaration = await readDeclaration(files.declaration), folder = dirname(resolve(files.declaration));
  // The held-out set was generated from the declaration of the commit its manifest records: the gated
  // declaration must be that one, and the commit must stay reachable on a remote.
  const commit = await setBasisCommit(files.set);
  const atCommit = declarationAtCommit(files.declaration, commit);
  if (atCommit === null) refuse('declaration_changed', `the declaration is not in commit ${commit.slice(0, 12)}, from which the held-out set was generated`);
  let committed: Declaration | null = null;
  try { committed = validateDeclaration(JSON.parse(atCommit!)); } catch { committed = null; }
  if (!committed || declarationHash(committed) !== declarationHash(declaration)) refuse('declaration_changed', `the gated declaration differs from the one in commit ${commit.slice(0, 12)}, from which the held-out set was generated`);
  if (!commitPushed(files.declaration, commit)) refuse('not_committed', `commit ${commit.slice(0, 12)} of the declaration is in no remote-tracking branch; keep the round's branch pushed`);
  const planPath = join(folder, roundFiles.plan(declaration.unit, declaration.round, declaration.probe.probe)), probePath = join(folder, roundFiles.probe(declaration.unit, declaration.round, declaration.probe.probe));
  committedFile(planPath); committedFile(probePath);
  const plan = await readPlan(planPath), probe = await readProbe(probePath);
  // The gate runs with the Practonaut the plan pins (PADR-0042 amended, 3.11).
  if (plan.toolchain.practonaut !== PACKAGE_VERSION) refuse('practonaut_version', `the round's plan pins Practonaut ${plan.toolchain.practonaut}; this is ${PACKAGE_VERSION}`);
  // The pre-probe world regenerated from the plan, never taken from the declaration or the record.
  const probeWorld = sha256Hex(canonicalJson(probeSet(plan).world));
  if (declaration.development.world.contentHash !== probeWorld || probe.world.contentHash !== probeWorld) refuse('round_files_mismatch', 'the declaration or the pre-probe record names another pre-probe world than the plan makes');
  const { set, seeds } = heldOutSet(declaration);
  await checkSetFolder(files.set, set, { unit: declaration.unit, round: declaration.round, seeds, basis: { kind: 'declaration', sha256: declarationHash(declaration), commit } });
  // The cheap refusals first: the pushed ledger and runs outside it, before any report is re-verified.
  const ledger = await pushedLedger(ledgerPaths(folder, files.ledger));
  const family = declaration.unit.split('.')[0] as Family, worldContentHash = sha256Hex(canonicalJson(set.world));
  const given = [...files.development, ...files.oracle, ...files.random, ...(files.ladder ?? [])];
  const roots = [...(files.benchRoots ?? []), ...given.map(path => dirname(dirname(resolve(path))))];
  const outside = await scanOutside(roots, { worlds: [probeWorld, worldContentHash], tasks: [...plan.seeds, ...seeds].map(seed => taskIdOf(family, seed)) }, ledger.ledger);
  checkOutside(outside);
  const folders = await roundFolders(roots, ledger.ledger, declaration.unit, declaration.round);
  const read = async (paths: readonly string[], sessions = false): Promise<GateReport[]> => { const out: GateReport[] = []; for (const path of paths) out.push(await readGateReport(path, sessions)); return out; };
  const development = await read(files.development, true), oracle = await read(files.oracle), random = await read(files.random);
  if (!oracle.length) refuse('baseline_missing', 'name the oracle report(s) (--oracle)');
  // Each oracle bench played the regenerated references.
  for (const [index, value] of oracle.entries()) {
    const stored = ReferencesFileSchema.parse(parseJsonEntry(await readFile(join(dirname(files.oracle[index]!), BENCH_REFERENCES_FILE)), BENCH_REFERENCES_FILE, 64));
    for (const task of value.report.settings.tasks) {
      const reference = stored.references.find(entry => entry.taskId === task), regenerated = set.oracles.find(entry => entry.taskId === task);
      if (!reference || !regenerated || !isDeepStrictEqual(reference.steps, regenerated.steps)) refuse('baseline_mismatch', `the oracle report's reference for ${task} is not the regenerated one`);
    }
  }
  const world = await worldFromPackage(await readFile(join(dirname(files.oracle[0]!), oracle[0]!.report.environment.world.package.path)));
  const nearMisses = await judgeNearMisses(world, set.oracles, [1]);
  let previousSeeds: number[] | undefined;
  if (declaration.round > 1) {
    const firstPath = join(folder, roundFiles.declaration(declaration.unit, 1));
    committedFile(firstPath);
    const first = await readDeclaration(firstPath);
    if (declarationHash(first) !== declaration.previous?.declaration) refuse('previous_round', 'the first round\'s declaration is not the one this round names');
    previousSeeds = heldOutSeeds(first);
  }
  return {
    plan, probe, declaration, git: { declaration: commit, versions: declarationVersions(files.declaration) },
    probeWorld, tasks: seeds.map(seed => taskIdOf(family, seed)), seeds, worldContentHash,
    development, oracle, random, nearMisses: { total: nearMisses.total, passed: nearMisses.passed, perInstance: set.oracles.map(value => value.nearMisses.length) },
    ledger, outside, folders, ...(previousSeeds ? { previousSeeds } : {}),
  };
}

/** `gate --preflight`: everything but the ladder, before any ladder run. */
export async function preflightFromFiles(files: GateFiles): Promise<{ result: PreflightResult; text: string }> {
  const data = await roundData(files, null);
  const result = preflightGate(data);
  return { result, text: renderPreflight(result) };
}

/** The gate: every check of the preflight and the ladder, the verdict, and the gate report /2 as
 * Markdown and JSON. */
export async function gateFromFiles(files: GateFiles): Promise<{ result: GateResult; markdown: string; json: string }> {
  const ladder: GateReport[] = [];
  for (const path of files.ladder ?? []) ladder.push(await readGateReport(path));
  const data = await roundData(files, ladder);
  const result = computeGate({ ...data, ladder });
  return { result, markdown: renderGate(result), json: JSON.stringify(result, null, 2) + '\n' };
}
export type { SessionRunV3 };

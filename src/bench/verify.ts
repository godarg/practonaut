/**
 * `practonaut report --verify`: re-judges every run of a bench report from the artifacts in its run
 * directory.
 *
 * bench/1 (PADR-0030): against the bundled library — the library (id, version and content hash of
 * the world) and each run's reference length must equal what this Practonaut ships.
 *
 * bench/2 (PADR-0036): against the world stored in the bench folder, never the bundled library — the
 * stored package's bytes, its identity and content hash and its tasks' generator metadata
 * (`bench_world_changed`); the stored references and every run artifact against the hashes the
 * report binds (`bench_artifact_changed`); every stored reference against the stored world: its
 * task, its length and the checker's verdict for every seed (`bench_reference_invalid`).
 *
 * Both then re-verify, for each judged run, the SHA-256 the report binds for the committed session,
 * the native export and the checker output; the session's task, seed and final history length
 * (`actions`); the independent checker re-run on the session and the native export, whose verdicts
 * must equal both the stored checker output and the report's verdicts. pass, pass@1, pass^k, mean
 * actions and efficiency then follow from these values (the validator re-derives them). Any
 * difference rejects the report.
 *
 * Not re-verifiable, self-reported by the runner: acceptedActions, rejectedActions, undos, resets,
 * toolCalls, wallMs, status, agentExitCode, note, the client-reported model and apiKeySource.
 *
 * What this shows: the report's verdicts follow from the artifacts on disk. What it does not show:
 * that those artifacts came from the agent named in the report. Whoever can write the run directory
 * can replace them; there is no signature.
 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { sha256Hex } from '../canonical/index.ts';
import { cliText } from '../cli/messages.ts';
import { safeText } from '../cli/output.ts';
import { checkInProcess } from '../cli/runtime.ts';
import { nativeMatchesState } from '../host/export-pair.ts';
import { PackageError } from '../package/index.ts';
import { LIMITS } from '../package/limits.ts';
import { parseJsonEntry } from '../package/json.ts';
import type { CheckerVerdict, SessionData, World } from '../world/types.ts';
import type { LibraryEntry } from '../library/index.ts';
import { BENCH_REFERENCES_FILE, BENCH_WORLD_FILE, BenchReportError, type BenchErrorCode, type BenchReportV1, type BenchReportV2, type BenchRun } from './report.ts';
import { RUN_ARTIFACTS, verdictOf } from './run.ts';
import { MAX_ORACLE_BYTES, ReferencesFileSchema, referenceProblem, worldContentHash, worldFromPackage } from './world.ts';

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export interface VerificationResult { reverified: number; unjudged: number }
export interface VerificationResultV2 extends VerificationResult { references: number; world: { id: string; version: string } }

/** A bounded regular file's bytes, or null when it is missing, not a regular file or too large. */
async function boundedBytes(path: string, max: number): Promise<Buffer | null> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > max) return null;
    return await readFile(path);
  } catch { return null; }
}

async function artifact(directory: string, runId: string, name: string, expected: string, code: BenchErrorCode): Promise<string> {
  const bytes = await boundedBytes(join(directory, runId, name), MAX_ARTIFACT_BYTES);
  if (bytes === null) throw new BenchReportError(cliText('verifyArtifactMissing', { run: runId, name }), code);
  if (sha256Hex(bytes) !== expected) throw new BenchReportError(cliText('verifyArtifactHash', { run: runId, name }), code);
  return bytes.toString('utf8');
}

/** Re-judges one judged run from its artifacts against `world`. */
async function rejudge(run: BenchRun, world: World, directory: string, artifactCode: BenchErrorCode): Promise<void> {
  if (!run.artifacts) throw new BenchReportError(`run ${run.id} binds no artifacts; the report can be consistency-checked but not re-verified`);
  const sessionText = await artifact(directory, run.id, RUN_ARTIFACTS.session, run.artifacts.session, artifactCode);
  const checkerText = await artifact(directory, run.id, RUN_ARTIFACTS.checker, run.artifacts.checker, artifactCode);
  const nativeText = run.artifacts.native === null ? null : await artifact(directory, run.id, RUN_ARTIFACTS.native, run.artifacts.native, artifactCode);
  const session = parseJsonEntry(Buffer.from(sessionText), RUN_ARTIFACTS.session, 64) as SessionData;
  if (session?.seed !== run.seed || session.taskId !== run.taskId || session.world?.id !== world.id || !Array.isArray(session.log))
    throw new BenchReportError(cliText('verifySessionOther', { run: run.id }));
  if (session.log.length !== run.actions) throw new BenchReportError(cliText('verifyActions', { run: run.id, given: run.actions, actual: session.log.length }));
  const settings = { seed: run.seed, taskId: run.taskId };
  let sessionRaw: CheckerVerdict, nativeRaw: CheckerVerdict | null = null;
  try { sessionRaw = await checkInProcess(world, sessionText, settings); }
  catch { throw new BenchReportError(cliText('verifyCheckerSession', { run: run.id })); }
  if (nativeText !== null) {
    if (!nativeMatchesState(world.schema, nativeText, session.state)) throw new BenchReportError(cliText('verifyNativeState', { run: run.id }));
    try { nativeRaw = await checkInProcess(world, nativeText, settings); }
    catch { throw new BenchReportError(cliText('verifyCheckerNative', { run: run.id })); }
  }
  const stored = (() => { try { return parseJsonEntry(Buffer.from(checkerText), RUN_ARTIFACTS.checker, 64); } catch { return undefined; } })();
  if (!isDeepStrictEqual(stored, JSON.parse(JSON.stringify({ session: sessionRaw, native: nativeRaw }))))
    throw new BenchReportError(cliText('verifyCheckerStored', { run: run.id }));
  const recomputed = { session: verdictOf(sessionRaw, run.taskId), native: nativeRaw === null ? null : verdictOf(nativeRaw, run.taskId) };
  if (!isDeepStrictEqual(recomputed, run.checker)) throw new BenchReportError(cliText('verifyVerdict', { run: run.id, result: `session ${recomputed.session.passed ? 'pass' : 'fail'}${recomputed.native ? `, native ${recomputed.native.passed ? 'pass' : 'fail'}` : ''}` }));
}

/** bench/1: re-judges every judged run of an already validated report against the bundled library;
 * throws `bench_report_invalid` on any difference (as in 0.1.0). */
export async function verifyBenchArtifacts(report: BenchReportV1, runsDirectory: string, library: { world: World; entries: ReadonlyMap<string, LibraryEntry>; contentHash: string }): Promise<VerificationResult> {
  const { world } = library, used = report.environment.library;
  if (used.worldId !== world.id || used.version !== world.version)
    throw new BenchReportError(`report was made with library ${used.worldId} ${used.version}; this Practonaut ships ${world.id} ${world.version}, so its runs cannot be re-judged here`);
  if (used.contentHash !== library.contentHash)
    throw new BenchReportError(`report was made with library ${used.worldId} ${used.version} of other content (hash ${used.contentHash.slice(0, 12)}…, this Practonaut ships ${library.contentHash.slice(0, 12)}…), so its runs cannot be re-judged here`);
  let reverified = 0, unjudged = 0;
  for (const run of report.runs) {
    const entry = library.entries.get(run.taskId);
    if (!entry) throw new BenchReportError(`run ${run.id}: task ${run.taskId} is not in the bundled library`);
    if (run.referenceActions !== entry.actions) throw new BenchReportError(`run ${run.id}: the report names a reference of ${run.referenceActions} actions; the library's reference solution has ${entry.actions}`);
    if (run.checker === null) { unjudged++; continue; }
    await rejudge(run, world, runsDirectory, 'bench_report_invalid');
    reverified++;
  }
  return { reverified, unjudged };
}

/** bench/2: the stored world, as the report binds it. */
async function storedWorld(report: BenchReportV2, directory: string): Promise<World> {
  const bound = report.environment.world, fail = (message: string): never => { throw new BenchReportError(message, 'bench_world_changed'); };
  const bytes = await boundedBytes(join(directory, BENCH_WORLD_FILE), LIMITS.maxArchiveBytes);
  if (bytes === null) return fail(cliText('verifyWorldMissing', { file: BENCH_WORLD_FILE }));
  if (sha256Hex(bytes) !== bound.package.sha256) return fail(cliText('verifyWorldHash', { file: BENCH_WORLD_FILE }));
  let world: World;
  try { world = await worldFromPackage(bytes); }
  catch (error) { return fail(cliText('verifyWorldPackage', { file: BENCH_WORLD_FILE, code: error instanceof PackageError ? error.code : String((error as { code?: unknown }).code ?? 'E_WORLD_INVALID') })); }
  const hash = worldContentHash(world);
  if (world.id !== bound.worldId || world.version !== bound.version || hash !== bound.contentHash)
    fail(cliText('verifyWorldIdentity', { world: safeText(world.id), version: safeText(world.version), hash: hash.slice(0, 12), expectedWorld: safeText(bound.worldId), expectedVersion: safeText(bound.version), expectedHash: bound.contentHash.slice(0, 12) }));
  for (const task of report.settings.tasks) if (!world.tasks.some(value => value.id === task)) fail(cliText('verifyWorldTask', { task }));
  const generated = report.settings.tasks.flatMap(taskId => { const by = world.tasks.find(task => task.id === taskId)?.generatedBy; return by ? [{ taskId, ...by }] : []; });
  if (!isDeepStrictEqual(generated, bound.generated)) fail(cliText('verifyWorldGenerated'));
  return world;
}

/** bench/2: the stored references, re-checked against the stored world for every planned seed. */
async function verifyReferences(report: BenchReportV2, world: World, directory: string): Promise<number> {
  const bound = report.references;
  if (bound === null) return 0;
  const bytes = await boundedBytes(join(directory, BENCH_REFERENCES_FILE), MAX_ORACLE_BYTES * 16);
  if (bytes === null) throw new BenchReportError(cliText('verifyReferencesMissing', { file: BENCH_REFERENCES_FILE }), 'bench_artifact_changed');
  if (sha256Hex(bytes) !== bound.sha256) throw new BenchReportError(cliText('verifyReferencesHash', { file: BENCH_REFERENCES_FILE }), 'bench_artifact_changed');
  const fail = (message: string): never => { throw new BenchReportError(message, 'bench_reference_invalid'); };
  let parsed: ReturnType<typeof ReferencesFileSchema.safeParse>;
  try { parsed = ReferencesFileSchema.safeParse(parseJsonEntry(bytes, BENCH_REFERENCES_FILE, 64)); } catch { return fail(cliText('verifyReferencesFormat', { file: BENCH_REFERENCES_FILE })); }
  if (!parsed.success) return fail(cliText('verifyReferencesFormat', { file: BENCH_REFERENCES_FILE }));
  const stored = parsed.data.references;
  if (stored.length !== bound.tasks.length) fail(cliText('verifyReferenceTask', { task: (stored.find(entry => !bound.tasks.some(task => task.taskId === entry.taskId)) ?? stored[0])?.taskId ?? '' }));
  for (const [index, expected] of bound.tasks.entries()) {
    const entry = stored[index]!;
    if (entry.taskId !== expected.taskId || entry.source !== expected.source || entry.oracle.taskId !== expected.taskId) fail(cliText('verifyReferenceTask', { task: expected.taskId }));
    if (entry.oracle.steps.length !== expected.actions) fail(cliText('verifyReferenceLength', { task: expected.taskId, given: expected.actions, actual: entry.oracle.steps.length }));
    for (const seed of report.settings.seeds) {
      const problem = await referenceProblem(world, expected.taskId, entry.oracle as Parameters<typeof referenceProblem>[2], seed);
      if (problem !== null) fail(problem);
    }
  }
  return bound.tasks.length;
}

/** bench/2: verifies the stored world and references, then re-judges every judged run against that
 * world. Throws a named `BenchReportError` on the first difference. */
export async function verifyBenchV2(report: BenchReportV2, runsDirectory: string): Promise<VerificationResultV2> {
  const world = await storedWorld(report, runsDirectory);
  // Artifacts are compared with their hashes before anything is re-judged.
  for (const run of report.runs) if (run.artifacts) {
    await artifact(runsDirectory, run.id, RUN_ARTIFACTS.session, run.artifacts.session, 'bench_artifact_changed');
    await artifact(runsDirectory, run.id, RUN_ARTIFACTS.checker, run.artifacts.checker, 'bench_artifact_changed');
    if (run.artifacts.native !== null) await artifact(runsDirectory, run.id, RUN_ARTIFACTS.native, run.artifacts.native, 'bench_artifact_changed');
  }
  const references = await verifyReferences(report, world, runsDirectory);
  let reverified = 0, unjudged = 0;
  for (const run of report.runs) {
    if (run.checker === null) { unjudged++; continue; }
    await rejudge(run, world, runsDirectory, 'bench_artifact_changed');
    reverified++;
  }
  return { reverified, unjudged, references, world: { id: world.id, version: world.version } };
}

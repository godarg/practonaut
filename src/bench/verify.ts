/**
 * `practonaut report --verify`: re-judges every run of a bench report from the artifacts in its run
 * directory.
 *
 * bench/1 (PADR-0030): against the bundled library — the library (id, version and content hash of
 * the world) and each run's reference length must equal what this Practonaut ships.
 *
 * bench/2 (PADR-0036): against the world stored in the bench folder — the stored package's bytes, its
 * identity and content hash and its tasks' generator metadata, and for a library bench of the version
 * this Practonaut ships, that library's content hash (`bench_world_changed`); the stored references
 * and every run artifact against the hashes the report binds (`bench_artifact_changed`); every stored
 * reference against the stored world: its task, its length and the checker's verdict for each seed a
 * run used (`bench_reference_invalid`).
 *
 * Both then re-verify, for each judged run, the SHA-256 the report binds for the committed session,
 * the native export and the checker output; the session's task, seed and final history length
 * (`actions`); the independent checker re-run on the session and the native export, whose verdicts
 * must equal both the stored checker output and the report's verdicts. pass, pass@1, pass^k, mean
 * actions and efficiency then follow from these values (the validator re-derives them). Any
 * difference rejects the report.
 *
 * bench/2 run evidence (PADR-0039): the call log, mutation log, condition trace and engine picture
 * against their hashes; the mutation log against the run's counters; the trace re-derived by the
 * checker from the session and the mutation log. The picture cannot be re-derived without the engine.
 *
 * Not re-verifiable, self-reported by the runner: acceptedActions, rejectedActions, undos, resets,
 * toolCalls, wallMs, status, agentExitCode, note, the client-reported model and apiKeySource, the
 * client's tokens, turns and cost, and the call log (written by the agent's own bridge).
 *
 * bench/3 at session level (PADR-0044): everything bench/2 checks, and the application's adapter
 * against the stored world's, every listed task identity re-derived from the stored world
 * (`bench_world_changed`), every external run's stdout against its hash (`bench_artifact_changed`),
 * and with the parser this Practonaut ships every value read from a stdout re-derived — the client
 * block, the offered tools and so the run's isolation, the failure and its exemption facts, the
 * agent's model, apiKeySource and client version (`bench_report_invalid`); a parser it does not ship
 * is named as not re-derived. A preset's name and command are checked against this Practonaut's when
 * the report's Practonaut version is its own. A task's action limit is counted from the agent's own
 * records. Artifact-level reports and co-actor runs are not re-verified here (their strands add it).
 *
 * What this shows: the report's verdicts follow from the artifacts on disk. What it does not show:
 * that those artifacts came from the agent named in the report. Whoever can write the run directory
 * can replace them; there is no signature.
 */
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { sha256Hex } from '../canonical/index.ts';
import { cliText } from '../cli/messages.ts';
import { safeText } from '../cli/output.ts';
import { checkInProcess, traceInProcess } from '../cli/runtime.ts';
import { nativeMatchesState } from '../host/export-pair.ts';
import { PackageError } from '../package/index.ts';
import { LIMITS } from '../package/limits.ts';
import { parseJsonEntry } from '../package/json.ts';
import type { CheckerVerdict, SessionData, World } from '../world/types.ts';
import type { LibraryEntry } from '../library/index.ts';
import { BENCH_REFERENCES_FILE, BENCH_WORLD_FILE, BenchReportError, type BenchErrorCode, type BenchReportV1, type BenchReportV2, type BenchReportV3, type BenchRun, type BenchRunV2, type SessionRunV3 } from './report.ts';
import { hashFile, mutationCounts, parseMutations, readLogHead, RUN_EVIDENCE, timelineOf, type MutationLogFormat } from './evidence.ts';
import { AGENT_PRESETS, clientInit, clientOf, displayCommand, PRESET_INFO, requestedBilling, vendorOf, type AgentSpec } from './agents.ts';
import { readClientEvidence, type ClientEvidence } from './client-evidence.ts';
import { apiKeySourceValue, SHIPPED_PARSERS } from './parsers.ts';
import { identityCache } from './identity.ts';
import { nativeFile, RUN_ARTIFACTS, verdictOf, taskLimitsOf } from './run.ts';
import { PACKAGE_VERSION } from '../version.ts';
import { MAX_REFERENCES_BYTES, readRegularFile, ReferencesFileSchema, referenceProblem, worldContentHash, worldFromPackage, type BenchReference, type ReferencesFile } from './world.ts';
import { analyseLengthForSeeds } from '../authoring/minimal-length.ts';

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export interface VerificationResult { reverified: number; unjudged: number }
export interface VerificationResultV2 extends VerificationResult { references: number; world: { id: string; version: string; contentHash: string }; library?: LibraryAnchor }
/** bench/3: also the parsers whose values were re-derived (and those this Practonaut does not ship),
 * and whether the preset's name and command were checked (null: not a preset). */
export interface VerificationResultV3 extends VerificationResultV2 { parsers: { rederived: number; notShipped: string[] }; preset: 'checked' | 'not-checked' | null }

async function artifact(directory: string, runId: string, name: string, expected: string, code: BenchErrorCode): Promise<string> {
  const bytes = await readRegularFile(join(directory, runId, name), MAX_ARTIFACT_BYTES);
  if (bytes === null) throw new BenchReportError(cliText('verifyArtifactMissing', { run: runId, name }), code);
  if (sha256Hex(bytes) !== expected) throw new BenchReportError(cliText('verifyArtifactHash', { run: runId, name }), code);
  return bytes.toString('utf8');
}

/** Re-judges one judged run from its artifacts against `world`; returns the session's text. */
async function rejudge(run: BenchRun | SessionRunV3, world: World, directory: string, artifactCode: BenchErrorCode, nativeName: string = RUN_ARTIFACTS.native): Promise<string> {
  if (!run.artifacts) throw new BenchReportError(`run ${run.id} binds no artifacts; the report can be consistency-checked but not re-verified`);
  const sessionText = await artifact(directory, run.id, RUN_ARTIFACTS.session, run.artifacts.session, artifactCode);
  const checkerText = await artifact(directory, run.id, RUN_ARTIFACTS.checker, run.artifacts.checker, artifactCode);
  const nativeText = run.artifacts.native === null ? null : await artifact(directory, run.id, nativeName, run.artifacts.native, artifactCode);
  const session = parseJsonEntry(Buffer.from(sessionText), RUN_ARTIFACTS.session, 64) as SessionData;
  if (session?.seed !== run.seed || session.taskId !== run.taskId || session.world?.id !== world.id || !Array.isArray(session.log))
    throw new BenchReportError(cliText('verifySessionOther', { run: run.id }));
  if (session.log.length !== run.actions) throw new BenchReportError(cliText('verifyActions', { run: run.id, given: run.actions, actual: session.log.length }));
  const settings = { seed: run.seed, taskId: run.taskId };
  let sessionRaw: CheckerVerdict, nativeRaw: CheckerVerdict | null = null;
  try { sessionRaw = await checkInProcess(world, sessionText, settings); }
  catch { throw new BenchReportError(cliText('verifyCheckerSession', { run: run.id })); }
  if (nativeText !== null) {
    if (!nativeMatchesState(world, nativeText, session.state)) throw new BenchReportError(cliText('verifyNativeState', { run: run.id }));
    try { nativeRaw = await checkInProcess(world, nativeText, settings); }
    catch { throw new BenchReportError(cliText('verifyCheckerNative', { run: run.id })); }
  }
  const stored = (() => { try { return parseJsonEntry(Buffer.from(checkerText), RUN_ARTIFACTS.checker, 64); } catch { return undefined; } })();
  if (!isDeepStrictEqual(stored, JSON.parse(JSON.stringify({ session: sessionRaw, native: nativeRaw }))))
    throw new BenchReportError(cliText('verifyCheckerStored', { run: run.id }));
  const recomputed = { session: verdictOf(sessionRaw, run.taskId), native: nativeRaw === null ? null : verdictOf(nativeRaw, run.taskId) };
  if (!isDeepStrictEqual(recomputed, run.checker)) throw new BenchReportError(cliText('verifyVerdict', { run: run.id, result: `session ${recomputed.session.passed ? 'pass' : 'fail'}${recomputed.native ? `, native ${recomputed.native.passed ? 'pass' : 'fail'}` : ''}` }));
  return sessionText;
}

/** bench/2 run evidence (PADR-0039): the call and mutation logs, the trace and the picture against
 * their hashes; the mutation log against the run's counters. */
async function evidenceHashes(run: BenchRunV2 | SessionRunV3, directory: string): Promise<{ mutations: string | null; trace: string | null }> {
  const code: BenchErrorCode = 'bench_artifact_changed';
  if (run.logs?.calls) await artifact(directory, run.id, RUN_EVIDENCE.calls, run.logs.calls.sha256, code);
  const mutations = run.logs ? await artifact(directory, run.id, RUN_EVIDENCE.mutations, run.logs.mutations.sha256, code) : null;
  const trace = typeof run.artifacts?.trace === 'string' ? await artifact(directory, run.id, RUN_EVIDENCE.trace, run.artifacts.trace, code) : null;
  if (typeof run.artifacts?.board === 'string') await artifact(directory, run.id, RUN_EVIDENCE.board, run.artifacts.board, code);
  return { mutations, trace };
}

/**
 * A task's limits (PADR-0040), counted as the host counts them from the runner's host-side mutation
 * log: every accepted action, undo and reset uses one change, every accepted check one check. Never
 * from the final history alone (an undone action still counted) nor from the agent's call log. The
 * log's records are bound to the run's counters by verifyEvidence. A judged run of a limited task
 * without the log cannot be verified and is refused.
 */
function verifyLimits(run: BenchRunV2 | SessionRunV3, world: World, settingsChecks: number | undefined, mutations: string | null, format: MutationLogFormat = 'v2'): void {
  const own = world.tasks.find(task => task.id === run.taskId)?.limits;
  const actionLimit = own?.actions;
  const checkLimits = [own?.checks, settingsChecks].filter((value): value is number => value !== undefined);
  const checkLimit = checkLimits.length ? Math.min(...checkLimits) : undefined;
  if (actionLimit === undefined && checkLimit === undefined) return;
  // An early bound: the agent's own actions in the final history (bench/3 decision 7; /2: all of them).
  const agentOwn = 'agentActions' in run ? run.agentActions : run.actions;
  if (actionLimit !== undefined && agentOwn > actionLimit) throw new BenchReportError(cliText('verifyActionLimit', { run: run.id, actions: agentOwn, limit: actionLimit }));
  if (mutations === null || !run.logs) {
    if (run.checker === null && run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check === 0) return;
    throw new BenchReportError(cliText('verifyLimitsEvidence', { run: run.id }));
  }
  let records;
  try { records = parseMutations(mutations, format); } catch { throw new BenchReportError(cliText('verifyMutationsFormat', { run: run.id })); }
  // Counted from the agent's own records only: a co-actor's edits use none of its budget.
  const counted = mutationCounts(records, 'agent'), changes = counted.accepted + counted.undos + counted.resets;
  if (actionLimit !== undefined && changes > actionLimit) throw new BenchReportError(cliText('verifyActionLimit', { run: run.id, actions: changes, limit: actionLimit }));
  if (checkLimit !== undefined && counted.checks > checkLimit) throw new BenchReportError(cliText('verifyCheckLimit', { run: run.id, checks: counted.checks, limit: checkLimit }));
}

/** A run's client figures name the model (and version) its agent's own stdout names in its init
 * event (second review): a report relabelled to another model without its output is refused. */
async function verifyClientModel(run: BenchRunV2, directory: string): Promise<void> {
  if (!run.client || run.client.model === null) return;
  const head = await readLogHead(join(directory, run.id, 'agent.stdout'), 64 * 1024);
  const init = clientInit(head?.text ?? '');
  if (init.model !== run.client.model || (run.client.version !== undefined && init.version !== run.client.version))
    throw new BenchReportError(cliText('verifyClientModel', { run: run.id, model: safeText(run.client.model), seen: safeText(init.model ?? 'none') }));
}

/** The mutation log agrees with the run's counters, and the checker re-derives the stored trace from
 * the session and that log. */
async function verifyEvidence(run: BenchRunV2 | SessionRunV3, world: World, sessionText: string | null, texts: { mutations: string | null; trace: string | null }, format: MutationLogFormat = 'v2'): Promise<void> {
  // A trace is only ever accepted with the mutation log that re-derives it.
  if (texts.trace !== null && (texts.mutations === null || !run.logs)) throw new BenchReportError(cliText('verifyTrace', { run: run.id }));
  if (texts.mutations === null || !run.logs) return;
  let records;
  try { records = parseMutations(texts.mutations, format); } catch { throw new BenchReportError(cliText('verifyMutationsFormat', { run: run.id })); }
  // Co-actor records are matched to their schedule by the scenario strand's checks (PADR-0044 decision 7), not here.
  if (records.some(record => record.actor === 'co-actor')) throw new BenchReportError(cliText('verifyCoActor', { run: run.id }));
  const counted = mutationCounts(records, 'agent'), omitted = run.logs.mutations.omitted;
  if (records.length !== run.logs.mutations.entries || counted.accepted !== run.acceptedActions || counted.undos !== run.undos || counted.resets !== run.resets
    || counted.act + counted.undoCalls + counted.resetCalls + counted.checkCalls + omitted !== run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check
    || counted.rejected > run.rejectedActions || (omitted === 0 && counted.rejected !== run.rejectedActions))
    throw new BenchReportError(cliText('verifyMutationsCounters', { run: run.id }));
  if (texts.trace === null || sessionText === null) return;
  const timeline = timelineOf(records, omitted, format === 'v3');
  let derived: string;
  try {
    if ('reason' in timeline) throw new Error(timeline.reason);
    derived = JSON.stringify(await traceInProcess(world, sessionText, timeline.timeline, { seed: run.seed, taskId: run.taskId })) + '\n';
  } catch { throw new BenchReportError(cliText('verifyTrace', { run: run.id })); }
  if (derived !== texts.trace) throw new BenchReportError(cliText('verifyTrace', { run: run.id }));
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

/** How a /2 library bench relates to the library this Practonaut ships: `same` (same id, version and
 * content), or `other` when the id or version differ (its content cannot be compared here). The same
 * id and version with other content is refused: a swapped stored world cannot pass as the library. */
export type LibraryAnchor = { status: 'same' } | { status: 'other'; shipped: { id: string; version: string } };
export function libraryAnchor(bound: { worldId: string; version: string; contentHash: string }, shipped: { id: string; version: string; contentHash: string }): LibraryAnchor {
  if (bound.worldId !== shipped.id || bound.version !== shipped.version) return { status: 'other', shipped: { id: shipped.id, version: shipped.version } };
  if (bound.contentHash !== shipped.contentHash)
    throw new BenchReportError(cliText('verifyLibraryContent', { world: safeText(bound.worldId), version: safeText(bound.version), hash: bound.contentHash, shipped: shipped.contentHash }), 'bench_world_changed');
  return { status: 'same' };
}

/** bench/2: the stored world, as the report binds it. */
async function storedWorld(report: BenchReportV2 | BenchReportV3, directory: string): Promise<World> {
  const bound = report.environment.world, fail = (message: string): never => { throw new BenchReportError(message, 'bench_world_changed'); };
  const bytes = await readRegularFile(join(directory, BENCH_WORLD_FILE), LIMITS.maxArchiveBytes);
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
  if (!isDeepStrictEqual(taskLimitsOf(world, report.settings.tasks), bound.limits ?? [])) fail(cliText('verifyWorldLimits'));
  return world;
}

/** bench/2: `references.json` against the hash the report binds, parsed. */
async function storedReferences(report: BenchReportV2 | BenchReportV3, directory: string): Promise<ReferencesFile['references']> {
  const bound = report.references;
  if (bound === null) return [];
  const bytes = await readRegularFile(join(directory, BENCH_REFERENCES_FILE), MAX_REFERENCES_BYTES);
  if (bytes === null) throw new BenchReportError(cliText('verifyReferencesMissing', { file: BENCH_REFERENCES_FILE }), 'bench_artifact_changed');
  if (sha256Hex(bytes) !== bound.sha256) throw new BenchReportError(cliText('verifyReferencesHash', { file: BENCH_REFERENCES_FILE }), 'bench_artifact_changed');
  let parsed: ReturnType<typeof ReferencesFileSchema.safeParse> | undefined;
  try { parsed = ReferencesFileSchema.safeParse(parseJsonEntry(bytes, BENCH_REFERENCES_FILE, 64)); } catch { parsed = undefined; }
  if (!parsed?.success) throw new BenchReportError(cliText('verifyReferencesFormat', { file: BENCH_REFERENCES_FILE }), 'bench_reference_invalid');
  return parsed.data.references;
}

/** bench/2: every stored reference against the stored world, for each seed a run of its task used. */
async function verifyReferences(report: BenchReportV2 | BenchReportV3, world: World, stored: ReferencesFile['references']): Promise<number> {
  const bound = report.references;
  if (bound === null) return 0;
  const fail = (message: string): never => { throw new BenchReportError(message, 'bench_reference_invalid'); };
  if (stored.length !== bound.tasks.length) fail(cliText('verifyReferenceTask', { task: (stored.find(entry => !bound.tasks.some(task => task.taskId === entry.taskId)) ?? stored[0])?.taskId ?? '' }));
  for (const [index, expected] of bound.tasks.entries()) {
    const entry = stored[index]!;
    if (entry.taskId !== expected.taskId || entry.source !== expected.source) fail(cliText('verifyReferenceTask', { task: expected.taskId }));
    if (entry.steps.length !== expected.actions) fail(cliText('verifyReferenceLength', { task: expected.taskId, given: expected.actions, actual: entry.steps.length }));
    // Only seeds that runs of this task used: an interrupted bench re-checks nothing it did not run.
    for (const seed of new Set((report.runs as ReadonlyArray<{ taskId: string; seed: number }>).filter(run => run.taskId === expected.taskId).map(run => run.seed))) {
      const problem = await referenceProblem(world, expected.taskId, entry as BenchReference, seed);
      if (problem !== null) fail(problem);
    }
    // A minimality claim is re-derived on the stored world (PADR-0040).
    if (expected.minimal !== undefined) {
      const proven = analyseLengthForSeeds(world, expected.taskId, report.settings.seeds, expected.actions).kind === 'minimal';
      if (proven !== expected.minimal) fail(cliText('verifyReferenceMinimal', { task: expected.taskId, given: cliText(expected.minimal ? 'lengthMinimal' : 'lengthReference'), actual: cliText(proven ? 'lengthMinimal' : 'lengthReference') }));
    }
  }
  return bound.tasks.length;
}

/** bench/2, in the order of PADR-0036 decision 6: the stored world (and, for a library bench, this
 * Practonaut's library), `references.json` and every run artifact against their hashes, the stored
 * references against the stored world, then every judged run re-judged against that world. Throws a
 * named `BenchReportError` on the first difference. */
export async function verifyBenchV2(report: BenchReportV2, runsDirectory: string, shippedLibrary: () => Promise<{ world: World; contentHash: string }>): Promise<VerificationResultV2> {
  const world = await storedWorld(report, runsDirectory);
  let library: LibraryAnchor | undefined;
  if (report.environment.world.source === 'library') {
    const shipped = await shippedLibrary();
    library = libraryAnchor(report.environment.world, { id: shipped.world.id, version: shipped.world.version, contentHash: shipped.contentHash });
  }
  const stored = await storedReferences(report, runsDirectory);
  // Artifacts and evidence are compared with their hashes before anything is re-judged.
  const evidence = new Map<string, { mutations: string | null; trace: string | null }>();
  for (const run of report.runs) {
    if (run.artifacts) {
      await artifact(runsDirectory, run.id, RUN_ARTIFACTS.session, run.artifacts.session, 'bench_artifact_changed');
      await artifact(runsDirectory, run.id, RUN_ARTIFACTS.checker, run.artifacts.checker, 'bench_artifact_changed');
      if (run.artifacts.native !== null) await artifact(runsDirectory, run.id, RUN_ARTIFACTS.native, run.artifacts.native, 'bench_artifact_changed');
    }
    evidence.set(run.id, await evidenceHashes(run, runsDirectory));
    await verifyClientModel(run, runsDirectory);
  }
  const references = await verifyReferences(report, world, stored);
  let reverified = 0, unjudged = 0;
  for (const run of report.runs) {
    // The host enforces a task's limits; a run that used more cannot come from a bench run.
    verifyLimits(run, world, report.settings.checks, evidence.get(run.id)!.mutations);
    if (run.checker === null) { unjudged++; await verifyEvidence(run, world, null, evidence.get(run.id)!); continue; }
    const sessionText = await rejudge(run, world, runsDirectory, 'bench_artifact_changed');
    await verifyEvidence(run, world, sessionText, evidence.get(run.id)!);
    reverified++;
  }
  return { reverified, unjudged, references, world: { id: world.id, version: world.version, contentHash: report.environment.world.contentHash }, ...(library ? { library } : {}) };
}

/** A version as SemVer 2.0.0 writes it: numeric parts without leading zeros, no empty identifier (the
 * numbers bounded so they stay exact). */
const NUMERIC = String.raw`(?:0|[1-9]\d{0,8})`, PRE_ID = String.raw`(?:0|[1-9]\d{0,14}|\d*[A-Za-z-][0-9A-Za-z-]*)`, BUILD_ID = '[0-9A-Za-z-]+';
const SEMVER = new RegExp(`^(${NUMERIC})\\.(${NUMERIC})\\.(${NUMERIC})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+${BUILD_ID}(?:\\.${BUILD_ID})*)?$`);
/** The order of two semantic versions (a pre-release below its release, SemVer 2.0.0 precedence); null
 * when either is not a valid SemVer 2.0.0 version. */
export function versionOrder(a: string, b: string): number | null {
  const parse = (value: string): { core: number[]; pre: string[] } | null => {
    const match = SEMVER.exec(value);
    return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] } : null;
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i]! < y.core[i]! ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}
/** A report made by a Practonaut newer than this one: only such a report may name a parser this one does
 * not ship (a version that is not a version is never newer). */
const madeByNewer = (report: { environment: { practonaut: string } }): boolean => (versionOrder(report.environment.practonaut, PACKAGE_VERSION) ?? 0) > 0;

/** bench/3: the values a shipped parser reads from a run's bound stdout, re-derived and compared with the
 * report (decisions 5, 6 and 9); the agent-level values from the first run that reports each. */
function verifyClientValues(report: BenchReportV3, run: SessionRunV3, read: ClientEvidence): void {
  const fail = (field: string): never => { throw new BenchReportError(cliText('verifyClientValue', { run: run.id, field })); };
  // A report relabelled to another model is named as such (as for /2).
  if (run.client && read.client && run.client.model !== read.client.model) throw new BenchReportError(cliText('verifyClientModel', { run: run.id, model: safeText(run.client.model ?? 'none'), seen: safeText(read.client.model ?? 'none') }));
  if (!isDeepStrictEqual(read.client, run.client)) fail('client');
  if (!isDeepStrictEqual(read.isolation, run.isolation)) fail('isolation');
  // The failure the shipped parser reads must be the report's, whatever the run's status: a client
  // failure in a judged run's own output, or one the report leaves out, is refused. Only an interrupted
  // run keeps the runner's reason (it was stopped before its output was classified).
  if (run.failure?.reason === 'interrupted') return;
  const failure = read.failure;
  if (failure === null) { if (run.failure?.parser) fail('failure'); return; }
  if (!run.failure || failure.reason !== run.failure.reason || failure.parser !== run.failure.parser || failure.code !== run.failure.code || failure.beforeModelWork !== run.failure.beforeModelWork) fail('failure');
}

/**
 * bench/3 at session level, in the order of PADR-0036 decision 6 extended by PADR-0044: the stored world
 * (its adapter, and every task identity the report lists), this Practonaut's library for a library bench,
 * `references.json`, every run artifact, log and stdout against their hashes, the values a shipped parser
 * reads from each stdout, the stored references against the stored world, then every judged run
 * re-judged against that world. Throws a named `BenchReportError` on the first difference.
 */
export async function verifyBenchV3(report: BenchReportV3, runsDirectory: string, shippedLibrary: () => Promise<{ world: World; contentHash: string }>): Promise<VerificationResultV3> {
  if (report.verdictLevel !== 'session') throw new BenchReportError(cliText('verifyArtifactLevel'));
  const world = await storedWorld(report, runsDirectory), changed = (message: string): never => { throw new BenchReportError(message, 'bench_world_changed'); };
  if (report.environment.app.adapterId !== world.app.adapterId) changed(cliText('verifyWorldApp', { given: safeText(report.environment.app.adapterId), stored: safeText(world.app.adapterId) }));
  if (report.environment.world.scenarios !== undefined) throw new BenchReportError(cliText('verifyCoActor', { run: report.environment.world.scenarios[0]?.taskId ?? '' }));
  const identityOf = identityCache(world);
  for (const entry of report.instances) {
    let identity: string;
    try { identity = identityOf(entry.taskId, entry.seed); } catch { return changed(cliText('verifyIdentity', { task: safeText(entry.taskId), seed: entry.seed })); }
    if (identity !== entry.identity) changed(cliText('verifyIdentity', { task: safeText(entry.taskId), seed: entry.seed }));
  }
  let library: LibraryAnchor | undefined;
  if (report.environment.world.source === 'library') {
    // The bundled library is the Excalidraw adapter's; a library bench of another adapter has none here.
    const shipped = await shippedLibrary();
    library = report.environment.app.adapterId === shipped.world.app.adapterId ? libraryAnchor(report.environment.world, { id: shipped.world.id, version: shipped.world.version, contentHash: shipped.contentHash }) : { status: 'other', shipped: { id: shipped.world.id, version: shipped.world.version } };
  }
  const stored = await storedReferences(report, runsDirectory);
  const runs = report.runs as SessionRunV3[], nativeName = nativeFile(report.environment.app.adapterId);
  const spec = { kind: report.agent.kind, name: report.agent.name, command: report.agent.command } as AgentSpec;
  const tools = report.toolchain.kind === 'practonaut' ? report.toolchain.tools : [];
  // Artifacts, evidence and stdout are compared with their hashes before anything is re-derived.
  const evidence = new Map<string, { mutations: string | null; trace: string | null }>(), reads = new Map<string, ClientEvidence>();
  const notShipped = new Set<string>(), unread = new Set<string>(), newer = madeByNewer(report);
  let rederived = 0;
  for (const run of runs) {
    if (run.artifacts) {
      await artifact(runsDirectory, run.id, RUN_ARTIFACTS.session, run.artifacts.session, 'bench_artifact_changed');
      await artifact(runsDirectory, run.id, RUN_ARTIFACTS.checker, run.artifacts.checker, 'bench_artifact_changed');
      if (run.artifacts.native !== null) await artifact(runsDirectory, run.id, nativeName, run.artifacts.native, 'bench_artifact_changed');
    }
    evidence.set(run.id, await evidenceHashes(run, runsDirectory));
    // An external run whose stdout the runner could not read binds none; a readable stdout in its folder
    // was hidden from the report (its evidence would not be re-derived), so it is refused.
    if (run.stdout === null && await hashFile(join(runsDirectory, run.id, 'agent.stdout')) !== null)
      throw new BenchReportError(cliText('verifyStdoutUnbound', { run: run.id }), 'bench_artifact_changed');
    if (run.stdout) {
      const path = join(runsDirectory, run.id, 'agent.stdout'), bound = await hashFile(path);
      if (bound === null) throw new BenchReportError(cliText('verifyArtifactMissing', { run: run.id, name: 'agent.stdout' }), 'bench_artifact_changed');
      if (bound.sha256 !== run.stdout.sha256 || bound.bytes !== run.stdout.bytes) throw new BenchReportError(cliText('verifyArtifactHash', { run: run.id, name: 'agent.stdout' }), 'bench_artifact_changed');
      const parser = run.client?.parser;
      // A report of this Practonaut or an older one can only name parsers this one ships: any other is
      // refused. Only a newer Practonaut's parser, or a preset whose client (and so its tool naming) this one
      // does not know, as in an older report after a preset was renamed, leaves the values not re-derived —
      // and every surface and the gate then treat them as the report's claims.
      if (parser !== undefined && !SHIPPED_PARSERS.has(parser)) {
        if (!newer) throw new BenchReportError(cliText('verifyParserUnknown', { run: run.id, parser: safeText(parser), version: safeText(report.environment.practonaut) }));
        notShipped.add(parser); unread.add(run.id); continue;
      }
      if (parser !== undefined && report.agent.kind === 'preset' && !Object.hasOwn(PRESET_INFO, report.agent.name)) { notShipped.add(`${parser} (preset ${report.agent.name})`); unread.add(run.id); continue; }
      const read = await readClientEvidence(spec, path, tools);
      if (read.stdout?.sha256 !== run.stdout.sha256) throw new BenchReportError(cliText('verifyArtifactHash', { run: run.id, name: 'agent.stdout' }), 'bench_artifact_changed');
      verifyClientValues(report, run, read);
      reads.set(run.id, read); rederived++;
    }
  }
  // The agent's values, each from the first run whose stdout reports it (decision 5). A run whose parser
  // this Practonaut does not ship is read by nobody here: a value it could be the first to report stays the
  // report's claim, but one that a run read by a shipped parser reports first is checked (Codex 3).
  if (report.agent.kind !== 'builtin') {
    const first = <T>(pick: (read: ClientEvidence) => T | null): { value: T | null } | null => {
      for (const run of runs) {
        if (unread.has(run.id)) return null;
        const value = reads.get(run.id), picked = value ? pick(value) : null;
        if (picked !== null) return { value: picked };
      }
      return { value: null };
    };
    const agentField = (field: string): never => { throw new BenchReportError(cliText('verifyClientValue', { run: runs[0]!.id, field })); };
    const model = first(read => read.init.model), apiKeySource = first(read => read.init.apiKeySource), version = first(read => read.init.version);
    if (model && report.agent.model !== model.value) agentField('agent.model');
    if (apiKeySource && report.agent.apiKeySource !== apiKeySourceValue(apiKeySource.value)) agentField('agent.apiKeySource');
    // The client version with its source, the vendor from the preset's mapping (of the attested model,
    // else of the requested one), and the client program the preset starts (decision 5); a preset this
    // Practonaut does not know has no mapping here.
    const source = report.agent.kind === 'preset' ? 'client-attested' as const : 'command-output' as const;
    if (version && !isDeepStrictEqual(report.agent.clientVersion, version.value === null ? { value: null, source: 'none' } : { value: version.value, source })) agentField('agent.clientVersion');
    // (When every run was read, as before: this Practonaut's mapping, also for a preset it does not know.)
    const knownPreset = !notShipped.size || report.agent.kind !== 'preset' || Object.hasOwn(PRESET_INFO, report.agent.name);
    if (model && knownPreset &&!isDeepStrictEqual(report.agent.vendor, vendorOf(spec, model.value, report.agent.requestedModel))) agentField('agent.vendor');
    if (knownPreset && !isDeepStrictEqual(report.agent.client, clientOf(spec))) agentField('agent.client');
    // What the preset was set up for, as this Practonaut sets it up: only for a report of this version
    // whose every run was read here.
    if (!notShipped.size && report.environment.practonaut === PACKAGE_VERSION) {
      if (!isDeepStrictEqual(report.agent.billing, requestedBilling(spec, report.agent.keptEnv))) agentField('agent.billing');
      if (report.agent.settings.length) agentField('agent.settings');
    }
  }
  // A preset's name and command, against this Practonaut's own presets when the report is its own version.
  let preset: VerificationResultV3['preset'] = null;
  if (report.agent.kind === 'preset') {
    if (report.environment.practonaut !== PACKAGE_VERSION) preset = 'not-checked';
    else {
      const shipped = Object.hasOwn(AGENT_PRESETS, report.agent.name) ? AGENT_PRESETS[report.agent.name]! : null;
      if (shipped === null || !isDeepStrictEqual(displayCommand(shipped), report.agent.command)) throw new BenchReportError(cliText('verifyPreset', { name: safeText(report.agent.name) }));
      preset = 'checked';
    }
  }
  const references = await verifyReferences(report, world, stored);
  let reverified = 0, unjudged = 0;
  for (const run of runs) {
    verifyLimits(run, world, report.settings.checks, evidence.get(run.id)!.mutations, 'v3');
    if (run.checker === null) { unjudged++; await verifyEvidence(run, world, null, evidence.get(run.id)!, 'v3'); continue; }
    const sessionText = await rejudge(run, world, runsDirectory, 'bench_artifact_changed', nativeName);
    await verifyEvidence(run, world, sessionText, evidence.get(run.id)!, 'v3');
    // agentActions: without a co-actor, every action of the final history is the agent's.
    if (run.agentActions !== run.actions) throw new BenchReportError(cliText('verifyActions', { run: run.id, given: run.agentActions, actual: run.actions }));
    reverified++;
  }
  return { reverified, unjudged, references, world: { id: world.id, version: world.version, contentHash: report.environment.world.contentHash }, ...(library ? { library } : {}), parsers: { rederived, notShipped: [...notShipped].sort() }, preset };
}

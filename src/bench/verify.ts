/**
 * `practonaut report --verify`: re-judges every run of a bench report from the artifacts in its run
 * directory and the bundled library.
 *
 * Re-verified: the library (id, version and content hash of the world), each run's reference length
 * (`referenceActions`, from the library entry), and for each judged run the SHA-256 the report binds
 * for the committed session, the native export and the checker output; the session's task, seed and
 * final history length (`actions`); the independent checker re-run on the session and the native
 * export, whose verdicts must equal both the stored checker output and the report's verdicts. pass,
 * pass@1, pass^k, mean actions and efficiency then follow from these values (the validator
 * re-derives them). Any difference rejects the report.
 *
 * Not re-verifiable, self-reported by the runner: acceptedActions, rejectedActions, undos, resets,
 * toolCalls, wallMs, status, agentExitCode, note and the client-attested model.
 *
 * What this shows: the report's verdicts follow from the artifacts on disk. What it does not show:
 * that those artifacts came from the agent named in the report. Whoever can write the run directory
 * can replace them; there is no signature.
 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { sha256Hex } from '../canonical/index.ts';
import { checkInProcess } from '../cli/runtime.ts';
import { nativeMatchesState } from '../host/export-pair.ts';
import { parseJsonEntry } from '../package/json.ts';
import type { CheckerVerdict, SessionData, World } from '../world/types.ts';
import type { LibraryEntry } from '../library/index.ts';
import { BenchReportError, type BenchReport } from './report.ts';
import { RUN_ARTIFACTS, verdictOf } from './run.ts';

const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

export interface VerificationResult { reverified: number; unjudged: number }

async function artifact(directory: string, runId: string, name: string, expected: string): Promise<string> {
  const path = join(directory, runId, name);
  let bytes: Buffer;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) throw new Error('not a bounded regular file');
    bytes = await readFile(path);
  } catch { throw new BenchReportError(`run ${runId}: artifact ${name} is missing or unreadable in the run directory (if the report was moved, point --runs at its bench folder)`); }
  if (sha256Hex(bytes) !== expected) throw new BenchReportError(`run ${runId}: artifact ${name} does not match the hash the report binds`);
  return bytes.toString('utf8');
}

/** Re-judges every judged run of an already validated report; throws `bench_report_invalid` on any difference. */
export async function verifyBenchArtifacts(report: BenchReport, runsDirectory: string, library: { world: World; entries: ReadonlyMap<string, LibraryEntry>; contentHash: string }): Promise<VerificationResult> {
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
    if (!run.artifacts) throw new BenchReportError(`run ${run.id} binds no artifacts; the report can be consistency-checked but not re-verified`);
    const sessionText = await artifact(runsDirectory, run.id, RUN_ARTIFACTS.session, run.artifacts.session);
    const checkerText = await artifact(runsDirectory, run.id, RUN_ARTIFACTS.checker, run.artifacts.checker);
    const session = parseJsonEntry(Buffer.from(sessionText), RUN_ARTIFACTS.session, 64) as SessionData;
    if (session?.seed !== run.seed || session.taskId !== run.taskId || session.world?.id !== world.id || !Array.isArray(session.log))
      throw new BenchReportError(`run ${run.id}: the session artifact belongs to another task or seed`);
    if (session.log.length !== run.actions) throw new BenchReportError(`run ${run.id}: the report counts ${run.actions} actions; the session's final history holds ${session.log.length}`);
    const settings = { seed: run.seed, taskId: run.taskId };
    let sessionRaw: CheckerVerdict, nativeRaw: CheckerVerdict | null = null;
    try { sessionRaw = await checkInProcess(world, sessionText, settings); }
    catch { throw new BenchReportError(`run ${run.id}: the checker rejects the session artifact`); }
    if (run.artifacts.native !== null) {
      const nativeText = await artifact(runsDirectory, run.id, RUN_ARTIFACTS.native, run.artifacts.native);
      if (!nativeMatchesState(world.schema, nativeText, session.state)) throw new BenchReportError(`run ${run.id}: the native export does not show the session's final state`);
      try { nativeRaw = await checkInProcess(world, nativeText, settings); }
      catch { throw new BenchReportError(`run ${run.id}: the checker rejects the native export`); }
    }
    const stored = (() => { try { return parseJsonEntry(Buffer.from(checkerText), RUN_ARTIFACTS.checker, 64); } catch { return undefined; } })();
    if (!isDeepStrictEqual(stored, JSON.parse(JSON.stringify({ session: sessionRaw, native: nativeRaw }))))
      throw new BenchReportError(`run ${run.id}: the stored checker output differs from the re-run`);
    const recomputed = { session: verdictOf(sessionRaw, run.taskId), native: nativeRaw === null ? null : verdictOf(nativeRaw, run.taskId) };
    if (!isDeepStrictEqual(recomputed, run.checker)) throw new BenchReportError(`run ${run.id}: the report's verdict differs from the re-run checker (re-run: session ${recomputed.session.passed ? 'pass' : 'fail'}${recomputed.native ? `, native ${recomputed.native.passed ? 'pass' : 'fail'}` : ''})`);
    reverified++;
  }
  return { reverified, unjudged };
}

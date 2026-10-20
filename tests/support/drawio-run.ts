/**
 * One run of the draw.io library protocol (PADR-0049 decision 8.4), in its own process with its own
 * browser: `node --import ./tests/support/test-home.ts tests/support/drawio-run.ts <order> <seed> <out>`
 * with order `forward`, `reverse` or `shuffle` (the seed fixes the shuffle and is recorded).
 *
 * For every task × case × sequence (the unchanged start, the reference, every near miss): a new core
 * session, `restoreState` of its start, every step through `adapter.apply` (all checks of decision
 * 4), the app's export after every step, `exportArtifact`, the PNG, and the checker's verdict on that
 * native file with format `drawio`. Recorded per sequence: the canonical hash of each export (the
 * random diagram id normalised), of the native file, of the PNG, and the full verdict. Also recorded:
 * the peak RSS of this Node process and of its Chromium process tree, any request the shell refused,
 * the browser's own version, and what the Chromium processes were started with: how many there were
 * and how many carry `--no-sandbox` (review m2c, runtime-1). Library content comes from the world;
 * nothing here decides a verdict.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDrawioAdapter } from '../../src/adapters/drawio/index.ts';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkSubmission } from '../../src/checker/index.ts';
import { sha256Hex } from '../../src/canonical/index.ts';
import { Session } from '../../src/core/index.ts';
import { LIBRARY_CASES } from '../../src/library/index.ts';
import type { Action, State, World } from '../../src/world/types.ts';
import type { TaskOracle } from '../../src/authoring/from-scenes.ts';
import { generateSet } from '../../src/challenge/build.ts';
import { FAMILIES } from '../../src/challenge/families.ts';
import { drawioLibrary, drawioTaskWorld, drawioTestRuntime } from './drawio.ts';

export type Order = 'forward' | 'reverse' | 'shuffle';
export interface SequenceRecord {
  key: string; taskId: string; variantCase: string; kind: 'start' | 'reference' | 'near-miss'; nearMiss?: string;
  steps: number; applied: boolean; failure?: string;
  exports: string[]; native: string; png: string;
  verdict: { passed: boolean; errors: string[] } | { refused: string };
}
export interface RunRecord {
  schema: 'practonaut.drawio-run/2'; order: Order; seed: number; keys: string[]; sequences: SequenceRecord[];
  /** `startMs`: the adapter's start in this run, from the call to its first scene confirmed. */
  refusedRequests: string[]; startMs: number; peakRss: { node: number; chromiumTree: number | null };
  /** The browser's version as it reports it; the Chromium processes observed after the start and before the close. */
  chromium: string | null; sandbox: SandboxObservation | null;
}
/** Processes under this one and how many of them carry `--no-sandbox`: the most seen in any sample. */
export interface SandboxObservation { samples: number; processes: number; noSandbox: number }

/** The random diagram id is file metadata (decision 5.4); everything else of the export is compared. */
export const normaliseExport = (xml: string): string => xml.replace(/(<diagram\b[^>]*\bid=")[^"]*(")/, '$1·$2');
/** Fixed shuffle: a seeded linear congruential generator, so the order is recorded by its seed. */
export function ordered<T>(items: readonly T[], order: Order, seed: number): T[] {
  if (order === 'forward') return [...items];
  if (order === 'reverse') return [...items].reverse();
  const out = [...items]; let state = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const j = state % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
/** Resident memory of every descendant of this process, in bytes (POSIX `ps`); null where not measured. */
export function chromiumTreeRss(): number | null {
  if (process.platform === 'win32') return null;
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map(line => line.trim().split(/\s+/).map(Number) as [number, number, number]);
    const children = new Map<number, number[]>();
    for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    const rss = new Map(rows.map(([pid, , kb]) => [pid, kb * 1024]));
    let total = 0; const queue = [...(children.get(process.pid) ?? [])];
    while (queue.length) { const pid = queue.pop()!; if (pid === process.pid) continue; total += rss.get(pid) ?? 0; queue.push(...(children.get(pid) ?? [])); }
    return total;
  } catch { return null; }
}

/** Every process with its parent and full command line: POSIX `ps` at full width, or on Windows the
 * `Win32_Process` table through PowerShell. The query's own process is left out. */
function processTable(): Array<{ pid: number; ppid: number; args: string }> {
  if (process.platform === 'win32') {
    const query = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress';
    const parsed = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })) as unknown;
    const list = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ ProcessId?: unknown; ParentProcessId?: unknown; CommandLine?: unknown }>;
    return list.map(p => ({ pid: Number(p.ProcessId), ppid: Number(p.ParentProcessId), args: typeof p.CommandLine === 'string' ? p.CommandLine.trim() : '' })).filter(p => !p.args.includes('Get-CimInstance Win32_Process'));
  }
  return execFileSync('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n')
    .flatMap(line => { const m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line); return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), args: m[3]!.trim() }] : []; })
    .filter(p => !/^(\S*\/)?ps\s+-A\b/.test(p.args));
}
/** The command line of every process under this one; null when the process table cannot be read. */
export function descendantCommands(): string[] | null {
  try {
    const rows = processTable(), children = new Map<number, number[]>();
    for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
    const args = new Map(rows.map(row => [row.pid, row.args])), out: string[] = [], seen = new Set<number>([process.pid]), queue = [...(children.get(process.pid) ?? [])];
    while (queue.length) { const pid = queue.pop()!; if (seen.has(pid)) continue; seen.add(pid); if (args.has(pid)) out.push(args.get(pid)!); queue.push(...(children.get(pid) ?? [])); }
    return out;
  } catch { return null; }
}
/** The checkout as git reports it: `HEAD` and `git status --porcelain`, null where git cannot tell. */
export interface CheckoutSample { commit: string | null; status: string | null }
/**
 * The checkout the runs were made on (review m2d, r2-runtime-4), from a sample before the first run and
 * one after the last: the commit before, dirty when either sample holds changes (null when git could not
 * tell), and a problem when the two samples differ (another commit, or changed files, during the runs).
 */
export function checkoutOf(before: CheckoutSample, after: CheckoutSample): { commit: string | null; dirty: boolean | null; problem: string | null } {
  const short = (commit: string | null): string => commit?.slice(0, 12) ?? 'no commit';
  const problem = before.commit !== after.commit ? `the checkout moved from ${short(before.commit)} to ${short(after.commit)} during the runs`
    : before.status !== after.status ? 'the checkout\'s files changed during the runs' : null;
  const dirty = before.status === null || after.status === null ? null : before.status.trim() !== '' || after.status.trim() !== '';
  return { commit: before.commit, dirty, problem };
}
/** One sample folded into an observation: the most processes seen, and the most carrying `--no-sandbox`. */
export function observeSandbox(previous: SandboxObservation | null, commands: string[] | null): SandboxObservation | null {
  if (commands === null) return previous;
  const noSandbox = commands.filter(line => /(^|\s)--no-sandbox(\s|=|$)/.test(line)).length;
  return { samples: (previous?.samples ?? 0) + 1, processes: Math.max(previous?.processes ?? 0, commands.length), noSandbox: Math.max(previous?.noSandbox ?? 0, noSandbox) };
}

interface Planned { key: string; source: string; world: World; taskId: string; variantCase: string; seed: number; kind: SequenceRecord['kind']; nearMiss?: string; steps: Array<{ name: string; params: Record<string, unknown> }> }
/** The families the conformance layer runs (decision 8.5): every family the generator has, seeds 1–3, difficulty mixed. */
export const FAMILY_SEEDS = [1, 2, 3] as const;
const sequencesOf = (source: string, world: World, oracle: TaskOracle, cases: readonly string[]): Planned[] => cases.flatMap(variantCase => {
  const seed = oracle.seeds[variantCase]!, taskId = oracle.taskId, slice = drawioTaskWorld(world, taskId), prefix = `${source}${taskId}/${variantCase}`;
  const base = { source, world: slice, taskId, variantCase, seed };
  return [
    { ...base, key: `${prefix}/start`, kind: 'start' as const, steps: [] },
    { ...base, key: `${prefix}/reference`, kind: 'reference' as const, steps: oracle.steps },
    ...oracle.nearMisses.map(miss => ({ ...base, key: `${prefix}/${miss.id}`, kind: 'near-miss' as const, nearMiss: miss.id, steps: miss.steps })),
  ];
});
/** Every planned sequence: the library's 16 tasks × 3 cases, then each family's instances on seeds 1–3
 * written for draw.io by the generator (`--app drawio`). */
export function plannedSequences(): Planned[] {
  const { world, library } = drawioLibrary();
  const families = FAMILIES.flatMap(family => {
    const set = generateSet(family, FAMILY_SEEDS, 'mixed', 'dev', 'drawio');
    return set.oracles.flatMap(oracle => sequencesOf(`family/${family}/`, set.world, oracle, ['drawn']));
  });
  return [...library.tasks.flatMap(task => sequencesOf('', world, task.oracle, LIBRARY_CASES)), ...families];
}

export async function runProtocol(order: Order, seed: number): Promise<RunRecord> {
  const runtime = drawioTestRuntime();
  const plan = ordered(plannedSequences(), order, seed);
  let peakTree = chromiumTreeRss();
  const sample = setInterval(() => { const now = chromiumTreeRss(); if (now !== null) peakTree = Math.max(peakTree ?? 0, now); }, 250);
  const first = plan[0]!, starting = performance.now();
  let chromium: string | null = null;
  const adapter = await createDrawioAdapter(new Session(first.world, first.seed, first.taskId).state, {}, { ready: browser => { chromium = browser.version(); } }, { runtimePath: runtime.runtimePath });
  const startMs = performance.now() - starting;
  let sandbox = observeSandbox(null, descendantCommands());
  const sequences: SequenceRecord[] = [];
  let refusedRequests: string[] = [];
  try {
    for (const planned of plan) {
      const slice = planned.world;
      const record: SequenceRecord = { key: planned.key, taskId: planned.taskId, variantCase: planned.variantCase, kind: planned.kind, ...(planned.nearMiss ? { nearMiss: planned.nearMiss } : {}), steps: 0, applied: true, exports: [], native: '', png: '', verdict: { refused: 'not reached' } };
      sequences.push(record);
      const resolved = runOracle(slice, planned.seed, planned.taskId, planned.steps as never);
      if (!resolved.ok) { record.applied = false; record.failure = `core refused step ${resolved.index}: ${resolved.code}`; continue; }
      const session = new Session(slice, planned.seed, planned.taskId);
      const restored = await adapter.restoreState(session.state);
      if (!restored.ok) { record.applied = false; record.failure = `restoreState: ${restored.error.code} ${restored.error.message}`; continue; }
      for (const entry of resolved.session.log) {
        const before: State = session.state, result = session.act(entry.action as Action);
        if (!result.ok) { record.applied = false; record.failure = `core: ${result.error.code}`; break; }
        const mirrored = await adapter.apply({ before, after: result.state, action: entry.action as Action });
        if (!mirrored.ok) { record.applied = false; record.failure = `apply: ${mirrored.error.code} ${mirrored.error.message.slice(0, 200)}`; break; }
        record.steps++;
        record.exports.push(sha256Hex(normaliseExport((await adapter.exportArtifact()).native)));
      }
      if (!record.applied) continue;
      const artifact = await adapter.exportArtifact();
      record.native = sha256Hex(normaliseExport(artifact.native));
      record.png = sha256Hex(Buffer.from(await adapter.renderPng()).toString('base64'));
      try {
        const verdict = checkSubmission(slice, artifact.native, { seed: planned.seed, taskId: planned.taskId, format: 'drawio' });
        record.verdict = { passed: verdict.passed, errors: verdict.tasks.flatMap(task => task.errors.map(error => error.id)).sort() };
      } catch (error) { record.verdict = { refused: `${(error as { code?: string }).code ?? 'error'}: ${String((error as Error).message).slice(0, 200)}` }; }
    }
  } finally {
    clearInterval(sample);
    sandbox = observeSandbox(sandbox, descendantCommands());
    refusedRequests = adapter.networkAttempts();
    await adapter.close();
  }
  const now = chromiumTreeRss(); if (now !== null) peakTree = Math.max(peakTree ?? 0, now);
  return { schema: 'practonaut.drawio-run/2', order, seed, keys: plan.map(p => p.key), sequences, refusedRequests, startMs, peakRss: { node: process.resourceUsage().maxRSS * 1024, chromiumTree: peakTree }, chromium, sandbox };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [order, seedText, out] = process.argv.slice(2) as [Order, string, string];
  if (!['forward', 'reverse', 'shuffle'].includes(order) || !/^\d+$/.test(seedText ?? '') || !out) { process.stderr.write('usage: drawio-run.ts forward|reverse|shuffle <seed> <out.json>\n'); process.exit(2); }
  const record = await runProtocol(order, Number(seedText));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(record) + '\n');
}

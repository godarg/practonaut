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
 * the peak RSS of this Node process and of its Chromium process tree, and any request the shell
 * refused. Library content comes from the world; nothing here decides a verdict.
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
import type { Action, State } from '../../src/world/types.ts';
import { drawioLibrary, drawioTaskWorld, drawioTestRuntime } from './drawio.ts';

export type Order = 'forward' | 'reverse' | 'shuffle';
export interface SequenceRecord {
  key: string; taskId: string; variantCase: string; kind: 'start' | 'reference' | 'near-miss'; nearMiss?: string;
  steps: number; applied: boolean; failure?: string;
  exports: string[]; native: string; png: string;
  verdict: { passed: boolean; errors: string[] } | { refused: string };
}
export interface RunRecord {
  schema: 'practonaut.drawio-run/1'; order: Order; seed: number; keys: string[]; sequences: SequenceRecord[];
  refusedRequests: string[]; startMs: number; peakRss: { node: number; chromiumTree: number | null };
}

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

interface Planned { key: string; taskId: string; variantCase: string; seed: number; kind: SequenceRecord['kind']; nearMiss?: string; steps: Array<{ name: string; params: Record<string, unknown> }> }
export function plannedSequences(): Planned[] {
  const { library } = drawioLibrary();
  return library.tasks.flatMap(task => LIBRARY_CASES.flatMap(variantCase => {
    const seed = task.oracle.seeds[variantCase]!;
    const base = { taskId: task.id, variantCase, seed };
    return [
      { ...base, key: `${task.id}/${variantCase}/start`, kind: 'start' as const, steps: [] },
      { ...base, key: `${task.id}/${variantCase}/reference`, kind: 'reference' as const, steps: task.oracle.steps },
      ...task.oracle.nearMisses.map(miss => ({ ...base, key: `${task.id}/${variantCase}/${miss.id}`, kind: 'near-miss' as const, nearMiss: miss.id, steps: miss.steps })),
    ];
  }));
}

export async function runProtocol(order: Order, seed: number): Promise<RunRecord> {
  const { world } = drawioLibrary(), runtime = drawioTestRuntime();
  const plan = ordered(plannedSequences(), order, seed);
  let peakTree = chromiumTreeRss();
  const sample = setInterval(() => { const now = chromiumTreeRss(); if (now !== null) peakTree = Math.max(peakTree ?? 0, now); }, 250);
  const first = plan[0]!, firstWorld = drawioTaskWorld(world, first.taskId);
  const adapter = await createDrawioAdapter(new Session(firstWorld, first.seed, first.taskId).state, {}, undefined, { runtimePath: runtime.runtimePath });
  const startMs = performance.now();
  const sequences: SequenceRecord[] = [];
  let refusedRequests: string[] = [];
  try {
    for (const planned of plan) {
      const slice = drawioTaskWorld(world, planned.taskId);
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
    refusedRequests = adapter.networkAttempts();
    await adapter.close();
  }
  const now = chromiumTreeRss(); if (now !== null) peakTree = Math.max(peakTree ?? 0, now);
  return { schema: 'practonaut.drawio-run/1', order, seed, keys: plan.map(p => p.key), sequences, refusedRequests, startMs, peakRss: { node: process.resourceUsage().maxRSS * 1024, chromiumTree: peakTree } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [order, seedText, out] = process.argv.slice(2) as [Order, string, string];
  if (!['forward', 'reverse', 'shuffle'].includes(order) || !/^\d+$/.test(seedText ?? '') || !out) { process.stderr.write('usage: drawio-run.ts forward|reverse|shuffle <seed> <out.json>\n'); process.exit(2); }
  const record = await runProtocol(order, Number(seedText));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(record) + '\n');
}

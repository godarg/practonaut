// Opt-in amplifier for the two real-mirror host deadline tests (issue #64; docs/testing.md "Host
// deadline tests"). It is not part of any test command. Each attempt runs one of the two tests from
// `tests/integration/host-deadline.test.ts` unchanged in its own `node --test` process, with the
// test-only preload `tests/support/host-deadline-seam.ts`, which records every real `browser.close()`
// and, as asked, throttles the renderer, blocks the test process's event loop, or holds the close.
// `--load` adds host load beside the attempts: CPU workers and file churn in the OS temporary
// directory (where Playwright keeps Chromium's profile). `--beside <test file>[,<test file>…]` runs
// those files one after the other, again and again, in their own `node --test` process while the
// attempts run, as `test:integration` (two files at a time) runs other files beside
// `host-deadline.test.ts`; its results are kept, not judged. In both failed Windows runs of #64 the
// file beside it was 0.2.0's `challenge-round.test.ts`, which the 0.3.0 gate replaced: a partner
// load today is not that one.
//
//   npm run amplify:host-deadline -- [--runs 30] [--cpu 20] [--block 0] [--load 0] [--hold 0] [--beside <file,…>] [--require-pass]
//
// `--require-pass` (the repeat workflow) makes it exit 1 unless each test ran in every attempt and
// passed, read from each attempt's TAP report with tools/require-test-passed.ts.
// Writes .local/amplify-host-deadline/<timestamp>-<commit>-<random>.json (commit, whether the tree and
// src/ had changes, settings, counts, every attempt with its close durations and where Playwright's
// own log says each close spent its time) and keeps each attempt's TAP report (with that log,
// `DEBUG=pw:browser`, as comment lines) and close record beside it.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireTestPassed } from './require-test-passed.ts';

export const HOST_DEADLINE_TESTS = Object.freeze({
  'late-write': 'a real late mirror write cannot commit after the supplied monotonic deadline',
  'core-serialization': 'deadline expiration at real core serialization is a timeout, with preserved committed export state',
});
type TestKey = keyof typeof HOST_DEADLINE_TESTS;
export interface TapResult { ok: boolean; durationMs: number | null; failureType: string | null; errorName: string | null; error: string | null }
export interface CloseRow { event: 'close-start' | 'close-end' | string; browser?: number; ms?: number; ok?: boolean; holdMs?: number; error?: string }

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The result of the one top-level test with this exact name in a TAP report, or null when it did not run. */
export function tapResult(tap: string, name: string): TapResult | null {
  const lines = tap.replace(/\r\n/g, '\n').split('\n');
  const head = new RegExp(`^(not ok|ok) \\d+ - ${escape(name)}(\\s+#.*)?$`);
  const index = lines.findIndex(line => head.test(line));
  if (index < 0) return null;
  const block: string[] = [];
  for (const line of lines.slice(index + 1)) { if (!line.startsWith('  ')) break; block.push(line); }
  const field = (key: string): string | null => {
    const line = block.find(entry => entry.startsWith(`  ${key}: `));
    return line ? line.slice(key.length + 4).replace(/^'(.*)'$/, '$1') : null;
  };
  const duration = Number(field('duration_ms'));
  return { ok: lines[index]!.startsWith('ok '), durationMs: Number.isFinite(duration) ? Math.round(duration) : null, failureType: field('failureType'), errorName: field('name'), error: field('error') };
}
export interface ClosePhases { pid: number; exitMs: number | null; cleanupMs: number | null; totalMs: number | null; removalError: boolean }
/** Where each browser's close spent its time, from Playwright's own browser-process log
 * (`DEBUG=pw:browser`, ISO timestamps; as `# ` comment lines in a TAP report): from the graceful
 * close request to the process exit, the removal of Playwright's temporary profile, and the whole
 * close. */
export function closePhases(log: string): ClosePhases[] {
  const marks = new Map<number, Record<string, number>>(), errors = new Set<number>();
  for (const line of log.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^(?:# )?(\d{4}-\d\d-\d\dT[\d:.]+Z) pw:browser \[pid=(\d+)\] (.*)$/.exec(line);
    if (!match) continue;
    const at = Date.parse(match[1]!), pid = Number(match[2]), text = match[3]!;
    const mark = marks.get(pid) ?? {}; marks.set(pid, mark);
    const key = text.startsWith('<gracefully close start>') ? 'start' : text.startsWith('<process did exit') ? 'exit'
      : text.startsWith('starting temporary directories cleanup') ? 'cleanupStart' : text.startsWith('finished temporary directories cleanup') ? 'cleanupEnd'
        : text.startsWith('<gracefully close end>') ? 'end' : text.startsWith('exception while removing') ? 'error' : null;
    if (key === 'error') errors.add(pid); else if (key && mark[key] === undefined) mark[key] = at;
  }
  const span = (from?: number, to?: number): number | null => from !== undefined && to !== undefined ? to - from : null;
  return [...marks].filter(([, mark]) => mark.start !== undefined).map(([pid, mark]) => ({ pid, exitMs: span(mark.start, mark.exit), cleanupMs: span(mark.cleanupStart, mark.cleanupEnd), totalMs: span(mark.start, mark.end), removalError: errors.has(pid) }));
}
/** Null when every test has exactly `runs` reports and each shows that test ran and passed (one
 * top-level test with its name, not skipped, nothing failed); otherwise every reason. */
export function requireAllPassed(reports: Record<TestKey, string[]>, runs: number): string | null {
  const reasons: string[] = [];
  for (const test of Object.keys(HOST_DEADLINE_TESTS) as TestKey[]) {
    const own = reports[test] ?? [];
    if (own.length !== runs) reasons.push(`${test}: expected ${runs} reports, found ${own.length}`);
    own.forEach((tap, index) => { const reason = requireTestPassed(tap, HOST_DEADLINE_TESTS[test]); if (reason) reasons.push(`${test} attempt ${index + 1}: ${reason}`); });
  }
  return reasons.length ? reasons.join('\n') : null;
}
/** The browser ledger's statements the preload wrote at the test process's exit (PADR-0050), counted:
 * how the callers' closes settled; of the entries with an abandoned close, how many ended (proven by
 * Playwright's close) and how many were still pending at the exit; launches rejected; and how each
 * slot was released, or held at the exit. Forced ends are Playwright's `<will force kill>` log lines. */
export interface LedgerCounts {
  entries: number; callers: Record<'closed' | 'failed' | 'abandoned' | 'cancelled', number>;
  abandonedEnded: number; abandonedPendingAtExit: number; launchesRejected: number;
  released: Record<'proof' | 'launch-wait' | 'unused' | 'heldAtExit', number>; forcedEnds: number;
}
export function ledgerCounts(closes: readonly CloseRow[], log = ''): LedgerCounts {
  const counts: LedgerCounts = { entries: 0, callers: { closed: 0, failed: 0, abandoned: 0, cancelled: 0 }, abandonedEnded: 0, abandonedPendingAtExit: 0, launchesRejected: 0, released: { proof: 0, 'launch-wait': 0, unused: 0, heldAtExit: 0 }, forcedEnds: 0 };
  for (const row of closes as ReadonlyArray<CloseRow & { callers?: Record<string, number>; launch?: string; end?: string; slot?: string }>) {
    if (row.event !== 'ledger') continue;
    counts.entries++;
    for (const key of Object.keys(counts.callers) as Array<keyof LedgerCounts['callers']>) counts.callers[key] += row.callers?.[key] ?? 0;
    if ((row.callers?.abandoned ?? 0) > 0) { if (row.end === 'proven') counts.abandonedEnded++; if (row.slot === 'held') counts.abandonedPendingAtExit++; }
    if (row.launch === 'rejected') counts.launchesRejected++;
    if (row.slot === 'held') counts.released.heldAtExit++; else if (row.slot === 'proof' || row.slot === 'launch-wait' || row.slot === 'unused') counts.released[row.slot]++;
  }
  counts.forcedEnds = log.split('\n').filter(line => /pw:browser \[pid=\d+\] <will force kill>/.test(line)).length;
  return counts;
}
/** One attempt's outcome from its test result and the closes the preload recorded. */
export function classify(result: TapResult | null, closes: CloseRow[], closeBoundMs: number): string {
  if (!result) return 'not-run';
  if (result.ok) return 'passed';
  if (result.failureType === 'testTimeoutFailure') return 'test-timeout';
  if (result.errorName === 'BrowserDeadlineError') {
    const started = closes.filter(row => row.event === 'close-start').length, ended = closes.filter(row => row.event === 'close-end');
    if (ended.some(row => (row.ms ?? 0) >= closeBoundMs) || started > ended.length) return 'close-deadline';
    return 'browser-deadline-other';
  }
  return 'other';
}

/** The partner files `--beside` names: one or more test files, separated by commas. */
export function partnerFiles(value: string | undefined): string[] {
  const files = (value ?? '').split(',');
  if (!value || files.some(file => !file.endsWith('.test.ts'))) throw new Error('--beside needs one or more test files, separated by commas');
  return files;
}
/** The node arguments of one partner run: the files one after the other (`--test-concurrency=1`), as
 * one file's tests run, with a TAP report at `tap`. */
export const partnerArgs = (files: readonly string[], tap: string): string[] =>
  ['--import', './tests/support/test-home.ts', '--test', '--test-concurrency=1', '--test-reporter=tap', `--test-reporter-destination=${tap}`, ...files];

async function main(): Promise<void> {
  const { BROWSER_BOUNDS } = await import('../src/adapters/browser/bounded.ts');
  const closeBoundMs = BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced;
  const args = process.argv.slice(2);
  const option = (name: string, fallback: number, min: number): number => {
    const index = args.indexOf(name), value = index >= 0 ? Number(args[index + 1]) : fallback;
    if (!Number.isInteger(value) || value < min) throw new Error(`${name} needs a whole number of at least ${min}`);
    return value;
  };
  const runs = option('--runs', 30, 1), cpu = option('--cpu', 20, 1), block = option('--block', 0, 0), load = option('--load', 0, 0), hold = option('--hold', 0, 0);
  const besideIndex = args.indexOf('--beside'), requirePass = args.includes('--require-pass');
  const besideFiles = besideIndex >= 0 ? partnerFiles(args[besideIndex + 1]) : [], beside = besideFiles.length ? besideFiles.join(',') : undefined;
  const git = (...command: string[]): string => spawnSync('git', command, { encoding: 'utf8' }).stdout.trim();
  const commit = git('rev-parse', '--short', 'HEAD'), dirty = git('status', '--porcelain').length > 0;
  const srcChanged = git('status', '--porcelain', '--', 'src').length > 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir('.local/amplify-host-deadline', { recursive: true });
  const out = await realpath(resolve('.local/amplify-host-deadline'));
  const root = await mkdtemp(join(out, `${stamp}-${commit}-`));

  // Host load: CPU workers and file churn in the OS temporary directory, until the attempts end. The
  // churn stays inside one folder this tool made, which it removes after stopping the loader.
  let loader: ChildProcess | undefined, churn: string | undefined;
  if (load > 0) {
    churn = await mkdtemp(join(tmpdir(), 'pn-amplify-load-'));
    const script = `const {Worker}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path'),root=process.argv[1];
for(let i=0;i<${load};i++)new Worker('for(;;){}',{eval:true});
(async()=>{for(let n=0;;n++){const dir=path.join(root,String(n));fs.mkdirSync(dir);await Promise.all(Array.from({length:200},(_,i)=>fs.promises.writeFile(path.join(dir,'f'+i),Buffer.alloc(16384,i))));await fs.promises.rm(dir,{recursive:true,force:true});}})();`;
    loader = spawn(process.execPath, ['-e', script, churn], { stdio: 'ignore' });
  }
  // The partner test file, restarted until the attempts end; each of its runs keeps its TAP report.
  let partner: Promise<void> = Promise.resolve(), attemptsDone = false;
  const partnerRuns: Array<{ run: number; exitCode: number | null; ms: number }> = [];
  const runPartner = (run: number): void => {
    if (!beside || attemptsDone) return;
    const started = performance.now();
    const child = spawn(process.execPath, partnerArgs(besideFiles, join(root, `beside-${run}.tap`)), { stdio: 'ignore' });
    partner = new Promise(done => child.once('close', code => { partnerRuns.push({ run, exitCode: code, ms: Math.round(performance.now() - started) }); runPartner(run + 1); done(); }));
  };
  runPartner(1);
  type Row = { attempt: number; test: TestKey; outcome: string; ms: number; testMs: number | null; error: string | null; closes: CloseRow[]; phases: ClosePhases[]; ledger: LedgerCounts };
  const rows: Row[] = [], reports: Record<TestKey, string[]> = { 'late-write': [], 'core-serialization': [] };
  try {
    for (let attempt = 1; attempt <= runs; attempt++) {
      for (const test of Object.keys(HOST_DEADLINE_TESTS) as TestKey[]) {
        const name = HOST_DEADLINE_TESTS[test], base = join(root, `attempt-${String(attempt).padStart(2, '0')}-${test}`);
        const tap = `${base}.tap`, record = `${base}.closes.jsonl`, start = performance.now();
        await new Promise<void>(done => {
          // Playwright's browser-process log (its `debug` channel, on the test file's stderr) lands in
          // the TAP report as comment lines.
          const child = spawn(process.execPath, ['--import', './tests/support/test-home.ts', '--import', './tests/support/host-deadline-seam.ts', '--test', `--test-name-pattern=^${escape(name)}$`,
            '--test-reporter=tap', `--test-reporter-destination=${tap}`, 'tests/integration/host-deadline.test.ts'],
          { stdio: 'ignore', env: { ...process.env, DEBUG: 'pw:browser', DEBUG_COLORS: '0', PN_AMPLIFY_RECORD: record, PN_AMPLIFY_CPU: String(cpu), PN_AMPLIFY_BLOCK_MS: String(block), PN_AMPLIFY_CLOSE_HOLD_MS: String(hold) } });
          child.once('close', () => done());
        });
        const report = await readFile(tap, 'utf8').catch(() => ''), result = tapResult(report, name);
        reports[test].push(report);
        const closes = (await readFile(record, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line) as CloseRow);
        const phases = closePhases(report);
        const row: Row = { attempt, test, outcome: classify(result, closes, closeBoundMs), ms: Math.round(performance.now() - start), testMs: result?.durationMs ?? null, error: result?.ok ? null : `${result?.errorName ?? ''}: ${result?.error ?? ''}`, closes, phases, ledger: ledgerCounts(closes, report) };
        rows.push(row);
        const closeMs = closes.filter(entry => entry.event === 'close-end').map(entry => entry.ms);
        const split = phases.map(phase => `exit ${phase.exitMs ?? '-'} + profile ${phase.cleanupMs ?? '-'}${phase.removalError ? ' (removal failed)' : ''}`).join('; ');
        const settled = row.ledger.entries ? `, closes ${row.ledger.callers.closed} closed/${row.ledger.callers.abandoned} abandoned/${row.ledger.callers.failed} failed${row.ledger.forcedEnds ? `, ${row.ledger.forcedEnds} forced end` : ''}` : '';
        console.log(`${String(attempt).padStart(2)}/${runs} ${test} ${row.outcome} test ${row.testMs} ms, close ${closeMs.join('/') || '-'} ms${split ? ` (${split})` : ''}${settled}${row.error ? ` — ${row.error}` : ''}`);
      }
    }
  } finally {
    attemptsDone = true;
    if (loader) { const ended = new Promise(done => loader!.once('close', done)); loader.kill(); await ended; }
    if (churn) await rm(churn, { recursive: true, force: true, maxRetries: 5 });
  }
  // The partner is not interrupted (its own child processes and folders would be left behind): its
  // current run ends on its own, and no new one starts.
  await partner;

  const count = (test?: TestKey): Record<string, number> => {
    const outcomes: Record<string, number> = {};
    for (const row of rows.filter(entry => !test || entry.test === test)) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
    return outcomes;
  };
  const closeMs = rows.flatMap(row => row.closes.filter(entry => entry.event === 'close-end').map(entry => entry.ms ?? 0)).sort((a, b) => a - b);
  const closeDurationsMs = closeMs.length ? { median: closeMs[Math.floor(closeMs.length / 2)]!, min: closeMs[0]!, max: closeMs.at(-1)!, closes: closeMs.length, atOrAboveBound: closeMs.filter(ms => ms >= closeBoundMs).length } : null;
  // Closes of a second or more, with where Playwright's log says the time went.
  const slowCloses = rows.flatMap(row => row.closes.filter(entry => entry.event === 'close-end' && (entry.ms ?? 0) >= 1000)
    .map(entry => ({ attempt: row.attempt, test: row.test, outcome: row.outcome, closeMs: entry.ms, phases: row.phases })));
  // The ledger's statements over every attempt (absent before PADR-0050: no entries).
  const totalLedger = rows.reduce<LedgerCounts>((sum, row) => {
    const add = (a: Record<string, number>, b: Record<string, number>): void => { for (const key of Object.keys(a)) a[key] = (a[key] ?? 0) + (b[key] ?? 0); };
    add(sum.callers, row.ledger.callers); add(sum.released, row.ledger.released);
    sum.entries += row.ledger.entries; sum.abandonedEnded += row.ledger.abandonedEnded; sum.abandonedPendingAtExit += row.ledger.abandonedPendingAtExit; sum.launchesRejected += row.ledger.launchesRejected; sum.forcedEnds += row.ledger.forcedEnds;
    return sum;
  }, ledgerCounts([]));
  const summary = { tool: 'amplify-host-deadline/1', commit, dirty, srcChanged, platform: process.platform, node: process.version, cpus: availableParallelism(),
    runs, cpuThrottlingRate: cpu, eventLoopBlockMs: block, loadWorkers: load, closeHoldMs: hold, beside: beside ?? null, partnerRuns, closeBoundMs,
    // Attempts whose renderer accepted the throttling command (0 when --cpu is 1).
    throttledAttempts: rows.filter(row => row.closes.some(entry => entry.event === 'throttled')).length,
    failures: rows.filter(row => row.outcome !== 'passed').length, outcomes: count(), byTest: { 'late-write': count('late-write'), 'core-serialization': count('core-serialization') },
    closeDurationsMs, slowCloses, ledger: totalLedger, evidence: root, rows };
  const file = `${root}.json`;
  await writeFile(file, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ commit, dirty, srcChanged, runs, cpuThrottlingRate: cpu, eventLoopBlockMs: block, loadWorkers: load, closeHoldMs: hold, beside: beside ?? null, partnerRuns: partnerRuns.length, failures: summary.failures, outcomes: summary.outcomes, closeDurationsMs, slowCloses: slowCloses.length, ledger: totalLedger, file }));
  if (requirePass) {
    const reason = requireAllPassed(reports, runs);
    if (reason) { console.error(`amplify-host-deadline: not every attempt ran and passed\n${reason}`); process.exitCode = 1; }
    else console.log(`amplify-host-deadline: all ${runs} attempts of each test ran and passed`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

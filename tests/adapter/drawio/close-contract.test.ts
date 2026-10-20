// PADR-0050 for the draw.io adapter against the real app and the real CLI: the cases the close
// contract's integration tests hold for Excalidraw, on a draw.io world, and a bench on draw.io under
// the browser budget. The tests read the process table themselves (the product reads none) and signal
// only processes their own child started. Each CLI runs in a home of its own that holds a clone of the
// verified draw.io runtime.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drawioRuntimePath } from '../../../src/adapters/drawio/runtime.ts';
import type { LedgerRecord } from '../../../src/adapters/browser/ledger.ts';
import { drawioAvailability } from '../../support/drawio.ts';
import { descendantsOf, processesWith, survivors, type ProcessRow } from '../../support/process-table.ts';

const availability = await drawioAvailability();
const skip = availability.ok ? false : availability.skip;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)), CLI = join(ROOT, 'src/cli/main.ts');
const preload = (name: string): string => pathToFileURL(join(ROOT, 'tests/support', name)).href;
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean, limitMs: number, stepMs = 50): Promise<boolean> {
  const end = performance.now() + limitMs;
  while (!condition()) { if (performance.now() > end) return false; await sleep(stepMs); }
  return true;
}
const playwrightDirectories = (directory: string): string[] => readdirSync(directory).filter(name => /^playwright(_chromiumdev_profile|-artifacts)-/.test(name)).sort();
const temporaryDirectoryOf = (directory: string): NodeJS.ProcessEnv => process.platform === 'win32' ? { TEMP: directory, TMP: directory } : { TMPDIR: directory };

/** A directory with a home that holds a clone of the verified runtime, a temporary directory, and the
 * draw.io library world packed; removed after the test. */
function setUp(t: TestContext, name: string): { directory: string; home: string; temporary: string; world: string; actions: string } {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), `pn-drawio-${name}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), temporary = join(directory, 'tmp'), runtime = drawioRuntimePath(home);
  mkdirSync(dirname(runtime), { recursive: true, mode: 0o700 }); mkdirSync(temporary);
  copyFileSync(availability.ok ? availability.runtime.runtimePath : '', runtime, constants.COPYFILE_FICLONE);
  const world = join(directory, 'drawio.pnworld'), actions = join(directory, 'actions.json');
  writeFileSync(actions, '[]');
  const packed = spawnSync(process.execPath, [CLI, 'pack', join(ROOT, 'tasks/drawio/world'), '--out', world], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  return { directory, home, temporary, world, actions };
}

test('the real CLI (A) on draw.io: run prints its result when the stalled close is abandoned; the CLI exits after Playwright\'s forced end with nothing left', { skip: skip || (process.platform === 'win32' ? 'POSIX: Windows has no deterministic way from Node to stall Chromium' : false), timeout: 240_000 }, async t => {
  const { directory, home, temporary, world, actions } = setUp(t, 'close-a'), gate = join(directory, 'gate');
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, ['--import', preload('close-stall-preload.ts'), CLI, 'run', world, '--seed', '0', '--task', 'connect', '--actions', actions, '--mirror', 'required'], { cwd: directory, env: { ...process.env, PRACTONAUT_HOME: home, ...temporaryDirectoryOf(temporary), PN_CLOSE_GATE: gate } });
  let stdout = '', stderr = '', browser: number | undefined;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; browser ??= Number(/\[close-stall\] browser-pid=(\d+)/.exec(stderr)?.[1]) || undefined; });
  const exited = new Promise<number | null>(resolve => child.on('close', code => resolve(code)));
  t.after(() => { if (browser !== undefined) { try { process.kill(-browser, 'SIGKILL'); } catch { /* Already gone. */ } } if (child.exitCode === null) child.kill('SIGKILL'); });
  assert.ok(await until(() => stderr.includes('[close-stall] closing'), 120_000), `the mirror's close was never asked:\n${stderr}`);
  const tree = descendantsOf(child.pid!), stalled = tree.find(row => row.pid === browser);
  assert.ok(stalled, 'the browser CDP named is a descendant of the CLI process the test started');
  assert.equal(stalled.pgid, browser, 'the browser leads its own process group');
  process.kill(-browser!, 'SIGSTOP');
  writeFileSync(gate, '');
  const requested = performance.now();
  assert.ok(await until(() => stderr.includes('Waiting for 1 browser to close'), 30_000), `run's main never returned:\n${stderr}`);
  const returnedAfter = performance.now() - requested;
  assert.ok(returnedAfter >= 7_000 && returnedAfter < 15_000, `the close returned abandoned at its deadline, ${Math.round(returnedAfter)} ms after the request`);
  assert.match(stdout, /"ok": true/, 'run printed its result');
  const recorded: ProcessRow[] = descendantsOf(child.pid!);
  assert.ok(recorded.some(row => row.pid === browser), 'the draw.io browser is alive when run has printed its result');
  assert.equal(playwrightDirectories(temporary).length, 2, 'the mirror\'s profile and artifacts directories appeared under the CLI\'s temporary directory');
  const code = await exited, exitedAfter = performance.now() - requested;
  assert.equal(code, 0, stderr);
  assert.ok(exitedAfter >= 29_000 && exitedAfter < 45_000, `the CLI exited ${Math.round(exitedAfter)} ms after the close request: after Playwright's forced end`);
  assert.match(stderr, /browser \d+ \(mirror\): close abandoned at its deadline, still running; process end not proven yet/);
  assert.deepEqual(survivors(recorded), [], 'none of the recorded processes remains');
  assert.deepEqual(playwrightDirectories(temporary), [], 'the profile and artifacts directories are gone');
});

test('the real CLI on draw.io without a stall: the directories appear where the test put the temporary directory, and nothing is left after the exit', { skip, timeout: 240_000 }, async t => {
  const { directory, home, temporary, world, actions } = setUp(t, 'close-w');
  const child = spawn(process.execPath, [CLI, 'run', world, '--seed', '0', '--task', 'connect', '--actions', actions, '--mirror', 'required'], { cwd: directory, env: { ...process.env, PRACTONAUT_HOME: home, ...temporaryDirectoryOf(temporary) } });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; }); child.stdout.resume();
  const exited = new Promise<number | null>(resolve => child.on('close', code => resolve(code)));
  const seen = new Set<string>();
  let running = true;
  void exited.then(() => { running = false; });
  while (running) { for (const name of playwrightDirectories(temporary)) seen.add(name); await sleep(10); }
  assert.equal(await exited, 0, stderr);
  assert.ok([...seen].some(name => name.startsWith('playwright_chromiumdev_profile-')) && [...seen].some(name => name.startsWith('playwright-artifacts-')), `Playwright's directories appeared: ${[...seen].join(', ')}`);
  assert.deepEqual(processesWith(temporary), [], 'no process started with the CLI\'s temporary directory remains');
  assert.deepEqual(playwrightDirectories(temporary), [], 'and no directory');
  assert.doesNotMatch(stderr, /Waiting for/);
});

test('bench on draw.io under the browser budget: the start check\'s browser, then the adapter\'s, each with the sandbox, each on a slot released by its proven end', { skip, timeout: 240_000 }, async t => {
  const { directory, home, temporary } = setUp(t, 'bench-budget'), report = join(directory, 'ledger.json'), out = join(directory, 'report.json');
  const run = spawnSync(process.execPath, ['--import', preload('ledger-report-preload.ts'), CLI, 'bench', '--agent', 'oracle', '--tasks', 'drawio/connect', '--seed-list', '0', '--mirror', 'required', '--out', out], { cwd: directory, encoding: 'utf8', timeout: 180_000, env: { ...process.env, PRACTONAUT_HOME: home, ...temporaryDirectoryOf(temporary), PN_LEDGER_REPORT: report } });
  assert.equal(run.status, 0, run.stderr);
  const bench = JSON.parse(readFileSync(out, 'utf8')) as { environment: { app: { adapterId: string } }; runs: Array<{ pass: boolean; status: string }> };
  assert.deepEqual([bench.environment.app.adapterId, bench.runs.map(entry => [entry.status, entry.pass])], ['drawio', [['completed', true]]]);
  const { launches, records } = JSON.parse(readFileSync(report, 'utf8')) as { launches: Array<{ proxy: boolean; chromiumSandbox: boolean | undefined }>; records: LedgerRecord[] };
  // The start check first (no sink proxy), under draw.io's policy; then the mirror's browser (the sink as its proxy).
  assert.deepEqual(launches, [{ proxy: false, chromiumSandbox: true }, { proxy: true, chromiumSandbox: true }], 'two launches, both with the sandbox');
  assert.deepEqual(records.map(record => record.owner), ['start-check', 'mirror']);
  for (const record of records) {
    assert.deepEqual([record.launch, record.close, record.connectedAtRequest, record.end, record.slot], ['resolved', 'fulfilled', true, 'proven', 'proof'], `${record.owner}: closed while connected, end proven, slot released`);
    assert.deepEqual([record.callers.abandoned, record.callers.failed], [0, 0], `${record.owner}: no close abandoned or failed`);
  }
  const [check, mirror] = records as [LedgerRecord, LedgerRecord];
  assert.ok(check.at.released! <= mirror.at.asked, 'the start check\'s slot was released before the mirror asked for its own');
  assert.doesNotMatch(run.stderr, /Waiting for|process end not proven/, 'nothing left to wait for or to report');
  assert.deepEqual(playwrightDirectories(temporary), [], 'no directory left');
});

test('bench on draw.io when every mirror start finds the budget full: the run is lost to the budget by name and counted after the table', { skip, timeout: 240_000 }, async t => {
  const { directory, home } = setUp(t, 'bench-full'), out = join(directory, 'report.json');
  const run = spawnSync(process.execPath, ['--import', preload('budget-mirror-full-preload.ts'), CLI, 'bench', '--agent', 'oracle', '--tasks', 'drawio/connect', '--seed-list', '0', '--mirror', 'required', '--out', out], { cwd: directory, encoding: 'utf8', timeout: 180_000, env: { ...process.env, PRACTONAUT_HOME: home } });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\n1 run could not be judged because no browser slot became free \(browser_budget_exhausted\); see each run's note\.\n/);
  const bench = JSON.parse(readFileSync(out, 'utf8')) as { runs: Array<{ status: string; note?: string }> };
  assert.deepEqual(bench.runs.map(entry => [entry.status, entry.note?.startsWith('browser_budget_exhausted: ')]), [['infra_error', true]]);
});

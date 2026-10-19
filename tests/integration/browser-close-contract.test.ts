// PADR-0050, decision 10: the close contract against real Chromium. The tests read the process table
// themselves (the product reads none) and signal only processes their own child started.
//
// 1. A launch that Playwright rejects after it spawned Chromium: the slot and the sink are held for
//    35 s after the rejection, and afterwards no such process remains.
// 2. The real CLI (POSIX): the mirror's browser is stopped (SIGSTOP on its own group) before its close,
//    so no graceful close can finish. (A) `run` returns its result when the close is abandoned, with
//    the browser alive; the CLI exits after Playwright's own forced end, with no process and no
//    directory left. (B) a bench whose second interrupt calls `process.exit` while that close is
//    pending: the browser is alive just before, and nothing is left after.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type LaunchOptions } from 'playwright-core';
import { BrowserLedger } from '../../src/adapters/browser/ledger.ts';
import { startShell } from '../../src/adapters/browser/shell.ts';
import { descendantsOf, processesWith, survivors, type ProcessRow } from '../support/process-table.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = join(ROOT, 'src/cli/main.ts'), PRELOAD = join(ROOT, 'tests/support/close-stall-preload.ts');
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean, limitMs: number, stepMs = 50): Promise<boolean> {
  const end = performance.now() + limitMs;
  while (!condition()) { if (performance.now() > end) return false; await sleep(stepMs); }
  return true;
}
function sinkAnswers(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect(port, '127.0.0.1');
    socket.once('data', data => { socket.destroy(); resolve(data.toString().startsWith('HTTP/1.1 403')); });
    socket.once('error', () => resolve(false));
  });
}
const playwrightDirectories = (directory: string): string[] => readdirSync(directory).filter(name => /^playwright(_chromiumdev_profile|-artifacts)-/.test(name)).sort();
/** Points `os.tmpdir()` (and so Playwright's profile and artifacts directories) at `directory`. */
function temporaryDirectoryOf(directory: string): NodeJS.ProcessEnv {
  return process.platform === 'win32' ? { TEMP: directory, TMP: directory } : { TMPDIR: directory };
}

test('a launch rejected after Chromium started holds its slot and its sink for 35 s, and no such process remains afterwards', { timeout: 240_000 }, async t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'pn-launch-rejected-'));
  const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
  Object.assign(process.env, temporaryDirectoryOf(directory));
  t.after(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } rmSync(directory, { recursive: true, force: true }); });
  // `--wait-for-debugger` makes the real Chromium wait before it connects, so Playwright's own launch
  // timeout reliably expires while the spawned process runs. An attempt counts only when the test's
  // own read finds that process after the rejection; otherwise it is repeated with a longer timeout.
  for (const timeoutMs of [1_500, 3_000, 6_000, 12_000]) {
    const ledger = new BrowserLedger(); let launched: LaunchOptions | undefined;
    const stalling = { launch: (options?: LaunchOptions) => { launched = options; return chromium.launch({ ...options, args: [...(options?.args ?? []), '--wait-for-debugger'] }); } };
    const failure = await startShell({ chromium: stalling, ledger, launchMs: timeoutMs, origins: {} }, async () => {}).then(() => undefined, (error: unknown) => error);
    assert.ok(failure instanceof Error, 'the launch did not fail');
    assert.ok(await until(() => ledger.records()[0]?.launch === 'rejected', 10_000), 'Playwright\'s launch promise rejected');
    const rejectedAt = ledger.records()[0]!.at.launchSettled!;
    const spawned = processesWith(directory);
    if (spawned.length === 0) { t.diagnostic(`attempt with ${timeoutMs} ms: no spawned Chromium found after the rejection; not counted`); continue; }
    const port = Number(new URL(launched!.proxy!.server).port);
    assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.end, await sinkAnswers(port)], [1, 'launch-rejected', true], 'slot and sink held after the rejection');
    assert.equal(playwrightDirectories(directory).length, 2, 'Playwright\'s profile and artifacts directories appeared where the test put the temporary directory');
    await sleep(Math.max(0, rejectedAt + 33_000 - performance.now()));
    assert.deepEqual([ledger.unreleased(), await sinkAnswers(port)], [1, true], 'still held 33 s after the rejection');
    assert.ok(await until(() => ledger.unreleased() === 0, 5_000), 'released 35 s after the rejection');
    assert.ok(performance.now() - rejectedAt >= 35_000, 'not before 35 s');
    assert.deepEqual([ledger.records()[0]!.slot, await sinkAnswers(port)], ['launch-wait', false], 'the sink closed with the slot');
    assert.deepEqual(processesWith(directory).map(row => row.pid), [], 'no spawned Chromium remains');
    assert.deepEqual(playwrightDirectories(directory), [], 'Playwright removed its directories');
    return;
  }
  assert.fail('no attempt found the spawned Chromium after the rejection');
});

/** A real CLI run whose mirror browser's close is held by the preload until the test stopped it. */
interface Stalled { child: ChildProcessWithoutNullStreams; stdout: () => string; stderr: () => string; exited: Promise<number | null>; pid: () => number | undefined }
function startStalled(t: TestContext, args: string[], directory: string): Stalled {
  const home = join(directory, 'home'), temporary = join(directory, 'tmp'), gate = join(directory, 'gate');
  mkdirSync(home); mkdirSync(temporary);
  const child = spawn(process.execPath, ['--import', PRELOAD, CLI, ...args], { cwd: directory, env: { ...process.env, PRACTONAUT_HOME: home, ...temporaryDirectoryOf(temporary), PN_CLOSE_GATE: gate } });
  let stdout = '', stderr = '', browser: number | undefined;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => {
    stderr += chunk;
    browser ??= Number(/\[close-stall\] browser-pid=(\d+)/.exec(stderr)?.[1]) || undefined;
  });
  const exited = new Promise<number | null>(resolve => child.on('close', code => resolve(code)));
  t.after(() => {
    // Only the tree this test's own child started: the browser's group, then the CLI.
    if (browser !== undefined) { try { process.kill(-browser, 'SIGKILL'); } catch { /* Already gone. */ } }
    if (child.exitCode === null) child.kill('SIGKILL');
    rmSync(directory, { recursive: true, force: true });
  });
  return { child, stdout: () => stdout, stderr: () => stderr, exited, pid: () => browser };
}
/** Waits for the held close, checks the browser is a descendant of the CLI and leads its group, stops
 * that group and lets the close go to the stopped browser. Returns when the close was asked. */
async function stopBrowserAtClose(run: Stalled, directory: string): Promise<{ pid: number; requested: number }> {
  assert.ok(await until(() => run.stderr().includes('[close-stall] closing'), 120_000), `the mirror's close was never asked:\n${run.stderr()}`);
  const pid = run.pid()!;
  const tree = descendantsOf(run.child.pid!), browser = tree.find(row => row.pid === pid);
  assert.ok(browser, 'the browser CDP named is a descendant of the CLI process the test started');
  assert.equal(browser.pgid, pid, 'the browser leads its own process group');
  process.kill(-pid, 'SIGSTOP');
  writeFileSync(join(directory, 'gate'), '');
  return { pid, requested: performance.now() };
}
function pack(directory: string): { world: string; actions: string } {
  const world = join(directory, 'flow.pnworld'), actions = join(directory, 'actions.json');
  writeFileSync(actions, '[]');
  const packed = spawnSync(process.execPath, [CLI, 'pack', join(ROOT, 'examples/worlds/flow-diagram'), '--out', world], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  return { world, actions };
}

test('the real CLI (A): run prints its result when the stalled close is abandoned; the CLI exits after Playwright\'s forced end with nothing left', { skip: process.platform === 'win32' ? 'POSIX: Windows has no deterministic way from Node to stall Chromium (see the Windows test below)' : false, timeout: 240_000 }, async t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'pn-cli-close-a-')), { world, actions } = pack(directory);
  const run = startStalled(t, ['run', world, '--seed', '1', '--actions', actions, '--mirror', 'required'], directory);
  const { pid, requested } = await stopBrowserAtClose(run, directory);
  // run printed its result before it asked for the close; its main returns when the close is abandoned.
  assert.ok(await until(() => run.stderr().includes('Waiting for 1 browser to close'), 30_000), `run's main never returned:\n${run.stderr()}`);
  const returnedAfter = performance.now() - requested;
  assert.ok(returnedAfter >= 7_000 && returnedAfter < 15_000, `the close returned abandoned at its deadline, ${Math.round(returnedAfter)} ms after the request, not after Playwright's 30 s`);
  assert.match(run.stdout(), /"ok": true/, 'run printed its result');
  const recorded: ProcessRow[] = descendantsOf(run.child.pid!);
  assert.ok(recorded.some(row => row.pid === pid), 'the browser is alive when run has printed its result');
  const temporary = join(directory, 'tmp');
  assert.equal(playwrightDirectories(temporary).length, 2, 'the mirror\'s profile and artifacts directories appeared under the CLI\'s temporary directory');
  const code = await run.exited, exitedAfter = performance.now() - requested;
  assert.equal(code, 0, run.stderr());
  assert.ok(exitedAfter >= 29_000 && exitedAfter < 45_000, `the CLI exited ${Math.round(exitedAfter)} ms after the close request: after Playwright's forced end, not before`);
  assert.equal(run.stderr().includes('[close-stall] process.exit'), false, 'a natural exit: Playwright\'s forced end proved the end before the 35 s rule');
  assert.match(run.stderr(), /browser \d+ \(mirror\): close abandoned at its deadline, still running; process end not proven yet/);
  assert.match(run.stderr(), /Waiting for 1 browser to close; Playwright ends it within 30 s of the request\./);
  assert.deepEqual(survivors(recorded), [], 'none of the recorded processes remains');
  assert.deepEqual(playwrightDirectories(temporary), [], 'the profile and artifacts directories are gone');
});

test('the real CLI (B): a bench whose second interrupt calls process.exit while the close is pending leaves nothing behind', { skip: process.platform === 'win32' ? 'POSIX: a second Ctrl+C cannot be sent to a Windows child' : false, timeout: 300_000 }, async t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'pn-cli-close-b-'));
  const run = startStalled(t, ['bench', '--agent', 'oracle', '--tasks', 'connect', '--mirror', 'required', '--out', join(directory, 'report.json')], directory);
  const { pid } = await stopBrowserAtClose(run, directory);
  await sleep(500);
  const recorded = descendantsOf(run.child.pid!);
  assert.ok(recorded.some(row => row.pid === pid), 'the browser is alive immediately before the interrupt');
  const temporary = join(directory, 'tmp');
  assert.ok(playwrightDirectories(temporary).length >= 2, 'the mirror\'s directories appeared under the CLI\'s temporary directory');
  run.child.kill('SIGINT');
  assert.ok(await until(() => /stopping/.test(run.stderr()), 10_000), run.stderr());
  run.child.kill('SIGINT');
  const code = await run.exited;
  assert.equal(code, 130, run.stderr());
  assert.match(run.stderr(), /\[close-stall\] process\.exit\(130\)/, 'the second interrupt\'s immediate process.exit');
  assert.ok(await until(() => survivors(recorded).length === 0, 5_000), `survivors: ${JSON.stringify(survivors(recorded).map(row => row.pid))}`);
  assert.deepEqual(playwrightDirectories(temporary), [], 'Playwright\'s exit handler removed the directories');
});

// Review of PR #69 (effects-5): Ctrl+C while the command says it waits for a browser killed Node past
// Playwright's exit handler, and the mirror's directories were left behind.
test('the real CLI (C): Ctrl+C during the wait for a browser ends the command through process.exit, and nothing is left', { skip: process.platform === 'win32' ? 'POSIX: a Ctrl+C cannot be sent to a Windows child' : false, timeout: 240_000 }, async t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'pn-cli-close-c-')), { world, actions } = pack(directory);
  const run = startStalled(t, ['run', world, '--seed', '1', '--actions', actions, '--mirror', 'required'], directory);
  const { pid } = await stopBrowserAtClose(run, directory);
  assert.ok(await until(() => run.stderr().includes('Waiting for 1 browser to close'), 30_000), run.stderr());
  const recorded = descendantsOf(run.child.pid!), temporary = join(directory, 'tmp');
  assert.ok(recorded.some(row => row.pid === pid), 'the browser is alive while the command waits');
  assert.equal(playwrightDirectories(temporary).length, 2, 'the mirror\'s directories are there');
  run.child.kill('SIGINT');
  assert.equal(await run.exited, 130, run.stderr());
  assert.match(run.stderr(), /\[close-stall\] process\.exit\(130\)/, 'the signal went through process.exit, so Playwright\'s exit handler ran');
  assert.ok(await until(() => survivors(recorded).length === 0, 5_000), `survivors: ${JSON.stringify(survivors(recorded).map(row => row.pid))}`);
  assert.deepEqual(playwrightDirectories(temporary), [], 'the directories are gone');
});

// Review of PR #69 (Codex gap): without a stall, the cleanup assertions could pass on a folder nothing
// used. The run is watched while it runs: Playwright's directories must appear in the CLI's temporary
// directory before the test asserts that they are gone. Runs on every platform; Windows has only this one.
test('the real CLI without a stall: the directories appear where the test put the temporary directory, and nothing is left after the exit', { timeout: 240_000 }, async t => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), 'pn-cli-close-w-')), { world, actions } = pack(directory);
  const temporary = join(directory, 'tmp'), home = join(directory, 'home');
  mkdirSync(temporary); mkdirSync(home);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, [CLI, 'run', world, '--seed', '1', '--actions', actions, '--mirror', 'required'], { cwd: directory, env: { ...process.env, PRACTONAUT_HOME: home, ...temporaryDirectoryOf(temporary) } });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; }); child.stdout.resume();
  const exited = new Promise<number | null>(resolve => child.on('close', code => resolve(code)));
  const seen = new Set<string>();
  let running = true;
  void exited.then(() => { running = false; });
  while (running) { for (const name of playwrightDirectories(temporary)) seen.add(name); await sleep(10); }
  assert.equal(await exited, 0, stderr);
  assert.ok([...seen].filter(name => name.startsWith('playwright_chromiumdev_profile-')).length >= 1 && [...seen].filter(name => name.startsWith('playwright-artifacts-')).length >= 1,
    `Playwright's profile and artifacts directories appeared under the CLI's temporary directory: ${[...seen].join(', ')}`);
  assert.deepEqual(processesWith(temporary), [], 'no process started with the CLI\'s temporary directory remains');
  assert.deepEqual(playwrightDirectories(temporary), [], 'and no directory');
});

// Ctrl+C during `practonaut bench`: the agent runs in its own process group, so the terminal's
// SIGINT never reaches it. The bench must end the agent and its children, close the session host
// (which removes its token file) and write the runs that finished as a partial report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBenchReport } from '../../src/bench/report.ts';
import { killProcessTree } from '../../src/bench/run.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const AGENT = fileURLToPath(new URL('../support/bench-agent.ts', import.meta.url));
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (condition()) return true; await new Promise(resolve => setTimeout(resolve, 100)); }
  return condition();
}
async function files(directory: string): Promise<string[]> {
  return (await readdir(directory, { recursive: true }).catch(() => [] as string[])).map(String);
}

// Windows cannot deliver SIGINT/SIGTERM/SIGHUP to another process: Node ends it abruptly, so no
// handler runs. Ctrl+C handling is tested on POSIX; the Windows process-tree end is tested below.
const POSIX_SIGNALS: string | false = process.platform === 'win32' ? 'POSIX signals cannot be sent to another process on Windows' : false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  test(`${signal} during bench ends the agent and its child, closes the session and writes a partial report`, { timeout: 120_000, skip: POSIX_SIGNALS }, async () => {
    const state = await mkdtemp(join(realpathSync(tmpdir()), 'pn-interrupt-')), home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-interrupt-home-'));
    let pids: { agent: number; child: number } | undefined;
    try {
      const out = join(state, 'partial.json');
      const bench = spawn(process.execPath, [CLI, 'bench', '--agent', `${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} family {mcp_config}`, '--tasks', 'connect,decision,insert-between', '--mirror', 'off', '--timeout', '600', '--out', out],
        { env: { ...process.env, PRACTONAUT_HOME: home, PN_TEST_AGENT_STATE: state }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = ''; bench.stdout.on('data', chunk => { stdout += chunk; }); bench.stderr.on('data', chunk => { stderr += chunk; });
      assert.ok(await until(() => existsSync(join(state, 'pids.json')), 60_000), `the second run's agent did not start: ${stderr}`);
      pids = JSON.parse(await readFile(join(state, 'pids.json'), 'utf8')) as { agent: number; child: number };
      assert.ok(alive(pids.agent) && alive(pids.child));
      const started = Date.now(); bench.kill(signal);
      const [code] = await once(bench, 'exit') as [number | null];
      assert.equal(code, 130, stderr); assert.ok(Date.now() - started < 15_000, 'stops within the kill grace period');
      assert.ok(await until(() => !alive(pids!.agent) && !alive(pids!.child), 5_000), 'agent and its child are gone');
      assert.match(stderr, /stopping — ending the agent/);
      // The interrupted run is listed, not judged; the rest is named for a resumed bench (PADR-0040).
      assert.match(stdout, /Interrupted: this report holds 2 of 3 planned runs; the run in progress is listed as not judged \(infra_error, “interrupted”\)\. To resume, bench the remaining tasks: --tasks decision,insert-between/);
      const report = validateBenchReport(JSON.parse(await readFile(out, 'utf8')));
      assert.deepEqual([report.runs.length, report.runs[0]!.taskId, report.interrupted], [2, 'connect', { plannedRuns: 3 }]);
      assert.deepEqual([report.runs[1]!.taskId, report.runs[1]!.status, report.runs[1]!.note, report.runs[1]!.checker, report.runs[1]!.pass], ['decision', 'infra_error', 'interrupted', null, false]);
      const left = await files(home);
      assert.deepEqual(left.filter(name => /\.token$|open-.*\.html$/.test(name)), [], 'no session token or launcher file is left behind');
    } finally {
      if (pids) for (const pid of [pids.agent, pids.child]) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
      await rm(state, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
    }
  });
}

test('a bench interrupted in its only run lists that run as not judged and exits 130', { timeout: 120_000, skip: POSIX_SIGNALS }, async () => {
  const home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-interrupt-home-'));
  try {
    const bench = spawn(process.execPath, [CLI, 'bench', '--agent', `${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} sleep {mcp_config}`, '--tasks', 'connect', '--mirror', 'off'], { env: { ...process.env, PRACTONAUT_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; bench.stderr.on('data', chunk => { stderr += chunk; });
    assert.ok(await until(() => stderr.includes('practonaut bench: 1 run'), 30_000)); await new Promise(resolve => setTimeout(resolve, 2_000));
    bench.kill('SIGINT');
    const [code] = await once(bench, 'exit') as [number | null];
    assert.equal(code, 130, stderr);
    const benches = await readdir(join(home, 'bench'));
    const report = validateBenchReport(JSON.parse(await readFile(join(home, 'bench', benches[0]!, 'report.json'), 'utf8')));
    assert.deepEqual([report.runs.length, report.runs[0]!.status, report.runs[0]!.note, report.interrupted], [1, 'infra_error', 'interrupted', undefined]);
    assert.deepEqual((await files(home)).filter(name => /\.token$/.test(name)), []);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test('a second Ctrl+C stops at once: the agent that ignores SIGTERM is killed, no report, exit 130', { timeout: 120_000, skip: process.platform === 'win32' }, async () => {
  const state = await mkdtemp(join(realpathSync(tmpdir()), 'pn-force-')), home = await mkdtemp(join(realpathSync(tmpdir()), 'pn-force-home-'));
  let agent: number | undefined;
  try {
    const out = join(state, 'report.json');
    const bench = spawn(process.execPath, [CLI, 'bench', '--agent', `${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} stubborn {mcp_config}`, '--tasks', 'connect', '--mirror', 'off', '--timeout', '600', '--out', out],
      { env: { ...process.env, PRACTONAUT_HOME: home, PN_TEST_AGENT_STATE: state }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; bench.stderr.on('data', chunk => { stderr += chunk; });
    assert.ok(await until(() => existsSync(join(state, 'pids.json')), 60_000), `the agent did not start: ${stderr}`);
    agent = (JSON.parse(await readFile(join(state, 'pids.json'), 'utf8')) as { agent: number }).agent;
    const exited = once(bench, 'exit') as Promise<[number | null]>;
    bench.kill('SIGINT');
    assert.ok(await until(() => stderr.includes('press Ctrl+C again to stop at once'), 5_000), stderr);
    // The first interrupt alone would wait for the agent's 3-second kill grace period.
    const second = Date.now(); bench.kill('SIGINT');
    const [code] = await exited;
    assert.ok(Date.now() - second < 1_500, `exited ${Date.now() - second} ms after the second interrupt`);
    assert.equal(code, 130, stderr); assert.match(stderr, /stopped at once \(second interrupt\)/);
    assert.ok(await until(() => !alive(agent!), 2_000), 'the agent is gone');
    assert.equal(existsSync(out), false, 'no report');
  } finally {
    if (agent) try { process.kill(agent, 'SIGKILL'); } catch { /* gone */ }
    await rm(state, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
  }
});

test('Windows: a timed-out or interrupted agent is ended with its whole process tree', () => {
  const calls: Array<[string, string[]]> = [], kills: Array<[number, string]> = [];
  killProcessTree(4242, 'SIGTERM', 'win32', (command, args) => calls.push([command, args]), (pid, signal) => kills.push([pid, signal]));
  assert.deepEqual(calls, [['taskkill', ['/pid', '4242', '/T', '/F']]]); assert.equal(kills.length, 0);
  killProcessTree(4242, 'SIGTERM', 'linux', (command, args) => calls.push([command, args]), (pid, signal) => kills.push([pid, signal]));
  assert.deepEqual(kills, [[-4242, 'SIGTERM']], 'POSIX signals the process group');
});

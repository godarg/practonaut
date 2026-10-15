// A bench killed without a report (kill -9, power loss, a second Ctrl+C) loses nothing a round needs
// (PADR-0040): `bench <its arguments> --recover <bench folder>` rebuilds the partial report from the
// run folders, re-verified as `report --verify` does, once the killed bench's agent has ended; the
// gate's spend scan and merge then take it like any partial report. A changed folder is refused by
// the run's name. The agent is a stand-in `claude` (no language model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClaude } from '../support/fake-claude.ts';
import { validateBenchReport, type BenchReportV2 } from '../../src/bench/report.ts';
import { scanSpend } from '../../src/challenge/files.ts';
import { mergeAgentRuns } from '../../src/challenge/gate.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TASKS = ['connect', 'decision', 'insert-between'];
const alive = (pid: number): boolean => { try { process.kill(-pid, 0); return true; } catch { return false; } };
async function until(condition: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (condition()) return true; await new Promise(resolve => setTimeout(resolve, 100)); }
  return condition();
}
const json = async (path: string): Promise<BenchReportV2> => validateBenchReport(JSON.parse(await readFile(path, 'utf8'))) as BenchReportV2;

test('a bench killed with kill -9 is recovered from its run folders once its agent has ended, resumed, and taken by the gate; a changed folder is refused by name', { timeout: 300_000, skip: process.platform === 'win32' ? 'kill -9 of a process group is POSIX' : false }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-recover-'));
  let sleeper: number | undefined;
  try {
    const bin = join(dir, 'bin'), home = join(dir, 'home'), state = join(dir, 'state');
    await mkdir(bin); await mkdir(state); await fakeClaude(bin);
    const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
    const env = { ...process.env, PRACTONAUT_HOME: home, PN_FAKE_MODEL: 'claude-opus-5-5', [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
    const args = (tasks: readonly string[]): string[] => ['bench', '--agent', 'claude-code', '--tasks', tasks.join(','), '--mirror', 'off', '--timeout', '600', '--stop-on-infra'];
    const cli = (extra: string[]) => spawnSync(process.execPath, [CLI, ...extra], { encoding: 'utf8', env });

    // The first run is judged; the second run's agent observes and then never ends: kill -9 the bench.
    const bench = spawn(process.execPath, [CLI, ...args(TASKS)], { env: { ...env, PN_FAKE_SLEEP_AFTER: '1', PN_FAKE_STATE: state }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; bench.stderr.on('data', chunk => { stderr += chunk; });
    assert.ok(await until(() => existsSync(join(state, 'sleeper.pid')), 120_000), `the second run's agent did not start: ${stderr}`);
    sleeper = Number(await readFile(join(state, 'sleeper.pid'), 'utf8'));
    const folder = join(home, 'bench', (await readdir(join(home, 'bench')))[0]!);
    assert.ok(existsSync(join(folder, 'connect-s1-r1', 'checker.json')), 'the first run was judged');
    bench.kill('SIGKILL'); await once(bench, 'exit');
    assert.equal(existsSync(join(folder, 'report.json')), false, 'a killed bench writes no report');
    // Without a report the judged run is listed nowhere: the gate would refuse the round.
    const scan = async () => (await scanSpend([join(home, 'bench')], { developmentHash: '-', developmentTasks: [], heldOutTasks: TASKS })).heldOut.map(run => `${run.runId}:${run.status}`);
    assert.deepEqual(await scan(), ['connect-s1-r1:null', 'decision-s1-r1:unjudged']);

    // The killed bench's agent outlives it: no recovery (and no world in the folder) while it runs.
    assert.ok(alive(sleeper));
    let result = cli([...args(TASKS), '--recover', folder]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`cannot be recovered: run decision-s1-r1: its agent \\(process ${sleeper}\\) still runs; end it and its process group \\(kill -9 -${sleeper}\\)`));
    assert.equal(existsSync(join(folder, 'world.pnworld')), false, 'the world stays out of a folder whose agent runs');
    process.kill(-sleeper, 'SIGKILL');
    assert.ok(await until(() => !alive(sleeper!), 5_000), 'the agent is gone');

    // A copy whose judged run claims a pass the checker does not give is refused, by the run's name.
    const tampered = join(dir, 'tampered'); await cp(folder, tampered, { recursive: true });
    const checkerPath = join(tampered, 'connect-s1-r1', 'checker.json'), checker = JSON.parse(await readFile(checkerPath, 'utf8'));
    assert.equal(checker.session.passed, false); checker.session.passed = true; await writeFile(checkerPath, JSON.stringify(checker) + '\n');
    result = cli([...args(TASKS), '--recover', tampered]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /cannot be recovered: .*run connect-s1-r1/);
    assert.equal(existsSync(join(tampered, 'report.json')), false);
    // Other arguments than the bench's own: a run folder outside their plan is refused.
    result = cli([...args(['connect']), '--recover', folder]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /run folder decision-s1-r1 is not in the plan of these arguments/);

    result = cli([...args(TASKS), '--recover', folder]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recovered 2 runs from the run folders \(1 judged and re-verified, 1 not judged, listed as infra_error “interrupted”\).*--tasks decision,insert-between/s);
    const recovered = await json(join(folder, 'report.json'));
    assert.deepEqual([recovered.recovered, recovered.interrupted, recovered.agent.model], [true, { plannedRuns: 3 }, 'claude-opus-5-5']);
    const [first, second] = recovered.runs;
    assert.deepEqual([first!.id, first!.status, first!.pass, first!.checker?.session.passed, first!.client?.model, first!.toolCalls.observe > 0], ['connect-s1-r1', 'completed', false, false, 'claude-opus-5-5', true]);
    assert.deepEqual([second!.id, second!.status, second!.note, second!.checker], ['decision-s1-r1', 'infra_error', 'interrupted', null]);
    const verified = cli(['report', join(folder, 'report.json'), '--verify']);
    assert.equal(verified.status, 0, verified.stderr);
    result = cli([...args(TASKS), '--recover', folder]);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /already holds a report\.json/);

    // Resumed with the named tasks; the gate's scan finds every run listed and its merge takes both.
    result = cli(args(['decision', 'insert-between']));
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await scan(), ['connect-s1-r1:completed', 'decision-s1-r1:infra_error', 'decision-s1-r1:completed', 'insert-between-s1-r1:completed']);
    const benches = (await readdir(join(home, 'bench'))).sort();
    const reports = await Promise.all(benches.map(async bench => ({ report: await json(join(home, 'bench', bench, 'report.json')), bench })));
    const merged = mergeAgentRuns(reports, 'claude-opus-5-5');
    assert.deepEqual(TASKS.map(task => `${task}:${merged.get(task)?.bench === benches[0] ? 'recovered' : 'resumed'}:${merged.get(task)?.run.status}`), ['connect:recovered:completed', 'decision:resumed:completed', 'insert-between:resumed:completed']);
  } finally {
    if (sleeper) try { process.kill(-sleeper, 'SIGKILL'); } catch { /* gone */ }
    await rm(dir, { recursive: true, force: true });
  }
});

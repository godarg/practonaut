// A guarded bench killed with kill -9 (PADR-0042 as amended on acceptance): `--recover` through the guard
// keeps the outcome of every run-end record already appended, writes the ones its folders prove, leaves
// the run the kill cut short void, and `probe` takes the recovered report. A temporary repository with a
// local bare remote and a stand-in `claude` that crashes, solves or sleeps per start
// (tests/support/challenge-project.ts); no language model. POSIX only: it kills a process group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLedger } from '../../src/challenge/ledger.ts';
import { json, preProbeReady, project, until, type Json } from '../support/challenge-project.ts';

test('a guarded bench killed with kill -9 is recovered through the guard: a run whose run-end record states an infra_error keeps it, a judged run binds to the run-end the runner wrote, the run the kill cut short stays void, and probe takes the recovered report (review: r2-killed-bench-dead-end; recovery ignores existing run-end records)', { timeout: 450_000, skip: process.platform === 'win32' ? 'kill -9 of a process group is POSIX' : false }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-killed-'));
  let sleeper: number | undefined;
  try {
    const p = await project(dir);
    const ready = await preProbeReady(p, dir), { plan, record, model } = ready;
    // Without --stop-on-infra, so that the bench goes on after an infra_error.
    const guarded = (tasks?: string): string[] => ready.guarded(tasks).filter(arg => arg !== '--stop-on-infra');
    // repair-1's agent ends without a tool call (infra_error, no_tool_call, recorded); repair-2 is judged
    // and recorded; repair-3's agent never ends: kill -9 the bench, then the agent.
    const running = p.background(guarded(), { ...model, PN_FAKE_CRASH_FIRST: '1', PN_FAKE_SLEEP_AFTER: '2' });
    assert.ok(await until(() => existsSync(join(p.state, 'sleeper.pid')), 120_000), 'the third run started');
    sleeper = Number(await readFile(join(p.state, 'sleeper.pid'), 'utf8'));
    running.child.kill('SIGKILL'); await running.exited;
    process.kill(-sleeper, 'SIGKILL');
    assert.ok(await until(() => { try { process.kill(-sleeper!, 0); return false; } catch { return true; } }, 5_000), 'the agent is gone');
    const folder = join(p.benchRoot, (await readdir(p.benchRoot))[0]!);
    assert.equal(existsSync(join(folder, 'report.json')), false);
    const ledger = parseLedger(await readFile(p.ledgerPath, 'utf8'));
    assert.deepEqual([...ledger.ends.values()].map(end => [end.status, end.failure?.reason ?? null]), [['infra_error', 'no_tool_call'], ['completed', null]]);
    // A judged, recorded run whose verdict left its folder is refused by its name; restored, it recovers.
    const verdict = join(folder, 'repair-2-s1-r1', 'checker.json');
    await rename(verdict, `${verdict}.aside`);
    const lost = p.tool(['bench', ...guarded(), '--recover', folder]);
    assert.equal(lost.status, 2); assert.match(lost.stderr, /run repair-2-s1-r1: its run-end record states a judged run \(completed\), and its folder no longer holds that verdict/);
    await rename(`${verdict}.aside`, verdict);
    const recovered = p.ok(['bench', ...guarded(), '--recover', folder]);
    assert.match(recovered.stdout, /Release ledger: 0 run-end records written from the run folders; 1 starts without a provable outcome stay void \(counted, and not benched again for the round\): repair-3-s1-r1/);
    // The run whose record states no_tool_call keeps that outcome (its folder alone would read "interrupted").
    const report = await json(join(folder, 'report.json'));
    assert.deepEqual(report.runs.map((run: Json) => [run.id, run.status, run.failure?.reason ?? null]), [['repair-1-s1-r1', 'infra_error', 'no_tool_call'], ['repair-2-s1-r1', 'completed', null], ['repair-3-s1-r1', 'infra_error', 'interrupted']]);
    // repair-1 (an infra_error) is benched again with the rest; repair-3 (void) is not.
    const rest = await p.bench(guarded('repair-1,repair-4,repair-5,repair-6,repair-7'), model);
    assert.equal(rest.status, 0, rest.stderr);
    p.ok(['ledger', 'write']); p.commit('ledger');
    assert.match(p.ok(['probe', '--plan', plan, '--set', ready.probeSet, '--dev', [join(folder, 'report.json'), rest.path].join(','), '--out', record]).stdout, /Opus passed 2 of 7; not admitted: 1 void pre-probe run \(no run-end record: repair-3\)/);
  } finally {
    if (sleeper) try { process.kill(-sleeper, 'SIGKILL'); } catch { /* gone */ }
    await rm(dir, { recursive: true, force: true });
  }
});

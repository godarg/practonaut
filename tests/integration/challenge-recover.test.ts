// A guarded bench whose run-end record cannot be appended (PADR-0042 as amended on acceptance): the bench
// stops without a report, `--recover` through the guard writes the run-end the run folder proves, a run
// whose verdict files are gone stays void, and `probe` takes both recovered reports. A temporary
// repository with a local bare remote and a stand-in `claude` that holds its run open while the test
// removes the ledger file (tests/support/challenge-project.ts); no language model; every platform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countLedger, parseLedger } from '../../src/challenge/ledger.ts';
import { json, preProbeReady, project, records, until } from '../support/challenge-project.ts';

test('a run-end the guard cannot append stops the bench without a report; --recover through the guard writes it from the run folder, a run whose verdict files are gone stays void, and probe records the pre-probe as not admitted (review: r2-killed-bench-dead-end, gate-run-end-lock-window)', { timeout: 450_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-recover-'));
  try {
    const p = await project(dir);
    const { plan, record, probeSet, model: solving, guarded } = await preProbeReady(p, dir);
    const hold = join(dir, 'hold'), model = { ...solving, PN_FAKE_HOLD: hold };
    /** A pre-probe bench whose first run cannot append its run-end: the ledger file is gone at that
     * moment. `at`: the ledger's record count once that run's start entry is appended. */
    const cut = async (tasks: string | undefined, at: number): Promise<string> => {
      await writeFile(hold, '');
      const before = new Set(await readdir(p.benchRoot).catch(() => [] as string[]));
      const running = p.background(guarded(tasks), model);
      assert.ok(await until(async () => await records(p.ledgerPath) === at, 120_000), 'the start entry was appended');
      const text = await readFile(p.ledgerPath, 'utf8');
      await rm(p.ledgerPath); await rm(hold);
      const ended = await running.exited;
      assert.equal(ended.status, 2, ended.stderr);
      assert.match(ended.stderr, /ledger_missing: the run-end record of repair-\d-s1-r1 could not be appended \(there is no local release ledger .*\); the bench stopped without a report\. Recover its folder through the same guard: the same command with --recover /);
      await writeFile(p.ledgerPath, text);
      const folder = join(p.benchRoot, (await readdir(p.benchRoot)).find(name => !before.has(name))!);
      assert.equal(existsSync(join(folder, 'report.json')), false, 'no report');
      return folder;
    };
    // 1. repair-1 is judged (its verdict files are in its folder) but its run-end is not appended.
    const first = await cut(undefined, 2);
    assert.ok(existsSync(join(first, 'repair-1-s1-r1', 'checker.json')));
    const recovered = p.ok(['bench', ...guarded(), '--recover', first]);
    assert.match(recovered.stdout, /Release ledger: 1 run-end records written from the run folders; 0 starts without a provable outcome stay void/);
    let ledger = parseLedger(await readFile(p.ledgerPath, 'utf8'));
    assert.deepEqual([...ledger.ends.values()].map(end => [end.start, end.status, end.recovered]), [[1, 'completed', true]]);
    // 2. repair-2 is cut the same way, and its verdict files are deleted before the recovery: void.
    const second = await cut('repair-2,repair-3,repair-4,repair-5,repair-6,repair-7', 4);
    await rm(join(second, 'repair-2-s1-r1', 'checker.json')); await rm(join(second, 'repair-2-s1-r1', 'session.json'));
    const voided = p.ok(['bench', ...guarded('repair-2,repair-3,repair-4,repair-5,repair-6,repair-7'), '--recover', second]);
    assert.match(voided.stdout, /Release ledger: 0 run-end records written from the run folders; 1 starts without a provable outcome stay void \(counted, and not benched again for the round\): repair-2-s1-r1/);
    ledger = parseLedger(await readFile(p.ledgerPath, 'utf8'));
    assert.deepEqual([ledger.ends.size, countLedger(ledger).open, countLedger(ledger).counted], [1, 1, 2]);
    // 3. The rest, then the record: both recovered reports are taken (the model from their start entries).
    const rest = await p.bench(guarded('repair-3,repair-4,repair-5,repair-6,repair-7'), solving);
    assert.equal(rest.status, 0, rest.stderr);
    p.ok(['ledger', 'write']); p.commit('ledger');
    const reports = [join(first, 'report.json'), join(second, 'report.json'), rest.path].join(',');
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', reports, '--out', record]).stdout, /Opus passed 2 of 7; not admitted: 1 void pre-probe run \(no run-end record: repair-2\); a refused unit may be retuned once/);
    const value = await json(join(p.repo, record));
    assert.deepEqual([value.admitted, value.void, value.passed, value.runs.length], [false, ['repair-2'], 2, 6]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

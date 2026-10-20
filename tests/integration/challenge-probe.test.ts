// The pre-probe record of a 0.3.0 round (PADR-0042 as amended on acceptance): `plan` names the unit an
// approval is for, `probe` refuses runs of the pre-probe instances made outside the release ledger — on
// the pre-probe set, or on another world that poses the same instances — and holds to the plan's
// Practonaut, and the guard takes no pre-probe start on another set. A temporary repository with a local
// bare remote and a stand-in `claude` (tests/support/challenge-project.ts); no language model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json, OPUS, preProbeReady, project } from '../support/challenge-project.ts';

test('probe refuses runs of the pre-probe outside the ledger, on the pre-probe set or a tuning set of the same instances, and holds to the plan\'s Practonaut; the guard takes no pre-probe start on another set; an approval names its unit (review: budget-declare-no-outside-scan, r2-round-instances-by-world-hash, r2-round-world-closure-from-stray-start, gate-probe-declare-skip-version-pin, gate-maintainer-approval-not-by-name)', { timeout: 450_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-probe-'));
  try {
    const p = await project(dir);
    const { plan, record, probeSet, model, guarded } = await preProbeReady(p, dir);
    // An approval names its unit.
    const named = p.tool(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'injection.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan, '--force']);
    assert.equal(named.status, 1); assert.match(named.stderr, /--maintainer-approved-unit names injection\.practonaut, not the planned unit repair\.practonaut/);
    // A look at one pre-probe instance outside the ledger, then the pre-probe through the guard.
    const peek = await p.bench(['--agent', 'claude-code', ...p.setArgs(probeSet, 'repair-4')], model, true);
    assert.equal(peek.status, 0, peek.stderr);
    const pre = await p.bench(guarded(), model);
    assert.equal(pre.status, 0, pre.stderr);
    p.ok(['ledger', 'write']); p.commit('ledger');
    let refused = p.tool(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run_outside_ledger: 1 model run folder of this round's tasks holds no start entry in the release ledger \(first: repair-4-s1-r1/);
    await rm(join(peek.path, '..'), { recursive: true });
    // The same instance on another world — a tuning set of the plan's seeds and difficulty — is found by
    // its task identity (review: r2-round-instances-by-world-hash), and the guard takes no pre-probe start
    // on it (review: r2-round-world-closure-from-stray-start).
    const devSet = join(dir, 'dev');
    p.ok(['generate', 'repair', '--set', 'dev', '--seed', '1', '--count', '7', '--difficulty', '1', '--out', devSet]);
    const startsBefore = (await p.started()).length;
    const stray = await p.bench(['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', ...p.setArgs(devSet, 'repair-6')], model);
    assert.equal(stray.status, 2); assert.match(stray.stderr, /round_instance_refused: this pre-probe run benches repair-6 on world [0-9a-f]{12}…, not an instance of the round's own set/);
    assert.equal((await p.started()).length, startsBefore);
    const devPeek = await p.bench(['--agent', 'claude-code', ...p.setArgs(devSet, 'repair-6')], model, true);
    assert.equal(devPeek.status, 0, devPeek.stderr);
    refused = p.tool(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run_outside_ledger: 1 model run folder of this round's tasks holds no start entry in the release ledger \(first: repair-6-s1-r1/);
    await rm(join(devPeek.path, '..'), { recursive: true });
    // Nothing outside the ledger: the record.
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]).stdout, /Opus passed 3 of 7; admitted/);
    // The pre-probe holds to the plan's Practonaut (review: gate-probe-declare-skip-version-pin).
    const value = await json(join(p.repo, plan)); value.toolchain.practonaut = '0.0.1';
    await writeFile(join(p.repo, plan), JSON.stringify(value, null, 2) + '\n'); p.commit('another pin');
    refused = p.tool(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', join(dir, 'x.json')]);
    assert.equal(refused.status, 2, refused.stderr); assert.match(refused.stderr, /practonaut_version: the round's plan pins Practonaut 0\.0\.1/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

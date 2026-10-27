// The declaration of a 0.3.0 round (PADR-0042 as amended on acceptance): `declare` refuses runs of the
// pre-probe instances made outside the release ledger after the record and holds to the plan's
// Practonaut, and the gate regenerates the pre-probe world from the plan. A temporary repository with a
// local bare remote and a stand-in `claude` (tests/support/challenge-project.ts); no language model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HAIKU, json, OPUS, preProbeReady, project, SONNET } from '../support/challenge-project.ts';

test('declare refuses runs of the pre-probe outside the ledger and holds to the plan\'s Practonaut; the gate regenerates the pre-probe world from the plan (review: budget-declare-no-outside-scan, gate-probe-declare-skip-version-pin, gate-probe-world-not-regenerated)', { timeout: 450_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-declare-'));
  try {
    const p = await project(dir);
    const { plan, record, declaration, probeSet, model, guarded } = await preProbeReady(p, dir);
    const pre = await p.bench(guarded(), model);
    assert.equal(pre.status, 0, pre.stderr);
    p.ok(['ledger', 'write']); p.commit('ledger');
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]).stdout, /Opus passed 3 of 7; admitted/);
    p.ok(['ledger', 'write']); p.commit('record');
    // A look after the record: the declaration scans as well.
    const later = await p.bench(['--agent', 'claude-code', ...p.setArgs(probeSet, 'repair-5')], model, true);
    assert.equal(later.status, 0, later.stderr);
    let refused = p.tool(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', [OPUS, SONNET, HAIKU].join(','), '--out', declaration]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run_outside_ledger: 1 model run folder of this round's tasks holds no start entry in the release ledger \(first: repair-5-s1-r1/);
    await rm(join(later.path, '..'), { recursive: true });
    p.ok(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', [OPUS, SONNET, HAIKU].join(','), '--out', declaration]);
    p.ok(['ledger', 'write']); p.commit('declare');
    // The gate regenerates the pre-probe world from the plan (review: gate-probe-world-not-regenerated): a
    // declaration naming another pre-probe world, committed and recorded by a set's manifest, is refused.
    const tampered = await json(join(p.repo, declaration)); tampered.development.world.contentHash = 'a'.repeat(64);
    await writeFile(join(p.repo, declaration), JSON.stringify(tampered, null, 2) + '\n'); p.commit('another pre-probe world');
    const fakeSet = join(dir, 'fake-set'); await mkdir(fakeSet);
    await writeFile(join(fakeSet, 'instances.json'), JSON.stringify({ basis: { commit: p.git('rev-parse', 'HEAD') } }));
    refused = p.tool(['gate', '--preflight', '--declaration', declaration, '--set', fakeSet, '--dev', pre.path, '--oracle', 'o', '--random', 'r']);
    assert.equal(refused.status, 2, refused.stderr); assert.match(refused.stderr, /round_files_mismatch: the declaration or the pre-probe record names another pre-probe world than the plan makes/);
    // The declaration holds to the plan's Practonaut.
    const value = await json(join(p.repo, plan)); value.toolchain.practonaut = '0.0.1';
    await writeFile(join(p.repo, plan), JSON.stringify(value, null, 2) + '\n'); p.commit('another pin');
    refused = p.tool(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', OPUS, '--out', declaration, '--force']);
    assert.equal(refused.status, 2, refused.stderr); assert.match(refused.stderr, /practonaut_version: the round's plan pins Practonaut 0\.0\.1/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

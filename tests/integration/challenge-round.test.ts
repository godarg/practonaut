// A 0.3.0 round without a language model (PADR-0042 as amended on acceptance, shape B): the start guard
// at 800, the file side on a real bench, and — opt-in — a whole round. A temporary repository with a local
// bare remote and the committed 0.2.0 round files copied in, and a stand-in `claude` that observes, plays
// a task's reference where the test lists the task for its model, or hits a usage limit
// (tests/support/challenge-project.ts). Every model run goes through the release ledger's start guard
// (`node tools/challenge.ts bench`). Expected counts are counted by hand from the outcome lists below.
// The other 0.3.0 gate files: challenge-ledger-home (where the ledger lives, `ledger init`),
// challenge-probe and challenge-declare (runs outside the ledger, the version pin), challenge-recover and
// challenge-killed (recovery through the guard), challenge-git (the ledger's history, the outside scan).
// The whole round re-judges every run and near miss in checker processes and takes longer than
// test:integration gives a file; run it on its own, after the engine build:
//   npm run engine:build && npm run player:build
//   PN_CHALLENGE_ROUND=1 node --import ./tests/support/test-home.ts --test --test-timeout=3600000 tests/integration/challenge-round.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countLedger, headerLine, parseLedger } from '../../src/challenge/ledger.ts';
import { readGateReport } from '../../src/challenge/files.ts';
import { attests, exemptRun } from '../../src/challenge/gate.ts';
import { counted, HAIKU, json, OPUS, project, RELEASE_FOLDER, SONNET, type Json } from '../support/challenge-project.ts';

test('the file side reads a real bench through the shipped parser: a judged run attests its model, a usage-limit run is exempt from its own stdout (review: gate-file-wiring-untested-by-default)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-wiring-'));
  try {
    const p = await project(dir);
    const run = await p.bench(['--agent', 'claude-code', '--tasks', 'connect,decision', '--mirror', 'off', '--timeout', '60'], { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS, PN_FAKE_LIMIT_AFTER: '1' }, true);
    assert.equal(run.status, 0, run.stderr);
    const read = await readGateReport(run.path);
    const [judged, limited] = read.report.runs;
    assert.deepEqual([judged!.status, limited!.status, limited!.failure?.reason], ['completed', 'infra_error', 'usage_limit']);
    assert.deepEqual([...read.rederived].sort(), [judged!.id, limited!.id].sort());
    assert.equal(attests(read, judged!, OPUS), true);
    assert.deepEqual(read.failures?.get(limited!.id), { reason: 'usage_limit', parser: 'claude-code-stream/1', code: limited!.failure!.code, beforeModelWork: true });
    assert.equal(exemptRun(limited!, read), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a start that would pass 800 is refused before the client starts; built-in runs take no entry; a pre-probe start needs its pushed plan', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-guard-'));
  try {
    const p = await project(dir);
    assert.match(p.ok(['ledger', 'init']).stdout, /a new release ledger for 0\.3\.0/);
    await writeFile(p.ledgerPath, counted(799));
    assert.match(p.ok(['ledger', 'show']).stdout, /799 of 800 model runs counted/);
    const model = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS };
    // Two runs planned: the 800th starts, the 801st is refused before its client starts.
    const two = await p.bench(['--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'connect,decision', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(two.status, 2, two.stderr);
    assert.match(two.stderr, /release_budget_exhausted: release 0\.3\.0 has 800 of its 800 model runs counted; this start would pass 800 and is refused before the client starts/);
    assert.deepEqual(await p.started(), [OPUS], 'the stand-in started once');
    const partial = await json(two.path);
    assert.deepEqual([partial.runs.length, partial.interrupted], [1, { plannedRuns: 2 }]);
    assert.equal(existsSync(join(two.path, '..', 'decision-s1-r1')), false, 'no run folder for the refused start');
    const ledger = parseLedger(await readFile(p.ledgerPath, 'utf8'));
    assert.deepEqual([countLedger(ledger).counted, ledger.records.length], [800, 802]);
    assert.deepEqual(ledger.records.slice(-2).map(record => record.kind), ['start', 'run-end']);
    // At the cap: refused at once, no client, no bench folder, nothing appended.
    const none = await p.bench(['--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(none.status, 2); assert.match(none.stderr, /release_budget_exhausted/);
    assert.deepEqual([await p.started(), none.path], [[OPUS], '']);
    assert.equal((await readFile(p.ledgerPath, 'utf8')), ledger.text);
    // A built-in agent starts no client and takes no entry, also at the cap.
    const oracle = await p.bench(['--purpose', 'example', '--', '--agent', 'oracle', '--tasks', 'connect', '--mirror', 'off']);
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.equal((await readFile(p.ledgerPath, 'utf8')), ledger.text);
    // A pre-probe start serves a committed and pushed plan; the 0.2.0 files are not counted anywhere.
    await writeFile(p.ledgerPath, headerLine());
    const plan = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.plan.json');
    p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'repair.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
    const unpushed = await p.bench(['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off'], model);
    assert.equal(unpushed.status, 2); assert.match(unpushed.stderr, /not_committed: repair\.practonaut-round-1\.probe-1\.plan\.json is not committed; commit and push it first/);
    assert.deepEqual(await p.started(), [OPUS]);
    // Shape A and a unit outside the preregistration are refused by name.
    let refused = p.tool(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'repair.practonaut', '--shape', 'A', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan, '--force']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /shape_a_refused/);
    refused = p.tool(['plan', '--unit', 'injection.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', join(RELEASE_FOLDER, 'injection.practonaut-round-1.probe-1.plan.json')]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /unit_not_preregistered/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a whole 0.3.0 round without a language model: pre-probe, declaration, held-out set, preflight, gate and ledger; the count starts at zero although the 0.2.0 rounds are committed', { timeout: 3_600_000, skip: process.env.PN_CHALLENGE_ROUND === '1' ? false : 'a whole round re-judges every run and near miss in checker processes, longer than test:integration gives a file; run with PN_CHALLENGE_ROUND=1' }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-round-030-'));
  try {
    const p = await project(dir), folder = p.folder;
    const file = (name: string) => join(RELEASE_FOLDER, name);
    const plan = file('repair.practonaut-round-1.probe-1.plan.json'), record = file('repair.practonaut-round-1.probe-1.json'), declaration = file('repair.practonaut-round-1.declaration.json');
    p.ok(['ledger', 'init']);
    // 1. The probe plan, committed and pushed before the first pre-probe run.
    p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'repair.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
    p.commit('plan repair.practonaut round 1');
    const probeSet = join(dir, 'probe');
    p.ok(['generate', 'repair.practonaut', '--set', 'probe', '--plan', plan, '--out', probeSet]);
    // 2. The pre-probe: Opus solves 3 of 7 (the stand-in plays the references of the listed tasks).
    const solve = join(dir, 'solve.json');
    await writeFile(solve, JSON.stringify({ oracles: join(probeSet, 'oracles'), tasks: { [OPUS]: ['repair-1', 'repair-2', 'repair-3'] } }));
    const opus = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS, PN_FAKE_SOLVE: solve };
    const pre = await p.bench(['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', ...p.setArgs(probeSet)], opus);
    assert.equal(pre.status, 0, pre.stderr);
    // The record reads the pushed ledger only.
    let refused = p.tool(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /ledger_not_committed: there is no committed release ledger/);
    assert.match(p.ok(['ledger', 'write']).stdout, /15 records \(15 new\)/);
    p.commit('ledger: pre-probe');
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]).stdout, /Opus passed 3 of 7; admitted \(1–5 of 7\)\. Wrote .* and registered it in the release ledger/);
    // The admission is in the local ledger only: declare reads the pushed one.
    p.commit('pre-probe record');
    refused = p.tool(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', [OPUS, SONNET, HAIKU].join(','), '--out', declaration]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /ledger_not_committed: the local release ledger holds 1 records the committed one lacks/);
    p.ok(['ledger', 'write']); p.commit('ledger: admission');
    // A pre-probe record is made once.
    refused = p.tool(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record, '--force']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /probe_recorded/);
    // 3. The declaration: the count before it is the pre-probe's 7, not 0.2.0's 470.
    const declared = p.ok(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', [OPUS, SONNET, HAIKU].join(','), '--out', declaration]);
    assert.match(declared.stdout, /release runs counted before this round: 7 of 800 \(0\.3\.0 counts from zero\); the round plans 85 \(formula 99 ≤ 100\); 198 kept for other units; funded/);
    const value = await json(join(p.repo, declaration));
    assert.deepEqual([value.schema, value.shape, value.alpha, value.pair, value.budget.before, value.probe.passed], ['practonaut.challenge-declaration/2', 'B', 0.05, { strongest: OPUS, weakest: HAIKU }, 7, 3]);
    p.ok(['ledger', 'write']); p.commit('declare repair.practonaut round 1');
    // 4. The held-out set and the baselines (no ledger entry), then the preflight.
    const held = join(dir, 'heldout');
    const made = p.ok(['generate', 'repair.practonaut', '--set', 'heldout', '--declaration', declaration, '--out', held]);
    assert.match(made.stdout, /ANTHROPIC_MODEL=claude-opus-5-5 node tools\/challenge\.ts bench --purpose held-out --declaration /);
    const tasks = ((await json(join(held, 'instances.json'))).instances as Json[]).map(entry => entry.taskId as string);
    assert.equal(tasks.length, 26);
    const args = p.setArgs(held);
    const oracle = await p.bench(['--agent', 'oracle', ...args], {}, true), random = await p.bench(['--agent', 'random', ...args], {}, true);
    assert.deepEqual([oracle.status, random.status], [0, 0]);
    const base = ['--declaration', declaration, '--set', held, '--dev', pre.path, '--oracle', oracle.path, '--random', random.path];
    assert.match(p.ok(['gate', '--preflight', ...base]).stdout, /preflight passed — the ladder may start[\s\S]*oracle 26\/26, random 0\/26/);
    // 5. The ladder through the guard: Opus solves the first 15, Sonnet 10, Haiku 4. Opus is stopped by
    // a usage limit at its eleventh run and resumed.
    await writeFile(solve, JSON.stringify({ oracles: join(held, 'oracles'), tasks: { [OPUS]: tasks.slice(0, 15), [SONNET]: tasks.slice(0, 10), [HAIKU]: tasks.slice(0, 4) } }));
    const ladder = (model: string, extra: Record<string, string> = {}, only?: string) => p.bench(['--purpose', 'held-out', '--declaration', declaration, '--', '--agent', 'claude-code', ...(only ? p.setArgs(held, only) : args)], { ANTHROPIC_MODEL: model, PN_FAKE_MODEL: model, PN_FAKE_SOLVE: solve, ...extra });
    const stopped = await ladder(OPUS, { PN_FAKE_LIMIT_AFTER: '10' });   // counted from this bench's first start
    assert.equal(stopped.status, 75, stopped.stderr);
    const rest = /--tasks (\S+)/.exec(stopped.stdout)![1]!;
    assert.equal(rest.split(',').length, 16);
    await rm(join(p.state, 'starts'));
    const resumed = await ladder(OPUS, {}, rest);
    const sonnet = await ladder(SONNET), haiku = await ladder(HAIKU);
    assert.deepEqual([resumed.status, sonnet.status, haiku.status], [0, 0, 0]);
    // A model the declaration does not name is refused before its client starts.
    const before = (await p.started()).length;
    const other = await ladder('claude-opus-4-1');
    assert.equal(other.status, 2); assert.match(other.stderr, /ledger_model_refused/);
    assert.equal((await p.started()).length, before);
    const reports = [stopped.path, resumed.path, sonnet.path, haiku.path];
    // 6. The gate reads only pushed records.
    refused = p.tool(['gate', ...base, '--ladder', reports.join(','), '--out', file('repair.practonaut-round1.md')]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /ledger_not_committed: the local release ledger holds 158 records the committed one lacks/);
    p.ok(['ledger', 'write']); p.commit('ledger: held-out');
    const gated = p.ok(['gate', ...base, '--ladder', reports.join(','), '--out', file('repair.practonaut-round1.md')]);
    assert.match(gated.stdout, /repair\.practonaut round 1: passes; 85 model runs counted in the round \(1 exempt\); release 85 of 800/);
    const markdown = await readFile(join(p.repo, file('repair.practonaut-round1.md')), 'utf8');
    assert.match(markdown, /\*\*Verdict: the unit passes round 1\.\*\* ladder: Claude models only\./);
    assert.match(markdown, /\| budget \| 85 model runs counted \(78 held-out \+ 7 pre-probe\), 1 refused by the client before model work not counted; release 85 of 800 \|/);
    assert.match(markdown, /\| ladder \(claude-code\) \| `claude-opus-5-5` \| 15\/26 \|.*\| 0 \| 0 \| 0 \| 0 \| 2 \|/);
    assert.match(markdown, /\| ladder \(claude-code\) \| `claude-haiku-5-5` \| 4\/26 \|/);
    assert.match(markdown, /\| mcnemar \| b = 11, c = 0, p = 0\.0010 \|/);
    assert.match(markdown, /Built-in runs, listed and not counted: oracle 26, random 26\./);
    const result = await json(join(p.repo, file('repair.practonaut-round1.gate.json')));
    assert.deepEqual([result.schema, result.verdict, result.spend, result.ledger.counted, result.ledger.versions.length], ['practonaut.challenge-gate/2', 'passes', { preProbe: 7, heldOut: 78, total: 85, exempt: 1, planned: 85, other: 0 }, 85, 4]);
    // A re-declaration once held-out runs started is refused (no re-roll of the held-out instances).
    refused = p.tool(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', [OPUS, SONNET, HAIKU].join(','), '--out', declaration, '--force']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /round_redeclared: repair\.practonaut round 1 was declared before and its held-out runs started/);
    // The 0.2.0 files are unchanged in the repository and appear in no 0.3.0 figure.
    assert.equal(p.git('status', '--porcelain', '--', ':(glob)docs/benchmarks/challenge/*.json', ':(glob)docs/benchmarks/challenge/*.md'), '');
    // 7. A run made outside the ledger (a plain bench of one held-out task) refuses the round.
    const plainRun = await p.bench(['--agent', 'claude-code', ...p.setArgs(held, tasks[20]!)], { ANTHROPIC_MODEL: HAIKU, PN_FAKE_MODEL: HAIKU }, true);
    assert.equal(plainRun.status, 0, plainRun.stderr);
    refused = p.tool(['gate', ...base, '--ladder', reports.join(','), '--out', join(dir, 'again.md')]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, new RegExp(`run_outside_ledger: 1 model run folder of this round's tasks holds no start entry in the release ledger \\(first: ${tasks[20]}-s1-r1`));
    // 8. A rewritten committed ledger is refused: every committed version is a prefix of the current one.
    const text = await readFile(p.ledgerPath, 'utf8'), lines = text.split('\n');
    await writeFile(join(folder, 'release-ledger.jsonl'), lines.slice(0, 3).join('\n') + '\n');
    await writeFile(p.ledgerPath, lines.slice(0, 3).join('\n') + '\n');
    p.commit('rewrite the ledger');
    await rm(join(p.benchRoot, (plainRun.path.split(/[\\/]/).at(-2))!), { recursive: true });
    refused = p.tool(['gate', ...base, '--ladder', reports.join(','), '--out', join(dir, 'again.md')]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /ledger_rewritten: the release ledger of commit [0-9a-f]{12} is not a prefix of the current one/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

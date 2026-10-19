// A 0.3.0 round without a language model (PADR-0042 as amended on acceptance, shape B): a temporary
// repository with a local bare remote and the committed 0.2.0 round files copied in; a stand-in
// `claude` (tests/support/fake-claude.ts) that observes, or plays a task's reference where the test
// lists the task for its model, or hits a usage limit. Every model run goes through the release
// ledger's start guard (`node tools/challenge.ts bench`). Expected counts are counted by hand from the
// outcome lists below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClaude } from '../support/fake-claude.ts';
import { countLedger, headerLine, nextLine, parseLedger, type LedgerRecord, type StartBody } from '../../src/challenge/ledger.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TOOL = fileURLToPath(new URL('../../tools/challenge.ts', import.meta.url));
const ROUNDS_020 = fileURLToPath(new URL('../../docs/benchmarks/challenge/', import.meta.url));
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
const RELEASE_FOLDER = join('docs', 'benchmarks', 'challenge', '0.3.0');
type Json = Record<string, any>;
const json = async (path: string): Promise<Json> => JSON.parse(await readFile(path, 'utf8')) as Json;

/** A repository with a bare remote and the committed 0.2.0 rounds, a stand-in `claude`, and helpers. */
async function project(dir: string) {
  const bin = join(dir, 'bin'), home = join(dir, 'home'), repo = join(dir, 'repo'), remote = join(dir, 'remote.git'), state = join(dir, 'state');
  await mkdir(bin); await mkdir(state); await fakeClaude(bin);
  const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, PRACTONAUT_HOME: home, PN_FAKE_STATE: state, [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
  delete env.ANTHROPIC_MODEL;
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=Practonaut Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  await mkdir(remote); spawnSync('git', ['init', '--bare'], { cwd: remote });
  await mkdir(join(repo, 'docs', 'benchmarks'), { recursive: true }); git('init'); git('remote', 'add', 'origin', remote);
  // The 0.2.0 rounds as committed: five declarations /1 and five ledgers that counted 470 of 500.
  await cp(ROUNDS_020, join(repo, 'docs', 'benchmarks', 'challenge'), { recursive: true });
  await writeFile(join(repo, '.gitignore'), '.local/\n');
  git('add', '.'); git('commit', '-m', 'start'); git('push', '-u', 'origin', 'main');
  const tool = (args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [TOOL, ...args], { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } });
  const ok = (args: string[], extra: Record<string, string> = {}) => { const result = tool(args, extra); assert.equal(result.status, 0, `${args.slice(0, 2).join(' ')}: ${result.stderr}`); return result; };
  const benchRoot = join(home, 'bench');
  /** A bench (through the tool's guard, or the plain CLI) and the report it wrote. */
  const bench = async (args: string[], extra: Record<string, string> = {}, plain = false): Promise<{ path: string; status: number | null; stdout: string; stderr: string }> => {
    const before = new Set(await readdir(benchRoot).catch(() => [] as string[]));
    const result = plain ? spawnSync(process.execPath, [CLI, 'bench', ...args], { cwd: repo, encoding: 'utf8', env: { ...env, ...extra } }) : tool(['bench', ...args], extra);
    const created = (await readdir(benchRoot).catch(() => [] as string[])).filter(name => !before.has(name));
    return { path: created.length === 1 ? join(benchRoot, created[0]!, 'report.json') : '', status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const setArgs = (set: string, tasks?: string): string[] => ok(['args', set, ...(tasks ? ['--tasks', tasks] : [])]).stdout.trim().split(' ');
  const started = async (): Promise<string[]> => existsSync(join(state, 'started.log')) ? (await readFile(join(state, 'started.log'), 'utf8')).split('\n').filter(Boolean) : [];
  const ledgerPath = join(repo, '.local', 'release-ledger-0.3.0.jsonl');
  const folder = join(repo, RELEASE_FOLDER);
  const commit = (message: string) => { git('add', '-A'); git('commit', '-m', message); git('push'); };
  return { env, git, tool, ok, bench, setArgs, started, ledgerPath, folder, commit, repo, benchRoot, state };
}

test('a start that would pass 800 is refused before the client starts; built-in runs take no entry; a pre-probe start needs its pushed plan', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-guard-'));
  try {
    const p = await project(dir);
    assert.match(p.ok(['ledger', 'init']).stdout, /a new release ledger for 0\.3\.0/);
    // 799 model runs counted (built line by line, each chained to the one before).
    const state = { text: headerLine(), records: [parseLedger(headerLine()).header] as LedgerRecord[] };
    for (let index = 0; index < 799; index++) {
      const body: StartBody = { kind: 'start', purpose: 'development', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: OPUS, agent: 'claude-code', bench: '20261101T100000Z-0001', run: `connect-s${index + 1}-r1` };
      const { record, line } = nextLine(state, body); state.text += line; state.records.push(record);
    }
    await writeFile(p.ledgerPath, state.text);
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
    p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
    const unpushed = await p.bench(['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off'], model);
    assert.equal(unpushed.status, 2); assert.match(unpushed.stderr, /not_committed: repair\.practonaut-round-1\.probe-1\.plan\.json is not committed; commit and push it first/);
    assert.deepEqual(await p.started(), [OPUS]);
    // Shape A and a unit outside the preregistration are refused by name.
    let refused = p.tool(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', '--shape', 'A', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan, '--force']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /shape_a_refused/);
    refused = p.tool(['plan', '--unit', 'injection.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', join(RELEASE_FOLDER, 'injection.practonaut-round-1.probe-1.plan.json')]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /unit_not_preregistered/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a whole 0.3.0 round without a language model: pre-probe, declaration, held-out set, preflight, gate and ledger; the count starts at zero although the 0.2.0 rounds are committed', { timeout: 1_800_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-round-030-'));
  try {
    const p = await project(dir), folder = p.folder;
    const file = (name: string) => join(RELEASE_FOLDER, name);
    const plan = file('repair.practonaut-round-1.probe-1.plan.json'), record = file('repair.practonaut-round-1.probe-1.json'), declaration = file('repair.practonaut-round-1.declaration.json');
    p.ok(['ledger', 'init']);
    // 1. The probe plan, committed and pushed before the first pre-probe run.
    p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
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
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]).stdout, /Opus passed 3 of 7; admitted \(1–5 of 7\)/);
    p.commit('pre-probe record');
    // 3. The declaration: the count before it is the pre-probe's 7, not 0.2.0's 470.
    const declared = p.ok(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', [OPUS, SONNET, HAIKU].join(','), '--out', declaration]);
    assert.match(declared.stdout, /release runs counted before this round: 7 of 800 \(0\.3\.0 counts from zero\); the round plans 85 \(formula 99 ≤ 100\); 198 kept for other units; funded/);
    const value = await json(join(p.repo, declaration));
    assert.deepEqual([value.schema, value.shape, value.alpha, value.pair, value.budget.before, value.probe.passed], ['practonaut.challenge-declaration/2', 'B', 0.05, { strongest: OPUS, weakest: HAIKU }, 7, 3]);
    p.commit('declare repair.practonaut round 1');
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
    const stopped = await ladder(OPUS, { PN_FAKE_LIMIT_AFTER: '17' });   // 7 pre-probe starts + 10 held-out
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
    assert.deepEqual([result.schema, result.verdict, result.spend, result.ledger.counted, result.ledger.versions.length], ['practonaut.challenge-gate/2', 'passes', { preProbe: 7, heldOut: 78, total: 85, exempt: 1, planned: 85 }, 85, 2]);
    // The 0.2.0 files are unchanged in the repository and appear in no 0.3.0 figure.
    assert.equal(p.git('status', '--porcelain', '--', 'docs/benchmarks/challenge/*.json'), '');
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

// A 0.3.0 round without a language model (PADR-0042 as amended on acceptance, shape B): a temporary
// repository with a local bare remote and the committed 0.2.0 round files copied in; a stand-in
// `claude` (tests/support/fake-claude.ts) that observes, or plays a task's reference where the test
// lists the task for its model, or hits a usage limit. Every model run goes through the release
// ledger's start guard (`node tools/challenge.ts bench`). Expected counts are counted by hand from the
// outcome lists below. The whole round re-judges every run and near miss in checker processes and takes
// longer than test:integration gives a file; run it on its own, after the engine build:
//   npm run engine:build && npm run player:build
//   PN_CHALLENGE_ROUND=1 node --import ./tests/support/test-home.ts --test --test-timeout=3600000 tests/integration/challenge-round.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fakeClaude } from '../support/fake-claude.ts';
import { isolateGit } from '../support/git-config.ts';
import { countLedger, headerLine, nextLine, parseLedger, type LedgerRecord, type StartBody } from '../../src/challenge/ledger.ts';
import { releaseLedgerPath, repositoryIdentity } from '../../src/challenge/repository.ts';
import { readGateReport } from '../../src/challenge/files.ts';
import { attests, exemptRun } from '../../src/challenge/gate.ts';

isolateGit();
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
  // Git with this file's configuration only (isolateGit above): a bare remote whose HEAD named a branch
  // that was never pushed would give every clone of it an unborn HEAD.
  const env: NodeJS.ProcessEnv = { ...process.env, PRACTONAUT_HOME: home, PN_FAKE_STATE: state, [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
  delete env.ANTHROPIC_MODEL;
  /** git in `cwd`, with this file's configuration only. */
  const gitIn = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const git = (...args: string[]) => gitIn(repo, ...args);
  await mkdir(remote); gitIn(remote, 'init', '--bare', '--quiet');
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
  // One local ledger per user and repository, under PRACTONAUT_HOME (shared by every clone and worktree).
  const ledgerPath = releaseLedgerPath(home, repositoryIdentity(repo)!.key);
  const folder = join(repo, RELEASE_FOLDER);
  const commit = (message: string) => { git('add', '-A'); git('commit', '-m', message); git('push'); };
  /** A guarded bench started in the background (to act while it runs), and its exit. */
  const background = (args: string[], extra: Record<string, string> = {}) => {
    const child = spawn(process.execPath, [TOOL, 'bench', ...args], { cwd: repo, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit').then(([code]) => ({ status: code as number | null, stdout, stderr }));
    return { child, exited };
  };
  return { env, git, gitIn, tool, ok, bench, background, setArgs, started, ledgerPath, folder, commit, repo, remote, home, benchRoot, state };
}

/** Waits until `condition` holds (polling), at most `ms`. */
async function until(condition: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await condition()) return true; await new Promise(resolve => setTimeout(resolve, 100)); }
  return condition();
}
const records = async (path: string): Promise<number> => existsSync(path) ? (await readFile(path, 'utf8')).split('\n').filter(Boolean).length : 0;
/** A ledger of `n` counted development starts, built line by line, each chained to the one before. */
function counted(n: number): string {
  const state = { text: headerLine(), records: [parseLedger(headerLine()).header] as LedgerRecord[] };
  for (let index = 0; index < n; index++) {
    const body: StartBody = { kind: 'start', purpose: 'development', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: OPUS, agent: 'claude-code', bench: '20261101T100000Z-0001', run: `connect-s${index + 1}-r1`, world: 'f'.repeat(64), instance: 'e'.repeat(64) };
    const { record, line } = nextLine(state, body); state.text += line; state.records.push(record);
  }
  return state.text;
}

test('one release ledger for every clone and worktree of a repository on this machine: the second start at 799 is refused (review: budget-checkout-local-ledger)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-clones-'));
  try {
    const p = await project(dir), wt = join(dir, 'wt'), clone = join(dir, 'clone');
    // The committed ledger holds 799 counted starts, pushed.
    await mkdir(p.folder, { recursive: true }); await writeFile(join(p.folder, 'release-ledger.jsonl'), counted(799)); p.commit('ledger at 799');
    p.git('worktree', 'add', wt, '-b', 'second');
    p.gitIn(dir, 'clone', '--quiet', p.remote, clone);
    const inside = (cwd: string, args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', env: { ...p.env, ...extra } });
    assert.match(p.ok(['ledger', 'init']).stdout, /a copy of the longest pushed ledger \(800 records\); every clone and worktree of this repository on this machine uses it/);
    // The worktree and the second clone find the same ledger: no second count is started there.
    for (const cwd of [wt, clone]) { const result = inside(cwd, ['ledger', 'init']); assert.equal(result.status, 2); assert.match(result.stderr, /ledger_exists: .* exists: this repository's local release ledger/); }
    assert.match(inside(clone, ['ledger', 'show']).stdout, /799 of 800 model runs counted/);
    // No option names another ledger.
    const named = p.tool(['ledger', 'init', '--ledger', join(dir, 'other.jsonl')]);
    assert.equal(named.status, 1); assert.match(named.stderr, /unknown or repeated option --ledger/);
    const model = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS };
    // The worktree takes the 800th start; the clone's and the main checkout's next starts are refused before their clients start.
    let result = inside(wt, ['bench', '--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(result.status, 0, result.stderr);
    result = inside(clone, ['bench', '--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'decision', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(result.status, 2); assert.match(result.stderr, /release_budget_exhausted: release 0\.3\.0 has 800 of its 800 model runs counted/);
    const second = await p.bench(['--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'decision', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(second.status, 2); assert.match(second.stderr, /release_budget_exhausted/);
    assert.deepEqual(await p.started(), [OPUS]);
    assert.equal(countLedger(parseLedger(await readFile(p.ledgerPath, 'utf8'))).counted, 800);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('one release ledger whatever directory a command runs in and however the origin is written: keyed on the root commit, a relative origin and a fork included (review: relative origin URLs)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-origin-'));
  try {
    const p = await project(dir), docs = join(p.repo, 'docs');
    // A relative origin, as `git remote add origin ../remote.git` writes it.
    p.git('remote', 'set-url', 'origin', '../remote.git');
    const inside = (cwd: string, args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [TOOL, ...args], { cwd, encoding: 'utf8', env: { ...p.env, ...extra } });
    // From a subdirectory first, then from the top level: the same ledger, so the second init is refused.
    const first = inside(docs, ['ledger', 'init']);
    assert.equal(first.status, 0, first.stderr);
    assert.ok(first.stdout.includes(p.ledgerPath), 'the ledger the top level names');
    const again = p.tool(['ledger', 'init']);
    assert.equal(again.status, 2); assert.match(again.stderr, /ledger_exists: /);
    assert.match(inside(docs, ['ledger', 'show']).stdout, new RegExp(`0 of 800 model runs counted.*\\(${p.ledgerPath.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\\)`));
    // A clone whose origin is another repository with the same root (a fork) shares it: one budget.
    const fork = join(dir, 'fork');
    p.gitIn(dir, 'clone', '--quiet', p.remote, fork);
    p.gitIn(fork, 'remote', 'set-url', 'origin', 'https://example.invalid/someone/practonaut-fork.git');
    const forked = inside(fork, ['ledger', 'init']);
    assert.equal(forked.status, 2); assert.match(forked.stderr, /ledger_exists: /);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ledger init refuses where an earlier Practonaut kept this repository\'s ledger, and in a shallow clone (review: budget-checkout-local-ledger, r2-ledger-history-local-refs)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-elsewhere-'));
  try {
    const p = await project(dir);
    const earlier = join(p.repo, '.git', 'practonaut', 'release-ledger-0.3.0.jsonl');
    await mkdir(join(earlier, '..'), { recursive: true }); await writeFile(earlier, counted(3));
    let refused = p.tool(['ledger', 'init']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /ledger_elsewhere: a release ledger of this repository exists at .*release-ledger-0\.3\.0\.jsonl, where an earlier Practonaut kept it; move it to /);
    assert.equal(existsSync(p.ledgerPath), false);
    await rm(earlier);
    await writeFile(join(p.repo, 'second.txt'), 'a second commit, so that a clone of depth 1 cuts history off\n'); p.commit('second');
    const shallow = join(dir, 'shallow');
    p.gitIn(dir, 'clone', '--quiet', '--depth', '1', pathToFileURL(p.remote).href, shallow);
    refused = spawnSync(process.execPath, [TOOL, 'ledger', 'init'], { cwd: shallow, encoding: 'utf8', env: p.env });
    assert.equal(refused.status, 2); assert.match(refused.stderr, /shallow_clone: this repository is a shallow clone/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ledger init refuses while model-run folders exist that no pushed version of the ledger names; an existing ledger first; a run ledgered on another pushed branch is no stranger (review: r2-ledger-init-scan-misreports)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-init-'));
  try {
    const p = await project(dir);
    const plain = await p.bench(['--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off', '--timeout', '60'], { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS }, true);
    assert.equal(plain.status, 0, plain.stderr);
    let refused = p.tool(['ledger', 'init']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /runs_outside_ledger: 1 model run folder \(first: connect-s1-r1 in bench folder \d{8}T\d{6}Z-[0-9a-f]{4}\) holds no start entry of any pushed version of the release ledger/);
    assert.equal(existsSync(p.ledgerPath), false);
    // Moved out of the bench roots, the ledger starts.
    await rm(join(plain.path, '..'), { recursive: true });
    p.ok(['ledger', 'init']);
    // A guarded run, in the local ledger only: init again says the ledger exists, never that the run was made outside it.
    const guarded = await p.bench(['--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off', '--timeout', '60'], { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS });
    assert.equal(guarded.status, 0, guarded.stderr);
    refused = p.tool(['ledger', 'init']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /^challenge: ledger_exists: /);
    // Another branch pushed the ledger with that run; this branch has none. A new machine (another
    // PRACTONAUT_HOME, the same bench folders) starts from the longest pushed version, which names it.
    p.ok(['ledger', 'write']); p.git('switch', '-c', 'other'); p.git('add', '-A'); p.git('commit', '-m', 'ledger on another branch'); p.git('push', '-u', 'origin', 'other'); p.git('switch', 'main');
    assert.equal(existsSync(join(p.folder, 'release-ledger.jsonl')), false);
    const home = join(dir, 'home2'); await cp(p.benchRoot, join(home, 'bench'), { recursive: true });
    const made = p.tool(['ledger', 'init'], { PRACTONAUT_HOME: home });
    assert.equal(made.status, 0, made.stderr); assert.match(made.stdout, /a copy of the longest pushed ledger \(3 records\)/);
    // Pushed versions that are not one history (a branch whose ledger is not a prefix of another's): refused.
    p.git('switch', '-c', 'third'); await mkdir(p.folder, { recursive: true }); await writeFile(join(p.folder, 'release-ledger.jsonl'), counted(1));
    p.git('add', '-A'); p.git('commit', '-m', 'another ledger'); p.git('push', '-u', 'origin', 'third'); p.git('switch', 'main');
    const refusedThird = p.tool(['ledger', 'init'], { PRACTONAUT_HOME: join(dir, 'home3') });
    assert.equal(refusedThird.status, 2); assert.match(refusedThird.stderr, /ledger_diverged: the pushed versions of the release ledger are not one history/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('probe and declare refuse runs of the pre-probe outside the ledger and hold to the plan\'s Practonaut (review: budget-declare-no-outside-scan, gate-probe-declare-skip-version-pin)', { timeout: 600_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-probe-'));
  try {
    const p = await project(dir);
    const plan = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.plan.json'), record = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.json'), declaration = join(RELEASE_FOLDER, 'repair.practonaut-round-1.declaration.json');
    p.ok(['ledger', 'init']);
    p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'repair.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
    // An approval names its unit.
    const named = p.tool(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'injection.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan, '--force']);
    assert.equal(named.status, 1); assert.match(named.stderr, /--maintainer-approved-unit names injection\.practonaut, not the planned unit repair\.practonaut/);
    p.commit('plan');
    const probeSet = join(dir, 'probe');
    p.ok(['generate', 'repair.practonaut', '--set', 'probe', '--plan', plan, '--out', probeSet]);
    const solve = join(dir, 'solve.json');
    await writeFile(solve, JSON.stringify({ oracles: join(probeSet, 'oracles'), tasks: { [OPUS]: ['repair-1', 'repair-2', 'repair-3'] } }));
    const model = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS, PN_FAKE_SOLVE: solve };
    // A look at one pre-probe instance outside the ledger, then the pre-probe through the guard.
    const peek = await p.bench(['--agent', 'claude-code', ...p.setArgs(probeSet, 'repair-4')], model, true);
    assert.equal(peek.status, 0, peek.stderr);
    const pre = await p.bench(['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', ...p.setArgs(probeSet)], model);
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
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', record]).stdout, /Opus passed 3 of 7; admitted/);
    p.ok(['ledger', 'write']); p.commit('record');
    // A look after the record: the declaration scans as well.
    const later = await p.bench(['--agent', 'claude-code', ...p.setArgs(probeSet, 'repair-5')], model, true);
    assert.equal(later.status, 0, later.stderr);
    refused = p.tool(['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', [OPUS, SONNET, HAIKU].join(','), '--out', declaration]);
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
    // Both hold to the plan's Practonaut.
    const value = await json(join(p.repo, plan)); value.toolchain.practonaut = '0.0.1';
    await writeFile(join(p.repo, plan), JSON.stringify(value, null, 2) + '\n'); p.commit('another pin');
    for (const command of [['probe', '--plan', plan, '--set', probeSet, '--dev', pre.path, '--out', join(dir, 'x.json')], ['declare', '--plan', plan, '--probe', record, '--dev', pre.path, '--ladder', OPUS, '--out', declaration, '--force']]) {
      refused = p.tool(command);
      assert.equal(refused.status, 2, refused.stderr); assert.match(refused.stderr, /practonaut_version: the round's plan pins Practonaut 0\.0\.1/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a run-end the guard cannot append stops the bench without a report; --recover through the guard writes it from the run folder, a run whose verdict files are gone stays void, and probe records the pre-probe as not admitted (review: r2-killed-bench-dead-end, gate-run-end-lock-window)', { timeout: 600_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-recover-'));
  try {
    const p = await project(dir);
    const plan = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.plan.json'), record = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.json');
    p.ok(['ledger', 'init']);
    p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'repair.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
    p.commit('plan');
    const probeSet = join(dir, 'probe');
    p.ok(['generate', 'repair.practonaut', '--set', 'probe', '--plan', plan, '--out', probeSet]);
    const solve = join(dir, 'solve.json'), hold = join(dir, 'hold');
    await writeFile(solve, JSON.stringify({ oracles: join(probeSet, 'oracles'), tasks: { [OPUS]: ['repair-1', 'repair-2', 'repair-3'] } }));
    const model = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS, PN_FAKE_SOLVE: solve, PN_FAKE_HOLD: hold };
    const guarded = (tasks?: string) => ['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', ...(tasks ? p.setArgs(probeSet, tasks) : p.setArgs(probeSet))];
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
    const rest = await p.bench(guarded('repair-3,repair-4,repair-5,repair-6,repair-7'), { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS, PN_FAKE_SOLVE: solve });
    assert.equal(rest.status, 0, rest.stderr);
    p.ok(['ledger', 'write']); p.commit('ledger');
    const reports = [join(first, 'report.json'), join(second, 'report.json'), rest.path].join(',');
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', reports, '--out', record]).stdout, /Opus passed 2 of 7; not admitted: 1 void pre-probe run \(no run-end record: repair-2\); a refused unit may be retuned once/);
    const value = await json(join(p.repo, record));
    assert.deepEqual([value.admitted, value.void, value.passed, value.runs.length], [false, ['repair-2'], 2, 6]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a guarded bench killed with kill -9 is recovered through the guard: a run whose run-end record states an infra_error keeps it, a judged run binds to the run-end the runner wrote, the run the kill cut short stays void, and probe takes the recovered report (review: r2-killed-bench-dead-end; recovery ignores existing run-end records)', { timeout: 600_000, skip: process.platform === 'win32' ? 'kill -9 of a process group is POSIX' : false }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-killed-'));
  let sleeper: number | undefined;
  try {
    const p = await project(dir);
    const plan = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.plan.json'), record = join(RELEASE_FOLDER, 'repair.practonaut-round-1.probe-1.json');
    p.ok(['ledger', 'init']);
    p.ok(['plan', '--unit', 'repair.practonaut', '--maintainer-approved-unit', 'repair.practonaut', '--round', '1', '--difficulty', '1', '--seed', '1', '--model', OPUS, '--mirror', 'off', '--timeout', '600', '--max-actions', '50', '--out', plan]);
    p.commit('plan');
    const probeSet = join(dir, 'probe');
    p.ok(['generate', 'repair.practonaut', '--set', 'probe', '--plan', plan, '--out', probeSet]);
    const solve = join(dir, 'solve.json');
    await writeFile(solve, JSON.stringify({ oracles: join(probeSet, 'oracles'), tasks: { [OPUS]: ['repair-1', 'repair-2', 'repair-3'] } }));
    const model = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS, PN_FAKE_SOLVE: solve };
    // Without --stop-on-infra, so that the bench goes on after an infra_error.
    const guarded = (tasks?: string) => ['--purpose', 'pre-probe', '--plan', plan, '--', '--agent', 'claude-code', ...(tasks ? p.setArgs(probeSet, tasks) : p.setArgs(probeSet)).filter(arg => arg !== '--stop-on-infra')];
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
    assert.match(p.ok(['probe', '--plan', plan, '--set', probeSet, '--dev', [join(folder, 'report.json'), rest.path].join(','), '--out', record]).stdout, /Opus passed 2 of 7; not admitted: 1 void pre-probe run \(no run-end record: repair-3\)/);
  } finally {
    if (sleeper) try { process.kill(-sleeper, 'SIGKILL'); } catch { /* gone */ }
    await rm(dir, { recursive: true, force: true });
  }
});

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

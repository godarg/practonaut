// A challenge round without a language model (PADR-0040): development benches of the claude-code
// preset (a stand-in `claude` that observes and stops), a round declaration made from them in a git
// repository with a local bare remote, the held-out set generated only from the committed and pushed
// declaration, and the gate's refusals of changed set files. The whole round through the preflight
// and the gate (oracle, random and three ladder benches on 26 instances, one stopped by a usage limit
// and resumed, every report re-verified, every near miss replayed, a hidden rerun found) takes about
// twenty minutes on a busy machine, longer than test:integration gives a file; run it on its own:
//   PN_CHALLENGE_ROUND=1 node --import ./tests/support/test-home.ts --test --test-timeout=3000000 tests/integration/challenge-round.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClaude } from '../support/fake-claude.ts';
import { declarationHash, heldOutSeeds, validateDeclaration } from '../../src/challenge/declaration.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TOOL = fileURLToPath(new URL('../../tools/challenge.ts', import.meta.url));
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
type Json = Record<string, any>;
const json = async (path: string): Promise<Json> => JSON.parse(await readFile(path, 'utf8')) as Json;
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

/** A tight-budget round up to its declaration: a repository with a bare remote, development benches. */
async function developedRound(dir: string) {
  const bin = join(dir, 'bin'); await mkdir(bin); await fakeClaude(bin);
  const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
  // Each round has its own data folder: the gate counts every model run in its bench folders.
  const home = join(dir, 'home'), benchRoot = (): string => join(home, 'bench');
  const env = { ...process.env, PRACTONAUT_HOME: home, [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
  const tool = (args: string[]) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', env });
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=Practonaut Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const repo = join(dir, 'repo'), remote = join(dir, 'remote.git'), declarations = join(repo, 'docs', 'benchmarks', 'challenge');
  await mkdir(remote); spawnSync('git', ['init', '--bare'], { cwd: remote });
  await mkdir(declarations, { recursive: true }); git('init'); git('remote', 'add', 'origin', remote);
  await writeFile(join(repo, 'README.md'), 'test\n'); git('add', '.'); git('commit', '-m', 'start'); git('push', '-u', 'origin', 'main');
  const bench = async (agent: string, args: string[], extra: Record<string, string> = {}): Promise<{ path: string; status: number | null; stdout: string }> => {
    const before = new Set(await readdir(benchRoot()).catch(() => [] as string[]));
    const result = spawnSync(process.execPath, [CLI, 'bench', '--agent', agent, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
    const created = (await readdir(benchRoot())).filter(name => !before.has(name));
    assert.equal(created.length, 1, result.stderr);
    return { path: join(benchRoot(), created[0]!, 'report.json'), status: result.status, stdout: result.stdout };
  };
  const setArgs = (setDir: string, tasks?: string): string[] => { const result = tool(['args', setDir, ...(tasks ? ['--tasks', tasks] : [])]); assert.equal(result.status, 0, result.stderr); return result.stdout.trim().split(' '); };
  assert.equal(tool(['generate', 'tight-budget', '--set', 'dev', '--count', '3', '--difficulty', '1', '--out', join(dir, 'dev')]).status, 0);
  const dev: string[] = [];
  for (const model of [OPUS, SONNET, HAIKU]) {
    const run = await bench('claude-code', [...setArgs(join(dir, 'dev')), '--mirror', 'off'], { PN_FAKE_MODEL: model });
    assert.equal(run.status, 0); dev.push(run.path);
  }
  const declarationPath = join(declarations, 'tight-budget-round-1.declaration.json');
  const declare = (reports: string[]) => tool(['declare', '--family', 'tight-budget', '--round', '1', '--difficulty', '1', '--dev', reports.join(','), '--out', declarationPath]);
  return { env, tool, git, bench, setArgs, dev, declare, declarationPath, declarations, repo };
}

test('a round is declared from its development benches and the committed rounds before it; its held-out set needs the declaration committed and pushed; the gate refuses changed set files', { timeout: 600_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-round-'));
  try {
    const { tool, git, bench, setArgs, dev, declare, declarationPath, declarations } = await developedRound(dir);
    const [devOpus, devSonnet, devHaiku] = dev as [string, string, string];
    // A development bench that left its mirror to `auto` is refused: a round names its mirror.
    const auto = await bench('claude-code', setArgs(join(dir, 'dev')), { PN_FAKE_MODEL: SONNET });
    let refused = declare([devOpus, auto.path, devHaiku]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /--mirror auto; a round names its mirror/);
    // A report relabelled to another model without the agent's output is refused by verification.
    const relabelled = join(dir, 'relabelled'); await cp(join(devSonnet, '..'), relabelled, { recursive: true });
    const value = await json(join(relabelled, 'report.json')); value.runs[1].client.model = OPUS; await writeFile(join(relabelled, 'report.json'), JSON.stringify(value));
    refused = declare([devOpus, join(relabelled, 'report.json'), devHaiku]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run tight-budget-2-s1-r1: the report names model claude-opus-5-5, but the agent's own output names claude-sonnet-5-5/);
    // Committed earlier rounds count before this one: a declared round 87, a gated one its ledger.
    await writeFile(join(declarations, 'repair-round-1.declaration.json'), '{}\n');
    await writeFile(join(declarations, 'injection-round-1.declaration.json'), '{}\n');
    await writeFile(join(declarations, 'injection-round1.ledger.json'), JSON.stringify({ schema: 'practonaut.challenge-ledger/1', spent: { total: 90 } }));
    git('add', '.'); git('commit', '-m', 'earlier rounds'); git('push');
    // The reports in any order: the tiers are ordered by capability.
    const declared = declare([devHaiku, devOpus, devSonnet]);
    assert.equal(declared.status, 0, declared.stderr);
    assert.match(declared.stdout, /gate pair claude-opus-5-5 \(strongest\) vs claude-haiku-5-5 \(weakest\), fixed by the capability order/);
    assert.match(declared.stdout, /release runs before this round: 212 \(35 \+ 90 injection-round-1\.declaration\.json \+ 87 repair-round-1\.declaration\.json\)/);
    const declaration = validateDeclaration(await json(declarationPath));
    assert.deepEqual([declaration.ladder, declaration.pair, declaration.development.seeds, declaration.development.spent, declaration.development.order], [[OPUS, SONNET, HAIKU], { strongest: OPUS, weakest: HAIKU }, [1, 2, 3], 12, 'consistent']);
    assert.deepEqual(declaration.bench, { mirror: 'off', timeoutSeconds: 600, maxActions: 50, checks: null });
    // The held-out set: only from the committed and pushed declaration.
    refused = tool(['generate', 'tight-budget', '--set', 'heldout', '--round', '1', '--seed', '1000000', '--out', join(dir, 'x')]);
    assert.equal(refused.status, 1); assert.match(refused.stderr, /a held-out set is generated from its round declaration/);
    const generate = () => tool(['generate', 'tight-budget', '--set', 'heldout', '--declaration', declarationPath, '--out', join(dir, 'heldout'), '--force']);
    refused = generate(); assert.equal(refused.status, 2); assert.match(refused.stderr, /tight-budget-round-1\.declaration\.json is not committed; commit and push it first/);
    git('add', '.'); git('commit', '-m', 'declare tight-budget round 1');
    refused = generate(); assert.equal(refused.status, 2); assert.match(refused.stderr, /which no remote-tracking branch contains; push it first/);
    git('push');
    const made = generate();
    assert.equal(made.status, 0, made.stderr);
    const seeds = heldOutSeeds(declaration), manifest = await json(join(dir, 'heldout', 'instances.json'));
    assert.deepEqual(manifest.seeds, seeds);
    assert.deepEqual(manifest.declaration, { sha256: declarationHash(declaration), commit: git('rev-parse', 'HEAD') });
    for (const entry of manifest.instances) assert.equal(entry.oracle.sha256, sha256(await readFile(join(dir, 'heldout', 'oracles', `${entry.taskId}.json`))));
    // The held-out arguments carry the declared settings and --stop-on-infra; the printed commands the
    // environment and each ladder model (second review S-1).
    assert.ok(manifest.bench.args.join(' ').endsWith('--seed-list 1 --repeats 1 --mirror off --max-actions 50 --timeout 600 --stop-on-infra'));
    assert.match(made.stdout, /DISABLE_AUTOUPDATER=1 ANTHROPIC_MODEL=claude-opus-5-5 node src\/cli\/main\.ts bench --agent claude-code --world /);
    const first = manifest.instances[0].taskId as string, second = manifest.instances[1].taskId as string;
    assert.deepEqual(setArgs(join(dir, 'heldout'), `${first},${second}`).slice(0, 6), ['--world', join(dir, 'heldout', 'world'), '--tasks', `${first},${second}`, '--oracle', `${join(dir, 'heldout', 'oracles', `${first}.json`)},${join(dir, 'heldout', 'oracles', `${second}.json`)}`]);

    // Changed set files are refused before any report is read (the report paths do not exist).
    let gates = 0;
    const changedSet = async (change: (setDir: string) => Promise<void>): Promise<ReturnType<typeof tool>> => {
      const copy = join(dir, `set-${++gates}`); await cp(join(dir, 'heldout'), copy, { recursive: true }); await change(copy);
      return tool(['gate', '--preflight', '--declaration', declarationPath, '--set', copy, '--dev', dev.join(','), '--oracle', 'o', '--random', 'r']);
    };
    refused = await changedSet(async copy => { const path = join(copy, 'oracles', `${first}.json`), oracle = await json(path); oracle.nearMisses = []; await writeFile(path, JSON.stringify(oracle, null, 2) + '\n'); });
    assert.equal(refused.status, 2); assert.match(refused.stderr, new RegExp(`oracles/${first}\\.json does not match the SHA-256 instances\\.json records`));
    refused = await changedSet(async copy => {
      const path = join(copy, 'oracles', `${first}.json`), oracle = await json(path); oracle.nearMisses = []; const text = JSON.stringify(oracle, null, 2) + '\n'; await writeFile(path, text);
      const changed = await json(join(copy, 'instances.json')); changed.instances[0].oracle = { sha256: sha256(text), nearMisses: 0 }; await writeFile(join(copy, 'instances.json'), JSON.stringify(changed));
    });
    assert.equal(refused.status, 2); assert.match(refused.stderr, new RegExp(`oracles/${first}\\.json is not the regenerated reference and near misses`));
    refused = await changedSet(async copy => { const path = join(copy, 'world', 'world.json'), world = await json(path); world.tasks[0].limits = { actions: 40 }; await writeFile(path, JSON.stringify(world)); });
    assert.equal(refused.status, 2); assert.match(refused.stderr, /world\/world\.json is not the world the generator makes from the declaration/);
    // A declaration changed after the set was made: refused, and a second committed version too.
    await writeFile(declarationPath, (await readFile(declarationPath, 'utf8')).replace('"round": 1', '"round":  1'));
    refused = tool(['gate', '--preflight', '--declaration', declarationPath, '--set', join(dir, 'heldout'), '--dev', dev.join(','), '--oracle', 'o', '--random', 'r']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /has changes that are not committed/);
    git('add', '.'); git('commit', '-m', 'respace'); git('push');
    refused = tool(['gate', '--preflight', '--declaration', declarationPath, '--set', join(dir, 'heldout'), '--dev', dev.join(','), '--oracle', 'o', '--random', 'r']);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the declaration has 2 versions in git; a round's declaration is committed once and never changed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the whole round: preflight, ladder benches (one stopped by a usage limit and resumed), the gate and its ledger; a hidden rerun refuses the round', { timeout: 3_000_000, skip: process.env.PN_CHALLENGE_ROUND === '1' ? false : 'about twenty minutes; run with PN_CHALLENGE_ROUND=1' }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-gate-'));
  try {
    const { tool, git, bench, setArgs, dev, declare, declarationPath, declarations } = await developedRound(dir);
    assert.equal(declare(dev).status, 0);
    git('add', '.'); git('commit', '-m', 'declare'); git('push');
    const declaration = validateDeclaration(await json(declarationPath)), seeds = heldOutSeeds(declaration);
    assert.equal(tool(['generate', 'tight-budget', '--set', 'heldout', '--declaration', declarationPath, '--out', join(dir, 'heldout')]).status, 0);
    const heldArgs = setArgs(join(dir, 'heldout'));
    const oracle = await bench('oracle', heldArgs), random = await bench('random', heldArgs);
    assert.deepEqual([oracle.status, random.status], [0, 0]);
    const base = ['--declaration', declarationPath, '--set', join(dir, 'heldout'), '--dev', dev.join(','), '--oracle', oracle.path, '--random', random.path];
    const preflight = tool(['gate', '--preflight', ...base]);
    assert.equal(preflight.status, 0, preflight.stderr);
    assert.match(preflight.stdout, /preflight passed — the ladder may start/);
    assert.match(preflight.stdout, /oracle 26\/26, random 0\/26/);
    // Opus: the stand-in hits the usage limit after 10 starts; the bench stops and names the rest.
    const state = join(dir, 'state'); await mkdir(state);
    const stopped = await bench('claude-code', heldArgs, { PN_FAKE_MODEL: OPUS, PN_FAKE_LIMIT_AFTER: '10', PN_FAKE_STATE: state });
    assert.equal(stopped.status, 75);
    const rest = /--tasks (\S+)/.exec(stopped.stdout)![1]!;
    assert.equal(rest.split(',').length, 16);
    const resumed = await bench('claude-code', setArgs(join(dir, 'heldout'), rest), { PN_FAKE_MODEL: OPUS });
    assert.equal(resumed.status, 0);
    const ladder = [stopped.path, resumed.path];
    for (const model of [SONNET, HAIKU]) { const run = await bench('claude-code', heldArgs, { PN_FAKE_MODEL: model }); assert.equal(run.status, 0); ladder.push(run.path); }
    const out = join(declarations, 'tight-budget-round1.md');
    const gated = tool(['gate', ...base, '--ladder', ladder.join(','), '--out', out]);
    assert.equal(gated.status, 0, gated.stderr);
    assert.match(gated.stdout, /tight-budget round 1: does not pass; 88 model runs spent/);
    const markdown = await readFile(out, 'utf8');
    assert.match(markdown, /\| oracle \| 26\/26 \| oracle passes 100 % \| yes \|/);
    assert.match(markdown, /\| near-misses \| (\d+)\/\1 fail \| every near miss fails \| yes \|/);
    assert.match(markdown, new RegExp(`\\| Held-out instances \\| 26 \\(generator seeds ${seeds[0]}–${seeds.at(-1)}, derived from the development runs`));
    // 79 held-out runs (the limited one and its rerun) + 9 development runs.
    assert.match(markdown, /\| budget \| 88 model runs spent \(79 held-out \+ 9 development\); release 123 of 500 \|/);
    assert.match(markdown, /\| ladder \(claude-code\) \| `claude-opus-5-5` \| 0\/26 \|.*\| 0 \| 0 \| 0 \| 2 \|/);
    const ledger = await json(join(declarations, 'tight-budget-round1.ledger.json'));
    assert.deepEqual([ledger.schema, ledger.spent, ledger.releaseRuns, ledger.heldOutRuns.length], ['practonaut.challenge-ledger/1', { development: 9, heldOut: 79, total: 88 }, 123, 79]);
    // A later run of one task for Haiku in the same bench folder (best-of-N): the gate finds it.
    const first = (await json(join(dir, 'heldout', 'instances.json'))).instances[0].taskId as string;
    await bench('claude-code', setArgs(join(dir, 'heldout'), first), { PN_FAKE_MODEL: HAIKU });
    const refused = tool(['gate', ...base, '--ladder', ladder.join(','), '--out', join(dir, 'again.md')]);
    assert.equal(refused.status, 2); assert.match(refused.stderr, new RegExp(`task ${first} was run more than once for claude-haiku-5-5`));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

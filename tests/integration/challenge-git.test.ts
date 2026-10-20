// A round file counts only as git holds it (PADR-0040, second review B-B): committed, unchanged in the
// working tree, contained in a remote-tracking branch. The release ledger as declare and gate read it
// (PADR-0044 decision 8): the committed copy pushed, the local ledger holding nothing more, every
// committed version a prefix of the current one; and the scan for model runs outside the ledger.
// A temporary repository with a local bare remote stands in for the project's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { commitPushed, committedFiles, declarationAtCommit, declarationCommit, declarationVersions, DeclarationGitError } from '../../src/challenge/git.ts';
import { pushedLedger, scanOutside, setIdentities, writeSet } from '../../src/challenge/files.ts';
import { generateSet } from '../../src/challenge/build.ts';
import { packWorld } from '../../src/package/index.ts';
import { canonicalJson, sha256Hex } from '../../src/canonical/index.ts';
import { pathToFileURL } from 'node:url';
import { isolateGit } from '../support/git-config.ts';
import { headerLine, nextLine, parseLedger, type StartBody } from '../../src/challenge/ledger.ts';

// Git with this file's configuration only, never the developer's or the CI runner's.
isolateGit();

test('a declaration is used only committed, unchanged and pushed; its versions are counted', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-declaration-git-'));
  try {
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=Practonaut Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
      return result.stdout.trim();
    };
    const remote = join(dir, 'remote.git'), work = join(dir, 'work'), folder = join(work, 'docs', 'benchmarks', 'challenge');
    await mkdir(remote); git(remote, 'init', '--bare');
    await mkdir(folder, { recursive: true }); git(work, 'init');
    const file = join(folder, 'repair-round-1.declaration.json');
    const refused = (message: RegExp): void => assert.throws(() => declarationCommit(file), (error: unknown) => error instanceof DeclarationGitError && message.test(error.message), message.source);
    await writeFile(file, '{"round":1}\n');
    refused(/repair-round-1\.declaration\.json is not committed; commit and push it first/);
    git(work, 'add', '.');
    refused(/has changes that are not committed|has no commit/);
    git(work, 'commit', '-m', 'declare');
    refused(/is committed in [0-9a-f]{12}, which no remote-tracking branch contains; push it first/);
    git(work, 'remote', 'add', 'origin', remote); git(work, 'push', '-u', 'origin', 'main');
    const pushed = declarationCommit(file);
    assert.deepEqual(pushed, { commit: git(work, 'rev-parse', 'HEAD'), versions: 1 });
    // A path spelled otherwise than git's top level names the same file (Windows spells the temporary
    // folder with an 8.3 short name; a case-insensitive disk takes another letter case).
    const respelled = join(dirname(dir), basename(dir).toUpperCase(), 'work', 'docs', 'benchmarks', 'challenge', 'repair-round-1.declaration.json');
    if (existsSync(respelled)) {
      assert.deepEqual(declarationCommit(respelled), pushed);
      assert.deepEqual(declarationVersions(respelled).map(version => version.commit), [pushed.commit]);
      assert.equal(declarationAtCommit(respelled, pushed.commit), '{"round":1}\n');
    }
    assert.deepEqual(committedFiles(folder), ['repair-round-1.declaration.json']);
    // Changed in the working tree, staged or not: refused.
    await writeFile(file, '{"round":2}\n');
    refused(/has changes that are not committed/);
    git(work, 'add', '.');
    refused(/has changes that are not committed/);
    // A second version, committed and pushed: usable, and the gate sees two versions.
    git(work, 'commit', '-m', 'redeclare'); git(work, 'push');
    assert.equal(declarationCommit(file).versions, 2);
    // Every version, newest first, and the content of each (third review).
    const versions = declarationVersions(file);
    assert.deepEqual(versions.map(version => version.commit), [git(work, 'rev-parse', 'HEAD'), pushed.commit]);
    assert.ok(versions.every(version => /^\d{4}-\d{2}-\d{2}T/.test(version.date)));
    assert.equal(declarationAtCommit(file, pushed.commit), '{"round":1}\n');
    assert.equal(declarationAtCommit(file, '0'.repeat(40)), null);
    assert.equal(commitPushed(file, pushed.commit), true);
    git(work, 'commit', '--allow-empty', '-m', 'local only');
    assert.equal(commitPushed(file, git(work, 'rev-parse', 'HEAD')), false);
    // Outside any repository.
    const loose = join(dir, 'loose'); await mkdir(loose); await writeFile(join(loose, 'repair-round-1.declaration.json'), '{}');
    assert.throws(() => declarationCommit(join(loose, 'repair-round-1.declaration.json')), /is not in a git repository; commit and push it first/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the release ledger as declare and gate read it: committed and pushed, nothing more in the local one, every committed version a prefix; never in a shallow clone (review: r2-ledger-history-local-refs)', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-ledger-git-'));
  try {
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=Practonaut Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
      return result.stdout.trim();
    };
    const remote = join(dir, 'remote.git'), work = join(dir, 'work'), folder = join(work, 'docs', 'benchmarks', 'challenge', '0.3.0');
    await mkdir(remote); git(remote, 'init', '--bare');
    await mkdir(folder, { recursive: true }); git(work, 'init'); git(work, 'remote', 'add', 'origin', remote);
    const start = (index: number, bench = '20261102T100000Z-0001'): StartBody => ({ kind: 'start', purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: 'claude-opus-5-5', agent: 'claude-code', bench, run: `connect-s${index}-r1`, world: 'f'.repeat(64), instance: 'e'.repeat(64) });
    let ledger = parseLedger(headerLine());
    const append = (body: StartBody): string => { ledger = parseLedger(ledger.text + nextLine(ledger, body).line); return ledger.text; };
    const paths = { local: join(dir, 'local.jsonl'), committed: join(folder, 'release-ledger.jsonl') };
    const code = async (expected: string, message?: RegExp): Promise<void> => { await assert.rejects(pushedLedger(paths), (error: Error & { code?: string }) => error.code === expected && (!message || message.test(error.message)), expected); };
    await writeFile(paths.local, append(start(1)));
    await code('ledger_not_committed', /there is no committed release ledger/);
    await writeFile(paths.committed, ledger.text);
    await code('not_committed', /is not committed/);
    git(work, 'add', '.'); git(work, 'commit', '-m', 'ledger 1');
    await code('not_committed', /which no remote-tracking branch contains/);
    git(work, 'push', '-u', 'origin', 'main');
    assert.deepEqual((await pushedLedger(paths)).versions.map(version => version.records), [2]);
    // The local ledger moves on: refused until the committed copy has it too.
    await writeFile(paths.local, append(start(2)));
    await code('ledger_not_committed', /holds 1 records the committed one lacks/);
    await writeFile(paths.committed, ledger.text); git(work, 'add', '.'); git(work, 'commit', '-m', 'ledger 2'); git(work, 'push');
    const read = await pushedLedger(paths);
    assert.deepEqual([read.ledger.records.length, read.versions.map(version => version.records)], [3, [3, 2]]);
    // A committed copy that is not the local one's prefix, and a history whose older version is not a prefix.
    await writeFile(paths.local, headerLine());
    await code('ledger_diverged');
    let other = parseLedger(headerLine());
    other = parseLedger(other.text + nextLine(other, start(9)).line);
    await writeFile(paths.local, other.text); await writeFile(paths.committed, other.text);
    git(work, 'add', '.'); git(work, 'commit', '-m', 'rewrite'); git(work, 'push');
    await code('ledger_rewritten', /is not a prefix of the current one/);
    // A shallow clone cannot show every version (review: r2-ledger-history-local-refs): refused.
    const shallow = join(dir, 'shallow');
    git(dir, 'clone', '--quiet', '--depth', '1', pathToFileURL(remote).href, shallow);
    await code('ledger_rewritten');
    await assert.rejects(pushedLedger({ local: paths.local, committed: join(shallow, 'docs', 'benchmarks', 'challenge', '0.3.0', 'release-ledger.jsonl') }), (error: Error & { code?: string }) => error.code === 'shallow_clone' && /shallow clone/.test(error.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('runs outside the ledger are found by task identity on any world: a dev set of the same seeds is the same instances; a bench folder without a world by task id (review: r2-round-instances-by-world-hash)', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-ledger-scan-'));
  try {
    // The round's pre-probe set, the same seeds generated as a tuning set (another world id), and other seeds.
    const round = generateSet('repair', [1, 2], 1, 'practonaut-r1-probe1'), dev = generateSet('repair', [1, 2], 1, 'dev'), other = generateSet('repair', [8], 1, 'dev'), harder = generateSet('repair', [1], 2, 'dev');
    const tasks = ['repair-1', 'repair-2'], identities = setIdentities(round, tasks);
    assert.deepEqual(setIdentities(dev, tasks), identities);
    assert.notEqual(canonicalJson(dev.world), canonicalJson(round.world));
    const root = join(dir, 'bench'), bench = (name: string) => join(root, name);
    const packed = async (set: typeof round, name: string): Promise<Buffer> => { await writeSet(set, join(dir, name), { family: 'repair', set: 'dev', difficulty: '1', seeds: set === other ? [8] : set === harder ? [1] : [1, 2] }); return packWorld(join(dir, name, 'world')); };
    const worlds = { round: await packed(round, 'round'), dev: await packed(dev, 'dev'), other: await packed(other, 'other'), harder: await packed(harder, 'harder') };
    assert.notEqual(setIdentities(harder, ['repair-1'])[0], identities[0], 'the same task id at another difficulty is another instance');
    // [bench, run, agent output, world package in the folder ('tampered': a report binding another SHA-256)]
    for (const [name, run, stdout, world] of [
      ['20261102T100000Z-0001', 'repair-1-s1-r1', true, 'round'], ['20261102T100000Z-0002', 'repair-1-s1-r1', true, 'round'], ['20261102T100000Z-0003', 'repair-1-s1-r1', false, 'round'],
      ['20261102T100000Z-0004', 'repair-2-s1-r1', true, 'dev'], ['20261102T100000Z-0005', 'repair-8-s1-r1', true, 'other'], ['20261102T100000Z-0006', 'repair-2-s1-r1', true, null],
      ['20261102T100000Z-0007', 'repair-1-s1-r1', true, 'tampered'], ['20261102T100000Z-0008', 'repair-1-s1-r1', true, 'harder'],
    ] as const) {
      await mkdir(join(bench(name), run), { recursive: true });
      if (stdout) await writeFile(join(bench(name), run, 'agent.stdout'), '{}\n');
      if (world === null) continue;
      const bytes = worlds[world === 'tampered' ? 'other' : world];
      await writeFile(join(bench(name), 'world.pnworld'), bytes);
      await writeFile(join(bench(name), 'report.json'), JSON.stringify({ environment: { world: { contentHash: 'a'.repeat(64), package: { path: 'world.pnworld', sha256: world === 'tampered' ? 'b'.repeat(64) : sha256Hex(bytes) } } } }));
    }
    const body: StartBody = { kind: 'start', purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: 'claude-opus-5-5', agent: 'claude-code', bench: '20261102T100000Z-0001', run: 'repair-1-s1-r1', world: 'f'.repeat(64), instance: identities[0]! };
    const listed = parseLedger(headerLine() + nextLine(parseLedger(headerLine()), body).line);
    // 0001 is in the ledger; 0003 has no agent output; 0004 runs the round's instance on the dev world;
    // 0005 another instance; 0006 has no report (by task id); 0007's world does not match its binding (by
    // task id); 0008 is another instance under the same task id.
    assert.deepEqual(await scanOutside([root], { identities: new Set(identities), tasks: new Set(tasks) }, listed), [
      { bench: '20261102T100000Z-0002', run: 'repair-1-s1-r1' }, { bench: '20261102T100000Z-0004', run: 'repair-2-s1-r1' },
      { bench: '20261102T100000Z-0006', run: 'repair-2-s1-r1' }, { bench: '20261102T100000Z-0007', run: 'repair-1-s1-r1' },
    ]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a committed ledger version on a merged side branch or a pushed unmerged branch is checked too (review: budget-ledger-history-simplified)', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-ledger-history-'));
  try {
    const git = (cwd: string, ...args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=Practonaut Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
      return result.stdout.trim();
    };
    const remote = join(dir, 'remote.git'), work = join(dir, 'work'), folder = join(work, 'docs', 'benchmarks', 'challenge', '0.3.0');
    await mkdir(remote); git(remote, 'init', '--bare');
    await mkdir(folder, { recursive: true }); git(work, 'init'); git(work, 'remote', 'add', 'origin', remote);
    const start = (index: number): StartBody => ({ kind: 'start', purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: 'claude-opus-5-5', agent: 'claude-code', bench: '20261102T100000Z-0001', run: `connect-s${index}-r1`, world: 'f'.repeat(64), instance: 'e'.repeat(64) });
    const append = (text: string, index: number): string => text + nextLine(parseLedger(text), start(index)).line;
    const paths = { local: join(dir, 'local.jsonl'), committed: join(folder, 'release-ledger.jsonl') };
    const commitLedger = async (text: string, message: string): Promise<void> => { await writeFile(paths.committed, text); git(work, 'add', '.'); git(work, 'commit', '-m', message); };
    const one = append(headerLine(), 1);
    await commitLedger(one, 'ledger 1'); git(work, 'push', '-u', 'origin', 'main');
    // A side branch appends its own record and is pushed; main appends another and merges the side
    // branch, resolving the ledger to its own side, and the side branch is deleted everywhere. The
    // side's pushed record is gone from main's simplified history; only the merge's second parent has it.
    git(work, 'switch', '-c', 'side'); await commitLedger(append(one, 2), 'side record'); git(work, 'push', '-u', 'origin', 'side');
    git(work, 'switch', 'main'); const mine = append(one, 3); await commitLedger(mine, 'main record');
    git(work, 'merge', '-s', 'ours', '--no-edit', 'side'); git(work, 'push');
    git(work, 'push', 'origin', '--delete', 'side'); git(work, 'branch', '-D', 'side'); git(work, 'fetch', '--prune');
    await writeFile(paths.local, mine);
    await assert.rejects(pushedLedger(paths), (error: Error & { code?: string }) => error.code === 'ledger_rewritten');
    // Without the merge: a pushed branch that is not merged holds a diverged version as well.
    const fresh = join(dir, 'fresh'), freshFolder = join(fresh, 'docs', 'benchmarks', 'challenge', '0.3.0'), freshRemote = join(dir, 'fresh.git');
    await mkdir(freshRemote); git(freshRemote, 'init', '--bare');
    await mkdir(freshFolder, { recursive: true }); git(fresh, 'init'); git(fresh, 'remote', 'add', 'origin', freshRemote);
    const freshPaths = { local: join(dir, 'fresh.jsonl'), committed: join(freshFolder, 'release-ledger.jsonl') };
    const commitFresh = async (text: string, message: string): Promise<void> => { await writeFile(freshPaths.committed, text); git(fresh, 'add', '.'); git(fresh, 'commit', '-m', message); };
    await commitFresh(one, 'ledger 1'); git(fresh, 'push', '-u', 'origin', 'main');
    git(fresh, 'switch', '-c', 'unmerged'); await commitFresh(append(one, 2), 'side record'); git(fresh, 'push', '-u', 'origin', 'unmerged');
    git(fresh, 'switch', 'main'); await commitFresh(mine, 'main record'); git(fresh, 'push');
    await writeFile(freshPaths.local, mine);
    await assert.rejects(pushedLedger(freshPaths), (error: Error & { code?: string }) => error.code === 'ledger_rewritten');
    // Once the pushed versions agree (the side branch deleted from the remote), the ledger reads.
    git(fresh, 'push', 'origin', '--delete', 'unmerged'); git(fresh, 'fetch', '--prune');
    assert.equal((await pushedLedger(freshPaths)).ledger.records.length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

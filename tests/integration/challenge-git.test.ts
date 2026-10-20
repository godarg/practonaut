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
import { pushedLedger, scanOutside } from '../../src/challenge/files.ts';
import { headerLine, nextLine, parseLedger, type StartBody } from '../../src/challenge/ledger.ts';

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

test('the release ledger as declare and gate read it: committed and pushed, nothing more in the local one, every committed version a prefix; runs outside it are found', { timeout: 120_000 }, async () => {
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
    const start = (index: number, bench = '20261102T100000Z-0001'): StartBody => ({ kind: 'start', purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: 'claude-opus-5-5', agent: 'claude-code', bench, run: `connect-s${index}-r1`, world: 'f'.repeat(64) });
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

    // Model-run folders of the round's tasks without a start entry (built-in runs have no agent.stdout).
    const root = join(dir, 'bench'), bench = (name: string) => join(root, name);
    for (const [name, run, stdout, world] of [['20261102T100000Z-0001', 'connect-s1-r1', true, 'a'], ['20261102T100000Z-0002', 'connect-s1-r1', true, 'a'], ['20261102T100000Z-0003', 'connect-s1-r1', false, 'a'], ['20261102T100000Z-0004', 'connect-s1-r1', true, 'b'], ['20261102T100000Z-0005', 'decision-s1-r1', true, null]] as const) {
      await mkdir(join(bench(name), run), { recursive: true });
      if (stdout) await writeFile(join(bench(name), run, 'agent.stdout'), '{}\n');
      if (world) await writeFile(join(bench(name), 'report.json'), JSON.stringify({ environment: { world: { contentHash: world.repeat(64) } } }));
    }
    const listed = parseLedger(headerLine() + nextLine(parseLedger(headerLine()), start(1)).line);
    // 0001 is in the ledger; 0003 has no agent output; 0004 is another world; 0005 has no report and counts.
    assert.deepEqual(await scanOutside([root], { worlds: ['a'.repeat(64)], tasks: ['connect', 'decision'] }, listed), [{ bench: '20261102T100000Z-0002', run: 'connect-s1-r1' }, { bench: '20261102T100000Z-0005', run: 'decision-s1-r1' }]);
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
    const start = (index: number): StartBody => ({ kind: 'start', purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: 'claude-opus-5-5', agent: 'claude-code', bench: '20261102T100000Z-0001', run: `connect-s${index}-r1`, world: 'f'.repeat(64) });
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

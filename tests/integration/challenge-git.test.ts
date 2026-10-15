// A round declaration counts only as git holds it (PADR-0040, second review B-B): committed, unchanged
// in the working tree, contained in a remote-tracking branch; at the gate in exactly one version.
// A temporary repository with a local bare remote stands in for the project's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { committedFiles, declarationCommit, DeclarationGitError } from '../../src/challenge/git.ts';

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
    assert.deepEqual(committedFiles(folder), ['repair-round-1.declaration.json']);
    // Changed in the working tree, staged or not: refused.
    await writeFile(file, '{"round":2}\n');
    refused(/has changes that are not committed/);
    git(work, 'add', '.');
    refused(/has changes that are not committed/);
    // A second version, committed and pushed: usable, and the gate sees two versions.
    git(work, 'commit', '-m', 'redeclare'); git(work, 'push');
    assert.equal(declarationCommit(file).versions, 2);
    // Outside any repository.
    const loose = join(dir, 'loose'); await mkdir(loose); await writeFile(join(loose, 'repair-round-1.declaration.json'), '{}');
    assert.throws(() => declarationCommit(join(loose, 'repair-round-1.declaration.json')), /is not in a git repository; commit and push it first/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

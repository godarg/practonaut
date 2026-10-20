// Where the 0.3.0 release ledger lives and how it starts (PADR-0042 as amended on acceptance): one local
// ledger per user and repository, keyed on the root commit, shared by every clone and worktree and found
// from every directory; `ledger init` and its refusals. A temporary repository with a local bare remote
// (tests/support/challenge-project.ts); no language model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { countLedger, parseLedger } from '../../src/challenge/ledger.ts';
import { counted, OPUS, project } from '../support/challenge-project.ts';

/** The file a printed path names, by its canonical spelling (both must exist). */
const canonical = (path: string): string => realpathSync.native(path);

test('one release ledger for every clone and worktree of a repository on this machine: the second start at 799 is refused (review: budget-checkout-local-ledger)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-clones-'));
  try {
    const p = await project(dir), wt = join(dir, 'wt'), clone = join(dir, 'clone');
    // The committed ledger holds 799 counted starts, pushed.
    await mkdir(p.folder, { recursive: true }); await writeFile(join(p.folder, 'release-ledger.jsonl'), counted(799)); p.commit('ledger at 799');
    p.git('worktree', 'add', '--quiet', wt, '-b', 'second');
    p.gitIn(dir, 'clone', '--quiet', p.remote, clone);
    assert.match(p.ok(['ledger', 'init']).stdout, /a copy of the longest pushed ledger \(800 records\); every clone and worktree of this repository on this machine uses it/);
    // The worktree and the second clone find the same ledger: no second count is started there.
    for (const cwd of [wt, clone]) { const result = p.toolIn(cwd, ['ledger', 'init']); assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /ledger_exists: .* exists: this repository's local release ledger/); }
    assert.match(p.toolIn(clone, ['ledger', 'show']).stdout, /799 of 800 model runs counted/);
    // No option names another ledger.
    const named = p.tool(['ledger', 'init', '--ledger', join(dir, 'other.jsonl')]);
    assert.equal(named.status, 1); assert.match(named.stderr, /unknown or repeated option --ledger/);
    const model = { ANTHROPIC_MODEL: OPUS, PN_FAKE_MODEL: OPUS };
    // The worktree takes the 800th start; the clone's and the main checkout's next starts are refused before their clients start.
    let result = p.toolIn(wt, ['bench', '--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'connect', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(result.status, 0, result.stderr);
    result = p.toolIn(clone, ['bench', '--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'decision', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(result.status, 2); assert.match(result.stderr, /release_budget_exhausted: release 0\.3\.0 has 800 of its 800 model runs counted/);
    const second = await p.bench(['--purpose', 'example', '--', '--agent', 'claude-code', '--tasks', 'decision', '--mirror', 'off', '--timeout', '60'], model);
    assert.equal(second.status, 2); assert.match(second.stderr, /release_budget_exhausted/);
    assert.deepEqual(await p.started(), [OPUS]);
    assert.equal(countLedger(parseLedger(await readFile(p.ledgerPath, 'utf8'))).counted, 800);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('one release ledger whatever directory a command runs in and however the origin is written: keyed on the root commit, a relative origin and a fork included; a relative PRACTONAUT_HOME refused (review: relative origin URLs)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-origin-'));
  try {
    const p = await project(dir), docs = join(p.repo, 'docs');
    // A relative origin, as `git remote add origin ../remote.git` writes it.
    p.git('remote', 'set-url', 'origin', '../remote.git');
    // From a subdirectory first, then from the top level: the same ledger, so the second init is refused.
    const first = p.toolIn(docs, ['ledger', 'init']);
    assert.equal(first.status, 0, first.stderr);
    // The printed path and the expected one name the same file: compared by their canonical spelling, as
    // Windows may spell one temporary folder two ways (an 8.3 short name and its long name).
    const written = /^wrote (.+?): /.exec(first.stdout)?.[1];
    assert.ok(written !== undefined && canonical(written) === canonical(p.ledgerPath), `the ledger the top level names: ${first.stdout}`);
    assert.deepEqual(await readdir(join(p.home, 'release-ledgers')), [join(p.ledgerPath, '..').split(/[\\/]/).at(-1)], 'one ledger for the repository');
    const again = p.tool(['ledger', 'init']);
    assert.equal(again.status, 2); assert.match(again.stderr, /ledger_exists: /);
    const shown = /0 of 800 model runs counted.*\((.+)\)\s*$/.exec(p.toolIn(docs, ['ledger', 'show']).stdout)?.[1];
    assert.ok(shown !== undefined && canonical(shown) === canonical(p.ledgerPath), 'ledger show names the same file');
    // A clone whose origin is another repository with the same root (a fork) shares it: one budget.
    const fork = join(dir, 'fork');
    p.gitIn(dir, 'clone', '--quiet', p.remote, fork);
    p.gitIn(fork, 'remote', 'set-url', 'origin', 'https://example.invalid/someone/practonaut-fork.git');
    const forked = p.toolIn(fork, ['ledger', 'init']);
    assert.equal(forked.status, 2); assert.match(forked.stderr, /ledger_exists: /);
    // A data folder named relatively would be another folder, and another ledger, in every directory.
    const relative = p.toolIn(docs, ['ledger', 'init'], { PRACTONAUT_HOME: 'relative-home' });
    assert.equal(relative.status, 1, relative.stdout); assert.match(relative.stderr, /PRACTONAUT_HOME is a relative path \(relative-home\)/);
    assert.equal(existsSync(join(docs, 'relative-home')), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ledger init refuses where an earlier Practonaut kept this repository\'s ledger, and in a shallow clone (review: budget-checkout-local-ledger, r2-ledger-history-local-refs)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-elsewhere-'));
  try {
    const p = await project(dir);
    const earlier = join(p.repo, '.git', 'practonaut', 'release-ledger-0.3.0.jsonl');
    await mkdir(join(earlier, '..'), { recursive: true }); await writeFile(earlier, counted(3));
    let refused = p.tool(['ledger', 'init']);
    assert.equal(refused.status, 2, refused.stderr); assert.match(refused.stderr, /ledger_elsewhere: a release ledger of this repository exists at .*release-ledger-0\.3\.0\.jsonl, where an earlier Practonaut kept it; move it to /);
    assert.equal(existsSync(p.ledgerPath), false);
    await rm(earlier);
    await writeFile(join(p.repo, 'second.txt'), 'a second commit, so that a clone of depth 1 cuts history off\n'); p.commit('second');
    const shallow = join(dir, 'shallow');
    p.gitIn(dir, 'clone', '--quiet', '--depth', '1', pathToFileURL(p.remote).href, shallow);
    refused = p.toolIn(shallow, ['ledger', 'init']);
    assert.equal(refused.status, 2, refused.stderr); assert.match(refused.stderr, /shallow_clone: this repository is a shallow clone/);
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
    p.ok(['ledger', 'write']); p.git('switch', '--quiet', '-c', 'other'); p.git('add', '-A'); p.git('commit', '--quiet', '-m', 'ledger on another branch'); p.git('push', '--quiet', '-u', 'origin', 'other'); p.git('switch', '--quiet', 'main');
    assert.equal(existsSync(join(p.folder, 'release-ledger.jsonl')), false);
    const home = join(dir, 'home2'); await cp(p.benchRoot, join(home, 'bench'), { recursive: true });
    const made = p.tool(['ledger', 'init'], { PRACTONAUT_HOME: home });
    assert.equal(made.status, 0, made.stderr); assert.match(made.stdout, /a copy of the longest pushed ledger \(3 records\)/);
    // Pushed versions that are not one history (a branch whose ledger is not a prefix of another's): refused.
    p.git('switch', '--quiet', '-c', 'third'); await mkdir(p.folder, { recursive: true }); await writeFile(join(p.folder, 'release-ledger.jsonl'), counted(1));
    p.git('add', '-A'); p.git('commit', '--quiet', '-m', 'another ledger'); p.git('push', '--quiet', '-u', 'origin', 'third'); p.git('switch', '--quiet', 'main');
    const refusedThird = p.tool(['ledger', 'init'], { PRACTONAUT_HOME: join(dir, 'home3') });
    assert.equal(refusedThird.status, 2); assert.match(refusedThird.stderr, /ledger_diverged: the pushed versions of the release ledger are not one history/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a history with more than one root commit is refused by name on every branch, never keyed on one of its roots (review: the ledger key on a branch that merged an unrelated history)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-roots-'));
  try {
    const p = await project(dir);
    p.ok(['ledger', 'init']);
    const roots = (result: { status: number | null; stderr: string }): void => { assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /repository_roots: this repository's history has 2 root commits \([0-9a-f]{12}, [0-9a-f]{12}\)/); };
    // An unrelated history on a branch of its own: refused there and on main, which does not contain it.
    p.git('switch', '--quiet', '--orphan', 'unrelated'); await writeFile(join(p.repo, 'other.txt'), 'another history\n');
    p.git('add', 'other.txt'); p.git('commit', '--quiet', '-m', 'another root');
    roots(p.tool(['ledger', 'show']));
    p.git('switch', '--quiet', 'main');
    roots(p.tool(['ledger', 'show']));
    // A branch that merged it (the root of the merged history may sort before main's): refused as well.
    p.git('switch', '--quiet', '-c', 'merged'); p.git('merge', '--quiet', '--allow-unrelated-histories', '-m', 'merge another history', 'unrelated');
    p.git('branch', '--quiet', '-D', 'unrelated');
    roots(p.tool(['ledger', 'show']));
    p.git('switch', '--quiet', 'main');
    roots(p.tool(['ledger', 'show']));
    // Without the other history in this clone, the repository's one ledger again.
    p.git('branch', '--quiet', '-D', 'merged');
    assert.match(p.ok(['ledger', 'show']).stdout, /0 of 800 model runs counted/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('ledger init reads every pushed version under the folder git names, however --folder spells it; a folder outside the repository is refused (review: --folder spelled otherwise than the top level)', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-release-folder-'));
  try {
    const p = await project(dir);
    // Two pushed branches whose ledgers are not one history; main holds none.
    const pushed = async (branch: string, text: string): Promise<void> => {
      p.git('switch', '--quiet', '-c', branch); await mkdir(p.folder, { recursive: true }); await writeFile(join(p.folder, 'release-ledger.jsonl'), text);
      p.git('add', '-A'); p.git('commit', '--quiet', '-m', `ledger on ${branch}`); p.git('push', '--quiet', '-u', 'origin', branch); p.git('switch', '--quiet', 'main');
    };
    await pushed('other', counted(2)); await pushed('third', counted(1).replace('connect-s1-r1', 'connect-s9-r1'));
    const diverged = (result: { status: number | null; stderr: string }): void => { assert.equal(result.status, 2, result.stderr); assert.match(result.stderr, /ledger_diverged: the pushed versions of the release ledger are not one history/); };
    diverged(p.tool(['ledger', 'init']));
    // The checkout through a link (a symbolic link, a junction on Windows): another spelling of the same folder.
    const link = join(dir, 'link'); await symlink(p.repo, link, 'junction');
    diverged(p.tool(['ledger', 'init', '--folder', join(link, 'docs', 'benchmarks', 'challenge', '0.3.0')]));
    const outside = p.tool(['ledger', 'init', '--folder', join(dir, 'elsewhere')]);
    assert.equal(outside.status, 2, outside.stderr); assert.match(outside.stderr, /ledger_outside_repository: the committed ledger .* lies outside this repository/);
    assert.equal(existsSync(p.ledgerPath), false, 'no ledger was started');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// node_modules against package-lock.json: the comparison, this checkout's own installation, the
// measuring tool that must not run on a stale install, and the git hooks that reinstall after a
// merge or branch switch. Expected values are hand-written lockfiles and installs, never the
// comparison's own output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describeDrift, installationDrift, lockfileDrift, readInstalled, type LockedPackage } from '../../tools/lockfile-drift.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const tool = (name: string): string => fileURLToPath(new URL(`../../tools/${name}`, import.meta.url));

/** Writes a fixture checkout: package-lock.json, the installed package.json files and npm's record. */
function writeCheckout(root: string, locked: Record<string, LockedPackage>, installed: Record<string, string>, record?: Record<string, LockedPackage>): void {
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' }, ...locked } }));
  for (const [path, version] of Object.entries(installed)) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, 'package.json'), JSON.stringify({ name: path.split('node_modules/').pop(), version }));
  }
  if (record) writeFileSync(join(root, 'node_modules', '.package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: record }));
}

test('the comparison names every package installed at another version, missing, from another archive or no longer locked', () => {
  const locked: Record<string, LockedPackage> = {
    '': { version: '0.0.0' },
    'node_modules/playwright-core': { version: '1.64.1', integrity: 'sha512-new' },
    'node_modules/zod': { version: '4.6.7', integrity: 'sha512-zod' },
    'node_modules/a/node_modules/b': { version: '2.0.0' },
    'node_modules/@esbuild/aix-ppc64': { version: '0.28.2', optional: true },
    'node_modules/fsevents': { version: '2.3.3', devOptional: true },
    'node_modules/linked': { version: '1.0.0', link: true },
  };
  const same = { 'node_modules/playwright-core': { version: '1.64.1', integrity: 'sha512-new' }, 'node_modules/zod': { version: '4.6.7' }, 'node_modules/a/node_modules/b': { version: '2.0.0' } };
  assert.deepEqual(lockfileDrift(locked, same), [], 'optional packages of another platform and links are no drift; an unknown integrity is not compared');
  // The case of 24 to 26 October 2026: a pull bumped Playwright, node_modules kept the previous one.
  assert.deepEqual(lockfileDrift(locked, { ...same, 'node_modules/playwright-core': { version: '1.64.0', integrity: 'sha512-old' } }),
    [{ path: 'node_modules/playwright-core', locked: '1.64.1', installed: '1.64.0', reason: 'version' }]);
  assert.deepEqual(lockfileDrift(locked, { ...same, 'node_modules/zod': { version: '4.6.7', integrity: 'sha512-other' } }),
    [{ path: 'node_modules/zod', locked: '4.6.7', installed: '4.6.7', reason: 'integrity' }]);
  const { 'node_modules/a/node_modules/b': _nested, ...withoutNested } = same;
  assert.deepEqual(lockfileDrift(locked, withoutNested), [{ path: 'node_modules/a/node_modules/b', locked: '2.0.0', reason: 'missing' }]);
  assert.deepEqual(lockfileDrift(locked, { ...same, 'node_modules/left-behind': { version: '1.0.0' } }),
    [{ path: 'node_modules/left-behind', installed: '1.0.0', reason: 'extraneous' }]);
});

test('the description names the count, the first five packages and npm ci', () => {
  const drift = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => ({ path: `node_modules/${name}`, locked: '2.0.0', installed: '1.0.0', reason: 'version' as const }));
  assert.equal(describeDrift(drift), 'node_modules does not match package-lock.json (7 packages: a 1.0.0 installed, 2.0.0 locked; b 1.0.0 installed, 2.0.0 locked; c 1.0.0 installed, 2.0.0 locked; d 1.0.0 installed, 2.0.0 locked; e 1.0.0 installed, 2.0.0 locked; 2 more): run npm ci');
  assert.equal(describeDrift([{ path: 'node_modules/fast-uri', locked: '3.1.9', reason: 'missing' }]), 'node_modules does not match package-lock.json (1 package: fast-uri 3.1.9 not installed): run npm ci');
});

test('installed versions are read from the package files on disk, not from npm\'s record of its last install', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pn-lock-')));
  try {
    const entry = { version: '1.64.1', integrity: 'sha512-new' };
    // npm's record says 1.64.1, the package on disk is 1.64.0 (replaced by hand, or a partial install).
    writeCheckout(root, { 'node_modules/playwright-core': entry }, { 'node_modules/playwright-core': '1.64.0' }, { 'node_modules/playwright-core': entry });
    assert.deepEqual(readInstalled(root, { 'node_modules/playwright-core': entry }), { 'node_modules/playwright-core': { version: '1.64.0' } }, 'the record\'s integrity belongs to another version and is not taken');
    assert.deepEqual(installationDrift(root), [{ path: 'node_modules/playwright-core', locked: '1.64.1', installed: '1.64.0', reason: 'version' }]);
    // A package npm installed that the lockfile no longer names is found through the record.
    writeCheckout(root, { 'node_modules/playwright-core': entry }, { 'node_modules/playwright-core': '1.64.1', 'node_modules/dropped': '1.0.0' },
      { 'node_modules/playwright-core': entry, 'node_modules/dropped': { version: '1.0.0' } });
    assert.deepEqual(installationDrift(root), [{ path: 'node_modules/dropped', installed: '1.0.0', reason: 'extraneous' }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('this checkout\'s node_modules matches package-lock.json (after a pull that changed it: npm ci)', () => {
  const drift = installationDrift(repo);
  assert.equal(drift.length, 0, describeDrift(drift));
});

test('the headless-shell measurement refuses a stale install before it runs Playwright\'s installer or writes anything', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pn-measure-')));
  try {
    mkdirSync(join(root, 'tools'));
    for (const name of ['measure-headless-shell.ts', 'lockfile-drift.ts']) cpSync(tool(name), join(root, 'tools', name));
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    const table = join(root, 'src/cli/chromium-download.ts');
    mkdirSync(dirname(table), { recursive: true });
    const source = '// measure-headless-shell:begin\nexport const HEADLESS_SHELL = {};\n// measure-headless-shell:end\n';
    writeFileSync(table, source);
    // Playwright's installer as the tool would start it for the dry run: it leaves a mark and fails,
    // so the tool stops there and never reaches the network.
    const reached = join(root, 'installer-reached');
    const install = (version: string): void => {
      writeCheckout(root, { 'node_modules/playwright-core': { version: '1.64.1' } }, { 'node_modules/playwright-core': version });
      writeFileSync(join(root, 'node_modules/playwright-core/browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '1', browserVersion: '1.0' }, { name: 'winldd', revision: '1' }] }));
      writeFileSync(join(root, 'node_modules/playwright-core/cli.js'), `require('node:fs').writeFileSync(${JSON.stringify(reached)}, ''); process.exitCode = 1;`);
    };
    const run = () => spawnSync(process.execPath, [join(root, 'tools/measure-headless-shell.ts'), '--write'], { encoding: 'utf8', timeout: 20_000 });

    install('1.64.0');
    const stale = run();
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(stale.stderr, /playwright-core 1\.64\.0 installed, 1\.64\.1 locked\): run npm ci first; nothing measured, nothing written/);
    assert.equal(existsSync(reached), false, 'Playwright\'s installer was started on a stale install');
    assert.equal(readFileSync(table, 'utf8'), source);

    // Control: on a matching install the same tool goes on to Playwright's installer.
    install('1.64.1');
    const current = run();
    assert.notEqual(current.status, 0);
    assert.equal(existsSync(reached), true, current.stdout + current.stderr);
    assert.equal(readFileSync(table, 'utf8'), source);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the git hooks run npm ci when a merge or branch switch leaves node_modules stale, and only then', {
  skip: process.platform === 'win32' && 'the hooks are bash scripts that Git for Windows runs; this test drives git and a fake npm on POSIX',
}, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pn-hooks-')));
  try {
    const work = join(root, 'checkout'), bin = join(root, 'bin'), log = join(root, 'npm.log');
    mkdirSync(join(work, 'tools'), { recursive: true }); mkdirSync(bin);
    cpSync(tool('githooks'), join(work, 'tools/githooks'), { recursive: true });
    cpSync(tool('lockfile-drift.ts'), join(work, 'tools/lockfile-drift.ts'));
    writeFileSync(join(work, 'package.json'), '{"type":"module"}');
    writeFileSync(join(work, '.gitignore'), 'node_modules/\n');
    const lock = (version: string) => writeFileSync(join(work, 'package-lock.json'), JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { '': { name: 'fixture' }, 'node_modules/left-pad': { version } } }));
    mkdirSync(join(work, 'node_modules/left-pad'), { recursive: true });
    writeFileSync(join(work, 'node_modules/left-pad/package.json'), JSON.stringify({ name: 'left-pad', version: '1.0.0' }));
    // A stand-in for npm at the process boundary: it logs its arguments and installs what the lockfile pins.
    writeFileSync(join(bin, 'npm'), `#!/usr/bin/env bash\necho "$*" >> ${JSON.stringify(log)}\nnode -e 'const fs=require("node:fs");for(const [p,e] of Object.entries(JSON.parse(fs.readFileSync("package-lock.json","utf8")).packages)){if(!p)continue;fs.mkdirSync(p,{recursive:true});fs.writeFileSync(p+"/package.json",JSON.stringify({version:e.version}))}'\n`);
    chmodSync(join(bin, 'npm'), 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: '1', PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter) };
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_GLOBAL']) delete env[name];
    const git = (...args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: work, env, encoding: 'utf8', timeout: 30_000 });
      assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stdout}${result.stderr}`);
      return result.stdout + result.stderr;
    };
    const calls = (): string[] => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];

    git('init', '-q', '-b', 'main');
    git('config', 'core.hooksPath', 'tools/githooks');
    lock('1.0.0');
    git('add', '-A'); git('commit', '-q', '--no-verify', '-m', 'lock 1.0.0');
    git('checkout', '-q', '-b', 'bump');
    lock('1.0.1'); git('commit', '-q', '--no-verify', '-am', 'lock 1.0.1');
    // Back on main the lockfile pins what is installed: a branch switch alone installs nothing.
    git('checkout', '-q', 'main');
    assert.deepEqual(calls(), []);

    // A pull is a fetch and this merge: the lockfile moves to 1.0.1, node_modules holds 1.0.0.
    const merged = git('merge', '-q', '--ff-only', 'bump');
    assert.deepEqual(calls(), ['ci --ignore-scripts --no-audit --no-fund']);
    assert.match(merged, /post-merge: node_modules does not match package-lock\.json \(1 package: left-pad 1\.0\.0 installed, 1\.0\.1 locked\)/);
    assert.equal(JSON.parse(readFileSync(join(work, 'node_modules/left-pad/package.json'), 'utf8')).version, '1.0.1');

    // A file checkout never installs, even when it makes node_modules stale.
    git('checkout', '-q', 'HEAD~1', '--', 'package-lock.json');
    assert.equal(calls().length, 1);
    git('checkout', '-q', 'HEAD', '--', 'package-lock.json');

    // A branch switch to a commit that pins another version does.
    git('checkout', '-q', '--detach', 'HEAD~1');
    assert.deepEqual(calls(), ['ci --ignore-scripts --no-audit --no-fund', 'ci --ignore-scripts --no-audit --no-fund']);

    // A checkout without node_modules (a new worktree) is told to bootstrap, not installed into.
    rmSync(join(work, 'node_modules'), { recursive: true });
    const fresh = git('checkout', '-q', 'main');
    assert.equal(calls().length, 2);
    assert.match(fresh, /post-checkout: no node_modules in this checkout: run npm run bootstrap/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

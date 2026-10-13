// Cross-platform private files and data paths. Windows and Linux are simulated by injecting the
// platform identity; only the host platform's real filesystem behaviour is exercised end to end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePrivateDirectory, isPrivateDirectory, isPrivateFile, ownedByCaller, pathParts, posixPermissions, PrivateFsError, type FsIdentity } from '../../src/platform/private-fs.ts';
import { dataPaths, practonautHome, resolvedDataPaths } from '../../src/platform/paths.ts';

const win32: FsIdentity = { platform: 'win32', uid: undefined };
const linux: FsIdentity = { platform: 'linux', uid: 1000 };
// What Node reports on Windows: uid 0, no POSIX bits that mean anything, regular nlink.
const stats = (kind: 'file' | 'dir', mode: number, uid: number, nlink = 1) => ({ uid, mode, nlink, isFile: () => kind === 'file', isDirectory: () => kind === 'dir' });

test('win32: Windows stat values (uid 0, 0o666/0o777) are private, not a thrown ownership failure', () => {
  assert.equal(posixPermissions(win32), false);
  assert.equal(ownedByCaller({ uid: 0 }, win32), true);
  assert.equal(isPrivateFile(stats('file', 0o100666, 0), win32), true);
  assert.equal(isPrivateDirectory(stats('dir', 0o40777, 0), win32), true);
  // Type and link checks still apply on Windows.
  assert.equal(isPrivateFile(stats('dir', 0o40777, 0), win32), false);
  assert.equal(isPrivateFile(stats('file', 0o100666, 0, 2), win32), false);
});

test('linux: POSIX ownership and mode are enforced', () => {
  assert.equal(posixPermissions(linux), true);
  assert.equal(isPrivateFile(stats('file', 0o100600, 1000), linux), true);
  assert.equal(isPrivateFile(stats('file', 0o100644, 1000), linux), false, 'group/world readable');
  assert.equal(isPrivateFile(stats('file', 0o100600, 1001), linux), false, 'other owner');
  assert.equal(isPrivateFile(stats('file', 0o100644, 1000), linux, false), true, 'mode check can be waived explicitly');
  assert.equal(isPrivateDirectory(stats('dir', 0o40700, 1000), linux), true);
  assert.equal(isPrivateDirectory(stats('dir', 0o40755, 1000), linux), false);
  assert.equal(ownedByCaller({ uid: 1000 }, { platform: 'linux', uid: undefined }), false, 'unknown uid on POSIX fails closed');
});

test('path components split on both Windows separators', () => {
  assert.deepEqual(pathParts('/home/a/.practonaut').parts, ['home', 'a', '.practonaut']);
  if (process.platform === 'win32') assert.deepEqual(pathParts('C:\\Users\\a\\.practonaut'), { root: 'C:\\', parts: ['Users', 'a', '.practonaut'] });
  else assert.deepEqual(pathParts('C:\\Users\\a/.practonaut').parts, ['C:', 'Users', 'a', '.practonaut']);
});

test('data paths: ~/.practonaut by default, PRACTONAUT_HOME overrides, per-platform separators', () => {
  assert.equal(practonautHome({}, '/home/a', 'linux'), '/home/a/.practonaut');
  assert.equal(practonautHome({}, '/Users/a', 'darwin'), '/Users/a/.practonaut');
  assert.equal(practonautHome({}, 'C:\\Users\\a', 'win32'), 'C:\\Users\\a\\.practonaut');
  assert.equal(practonautHome({ PRACTONAUT_HOME: '/srv/pn' }, '/home/a', 'linux'), '/srv/pn');
  assert.equal(practonautHome({ PRACTONAUT_HOME: 'D:\\pn' }, 'C:\\Users\\a', 'win32'), 'D:\\pn');
  assert.equal(practonautHome({ PRACTONAUT_HOME: '' }, '/home/a', 'linux'), '/home/a/.practonaut', 'empty value means unset');
  assert.deepEqual(dataPaths('C:\\Users\\a\\.practonaut', 'win32'), { home: 'C:\\Users\\a\\.practonaut', host: 'C:\\Users\\a\\.practonaut\\host', recordings: 'C:\\Users\\a\\.practonaut\\recordings', projects: 'C:\\Users\\a\\.practonaut\\projects', author: 'C:\\Users\\a\\.practonaut\\author' });
  assert.equal(dataPaths('/home/a/.practonaut', 'linux').host, '/home/a/.practonaut/host');
});

test('data paths never depend on the current directory', async () => {
  const before = process.cwd();
  const other = await mkdtemp(join(await realpath(tmpdir()), 'pn-cwd-'));
  try {
    const expected = practonautHome();
    process.chdir(other);
    assert.equal(practonautHome(), expected);
    assert.equal((await resolvedDataPaths()).home.startsWith(other), false);
  } finally { process.chdir(before); await rm(other, { recursive: true, force: true }); }
});

test('resolvedDataPaths resolves a symbolic link the user chose for PRACTONAUT_HOME', { skip: process.platform === 'win32' }, async () => {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'pn-link-'));
  try {
    await mkdir(join(base, 'real'));
    await symlink(join(base, 'real'), join(base, 'link'));
    const paths = await resolvedDataPaths({ PRACTONAUT_HOME: join(base, 'link', 'missing', 'home') });
    assert.equal(paths.home, join(base, 'real', 'missing', 'home'));
    await ensurePrivateDirectory(paths.host);
    assert.equal(isPrivateDirectory(await lstat(paths.host)), true);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('ensurePrivateDirectory: creates 0700, refuses symlink ancestors and a non-private leaf', { skip: process.platform === 'win32' }, async () => {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'pn-private-'));
  try {
    const leaf = join(base, 'a', 'b');
    await ensurePrivateDirectory(leaf);
    assert.equal((await lstat(leaf)).mode & 0o777, 0o700);
    await symlink(join(base, 'a'), join(base, 'via'));
    await assert.rejects(ensurePrivateDirectory(join(base, 'via', 'c')), PrivateFsError);
    await writeFile(join(base, 'file'), 'x');
    await assert.rejects(ensurePrivateDirectory(join(base, 'file', 'c')), PrivateFsError);
    await chmod(leaf, 0o755);
    await assert.rejects(ensurePrivateDirectory(leaf), PrivateFsError, 'an existing world-readable leaf is refused, not repaired');
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('the test process runs with a temporary PRACTONAUT_HOME, not ~/.practonaut', () => {
  assert.ok(process.env.PRACTONAUT_HOME, 'tests are started with tests/support/test-home.ts');
  assert.match(process.env.PRACTONAUT_HOME!, /pn-home-/);
});

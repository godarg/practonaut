// `practonaut setup` installs only the Chromium headless shell (and what Playwright brings along).
// A browser cache holding nothing else must be enough: doctor reports the mirror ready, and a
// session starts with the real engine. The cache is built from the real one (links to the pinned
// headless shell and ffmpeg folders), so the browser that starts is the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('a browser cache with only the headless shell: doctor is ready and a session starts with the real engine', { timeout: 180_000 }, async () => {
  let revision = dirname(chromium.executablePath());
  while (!/^chromium-\d+$/.test(basename(revision))) revision = dirname(revision);
  const real = dirname(revision), shell = basename(revision).replace('chromium-', 'chromium_headless_shell-');
  const ffmpegRevision = (JSON.parse(readFileSync(fileURLToPath(new URL('../../node_modules/playwright-core/browsers.json', import.meta.url)), 'utf8')) as { browsers: Array<{ name: string; revision: string }> }).browsers.find(entry => entry.name === 'ffmpeg')!.revision;
  const cache = await mkdtemp(join(await realpath(tmpdir()), 'pn-shell-only-')), home = await mkdtemp(join(await realpath(tmpdir()), 'pn-shell-only-home-'));
  try {
    for (const folder of [shell, `ffmpeg-${ffmpegRevision}`]) await symlink(join(real, folder), join(cache, folder), 'junction');
    assert.deepEqual((await readdir(cache)).sort(), [shell, `ffmpeg-${ffmpegRevision}`].sort(), 'no headed Chromium in this cache');
    const env: NodeJS.ProcessEnv = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache, PRACTONAUT_HOME: home };

    const doctor = spawnSync(process.execPath, [main, 'doctor', '--adapter', '--json'], { env, encoding: 'utf8', timeout: 90_000 });
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
    const checks = (JSON.parse(doctor.stdout) as { checks: Array<{ name: string; ok: boolean }> }).checks;
    assert.deepEqual(checks.filter(check => /chromium/.test(check.name)).map(check => [check.name, check.ok]), [['playwright chromium (cache)', true], ['chromium start', true]]);

    // The mirror starts headless from it: the session reports the real engine.
    const child = spawn(process.execPath, [main, 'play', '--no-open'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { output += String(data); });
    const deadline = Date.now() + 90_000;
    while (!/^Open: http/m.test(output) && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    const exit = new Promise<number | null>(resolve => child.once('exit', resolve)); child.kill('SIGINT');
    // Windows cannot send a signal to another process: kill() terminates it, so no exit code.
    assert.equal(await exit, process.platform === 'win32' ? null : 0, output);
    assert.match(output, /^Mode: real-engine$/m, output);
    assert.doesNotMatch(output, /Chromium is not installed/);
  } finally {
    await rm(cache, { recursive: true, force: true }); await rm(home, { recursive: true, force: true });
  }
});

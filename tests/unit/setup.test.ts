import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { HEADLESS_SHELL, headlessShellDownload, headlessShellMegabytes } from '../../src/cli/chromium-download.ts';
import { headlessShellInstalled } from '../../src/cli/doctor.ts';

test('the named download size belongs to the pinned Playwright and its headless shell', async () => {
  // The sizes were measured for one Playwright pin; a dependency update has to measure them again.
  const pinned = JSON.parse(await readFile(new URL('../../node_modules/playwright-core/package.json', import.meta.url), 'utf8')) as { version: string };
  const browsers = JSON.parse(await readFile(new URL('../../node_modules/playwright-core/browsers.json', import.meta.url), 'utf8')) as { browsers: Array<{ name: string; browserVersion?: string }> };
  assert.equal(HEADLESS_SHELL.playwright, pinned.version, 'sizes measured for another Playwright: re-measure the CDN archives');
  assert.equal(HEADLESS_SHELL.browserVersion, browsers.browsers.find(entry => entry.name === 'chromium-headless-shell')?.browserVersion);
  // Hand-summed archive sizes (headless shell + ffmpeg), rounded to whole MB.
  assert.equal(headlessShellMegabytes('darwin', 'arm64'), 105);
  assert.equal(headlessShellMegabytes('linux', 'x64'), 128);
  assert.equal(headlessShellMegabytes('win32', 'x64'), 125);
  // An unknown platform is told the largest measured size, never less.
  assert.equal(headlessShellMegabytes('freebsd', 'x64'), 128);
  assert.deepEqual(headlessShellDownload('darwin', 'x64'), { name: 'Chromium headless shell', size: 111 });
});

test('doctor counts a cache with only the headless shell as installed, and a headed Chromium alone as missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pn-shell-cache-'));
  try {
    // The path Playwright reports for the headed browser, which `setup` no longer downloads.
    const headed = join(root, 'chromium-1243', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
    assert.equal(headlessShellInstalled(headed), false, 'empty cache');
    await mkdir(dirname(headed), { recursive: true }); await writeFile(headed, '');
    assert.equal(headlessShellInstalled(headed), false, 'the headed browser alone does not run the mirror');
    await mkdir(join(root, 'chromium_headless_shell-1243', 'chrome-headless-shell-mac-arm64'), { recursive: true });
    assert.equal(headlessShellInstalled(headed), false, 'a shell folder without its executable is an incomplete download');
    await writeFile(join(root, 'chromium_headless_shell-1243', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'), '');
    assert.equal(headlessShellInstalled(headed), true);
    await rm(join(root, 'chromium-1243'), { recursive: true });
    assert.equal(headlessShellInstalled(headed), true, 'only-shell install: no headed browser needed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('setup explicitly provisions Chromium and propagates installer failure at the process boundary', async () => {
  // Under `npx practonaut` the installed Playwright lives below a `_npx` cache folder.
  const dir = await mkdtemp(join(tmpdir(), '_npx-pn-setup-boundary-'));
  try {
    await mkdir(join(dir, 'node_modules/playwright-core'), { recursive: true });
    await cp(new URL('../../src/cli/setup.ts', import.meta.url), join(dir, 'setup.ts'));
    await cp(new URL('../../src/cli/messages.ts', import.meta.url), join(dir, 'messages.ts'));
    await cp(new URL('../../src/cli/invocation.ts', import.meta.url), join(dir, 'invocation.ts'));
    await cp(new URL('../../src/cli/output.ts', import.meta.url), join(dir, 'output.ts'));
    await cp(new URL('../../src/cli/chromium-download.ts', import.meta.url), join(dir, 'chromium-download.ts'));
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(dir, 'node_modules/playwright-core/package.json'), '{"name":"playwright-core","type":"module","exports":{"./package.json":"./package.json"}}');
    await writeFile(join(dir, 'node_modules/playwright-core/cli.js'), `
      import assert from 'node:assert/strict';
      // Playwright's own check (isLikelyNpxGlobal): a CLI path containing _npx prints a warning box.
      if (process.argv[1].includes('_npx')) console.error('WARNING: It looks like you are running npx playwright install without first installing your project dependencies');
      // Only the headless shell: the mirror never starts a headed Chromium.
      assert.deepEqual(process.argv.slice(2), ['install', '--only-shell', 'chromium', ...(process.argv.includes('--dry-run') ? ['--dry-run'] : [])]);
      console.log('installer-boundary:' + JSON.stringify(process.argv.slice(2)));
      process.exitCode = process.argv.includes('--dry-run') ? 0 : Number(process.env.PN_TEST_INSTALL_EXIT);
    `);
    await writeFile(join(dir, 'entry.ts'), "import {commandSetup} from './setup.ts'; process.exitCode=await commandSetup(process.argv.slice(2));");
    const run = (exit: number, args: string[] = []) => spawnSync(process.execPath, [join(dir, 'entry.ts'), ...args], {
      env: { ...process.env, PN_TEST_INSTALL_EXIT: String(exit) }, encoding: 'utf8', timeout: 10_000,
    });
    const green = run(0);
    assert.equal(green.status, 0, green.stderr);
    // The download is named with its size before the installer runs at all.
    const named = green.stdout.indexOf('setup: one download for the real Excalidraw mirror: Chromium headless shell ');
    assert.ok(named >= 0, green.stdout);
    assert.match(green.stdout, /Chromium headless shell \d+\.\d+\.\d+\.\d+, about \d{2,3} MB/);
    assert.ok(named < green.stdout.indexOf('installer-boundary:'), 'named before the first installer call');
    assert.match(green.stdout, /installer-boundary:\["install","--only-shell","chromium","--dry-run"\]/);
    assert.match(green.stdout, /installer-boundary:\["install","--only-shell","chromium"\]/);
    assert.doesNotMatch(green.stderr, /WARNING: It looks like you are running/, 'no Playwright npx warning box under npx practonaut');
    const failed = run(7);
    assert.equal(failed.status, 3, failed.stdout + failed.stderr);
    assert.doesNotMatch(failed.stdout, /provisioning completed/);
    const usage = run(0, ['--unexpected']);
    assert.equal(usage.status, 1);
    assert.doesNotMatch(usage.stdout, /installer-boundary/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

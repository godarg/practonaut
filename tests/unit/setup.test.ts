import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { HEADLESS_SHELL, headlessShellDownload, headlessShellMegabytes } from '../../src/cli/chromium-download.ts';
import { headlessShellInstalled } from '../../src/cli/doctor.ts';

test('the named download size belongs to the pinned Playwright and its headless shell', async () => {
  // The sizes were measured for one Playwright pin; a dependency update has to measure them again.
  const pinned = JSON.parse(await readFile(new URL('../../node_modules/playwright-core/package.json', import.meta.url), 'utf8')) as { version: string };
  const browsers = JSON.parse(await readFile(new URL('../../node_modules/playwright-core/browsers.json', import.meta.url), 'utf8')) as { browsers: Array<{ name: string; browserVersion?: string }> };
  assert.equal(HEADLESS_SHELL.playwright, pinned.version, `the headless-shell sizes were measured for Playwright ${HEADLESS_SHELL.playwright}, the pin is ${pinned.version}: run node tools/measure-headless-shell.ts --write`);
  assert.equal(HEADLESS_SHELL.browserVersion, browsers.browsers.find(entry => entry.name === 'chromium-headless-shell')?.browserVersion);
  // Hand-summed archive sizes (headless shell + ffmpeg, plus winldd on Windows), rounded to whole MB.
  assert.equal(headlessShellMegabytes('darwin', 'arm64'), 105);
  assert.equal(headlessShellMegabytes('linux', 'x64'), 128);
  // Windows also fetches Playwright's winldd.
  assert.equal(headlessShellMegabytes('win32', 'x64'), 126);
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
    // Plain setup's modules only, in their own layout: the CLI's and the world table's display names.
    for (const file of ['cli/setup.ts', 'cli/messages.ts', 'cli/invocation.ts', 'cli/output.ts', 'cli/chromium-download.ts', 'world/apps.ts', 'world/preflight.ts', 'world/limits.ts']) await cp(new URL(`../../src/${file}`, import.meta.url), join(dir, file));
    await writeFile(join(dir, 'package.json'), '{"type":"module"}');
    await writeFile(join(dir, 'node_modules/playwright-core/package.json'), '{"name":"playwright-core","type":"module","exports":{".":"./index.js","./package.json":"./package.json"}}');
    // Where Playwright would put the headed browser and, beside it, the headless shell: 100,000,000
    // bytes on disk (a sparse file), which is 100 MB and 95 MiB.
    const cache = join(dir, 'cache'), shell = join(cache, 'chromium_headless_shell-1248', 'chrome-headless-shell-mac-arm64');
    await mkdir(shell, { recursive: true }); await writeFile(join(shell, 'chrome-headless-shell'), ''); await truncate(join(shell, 'chrome-headless-shell'), 100_000_000);
    await writeFile(join(dir, 'node_modules/playwright-core/index.js'), `export const chromium = { executablePath: () => ${JSON.stringify(join(cache, 'chromium-1248', 'chrome-mac-arm64', 'Chromium'))} };`);
    await writeFile(join(dir, 'node_modules/playwright-core/cli.js'), `
      import assert from 'node:assert/strict';
      // Playwright's own check (isLikelyNpxGlobal): a CLI path containing _npx prints a warning box.
      if (process.argv[1].includes('_npx')) console.error('WARNING: It looks like you are running npx playwright install without first installing your project dependencies');
      // Only the headless shell: the mirror never starts a headed Chromium.
      assert.deepEqual(process.argv.slice(2), ['install', '--only-shell', 'chromium', ...(process.argv.includes('--dry-run') ? ['--dry-run'] : [])]);
      console.log('installer-boundary:' + JSON.stringify(process.argv.slice(2)));
      process.exitCode = process.argv.includes('--dry-run') ? 0 : Number(process.env.PN_TEST_INSTALL_EXIT);
    `);
    await writeFile(join(dir, 'entry.ts'), "import {commandSetup} from './cli/setup.ts'; process.exitCode=await commandSetup(process.argv.slice(2));");
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
    // The size on disk in decimal megabytes, like the download size before it, of the shell's own folder.
    assert.match(green.stdout, /setup: the Chromium headless shell is ready in .+chromium_headless_shell-1248 \(100 MB on disk\)/);
    const failed = run(7);
    assert.equal(failed.status, 3, failed.stdout + failed.stderr);
    assert.doesNotMatch(failed.stdout, /provisioning completed/);
    const usage = run(0, ['--unexpected']);
    assert.equal(usage.status, 1);
    assert.doesNotMatch(usage.stdout, /installer-boundary/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

import { cliText } from './messages.ts';
import { displayPath, safeText } from './output.ts';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { lstat, readdir } from 'node:fs/promises';
import { HEADLESS_SHELL, headlessShellMegabytes } from './chromium-download.ts';

/** Explicit provisioning only: installing Practonaut never invokes this command. */
export async function commandSetup(args: string[]): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(cliText("setupHelp"));
    return 0;
  }
  if (args.length !== 0) {
    process.stderr.write(cliText("setupUsage"));
    return 1;
  }
  const require = createRequire(import.meta.url);
  let cli: string;
  try { cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js'); }
  catch {
    process.stderr.write(cliText("setupMissing"));
    return 3;
  }
  // Playwright prints a large "running 'npx playwright install' without first installing your
  // project's dependencies" box whenever its CLI script path contains `_npx` — which is always the case
  // under `npx practonaut`, where Practonaut is the project and its pinned Playwright is the one
  // installed. The CLI is started under the plain name `playwright` instead (same script, same
  // arguments); nothing else about the install changes.
  const loader = `process.argv.splice(1, 0, 'playwright'); require(${JSON.stringify(cli)});`;
  const run = (options: string[]): Promise<number> => new Promise(resolve => {
    // Only the headless shell: the mirror never starts a headed Chromium (see chromium-download.ts).
    const child = spawn(process.execPath, ['-e', loader, 'install', '--only-shell', 'chromium', ...options], { stdio: 'inherit' });
    child.once('error', () => resolve(3));
    child.once('close', code => resolve(code === 0 ? 0 : 3));
  });
  // The download is named with its size before anything is fetched; the dry run then names the
  // actual pinned sources and the cache folder, including when everything is cached already.
  process.stdout.write(cliText('setupStart', { name: HEADLESS_SHELL.name, version: HEADLESS_SHELL.browserVersion, size: headlessShellMegabytes() }));
  if (await run(['--dry-run']) !== 0) return 3;
  if (await run([]) !== 0) return 3;
  const installed = await installedHeadlessShell();
  process.stdout.write(installed ? cliText('setupDoneAt', { name: HEADLESS_SHELL.name, path: safeText(displayPath(installed.directory)), size: (installed.bytes / 1024 / 1024).toFixed(0) }) : cliText("setupDone"));
  return 0;
}

/** Where the pinned headless shell now lives and how much disk it takes. */
async function installedHeadlessShell(): Promise<{ directory: string; bytes: number } | undefined> {
  try {
    const { chromium } = await import('playwright-core') as { chromium: { executablePath(): string } };
    let revision = dirname(chromium.executablePath());
    while (dirname(revision) !== revision && !/^chromium-\d+$/.test(basename(revision))) revision = dirname(revision);
    if (!/^chromium-\d+$/.test(basename(revision))) return undefined;
    const shell = join(dirname(revision), basename(revision).replace('chromium-', 'chromium_headless_shell-'));
    let bytes = 0;
    for (const entry of await readdir(shell, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) bytes += (await lstat(join(entry.parentPath, entry.name)).catch(() => ({ size: 0 }))).size;
    }
    return { directory: dirname(revision), bytes };
  } catch { return undefined; }
}

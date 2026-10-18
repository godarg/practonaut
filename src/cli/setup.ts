import { cliText } from './messages.ts';
import { displayPath, safeText } from './output.ts';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { lstat, readdir } from 'node:fs/promises';
import { HEADLESS_SHELL, headlessShellMegabytes } from './chromium-download.ts';
import type { SetupSeams } from './setup-app.ts';

/** Explicit provisioning only: installing Practonaut never invokes this command. Plain `setup`
 * installs only Chromium; `setup --app drawio [--from <file>]` also downloads (or takes) the pinned
 * draw.io release, which is never fetched any other way (PADR-0049 decision 2). */
export async function commandSetup(args: string[], seams: SetupSeams = {}): Promise<number> {
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(cliText("setupHelp"));
    return 0;
  }
  if (args.length === 0) return setupChromium();
  const app = args[0] === '--app' ? args[1] : undefined;
  const from = args.length === 4 && args[2] === '--from' ? args[3] : undefined;
  if (app !== 'drawio' || (args.length !== 2 && from === undefined)) { process.stderr.write(cliText('setupAppUsage')); return 1; }
  // Only `--app` loads the app download: plain setup keeps its small set of modules.
  const { setupDrawio } = await import('./setup-app.ts');
  return setupDrawio(from, { chromium: setupChromium, ...seams });
}

export async function setupChromium(): Promise<number> {
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
  // Megabytes are 10^6 bytes here, as in the download size printed before it.
  process.stdout.write(installed ? cliText('setupDoneAt', { name: HEADLESS_SHELL.name, path: safeText(displayPath(installed.directory)), size: Math.round(installed.bytes / 1_000_000) }) : cliText("setupDone"));
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
    // The folder the size is of: the headless shell itself, not the whole Playwright cache.
    return { directory: shell, bytes };
  } catch { return undefined; }
}

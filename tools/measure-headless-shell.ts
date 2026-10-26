// Measures the download `practonaut setup` names: for every platform, the archives Playwright's own
// `install --only-shell chromium` would fetch (read from its dry run with
// PLAYWRIGHT_HOST_PLATFORM_OVERRIDE, plus `winldd` on Windows, which Playwright adds only on a real
// Windows host), and their sizes from the CDN's Content-Length (HEAD requests, redirects followed).
//
//   node tools/measure-headless-shell.ts           print the table
//   node tools/measure-headless-shell.ts --write   also rewrite it in src/cli/chromium-download.ts
//
// Run it after every Playwright update (the unit test in tests/unit/setup.test.ts names it when the
// pinned Playwright and the table disagree). This tool makes network requests; the product never does.
// It measures only an install that matches package-lock.json: the table is written as the locked
// Playwright's, and a stale node_modules (a pull without `npm ci`) would write the previous one back.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeDrift, installationDrift } from './lockfile-drift.ts';

const stale = installationDrift(fileURLToPath(new URL('../', import.meta.url)));
if (stale.length > 0) {
  console.error(`measure-headless-shell: ${describeDrift(stale)} first; nothing measured, nothing written`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const pwRoot = dirname(require.resolve('playwright-core/package.json'));
const pw = JSON.parse(readFileSync(join(pwRoot, 'package.json'), 'utf8')) as { version: string };
const browsers = (JSON.parse(readFileSync(join(pwRoot, 'browsers.json'), 'utf8')) as { browsers: Array<{ name: string; revision: string; browserVersion?: string }> }).browsers;
const shell = browsers.find(entry => entry.name === 'chromium-headless-shell')!;
const winldd = browsers.find(entry => entry.name === 'winldd')!;

/** Practonaut platform key → Playwright host platform it stands for. */
const PLATFORMS: Record<string, string> = { 'darwin-arm64': 'mac15-arm64', 'darwin-x64': 'mac15', 'linux-x64': 'ubuntu24.04-x64', 'linux-arm64': 'ubuntu24.04-arm64', 'win32-x64': 'win64' };

function urls(override: string): string[] {
  const run = spawnSync(process.execPath, [join(pwRoot, 'cli.js'), 'install', '--only-shell', '--dry-run', 'chromium'], { encoding: 'utf8', env: { ...process.env, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: override } });
  if (run.status !== 0) throw new Error(`dry run for ${override} failed:\n${run.stdout}\n${run.stderr}`);
  // One archive per browser: its first "Download url" (the fallbacks are the same file).
  const found = [...run.stdout.matchAll(/^\S.*\n(?:\s+Install location:.*\n)?\s+Download url:\s+(\S+)/gm)].map(match => match[1]!);
  if (override === 'win64') found.push(`https://cdn.playwright.dev/dbazure/download/playwright/builds/winldd/${winldd.revision}/winldd-win64.zip`);
  if (!found.some(url => url.includes('chrome-headless-shell'))) throw new Error(`no headless shell for ${override}:\n${run.stdout}`);
  return found;
}
async function size(url: string): Promise<number> {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  const length = Number(response.headers.get('content-length'));
  if (!response.ok || !Number.isSafeInteger(length) || length <= 0) throw new Error(`${url}: HTTP ${response.status}, Content-Length ${response.headers.get('content-length')}`);
  return length;
}

const table: Record<string, number[]> = {};
for (const [key, override] of Object.entries(PLATFORMS)) {
  table[key] = [];
  for (const url of urls(override)) { const bytes = await size(url); table[key].push(bytes); console.log(`${key}  ${bytes.toString().padStart(11)}  ${url}`); }
}
const today = new Date().toISOString().slice(0, 10);
const group = (n: number): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '_');
const block = [
  '// measure-headless-shell:begin (written by tools/measure-headless-shell.ts --write)',
  'export const HEADLESS_SHELL = Object.freeze({',
  "  name: 'Chromium headless shell',",
  `  playwright: '${pw.version}',`,
  `  browserVersion: '${shell.browserVersion}',`,
  `  measured: '${today}',`,
  '  /** Bytes per platform: the sum of the archives Playwright downloads for `install --only-shell chromium`. */',
  '  bytes: Object.freeze({',
  ...Object.entries(table).map(([key, parts]) => `    '${key}': ${parts.map(group).join(' + ')},`),
  '  } as Record<string, number>),',
  '});',
  '// measure-headless-shell:end',
].join('\n');
console.log(`\nplaywright-core ${pw.version}, Chrome for Testing ${shell.browserVersion}: ${Object.entries(table).map(([key, parts]) => `${key} ${Math.round(parts.reduce((a, b) => a + b, 0) / 1e6)} MB`).join(', ')}`);
if (process.argv.includes('--write')) {
  const file = fileURLToPath(new URL('../src/cli/chromium-download.ts', import.meta.url));
  const source = readFileSync(file, 'utf8');
  const updated = source.replace(/\/\/ measure-headless-shell:begin[\s\S]*?\/\/ measure-headless-shell:end/, block);
  if (updated === source && !source.includes(block)) throw new Error('measure-headless-shell markers not found');
  writeFileSync(file, updated);
  console.log(`written ${file}`);
}

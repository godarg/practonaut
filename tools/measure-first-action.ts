// First 60 seconds (roadmap 0.2.0, Should 7): the time from the command to the first visible action
// of the demonstration. Each run starts `practonaut --no-open` as a user would: by default
// `npx --yes --package <packed tarball> practonaut` with a warm npx cache, which installs nothing and
// looks nothing up in the npm registry (the runs set npm offline; a registry install would add its
// own download time). It opens the printed link in a fresh browser profile, clicks "Watch a
// demonstration" by automation (so the figure holds no human reaction time) and stops the clock when
// the first demonstrated step is on the board. The browser launch counts: it stands in for the
// user's own browser that `practonaut` opens.
// Writes .local/measure-first-action/<timestamp>-<commit>.json (the commit and whether the tree had
// changes are in the file) and prints the medians.
//
//   node tools/measure-first-action.ts [--runs 3] [--mode model-only|real-engine|both] [--tarball <tgz> | --local]
//
// --local runs the local build (`node dist/cli/main.js`, after `npm run build`) instead of npx.
// model-only points PLAYWRIGHT_BROWSERS_PATH at an empty folder, so Practonaut finds no Chromium:
// the case of a first start before `practonaut setup`. The measuring browser is the repository's
// own Playwright Chromium and is not affected.
import { spawn, spawnSync } from 'node:child_process';
import { cpus, totalmem, platform, release, arch } from 'node:os';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { spawnable } from '../src/platform/spawnable.ts';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const runs = Number(option('--runs') ?? 3);
const modes = (option('--mode') ?? 'both') === 'both' ? ['model-only', 'real-engine'] as const : [option('--mode') as 'model-only' | 'real-engine'];
const local = args.includes('--local');
const out = resolve('.local/measure-first-action');
await mkdir(out, { recursive: true });

function run(command: string[], options: { env?: NodeJS.ProcessEnv } = {}): string {
  const target = spawnable(command);
  const result = spawnSync(target.command, target.args, { encoding: 'utf8', env: options.env ?? process.env, maxBuffer: 64 * 1024 * 1024, ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) });
  if (result.status !== 0) throw new Error(`${command.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

let command: string[];
let how: string;
if (local) {
  command = [process.execPath, resolve('dist/cli/main.js')];
  how = 'local build: node dist/cli/main.js';
} else {
  let tarball = option('--tarball');
  if (!tarball) {
    console.log('measure: npm run build and npm pack (once)');
    run(['npm', 'run', '--silent', 'build']);
    const name = run(['npm', 'pack', '--ignore-scripts', '--pack-destination', out]).trim().split('\n').at(-1)!;
    tarball = join(out, name);
  }
  tarball = resolve(tarball);
  // The packed package under its own name, as `npx practonaut` runs it from the registry.
  command = ['npx', '--yes', '--package', tarball, 'practonaut'];
  how = `npx --yes --package ${tarball} practonaut (warm npx cache)`;
  // Warm the npx cache: the first npx of a package installs it; the measured runs reuse it.
  console.log('measure: warming the npx cache');
  run([...command, '--version']);
}

interface Sample { mode: string; run: number; linkMs: number; playerMs: number; firstActionMs: number }
const samples: Sample[] = [];
const emptyBrowsers = await mkdtemp(join(await realpath(tmpdir()), 'pn-measure-no-browsers-'));
try {
  for (const mode of modes) for (let index = 1; index <= runs; index++) {
    const home = await mkdtemp(join(await realpath(tmpdir()), 'pn-measure-home-'));
    // npm offline: a measured run that would need the registry fails instead of quietly downloading.
    const env: NodeJS.ProcessEnv = { ...process.env, PRACTONAUT_HOME: home, ...(local ? {} : { npm_config_offline: 'true' }), ...(mode === 'model-only' ? { PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers } : {}) };
    const target = spawnable([...command, '--no-open']);
    const started = performance.now();
    const child = spawn(target.command, target.args, { env, stdio: ['pipe', 'pipe', 'pipe'], ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) });
    let output = '';
    child.stdout.on('data', data => { output += String(data); }); child.stderr.on('data', data => { output += String(data); });
    const deadline = Date.now() + 120_000;
    while (!/^Open: http/m.test(output)) { if (child.exitCode !== null || Date.now() > deadline) throw new Error(`no link:\n${output}`); await new Promise(done => setTimeout(done, 10)); }
    const linkMs = performance.now() - started;
    // `practonaut` opens the user's browser now; here a fresh Chromium stands in for it.
    const browser = await chromium.launch({ headless: true });
    try {
      const expected = mode === 'model-only' ? /^Mode: model-only/m : /^Mode: real-engine$/m;
      if (!expected.test(output)) throw new Error(`expected ${mode}:\n${output}`);
      const url = /^Open: (\S+)$/m.exec(output)![1]!;
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', serviceWorkers: 'block' })).newPage();
      await page.goto(url);
      await page.getByTestId('demo-start').waitFor();
      const playerMs = performance.now() - started;
      await page.getByTestId('demo-start').click();
      await page.locator('svg [data-object-type="step"]').first().waitFor({ timeout: 60_000 });
      const firstActionMs = performance.now() - started;
      samples.push({ mode, run: index, linkMs: Math.round(linkMs), playerMs: Math.round(playerMs), firstActionMs: Math.round(firstActionMs) });
      console.log(`measure: ${mode} run ${index}: link ${Math.round(linkMs)} ms, Player ${Math.round(playerMs)} ms, first demonstrated action ${Math.round(firstActionMs)} ms`);
    } finally {
      await browser.close();
      child.kill('SIGINT');
      await new Promise(done => { if (child.exitCode !== null) done(undefined); else child.once('exit', done); });
      await rm(home, { recursive: true, force: true });
    }
  }
} finally { await rm(emptyBrowsers, { recursive: true, force: true }); }

const median = (values: number[]): number => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2); };
const summary = Object.fromEntries(modes.map(mode => { const own = samples.filter(sample => sample.mode === mode); return [mode, { runs: own.length, medianFirstActionMs: median(own.map(sample => sample.firstActionMs)), medianPlayerMs: median(own.map(sample => sample.playerMs)), medianLinkMs: median(own.map(sample => sample.linkMs)) }]; }));
const machine = { platform: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, memoryGb: Math.round(totalmem() / 1024 ** 3), node: process.version };
const git = (args: string[]): string => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
const commit = git(['rev-parse', '--short', 'HEAD']) || 'unknown', dirty = git(['status', '--porcelain', '--untracked-files=no']) !== '';
const report = { schema: 'practonaut.measure-first-action/1', date: new Date().toISOString(), commit, dirty, how, clicks: 'automated (no human reaction time)', budgetMs: 30_000, machine, summary, samples };
const file = join(out, `${report.date.replace(/[:.]/g, '-')}-${commit}${dirty ? '-dirty' : ''}.json`);
await writeFile(file, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ commit, dirty, how, machine, summary }, null, 2));
console.log(`measure: written ${file}`);
if (Object.values(summary).some(entry => entry.medianFirstActionMs > report.budgetMs)) process.exitCode = 1;

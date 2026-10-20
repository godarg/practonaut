// Opt-in measurement for the browser budget (PADR-0050, decision 10; docs/testing.md "Browser close
// contract"). It is not part of any test command and is POSIX only: it stops browsers it started.
//
//   node --import ./tests/support/test-home.ts tools/measure-browser-budget.ts [--mirrors 5] [--recoveries 2]
//
// The budget's scenario, with real Excalidraw mirrors on real Chromium: the start check's browser is
// still closing; `--mirrors` mirrors run (an author host and four practice hosts); `--recoveries` of
// them recover at the same time, each while its old browser is still closing. A browser is kept
// "still closing" by stopping its own process group (SIGSTOP) before its close is asked, so no graceful
// close can finish and Playwright's forced end comes 30 s after the request. Only browsers this tool
// launched are ever signalled. Every 250 ms it reads the process table (this tool's own read; the
// product reads none) and records the resident size summed over each browser's process tree (shared
// pages count once per process, so the sum is an upper bound), the sinks still bound (mirror entries
// whose slot is held) and Playwright's profile directories in its own temporary directory. Writes
// .local/measure-browser-budget/<timestamp>.json and prints the summary.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';

if (process.platform === 'win32') { process.stderr.write('measure-browser-budget: POSIX only (it stops the browsers it started); Windows stays UNKNOWN\n'); process.exit(2); }
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const option = (name: string, fallback: number): number => { const index = process.argv.indexOf(name); return index < 0 ? fallback : Number(process.argv[index + 1]); };
const MIRRORS = option('--mirrors', 5), RECOVERIES = option('--recoveries', 2);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = join(ROOT, '.local', 'measure-browser-budget'), temporary = join(out, `${stamp}-tmp`);
mkdirSync(temporary, { recursive: true });
process.env.TMPDIR = temporary; // Playwright's profile and artifacts directories go here.

const { chromium } = await import('playwright-core');
const { processLedger, startBrowser } = await import('../src/adapters/browser/ledger.ts');
const { createExcalidrawAdapter } = await import('../src/adapters/excalidraw/index.ts');
const { ADAPTER_REGISTRY } = await import('../src/adapters/registry.ts');
const { createProductionMirror } = await import('../src/host/mirror.ts');
const { validateWorld } = await import('../src/world/schema.ts');
type Mirror = Awaited<ReturnType<typeof createProductionMirror>>;

const initial = validateWorld(JSON.parse(readFileSync(join(ROOT, 'examples/worlds/flow-diagram/world.json'), 'utf8'))).initialState;
const browserPid = async (browser: Browser): Promise<number> => {
  const session = await browser.newBrowserCDPSession();
  const info = await session.send('SystemInfo.getProcessInfo') as { processInfo: Array<{ type: string; id: number }> };
  await session.detach();
  return info.processInfo.find(entry => entry.type === 'browser')!.id;
};
const table = (): Array<{ pid: number; ppid: number; rss: number }> => execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', LC_ALL: 'C' } })
  .split('\n').filter(Boolean).map(line => { const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number); return { pid: pid!, ppid: ppid!, rss: rss! }; });
/** Resident size (KiB) summed over the process tree of `root`, and how many processes it has. */
function treeRss(rows: ReturnType<typeof table>, root: number): { kib: number; processes: number } {
  let kib = 0, processes = 0; const walk = (pid: number): void => { const row = rows.find(candidate => candidate.pid === pid); if (!row) return; kib += row.rss; processes++; for (const child of rows.filter(candidate => candidate.ppid === pid)) walk(child.pid); };
  walk(root); return { kib, processes };
}
const browsers = new Map<number, string>(); // pid → role
const stop = (pid: number): void => { process.kill(-pid, 'SIGSTOP'); };

// The start check's browser, still closing.
const check = await startBrowser('start-check', chromium, () => ({ headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }));
const checkPid = await browserPid(check.browser); browsers.set(checkPid, 'start-check (closing)');
stop(checkPid); void check.lease.close();

// The mirrors: each adapter's first write fails, as a timed-out write would, so its next recovery
// replaces the browser.
let created = 0;
const registry = { excalidraw: { ...ADAPTER_REGISTRY.excalidraw, create: async (state: typeof initial, options?: Parameters<typeof createExcalidrawAdapter>[1]) => {
  const index = ++created; let pid = 0;
  const adapter = await createExcalidrawAdapter(state, options, { ready: async browser => { pid = await browserPid(browser); } });
  browsers.set(pid, index <= MIRRORS ? `mirror ${index}` : `replacement ${index - MIRRORS}`);
  let failed = false;
  return { ...adapter, apply: async (...args: Parameters<typeof adapter.apply>) => { if (!failed) { failed = true; throw new Error('measurement: a write that failed'); } return adapter.apply(...args); } };
} } };
const mirrors: Mirror[] = [];
for (let index = 0; index < MIRRORS; index++) mirrors.push(await createProductionMirror(initial, undefined, undefined, registry));

interface Sample { atMs: number; browsersAlive: number; rssMiB: number; perBrowserMiB: Record<string, number>; processes: number; slots: number; sinks: number; profiles: number }
const samples: Sample[] = [], t0 = performance.now();
const sample = (): Sample => {
  const rows = table(); let kib = 0, processes = 0, alive = 0; const per: Record<string, number> = {};
  for (const [pid, role] of browsers) { const tree = treeRss(rows, pid); if (tree.processes === 0) continue; alive++; kib += tree.kib; processes += tree.processes; per[role] = Math.round(tree.kib / 1024); }
  const held = processLedger.records().filter(record => record.slot === 'held');
  const result = { atMs: Math.round(performance.now() - t0), browsersAlive: alive, rssMiB: Math.round(kib / 1024), perBrowserMiB: per, processes, slots: held.length, sinks: held.filter(record => record.owner === 'mirror').length,
    profiles: readdirSync(temporary).filter(name => name.startsWith('playwright_chromiumdev_profile-')).length };
  samples.push(result); return result;
};
const steady = sample();
process.stdout.write(`steady: ${JSON.stringify(steady)}\n`);

// Recoveries at the same time, each with its old browser stopped before its close.
const recovering = mirrors.slice(0, RECOVERIES);
for (const mirror of recovering) await mirror.apply({ before: initial, after: initial, action: { name: 'move_step', params: {} } }).catch(() => undefined);
const olds = [...browsers].filter(([, role]) => /^mirror [0-9]+$/.test(role) && Number(role.split(' ')[1]) <= RECOVERIES).map(([pid]) => pid);
for (const pid of olds) { stop(pid); browsers.set(pid, `${browsers.get(pid)} (old, closing)`); }
const sampler = setInterval(sample, 250);
const recovered = await Promise.allSettled(recovering.map(mirror => mirror.recover(initial)));
const overlap = sample();
process.stdout.write(`recoveries: ${recovered.map(result => result.status).join(', ')}; during the overlap: ${JSON.stringify(overlap)}\n`);
// Playwright ends the stopped browsers 30 s after their close requests; then every slot is proven free.
const drained = performance.now();
while (processLedger.unreleased() > MIRRORS && performance.now() - drained < 45_000) await new Promise(done => setTimeout(done, 250));
clearInterval(sampler);
const after = sample();
for (const mirror of mirrors) await mirror.close();
while (processLedger.unreleased() > 0 && performance.now() - drained < 60_000) await new Promise(done => setTimeout(done, 100));
const peak = samples.reduce((best, current) => current.rssMiB > best.rssMiB ? current : best, samples[0]!);
const summary = {
  machine: { platform: process.platform, release: execFileSync('uname', ['-r'], { encoding: 'utf8' }).trim(), node: process.version, playwright: (JSON.parse(readFileSync(join(ROOT, 'node_modules/playwright-core/package.json'), 'utf8')) as { version: string }).version },
  scenario: { mirrors: MIRRORS, recoveries: RECOVERIES, startCheckClosing: true },
  recoveries: recovered.map(result => result.status),
  steady, overlap, peak, afterForcedEnds: after, unreleasedAtEnd: processLedger.unreleased(),
  profilesAtEnd: readdirSync(temporary).filter(name => name.startsWith('playwright')).length,
  ledger: processLedger.records().map(record => ({ id: record.id, owner: record.owner, end: record.end, slot: record.slot, abandoned: record.callers.abandoned })),
  samples,
};
mkdirSync(out, { recursive: true });
const file = join(out, `${stamp}.json`);
writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
process.stdout.write(`${JSON.stringify({ steady: { browsers: steady.browsersAlive, rssMiB: steady.rssMiB }, peak: { browsers: peak.browsersAlive, rssMiB: peak.rssMiB, slots: peak.slots, sinks: peak.sinks, profiles: peak.profiles, perBrowserMiB: peak.perBrowserMiB }, afterForcedEnds: { browsers: after.browsersAlive, slots: after.slots, sinks: after.sinks, profiles: after.profiles }, unreleasedAtEnd: summary.unreleasedAtEnd, profilesAtEnd: summary.profilesAtEnd, file })}\n`);

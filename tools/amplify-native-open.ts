// Opt-in amplifier for the native Open leg of `nativeFileTransfer` (issue #45; docs/testing.md). It is
// not part of any test command. It runs the real product function N times; through the test launch
// seam (tests/support/native-open.ts) it throttles the renderer's CPU (Emulation.setCPUThrottlingRate)
// from the editor's ready scene until the first file-chooser wait settles, and a probe records every
// file-input click with `navigator.userActivation.isActive` and where keyboard focus was. Each attempt
// is classified from its own terminal record and the probe rows.
//
//   npm run amplify:native-open -- [--runs 30] [--cpu 20]
//
// Writes .local/amplify-native-open/<timestamp>-<commit>-<random>.json (commit, whether the tree and
// src/ had changes, settings, counts, one row per attempt) and keeps every attempt's evidence folder
// beside it.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { nativeFileTransfer } from '../src/evaluation/transfer.ts';
import { h1NativeInput, installLaunchSeam, throttleOpenLeg, openProbeInitScript, OPEN_PROBE_PREFIX } from '../tests/support/native-open.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: number): number => {
  const index = args.indexOf(name), value = index >= 0 ? Number(args[index + 1]) : fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} needs a positive integer`);
  return value;
};
const runs = option('--runs', 30), cpu = option('--cpu', 20);
const git = (...command: string[]): string => spawnSync('git', command, { encoding: 'utf8' }).stdout.trim();
const commit = git('rev-parse', '--short', 'HEAD'), dirty = git('status', '--porcelain').length > 0;
// Whether the product code under src/ differs from the commit (the amplifier itself lives outside src/).
const srcChanged = git('status', '--porcelain', '--', 'src').length > 0;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await mkdir('.local/amplify-native-open', { recursive: true });
const out = await realpath(resolve('.local/amplify-native-open'));
const root = await mkdtemp(join(out, `${stamp}-${commit}-`));

type Probe = { kind: string; userActivation: boolean | null; focusInside: boolean; connected?: boolean; active: string | null; ms: number };
type Row = { attempt: number; ms: number; status: string; stage: string | null; error: string | null; outcome: string; probe: Probe[] };
function classify(terminal: { status?: string; stage?: string; primaryError?: { message?: string } | null } | null, probe: Probe[]): string {
  if (terminal?.status === 'succeeded') return 'passed';
  const message = terminal?.primaryError?.message ?? '';
  if (terminal?.stage !== 'open') return `failed-${terminal?.stage ?? 'unknown'}`;
  if (/focus/i.test(message)) return 'open-focus-outside-editor';
  if (!/filechooser/.test(message)) return 'open-other';
  const clicks = probe.filter(row => row.kind.startsWith('file-input'));
  if (!probe.some(row => row.kind === 'open-keydown')) return 'open-no-shortcut-keydown';
  if (!clicks.length) return 'open-no-file-input-click';
  if (clicks.some(row => row.userActivation === false)) return 'open-file-input-without-user-activation';
  if (clicks.every(row => row.userActivation === true && row.focusInside)) return 'open-chooser-lost-after-activated-click';
  return 'open-other';
}

const input = await h1NativeInput(root); // Before the seam: the input export uses its own real editor.
const rows: Row[] = [], seamErrors: string[] = [];
let probe: Probe[] = [];
const seam = installLaunchSeam({
  initScript: openProbeInitScript,
  page(page, context) {
    page.on('console', message => { const text = message.text(); if (text.startsWith(OPEN_PROBE_PREFIX)) probe.push(JSON.parse(text.slice(OPEN_PROBE_PREFIX.length)) as Probe); });
    throttleOpenLeg(cpu, error => seamErrors.push(String(error)))(page, context);
  },
});
try {
  for (let attempt = 1; attempt <= runs; attempt++) {
    probe = [];
    const outputDirectory = join(root, `attempt-${String(attempt).padStart(2, '0')}`), start = performance.now();
    await nativeFileTransfer({ inputPath: input.inputPath, expectedInputSha256: input.expectedInputSha256, outputDirectory, stepId: 'transfer-step-0' }).catch(() => undefined);
    const terminal = await readFile(join(outputDirectory, 'terminal.json'), 'utf8').then(text => JSON.parse(text) as { status?: string; stage?: string; primaryError?: { message?: string } | null }, () => null);
    const row: Row = { attempt, ms: Math.round(performance.now() - start), status: terminal?.status ?? 'no-terminal', stage: terminal?.stage ?? null,
      error: terminal?.primaryError?.message?.split('\n')[0] ?? null, outcome: classify(terminal, probe), probe };
    rows.push(row);
    console.log(`${String(attempt).padStart(2)}/${runs} ${row.outcome} ${row.ms} ms${row.error ? ` — ${row.error}` : ''}`);
  }
} finally { seam.uninstall(); }

const outcomes: Record<string, number> = {};
for (const row of rows) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
const summary = { tool: 'amplify-native-open/1', commit, dirty, srcChanged, platform: process.platform, node: process.version, runs, cpuThrottlingRate: cpu,
  failures: rows.filter(row => row.outcome !== 'passed').length, openFailures: rows.filter(row => row.stage === 'open' && row.outcome !== 'passed').length,
  outcomes, seamErrors, evidence: root, rows };
const file = `${root}.json`;
await writeFile(file, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ commit, dirty, srcChanged, runs, cpuThrottlingRate: cpu, failures: summary.failures, openFailures: summary.openFailures, outcomes, seamErrors: seamErrors.length, file }));

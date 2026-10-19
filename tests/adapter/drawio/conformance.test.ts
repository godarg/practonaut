// PADR-0049 decision 8.4: "three runs agree", in a form that can fail. Three fresh processes, each with
// its own browser, take every task × case × sequence of the library (the unchanged start, the
// reference, every near miss) in three recorded orders: forward, reverse and a shuffle whose seed is
// recorded. Each run must meet every expectation (every start and near miss fails, every reference
// passes, every step's checks hold, nothing refused by the shell), and the three runs must agree on
// every recorded value: the export after every step, the native file, the PNG and the verdict. The
// summary goes to .local/drawio-conformance/summary.json (no local paths, no part of the archive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DRAWIO_PIN } from '../../../src/adapters/drawio/pin.ts';
import { ADAPTER_REGISTRY } from '../../../src/adapters/registry.ts';
import { drawioAvailability } from '../../support/drawio.ts';
import { plannedSequences, type Order, type RunRecord } from '../../support/drawio-run.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = join(root, '.local/drawio-conformance');
const availability = await drawioAvailability();
/** The node process's and the Chromium tree's bounds (decision 3.6). */
const NODE_RSS_MAX = 1024 ** 3, CHROMIUM_TREE_RSS_MAX = 1.5 * 1024 **3;

/** Per task (a library task, or `family/<family>/<task>`): references passed, near misses and starts failed, each of its total. */
function byTask(record: RunRecord): Record<string, { referencesPassed: string; nearMissesFailed: string; startsFailed: string }> {
  const out: Record<string, { references: [number, number]; nearMisses: [number, number]; starts: [number, number] }> = {};
  for (const sequence of record.sequences) {
    const task = sequence.key.split('/').slice(0, -2).join('/');
    const entry = out[task] ??= { references: [0, 0], nearMisses: [0, 0], starts: [0, 0] };
    const passed = sequence.applied && 'passed' in sequence.verdict ? sequence.verdict.passed : null;
    const slot = sequence.kind === 'reference' ? entry.references : sequence.kind === 'start' ? entry.starts : entry.nearMisses;
    slot[1]++; if (sequence.kind === 'reference' ? passed === true : passed === false) slot[0]++;
  }
  return Object.fromEntries(Object.entries(out).map(([task, e]) => [task, { referencesPassed: `${e.references[0]}/${e.references[1]}`, nearMissesFailed: `${e.nearMisses[0]}/${e.nearMisses[1]}`, startsFailed: `${e.starts[0]}/${e.starts[1]}` }]));
}

function run(order: Order, seed: number, index: number): RunRecord {
  const out = join(OUT, `run-${index}.json`);
  rmSync(out, { force: true });
  const child = spawnSync(process.execPath, ['--import', './tests/support/test-home.ts', 'tests/support/drawio-run.ts', order, String(seed), out], { cwd: root, encoding: 'utf8', timeout: 900_000, env: process.env });
  assert.equal(child.status, 0, `run ${index} (${order}, seed ${seed}) failed:\n${child.stderr.slice(-4000)}`);
  return JSON.parse(readFileSync(out, 'utf8')) as RunRecord;
}

test('the library on draw.io: three fresh runs in three orders meet every expectation and agree on every recorded value', { skip: availability.ok ? false : availability.skip, timeout: 2_700_000 }, () => {
  mkdirSync(OUT, { recursive: true }); rmSync(join(OUT, 'summary.json'), { force: true });
  const shuffleSeed = randomInt(1, 2 ** 31);
  const orders: Array<[Order, number]> = [['forward', 0], ['reverse', 0], ['shuffle', shuffleSeed]];
  const runs = orders.map(([order, seed], index) => run(order, seed, index + 1));
  const planned = plannedSequences().map(sequence => sequence.key);
  const problems: string[] = [];
  for (const record of runs) {
    const where = `${record.order} (seed ${record.seed})`;
    assert.deepEqual([...record.keys].sort(), [...planned].sort(), `${where}: every planned sequence, once`);
    for (const sequence of record.sequences) {
      if (!sequence.applied) { problems.push(`${where} ${sequence.key}: ${sequence.failure}`); continue; }
      if ('refused' in sequence.verdict) { problems.push(`${where} ${sequence.key}: the checker refused the export (${sequence.verdict.refused})`); continue; }
      const expected = sequence.kind === 'reference';
      if (sequence.verdict.passed !== expected) problems.push(`${where} ${sequence.key}: ${sequence.kind} ${sequence.verdict.passed ? 'passed' : 'failed'}`);
    }
    if (record.refusedRequests.length) problems.push(`${where}: the shell refused ${record.refusedRequests.slice(0, 5).join(', ')}`);
    if (record.peakRss.node > NODE_RSS_MAX) problems.push(`${where}: Node peak RSS ${record.peakRss.node} bytes`);
    if (record.peakRss.chromiumTree !== null && record.peakRss.chromiumTree > CHROMIUM_TREE_RSS_MAX) problems.push(`${where}: Chromium tree peak RSS ${record.peakRss.chromiumTree} bytes`);
    // The sandbox is measured, not assumed (review m2c, runtime-1): processes ran, none with --no-sandbox.
    if (record.sandbox === null) problems.push(`${where}: the Chromium processes were not observed`);
    else if (record.sandbox.processes === 0) problems.push(`${where}: no Chromium process was observed`);
    else if (record.sandbox.noSandbox > 0) problems.push(`${where}: ${record.sandbox.noSandbox} Chromium processes ran with --no-sandbox`);
  }
  const chromiumVersions = [...new Set(runs.map(record => record.chromium))];
  if (chromiumVersions.length !== 1 || !chromiumVersions[0]) problems.push(`the runs report Chromium ${chromiumVersions.join(', ')}`);
  // Agreement on every recorded value, sequence by sequence.
  const byKey = runs.map(record => new Map(record.sequences.map(sequence => [sequence.key, sequence])));
  let disagreements = 0;
  for (const key of planned) {
    const [a, ...others] = byKey.map(map => map.get(key)!);
    for (const [index, b] of others.entries()) {
      for (const field of ['exports', 'native', 'png', 'verdict'] as const) {
        if (JSON.stringify(a![field]) !== JSON.stringify(b[field])) { disagreements++; problems.push(`${key}: run 1 and run ${index + 2} differ in ${field}`); }
      }
    }
  }
  const git = (...args: string[]): string | null => { const out = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); return out.status === 0 ? out.stdout : null; };
  const status = git('status', '--porcelain');
  const summary = {
    schema: 'practonaut.drawio-conformance/2',
    // The commit the runs were made on (CI names it; a checkout asks git), never a path, and whether
    // the checkout held changes not in that commit (review m2c: the evidence binds to a clean commit).
    commit: process.env.GITHUB_SHA ?? (git('rev-parse', 'HEAD')?.trim() || null), dirty: status === null ? null : status.trim() !== '',
    platform: `${process.platform}-${process.arch}`, node: process.version,
    playwright: (JSON.parse(readFileSync(join(root, 'node_modules/playwright-core/package.json'), 'utf8')) as { version: string }).version,
    chromium: chromiumVersions.length === 1 ? chromiumVersions[0] : null,
    sandbox: { policy: ADAPTER_REGISTRY.drawio.sandbox, observed: runs.map(record => record.sandbox) },
    pin: { version: DRAWIO_PIN.version, size: DRAWIO_PIN.size, sha256: DRAWIO_PIN.sha256 },
    runs: runs.map(record => ({ order: record.order, seed: record.seed, sequences: record.sequences.length, steps: record.sequences.reduce((n, s) => n + s.steps, 0), startMs: Math.round(record.startMs), peakRss: record.peakRss, refusedRequests: record.refusedRequests.length, chromium: record.chromium, sandbox: record.sandbox, byTask: byTask(record) })),
    disagreements, problems: problems.slice(0, 50),
    sequences: Object.fromEntries(runs[0]!.sequences.map(sequence => [sequence.key, { kind: sequence.kind, exports: sequence.exports, native: sequence.native, png: sequence.png, verdict: sequence.verdict }])),
  };
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  assert.deepEqual(problems, [], `shuffle seed ${shuffleSeed}`);
});

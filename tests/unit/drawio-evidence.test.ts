// PADR-0049 decisions 8.6 and 8.9: the committed draw.io acceptance evidence holds what it claims. Both
// oracle reports are bench/3 at the session level with the real mirror, every run judged on the session
// and on the native export; compare pairs 48 of 48 task identities with equal run counts and no
// difference; the three-run summary is complete and agrees; and no file holds a local path or a draw.io
// release. The re-verification from the stored folders is in tests/integration/drawio-evidence.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBenchReportV3 } from '../../src/bench/report.ts';
import { compareReports } from '../../src/bench/compare.ts';
import { summaryProblems } from '../../tools/require-drawio-summary.ts';

const root = fileURLToPath(new URL('../../', import.meta.url)), dir = join(root, 'docs/benchmarks/drawio');
const report = (name: string) => validateBenchReportV3(JSON.parse(readFileSync(join(dir, name, 'report.json'), 'utf8')));

test('both oracle reports: bench/3, real mirror, every run judged on the session and the native export and passed', () => {
  for (const [name, app, version, world] of [['excalidraw-oracle', 'excalidraw', '0.18.1', 'excalidraw-library'], ['drawio-oracle', 'drawio', '32.4.1', 'drawio-library']] as const) {
    const value = report(name);
    assert.deepEqual([value.verdictLevel, value.environment.app, value.environment.mirror, value.environment.world.source, value.environment.world.worldId], ['session', { adapterId: app, version }, 'required', 'library', world], name);
    assert.deepEqual([value.settings.seeds, value.settings.repeats, value.runs.length], [[0, 2, 4], 1, 48], name);
    for (const run of value.runs as Array<{ id: string; pass: boolean; checker: { session: { passed: boolean }; native: { passed: boolean } | null } | null }>) {
      assert.ok(run.pass && run.checker?.session.passed && run.checker.native?.passed, `${name} ${run.id}`);
    }
  }
});

test('compare pairs all 48 task identities with equal run counts and no different outcome', () => {
  const comparison = compareReports(report('excalidraw-oracle'), report('drawio-oracle'));
  assert.equal(comparison.pairing, 'identity');
  assert.equal(comparison.pairs.length, 48);
  assert.ok(comparison.pairs.every(pair => pair.kind === 'paired' && pair.baseline?.repeats === pair.candidate?.repeats && pair.baseline?.outcome === 'pass' && pair.candidate?.outcome === 'pass'));
  assert.deepEqual([comparison.discordant.baselineOnly, comparison.discordant.candidateOnly], [0, 0]);
  const committed = JSON.parse(readFileSync(join(dir, 'compare.json'), 'utf8')) as { baseline: { verification: string }; candidate: { verification: string }; comparison: { paired: number } };
  assert.deepEqual([committed.baseline.verification, committed.candidate.verification, committed.comparison.paired], ['re-verified', 're-verified', 48]);
});

test('the three-run summary: complete, every run 303 sequences, every task as expected, no disagreement', () => {
  const text = readFileSync(join(dir, 'conformance-summary.json'), 'utf8');
  assert.deepEqual(summaryProblems(text), []);
  const summary = JSON.parse(text) as { runs: Array<{ order: string; sequences: number; refusedRequests: number; byTask: Record<string, { referencesPassed: string; nearMissesFailed: string; startsFailed: string }> }>; pin: { version: string } };
  assert.deepEqual(summary.runs.map(run => run.order), ['forward', 'reverse', 'shuffle']);
  assert.equal(summary.pin.version, '32.4.1');
  for (const run of summary.runs) {
    assert.equal(run.sequences, 303); assert.equal(run.refusedRequests, 0);
    assert.equal(Object.keys(run.byTask).length, 16 + 15);
    for (const [task, counts] of Object.entries(run.byTask)) for (const value of Object.values(counts)) { const [done, total] = value.split('/').map(Number); assert.equal(done, total, `${run.order} ${task}`); }
  }
});

test('no committed evidence file holds a local path or a draw.io release', () => {
  const files = (path: string): string[] => readdirSync(path).flatMap(name => { const full = join(path, name); return statSync(full).isDirectory() ? files(full) : [full]; });
  const all = files(dir);
  assert.ok(all.length > 100);
  for (const file of all) {
    assert.doesNotMatch(file, /\.war$/i);
    const text = readFileSync(file, 'latin1');
    for (const local of [root.replace(/[\\/]$/, ''), '/Users/', '/home/', 'C:\\Users', '\\\\?\\']) assert.ok(!text.includes(local), `${file.slice(root.length)} holds ${local}`);
  }
});

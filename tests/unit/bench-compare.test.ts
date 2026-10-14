// `practonaut compare` (PADR-0039 C) on hand-built reports: every documented verdict — instance
// regression, improvement, decline, not distinguishable, single runs, unjudged runs, incomparable —
// with p-values worked out by hand next to each case, the CLI exit codes, and escaped output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BENCH_SCHEMA_V2, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';
import { compareReports, CompareError, isolationOf } from '../../src/bench/compare.ts';
import { renderCompareHtml, renderCompareTable } from '../../src/bench/render-compare.ts';

const CLI = new URL('../../src/cli/main.ts', import.meta.url).pathname;
const hash = (c: string): string => c.repeat(64);
type Verdict = boolean | null;
/** A consistent command-agent report; `outcomes[task][seed]` lists each repeat's verdict (null: not judged). */
function report(outcomes: Record<string, Record<number, Verdict[]>>, changes: (value: BenchReportV2) => void = () => {}): BenchReportV2 {
  const tasks = Object.keys(outcomes), seeds = [...new Set(tasks.flatMap(task => Object.keys(outcomes[task]!).map(Number)))].sort((a, b) => a - b);
  const repeats = Math.max(...tasks.flatMap(task => seeds.map(seed => outcomes[task]![seed]!.length)));
  const runs: BenchRunV2[] = tasks.flatMap(taskId => seeds.flatMap(seed => outcomes[taskId]![seed]!.map((verdict, index): BenchRunV2 => {
    const checker = verdict === null ? null : { session: { passed: verdict, errorClasses: verdict ? [] : ['extra-arrow'] }, native: null };
    return { id: `${taskId}-s${seed}-r${index + 1}`, taskId, seed, repeat: index + 1, status: verdict === null ? 'infra_error' : 'completed', pass: verdict === true, actions: 1, acceptedActions: 1, rejectedActions: 0, undos: 0, resets: 0,
      toolCalls: { observe: 1, act: 1, undo: 0, reset: 0, check: 0, total: 2 }, wallMs: 100, referenceActions: null, checker, agentExitCode: verdict === null ? null : 0, ...(checker ? { artifacts: { session: hash('a'), native: null, checker: hash('c') } } : {}) };
  })));
  const value: BenchReportV2 = {
    schema: BENCH_SCHEMA_V2, createdAt: '2026-10-14T12:00:00.000Z',
    environment: { practonaut: '0.2.0-dev.0', excalidraw: '0.18.1', node: 'v22.22.3', os: { platform: 'linux', release: '6.8.0', arch: 'x64' }, mirror: 'off',
      world: { source: 'own', worldId: 'my-world', version: '1.0.0', contentHash: hash('d'), package: { path: 'world.pnworld', sha256: hash('e') }, generated: [] } },
    agent: { kind: 'command', name: 'generic', command: ['agent', '{mcp_config}'], isolation: 'template-unrestricted', model: 'model-a', modelSource: 'command-output', apiKeySource: null, keptEnv: [] },
    settings: { tasks, seeds, repeats, timeoutSeconds: 300, maxActions: 50, mirror: 'off', prompt: 'p' },
    references: null, runs, summary: summarize(runs, repeats),
  };
  changes(value);
  value.summary = summarize(value.runs, value.settings.repeats);
  return validateBenchReportV2(value);
}
/** n instances (task T, seeds 1 … n), each with the given repeats. */
const instances = (rows: Verdict[][]): Record<string, Record<number, Verdict[]>> => ({ T: Object.fromEntries(rows.map((row, index) => [index + 1, row])) });
const times = (n: number, row: Verdict[]): Verdict[][] => Array.from({ length: n }, () => row);

test('instance regression: three repeats a side, all passed on the baseline, all failed on the candidate', () => {
  const baseline = report(instances([[true, true, true], [true, true, true], [false, false, false]]));
  const candidate = report(instances([[false, false, false], [true, false, true], [true, true, true]]));
  const comparison = compareReports(baseline, candidate);
  assert.deepEqual(comparison.regressions.map(pair => [pair.taskId, pair.seed]), [['T', 1]]);
  assert.deepEqual(comparison.fixes.map(pair => pair.seed), [3]);
  // Seed 2: 3/3 → 2/3 passes on both aggregates (at least half): not a flip at all.
  assert.equal(comparison.pairs[1]!.flip, null);
  // A majority flip with three repeats a side that not every repeat shows: named, never a regression,
  // and one of McNemar's discordant instances. Baseline [pass, pass, fail] → candidate [fail, fail, pass].
  const changed = compareReports(report(instances([[true, true, false]])), report(instances([[false, false, true]])));
  assert.deepEqual([changed.pairs[0]!.flip, changed.regressions.length, changed.discordant.baselineOnly], ['changed-down', 0, 1]);
  assert.deepEqual(changed.changedFlips.map(pair => pair.seed), [1]);
  const changedText = renderCompareTable({ report: report(instances([[true, true, false]])), verification: 'consistency-checked' }, { report: report(instances([[false, false, true]])), verification: 'consistency-checked' }, changed);
  assert.match(changedText, /Outcome changed, not in every repeat — not a regression signal:\n  T · seed 1: passed on the baseline \(2\/3\), failed on the candidate \(1\/3\)/);
  const changedHtml = renderCompareHtml({ report: report(instances([[true, true, false]])), verification: 'consistency-checked' }, { report: report(instances([[false, false, true]])), verification: 'consistency-checked' }, changed, ':root{}');
  assert.match(changedHtml, /<td class="text">outcome changed, not in every repeat — not a regression signal<\/td>/);
  assert.equal(changedHtml.includes('same outcome'), false);
  assert.equal(comparison.regressionSignal, true);
  // b = 1 (seed 1), c = 1 (seed 3): p = min(1, 2 · P(X ≤ 1 | n = 2)) = min(1, 2 · 3/4) = 1.
  assert.deepEqual([comparison.discordant, comparison.p, comparison.verdict], [{ baselineOnly: 1, candidateOnly: 1 }, 1, 'not_distinguishable']);
  const text = renderCompareTable({ report: baseline, verification: 'consistency-checked' }, { report: candidate, verification: 'consistency-checked' }, comparison);
  assert.match(text, /Instance regressions:\n  ✗ T · seed 1: passed 3\/3 on the baseline, failed 3\/3 on the candidate/);
  assert.match(text, /Instance fixes:\n  ✓ T · seed 3/);
});

test('single runs are never a regression: a flip is listed as "single runs — not a regression signal"', () => {
  const comparison = compareReports(report(instances([[true], [true]])), report(instances([[false], [true]])));
  assert.deepEqual([comparison.regressions.length, comparison.regressionSignal], [0, false]);
  assert.deepEqual(comparison.singleFlips.map(pair => [pair.seed, pair.flip]), [[1, 'single-down']]);
  // Two repeats on one side are still not three.
  assert.equal(compareReports(report(instances([[true, true, true]])), report(instances([[false, false]]))).regressions.length, 0);
  const text = renderCompareTable({ report: report(instances([[true], [true]])), verification: 'consistency-checked' }, { report: report(instances([[false], [true]])), verification: 'consistency-checked' }, comparison);
  assert.match(text, /Instance regressions: single runs — not a regression signal/);
  assert.match(text, /Single runs — not a regression signal:\n  T · seed 1: passed on the baseline \(1\/1\), failed on the candidate \(0\/1\)/);
});

test('rate verdicts: exact McNemar on the discordant instances at α = 0.05', () => {
  // c = 6, b = 0: p = 2 · 2⁻⁶ = 0.03125 < 0.05 → improvement.
  const improved = compareReports(report(instances([...times(6, [false]), ...times(4, [true])])), report(instances(times(10, [true]))));
  assert.deepEqual([improved.verdict, improved.discordant], ['improvement', { baselineOnly: 0, candidateOnly: 6 }]);
  assert.ok(Math.abs(improved.p - 0.03125) < 1e-12);
  assert.deepEqual([improved.baseline.passed, improved.candidate.passed, improved.paired], [4, 10, 10]);
  // c = 5, b = 0: p = 2 · 2⁻⁵ = 0.0625 → not distinguishable, although 5 of 10 instances changed.
  const close = compareReports(report(instances([...times(5, [false]), ...times(5, [true])])), report(instances(times(10, [true]))));
  assert.equal(close.verdict, "not_distinguishable"); assert.ok(Math.abs(close.p - 0.0625) < 1e-12);
  // b = 7, c = 1: p = 2 · (1 + 8) / 256 = 0.0703 → not distinguishable; b = 8, c = 1: 2 · 10/512 = 0.039 → decline.
  assert.equal(compareReports(report(instances([...times(8, [true]), [false]])), report(instances([...times(7, [false]), [true], [true]]))).verdict, 'not_distinguishable');
  const declined = compareReports(report(instances([...times(9, [true]), [false]])), report(instances([...times(8, [false]), [true], [true]])));
  assert.deepEqual([declined.verdict, declined.discordant], ['decline', { baselineOnly: 8, candidateOnly: 1 }]);
  assert.ok(Math.abs(declined.p - 20 / 512) < 1e-12);
  const text = renderCompareTable({ report: report(instances(times(10, [true]))), verification: 're-verified' }, { report: report(instances(times(10, [true]))), verification: 'consistency-checked' }, close);
  assert.match(text, /Verdict: not distinguishable at this n \(exact McNemar p = 0\.063; 0 only on the baseline, 5 only on the candidate\)/);
  // Each side carries its mirror, isolation level and verification status (vision §6, principle 4).
  assert.match(text, /^Baseline: generic · model model-a \(self-reported, from the command output\) · model only \(no mirror\) · template: tools not restricted by Practonaut · re-verified from the artifacts · 2026-10-14$/m);
  assert.match(text, /^Candidate: generic · .* · model only \(no mirror\) · template: tools not restricted by Practonaut · consistency-checked, not re-verified · /m);
  const page = renderCompareHtml({ report: report(instances(times(10, [true]))), verification: 're-verified' }, { report: report(instances(times(10, [true]))), verification: 'consistency-checked' }, close, ':root{}', 'de');
  assert.equal((page.match(/nur Modell \(keine Spiegelung\) · Vorlage: Werkzeuge nicht von Practonaut eingeschränkt/g) ?? []).length, 2);
  assert.match(text, /Baseline: 5\/10 instances passed · 95 % interval 23–77 % over the 10 instances judged on both sides/);
});

test('unjudged runs and missing instances are listed, never counted', () => {
  // Seed 2 has no judged run on the candidate; an unjudged repeat beside judged ones does not count.
  const baseline = report(instances([[true, true, true], [true, true, true], [false, false, false]]));
  const candidate = report(instances([[true, null, true], [null, null, null], [true, null, false]]));
  const comparison = compareReports(baseline, candidate);
  assert.deepEqual(comparison.notCompared.map(pair => [pair.seed, pair.kind, pair.side]), [[2, 'unjudged', 'candidate']]);
  assert.equal(comparison.paired, 2);
  assert.deepEqual(comparison.pairs[2]!.candidate, { repeats: 3, judged: 2, passed: 1, outcome: 'pass' });
  assert.equal(comparison.regressions.length, 0, 'two judged repeats are not three');
  const missing = report(instances([[true], [true]]), value => { value.runs = value.runs.slice(0, 1); value.interrupted = { plannedRuns: 2 }; });
  const partial = compareReports(report(instances([[true], [true]])), missing);
  assert.deepEqual(partial.notCompared.map(pair => [pair.seed, pair.kind, pair.side]), [[2, 'missing', 'candidate']]);
  assert.match(renderCompareTable({ report: baseline, verification: 'consistency-checked' }, { report: candidate, verification: 'consistency-checked' }, comparison), /Not compared:\n  T · seed 2: no judged run on the candidate \(infrastructure\)/);
});

test('incomparable reports are refused, naming every difference', () => {
  const base = report(instances([[true]]));
  const differs = (change: (value: BenchReportV2) => void): string[] => {
    try { compareReports(base, report(instances([[true]]), change)); return []; }
    catch (error) { assert.ok(error instanceof CompareError); return error.differences.map(difference => difference.field); }
  };
  assert.deepEqual(differs(value => { value.environment.world.contentHash = hash('f'); }), ['world']);
  assert.deepEqual(differs(value => { value.settings.maxActions = 20; }), ['budget']);
  assert.deepEqual(differs(value => { value.environment.mirror = 'required'; value.settings.mirror = 'required'; for (const run of value.runs) { run.checker!.native = { passed: true, errorClasses: [] }; run.artifacts!.native = hash('b'); } }), ['mirror']);
  assert.deepEqual(differs(value => { value.agent = { ...value.agent, kind: 'preset', name: 'claude-code', isolation: 'tool-restricted-preset', modelSource: 'client-attested' }; }), ['isolation']);
  const grid = report({ T: { 1: [true], 2: [true] } });
  assert.throws(() => compareReports(base, grid), (error: CompareError) => error.differences.map(difference => difference.field).join() === 'grid');
  // Timeout and repeats may differ; they are named as caveats.
  const slower = compareReports(base, report(instances([[true, true]]), value => { value.settings.timeoutSeconds = 60; }));
  assert.deepEqual(slower.caveats.map(caveat => caveat.field), ['timeout', 'repeats']);
  // A /1 report has no isolation field; it follows from the agent kind (PADR-0036).
  assert.equal(isolationOf({ schema: 'practonaut.bench/1', agent: { kind: 'builtin' } } as never), 'builtin-baseline');
});

test('CLI: the verdicts by exit code; incomparable and --fail-on-regression exit 2 by name; the HTML escapes report text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pn-compare-'));
  try {
    const write = (name: string, value: BenchReportV2): string => { const path = join(dir, name); writeFileSync(path, JSON.stringify(value)); return path; };
    const baseline = write('a.json', report(instances([[true, true, true], [true, true, true]]), value => { value.label = '<b>baseline</b>‮'; }));
    const candidate = write('b.json', report(instances([[false, false, false], [true, true, true]])));
    const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, 'compare', ...args], { encoding: 'utf8' });
    const plain = cli(baseline, candidate, '--html', join(dir, 'c.html'));
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /T · seed 1: passed 3\/3 on the baseline, failed 3\/3 on the candidate/);
    const gated = cli(baseline, candidate, '--fail-on-regression');
    assert.equal(gated.status, 2); assert.match(gated.stderr, /1 instance regression .*T seed 1 \[instance_regression\]/);
    assert.equal(cli(baseline, baseline, '--fail-on-regression').status, 0, 'no regression: the gate passes');
    const other = write('d.json', report(instances([[true, true, true], [true, true, true]]), value => { value.settings.maxActions = 10; value.environment.mirror = 'off'; }));
    const refused = cli(baseline, other);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the action budget differs \(50 on the baseline, 10 on the candidate\).*\[compare_incomparable\]/);
    const json = JSON.parse(cli(baseline, candidate, '--json').stdout);
    assert.deepEqual([json.comparison.regressions.length, json.comparison.verdict], [1, 'not_distinguishable']);
    const html = renderCompareHtml({ report: report(instances([[true]]), value => { value.label = '<img src=x onerror=alert(1)>'; }), verification: 'consistency-checked' }, { report: report(instances([[true]])), verification: 'consistency-checked' }, compareReports(report(instances([[true]])), report(instances([[true]]))), ':root{}');
    assert.equal(html.includes('<img'), false); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(/<script|style="|data:/i.test(html), false);
    assert.equal(cli(baseline).status, 1, 'two reports are needed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// `practonaut compare` (PADR-0039 C) on hand-built reports: every documented verdict — instance
// regression, improvement, decline, not distinguishable, single runs, unjudged runs, an incomplete
// candidate, nothing paired, incomparable — with p-values worked out by hand next to each case, the
// CLI exit codes, and escaped output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BENCH_SCHEMA_V2, summarize, validateBenchReport, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';
import { compareReports, CompareError, isolationOf } from '../../src/bench/compare.ts';
import { renderCompareHtml, renderCompareTable } from '../../src/bench/render-compare.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
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
  assert.match(changedHtml, /<td data-label="change" class="text prose">outcome changed, not in every repeat — not a regression signal<\/td>/);
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
  assert.match(text, /Verdict: rate difference not distinguishable at this n \(exact McNemar p = 0\.063; 0 only on the baseline, 5 only on the candidate\)/);
  // Each side carries its mirror, isolation level and verification status (vision §6, principle 4).
  assert.match(text, /^Baseline: generic · session verdict · model model-a \(self-reported, from the command output\) · model only \(no mirror\) · template: tools not restricted by Practonaut · re-verified from the artifacts · 2026-10-14$/m);
  assert.match(text, /^Candidate: generic · .* · model only \(no mirror\) · template: tools not restricted by Practonaut · consistency-checked, not re-verified · /m);
  const page = renderCompareHtml({ report: report(instances(times(10, [true]))), verification: 're-verified' }, { report: report(instances(times(10, [true]))), verification: 'consistency-checked' }, close, ':root{}', 'de');
  assert.equal((page.match(/<li class="chip"><span>nur Modell \(keine Spiegelung\)<\/span><\/li><li class="chip"><span>Vorlage: Werkzeuge nicht von <span class="name">Practonaut<\/span> eingeschränkt<\/span><\/li>/g) ?? []).length, 2);
  assert.match(text, /Baseline: 5\/10 instances passed · 95 % interval 23–77 % over the 10 instances on both sides/);
});

test('every run counts: a run that was not judged counts as not passed, is named, and leaves the candidate incomplete', () => {
  const baseline = report(instances([[true, true, true], [true, true, true], [false, false, false]]));
  const candidate = report(instances([[true, null, true], [null, null, null], [true, null, false]]));
  const comparison = compareReports(baseline, candidate);
  // Seed 2 has no judged run on the candidate: it is compared, as a fail (0 of 3 passed), never left out.
  assert.deepEqual([comparison.paired, comparison.notCompared.length], [3, 0]);
  assert.deepEqual(comparison.pairs[1]!.candidate, { repeats: 3, judged: 0, unjudged: 3, passed: 0, outcome: 'fail' });
  // Seed 3: 1 of 3 passed, one not judged: a fail. Over judged runs only it would be 1 of 2, a pass.
  assert.deepEqual(comparison.pairs[2]!.candidate, { repeats: 3, judged: 2, unjudged: 1, passed: 1, outcome: 'fail' });
  // b = 1 (seed 2 passed only on the baseline), c = 0; the candidate rate counts every run.
  assert.deepEqual([comparison.discordant, comparison.candidate.passed], [{ baselineOnly: 1, candidateOnly: 0 }, 1]);
  assert.equal(comparison.regressions.length, 0, 'no judged candidate repeat on seed 2: not an instance regression');
  assert.deepEqual(comparison.withUnjudged.map(pair => pair.seed), [1, 2, 3]);
  assert.deepEqual(comparison.incomplete.map(pair => pair.seed), [1, 2, 3]);
  const text = renderCompareTable({ report: baseline, verification: 'consistency-checked' }, { report: candidate, verification: 'consistency-checked' }, comparison);
  // Seed 2 had no verdict at all on the candidate: it did not fail there, so it is never "failed on the
  // candidate (0/3)" — it is named with the runs not judged, under "?".
  assert.match(text, /Runs not judged:\n  \? T · seed 1: 1 run not judged on the candidate, counted as not passed\n  \? T · seed 2: passed on the baseline \(3\/3\), no verdict on the candidate \(3 of 3 runs not judged, counted as not passed\)/);
  assert.equal(text.includes('failed on the candidate (0/3)'), false);
  const page = renderCompareHtml({ report: baseline, verification: 'consistency-checked' }, { report: candidate, verification: 'consistency-checked' }, comparison, ':root{}').replace(/\u00a0/g, ' ');
  // In the instance table and the list: the unknown mark (a dashed ring) with "no verdict", never the fail mark.
  assert.match(page, /<td data-label="candidate" class="text"><span class="outcome"><svg class="status-icon unknown"[^>]*><circle [^>]*stroke-dasharray="2\.4 3"\/><\/svg>no verdict \(3 of 3 runs not judged\), counted as not passed<\/span><\/td><td data-label="change" class="text prose">no verdict on one side — not a regression signal<\/td>/);
  assert.match(page, /<li><svg class="status-icon unknown"[^>]*>.*?<\/svg><span><code class="id">T<\/code> · seed 2: passed on the baseline \(3\/3\), no verdict on the candidate/);
  assert.equal(page.includes('failed on the candidate (0/3)'), false);
  assert.match(text, /The candidate is incomplete: 3 instances are missing, cut short or hold a run that was not judged\./);
  assert.deepEqual(compareReports(baseline, baseline).incomplete, [], 'a complete candidate');
  // An interrupted candidate: the instance it never ran is listed, left out and incomplete.
  const missing = report(instances([[true], [true]]), value => { value.runs = value.runs.slice(0, 1); value.interrupted = { plannedRuns: 2 }; });
  const partial = compareReports(report(instances([[true], [true]])), missing);
  assert.deepEqual(partial.notCompared.map(pair => [pair.seed, pair.kind, pair.side]), [[2, 'missing', 'candidate']]);
  assert.deepEqual(partial.incomplete.map(pair => pair.seed), [2]);
  // Fewer repeats than planned (cut short) is incomplete too.
  const short = report(instances([[true, true, true]]), value => { value.runs = value.runs.slice(0, 2); value.interrupted = { plannedRuns: 3 }; });
  assert.deepEqual(compareReports(report(instances([[true, true, true]])), short).incomplete.map(pair => pair.candidate!.repeats), [2]);
  // No instance on both sides: nothing to test, said so (not "not distinguishable").
  const onlyFirst = report(instances([[true], [true]])), onlySecond = report(instances([[true], [true]]));
  onlyFirst.runs = onlyFirst.runs.filter(run => run.seed === 1); onlySecond.runs = onlySecond.runs.filter(run => run.seed === 2);
  const nothing = compareReports(onlyFirst, onlySecond);
  assert.deepEqual([nothing.verdict, nothing.paired], ['nothing_paired', 0]);
  assert.match(renderCompareTable({ report: onlyFirst, verification: 'consistency-checked' }, { report: onlySecond, verification: 'consistency-checked' }, nothing), /Verdict: nothing to compare: no instance has runs on both sides/);
  assert.match(renderCompareHtml({ report: onlyFirst, verification: 'consistency-checked' }, { report: onlySecond, verification: 'consistency-checked' }, nothing, ':root{}'), /<p class="verdict">Nothing to compare: no instance has runs on both sides\.<\/p>/);
});

test('a built-in side carries one chip that says "no language model", not two', () => {
  const builtin = (value: BenchReportV2): void => { value.agent = { kind: 'builtin', name: 'oracle', command: [], isolation: 'builtin-baseline', model: null, modelSource: 'none', apiKeySource: null, keptEnv: [] }; };
  const side = { report: report(instances([[true]]), builtin), verification: 'consistency-checked' as const };
  const comparison = compareReports(side.report, side.report);
  for (const [language, words] of [['en', 'no language model'], ['de', 'kein Sprachmodell|ohne Sprachmodell']] as const) {
    const page = renderCompareHtml(side, side, comparison, ':root{}', language);
    const chips = [...page.matchAll(/<li class="chip"><span>([\s\S]*?)<\/span><\/li>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ''));
    // Two sides, one such chip each.
    assert.equal(chips.filter(chip => new RegExp(words).test(chip)).length, 2, `${language}: ${chips.join(' | ')}`);
  }
  assert.match(renderCompareTable(side, side, comparison), /^Baseline: oracle · session verdict · model only \(no mirror\) · built-in baseline: no language model, MCP only · consistency-checked, not re-verified · 2026-10-14$/m);
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
  // A /1 report has no isolation field; it follows from the agent kind (PADR-0036): the committed /1
  // fixture's agent is the built-in oracle.
  assert.equal(isolationOf(validateBenchReport(JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/bench/v1/report.json', import.meta.url)), 'utf8')))), 'builtin-baseline');
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
    // One run of the candidate was not judged: two judged failures are not three, so no regression is
    // found, but the gate must not pass it as "no regression".
    const hidden = write('h.json', report(instances([[false, false, null], [true, true, true]])));
    const incomplete = cli(baseline, hidden, '--fail-on-regression');
    assert.equal(incomplete.status, 2, incomplete.stdout); assert.match(incomplete.stderr, /the candidate is incomplete: 1 instance is missing, cut short or holds a run that was not judged \(T seed 1\).*\[compare_incomplete\]/);
    assert.equal(cli(baseline, hidden).status, 0, 'without the gate it is a report, not a failure');
    // The page names each side by its label or file name.
    const named = readFileSync(join(dir, 'c.html'), 'utf8');
    assert.match(named, /<h1>&lt;b&gt;baseline&lt;\/b&gt;\\u\{202e\} \(baseline\) → b \(candidate\)<\/h1>/);
    const other = write('d.json', report(instances([[true, true, true], [true, true, true]]), value => { value.settings.maxActions = 10; value.environment.mirror = 'off'; }));
    const refused = cli(baseline, other, '--html', join(dir, 'refused.html'));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the action budget differs \(50 on the baseline, 10 on the candidate\).*\[compare_incomparable\]/);
    // With --html the refusal is a page that names every difference.
    const refusal = readFileSync(join(dir, 'refused.html'), 'utf8').replace(/\u00a0/g, ' ');
    assert.match(refusal, /<p class="headline">Not comparable\.<\/p>/); assert.match(refusal, /<p class="banner-title">What differs<\/p>/); assert.match(refusal.replace(/<\/?span[^>]*>/g, ''), /Action budget: 50 on the baseline, 10 on the candidate/);
    assert.equal(existsSync(join(dir, 'refused.html')) && !/<script|style="/i.test(refusal), true);
    assert.match(refused.stderr, /\. Bench the baseline again with the candidate's settings \[compare_incomparable\]/);
    // The isolation level follows from the agent kind, so no flag of the candidate's makes the oracle a
    // baseline for a command template: the refusal says which kind to bench instead (EN, DE, the page).
    const oracle = write('o.json', report(instances([[true, true, true], [true, true, true]]), value => { value.agent = { kind: 'builtin', name: 'oracle', command: [], isolation: 'builtin-baseline', model: null, modelSource: 'none', apiKeySource: null, keptEnv: [] }; }));
    const kinds = cli(oracle, candidate, '--html', join(dir, 'kinds.html'));
    assert.equal(kinds.status, 2);
    assert.match(kinds.stderr, /the isolation level differs \(builtin-baseline on the baseline, template-unrestricted on the candidate\)\. The isolation level follows from the agent kind for a built-in or a command template, and for a preset from its runs' evidence \(tool-restricted only when its client listed exactly Practonaut's tools\): oracle and random compare only with a built-in, a tool-restricted preset only with itself, a command template only with a command template or an unrestricted preset\. As the baseline, bench a configuration of the candidate's agent kind that you trust, with the candidate's settings \[compare_incomparable\]/);
    assert.equal(kinds.stderr.includes('Bench the baseline again'), false);
    assert.match(readFileSync(join(dir, 'kinds.html'), 'utf8').replace(/ /g, ' '), /<p>The isolation level follows from the agent kind for a built-in or a command template, and for a preset from its runs’ evidence .*As the baseline, bench a configuration of the candidate’s agent kind that you trust, with the candidate’s settings, then compare\.<\/p>/);
    const german = spawnSync(process.execPath, [CLI, '--lang', 'de', 'compare', oracle, candidate], { encoding: 'utf8' });
    assert.equal(german.status, 2);
    assert.match(german.stderr, /Die Isolationsstufe folgt bei einer eingebauten Vergleichsbasis und einer Befehlsvorlage aus der Art des Agenten, bei einer Voreinstellung aus dem Nachweis ihrer Läufe .* Als Basis eine vertrauenswürdige Konfiguration derselben Agentenart wie beim Kandidaten benchen, mit dessen Einstellungen \[compare_incomparable\]/);
    const json = JSON.parse(cli(baseline, candidate, '--json').stdout);
    assert.deepEqual([json.comparison.regressions.length, json.comparison.verdict], [1, 'not_distinguishable']);
    const html = renderCompareHtml({ report: report(instances([[true]]), value => { value.label = '<img src=x onerror=alert(1)>'; }), verification: 'consistency-checked' }, { report: report(instances([[true]])), verification: 'consistency-checked' }, compareReports(report(instances([[true]])), report(instances([[true]]))), ':root{}');
    assert.equal(html.includes('<img'), false); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.equal(/<script|style="|data:/i.test(html), false);
    assert.equal(cli(baseline).status, 1, 'two reports are needed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Bench report: pass^k arithmetic, the validator's re-derivation of every pass and aggregate,
// the committed JSON Schema read independently from its file, and the HTML rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { BENCH_SCHEMA_V1, passHatK, summarize, validateBenchReport, type BenchReportV1 as BenchReport, type BenchRunV1 as BenchRun } from '../../src/bench/report.ts';
import { renderHtml, renderTable } from '../../src/bench/render.ts';

function run(taskId: string, seed: number, repeat: number, verdict: boolean | null, native: boolean | null = verdict, actions = 2): BenchRun {
  const checker = verdict === null ? null : { session: { passed: verdict, errorClasses: verdict ? [] : ['missing-arrow'] }, native: native === null ? null : { passed: native, errorClasses: [] } };
  const pass = checker !== null && checker.native !== null && checker.session.passed && checker.native.passed;
  return { id: `${taskId}-s${seed}-r${repeat}`, taskId, seed, repeat, status: verdict === null ? 'infra_error' : 'completed', pass, actions, acceptedActions: actions, rejectedActions: 1, undos: 0, resets: 0,
    toolCalls: { observe: 3, act: actions + 1, undo: 0, reset: 0, check: 1, total: 3 + actions + 1 + 1 }, wallMs: 1000, referenceActions: 1, checker, agentExitCode: verdict === null ? null : 0 };
}
export function report(runs: BenchRun[], repeats: number, tasks: string[], seeds: number[]): BenchReport {
  return {
    schema: BENCH_SCHEMA_V1, createdAt: '2026-10-12T20:00:00.000Z',
    environment: { practonaut: '0.1.0-dev.0', excalidraw: '0.18.1', node: 'v22.22.3', os: { platform: 'darwin', release: '27.0.0', arch: 'arm64' }, mirror: 'required', library: { worldId: 'excalidraw-library', version: '1.1.0', contentHash: 'a'.repeat(64) } },
    agent: { kind: 'builtin', name: 'oracle', command: [], model: null, modelSource: 'none' },
    settings: { tasks, seeds, repeats, timeoutSeconds: 300, maxActions: 50, mirror: 'auto', prompt: '' },
    runs, summary: summarize(runs, repeats),
  };
}
const fixture = (): BenchReport => report([run('connect', 1, 1, true), run('connect', 1, 2, false), run('connect', 2, 1, true), run('connect', 2, 2, true), run('decision', 1, 1, true), run('decision', 1, 2, null), run('decision', 2, 1, false), run('decision', 2, 2, false)], 2, ['connect', 'decision'], [1, 2]);

test('pass^k follows the tau-bench estimator C(c,k)/C(n,k), averaged over task instances', () => {
  // One instance, n=4, c=2: pass^1 = 2/4, pass^2 = C(2,2)/C(4,2) = 1/6, pass^3 = 0.
  assert.equal(passHatK([{ n: 4, c: 2 }], 1), 0.5);
  assert.equal(passHatK([{ n: 4, c: 2 }], 2), 0.1667);
  assert.equal(passHatK([{ n: 4, c: 2 }], 3), 0);
  // Two instances: (4,4) gives 1 for every k, (4,2) gives 1/6 at k=2: mean (1 + 1/6) / 2.
  assert.equal(passHatK([{ n: 4, c: 4 }, { n: 4, c: 2 }], 2), 0.5833);
  const summary = fixture().summary;
  assert.equal(summary.passAt1, 0.5);
  assert.deepEqual(summary.passHatK, [{ k: 1, value: 0.5 }, { k: 2, value: 0.25 }]);
  assert.equal(summary.infraErrors, 1); assert.equal(summary.judged, 7);
});

test('a consistent report validates; every forged or inconsistent field is rejected', () => {
  assert.doesNotThrow(() => validateBenchReport(fixture()));
  const forged = (mutate: (value: BenchReport) => void, message: RegExp): void => {
    const value = structuredClone(fixture()); mutate(value);
    assert.throws(() => validateBenchReport(value), (error: Error & { code?: string }) => error.code === 'bench_report_invalid' && message.test(error.message), message.source);
  };
  // A pass without any independent verdict (the infra-error run claims success).
  forged(value => { value.runs[5]!.pass = true; value.summary = summarize(value.runs, 2); }, /checker verdicts give pass=false/);
  // A pass against a failed session verdict, with the summary recomputed to match the lie.
  forged(value => { value.runs[1]!.pass = true; value.summary = summarize(value.runs, 2); }, /claims pass=true/);
  // Verdict removed from a completed run.
  forged(value => { value.runs[0]!.checker = null; }, /no independent checker verdict/);
  // A mirrored report without the native-export verdict.
  forged(value => { value.runs[0]!.checker!.native = null; }, /native-export verdict/);
  // Aggregates edited by hand.
  forged(value => { value.summary.passAt1 = 0.9; }, /summary does not follow/);
  forged(value => { value.summary.passHatK[1]!.value = 0.5; }, /summary does not follow/);
  // Runs dropped or duplicated.
  forged(value => { value.runs.pop(); value.summary = summarize(value.runs, 2); }, /report has 7 runs, but its settings plan 8/);
  forged(value => { value.runs[7] = structuredClone(value.runs[6]!); value.summary = summarize(value.runs, 2); }, /appears twice/);
  // Counter arithmetic that the host could not have produced.
  forged(value => { value.runs[0]!.toolCalls.total += 1; }, /total does not add up/);
  forged(value => { value.runs[0]!.acceptedActions += 3; value.summary = summarize(value.runs, 2); }, /act calls must equal/);
  forged(value => { value.runs[0]!.actions += 3; value.summary = summarize(value.runs, 2); }, /final history holds more actions than the host accepted/);
  forged(value => { value.runs[1]!.referenceActions = 5; value.summary = summarize(value.runs, 2); }, /another reference length/);
  // Unknown fields and the wrong schema name.
  forged(value => { (value as unknown as Record<string, unknown>).verdict = 'pass'; }, /does not match practonaut\.bench\/1/);
  forged(value => { (value as unknown as Record<string, unknown>).schema = 'practonaut.bench/2'; }, /does not match/);
});

test('schemas/bench.v1.json, read from the file, accepts the report and rejects extra or missing fields', () => {
  const schema = z.fromJSONSchema(JSON.parse(readFileSync(new URL('../../schemas/bench.v1.json', import.meta.url), 'utf8')) as Parameters<typeof z.fromJSONSchema>[0]);
  const value = fixture();
  assert.equal(schema.safeParse(JSON.parse(JSON.stringify(value))).success, true);
  assert.equal(schema.safeParse({ ...value, extra: 1 }).success, false);
  const noChecker = structuredClone(value) as unknown as { runs: Array<Record<string, unknown>> }; delete noChecker.runs[0]!.checker;
  assert.equal(schema.safeParse(noChecker).success, false);
  assert.equal(schema.safeParse({ ...value, schema: 'practonaut.bench/2' }).success, false);
});

test('HTML is static and self-contained, escapes report text and never shows status by colour alone', () => {
  const value = fixture(); value.agent = { kind: 'command', name: 'generic', command: ['my-agent', '<script>alert(1)</script>', '{mcp_config}'], model: null, modelSource: 'none' };
  const html = renderHtml(value, ':root{--pn-color-bg:Canvas}');
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'/);
  assert.equal(html.includes('<script'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(/\bsrc=|href="(?!#run-)/.test(html), false, 'no external or linked asset; links only to the page\'s own run details');
  // Status is a word beside a shape (the kit's filled circle with a tick or a cross), never colour alone.
  assert.match(html, /<span class="result pass"><svg class="status-icon pass" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle [^>]*\/><path d="M7\.7 12\.4l3 3 5\.6-6" [^>]*\/><\/svg>pass<\/span>/);
  assert.match(html, /<span class="result fail"><svg class="status-icon fail" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle [^>]*\/><path d="M9 9l6 6M15 9l-6 6" [^>]*\/><\/svg>fail<\/span>/);
  const table = renderTable(value);
  // Instances (PADR-0039 B.1): connect s1 [pass, fail] and s2 [pass, pass] pass (at least half of all
  // their runs), decision s1 [pass, not judged] passes with 1 of 2 (the unjudged run counts as not
  // passed; half is enough), decision s2 [fail, fail] fails: 3/4.
  // Wilson 3/4 by hand: centre (0.75 + 0.4802) / 1.9604 = 0.6275, half 0.3269 → 30.06–95.44 %, shown 30–96 %.
  assert.match(table, /^4\/8 runs passed · 3\/4 instances passed \(at least half of all their runs\) · 95 % interval 30–96 % over 4 instances · session verdict · consistency-checked, not re-verified · real Excalidraw mirror · isolation not recorded \(bench\/1\) · model not reported$/m);
  assert.match(table, /^1 not judged \(infrastructure\), counted as not passed$/m);
  assert.match(table, /^n = 8 runs · 2 seeds · 2 repeats$/m);
  // pass^2 for k = repeats: only connect s2 passed both repeats.
  assert.match(table, /^all 2 repeats passed on 1\/4 instances$/m);
  assert.equal(/0\.50   |50\.0 %|pass@1 0/.test(table), false, 'no rate as a decimal or a percentage at n = 8');
  assert.match(table, /efficiency vs reference length 0\.50  \(> 1 = fewer actions than the reference solution\)/);
  assert.match(renderTable(value, 'de'), /Läufe/);
});

test('a report whose settings plan more runs than it holds is rejected before the plan is expanded', () => {
  // 1000 tasks × 1000 seeds × 1000 repeats would be 10^9 planned keys; the report holds 8 runs.
  const value = fixture() as unknown as { settings: { tasks: string[]; seeds: number[]; repeats: number } };
  value.settings.tasks = Array.from({ length: 1000 }, (_, i) => `t${i}`); value.settings.seeds = Array.from({ length: 1000 }, (_, i) => i); value.settings.repeats = 1000;
  const started = performance.now();
  assert.throws(() => validateBenchReport(value), /report has 8 runs, but its settings plan 1000000000/);
  assert.ok(performance.now() - started < 2000, 'rejected without materialising the plan');
});

test('text from a report never reaches the terminal or the page as control sequences', () => {
  const value = fixture(); value.agent = { kind: 'command', name: 'evil\u001b]0;owned\u0007', command: ['agent', '\u001b[2J', '{mcp_config}'], model: '\u001b[31mred\u202egpj.exe', modelSource: 'client-attested' };
  value.environment.os.release = '27\u001b[1A';
  for (const text of [renderTable(value), renderTable(value, 'de'), renderHtml(value, ':root{}')]) {
    assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(text), false, 'no control, C1 or bidi character survives');
    assert.match(text, /\\u\{001b\}/);
  }
  assert.match(renderTable(value), /\\u\{202e\}gpj\.exe/);
});

test('the HTML names its verification level; the command line, home folder as ~, sits under Technical details', () => {
  const value = fixture(); value.agent = { kind: 'preset', name: 'claude-code', command: ['claude', '-p', '--mcp-config', '{mcp_config}', '--tools', ''], model: null, modelSource: 'none' };
  const plain = renderHtml(value, ':root{}'), verified = renderHtml(value, ':root{}', 'en', 're-verified');
  assert.match(plain, /consistency-checked, not re-verified/); assert.equal(plain.includes('re-verified: every judged run'), false);
  assert.match(verified, /re-verified: every judged run was re-judged/);
  assert.match(plain, /<details class="tech"><summary>Technical details<\/summary><dl class="settings"><dt>Command<\/dt><dd><code>claude -p --mcp-config \{mcp_config\} --tools &#39;&#39;<\/code><\/dd>/);
  const local = fixture(); local.agent = { kind: 'command', name: 'mine', command: [join(homedir(), 'agents', 'run.sh'), '{mcp_config}'], model: null, modelSource: 'none' };
  const shared = renderHtml(local, ':root{}');
  assert.match(shared, /<code>~[/\\]agents[/\\]run\.sh \{mcp_config\}<\/code>/); assert.equal(shared.includes(homedir()), false, 'the home folder is not named');
  assert.match(plain, /n = 8\u00a0runs · 2\u00a0seeds · 2\u00a0repeats/);
  assert.match(renderHtml(value, ':root{}', 'de'), /n = 8\u00a0Läufe · 2\u00a0Seeds · 2\u00a0Wiederholungen/);
  const one = report([run('connect', 1, 1, true)], 1, ['connect'], [1]);
  assert.match(renderTable(one), /^n = 1 run · 1 seed · 1 repeat$/m);
  assert.match(renderTable(one), /^1 task × 1 seed × 1 repeat, timeout/m);
});

test('an interrupted report holds fewer runs than planned, says so, and cannot claim the full plan', () => {
  const value = report([run('connect', 1, 1, true), run('connect', 1, 2, false)], 2, ['connect', 'decision'], [1]);
  assert.throws(() => validateBenchReport(value), /report has 2 runs, but its settings plan 4/);
  const partial = { ...value, interrupted: { plannedRuns: 4 } };
  assert.doesNotThrow(() => validateBenchReport(partial));
  assert.match(renderTable(partial), /Interrupted: 2 of 4 planned runs finished/);
  assert.match(renderHtml(partial, ':root{}'), /Interrupted: 2\u00a0of\u00a04\u00a0planned runs finished/);
  assert.throws(() => validateBenchReport({ ...value, interrupted: { plannedRuns: 5 } }), /interrupted report holds 2 runs, but its settings plan 4/);
  const full = report([run('connect', 1, 1, true), run('connect', 1, 2, false)], 2, ['connect'], [1]);
  assert.throws(() => validateBenchReport({ ...full, interrupted: { plannedRuns: 2 } }), /interrupted report holds 2 runs/);
  // A run outside the plan is still rejected without expanding it.
  const stray = structuredClone(partial); stray.runs[1] = run('decision', 7, 1, true); stray.summary = summarize(stray.runs, 2);
  assert.throws(() => validateBenchReport(stray), /not one of the planned/);
});

test('a run without a verdict shows the unknown mark and says so, never the fail mark or "Why it failed"', () => {
  const value = report([run('connect', 1, 1, true), run('connect', 2, 1, null)], 1, ['connect'], [1, 2]);
  const html = renderHtml(value, ':root{}'), card = html.slice(html.indexOf('<details class="run" id="run-connect-s2-r1"'));
  const mark = '<span class="result unknown"><svg class="status-icon unknown" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" stroke-dasharray="2.4 3"/></svg>no verdict, counted as not passed</span>';
  // In the runs table and on the card: the dashed ring (unknown, design-language §7.3) and the words.
  assert.equal(html.split(mark).length - 1, 2);
  assert.match(card, /<h3>Why there is no verdict<\/h3>/); assert.equal(card.slice(0, card.indexOf('</details>')).includes('Why it failed'), false);
  assert.match(card, /<span class="state">No verdict:<\/span> the run could not be judged, so it counts as not passed; an infrastructure fault never raises a score\./);
  assert.equal((html.match(/class="result fail"/g) ?? []).length, 0, 'no fail mark for a run that was not judged');
  // The terminal marks it with "?", not with the cross of a judged failure.
  assert.match(renderTable(value), /^\? connect-s2-r1  no verdict, counted as not passed$/m);
});

test('a run that could not be judged stays in the denominator of pass@1 and pass^k', () => {
  const value = report([run('connect', 1, 1, true), run('connect', 2, 1, null)], 1, ['connect'], [1, 2]);
  assert.deepEqual([value.summary.runs, value.summary.passed, value.summary.judged, value.summary.infraErrors], [2, 1, 1, 1]);
  assert.equal(value.summary.passAt1, 0.5, 'passed / all runs, not passed / judged runs');
  assert.deepEqual(value.summary.passHatK, [{ k: 1, value: 0.5 }]);
  assert.equal(value.summary.byTask[0]!.passAt1, 0.5);
});

test('summary cards show each figure once: pass^k only from k = 2, the passed count inside pass@1', () => {
  const cards = (html: string): string[] => [...html.matchAll(/<div class="figure"><dt>([^<]*)<\/dt><dd>([^<]*)<\/dd>/g)].map(match => `${match[1]}=${match[2]}`);
  const single = report([run('connect', 1, 1, true), run('decision', 1, 1, true)], 1, ['connect', 'decision'], [1]);
  const one = renderHtml(single, ':root{}');
  assert.deepEqual(cards(one).map(card => card.split('=')[0]), ['pass@1', 'mean actions', 'efficiency vs reference length', 'mean time per run']);
  assert.match(one, /<dl class="figures n4">/); assert.match(one, /<dd>2\/2<\/dd><dd class="detail">2\u00a0runs counted<\/dd>/);
  assert.match(renderHtml(report([run('connect', 1, 1, true)], 1, ['connect'], [1]), ':root{}'), /<dd>1\/1<\/dd><dd class="detail">1\u00a0run counted<\/dd>/);
  assert.equal(/pass\^1/.test(one), false, 'pass^1 equals pass@1 and is not shown twice');
  const two = renderHtml(fixture(), ':root{}');
  assert.deepEqual(cards(two).map(card => card.split('=')[0]), ['pass@1', 'pass^2', 'mean actions', 'efficiency vs reference length', 'mean time per run']);
  assert.match(two, /<dl class="figures n5">/); assert.match(two, /1\u00a0not judged \(infrastructure\), counted as not passed/);
  // No grid width leaves one card alone in a row: 4 cards = 2 × 2 or 4 × 1; 5 cards = 1 + 2 + 2, 3 + 2 or 5 × 1.
  assert.match(two, /\.figures\.n5 \.figure:first-child\{grid-column:1\/-1\}/);
  assert.match(two, /\.figures\.n5\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}\.figures\.n5 \.figure\{grid-column:span 2\}\.figures\.n5 \.figure:nth-child\(-n\+2\)\{grid-column:span 3\}/);
});

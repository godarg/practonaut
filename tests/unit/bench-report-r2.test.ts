// Design review R2 of the bench/3 report and compare pages (PR #66, commit 440e261), on the registered
// states' own reports (tests/support/bench-v3-states.ts): identifiers that split at their own hyphens
// (R2-F1, measured as rendered by test:a11y with tests/support/identifier-lines.ts; here, the markup that
// keeps them whole) and the minors fixed in the same round. Expected words are the catalogue's, written
// here by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTokensCss, renderHtml, ID_MAX } from '../../src/bench/render.ts';
import { compareReports, differences } from '../../src/bench/compare.ts';
import { renderCompareHtml, renderCompareTable, renderIncomparableHtml, type CompareInput } from '../../src/bench/render-compare.ts';
import { validateBenchReportV3, type BenchReportV3 } from '../../src/bench/report.ts';
import { sessionReport } from '../support/bench-v3.ts';
import { v3States } from '../support/bench-v3-states.ts';

const s = v3States();
const tokens = await readTokensCss();
const side = (report: BenchReportV3, name: string): CompareInput => ({ report, verification: 'consistency-checked', name });
const compared = (a: BenchReportV3, b: BenchReportV3, language: 'en' | 'de' = 'en'): string => renderCompareHtml(side(a, 'excalidraw'), side(b, 'drawio'), compareReports(a, b), tokens, language);
const body = (html: string): string => html.replace(/<head>[\s\S]*?<\/head>/u, '');
const visible = (html: string): string => body(html).replace(/<[^>]+>/gu, ' ').replace(/&#39;/gu, '\'').replace(/&amp;/gu, '&').replace(/[ ⁠]/gu, match => match === ' ' ? ' ' : '').replace(/\s+/gu, ' ');

test('R2-F1: every identifier with a hyphen is one unbreakable word (`id`), in tables, lists, chips, settings and refusals', () => {
  const pages = (['en', 'de'] as const).flatMap(language => [
    compared(s.configExcalidraw, s.configDrawio, language), compared(s.excalidraw, s.drawio, language), compared(s.excalidraw, s.unjudgedCandidate, language),
    renderIncomparableHtml(side(s.excalidraw, 'excalidraw'), side(s.drawio, 'drawio'), differences(s.excalidraw, s.drawio, { regressionGate: true }), tokens, language, { regressionGate: true }),
    renderHtml(s.claimed, tokens, language, s.claims), renderHtml(s.artifact, tokens, language),
  ]);
  const ids = ['restyle-flow', 'restyle-flow-drawio', 'excalidraw-library', 'drawio-library', 'claude-haiku-5-5', 'claude-code', 'my-world', 'model-a', 'extra-arrow', 'unchanged-start', 'excalidraw-mcp', 'excalidraw-mcp-store'];
  let seen = 0;
  for (const html of pages) {
    // Every text run that holds an id: the element that holds it directly carries `id` (or is a flag).
    for (const match of body(html).matchAll(/<([a-z][a-z0-9]*)([^>]*)>([^<]*)/gu)) {
      const [, tag, attributes, text] = match as unknown as [string, string, string, string];
      for (const id of ids) {
        if (!new RegExp(`(?<![\\w-])${id.replace(/\./gu, '\\.')}(?![\\w-])`, 'u').test(text) || tag === 'title' || tag === 'style' || tag === 'h1') continue;
        seen++;
        assert.ok(/\bclass="[^"]*\bid\b/u.test(attributes) && text.trim() === id || /\bclass="[^"]*\bid\b/u.test(attributes) && text.trim().replace(/[,;:)]+$/u, '') === id, `"${id}" sits in <${tag}${attributes}>${text.slice(0, 60)}`);
      }
    }
  }
  assert.ok(seen > 50, `ids looked at: ${seen}`);
  assert.equal(ID_MAX, 32);
});

test('R2-F2/F3/F4/F5: across worlds a rate resting on runs without a verdict says so at the top; the reason for no rate once; the section and the instance cell fit identities', () => {
  const unjudged = compared(s.excalidraw, s.unjudgedCandidate);
  assert.match(unjudged, /<div class="banner unknown" role="note">[\s\S]*?<p class="banner-title">The rates rest on runs without a verdict<\/p><p>2 paired identities have no verdict on the candidate; they count as not passed\.<\/p>/u);
  // The session compare keeps its own (incomplete) warning and gets no second notice.
  const one = validateBenchReportV3(sessionReport({ T: { 1: [true] } })), none = validateBenchReportV3(sessionReport({ T: { 1: [null] } }));
  assert.equal(compared(one, none).includes('The rates rest on runs without a verdict'), false);
  const identity = compared(s.excalidraw, s.drawio), text = visible(identity);
  assert.equal(text.split('has a different number of runs on the two sides').length - 1, 1);
  assert.equal(text.split('no rate').length - 1, 2);
  assert.match(identity, /<h2 id="regressions">Outcomes per task identity<\/h2>/);
  assert.match(compared(s.excalidraw, s.drawio, 'de'), /<h2 id="regressions">Ergebnisse je Aufgabenidentität<\/h2>/);
  assert.match(identity, /<td data-label="instance" class="text wide">/);
  assert.match(compared(one, one), /<td data-label="instance" class="text">/);
});

test('R2-F6: one instance name in one type style: the table and the lists name a task in mono with "seed"', () => {
  const html = compared(validateBenchReportV3(sessionReport({ 'restyle-flow': { 1: [true] } })), validateBenchReportV3(sessionReport({ 'restyle-flow': { 1: [false] } })));
  assert.match(html, /<td data-label="instance" class="text"><code class="id">restyle-flow<\/code> · seed 1<\/td>/u);
  assert.match(html, /<li><span><code class="id">restyle-flow<\/code> · seed 1: passed on the baseline/u);
  // A command in a note is code, as in the banner.
  assert.match(renderHtml(s.claimed, tokens, 'en', s.claims), /Not re-checked by <code class="id">report<\/code> <code class="flag">--verify<\/code>:/u);
});

test('R2-F7/F8/F14: shared boards, a world and a grid are worded from the catalogue; the world hash only when id and version match', () => {
  const shared = { T: { 1: 'a'.repeat(64), 2: 'a'.repeat(64), 3: 'b'.repeat(64) } };
  const a = validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [true], 3: [true] } }, { identities: shared }));
  const page = (language: 'en' | 'de'): string => visible(compared(a, a, language));
  assert.match(page('en'), /Instances that share a board \(seeds that select one variant\): 2 distinct boards among 3 instances on the baseline, 2 distinct boards among 3 instances on the candidate/);
  assert.match(page('de'), /2 verschiedene Arbeitsflächen unter 3 Instanzen bei der Basis/);
  assert.equal(page('en').includes('2 / 3'), false);
  // Two worlds of different ids: the ids are what differs; one id and version: the hash says which.
  assert.deepEqual(differences(s.excalidraw, s.drawio, { regressionGate: true })[0], { field: 'world', baseline: 'excalidraw-library 1.0.0', candidate: 'drawio-library 1.0.0' });
  const same = validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { contentHash: 'c'.repeat(64) })), other = validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { contentHash: 'e'.repeat(64) }));
  assert.deepEqual(differences(same, other)[0], { field: 'world', baseline: 'my-world 1.0.0 (cccccccccccc)', candidate: 'my-world 1.0.0 (eeeeeeeeeeee)' });
  // A grid in German words.
  const grid = validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [true], 3: [true] } }));
  const refusal = visible(renderIncomparableHtml(side(one(), 'a'), side(grid, 'b'), differences(one(), grid), tokens, 'de'));
  assert.match(refusal, /T × Seed 1 bei der Basis, T × Seeds 1, 2, 3 beim Kandidaten/);
  assert.equal(/\bseeds?\b/u.test(refusal), false);
  function one(): BenchReportV3 { return validateBenchReportV3(sessionReport({ T: { 1: [true] } })); }
});

test('R2-F9/F10/F14: a range, a percent sign and "> 1" stay with their numbers; proper names are never hyphenated', () => {
  const report = renderHtml(s.claimed, tokens, 'en', s.claims);
  assert.match(report, /interval 9–⁠91 % over/u);
  assert.match(report, /&gt; 1 = fewer actions/u);
  assert.match(renderHtml(s.excalidraw, tokens, 'en'), /restricted by <span class="name">Practonaut<\/span>/u);
  assert.match(compared(s.configExcalidraw, s.configDrawio), /exact <span class="name">McNemar<\/span> p/u);
});

test('R2-F11/F12/F13: German says "beim Kandidaten" and names a missing side once; no "score" on a page; a three-column table is as wide as its content', () => {
  const de = visible(compared(s.excalidraw, s.drawio, 'de'));
  assert.match(de, /T · Seed 2, T · Seed 3, T · Seed 5 \(Basis\): kein Lauf beim Kandidaten/);
  assert.equal(de.includes('bei dem Kandidaten'), false);
  assert.equal(de.includes('keine Instanz (Kandidat): kein Lauf'), false);
  assert.match(renderCompareTable(side(s.excalidraw, 'a'), side(s.drawio, 'b'), compareReports(s.excalidraw, s.drawio), 'de'), /kein Lauf beim Kandidaten/);
  for (const html of [renderHtml(s.artifact, tokens, 'en'), renderHtml(s.claimed, tokens, 'en', s.claims), renderHtml(validateBenchReportV3(sessionReport({ T: { 1: [null] } })), tokens, 'en')]) assert.equal(/\bscor/iu.test(visible(html)), false);
  assert.match(renderHtml(s.artifact, tokens, 'en'), /<div class="scroll stack compact" role="region" aria-labelledby="by-task"/);
});

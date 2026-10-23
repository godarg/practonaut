// Design review R3 of the bench/3 report and compare pages (PR #66, commit 75c99cf), on the registered
// states' own reports: the session compare's instance name cut inside "Seed" in a half-width stacked
// cell (R3-F1, measured as rendered by test:a11y with tests/support/identifier-lines.ts; here, the markup
// that prevents it), run-count lines across worlds that set the task id in the text face (R3-F2), and
// proper names hyphenated in notes (R3-F3). Expected words are the catalogue's, written here by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPER_NAMES, readTokensCss, renderHtml } from '../../src/bench/render.ts';
import { compareReports, differences } from '../../src/bench/compare.ts';
import { renderCompareHtml, renderIncomparableHtml, type CompareInput } from '../../src/bench/render-compare.ts';
import { validateBenchReportV3, type BenchReportV3 } from '../../src/bench/report.ts';
import { sessionReport } from '../support/bench-v3.ts';
import { v3States } from '../support/bench-v3-states.ts';

const s = v3States();
const tokens = await readTokensCss();
const side = (report: BenchReportV3, name: string): CompareInput => ({ report, verification: 'consistency-checked', name });
const compared = (a: BenchReportV3, b: BenchReportV3, language: 'en' | 'de' = 'en'): string => renderCompareHtml(side(a, 'a'), side(b, 'b'), compareReports(a, b), tokens, language);

test('R3-F1: a session compare\'s instance name is one unit in a cell that takes the whole stacked row', () => {
  const a = validateBenchReportV3(sessionReport({ 'restyle-flow': { 1: [true] } })), b = validateBenchReportV3(sessionReport({ 'restyle-flow': { 1: [false] } }));
  for (const [language, seed] of [['en', 'seed'], ['de', 'Seed']] as const) {
    const html = compared(a, b, language);
    // The cell spans the row when the table stacks; the name never breaks inside, not even inside "Seed".
    assert.match(html, new RegExp(`<td data-label="[^"]+" class="text wide"><span class="id"><code class="id">restyle-flow</code> · ${seed} 1</span></td>`, 'u'));
  }
});

test('R3-F2: across worlds a run-count line names its pair as the table does, the task id in mono', () => {
  const html = compared(s.excalidraw, s.drawio);
  const lines = [...html.slice(html.indexOf('<section aria-labelledby="caveats">')).matchAll(/<li><span>([\s\S]*?)<\/span><\/li>/gu)].map(match => match[1]!).filter(line => line.includes('left out of the rate'));
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.match(line, /^<span class="id"><code class="id">T<\/code> · seed \d<\/span> \(baseline\) · <span class="id"><code class="id">T<\/code> · seed \d<\/span>/u);
    assert.equal(/(?<![>\w])T ·/u.test(line), false, 'no task id in the text face');
  }
});

test('R3-F3: proper names in notes and notices are never hyphenated (each sits in a name span)', () => {
  const pages = (['en', 'de'] as const).flatMap(language => [
    renderIncomparableHtml(side(s.excalidraw, 'a'), side(validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [true] } }, { worldId: 'excalidraw-library', contentHash: 'a'.repeat(64) })), 'b'), [{ field: 'budget', baseline: '50', candidate: '10' }], tokens, language),
    renderHtml(s.artifact, tokens, language), renderHtml(s.claimed, tokens, language, s.claims), compared(s.configExcalidraw, s.configDrawio, language),
  ]);
  let seen = 0;
  for (const html of pages) {
    const notes = [...html.matchAll(/<p class="note">([\s\S]*?)<\/p>|<div class="banner-body">([\s\S]*?)<\/div>|<p class="verdict">([\s\S]*?)<\/p>/gu)].map(match => match[1] ?? match[2] ?? match[3]!);
    for (const note of notes) {
      const outside = note.replace(/<span class="name">[^<]*<\/span>/gu, '');
      for (const name of PROPER_NAMES) {
        seen += note.split(`<span class="name">${name}</span>`).length - 1;
        assert.equal(outside.includes(name), false, `${name} outside a name span in: ${note.slice(0, 120)}`);
      }
    }
  }
  assert.ok(seen >= 10, `names seen: ${seen}`);
  assert.deepEqual([...PROPER_NAMES].sort(), ['Excalidraw', 'McNemar', 'Practonaut', 'Wilson', 'draw.io']);
  // The refusal page's rules name McNemar; the artifact page's notice and note name Practonaut and Wilson.
  assert.match(renderIncomparableHtml(side(s.excalidraw, 'a'), side(s.drawio, 'b'), differences(s.excalidraw, s.drawio), tokens), /exact <span class="name">McNemar<\/span> test/u);
  assert.match(renderHtml(s.artifact, tokens, 'en'), /<div class="banner-body"><p class="banner-title">Foreign MCP server: no sandbox<\/p><p>The foreign MCP server’s code runs as the same OS user as <span class="name">Practonaut<\/span>, without a sandbox\.<\/p>/u);
  assert.match(renderHtml(s.artifact, tokens, 'en'), /<span class="name">Wilson<\/span> interval/u);
});

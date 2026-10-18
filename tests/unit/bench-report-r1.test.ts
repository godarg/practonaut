// Design review R1 of the bench/3 report and compare pages (PR #66, design-language §16): each major
// finding as the reader saw it, on the registered states' own reports (tests/support/bench-v3-states.ts),
// red on the reviewed commit. Expected words are the catalogue's, written here by hand; an identifier's
// protection is read from the markup the page's stylesheet acts on (`code`, `.data`: no hyphenation;
// `.flag`: no break), and test:a11y measures the same on the rendered pages at 320 and 1280 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTokensCss, renderHtml } from '../../src/bench/render.ts';
import { compareReports, differences } from '../../src/bench/compare.ts';
import { renderCompareHtml, renderCompareTable, renderIncomparableHtml, type CompareInput } from '../../src/bench/render-compare.ts';
import type { BenchReportV3 } from '../../src/bench/report.ts';
import { sessionReport } from '../support/bench-v3.ts';
import { v3States } from '../support/bench-v3-states.ts';

const s = v3States();
const tokens = await readTokensCss();
const LANGUAGES = ['en', 'de'] as const;
const side = (report: BenchReportV3, name: string): CompareInput => ({ report, verification: 'consistency-checked', name });
const compared = (a: BenchReportV3, b: BenchReportV3, language: 'en' | 'de'): string => renderCompareHtml(side(a, 'excalidraw'), side(b, 'drawio'), compareReports(a, b), tokens, language);
const gate = (language: 'en' | 'de'): string => renderIncomparableHtml(side(s.excalidraw, 'excalidraw'), side(s.drawio, 'drawio'), differences(s.excalidraw, s.drawio, { regressionGate: true }), tokens, language, { regressionGate: true });
/** The page body as a reader sees it: tags dropped, entities read, no-break spaces as spaces. */
const visible = (html: string): string => html.replace(/<head>[\s\S]*?<\/head>/u, '').replace(/<[^>]+>/gu, ' ').replace(/&#39;/gu, '\'').replace(/&quot;/gu, '"').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&').replace(/ /gu, ' ').replace(/\s+/gu, ' ');
/** Text the browser may hyphenate: everything outside code, `.data`, Technical details and the title. */
const hyphenable = (html: string): string => visible(html.replace(/<head>[\s\S]*?<\/head>/u, '').replace(/<h1>[\s\S]*?<\/h1>/gu, '').replace(/<details class="tech">[\s\S]*?<\/details>/gu, '')
  .replace(/<code>[^<]*<\/code>/gu, '').replace(/<span class="data[^"]*">[^<]*<\/span>/gu, ''));
/** One part of a page: from the element that opens with `start` to the first `end` after it. */
const part = (html: string, start: string, end: string): string => { const from = html.indexOf(start); assert.ok(from >= 0, start); return html.slice(from, html.indexOf(end, from) + end.length); };

test('R1-F1: identifiers and commands never hyphenate and a flag never breaks, on the report, compare and refusal pages', () => {
  const pages = LANGUAGES.flatMap(language => [
    renderHtml(s.claimed, tokens, language, s.claims), renderHtml(s.artifact, tokens, language), gate(language),
    compared(s.excalidraw, s.drawio, language), compared(s.configExcalidraw, s.configDrawio, language),
  ]);
  // Tool, model, server, reading-rules, toolchain and world ids, the agent's name, a command and flags.
  const identifiers = ['explain_result', 'list_actions', 'check_result', 'claude-haiku-5-5', 'claude-code', 'excalidraw-mcp', 'excalidraw-mcp-store', 'excalidraw-mcp-0.3.2', 'excalidraw-library', 'drawio-library', 'my-world', 'restyle-flow', 'practonaut report', 'report --verify', '--verify', '--fail-on-regression'];
  for (const html of pages) {
    const free = hyphenable(html);
    for (const id of identifiers) assert.equal(free.includes(id), false, `"${id}" may hyphenate in: …${free.slice(Math.max(0, free.indexOf(id) - 60), free.indexOf(id) + 60)}…`);
    // Every flag in the body is one unbreakable piece.
    const body = html.replace(/<head>[\s\S]*?<\/head>/u, '');
    for (const flag of ['--fail-on-regression', '--verify']) assert.equal((body.match(new RegExp(`(?<![\\w-])${flag}(?![\\w-])`, 'gu')) ?? []).length, (body.match(new RegExp(`<span class="data flag">${flag}</span>`, 'gu')) ?? []).length, flag);
  }
  // The gate's way forward names its flag whole (the reviewer saw "without -" / "-fail-on-regression").
  assert.match(gate('en'), /Compare without <span class="data flag">--fail-on-regression<\/span> to see/);
});

test('R1-F2: a header says once that the client values were not re-derived; the model and the isolation keep their words', () => {
  for (const language of LANGUAGES) {
    const html = renderHtml(s.claimed, tokens, language, s.claims), chips = visible(part(html, '<ul class="chips"', '</ul>'));
    const phrase = language === 'en' ? 'not re-derived' : 'nicht nachgerechnet';
    // "nachgerechnet; Angaben des Clients nicht nachgerechnet": the verification chip, once.
    assert.equal(chips.split(phrase).length - 1, 1, chips);
    assert.match(chips, language === 'en' ? /tool-restricted preset model claude-haiku-5-5 \(self-reported, client-attested\)/ : /Voreinstellung mit eingeschränkten Werkzeugen Modell claude-haiku-5-5 \(Selbstauskunft des Clients\)/);
    assert.match(html, language === 'en' ? /<dt>Isolation<\/dt><dd>tool-restricted preset<\/dd>/ : /<dt>Isolation<\/dt><dd>Voreinstellung mit eingeschränkten Werkzeugen<\/dd>/);
  }
  // A compare side says it once too.
  const page = renderCompareHtml({ report: s.claimed, verification: s.claims, name: 'a' }, { report: s.claimed, verification: s.claims, name: 'b' }, compareReports(s.claimed, s.claimed), tokens);
  assert.equal(visible(part(page, '<ul class="chips"', '</ul>')).split('not re-derived').length - 1, 1);
});

test('R1-F3: an artifact run card says why it failed or has no verdict in words, with the meta line, the jump links and linked tasks; the drawing note once', () => {
  const html = renderHtml(s.artifact, tokens, 'en'), text = visible(html);
  const card = (id: string): string => visible(part(html, `<details class="run" id="run-${id}"`, '</details></div></details>'));
  // Judged on the start file: why it failed, by name, the judged file and the error class in words.
  assert.match(card('flow-s2-r1'), /flow · seed 2 · repeat 1 3 forwarded tool calls · completed Why it failed Judged file: the start file, as the server stored no result Error class unchanged-start/);
  // Not judged: why there is no verdict, the failure reason in words, counted as not passed.
  assert.match(card('flow-s3-r1'), /0 forwarded tool calls · not judged Why there is no verdict No verdict: the foreign MCP server failed before the first forwarded tool call; the run counts as not passed\./);
  // The failed runs, linked from the top; every task in the runs table links to its card.
  assert.match(part(html, '<nav class="jump"', '</nav>'), /href="#run-flow-s2-r1".*href="#run-flow-s3-r1"/);
  for (const id of ['flow-s1-r1', 'flow-s2-r1', 'flow-s3-r1']) assert.match(html, new RegExp(`<a href="#run-${id}"><code>flow</code></a>`));
  assert.equal(text.split('This page does not draw the judged state').length - 1, 1);
  // F14-F16 on the same page: the sandbox said once (a warning, with the triangle), three cards in a
  // three-column grid, and how an artifact-judged run is scored.
  assert.equal(/<li class="chip">[^<]*sandbox/iu.test(html), false);
  assert.match(html, /<div class="banner warning" role="note"><svg class="banner-icon"[^>]*><path d="M10\.3 4\.9L2\.9 17\.7/);
  assert.match(html, /<dl class="figures n3">/);
  assert.match(text, /How this is scored: after the agent stops, a separate checker process reads the result the foreign MCP server stored \(or the start file when it stored none\) and judges its end state only/);
  // German: the same states in German words.
  assert.match(visible(renderHtml(s.artifact, tokens, 'de')), /Warum nicht bestanden Bewertete Datei: die Startdatei, da der Server kein Ergebnis gespeichert hat/);
});

test('R1-F4: across worlds the headline is the result (identities paired), the rule sentence only in its section', () => {
  for (const [language, headline, rule] of [
    ['en', '2 of 3 task identities paired across worlds.', 'Across worlds a different outcome is a difference between the two configurations, never an instance regression.'],
    ['de', '2 von 3 Aufgabenidentitäten über Welten hinweg gepaart.', 'Über Welten hinweg ist ein anderes Ergebnis ein Unterschied zwischen den beiden Konfigurationen, nie eine Instanz-Regression.'],
  ] as const) {
    const html = compared(s.excalidraw, s.drawio, language);
    assert.equal(visible(part(html, '<p class="headline">', '</p>')).trim(), headline);
    assert.equal(visible(html).split(rule).length - 1, 1, 'the rule sentence once, under instance regressions');
    assert.equal(part(html, '<header>', '</header>').includes(rule.slice(0, 20)), false);
  }
});

test('R1-F5: a side without a rate says why (no identity with equal run counts), never "no instance" beside paired instances', () => {
  const html = compared(s.excalidraw, s.drawio, 'en'), sides = visible(part(html, '<dl class="sides">', '</dl>'));
  assert.equal(sides.split('no rate: no task identity has the same number of runs on both sides').length - 1, 2);
  assert.equal(visible(html).includes('no interval (no instance)'), false);
  assert.match(visible(compared(s.excalidraw, s.drawio, 'de')), /keine Rate: keine Aufgabenidentität hat auf beiden Seiten gleich viele Läufe/);
});

test('R1-F6: a side whose rate rests on runs without a verdict says so on its card, under the unknown mark', () => {
  for (const [language, words] of [['en', '2 instances without a verdict, counted as not passed'], ['de', '2 Instanzen ohne Urteil, als nicht bestanden gezählt']] as const) {
    const html = compared(s.excalidraw, s.unjudgedCandidate, language);
    const [baseline, candidate] = part(html, '<dl class="sides">', '</dl>').split('<div class="figure">').slice(1) as [string, string];
    assert.match(candidate, new RegExp(`<span class="result unknown"><svg class="status-icon unknown"[^>]*><circle [^>]*stroke-dasharray="2\\.4 3"/></svg>${words.replace(/ /gu, '[ \\u00a0]')}</span>`));
    assert.equal(visible(baseline).includes(words.slice(2)), false);
  }
});

test('R1-F7: German pages name instances in German ("T · Seed 2"); no English "seed" on a German page or line', () => {
  for (const html of [compared(s.excalidraw, s.drawio, 'de'), compared(s.excalidraw, s.unjudgedCandidate, 'de'), compared(s.configExcalidraw, s.configDrawio, 'de')]) {
    assert.equal(/\bseed\b/u.test(visible(html)), false, visible(html).match(/.{40}\bseed\b.{20}/u)?.[0]);
  }
  const de = visible(compared(s.excalidraw, s.drawio, 'de'));
  assert.match(de, /T · Seed 1 \(Basis\) · T · Seed 2, T · Seed 3, T · Seed 5 \(Kandidat\)/);
  const text = renderCompareTable(side(s.excalidraw, 'excalidraw'), side(s.drawio, 'drawio'), compareReports(s.excalidraw, s.drawio), 'de');
  assert.equal(/\bseed\b/u.test(text), false);
  // One colon per line: the run counts of an identity in one sentence.
  assert.match(text, /^ {2}T · Seed 4 \(Basis\) · T · Seed 1, T · Seed 4 \(Kandidat\): 1 Lauf bei der Basis, 2 beim Kandidaten, nicht in der Rate$/m);
});

test('R1-F8: the gate\'s refusal of two worlds says why the gate refuses, not that nothing between them would mean anything', () => {
  for (const [language, lead, general] of [
    ['en', 'A regression gate compares one world with itself; these reports come from two worlds.', 'no rate or flip between them would mean anything'],
    ['de', 'Eine Regressionsschranke vergleicht eine Welt mit sich selbst; diese Berichte stammen aus zwei Welten.', 'keine Rate und kein Wechsel zwischen ihnen hätte eine Bedeutung'],
  ] as const) {
    const text = visible(gate(language));
    assert.ok(text.includes(lead), text);
    assert.equal(text.includes(general), false);
  }
  // Any other refusal keeps the general lead.
  const other = renderIncomparableHtml(side(s.excalidraw, 'a'), side(s.drawio, 'b'), [{ field: 'budget', baseline: '50', candidate: '10' }], tokens, 'en');
  assert.match(visible(other), /no rate or flip between them would mean anything/);
});

test('R1-F9: across applications each side names its application and its world first; one world and application name neither', () => {
  for (const html of [compared(s.excalidraw, s.drawio, 'en'), gate('en')]) {
    const chips = [...html.matchAll(/<ul class="chips"[^>]*>([\s\S]*?)<\/ul>/gu)].map(match => visible(match[1]!).trim());
    assert.ok(chips[0]!.startsWith('Excalidraw world excalidraw-library 1.0.0 generic'), chips[0]);
    assert.ok(chips[1]!.startsWith('draw.io world drawio-library 1.0.0 generic'), chips[1]);
  }
  const one = sessionReport({ T: { 1: [true] } });
  const same = renderCompareHtml(side(one, 'a'), side(one, 'b'), compareReports(one, one), tokens);
  assert.equal(/<li class="chip">(Excalidraw|world )/u.test(same), false);
});

test('R1 minors: one colon and a capital per caveat line, the task id in mono, "no instance", a short change cell, p and n kept with their values', () => {
  const html = compared(s.excalidraw, s.drawio, 'en');
  const caveats = [...part(html, '<section aria-labelledby="caveats">', '</section>').matchAll(/<li>([\s\S]*?)<\/li>/gu)].map(match => visible(match[1]!).trim());
  assert.deepEqual(caveats.map(line => [/^\p{Lu}/u.test(line), line.split(': ').length - 1]), caveats.map(() => [true, 1]), caveats.join('\n'));
  assert.equal(caveats[0], 'Paired by task identity: excalidraw-library 1.0.0 on the baseline, drawio-library 1.0.0 on the candidate');
  assert.match(html, /<td data-label="instance" class="text"><code>T<\/code> · seed 1 \(baseline\) · <code>T<\/code>/);
  assert.match(html, /\(baseline\) · no instance \(candidate\)<\/td>/);
  assert.match(html, /<td data-label="change" class="text prose">no run on the candidate<\/td>/);
  assert.equal(visible(html).includes('PADR-'), false, 'no decision-record number on a page');
  // The changed outcomes of the configurations are listed under their own heading (R1-F22's state).
  const config = visible(compared(s.configExcalidraw, s.configDrawio, 'en'));
  assert.match(config, /Different outcome on the two configurations — neither a regression nor a fix restyle-flow · seed 1 \(baseline\) · restyle-flow-drawio · seed 1 \(candidate\): passed on the baseline \(1\/1\), failed on the candidate \(0\/1\) restyle-flow · seed 3 \(baseline\) · restyle-flow-drawio · seed 3 \(candidate\): failed on the baseline \(0\/1\), passed on the candidate \(1\/1\)/);
  assert.match(compared(s.configExcalidraw, s.configDrawio, 'en'), /p = 1\.000/);
  // The report page: the toolchain in words (tool names under Technical details), no "level" (§3).
  const report = renderHtml(s.claimed, tokens, 'en', s.claims);
  assert.match(report, /<dt>Toolchain<\/dt><dd>Practonaut’s own MCP tools \(7\)<\/dd>/);
  assert.match(report, /<dt>MCP tools<\/dt><dd><code>observe, list_actions, act, undo, reset, explain_result, check_result<\/code><\/dd>/);
  for (const page of [report, renderHtml(s.artifact, tokens, 'en')]) assert.equal(/\blevel\b/iu.test(visible(page)), false, visible(page).match(/.{40}\blevel\b.{20}/iu)?.[0]);
});

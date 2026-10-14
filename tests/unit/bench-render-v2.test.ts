// Report v2 presentation (PADR-0039 B): no rate finer than 1/n, the engine's SVG reduced to an
// allowlist so board text is never markup, and the schematic that keeps every goal-relevant attribute.
// Expected values are written out by hand next to each case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_SCHEMA_V2, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';
import { renderHtml, renderTable } from '../../src/bench/render.ts';
import { intervalPercent, percentDigits, rateText } from '../../src/bench/rates.ts';
import { engineSvgMarkup, SvgRefused } from '../../src/bench/svg.ts';
import { framesOf, groupsOf, schematicSvg } from '../../src/bench/schematic.ts';
import type { State } from '../../src/world/types.ts';

const hash = (c: string): string => c.repeat(64);
/** n runs over two tasks (one repeat), the first `passed` of them passed. */
function report(n: number, passed: number): BenchReportV2 {
  const seeds = Math.ceil(n / 2);
  const runs: BenchRunV2[] = Array.from({ length: n }, (_, index) => ({ id: `${index < seeds ? 'T' : 'U'}-s${(index % seeds) + 1}-r1`, taskId: index < seeds ? 'T' : 'U', seed: (index % seeds) + 1, repeat: 1, status: 'completed', pass: index < passed, actions: 1, acceptedActions: 1, rejectedActions: 0, undos: 0, resets: 0,
    toolCalls: { observe: 1, act: 1, undo: 0, reset: 0, check: 0, total: 2 }, wallMs: 100, referenceActions: null, checker: { session: { passed: index < passed, errorClasses: [] }, native: null }, agentExitCode: 0, artifacts: { session: hash('a'), native: null, checker: hash('c') } }));
  return validateBenchReportV2({
    schema: BENCH_SCHEMA_V2, createdAt: '2026-10-14T12:00:00.000Z',
    environment: { practonaut: '0.2.0-dev.0', excalidraw: '0.18.1', node: 'v22', os: { platform: 'linux', release: '6', arch: 'x64' }, mirror: 'off', world: { source: 'own', worldId: 'w', version: '1.0.0', contentHash: hash('d'), package: { path: 'world.pnworld', sha256: hash('e') }, generated: [] } },
    agent: { kind: 'builtin', name: 'oracle', command: [], isolation: 'builtin-baseline', model: null, modelSource: 'none', apiKeySource: null, keptEnv: [] },
    settings: { tasks: ['T', 'U'], seeds: Array.from({ length: seeds }, (_, index) => index + 1), repeats: 1, timeoutSeconds: 300, maxActions: 50, mirror: 'off', prompt: '' },
    references: null, runs, summary: summarize(runs, 1),
  });
}

test('rates are fractions; a percentage only at a resolution of at least 1/n; intervals in whole percent, rounded outward', () => {
  assert.deepEqual([6, 99, 100, 999, 1000].map(percentDigits), [null, null, 0, 0, 1]);
  assert.equal(rateText(5, 6, 'en'), '5/6');
  assert.equal(rateText(150, 200, 'en'), '150/200 (75 %)');
  assert.equal(rateText(1001, 1200, 'en'), '1001/1200 (83.4 %)');
  assert.equal(rateText(1001, 1200, 'de'), '1001/1200 (83,4 %)');
  // Wilson 5/6 = 0.4365 … 0.9699 (Newcombe's formula by hand): 43–97 %; 0/20 = 0 … 0.1611: 0–17 %.
  assert.deepEqual(intervalPercent(5, 6), { low: 43, high: 97 });
  assert.deepEqual(intervalPercent(0, 20), { low: 0, high: 17 });
  assert.deepEqual(intervalPercent(20, 20), { low: 83, high: 100 });
});

test('no rate is shown finer than 1/n, in the terminal or on the page, in English and German', () => {
  for (const [n, passed] of [[6, 5], [98, 50], [150, 113], [1200, 1001]] as const) {
    const value = report(n, passed);
    for (const language of ['en', 'de'] as const) {
      const texts = [renderTable(value, language), renderHtml(value, ':root{}', language).replace(/<style>[\s\S]*<\/style>/, '').replace(/<[^>]+>/g, ' ')];
      for (const text of texts) {
        // Remove the confidence level and the interval range: they are estimates, not observed rates.
        const rest = text.replace(/95(-| )%(-Intervall| interval) \d+–\d+ %/g, '').replace(/95 %|95-%/g, '');
        // Every percentage belongs to a fraction k/m and has the resolution m allows (each per-task row has its own m).
        let alone = rest;
        for (const match of rest.matchAll(/(\d+)\/(\d+) \((\d+(?:[.,]\d+)?) %\)/g)) {
          const m = Number(match[2]), digits = percentDigits(m);
          assert.notEqual(digits, null, `n = ${n} (${language}): ${match[0]} at m = ${m}`);
          assert.equal(match[3]!.split(/[.,]/)[1]?.length ?? 0, digits, `n = ${n} (${language}): ${match[0]}`);
          alone = alone.replace(match[0], '');
        }
        assert.deepEqual([...alone.matchAll(/(\d+(?:[.,]\d+)?) ?%/g)].map(match => match[0]), [], `n = ${n} (${language}) shows a percentage without its fraction`);
        if (percentDigits(n) === null) assert.equal(/\d %/.test(alone), false);
        // The rate as a decimal (0.83 for 5/6) never appears either.
        const decimal = (passed / n).toFixed(2), comma = decimal.replace('.', ',');
        assert.equal(rest.includes(` ${decimal}`) || rest.includes(` ${comma}`), false, `n = ${n} (${language}) shows ${decimal}`);
      }
    }
  }
});

test('engine SVG: only geometry and paint survive; scripts, links, styles, fonts and foreign content are dropped; text is escaped', () => {
  // The shape of Excalidraw 0.18's export (as written by the pinned engine), with hostile additions.
  const exported = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 130" width="820" height="130" onload="alert(1)"><!-- svg-source:excalidraw --><metadata></metadata>'
    + '<defs><style class="style-fonts">@font-face { font-family: Cascadia; src: url(data:font/woff2;base64,AAAA); }</style><mask id="m"><rect x="0" y="0" width="10" height="10" fill="#fff"/></mask></defs>'
    + '<rect x="0" y="0" width="820" height="130" fill="#ffffff"></rect><script>alert(2)</script><foreignObject><div>html</div></foreignObject>'
    + '<g stroke-linecap="round" transform="translate(20 20) rotate(0 90 45)" mask="url(#m)"><path d="M0 0 C36 0, 72 0, 180 0" stroke="#1e1e1e" stroke-width="2" fill="none" style="fill: red"></path></g>'
    + '<a href="https://example.invalid/"><text>link</text></a><image href="https://example.invalid/x.png"/>'
    + '<g transform="translate(80.7 53) rotate(0 29.3 12)"><text x="29.3" y="18.9" font-family="Cascadia, Segoe UI Emoji" font-size="20px" fill="#1e1e1e" text-anchor="middle" style="white-space: pre;">&lt;img src=x onerror=alert(3)&gt; &amp; &#60;b&#62;</text></g>'
    + '<rect x="1" y="1" width="2" height="2" fill="url(https://example.invalid/p)" stroke="javascript:alert(4)" xlink:href="#m"/></svg>';
  const markup = engineSvgMarkup(exported, { prefix: 'run1', label: 'Final "board" <b>', classes: 'engine-board' });
  assert.match(markup, /^<svg viewBox="0 0 820 130" class="engine-board" role="img" aria-label="Final &quot;board&quot; &lt;b&gt;">/);
  for (const forbidden of ['<script', 'onload', 'alert(2)', '<foreignObject', 'html', 'style', 'data:', '<a ', 'link', '<image', 'https:', 'javascript', 'xlink', 'font-family', '<metadata']) assert.equal(markup.includes(forbidden), false, forbidden);
  assert.match(markup, /<mask id="run1-m">/); assert.match(markup, /mask="url\(#run1-m\)"/);
  assert.match(markup, /<path d="M0 0 C36 0, 72 0, 180 0" stroke="#1e1e1e" stroke-width="2" fill="none"><\/path>/);
  assert.match(markup, /<text x="29.3" y="18.9" font-size="20px" fill="#1e1e1e" text-anchor="middle">&lt;img src=x onerror=alert\(3\)&gt; &amp; &lt;b&gt;<\/text>/);
  // A reference to anything but a local id is dropped, the element stays.
  assert.match(markup, /<rect x="1" y="1" width="2" height="2"><\/rect>/);
  for (const [refused, why] of [
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 1 1"/>', /DOCTYPE/], ['<svg viewBox="0 0 1 1"><text>&x;</text></svg>', /entity/], ['<svg viewBox="0 0 1 1"><text><![CDATA[<script>]]></text></svg>', /CDATA/],
    ['<html viewBox="0 0 1 1"></html>', /root/], ['<svg><rect/></svg>', /viewBox/], ['<svg viewBox="0 0 1 1"><g></svg>', /end tag|unclosed/], ['<svg viewBox="0 0 1 1" a="1" a="2"/>', /repeated/],
    ['<svg viewBox="0 0 1 1"><text>a & b</text></svg>', /ampersand/], ['<svg viewBox="0 0 1 1"><rect x=1/></svg>', /unquoted/], ['<svg viewBox="0 0 1 1"/><svg viewBox="0 0 1 1"/>', /after the root/],
  ] as const) assert.throws(() => engineSvgMarkup(refused, { prefix: 'p', label: 'x', classes: 'engine-board' }), (error: Error) => error instanceof SvgRefused && why.test(error.message), String(why));
});

/** A world/2 board: two styled steps in a frame and a group, one loose arrow, one plain step. */
const board: State = { objects: {
  f: { id: 'f', type: 'frame', name: 'Lane <one>', deleted: false },
  a: { id: 'a', type: 'step', deleted: false, frameId: 'f', label: 'Start & <b>go</b>', x: 100, y: 100, width: 180, height: 90, shape: 'ellipse', groupId: 'g1', stroke: 'red', fill: 'yellow' },
  b: { id: 'b', type: 'step', deleted: false, frameId: 'f', label: 'Check', x: 400, y: 100, width: 180, height: 90, shape: 'diamond', groupId: 'g1', stroke: 'black', fill: 'none' },
  c: { id: 'c', type: 'step', deleted: false, frameId: null, label: 'Done', x: 700, y: 300, width: 200, height: 100, shape: 'rectangle', groupId: null, stroke: 'blue', fill: 'green' },
  gone: { id: 'gone', type: 'step', deleted: true, frameId: null, label: 'Deleted', x: 0, y: 0, width: 10, height: 10, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none' },
  ab: { id: 'ab', type: 'arrow', deleted: false, frameId: 'f', from: 'a', to: 'b' },
  loose: { id: 'loose', type: 'arrow', deleted: false, frameId: null, from: 'b', to: null },
} };
const words = { group: 'Group', loose: 'loose end' };

test('schematic: shape, line, fill, size, position, frames and groups from the judged state; board text escaped', () => {
  const svg = schematicSvg(board, { prefix: 'r1', label: 'Final board', words });
  assert.match(svg, /^<svg viewBox="[-\d. ]+" class="schematic" role="img" aria-label="Final board">/);
  assert.match(svg, /<ellipse cx="190" cy="145" rx="90" ry="45" class="sch-step sch-fill-yellow sch-line-red"\/>/);
  assert.match(svg, /<polygon points="490,100 580,145 490,190 400,145" class="sch-step sch-line-black"\/>/);
  assert.match(svg, /<rect x="700" y="300" width="200" height="100" rx="8" class="sch-step sch-fill-green sch-line-blue"\/>/);
  assert.match(svg, /class="sch-frame"\/><text [^>]*class="sch-frame-label">Lane &lt;one&gt;<\/text>/);
  assert.match(svg, /class="sch-group"\/><text [^>]*class="sch-group-label">Group 1<\/text>/);
  assert.match(svg, />Start &amp;<\/tspan><tspan [^>]*>&lt;b&gt;go&lt;\/b&gt;<\/tspan>/); assert.equal(svg.includes('<b>'), false);
  assert.match(svg, /class="sch-loose"\/><text [^>]*class="sch-loose-label">loose end<\/text>/);
  assert.equal(svg.includes('Deleted'), false, 'a deleted step is not on the board');
  assert.deepEqual(groupsOf(board), [{ name: 'Group 1', members: ['Start & <b>go</b>', 'Check'] }]);
  assert.deepEqual(framesOf(board), [{ name: 'Lane <one>', members: ['Start & <b>go</b>', 'Check'] }]);
  // Grouped and ungrouped, or another fill: a different picture.
  const ungrouped = structuredClone(board); for (const id of ['a', 'b']) (ungrouped.objects[id] as { groupId: string | null }).groupId = null;
  const blue = structuredClone(board); (blue.objects.c as { fill: string }).fill = 'blue';
  assert.notEqual(schematicSvg(ungrouped, { prefix: 'r1', label: 'Final board', words }), svg);
  assert.equal(schematicSvg(ungrouped, { prefix: 'r1', label: 'Final board', words }).includes('sch-group'), false);
  assert.notEqual(schematicSvg(blue, { prefix: 'r1', label: 'Final board', words }), svg);
  assert.deepEqual(groupsOf(ungrouped), []);
});

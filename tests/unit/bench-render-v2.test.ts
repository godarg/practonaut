// Report v2 presentation (PADR-0039 B): no rate finer than 1/n, the engine's SVG reduced to an
// allowlist so board text is never markup, and the schematic that keeps every goal-relevant attribute.
// Expected values are written out by hand next to each case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_SCHEMA_V2, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';
import { escapeHtml, prose, renderHtml, renderTable } from '../../src/bench/render.ts';
import { firstDifference } from '../../src/bench/details.ts';
import { intervalPercent, percentDigits, rateText } from '../../src/bench/rates.ts';
import { engineSvgMarkup, SvgRefused } from '../../src/bench/svg.ts';
import { boardObjects, framesOf, groupsOf, lines, pictureSizeClass, schematicSvg, unionBox } from '../../src/bench/schematic.ts';
import { objectLines } from '../../src/bench/render.ts';
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
  // A fraction that is neither none nor all never rounds to 0 % or 100 %.
  assert.equal(rateText(1, 300, 'en'), '1/300 (< 1 %)');
  assert.equal(rateText(299, 300, 'en'), '299/300 (> 99 %)');
  assert.equal(rateText(1, 3000, 'de'), '1/3000 (< 0,1 %)');
  assert.equal(rateText(2999, 3000, 'en'), '2999/3000 (> 99.9 %)');
  assert.equal(rateText(1, 2000, 'en'), '1/2000 (0.1 %)', '0.05 % rounds up to 0.1 %, not to 0');
  assert.deepEqual([rateText(0, 300, 'en'), rateText(300, 300, 'en')], ['0/300 (0 %)', '300/300 (100 %)']);
  // Wilson 5/6 = 0.4365 … 0.9699 (Newcombe's formula by hand): 43–97 %; 0/20 = 0 … 0.1611: 0–17 %.
  assert.deepEqual(intervalPercent(5, 6), { low: 43, high: 97 });
  assert.deepEqual(intervalPercent(0, 20), { low: 0, high: 17 });
  assert.deepEqual(intervalPercent(20, 20), { low: 83, high: 100 });
});

test('no rate is shown finer than 1/n, in the terminal or on the page, in English and German', () => {
  for (const [n, passed] of [[6, 5], [98, 50], [150, 113], [1200, 1001]] as const) {
    const value = report(n, passed);
    for (const language of ['en', 'de'] as const) {
      const texts = [renderTable(value, language), renderHtml(value, ':root{}', language).replace(/<style>[\s\S]*<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\u00a0/g, ' ').replace(/\u2060/g, '')];
      for (const text of texts) {
        // Remove the confidence level and the interval range: they are estimates, not observed rates.
        const rest = text.replace(/95(-|\u2011| )%(-Intervall| interval) \d+–\d+ %/g, '').replace(/95 %|95[-\u2011]%/g, '');
        // Every percentage belongs to a fraction k/m and has the resolution m allows (each per-task row has its own m).
        let alone = rest;
        for (const match of rest.matchAll(/(\d+)\/(\d+) \((?:[<>] )?(\d+(?:[.,]\d+)?) %\)/g)) {
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
    + '<text x="1" y="1">evil&#x202E;txt.exe</text>'
    + '<rect x="1" y="1" width="2" height="2" fill="url(https://example.invalid/p)" stroke="javascript:alert(4)" xlink:href="#m"/></svg>';
  const markup = engineSvgMarkup(exported, { prefix: 'run1', label: 'Final "board" <b>', classes: 'engine-board' });
  // Its size class sets the floor (0.6 px per board unit) and the cap (1 px per unit) of an 820-unit picture.
  assert.match(markup, /^<svg viewBox="0 0 820 130" class="engine-board pw-9" role="img" aria-label="Final &quot;board&quot; &lt;b&gt;">/);
  // A bidi override in board text is shown escaped, never applied.
  assert.match(markup, /<text x="1" y="1">evil\\u\{202e\}txt\.exe<\/text>/); assert.equal(markup.includes('\u202e'), false);
  // Placed in a shared viewBox: the drawing moves by the offset, the viewBox and size class are the pair's.
  const placed = engineSvgMarkup(exported, { prefix: 'run1', label: 'x', classes: 'engine-board', offset: [80, -20], viewBox: { x: 0, y: -20, width: 1250, height: 400 } });
  assert.match(placed, /^<svg viewBox="0 -20 1250 400" class="engine-board pw-13" role="img" aria-label="x"><g class="engine-content"><g transform="translate\(80 -20\)"><defs>/);
  for (const forbidden of ['<script', 'onload', 'alert(2)', '<foreignObject', 'html', 'style', 'data:', '<a ', 'link', '<image', 'https:', 'javascript', 'xlink', 'font-family', '<metadata']) assert.equal(markup.includes(forbidden), false, forbidden);
  assert.match(markup, /<mask id="run1-m">/); assert.match(markup, /mask="url\(#run1-m\)"/);
  // The export's background (a rectangle over the whole viewBox) is paper, not content: left out.
  assert.equal(markup.includes('width="820" height="130" fill="#ffffff"'), false);
  assert.match(markup, /<rect x="0" y="0" width="10" height="10" fill="#fff"><\/rect><\/mask>/, 'a rectangle inside the drawing stays');
  assert.match(markup, /<path d="M0 0 C36 0, 72 0, 180 0" stroke="#1e1e1e" stroke-width="2" fill="none"><\/path>/);
  assert.match(markup, /<text x="29.3" y="18.9" font-size="20px" fill="#1e1e1e" text-anchor="middle">&lt;img src=x onerror=alert\(3\)&gt; &amp; &lt;b&gt;<\/text>/);
  // A reference to anything but a local id is dropped, the element stays.
  assert.match(markup, /<rect x="1" y="1" width="2" height="2"><\/rect>/);
  // CSS names functions in any letter case: URL(…) and Url(…) are references too; only local ones stay,
  // written back with the prefix; every other function but the transforms drops its attribute.
  const cased = engineSvgMarkup('<svg viewBox="0 0 9 9"><mask id="m"/><rect x="1" y="1" width="1" height="1" fill="URL(evil.svg)" stroke="Url( evil.svg )" mask="URL(#m)"/><g transform="Translate(1 2) ROTATE(0 1 1)" fill="image(x.png)" stroke="Var(--x)"/></svg>', { prefix: 'p', label: 'x', classes: 'engine-board' });
  assert.match(cased, /<rect x="1" y="1" width="1" height="1" mask="url\(#p-m\)"><\/rect>/);
  assert.match(cased, /<g transform="Translate\(1 2\) ROTATE\(0 1 1\)"><\/g>/);
  assert.equal(/evil|image\(|Var\(/i.test(cased), false);
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
  assert.match(svg, /^<svg viewBox="[-\d. ]+" class="schematic pw-\d+" role="img" aria-label="Final board">/);
  assert.match(svg, /<ellipse cx="190" cy="145" rx="90" ry="45" class="sch-step sch-fill-yellow sch-line-red"\/>/);
  assert.match(svg, /<polygon points="490,100 580,145 490,190 400,145" class="sch-step sch-line-black"\/>/);
  // Sharp corners, as Excalidraw draws these steps.
  assert.match(svg, /<rect x="700" y="300" width="200" height="100" class="sch-step sch-fill-green sch-line-blue"\/>/);
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
  // Board text with a bidi override is shown escaped inside the picture too.
  const bidi = structuredClone(board); (bidi.objects.b as { label: string }).label = 'Che\u202eck';
  assert.match(schematicSvg(bidi, { prefix: 'r1', label: 'Final board', words }), />Che\\u\{202e\}ck<\/tspan>/);
});

test('schematic: two arrows between the same steps are drawn apart, never as one double-headed line', () => {
  const both = structuredClone(board); both.objects.ba = { id: 'ba', type: 'arrow', deleted: false, frameId: 'f', from: 'b', to: 'a' };
  const svg = schematicSvg(both, { prefix: 'r1', label: 'x', words });
  const between = [...svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" class="sch-edge" marker-end/g)].map(match => match.slice(1).map(Number));
  assert.equal(between.length, 2);
  // a (centre 190,145) and b (centre 490,145) lie on one horizontal line: the two arrows are 18 units apart
  // vertically (each 9 from the centre line) and point in opposite directions.
  const [first, second] = between as [number[], number[]];
  assert.deepEqual([first[1], first[3], second[1], second[3]].map(value => Math.abs(value! - 145)), [9, 9, 9, 9]);
  assert.notEqual(first[1], second[1]);
  assert.equal(Math.sign(first[2]! - first[0]!), -Math.sign(second[2]! - second[0]!));
  // One arrow alone stays on the centre line.
  assert.match(schematicSvg(board, { prefix: 'r1', label: 'x', words }), /<line x1="283" y1="145" x2="395" y2="145" class="sch-edge" marker-end/);
  // The offset lines meet each shape's own outline, without a gap: at 9 units off the centre line the
  // diamond b (centre 490, half-width 90, half-height 45) is 90 · (1 − 9/45) = 72 wide each side, so its
  // left outline is at 418; the ellipse a (centre 190, radii 90 × 45) reaches 90 · √(1 − (9/45)²) = 88.18,
  // so its right outline is at 278.18. Arrow ends keep their gap (3 at the start, 5 at the tip).
  const fromA = between.find(line => line[0]! < line[2]!)!, fromB = between.find(line => line[0]! > line[2]!)!;
  assert.ok(Math.abs(fromA[0]! - 281.2) < 0.15 && Math.abs(fromA[2]! - 413) < 0.15, `a→b ${fromA.join(' ')}`);
  assert.ok(Math.abs(fromB[0]! - 415) < 0.15 && Math.abs(fromB[2]! - 283.2) < 0.15, `b→a ${fromB.join(' ')}`);
});

test('board text is data: quoted labels and task ids never hyphenate; a number stays with its word', () => {
  // Quoted parts and named ids are wrapped as data; the rest stays prose (hyphenated in the page's language).
  assert.equal(prose('One rectangle “Review” in the default style.', []), 'One rectangle <span class="data quoted">“Review”</span> in the default style.');
  assert.equal(prose('connect · seed 1', ['connect']), '<span class="data id">connect</span> · seed\u00a01');
  assert.equal(prose('„Archive“ & <b>', ['data']), '<span class="data quoted">„Archive“</span> &amp; &lt;b&gt;', 'an id never matches inside markup');
  // A no-break space joins a number and its word on the page, but quoted data keeps its own characters.
  assert.equal(escapeHtml('6 runs · seed 2 · after #3 · “Wrong 1”'), '6\u00a0runs · seed\u00a02 · after\u00a0#3 · “Wrong 1”');
});

test('pictures of a pair share one viewBox and size class; long words split evenly with no hyphen drawn, punctuation stays with its word', () => {
  const target = structuredClone(board); (target.objects.c as { x: number }).x = 1400;
  const view = unionBox({ x: -10, y: 0, width: 500, height: 300 }, { x: 100, y: -50, width: 900, height: 100 });
  assert.deepEqual(view, { x: -10, y: -50, width: 1010, height: 350 });
  const one = schematicSvg(board, { prefix: 'a', label: 'x', words, viewBox: view }), two = schematicSvg(target, { prefix: 'b', label: 'x', words, viewBox: view });
  for (const svg of [one, two]) assert.match(svg, /^<svg viewBox="-10 -50 1010 350" class="schematic pw-11" /);
  // Where a scrolling pair opens: at the first object that differs from the target. Step c (x 700–900) has
  // another fill in the target: its centre is 800, right of the middle of a 1010-wide view from −10.
  const recoloured = structuredClone(board); (recoloured.objects.c as { fill: string }).fill = 'blue';
  assert.equal(firstDifference(board, recoloured), 800);
  assert.equal(firstDifference(board, structuredClone(board)), null, 'the same board: nothing to open at');
  // A label the final board lacks is the first difference, at the target's step (a: x 100–280, centre 190).
  const relabelled = structuredClone(board); (relabelled.objects.a as { label: string }).label = 'Begin';
  assert.equal(firstDifference(board, relabelled), 190);
  // Size classes: k × 100 units, at least 3 and at most 60.
  assert.deepEqual([100, 300, 301, 1010, 6000, 9000].map(pictureSizeClass), ['pw-3', 'pw-3', 'pw-4', 'pw-11', 'pw-60', 'pw-60']);
  // A 180-unit box holds 13 monospace characters of 20 units: "„Genehmigung“" fits whole, with both quotes;
  // the 25-letter word is split into two even pieces (13 + 12 letters) and no hyphen is drawn into the
  // label (it is data); past three lines the drawing cuts with an ellipsis (the legend keeps it in full).
  assert.deepEqual(lines('„Genehmigung“ Freigabeprüfungsverfahren', 180, 20), ['„Genehmigung“', 'Freigabeprüfu', 'ngsverfahren']);
  // 43 letters at 13 a line: four even pieces of 11; the label runs past three lines, so the third ends in "…".
  assert.deepEqual(lines('Kreditorenstammdatenänderungsantragsprüfung Rechnung Zahlung', 180, 20), ['Kreditorens', 'tammdatenän', 'derungsantr…']);
  assert.deepEqual(lines('Prüfung (Stufe 2)', 180, 20), ['Prüfung', '(Stufe 2)']);
});

test('the legend keeps every label in full and every attribute in words: boards that differ in a label tail differ on the page', () => {
  const long = (tail: string): State => { const value = structuredClone(board); (value.objects.c as { label: string }).label = `Very long label that wraps over more than three lines in the drawing ${tail}`; return value; };
  const one = long('ending one'), two = long('ending two');
  // The drawing cuts after three lines, so the pictures alone may agree …
  assert.equal(schematicSvg(one, { prefix: 'r', label: 'x', words }), schematicSvg(two, { prefix: 'r', label: 'x', words }));
  // … the legend under them does not.
  const [lineOne, lineTwo] = [objectLines(boardObjects(one), 'en'), objectLines(boardObjects(two), 'en')];
  assert.notDeepEqual(lineOne, lineTwo);
  assert.ok(lineOne.includes('“Very long label that wraps over more than three lines in the drawing ending one”: rectangle, line blue, fill green, 200 × 100 at (700, 300)'));
  assert.ok(lineOne.includes('“Start & <b>go</b>”: ellipse, line red, fill yellow, 180 × 90 at (100, 100), in frame “Lane <one>”, Group 1'));
  assert.ok(lineOne.includes('“Check”: diamond, line black, no fill, 180 × 90 at (400, 100), in frame “Lane <one>”, Group 1'));
  assert.ok(lineOne.includes('arrow “Check” → loose end'));
  assert.ok(objectLines(boardObjects(one), 'de').includes('„Check“: Raute, Linie schwarz, keine Füllung, 180 × 90 bei (400, 100), im Rahmen „Lane <one>“, Gruppe 1'));
});

// The report's board pair on draw.io (design-language §10.5: "the pair shares one viewBox (one scale)").
// draw.io's SVG export starts at its drawing's top-left corner, the target schematic at the board's
// padded bounds; the report places the export in board units by the judged steps, so both pictures
// share one viewBox and a step is drawn where the session says it is. Read from the committed
// draw.io evidence: real exports of the pinned app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadReportDetails } from '../../src/bench/details.ts';
import { detailWords, readTokensCss, renderHtml } from '../../src/bench/render.ts';
import { renderCompareHtml } from '../../src/bench/render-compare.ts';
import { compareReports } from '../../src/bench/compare.ts';
import { validateBenchReportV3, type SessionReportV3 } from '../../src/bench/report.ts';
import { drawioPlacement, engineSvgMarkup } from '../../src/bench/svg.ts';
import { pictureOverflow } from '../../src/bench/schematic.ts';

const folder = 'docs/benchmarks/drawio/drawio-oracle';
const viewBox = (markup: string | null | undefined): string | undefined => /viewBox="([^"]+)"/.exec(markup ?? '')?.[1];

test('every draw.io final-board picture shares one viewBox with its target, and a step lands on its board coordinates', async () => {
  const report = validateBenchReportV3(JSON.parse(readFileSync(join(folder, 'report.json'), 'utf8')));
  const details = await loadReportDetails(report, folder, detailWords('en'));
  assert.equal(details.runs.size, 48);
  for (const [id, detail] of details.runs) {
    assert.equal(detail.picture?.kind, 'engine', id);
    assert.equal(viewBox(detail.picture!.markup), viewBox(detail.target), `${id}: one viewBox for the pair`);
  }
  // connect-s0-r1: where the session puts step a, and where draw.io drew it (read here from the export).
  const svg = readFileSync(join(folder, 'connect-s0-r1', 'board.svg'), 'utf8');
  const a = (JSON.parse(readFileSync(join(folder, 'connect-s0-r1', 'session.json'), 'utf8')) as { state: { objects: Record<string, { x: number; y: number }> } }).state.objects.a!;
  const drawn = /data-cell-id="a"[\s\S]*?<rect x="(-?[0-9.]+)" y="(-?[0-9.]+)"/.exec(svg)!;
  const shift = /transform="translate\((-?[0-9.]+) (-?[0-9.]+)\)"/.exec(details.runs.get('connect-s0-r1')!.picture!.markup)!;
  assert.deepEqual([Number(shift[1]), Number(shift[2])], [a.x - Number(drawn[1]), a.y - Number(drawn[2])]);
  // Groups are outlined over the export once the two share coordinates.
  assert.equal(details.runs.get('group-s0-r1')!.groupOverlay, true);
});

test('a draw.io pair is drawn at exactly one px per board unit at any width, so draw.io\'s 12-unit text stays at 12 px (design-language §10.5; review m4)', async () => {
  const report = validateBenchReportV3(JSON.parse(readFileSync(join(folder, 'report.json'), 'utf8')));
  const details = await loadReportDetails(report, folder, detailWords('en'));
  // The svg's width attribute in px, and whether it carries the class the width rule leaves alone.
  const sized = (markup: string | null | undefined): [string | undefined, boolean] => { const tag = /^<svg\b[^>]*>/.exec(markup ?? '')?.[0] ?? ''; return [/\swidth="([0-9.]+)"/.exec(tag)?.[1], /class="[^"]*\bpu\b/.test(tag)]; };
  for (const [id, detail] of details.runs) {
    const width = viewBox(detail.picture!.markup)!.split(' ')[2];
    assert.deepEqual(sized(detail.picture!.markup), [width, true], id);
    assert.deepEqual(sized(detail.target), [width, true], `${id}: the target shares the scale`);
  }
  // Past the old 6,000-unit cap of the size classes: a board 9,000 and 20,000 units wide.
  const svg = readFileSync(join(folder, 'connect-s0-r1', 'board.svg'), 'utf8');
  for (const width of [9000, 20000]) {
    assert.deepEqual(sized(engineSvgMarkup(svg, { prefix: 'wide', label: 'x', classes: 'engine-board engine-board--drawio', floor: 1, viewBox: { x: 0, y: 0, width, height: 200 } })), [String(width), true]);
    assert.equal(pictureOverflow(width, 1), 'wide');
  }
  // report.css: the 100 % width rule skips such a picture, and no rule caps it.
  const css = readFileSync('src/bench/report.css', 'utf8');
  assert.match(css, /\.schematic:not\(\.pu\),\.engine-board:not\(\.pu\)\{width:100%\}/);
  assert.match(css, /\.pu\{max-width:none\}/);
  assert.equal(/\.pu-\d+\{/.test(css), false);
});

test('the interim notice once on every page that names draw.io, never on one that does not; draw.io\'s picture is marked as its own (review D1-F4, F5)', async () => {
  const notice = { en: 'draw.io is a registered trademark; Practonaut is not affiliated with, endorsed or sponsored by draw.io Ltd or draw.io AG.', de: 'draw.io ist eine eingetragene Marke; Practonaut ist mit draw.io Ltd und draw.io AG nicht verbunden und wird von ihnen weder unterstützt noch gesponsert.' } as const;
  const read = (name: string) => validateBenchReportV3(JSON.parse(readFileSync(join('docs/benchmarks/drawio', name, 'report.json'), 'utf8'))) as SessionReportV3;
  const drawio = read('drawio-oracle'), excalidraw = read('excalidraw-oracle'), tokens = await readTokensCss();
  const count = (html: string, text: string): number => html.replace(/<[^>]+>/g, '').split(text).length - 1;
  for (const language of ['en', 'de'] as const) {
    const drawioPage = renderHtml(drawio, tokens, language, 'consistency-checked', await loadReportDetails(drawio, folder, detailWords(language)));
    assert.equal(count(drawioPage, notice[language]), 1, `${language}: the draw.io report`);
    assert.ok(drawioPage.split('class="engine-board engine-board--drawio').length - 1 >= 48, `${language}: every picture is marked as draw.io's own`);
    assert.equal(count(renderHtml(excalidraw, tokens, language, 'consistency-checked'), notice[language]), 0, `${language}: an Excalidraw report`);
    const side = (report: SessionReportV3) => ({ report, verification: 'consistency-checked' as const });
    assert.equal(count(renderCompareHtml(side(excalidraw), side(drawio), compareReports(excalidraw, drawio), tokens, language), notice[language]), 1, `${language}: the compare page`);
    assert.equal(count(renderCompareHtml(side(excalidraw), side(excalidraw), compareReports(excalidraw, excalidraw), tokens, language), notice[language]), 0, `${language}: Excalidraw only`);
  }
});

test('placement reads only numbers: no step found, an id outside the pattern or an unbounded shift give no placement', () => {
  const svg = '<svg viewBox="0 0 200 100"><g data-cell-id="a"><rect x="10" y="20" width="50" height="40"/></g><g data-cell-id="b"><ellipse cx="130" cy="50" rx="30" ry="20"/></g><g data-cell-id="c"><path d="M 170 50 L 185 35 L 200 50 L 185 65 Z"/></g></svg>';
  assert.deepEqual(drawioPlacement(svg, [{ id: 'a', x: 110, y: 220 }]), { x: 100, y: 200, width: 200, height: 100 });
  assert.deepEqual(drawioPlacement(svg, [{ id: 'b', x: 200, y: 230 }]), { x: 100, y: 200, width: 200, height: 100 }, 'an ellipse: its box is the centre less the radii');
  assert.deepEqual(drawioPlacement(svg, [{ id: 'c', x: 270, y: 235 }]), { x: 100, y: 200, width: 200, height: 100 }, 'a rhombus: its box is the path\'s least x and y');
  assert.equal(drawioPlacement(svg, [{ id: 'z', x: 0, y: 0 }]), null);
  assert.equal(drawioPlacement(svg, [{ id: 'a" onload="x', x: 0, y: 0 }]), null);
  assert.equal(drawioPlacement(svg, [{ id: 'a', x: 5_000_000, y: 0 }]), null);
  assert.equal(drawioPlacement('<svg width="10"></svg>', [{ id: 'a', x: 0, y: 0 }]), null);
});

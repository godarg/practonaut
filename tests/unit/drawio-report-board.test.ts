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
import { detailWords } from '../../src/bench/render.ts';
import { validateBenchReportV3 } from '../../src/bench/report.ts';
import { drawioPlacement } from '../../src/bench/svg.ts';

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

test('a draw.io pair is never drawn below one px per board unit, so draw.io\'s 12-unit text stays at 12 px (design-language §10.5)', async () => {
  const report = validateBenchReportV3(JSON.parse(readFileSync(join(folder, 'report.json'), 'utf8')));
  const details = await loadReportDetails(report, folder, detailWords('en'));
  const sizeClass = (markup: string | null | undefined): string | undefined => /class="[^"]*\b(p[uw]-\d+)\b/.exec(markup ?? '')?.[1];
  for (const [id, detail] of details.runs) {
    const width = Number(viewBox(detail.picture!.markup)!.split(' ')[2]), k = Math.min(60, Math.max(3, Math.ceil(width / 100)));
    assert.equal(sizeClass(detail.picture!.markup), `pu-${k}`, id);
    assert.equal(sizeClass(detail.target), `pu-${k}`, `${id}: the target shares the scale`);
  }
  // report.css: pu-k is exactly k × 100 px wide (k × 6.25 rem), for every k the class can take.
  const css = readFileSync('src/bench/report.css', 'utf8');
  for (let k = 3; k <= 60; k++) {
    const rule = new RegExp(`\\.pu-${k}\\{min-width:([0-9.]+)rem;max-width:([0-9.]+)rem\\}`).exec(css);
    assert.ok(rule, `pu-${k}`);
    assert.deepEqual([Number(rule[1]) * 16, Number(rule[2]) * 16], [k * 100, k * 100], `pu-${k}`);
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

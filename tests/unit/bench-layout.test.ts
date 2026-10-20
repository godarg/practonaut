// The report's layout overlay and legend (PADR-0047 decision 7): the labelled reasons of unmet layout
// clauses come from the shared analysis and read as words with their measured numbers, EN and DE; the
// overlay draws the judged geometry, keeps its lines off every text of the picture (also where two
// label areas overlap) and its layout area's label off texts, outlines and steps. Expected marks and
// numbers are derived by hand from the fixture's coordinates (tests/support/layout-world.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutMarks, openingSide, PHONE_WINDOW } from '../../src/bench/details.ts';
import { layoutMarkText } from '../../src/bench/render.ts';
import { judgedOverlay, pictureSizeClass, schematicHalo, schematicText, textFloorScale, type Box, type OverlayContext } from '../../src/bench/schematic.ts';
import { engineSvgMarkup, exportHalo, readEngineSvg } from '../../src/bench/svg.ts';
import { publicConditions } from '../../src/host/session.ts';
import { rectUnion } from '../../src/player/ui/rect-union.ts';
import type { State, StepV2 } from '../../src/world/types.ts';
import { aligned, arrow, board, box, clearOfSteps, everything, inFrame, noCrossing } from '../support/layout-board.ts';
import { LAYOUT_GOAL_STATE, LAYOUT_START_STATE, layoutWorld } from '../support/layout-world.ts';

const conditions = publicConditions(layoutWorld().tasks[0]!);
const overlays = conditions.flatMap(condition => condition.layout ? [condition.layout] : []);
const schematic = (state: State): OverlayContext => ({ ...schematicText(state, { frames: true, groups: true, groupWord: 'Group' }), halo: schematicHalo(state, true) });

/** The overlay's clip as rectangles (`M x y h w v h h -w Z`) and whether it shows a point (evenodd). */
function clipOf(svg: string, prefix: string): (x: number, y: number) => boolean {
  const d = new RegExp(`<clipPath id="${prefix}-judged"><path d="([^"]*)" clip-rule="evenodd"/>`).exec(svg)?.[1];
  assert.ok(d, 'a clip');
  const rects = [...d.matchAll(/M (-?[\d.e+]+) (-?[\d.e+]+) h (-?[\d.e+]+) v (-?[\d.e+]+) h -?[\d.e+]+ Z/g)].map(m => m.slice(1, 5).map(Number) as [number, number, number, number]);
  return (x, y) => rects.filter(([rx, ry, w, h]) => x > rx && x < rx + w && y > ry && y < ry + h).length % 2 === 1;
}
/** Points along every line and rectangle edge drawn inside the clipped group. */
function clippedPoints(svg: string): Array<[number, number]> {
  const group = /<g clip-path="url\(#[^)]*\)">(.*?)<\/g>/.exec(svg)?.[1] ?? '';
  const points: Array<[number, number]> = [];
  const along = (x1: number, y1: number, x2: number, y2: number): void => { for (let i = 0; i <= 200; i++) points.push([x1 + (x2 - x1) * i / 200, y1 + (y2 - y1) * i / 200]); };
  for (const m of group.matchAll(/<line x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g)) along(...(m.slice(1, 5).map(Number) as [number, number, number, number]));
  for (const m of group.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)) {
    const [x, y, w, h] = m.slice(1, 5).map(Number) as [number, number, number, number];
    along(x, y, x + w, y); along(x + w, y, x + w, y + h); along(x, y + h, x + w, y + h); along(x, y, x, y + h);
  }
  return points;
}
const inside = (b: Box, x: number, y: number): boolean => x > b.x && x < b.x + b.width && y > b.y && y < b.y + b.height;
const meets = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('report: unmet layout clauses', () => {
  it('label every reason by its condition and say it in words with the measured numbers (design review L1-F10, L1-F11)', () => {
    const marks = layoutMarks(LAYOUT_START_STATE, conditions);
    // By hand on the start: a2 (480–640 × 120–200) overlaps a3 (540–700 × 100–180) by 100 along x and 60
    // along y, and touches b2 (320–480 × 200–280) at the corner (480, 200): 0 px apart; b3 ends at 940,
    // past 760; the arrow Decide → Pack runs from (620, 140) to (180, 340) through b2's centre (400, 240),
    // where the arrows from Pack, to Done and the self-loop on Ship meet, and through a2's and b2's boxes;
    // e1 ends at a2's centre (560, 160) inside a3's box; lane A's y-centres are 140, 160, 140 (20 apart);
    // a2 and a3 overlap by 100 along x; lane B's y-centres are 340, 240, 340 (100 apart); lane B's gaps
    // are 60 (b1–b2: 320 − 260) and 300 (b2–b3: 780 − 480).
    assert.deepEqual(marks.map(mark => layoutMarkText(mark, 'en')), [
      '1.1 · condition 1: “Check” and “Decide” overlap (they must be at least 20 px apart)',
      '1.2 · condition 1: “Check” and “Ship” are 0 px apart (at least 20)',
      '2.1 · condition 2: “Done” lies outside the layout area',
      '3.1 · condition 3: the arrows “Decide” → “Pack” and “Pack” → “Ship” cross or touch',
      '3.2 · condition 3: the arrows “Decide” → “Pack” and “Ship” → “Done” cross or touch',
      '3.3 · condition 3: the arrows “Decide” → “Pack” and “Ship” → “Ship” cross or touch',
      '4.1 · condition 4: the arrow “Start” → “Check” touches the box of “Decide”',
      '4.2 · condition 4: the arrow “Decide” → “Pack” touches the box of “Check”',
      '4.3 · condition 4: the arrow “Decide” → “Pack” touches the box of “Ship”',
      '5.1 · condition 5: the y-centres of “Start” and “Check” differ by 20 px (at most 4)',
      '6.1 · condition 6: “Check” and “Decide” overlap by 100 px along x',
      '7.1 · condition 7: the y-centres of “Ship” and “Pack” differ by 100 px (at most 4)',
      '8.1 · condition 8: the gaps along x differ by more than 4 px: 60 px between “Pack” and “Ship”, 300 px between “Ship” and “Done”',
    ]);
    assert.equal(layoutMarkText(marks[2]!, 'de'), '2.1 · Bedingung 2: „Done“ liegt außerhalb des Layoutbereichs');
    assert.equal(layoutMarkText(marks[9]!, 'de'), '5.1 · Bedingung 5: die y-Mittelpunkte von „Start“ und „Check“ weichen um 20 px ab (höchstens 4)');
    assert.equal(layoutMarkText(marks[12]!, 'de'), '8.1 · Bedingung 8: die Lücken entlang x weichen um mehr als 4 px ab: 60 px zwischen „Pack“ und „Ship“, 300 px zwischen „Ship“ und „Done“');
    // Half pixels: centres 0.5 apart read "0.5 px" and „0,5 px“.
    const half: State = structuredClone(LAYOUT_GOAL_STATE); Object.assign(half.objects.a2!, { height: 81 });
    const spread = layoutMarks(half, [{ predicate: aligned(inFrame('step', 'Lane A', 3), 'y', 'center', 0), layout: { op: 'aligned', steps: { type: 'step', scope: { kind: 'frame', name: 'Lane A' }, count: 3 }, axis: 'y', anchor: 'center', tolerance: 0 } }]);
    assert.deepEqual(spread.map(mark => [layoutMarkText(mark, 'en'), layoutMarkText(mark, 'de')]), [['1.1 · condition 1: the y-centres of “Start” and “Check” differ by 0.5 px (at most 0)', '1.1 · Bedingung 1: die y-Mittelpunkte von „Start“ und „Check“ weichen um 0,5 px ab (höchstens 0)']]);
    assert.deepEqual(layoutMarks(LAYOUT_GOAL_STATE, conditions), [], 'the reference meets every clause: no mark');
  });

  it('name a count that differs and a loose end; at most five reasons per clause', () => {
    const outOfLane: State = structuredClone(LAYOUT_GOAL_STATE); (outOfLane.objects.b3 as StepV2).frameId = null;
    (outOfLane.objects.e5 as { frameId: string | null }).frameId = null;
    const lane = [{ predicate: aligned(inFrame('step', 'Lane B', 3), 'y', 'center', 4), layout: conditions[6]!.layout! }];
    assert.deepEqual(layoutMarks(outOfLane, lane).map(mark => layoutMarkText(mark, 'en')), ['1.1 · condition 1: expected 3 steps in “Lane B”, found 2']);
    assert.equal(layoutMarkText(layoutMarks(outOfLane, lane)[0]!, 'de'), '1.1 · Bedingung 1: erwartet 3 Schritte in „Lane B“, gefunden 2');
    const loose: State = structuredClone(LAYOUT_GOAL_STATE); (loose.objects.e5 as { to: string | null }).to = null;
    (loose.objects.e5 as { frameId: string | null }).frameId = 'fB';
    const clear = [{ predicate: clearOfSteps(everything('arrow', 6), everything('step', 6)), layout: conditions[3]!.layout! }];
    assert.deepEqual(layoutMarks(loose, clear).map(mark => layoutMarkText(mark, 'en')), ['1.1 · condition 1: the arrow “Ship” → a loose end is not attached at both ends']);
    // Six overlapping steps: fifteen overlapping pairs, five of them named.
    const pile: State = structuredClone(LAYOUT_GOAL_STATE);
    for (const id of ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']) Object.assign(pile.objects[id]!, { x: 100, y: 100 });
    assert.equal(layoutMarks(pile, [conditions[0]!]).length, 5);
  });

  it('size a pair of pictures so that an export\'s smallest text (a frame\'s name at 14 units) stays at 12 px', () => {
    // Hand-written export: a frame name at 14 px, a label at 20 px.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 400"><text x="0" y="12" font-size="14px">Lane A</text><text x="10" y="40" font-size="20px">Pack</text></svg>';
    assert.equal(readEngineSvg(svg, 'p').smallestText, 14);
    assert.equal(readEngineSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="1" height="1"/></svg>', 'p').smallestText, null);
    assert.equal(textFloorScale(14), 20 / 14);
    assert.equal(textFloorScale(20), 1);
    assert.equal(textFloorScale(null), 1);
    // The floor is 0.6 px per unit for the class of the width counted: 14-unit text at 20/14 of it is 12 px.
    assert.equal(pictureSizeClass(1000 * textFloorScale(14)), 'pw-15');
  });

  it('draw the judged geometry: the layout area with its corners, the boxes of ellipses and diamonds, the segments, the self-loop ring under its label again and the labelled marks', () => {
    const svg = judgedOverlay(LAYOUT_START_STATE, overlays, [{ label: '1.1', steps: ['a2', 'a3'], arrows: [] }, { label: '2.1', steps: ['b3'], arrows: [] }, { label: '12.3', steps: ['a2'], arrows: [] }], { canvas: 'Layout area' }, 'run0-final', schematic(LAYOUT_START_STATE));
    const count = (pattern: RegExp): number => (svg.match(pattern) ?? []).length;
    assert.equal(count(/class="sch-judged-canvas"/g), 1);
    assert.match(svg, />Layout area \(40, 40\)–\(760, 440\)</);
    assert.equal(count(/class="sch-judged-box"/g), 3, 'Start, Done (ellipses) and Decide (diamond)');
    assert.equal(count(/class="sch-judged-segment"/g), 5);
    assert.equal(count(/class="sch-judged-point"/g), 1);
    // Ship's label again over its ring, with a halo in its frame's colour (it has no fill).
    assert.match(svg, /<circle cx="400" cy="240" r="18" class="sch-judged-point"\/><text x="400" y="[\d.]+" text-anchor="middle" class="sch-label sch-halo sch-halo--frame"><tspan x="400" dy="0">Ship<\/tspan><\/text>/);
    // Marks are capsules with their label; the two on Check (1.1 and 12.3) and the one on Decide (1.1)
    // stay near their corners, (480, 120) and (540, 100), without covering each other.
    assert.equal(count(/class="sch-mark"/g), 4);
    assert.deepEqual([...svg.matchAll(/class="sch-mark-number">([^<]*)</g)].map(m => m[1]), ['1.1', '1.1', '2.1', '12.3']);
    const capsules = [...svg.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="32" rx="16" class="sch-mark"\/><text [^>]*>([^<]*)</g)].map(m => ({ label: m[4]!, x: Number(m[1]) + Number(m[3]) / 2, y: Number(m[2]) + 16, box: { x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: 32 } }));
    const near = (label: string, x: number, y: number): boolean => capsules.some(c => c.label === label && Math.hypot(c.x - x, c.y - y) <= 160);
    assert.ok(near('1.1', 480, 120) && near('1.1', 540, 100) && near('12.3', 480, 120) && near('2.1', 780, 300), JSON.stringify(capsules));
    for (const [i, a] of capsules.entries()) for (const b of capsules.slice(i + 1)) assert.equal(meets(a.box, b.box), false);
    assert.equal(judgedOverlay(LAYOUT_START_STATE, [], [], { canvas: 'Layout area' }, 'x', schematic(LAYOUT_START_STATE)), '', 'no layout condition, no overlay');
    // Every mark of the start's thirteen reasons: no two cover each other, none covers a label. On the
    // start, Ship's centre is the middle of the arrow Decide → Pack and the point of its self-loop.
    const placements = layoutMarks(LAYOUT_START_STATE, conditions).map(mark => { const ids = Object.entries(mark.names); return { label: mark.label, steps: [...new Set(ids.filter(([, v]) => 'step' in v).map(([id]) => id))], arrows: ids.filter(([, v]) => !('step' in v)).map(([id]) => id) }; });
    const context = schematic(LAYOUT_START_STATE), all = judgedOverlay(LAYOUT_START_STATE, overlays, placements, { canvas: 'Layout area' }, 'all', context);
    const boxes = [...all.matchAll(/<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="32" rx="16" class="sch-mark"\/>/g)].map(m => ({ x: Number(m[1]), y: Number(m[2]), width: Number(m[3]), height: 32 }));
    assert.equal(boxes.length, placements.reduce((sum, p) => sum + p.steps.length + p.arrows.length, 0));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) assert.equal(meets(a, b), false, `marks at ${a.x},${a.y} and ${b.x},${b.y}`);
      assert.equal(context.texts.some(text => meets(a, text)), false, `a mark at ${a.x},${a.y} covers a label`);
    }
  });

  it('cuts the label areas out as a union: a line through two overlapping labels stays hidden in both (Codex review)', () => {
    // A and B lie on each other, both labelled "Pack"; C is to the right. The judged arrow A → C runs
    // through both label areas. Cut out with evenodd one by one, the overlap would count three times and
    // show the line again.
    const state = board(box('A', 0, 0, 160, 80, null, { label: 'Pack' }), box('B', 0, 0, 160, 80, null, { label: 'Pack' }), box('C', 300, 0, 160, 80, null, { label: 'Other' }), arrow('ac', 'A', 'C'), arrow('bc', 'B', 'C'));
    const svg = judgedOverlay(state, [{ op: 'arrowsNoCrossing', arrows: { type: 'arrow', scope: { kind: 'all' }, count: 2 } }], [], { canvas: 'Layout area' }, 'u', schematic(state));
    const shows = clipOf(svg, 'u');
    assert.equal(shows(80, 40), false, 'the middle of the two labels');
    assert.equal(shows(80 + 20, 40), false);
    assert.equal(shows(230, 40), true, 'between the steps the line shows');
    // The union itself: disjoint pieces covering exactly the area of the union.
    const pieces = rectUnion([{ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 }, { x: 0, y: 0, width: 10, height: 10 }]);
    assert.equal(pieces.reduce((sum, r) => sum + r.width * r.height, 0), 175, '100 + 100 − 25');
    for (const [i, a] of pieces.entries()) for (const b of pieces.slice(i + 1)) assert.equal(meets(a, b), false, 'disjoint');
  });

  it('keeps every judged line off an export\'s texts and puts the layout area\'s label clear of texts, outlines and steps (design review L1-F4)', () => {
    // A hand-written export in Excalidraw's own shape: a frame name whose box crosses the layout area's
    // top edge (y 40), a frame outline whose bottom edge runs where the label would go under the area,
    // and Ship's label. Offset (0, 0): export units are board units.
    const exported = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 520">'
      + '<g transform="translate(60 30) rotate(0 22 8.75)"><text x="0" y="12.5" font-size="14px" fill="#999999" text-anchor="start">Lane A</text></g>'
      + '<rect transform="translate(20 240.5) rotate(0 460 115)" width="920px" height="230px" rx="8" ry="8" fill="none" stroke="#bbb" stroke-width="2"></rect>'
      + '<g transform="translate(376.5 228) rotate(0 23.5 12)"><text x="23.5" y="18.9" font-size="20px" fill="#1e1e1e" text-anchor="middle">Ship</text></g>'
      + '</svg>';
    const read = readEngineSvg(exported, 'e');
    assert.deepEqual(read.texts.map(text => text.box), [{ x: 60, y: 30, width: 44, height: 17.5 }, { x: 376.5, y: 228, width: 47, height: 24 }]);
    assert.deepEqual(read.outlines, [{ x: 20, y: 240.5, width: 920, height: 230 }]);
    const context: OverlayContext = { texts: read.texts.map(text => text.box), outlines: read.outlines, halo: exportHalo(read, [0, 0]) };
    const svg = judgedOverlay(LAYOUT_START_STATE, overlays, [], { canvas: 'Layout area' }, 'eng', context);
    const shows = clipOf(svg, 'eng');
    const crossing = clippedPoints(svg).filter(([x, y]) => shows(x, y) && context.texts.some(text => inside(text, x, y)));
    assert.deepEqual(crossing, [], 'no judged line shows inside an export text');
    assert.ok(clippedPoints(svg).some(([x, y]) => y === 40 && x > 60 && x < 104), 'the area\'s top edge does run past "Lane A" (and is cut there)');
    // The label: not under the area at the left (the outline's bottom edge at 470.5 runs there), but at
    // the next free place; it meets no text, crosses no outline and covers no step.
    const label = /<text x="([\d.]+)" y="([\d.]+)" class="sch-judged-label">Layout area \(40, 40\)–\(760, 440\)<\/text>/.exec(svg);
    assert.ok(label);
    const [lx, ly] = [Number(label[1]), Number(label[2])];
    const labelBox = { x: lx - 2, y: ly - 19, width: [...'Layout area (40, 40)–(760, 440)'].length * 12 + 6, height: 26 };
    assert.notDeepEqual([lx, ly], [40, 472], 'the place under the left end crosses the frame outline');
    assert.equal(context.texts.some(text => meets(labelBox, text)), false);
    assert.equal(read.outlines.some(outline => meets(labelBox, outline) && !(labelBox.x >= outline.x && labelBox.y >= outline.y && labelBox.x + labelBox.width <= outline.x + outline.width && labelBox.y + labelBox.height <= outline.y + outline.height)), false);
    assert.equal(Object.values(LAYOUT_START_STATE.objects).some(o => o.type === 'step' && meets(labelBox, o)), false);
    // Ship's own label is drawn again over its ring, in the halo's group, outside the dark filter.
    assert.match(svg, /<circle cx="400" cy="240" r="18" class="sch-judged-point"\/><g class="engine-halo" transform="translate\(0 0\)"><g transform="translate\(0 0\)"><g transform="translate\(376.5 228\) rotate\(0 23.5 12\)"><text x="23.5" y="18.9" font-size="20px" fill="#1e1e1e" text-anchor="middle">Ship<\/text><\/g><\/g><\/g>/);
  });

  it('keeps the dark filter on the export\'s own content: the overlay is outside it (design review L1-F5)', () => {
    const markup = engineSvgMarkup('<svg viewBox="0 0 100 50"><rect x="0" y="0" width="100" height="50" fill="#ffffff"/><text x="5" y="20" font-size="20px">Pack</text></svg>', { prefix: 'p', label: 'x', classes: 'engine-board', overlay: '<g class="sch-judged"><text class="sch-judged-label">Layout area</text></g>' });
    assert.match(markup, /^<svg [^>]*><g class="engine-content"><text x="5" y="20" font-size="20px">Pack<\/text><\/g><g class="sch-judged">/);
  });

  it('opens each scrolling picture at the end of its own first difference, as long as a phone shows a step there (design review L1-F6)', () => {
    // A pair 1300 units wide (pw-13: 780 px at its floor): a phone shows 280 / 780 of it, 466.7 units.
    const view = { x: 0, y: 0, width: 1300, height: 400 }, window = PHONE_WINDOW * 1300 / 780;
    const final = [{ x: 100, y: 0, width: 160, height: 80 }, { x: 1100, y: 0, width: 160, height: 80 }];
    // The target ends at 760: the last 466.7 units (833.3–1300) hold none of its steps.
    const target = [{ x: 100, y: 0, width: 160, height: 80 }, { x: 540, y: 0, width: 160, height: 80 }];
    assert.equal(openingSide(view, 1300, final, 1180), 'end', 'the final board opens where its difference is');
    assert.equal(openingSide(view, 1300, target, 1180), 'start', 'the target would open empty at the end: it opens at the start');
    assert.equal(openingSide(view, 1300, target, 620), 'start');
    assert.equal(openingSide(view, 1300, final, null), 'start');
    // Whatever end it opens at, the window shows a step.
    for (const steps of [final, target]) for (const difference of [null, 100, 700, 1200]) {
      const side = openingSide(view, 1300, steps, difference), left = side === 'end' ? view.width - window : 0;
      assert.ok(steps.some(step => step.x < left + window && step.x + step.width > left), `${side} ${difference}`);
    }
  });
});

// The report's layout overlay and legend (PADR-0047 decision 7): the numbered reasons of unmet layout
// clauses come from the shared analysis and read as words, EN and DE; the overlay draws the judged
// geometry. Expected marks are derived by hand from the fixture's coordinates
// (tests/support/layout-world.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { layoutMarks } from '../../src/bench/details.ts';
import { layoutMarkText } from '../../src/bench/render.ts';
import { judgedOverlay, pictureSizeClass, textFloorScale } from '../../src/bench/schematic.ts';
import { readEngineSvg } from '../../src/bench/svg.ts';
import { publicConditions } from '../../src/host/session.ts';
import type { State, StepV2 } from '../../src/world/types.ts';
import { aligned, clearOfSteps, everything, inFrame } from '../support/layout-board.ts';
import { LAYOUT_GOAL_STATE, LAYOUT_START_STATE, layoutWorld } from '../support/layout-world.ts';

const conditions = publicConditions(layoutWorld().tasks[0]!);

describe('report: unmet layout clauses', () => {
  it('number every reason of every unmet clause and say it in words', () => {
    const marks = layoutMarks(LAYOUT_START_STATE, conditions);
    // By hand on the start: a2 (480–640 × 120–200) overlaps a3 (540–700 × 100–180) and touches b2
    // (320–480 × 200–280) at the corner (480, 200); b3 ends at 940, past 760; the arrow Decide → Pack runs
    // from (620, 140) to (180, 340) through b2's centre (400, 240), where the arrows from Pack, to Done and
    // the self-loop on Ship meet, and through a2's and b2's boxes; e1 ends at a2's centre (560, 160) inside
    // a3's box; lane A's centres are 140, 160, 140; a2 and a3 overlap along x; lane B's centres are 340,
    // 240, 340; lane B's gaps are 60 (b1–b2) and 300 (b2–b3).
    assert.deepEqual(marks.map(mark => layoutMarkText(mark, 'en')), [
      '1 · condition 1: “Check” and “Decide” are closer than 20 px',
      '2 · condition 1: “Check” and “Ship” are closer than 20 px',
      '3 · condition 2: “Done” lies outside the canvas',
      '4 · condition 3: the arrows “Decide” → “Pack” and “Pack” → “Ship” cross or touch',
      '5 · condition 3: the arrows “Decide” → “Pack” and “Ship” → “Done” cross or touch',
      '6 · condition 3: the arrows “Decide” → “Pack” and “Ship” → “Ship” cross or touch',
      '7 · condition 4: the arrow “Start” → “Check” touches the box of “Decide”',
      '8 · condition 4: the arrow “Decide” → “Pack” touches the box of “Check”',
      '9 · condition 4: the arrow “Decide” → “Pack” touches the box of “Ship”',
      '10 · condition 5: “Start” and “Check” differ most, by more than 4 px',
      '11 · condition 6: “Check” and “Decide” overlap along x',
      '12 · condition 7: “Ship” and “Pack” differ most, by more than 4 px',
      '13 · condition 8: the smallest gap is between “Pack” and “Ship”, the largest between “Ship” and “Done”: they differ by more than 4 px',
    ]);
    assert.equal(layoutMarkText(marks[2]!, 'de'), '3 · Bedingung 2: „Done“ liegt außerhalb der Arbeitsfläche');
    assert.equal(layoutMarkText(marks[12]!, 'de'), '13 · Bedingung 8: die kleinste Lücke liegt zwischen „Pack“ und „Ship“, die größte zwischen „Ship“ und „Done“: Sie unterscheiden sich um mehr als 4 px');
    assert.deepEqual(layoutMarks(LAYOUT_GOAL_STATE, conditions), [], 'the reference meets every clause: no mark');
  });

  it('name a count that differs and a loose end; at most five reasons per clause', () => {
    const outOfLane: State = structuredClone(LAYOUT_GOAL_STATE); (outOfLane.objects.b3 as StepV2).frameId = null;
    (outOfLane.objects.e5 as { frameId: string | null }).frameId = null;
    const lane = [{ predicate: aligned(inFrame('step', 'Lane B', 3), 'y', 'center', 4), layout: conditions[6]!.layout! }];
    assert.deepEqual(layoutMarks(outOfLane, lane).map(mark => layoutMarkText(mark, 'en')), ['1 · condition 1: expected 3 steps in “Lane B”, found 2']);
    assert.equal(layoutMarkText(layoutMarks(outOfLane, lane)[0]!, 'de'), '1 · Bedingung 1: erwartet 3 Schritte in „Lane B“, gefunden 2');
    const loose: State = structuredClone(LAYOUT_GOAL_STATE); (loose.objects.e5 as { to: string | null }).to = null;
    (loose.objects.e5 as { frameId: string | null }).frameId = 'fB';
    const clear = [{ predicate: clearOfSteps(everything('arrow', 6), everything('step', 6)), layout: conditions[3]!.layout! }];
    assert.deepEqual(layoutMarks(loose, clear).map(mark => layoutMarkText(mark, 'en')), ['1 · condition 1: the arrow “Ship” → a loose end is not attached at both ends']);
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

  it('draw the judged geometry: the canvas with its corners, the boxes of ellipses and diamonds, the segments, the self-loop ring and the marks', () => {
    const overlays = conditions.flatMap(condition => condition.layout ? [condition.layout] : []);
    const marks = layoutMarks(LAYOUT_START_STATE, conditions);
    const svg = judgedOverlay(LAYOUT_START_STATE, overlays, [{ number: 1, steps: ['a2', 'a3'], arrows: [] }, { number: 2, steps: ['b3'], arrows: [] }], { canvas: 'Canvas' }, 'run0-final');
    const count = (pattern: RegExp): number => (svg.match(pattern) ?? []).length;
    assert.equal(count(/class="sch-judged-canvas"/g), 1);
    assert.match(svg, />Canvas \(40, 40\)–\(760, 440\)</);
    assert.equal(count(/class="sch-judged-box"/g), 3, 'Start, Done (ellipses) and Decide (diamond)');
    assert.equal(count(/class="sch-judged-segment"/g), 5);
    assert.equal(count(/class="sch-judged-point"/g), 1);
    assert.equal(count(/class="sch-mark"/g), 3);
    assert.match(svg, /<clipPath id="run0-final-judged">/);
    assert.ok(marks.length > 0);
    assert.equal(judgedOverlay(LAYOUT_START_STATE, [], [], { canvas: 'Canvas' }, 'x'), '', 'no layout condition, no overlay');
  });
});

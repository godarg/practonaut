// A layout task in the Player (PADR-0047 decision 7): board mode draws the judged geometry from the
// public conditions and the public board — the judged segments, a self-loop's centre ring under a
// label that keeps a halo, the boxes of ellipses and diamonds, the layout area with its corners, each
// lane as its own frame — in thin solid lines, before and after moves, and says in words what it
// draws; judged lines never cross a label, also where two labels overlap. The Goal card states the
// arrow rule once. The real editor is never drawn over: the top of the Goal card names the layout
// area and a button leads to the board. A task without layout conditions draws none of it. Counts are
// written out by hand from the fixture (tests/support/layout-world.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mode, setLanguage, startPlayer } from '../support/player-states.ts';
import { layoutWorld } from '../support/layout-world.ts';

/** In the page: points of every judged line (segments, boxes, layout areas) that lie in the box of a
 * text on the board (step labels, lane names, the layout area's label) and still show through their
 * clip (evenodd: a point inside an even number of the clip's rectangles is cut out). */
function linesOverLabels(): string[] {
  const board = document.querySelector('[data-testid=board]')!;
  const labels = [...board.querySelectorAll('.step-label, .board-frame-label, .judged-canvas-label')].map(label => (label as SVGGraphicsElement).getBBox());
  const found: string[] = [];
  for (const element of board.querySelectorAll('[data-testid=judged-segments] line, .judged-box, .judged-canvas')) {
    const owner = element.closest('[clip-path]');
    const d = owner ? board.querySelector(`${(owner.getAttribute('clip-path') ?? '').replace(/^url\((#[^)]*)\)$/, '$1')} path`)?.getAttribute('d') ?? '' : '';
    const rects = [...d.matchAll(/M (-?[\d.e+]+) (-?[\d.e+]+) h (-?[\d.e+]+) v (-?[\d.e+]+) h -?[\d.e+]+ Z/g)].map(m => m.slice(1, 5).map(Number));
    const shows = (x: number, y: number): boolean => !owner || rects.filter(([rx, ry, w, h]) => x > rx! && x < rx! + w! && y > ry! && y < ry! + h!).length % 2 === 1;
    const n = (name: string): number => Number(element.getAttribute(name));
    const edges: Array<[number, number, number, number]> = element.tagName === 'line' ? [[n('x1'), n('y1'), n('x2'), n('y2')]]
      : [[n('x'), n('y'), n('x') + n('width'), n('y')], [n('x'), n('y') + n('height'), n('x') + n('width'), n('y') + n('height')], [n('x'), n('y'), n('x'), n('y') + n('height')], [n('x') + n('width'), n('y'), n('x') + n('width'), n('y') + n('height')]];
    for (const [x1, y1, x2, y2] of edges) for (let i = 0; i <= 400; i++) {
      const x = x1 + (x2 - x1) * i / 400, y = y1 + (y2 - y1) * i / 400;
      if (labels.some(box => x > box.x + 1 && x < box.x + box.width - 1 && y > box.y + 1 && y < box.y + box.height - 1) && shows(x, y)) { found.push(`${element.getAttribute('class')} ${x.toFixed(0)},${y.toFixed(0)}`); break; }
    }
  }
  return found;
}

test('board mode draws what a layout task judges, the editor gets a note and the way back', { timeout: 240_000 }, async () => {
  const s = await startPlayer({ world: layoutWorld(), taskId: 'tidy', mirror: 'off' });
  try {
    await setLanguage(s.page, 'en');
    const board = s.page.getByTestId('board');
    await board.getByTestId('judged-canvas').waitFor();
    // Five arrows between two different steps, one self-loop (Ship), two ellipses and a diamond.
    assert.equal(await board.locator('[data-testid=judged-segments] line').count(), 5);
    assert.equal(await board.getByTestId('judged-point').count(), 1);
    assert.equal(await board.getByTestId('judged-box').count(), 3);
    assert.equal(await board.locator('.judged-canvas-label').textContent(), 'Layout area (40, 40)–(760, 440)');
    // Thin solid lines: never dashed (dashes mean uncertainty, design language §7.4; review L1-F3).
    assert.deepEqual(await board.locator('.judged-segment, .judged-box, .judged-canvas, .judged-point').evaluateAll(nodes => [...new Set(nodes.map(node => getComputedStyle(node).strokeDasharray))]), ['none']);
    // The ring sits at Ship's centre: b2 at (320, 200), 160 × 80 in the start; Ship's label, drawn over
    // it, keeps a halo in its card's fill so the ring never runs through its letters (L1-F2).
    const ring = board.getByTestId('judged-point');
    assert.deepEqual(await ring.evaluate(node => [node.getAttribute('cx'), node.getAttribute('cy')]), ['400', '240']);
    assert.deepEqual(await ring.evaluate(node => { const label = node.parentElement!.querySelector('.step-label')!; return [label.textContent, label.classList.contains('step-label--halo'), getComputedStyle(label).paintOrder, Boolean(node.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING)]; }), ['Ship', true, 'stroke', true]);
    // Each lane is its own frame with its name (L1-F15); the layout area's label is set like a frame's
    // name (15 units), so it does not set the board's scale (L1-F9).
    assert.deepEqual(await board.getByTestId('board-lane').evaluateAll(lanes => lanes.map(lane => lane.textContent)), ['Lane A', 'Lane B']);
    assert.equal(await board.evaluate(svg => (svg as SVGSVGElement).style.getPropertyValue('--_board-text-unit')), '15');
    // At 1280 px "Done", past the layout area and the subject of condition 2, is in view whole: the board
    // is set at 12/15 px per unit (784 px for its 980 units), only its empty margin is past the edge.
    assert.equal(await s.page.locator('.canvas__scroll').evaluate(scroll => {
      const done = scroll.querySelector('[data-object-id=b3] .step-box')!.getBoundingClientRect(), view = scroll.getBoundingClientRect();
      return done.left >= view.left && done.right <= view.right;
    }), true);
    // The line under the board names every part it draws (L1-F2).
    assert.equal(await s.page.getByTestId('judged-note').textContent(), 'Drawn as the layout conditions judge it: thin lines for the arrows, from step centre to step centre, a box around each ellipse and diamond, a ring at a step’s centre for an arrow from the step to itself and the layout area.');
    // The Goal card states the arrow rule once, under the first arrow condition (L1-F14).
    const goal = await s.page.locator('.goal-item__body').evaluateAll(items => items.map(item => item.textContent ?? ''));
    assert.equal(goal.filter(text => text.includes('An arrow counts as the straight line')).length, 1);
    assert.ok(goal[2]!.includes('An arrow counts as the straight line') && goal[3]!.includes('None of the 6 arrows touches the box'));
    assert.deepEqual(await s.page.evaluate(linesOverLabels), [], 'no judged line shows over a label');
    // A move redraws the judged segment from the step's new centre.
    assert.equal((await s.post('act', { action: { name: 'move_step', params: { id: 'a2', x: 320, y: 100 } } })).ok, true);
    await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=judged-segments] line')].some(line => line.getAttribute('x2') === '400' && line.getAttribute('y2') === '140'));
    // Decide onto Check: their label areas overlap; the arrow Decide → Pack leaves through both. The clip
    // cuts out their union, so no part of the line shows over either label (Codex review).
    assert.equal((await s.post('act', { action: { name: 'move_step', params: { id: 'a3', x: 330, y: 104 } } })).ok, true);
    await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=judged-segments] line')].some(line => line.getAttribute('x1') === '410' && line.getAttribute('y1') === '144'));
    assert.deepEqual(await s.page.evaluate(linesOverLabels), [], 'no judged line shows over two overlapping labels');
    // The Excalidraw workspace is never drawn over: the top of the Goal card, in view, holds a note with
    // the layout area and a button to the board (L1-F8, L1-F13).
    await mode(s.page, 'editor');
    assert.equal(await s.page.getByTestId('judged-editor-note').textContent(), 'The layout conditions judge each step by its box and each arrow as the straight line between the centres of its steps, not the arrows as drawn here. The layout area runs from (40, 40) to (760, 440).');
    assert.equal(await s.page.getByTestId('judged-show-board').textContent(), 'Show on board');
    assert.equal(await s.page.locator('[data-testid=check-result] .goal-judged + .goal-list').count(), 1, 'the note comes before the conditions');
    const inView = await s.page.getByTestId('judged-show-board').evaluate(button => { const box = button.getBoundingClientRect(), side = button.closest('.practice-inspector')?.getBoundingClientRect(); return box.bottom <= window.innerHeight && (!side || (box.top >= side.top && box.bottom <= side.bottom)); });
    assert.equal(inView, true, 'the button is in view at 1280 × 900 without scrolling');
    await s.page.getByTestId('judged-show-board').focus();
    await s.page.keyboard.press('Enter');
    await s.page.waitForFunction(() => document.body.dataset.workspace === 'board');
    await setLanguage(s.page, 'de');
    assert.equal(await board.locator('.judged-canvas-label').textContent(), 'Layoutbereich (40, 40)–(760, 440)');
    assert.deepEqual(s.external, []);
  } finally { await s.close(); }
  // The bundled example has no layout condition: nothing judged is drawn, and the board is one frame.
  const plain = await startPlayer({ mirror: 'off', phase3: false });
  try {
    assert.equal(await plain.page.locator('[data-testid=board] .judged, [data-testid=judged-note], [data-testid=board-lane]').count(), 0);
  } finally { await plain.close(); }
});

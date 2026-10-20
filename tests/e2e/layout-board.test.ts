// A layout task in the Player (PADR-0047 decision 7): board mode draws the judged geometry from the
// public conditions and the public board — the judged segments, a self-loop's centre ring, the boxes of
// ellipses and diamonds, the canvas with its corners — before and after moves, and says in words what
// the dashes are; the real editor is never drawn over: a note names the canvas and a button leads to
// the board. A task without layout conditions draws none of it. Counts are written out by hand from
// the fixture (tests/support/layout-world.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mode, setLanguage, startPlayer } from '../support/player-states.ts';
import { layoutWorld } from '../support/layout-world.ts';

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
    assert.equal(await board.locator('.judged-canvas-label').textContent(), 'Canvas (40, 40)–(760, 440)');
    // The ring sits at Ship's centre: b2 at (320, 330), 160 × 80 in the start.
    assert.deepEqual(await board.getByTestId('judged-point').evaluate(ring => [ring.getAttribute('cx'), ring.getAttribute('cy')]), ['400', '370']);
    assert.match(await s.page.getByTestId('judged-note').textContent() ?? '', /Dashed lines show what the layout conditions judge/);
    // A move redraws the judged segment from the step's new centre.
    assert.equal((await s.post('act', { action: { name: 'move_step', params: { id: 'a2', x: 320, y: 100 } } })).ok, true);
    await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid=judged-segments] line')].some(line => line.getAttribute('x2') === '400' && line.getAttribute('y2') === '140'));
    // The Excalidraw workspace is never drawn over: a note with the canvas and a button to the board.
    await mode(s.page, 'editor');
    assert.match(await s.page.getByTestId('judged-editor-note').textContent() ?? '', /inside the canvas from \(40, 40\) to \(760, 440\), not the arrows as drawn here/);
    await s.page.getByTestId('judged-show-board').focus();
    await s.page.keyboard.press('Enter');
    await s.page.waitForFunction(() => document.body.dataset.workspace === 'board');
    await setLanguage(s.page, 'de');
    assert.equal(await board.locator('.judged-canvas-label').textContent(), 'Arbeitsfläche (40, 40)–(760, 440)');
    assert.deepEqual(s.external, []);
  } finally { await s.close(); }
  // The bundled example has no layout condition: nothing judged is drawn.
  const plain = await startPlayer({ mirror: 'off', phase3: false });
  try {
    assert.equal(await plain.page.locator('[data-testid=board] .judged, [data-testid=judged-note]').count(), 0);
  } finally { await plain.close(); }
});

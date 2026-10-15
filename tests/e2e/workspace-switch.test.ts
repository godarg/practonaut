// Switching workspaces while one is still being prepared: the control shows the workspace that was
// chosen at once, and a click on another one is never dropped without a trace (CI saw the installed
// Player stay in Excalidraw after a click on Practice that landed while Excalidraw was preparing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPlayer } from '../support/player-states.ts';

test('a click on Practice while Excalidraw is being prepared is never lost', { timeout: 120_000 }, async () => {
  const s = await startPlayer({});
  try {
    const page = s.page;
    await page.getByTestId('mode-editor').click();
    // At once: Excalidraw is the chosen workspace; the others wait for the preparation and say so.
    assert.equal(await page.getByTestId('mode-editor').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByTestId('mode-board').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.getByTestId('mode-board').isDisabled(), true, 'Practice waits while Excalidraw is being prepared');
    assert.match(await page.getByTestId('mode-board').getAttribute('aria-label') ?? '', /^Practice opens when the drawing surface is ready\.$/);
    // The click waits until Practice can be chosen, and then it counts.
    await page.getByTestId('mode-board').click();
    await page.waitForFunction(() => document.body.dataset.workspace === 'board' && !(document.querySelector('[data-testid=mode-editor]') as HTMLButtonElement).disabled, undefined, { timeout: 30_000 });
    await page.getByTestId('board').waitFor({ timeout: 5_000 });
    assert.equal(await page.getByTestId('mode-board').getAttribute('aria-pressed'), 'true');
    // And it stays: no preparation finishes later and takes the person elsewhere.
    await page.waitForTimeout(1_500);
    assert.equal(await page.evaluate(() => document.body.dataset.workspace), 'board');
  } finally { await s.close(); }
});

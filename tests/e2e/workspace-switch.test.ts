// Choosing a workspace while another one is being prepared. The current workspace stays pressed until
// the change is done (it is where you are), and a click on it is kept: once the preparation has ended,
// the person is back where they clicked. CI saw the installed Player stay in Excalidraw after a click
// on Practice that landed while Excalidraw was still being prepared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPlayer } from '../support/player-states.ts';

test('a click on Practice while Excalidraw is being prepared is kept: the person ends on Practice', { timeout: 120_000 }, async () => {
  const s = await startPlayer({});
  try {
    const page = s.page;
    const frame = page.frames().find(candidate => candidate.url().includes('/editor.html'));
    assert.ok(frame, 'the real editor is loaded');
    // Hold the editor's acknowledgement of the new scene, so the click below lands during the
    // preparation every time (the window is otherwise a few hundred milliseconds).
    await frame.evaluate(() => {
      const original = MessagePort.prototype.postMessage, held: Array<() => void> = [];
      const control = window as unknown as { __release(): void; __holding: boolean };
      control.__holding = true;
      control.__release = () => { control.__holding = false; for (const send of held.splice(0)) send(); };
      MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
        if (control.__holding && message !== null && typeof message === 'object' && (message as { type?: string }).type === 'configured') { held.push(() => Reflect.apply(original, this, [message, ...rest])); return; }
        return Reflect.apply(original, this, [message, ...rest]);
      } as typeof MessagePort.prototype.postMessage;
    });
    await page.getByTestId('mode-editor').click();
    await page.waitForFunction(() => document.querySelector('.native-editor-scroll')?.getAttribute('aria-busy') === 'true');
    // While Excalidraw is being prepared, Practice is still where you are: pressed, never disabled.
    assert.equal(await page.getByTestId('mode-board').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByTestId('mode-board').isDisabled(), false);
    await page.getByTestId('mode-board').click();
    await frame.evaluate(() => (window as unknown as { __release(): void }).__release());
    // The preparation ends, and the click counts: back on Practice, with nothing left preparing.
    await page.waitForFunction(() => document.body.dataset.workspace === 'board' && document.querySelector('.native-editor-scroll')?.getAttribute('aria-busy') === 'false', undefined, { timeout: 30_000 });
    await page.getByTestId('board').waitFor({ timeout: 5_000 });
    assert.equal(await page.getByTestId('mode-board').getAttribute('aria-pressed'), 'true');
    await page.waitForTimeout(1_000);
    assert.equal(await page.evaluate(() => document.body.dataset.workspace), 'board', 'and it stays there');
  } finally { await s.close(); }
});

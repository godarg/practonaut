// The demonstration in the Player after the design review of 0.2.0 Should 7 (F1–F13, nits c and d):
// what the board, the head, the Demonstration card, the Goal card and the export say while it plays
// and after it, in a mirrored and in a model-only session, and where the focus and scroll land.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { demonstrate, demonstrationStatus, MODEL_ONLY_STATES, mode, modelBaseline, PLAYER_STATES, practiceBaseline, setLanguage, settle, startPlayer, type PlayerSession } from '../support/player-states.ts';

const text = async (page: Page, testid: string): Promise<string> => (await page.getByTestId(testid).innerText()).replace(/\s+/g, ' ').trim();
async function withPlayer(options: Parameters<typeof startPlayer>[0], run: (s: PlayerSession) => Promise<void>): Promise<void> {
  const s = await startPlayer(options);
  try { await setLanguage(s.page, 'en'); await run(s); } finally { await s.close(); }
}
let browser: Browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser.close(); });

test('while it plays: its own head line, three plain rows, the last touched object ringed, Stop with its key, no Check', { timeout: 180_000 }, async () => {
  await withPlayer({ browser }, async s => {
    await practiceBaseline(s);
    // F13: the attempt line sits on the line above the title, beside "Task", even with the long T3 title.
    const eyebrow = await s.page.locator('.practice-head .t-eyebrow').boundingBox(), meta = await s.page.locator('.practice-head__meta').boundingBox();
    assert.ok(eyebrow && meta && Math.abs(eyebrow.y - meta.y) < 8, `attempt line beside the eyebrow: ${JSON.stringify({ eyebrow, meta })}`);
    assert.equal(await text(s.page, 'head-meta'), 'Attempt 1 · 0 actions');
    await demonstrate(s, 'running');
    // F2: the head says whose board it is and does not count an attempt.
    assert.equal(await text(s.page, 'head-meta'), 'Demonstration · 1 action');
    // F4/F11: noun titles, the state in words, one counter for confirmations.
    assert.equal(await s.page.getByTestId('demo-actions').locator('.pn-steplist__title').innerText(), 'Actions on the board');
    assert.equal(await s.page.getByTestId('demo-mirror').locator('.pn-steplist__title').innerText(), 'Check in the real Excalidraw');
    assert.equal(await s.page.getByTestId('demo-check').locator('.pn-steplist__title').innerText(), 'Result check');
    assert.match(await text(s.page, 'demo-actions'), /1 of 3$/);
    assert.match(await text(s.page, 'demo-mirror'), /1 confirmed$/);
    // F8: T3's first action rewires the arrow from the first step: that arrow carries the selection ring.
    assert.equal(await s.page.locator('svg .edge.selected').count(), 1);
    assert.equal(await s.page.locator('[data-object-id="ab"][aria-pressed="true"]').count(), 1);
    // F9: Stop names its key; F10: no result check while the board is the demonstration's.
    assert.equal(await s.page.getByTestId('demo-stop').locator('kbd').innerText(), 'Esc');
    assert.equal(await s.page.getByTestId('check').count(), 0);
    // Nit d: Escape in Create does not stop it; on the practice board it does.
    await mode(s.page, 'author'); await s.page.keyboard.press('Escape'); await settle(s.page);
    assert.equal((await demonstrationStatus(s))?.state, 'running');
    await mode(s.page, 'board'); await s.page.keyboard.press('Escape');
    await s.page.getByTestId('demonstration').and(s.page.locator('[data-state=stopped]')).waitFor();
  });
});

test('after it: the verdict says whose board it is, the card stays readable, an own attempt keeps the count and asks nothing', { timeout: 180_000 }, async () => {
  await withPlayer({ browser }, async s => {
    await practiceBaseline(s);
    await demonstrate(s, 'finished');
    // F3: one sentence in the verdict, no separate note; the Demonstration card's title is in view.
    assert.equal(await s.page.locator('.verdict.pass').innerText(), 'The demonstration’s board meets all conditions.');
    assert.equal(await s.page.getByTestId('demo-verdict-note').count(), 0);
    const side = await s.page.locator('.practice-inspector').boundingBox(), title = await s.page.locator('#demo-title').boundingBox();
    assert.ok(side && title && title.y >= side.y - 1 && title.y + title.height <= side.y + side.height, `Demonstration title visible: ${JSON.stringify({ side, title })}`);
    // F10: still no Check; the one next step is an own attempt.
    assert.equal(await s.page.getByTestId('check').count(), 0);
    // F12: the export refusal is information, not an unknown.
    const refusal = s.page.getByTestId('export-demonstration');
    assert.equal(await refusal.evaluate(node => node.classList.contains('pn-banner--unknown')), false);
    // Nit c: a task change from the demonstration's board asks nothing.
    await s.page.getByTestId('task-picker').click(); await s.page.getByTestId('task-picker-option-T2').click();
    await s.page.waitForFunction(() => document.querySelector('#task-title')?.textContent === 'Insert a step');
    assert.equal(await s.page.locator('dialog[open]').count(), 0);
    // F2: the person's attempt count went on from 1 as if there had been no demonstration.
    assert.equal(await text(s.page, 'head-meta'), 'Attempt 1 · 0 actions');
    await s.page.getByTestId('task-picker').click(); await s.page.getByTestId('task-picker-option-T3').click();
    await s.page.waitForFunction(() => document.querySelector('#task-title')?.textContent === 'Remove a step and close the chain');
    // Nit c: Reset on the demonstration's board asks nothing either.
    await demonstrate(s, 'finished');
    await s.page.getByTestId('reset').click(); await s.page.getByTestId('demonstration').waitFor({ state: 'detached' });
    assert.equal(await s.page.locator('dialog[open]').count(), 0);
    assert.equal(await text(s.page, 'head-meta'), 'Attempt 1 · 0 actions');
  });
});

test('asking first, stopping early, and the board fitting the canvas at 1280', { timeout: 180_000 }, async () => {
  await withPlayer({ browser }, async s => {
    // F7: the example's boards fit at 1280 without a sideways scroll.
    await practiceBaseline(s);
    assert.equal(await s.page.getByTestId('board-scroll-hint').isHidden(), true);
    // F2: the sheet says what happens to the board, not "a new attempt".
    await PLAYER_STATES.find(state => state.id === 'demo-confirm')!.enter(s);
    const sheet = (await s.page.locator('dialog[open]').innerText()).replace(/\s+/g, ' ');
    assert.match(sheet, /clears the board and solves this task once/); assert.doesNotMatch(sheet, /new attempt/);
    await s.page.keyboard.press('Escape');
    // F1: stopped early: a sentence for people, the reason under Technical details.
    await PLAYER_STATES.find(state => state.id === 'demo-failed')!.enter(s);
    const failed = s.page.getByTestId('demo-failed');
    assert.match((await failed.innerText()).replace(/\s+/g, ' '), /^The demonstration stopped early\. Its next action was refused; the board keeps the actions before it\. Start your own attempt\. Technical details$/);
    await failed.locator('summary').click();
    assert.match(await failed.locator('.rule-origin').innerText(), /^invalid_argument$/);
    // F6: in the real editor the refusal is "Not applied".
    await PLAYER_STATES.find(state => state.id === 'editor-demonstration')!.enter(s);
    assert.match(await s.page.getByTestId('phase3-status').innerText(), /^Not applied\n/);
  });
  // F7: the first task's demonstration (what a first `npx practonaut` shows) leaves a board that fits too.
  await withPlayer({ browser }, async s => {
    const reply = await s.post('variant', { confirmed: true, taskId: 'T1' }); assert.equal(reply.ok, true, JSON.stringify(reply));
    await s.page.reload(); await s.page.getByTestId('board').waitFor();
    await demonstrate(s, 'finished'); await settle(s.page);
    assert.equal(await s.page.locator('.board-scroll').evaluate(node => node.scrollWidth - node.clientWidth), 0, 'no sideways scroll after the T1 demonstration');
    assert.equal(await s.page.getByTestId('board-scroll-hint').isHidden(), true);
  });
  // F7: where the board is wider than its canvas, the hint does not assume a touch screen.
  await withPlayer({ browser, width: 820 }, async s => {
    await practiceBaseline(s);
    assert.equal(await s.page.getByTestId('board-scroll-hint').innerText(), 'Scroll sideways to see the whole board.');
  });
});

test('model-only: one plain wording for what the real Excalidraw does not check, and rows that stay true', { timeout: 180_000 }, async () => {
  await withPlayer({ browser, phase3: false, mirror: 'off' }, async s => {
    await MODEL_ONLY_STATES.find(state => state.id === 'model-only-banner')!.enter(s);
    // F5: the line under the board, the banner and the "How this is checked" line say the same thing.
    assert.equal(await text(s.page, 'mirror-mode-note'), 'This is a practice model. In this session the real Excalidraw does not check it.');
    assert.match(await text(s.page, 'model-only-banner'), /^Not yet checked against the real Excalidraw In this session the real Excalidraw does not check the practice model\./);
    assert.match(await text(s.page, 'how-checked'), /In this session the real Excalidraw does not check the practice model\./);
    // F12: the model-only export refusal is information too.
    assert.equal(await s.page.getByTestId('export-model-only').evaluate(node => node.classList.contains('pn-banner--unknown')), false);
    await modelBaseline(s);
    await demonstrate(s, 'running');
    // F4: no claim that the real Excalidraw confirms anything here.
    assert.equal(await s.page.getByTestId('demo-mirror').locator('.pn-steplist__title').innerText(), 'Check in the real Excalidraw');
    assert.match(await text(s.page, 'demo-mirror'), /Not checked in this session$/);
  });
});

test('at 390 the offer is flush with the text above it', { timeout: 120_000 }, async () => {
  await withPlayer({ browser, width: 390, height: 844 }, async s => {
    await practiceBaseline(s);
    // F13: the play icon starts at the prompt's left edge.
    const prompt = await s.page.locator('.practice-head__prompt').boundingBox(), glyph = await s.page.getByTestId('demo-start').locator('.pn-icon').boundingBox();
    assert.ok(prompt && glyph && Math.abs(glyph.x - prompt.x) <= 2, JSON.stringify({ prompt, glyph }));
  });
});

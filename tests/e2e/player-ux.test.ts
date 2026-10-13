import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright';
import { fixture, changed } from './harness.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { startHost } from '../../src/host/server.ts';

const { world: library } = loadLibrary();
const activeObject = (page: Page): Promise<string | undefined> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.objectId);

test('connecting by keyboard never offers the source as its own target and names the target', { timeout: 90_000 }, async () => {
  const f = await fixture({ taskId: 'T3' });
  try {
    await f.page.getByTestId('language-en').click();
    const origin = 'a';
    await f.page.locator(`[data-object-id="${origin}"]`).first().focus();
    await f.page.keyboard.press('c');
    const first = await activeObject(f.page);
    assert.ok(first && first !== origin, 'C preselects another step');
    const coach = await f.page.getByTestId('board-status').innerText();
    assert.match(coach, /^Connect from “.+” to “.+”\./, coach);
    // Walk every direction and both ends: the source never comes back as a target.
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'Home', 'End', 'ArrowUp', 'ArrowDown']) {
      await f.page.keyboard.press(key);
      assert.notEqual(await activeObject(f.page), origin, `${key} reached the source`);
    }
    const target = (await activeObject(f.page))!;
    const view = await changed(f, () => f.page.keyboard.press('Enter'));
    const arrow = Object.values(view.state.objects).find(o => o.type === 'arrow' && !o.deleted && o.from === origin && o.to === target);
    assert.ok(arrow, 'the arrow goes from the source to the chosen target');
    assert.equal(Object.values(view.state.objects).some(o => o.type === 'arrow' && !o.deleted && o.from === o.to), false, 'no self loop');
  } finally { await f.close(); }
});

test('the goal reads as sentences; formal conditions sit behind one switch; consequences wait for an action', { timeout: 90_000 }, async () => {
  const example = await fixture({ taskId: 'T1' });
  try {
    await example.page.getByTestId('language-en').click();
    const goal = example.page.getByTestId('check-result');
    // A world/1 goal without sentences shows the task's own sentences, never the formula.
    assert.doesNotMatch(await goal.innerText(), /there is a step|\[s0\]/);
    assert.match(await goal.innerText(), /Use two arrows, each bound at both ends\./);
    assert.equal(await example.page.getByText(/Formal goal condition/).count(), 0, 'no disclosure link under each condition');
    assert.equal(await example.page.getByTestId('formal-switch').count(), 1);
    await example.page.getByTestId('formal-switch').click();
    assert.match(await example.page.getByTestId('goal-formal').first().innerText(), /there is a step/);
    assert.equal(await example.page.getByTestId('formal-switch').getAttribute('aria-pressed'), 'true');
  } finally { await example.close(); }
  const f = await fixture({ world: library, taskId: 'decision' });
  try {
    await f.page.getByTestId('language-en').click();
    assert.equal(await f.page.getByTestId('consequence').count(), 0, 'nothing has changed before the first action');
    const view = await changed(f, async () => {
      await f.page.getByTestId('action-add').click(); await f.page.getByTestId('input-label').fill('Accept');
      await f.page.getByTestId('action-submit').click();
    });
    assert.ok(view.errors.length > 0, 'the fixture task still reports points after one action');
    assert.equal(await f.page.getByTestId('consequence').count(), 1, 'one banner, however many points');
  } finally { await f.close(); }
});

test('every route shows the same three workspaces; unavailable ones say why', { timeout: 60_000 }, async () => {
  // The harness host has no drawing surface, like the practice window of a created exercise.
  const f = await fixture({ taskId: 'T3' });
  try {
    await f.page.getByTestId('language-en').click();
    for (const id of ['board', 'editor', 'author']) assert.equal(await f.page.getByTestId(`mode-${id}`).count(), 1, `mode-${id}`);
    assert.equal(await f.page.getByTestId('mode-board').getAttribute('aria-pressed'), 'true');
    for (const id of ['editor', 'author']) {
      assert.equal(await f.page.getByTestId(`mode-${id}`).isDisabled(), true);
      assert.match(await f.page.getByTestId(`mode-${id}`).getAttribute('aria-label') ?? '', /not available|available in the window/);
    }
  } finally { await f.close(); }
});

test('390 px: the board fits the card without cutting the frame', { timeout: 120_000 }, async () => {
  for (const [world, taskId] of [[library, 'restyle-flow'], [undefined, 'T3']] as const) {
    const f = await fixture({ ...(world ? { world } : {}), taskId, width: 390 });
    try {
      const fit = await f.page.evaluate(() => {
        const scroll = document.querySelector('.board-scroll')!, card = document.querySelector('.canvas')!.getBoundingClientRect();
        const inside = [...document.querySelectorAll('.board-frame, [data-object-type="step"]')].every(node => { const r = node.getBoundingClientRect(); return r.left >= card.left - 0.5 && r.right <= card.right + 0.5; });
        return { overflow: scroll.scrollWidth - scroll.clientWidth, inside };
      });
      assert.deepEqual(fit, { overflow: 0, inside: true }, taskId);
    } finally { await f.close(); }
  }
});

async function editorFrame(page: Page): Promise<Frame> {
  const handle = await page.getByTestId('real-editor').elementHandle(); const frame = await handle!.contentFrame(); assert.ok(frame);
  await frame.waitForFunction(() => !!(window as unknown as { __pnEditor: unknown }).__pnEditor);
  return frame;
}
test('Create offers both ways side by side at the top; the object list follows the drawing live', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-ways-'));
  const host = await startHost(library, { phase3: true, taskId: 'add-step', seed: 42, localDirectory: directory, tokenDirectory: join(directory, 'credentials') });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })).newPage();
    await page.goto(host.url); await page.getByTestId('phase3-status').filter({ hasText: /ready|bereit/ }).waitFor({ timeout: 20_000 });
    await page.getByTestId('language-en').click(); await page.getByTestId('mode-author').click();
    await page.getByTestId('recovery-guide').waitFor();
    const draw = (await page.getByTestId('create-way-draw').boundingBox())!, record = (await page.getByTestId('create-way-record').boundingBox())!, guide = (await page.getByTestId('recovery-guide').boundingBox())!;
    assert.ok(draw.x < record.x && Math.abs(draw.y - record.y) < 1 && Math.abs(draw.width - record.width) < 1, 'two equal cards, drawing first');
    assert.ok(draw.y + draw.height <= guide.y, 'both ways sit above the guide');
    assert.match(await page.getByTestId('create-way-draw').innerText(), /Draw start and goal/);
    assert.match(await page.getByTestId('create-way-record').innerText(), /Record a demonstration/);
    await page.getByTestId('create-way-draw').click();
    await page.getByTestId('two-scenes').waitFor();
    assert.equal(await page.getByTestId('recovery-guide').isVisible(), false, 'one way at a time');
    await page.getByTestId('two-scenes-blank').click();
    await page.getByTestId('native-objects-empty').filter({ hasText: 'Nothing drawn yet.' }).waitFor();
    const frame = await editorFrame(page);
    await page.getByTestId('real-editor').scrollIntoViewIfNeeded();
    const box = (await page.getByTestId('real-editor').boundingBox())!;
    await frame.locator('.excalidraw').press('r');
    await page.mouse.move(box.x + 380, box.y + 140); await page.mouse.down(); await page.mouse.move(box.x + 540, box.y + 220, { steps: 6 }); await page.mouse.up();
    await page.mouse.dblclick(box.x + 460, box.y + 180);
    await frame.locator('textarea').waitFor({ state: 'visible' }); await page.keyboard.type('Order'); await page.keyboard.press('Escape');
    // No other action: the list catches up with the drawing on its own.
    await page.locator('.native-objects__list').filter({ hasText: 'Order' }).waitFor({ timeout: 5_000 });
  } finally { await browser.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});

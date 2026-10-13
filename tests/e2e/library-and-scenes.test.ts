import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Frame, type Page } from 'playwright';
import { fixture, changed, assertOracle } from './harness.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { startHost } from '../../src/host/server.ts';
import { TOKEN_HEADER, type HostReply, type HostView } from '../../src/host/protocol.ts';
import { createBridge } from '../../src/mcp/bridge.ts';
import type { StepV2 } from '../../src/world/types.ts';

const { world: library } = loadLibrary();

test('a library task is chosen in the player and solved with the keyboard on the real engine', { timeout: 120_000 }, async () => {
  const f = await fixture({ world: library, taskId: 'add-step' });
  try {
    await f.page.getByTestId('language-en').click();
    // Choose the task from the library's task list and apply it with the keyboard.
    await f.page.getByTestId('task-picker').focus(); await f.page.keyboard.press('Enter');
    // Each option shows the task's level as dots and the length of its reference solution (expected
    // values from library.json); assistive technology hears the level in words, not the dots.
    for (const entry of loadLibrary().library.tasks) {
      const detail = f.page.getByTestId(`task-picker-option-${entry.id}`).locator('.pn-picker__detail');
      const dots = `${'●'.repeat(entry.difficulty)}${'○'.repeat(3 - entry.difficulty)}`, length = `${entry.actions} ${entry.actions === 1 ? 'action' : 'actions'}`;
      assert.equal(await detail.locator('.pn-picker__meter').textContent(), dots, entry.id);
      assert.equal(await detail.locator('.pn-picker__meter').getAttribute('aria-hidden'), 'true', entry.id);
      assert.equal(await detail.textContent(), `${dots}Difficulty ${entry.difficulty} of 3, reference solution,  · ${length}`, entry.id);
    }
    await f.page.getByTestId('task-picker-option-recolor').focus();
    let view = await changed(f, () => f.page.keyboard.press('Enter'));
    assert.equal(view.task.id, 'recolor');
    assert.match(view.task.conditions.map(c => c.text.en).join(' '), /with red line and red fill/);
    const failed = Object.values(view.state.objects).find((o): o is StepV2 => o.type === 'step' && /failed/.test(o.label))!;
    // Focus the step, open the style sheet from the palette, choose by typing, submit with Enter.
    await f.page.locator(`[data-object-id="${failed.id}"]`).first().focus();
    await f.page.keyboard.press('Space'); await f.page.keyboard.press('Escape'); // select it; Escape leaves the pickup preview
    await f.page.getByTestId('action-style').focus(); await f.page.keyboard.press('Enter');
    await f.page.getByTestId('input-shape').waitFor();
    assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'input-shape');
    await f.page.keyboard.press('Tab'); await f.page.keyboard.type('red');
    await f.page.keyboard.press('Tab'); await f.page.keyboard.type('red');
    assert.deepEqual([await f.page.getByTestId('input-stroke').inputValue(), await f.page.getByTestId('input-fill').inputValue()], ['red', 'red']);
    await f.page.getByTestId('action-submit').focus();
    view = await changed(f, () => f.page.keyboard.press('Enter'));
    assert.deepEqual([(view.state.objects[failed.id] as StepV2).stroke, (view.state.objects[failed.id] as StepV2).fill], ['red', 'red']);
    assertOracle(f.world, view);
    // The board names the style in text, not by colour alone.
    assert.match(await f.page.locator(`[data-object-id="${failed.id}"]`).first().getAttribute('aria-label') ?? '', /red line, red fill/);
    await f.page.getByTestId('check').focus();
    const response = f.page.waitForResponse(item => item.url().endsWith('/api/check'));
    await f.page.keyboard.press('Enter');
    const reply = await (await response).json() as HostReply<{ passed: boolean }>;
    assert.equal(reply.ok && reply.value.passed, true, JSON.stringify(reply));
    assert.deepEqual(f.externalRequests, []);
  } finally { await f.close(); }
});

async function editor(page: Page): Promise<Frame> {
  const handle = await page.getByTestId('real-editor').elementHandle(); const frame = await handle!.contentFrame(); assert.ok(frame);
  await frame.waitForFunction(() => !!(window as unknown as { __pnEditor: unknown }).__pnEditor);
  return frame;
}
const sceneOf = (frame: Frame) => frame.evaluate(() => (window as unknown as { __pnEditor: { read(): Array<{ id: string; type: string; isDeleted: boolean; containerId?: string | null; text?: string; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null }> } }).__pnEditor.read().filter(e => !e.isDeleted));
/** Draw a labelled rectangle with the real editor's own tools: R, drag, double-click, type, Escape. */
async function rectangle(page: Page, frame: Frame, x: number, y: number, label: string): Promise<void> {
  const box = (await page.getByTestId('real-editor').boundingBox())!;
  await frame.locator('.excalidraw').press('r');
  await page.mouse.move(box.x + x, box.y + y); await page.mouse.down(); await page.mouse.move(box.x + x + 160, box.y + y + 80, { steps: 6 }); await page.mouse.up();
  await page.mouse.dblclick(box.x + x + 80, box.y + y + 40);
  await frame.locator('textarea').waitFor({ state: 'visible' }); await page.keyboard.type(label); await page.keyboard.press('Escape');
  await frame.waitForFunction(label => (window as unknown as { __pnEditor: { read(): Array<{ type: string; isDeleted: boolean; containerId?: string | null; originalText?: string }> } }).__pnEditor.read().some(e => !e.isDeleted && e.type === 'text' && e.containerId && e.originalText === label), label);
}
test('Create, second way: draw start and goal in the real editor, get a checked exercise', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-scenes-'));
  const host = await startHost(library, { phase3: true, taskId: 'add-step', seed: 42, localDirectory: directory, tokenDirectory: join(directory, 'credentials') });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.goto(host.url); await page.getByTestId('phase3').waitFor();
    await page.getByTestId('phase3-status').filter({ hasText: /ready|bereit/ }).waitFor({ timeout: 20_000 });
    await page.getByTestId('language-en').click(); await page.getByTestId('mode-author').click();
    await page.getByTestId('create-way-draw').click(); await page.getByTestId('two-scenes').waitFor();
    await page.getByTestId('two-scenes-blank').click();
    const frame = await editor(page);
    await page.getByTestId('real-editor').scrollIntoViewIfNeeded();
    // Right of the editor's property panel, inside the empty canvas.
    await rectangle(page, frame, 380, 140, 'Order'); await rectangle(page, frame, 720, 140, 'Ship');
    await page.getByTestId('two-scenes-start').click();
    // Taking the start closes its step (its summary line says what was taken) and opens the goal step.
    await page.locator('[data-two-scenes-step="start"] .pn-step__summary-line').filter({ hasText: /^2 steps, 0 arrows taken\.$/ }).waitFor();
    assert.equal(await page.locator('[data-two-scenes-step="goal"]').evaluate(node => (node as HTMLDetailsElement).open), true);
    // The goal: an arrow from Order to Ship, drawn with the arrow tool across both shapes.
    const box = (await page.getByTestId('real-editor').boundingBox())!;
    await frame.locator('.excalidraw').press('a');
    await page.mouse.move(box.x + 532, box.y + 180); await page.mouse.down(); await page.mouse.move(box.x + 728, box.y + 180, { steps: 10 }); await page.mouse.up();
    await page.keyboard.press('Escape');
    const drawn = await sceneOf(frame);
    const arrow = drawn.find(e => e.type === 'arrow'); assert.ok(arrow?.startBinding && arrow.endBinding, JSON.stringify(arrow));
    await page.getByTestId('two-scenes-goal').click();
    await page.locator('[data-two-scenes-step="goal"] .pn-step__summary-line').filter({ hasText: /^2 steps, 1 arrow taken\.$/ }).waitFor();
    await page.getByTestId('two-scenes-create').click();
    await page.getByTestId('two-scenes-result').waitFor({ timeout: 30_000 });
    const href = await page.getByTestId('two-scenes-open').getAttribute('href');
    assert.match(href ?? '', /^http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32}$/);
    // The new exercise opens as an ordinary practice session whose goal is the drawn arrow.
    const practice = await context.newPage(); await practice.goto(href!); await practice.getByTestId('board').waitFor();
    await practice.getByTestId('language-en').click();
    assert.match(await practice.getByTestId('check-result').innerText(), /One arrow from “Order” to “Ship”\./);
    const verdict = async (): Promise<boolean> => {
      const response = practice.waitForResponse(item => item.url().endsWith('/api/check'));
      await practice.getByTestId('check').click();
      const reply = await (await response).json() as HostReply<{ passed: boolean }>; assert.equal(reply.ok, true); return reply.ok && reply.value.passed;
    };
    assert.equal(await verdict(), false, 'the start of the new exercise fails');
    // Solve it in the practice board with the keyboard: C on “Order”, choose “Ship”, Enter.
    await practice.locator('[data-object-type="step"][aria-label^="Order"]').focus();
    await practice.keyboard.press('c');
    await practice.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Ship'));
    const acted = practice.waitForResponse(item => item.url().endsWith('/api/act'));
    await practice.keyboard.press('Enter');
    assert.equal(((await (await acted).json()) as HostReply<unknown>).ok, true);
    assert.equal(await verdict(), true, 'the drawn goal is reachable');
    const reply = await (await fetch(host.origin + '/api/observe', { headers: { [TOKEN_HEADER]: host.token } })).json() as HostReply<HostView>;
    assert.equal(reply.ok && reply.value.task.id, 'add-step', 'the author session itself is unchanged');
  } finally { await browser.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test('Create, draw way: an empty drawing cannot be taken as start, and nothing speaks of recording', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-scenes-empty-'));
  const host = await startHost(library, { phase3: true, taskId: 'add-step', seed: 42, localDirectory: directory, tokenDirectory: join(directory, 'credentials') });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' })).newPage();
    await page.goto(host.url); await page.getByTestId('phase3').waitFor();
    await page.getByTestId('phase3-status').filter({ hasText: /ready|bereit/ }).waitFor({ timeout: 20_000 });
    await page.getByTestId('language-en').click(); await page.getByTestId('mode-author').click();
    await page.getByTestId('create-way-draw').click(); await page.getByTestId('two-scenes').waitFor();
    // N2: the draw way records nothing, so no line on the page mentions recording.
    const recordingWords = /record|Recording/;
    const notes = async (): Promise<string> => `${await page.locator('.engine-note').innerText()}\n${await page.getByTestId('phase3-status').innerText()}`;
    assert.doesNotMatch(await notes(), recordingWords);
    assert.equal(await page.locator('.create-advanced').isVisible(), false, 'the recorder details belong to the record way');
    // N1: before anything is drawn, "Use the drawing as start" is off and says why.
    const start = page.getByTestId('two-scenes-start');
    assert.equal(await start.isDisabled(), true);
    assert.match(await page.getByTestId('two-scenes-start-reason').innerText(), /Draw at least one step first/);
    assert.equal(await start.getAttribute('aria-describedby'), 'two-scenes-start-reason');
    await page.getByTestId('two-scenes-blank').click();
    const frame = await editor(page);
    await page.getByTestId('real-editor').scrollIntoViewIfNeeded();
    assert.equal(await start.isDisabled(), true, 'an empty drawing is still empty');
    assert.doesNotMatch(await notes(), recordingWords);
    await rectangle(page, frame, 380, 140, 'Order');
    await page.waitForFunction(() => !(document.querySelector('[data-testid="two-scenes-start"]') as HTMLButtonElement | null)?.disabled, undefined, { timeout: 10_000 });
    assert.equal(await page.getByTestId('two-scenes-start-reason').count(), 0);
    // N3: the object list repeats the drawn shape.
    assert.equal(await page.locator('.native-object[data-shape="rectangle"] .native-object__step--rectangle').count(), 1);
  } finally { await browser.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
});

test('history names who acted: Agent · <MCP client> for MCP changes, You for the Player; one switch for rules', { timeout: 120_000 }, async () => {
  const f = await fixture({ world: library, taskId: 'connect' });
  try {
    await f.page.getByTestId('language-en').click();
    const bridge = await createBridge({ host: f.host.origin, token: f.host.token });
    const view = await f.observe();
    const steps = Object.values(view.state.objects).filter(o => o.type === 'step');
    const agentAct = await bridge.call('act', { name: 'move_step', params: { id: steps[0]!.id, x: 40, y: 40 }, baseStep: view.step, expectedRevision: view.revision }, { client: 'claude-code' });
    assert.equal(agentAct.ok, true, JSON.stringify(agentAct));
    await f.page.getByTestId('history-entry').first().waitFor();
    assert.equal(await f.page.getByTestId('history-actor').first().innerText(), 'Agent · claude-code');
    // A client name that is not plain text is shown as the generic name, never as given.
    const next = await f.observe();
    const hostile = await bridge.call('act', { name: 'move_step', params: { id: steps[0]!.id, x: 60, y: 40 }, baseStep: next.step, expectedRevision: next.revision }, { client: 'evil\u202e<b>' });
    assert.equal(hostile.ok, true);
    await f.page.getByTestId('history-entry').nth(1).waitFor();
    assert.equal(await f.page.getByTestId('history-actor').nth(1).innerText(), 'Agent · MCP client');
    // The person in the Player: undo is not an act; add a step through the palette.
    await changed(f, async () => { await f.page.getByTestId('action-add').click(); await f.page.getByTestId('input-label').fill('Mine'); await f.page.getByTestId('action-submit').click(); });
    await f.page.getByTestId('history-entry').nth(2).waitFor();
    assert.equal(await f.page.getByTestId('history-actor').nth(2).innerText(), 'You');
    assert.deepEqual((await f.observe()).history.map(item => item.actor), [{ kind: 'agent', client: 'claude-code' }, { kind: 'agent', client: 'MCP client' }, { kind: 'human' }]);
    // One switch for rules and origins, not a link under each entry.
    assert.equal(await f.page.getByTestId('history-rule-origin').count(), 0);
    await f.page.getByTestId('history-origins').click();
    assert.equal(await f.page.getByTestId('history-rule-origin').count(), 3);
    assert.equal(await f.page.getByTestId('history-origins').getAttribute('aria-pressed'), 'true');
    // What this changed names the change and sits below the goal and its Check button.
    const consequence = await f.page.getByTestId('consequence').innerText();
    assert.match(consequence, /What this changed\s+Added step “Mine”/);
    const order = await f.page.evaluate(() => { const check = document.querySelector('[data-testid="check"]')!, banner = document.querySelector('[data-testid="consequence"]')!; return check.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING; });
    assert.ok(order, 'the consequence banner follows Check result');
  } finally { await f.close(); }
});

test('a black line is drawn in Excalidraw black, at least 2 px wide on screen at 320 px and at 1440 px', { timeout: 120_000 }, async () => {
  for (const width of [320, 1440]) {
    const f = await fixture({ world: library, taskId: 'connect', width, theme: 'light' });
    try {
      const measured = await f.page.locator('.step-box').first().evaluate(node => { const style = getComputedStyle(node); return { stroke: style.stroke, width: style.strokeWidth, effect: style.vectorEffect, cls: node.getAttribute('class') }; });
      assert.match(measured.cls ?? '', /step-box--line-black/, `${width}: library steps carry the black line`);
      assert.deepEqual([measured.stroke, measured.effect], ['rgb(30, 30, 30)', 'non-scaling-stroke'], `${width}`);
      // Non-scaling: the computed width is the width on screen, whatever the board's scale.
      assert.ok(parseFloat(measured.width) >= 2, `${width}: ${measured.width}`);
    } finally { await f.close(); }
  }
});

test('320 px: a board wider than the screen is a named, focusable region with a visible hint', { timeout: 120_000 }, async () => {
  const f = await fixture({ world: library, taskId: 'insert-between', width: 320 });
  try {
    await f.page.getByTestId('language-en').click();
    const region = f.page.locator('.board-scroll');
    assert.equal(await region.getAttribute('role'), 'region'); assert.match(await region.getAttribute('aria-label') ?? '', /scroll horizontally/);
    assert.equal(await region.getAttribute('tabindex'), '0');
    const overflow = await region.evaluate(node => node.scrollWidth > node.clientWidth);
    assert.equal(overflow, true, 'the fixture board is wider than 320 px');
    await f.page.getByTestId('board-scroll-hint').waitFor();
    assert.equal(await f.page.getByTestId('board-scroll-hint').innerText(), 'Swipe sideways to see the whole board.');
    assert.equal(await region.getAttribute('aria-describedby'), 'board-scroll-hint');
    assert.match(await region.getAttribute('class') ?? '', /is-clipped-end/);
    await region.focus(); await f.page.keyboard.press('ArrowRight');
  } finally { await f.close(); }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, changed, assertOracle } from './harness.ts';

test('task and variant changes preserve work until explicitly confirmed; modal undo cannot bypass cancel', { timeout: 90_000 }, async () => {
  const f = await fixture({ taskId: 'T3' });
  try {
    await f.page.locator('[data-object-id="a"]').first().focus();
    await f.page.keyboard.press('Enter'); await f.page.keyboard.press('ArrowRight');
    await changed(f, () => f.page.keyboard.press('Enter'));
    await changed(f, () => f.page.getByTestId('hint').click());
    const before = await f.observe(); assertOracle(f.world, before);
    // Unsolved work on the board: choosing another task asks first, naming the task.
    await f.page.getByTestId('task-picker').click();
    await f.page.getByTestId('task-picker-option-T1').click();
    await f.page.getByTestId('change-cancel').waitFor();
    assert.match(await f.page.getByTestId('change-dialog').innerText(), /Build the flow|Fluss aufbauen|T1/);
    assert.equal(await f.page.locator(':focus').getAttribute('data-testid'), 'change-cancel');
    await f.page.keyboard.press('Control+z');
    assert.deepEqual(await f.observe(), before, 'undo must not mutate behind confirmation');
    await f.page.getByTestId('change-cancel').click();
    assert.deepEqual(await f.observe(), before, 'task cancel preserves log, hash, revision and hints');
    // The keyboard path: open the list with Enter, move to the option, Enter.
    await f.page.getByTestId('task-picker').focus(); await f.page.keyboard.press('Enter');
    await f.page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'option');
    while (await f.page.evaluate(() => document.activeElement?.getAttribute('data-value')) !== 'T1') await f.page.keyboard.press('ArrowDown');
    await f.page.keyboard.press('Enter');
    const task = await changed(f, () => f.page.getByTestId('change-confirm').click());
    assert.equal(task.task.id, 'T1'); assert.equal(task.seed, before.seed);
    assert.equal(task.variantId, before.variantId); assert.equal(task.step, 0); assert.equal(task.hintsOpened, 0);
    assert.equal(task.attempt, 1, 'the attempt counter starts again for the new task');
    assert.match(await f.page.locator('.practice-head__meta').innerText(), /Attempt 1 · 0 actions|Versuch 1 · 0 Aktionen/);
    await f.page.getByTestId('action-add').click(); await f.page.getByTestId('input-label').fill('Work to keep');
    await changed(f, () => f.page.getByTestId('action-submit').click());
    const working = await f.observe();
    await f.page.getByTestId('new-variant').click(); await f.page.getByTestId('change-cancel').waitFor();
    await f.page.keyboard.press('Escape');
    assert.deepEqual(await f.observe(), working, 'variant Escape preserves every committed field');
    await f.page.getByTestId('new-variant').click();
    const next = await changed(f, () => f.page.getByTestId('change-confirm').click());
    assert.equal(next.task.id, 'T1'); assert.notEqual(next.variantId, working.variantId); assert.equal(next.step, 0);
    // Without unsolved work a task change is one step: no dialog, the task switches at once.
    await f.page.getByTestId('task-picker').click();
    const switched = await changed(f, () => f.page.getByTestId('task-picker-option-T3').click());
    assert.equal(switched.task.id, 'T3'); assert.equal(await f.page.getByTestId('change-dialog').count(), 0);
    assert.equal(await f.page.getByText(/Pending:|Vorgemerkt:/).count(), 0);
    assert.deepEqual(f.externalRequests, []);
  } finally { await f.close(); }
});

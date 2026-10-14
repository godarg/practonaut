// Task limits in the Player (PADR-0040): the Player shows the changes used and the checks left, one
// counter serves the Player and an agent on the same session, and a used-up limit is refused by the
// host and explained in the Player. Counts are written out by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitsWorld, setLanguage, settle, startPlayer } from '../support/player-states.ts';
import { v2Task, v2World } from '../support/world-v2.ts';
import type { ErrorClass } from '../../src/world/types.ts';

test('the Player shows changes used and checks left, shares the counters with agents and explains a used-up limit', { timeout: 180_000 }, async () => {
  const s = await startPlayer({ world: limitsWorld(), taskId: 'T1', phase3: false, mirror: 'off' });
  try {
    const used = s.page.getByTestId('changes-used'), left = s.page.getByTestId('checks-left'), check = s.page.getByTestId('check');
    await left.waitFor();
    assert.equal(await used.textContent(), '0 of 3 changes used (undo, reset and new variants count too)');
    assert.equal(await left.textContent(), '2 checks left of 2');
    // A check from the Player uses one.
    await check.click();
    await s.page.waitForFunction(() => document.querySelector('[data-testid=checks-left]')?.textContent === '1 check left of 2');
    // An agent's check (the same host route the MCP bridge uses) uses the other one: Check turns off.
    assert.equal((await s.post('check')).ok, true);
    await s.page.waitForFunction(() => (document.querySelector('[data-testid=check]') as HTMLButtonElement | null)?.disabled === true);
    assert.equal(await left.textContent(), 'No checks left for this task in this session.');
    const refused = await s.post('check');
    assert.equal(!refused.ok && refused.error.code, 'check_budget_exhausted');
    // Changes: three accepted ones (act, undo, act), then the host refuses the fourth.
    for (const action of [{ name: 'move_step', params: { id: 'a', x: 120, y: 100 } }]) assert.equal((await s.post('act', { action })).ok, true);
    assert.equal((await s.post('undo')).ok, true);
    assert.equal((await s.post('act', { action: { name: 'connect', params: { from: 'b', to: 'c' } } })).ok, true);
    await s.page.waitForFunction(() => /^3 of 3 changes used/.test(document.querySelector('[data-testid=changes-used]')?.textContent ?? ''));
    const before = await s.observe();
    await s.page.getByTestId('undo').click();
    await s.page.getByTestId('rejection').waitFor();
    assert.match(await s.page.getByTestId('rejection').textContent() ?? '', /All changes for this task are used up/);
    assert.equal((await s.observe()).hash, before.hash, 'the refused undo changed nothing');
    // German.
    await setLanguage(s.page, 'de'); await settle(s.page);
    assert.match(await used.textContent() ?? '', /^3 von 3 Änderungen verbraucht/);
    assert.equal(await left.textContent(), 'Für diese Aufgabe sind in dieser Sitzung keine Prüfungen mehr übrig.');
    // A new variant of the same task counts like a reset: refused once every change is used.
    const variant = await s.post('variant', { confirmed: true });
    assert.equal(!variant.ok && variant.error.code, 'action_budget_exhausted');
  } finally { await s.close(); }
});

test('a session check limit (--checks) shows in the Player of a task without limits', { timeout: 120_000 }, async () => {
  const s = await startPlayer({ phase3: false, mirror: 'off', checks: 1 });
  try {
    await s.page.getByTestId('checks-left').waitFor();
    assert.equal(await s.page.getByTestId('checks-left').textContent(), '1 check left of 1');
    assert.equal(await s.page.getByTestId('changes-used').count(), 0, 'no action limit, no count');
  } finally { await s.close(); }
});

test('the Player\'s New variant button counts like a reset under task limits (review nit a)', { timeout: 120_000 }, async () => {
  const s = await startPlayer({ world: limitsWorld(), taskId: 'T1', phase3: false, mirror: 'off' });
  try {
    const used = s.page.getByTestId('changes-used');
    await used.waitFor();
    // Nothing on the board yet: the Player changes the variant without asking; it uses one change.
    await s.page.getByTestId('new-variant').click();
    await s.page.waitForFunction(() => /^1 of 3 changes used/.test(document.querySelector('[data-testid=changes-used]')?.textContent ?? ''));
    assert.equal((await s.post('act', { action: { name: 'move_step', params: { id: 'a', x: 120, y: 100 } } })).ok, true);
    assert.equal((await s.post('undo')).ok, true);
    await s.page.waitForFunction(() => /^3 of 3 changes used/.test(document.querySelector('[data-testid=changes-used]')?.textContent ?? ''));
    const before = await s.observe();
    await s.page.getByTestId('new-variant').click();
    await s.page.getByTestId('rejection').waitFor();
    assert.match(await s.page.getByTestId('rejection').textContent() ?? '', /All changes for this task are used up/);
    assert.equal((await s.observe()).revision, before.revision, 'the refused variant changed nothing');
  } finally { await s.close(); }
});

test('under a check limit the Player shows error explanations only through a check (review S6)', { timeout: 180_000 }, async () => {
  // A hand-written error class that holds on the start board and after a move (one arrow).
  const missing: ErrorClass = { id: 'arrow-missing', category: 'accepted_but_violates_goal', when: { op: 'eq', left: { kind: 'count', type: 'arrow', as: 'n', where: { op: 'true' } }, right: { kind: 'literal', value: 1 } }, explanation: { en: 'The arrow to Ship is still missing.', de: 'Der Pfeil zu Versand fehlt noch.' } };
  const shown = async (limits: { actions?: number; checks?: number }): Promise<boolean> => {
    const s = await startPlayer({ world: v2World({ tasks: [v2Task({ limits, errorClasses: [missing] })] }), taskId: 'T1', phase3: false, mirror: 'off' });
    try {
      await s.page.getByTestId('changes-used').waitFor();
      assert.equal((await s.post('act', { action: { name: 'move_step', params: { id: 'a', x: 120, y: 100 } } })).ok, true);
      await s.page.getByTestId('consequence').waitFor();
      await settle(s.page);
      return (await s.page.locator('body').innerText()).includes('The arrow to Ship is still missing.');
    } finally { await s.close(); }
  };
  assert.equal(await shown({ actions: 5 }), true, 'without a check limit the Player explains the error after the move');
  assert.equal(await shown({ actions: 5, checks: 1 }), false, 'with a check limit it does not');
});


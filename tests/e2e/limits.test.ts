// Task limits in the Player (PADR-0040): the Player shows the changes used and the checks left, one
// counter serves the Player and an agent on the same session, and a used-up limit is refused by the
// host and explained in the Player. Counts are written out by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitsWorld, setLanguage, settle, startPlayer } from '../support/player-states.ts';

test('the Player shows changes used and checks left, shares the counters with agents and explains a used-up limit', { timeout: 180_000 }, async () => {
  const s = await startPlayer({ world: limitsWorld(), taskId: 'T1', phase3: false, mirror: 'off' });
  try {
    const meta = s.page.getByTestId('practice-meta'), left = s.page.getByTestId('checks-left'), check = s.page.getByTestId('check');
    await left.waitFor();
    assert.match(await meta.textContent() ?? '', /0 of 3 changes used/);
    assert.equal(await left.textContent(), '2 checks left of 2');
    // A check from the Player uses one.
    await check.click();
    await s.page.waitForFunction(() => document.querySelector('[data-testid=checks-left]')?.textContent === '1 check left of 2');
    // An agent's check (the same host route the MCP bridge uses) uses the other one: Check turns off.
    assert.equal((await s.post('check')).ok, true);
    await s.page.waitForFunction(() => (document.querySelector('[data-testid=check]') as HTMLButtonElement | null)?.disabled === true);
    assert.equal(await left.textContent(), 'No checks left in this attempt. A new variant starts a new attempt.');
    const refused = await s.post('check');
    assert.equal(!refused.ok && refused.error.code, 'check_budget_exhausted');
    // Changes: three accepted ones (act, undo, act), then the host refuses the fourth.
    for (const action of [{ name: 'move_step', params: { id: 'a', x: 120, y: 100 } }]) assert.equal((await s.post('act', { action })).ok, true);
    assert.equal((await s.post('undo')).ok, true);
    assert.equal((await s.post('act', { action: { name: 'connect', params: { from: 'b', to: 'c' } } })).ok, true);
    await s.page.waitForFunction(() => /3 of 3 changes used/.test(document.querySelector('[data-testid=practice-meta]')?.textContent ?? ''));
    const before = await s.observe();
    await s.page.getByTestId('undo').click();
    await s.page.getByTestId('rejection').waitFor();
    assert.match(await s.page.getByTestId('rejection').textContent() ?? '', /used all its changes/);
    assert.equal((await s.observe()).hash, before.hash, 'the refused undo changed nothing');
    // German.
    await setLanguage(s.page, 'de'); await settle(s.page);
    assert.match(await meta.textContent() ?? '', /3 von 3 Änderungen verbraucht/);
    assert.equal(await left.textContent(), 'In diesem Versuch sind keine Prüfungen mehr übrig. Eine neue Variante beginnt einen neuen Versuch.');
    // A new variant is a new attempt with fresh counts.
    assert.equal((await s.post('variant', { confirmed: true })).ok, true);
    await s.page.waitForFunction(() => document.querySelector('[data-testid=checks-left]')?.textContent === '2 Prüfungen von 2 übrig');
  } finally { await s.close(); }
});

test('a session check limit (--checks) shows in the Player of a task without limits', { timeout: 120_000 }, async () => {
  const s = await startPlayer({ phase3: false, mirror: 'off', checks: 1 });
  try {
    await s.page.getByTestId('checks-left').waitFor();
    assert.equal(await s.page.getByTestId('checks-left').textContent(), '1 check left of 1');
    assert.doesNotMatch(await s.page.getByTestId('practice-meta').textContent() ?? '', /changes used/, 'no action limit, no count');
  } finally { await s.close(); }
});

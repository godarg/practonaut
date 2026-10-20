// PADR-0050, decisions 4, 5 and 7: the process-wide browser budget and what proves a browser's end.
// A slot is released only by Playwright's own close, asked while the browser was connected and
// fulfilled; a launch that rejected holds its slot for 35 s; a browser that was disconnected before its
// close, or whose close rejected, holds it until the process exits. Node's mock clock moves the time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserBudgetError, BrowserLedger, type BrowserLease } from '../../src/adapters/browser/ledger.ts';
import type { ChromiumLaunch } from '../../src/adapters/browser/chromium.ts';
import { closeBy } from '../../src/adapters/browser/close.ts';
import { budgetNote, budgetOutcome } from '../../src/bench/run.ts';
import type { Browser } from 'playwright-core';
import { FakeBrowser, advance, flush } from '../support/fake-browser.ts';

const launched = (browser: FakeBrowser): Promise<ChromiumLaunch> => Promise.resolve({ browser: browser as unknown as Browser, sandbox: true });
async function running(ledger: BrowserLedger, browser = new FakeBrowser()): Promise<{ lease: BrowserLease; browser: FakeBrowser; released: () => boolean }> {
  const lease = await ledger.reserve('mirror', { waitMs: 15_000 });
  let released = false; lease.onRelease(() => { released = true; });
  await lease.launch(() => launched(browser));
  return { lease, browser, released: () => released };
}

test('a close asked while connected that fulfils proves the end: the slot and the sink are released', async () => {
  const ledger = new BrowserLedger(8), { lease, released } = await running(ledger);
  assert.equal(ledger.unreleased(), 1);
  assert.deepEqual(await lease.close(), { outcome: 'closed' });
  await flush();
  assert.equal(released(), true, 'the release callback (the shell closes its sink there) ran');
  assert.equal(ledger.unreleased(), 0);
  const record = ledger.records()[0]!;
  assert.deepEqual([record.launch, record.close, record.connectedAtRequest, record.end, record.slot, record.cleanup], ['resolved', 'fulfilled', true, 'proven', 'proof', 'unconfirmed']);
});

test('a close asked after `disconnected` fulfils but proves nothing: slot and sink stay until the process exits', async () => {
  const ledger = new BrowserLedger(8), { lease, browser, released } = await running(ledger);
  browser.disconnect(); // Chromium closed its end; its process may still run.
  assert.deepEqual(await lease.close(), { outcome: 'closed' }, 'the promise result is still closed');
  await flush();
  assert.equal(released(), false);
  assert.equal(ledger.unreleased(), 1);
  assert.deepEqual([ledger.records()[0]!.connectedAtRequest, ledger.records()[0]!.end, ledger.records()[0]!.slot], [false, 'disconnected-before-close', 'held']);
});

test('a close asked while `isConnected()` is already false is no proof either', async () => {
  const ledger = new BrowserLedger(8), browser = new FakeBrowser(), { lease } = await running(ledger, browser);
  browser.connected = false; // No `disconnected` delivered yet.
  await lease.close(); await flush();
  assert.equal(ledger.unreleased(), 1);
});

test('a close that rejects is failed and keeps the slot until the process exits', async () => {
  const ledger = new BrowserLedger(8), { lease, browser } = await running(ledger, new FakeBrowser('held'));
  const closing = lease.close();
  browser.closing.fail(new Error('stand-in close failed'));
  const result = await closing;
  assert.equal(result.outcome, 'failed');
  assert.equal((result.error as Error).message, 'stand-in close failed');
  await flush();
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.end], [1, 'close-failed']);
});

test('joining callers share one browser.close() and each gets the outcome against its own deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(8), { lease, browser, released } = await running(ledger, new FakeBrowser('held'));
  const now = performance.now(), outcomes: string[] = [];
  void lease.close(now + 1_000).then(result => outcomes.push(`first:${result.outcome}`));
  void lease.close(now + 5_000).then(result => outcomes.push(`second:${result.outcome}`));
  await advance(t, () => outcomes.length === 2, 6_000);
  assert.deepEqual(outcomes, ['first:abandoned', 'second:abandoned']);
  assert.equal(browser.closing.calls, 1, 'one close for every caller');
  assert.equal(ledger.unreleased(), 1, 'an abandoned close keeps the slot');
  browser.closing.finish(); await flush();
  assert.equal(released(), true, 'the close that fulfils later proves the end');
  assert.deepEqual(await lease.close(), { outcome: 'closed' }, 'a later caller joins the settled close');
  assert.equal(browser.closing.calls, 1);
  assert.deepEqual(ledger.records()[0]!.callers, { closed: 1, failed: 0, abandoned: 2, cancelled: 0 });
});

test('a launch that rejects holds its slot and sink for 35 s after the rejection, judged by Playwright\'s promise', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(8), lease = await ledger.reserve('mirror', { waitMs: 15_000 });
  let released = false; lease.onRelease(() => { released = true; });
  let reject!: (error: unknown) => void;
  const launching = lease.launch(() => new Promise<ChromiumLaunch>((_, fail) => { reject = fail; }));
  launching.catch(() => undefined);
  // The caller's own race is lost first (its deadline or abort): the entry stays launching.
  assert.deepEqual(await lease.close(), { outcome: 'cancelled' });
  await advance(t, () => false, 20_000);
  assert.deepEqual([ledger.records()[0]!.launch, ledger.unreleased(), released], ['pending', 1, false], 'nothing is released while Playwright\'s launch runs');
  reject(new Error('Timeout 3000ms exceeded')); await flush();
  assert.deepEqual([ledger.records()[0]!.launch, ledger.records()[0]!.end], ['rejected', 'launch-rejected']);
  await advance(t, () => false, 34_750);
  assert.equal(released, false, 'held until 35 s after the rejection');
  await advance(t, () => released, 1_000);
  assert.deepEqual([released, ledger.unreleased(), ledger.records()[0]!.slot], [true, 0, 'launch-wait']);
});

test('a browser that arrives after its caller gave up joins its one close, and that close proves its end', async () => {
  const ledger = new BrowserLedger(8), lease = await ledger.reserve('mirror', { waitMs: 15_000 }), browser = new FakeBrowser();
  let arrive!: () => void;
  void lease.launch(() => new Promise<ChromiumLaunch>(resolve => { arrive = () => resolve({ browser: browser as unknown as Browser, sandbox: true }); }));
  assert.deepEqual(await lease.close(), { outcome: 'cancelled' }, 'no browser existed when the caller gave up');
  assert.equal(browser.closing.calls, 0);
  arrive(); await flush();
  assert.equal(browser.closing.calls, 1, 'the late browser went to its one close');
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.end], [0, 'proven']);
});

test('a slot whose launch never started is given back at once', async () => {
  const ledger = new BrowserLedger(8), lease = await ledger.reserve('mirror', { waitMs: 15_000 });
  assert.deepEqual(await lease.close(), { outcome: 'cancelled' });
  assert.deepEqual([ledger.unreleased(), ledger.records()[0]!.slot, ledger.records()[0]!.end], [0, 'unused', 'none']);
});

test('the budget: nine starts in one turn with eight slots; the reservation is synchronous and the ninth is refused at its launch bound', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(8);
  const starts = Array.from({ length: 9 }, () => ledger.reserve('mirror', { waitMs: 15_000 }));
  assert.equal(ledger.unreleased(), 8, 'eight slots taken before any start awaited anything');
  let ninth: unknown = 'pending';
  starts[8]!.then(() => { ninth = 'granted'; }, error => { ninth = error; });
  await advance(t, () => ninth !== 'pending', 14_750);
  const outcome = (): unknown => ninth;
  assert.equal(outcome(), 'pending', 'the ninth waits within its launch bound');
  await advance(t, () => ninth !== 'pending', 1_000);
  const refused = outcome();
  assert.ok(refused instanceof BrowserBudgetError, `refused by name, not ${String(refused)}`);
  assert.deepEqual([refused.code, refused.running, refused.closing, refused.budget], ['browser_budget_exhausted', 8, 0, 8]);
  assert.match(refused.message, /8 running and 0 closing of 8 allowed; wait until they have closed, or restart Practonaut/);
  await Promise.all(starts.slice(0, 8));
});

test('the budget: the waiting start takes the first slot that frees, in call order', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(8);
  const leases = await Promise.all(Array.from({ length: 8 }, () => ledger.reserve('mirror', { waitMs: 15_000 })));
  let ninth: BrowserLease | undefined, tenth: unknown = 'pending';
  void ledger.reserve('render-check', { waitMs: 15_000 }).then(lease => { ninth = lease; });
  void ledger.reserve('report-card', { waitMs: 15_000 }).then(() => { tenth = 'granted'; }, error => { tenth = error; });
  await advance(t, () => false, 5_000);
  assert.equal(ledger.tryReserve('start-check'), undefined, 'a start cannot jump the queue');
  await leases[0]!.close(); // An unused slot is given back at once.
  await flush();
  assert.ok(ninth, 'the first waiting start got the freed slot');
  assert.equal(ledger.records().at(-1)!.owner, 'render-check');
  await advance(t, () => tenth !== 'pending', 11_000);
  assert.ok(tenth instanceof BrowserBudgetError, 'the second waiter is still refused at its own bound');
});

test('an abort while waiting for a slot refuses the start as cancelled and takes no slot', async () => {
  const ledger = new BrowserLedger(1), first = await ledger.reserve('mirror', { waitMs: 15_000 }), stop = new AbortController();
  const waiting = ledger.reserve('mirror', { waitMs: 15_000, signal: stop.signal, cancelled: () => new Error('cancelled before launch') });
  stop.abort();
  await assert.rejects(waiting, /cancelled before launch/);
  await first.close();
  assert.equal(ledger.unreleased(), 0);
});

test('the ledger keeps every unreleased entry and the latest 64 in all', async () => {
  const ledger = new BrowserLedger(8), held = await running(ledger);
  held.browser.disconnect(); await held.lease.close(); // Held until exit.
  for (let index = 0; index < 70; index++) { const { lease } = await running(ledger); await lease.close(); }
  const records = ledger.records();
  assert.equal(records.length, 64);
  assert.equal(records[0]!.id, 1, 'the unreleased entry stays');
  assert.equal(records.at(-1)!.id, 71);
});

test('a close whose deadline has already passed is abandoned at once, not cut by the safety timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(), { lease } = await running(ledger, new FakeBrowser('held'));
  const outcomes: string[] = [];
  void closeBy(deadline => lease.close(deadline), performance.now() - 1_000).then(result => outcomes.push(result.outcome));
  await advance(t, () => outcomes.length > 0, 2_000, 1);
  assert.deepEqual(outcomes, ['abandoned']);
});

// Review of PR #69 (effects-8, effects-3): refusals are counted, so a bench run that lost its mirror to
// the budget in a recovery names it; and how long a start waited for its slot is recorded.
test('the ledger counts its refusals and records how long a start waited for its slot; a bench run lost to one names it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ledger = new BrowserLedger(1), held = await ledger.reserve('mirror', { waitMs: 1 });
  let refused: unknown;
  ledger.reserve('mirror', { waitMs: 1_000 }).catch(error => { refused = error; });
  await advance(t, () => refused !== undefined, 2_000);
  assert.deepEqual([refused instanceof BrowserBudgetError, ledger.refusals], [true, 1]);
  const waiting = ledger.reserve('render-check', { waitMs: 15_000 });
  await advance(t, () => false, 3_000);
  await held.close();
  await waiting;
  const record = ledger.records().at(-1)!;
  assert.ok(record.at.reserved >= record.at.asked, 'when the start asked and when it got its slot');
  assert.equal(budgetNote('error: native export failed: mirror_unavailable'), 'browser_budget_exhausted: a browser start was refused during the run; error: native export failed: mirror_unavailable');
  assert.equal(budgetNote('browser_budget_exhausted: No browser slot became free'), 'browser_budget_exhausted: No browser slot became free', 'a note that already names it stays');
  // A recovery refused during the run: the run ends without a mirror and its note names the budget.
  const lost = { status: 'infra_error', note: 'error: native export failed: mirror_unavailable' };
  assert.match(budgetOutcome(lost, 0, ledger).note ?? '', /^browser_budget_exhausted: /);
  assert.equal(budgetOutcome(lost, ledger.refusals, ledger), lost, 'no refusal during the run, no change');
  const judged: { status: string; note?: string } = { status: 'completed' };
  assert.equal(budgetOutcome(judged, 0, ledger), judged, 'a judged run is unchanged');
});

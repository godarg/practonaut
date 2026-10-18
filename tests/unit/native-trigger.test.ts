// Arm, barrier, trigger (issue #45): the order of the steps; no input once the wait has ended or the
// event came first; one time limit from arming to the event, also when an operation hangs; a waiter
// left behind never becomes an unhandled rejection. The real-browser ordering of `nativeFileTransfer`
// is checked in tests/integration/transfer.test.ts through the launch seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { armBarrierTrigger, openNativeFileChooser, type ArmBarrierTriggerSteps, type NativeOpenPage } from '../../src/evaluation/native-trigger.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
const after = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const hang = (): Promise<never> => new Promise<never>(() => undefined);
const named = (pattern: RegExp) => (error: unknown): boolean => {
  assert.ok(error instanceof RuntimeError, String(error)); assert.equal(error.code, 'transfer_invalid');
  assert.match(error.message, pattern); return true;
};
function steps<T>(overrides: Partial<ArmBarrierTriggerSteps<T>> & Pick<ArmBarrierTriggerSteps<T>, 'arm'>): ArmBarrierTriggerSteps<T> {
  return { label: 'Native Open', input: 'shortcut', limitMs: 5_000, barrier: async () => undefined, trigger: async () => undefined, ...overrides };
}

test('arm, prepare, barrier and trigger run in that order and the armed value is returned', async () => {
  const calls: string[] = [];
  let release!: (value: string) => void;
  const result = await armBarrierTrigger(steps({
    arm: () => { calls.push('arm'); return new Promise<string>(resolve => { release = resolve; }); },
    prepare: async left => { await tick(); calls.push(`prepare:${left() <= 5_000 && left() > 4_000}`); },
    barrier: async () => { await tick(); calls.push('barrier'); },
    trigger: async () => { calls.push('trigger'); release('event-after-trigger'); },
  }));
  assert.deepEqual(calls, ['arm', 'prepare:true', 'barrier', 'trigger']);
  assert.equal(result, 'event-after-trigger');
});

test('a wait that ends during preparation is refused by name at once; the input is never sent', { timeout: 3_000 }, async () => {
  const calls: string[] = [], timeout = new Error('waiter timed out');
  const refusal = await armBarrierTrigger(steps({
    arm: async () => { await after(20); calls.push('wait-ended'); throw timeout; },
    prepare: async () => { await after(150); calls.push('prepare-done'); },
    trigger: async () => { calls.push('trigger'); },
  })).then(() => assert.fail('must refuse'), (error: unknown) => { calls.push('refused'); return error; });
  named(/^Native Open: the wait for the event ended \(waiter timed out\) during prepare after \d+ ms; shortcut not sent$/)(refusal);
  assert.equal((refusal as Error).cause, timeout);
  await after(200);
  // Refused when the wait ended, not when the preparation finished; the trigger is never called.
  assert.deepEqual(calls, ['wait-ended', 'refused', 'prepare-done']);
});

test('a hanging barrier is refused within the limit; the input is never sent', { timeout: 3_000 }, async () => {
  let triggered = false;
  const started = performance.now();
  await assert.rejects(armBarrierTrigger(steps({ limitMs: 50, arm: hang, barrier: hang, trigger: async () => { triggered = true; } })),
    named(/^Native Open: the limit of 50 ms passed during barrier after \d+ ms; shortcut not sent$/));
  assert.ok(performance.now() - started < 1_000); assert.equal(triggered, false);
});

test('a hanging trigger is refused within the limit and says the input was sent', { timeout: 3_000 }, async () => {
  const started = performance.now();
  await assert.rejects(armBarrierTrigger(steps({ limitMs: 50, arm: hang, trigger: hang })),
    named(/^Native Open: the limit of 50 ms passed during trigger after \d+ ms; shortcut was sent$/));
  assert.ok(performance.now() - started < 1_000);
});

test('an event that arrives before the input is refused; the input is never sent', { timeout: 3_000 }, async () => {
  let triggered = false;
  await assert.rejects(armBarrierTrigger(steps({ arm: async () => 'unrelated chooser', barrier: () => after(30), trigger: async () => { triggered = true; } })),
    named(/^Native Open: the event arrived before the input during barrier after \d+ ms; shortcut not sent$/));
  assert.equal(triggered, false);
});

test('an event already there when the round trip returns at once is refused, not returned', { timeout: 3_000 }, async () => {
  let triggered = false;
  await assert.rejects(armBarrierTrigger(steps({ arm: () => Promise.resolve('foreign chooser'), barrier: () => Promise.resolve(), trigger: async () => { triggered = true; } })),
    named(/^Native Open: the event arrived before the input during \w+ after \d+ ms; shortcut not sent$/));
  assert.equal(triggered, false);
});

test('a wait that ends right after the round trip resolves stops the input', { timeout: 3_000 }, async () => {
  const calls: string[] = [];
  let fail!: (error: Error) => void;
  await assert.rejects(armBarrierTrigger(steps({
    arm: () => new Promise<never>((_, reject) => { fail = reject; }),
    barrier: () => { const resolved = Promise.resolve(); calls.push('barrier-resolved'); void resolved.then(() => { calls.push('wait-ended'); fail(new Error('timed out')); }); return resolved; },
    trigger: async () => { calls.push('trigger'); },
  })), named(/^Native Open: the wait for the event ended \(timed out\) during \w+ after \d+ ms; shortcut not sent$/));
  assert.deepEqual(calls, ['barrier-resolved', 'wait-ended']);
});

test('a wait that ends several microtasks after the round trip still stops the input', { timeout: 3_000 }, async () => {
  const calls: string[] = [];
  let fail!: (error: Error) => void;
  await assert.rejects(armBarrierTrigger(steps({
    arm: () => new Promise<never>((_, reject) => { fail = reject; }),
    barrier: () => {
      void (async () => { for (let turn = 0; turn < 8; turn++) await null; calls.push('wait-ended'); fail(new Error('timed out')); })();
      return Promise.resolve();
    },
    trigger: async () => { calls.push('trigger'); },
  })), named(/the wait for the event ended \(timed out\) during \w+ after \d+ ms; shortcut not sent$/));
  assert.deepEqual(calls, ['wait-ended']);
});

/** A clock the test moves; the real limit timer (5 s) never fires in these tests. */
function manualClock(): { now: () => number; advance(ms: number): void } {
  let time = 1_000;
  return { now: () => time, advance: ms => { time += ms; } };
}

test('a round trip that returns after the limit, before the limit timer could fire, stops the input', { timeout: 3_000 }, async () => {
  const clock = manualClock();
  let triggered = false;
  await assert.rejects(armBarrierTrigger(steps({ limitMs: 30, now: clock.now, arm: hang,
    barrier: async () => { clock.advance(92); }, trigger: async () => { triggered = true; } })),
  named(/^Native Open: the limit of 30 ms passed during trigger after 92 ms; shortcut not sent$/));
  assert.equal(triggered, false);
});

test('an event observed after the limit is refused, not returned', { timeout: 3_000 }, async () => {
  const clock = manualClock();
  let emit!: (value: string) => void;
  await assert.rejects(armBarrierTrigger(steps({ limitMs: 30, now: clock.now, arm: () => new Promise<string>(resolve => { emit = resolve; }),
    trigger: async () => { clock.advance(45); emit('late chooser'); } })),
  named(/^Native Open: the event arrived after the limit of 30 ms \(at 45 ms\) during event after 45 ms; shortcut was sent$/));
});

test('no event after the input is named with the wait\'s own error as cause', { timeout: 3_000 }, async () => {
  const timeout = new Error('Timeout 40ms exceeded while waiting for event "filechooser"\n  call log');
  await assert.rejects(armBarrierTrigger(steps({ arm: async () => { await after(40); throw timeout; } })), error => {
    named(/^Native Open: no event arrived \(Timeout 40ms exceeded while waiting for event "filechooser"\) during event after \d+ ms; shortcut was sent$/)(error);
    assert.equal((error as Error).cause, timeout); return true;
  });
});

test('a barrier refusal stops before the trigger; the abandoned waiter rejects without an unhandled rejection', async () => {
  const unhandled: unknown[] = [], onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    let fail!: (error: Error) => void, triggered = false;
    const refusal = new RuntimeError('transfer_invalid', 'independently assigned barrier refusal');
    await assert.rejects(armBarrierTrigger(steps({
      arm: () => new Promise<never>((_, reject) => { fail = reject; }),
      barrier: async () => { throw refusal; },
      trigger: async () => { triggered = true; },
    })), error => error === refusal);
    assert.equal(triggered, false);
    fail(new Error('waiter timed out later')); // as Playwright's waiter does after its own timeout
    await tick(); await tick();
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); }
});

/** A page stand-in that records the calls the Open sequence makes, with a fixed focus answer. */
function recordingPage(focus: { inside: boolean; active: string | null }) {
  const calls: string[] = [];
  let emit: ((value: unknown) => void) | undefined;
  const page = {
    waitForEvent: (event: string, options: { timeout: number }) => { calls.push(`waitForEvent:${event}:${options.timeout}`); return new Promise(resolve => { emit = resolve; }); },
    locator: (selector: string) => ({ first: () => ({ click: async (options: { position: { x: number; y: number }; timeout: number }) => { await tick(); calls.push(`click:${selector}:${options.position.x},${options.position.y}:${options.timeout <= 7_000}`); } }) }),
    evaluate: async (_fn: unknown, selector: unknown) => { calls.push(`evaluate-start:${String(selector)}`); await tick(); calls.push('evaluate-end'); return focus; },
    keyboard: { press: async (key: string) => { calls.push(`press:${key}`); emit?.({ chooser: 'stand-in' }); } },
  };
  return { page: page as unknown as NativeOpenPage, calls };
}

test('native Open: waiter before the click, focus round trip completed before the shortcut, one limit', async () => {
  const { page, calls } = recordingPage({ inside: true, active: 'div' });
  const chooser = await openNativeFileChooser(page, { container: '.excalidraw', position: { x: 1300, y: 800 }, shortcut: 'Control+o', limitMs: 7_000 });
  assert.deepEqual(chooser, { chooser: 'stand-in' });
  assert.deepEqual(calls, ['waitForEvent:filechooser:7000', 'click:.excalidraw:1300,800:true', 'evaluate-start:.excalidraw', 'evaluate-end', 'press:Control+o']);
});

test('native Open: focus outside the editor is refused by name and the shortcut is never sent', async () => {
  const { page, calls } = recordingPage({ inside: false, active: 'button#elsewhere' });
  await assert.rejects(openNativeFileChooser(page, { container: '.excalidraw', position: { x: 1300, y: 800 }, shortcut: 'Meta+o', limitMs: 7_000 }),
    named(/keyboard focus is on button#elsewhere, outside the editor \(\.excalidraw\)/));
  assert.equal(calls.some(call => call.startsWith('press:')), false);
});

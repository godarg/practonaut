// Arm, barrier, trigger (issue #45): the order of the steps, refusal before the trigger, and that a
// waiter left behind by a refusal never becomes an unhandled rejection. The real-browser ordering of
// `nativeFileTransfer` is checked in tests/integration/transfer.test.ts through the launch seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { armBarrierTrigger, openNativeFileChooser, type NativeOpenPage } from '../../src/evaluation/native-trigger.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';

const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('arm, prepare, barrier and trigger run in that order and the armed value is returned', async () => {
  const calls: string[] = [];
  let release!: (value: string) => void;
  const result = await armBarrierTrigger({
    arm: () => { calls.push('arm'); return new Promise<string>(resolve => { release = resolve; }); },
    prepare: async () => { await tick(); calls.push('prepare'); },
    barrier: async () => { await tick(); calls.push('barrier'); },
    trigger: async () => { calls.push('trigger'); release('event-after-trigger'); },
  });
  assert.deepEqual(calls, ['arm', 'prepare', 'barrier', 'trigger']);
  assert.equal(result, 'event-after-trigger');
});

test('a barrier refusal stops before the trigger; the abandoned waiter rejects without an unhandled rejection', async () => {
  const unhandled: unknown[] = [], onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
  process.on('unhandledRejection', onUnhandled);
  try {
    let fail!: (error: Error) => void, triggered = false;
    const refusal = new RuntimeError('transfer_invalid', 'independently assigned barrier refusal');
    await assert.rejects(armBarrierTrigger({
      arm: () => new Promise<never>((_, reject) => { fail = reject; }),
      barrier: async () => { throw refusal; },
      trigger: async () => { triggered = true; },
    }), error => error === refusal);
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
    locator: (selector: string) => ({ first: () => ({ click: async (options: { position: { x: number; y: number } }) => { await tick(); calls.push(`click:${selector}:${options.position.x},${options.position.y}`); } }) }),
    evaluate: async (_fn: unknown, selector: unknown) => { calls.push(`evaluate-start:${String(selector)}`); await tick(); calls.push('evaluate-end'); return focus; },
    keyboard: { press: async (key: string) => { calls.push(`press:${key}`); emit?.({ chooser: 'stand-in' }); } },
  };
  return { page: page as unknown as NativeOpenPage, calls };
}

test('native Open: waiter before the click, focus round trip completed before the shortcut', async () => {
  const { page, calls } = recordingPage({ inside: true, active: 'div' });
  const chooser = await openNativeFileChooser(page, { container: '.excalidraw', position: { x: 1300, y: 800 }, shortcut: 'Control+o', timeout: () => 7_000 });
  assert.deepEqual(chooser, { chooser: 'stand-in' });
  assert.deepEqual(calls, ['waitForEvent:filechooser:7000', 'click:.excalidraw:1300,800', 'evaluate-start:.excalidraw', 'evaluate-end', 'press:Control+o']);
});

test('native Open: focus outside the editor is refused by name and the shortcut is never sent', async () => {
  const { page, calls } = recordingPage({ inside: false, active: 'button#elsewhere' });
  await assert.rejects(openNativeFileChooser(page, { container: '.excalidraw', position: { x: 1300, y: 800 }, shortcut: 'Meta+o', timeout: () => 7_000 }), error => {
    assert.ok(error instanceof RuntimeError); assert.equal(error.code, 'transfer_invalid');
    assert.match(error.message, /keyboard focus is on button#elsewhere, outside the editor \(\.excalidraw\)/); return true;
  });
  assert.equal(calls.some(call => call.startsWith('press:')), false);
});

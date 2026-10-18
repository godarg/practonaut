import type { FileChooser, Page } from 'playwright-core';
import { RuntimeError } from '../cli/runtime.ts';

/**
 * Arm, barrier, trigger: the ordering contract for a browser event that page input causes (issue #45).
 *
 * Playwright turns on Chromium's file-chooser interception (`Page.setInterceptFileChooserDialog`) when
 * the first `filechooser` listener is added, and does not wait for it. The measurements are consistent
 * with this: when the renderer is busy, an input sent right after that command can be handled before
 * the interception takes effect, the page opens a chooser that is not intercepted, headless Chromium
 * cancels it without a trace, and the awaited event never arrives (docs/testing.md, "Native Open
 * ordering").
 *
 * So the waiter is created first (arm), then any preparation runs, then one page round trip completes
 * after it (barrier), and only then is the input sent (trigger). The whole sequence, from arming to
 * the event, shares one time limit. The input is never sent once the wait has ended or the event has
 * already arrived, and every refusal is a named `transfer_invalid` that says in which phase it
 * happened and whether the input was sent.
 */
export interface ArmBarrierTriggerSteps<T> {
  /** Name of the step and of its input in refusals, for example `Native Open` and `shortcut`. */
  label: string; input: string;
  /** One limit for the whole sequence, from arming until the event, in milliseconds. */
  limitMs: number;
  arm(): Promise<T>;
  /** `left()` is the time still available under the limit, for the operation's own timeout. */
  prepare?(left: () => number): Promise<void>;
  barrier(left: () => number): Promise<void>;
  trigger(left: () => number): Promise<void>;
}
type Phase = 'prepare' | 'barrier' | 'trigger' | 'event';
type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
const firstLine = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split('\n')[0]!;

export async function armBarrierTrigger<T>(steps: ArmBarrierTriggerSteps<T>): Promise<T> {
  const start = performance.now();
  const left = (): number => Math.max(1, Math.floor(steps.limitMs - (performance.now() - start)));
  let phase: Phase = 'prepare', sent = false, outcome: Outcome<T> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const refuse = (why: string, cause?: unknown): RuntimeError => {
    const error = new RuntimeError('transfer_invalid', `${steps.label}: ${why} during ${phase} after ${Math.round(performance.now() - start)} ms; ${steps.input} ${sent ? 'was sent' : 'not sent'}`);
    if (cause !== undefined) error.cause = cause;
    return error;
  };
  // The waiter is observed from here on, so a refusal before the trigger never leaves it unhandled.
  const waiter: Promise<Outcome<T>> = steps.arm().then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  void waiter.then(value => { outcome = value; });
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(refuse(`the limit of ${steps.limitMs} ms passed`)), steps.limitMs); });
  limit.catch(() => undefined);
  // Before the input: the wait ending, or an event the input did not cause, interrupts at once.
  const interrupted = waiter.then(value => {
    if (!value.ok) throw refuse(`the wait for the event ended (${firstLine(value.error)})`, value.error);
    if (!sent) throw refuse('the event arrived before the input');
    return new Promise<never>(() => undefined);
  });
  interrupted.catch(() => undefined);
  const guard = <R>(operation: Promise<R>): Promise<R> => Promise.race([operation, limit, interrupted]);
  try {
    if (steps.prepare) await guard(steps.prepare(left));
    phase = 'barrier'; await guard(steps.barrier(left));
    phase = 'trigger';
    if (outcome) throw outcome.ok ? refuse('the event arrived before the input') : refuse(`the wait for the event ended (${firstLine(outcome.error)})`, outcome.error);
    sent = true; await guard(steps.trigger(left));
    phase = 'event';
    const result = await Promise.race([waiter, limit]);
    if (!result.ok) throw refuse(`no event arrived (${firstLine(result.error)})`, result.error);
    return result.value;
  } finally { clearTimeout(timer); }
}

/** Where keyboard focus is, as one page round trip. `inside` when it is the container or within it. */
export interface KeyboardFocus { inside: boolean; active: string | null }
export async function keyboardFocus(page: Pick<Page, 'evaluate'>, container: string): Promise<KeyboardFocus> {
  return page.evaluate(selector => {
    const root = document.querySelector(selector), active = document.activeElement;
    const name = active ? active.tagName.toLowerCase() + (active.id ? `#${active.id}` : '') : null;
    return { inside: !!root && !!active && root.contains(active), active: name };
  }, container);
}

export type NativeOpenPage = Pick<Page, 'waitForEvent' | 'locator' | 'evaluate' | 'keyboard'>;
/**
 * Native Open through the editor's own shortcut: arm the `filechooser` waiter, click the editor surface,
 * assert in one round trip that keyboard focus is inside the editor container (else `transfer_invalid`
 * at once, instead of a lost shortcut and a timeout), then press the shortcut. Click, round trip,
 * shortcut and the event share one limit, `limitMs`, counted from arming.
 */
export async function openNativeFileChooser(page: NativeOpenPage, input: {
  container: string; position: { x: number; y: number }; shortcut: string; limitMs: number;
}): Promise<FileChooser> {
  return armBarrierTrigger({
    label: 'Native Open', input: 'shortcut', limitMs: input.limitMs,
    arm: () => page.waitForEvent('filechooser', { timeout: input.limitMs }),
    prepare: left => page.locator(input.container).first().click({ position: input.position, timeout: left() }),
    barrier: async () => {
      const focus = await keyboardFocus(page, input.container);
      if (!focus.inside) throw new RuntimeError('transfer_invalid', `Native Open shortcut not sent: keyboard focus is on ${focus.active ?? 'no element'}, outside the editor (${input.container})`);
    },
    trigger: () => page.keyboard.press(input.shortcut),
  });
}

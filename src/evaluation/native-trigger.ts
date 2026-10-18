import type { FileChooser, Page } from 'playwright-core';
import { RuntimeError } from '../cli/runtime.ts';

/**
 * Arm, barrier, trigger: the ordering contract for a browser event that page input causes (issue #45).
 *
 * Playwright turns on Chromium's file-chooser interception (`Page.setInterceptFileChooserDialog`) when
 * the first `filechooser` listener is added, and does not wait for it. When the renderer is busy, an
 * input sent right after that command can be handled before the interception takes effect: the page
 * opens a chooser that is not intercepted, headless Chromium cancels it without a trace, and the
 * awaited event never arrives (measurements in docs/testing.md, "Native Open ordering").
 *
 * So the waiter is created first (arm), then any preparation runs, then one page round trip completes
 * after it (barrier), and only then is the input sent (trigger). The barrier may refuse by name when
 * the trigger would be lost anyway.
 */
export async function armBarrierTrigger<T>(steps: {
  arm(): Promise<T>; prepare?(): Promise<void>; barrier(): Promise<void>; trigger(): Promise<void>;
}): Promise<T> {
  const armed = steps.arm();
  // A failure before the trigger leaves the waiter to its own timeout or to page close; observed here,
  // still rejected to the caller below when the sequence gets that far.
  armed.catch(() => undefined);
  if (steps.prepare) await steps.prepare();
  await steps.barrier();
  await steps.trigger();
  return await armed;
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
 * at once, instead of a lost shortcut and a timeout), then press the shortcut.
 */
export async function openNativeFileChooser(page: NativeOpenPage, input: {
  container: string; position: { x: number; y: number }; shortcut: string; timeout(): number;
}): Promise<FileChooser> {
  return armBarrierTrigger({
    arm: () => page.waitForEvent('filechooser', { timeout: input.timeout() }),
    prepare: () => page.locator(input.container).first().click({ position: input.position, timeout: input.timeout() }),
    barrier: async () => {
      const focus = await keyboardFocus(page, input.container);
      if (!focus.inside) throw new RuntimeError('transfer_invalid', `Native Open shortcut not sent: keyboard focus is on ${focus.active ?? 'no element'}, outside the editor (${input.container})`);
    },
    trigger: () => page.keyboard.press(input.shortcut),
  });
}

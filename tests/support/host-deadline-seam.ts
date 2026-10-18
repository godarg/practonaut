// Test-only preload for `tools/amplify-host-deadline.ts` (issue #64, docs/testing.md "Host deadline
// tests"). The amplifier starts `node --test` with `--import` of this file; it is in no test command.
//
// It patches `chromium.launch` of playwright-core — the module object the browser shell imports — so
// the real tests and the real product code run unchanged, and, as the environment asks:
//   PN_AMPLIFY_RECORD      JSON lines file: one `close-start` and one `close-end` row per real
//                          `browser.close()` (its own duration, whatever bound the caller put on it)
//   PN_AMPLIFY_CPU         renderer CPU throttling rate (`Emulation.setCPUThrottlingRate`), switched on
//                          after the adapter's first scene write, so the engine's own start is not slowed
//   PN_AMPLIFY_BLOCK_MS    blocks this process's event loop for that long, again and again, with a
//                          1 ms gap between blocks
//   PN_AMPLIFY_CLOSE_HOLD_MS  holds every `browser.close()` that long before the real close starts
//                          (stands in for a browser that is slow to close; nothing else is changed)
import { appendFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const setting = (name: string): number => {
  const value = Number(process.env[name] ?? 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a number of at least 0`);
  return value;
};
const record = process.env.PN_AMPLIFY_RECORD, cpu = setting('PN_AMPLIFY_CPU'), blockMs = setting('PN_AMPLIFY_BLOCK_MS'), holdMs = setting('PN_AMPLIFY_CLOSE_HOLD_MS');
let browsers = 0;
const write = (row: Record<string, unknown>): void => { if (record) appendFileSync(record, JSON.stringify({ ...row, at: Math.round(performance.now()) }) + '\n'); };

function throttleAfterFirstWrite(page: Page, context: BrowserContext): void {
  if (cpu <= 1) return;
  const original = page.evaluate.bind(page) as (...args: unknown[]) => Promise<unknown>;
  let on = false;
  (page as unknown as { evaluate: (...args: unknown[]) => Promise<unknown> }).evaluate = async (...args: unknown[]) => {
    const result = await original(...args);
    if (!on && typeof args[0] === 'string' && args[0].includes('window.__pn.write')) {
      on = true;
      try { await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpu }); write({ event: 'throttled', rate: cpu }); }
      catch (error) { write({ event: 'throttle-failed', error: String(error).slice(0, 200) }); }
    }
    return result;
  };
}

function observe(browser: Browser): Browser {
  const id = ++browsers;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (async (...args: Parameters<Browser['newContext']>) => {
    const context = await newContext(...args);
    context.on('page', page => throttleAfterFirstWrite(page, context));
    return context;
  }) as Browser['newContext'];
  const close = browser.close.bind(browser);
  browser.close = (async (...args: Parameters<Browser['close']>) => {
    const started = performance.now();
    write({ event: 'close-start', browser: id, holdMs });
    try {
      if (holdMs > 0) await new Promise(done => setTimeout(done, holdMs));
      await close(...args);
      write({ event: 'close-end', browser: id, ok: true, ms: Math.round(performance.now() - started) });
    } catch (error) {
      write({ event: 'close-end', browser: id, ok: false, ms: Math.round(performance.now() - started), error: String(error).slice(0, 200) });
      throw error;
    }
  }) as Browser['close'];
  return browser;
}

const target = chromium as unknown as { launch: typeof chromium.launch };
const launch = target.launch.bind(chromium);
target.launch = (async (...args: Parameters<typeof chromium.launch>) => observe(await launch(...args))) as typeof chromium.launch;

if (blockMs > 0) {
  const block = (): void => { const end = performance.now() + blockMs; while (performance.now() < end) { /* busy */ } setTimeout(block, 1).unref(); };
  setTimeout(block, 1).unref();
}

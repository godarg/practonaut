// Test preload for the real-CLI close tests (PADR-0050, decision 10). For the mirror's browser — the
// one launched with the shell's sink proxy; the start check's closes as usual — it reports the
// browser's process id from CDP, and it holds that browser's close until the file named in
// PN_CLOSE_GATE exists: the test stops the browser's process group first, so no graceful close can
// finish. The product's ledger has already read the connection when the close is asked. A call of
// `process.exit` is reported on stderr before it happens.
import { existsSync, writeSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

const gate = process.env.PN_CLOSE_GATE ?? '';
const say = (text: string): void => { writeSync(2, `[close-stall] ${text}\n`); };
const launch = chromium.launch.bind(chromium);
chromium.launch = (async (options?: Parameters<typeof chromium.launch>[0]): Promise<Browser> => {
  const browser = await launch(options);
  if (!options?.proxy) return browser;
  const session = await browser.newBrowserCDPSession();
  const info = await session.send('SystemInfo.getProcessInfo') as { processInfo: Array<{ type: string; id: number }> };
  await session.detach();
  say(`browser-pid=${info.processInfo.find(entry => entry.type === 'browser')?.id ?? 'unknown'}`);
  const close = browser.close.bind(browser);
  browser.close = (async (...args: Parameters<Browser['close']>) => {
    say('closing');
    while (!existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 10));
    return close(...args);
  }) as Browser['close'];
  return browser;
}) as typeof chromium.launch;

const exit = process.exit.bind(process);
process.exit = ((code?: number) => { say(`process.exit(${String(code)})`); return exit(code); }) as typeof process.exit;

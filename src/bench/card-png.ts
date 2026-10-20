/**
 * The card's PNG (report --card): the same SVG, drawn by the headless Chromium Practonaut already uses
 * for its mirror and started the one way it is started everywhere (PADR-0032: sandbox first; on Linux
 * once without it when the system refuses the sandbox, which the caller says). The page loads nothing
 * but the card: JavaScript is off, every other request is aborted by the page's own route before it
 * leaves the browser (`blockedbyclient`), the viewport is 1280 × 640 at device scale 1. The PNG is
 * Chromium's screenshot of it; on one machine the same SVG gives the same bytes
 * (tests/integration/bench-card.test.ts), across machines the system font can differ.
 */
import { closeAfterFailure, closeStep, withClose } from '../adapters/browser/close.ts';
import { startBrowser, type BrowserLedger, type ChromiumLauncher } from '../adapters/browser/ledger.ts';
import { CARD_SIZE } from './card.ts';

/** Never resolved: the request is answered by the route below before anything reaches a network. */
export const CARD_URL = 'https://card.invalid/card.svg';

export interface CardPngOptions {
  timeoutMs?: number;
  /** The browser type to launch (default: Playwright's Chromium); tests pass one that observes requests. */
  chromium?: ChromiumLauncher;
  /** Test seam: a ledger of the test's own (default: the process's, PADR-0050). */
  ledger?: BrowserLedger;
}

export async function renderCardPngs(svgs: readonly string[], options: CardPngOptions = {}): Promise<{ pngs: Buffer[]; sandbox: boolean }> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const chromium = options.chromium ?? (await import('playwright-core')).chromium;
  const { browser, sandbox, lease } = await startBrowser('report-card', chromium, () => ({ headless: true, timeout: timeoutMs, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }), { ledger: options.ledger });
  // Every close runs under the close contract (PADR-0050). Each picture's context closes within its
  // deadline: one that is abandoned neither holds the command nor discards the pictures already taken,
  // and the browser's one close ends it. After a failure each close is kept next to that failure and
  // never replaces it (issue #64); after the pictures, the browser's close does not discard them.
  const pngs: Buffer[] = [];
  try {
    for (const svg of svgs) {
      const context = await browser.newContext({ viewport: { ...CARD_SIZE }, deviceScaleFactor: 1, javaScriptEnabled: false, serviceWorkers: 'block', reducedMotion: 'reduce' });
      await withClose(async () => {
        await context.route('**/*', route => route.request().url() === CARD_URL ? route.fulfill({ status: 200, contentType: 'image/svg+xml; charset=utf-8', body: svg }) : route.abort('blockedbyclient'));
        const page = await context.newPage();
        await page.goto(CARD_URL, { waitUntil: 'load', timeout: timeoutMs });
        pngs.push(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...CARD_SIZE }, animations: 'disabled', caret: 'hide', timeout: timeoutMs }));
      }, deadline => closeStep(() => context.close(), deadline));
    }
  } catch (failure) { throw await closeAfterFailure(failure, deadline => lease.close(deadline)); }
  await lease.close();
  return { pngs, sandbox };
}

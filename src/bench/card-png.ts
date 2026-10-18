/**
 * The card's PNG (report --card): the same SVG, drawn by the headless Chromium Practonaut already uses
 * for its mirror and started the one way it is started everywhere (PADR-0032: sandbox first; on Linux
 * once without it when the system refuses the sandbox, which the caller says). The page loads nothing
 * but the card: JavaScript is off, every other request is aborted by the page's own route before it
 * leaves the browser (`blockedbyclient`), the viewport is 1280 × 640 at device scale 1. The PNG is
 * Chromium's screenshot of it; on one machine the same SVG gives the same bytes
 * (tests/integration/bench-card.test.ts), across machines the system font can differ.
 */
import type { Browser, LaunchOptions } from 'playwright-core';
import { launchChromium } from '../adapters/browser/chromium.ts';
import { withClose } from '../adapters/browser/bounded.ts';
import { CARD_SIZE } from './card.ts';

/** Never resolved: the request is answered by the route below before anything reaches a network. */
export const CARD_URL = 'https://card.invalid/card.svg';

export interface CardPngOptions {
  timeoutMs?: number;
  /** The browser type to launch (default: Playwright's Chromium); tests pass one that observes requests. */
  chromium?: { launch(options?: LaunchOptions): Promise<Browser> };
}

export async function renderCardPngs(svgs: readonly string[], options: CardPngOptions = {}): Promise<{ pngs: Buffer[]; sandbox: boolean }> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const chromium = options.chromium ?? (await import('playwright-core')).chromium;
  const { browser, sandbox } = await launchChromium(chromium, () => ({ headless: true, timeout: timeoutMs, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }));
  // After a failure each close has the close bound and never replaces that failure (issue #64); after
  // the pictures, the browser's close runs as before and its failure is ignored, as before.
  return withClose(async () => {
    const pngs: Buffer[] = [];
    for (const svg of svgs) {
      const context = await browser.newContext({ viewport: { ...CARD_SIZE }, deviceScaleFactor: 1, javaScriptEnabled: false, serviceWorkers: 'block', reducedMotion: 'reduce' });
      await withClose(async () => {
        await context.route('**/*', route => route.request().url() === CARD_URL ? route.fulfill({ status: 200, contentType: 'image/svg+xml; charset=utf-8', body: svg }) : route.abort('blockedbyclient'));
        const page = await context.newPage();
        await page.goto(CARD_URL, { waitUntil: 'load', timeout: timeoutMs });
        pngs.push(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...CARD_SIZE }, animations: 'disabled', caret: 'hide', timeout: timeoutMs }));
      }, () => context.close());
    }
    return { pngs, sandbox };
  }, () => browser.close().catch(() => {}));
}

// Test-driven browsers start the way the product starts its mirror (src/adapters/browser/chromium.ts):
// sandbox first, on Linux once without it when the system refuses the sandbox (PADR-0032).
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';
import { launchChromium } from '../../src/adapters/browser/chromium.ts';

export async function launchBrowser(options: LaunchOptions = {}): Promise<Browser> {
  return (await launchChromium(chromium, () => options)).browser;
}

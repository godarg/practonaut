// Test preload (PADR-0050 on draw.io): what a real CLI process did with its browsers. Every Playwright
// launch is recorded with whether it had the shell's sink as its proxy (the mirror's browser) and how
// it asked for the sandbox; at the process's exit the launches and the process ledger's records are
// written as JSON to the file named in PN_LEDGER_REPORT. It changes nothing the command does.
import { writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { processLedger } from '../../src/adapters/browser/ledger.ts';

const file = process.env.PN_LEDGER_REPORT ?? '';
const launches: Array<{ proxy: boolean; chromiumSandbox: boolean | undefined }> = [];
const launch = chromium.launch.bind(chromium);
chromium.launch = (async (options?: Parameters<typeof chromium.launch>[0]): Promise<Browser> => {
  launches.push({ proxy: options?.proxy !== undefined, chromiumSandbox: options?.chromiumSandbox });
  return launch(options);
}) as typeof chromium.launch;
process.on('exit', () => { if (file) writeFileSync(file, JSON.stringify({ launches, records: processLedger.records() })); });

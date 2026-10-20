// Test preload: every mirror start finds the process's browser budget full and is refused by name
// (PADR-0050, decision 4), while the start check succeeds on a stand-in browser. Nothing is launched:
// a bench with `--mirror required` then loses each run to the budget.
import { chromium, type Browser } from 'playwright-core';
import { BrowserBudgetError, processLedger } from '../../src/adapters/browser/ledger.ts';

const reserve = processLedger.reserve.bind(processLedger);
processLedger.reserve = (owner, options) => owner === 'mirror' ? Promise.reject(new BrowserBudgetError({ running: 6, closing: 2 }, processLedger.budget)) : reserve(owner, options);
const target = chromium as unknown as { launch: typeof chromium.launch };
target.launch = (async () => ({ isConnected: () => true, on() { return this; }, close: async () => {} }) as unknown as Browser) as typeof chromium.launch;

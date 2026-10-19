// Test preload: the process's browser budget is full and stays full past the launch bound, so every
// browser start is refused by name at once (PADR-0050, decision 4). No browser is launched.
import { BrowserBudgetError, processLedger } from '../../src/adapters/browser/ledger.ts';

processLedger.reserve = () => Promise.reject(new BrowserBudgetError({ running: 5, closing: 3 }, processLedger.budget));

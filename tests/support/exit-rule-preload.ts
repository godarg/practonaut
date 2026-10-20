// Test preload for the 35 s rule (PADR-0050, decision 9) in a real CLI process. Before the command
// runs it puts one entry into the process ledger: Codex's combined path — a close that fulfilled after
// the connection dropped, its child still alive, so no proof and the slot held until the process
// exits. Its close request is dated 40 s back, so the rule fires as soon as the command's shutdown has
// finished. A referenced timer stands for Playwright's pipes and close timer: Node cannot exit by
// itself. `process.exit` reports when it was called and which session credentials still existed.
import { readdirSync } from 'node:fs';

import type { Browser } from 'playwright-core';
import { processLedger } from '../../src/adapters/browser/ledger.ts';

const browser = { connected: true, isConnected() { return this.connected; }, on() { return this; }, close: async () => {} };
const lease = processLedger.tryReserve('mirror')!;
await lease.launch(() => Promise.resolve({ browser: browser as unknown as Browser, sandbox: true }));
browser.connected = false; // Chromium closed its end; its process is not known to have ended.
const now = performance.now.bind(performance);
performance.now = () => now() - 40_000;
try { await lease.close(); } finally { performance.now = now; }

const alive = setInterval(() => {}, 60_000);
const exit = process.exit.bind(process);
process.exit = ((code?: number) => {
  clearInterval(alive);
  let tokens = 0;
  // Every session credential anywhere under the home: the session hosts' and every bench run's (`<bench folder>/<run>/host`).
  try { tokens = readdirSync(process.env.PRACTONAUT_HOME ?? '', { recursive: true }).filter(name => String(name).endsWith('.token')).length; } catch { /* No home: no credential. */ }
  process.stderr.write(`[exit-rule] process.exit(${String(code)}) tokens=${tokens}\n`, () => exit(code));
  return undefined as never;
}) as typeof process.exit;

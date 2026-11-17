// Preloaded into child processes through NODE_OPTIONS by tests/unit/checker-timeout-retry.test.ts: a
// checker process start (`src/checker/main.ts`) as a starved process on a busy machine sees it. Every
// checker start claims the next number in PN_STALL_DIR (start-1, start-2, …; mkdir is atomic); the
// starts listed in PN_STALL_AT then sleep past the checker's 10 s wall limit before the checker runs.
// Any other process, or a process without PN_STALL_DIR, is left alone.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.env.PN_STALL_DIR;
const stalled = new Set((process.env.PN_STALL_AT ?? '').split(',').filter(Boolean).map(Number));
if (directory && /[\\/]checker[\\/]main\.(ts|js)$/.test(process.argv[1] ?? '')) {
  for (let start = 1; start < 10_000; start++) {
    try { mkdirSync(join(directory, `start-${start}`)); } catch { continue; }
    if (stalled.has(start)) await new Promise(resolve => setTimeout(resolve, 12_000));
    break;
  }
}

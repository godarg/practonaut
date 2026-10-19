// PADR-0049 decision 3.6: the adapter starts in 5 fresh processes; the median time from process start
// to the first `load` must stay within 3 s, the Chromium process tree within 1.5 GB and the Node
// process within 1 GB, and no request may be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { drawioAvailability } from '../../support/drawio.ts';
import { descendantCommands, observeSandbox, type SandboxObservation } from '../../support/drawio-run.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const availability = await drawioAvailability();

test('the sandbox observation tells a Chromium started without its sandbox from one started with it', { skip: availability.ok ? (process.platform === 'win32' ? 'not measured on Windows' : false) : availability.skip, timeout: 120_000 }, async () => {
  const observed: Record<string, SandboxObservation | null> = {};
  for (const chromiumSandbox of [false, true]) {
    const browser = await chromium.launch({ chromiumSandbox, headless: true });
    try { await (await browser.newPage()).setContent('<p>observed</p>'); observed[String(chromiumSandbox)] = observeSandbox(null, descendantCommands()); }
    finally { await browser.close(); }
  }
  assert.ok(observed.false && observed.false.processes > 0 && observed.false.noSandbox > 0, JSON.stringify(observed));
  assert.ok(observed.true && observed.true.processes > 0 && observed.true.noSandbox === 0, JSON.stringify(observed));
});

test('five fresh starts: median to the first load within 3 s, Chromium tree within 1.5 GB, Node within 1 GB, nothing refused', { skip: availability.ok ? false : availability.skip, timeout: 600_000 }, () => {
  const starts = Array.from({ length: 5 }, () => {
    const child = spawnSync(process.execPath, ['--import', './tests/support/test-home.ts', 'tests/support/drawio-start.ts'], { cwd: root, encoding: 'utf8', timeout: 120_000, env: process.env });
    assert.equal(child.status, 0, child.stderr.slice(-2000));
    return JSON.parse(child.stdout.trim().split('\n').at(-1)!) as { firstLoadMs: number; nodeRss: number; chromiumTree: number | null; chromium: string | null; sandbox: SandboxObservation | null; refused: string[] };
  });
  const times = starts.map(start => start.firstLoadMs).sort((a, b) => a - b);
  assert.ok(times[2]! <= 3_000, `median ${Math.round(times[2]!)} ms (${times.map(Math.round).join(', ')})`);
  for (const start of starts) {
    assert.deepEqual(start.refused, []);
    // Measured, not assumed (review m2c, runtime-1): Chromium processes ran, and none without its sandbox.
    assert.match(start.chromium ?? '', /^\d+\.\d+\.\d+\.\d+$/);
    if (process.platform !== 'win32') { assert.ok(start.sandbox && start.sandbox.processes > 0, JSON.stringify(start.sandbox)); assert.equal(start.sandbox.noSandbox, 0); }
    assert.ok(start.nodeRss <= 1024 ** 3, `Node peak RSS ${start.nodeRss}`);
    if (start.chromiumTree !== null) assert.ok(start.chromiumTree <= 1.5 * 1024 ** 3, `Chromium tree RSS ${start.chromiumTree}`);
  }
});

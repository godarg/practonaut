// PADR-0049 decision 3.6: the adapter starts in 5 fresh processes; the median time from process start
// to the first `load` must stay within 3 s, the Chromium process tree within 1.5 GB and the Node
// process within 1 GB, and no request may be refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { drawioAvailability } from '../../support/drawio.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const availability = await drawioAvailability();

test('five fresh starts: median to the first load within 3 s, Chromium tree within 1.5 GB, Node within 1 GB, nothing refused', { skip: availability.ok ? false : availability.skip, timeout: 600_000 }, () => {
  const starts = Array.from({ length: 5 }, () => {
    const child = spawnSync(process.execPath, ['--import', './tests/support/test-home.ts', 'tests/support/drawio-start.ts'], { cwd: root, encoding: 'utf8', timeout: 120_000, env: process.env });
    assert.equal(child.status, 0, child.stderr.slice(-2000));
    return JSON.parse(child.stdout.trim().split('\n').at(-1)!) as { firstLoadMs: number; nodeRss: number; chromiumTree: number | null; refused: string[] };
  });
  const times = starts.map(start => start.firstLoadMs).sort((a, b) => a - b);
  assert.ok(times[2]! <= 3_000, `median ${Math.round(times[2]!)} ms (${times.map(Math.round).join(', ')})`);
  for (const start of starts) {
    assert.deepEqual(start.refused, []);
    assert.ok(start.nodeRss <= 1024 ** 3, `Node peak RSS ${start.nodeRss}`);
    if (start.chromiumTree !== null) assert.ok(start.chromiumTree <= 1.5 * 1024 ** 3, `Chromium tree RSS ${start.chromiumTree}`);
  }
});

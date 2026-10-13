import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecorder } from '../../src/adapters/excalidraw/recorder.ts';
import type { RawElement } from '../../src/adapters/excalidraw/raw.ts';
const frame: RawElement = { id: 'f', type: 'frame', isDeleted: false, frameId: null, x: 0, y: 0, width: 1000, height: 600, name: 'Process', boundElements: [] };
const box: RawElement = { id: 'b', type: 'rectangle', isDeleted: false, frameId: 'f', x: 10, y: 20, width: 180, height: 100, boundElements: [] };
for (const hold of [150, 300]) test(`quiet timer cannot close a held pointer gesture (${hold}ms)`, async () => {
  const r = createGestureRecorder(); r.start([frame, box], true);
  // Optional call lets the same negative test expose the actual old quiet split rather
  // than failing merely because the new lifecycle API has not been implemented yet.
  (r as typeof r & { pointerDown?: () => void }).pointerDown?.();
  r.observe([frame, { ...box, x: 50 }]);
  await new Promise(resolve => setTimeout(resolve, hold));
  assert.equal(r.gestures.length, 0, 'held input must remain one unfinished gesture');
  r.observe([frame, { ...box, x: 100 }]);
  const g = r.boundary('pointerup'); assert.ok(g);
  assert.deepEqual(g.events, [{ kind: 'set', id: 'b', field: 'x', before: 10, after: 100 }]);
  assert.equal(g.boundary, 'pointerup'); assert.deepEqual(g.unmodeled, []); r.stop();
});

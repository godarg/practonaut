// The versioned measurement tool's arithmetic and reply reading (roadmap 0.2.0, measurement rules).
// Expected values are computed by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createdIds, position, quantile, replyValue, stats } from '../../tools/measure-agent-surface.ts';

test('quantiles interpolate linearly between ranks; stats round to one decimal', () => {
  assert.equal(quantile([3, 1, 2], 0.5), 2);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  // Ten values 1..10: position 0.9 × 9 = 8.1 → 9 + 0.1 × (10 − 9) = 9.1.
  assert.equal(quantile([10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 0.9), 9.1);
  assert.ok(Number.isNaN(quantile([], 0.5)));
  assert.deepEqual(stats([1.04, 2.06, 3]), { n: 3, median: 2.1, p90: 2.8, max: 3 });
});

test('replies of both surfaces: structured content first, else the text JSON; step, revision and created ids', () => {
  const value = { ok: true, value: { step: 3, revision: 5, created: ['n1'] } };
  assert.deepEqual(replyValue({ structuredContent: value, content: [{ type: 'text', text: '{}' }] }), value);
  assert.deepEqual(replyValue({ content: [{ type: 'text', text: JSON.stringify(value) }] }), value);
  assert.deepEqual(replyValue({ content: [{ type: 'text', text: 'not json' }] }), {});
  // 0.2.0 compact reply and 0.1.0 reply with a nested view.
  assert.deepEqual(position(value.value), { step: 3, revision: 5 });
  assert.deepEqual(position({ view: { step: 4, revision: 6 } }), { step: 4, revision: 6 });
  assert.deepEqual(createdIds(value.value, new Set()), ['n1']);
  assert.deepEqual(createdIds({ view: { state: { objects: { a: {}, b: {}, c: {} } } } }, new Set(['a', 'b'])), ['c']);
});

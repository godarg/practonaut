// Console evidence of a native attempt (issue #45): bounded in count and length, uncaught page errors
// included. Expected values are the literal bounds the evidence promises in docs/testing.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { consoleRecorder } from '../../src/evaluation/console-evidence.ts';

const message = (type: string, text: string) => ({ type: () => type, text: () => text });

test('keeps 200 messages, counts the rest as dropped, cuts each text to 2,000 characters', () => {
  let clock = 1_000;
  const recorder = consoleRecorder(() => clock);
  clock = 1_250; recorder.message(message('info', 'x'.repeat(2_001)));
  for (let index = 1; index < 200; index++) recorder.message(message('log', `message ${index}`));
  recorder.message(message('warning', 'message 200, past the limit'));
  const evidence = recorder.evidence();
  assert.equal(evidence.messages.length, 200);
  assert.equal(evidence.dropped, 1);
  assert.deepEqual(evidence.messages[0], { type: 'info', text: 'x'.repeat(2_000), ms: 250 });
  assert.equal(evidence.messages.at(-1)!.text, 'message 199');
  assert.equal(evidence.messages.some(entry => entry.text.includes('past the limit')), false);
});

test('an uncaught page error is recorded with its name and message', () => {
  const recorder = consoleRecorder(() => 0);
  recorder.pageError(new TypeError('independently assigned page failure'));
  assert.deepEqual(recorder.evidence(), { messages: [{ type: 'pageerror', text: 'TypeError: independently assigned page failure', ms: 0 }], dropped: 0 });
});

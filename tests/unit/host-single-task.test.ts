// A bench host (PADR-0036): its task list holds only the session's own task and a change to another
// task is refused, so a world that holds a held-out set shows an agent only its instance; the
// Player's play and serve keep every task.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeController } from '../../src/host/session.ts';
import { v2Task, v2World } from '../support/world-v2.ts';

test('a bench host publishes only its own task and refuses a change to another; play keeps every task', async () => {
  const world = v2World({ tasks: [v2Task(), { ...v2Task(), id: 'T2' }] });
  const bench = await createPracticeController(world, { taskId: 'T1', mirror: 'off', singleTask: true }, async () => { throw new Error('mirror must not start'); });
  try {
    assert.deepEqual(bench.view().tasks.map(task => task.id), ['T1']);
    const other = await bench.variant({ expectedRevision: bench.view().revision, confirmed: true, taskId: 'T2' });
    assert.equal(other.ok, false); if (!other.ok) assert.equal(other.error.code, 'invalid_request');
    assert.equal(bench.view().task.id, 'T1');
    assert.equal((await bench.variant({ expectedRevision: bench.view().revision, confirmed: true, taskId: 'T1' })).ok, true, 'its own task can be restarted');
  } finally { await bench.close(); }
  const play = await createPracticeController(world, { taskId: 'T1', mirror: 'off' }, async () => { throw new Error('mirror must not start'); });
  try {
    assert.deepEqual(play.view().tasks.map(task => task.id), ['T1', 'T2']);
    assert.equal((await play.variant({ expectedRevision: play.view().revision, confirmed: true, taskId: 'T2' })).ok, true);
  } finally { await play.close(); }
});

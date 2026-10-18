// A bench host (PADR-0036): its task list holds only the session's own task and every variant request
// is refused (another task, a new variant, a restart of its own task), so a world that holds a
// held-out set shows an agent only its instance and the judged session keeps the run's seed; the
// Player's play and serve keep every task and variant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeController } from '../../src/host/session.ts';
import { v2Task, v2World } from '../support/world-v2.ts';

test('a bench host publishes only its own task and refuses every variant request; play keeps every task and variant', async () => {
  const world = v2World({ tasks: [v2Task(), { ...v2Task(), id: 'T2' }] });
  const bench = await createPracticeController(world, { seed: 7, taskId: 'T1', mirror: 'off', singleTask: true }, async () => { throw new Error('mirror must not start'); });
  try {
    assert.deepEqual(bench.view().tasks.map(task => task.id), ['T1']);
    const before = bench.view();
    for (const request of [{ taskId: 'T2' }, {}, { taskId: 'T1' }]) {
      const refused = await bench.variant({ expectedRevision: bench.view().revision, confirmed: true, ...request });
      assert.equal(!refused.ok && refused.error.code, 'invalid_request', JSON.stringify(request));
    }
    assert.deepEqual([bench.view().task.id, bench.view().seed, bench.view().revision, bench.view().attempt], ['T1', 7, before.revision, before.attempt]);
    assert.equal((await bench.reset({ expectedRevision: before.revision, confirmed: true })).ok, true, 'reset stays the way back to the start');
    assert.deepEqual([bench.view().seed, bench.view().attempt], [7, before.attempt + 1]);
  } finally { await bench.close(); }
  const play = await createPracticeController(world, { seed: 7, taskId: 'T1', mirror: 'off' }, async () => { throw new Error('mirror must not start'); });
  try {
    assert.deepEqual(play.view().tasks.map(task => task.id), ['T1', 'T2']);
    assert.equal((await play.variant({ expectedRevision: play.view().revision, confirmed: true, taskId: 'T2' })).ok, true);
    assert.equal(play.view().task.id, 'T2');
    assert.equal((await play.variant({ expectedRevision: play.view().revision, confirmed: true, taskId: 'T1' })).ok, true, 'its own task can be restarted');
  } finally { await play.close(); }
});

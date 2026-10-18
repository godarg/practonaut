// PADR-0045: the host compares the mirror's read-back as the adapter declares. `full` (Excalidraw,
// and every mirror that declares nothing) compares the whole state, tombstones included; `live`
// (an app that keeps no deleted objects, like draw.io) compares live objects only, and is still a
// check: a deleted object the app shows as live is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeController } from '../../src/host/session.ts';
import type { MirrorWorld, PracticeMirror } from '../../src/host/mirror.ts';
import { readBackAgrees, type ReadBackComparison } from '../../src/adapters/registry.ts';
import type { Action, State } from '../../src/world/types.ts';
import { stepV2, v2World } from '../support/world-v2.ts';

/** Hand-written: the core's tombstone for `c` after delete_step (world/2 keeps deleted objects). */
const afterDelete = (start: State): State => ({ objects: { ...structuredClone(start.objects), c: { ...stepV2('c', 'Ship', 700, 300), deleted: true } } });
const live = (state: State): State => ({ objects: Object.fromEntries(Object.entries(state.objects).filter(([, object]) => !object.deleted)) });
const deleteShip: Action = { name: 'delete_step', params: { id: 'c' } };

/** A mirror of an app that keeps no deleted objects; `ignoreDeletes` makes it keep `c` live. */
function appWithoutTombstones(initial: State, readBack: ReadBackComparison | undefined, ignoreDeletes = false): PracticeMirror & { state: State; worlds: MirrorWorld[] } {
  const hold = (state: State, before: State): State => ignoreDeletes ? { objects: { ...live(state).objects, ...Object.fromEntries(Object.entries(before.objects).filter(([id, o]) => !o.deleted && state.objects[id]?.deleted)) } } : live(state);
  const mirror = {
    state: live(initial), worlds: [] as MirrorWorld[],
    async apply(transition: { before: State; after: State }) { this.state = hold(transition.after, transition.before); return { ok: true as const, state: structuredClone(this.state), warnings: [] }; },
    async replace(state: State) { this.state = live(state); return { ok: true as const, state: structuredClone(this.state), warnings: [] }; },
    async recover(state: State) { this.state = live(state); },
    async snapshot() { return structuredClone(this.state); }, async png() { return new Uint8Array([137, 80, 78, 71]); }, async close() {},
    ...(readBack ? { readBack } : {}),
  };
  return mirror;
}

test('read-back comparison: full includes tombstones, live compares live objects only', () => {
  const start = v2World().initialState, deleted = afterDelete(start);
  assert.equal(readBackAgrees('full', deleted, deleted), true);
  assert.equal(readBackAgrees('full', live(deleted), deleted), false, 'a missing tombstone is a difference under full');
  assert.equal(readBackAgrees('live', live(deleted), deleted), true, 'the app holds no tombstones under live');
  assert.equal(readBackAgrees('live', start, deleted), false, 'a deleted object shown live is a difference under live');
  const moved = structuredClone(live(deleted)); (moved.objects.a as ReturnType<typeof stepV2>).x = 101;
  assert.equal(readBackAgrees('live', moved, deleted), false, 'a changed live attribute is a difference under live');
});

test('a mirror that declares live read-back commits a delete its app holds without the tombstone', async () => {
  let mirror: ReturnType<typeof appWithoutTombstones> | undefined;
  const world = v2World();
  const controller = await createPracticeController(world, { taskId: 'T1' }, async (initial, mirrored) => { mirror = appWithoutTombstones(initial, 'live'); mirror.worlds.push(mirrored); return mirror; });
  try {
    assert.equal(mirror!.worlds[0]!.app.adapterId, 'excalidraw', 'the factory receives the world\'s app');
    const reply = await controller.act({ expectedRevision: 0, action: deleteShip });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.deepEqual(controller.view().state, afterDelete(world.initialState), 'the core keeps the tombstone');
    assert.equal(mirror!.state.objects.c, undefined, 'the app holds none');
    const checked = await controller.check({ expectedRevision: 1 });
    assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.equal((await controller.png()).ok, true);
  } finally { await controller.close(); }
});

test('without a declaration the host compares the full state: the same app is refused (Excalidraw keeps this check)', async () => {
  const world = v2World();
  const controller = await createPracticeController(world, { taskId: 'T1' }, async initial => appWithoutTombstones(initial, undefined));
  try {
    const reply = await controller.act({ expectedRevision: 0, action: deleteShip });
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'real_tool_disagrees');
    assert.deepEqual(controller.view().state, world.initialState, 'the board is unchanged');
  } finally { await controller.close(); }
});

test('live read-back is still a check: an app that keeps the deleted step live is refused', async () => {
  const world = v2World();
  const controller = await createPracticeController(world, { taskId: 'T1' }, async initial => appWithoutTombstones(initial, 'live', true));
  try {
    const reply = await controller.act({ expectedRevision: 0, action: deleteShip });
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'real_tool_disagrees');
    assert.deepEqual(controller.view().state, world.initialState);
  } finally { await controller.close(); }
});

// PADR-0045: the host compares the mirror's read-back the way the adapter's registry entry declares.
// `full` (Excalidraw) compares the whole state, tombstones included; `live` (an app that keeps no
// deleted objects, as draw.io will declare) compares live objects only, and is still a check: a
// deleted object the app shows as live is refused. The mirrors here are the production mirror
// (createProductionMirror) over a registry entry whose factory returns a browser-free app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPracticeController } from '../../src/host/session.ts';
import { createProductionMirror } from '../../src/host/mirror.ts';
import { ADAPTER_REGISTRY, readBackAgrees, type AdapterRegistration, type AdapterRegistry, type ReadBackComparison } from '../../src/adapters/registry.ts';
import type { AdapterResult, MirrorAdapter } from '../../src/adapters/types.ts';
import type { Action, State } from '../../src/world/types.ts';
import { stepV2, v2World } from '../support/world-v2.ts';

/** Hand-written: the core's tombstone for `c` after delete_step (world/2 keeps deleted objects). */
const afterDelete = (start: State): State => ({ objects: { ...structuredClone(start.objects), c: { ...stepV2('c', 'Ship', 700, 300), deleted: true } } });
const live = (state: State): State => ({ objects: Object.fromEntries(Object.entries(state.objects).filter(([, object]) => !object.deleted)) });
const deleteShip: Action = { name: 'delete_step', params: { id: 'c' } };

/** An app that keeps no deleted objects; `ignoreDeletes` makes it keep a deleted step live. */
function appWithoutTombstones(ignoreDeletes = false): { create: AdapterRegistration['create']; held: () => State | undefined } {
  let held: State | undefined;
  const hold = (state: State, before: State): State => ignoreDeletes
    ? { objects: { ...live(state).objects, ...Object.fromEntries(Object.entries(before.objects).filter(([id, o]) => !o.deleted && state.objects[id]?.deleted)) } }
    : live(state);
  const result = (): AdapterResult => ({ ok: true, state: structuredClone(held!), warnings: [] });
  const create = async (initial: State): Promise<MirrorAdapter> => {
    held = live(initial);
    return {
      describe: () => { throw new Error('unused'); },
      snapshot: async () => structuredClone(held!),
      apply: async transition => { held = hold(transition.after, transition.before); return result(); },
      restoreState: async state => { held = live(state); return result(); },
      exportArtifact: async () => { throw new Error('unused'); }, importArtifact: async () => { throw new Error('unused'); },
      renderPng: async () => new Uint8Array([137, 80, 78, 71]), networkAttempts: () => [], terminate: async () => {}, close: async () => {},
    };
  };
  return { create, held: () => held };
}
/** The registry with the Excalidraw entry's factory swapped for `app`, and optionally its comparison. */
const registryWith = (app: ReturnType<typeof appWithoutTombstones>, readBack?: ReadBackComparison): AdapterRegistry =>
  ({ excalidraw: { ...ADAPTER_REGISTRY.excalidraw, create: app.create, ...(readBack ? { readBack } : {}) } });

test('read-back comparison: full includes tombstones, live compares live objects only', () => {
  const start = v2World().initialState, deleted = afterDelete(start);
  assert.equal(readBackAgrees('full', deleted, deleted), true);
  assert.equal(readBackAgrees('full', live(deleted), deleted), false, 'a missing tombstone is a difference under full');
  assert.equal(readBackAgrees('live', live(deleted), deleted), true, 'the app holds no tombstones under live');
  assert.equal(readBackAgrees('live', start, deleted), false, 'a deleted object shown live is a difference under live');
  const moved = structuredClone(live(deleted)); (moved.objects.a as ReturnType<typeof stepV2>).x = 101;
  assert.equal(readBackAgrees('live', moved, deleted), false, 'a changed live attribute is a difference under live');
});

test('the Excalidraw entry\'s full comparison reaches the host: an app that drops tombstones is refused', async () => {
  assert.equal(ADAPTER_REGISTRY.excalidraw.readBack, 'full', 'Excalidraw keeps deleted elements (PADR-0045)');
  const world = v2World(), app = appWithoutTombstones(), registry = registryWith(app);
  const controller = await createPracticeController(world, { taskId: 'T1' }, async (initial, mirrored) => {
    const mirror = await createProductionMirror(initial, undefined, mirrored, registry);
    assert.equal(mirror.readBack, 'full', 'the mirror carries its registry entry\'s comparison');
    return mirror;
  });
  try {
    const reply = await controller.act({ expectedRevision: 0, action: deleteShip });
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'real_tool_disagrees');
    assert.deepEqual(controller.view().state, world.initialState, 'the board is unchanged');
  } finally { await controller.close(); }
});

test('an entry that declares live commits a delete its app holds without the tombstone', async () => {
  const world = v2World(), app = appWithoutTombstones();
  const controller = await createPracticeController(world, { taskId: 'T1' }, (initial, mirrored) => createProductionMirror(initial, undefined, mirrored, registryWith(app, 'live')));
  try {
    const reply = await controller.act({ expectedRevision: 0, action: deleteShip });
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.deepEqual(controller.view().state, afterDelete(world.initialState), 'the core keeps the tombstone');
    assert.equal(app.held()!.objects.c, undefined, 'the app holds none');
    const checked = await controller.check({ expectedRevision: 1 });
    assert.equal(checked.ok, true, JSON.stringify(checked));
    assert.equal((await controller.png()).ok, true);
  } finally { await controller.close(); }
});

test('live read-back is still a check: an app that keeps the deleted step live is refused', async () => {
  const world = v2World();
  const controller = await createPracticeController(world, { taskId: 'T1' }, (initial, mirrored) => createProductionMirror(initial, undefined, mirrored, registryWith(appWithoutTombstones(true), 'live')));
  try {
    const reply = await controller.act({ expectedRevision: 0, action: deleteShip });
    assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, 'real_tool_disagrees');
    assert.deepEqual(controller.view().state, world.initialState);
  } finally { await controller.close(); }
});

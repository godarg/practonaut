import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateWorld } from '../../src/world/schema.ts';
import { checkInProcess } from '../../src/cli/runtime.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import { createExcalidrawAdapter } from '../../src/adapters/excalidraw/index.ts';
import { parseExcalidraw } from '../../src/checker/index.ts';
import { Session } from '../../src/core/index.ts';
import { canonicalJson } from '../../src/canonical/index.ts';
import type { State } from '../../src/world/types.ts';
import { syntheticProcessWorld, CYCLE_LABELS, CYCLE_POSITIONS, CYCLE_EDGES, REVISED_CYCLE_EDGES, CYCLE_CONTENT_PROVENANCE } from '../support/synthetic-process-world.ts';
import { checkStagePreservation, type StagePreservationSpec } from '../support/synthetic-process.ts';
const revisionSpec: StagePreservationSpec = { renames: [{ from: 'Inspect', to: 'Verify' }], reconnects: [{ from: 'Link', before: 'Inspect', after: 'Polish' }, { from: 'Inspect', before: 'Polish', after: 'Store' }, { from: 'Polish', before: 'Store', after: 'Inspect' }], addedArrows: 0 };

const reference = async () => validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json', 'utf8')));
function cycleState(revised = false): State {
  const state: State = { objects: { 'flow-frame': { id: 'flow-frame', type: 'frame', deleted: false, name: 'Loop practice' } } };
  CYCLE_LABELS.forEach((label, index) => { const [x, y] = CYCLE_POSITIONS[index]!; const id = 's' + index; state.objects[id] = { id, type: 'step', deleted: false, label: revised && label === 'Inspect' ? 'Verify' : label, frameId: 'flow-frame', x, y, width: 180, height: 100, fontFamily: 3 }; });
  (revised ? REVISED_CYCLE_EDGES : CYCLE_EDGES).forEach(([from, to], index) => { const id = 'e' + index; state.objects[id] = { id, type: 'arrow', deleted: false, frameId: 'flow-frame', from: 's' + from, to: 's' + to }; });
  return state;
}
const native = (state: State) => JSON.stringify({ type: 'excalidraw', version: 2, elements: toRaw(state), files: {} });

test('neutral seven-node cycle has own CC0 content and rejects every missing or incorrectly bound edge', async () => {
  const world = validateWorld(syntheticProcessWorld(await reference())); const state = cycleState();
  assert.equal(world.rights.license, 'CC0-1.0'); assert.deepEqual(world.provenance.authors, [CYCLE_CONTENT_PROVENANCE.author]);
  assert.equal(CYCLE_LABELS.length, 7); assert.equal(CYCLE_EDGES.length, 7);
  assert.equal((await checkInProcess(world, native(state), { seed: 42, taskId: 'S1' })).passed, true);
  for (let index = 0; index < CYCLE_EDGES.length; index++) {
    const missing = structuredClone(state); delete missing.objects['e' + index];
    assert.equal((await checkInProcess(world, native(missing), { seed: 42, taskId: 'S1' })).passed, false, 'missing edge ' + index);
    const incorrect = structuredClone(state); const edge = incorrect.objects['e' + index]; assert.ok(edge?.type === 'arrow');
    edge.to = 's' + ((CYCLE_EDGES[index]![1] + 1) % 7);
    assert.equal((await checkInProcess(world, native(incorrect), { seed: 42, taskId: 'S1' })).passed, false, 'incorrect target ' + index);
  }
  const wrongLabel = structuredClone(state); const step = wrongLabel.objects.s4; assert.ok(step?.type === 'step'); step.label = 'Verify';
  assert.equal((await checkInProcess(world, native(wrongLabel), { seed: 42, taskId: 'S1' })).passed, false);
});

test('rename and three real endpoint actions preserve existing objects and yield the distinct revised cycle', async () => {
  const world = validateWorld(syntheticProcessWorld(await reference(), true, cycleState()));
  const session = new Session(world, 42, 'S1'); const before = structuredClone(session.state);
  assert.equal((await checkInProcess(world, native(session.state), { seed: 42, taskId: 'S1' })).passed, false);
  assert.ok(session.act({ name: 'rename_step', params: { id: 's4', label: 'Verify' } }).ok);
  assert.ok(session.act({ name: 'reconnect_end', params: { id: 'e3', end: 'end', target: 's5' } }).ok);
  assert.ok(session.act({ name: 'reconnect_end', params: { id: 'e4', end: 'end', target: 's6' } }).ok);
  assert.ok(session.act({ name: 'reconnect_end', params: { id: 'e5', end: 'end', target: 's4' } }).ok);
  assert.deepEqual(Object.keys(session.state.objects).sort(), Object.keys(before.objects).sort());
  for (let index = 0; index < 7; index++) { const original = before.objects['s' + index], actual = session.state.objects['s' + index]; assert.ok(original?.type === 'step' && actual?.type === 'step'); assert.deepEqual([actual.x, actual.y, actual.width, actual.height], [original.x, original.y, original.width, original.height]); }
  assert.equal((await checkInProcess(world, native(session.state), { seed: 42, taskId: 'S1' })).passed, true);
  assert.deepEqual(checkStagePreservation(before, session.state, revisionSpec), { passed: true, errors: [] });
  assert.ok(session.checkReplay().ok);
});

test('a passing revised graph cannot hide changed object IDs, geometry, frame name or font', async () => {
  const before = cycleState(), revised = structuredClone(before), world = validateWorld(syntheticProcessWorld(await reference(), true, before));
  const renamed = revised.objects.s4; assert.ok(renamed?.type === 'step'); renamed.label = 'Verify';
  for (const [id, target] of [['e3', 's5'], ['e4', 's6'], ['e5', 's4']]) { const arrow = revised.objects[id!]; assert.ok(arrow?.type === 'arrow'); arrow.to = target!; }
  assert.equal(checkStagePreservation(before, revised, revisionSpec).passed, true);
  const replaced = structuredClone(revised), step = replaced.objects.s0; assert.ok(step?.type === 'step');
  delete replaced.objects.s0; step.id = 'replacement'; replaced.objects.replacement = step;
  for (const object of Object.values(replaced.objects)) if (object.type === 'arrow') { if (object.from === 's0') object.from = step.id; if (object.to === 's0') object.to = step.id; }
  const moved = structuredClone(revised), movedStep = moved.objects.s0; assert.ok(movedStep?.type === 'step'); movedStep.x += 20;
  for (const changed of [replaced, moved]) {
    assert.equal((await checkInProcess(world, native(changed), { seed: 42, taskId: 'S1' })).passed, true, 'graph goal alone accepts this changed layout/identity');
    assert.equal(checkStagePreservation(before, changed, revisionSpec).passed, false);
  }
  const frame = structuredClone(revised), frameObject = frame.objects['flow-frame']; assert.ok(frameObject?.type === 'frame'); frameObject.name += ' changed';
  const font = structuredClone(revised), fontObject = font.objects.s0; assert.ok(fontObject?.type === 'step'); (fontObject as { fontFamily: number }).fontFamily = 1;
  assert.equal(checkStagePreservation(before, frame, revisionSpec).passed, false);
  assert.equal(checkStagePreservation(before, font, revisionSpec).passed, false);
});

test('exact synthetic native artifact survives a separate real editor roundtrip without annotations', async () => {
  const world = validateWorld(syntheticProcessWorld(await reference(), true)); const state = cycleState(true);
  const producer = await createExcalidrawAdapter(state);
  let actual: string;
  try { const artifact = await producer.exportArtifact(); actual = artifact.native; assert.deepEqual(producer.networkAttempts(), []); }
  finally { await producer.close(); }
  const consumer = await createExcalidrawAdapter({ objects: {} });
  try {
    const imported = await consumer.importArtifact(actual); assert.ok(imported.ok);
    const roundtrip = await consumer.exportArtifact(); assert.deepEqual(consumer.networkAttempts(), []);
    assert.equal(canonicalJson(parseExcalidraw(actual)), canonicalJson(state));
    assert.equal(canonicalJson(parseExcalidraw(roundtrip.native)), canonicalJson(state));
    assert.equal((await checkInProcess(world, roundtrip.native, { seed: 42, taskId: 'S1' })).passed, true);
  } finally { await consumer.close(); }
});

test('public synthetic helper refuses a neutral private grammar reference before CC0 dedication', async () => {
  const value = structuredClone(await reference());
  const privateReference = { ...value, rights: { ...value.rights, license: 'LicenseRef-Private' } } as typeof value;
  assert.throws(() => syntheticProcessWorld(privateReference), /Synthetic grammar reference must declare CC0/);
  const privateSource = { ...value, provenance: { ...value.provenance, privateSource: { owner: 'Neutral owner' } } } as typeof value;
  assert.throws(() => syntheticProcessWorld(privateSource), /Synthetic grammar reference must declare CC0/);
});

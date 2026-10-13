import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecorder, snapshotElements, replayGesture, validateRecording, projectSnapshot, RECORDING_LIMITS } from '../../src/adapters/excalidraw/recorder.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import type { RawElement } from '../../src/adapters/excalidraw/raw.ts';
import type { Recording } from '../../src/adapters/excalidraw/recorder-types.ts';

const frame = (): RawElement => ({ id: 'f', type: 'frame', isDeleted: false, frameId: null, x: 0, y: 0, width: 1000, height: 600, boundElements: [], name: 'Process' });
const rectangle = (): RawElement => ({ id: 'b', type: 'rectangle', isDeleted: false, frameId: 'f', x: 10, y: 20, width: 180, height: 100, boundElements: [] });
const text = (): RawElement => ({ id: 't', type: 'text', isDeleted: false, frameId: 'f', x: 15, y: 25, width: 170, height: 25, boundElements: [], containerId: 'b', originalText: 'Start', text: 'Start', fontFamily: 3 });
import { makeRecording } from './recorder-fixture.ts';

test('observed multiple native selection is excluded while its complete deletion remains replayable', () => {
  const arrow: RawElement = { ...rectangle(), id: 'a', type: 'arrow', points: [[0, 0], [100, 0]], startBinding: null, endBinding: null };
  const before = [frame(), rectangle(), text(), arrow];
  const r = createGestureRecorder(); r.start(before, true);
  r.excludeSelection(['b', 'a']);
  const after = structuredClone(before); for (const e of after) if (['b', 't', 'a'].includes(e.id)) e.isDeleted = true;
  r.observe(after); const g = r.boundary('key'); assert.ok(g);
  assert.equal(g.events.filter(e => e.kind === 'set' && e.field === 'isDeleted').length, 3);
  assert.deepEqual(g.unmodeled.map(e => e.id).sort(), ['a', 'b']);
  assert.ok(g.unmodeled.every(e => e.attributes.length === 0 && e.reason.includes('multiple independently selected')));
  assert.deepEqual(replayGesture(g), g.after);
  const source = makeRecording(); source.initial = g.before; source.gestures = [g];
  validateRecording(source); r.stop();
  r.start(before, true); r.excludeSelection(['b', 'b', 't', 'missing']);
  r.observe(after); const single = r.boundary('key'); assert.ok(single);
  assert.deepEqual(single.unmodeled, []); // Bound labels and missing/duplicate IDs do not invent a second root.
  assert.deepEqual(replayGesture(single), single.after); r.stop();
});

test('explicit start and complete fonts gate recording; intermediate UI states remain recordable', () => {
  const r = createGestureRecorder(); r.observe([frame()]); assert.equal(r.gestures.length, 0);
  assert.throws(() => r.start([frame()], false), /fonts/); r.start([frame()], true);
  r.observe([frame(), rectangle()]); const g = r.boundary('pointerup'); assert.ok(g); assert.equal(g.events[0]?.kind, 'create');
  assert.equal(projectSnapshot(g.after).ok, false); r.stop();
});
test('three scripted semantic recordings are identical and replay each gesture', () => {
  const recordings = ['repeat-1', 'repeat-2', 'repeat-3'].map(makeRecording);
  for (const r of recordings) { validateRecording(r); assert.deepEqual(replayGesture(r.gestures[0]!), r.gestures[0]!.after); }
  assert.deepEqual(recordings[0]!.gestures, recordings[1]!.gestures); assert.deepEqual(recordings[1]!.gestures, recordings[2]!.gestures);
  assert.equal(projectSnapshot(recordings[0]!.gestures[0]!.after).ok, true);
});
test('removing or falsifying an observed semantic event makes strict replay red', () => {
  const g = makeRecording().gestures[0]!;
  const missing = structuredClone(g); missing.events.pop(); assert.throws(() => replayGesture(missing), /replay_mismatch/);
  const tampered = structuredClone(g); const e = tampered.events[0]; assert.ok(e?.kind === 'create'); e.element.attributes.frameId = 'different'; assert.throws(() => replayGesture(tampered), /replay_mismatch/);
});
test('arrow bend touching only excluded points is unmodeled, including unrelated concurrent move', () => {
  const arrow: RawElement = { ...rectangle(), id: 'a', type: 'arrow', points: [[0, 0], [100, 0]], startBinding: null, endBinding: null };
  const r = createGestureRecorder(); r.start([frame(), rectangle(), arrow], true);
  const bent = structuredClone(arrow); bent.points = [[0, 0], [50, 40], [100, 0]];
  r.observe([frame(), rectangle(), bent]); const g = r.boundary('pointerup'); assert.ok(g); assert.equal(g.events.length, 0); assert.deepEqual(g.unmodeled[0]?.attributes, ['points']);
  const moved = rectangle(); moved.x = 50; bent.points = [[0, 0], [50, 80], [100, 0]];
  r.observe([frame(), moved, bent]); assert.deepEqual(r.boundary('pointerup')?.unmodeled[0]?.attributes, ['points']); r.stop();
});
test('volatile font layout injected midgesture is quarantined even if final geometry recovers', () => {
  const r = createGestureRecorder(); r.start([frame(), rectangle(), text()], true);
  const changed = text(); changed.width = 122; r.observe([frame(), rectangle(), changed]);
  r.observe([frame(), rectangle(), text()]); const g = r.boundary('pointerup'); assert.ok(g?.quarantined); assert.match(g.quarantineReasons[0]!, /font layout/); r.stop();
  const recording = makeRecording(); recording.initial = g.before; recording.gestures = [g]; recording.manifest.status = 'quarantined'; validateRecording(recording);
});
test('quiet period and key/pointer boundaries coalesce without inventing action intent', async () => {
  const r = createGestureRecorder(); r.start([frame(), rectangle()], true);
  for (let x = 11; x < 20; x++) { const b = rectangle(); b.x = x; r.observe([frame(), b]); }
  await new Promise(resolve => setTimeout(resolve, 160)); assert.equal(r.gestures.length, 1); assert.equal(r.gestures[0]?.boundary, 'quiet');
  assert.deepEqual(r.gestures[0]?.events, [{ kind: 'set', id: 'b', field: 'x', before: 10, after: 19 }]); r.stop();
});
test('bookkeeping changes produce no semantic action; unsupported style/type remains visible', () => {
  const r = createGestureRecorder(); r.start([frame(), rectangle()], true);
  const b = rectangle(); b.versionNonce = 94; b.version = 2; r.observe([frame(), b]); assert.equal(r.boundary('key'), null);
  b.strokeColor = 'red'; r.observe([frame(), b]); assert.deepEqual(r.boundary('pointerup')?.unmodeled[0]?.attributes, ['strokeColor']);
  const ellipse = { ...rectangle(), id: 'e', type: 'ellipse' }; r.observe([frame(), b, ellipse]); assert.deepEqual(r.boundary('pointerup')?.unmodeled[0]?.attributes, ['type']); r.stop();
});
test('round-trip declared projection and recording limits reject malformed snapshots', () => {
  const state = { objects: { f: { id: 'f', type: 'frame' as const, name: 'Process', deleted: false }, b: { id: 'b', type: 'step' as const, frameId: 'f', label: 'Start', x: 10, y: 20, width: 180, height: 100, fontFamily: 3, deleted: false } } };
  assert.deepEqual(projectSnapshot(snapshotElements(toRaw(state))), { ok: true, state });
  const malformed = makeRecording(); malformed.initial.elements.f!.attributes.untrusted = 'x'; assert.throws(() => validateRecording(malformed), /undeclared/);
  assert.throws(() => snapshotElements(Array.from({ length: RECORDING_LIMITS.maxElements + 1 }, (_, i) => ({ ...frame(), id: 'f' + i }))), /limit/);
  const tooLong = makeRecording(); tooLong.manifest.stoppedAt = '2026-10-04T12:31:00.000Z'; assert.throws(() => validateRecording(tooLong), /duration/);
  const broken = makeRecording(); broken.gestures[0]!.index = 2; assert.throws(() => validateRecording(broken), /chain/);
});
test('unsupported font families remain visible and cannot project into confirmed flow state', () => {
  const r = createGestureRecorder(); r.start([frame(), rectangle(), text()], true);
  const otherFont = text(); otherFont.fontFamily = 5; r.observe([frame(), rectangle(), otherFont]); const g = r.boundary('key'); assert.ok(g);
  assert.deepEqual(g.unmodeled[0]?.attributes, ['fontFamily']); assert.equal(projectSnapshot(g.after).ok, false); r.stop();
});
test('native and accumulated byte ceilings stop recording with an explicit quiet-boundary error', async () => {
  const huge = rectangle(); huge.points = [[0, 0]]; huge.customData = { notes: 'x'.repeat(RECORDING_LIMITS.maxBytes) };
  assert.throws(() => snapshotElements([huge]), /byte limit/);
  const texts = Array.from({ length: 350 }, (_, i) => ({ ...text(), id: 't' + i, originalText: 'x'.repeat(3000), text: 'x'.repeat(3000) }));
  let failure: Error | undefined; const r = createGestureRecorder({ onError: error => { failure = error; } });
  r.start([frame(), rectangle(), ...texts], true); const moved = rectangle(); moved.x = 50;
  r.observe([frame(), moved, ...texts]); await new Promise(resolve => setTimeout(resolve, 160));
  assert.match(failure?.message ?? '', /accumulated gesture bytes/); assert.equal(r.active, false); assert.equal(r.gestures.length, 0);
});
test('native arrow endpoint events explain incident step cache updates; cache-only changes stay unmodeled', () => {
  const target = { ...rectangle(), id: 'c', x: 300 };
  const r = createGestureRecorder(); r.start([frame(), rectangle(), target], true);
  const bound = rectangle(); bound.boundElements = [{ id: 'a', type: 'arrow' }];
  const boundTarget = structuredClone(target); boundTarget.boundElements = [{ id: 'a', type: 'arrow' }];
  const arrow: RawElement = { ...rectangle(), id: 'a', type: 'arrow', startBinding: { elementId: 'b', focus: 0, gap: 4 }, endBinding: { elementId: 'c', focus: 0, gap: 4 }, points: [[0, 0], [290, 0]] };
  r.observe([frame(), bound, boundTarget, arrow]); const connected = r.boundary('pointerup'); assert.ok(connected);
  assert.equal(connected.unmodeled.length, 0); assert.deepEqual(connected.events.map(e => e.kind), ['create']); replayGesture(connected);
  const removed = structuredClone(arrow); removed.isDeleted = true; removed.startBinding = null; removed.endBinding = null;
  r.observe([frame(), rectangle(), target, removed]); const disconnected = r.boundary('key'); assert.ok(disconnected); assert.equal(disconnected.unmodeled.length, 0); replayGesture(disconnected);
  const unexplained = rectangle(); unexplained.boundElements = [{ id: 'phantom', type: 'arrow' }];
  r.observe([frame(), unexplained, target, removed]); const cacheOnly = r.boundary('pointerup'); assert.ok(cacheOnly); assert.equal(cacheOnly.events.length, 0); assert.deepEqual(cacheOnly.unmodeled[0]?.attributes, ['boundElements']); r.stop();
});

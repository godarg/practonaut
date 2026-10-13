import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson } from '../../src/canonical/index.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { checkInProcess } from '../../src/cli/runtime.ts';
import { checkState, generateCheckerVariant } from '../../src/checker/index.ts';
import { prepareRepairProject, configureRepairProject, analyzeRecordings, confirmHypothesis, observationRef, compileProject } from '../../src/authoring/index.ts';
import { snapshotElements } from '../../src/adapters/excalidraw/recorder.ts';
import { inspectNativeTransferFile, assertNativeRectangleMove, assertNativeFinalizationPreserved, type NativeTransferFile, type NativeFileTransfer, type nativeFileTransfer } from '../../src/evaluation/transfer.ts';
import type { Recording, SemanticEvent } from '../../src/adapters/excalidraw/recorder-types.ts';
import type { CheckerData, State, World } from '../../src/world/types.ts';
import { syntheticProcessWorld, CYCLE_LABELS, CYCLE_EDGES, CYCLE_POSITIONS } from '../support/synthetic-process-world.ts';
import { artifactSha256, runProcessNativeTransfer } from '../support/synthetic-process.ts';

// Independent literal native fixtures. No adapter export, raw serializer or native browser supplies truth.
function nativeFixture(state: State): string {
  const elements: Array<Record<string, unknown>> = [];
  for (const object of Object.values(state.objects)) {
    const base = { id: object.id, isDeleted: object.deleted, angle: 0, x: 0, y: 0, width: 1, height: 1, boundElements: [] as Array<{ id: string; type: string }> };
    if (object.type === 'frame') elements.push({ ...base, type: 'frame', frameId: null, name: object.name, x: 20, y: 100, width: 1400, height: 600 });
    if (object.type === 'step') {
      const refs = [{ id: object.id + ':text', type: 'text' }, ...Object.values(state.objects).filter(item => item.type === 'arrow' && !item.deleted && (item.from === object.id || item.to === object.id)).map(item => ({ id: item.id, type: 'arrow' }))];
      elements.push({ ...base, type: 'rectangle', frameId: object.frameId, x: object.x, y: object.y, width: object.width, height: object.height, boundElements: refs });
      elements.push({ ...base, id: object.id + ':text', type: 'text', frameId: object.frameId, containerId: object.id, fontFamily: 3, text: object.label, originalText: object.label });
    }
    if (object.type === 'arrow') elements.push({ ...base, type: 'arrow', frameId: object.frameId,
      startBinding: object.from === null ? null : { elementId: object.from }, endBinding: object.to === null ? null : { elementId: object.to }, startArrowhead: null, endArrowhead: 'arrow' });
  }
  return JSON.stringify({ type: 'excalidraw', version: 2, elements, files: {} });
}
function normalized(native: string): string {
  const raw = JSON.parse(native) as { elements: Array<Record<string, unknown>> };
  return JSON.stringify({ ...raw, source: 'native fixture normalization', appState: { viewBackgroundColor: '#ffffff' }, elements: raw.elements.filter(element => !element.isDeleted) }, null, 2);
}
/** Mock only the owned native application/process boundary; actual disk reads and checker children remain real. */
function nativeBoundary(savedNative?: string, mutate?: (result: NativeFileTransfer) => Promise<void>) {
  let calls = 0;
  const transfer: typeof nativeFileTransfer = async input => {
    calls++;
    const inputBytes = await readFile(input.inputPath); assert.equal(artifactSha256(inputBytes), input.expectedInputSha256);
    await mkdir(input.outputDirectory, { mode: 0o700 });
    const before = inspectNativeTransferFile(inputBytes), opened = inspectNativeTransferFile(normalized(before.native));
    const changed = JSON.parse(opened.native) as { elements: Array<Record<string, unknown>> };
    const rectangle = changed.elements.find(element => element.id === input.stepId)!; rectangle.x = Number(rectangle.x) + 5;
    const edited = inspectNativeTransferFile(JSON.stringify(changed)), savedPath = join(input.outputDirectory, 'native-saved.excalidraw');
    await writeFile(savedPath, savedNative ?? opened.native, { flag: 'wx', mode: 0o600 });
    const saved = inspectNativeTransferFile(await readFile(savedPath));
    const result: NativeFileTransfer = { evidence: 'SCRIPTED_HEADLESS', visibleOsSighting: 'OPEN', inputPath: input.inputPath, savedPath,
      save: { method: 'native-menu-save-as-download', suggestedFilename: 'fixture.excalidraw' },
      snapshots: { before, opened, edited, undone: opened, saved }, edit: { stepId: input.stepId, dx: 5, dy: 0 }, networkAttempts: [] };
    await mutate?.(result); return result;
  };
  return { transfer, calls: () => calls };
}
const directory = () => mkdtemp(join(tmpdir(), 'pn-process-native-source-'));
const reference = async () => validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json', 'utf8')));
function cycleState(): State {
  const state: State = { objects: { 'flow-frame': { id: 'flow-frame', type: 'frame', deleted: false, name: 'Loop practice' } } };
  CYCLE_LABELS.forEach((label, index) => { const [x, y] = CYCLE_POSITIONS[index]!, id = 's' + index; state.objects[id] = { id, type: 'step', deleted: false, frameId: 'flow-frame', label, x, y, width: 180, height: 100, fontFamily: 3 }; });
  CYCLE_EDGES.forEach(([from, to], index) => { const id = 'e' + index; state.objects[id] = { id, type: 'arrow', deleted: false, frameId: 'flow-frame', from: 's' + from, to: 's' + to }; });
  return state;
}
// Manually assigned state deltas feed the real author compiler; no Session transition generates expectations.
function freshRepair() {
  let project = prepareRepairProject({ id: 'native-process-repair', title: 'Shorten a CC0 process', author: 'Synthetic source test', labels: ['Collect', 'Review', 'Publish'] });
  const initial = project.initialState, deleted = structuredClone(initial), reconnected = structuredClone(initial), removed = structuredClone(initial);
  for (const state of [deleted, reconnected, removed]) {
    state.objects.b!.deleted = true;
    const ab = state.objects.ab, bc = state.objects.bc; assert.ok(ab?.type === 'arrow' && bc?.type === 'arrow'); ab.to = null; bc.from = null;
  }
  for (const state of [reconnected, removed]) { const ab = state.objects.ab; assert.ok(ab?.type === 'arrow'); ab.to = 'c'; }
  removed.objects.bc!.deleted = true;
  const recording = (id: string, before: State, after: State): Recording => {
    const first = snapshotElements(JSON.parse(nativeFixture(before)).elements), last = snapshotElements(JSON.parse(nativeFixture(after)).elements), events: SemanticEvent[] = [];
    for (const key of Object.keys(last.elements).sort()) for (const field of Object.keys(last.elements[key]!.attributes).sort()) {
      const old = first.elements[key]!.attributes[field]!, value = last.elements[key]!.attributes[field]!;
      if (old !== value) events.push({ kind: 'set', id: key, field, before: old, after: value });
    }
    return { manifest: { schema: 'practonaut.recording/1', id, createdAt: '2026-10-10T00:00:00Z', stoppedAt: '2026-10-10T00:00:01Z', appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: 'excalidraw-gesture-v1', author: 'Synthetic source test', license: 'CC0-1.0', consent: 'Independent non-personal CC0 source test', demonstration: 'scripted', status: 'review' },
      initial: first, gestures: [{ index: 0, boundary: 'key', before: first, after: last, events, unmodeled: [], quarantined: false, quarantineReasons: [] }] };
  };
  const recordings = [recording('delete-proposal', initial, deleted), recording('delete-confirmation', initial, deleted), recording('reconnect-proposal', deleted, reconnected), recording('reconnect-confirmation', deleted, reconnected), recording('disconnect-proposal', reconnected, removed), recording('disconnect-confirmation', reconnected, removed)];
  project = { ...project, ...analyzeRecordings(recordings), recordingIds: recordings.map(value => value.manifest.id) };
  for (const [id, index] of [['delete-keeps-arrows-v1', 1], ['reconnect-v1', 3], ['disconnect-v1', 5]] as const) project = confirmHypothesis(project, { hypothesisId: id, evidence: observationRef(recordings[index]!, 0) }, recordings);
  project = configureRepairProject(project, { ...project.repair!, reviewedExamples: true });
  return compileProject({ project, recordings });
}

test('CC0 complete cycle consumes the entire saved file in the original checker without replacing byte transport', async () => {
  const world = validateWorld(syntheticProcessWorld(await reference())), native = nativeFixture(cycleState()), boundary = nativeBoundary(), root = await directory();
  const worldOriginal = canonicalJson(world), result = await runProcessNativeTransfer({ directory: root, native, world, seed: 42, taskId: 'S1' }, boundary.transfer);
  assert.equal(boundary.calls(), 1); assert.equal(result.passed, true);
  assert.equal((await readFile(join(root, 'input.excalidraw'), 'utf8')), native);
  assert.equal(result.binding.taskId, 'S1'); assert.equal(result.binding.seed, 42); assert.equal(result.binding.worldSha256, artifactSha256(worldOriginal));
  assert.equal(result.saved.sha256, artifactSha256(await readFile(result.native.savedPath))); assert.equal(result.nativeByteEqualTransport, false);
  assert.equal(result.tombstoneIdenticalFullState, true); assert.equal(result.supplementalActivePreservation, true);
  assert.deepEqual(result.verdict.counterprobes, { empty: false, unchanged: false, wrongArtifact: false }); assert.equal(canonicalJson(world), worldOriginal);
});

test('fresh repair keeps original goals and reference/alternative/near-miss while native normalization stays separate', async () => {
  const compiled = freshRepair(), world = compiled.world, checker = compiled.checker, original = canonicalJson({ world, checker });
  const fixtures = generateCheckerVariant(world, checker, 42).fixtures;
  assert.deepEqual(fixtures.map(fixture => fixture.kind).sort(), ['alternative', 'near-miss', 'reference']);
  for (const fixture of fixtures) assert.equal(checkState(world, fixture.state, { seed: 42, taskId: 'repair-flow', bundle: checker }).passed, fixture.expected);
  for (const kind of ['reference', 'alternative'] as const) {
    const state = fixtures.find(fixture => fixture.kind === kind)!.state, native = nativeFixture(state), boundary = nativeBoundary(), root = await directory();
    const result = await runProcessNativeTransfer({ directory: root, native, world, checker, seed: 42, taskId: 'repair-flow' }, boundary.transfer);
    assert.equal(result.passed, true); assert.equal(boundary.calls(), 1); assert.equal(result.binding.checkerSha256, artifactSha256(canonicalJson(checker)));
    assert.equal(result.tombstoneIdenticalFullState, false); assert.equal(result.nativeByteEqualTransport, false);
    assert.notDeepEqual(result.native.snapshots.before.state, result.native.snapshots.saved.state, 'Historical tombstone full-array mismatch stays distinct');
  }
  assert.equal(canonicalJson({ world, checker }), original);
});

test('active label/frame/binding/back-reference/identity/geometry losses cannot pass an unchanged repair goal', async () => {
  const { world, checker } = freshRepair(), state = generateCheckerVariant(world, checker, 42).fixtures.find(fixture => fixture.kind === 'reference')!.state;
  const native = nativeFixture(state), saved = JSON.parse(normalized(native)) as { elements: Array<Record<string, unknown>> };
  for (const damage of ['label', 'frame', 'binding', 'back-reference', 'identity', 'geometry'] as const) {
    const changed = structuredClone(saved), rectangle = changed.elements.find(element => element.id === 'a')!, arrow = changed.elements.find(element => element.id === 'ab')!;
    if (damage === 'label') { const text = changed.elements.find(element => element.id === 'a:text')!; text.originalText = 'Wrong'; text.text = 'Wrong'; }
    if (damage === 'frame') changed.elements.find(element => element.type === 'frame')!.name = 'Different';
    if (damage === 'binding') arrow.endBinding = null;
    if (damage === 'back-reference') rectangle.boundElements = [{ id: 'a:text', type: 'text' }];
    if (damage === 'identity') changed.elements = changed.elements.filter(element => element.id !== 'a:text');
    if (damage === 'geometry') rectangle.x = Number(rectangle.x) + 20;
    const bytes = JSON.stringify(changed), root = await directory(), boundary = nativeBoundary(bytes);
    await assert.rejects(runProcessNativeTransfer({ directory: root, native, world, checker, seed: 42, taskId: 'repair-flow' }, boundary.transfer));
    assert.equal(boundary.calls(), 1); assert.equal(JSON.parse(await readFile(join(root, 'native-transfer-check-failure.json'), 'utf8')).passed, false);
    assert.equal(await readFile(join(root, 'native-transfer/native-saved.excalidraw'), 'utf8'), bytes);
    if (damage === 'label') assert.equal((await checkInProcess(world, bytes, { seed: 42, taskId: 'repair-flow', bundle: checker })).passed, true, 'Supplemental label preservation must reject even though the original goal does not constrain labels');
  }
});

test('a supplemental intact native scene cannot turn an original full-task failure into pass', async () => {
  const world = validateWorld(syntheticProcessWorld(await reference())), state = cycleState(); delete state.objects.e6;
  const native = nativeFixture(state), root = await directory(), boundary = nativeBoundary();
  const result = await runProcessNativeTransfer({ directory: root, native, world, seed: 42, taskId: 'S1' }, boundary.transfer);
  assert.equal(boundary.calls(), 1); assert.equal(result.supplementalActivePreservation, true); assert.equal(result.passed, false); assert.equal(result.verdict.passed, false);
  assert.equal(JSON.parse(await readFile(join(root, 'native-saved-full-verdict.json'), 'utf8')).verdict.passed, false);
});

test('changed transport, decoy saved bytes, network activity and native failure retain originals and never retry', async () => {
  const world = validateWorld(syntheticProcessWorld(await reference())), native = nativeFixture(cycleState());
  for (const damage of ['transport', 'saved-bytes', 'network', 'native-failure'] as const) {
    const root = await directory(); let calls = 0;
    const boundary = nativeBoundary(undefined, async result => {
      if (damage === 'transport') await writeFile(result.inputPath, native + '\n');
      if (damage === 'saved-bytes') await writeFile(result.savedPath, result.snapshots.saved.native + '\n');
      if (damage === 'network') result.networkAttempts.push('https://example.invalid/blocked');
    });
    const transfer: typeof nativeFileTransfer = async input => { calls++; if (damage === 'native-failure') throw Error('Native owned attempt failed'); return boundary.transfer(input); };
    await assert.rejects(runProcessNativeTransfer({ directory: root, native, world, seed: 42, taskId: 'S1' }, transfer));
    assert.equal(calls, 1); const failure = JSON.parse(await readFile(join(root, 'native-transfer-check-failure.json'), 'utf8')); assert.equal(failure.passed, false); assert.equal(failure.retry, false);
    assert.equal(failure.binding.inputSha256, artifactSha256(native));
    if (damage !== 'transport') assert.equal(await readFile(join(root, 'input.excalidraw'), 'utf8'), native);
  }
});

// Literal native input and whole expected state are independently authored here. No adapter,
// serializer, runtime transition, cycle generator or production comparison creates the truth.
function editOracleFixture(): { native: string; expected: State } {
  const native = JSON.stringify({ type: 'excalidraw', version: 2, files: {}, elements: [
    { id: 'f', type: 'frame', name: 'Synthetic edit', isDeleted: false, angle: 0, x: 0, y: 0, width: 900, height: 600, frameId: null, boundElements: [] },
    { id: 'valueOf', type: 'frame', name: 'Other frame', isDeleted: false, angle: 0, x: 1000, y: 0, width: 900, height: 600, frameId: null, boundElements: [] },
    { id: 'toString', type: 'rectangle', isDeleted: false, angle: 0, x: 120, y: 200, width: 180, height: 100, frameId: 'f', boundElements: [{ id: 'text-a', type: 'text' }, { id: '_edge', type: 'arrow' }] },
    { id: 'text-a', type: 'text', isDeleted: false, angle: 0, x: 150, y: 230, width: 90, height: 20, frameId: 'f', containerId: 'toString', text: 'Alpha', originalText: 'Alpha', fontFamily: 3, boundElements: [] },
    { id: 'hasOwnProperty', type: 'rectangle', isDeleted: false, angle: 0, x: 480, y: 200, width: 180, height: 100, frameId: 'f', boundElements: [{ id: 'text-b', type: 'text' }, { id: '_edge', type: 'arrow' }] },
    { id: 'text-b', type: 'text', isDeleted: false, angle: 0, x: 510, y: 230, width: 90, height: 20, frameId: 'f', containerId: 'hasOwnProperty', text: 'Beta', originalText: 'Beta', fontFamily: 3, boundElements: [] },
    { id: '_edge', type: 'arrow', isDeleted: false, angle: 0, x: 300, y: 250, width: 180, height: 0, frameId: 'f', startBinding: { elementId: 'toString' }, endBinding: { elementId: 'hasOwnProperty' }, startArrowhead: null, endArrowhead: 'arrow', boundElements: [] },
    { id: '_gone', type: 'rectangle', isDeleted: true, angle: 0, x: 120, y: 400, width: 180, height: 100, frameId: 'f', boundElements: [{ id: 'text-gone', type: 'text' }] },
    { id: 'text-gone', type: 'text', isDeleted: true, angle: 0, x: 150, y: 430, width: 90, height: 20, frameId: 'f', containerId: '_gone', text: 'Gone', originalText: 'Gone', fontFamily: 3, boundElements: [] },
    { id: '_old', type: 'arrow', isDeleted: true, angle: 0, x: 120, y: 300, width: 0, height: 100, frameId: 'f', startBinding: null, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', boundElements: [] },
  ] });
  const objects: State['objects'] = Object.create(null) as State['objects'];
  objects.f = { id: 'f', type: 'frame', name: 'Synthetic edit', deleted: false };
  objects['valueOf'] = { id: 'valueOf', type: 'frame', name: 'Other frame', deleted: false };
  objects['toString'] = { id: 'toString', type: 'step', deleted: false, frameId: 'f', label: 'Alpha', x: 120, y: 200, width: 180, height: 100, fontFamily: 3 };
  objects['hasOwnProperty'] = { id: 'hasOwnProperty', type: 'step', deleted: false, frameId: 'f', label: 'Beta', x: 480, y: 200, width: 180, height: 100, fontFamily: 3 };
  objects._edge = { id: '_edge', type: 'arrow', deleted: false, frameId: 'f', from: 'toString', to: 'hasOwnProperty' };
  objects._gone = { id: '_gone', type: 'step', deleted: true, frameId: 'f', label: 'Gone', x: 120, y: 400, width: 180, height: 100, fontFamily: 3 };
  objects._old = { id: '_old', type: 'arrow', deleted: true, frameId: 'f', from: null, to: null };
  return { native, expected: { objects } };
}
function movedEditFixture(): { opened: State; edited: State; expected: State } {
  const { native, expected } = editOracleFixture(), changed = JSON.parse(native) as { elements: Array<Record<string, unknown>> };
  const rectangle = changed.elements.find(element => element.id === 'toString')!;
  rectangle.x = 125; // Independent literal expected visible coordinate, not calculated by the tested helper.
  return { opened: inspectNativeTransferFile(native).state, edited: inspectNativeTransferFile(JSON.stringify(changed)).state, expected };
}

test('strict native edit accepts the single literal +5x move across independently parsed null-prototype dictionaries', () => {
  const { opened, edited, expected } = movedEditFixture();
  assert.deepEqual(opened, expected, 'Whole literal expected state independently verifies the native parser contract');
  const target = expected.objects['toString']; assert.ok(target?.type === 'step'); target.x = 125;
  assert.deepEqual(edited, expected);
  assert.equal(Object.getPrototypeOf(opened.objects), null); assert.equal(Object.getPrototypeOf(edited.objects), null);
  assert.notDeepEqual(structuredClone(edited), edited, 'The original structuredClone expectation loses the dictionary prototype');
  assert.doesNotThrow(() => assertNativeRectangleMove(opened, edited, 'toString'));
  assert.equal(Object.getPrototypeOf(opened.objects), null); assert.equal(Object.getPrototypeOf(edited.objects), null);
  assert.equal(opened.objects['toString']?.type === 'step' && opened.objects['toString'].x, 120);
  assert.equal(Object.hasOwn(opened.objects, 'hasOwnProperty'), true); assert.equal(Object.hasOwn(opened.objects, 'valueOf'), true);
  assert.equal(Object.hasOwn({}, '_edge'), false);
  for (const reserved of ['__proto__', 'prototype', 'constructor']) {
    const { native } = editOracleFixture(), raw = JSON.parse(native) as { elements: Array<Record<string, unknown>> };
    raw.elements.find(element => element.id === 'f')!.id = reserved;
    assert.throws(() => inspectNativeTransferFile(JSON.stringify(raw)), /invalid native semantic id/);
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  }
});

test('strict native edit rejects every additional whole-state key, object, type, value, geometry and relation delta', () => {
  const mutations: Array<[string, (state: State) => void]> = [
    ['unchanged x', state => { const step = state.objects['toString']; assert.ok(step?.type === 'step'); step.x = 120; }],
    ['wrong x', state => { const step = state.objects['toString']; assert.ok(step?.type === 'step'); step.x = 126; }],
    ['y', state => { const step = state.objects['toString']; assert.ok(step?.type === 'step'); step.y = 201; }],
    ['width', state => { const step = state.objects['toString']; assert.ok(step?.type === 'step'); step.width = 181; }],
    ['height', state => { const step = state.objects['toString']; assert.ok(step?.type === 'step'); step.height = 101; }],
    ['font', state => { const step = state.objects['toString']; assert.ok(step?.type === 'step'); (step as { fontFamily: number }).fontFamily = 2; }],
    ['label', state => { const step = state.objects['hasOwnProperty']; assert.ok(step?.type === 'step'); step.label = 'Changed'; }],
    ['step frame', state => { const step = state.objects['toString']; assert.ok(step?.type === 'step'); step.frameId = 'valueOf'; }],
    ['frame name', state => { const frame = state.objects['valueOf']; assert.ok(frame?.type === 'frame'); frame.name = 'Changed'; }],
    ['arrow from', state => { const arrow = state.objects._edge; assert.ok(arrow?.type === 'arrow'); arrow.from = null; }],
    ['arrow to', state => { const arrow = state.objects._edge; assert.ok(arrow?.type === 'arrow'); arrow.to = 'toString'; }],
    ['arrow frame', state => { const arrow = state.objects._edge; assert.ok(arrow?.type === 'arrow'); arrow.frameId = 'valueOf'; }],
    ['deleted', state => { state.objects._gone!.deleted = false; }],
    ['deleted arrow value', state => { const arrow = state.objects._old; assert.ok(arrow?.type === 'arrow'); arrow.from = 'toString'; }],
    ['other geometry', state => { const step = state.objects._gone; assert.ok(step?.type === 'step'); step.x = 121; }],
    ['identity', state => { state.objects._gone!.id = '_different'; }],
    ['type', state => { state.objects._gone = { id: '_gone', type: 'frame', name: 'Changed', deleted: true }; }],
    ['remove', state => { delete state.objects._old; }],
    ['add', state => { state.objects.extra = { id: 'extra', type: 'frame', name: 'Extra', deleted: false }; }],
    ['extra field', state => { Object.defineProperty(state.objects.f, 'extra', { value: undefined, enumerable: true }); }],
    ['value type', state => { Object.defineProperty(state.objects['toString'], 'x', { value: '125', enumerable: true }); }],
    ['dictionary prototype', state => { Object.setPrototypeOf(state.objects, Object.prototype); }],
    ['object prototype', state => { Object.setPrototypeOf(state.objects.f!, null); }],
  ];
  for (const [name, mutate] of mutations) {
    const { opened, edited } = movedEditFixture(); mutate(edited);
    assert.throws(() => assertNativeRectangleMove(opened, edited, 'toString'), /Native edit changed more than the preregistered rectangle move/, name);
  }
  const { opened, edited } = movedEditFixture();
  assert.throws(() => assertNativeRectangleMove(opened, edited, '_missing'), /Opened native rectangle disappeared/);
  assert.throws(() => assertNativeRectangleMove(opened, edited, 'f'), /Opened native rectangle disappeared/);
});

test('strict edit production call remains bound between native capture and native Undo with original early delta guard', async () => {
  const source = await readFile('src/evaluation/transfer.ts', 'utf8');
  const capture = source.indexOf("const edited = await capture('02-edited');"), compare = source.indexOf('assertNativeRectangleMove(opened.state, edited.state, input.stepId);'), undo = source.indexOf("stage = 'undo';", compare);
  assert.ok(capture > 0 && compare > capture && undo > compare);
  assert.ok(source.slice(capture, compare).includes("if (moved?.type !== 'step' || moved.x !== step.x + 5 || moved.y !== step.y)"));
});

test('native finalization keeps the whole parsed state, active fields and tombstones before the original Undo', async () => {
  const captures = (): { edited: NativeTransferFile; finalized: NativeTransferFile; expected: State } => {
    const { native, expected } = editOracleFixture(), raw = JSON.parse(native) as { elements: Array<Record<string, unknown>> };
    raw.elements.find(element => element.id === 'toString')!.x = 125;
    const step = expected.objects['toString']; assert.ok(step?.type === 'step'); step.x = 125;
    const bytes = JSON.stringify(raw);
    return { edited: inspectNativeTransferFile(bytes), finalized: inspectNativeTransferFile(bytes), expected };
  };
  const { edited, finalized, expected } = captures();
  assert.deepEqual(edited.state, expected, 'The independent literal native fixture and manual whole state define the truth');
  assert.deepEqual(finalized.state, expected);
  assert.equal(Object.getPrototypeOf(edited.state.objects), null); assert.equal(Object.getPrototypeOf(finalized.state.objects), null);
  assert.doesNotThrow(() => assertNativeFinalizationPreserved(edited, finalized));
  assert.deepEqual(edited.state, expected); assert.deepEqual(finalized.state, expected);
  // Exact equality of synthetic tombstones exercises this guard; the earlier native Open
  // guard still forbids retained tombstones in a real transfer attempt.
  assert.deepEqual(edited.tombstoneIds, ['_gone', '_old', 'text-gone']);
  const mutations: Array<[string, (file: NativeTransferFile) => void]> = [
    ['whole state extra key', file => { Object.defineProperty(file.state, 'extra', { value: undefined, enumerable: true }); }],
    ['object extra key', file => { Object.defineProperty(file.state.objects.f!, 'extra', { value: undefined, enumerable: true }); }],
    ['value type', file => { Object.defineProperty(file.state.objects['toString'], 'x', { value: '125', enumerable: true }); }],
    ['small coordinate delta', file => { const step = file.state.objects['toString']; assert.ok(step?.type === 'step'); step.x = 125.001; }],
    ['frame name', file => { const frame = file.state.objects.f; assert.ok(frame?.type === 'frame'); frame.name = 'Different'; }],
    ['arrow relation', file => { const arrow = file.state.objects._edge; assert.ok(arrow?.type === 'arrow'); arrow.to = 'toString'; }],
    ['deleted state', file => { file.state.objects._gone!.deleted = false; }],
    ['remove state object', file => { delete file.state.objects._old; }],
    ['add state object', file => { file.state.objects.extra = { id: 'extra', type: 'frame', name: 'Extra', deleted: false }; }],
    ['state prototype', file => { Object.setPrototypeOf(file.state, null); }],
    ['dictionary prototype', file => { Object.setPrototypeOf(file.state.objects, Object.prototype); }],
    ['object prototype', file => { Object.setPrototypeOf(file.state.objects.f!, null); }],
    ['active frame geometry', file => { file.activeElements.find(element => element.id === 'f')!.width = 901; }],
    ['active original label', file => { file.activeElements.find(element => element.id === 'text-a')!.originalText = 'Different'; }],
    ['active arrowhead', file => { file.activeElements.find(element => element.id === '_edge')!.endArrowhead = null; }],
    ['active binding', file => { file.activeElements.find(element => element.id === '_edge')!.endBinding = 'toString'; }],
    ['active back-reference', file => { file.activeElements.find(element => element.id === 'toString')!.boundElements = []; }],
    ['active extra key', file => { Object.defineProperty(file.activeElements[0], 'extra', { value: undefined, enumerable: true }); }],
    ['add tombstone', file => { file.tombstoneIds.push('_extra'); }],
    ['remove tombstone', file => { file.tombstoneIds.pop(); }],
    ['tombstone order', file => { file.tombstoneIds.reverse(); }],
  ];
  for (const [name, mutate] of mutations) {
    const { edited, finalized, expected } = captures();
    assert.deepEqual(edited.state, expected); assert.deepEqual(finalized.state, expected);
    mutate(finalized);
    assert.throws(() => assertNativeFinalizationPreserved(edited, finalized), /Native finalization changed the edited state or preservation fields/, name);
    assert.deepEqual(edited.state, expected, 'The finalization guard must not rewrite its expected scene');
  }
  const source = await readFile('src/evaluation/transfer.ts', 'utf8'), undoStage = source.indexOf("stage = 'undo';");
  const escape = source.indexOf("await observe(() => nativePage.keyboard.press('Escape'));", undoStage);
  const capture = source.indexOf("const finalized = await capture('02-finalized');", escape);
  const guard = source.indexOf('assertNativeFinalizationPreserved(edited, finalized);', capture);
  const undo = source.indexOf('await observe(() => nativePage.keyboard.press(`${modifier}+z`));', guard);
  const restore = source.indexOf('await observe(() => nativePage.waitForFunction(({ id, x })', undo);
  assert.ok(undoStage > 0 && escape > undoStage && capture > escape && guard > capture && undo > guard && restore > undo);
  assert.equal(source.slice(undoStage, undo).match(/nativePage\.keyboard\.press\('Escape'\)/g)?.length, 1);
});

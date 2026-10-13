import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readdir, readFile, realpath, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createAuthorController } from '../../src/host/author-controller.ts';
import { observationRef } from '../../src/authoring/index.ts';
import { makeRecording } from './recorder-fixture.ts';
import type { AuthorProject } from '../../src/authoring/types.ts';

async function capture(controller: Awaited<ReturnType<typeof createAuthorController>>) {
  const fixture = makeRecording();
  let view = await controller.view();
  view = await controller.start({ expectedRevision: view.revision, metadata: { author: 'Local scripted author', license: 'CC0-1.0', consent: 'Self-created; no personal information.', demonstration: 'scripted' }, initial: fixture.initial, fontsReady: true });
  view = await controller.gesture({ expectedRevision: view.revision, gesture: fixture.gestures[0]! });
  const stopped = await controller.stop({ expectedRevision: view.revision });
  return { view: stopped.view, recording: await controller.read(stopped.recordingId) };
}
function taskProject(project: AuthorProject): AuthorProject {
  const candidate = structuredClone(project);
  const task = { id: 'create', title: { en: 'Create a step', de: 'Schritt erstellen' }, prompt: { en: 'Create Start in the frame.', de: 'Erstelle Start im Rahmen.' }, goal: { op: 'exists' as const, type: 'step' as const, as: 's', where: { op: 'eq' as const, left: { kind: 'field' as const, variable: 's', field: 'label' }, right: { kind: 'literal' as const, value: 'Start' } } }, hints: [{ en: "Create a rectangle with a bound label.", de: "Erstelle ein Rechteck mit gebundener Beschriftung." }], errorClasses: [] };
  candidate.tasks = [{ task, solutions: { default: [{ name: 'add_step', params: { frameId: 'f', label: 'Start', x: 10, y: 20, width: 180, height: 100, fontFamily: 3 } }] } }];
  const right = structuredClone(candidate.initialState);
  right.objects.b = { id: 'b', type: 'step', deleted: false, frameId: 'f', label: 'Start', x: 10, y: 20, width: 180, height: 100, fontFamily: 3 };
  const alternative = structuredClone(right); if (alternative.objects.b?.type === 'step') alternative.objects.b.x = 60;
  candidate.checkerFixtures = [{ taskId: 'create', kind: 'reference', state: right, expected: true }, { taskId: 'create', kind: 'alternative', state: alternative, expected: true }, { taskId: 'create', kind: 'near-miss', state: candidate.initialState, expected: false }];
  return candidate;
}
test('author project edits cannot remove excluded sources or change admission by shrinking the source set',async()=>{
  const dir=await mkdtemp(join(await realpath(tmpdir()),'pn-author-source-retention-'));
  const controller=await createAuthorController(dir);
  try{
    await capture(controller);
    const fixture=makeRecording(),gesture=structuredClone(fixture.gestures[0]!);
    gesture.unmodeled=[{id:'b',attributes:['opacity'],reason:'Synthetic unsupported change'}];
    let view=await controller.view();
    view=await controller.start({expectedRevision:view.revision,metadata:{author:'Local scripted author',license:'CC0-1.0',consent:'Synthetic evidence; no personal data.',demonstration:'scripted'},initial:fixture.initial,fontsReady:true});
    view=await controller.gesture({expectedRevision:view.revision,gesture});
    const stopped=await controller.stop({expectedRevision:view.revision});
    const second=await capture(controller);
    view=await controller.analyze(second.view.revision);
    const before=structuredClone(view),candidate=structuredClone(view.project!);
    candidate.recordingIds=candidate.recordingIds.filter(id=>id!==stopped.recordingId);
    await assert.rejects(controller.project(candidate,view.revision),error=>error instanceof Error&&'code' in error&&error.code==='evidence_required');
    assert.deepEqual(await controller.view(),before);
    await assert.rejects(controller.confirm({expectedRevision:view.revision,confirmation:{hypothesisId:'create-step-v1',evidence:observationRef(second.recording,0)}}),/evidence_unmodeled/);
    assert.deepEqual((await controller.read(stopped.recordingId)).gestures[0]!.unmodeled,gesture.unmodeled);
    const fresh=await controller.prepare({expectedRevision:view.revision,title:'Separate supported project',author:'Synthetic author',labels:['A','B','C']});
    assert.notEqual(fresh.view.project!.id,before.project!.id);
    assert.deepEqual(fresh.view.project!.recordingIds,[]);
    assert.deepEqual((await controller.read(stopped.recordingId)).gestures[0]!.unmodeled,gesture.unmodeled);
  }finally{await controller.close();await rm(dir,{recursive:true,force:true});}
});
test('author host requires new evidence, compiles private files and deletion revokes persisted derivatives across sessions', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-author-host-'));
  const controller = await createAuthorController(join(dir, '.local'));
  try {
    const first = await capture(controller);
    let view = await controller.analyze(first.view.revision);
    assert.equal(view.project?.hypotheses[0]?.status, 'proposed');
    const forged = structuredClone(view.project!); forged.hypotheses[0]!.status = 'confirmed'; forged.hypotheses[0]!.confirmingEvidence = [observationRef(first.recording, 0)];
    await assert.rejects(controller.project(forged, view.revision), /only change through observations/);
    await assert.rejects(controller.confirm({ expectedRevision: view.revision, confirmation: { hypothesisId: 'create-step-v1', evidence: observationRef(first.recording, 0) } }), /confirmation_requires_new_observation/);
    const second = await capture(controller);
    view = await controller.analyze(second.view.revision);
    view = await controller.confirm({ expectedRevision: view.revision, confirmation: { hypothesisId: 'create-step-v1', evidence: observationRef(second.recording, 0) } });
    view = await controller.project(taskProject(view.project!), view.revision);
    const result = await controller.compile(view.revision);
    assert.equal(result.report.demonstrationsPerRule && (result.report.demonstrationsPerRule as Record<string, number>)['create-step-v1'], 2);
    const files = await readdir(join(dir, '.local/author')); assert.equal(files.length, 3);
    assert.ok((await readFile(join(dir, '.local/author', String(result.report.localWorldFile)))).length > 0);
    const quotaFiles = Array.from({ length: 93 }, (_, i) => join(dir, '.local/author', `quota-${i}.pncheck`));
    for (const file of quotaFiles) await writeFile(file, '', { flag: 'wx', mode: 0o600 });
    await assert.rejects(controller.compile(view.revision), /persistent budget/);
    assert.equal((await readdir(join(dir, '.local/author'))).length, 96);
    for (const file of quotaFiles) await unlink(file);
    await controller.close();
    const deleted = spawnSync(process.execPath, [new URL('../../src/cli/main.ts', import.meta.url).pathname, 'record', 'delete', first.recording.manifest.id], { cwd: dir, env: { ...process.env, PRACTONAUT_HOME: join(dir, '.local') }, encoding: 'utf8' });
    assert.equal(deleted.status, 0, deleted.stderr);
    assert.equal((await readdir(join(dir, '.local/author'))).length, 0);
    const reopened = await createAuthorController(join(dir, '.local'));
    try { assert.equal((await reopened.view()).recordings.length, 1); } finally { await reopened.close(); }
  } finally { await controller.close(); await rm(dir, { recursive: true, force: true }); }
});

test('author host rejects stale writes, missing fonts and forged replay before changing its view', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-author-reject-'));
  const controller = await createAuthorController(dir);
  try {
    const first = await capture(controller); const before = await controller.view();
    await assert.rejects(controller.analyze(before.revision - 1), /changed since this request/);
    await assert.rejects(controller.delete('../outside', before.revision), /recording_invalid/);
    assert.deepEqual(await controller.view(), before);
    const fixture = makeRecording();
    const request = { expectedRevision: before.revision, metadata: first.recording.manifest, initial: fixture.initial, fontsReady: false };
    await assert.rejects(controller.start(request as never), /Fonts must be ready/);
    const started = await controller.start({ ...request, metadata: { author: 'Script', license: 'CC0-1.0', consent: 'Synthetic', demonstration: 'scripted' }, fontsReady: true });
    const tampered = structuredClone(fixture.gestures[0]!); tampered.events = [];
    await assert.rejects(controller.gesture({ expectedRevision: started.revision, gesture: tampered }), /replay_mismatch/);
    assert.equal((await controller.view()).recording.gestures, 0);
  } finally { await controller.close(); await rm(dir, { recursive: true, force: true }); }
});

test('author stop saves a large recording independently of its large project response', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-author-response-'));
  const controller = await createAuthorController(dir);
  try {
    const first = await capture(controller);
    let view = await controller.analyze(first.view.revision);
    const project = structuredClone(view.project!);
    project.variants[0]!.labels = Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`label${i}`, 'x'.repeat(4096)]));
    view = await controller.project(project, view.revision);
    const initial = structuredClone(makeRecording().initial);
    for (let i = 0; i < 180; i++) initial.elements[`frame${i}`] = {
      id: `frame${i}`, type: 'frame', attributes: { ...initial.elements.f!.attributes, name: 'y'.repeat(4096) },
    };
    view = await controller.start({ expectedRevision: view.revision, metadata: { author: 'Script', license: 'CC0-1.0', consent: 'Synthetic size probe', demonstration: 'scripted' }, initial, fontsReady: true });
    view = await controller.gesture({ expectedRevision: view.revision, gesture: { index: 0, boundary: 'pointerup', before: initial, after: initial, events: [], unmodeled: [], quarantined: false, quarantineReasons: [] } });
    const stopped = await controller.stop({ expectedRevision: view.revision });
    assert.equal(stopped.view.recording.active, false);
    assert.equal(stopped.view.recordings.length, 2);
    const recording = await controller.read(stopped.recordingId);
    assert.ok(Buffer.byteLength(JSON.stringify(stopped)) <= 3 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(recording)) <= 3 * 1024 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify({ view: stopped.view, recording })) > 3 * 1024 * 1024, 'this is the combined-response regression case');
  } finally { await controller.close(); await rm(dir, { recursive: true, force: true }); }
});

test('every admitted recording prefix remains stoppable near 3MiB without a project', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-author-stop-boundary-'));
  const controller = await createAuthorController(dir);
  try {
    const initial = structuredClone(makeRecording().initial);
    for (let i = 0; i < 256; i++) initial.elements[`frame${i}`] = { id: `frame${i}`, type: 'frame', attributes: { ...initial.elements.f!.attributes, name: 'Base' } };
    const gesture = { index: 0, boundary: 'pointerup' as const, before: initial, after: initial, events: [], unmodeled: [], quarantined: false, quarantineReasons: [] };
    const metadata = { author: 'Script', license: 'CC0-1.0', consent: 'Synthetic boundary probe', demonstration: 'scripted' as const };
    const projected = { manifest: { ...makeRecording().manifest, id: 'r-' + '0'.repeat(32), createdAt: '2026-10-04T00:00:00.000Z', stoppedAt: '2026-10-04T00:00:00.000Z', adapterVersion: '1.0.0', ...metadata }, initial, gestures: [gesture] };
    const target = 3 * 1024 * 1024 - 16;
    let remaining = target - Buffer.byteLength(JSON.stringify(projected));
    for (let i = 0; i < 256 && remaining >= 3; i++) {
      const amount = Math.min(4092, Math.floor(remaining / 3));
      initial.elements[`frame${i}`]!.attributes.name = 'Base' + 'y'.repeat(amount);
      remaining -= amount * 3;
    }
    let view = await controller.start({ expectedRevision: 0, metadata, initial, fontsReady: true });
    view = await controller.gesture({ expectedRevision: view.revision, gesture });
    const stopped = await controller.stop({ expectedRevision: view.revision });
    assert.equal(stopped.view.recording.active, false);
    assert.equal(stopped.view.revision, view.revision + 1);
    const saved = await controller.read(stopped.recordingId);
    const bytes = Buffer.byteLength(JSON.stringify(saved));
    assert.ok(bytes <= 3 * 1024 * 1024 && bytes > 3 * 1024 * 1024 - 32, `the actual saved boundary recording is ${bytes} bytes`);
    assert.equal(saved.gestures.length, 1);
    assert.ok(Buffer.byteLength(JSON.stringify(stopped)) < 4096, 'the stop acknowledgement stays small even at the recording ceiling');
  } finally { await controller.close(); await rm(dir, { recursive: true, force: true }); }
});

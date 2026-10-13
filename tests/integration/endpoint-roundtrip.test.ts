import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host/server.ts';
import { HOST_ROUTES, TOKEN_HEADER, type HostView, type MutationReply, type RunningHost } from '../../src/host/protocol.ts';
import { AUTHOR_ROUTES, type AuthorView, type AuthorPreparedReply } from '../../src/host/author-protocol.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import { makeRecording } from '../unit/recorder-fixture.ts';

async function localHost(run: (host: RunningHost, directory: string, authorToken: string) => Promise<void>) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-endpoint-roundtrip-'));
  const raw = JSON.parse(await readFile('tests/fixtures/core/world.json', 'utf8'));
  // The foundation kernel fixture uses font 1. This editor route probe deliberately uses
  // the supported licensed native font 3, without changing a product world or adapter.
  raw.app.fontFamilies = [3];
  for (const object of Object.values(raw.initialState.objects) as Array<{ type: string; fontFamily?: number }>) if (object.type === 'step') object.fontFamily = 3;
  const world = validateWorld(raw);
  const host = await startHost(world, { mirror: 'off', phase3: true, tokenDirectory: join(directory, 'tokens'), localDirectory: join(directory, 'author') });
  try {
    const response = await fetch(host.origin + HOST_ROUTES.bootstrap, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: host.code }) });
    const bootstrap = await response.json() as { ok: boolean; value: { authorToken: string } };
    assert.equal(response.status, 200); assert.equal(bootstrap.ok, true);
    assert.equal(typeof bootstrap.value.authorToken, 'string'); assert.notEqual(bootstrap.value.authorToken, host.token, 'author and practice capabilities must differ');
    await run(host, directory, bootstrap.value.authorToken);
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
}
async function post<T>(host: RunningHost, path: string, payload: unknown, token = host.token): Promise<T> {
  const response = await fetch(host.origin + path, { method: 'POST', headers: { [TOKEN_HEADER]: token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const reply = await response.json() as { ok: boolean; value: T; error?: { code: string; message: string } };
  assert.equal(response.status, 200, JSON.stringify(reply.error)); assert.equal(reply.ok, true);
  return reply.value;
}
async function observe(host: RunningHost): Promise<HostView> {
  return (await (await fetch(host.origin + HOST_ROUTES.observe, { headers: { [TOKEN_HEADER]: host.token } })).json() as { value: HostView }).value;
}

test('successful HTTP undo and reset restore independently saved initial state and advance revisions', async () => {
  await localHost(async host => {
    const initial = await observe(host);
    const edit = async (revision: number) => post<MutationReply>(host, HOST_ROUTES.act, { expectedRevision: revision, action: { name: 'rename_step', params: { id: 'a', label: 'Temporary HTTP label' }, baseStep: 0 } });
    const changed = await edit(initial.revision); assert.notDeepEqual(changed.view.state, initial.state);
    const undone = await post<MutationReply>(host, HOST_ROUTES.undo, { expectedRevision: changed.view.revision });
    assert.deepEqual(undone.view.state, initial.state); assert.equal(undone.view.hash, initial.hash); assert.equal(undone.view.step, 0); assert.equal(undone.view.revision, changed.view.revision + 1);
    const second = await edit(undone.view.revision);
    const reset = await post<MutationReply>(host, HOST_ROUTES.reset, { expectedRevision: second.view.revision, confirmed: true });
    assert.deepEqual(reset.view.state, initial.state); assert.equal(reset.view.hash, initial.hash); assert.equal(reset.view.step, 0); assert.equal(reset.view.attempt, second.view.attempt + 1);
    assert.deepEqual(await observe(host), reset.view);
  });
});

test('successful HTTP editor gesture commits a bounded label edit to the same observable host state', async () => {
  await localHost(async host => {
    const initial = await observe(host), before = toRaw(initial.state), after = structuredClone(before);
    const text = after.find(element => element.type === 'text' && element.containerId === 'a'); assert.ok(text);
    text.text = 'Native HTTP label'; text.originalText = 'Native HTTP label';
    const result = await post<MutationReply>(host, AUTHOR_ROUTES.editor, { expectedRevision: initial.revision, before, after, boundary: 'key' });
    const expected = structuredClone(initial.state), step = expected.objects.a; assert.ok(step && step.type === 'step'); step.label = 'Native HTTP label';
    assert.deepEqual(result.view.state, expected); assert.equal(result.view.step, 1); assert.equal(result.view.revision, initial.revision + 1);
    assert.deepEqual(await observe(host), result.view);
    // This synthetic route probe is model-only; it makes no native-user or real-engine claim.
    assert.equal(result.mirrorConfirmed, false); assert.equal(result.view.practiceEvidence, false);
  });
});

test('successful HTTP project edit persists its content and recording deletion removes the stored source', async () => {
  await localHost(async (host, directory, authorToken) => {
    const authorPost = <T>(path: string, payload: unknown): Promise<T> => post<T>(host, path, payload, authorToken);
    const prepared = await authorPost<AuthorPreparedReply>(AUTHOR_ROUTES.prepare, { expectedRevision: 0, title: 'Endpoint demonstration', labels: ['Request', 'Review', 'Archive'], author: 'Synthetic HTTP probe' });
    const project = structuredClone(prepared.view.project); assert.ok(project); project.notes = 'Saved through the public project write route.';
    const edited = await authorPost<AuthorView>(AUTHOR_ROUTES.project, { expectedRevision: prepared.view.revision, project });
    assert.equal(edited.project?.notes, project.notes); assert.equal(edited.revision, prepared.view.revision + 1);
    const observation = makeRecording();
    let current = await authorPost<AuthorView>(AUTHOR_ROUTES.start, { expectedRevision: edited.revision, initial: observation.initial, fontsReady: true,
      metadata: { author: 'Synthetic HTTP probe', license: 'CC0-1.0', consent: 'Own non-personal fixture', demonstration: 'scripted' } });
    current = await authorPost<AuthorView>(AUTHOR_ROUTES.gesture, { expectedRevision: current.revision, gesture: observation.gestures[0] });
    const stopped = await authorPost<{ view: AuthorView; recordingId: string }>(AUTHOR_ROUTES.stop, { expectedRevision: current.revision });
    assert.ok(stopped.view.recordings.some(recording => recording.id === stopped.recordingId));
    const recordingPath = join(directory, 'author', 'recordings', stopped.recordingId + '.json');
    assert.ok((await readFile(recordingPath)).length > 0);
    const deleted = await authorPost<AuthorView>(AUTHOR_ROUTES.delete, { expectedRevision: stopped.view.revision, id: stopped.recordingId });
    assert.equal(deleted.revision, stopped.view.revision + 1); assert.equal(deleted.recordings.some(recording => recording.id === stopped.recordingId), false);
    const response = await fetch(host.origin + AUTHOR_ROUTES.recording + '?id=' + stopped.recordingId, { headers: { [TOKEN_HEADER]: authorToken } });
    const failure = await response.json() as { ok: boolean; error: { code: string } };
    assert.equal(failure.ok, false);
    await assert.rejects(readFile(recordingPath), { code: 'ENOENT' });
    assert.equal(deleted.project?.notes, project.notes);
  });
});

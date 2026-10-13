import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, stat, chmod, symlink, link, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecordingStore } from '../../src/recordings/index.ts';
import { RECORDING_LIMITS } from '../../src/adapters/excalidraw/recorder.ts';
import { makeRecording } from './recorder-fixture.ts';

async function fixture(t: { after(fn: () => Promise<void>): void }) { const base = await mkdtemp(join(await realpath(tmpdir()), 'pn-recording-')); t.after(() => rm(base, { recursive: true, force: true })); return { base, root: join(base, 'recordings') }; }

test('private immutable recording save, digest checked review and actual deletion', async t => {
  const { root } = await fixture(t), store = createRecordingStore(root), recording = makeRecording();
  assert.equal(await store.save(recording), recording.manifest.id); assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, recording.manifest.id + '.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await store.read(recording.manifest.id), recording); assert.deepEqual(await store.list(), [recording.manifest]);
  await assert.rejects(store.save(recording), /EEXIST/);
  assert.deepEqual(await store.delete(recording.manifest.id), { id: recording.manifest.id, removed: [recording.manifest.id + '.json'] });
  assert.deepEqual(await readdir(root), []); await assert.rejects(store.read(recording.manifest.id), /ENOENT/);
});
test('IDs cannot escape; ancestor and leaf symlinks cannot bypass containment', async t => {
  const { base, root } = await fixture(t), store = createRecordingStore(root);
  for (const id of ['../elsewhere', '/absolute', '.', 'a/b', 'x.json']) await assert.rejects(store.read(id), /invalid recording ID/);
  await mkdir(join(base, 'elsewhere'), { mode: 0o700 }); await symlink(join(base, 'elsewhere'), root);
  await assert.rejects(store.save(makeRecording()), /ancestor/); await rm(root);
  await store.save(makeRecording()); await symlink(join(root, 'test-recording.json'), join(root, 'evil.json'));
  await assert.rejects(store.read('evil')); await assert.rejects(store.delete('evil')); assert.equal((await readFile(join(root, 'test-recording.json'))).length > 0, true);
});
test('file ownership permissions/hardlink, directory permissions and digest tampering fail closed', async t => {
  const { base, root } = await fixture(t), store = createRecordingStore(root); await store.save(makeRecording());
  const file = join(root, 'test-recording.json'); await chmod(file, 0o644); await assert.rejects(store.read('test-recording'), /unsafe recording/); await chmod(file, 0o600);
  await link(file, join(base, 'hardlink')); await assert.rejects(store.read('test-recording'), /unsafe recording/); await rm(join(base, 'hardlink'));
  const envelope = JSON.parse(await readFile(file, 'utf8')); envelope.recording.manifest.author = 'changed'; await writeFile(file, JSON.stringify(envelope));
  await assert.rejects(store.read('test-recording'), /digest mismatch/); await store.delete('test-recording');
  await chmod(root, 0o755); await assert.rejects(store.list(), /0700/);
});
test('byte/count caps reject oversized recordings before writes and bounded inventory is enforced', async t => {
  const { root } = await fixture(t), store = createRecordingStore(root), enormous = makeRecording();
  enormous.manifest.consent = 'x'.repeat(RECORDING_LIMITS.maxBytes); await assert.rejects(store.save(enormous), /byte limit/);
  await mkdir(root, { mode: 0o700, recursive: true });
  for (let i = 0; i < RECORDING_LIMITS.maxFiles; i++) await writeFile(join(root, 'r' + i + '.json'), '{}', { mode: 0o600 });
  await assert.rejects(store.save(makeRecording()), /count limit/);
  await writeFile(join(root, 'too-large.json'), 'x'.repeat(RECORDING_LIMITS.maxBytes + 300), { mode: 0o600 });
  await rm(join(root, 'r0.json')); await assert.rejects(store.list(), /byte limit/);
});
test('concurrent immutable saves serialize count accounting and do not overwrite', async t => {
  const { root } = await fixture(t), store = createRecordingStore(root);
  const results = await Promise.allSettled([store.save(makeRecording()), store.save(makeRecording())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.deepEqual((await store.list()).map(m => m.id), ['test-recording']);
});
test('separate CLI/host store instances cannot concurrently bypass writer admission', async t => {
  const { root } = await fixture(t); await mkdir(root, { mode: 0o700 });
  const first = createRecordingStore(root), second = createRecordingStore(root);
  const result = await Promise.allSettled([first.save(makeRecording('r1')), second.save(makeRecording('r2'))]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await first.list()).length, 1);
});

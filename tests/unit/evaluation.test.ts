import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, stat, readFile, writeFile, chmod, lstat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { bindClient, assertClientUnchanged, requireSameUser } from '../../src/evaluation/client.ts';
import { classifySeal, boundedProcess } from '../../src/evaluation/process.ts';
import { createPrivateOutput, exclusiveOutput, redactCredential } from '../../src/evaluation/private-output.ts';
import { publicEvaluationWorld } from '../../src/evaluation/contracts.ts';
import { validateWorld } from '../../src/world/schema.ts';

import { SUPERVISED_EVALUATION } from '../support/platform.ts';
test('Windows: supervised client evaluation is refused by name, not attempted', { skip: process.platform !== 'win32' }, () => {
  assert.throws(() => requireSameUser({ uid: 0, gid: 0, home: 'C:\\Users\\x' }), (error: unknown) => (error as { code?: string }).code === 'evaluation_identity_unsupported');
});

test('actual same-user identity never becomes sealed after a synthetic unreadable probe', { skip: SUPERVISED_EVALUATION }, () => {
  const identity = { uid: process.getuid!(), gid: process.getgid!(), home: '/unused' }, probe = { uid: identity.uid, gid: identity.gid, readable: false, reason: 'permission-denied' as const };
  assert.throws(() => classifySeal(probe, identity, false), /trust boundary/); assert.equal(classifySeal(probe, identity, true), 'unsealed');
  const other = { ...identity, uid: identity.uid + 1 }, readable = { ...probe, uid: other.uid, readable: true, reason: 'opened' as const };
  assert.throws(() => classifySeal(readable, other, false)); assert.throws(() => classifySeal(readable, other, true), /unsupported/);
  assert.throws(() => classifySeal({ ...readable, readable: false, reason: 'permission-denied' }, other, false), /unsupported/);
});
test('private evaluation outputs reject reuse and symlink ancestors, preserve ownership and exclude credential logs', { skip: SUPERVISED_EVALUATION }, async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'pn-eval-output-'));
  try { const output = await createPrivateOutput(join(root, 'report')); assert.equal((await stat(output)).mode & 0o777, 0o700);
    await exclusiveOutput(join(output, 'result'), 'first'); assert.equal((await stat(join(output, 'result'))).mode & 0o777, 0o600);
    await assert.rejects(createPrivateOutput(output)); await assert.rejects(exclusiveOutput(join(output, 'result'), 'overwrite'));
    await mkdir(join(root, 'target')); await symlink(join(root, 'target'), join(root, 'link')); await assert.rejects(createPrivateOutput(join(root, 'link', 'new')));
    assert.equal(redactCredential('token abc token code_xyz', 'token', 'code_xyz'), '[session-credential-redacted] abc [session-credential-redacted] [session-credential-redacted]');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('public evaluation world never carries held-out goal, hints or error predicates', async () => {
  const world = validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json', 'utf8'))), initialState = { objects: { f: { id: 'f', type: 'frame' as const, name: 'Assignment', deleted: false } } };
  const projected = publicEvaluationWorld(world, { id: 'H1', title: { en: 'Task', de: 'Aufgabe' }, prompt: { en: 'Build the diagram', de: 'Baue das Diagramm' }, initialState });
  const task = validateWorld(projected).tasks[0]!; assert.deepEqual(task.goal, { op: 'false' }); assert.deepEqual(task.errorClasses, []); assert.equal(task.hints.length, 1); assert.match(task.hints[0]!.en, /no correctness feedback/); assert.equal(projected.tasks.length, 1);
});
test('evaluation process caps bytes and wall time at the real process boundary', async () => {
  await assert.rejects(boundedProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { bytes: 100 }), /bounded process contract/);
  await assert.rejects(boundedProcess(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { wallMs: 50 }), /bounded process contract/);
});

test('root and cross-uid/gid are refused by the shared launcher before work', { skip: SUPERVISED_EVALUATION }, () => {
  const identity = { uid: process.getuid!(), gid: process.getgid!(), home: '/unused' };
  requireSameUser(identity);
  assert.throws(() => requireSameUser({ ...identity, uid: identity.uid + 1 }), /unsupported/);
  assert.throws(() => requireSameUser({ ...identity, gid: identity.gid + 1 }), /unsupported/);
  const original = process.getuid!; try { process.getuid = () => 0; assert.throws(() => requireSameUser({ ...identity, uid: 0 }), /unsupported/); } finally { process.getuid = original; }
});
test('pinned executable refuses PATH, symlinks, writable paths and changed bytes; fixtures retain non-genuine identity', { skip: SUPERVISED_EVALUATION }, async () => {
  const root = await mkdtemp(join(homedir(), '.pn-client-test-'));
  try {
    const path = join(root, 'client'); await writeFile(path, '#!/bin/sh\nexit 0\n'); await chmod(path, 0o700);
    const binding = await bindClient(path, true); assert.equal(binding.identityAssessment, 'fixture/non-genuine'); assert.equal(binding.kind, 'fixture-client'); assert.match(binding.sha256, /^[a-f0-9]{64}$/);
    await assertClientUnchanged(binding); await writeFile(path, '#!/bin/sh\nexit 1\n'); await assert.rejects(assertClientUnchanged(binding), /changed/);
    await assert.rejects(bindClient('claude'), /absolute/); await symlink(path, join(root, 'link')); await assert.rejects(bindClient(join(root, 'link')));
    await chmod(path, 0o720); await assert.rejects(bindClient(path), /group\/world/); await chmod(path, 0o700);
    await chmod(root, 0o770); await assert.rejects(bindClient(path), /ancestor/); await chmod(root, 0o700);
    // The sticky bit alone does not make a shared directory safe: only root's /tmp-style directory is.
    await chmod(root, 0o1777); await assert.rejects(bindClient(path), /ancestor/); await chmod(root, 0o700);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('a root-owned sticky shared directory (Linux /tmp, macOS /private/tmp) is a safe client ancestor', { skip: SUPERVISED_EVALUATION }, async () => {
  const shared = await realpath('/tmp'), info = await lstat(shared);
  assert.ok(info.uid === 0 && (info.mode & 0o1777) === 0o1777, `precondition: ${shared} is root-owned, world-writable and sticky`);
  const root = await mkdtemp(join(shared, 'pn-client-sticky-'));
  try {
    const path = join(root, 'client'); await writeFile(path, '#!/bin/sh\nexit 0\n'); await chmod(path, 0o700);
    assert.match((await bindClient(path, true)).sha256, /^[a-f0-9]{64}$/);
    // The coordinator's own directory below it must still be private.
    await chmod(root, 0o777); await assert.rejects(bindClient(path), /ancestor/); await chmod(root, 0o700);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host/server.ts';
import { createPracticeSession } from '../../src/host/session.ts';
import { validateWorld } from '../../src/world/index.ts';
import { TOKEN_HEADER } from '../../src/host/protocol.ts';
import { AUTHOR_ROUTES } from '../../src/host/author-protocol.ts';
import { makeRecording } from '../unit/recorder-fixture.ts';

test('all author/editor writes keep token, origin, JSON and schema boundaries; child origin has assets only', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-author-http-'));
  const world = validateWorld(JSON.parse(await readFile('tests/fixtures/core/world.json', 'utf8')));
  const host = await startHost(world, { mirror: 'off', phase3: true, tokenDirectory: join(dir, 'tokens'), localDirectory: join(dir, 'local') });
  const auth = { [TOKEN_HEADER]: host.token, 'Content-Type': 'application/json' };
  const call = async (path: string, headers: Record<string, string>, payload: unknown) => {
    const response = await fetch(host.origin + path, { method: 'POST', headers, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
    return { status: response.status, data: await response.json() as { ok: boolean; error?: { code: string }; value?: any } };
  };
  const observe = async () => (await (await fetch(host.origin + AUTHOR_ROUTES.observe, { headers: auth })).json() as { value: unknown }).value;
  try {
    const bootstrap = await call('/api/bootstrap', { 'Content-Type': 'application/json' }, { code: host.code });assert.equal(bootstrap.status,200);auth[TOKEN_HEADER]=bootstrap.data.value.authorToken;assert.equal(auth[TOKEN_HEADER]!==host.token,true,'author and practice capabilities must differ');
    const before = await observe();
    for (const path of Object.values(AUTHOR_ROUTES).filter(p => ![AUTHOR_ROUTES.observe, AUTHOR_ROUTES.recording, AUTHOR_ROUTES.scene, AUTHOR_ROUTES.projects].includes(p as typeof AUTHOR_ROUTES.observe))) {
      assert.equal((await call(path, { 'Content-Type': 'application/json' }, {})).data.error?.code, 'token_required');
      assert.equal((await call(path, { ...auth, Origin: 'https://foreign.invalid' }, {})).data.error?.code, 'origin_rejected');
      assert.equal((await call(path, { ...auth, 'Content-Type': 'text/plain' }, {})).data.error?.code, 'json_required');
      assert.equal((await call(path, auth, { expectedRevision: 0, unexpected: true })).data.error?.code, 'invalid_request');
      assert.deepEqual(await observe(), before);
    }
    const fixture = makeRecording();
    const started = await call(AUTHOR_ROUTES.start, auth, { expectedRevision: 0, initial: fixture.initial, fontsReady: true, metadata: { author: 'HTTP script', license: 'CC0-1.0', consent: 'Synthetic', demonstration: 'scripted' } });
    assert.equal(started.status, 200);
    const corrupted = structuredClone(fixture.gestures[0]!); corrupted.events = [];
    assert.equal((await call(AUTHOR_ROUTES.gesture, auth, { expectedRevision: started.data.value.revision, gesture: corrupted })).data.error?.code, 'replay_mismatch');
    assert.equal((await observe() as any).recording.gestures, 0);
    assert.equal((await call(AUTHOR_ROUTES.gesture, auth, ' '.repeat(65_537))).data.error?.code, 'body_too_large');
    const child = bootstrap.data.value.engineOrigin as string;
    assert.notEqual(child, host.origin);
    const shell = await fetch(child + '/editor.html');
    assert.equal(shell.status, 200); assert.match(shell.headers.get('Content-Security-Policy')!, /connect-src 'none'/);
    assert.equal((await fetch(child + '/api/author')).status, 404);
    assert.equal((await fetch(child + '/editor.js', { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal((await fetch(child + '/editor.js', { method: 'POST' })).status, 405);
    assert.equal((await fetch(child + '/editor.js?path=other')).status, 404);
    assert.equal((await fetch(host.origin + '/')).headers.get('Content-Security-Policy')!.includes(`frame-src ${child}`), true);
  } finally { await host.close(); await rm(dir, { recursive: true, force: true }); }
});

test('an oversized bootstrap does not consume its code before a usable reply', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-bootstrap-size-'));
  const world = validateWorld(JSON.parse(await readFile('tests/fixtures/core/world.json', 'utf8')));
  let large = true;
  const host = await startHost(world, { mirror: 'off', tokenDirectory: join(dir, 'tokens'), controllerFactory: async (w, options) => {
    const controller = await createPracticeSession(w, options);
    return { ...controller, view: () => ({ ...controller.view(), probe: large ? 'x'.repeat(4 * 1024 * 1024) : '' }) };
  } });
  const exchange = async () => { const response = await fetch(host.origin + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: host.code }) }); return { status: response.status, data: await response.json() as any }; };
  try {
    assert.equal((await exchange()).data.error.code, 'result_too_large');
    large = false; const reply = await exchange(); assert.equal(reply.status, 200); assert.equal(reply.data.value.token===host.token,true,'bootstrap practice capability must match');
    assert.equal((await exchange()).data.error.code, 'bootstrap_used');
  } finally { await host.close(); await rm(dir, { recursive: true, force: true }); }
});

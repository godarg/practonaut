import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host/server.ts';
import { HOST_ROUTES, TOKEN_HEADER, type HostView } from '../../src/host/protocol.ts';
import { AUTHOR_ROUTES, type AuthorFromScenesReply, type AuthorView } from '../../src/host/author-protocol.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { arrow, box } from '../support/scenes.ts';

// Raw editor elements as the Player sends them (the scene builder writes Excalidraw's own fields).
const start = [box('a', 'Draft', 100, 100), box('b', 'Send', 400, 100)].flat();
const goal = [...start, arrow('ab', 'a', 'b')].map(e => structuredClone(e));
for (const id of ['a', 'b']) { const target = goal.find(e => e.id === id)!; target.boundElements = [...((target.boundElements as unknown[] | null) ?? []), { type: 'arrow', id: 'ab' }]; }

test('author/from-scenes turns two editor scenes into a practice session, refuses with named codes', { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-from-scenes-http-'));
  const host = await startHost(loadLibrary().world, { mirror: 'off', phase3: true, taskId: 'connect', tokenDirectory: join(directory, 'tokens'), localDirectory: join(directory, 'author') });
  try {
    const bootstrap = await (await fetch(host.origin + HOST_ROUTES.bootstrap, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: host.code }) })).json() as { value: { authorToken: string } };
    const author = bootstrap.value.authorToken;
    const call = async (token: string, payload: unknown) => {
      const response = await fetch(host.origin + AUTHOR_ROUTES.fromScenes, { method: 'POST', headers: { [TOKEN_HEADER]: token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      return { status: response.status, reply: await response.json() as { ok: boolean; value?: AuthorFromScenesReply; error?: { code: string } } };
    };
    const view = await (await fetch(host.origin + AUTHOR_ROUTES.observe, { headers: { [TOKEN_HEADER]: author } })).json() as { value: AuthorView };
    const revision = view.value.revision;
    // The practice credential is not an author capability.
    assert.notEqual((await call(host.token, { expectedRevision: revision, start, goal })).status, 200);
    const made = await call(author, { expectedRevision: revision, start, goal });
    assert.equal(made.status, 200, JSON.stringify(made.reply));
    assert.match(made.reply.value!.url, /^http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32}$/);
    assert.deepEqual(made.reply.value!.task.conditions.map(c => c.en).at(-1), 'One arrow from “Draft” to “Send”.');
    assert.equal(made.reply.value!.summary.oracleActions, 1);
    const same = await call(author, { expectedRevision: revision, start, goal: start });
    assert.equal(same.reply.ok, false); assert.equal(same.reply.error?.code, 'scenes_identical');
    const stale = await call(author, { expectedRevision: revision + 7, start, goal });
    assert.equal(stale.reply.ok, false); assert.equal(stale.reply.error?.code, 'stale_base');
    const bad = await call(author, { expectedRevision: revision, start: 'nope', goal });
    assert.equal(bad.reply.ok, false); assert.equal(bad.reply.error?.code, 'invalid_request');
    // The author's own practice session is untouched.
    const practice = await (await fetch(host.origin + HOST_ROUTES.observe, { headers: { [TOKEN_HEADER]: host.token } })).json() as { value: HostView };
    assert.equal(practice.value.task.id, 'connect'); assert.equal(practice.value.step, 0);
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

// A large drawing within the 64 KiB request budget: elements in the compact form the scene parser
// accepts, start with one step, the goal with 110 (five labels repeated), so the reference
// solution has 109 actions. The derivation runs in a worker; the listener keeps answering.
const KEEP = ['id', 'type', 'x', 'y', 'width', 'height', 'angle', 'strokeColor', 'backgroundColor', 'groupIds', 'frameId', 'isDeleted', 'boundElements', 'text', 'originalText', 'containerId', 'fontFamily', 'startBinding', 'endBinding', 'points'];
const compact = (elements: Array<Record<string, unknown>>) => elements.map(e => Object.fromEntries(Object.entries(e).filter(([key]) => KEEP.includes(key))));
const many = (n: number, label = (i: number) => `S${i % 5}`) => compact(Array.from({ length: n }, (_, i) => box(`m${i}`, label(i), (i % 20) * 220, Math.floor(i / 20) * 150)).flat());

test('author/from-scenes on a large drawing runs off the event loop and refuses oversize scenes by name', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'pn-from-scenes-big-'));
  const host = await startHost(loadLibrary().world, { mirror: 'off', phase3: true, taskId: 'connect', tokenDirectory: join(directory, 'tokens'), localDirectory: join(directory, 'author') });
  try {
    const bootstrap = await (await fetch(host.origin + HOST_ROUTES.bootstrap, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: host.code }) })).json() as { value: { authorToken: string } };
    const author = bootstrap.value.authorToken;
    const revision = ((await (await fetch(host.origin + AUTHOR_ROUTES.observe, { headers: { [TOKEN_HEADER]: author } })).json()) as { value: AuthorView }).value.revision;
    const post = (payload: unknown) => fetch(host.origin + AUTHOR_ROUTES.fromScenes, { method: 'POST', headers: { [TOKEN_HEADER]: author, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const started = performance.now();
    let derivedAt = 0;
    const pending = post({ expectedRevision: revision, start: many(1), goal: many(110) }).then(response => { derivedAt = performance.now(); return response; });
    await new Promise(resolve => setTimeout(resolve, 200));
    const observed = await fetch(host.origin + HOST_ROUTES.observe, { headers: { [TOKEN_HEADER]: host.token } });
    const readAt = performance.now();
    const made = await (await pending).json() as { ok: boolean; value?: AuthorFromScenesReply; error?: { code: string; message: string } };
    assert.equal(made.ok, true, JSON.stringify(made.error)); assert.equal(made.value!.summary.oracleActions, 109);
    assert.equal(observed.status, 200);
    assert.ok(readAt < derivedAt, `observe (${Math.round(readAt - started)} ms) must answer before the derivation ends (${Math.round(derivedAt - started)} ms)`);
    assert.ok(derivedAt - started < 30_000, `from-scenes took ${Math.round(derivedAt - started)} ms`);
    // Above the step limit: a named refusal, not a long wait.
    const tooLarge = await (await post({ expectedRevision: revision, start: many(1), goal: many(201, () => '') })).json() as { ok: boolean; error?: { code: string; message: string } };
    assert.deepEqual([tooLarge.ok, tooLarge.error?.code], [false, 'scene_too_large'], JSON.stringify(tooLarge)); assert.match(tooLarge.error!.message, /201 steps; from-scenes accepts at most 200/);
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});

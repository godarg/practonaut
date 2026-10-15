// The demonstration's two routes and its event over real HTTP: offered only by a bundled-example
// session, refused like every other practice route without the session's credentials, confirmed
// like a reset, never claimable as an actor by a request, and the Player learns why a session is
// model-only from the bootstrap reply.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startHost } from '../../src/host/server.ts';
import { TOKEN_HEADER, type DemonstrationStatus, type HostEvent, type ModelOnlyNotice, type RunningHost } from '../../src/host/protocol.ts';
import { validateWorld } from '../../src/world/index.ts';
import { createBridge } from '../../src/mcp/bridge.ts';
import type { World } from '../../src/world/types.ts';

const example = async (): Promise<World> => validateWorld(JSON.parse(await readFile('examples/worlds/flow-diagram/world.json', 'utf8')));
const notice: ModelOnlyNotice = { reason: 'missing', command: 'npx practonaut setup', download: { name: 'Chromium headless shell', megabytes: 100 } };

async function fixture(world: World, options: { demonstration?: boolean; modelOnly?: ModelOnlyNotice; checks?: number } = {}): Promise<{ dir: string; host: RunningHost; close(): Promise<void> }> {
  await mkdir('.local', { recursive: true }); const dir = await mkdtemp(resolve('.local/demo-http-'));
  const assets = join(dir, 'player'); await mkdir(assets);
  for (const file of ['index.html', 'player.js', 'player.css', 'tokens.css']) await writeFile(join(assets, file), '/* fixed shell */');
  const host = await startHost(world, { mirror: 'off', seed: 42, assetDirectory: assets, tokenDirectory: join(dir, 'tokens'), ...options });
  return { dir, host, async close() { await host.close(); await rm(dir, { recursive: true, force: true }); } };
}
const headers = (host: RunningHost, extra: Record<string, string> = {}): Record<string, string> => ({ [TOKEN_HEADER]: host.token, 'Content-Type': 'application/json', ...extra });
async function post(host: RunningHost, route: string, body: unknown, extra: Record<string, string> = {}): Promise<{ status: number; code?: string; value?: unknown }> {
  const response = await fetch(host.origin + route, { method: 'POST', headers: headers(host, extra), body: JSON.stringify(body) });
  const reply = await response.json() as { ok: boolean; value?: unknown; error?: { code: string } };
  return { status: response.status, ...(reply.error ? { code: reply.error.code } : {}), ...(reply.ok ? { value: reply.value } : {}) };
}
async function revision(host: RunningHost): Promise<number> { return (await (await fetch(host.origin + '/api/observe', { headers: headers(host) })).json()).value.revision; }
/** The Player's event stream, read until `until` holds for the demonstration events seen. */
async function events(host: RunningHost, until: (statuses: Array<DemonstrationStatus | null>) => boolean): Promise<Array<DemonstrationStatus | null>> {
  const controller = new AbortController(); const statuses: Array<DemonstrationStatus | null> = [];
  const response = await fetch(host.origin + '/api/events', { headers: headers(host), signal: controller.signal });
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = '';
  // Generous: on a loaded CI runner the real mirror confirms each step slowly.
  const deadline = setTimeout(() => controller.abort(), 90_000);
  try {
    while (!until(statuses)) {
      const chunk = await reader.read(); if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const data = buffer.slice(0, split).split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5)).join('\n'); buffer = buffer.slice(split + 2);
        const event = JSON.parse(data) as HostEvent;
        if (event.type === 'demonstration') statuses.push(event.status);
      }
    }
  } finally { clearTimeout(deadline); controller.abort(); }
  return statuses;
}

test('the bundled example offers the demonstration: Player metadata, confirmation, ownership, stop and the event stream', { timeout: 240_000 }, async () => {
  const f = await fixture(await example(), { demonstration: true, modelOnly: notice });
  try {
    const boot = await (await fetch(f.host.origin + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: f.host.code }) })).json();
    assert.deepEqual(boot.value.demonstration, { tasks: ['T1', 'T2', 'T3'], status: null });
    assert.deepEqual(boot.value.modelOnly, notice, 'the Player can say why it is model-only and what gets the real engine');
    const resumed = await (await fetch(f.host.origin + '/api/resume', { headers: headers(f.host) })).json();
    assert.deepEqual(resumed.value.demonstration, boot.value.demonstration); assert.deepEqual(resumed.value.modelOnly, notice);
    // The observe view (what MCP agents read) carries neither.
    const observed = await (await fetch(f.host.origin + '/api/observe', { headers: headers(f.host) })).json();
    assert.equal('demonstration' in observed.value, false); assert.equal('modelOnly' in observed.value, false);

    // Every rejection of a practice route applies.
    const unauthenticated = await fetch(f.host.origin + '/api/demonstration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 0, confirmed: true }) });
    assert.equal(unauthenticated.status, 401); assert.equal((await unauthenticated.json()).error.code, 'token_required');
    assert.deepEqual(await post(f.host, '/api/demonstration', { expectedRevision: 0, confirmed: true }, { Origin: 'http://127.0.0.1:1' }), { status: 403, code: 'origin_rejected' });
    assert.equal((await fetch(f.host.origin + '/api/demonstration', { headers: headers(f.host) })).status, 405);
    assert.equal((await fetch(f.host.origin + '/api/demonstration', { method: 'POST', headers: { [TOKEN_HEADER]: f.host.token, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    for (const body of [{ expectedRevision: 0 }, { expectedRevision: 0, confirmed: false }, { expectedRevision: 0, confirmed: true, taskId: 'T2' }, { confirmed: true }])
      assert.deepEqual(await post(f.host, '/api/demonstration', body), { status: 400, code: 'invalid_request' }, JSON.stringify(body));
    assert.deepEqual(await post(f.host, '/api/demonstration', { expectedRevision: 7, confirmed: true }), { status: 409, code: 'stale_base' });
    assert.deepEqual(await post(f.host, '/api/demonstration/stop', { now: true }), { status: 400, code: 'invalid_request' });
    // No request can set the next attempt number (only the demonstration does, inside the host).
    for (const route of ['/api/reset', '/api/variant']) assert.deepEqual(await post(f.host, route, { expectedRevision: 0, confirmed: true, attempt: 1 }), { status: 400, code: 'invalid_request' }, route);
    // No request can claim the demonstration's actor.
    assert.deepEqual(await post(f.host, '/api/act', { expectedRevision: 0, action: { name: 'add_step', params: { frameId: 'flow-frame', label: 'x', x: 0, y: 0, width: 180, height: 100, fontFamily: 3 } }, actor: { kind: 'demonstration' } }), { status: 400, code: 'invalid_request' });
    assert.equal(await revision(f.host), 0, 'every refusal left the session unchanged');

    const watched = events(f.host, statuses => statuses.some(status => status?.state === 'finished'));
    const started = await post(f.host, '/api/demonstration', { expectedRevision: 0, confirmed: true });
    assert.equal(started.status, 200); assert.deepEqual(started.value, { state: 'running', taskId: 'T1', attempt: 2, total: 5, done: 0 });
    assert.deepEqual(await post(f.host, '/api/act', { expectedRevision: await revision(f.host), action: { name: 'move_step', params: { id: 'x', x: 0, y: 0 } } }), { status: 409, code: 'demonstration_running' });
    const statuses = await watched;
    assert.deepEqual(statuses[0], null, 'a new stream first learns the current demonstration status');
    assert.deepEqual(statuses.filter(status => status?.state === 'running').map(status => status!.done), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(statuses.at(-1), { state: 'finished', taskId: 'T1', attempt: 2, total: 5, done: 5, passed: true });
    const view = (await (await fetch(f.host.origin + '/api/observe', { headers: headers(f.host) })).json()).value;
    assert.deepEqual([...new Set(view.history.map((item: { actor: { kind: string } }) => item.actor.kind))], ['demonstration']);
    assert.equal(view.result.passed, true); assert.equal(view.result.practiceEvidence, false, 'model-only is never evidence');
    assert.deepEqual(await post(f.host, '/api/export', { expectedRevision: view.revision }), { status: 409, code: 'demonstration_attempt' });
    // Player and agent read the same: the attempt and its verdict are the demonstration's, never evidence.
    assert.equal(view.demonstration, true); assert.equal(view.result.demonstration, true);
    const resumedView = (await (await fetch(f.host.origin + '/api/resume', { headers: headers(f.host) })).json()).value.view;
    assert.equal(resumedView.demonstration, true); assert.equal(resumedView.practiceEvidence, false);
    const bridge = await createBridge({ host: f.host.origin, token: f.host.token });
    const agentView = await bridge.call('observe', { history: 0 });
    assert.ok(agentView.ok, JSON.stringify(agentView));
    const compact = agentView.value as { demonstration?: true; practiceEvidence: boolean; result: { passed: boolean; demonstration?: true } | null; history: { recent: unknown[] } };
    assert.deepEqual([compact.demonstration, compact.practiceEvidence, compact.result?.passed, compact.result?.demonstration, compact.history.recent.length], [true, false, true, true, 0]);
    const full = await bridge.call('observe', { detail: 'full' });
    assert.ok(full.ok); assert.equal((full.value as { demonstration?: true }).demonstration, true);
    const checked = await bridge.call('check_result', { expectedRevision: view.revision });
    assert.ok(checked.ok, JSON.stringify(checked));
    assert.deepEqual([checked.value.passed, checked.value.demonstration, checked.value.practiceEvidence], [true, true, false]);
    assert.deepEqual(await post(f.host, '/api/demonstration/stop', {}), { status: 200, value: statuses.at(-1) }, 'stop after the end changes nothing');
    const released = events(f.host, statuses => statuses.length >= 2);
    assert.equal((await post(f.host, '/api/reset', { expectedRevision: view.revision, confirmed: true })).status, 200);
    assert.deepEqual(await released, [statuses.at(-1), null], 'a reset ends the demonstration attempt');
    const resumedAfter = await (await fetch(f.host.origin + '/api/resume', { headers: headers(f.host) })).json();
    assert.equal(resumedAfter.value.demonstration.status, null);
  } finally { await f.close(); }
});

test('no demonstration without the bundled example, without the option or under a check limit', async () => {
  const library = validateWorld(JSON.parse(await readFile('tasks/excalidraw/world/world.json', 'utf8')));
  // A demonstration would spend a limited attempt's changes and checks (PADR-0040).
  for (const [world, demonstration, checks] of [[library, true, undefined], [await example(), false, undefined], [await example(), true, 2]] as const) {
    const f = await fixture(world, { demonstration, modelOnly: notice, ...(checks !== undefined ? { checks } : {}) });
    try {
      const boot = await (await fetch(f.host.origin + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: f.host.code }) })).json();
      assert.equal('demonstration' in boot.value, false);
      assert.deepEqual(await post(f.host, '/api/demonstration', { expectedRevision: 0, confirmed: true }), { status: 404, code: 'not_found' });
      assert.deepEqual(await post(f.host, '/api/demonstration/stop', {}), { status: 404, code: 'not_found' });
    } finally { await f.close(); }
  }
});

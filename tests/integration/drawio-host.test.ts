// PADR-0049 decision 10.1: the Player's editor and author workspaces embed Excalidraw, so a host for a
// draw.io world never offers them, even when asked to (`phase3`): no editor origin, no author token,
// and the author routes do not exist. The Excalidraw library world keeps both.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host/server.ts';
import { validateWorld } from '../../src/world/index.ts';
import { TOKEN_HEADER } from '../../src/host/protocol.ts';
import { AUTHOR_ROUTES } from '../../src/host/author-protocol.ts';

const library = JSON.parse(await readFile('tasks/excalidraw/world/world.json', 'utf8')) as Record<string, unknown>;
const drawio = validateWorld({ ...library, id: 'drawio-host-test', app: { adapterId: 'drawio', versionRange: '32.4.1' }, provenance: { ...(library.provenance as object), appVersion: '32.4.1' } });
const excalidraw = validateWorld(library);

test('a draw.io world gets the board workspace only: no editor origin, no author token, no author routes', async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-drawio-host-'));
  for (const [world, offered] of [[drawio, false], [excalidraw, true]] as const) {
    const host = await startHost(world, { mirror: 'off', phase3: true, tokenDirectory: join(dir, 'tokens'), localDirectory: join(dir, 'local') });
    try {
      const response = await fetch(host.origin + '/api/bootstrap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: host.code }) });
      const reply = await response.json() as { ok: boolean; value: { token: string; authorToken?: string; engineOrigin?: string; authorEnabled?: boolean; view: { world: { adapterId: string } } } };
      assert.equal(reply.ok, true);
      assert.equal(reply.value.view.world.adapterId, world.app.adapterId);
      assert.deepEqual([typeof reply.value.engineOrigin === 'string', typeof reply.value.authorToken === 'string', reply.value.authorEnabled === true], [offered, offered, offered], world.app.adapterId);
      const author = await fetch(host.origin + AUTHOR_ROUTES.observe, { headers: { [TOKEN_HEADER]: reply.value.authorToken ?? reply.value.token } });
      const body = await author.json() as { ok: boolean; error?: { code: string } };
      if (offered) assert.equal(body.ok, true); else assert.equal(body.error?.code, 'not_found');
    } finally { await host.close(); }
  }
  await rm(dir, { recursive: true, force: true });
});

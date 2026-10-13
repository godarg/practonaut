import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startHost } from '../../src/host/server.ts';
import { startEditorAssets } from '../../src/host/editor-assets.ts';
import { validateWorld } from '../../src/world/index.ts';

// A request target that is not a valid URL (`GET http://[ HTTP/1.1`) reaches the request handler
// unauthenticated. Every local listener must answer it with 400 and keep serving.
function raw(port: number, requestText: string): Promise<string> {
  return new Promise((done, reject) => {
    const socket = connect(port, '127.0.0.1'); const chunks: Buffer[] = [];
    socket.once('connect', () => socket.write(requestText)); socket.on('data', chunk => { chunks.push(chunk); socket.end(); });
    socket.on('error', reject); socket.on('close', () => done(Buffer.concat(chunks).toString()));
  });
}
const BAD_TARGETS = ['http://[', 'http://%', '//[::1', 'http://127.0.0.1:99999/'];

test('editor asset listener answers a malformed request target with 400 and stays up', async () => {
  const parent = 'http://127.0.0.1:1';
  const assets = await startEditorAssets(parent);
  try {
    const port = Number(new URL(assets.origin).port);
    for (const target of BAD_TARGETS) assert.match(await raw(port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 400 /, target);
    assert.match(await raw(port, `GET /editor.html HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 200 /);
  } finally { await assets.close(); }
});

test('session host (with editor port) answers a malformed request target with 400 on every port and stays up', async () => {
  await mkdir('.local', { recursive: true }); const dir = await mkdtemp(resolve('.local/host-target-'));
  const player = join(dir, 'player'); await mkdir(player);
  for (const file of ['index.html', 'player.js', 'player.css', 'tokens.css']) await writeFile(join(player, file), 'fixed');
  const world = validateWorld(JSON.parse(await readFile('tests/fixtures/core/world.json', 'utf8')));
  const host = await startHost(world, { mirror: 'off', assetDirectory: player, tokenDirectory: join(dir, 'host'), localDirectory: dir, phase3: true });
  try {
    const bootstrap = await fetch(`${host.origin}/api/bootstrap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: host.code }) });
    const engineOrigin = ((await bootstrap.json()) as { value: { engineOrigin: string } }).value.engineOrigin;
    for (const port of [host.port, Number(new URL(engineOrigin).port)]) {
      for (const target of BAD_TARGETS) assert.match(await raw(port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 400 /, `${port} ${target}`);
    }
    assert.match(await raw(host.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${host.port}\r\nConnection: close\r\n\r\n`), /^HTTP\/1\.1 200 /);
  } finally { await host.close(); await rm(dir, { recursive: true, force: true }); }
});

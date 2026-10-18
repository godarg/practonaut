// PADR-0049 decision 1.5 through the real stdio server: `mcp --task` on a draw.io world, model-only
// (no browser, no draw.io runtime needed), builds its instructions from the host's view, which carries
// the world's adapter id. The unit layer checks the texts themselves (tests/unit/display-names.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mcpInstructions } from '../../src/mcp/contracts.ts';
import type { HostReply, HostView } from '../../src/host/protocol.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const library = JSON.parse(readFileSync(join(root, 'tasks/excalidraw/world/world.json'), 'utf8')) as Record<string, unknown>;
const drawioRaw = { ...library, id: 'drawio-names-test', app: { adapterId: 'drawio', versionRange: '32.4.1' }, provenance: { ...(library.provenance as object), appVersion: '32.4.1' } };

test('mcp --task on a draw.io world, model-only: the instructions name draw.io and the view carries the adapter id', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-names-mcp-'));
  const source = join(dir, 'world'); mkdirSync(source);
  writeFileSync(join(source, 'world.json'), JSON.stringify(drawioRaw));
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/cli/main.ts'), 'mcp', '--task', source, '--task-id', 'connect', '--mirror', 'off'], stderr: 'pipe', cwd: dir, env: { ...process.env, PRACTONAUT_HOME: join(dir, 'home') } as Record<string, string> });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += String(chunk); });
  const client = new Client({ name: 'display-names-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  try {
    await client.connect(transport);
    assert.equal(client.getInstructions(), mcpInstructions('drawio'), stderr);
    assert.doesNotMatch(client.getInstructions() ?? '', /Excalidraw/);
    const raw = await client.callTool({ name: 'observe', arguments: { detail: 'full', lang: 'en' } });
    const reply = JSON.parse((raw.content as Array<{ text: string }>)[0]!.text) as HostReply<HostView>;
    assert.ok(reply.ok); assert.deepEqual(reply.value.world, { id: 'drawio-names-test', version: library.version, adapterId: 'drawio' });
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});

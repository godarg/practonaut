// The MCP Registry renders a named argument as `--task=excalidraw/connect`; the real CLI started that
// way answers initialize (needs the built Player, so it lives in the integration layer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('the real CLI: mcp --task=excalidraw/connect answers initialize', { timeout: 60_000 }, async () => {
  const child = spawn(process.execPath, [main, 'mcp', '--task=excalidraw/connect', '--mirror=off'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', chunk => { out += String(chunk); }); child.stderr.on('data', chunk => { err += String(chunk); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
  const deadline = Date.now() + 45_000;
  while (!out.includes('"id":1') && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  child.stdin.end();
  const code = child.exitCode ?? await new Promise<number | null>(resolve => child.once('exit', resolve));
  assert.match(out, /"serverInfo":\{"name":"practonaut"/, err); assert.equal(code, 0, err);
});

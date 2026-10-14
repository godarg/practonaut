// `practonaut mcp --call-log`: one line per tools/call with the tool, its result code, the exact
// bytes of the result as sent and the bridge's time — on both wire eras, including refused and
// rate-limited calls, and never any argument or reply content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { CallLogEntry } from '../../src/mcp/server.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('the call log has one exact line per tool call on both wire eras, refusals and rate limits included, and no content', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pn-call-log-'));
  try {
    for (const modern of [true, false]) {
      const log = join(dir, `${modern ? 'modern' : 'legacy'}.jsonl`);
      const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', '--task', 'excalidraw/connect', '--mirror', 'off', '--call-log', log], stderr: 'pipe' });
      const client = new Client({ name: 'call-log-test', version: '1.0.0' }, modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {});
      await client.connect(transport);
      // Every reply exactly as it arrives on the wire, by request id.
      const wire = new Map<string | number, unknown>(); const receive = transport.onmessage!;
      transport.onmessage = message => { if ('id' in message && message.id !== undefined && ('result' in message || 'error' in message)) wire.set(message.id, 'result' in message ? message.result : message.error); receive(message); };
      const sent: Array<string | number> = []; const send = transport.send.bind(transport);
      transport.send = async message => { if ('method' in message && message.method === 'tools/call' && 'id' in message && message.id !== undefined) sent.push(message.id); return send(message); };
      try {
        const observed = await client.callTool({ name: 'observe', arguments: {} });
        const view = JSON.parse((observed.content as Array<{ text: string }>)[0]!.text) as { value: { step: number; revision: number } };
        await client.callTool({ name: 'act', arguments: { name: 'rename_step', params: { id: 'MARKER_ID', label: 'MARKER_LABEL' }, baseStep: view.value.step, expectedRevision: view.value.revision } });
        await client.callTool({ name: 'act', arguments: { name: 'move_step', params: { id: 'a', x: 'MARKER_VALUE', y: 0 }, baseStep: 0, expectedRevision: 0 } });
        await client.callTool({ name: 'MARKER_TOOL', arguments: {} }).catch(() => undefined);
        // Past the request budget: the bridge refuses before any handler runs.
        await Promise.allSettled(Array.from({ length: 230 }, () => client.callTool({ name: 'list_actions', arguments: {} })));
      } finally { await client.close(); }
      const text = await readFile(log, 'utf8');
      const entries = text.trim().split('\n').map(line => JSON.parse(line) as CallLogEntry);
      assert.equal(entries.length, sent.length, 'one line per tools/call sent');
      for (const marker of ['MARKER_ID', 'MARKER_LABEL', 'MARKER_VALUE', 'MARKER_TOOL', 'Connect two steps']) assert.equal(text.includes(marker), false, marker);
      assert.deepEqual(entries.slice(0, 4).map(entry => [entry.tool, entry.code]), [['observe', 'ok'], ['act', 'precondition_failed'], ['act', 'invalid_request'], ['unknown', 'invalid_request']]);
      assert.ok(entries.some(entry => entry.code === 'rate_limited'), 'rate-limited calls are logged');
      // The logged size is the result as sent, everything the SDK added included. Refusals leave
      // before earlier calls finish, so lines follow reply order: compare as sorted lists.
      assert.equal(sent.every(id => wire.has(id)), true, 'every call was answered');
      const sizes = sent.map(id => Buffer.byteLength(JSON.stringify(wire.get(id)))).sort((a, b) => a - b);
      assert.deepEqual(entries.map(entry => entry.resultBytes).sort((a, b) => a - b), sizes, modern ? 'modern era' : 'legacy era');
      for (const entry of entries) assert.ok(entry.bridgeMs >= 0 && entry.bridgeMs < 60_000);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// `practonaut mcp --task …` starts its own host and mirror and speaks MCP over stdio: the official
// SDK client solves a library task through it, and nothing private reaches the client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { loadLibrary } from '../../src/library/index.ts';
import { MCP_INSTRUCTIONS, MCP_TOOL_NAMES, TOOL_DESCRIPTIONS } from '../../src/mcp/contracts.ts';
import type { HostReply, HostView, MutationReply, PublicCheck } from '../../src/host/protocol.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('mcp --task excalidraw/connect: self-started session, real mirror, observe → act → check_result passes', { timeout: 120_000 }, async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', '--task', 'excalidraw/connect', '--seed', '7', '--mirror', 'required'], stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += String(chunk); });
  const client = new Client({ name: 'self-start-test', version: '1.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  const outputs: unknown[] = [];
  const call = async <T>(name: string, input: Record<string, unknown>): Promise<HostReply<T>> => {
    const raw = await client.callTool({ name, arguments: input }); outputs.push(raw);
    const text = (raw.content as Array<{ type: string; text?: string }>).find(part => part.type === 'text')!.text!;
    return JSON.parse(text) as HostReply<T>;
  };
  await client.connect(transport);
  try {
    assert.equal(client.getInstructions(), MCP_INSTRUCTIONS);
    const tools = (await client.listTools()).tools; outputs.push(tools);
    assert.deepEqual(tools.map(tool => tool.name), [...MCP_TOOL_NAMES]);
    for (const tool of tools) assert.equal(tool.description, TOOL_DESCRIPTIONS[tool.name as typeof MCP_TOOL_NAMES[number]]);
    const act = tools.find(tool => tool.name === 'act')!.inputSchema as unknown as { properties: { name: { enum: string[] } } };
    assert.equal(act.properties.name.enum.length, 13, 'world/2 vocabulary from the library world');

    const observed = await call<HostView>('observe', {}); assert.equal(observed.ok, true);
    const view = (observed as { value: HostView }).value;
    assert.deepEqual([view.task.id, view.seed, view.mirror, view.practiceEvidence], ['connect', 7, 'required', true]);
    // The library oracle for connect, with ids from the observed state (no variant label is involved).
    const step = loadLibrary().library.tasks.find(task => task.id === 'connect')!.oracle.steps[0]!;
    const unchecked = await call<PublicCheck>('check_result', { expectedRevision: view.revision });
    assert.equal(unchecked.ok && unchecked.value.passed, false, 'the start state does not pass');
    const acted = await call<MutationReply>('act', { name: step.name, params: step.params, baseStep: view.step, expectedRevision: view.revision });
    assert.equal(acted.ok, true, JSON.stringify(acted));
    const after = (acted as { value: MutationReply }).value;
    assert.equal(after.mirrorConfirmed, true);
    const checked = await call<PublicCheck>('check_result', { expectedRevision: after.view.revision });
    assert.equal(checked.ok, true); assert.equal((checked as { value: PublicCheck }).value.passed, true);
    assert.equal((checked as { value: PublicCheck }).value.mode, 'real-engine');

    // Nothing private reaches the client: no goal predicate, no oracle or near misses, no link code.
    const text = JSON.stringify(outputs);
    for (const hidden of ['"op":', '"predicate"', '"goal"', 'nearMisses', '"oracle"', '"errorClasses"', '"when"']) assert.equal(text.includes(hidden), false, hidden);
    const code = /#code=([0-9a-f]{32})/.exec(stderr)?.[1];
    assert.ok(code, 'the one-use watch link is printed on stderr');
    assert.equal(text.includes(code), false, 'the link code never reaches the MCP client');
    assert.match(stderr, /Practonaut MCP: task connect \(world excalidraw-library\), seed 7, real-engine/);
  } finally { await client.close(); }
});

test('mcp --task refuses an unknown task and a mixed attach/self-start command with named errors', { timeout: 60_000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const unknown = spawnSync(process.execPath, [CLI, 'mcp', '--task', 'excalidraw/no-such-task', '--mirror', 'off'], { encoding: 'utf8', input: '' });
  assert.notEqual(unknown.status, 0); assert.equal(unknown.stdout, ''); assert.match(unknown.stderr, /world not found|unknown/);
  const mixed = spawnSync(process.execPath, [CLI, 'mcp', '--task', 'connect', '--host', 'http://127.0.0.1:9'], { encoding: 'utf8', input: '' });
  assert.equal(mixed.status, 3); assert.equal(mixed.stdout, ''); assert.match(mixed.stderr, /refused: invalid_request/);
});

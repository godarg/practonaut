// Task limits through the real MCP bridge (PADR-0040): `mcp --task <world> --checks 1` on a world/2
// task with an action limit. observe and every mutation reply carry the counts, check_result says how
// many checks remain, and a used-up limit is refused by name without changing the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { HostReply, PublicCheck } from '../../src/host/protocol.ts';
import type { ErrorClass } from '../../src/world/types.ts';
import type { CompactView, MutationResult } from '../../src/mcp/replies.ts';
import { v2Task, v2World } from '../support/world-v2.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('mcp --task --checks: limits in observe and replies, refusals by name, nothing changed by a refusal', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-mcp-limits-'));
  const source = join(dir, 'world'); await mkdir(source);
  // The task allows two changes and three checks; --checks 1 lowers the check limit to one.
  await writeFile(join(source, 'world.json'), JSON.stringify(v2World({ tasks: [v2Task({ limits: { actions: 2, checks: 3 } })] })));
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', '--task', source, '--mirror', 'off', '--checks', '1'], stderr: 'pipe', env: { ...process.env } as Record<string, string> });
  const client = new Client({ name: 'limits-test', version: '1.0.0' });
  const call = async <T>(name: string, input: Record<string, unknown>): Promise<HostReply<T>> => {
    const raw = await client.callTool({ name, arguments: input });
    return JSON.parse((raw.content as Array<{ type: string; text?: string }>).find(part => part.type === 'text')!.text!) as HostReply<T>;
  };
  await client.connect(transport);
  try {
    const observed = await call<CompactView>('observe', {});
    assert.ok(observed.ok);
    assert.deepEqual(observed.value.limits, { actions: { limit: 2, used: 0 }, checks: { limit: 1, used: 0 } });
    const moved = await call<MutationResult>('act', { name: 'move_step', params: { id: 'a', x: 120, y: 100 }, baseStep: 0, expectedRevision: 0 });
    assert.ok(moved.ok);
    assert.deepEqual(moved.value.limits, { actions: { limit: 2, used: 1 }, checks: { limit: 1, used: 0 } });
    const checked = await call<PublicCheck>('check_result', { expectedRevision: moved.value.revision });
    assert.ok(checked.ok); assert.equal(checked.value.passed, false); assert.equal(checked.value.checksRemaining, 0);
    const again = await call<PublicCheck>('check_result', { expectedRevision: moved.value.revision });
    assert.equal(!again.ok && again.error.code, 'check_budget_exhausted');
    const undone = await call<MutationResult>('undo', { expectedRevision: moved.value.revision });
    assert.ok(undone.ok); assert.deepEqual(undone.value.limits?.actions, { limit: 2, used: 2 });
    const refused = await call<MutationResult>('act', { name: 'connect', params: { from: 'b', to: 'c' }, baseStep: undone.value.step, expectedRevision: undone.value.revision });
    assert.equal(!refused.ok && refused.error.code, 'action_budget_exhausted');
    const after = await call<CompactView>('observe', {});
    assert.ok(after.ok);
    assert.equal(after.value.revision, undone.value.revision, 'the refused act changed nothing');
    assert.equal(Object.values(after.value.state.objects).filter(object => object.type === 'arrow').length, 1);
  } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
});

test('mcp --checks outside 0–1000 is a usage error', { timeout: 60_000 }, async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [CLI, 'mcp', '--task', 'excalidraw/connect', '--checks', '1001'], { encoding: 'utf8', input: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--checks must be a whole number from 0 to 1000/);
});

test('mcp: under a check limit, error classes reach the agent only through a counted check_result (review S6)', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-mcp-errors-'));
  const source = join(dir, 'world'); await mkdir(source);
  // A hand-written error class that holds on the start board (one arrow).
  const missing: ErrorClass = { id: 'arrow-missing', category: 'accepted_but_violates_goal', when: { op: 'eq', left: { kind: 'count', type: 'arrow', as: 'n', where: { op: 'true' } }, right: { kind: 'literal', value: 1 } }, explanation: { en: 'The arrow to Ship is still missing.', de: 'Der Pfeil zu Versand fehlt noch.' } };
  await writeFile(join(source, 'world.json'), JSON.stringify(v2World({ tasks: [v2Task({ limits: { checks: 1 }, errorClasses: [missing] })] })));
  const transport = new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp', '--task', source, '--mirror', 'off'], stderr: 'pipe', env: { ...process.env } as Record<string, string> });
  const client = new Client({ name: 'limits-test', version: '1.0.0' });
  const call = async <T>(name: string, input: Record<string, unknown>): Promise<HostReply<T>> => {
    const raw = await client.callTool({ name, arguments: input });
    return JSON.parse((raw.content as Array<{ type: string; text?: string }>).find(part => part.type === 'text')!.text!) as HostReply<T>;
  };
  await client.connect(transport);
  try {
    type Explained = { result: PublicCheck | null; errors: Array<{ id: string }> };
    const observed = await call<CompactView>('observe', {});
    assert.ok(observed.ok); assert.deepEqual(observed.value.errors, []);
    const before = await call<Explained>('explain_result', {});
    assert.ok(before.ok); assert.deepEqual([before.value.result, before.value.errors], [null, []]);
    const moved = await call<MutationResult>('act', { name: 'move_step', params: { id: 'a', x: 120, y: 100 }, baseStep: 0, expectedRevision: 0 });
    assert.ok(moved.ok); assert.deepEqual(moved.value.errors, []);
    const checked = await call<PublicCheck>('check_result', { expectedRevision: moved.value.revision });
    assert.ok(checked.ok); assert.deepEqual(checked.value.errors.map(error => error.id), ['arrow-missing']);
    const after = await call<Explained>('explain_result', {});
    assert.ok(after.ok); assert.deepEqual(after.value.result?.errors.map(error => error.id), ['arrow-missing']); assert.deepEqual(after.value.errors, []);
  } finally { await client.close(); await rm(dir, { recursive: true, force: true }); }
});


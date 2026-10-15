// Run evidence (PADR-0039 A): the normalised call log, the mutation recorder and its strict reader,
// the client's own figures, and the checker's condition trace with its refusals. Expected condition
// strings are derived by hand from the task's condition sentences, written out next to each case.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clientFailure, clientResult, MAX_LOG_LINES, MAX_RECORDED_REFUSALS, MAX_REJECTED_TEXT, mutationCounts, readLogHead, MutationRecorder, normaliseCallLog, parseCallLog, parseMutations, timelineOf } from '../../src/bench/evidence.ts';
import { goalClauses, traceSession, type TraceEntry } from '../../src/checker/trace.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { Session } from '../../src/core/session.ts';
import { publicConditions } from '../../src/host/session.ts';
import { generateVariant } from '../../src/world/variant.ts';
import type { Action } from '../../src/world/types.ts';
import { clientInit } from '../../src/bench/agents.ts';

test('call log: well-formed bridge lines in order, numbered, client round trip joined by request id; anything else dropped', () => {
  const raw = [
    JSON.stringify({ id: 2, tool: 'observe', code: 'ok', resultBytes: 3728, bridgeMs: 5.4 }),
    'not json',
    JSON.stringify({ id: 3, tool: 'act', code: 'precondition_failed', resultBytes: 259, bridgeMs: 2.3, extra: 'field' }),
    JSON.stringify({ id: 4, tool: 'act', code: 'ok', resultBytes: 1138, bridgeMs: 8.8 }),
    JSON.stringify({ tool: 'observe', code: 'ok', resultBytes: 10, bridgeMs: 1 }),
    JSON.stringify({ id: 5, tool: 'act', code: '<b>', resultBytes: 1, bridgeMs: 1 }),
  ].join('\n') + '\n';
  const built = normaliseCallLog(raw, [{ id: 2, tool: 'observe', ms: 9.1 }, { id: 4, tool: 'act', ms: 11 }]);
  assert.equal(built.dropped, 3);
  assert.deepEqual(built.records.map(record => [record.seq, record.id, record.tool, record.clientMs]), [[0, 2, 'observe', 9.1], [1, 4, 'act', 11], [2, null, 'observe', null]]);
  assert.deepEqual(parseCallLog(built.text), built.records);
  // Another client: nothing to join, every client time is null ("client timing unavailable").
  assert.equal(normaliseCallLog(raw).records.every(record => record.clientMs === null), true);
  assert.throws(() => parseCallLog(built.text.replace('"seq":1', '"seq":7')), /line 2/);
  // Lines beyond the line limit, and lines the caller could not read, are counted, never lost silently.
  const line = JSON.stringify({ id: 1, tool: 'observe', code: 'ok', resultBytes: 1, bridgeMs: 1 });
  const many = normaliseCallLog(Array.from({ length: MAX_LOG_LINES + 5 }, () => line).join('\n') + '\nbroken', undefined, 3);
  assert.deepEqual([many.records.length, many.dropped, many.omitted], [MAX_LOG_LINES, 0, 5 + 1 + 3]);
});

test('reading a call log: the head up to its last whole line, the lines beyond it counted up to a bound', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pn-log-head-'));
  try {
    const path = join(dir, 'calls.bridge.jsonl'), line = (n: number) => JSON.stringify({ id: n, tool: 'act', code: 'ok', resultBytes: 1, bridgeMs: 1 });
    const text = Array.from({ length: 10 }, (_, n) => line(n)).join('\n') + '\n';
    await writeFile(path, text);
    // 3.5 lines fit: three are kept, the cut fourth and the six after it are counted.
    const limit = Math.floor(line(0).length * 3.5) + 3;
    const head = await readLogHead(path, limit);
    assert.equal(head!.text.trim().split('\n').length, 3); assert.deepEqual([head!.unreadLines, head!.countCapped], [7, false]);
    const all = await readLogHead(path, 1024 * 1024);
    assert.deepEqual([all!.text, all!.unreadLines, all!.countCapped], [text, 0, false]);
    // Counting stops after maxCounted bytes beyond the head: the count is then a lower bound, and says so.
    // Two whole lines fit in 2.5 line lengths after the cut (the cut fourth line ends inside them).
    const capped = await readLogHead(path, limit, Math.floor(line(0).length * 2.5));
    assert.equal(capped!.countCapped, true); assert.ok(capped!.unreadLines >= 2 && capped!.unreadLines < 7, String(capped!.unreadLines));
    assert.deepEqual([(await readLogHead(path, limit, 1024 * 1024))!.countCapped], [false], 'a bound past the end: an exact count');
    assert.equal(await readLogHead(join(dir, 'missing'), 10), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('mutation recorder: rejected parameters cut and scalar, budget refusals capped, positions read only when kept', () => {
  const recorder = new MutationRecorder();
  let reads = 0;
  const at = (step: number) => () => { reads++; return { step, revision: step }; };
  recorder.record({ op: 'act', action: { name: 'rename_step', params: { id: 'a', label: 'Ok' }, baseStep: 0 }, client: 'agent-one', outcome: 'accepted', position: at(1) });
  recorder.record({ op: 'act', action: { name: 'rename_step', params: { id: 'a', label: 'x'.repeat(1000), nested: { deep: true } } as never, baseStep: 1 }, client: '<script>', outcome: 'rejected', code: 'invalid_argument', position: at(1) });
  recorder.record({ op: 'undo', outcome: 'accepted', position: at(0) });
  recorder.record({ op: 'check', outcome: 'accepted', position: at(0) });
  for (let i = 0; i < MAX_RECORDED_REFUSALS + 7; i++) recorder.record({ op: 'act', action: { name: 'connect', params: {} }, outcome: 'rejected', code: 'action_budget_exhausted', position: at(0) });
  // Check refusals are capped on their own, so 100 action refusals cannot hide a check (PADR-0040).
  for (let i = 0; i < MAX_RECORDED_REFUSALS + 3; i++) recorder.record({ op: 'check', outcome: 'rejected', code: 'check_budget_exhausted', position: at(0) });
  assert.equal(recorder.records.length, 4 + 2 * MAX_RECORDED_REFUSALS); assert.equal(recorder.omitted, 10);
  assert.equal(reads, 4 + 2 * MAX_RECORDED_REFUSALS, 'an omitted refusal never reads the session');
  const rejected = recorder.records[1]!;
  assert.equal((rejected.action!.params.label as string).length, MAX_REJECTED_TEXT + 1);
  assert.equal(rejected.action!.params.nested, '[not a scalar]');
  assert.equal(rejected.client, null, 'a client name outside the allowed set is not kept');
  assert.equal(recorder.records[0]!.client, 'agent-one');
  const parsed = parseMutations(recorder.text());
  assert.deepEqual(parsed, recorder.records);
  assert.deepEqual(mutationCounts(parsed), { act: 2 + MAX_RECORDED_REFUSALS, accepted: 1, rejected: 1 + MAX_RECORDED_REFUSALS, undoCalls: 1, undos: 1, resetCalls: 0, resets: 0, checkCalls: 1 + MAX_RECORDED_REFUSALS, checks: 1 });
  const timeline = timelineOf(parsed, recorder.omitted);
  assert.ok('timeline' in timeline);
  // A check changes nothing: the checker's replay never sees it.
  assert.deepEqual(timeline.timeline, [{ seq: 0, op: 'act', action: { name: 'rename_step', params: { id: 'a', label: 'Ok' }, baseStep: 0 } }, { seq: 2, op: 'undo' }]);
  assert.throws(() => parseMutations(recorder.text().replace('"outcome":"accepted"', '"outcome":"maybe"')), /line 1/);
});

test('client figures: the last stream-json result event, every field plain or null', () => {
  const result = { type: 'result', subtype: 'success', num_turns: 7, total_cost_usd: 0.1234567891, usage: { input_tokens: 12, output_tokens: 456, cache_read_input_tokens: 7890, cache_creation_input_tokens: 3456 } };
  const out = ['{"type":"system","subtype":"init","model":"m"}', JSON.stringify({ ...result, num_turns: 1 }), JSON.stringify(result), 'trailing text'].join('\n');
  assert.deepEqual(clientResult(out), { turns: 7, costUsd: 0.123457, tokens: { input: 12, output: 456, cacheRead: 7890, cacheCreation: 3456 } });
  assert.deepEqual(clientResult(JSON.stringify({ type: 'result', num_turns: -1, total_cost_usd: 'free', usage: { input_tokens: 1.5 } })), { turns: null, costUsd: null, tokens: null });
  assert.deepEqual(clientResult('no events at all'), { turns: null, costUsd: null, tokens: null });
  // A later line that only mentions "result" and "type" is not the result event.
  const chatter = [JSON.stringify(result), JSON.stringify({ type: 'assistant', message: { content: 'the result type is fine' } }), '{"type": "res', '"result" "type"'].join('\n');
  assert.deepEqual(clientResult(chatter), { turns: 7, costUsd: 0.123457, tokens: { input: 12, output: 456, cacheRead: 7890, cacheCreation: 3456 } });
});

const { world } = loadLibrary();
const connectAB: Action = { name: 'connect', params: { from: 'a', to: 'b' } };
const connectBA: Action = { name: 'connect', params: { from: 'b', to: 'a' } };
/** The judged session after the given actions, made by the core (the checker must agree independently). */
function session(actions: Action[]): string {
  const value = new Session(world, 1, 'connect');
  for (const action of actions) { const result = value.act({ ...action, baseStep: value.step }); assert.equal(result.ok, true); }
  return JSON.stringify(value.serialize());
}
const act = (seq: number, action: Action, baseStep: number): TraceEntry => ({ seq, op: 'act', action: { ...action, baseStep } });

test('condition trace: the checker judges every state the run passed through, undo and reset included', () => {
  // connect's conditions: exactly 2 steps · exactly 1 arrow · rectangle “l2” · rectangle “l1” · arrow from “l1” to “l2”
  // (a is l1, b is l2). Start: 2 steps, no arrow → 1 0 1 1 0.
  const trace = traceSession(world, session([connectBA]), [act(0, connectAB, 0), { seq: 1, op: 'undo' }, act(3, connectBA, 0)], { seed: 1, taskId: 'connect' });
  assert.deepEqual(trace.conditions, ['goal-1', 'goal-2', 'goal-3', 'goal-4', 'goal-5']);
  assert.equal(trace.start, '10110');
  // a→b meets everything; undo returns to the start; b→a has one arrow, but in the wrong direction.
  assert.deepEqual(trace.points, [{ seq: 0, step: 1, met: '11111' }, { seq: 1, step: 0, met: '10110' }, { seq: 3, step: 1, met: '11110' }]);
  const reset = traceSession(world, session([connectBA]), [act(0, connectAB, 0), { seq: 1, op: 'reset' }, act(2, connectBA, 0)], { seed: 1, taskId: 'connect' });
  assert.deepEqual(reset.points.map(point => point.met), ['11111', '10110', '11110']);
});

test('condition trace: a timeline that does not end in the judged session, or holds an invalid action, is refused', () => {
  const refused = (error: unknown): boolean => (error as { code?: string }).code === 'artifact_invalid';
  // The log says a→b was the last action, but the judged session holds b→a.
  assert.throws(() => traceSession(world, session([connectBA]), [act(0, connectAB, 0)]), refused);
  // An action the checker's own transitions do not accept.
  assert.throws(() => traceSession(world, session([connectBA]), [act(0, { name: 'connect', params: { from: 'a', to: 'zz' } }, 0), act(1, connectBA, 0)]), refused);
  // A wrong seed or task for the session.
  assert.throws(() => traceSession(world, session([connectBA]), [act(0, connectBA, 0)], { seed: 2 }), refused);
});

test('the checker splits every library goal into the same conditions the Player and MCP show', () => {
  for (const seed of [1, 2]) {
    const variant = generateVariant(world, seed);
    for (const task of variant.tasks) assert.deepEqual(goalClauses(task.goal).map((_, index) => `goal-${index + 1}`), publicConditions(task).map(condition => condition.id), task.id);
  }
});

test('client failures: a usage or rate limit and an API error are the client\'s, error_max_turns and other agent errors are not (review B-A)', () => {
  const lines = (...events: unknown[]): string => events.map(event => JSON.stringify(event)).join('\n') + '\n';
  const init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5' };
  assert.deepEqual(clientFailure(lines(init, { type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } })), { reason: 'usage_limit', detail: 'rate_limit_event not allowed' });
  assert.equal(clientFailure(lines(init, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } })), null);
  assert.equal(clientFailure(lines(init, { type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1760000000' }))?.reason, 'usage_limit');
  assert.equal(clientFailure(lines(init, { type: 'result', subtype: 'success', is_error: true, result: 'x', api_error_status: 429 }))?.reason, 'usage_limit');
  assert.equal(clientFailure(lines(init, { type: 'result', subtype: 'success', is_error: true, result: 'API Error: 529 overloaded' }))?.reason, 'api_error');
  assert.equal(clientFailure(lines(init, { type: 'assistant', isApiErrorMessage: true, message: {} }))?.reason, 'api_error');
  assert.equal(clientFailure(lines(init, { type: 'assistant', error: 'rate_limit', message: {} }))?.reason, 'usage_limit');
  // The agent's own failures.
  assert.equal(clientFailure(lines(init, { type: 'result', subtype: 'error_max_turns', is_error: true, result: 'rate limit is mentioned in passing' })), null);
  assert.equal(clientFailure(lines(init, { type: 'result', subtype: 'error_during_execution', is_error: true })), null);
  assert.equal(clientFailure(lines(init, { type: 'result', subtype: 'success', is_error: false, result: 'I hit the usage limit of patience' })), null, 'not an error result');
  assert.equal(clientFailure('not json\n{"type":"result","is_error":true,"result":"API Error"'), null, 'a cut line is not an event');
});

test('model ids may carry a bracketed suffix; init records Claude Code\'s version (review S-5)', () => {
  assert.deepEqual(clientInit('{"type":"system","subtype":"init","model":"claude-opus-5-5[1m]","apiKeySource":"none","claude_code_version":"2.1.3"}\n'), { model: 'claude-opus-5-5[1m]', apiKeySource: 'none', version: '2.1.3' });
  assert.equal(clientInit('{"type":"system","subtype":"init","model":"claude-opus-5-5[<b>]"}').model, null);
  assert.equal(clientInit('{"type":"system","subtype":"init","model":"m","claude_code_version":"2 1"}').version, null);
});


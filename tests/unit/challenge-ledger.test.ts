// The 0.3.0 release ledger (PADR-0042 decision 4, PADR-0044 decisions 5 and 8, as amended on
// acceptance): its hash chain and canonical lines, the count against the cap and what releases a
// reservation, the prefix rule for committed versions, and the start guard on the file: a local
// ledger only by `ledger init`, the committed one its prefix, one writer at a time, and a start that
// would pass 800 refused. Records are built here line by line; the expected counts are counted by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countLedger, exemptEnd, headerLine, isPrefix, nextLine, parseLedger, type LedgerRecord, type RunEndBody, type StartBody } from '../../src/challenge/ledger.ts';
import { initLedger, ledgerGuard, readLedger, writeCommittedLedger } from '../../src/challenge/ledger-file.ts';
import { presetRun } from '../support/challenge-round.ts';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const start = (index: number, extra: Partial<StartBody> = {}): StartBody => ({ kind: 'start', purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: 'claude-opus-5-5', agent: 'claude-code', bench: '20261102T100000Z-0001', run: `connect-s${index + 1}-r1`, ...extra });
const end = (startSeq: number, extra: Partial<RunEndBody> = {}): RunEndBody => ({ kind: 'run-end', start: startSeq, toolchain: 'practonaut', rules: null, status: 'completed', judged: 'a'.repeat(64), stdout: 'b'.repeat(64), checker: 'c'.repeat(64), observed: { class: 'api-key', source: 'client-attested' }, failure: null, hostCalls: 3, reads: 1, tokens: 15, ...extra });
/** A ledger text from bodies, appended in order (O(n): the records are kept, not re-parsed). */
function build(bodies: Array<StartBody | RunEndBody | ((records: LedgerRecord[]) => StartBody | RunEndBody)>): string {
  const state = { text: headerLine(), records: [parseLedger(headerLine()).header] as LedgerRecord[] };
  for (const value of bodies) {
    const { record, line } = nextLine(state, typeof value === 'function' ? value(state.records) : value);
    state.text += line; state.records.push(record);
  }
  return state.text;
}

test('the ledger is a hash chain of canonical lines: the header first, seq the line index, prev the SHA-256 of the line before', () => {
  const text = build([start(0), end(1)]);
  const lines = text.slice(0, -1).split('\n');
  assert.equal(lines.length, 3);
  // Written by hand: the header's canonical JSON, keys sorted.
  assert.equal(lines[0], `{"cap":800,"kind":"release","prev":"${'0'.repeat(64)}","release":"0.3.0","schema":"practonaut.release-ledger/1","seq":0}`);
  assert.equal(JSON.parse(lines[1]!).prev, sha(lines[0]!));
  assert.equal(JSON.parse(lines[2]!).prev, sha(lines[1]!));
  const invalid = (value: string, message: RegExp): void => assert.throws(() => parseLedger(value), (error: unknown) => (error as { code?: string }).code === 'ledger_invalid' && message.test((error as Error).message), message.source);
  invalid(text.slice(0, -1), /does not end with a complete line/);
  invalid(text.replace(lines[1]!, lines[1]!.replace('{"agent"', '{ "agent"')), /line 2: not in canonical form/);
  invalid(build([start(0)]).replace('"seq":1', '"seq":2'), /line 2: seq 2, expected 1/);
  // A changed line breaks the chain at the next one.
  const changed = text.replace(lines[1]!, lines[1]!.replace('connect-s1-r1', 'connect-s9-r1'));
  invalid(changed, /line 3: its prev is not the SHA-256 of the line before/);
  invalid(build([start(0), end(1), end(1)]), /start entry 1 has a run-end record already/);
  invalid(build([end(0)]), /its start entry 0 is not an earlier start entry/);
  invalid(build([start(0), end(1, { toolchain: 'excalidraw-mcp-0.3.2' })]), /its toolchain or rules version differs from start entry 1/);
  assert.throws(() => parseLedger(text, '0.4.0'), /counts release 0\.3\.0, not 0\.4\.0/);
});

test('the count: every start entry until its run-end releases it — a local run attested local, or a run the client refused before model work', () => {
  const usage = { reason: 'usage_limit' as const, parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true };
  const text = build([
    start(0), end(1),                                                        // counted
    start(1),                                                                // open: counted
    start(2, { requested: 'local' }), end(4, { observed: { class: 'local', source: 'client-attested' } }),        // released: local
    start(3, { requested: 'local' }), end(6, { observed: { class: 'local', source: 'preset-requested' } }),       // counted: not attested
    start(4), end(8, { observed: { class: 'local', source: 'client-attested' } }),                                // counted: requested api-key
    start(5), end(10, { status: 'infra_error', failure: usage, hostCalls: 0, reads: 0, tokens: null }),           // released: exempt
    start(6), end(12, { status: 'infra_error', failure: { ...usage, reason: 'api_error' }, hostCalls: 0, reads: 0, tokens: null }), // counted
  ]);
  assert.deepEqual(countLedger(parseLedger(text)), { starts: 7, counted: 5, local: 1, exempt: 1, open: 1 });
  // The exemption, from structure only.
  const exempt = end(0, { status: 'infra_error', failure: usage, hostCalls: 0, reads: 1, tokens: 0 });
  assert.equal(exemptEnd(exempt), true);
  for (const [why, change] of [
    ['after model work', { failure: { ...usage, beforeModelWork: false } }], ['unknown', { failure: { ...usage, beforeModelWork: null } }],
    ['auth only with its parser', { failure: { ...usage, reason: 'auth' as const, parser: 'x/1' } }], ['a runner reason', { failure: { reason: 'runner' as const, parser: null, code: null, beforeModelWork: null } }],
    ['a host call', { hostCalls: 1 }], ['two reads', { reads: 2 }], ['tokens', { tokens: 3 }], ['a judged run', { status: 'completed' as const }], ['server_error', { failure: { ...usage, reason: 'server_error' as const } }],
  ] as const) assert.equal(exemptEnd({ ...exempt, ...change } as RunEndBody), false, why);
  assert.equal(exemptEnd({ ...exempt, failure: { ...usage, reason: 'auth' } }), true);
});

test('a committed version is a prefix of the current ledger on whole lines', () => {
  const one = build([start(0)]), two = build([start(0), end(1)]);
  assert.equal(isPrefix(one, two), true); assert.equal(isPrefix('', two), true); assert.equal(isPrefix(two, two), true);
  assert.equal(isPrefix(two, one), false); assert.equal(isPrefix(one.slice(0, -10), two), false);
  assert.equal(isPrefix(build([start(1)]), build([start(0), end(1)])), false);
});

test('the start guard on the file: a missing or diverged local ledger refuses, a model the round does not name refuses, every start and end is appended under one lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pn-ledger-'));
  try {
    const paths = { local: join(dir, 'local', 'ledger.jsonl'), committed: join(dir, 'release-ledger.jsonl') };
    const request = (run: string, extra: Partial<{ model: string | null; requested: 'api-key' | 'local' }> = {}) => ({ bench: '20261102T100000Z-0001', run, taskId: 'connect', seed: 1, repeat: 1, agent: { kind: 'preset' as const, name: 'claude-code', command: [] }, requested: 'api-key' as const, model: 'claude-opus-5-5', ...extra });
    const guard = ledgerGuard({ paths, purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null });
    await assert.rejects(guard.start(request('connect-s1-r1')), (error: Error & { code?: string }) => error.code === 'ledger_missing' && /ledger init/.test(error.message));
    assert.deepEqual(await initLedger(paths), { records: 1, from: 'new' });
    await assert.rejects(initLedger(paths), (error: Error & { code?: string }) => error.code === 'ledger_exists');
    // Starts in parallel: one writer at a time, every record chained.
    const seqs = await Promise.all([1, 2, 3, 4].map(seed => guard.start(request(`connect-s${seed}-r1`))));
    assert.deepEqual([...seqs].sort(), [1, 2, 3, 4]);
    await guard.end(seqs[0]!, presetRun('connect-1', true, 'claude-opus-5-5'));
    const ledger = (await readLedger(paths.local))!;
    assert.equal(ledger.records.length, 6);
    const ended = ledger.ends.get(seqs[0]!)!;
    assert.deepEqual([ended.status, ended.judged, ended.stdout, ended.hostCalls, ended.reads, ended.tokens], ['completed', presetRun('connect-1', true, 'x').artifacts!.session, presetRun('connect-1', true, 'x').stdout!.sha256, 4, 1, 15]);
    // The committed copy, then a local ledger that lost a record refuses every start.
    assert.deepEqual(await writeCommittedLedger(paths), { records: 6, added: 6 });
    const text = await readFile(paths.local, 'utf8');
    await writeFile(paths.local, headerLine());
    await assert.rejects(guard.start(request('connect-s9-r1')), (error: Error & { code?: string }) => error.code === 'ledger_diverged');
    await writeFile(paths.local, text);
    // A round's guard takes only the models the round names.
    const round = ledgerGuard({ paths, purpose: 'held-out', unit: 'repair.practonaut', round: 1, basis: 'd'.repeat(64), toolchain: 'practonaut', rules: null, models: ['claude-opus-5-5'] });
    await assert.rejects(round.start(request('connect-s9-r1', { model: 'claude-sonnet-5-5' })), (error: Error & { code?: string }) => error.code === 'ledger_model_refused');
    await assert.rejects(round.start(request('connect-s9-r1', { model: null })), (error: Error & { code?: string }) => error.code === 'ledger_model_refused');
    // A new machine starts from the committed ledger.
    const other = { ...paths, local: join(dir, 'other.jsonl') };
    assert.deepEqual(await initLedger(other), { records: 6, from: 'committed' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a start that would pass 800 is refused before anything is appended; a start reserves until its run-end releases it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pn-ledger-cap-'));
  try {
    const paths = { local: join(dir, 'ledger.jsonl'), committed: join(dir, 'none', 'release-ledger.jsonl') };
    // 798 counted starts and one local start whose run-end is not written yet: 799 counted.
    const bodies: Array<StartBody | RunEndBody> = Array.from({ length: 798 }, (_, index) => start(index));
    bodies.push(start(798, { requested: 'local' }));
    await writeFile(paths.local, build(bodies));
    const guard = ledgerGuard({ paths, purpose: 'acceptance', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null });
    const request = (run: string) => ({ bench: '20261102T100000Z-0002', run, taskId: 'connect', seed: 1, repeat: 1, agent: { kind: 'preset' as const, name: 'claude-code', command: [] }, requested: 'api-key' as const, model: 'claude-opus-5-5' });
    const eight = await guard.start(request('connect-s800-r1'));
    assert.equal(eight, 800);
    const before = await readFile(paths.local, 'utf8');
    await assert.rejects(guard.start(request('connect-s801-r1')), (error: Error & { code?: string }) => error.code === 'release_budget_exhausted' && /800 of its 800 model runs counted; this start would pass 800 and is refused before the client starts/.test(error.message));
    assert.equal(await readFile(paths.local, 'utf8'), before, 'nothing was appended');
    // The local run ends attested local: its reservation is released, and one more start fits.
    const local = presetRun('connect-1', true, 'local-model');
    local.client!.billing = { class: 'local', source: 'client-attested', via: 'claude-code-stream/1:init.apiKeySource' };
    await guard.end(799, local);
    assert.equal(countLedger((await readLedger(paths.local))!).counted, 799);
    assert.equal(await guard.start(request('connect-s802-r1')), 802);
    await assert.rejects(guard.start(request('connect-s803-r1')), (error: Error & { code?: string }) => error.code === 'release_budget_exhausted');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

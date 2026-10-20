// The 0.3.0 release ledger (PADR-0042 decision 4, PADR-0044 decisions 5 and 8, as amended on
// acceptance): its hash chain and canonical lines, the count against the cap and what releases a
// reservation, the prefix rule for committed versions, round membership by task identity, and the
// start guard on the file: a local ledger only by `ledger init`, the committed one its prefix, one
// writer at a time, a round's run only on its own instances, a start that would pass 800 refused, and
// the recovery of a killed bench. Records are built here line by line; the expected counts are counted
// by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { countLedger, exemptEnd, headerLine, isPrefix, nextLine, parseLedger, roundEvents, roundStarts, type LedgerRecord, type RoundBody, type RunEndBody, type StartBody } from '../../src/challenge/ledger.ts';
import { initLedger, ledgerGuard, readLedger, writeCommittedLedger } from '../../src/challenge/ledger-file.ts';
import { presetRun } from '../support/challenge-round.ts';
import { normaliseRemote, releaseLedgerPath } from '../../src/challenge/repository.ts';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');
const start = (index: number, extra: Partial<StartBody> = {}): StartBody => ({ kind: 'start', purpose: 'example', unit: null, round: null, basis: null, toolchain: 'practonaut', rules: null, requested: 'api-key', model: 'claude-opus-5-5', agent: 'claude-code', bench: '20261102T100000Z-0001', run: `connect-s${index + 1}-r1`, world: 'f'.repeat(64), instance: 'e'.repeat(64), ...extra });
const end = (startSeq: number, extra: Partial<RunEndBody> = {}): RunEndBody => ({ kind: 'run-end', start: startSeq, toolchain: 'practonaut', rules: null, status: 'completed', judged: 'a'.repeat(64), stdout: 'b'.repeat(64), checker: 'c'.repeat(64), observed: { class: 'api-key', source: 'client-attested' }, failure: null, hostCalls: 3, reads: 1, tokens: 15, ...extra });
/** A ledger text from bodies, appended in order (O(n): the records are kept, not re-parsed). */
function build(bodies: Array<StartBody | RunEndBody | RoundBody | ((records: LedgerRecord[]) => StartBody | RunEndBody)>): string {
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
  assert.throws(() => parseLedger(text, '0.4.0'), /counts release 0\.3\.0 with a cap of 800; release 0\.4\.0 has 800/);
});

test('the cap is the release\'s 800, never a value the ledger file names (review: budget-cap-from-header)', () => {
  // Written by hand: a self-consistent ledger whose header names a cap of 5000.
  const header = `{"cap":5000,"kind":"release","prev":"${'0'.repeat(64)}","release":"0.3.0","schema":"practonaut.release-ledger/1","seq":0}`;
  assert.throws(() => parseLedger(header + '\n'), (error: unknown) => (error as { code?: string }).code === 'ledger_invalid' && /a cap of 5000; release 0\.3\.0 has 800/.test((error as Error).message));
  assert.throws(() => parseLedger(header.replace('"0.3.0"', '"0.3.1"').replace('5000', '800') + '\n'), /counts release 0\.3\.1/);
});

test('round records name their instances; a start on a round\'s instance belongs to it on any world and under any purpose, and a start never widens a round (review: r2-round-instances-by-world-hash, r2-round-world-closure-from-stray-start)', () => {
  const id = (c: string): string => c.repeat(64);
  const round = (event: RoundBody['event'], world: string, instances: string[]): RoundBody => ({ kind: 'round', event, unit: 'repair.practonaut', round: 1, probe: 1, plan: 'a'.repeat(64), record: 'b'.repeat(64), declaration: event === 'declared' ? 'c'.repeat(64) : null, world, heldOutRuns: event === 'declared' ? 78 : 0, instances });
  const ledger = parseLedger(build([
    start(0, { purpose: 'pre-probe', unit: 'repair.practonaut', round: 1, basis: 'a'.repeat(64), world: id('1'), instance: id('5') }), round('admitted', id('1'), [id('5')]), round('declared', id('2'), [id('6')]),
    start(1, { world: id('2'), instance: id('6') }),        // seq 4: a development run of a held-out instance
    start(2, { world: id('9'), instance: id('5') }),        // seq 5: a pre-probe instance benched on another world (a dev set)
    start(3, { world: id('2'), instance: id('7') }),        // seq 6: the held-out world, another instance: not the round's
    // seq 7: a stray pre-probe start of another unit on repair's held-out instance (and world).
    start(4, { purpose: 'pre-probe', unit: 'injection.practonaut', round: 1, basis: 'a'.repeat(64), world: id('2'), instance: id('6') }),
  ]));
  assert.deepEqual(roundStarts(ledger, 'repair.practonaut', 1).map(record => record.seq), [1, 4, 5, 7]);
  // The stray start does not pull repair's runs into injection's round (by its world or its instance).
  assert.deepEqual(roundStarts(ledger, 'injection.practonaut', 1).map(record => record.seq), [7]);
  // The caller's regenerated instances count too (a pre-probe before its record is registered).
  assert.deepEqual(roundStarts(ledger, 'repair.practonaut', 1, [id('7')]).map(record => record.seq), [1, 4, 5, 6, 7]);
  assert.deepEqual(roundEvents(ledger, 'repair.practonaut', 1).map(record => record.event), ['admitted', 'declared']);
  // Round records are not starts: they count nothing.
  assert.equal(countLedger(ledger).starts, 5);
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
    const request = (run: string, extra: Partial<{ model: string | null; requested: 'api-key' | 'local'; world: string; instance: string }> = {}) => ({ bench: '20261102T100000Z-0001', run, taskId: 'connect', seed: 1, repeat: 1, agent: { kind: 'preset' as const, name: 'claude-code', command: [] }, requested: 'api-key' as const, model: 'claude-opus-5-5', world: 'f'.repeat(64), instance: 'e'.repeat(64), ...extra });
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
    // A round's run benches the round's own set (review: r2-round-world-closure-from-stray-start): another
    // world or another instance is refused before the client starts, and nothing is appended.
    const own = ledgerGuard({ paths, purpose: 'held-out', unit: 'repair.practonaut', round: 1, basis: 'd'.repeat(64), toolchain: 'practonaut', rules: null, models: ['claude-opus-5-5'], set: { world: 'f'.repeat(64), instances: new Set(['e'.repeat(64)]) } });
    const kept = await readFile(paths.local, 'utf8');
    await assert.rejects(own.start(request('connect-s9-r1', { world: '2'.repeat(64) })), (error: Error & { code?: string }) => error.code === 'round_instance_refused' && /not an instance of the round's own set/.test(error.message));
    await assert.rejects(own.start(request('connect-s9-r1', { instance: '7'.repeat(64) })), (error: Error & { code?: string }) => error.code === 'round_instance_refused');
    assert.equal(await readFile(paths.local, 'utf8'), kept);
    assert.equal(await own.start(request('connect-s9-r1')), 6);
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
    const request = (run: string) => ({ bench: '20261102T100000Z-0002', run, taskId: 'connect', seed: 1, repeat: 1, agent: { kind: 'preset' as const, name: 'claude-code', command: [] }, requested: 'api-key' as const, model: 'claude-opus-5-5', world: 'f'.repeat(64), instance: 'e'.repeat(64) });
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

test('recovery through the guard (review: r2-killed-bench-dead-end): the run-end records a folder proves are appended, marked recovered; a run without a provable outcome stays void', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pn-ledger-recover-'));
  try {
    const paths = { local: join(dir, 'ledger.jsonl'), committed: join(dir, 'none', 'release-ledger.jsonl') };
    const bench = '20261102T100000Z-0003', basis = 'a'.repeat(64);
    const pre = (index: number): StartBody => start(index, { purpose: 'pre-probe', unit: 'repair.practonaut', round: 1, basis, bench, run: `repair-${index + 1}-s1-r1` });
    // Starts 1–5 of a killed pre-probe bench; run 1 ended before the kill.
    await writeFile(paths.local, build([pre(0), end(1), pre(1), pre(2), pre(3), pre(4)]));
    const guard = ledgerGuard({ paths, purpose: 'pre-probe', unit: 'repair.practonaut', round: 1, basis, toolchain: 'practonaut', rules: null });
    const judged = presetRun('repair-2', false, 'claude-opus-5-5');
    const limited = presetRun('repair-3', null, 'claude-opus-5-5');                                    // a usage limit its stdout reports
    const interrupted = { ...presetRun('repair-4', null, 'claude-opus-5-5'), failure: { reason: 'interrupted' as const, parser: null, code: null, beforeModelWork: null }, note: 'interrupted' };
    const runs = [presetRun('repair-1', true, 'claude-opus-5-5'), judged, limited, interrupted];
    // repair-5's start has no folder at all: void too.
    assert.deepEqual(await guard.recover!(bench, runs), { written: ['repair-2-s1-r1', 'repair-3-s1-r1'], void: ['repair-4-s1-r1', 'repair-5-s1-r1'] });
    const ledger = (await readLedger(paths.local))!;
    const recovered = [...ledger.ends.values()].filter(record => record.recovered === true);
    assert.deepEqual(recovered.map(record => [record.start, record.status, record.checker]), [[3, 'completed', judged.artifacts!.checker], [4, 'infra_error', null]]);
    assert.equal(ledger.ends.has(1) && ledger.ends.get(1)!.recovered, undefined, 'the run-end the runner wrote is left as it is');
    assert.deepEqual([ledger.ends.has(5), ledger.ends.has(6)], [false, false]);
    // Again: nothing more to write; the void starts stay void.
    assert.deepEqual(await guard.recover!(bench, runs), { written: [], void: ['repair-4-s1-r1', 'repair-5-s1-r1'] });
    assert.equal((await readLedger(paths.local))!.records.length, ledger.records.length);
    // A run without a start entry, or a start of another purpose or plan, is refused.
    await assert.rejects(guard.recover!(bench, [presetRun('repair-9', true, 'claude-opus-5-5')]), (error: Error & { code?: string }) => error.code === 'run_outside_ledger');
    const other = ledgerGuard({ paths, purpose: 'pre-probe', unit: 'repair.practonaut', round: 1, basis: 'b'.repeat(64), toolchain: 'practonaut', rules: null });
    await assert.rejects(other.recover!(bench, runs), (error: Error & { code?: string }) => error.code === 'ledger_mismatch');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('one local ledger per user and repository: every spelling of the origin names one repository, and the ledger lives under PRACTONAUT_HOME (review: budget-checkout-local-ledger)', () => {
  // Written by hand: the forms the version-control tool accepts for one GitHub repository, and a local remote.
  for (const url of ['https://github.com/Example/Practonaut.git', 'https://user:secret@GitHub.com/Example/Practonaut/', 'git@github.com:Example/Practonaut.git', 'ssh://git@github.com/Example/Practonaut', 'git://github.com/Example/Practonaut.git'])
    assert.equal(normaliseRemote(url), 'github.com/Example/Practonaut', url);
  const local = (path: string): string => resolve(path).replaceAll('\\', '/');
  assert.equal(normaliseRemote('/srv/repos/practonaut.git/'), local('/srv/repos/practonaut'));
  assert.equal(normaliseRemote('file:///srv/repos/practonaut.git'), local('/srv/repos/practonaut'));
  assert.equal(normaliseRemote('../practonaut.git', local('/srv/work/clone')), local('/srv/work/practonaut'));
  assert.equal(releaseLedgerPath(join('home', 'pn'), 'k'.repeat(24)), join('home', 'pn', 'release-ledgers', 'k'.repeat(24), 'release-ledger-0.3.0.jsonl'));
});

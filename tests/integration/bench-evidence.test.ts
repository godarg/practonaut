// Run evidence in the bench folder (PADR-0039 A) end to end: the bridge's call log with the bench
// client's round trips for built-in agents and "client timing unavailable" for others, the runner's
// mutation log, the checker's condition trace, the engine picture with the mirror, the client's own
// figures; `report --verify` binds and re-derives them and names every tampering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench } from '../../src/bench/run.ts';
import { resolveAgent } from '../../src/bench/agents.ts';
import { parseCallLog, parseMutations } from '../../src/bench/evidence.ts';
import { sha256Hex } from '../../src/canonical/index.ts';
import type { BenchReportV2 } from '../../src/bench/report.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const AGENT = fileURLToPath(new URL('../support/bench-agent.ts', import.meta.url));
const base = { seeds: [1], repeats: 1, timeoutSeconds: 60, maxActions: 50, mirrorRequested: 'off' as const, mirror: 'off' as const };
const verify = (report: string, runs: string) => spawnSync(process.execPath, [CLI, 'report', report, '--verify', '--runs', runs], { encoding: 'utf8' });

test('built-in agent: client round trips joined to the bridge log, every mutation logged, trace and evidence re-verified; tampering is named', { timeout: 300_000 }, async () => {
  const bench = await runBench({ ...base, agent: resolveAgent('oracle'), tasks: ['connect', 'restyle-flow'] });
  const report = bench.report!, path = join(bench.directory, 'report.json');
  await writeFile(path, JSON.stringify(report));
  for (const run of report.runs) {
    const folder = join(bench.directory, run.id);
    const calls = parseCallLog(await readFile(join(folder, 'calls.jsonl'), 'utf8'));
    // The bridge's own file stays beside the normalised copy, line for line.
    const bridged = (await readFile(join(folder, 'calls.bridge.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(bridged.length, calls.length); assert.deepEqual([run.logs?.calls?.dropped, run.logs?.calls?.omitted], [0, 0]);
    assert.ok(calls.length >= run.referenceActions! + 2, run.id);
    assert.equal(calls.every(call => call.clientMs !== null && call.clientMs + 0.2 >= call.bridgeMs && call.resultBytes > 0), true, 'every call of the bench client has its round trip, which contains the bridge time');
    assert.deepEqual(calls.filter(call => call.tool === 'act').length, run.toolCalls.act);
    const mutations = parseMutations(await readFile(join(folder, 'mutations.jsonl'), 'utf8'));
    assert.equal(mutations.length, run.referenceActions);
    assert.equal(mutations.every(entry => entry.op === 'act' && entry.outcome === 'accepted' && entry.client === 'practonaut-bench'), true);
    const trace = JSON.parse(await readFile(join(folder, 'trace.json'), 'utf8')) as { points: Array<{ met: string }> };
    assert.equal(trace.points.length, run.referenceActions);
    assert.match(trace.points.at(-1)!.met, /^1+$/, 'the oracle meets every condition after its last action');
    assert.deepEqual([run.logs?.calls?.clientTiming, run.artifacts?.board, run.client], [true, null, undefined]);
  }
  const verified = verify(path, bench.directory); assert.equal(verified.status, 0, verified.stderr);

  const folder = join(bench.directory, 'restyle-flow-s1-r1'), original = { mutations: await readFile(join(folder, 'mutations.jsonl'), 'utf8'), trace: await readFile(join(folder, 'trace.json'), 'utf8') };
  const restore = async (): Promise<void> => { await writeFile(join(folder, 'mutations.jsonl'), original.mutations); await writeFile(join(folder, 'trace.json'), original.trace); await writeFile(path, JSON.stringify(report)); };
  // A changed log against the report's hash.
  await writeFile(join(folder, 'mutations.jsonl'), original.mutations.replace('"step":1', '"step":9'));
  let refused = verify(path, bench.directory); assert.equal(refused.status, 2); assert.match(refused.stderr, /restyle-flow-s1-r1.*mutations\.jsonl.*\[bench_artifact_changed\]/);
  await restore();
  // A forged log with one more action, bound by a recomputed hash: it no longer matches the counted calls.
  const forgedLog = original.mutations + original.mutations.split('\n')[0]!.replace('"seq":0', `"seq":${original.mutations.trim().split('\n').length}`) + '\n';
  await writeFile(join(folder, 'mutations.jsonl'), forgedLog);
  const forged = structuredClone(report) as BenchReportV2; const forgedRun = forged.runs.find(run => run.id === 'restyle-flow-s1-r1')!;
  forgedRun.logs!.mutations.sha256 = sha256Hex(forgedLog);
  await writeFile(path, JSON.stringify(forged));
  refused = verify(path, bench.directory); assert.equal(refused.status, 2, refused.stdout); assert.match(refused.stderr, /restyle-flow-s1-r1: the mutation log does not agree with the run's counted act, undo and reset calls \[bench_report_invalid\]/);
  // The same log with counters forged to match: the checker cannot replay it into the judged session.
  forgedRun.logs!.mutations.entries += 1; forgedRun.toolCalls.act += 1; forgedRun.toolCalls.total += 1; forgedRun.acceptedActions += 1; forged.summary.toolCalls += 1;
  await writeFile(path, JSON.stringify(forged));
  refused = verify(path, bench.directory); assert.equal(refused.status, 2, refused.stdout); assert.match(refused.stderr, /restyle-flow-s1-r1: the checker does not re-derive the stored condition trace .*\[bench_report_invalid\]/);
  await restore();
  // A trace that says a condition was met when it was not, bound by a recomputed hash: the checker does not re-derive it.
  const forgedTrace = original.trace.replace(/"met":"([01]*)0([01]*)"/, '"met":"$11$2"');
  assert.notEqual(forgedTrace, original.trace);
  await writeFile(join(folder, 'trace.json'), forgedTrace);
  const traced = structuredClone(report) as BenchReportV2; traced.runs.find(run => run.id === 'restyle-flow-s1-r1')!.artifacts!.trace = sha256Hex(forgedTrace);
  await writeFile(path, JSON.stringify(traced));
  refused = verify(path, bench.directory); assert.equal(refused.status, 2); assert.match(refused.stderr, /restyle-flow-s1-r1.*condition trace.*\[bench_report_invalid\]/);
  await restore();
  assert.equal(verify(path, bench.directory).status, 0);
  await rm(bench.directory, { recursive: true, force: true });
});

test('command agent: no client timing, its own figures self-reported, two MCP clients and undo in the evidence', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-evidence-'));
  try {
    const script = join(dir, 'script.json');
    await writeFile(script, JSON.stringify({ connect: {
      clients: ['second-agent'],
      print: [JSON.stringify({ type: 'system', subtype: 'init', model: 'pn-script-model', apiKeySource: 'none' }), JSON.stringify({ type: 'result', subtype: 'success', num_turns: 4, total_cost_usd: 0.0123, usage: { input_tokens: 120, output_tokens: 45, cache_read_input_tokens: 900, cache_creation_input_tokens: 300 } })],
      steps: [{ act: 'connect', params: { from: 'a', to: 'b' } }, { undo: true }, { act: 'connect', params: { from: 'a', to: 'zz' } }, { act: 'connect', params: { from: 'b', to: 'a' }, client: 1 }, { check: true }],
    } }));
    process.env.PN_TEST_AGENT_SCRIPT = script;
    const bench = await runBench({ ...base, agent: resolveAgent(`${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} script {mcp_config}`), tasks: ['connect'] });
    const run = bench.report!.runs[0]!, folder = join(bench.directory, run.id);
    assert.deepEqual([run.pass, run.acceptedActions, run.rejectedActions, run.undos], [false, 2, 1, 1]);
    assert.deepEqual(run.client, { source: 'command-output', model: 'pn-script-model', turns: 4, costUsd: 0.0123, tokens: { input: 120, output: 45, cacheRead: 900, cacheCreation: 300 } });
    assert.equal(run.logs?.calls?.clientTiming, false);
    assert.equal(parseCallLog(await readFile(join(folder, 'calls.jsonl'), 'utf8')).every(call => call.clientMs === null), true);
    const mutations = parseMutations(await readFile(join(folder, 'mutations.jsonl'), 'utf8'));
    // Every change through MCP names its client, an undo too.
    assert.deepEqual(mutations.map(entry => [entry.op, entry.outcome, entry.code ?? null, entry.client]), [['act', 'accepted', null, 'practonaut-bench'], ['undo', 'accepted', null, 'practonaut-bench'], ['act', 'rejected', 'precondition_failed', 'practonaut-bench'], ['act', 'accepted', null, 'second-agent']]);
    // connect: 2 steps · 1 arrow · “l2” · “l1” · arrow l1→l2. a→b meets all; undo returns; b→a misses the direction.
    const trace = JSON.parse(await readFile(join(folder, 'trace.json'), 'utf8')) as { start: string; points: Array<{ seq: number; met: string }> };
    assert.deepEqual([trace.start, ...trace.points.map(point => `${point.seq}:${point.met}`)], ['10110', '0:11111', '1:10110', '3:11110']);
    const path = join(bench.directory, 'report.json'); await writeFile(path, JSON.stringify(bench.report));
    const verified = verify(path, bench.directory); assert.equal(verified.status, 0, verified.stderr);
    await rm(bench.directory, { recursive: true, force: true });
  } finally { delete process.env.PN_TEST_AGENT_SCRIPT; await rm(dir, { recursive: true, force: true }); }
});

test('with the mirror the real engine pictures the final board; the picture is bound and a changed one is refused', { timeout: 300_000 }, async () => {
  const bench = await runBench({ ...base, mirrorRequested: 'required', mirror: 'required', agent: resolveAgent('oracle'), tasks: ['restyle-flow'] });
  const run = bench.report!.runs[0]!, folder = join(bench.directory, run.id), path = join(bench.directory, 'report.json');
  await writeFile(path, JSON.stringify(bench.report));
  const svg = await readFile(join(folder, 'board.svg'), 'utf8');
  assert.match(svg, /^<svg[\s>]/); assert.equal(run.artifacts?.board, sha256Hex(svg));
  assert.equal(verify(path, bench.directory).status, 0);
  await writeFile(join(folder, 'board.svg'), svg.replace('</svg>', '<text>forged</text></svg>'));
  const refused = verify(path, bench.directory); assert.equal(refused.status, 2); assert.match(refused.stderr, /board\.svg.*\[bench_artifact_changed\]/);
  await rm(bench.directory, { recursive: true, force: true });
});

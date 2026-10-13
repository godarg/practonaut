// Bench hardening: what `report --verify` re-derives (reference length, final history, library
// content), and that an agent cannot turn its own failure into an unjudged run by leaving files
// under the judged artifacts' names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runBench } from '../../src/bench/run.ts';
import { resolveAgent } from '../../src/bench/agents.ts';
import { summarize, type BenchReport } from '../../src/bench/report.ts';
import { loadLibrary } from '../../src/library/index.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const AGENT = fileURLToPath(new URL('../support/bench-agent.ts', import.meta.url));
const base = { seeds: [1], repeats: 1, timeoutSeconds: 60, maxActions: 50, mirrorRequested: 'off' as const, mirror: 'off' as const };
const command = (mode: string) => resolveAgent(`${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} ${mode} {mcp_config}`);
const verify = (path: string) => spawnSync(process.execPath, [CLI, 'report', path, '--verify'], { encoding: 'utf8' });

test('report --verify re-derives the reference length, the final history and the library content', { timeout: 300_000 }, async () => {
  const bench = await runBench({ ...base, agent: resolveAgent('oracle'), tasks: ['connect', 'insert-between'] });
  const report = bench.report!, directory = bench.directory;
  // Expected values from another source than the runner: the committed library file.
  const library = new Map(loadLibrary().library.tasks.map(task => [task.id, task.actions]));
  for (const run of report.runs) { assert.equal(run.referenceActions, library.get(run.taskId)); assert.equal(run.actions, library.get(run.taskId), run.id); assert.equal(run.pass, true, run.id); }
  assert.equal(report.environment.library.version, '1.1.0');
  assert.match(report.environment.library.contentHash, /^[a-f0-9]{64}$/);
  const path = join(directory, 'report.json'); await writeFile(path, JSON.stringify(report));
  assert.equal(verify(path).status, 0);
  const forge = async (name: string, mutate: (value: BenchReport) => void): Promise<ReturnType<typeof verify>> => {
    const value = structuredClone(report); mutate(value); value.summary = summarize(value.runs, 1);
    const forged = join(directory, `${name}.json`); await writeFile(forged, JSON.stringify(value));
    // The forgery is internally consistent: without --verify it is accepted.
    assert.equal(spawnSync(process.execPath, [CLI, 'report', forged], { encoding: 'utf8' }).status, 0, `${name} passes the consistency check`);
    return verify(forged);
  };
  // A longer reference makes the agent look five times as efficient.
  const reference = await forge('reference', value => { for (const run of value.runs) run.referenceActions *= 5; });
  assert.equal(reference.status, 2); assert.match(reference.stderr, /the report names a reference of \d+ actions; the library's reference solution has \d+.*\[bench_report_invalid\]/);
  // Fewer actions than the session's history holds.
  const longest = report.runs.reduce((a, b) => (b.actions > a.actions ? b : a));
  assert.ok(longest.actions >= 2, 'a task whose reference needs at least two actions');
  const actions = await forge('actions', value => { value.runs.find(run => run.id === longest.id)!.actions = 1; });
  assert.equal(actions.status, 2); assert.match(actions.stderr, /the report counts 1 actions; the session's final history holds \d+/);
  // Same library id and version, other content.
  const content = await forge('content', value => { value.environment.library.contentHash = 'f'.repeat(64); });
  assert.equal(content.status, 2); assert.match(content.stderr, /of other content/);
});

test('files an agent leaves under the artifact names cannot block judging; an unjudged run counts as not passed', { timeout: 300_000 }, async () => {
  const planted = await runBench({ ...base, agent: command('plant'), tasks: ['connect'] });
  const run = planted.report!.runs[0]!;
  assert.deepEqual([run.status, run.pass, run.checker?.session.passed], ['completed', true, true], run.note);
  const directory = join(planted.directory, run.id);
  // The judged artifacts are the runner's, not the agent's planted ones.
  assert.equal((await readFile(join(directory, 'checker.json'), 'utf8')).includes('forged'), false);
  assert.equal((await stat(join(directory, 'agent', 'checker.json'))).isFile(), true, 'the agent wrote into its own home');
  const path = join(planted.directory, 'report.json'); await writeFile(path, JSON.stringify(planted.report));
  assert.equal(verify(path).status, 0);
  // Something that is not a replaceable file where checker.json goes: the run is unjudged, stays in
  // the denominator, and its note names no local path.
  const blocked = await runBench({ ...base, agent: command('plant-dir'), tasks: ['connect'] });
  const failed = blocked.report!.runs[0]!, summary = blocked.report!.summary;
  assert.deepEqual([failed.status, failed.pass, failed.checker], ['infra_error', false, null]);
  assert.deepEqual([summary.runs, summary.passed, summary.infraErrors, summary.passAt1], [1, 0, 1, 0]);
  assert.ok(failed.note, 'the run names its error');
  for (const local of [blocked.directory, tmpdir(), process.env.PRACTONAUT_HOME!]) assert.equal(failed.note!.includes(local), false, `note ${failed.note} names ${local}`);
  assert.equal(/(?:^|[\s'"])\/[^\s'"]*\//.test(failed.note!), false, `note ${failed.note} holds an absolute path`);
});

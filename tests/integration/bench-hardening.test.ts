// Bench hardening: what `report --verify` re-derives (reference length, final history, library
// content), and that an agent cannot turn its own failure into an unjudged run by leaving files
// under the judged artifacts' names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runBench } from '../../src/bench/run.ts';
import { resolveAgent } from '../../src/bench/agents.ts';
import { summarize, type SessionReportV3 as BenchReport } from '../../src/bench/report.ts';
import { loadLibrary } from '../../src/library/index.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const AGENT = fileURLToPath(new URL('../support/bench-agent.ts', import.meta.url));
const base = { seeds: [1], repeats: 1, timeoutSeconds: 60, maxActions: 50, mirrorRequested: 'off' as const, mirror: 'off' as const };
const command = (mode: string) => resolveAgent(`${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} ${mode} {mcp_config}`);
const verify = (path: string) => spawnSync(process.execPath, [CLI, 'report', path, '--verify'], { encoding: 'utf8' });

test('report --verify re-derives the reference length, the final history and the stored library content', { timeout: 300_000 }, async () => {
  const bench = await runBench({ ...base, agent: resolveAgent('oracle'), tasks: ['connect', 'insert-between'] });
  const report = bench.report!, directory = bench.directory;
  // Expected values from another source than the runner: the committed library file.
  const library = new Map(loadLibrary().library.tasks.map(task => [task.id, task.actions]));
  for (const run of report.runs) { assert.equal(run.referenceActions, library.get(run.taskId)); assert.equal(run.actions, library.get(run.taskId), run.id); assert.equal(run.pass, true, run.id); }
  assert.deepEqual([report.environment.world.source, report.environment.world.worldId, report.environment.world.version], ['library', 'excalidraw-library', loadLibrary().world.version]);
  assert.match(report.environment.world.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.references?.tasks.map(task => [task.taskId, task.source, task.actions]), report.runs.map(run => [run.taskId, 'library', library.get(run.taskId)]));
  const path = join(directory, 'report.json'); await writeFile(path, JSON.stringify(report));
  assert.equal(verify(path).status, 0);
  const forge = async (name: string, mutate: (value: BenchReport) => void): Promise<ReturnType<typeof verify>> => {
    const value = structuredClone(report); mutate(value); value.summary = summarize(value.runs, 1, run => run.agentActions);
    const forged = join(directory, `${name}.json`); await writeFile(forged, JSON.stringify(value));
    // The forgery is internally consistent: without --verify it is accepted.
    assert.equal(spawnSync(process.execPath, [CLI, 'report', forged], { encoding: 'utf8' }).status, 0, `${name} passes the consistency check`);
    return verify(forged);
  };
  // A longer reference makes the agent look five times as efficient: the report's references and every
  // run changed together stay consistent, but the stored reference solution has its own length.
  const reference = await forge('reference', value => { for (const run of value.runs) run.referenceActions! *= 5; for (const task of value.references!.tasks) task.actions *= 5; });
  assert.equal(reference.status, 2); assert.match(reference.stderr, /the report names a reference of \d+ actions; the stored reference has \d+.*\[bench_reference_invalid\]/);
  // Fewer actions than the session's history holds.
  const longest = report.runs.reduce((a, b) => (b.actions > a.actions ? b : a));
  assert.ok(longest.actions >= 2, 'a task whose reference needs at least two actions');
  const actions = await forge('actions', value => { const run = value.runs.find(run => run.id === longest.id)!; run.actions = 1; run.agentActions = 1; });
  assert.equal(actions.status, 2); assert.match(actions.stderr, /the report counts 1 actions; the session's final history holds \d+/);
  // Same library id and version, other content: the stored world says otherwise.
  const content = await forge('content', value => { value.environment.world.contentHash = 'f'.repeat(64); });
  assert.equal(content.status, 2); assert.match(content.stderr, /the stored world is excalidraw-library .* \(content [a-f0-9]{12}…\), the report names .*\(content ffffffffffff…\).*\[bench_world_changed\]/);
});

test('a bench agent sees no reference length of any task, even in a full observe', { timeout: 120_000 }, async () => {
  const state = await mkdtemp(join(tmpdir(), 'pn-bench-tasks-'));
  process.env.PN_TEST_AGENT_STATE = state;
  try {
    await runBench({ ...base, agent: command('tasks'), tasks: ['connect'] });
    const tasks = JSON.parse(await readFile(join(state, 'tasks.json'), 'utf8')) as Array<Record<string, unknown>>;
    // A bench host lists only the run's own task, by id and title: no level, no reference length,
    // and no other task of the world.
    assert.deepEqual(tasks.map(task => task.id), ['connect']);
    for (const task of tasks) assert.deepEqual(Object.keys(task).sort(), ['id', 'title'], JSON.stringify(task));
  } finally { delete process.env.PN_TEST_AGENT_STATE; await rm(state, { recursive: true, force: true }); }
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

test('evidence that cannot be written never changes a verdict: no trace without its log, no picture, still judged', { timeout: 300_000 }, async () => {
  // A folder where the mutation log goes: the log is left out, so the trace (which follows the log) is
  // left out too and says why; the run is judged as usual and the report verifies.
  const logBlocked = await runBench({ ...base, agent: command('plant-log'), tasks: ['connect'] });
  const run = logBlocked.report!.runs[0]!;
  assert.deepEqual([run.status, run.pass, run.checker?.session.passed, run.logs, run.artifacts?.trace, run.artifacts?.traceError], ['completed', true, true, undefined, null, 'log_unwritten'], run.note);
  const path = join(logBlocked.directory, 'report.json'); await writeFile(path, JSON.stringify(logBlocked.report));
  const verified = verify(path); assert.equal(verified.status, 0, verified.stderr);
  // A folder where the engine's picture goes (mirror): the picture is left out; the verdict is the same.
  const boardBlocked = await runBench({ ...base, mirrorRequested: 'required', mirror: 'required', agent: command('plant-board'), tasks: ['connect'] });
  const pictured = boardBlocked.report!.runs[0]!;
  assert.deepEqual([pictured.status, pictured.pass, pictured.checker?.native?.passed, pictured.artifacts?.board], ['completed', true, true, null], pictured.note);
  assert.equal(typeof pictured.artifacts?.trace, 'string', 'the trace does not depend on the picture');
  await rm(logBlocked.directory, { recursive: true, force: true }); await rm(boardBlocked.directory, { recursive: true, force: true });
});

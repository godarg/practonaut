// A run that cannot show what the model can do is an infra_error, not a model failure (PADR-0040,
// second review B-A): the claude-code preset through the real CLI and runner with a stand-in `claude`
// that hits a subscription usage limit, an API error, ends without a tool call, or fails on its own
// (error_max_turns, another agent error: those stay agent_failed and are judged). --stop-on-infra
// stops at the first infra_error with a partial report naming the tasks to resume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClaude } from '../support/fake-claude.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
type Json = Record<string, any>;
const benchRoot = (): string => join(process.env.PRACTONAUT_HOME!, 'bench');

test('usage limits, API errors and silent ends are infra_error and unjudged; the agent\'s own failures stay agent_failed; --stop-on-infra stops and names the rest', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-infra-'));
  try {
    const bin = join(dir, 'bin'); await mkdir(bin); await fakeClaude(bin);
    const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
    const bench = async (mode: Record<string, string>, ...args: string[]) => {
      const before = new Set(await readdir(benchRoot()).catch(() => [] as string[]));
      const result = spawnSync(process.execPath, [CLI, 'bench', '--agent', 'claude-code', '--mirror', 'off', '--timeout', '60', ...args], { encoding: 'utf8', env: { ...process.env, [pathKey]: bin + delimiter + (process.env[pathKey] ?? ''), PN_FAKE_MODEL: 'claude-opus-5-5', ...mode } });
      const created = (await readdir(benchRoot())).filter(name => !before.has(name));
      assert.equal(created.length, 1, result.stderr);
      const path = join(benchRoot(), created[0]!, 'report.json');
      return { result, path, report: JSON.parse(await readFile(path, 'utf8')) as Json };
    };
    const one = async (mode: string) => { const { result, report, path } = await bench({ PN_FAKE_MODE: mode }, '--tasks', 'connect'); assert.equal(result.status, 0, result.stderr); return { run: report.runs[0] as Json, path }; };
    // Expected classes, by hand from the stand-in's behaviour.
    for (const [mode, note] of [['usage-limit', /the client reported a usage or rate limit/], ['api-error', /the client reported an API error/], ['silent-crash', /the agent ended \(agent_failed\) without a single tool call/]] as const) {
      const { run, path } = await one(mode);
      assert.equal(run.status, 'infra_error', mode); assert.match(run.note, note, mode);
      assert.equal(run.checker, null, `${mode}: not judged`); assert.equal(run.artifacts, undefined);
      assert.equal(run.pass, false);
      const verified = spawnSync(process.execPath, [CLI, 'report', path, '--verify'], { encoding: 'utf8' });
      assert.equal(verified.status, 0, verified.stderr);
    }
    for (const mode of ['max-turns', 'agent-error']) {
      const { run } = await one(mode);
      assert.equal(run.status, 'agent_failed', mode); assert.notEqual(run.checker, null, `${mode}: judged`);
      assert.equal(run.toolCalls.observe >= 1, true);
    }
    // The init event's Claude Code version is recorded per run.
    const observed = await one('observe');
    assert.equal(observed.run.client.version, '2.1.0');
    // A report relabelled to another model without the agent's own output is refused by --verify.
    const relabelled = join(dir, 'relabelled'); await cp(join(observed.path, '..'), relabelled, { recursive: true });
    const value = JSON.parse(await readFile(join(relabelled, 'report.json'), 'utf8')) as Json;
    value.agent.model = 'claude-haiku-5-5'; value.runs[0].client.model = 'claude-haiku-5-5';
    await writeFile(join(relabelled, 'report.json'), JSON.stringify(value));
    const refused = spawnSync(process.execPath, [CLI, 'report', join(relabelled, 'report.json'), '--verify'], { encoding: 'utf8' });
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run connect-s1-r1: the report names model claude-haiku-5-5, but the agent's own output names claude-opus-5-5/);

    // --stop-on-infra: the first start observes, the second hits the limit; the bench stops there.
    const state = join(dir, 'state'); await mkdir(state);
    const stopped = await bench({ PN_FAKE_LIMIT_AFTER: '1', PN_FAKE_STATE: state }, '--tasks', 'connect,restyle-flow,insert-between', '--stop-on-infra');
    assert.equal(stopped.result.status, 75, stopped.result.stderr);
    assert.deepEqual(stopped.report.runs.map((run: Json) => run.status), ['completed', 'infra_error']);
    assert.deepEqual(stopped.report.interrupted, { plannedRuns: 3, stopped: { run: 'restyle-flow-s1-r1', remaining: ['restyle-flow', 'insert-between'] } });
    assert.match(stopped.result.stdout, /Stopped after run restyle-flow-s1-r1: the client reported a usage or rate limit .*--tasks restyle-flow,insert-between/s);
    assert.equal(spawnSync(process.execPath, [CLI, 'report', stopped.path, '--verify'], { encoding: 'utf8' }).status, 0);
    // Without it every later run is an infra_error too, and the bench completes.
    await rm(join(state, 'starts'));
    const all = await bench({ PN_FAKE_LIMIT_AFTER: '1', PN_FAKE_STATE: state }, '--tasks', 'connect,restyle-flow,insert-between');
    assert.equal(all.result.status, 0);
    assert.deepEqual(all.report.runs.map((run: Json) => run.status), ['completed', 'infra_error', 'infra_error']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

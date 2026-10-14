// Challenge instances through the real bench (PADR-0040): a generated set is benched with the
// arguments its instances.json names; the oracle passes within a tight budget whose length the
// report marks minimal; random is stopped by the task's action limit; --checks reaches the host;
// the bench folder re-verifies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TOOL = fileURLToPath(new URL('../../tools/challenge.ts', import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env });
type Json = Record<string, any>;
const json = async (path: string): Promise<Json> => JSON.parse(await readFile(path, 'utf8')) as Json;
const benchRoot = (): string => join(process.env.PRACTONAUT_HOME!, 'bench');
async function bench(args: string[]): Promise<{ report: Json; folder: string; stderr: string }> {
  const before = new Set(await readdir(benchRoot()).catch(() => [] as string[]));
  const result = run([CLI, 'bench', ...args]);
  assert.equal(result.status, 0, result.stderr);
  const created = (await readdir(benchRoot())).filter(name => !before.has(name));
  assert.equal(created.length, 1);
  const folder = join(benchRoot(), created[0]!);
  return { report: await json(join(folder, 'report.json')), folder, stderr: result.stderr };
}

test('a generated tight-budget set: oracle passes in exactly the budget, random is stopped by it, references are minimal, --verify passes', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-bench-'));
  try {
    const made = run([TOOL, 'generate', 'tight-budget', '--set', 'dev', '--count', '2', '--difficulty', '1', '--out', join(dir, 'set')]);
    assert.equal(made.status, 0, made.stderr);
    const instances = await json(join(dir, 'set', 'instances.json'));
    const args = (instances.bench.args as string[]).slice(1);
    assert.deepEqual(args.slice(args.indexOf('--seed-list'), args.indexOf('--seed-list') + 4), ['--seed-list', '1', '--repeats', '1']);
    const oracle = await bench(['--agent', 'oracle', ...args, '--mirror', 'off']);
    for (const runResult of oracle.report.runs) {
      const instance = instances.instances.find((value: Json) => value.taskId === runResult.taskId);
      // The instance's own record (written by the generator) names the budget; the run used exactly it.
      assert.equal(runResult.pass, true, runResult.id);
      assert.equal(runResult.actions, instance.limits.actions);
      assert.equal(runResult.referenceActions, instance.limits.actions);
    }
    assert.deepEqual(oracle.report.references.tasks.map((task: Json) => task.minimal), [true, true]);
    assert.equal(oracle.report.environment.world.generated[0].id, 'challenge-tight-budget');
    const verified = run([CLI, 'report', join(oracle.folder, 'report.json'), '--verify']);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(run([CLI, 'report', join(oracle.folder, 'report.json')]).stdout, /efficiency vs minimal length 1\.00/);

    const random = await bench(['--agent', 'random', ...args, '--mirror', 'off']);
    for (const runResult of random.report.runs) {
      const budget = instances.instances.find((value: Json) => value.taskId === runResult.taskId).limits.actions;
      assert.equal(runResult.pass, false, runResult.id);
      // Accepted changes (act, undo, reset) never exceed the task's limit; the host refused the rest.
      assert.ok(runResult.acceptedActions + runResult.undos + runResult.resets <= budget, `${runResult.id}: ${runResult.acceptedActions} accepted, budget ${budget}`);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the gate tool reads, re-verifies and judges five bench folders, and refuses a round below 24 held-out instances by name', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-gate-'));
  try {
    const made = run([TOOL, 'generate', 'tight-budget', '--set', 'heldout', '--round', '1', '--seed', '1000000', '--count', '2', '--difficulty', '1', '--out', join(dir, 'set')]);
    assert.equal(made.status, 0, made.stderr);
    const args = ((await json(join(dir, 'set', 'instances.json'))).bench.args as string[]).slice(1);
    const oracle = await bench(['--agent', 'oracle', ...args, '--mirror', 'off']);
    // Four more reports of the same runs under other agent names: consistent reports whose
    // artifacts still re-verify (the agent fields are not part of what the artifacts bind).
    const copies: string[] = [];
    for (const [index, agent] of [{ kind: 'builtin', name: 'random', command: [], isolation: 'builtin-baseline', model: null, modelSource: 'none', apiKeySource: null },
      ...['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map(model => ({ kind: 'preset', name: 'claude-code', command: ['claude', '-p'], isolation: 'tool-restricted-preset', model, modelSource: 'client-attested', apiKeySource: 'none' }))].entries()) {
      const copy = join(dir, `agent-${index}`); await cp(oracle.folder, copy, { recursive: true });
      const report = await json(join(copy, 'report.json')); report.agent = { ...agent, keptEnv: [] };
      await writeFile(join(copy, 'report.json'), JSON.stringify(report));
      copies.push(join(copy, 'report.json'));
    }
    const gate = run([TOOL, 'gate', '--family', 'tight-budget', '--round', '1', '--oracle', join(oracle.folder, 'report.json'), '--random', copies[0]!, '--ladder', copies.slice(1).join(','),
      '--strongest', 'claude-opus-5-5', '--weakest', 'claude-haiku-5-5', '--out', join(dir, 'gate.md')]);
    assert.equal(gate.status, 2, gate.stderr);
    assert.match(gate.stderr, /gate_input_invalid: the gate needs at least 24 held-out instances, these reports have 2/);
    // A report whose artifacts were changed is refused before anything is computed.
    await writeFile(join(dir, 'agent-1', 'tight-budget-1000000-s1-r1', 'session.json'), '{}');
    const tampered = run([TOOL, 'gate', '--family', 'tight-budget', '--round', '1', '--oracle', join(oracle.folder, 'report.json'), '--random', copies[0]!, '--ladder', copies.slice(1).join(','),
      '--strongest', 'claude-opus-5-5', '--weakest', 'claude-haiku-5-5', '--out', join(dir, 'gate.md')]);
    assert.equal(tampered.status, 2); assert.match(tampered.stderr, /bench_artifact_changed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('--checks reaches the host in a bench run and is recorded; a limited-checks instance carries its own limit', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-checks-'));
  try {
    const made = run([TOOL, 'generate', 'limited-checks', '--set', 'dev', '--count', '1', '--difficulty', '2', '--out', join(dir, 'set')]);
    assert.equal(made.status, 0, made.stderr);
    const instances = await json(join(dir, 'set', 'instances.json'));
    assert.deepEqual(instances.instances[0].limits, { checks: 1 });
    const args = (instances.bench.args as string[]).slice(1);
    // The oracle checks once at the end; with --checks 0 the host refuses that check, and the
    // separate checker still judges the board.
    const none = await bench(['--agent', 'oracle', ...args, '--mirror', 'off', '--checks', '0']);
    assert.equal(none.report.settings.checks, 0);
    assert.equal(none.report.runs[0].pass, true);
    assert.match(none.report.runs[0].note, /check_result failed: check_budget_exhausted/);
    const own = await bench(['--agent', 'oracle', ...args, '--mirror', 'off']);
    assert.equal(Object.hasOwn(own.report.settings, 'checks'), false);
    assert.equal(own.report.runs[0].note, undefined, 'the instance allows one check, which the oracle uses');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

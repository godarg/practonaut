// The command-template example examples/agents/minimal-agent.mjs (docs/benchmarks/README.md §2), run
// the way the docs say: bench starts it by absolute path with {mcp_config} and a plan, here the
// oracle.json of the CI-recipe fixture (one task made with `tasks from-scenes`). Played whole, the plan
// passes; with --mistake its last action is missing and the checker fails the run, judged. Named by a
// relative path, the script is not found from the run's agent/ folder: the run ends as infra_error
// without a single tool call, and only agent.stderr says why. Expected values come from the plan file.
// The same bench with two seeds on this one-variant world prints the notice seeds_share_variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../../examples/agents/minimal-agent.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../fixtures/ci-recipe/', import.meta.url));
const PLAN = join(FIXTURE, 'oracle.json');
const benchRoot = (): string => join(process.env.PRACTONAUT_HOME!, 'bench');
const benches = async (): Promise<Set<string>> => new Set(await readdir(benchRoot()).catch(() => [] as string[]));
type Json = Record<string, any>;

/** One bench on the fixture world with the given agent; returns the CLI result and the new bench folder's report. */
async function bench(agent: string, ...extra: string[]): Promise<{ stderr: string; folder: string; report: Json }> {
  const before = await benches();
  const result = spawnSync(process.execPath, [CLI, 'bench', '--agent', agent, '--world', join(FIXTURE, 'world'), '--oracle', PLAN, '--mirror', 'off', ...extra], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
  const created = [...await benches()].filter(name => !before.has(name));
  assert.equal(created.length, 1, `one new bench folder: ${created.join(', ')}`);
  const folder = join(benchRoot(), created[0]!);
  return { stderr: result.stderr, folder, report: JSON.parse(await readFile(join(folder, 'report.json'), 'utf8')) as Json };
}
// Quoted words: the template is split like a shell would split it, but never run by one.
const template = (script: string, ...rest: string[]): string => [process.execPath, script, '{mcp_config}', PLAN, ...rest].map(word => word.startsWith('{') || word.startsWith('--') ? word : `'${word}'`).join(' ');

test('the minimal example agent passes with its plan, fails judged with --mistake, and a relative path ends as infra_error explained in agent.stderr', { timeout: 300_000 }, async () => {
  const plan = (JSON.parse(await readFile(PLAN, 'utf8')) as { steps: unknown[] }).steps.length;

  const solved = await bench(template(EXAMPLE), '--label', 'example agent');
  assert.equal(solved.stderr.includes('seeds_share_variant'), false, 'one seed: no notice');
  assert.deepEqual([solved.report.agent.kind, solved.report.agent.name, solved.report.label], ['command', 'generic', 'example agent']);
  const [run] = solved.report.runs as Json[];
  assert.deepEqual([run!.status, run!.pass, run!.actions, run!.toolCalls.act, run!.toolCalls.check], ['completed', true, plan, plan, 1]);
  assert.match(await readFile(join(solved.folder, run!.id, 'agent.stdout'), 'utf8'), /^check_result: passed$/m);

  const mistaken = await bench(template(EXAMPLE, '--mistake'));
  const [failed] = mistaken.report.runs as Json[];
  assert.deepEqual([failed!.status, failed!.pass, failed!.actions, failed!.toolCalls.check], ['completed', false, plan - 1, 1]);
  assert.equal(failed!.checker.session.passed, false, 'judged by the checker, not passed');

  // The agent's working directory is its own empty folder: a path relative to the bench's directory
  // does not resolve there, and only agent.stderr names the missing script.
  const relative = await bench(`node examples/agents/minimal-agent.mjs {mcp_config} '${PLAN}'`);
  const [lost] = relative.report.runs as Json[];
  assert.deepEqual([lost!.status, lost!.checker, lost!.toolCalls.total], ['infra_error', null, 0]);
  assert.match(lost!.note, /without a single tool call/);
  assert.match(await readFile(join(relative.folder, lost!.id, 'agent.stderr'), 'utf8'), /Cannot find module '.*[\\/]agent[\\/]examples[\\/]agents[\\/]minimal-agent\.mjs'/);
});

test('two seeds on a world with one variant: bench names the task and its variant count on stderr and still runs both', { timeout: 300_000 }, async () => {
  const doubled = await bench('oracle', '--seed-list', '1,2');
  assert.match(doubled.stderr, /^practonaut bench: notice seeds_share_variant: task review-and-send has 1 variant, but the 2 seeds give only 1 distinct board per task\. /m);
  // Instances are counted as before (a later decision): two seeds, two instances.
  assert.deepEqual([doubled.report.settings.seeds, doubled.report.runs.length], [[1, 2], 2]);
  const repeated = await bench('oracle', '--seed-list', '1', '--repeats', '2');
  assert.equal(repeated.stderr.includes('seeds_share_variant'), false, 'one seed with repeats: no notice');
});

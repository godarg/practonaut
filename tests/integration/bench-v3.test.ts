// bench/3 at session level through the real CLI and runner (PADR-0044), with a stand-in `claude` (no
// language model) started by the claude-code preset: the agent's evidenced identity, the stdout binding,
// isolation from the tools the client offered, the structured failure of a run the client rejected,
// and `report --verify` refusing each relabelled or changed value by its code. Expected values come
// from the stand-in's own output (written in tests/support/fake-claude.ts) and node:crypto, not from
// the runner. `bench --recover` refuses a folder written before /3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { appendFile, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeClaude } from '../support/fake-claude.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const V2_FOLDER = fileURLToPath(new URL('../fixtures/bench/v2/', import.meta.url));
const CI_WORLD = fileURLToPath(new URL('../fixtures/ci-recipe/world/', import.meta.url));
const CI_ORACLE = fileURLToPath(new URL('../fixtures/ci-recipe/oracle.json', import.meta.url));
type Json = Record<string, any>;
const SEVEN = ['act', 'check_result', 'explain_result', 'list_actions', 'observe', 'reset', 'undo'].map(tool => `mcp__practonaut__${tool}`);

test('a preset bench writes /3 with evidenced identity, bound stdout and isolation from the offered tools; --verify refuses each change by its code', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-v3-'));
  try {
    const bin = join(dir, 'bin'), home = join(dir, 'home'); await mkdir(bin); await fakeClaude(bin);
    const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
    const env = { ...process.env, PRACTONAUT_HOME: home, PN_FAKE_MODEL: 'claude-opus-5-5', ANTHROPIC_MODEL: 'claude-opus-5-5', [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
    const cli = (args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
    const bench = async (extra: Record<string, string> = {}): Promise<{ folder: string; report: Json }> => {
      const before = new Set(await readdir(join(home, 'bench')).catch(() => [] as string[]));
      const result = cli(['bench', '--agent', 'claude-code', '--tasks', 'connect', '--seed-list', '1,2', '--mirror', 'off', '--timeout', '60'], extra);
      assert.equal(result.status, 0, result.stderr);
      const folder = join(home, 'bench', (await readdir(join(home, 'bench'))).filter(name => !before.has(name))[0]!);
      return { folder, report: JSON.parse(await readFile(join(folder, 'report.json'), 'utf8')) as Json };
    };
    const verify = (path: string) => cli(['report', path, '--verify']);

    const { folder, report } = await bench();
    assert.deepEqual([report.schema, report.verdictLevel, report.toolchain.kind, report.environment.app], ['practonaut.bench/3', 'session', 'practonaut', { adapterId: 'excalidraw', version: '0.18.1' }]);
    // The agent: the stand-in reports claude-opus-5-5 and Claude Code 2.1.0 and its own login ("none").
    assert.deepEqual(report.agent, {
      kind: 'preset', name: 'claude-code', command: report.agent.command, isolation: 'tool-restricted-preset', model: 'claude-opus-5-5', modelSource: 'client-attested', apiKeySource: 'none', keptEnv: [],
      vendor: { value: 'anthropic', source: 'client-attested' }, client: { value: 'claude-code', source: 'preset-requested' }, clientVersion: { value: '2.1.0', source: 'client-attested' },
      requestedModel: { value: 'claude-opus-5-5', source: 'preset-requested' }, settings: [], billing: { class: 'subscription', source: 'preset-requested' },
    });
    for (const run of report.runs as Json[]) {
      const stdout = await readFile(join(folder, run.id, 'agent.stdout'));
      assert.deepEqual(run.stdout, { sha256: createHash('sha256').update(stdout).digest('hex'), bytes: stdout.length });
      assert.deepEqual(run.isolation, { level: 'tool-restricted-preset', evidence: 'tools-within-servers' });
      assert.deepEqual(run.client.tools, { names: SEVEN, omitted: 0 });
      assert.deepEqual(run.client.billing, { class: 'subscription', source: 'client-attested', via: 'claude-code-stream/1:init.apiKeySource' });
      assert.equal(run.client.parser, 'claude-code-stream/1');
      assert.equal(run.agentActions, run.actions);
    }
    assert.equal(verify(join(folder, 'report.json')).status, 0);

    // Changes to the report or the folder, each refused by its named code.
    const edited = async (name: string, change: (value: Json) => void): Promise<string> => {
      const copy = join(dir, name); await cp(folder, copy, { recursive: true });
      const value = JSON.parse(await readFile(join(copy, 'report.json'), 'utf8')) as Json; change(value);
      await writeFile(join(copy, 'report.json'), JSON.stringify(value)); return join(copy, 'report.json');
    };
    let refused = verify(await edited('identity', value => { value.instances[0].identity = 'f'.repeat(64); }));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the task identity of connect with seed 1 is not the one the stored world gives \[bench_world_changed\]/);
    refused = verify(await edited('app', value => { value.environment.app.adapterId = 'drawio'; }));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the report names application adapter drawio; the stored world is for excalidraw \[bench_world_changed\]/);
    refused = verify(await edited('model', value => { value.agent.model = 'claude-haiku-5-5'; value.runs[0].client.model = 'claude-haiku-5-5'; }));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run connect-s1-r1: the report names model claude-haiku-5-5, but the agent's own output names claude-opus-5-5 \[bench_report_invalid\]/);
    refused = verify(await edited('billing', value => { value.runs[1].client.billing.class = 'api-key'; }));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run connect-s2-r1: its client is not what the parser reads from the run's bound stdout \[bench_report_invalid\]/);
    refused = verify(await edited('command', value => { value.agent.command = [...value.agent.command, '--dangerously-skip-permissions']; }));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the report names preset claude-code with a command this Practonaut does not ship for it/);
    const stdoutChanged = await edited('stdout', () => {});
    await appendFile(join(stdoutChanged, '..', 'connect-s1-r1', 'agent.stdout'), '{"type":"system","subtype":"note"}\n');
    refused = verify(stdoutChanged); assert.equal(refused.status, 2); assert.match(refused.stderr, /connect-s1-r1.*agent\.stdout.*\[bench_artifact_changed\]/);

    // A client that offers a shell tool: not restricted, by its own run's evidence.
    const shell = await bench({ PN_FAKE_TOOLS: [...SEVEN, 'Bash'].join(',') });
    assert.equal(shell.report.agent.isolation, 'template-unrestricted');
    assert.deepEqual(shell.report.runs.map((run: Json) => run.isolation), [{ level: 'template-unrestricted', evidence: 'tool-outside-servers' }, { level: 'template-unrestricted', evidence: 'tool-outside-servers' }]);
    assert.match(cli(['report', join(shell.folder, 'report.json')]).stdout, /template: tools not restricted by Practonaut/);
    assert.equal(verify(join(shell.folder, 'report.json')).status, 0);

    // A usage limit before any model message: infra_error with the parser's failure; --verify re-derives it.
    const limited = await bench({ PN_FAKE_MODE: 'usage-limit' });
    assert.deepEqual(limited.report.runs.map((run: Json) => [run.status, run.failure]), [
      ['infra_error', { reason: 'usage_limit', parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true }],
      ['infra_error', { reason: 'usage_limit', parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true }],
    ]);
    assert.equal(verify(join(limited.folder, 'report.json')).status, 0);
    const relabelled = join(dir, 'relabelled'); await cp(limited.folder, relabelled, { recursive: true });
    const value = JSON.parse(await readFile(join(relabelled, 'report.json'), 'utf8')) as Json;
    value.runs[0].failure.code = '529';
    await writeFile(join(relabelled, 'report.json'), JSON.stringify(value));
    refused = verify(join(relabelled, 'report.json'));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run connect-s1-r1: its failure is not what the parser reads/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('bench --recover writes /3 only: a folder whose mutation log was written by the /2 writer is refused by name', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-recover-v2-'));
  try {
    // The committed /2 folder, without its report, world and references (as a killed bench leaves it).
    const folder = join(dir, 'bench');
    await cp(V2_FOLDER, folder, { recursive: true });
    for (const name of ['report.json', 'world.pnworld', 'references.json']) await rm(join(folder, name));
    const result = spawnSync(process.execPath, [CLI, 'bench', '--agent', 'oracle', '--world', CI_WORLD, '--oracle', CI_ORACLE, '--seed-list', '1', '--repeats', '2', '--checks', '4', '--mirror', 'required', '--recover', folder], { encoding: 'utf8', env: { ...process.env, PRACTONAUT_HOME: join(dir, 'home') } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /run review-and-send-s1-r1: its mutation log is not a bench\/3 log \(written by an earlier Practonaut, or changed\); recover it with the Practonaut that ran it/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

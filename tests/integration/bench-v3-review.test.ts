// Review findings on bench/3 (PR #66) reproduced on a real preset bench (a stand-in `claude` that names
// claude-opus-5-5 and Claude Code 2.1.0, tests/support/fake-claude.ts): each attack edits the report or
// the bench folder as the reviewers did, and `report --verify` and the 0.2.0 gate's reader refuse it by
// name — or, for a report of a newer Practonaut, read its client values only as the report's claims.
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
import { summarize, type SessionRunV3 } from '../../src/bench/report.ts';
import { readGateReport } from '../../src/challenge/files.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
type Json = Record<string, any>;
const SEVEN = ['act', 'check_result', 'explain_result', 'list_actions', 'observe', 'reset', 'undo'].map(tool => `mcp__practonaut__${tool}`);
const sha = (bytes: Buffer | string): { sha256: string; bytes: number } => ({ sha256: createHash('sha256').update(bytes).digest('hex'), bytes: Buffer.byteLength(bytes) });

test('review A, B, C, E: relabelled client values, a hidden failure, edited agent fields and an unbound stdout are refused; a newer report\'s values stay claims', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-v3-review-'));
  try {
    const bin = join(dir, 'bin'), home = join(dir, 'home'); await mkdir(bin); await fakeClaude(bin);
    const pathKey = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH') ?? 'PATH';
    const env = { ...process.env, PRACTONAUT_HOME: home, PN_FAKE_MODEL: 'claude-opus-5-5', ANTHROPIC_MODEL: 'claude-opus-5-5', [pathKey]: bin + delimiter + (process.env[pathKey] ?? '') };
    const cli = (args: string[], extra: Record<string, string> = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...env, ...extra } });
    const bench = async (extra: Record<string, string> = {}): Promise<string> => {
      const before = new Set(await readdir(join(home, 'bench')).catch(() => [] as string[]));
      const result = cli(['bench', '--agent', 'claude-code', '--tasks', 'connect', '--seed-list', '1,2', '--mirror', 'off', '--timeout', '60'], extra);
      assert.equal(result.status, 0, result.stderr);
      return join(home, 'bench', (await readdir(join(home, 'bench'))).filter(name => !before.has(name))[0]!);
    };
    const folder = await bench(), shell = await bench({ PN_FAKE_TOOLS: [...SEVEN, 'Bash'].join(',') });
    const edited = async (source: string, name: string, change: (value: Json, copy: string) => Promise<void> | void): Promise<string> => {
      const copy = join(dir, name); await cp(source, copy, { recursive: true });
      const value = JSON.parse(await readFile(join(copy, 'report.json'), 'utf8')) as Json; await change(value, copy);
      await writeFile(join(copy, 'report.json'), JSON.stringify(value)); return join(copy, 'report.json');
    };
    const verify = (path: string) => cli(['report', path, '--verify']);
    assert.equal(verify(join(folder, 'report.json')).status, 0);

    // A. Opus relabelled to Haiku with every run's parser renamed to one this Practonaut does not ship.
    const relabel = (value: Json): void => { value.agent.model = 'claude-haiku-5-5'; for (const run of value.runs) { run.client.parser = 'claude-code-stream/2'; run.client.model = 'claude-haiku-5-5'; } };
    const own = await edited(folder, 'relabelled', relabel);
    let refused = verify(own);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run connect-s1-r1 names parser claude-code-stream\/2, which this Practonaut does not ship; a report of Practonaut [^ ]+, this version or an older one, can only name shipped parsers \[bench_report_invalid\]/);
    await assert.rejects(readGateReport(own), /names parser claude-code-stream\/2/);
    // The same for isolation: a client that offered a shell tool, its runs' evidence rewritten to "within".
    const restricted = await edited(shell, 'restricted', value => {
      value.agent.isolation = 'tool-restricted-preset';
      for (const run of value.runs) { run.client.parser = 'x/1'; run.client.tools = { names: SEVEN, omitted: 0 }; run.isolation = { level: 'tool-restricted-preset', evidence: 'tools-within-servers' }; }
    });
    refused = verify(restricted);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /names parser x\/1, which this Practonaut does not ship/);
    // A report of a newer Practonaut may name a parser this one does not ship: read, its client values the
    // report's claims on every surface, and never taken by the gate.
    const newer = await edited(folder, 'newer', value => { relabel(value); value.environment.practonaut = '9.9.9'; });
    const read = cli(['report', newer, '--verify', '--junit', join(dir, 'newer.xml')]);
    assert.equal(read.status, 0, read.stderr);
    // The header says it once, by the verification; the isolation and the model keep their own words.
    assert.match(read.stdout, /re-verified; client values not re-derived · /);
    assert.match(read.stdout, / · tool-restricted preset · model claude-haiku-5-5 \(self-reported, client-attested\)$/m);
    assert.equal(read.stdout.includes('the report’s claim, not re-derived'), false);
    assert.match(read.stdout, /not re-derived: values read by the parser claude-code-stream\/2/);
    assert.match(await readFile(join(dir, 'newer.xml'), 'utf8'), /<property name="practonaut\.verification\.clientValues" value="not re-derived: the report&apos;s claims"\/>/);
    await assert.rejects(readGateReport(newer), /values read by claude-code-stream\/2 were not re-derived by this Practonaut/);

    // B. A client failure in a judged run's own output that the report leaves out (the session kept).
    const hiddenFailure = await edited(folder, 'hidden-failure', async (value, copy) => {
      const path = join(copy, 'connect-s1-r1', 'agent.stdout');
      await appendFile(path, '{"type":"rate_limit_event","rate_limit_info":{"status":"rejected"}}\n');
      value.runs[0].stdout = sha(await readFile(path));
    });
    refused = verify(hiddenFailure);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run connect-s1-r1: its failure is not what the parser reads from the run's bound stdout \[bench_report_invalid\]/);

    // C. Agent fields edited in report.json alone, each refused by name.
    for (const [name, change, field] of [
      ['vendor', (value: Json) => { value.agent.vendor = { value: 'openai', source: 'client-attested' }; }, 'agent.vendor'],
      ['client', (value: Json) => { value.agent.client = { value: 'codex', source: 'preset-requested' }; }, 'agent.client'],
      ['billing-local', (value: Json) => { value.agent.billing = { class: 'local', source: 'preset-requested' }; }, 'agent.billing'],
      ['version-source', (value: Json) => { value.agent.clientVersion = { value: '2.1.0', source: 'preset-requested' }; }, 'agent.clientVersion'],
      ['settings', (value: Json) => { value.agent.settings = [{ name: 'effort', value: 'high' }]; }, 'agent.settings'],
    ] as const) {
      refused = verify(await edited(folder, name, change));
      assert.equal(refused.status, 2, name); assert.match(refused.stderr, new RegExp(`its ${field.replace('.', '\\.')} is not what the parser reads from the run's bound stdout \\[bench_report_invalid\\]`), name);
    }

    // E. A run's readable stdout hidden behind "stdout: null": its client listed a shell tool, the run made
    // unjudged with "no evidence", so the other run's evidence alone would make the preset look restricted.
    const unbound = await edited(folder, 'unbound', async (value, copy) => {
      await writeFile(join(copy, 'connect-s1-r1', 'agent.stdout'), JSON.stringify({ type: 'system', subtype: 'init', tools: [...SEVEN, 'Bash'], mcp_servers: [{ name: 'practonaut', status: 'connected' }], model: 'claude-opus-5-5', apiKeySource: 'none', claude_code_version: '2.1.0' }) + '\n');
      const run = value.runs[0] as Json;
      Object.assign(run, { status: 'infra_error', pass: false, checker: null, agentExitCode: null, note: 'interrupted', failure: { reason: 'interrupted', parser: null, code: null, beforeModelWork: null }, stdout: null, isolation: { level: 'template-unrestricted', evidence: 'no-evidence' } });
      delete run.artifacts; delete run.client;
      value.summary = summarize(value.runs as SessionRunV3[], 1, entry => entry.agentActions);
    });
    assert.equal(cli(['report', unbound]).status, 0, 'the forgery is consistent');
    refused = verify(unbound);
    assert.equal(refused.status, 2); assert.match(refused.stderr, /run connect-s1-r1 binds no stdout, but its folder holds a readable agent\.stdout \[bench_artifact_changed\]/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

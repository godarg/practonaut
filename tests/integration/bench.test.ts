// practonaut bench end to end: baselines through MCP, external command agents through the
// generated MCP configuration, scoring only from host counters and the independent checker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBench } from '../../src/bench/run.ts';
import { resolveAgent } from '../../src/bench/agents.ts';
import { summarize, validateBenchReport, type BenchReportV2 as BenchReport } from '../../src/bench/report.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const AGENT = fileURLToPath(new URL('../support/bench-agent.ts', import.meta.url));
const base = { seeds: [1], repeats: 1, timeoutSeconds: 60, maxActions: 50, mirrorRequested: 'off' as const, mirror: 'off' as const };

test('CLI: oracle passes every run with the real mirror; report renders; a forged pass is refused', { timeout: 300_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-'));
  try {
    const out = join(dir, 'oracle.json');
    const benchRoot = join(process.env.PRACTONAUT_HOME!, 'bench'), before = new Set(await readdir(benchRoot).catch(() => []));
    const bench = spawnSync(process.execPath, [CLI, 'bench', '--agent', 'oracle', '--tasks', 'excalidraw/connect,insert-between,remove-step', '--seeds', '2', '--mirror', 'required', '--out', out], { encoding: 'utf8', env: process.env });
    assert.equal(bench.status, 0, bench.stderr);
    const runs = (await readdir(benchRoot)).filter(name => !before.has(name)); assert.equal(runs.length, 1);
    // The native-export artifacts are re-judged as well when the report lives outside its run directory.
    const verified = spawnSync(process.execPath, [CLI, 'report', out, '--verify', '--runs', join(benchRoot, runs[0]!)], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr); assert.match(verified.stdout, /Re-verified: 6 runs re-judged by the checker from their artifacts, against the world stored in the bench folder \(excalidraw-library [^)]+\); every verdict matches \(0 not judged\); 3 references re-checked/);
    const report = validateBenchReport(JSON.parse(await readFile(out, 'utf8')));
    assert.deepEqual([report.summary.runs, report.summary.passed, report.summary.passAt1, report.environment.mirror], [6, 6, 1, 'required']);
    for (const run of report.runs) { assert.equal(run.checker?.native?.passed, true, run.id); assert.equal(run.actions, run.referenceActions); }
    assert.equal(JSON.stringify(report).includes(dir), false, 'no absolute run paths in the report');
    const html = join(dir, 'oracle.html');
    const rendered = spawnSync(process.execPath, [CLI, 'report', out, '--html', html], { encoding: 'utf8' });
    assert.equal(rendered.status, 0, rendered.stderr); assert.match(rendered.stdout, /6 runs, 6 passed \(100\.0 %\)/);
    assert.match(await readFile(html, 'utf8'), /^<!doctype html>/);
    // Negative control at the CLI: one failed run rewritten to pass, with the summary recomputed by hand.
    const forged = structuredClone(report) as BenchReport; forged.runs[0]!.checker!.session.passed = false;
    await writeFile(join(dir, 'forged.json'), JSON.stringify(forged));
    const refused = spawnSync(process.execPath, [CLI, 'report', join(dir, 'forged.json')], { encoding: 'utf8' });
    assert.equal(refused.status, 2); assert.match(refused.stderr, /\[bench_report_invalid\]/); assert.equal(refused.stdout, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('random stays inside the action budget and is scored by the checker, not by itself', { timeout: 300_000 }, async () => {
  const report = (await runBench({ ...base, agent: resolveAgent('random'), tasks: ['connect', 'decision'], seeds: [1, 2], maxActions: 5 })).report!;
  assert.equal(report.runs.length, 4);
  for (const run of report.runs) {
    assert.equal(run.status, 'completed', run.note);
    assert.ok(run.acceptedActions + run.undos + run.resets <= 5, `${run.id} exceeded the budget`);
    assert.ok(run.checker, run.id);
  }
  assert.ok(report.summary.passAt1 < 1);
});

test('external command agents: MCP through the generated config, opaque output, timeout and missing command', { timeout: 300_000 }, async () => {
  const command = (mode: string) => resolveAgent(`${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} ${mode} {mcp_config}`);
  const solved = (await runBench({ ...base, agent: command('solve'), tasks: ['connect'] })).report!.runs[0]!;
  assert.deepEqual([solved.status, solved.pass, solved.actions, solved.agentExitCode], ['completed', true, 1, 0]);
  assert.ok(solved.toolCalls.observe >= 2, 'the bridge start-up read and the agent observe reach the host');
  // A forged success on stdout changes nothing: the checker sees the untouched start state.
  const claim = (await runBench({ ...base, agent: command('claim'), tasks: ['connect'] })).report!.runs[0]!;
  assert.deepEqual([claim.status, claim.pass, claim.actions, claim.checker?.session.passed], ['completed', false, 0, false]);
  const slow = (await runBench({ ...base, agent: command('sleep'), tasks: ['connect'], timeoutSeconds: 2 })).report!.runs[0]!;
  assert.deepEqual([slow.status, slow.pass], ['timeout', false]); assert.ok(slow.checker);
  const missing = (await runBench({ ...base, agent: resolveAgent('practonaut-no-such-agent-binary {mcp_config}'), tasks: ['connect'] })).report!.runs[0]!;
  assert.deepEqual([missing.status, missing.pass], ['agent_failed', false]);
});

test('report --verify re-judges every run from its artifacts; a consistent forgery passes the consistency check only', { timeout: 300_000 }, async () => {
  const command = resolveAgent(`${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} claim {mcp_config}`);
  const bench = await runBench({ ...base, agent: command, tasks: ['connect', 'decision'] }); const report = bench.report!, directory = bench.directory;
  const path = join(directory, 'report.json'); await writeFile(path, JSON.stringify(report));
  const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, 'report', ...args], { encoding: 'utf8' });
  for (const run of report.runs) { assert.equal(run.pass, false, run.id); assert.match(run.artifacts?.session ?? '', /^[a-f0-9]{64}$/); assert.equal(run.artifacts?.native, null); }
  const plain = cli(path); assert.equal(plain.status, 0, plain.stderr); assert.match(plain.stdout, /Consistency-checked, not re-verified/);
  const json = cli(path, '--json'); assert.equal(JSON.parse(json.stdout).verification.level, 'consistency-checked');
  const verified = cli(path, '--verify'); assert.equal(verified.status, 0, verified.stderr); assert.match(verified.stdout, /Re-verified: 2 runs re-judged/);
  const verification = JSON.parse(cli(path, '--verify', '--json').stdout).verification;
  assert.deepEqual([verification.level, verification.reverified, verification.unjudged, verification.references, verification.world.id], ['re-verified', 2, 0, 2, 'excalidraw-library']);
  // A forgery that keeps the file consistent: a failed run rewritten to pass, the summary recomputed.
  const forged = structuredClone(report) as BenchReport; const target = forged.runs[0]!;
  target.checker!.session = { passed: true, errorClasses: [] }; target.pass = true; forged.summary = summarize(forged.runs, 1);
  const forgedPath = join(directory, 'forged.json'); await writeFile(forgedPath, JSON.stringify(forged));
  const consistent = cli(forgedPath); assert.equal(consistent.status, 0, 'the consistency check alone cannot see it'); assert.match(consistent.stdout, /not re-verified/);
  const refused = cli(forgedPath, '--verify'); assert.equal(refused.status, 2); assert.match(refused.stderr, /verdict differs from the re-run checker.*\[bench_report_invalid\]/); assert.equal(refused.stdout, '');
  // A changed artifact no longer matches the hash the report binds.
  await appendFile(join(directory, report.runs[1]!.id, 'session.json'), ' ');
  const tampered = cli(path, '--verify'); assert.equal(tampered.status, 2); assert.match(tampered.stderr, /artifact session\.json does not match the hash the report binds.*\[bench_artifact_changed\]/);
  // A /2 report whose judged runs bind no artifacts is refused already by the consistency check
  // (a /1 report without them can only be consistency-checked: tests/integration/bench-own-world.test.ts).
  const unbound = structuredClone(report) as BenchReport; for (const run of unbound.runs) delete run.artifacts;
  await writeFile(join(directory, 'unbound.json'), JSON.stringify(unbound));
  const old = cli(join(directory, 'unbound.json'), '--verify'); assert.equal(old.status, 2); assert.match(old.stderr, /a judged run binds its artifacts.*\[bench_report_invalid\]/);
  assert.equal(cli(join(directory, 'unbound.json'), '--runs', directory).status, 1, '--runs needs --verify');
});

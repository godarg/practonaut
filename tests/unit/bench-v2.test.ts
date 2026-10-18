// practonaut.bench/2 (PADR-0036): the validator's /2 rules, the summary with optional references, the
// committed JSON Schemas read from their files, the stored bench/1 fixture, rendering of the new
// fields, the client init line, the new bench options, and the
// world and oracle helpers that run before any agent starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { BENCH_SCHEMA_V2, ISOLATION_OF, summarize, validateBenchReport, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';
import { renderHtml, renderTable } from '../../src/bench/render.ts';
import { clientInit } from '../../src/bench/agents.ts';
import { parseBenchArguments } from '../../src/cli/bench.ts';
import { cliText } from '../../src/cli/messages.ts';
import { assertReferencesFit, libraryReferences, ownBenchWorld, ownReferences, readAtMost, readOracleFile, readRegularFile, referencesText, resolveWorldTasks, validateOwnReferences, worldContentHash } from '../../src/bench/world.ts';
import { libraryAnchor } from '../../src/bench/verify.ts';
import { oracleDigest } from '../oracles/core-hash.ts';
import { v2World } from '../support/world-v2.ts';
import { fromScenes, type TaskOracle } from '../../src/authoring/from-scenes.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { World } from '../../src/world/types.ts';
import { arrow, between, box, scene } from '../support/scenes.ts';
import { buildZip } from '../support/zipwriter.ts';

const hash = (c: string): string => c.repeat(64);
function run(taskId: string, seed: number, repeat: number, verdict: boolean | null, actions: number, reference: number | null): BenchRunV2 {
  const checker = verdict === null ? null : { session: { passed: verdict, errorClasses: verdict ? [] : ['missing-arrow'] }, native: null };
  return { id: `${taskId}-s${seed}-r${repeat}`, taskId, seed, repeat, status: verdict === null ? 'infra_error' : 'completed', pass: verdict === true, actions, acceptedActions: actions, rejectedActions: 0, undos: 0, resets: 0,
    toolCalls: { observe: 2, act: actions, undo: 0, reset: 0, check: 1, total: 3 + actions }, wallMs: 500, referenceActions: reference, checker, agentExitCode: verdict === null ? null : 0,
    ...(checker ? { artifacts: { session: hash('a'), native: null, checker: hash('c') } } : {}) };
}
/** An own world with two tasks: `Flow` has a reference of 2 actions, `other` has none. */
function v2Report(runs: BenchRunV2[] = [run('Flow', 2, 1, true, 4, 2), run('Flow', 5, 1, false, 1, 2), run('other', 2, 1, true, 3, null), run('other', 5, 1, null, 0, null)]): BenchReportV2 {
  return {
    schema: BENCH_SCHEMA_V2, createdAt: '2026-10-14T12:00:00.000Z', label: 'nightly',
    environment: { practonaut: '0.2.0-dev.0', excalidraw: '0.18.1', node: 'v22.22.3', os: { platform: 'linux', release: '6.8.0', arch: 'x64' }, mirror: 'off',
      world: { source: 'own', worldId: 'my-world', version: '1.0.0', contentHash: hash('d'), package: { path: 'world.pnworld', sha256: hash('e') }, generated: [{ taskId: 'Flow', id: 'repair', version: '0.1.0', seed: 17, parameters: { defects: 3 } }] } },
    agent: { kind: 'command', name: 'generic', command: ['my-agent', '{mcp_config}'], isolation: 'template-unrestricted', model: 'some-model', modelSource: 'command-output', apiKeySource: 'none', keptEnv: [] },
    settings: { tasks: ['Flow', 'other'], seeds: [2, 5], repeats: 1, timeoutSeconds: 300, maxActions: 50, mirror: 'off', prompt: 'p' },
    references: { path: 'references.json', sha256: hash('f'), tasks: [{ taskId: 'Flow', source: 'oracle-file', actions: 2 }] },
    runs, summary: summarize(runs, 1),
  };
}

test('summary: efficiency only over passed runs whose task has a validated reference', () => {
  const summary = v2Report().summary;
  // Hand calculation: passed runs with a reference: Flow s2 (reference 2, 4 actions) → 0.5.
  // other s2 passed but has no reference and is not counted.
  assert.equal(summary.efficiencyVsReference, 0.5);
  assert.deepEqual(summary.byTask.map(task => [task.taskId, task.referenceActions, task.efficiency]), [['Flow', 2, 0.5], ['other', null, null]]);
  assert.deepEqual([summary.runs, summary.passed, summary.infraErrors, summary.passAt1], [4, 2, 1, 0.5]);
  const none = summarize([run('other', 2, 1, true, 3, null)], 1);
  assert.equal(none.efficiencyVsReference, null);
});

test('a consistent /2 report validates; every inconsistent /2 field is refused', () => {
  assert.doesNotThrow(() => validateBenchReportV2(v2Report()));
  assert.equal(validateBenchReport(v2Report()).schema, BENCH_SCHEMA_V2);
  const refused = (mutate: (value: BenchReportV2) => void, message: RegExp): void => {
    const value = structuredClone(v2Report()); mutate(value); value.summary = summarize(value.runs, value.settings.repeats);
    assert.throws(() => validateBenchReport(value), (error: Error & { code?: string }) => error.code === 'bench_report_invalid' && message.test(error.message), message.source);
  };
  refused(value => { value.agent.isolation = 'tool-restricted-preset'; }, /kind command has isolation level template-unrestricted; the report says tool-restricted-preset/);
  refused(value => { value.agent.kind = 'builtin'; value.agent.isolation = 'builtin-baseline'; value.agent.model = null; value.agent.modelSource = 'none'; }, /kind builtin cannot have this command/);
  refused(value => { value.agent.modelSource = 'client-attested'; }, /kind command cannot have this modelSource/);
  refused(value => { value.agent.model = null; }, /a model without its source, or a model source without a model/);
  refused(value => { value.agent.keptEnv = ['ANTHROPIC_API_KEY']; }, /kind command cannot have this keptEnv/);
  refused(value => { value.agent = { ...value.agent, kind: 'builtin', command: [], isolation: 'builtin-baseline', model: null, modelSource: 'none' }; }, /kind builtin cannot have this apiKeySource/);
  refused(value => { value.runs[0]!.id = 'Flow-s2-r9'; }, /run Flow-s2-r9 is not named after its task, seed and repeat \(Flow-s2-r1\)/);
  refused(value => { value.runs[2]!.referenceActions = 3; }, /run other-s2-r1 names a reference of 3 actions; the report's references give null/);
  refused(value => { for (const r of value.runs.slice(0, 2)) r.referenceActions = 5; }, /run Flow-s2-r1 names a reference of 5 actions; the report's references give 2/);
  refused(value => { value.references!.tasks.push({ taskId: 'gone', source: 'oracle-file', actions: 1 }); }, /references name task gone twice, or a task that is not benched/);
  refused(value => { value.references!.tasks[0]!.source = 'library'; }, /a reference from library does not fit a world of source own/);
  refused(value => { value.environment.world.source = 'library'; value.references!.tasks[0]!.source = 'library'; }, /a library bench has a reference for every task; other has none/);
  refused(value => { value.environment.world.generated.push({ ...value.environment.world.generated[0]! }); }, /generator metadata names task Flow twice/);
  refused(value => { delete value.runs[0]!.artifacts; }, /run Flow-s2-r1: a judged run binds its artifacts/);
  refused(value => { value.runs[3]!.artifacts = { session: hash('a'), native: null, checker: hash('c') }; }, /binds artifacts but has no checker verdict|a judged run binds its artifacts/);
  refused(value => { value.settings.tasks = ['Flow', 'flow']; value.runs = value.runs.map(r => r.taskId === 'other' ? { ...r, taskId: 'flow', id: r.id.replace('other', 'flow') } : r); value.references = null; for (const r of value.runs) r.referenceActions = null; }, /settings name tasks Flow and flow, which differ only in case/);
  refused(value => { value.settings.seeds = [2, 1_000_000_000]; }, /does not match practonaut\.bench\/2: settings\.seeds\.1/);
  refused(value => { (value as unknown as Record<string, unknown>).label = ''; }, /does not match practonaut\.bench\/2: label/);
  refused(value => { (value.environment.world.package as { path: string }).path = '../elsewhere.pnworld'; }, /does not match practonaut\.bench\/2: environment\.world\.package\.path/);
  refused(value => { (value as unknown as Record<string, unknown>).schema = 'practonaut.bench/4'; }, /report does not match practonaut\.bench\/1, practonaut\.bench\/2, practonaut\.bench\/3/);
});

test('bench/2 run evidence (PADR-0039): picture, trace, mutation log, client timing and client figures follow their rules', () => {
  /** A command agent's report whose first run carries every evidence field. */
  const withEvidence = (): BenchReportV2 => {
    const value = structuredClone(v2Report()), first = value.runs[0]!;
    first.artifacts = { ...first.artifacts!, trace: hash('7'), board: null };
    first.logs = { calls: { sha256: hash('8'), entries: 9, dropped: 0, clientTiming: false }, mutations: { sha256: hash('9'), entries: first.toolCalls.act + first.toolCalls.check, omitted: 0 } };
    first.client = { source: 'command-output', model: 'some-model', turns: 6, costUsd: 0.05, tokens: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 } };
    return value;
  };
  assert.doesNotThrow(() => validateBenchReportV2(withEvidence()));
  const refused = (mutate: (value: BenchReportV2) => void, message: RegExp): void => {
    const value = withEvidence(); mutate(value); value.summary = summarize(value.runs, value.settings.repeats);
    assert.throws(() => validateBenchReport(value), (error: Error & { code?: string }) => error.code === 'bench_report_invalid' && message.test(error.message), message.source);
  };
  refused(value => { value.runs[0]!.artifacts!.board = hash('b'); }, /binds a picture of the real engine, but the bench ran without the mirror/);
  refused(value => { value.runs[0]!.artifacts!.traceError = 'checker_timeout'; }, /trace and a trace error must not appear together/);
  refused(value => { value.runs[0]!.artifacts!.trace = null; }, /a missing trace needs its error/);
  // A trace without the mutation log that re-derives it could never be re-verified: refused outright.
  refused(value => { delete value.runs[0]!.logs; }, /binds a condition trace without the mutation log it is re-derived from/);
  refused(value => { value.runs[0]!.logs!.mutations.entries += 1; }, /the mutation log holds 6 entries, but the run counted 5 act, undo, reset and check_result calls/);
  // The log records check calls too (PADR-0040): one without them is refused.
  refused(value => { value.runs[0]!.logs!.mutations.entries -= value.runs[0]!.toolCalls.check; }, /the mutation log holds 4 entries, but the run counted 5 act, undo, reset and check_result calls/);
  refused(value => { value.runs[0]!.logs!.calls!.clientTiming = true; }, /client timing comes only from Practonaut's own client/);
  refused(value => { value.runs[0]!.client!.source = 'client-attested'; }, /client figures come only from an external agent's own output, with the source its kind \(command\) allows/);
  // A trace that could not be made, with its error, is valid; so is a run without any evidence (an older /2 report).
  const failed = withEvidence(); failed.runs[0]!.artifacts!.trace = null; failed.runs[0]!.artifacts!.traceError = 'checker_timeout';
  assert.doesNotThrow(() => validateBenchReportV2(failed));
  // The JSON Schema file accepts the evidence fields and refuses an unknown one inside them.
  const schema = z.fromJSONSchema(JSON.parse(readFileSync(new URL('../../schemas/bench.v2.json', import.meta.url), 'utf8')) as Parameters<typeof z.fromJSONSchema>[0]);
  const value = JSON.parse(JSON.stringify(withEvidence()));
  assert.equal(schema.safeParse(value).success, true);
  value.runs[0].logs.mutations.extra = 1;
  assert.equal(schema.safeParse(value).success, false);
});

test('schemas/bench.v2.json, read from the file, accepts a /2 report and rejects extra, missing or /1 fields', () => {
  const read = (file: string) => z.fromJSONSchema(JSON.parse(readFileSync(new URL(`../../schemas/${file}`, import.meta.url), 'utf8')) as Parameters<typeof z.fromJSONSchema>[0]);
  const v2 = read('bench.v2.json'), v1 = read('bench.v1.json');
  const value = JSON.parse(JSON.stringify(v2Report()));
  assert.equal(v2.safeParse(value).success, true);
  assert.equal(v2.safeParse({ ...value, extra: 1 }).success, false);
  const noIsolation = structuredClone(value); delete noIsolation.agent.isolation;
  assert.equal(v2.safeParse(noIsolation).success, false);
  assert.equal(v1.safeParse(value).success, false, 'a /2 report is not a /1 report');
  // The bench/1 report kept as a fixture (made by the build before bench/2) still fits /1 only.
  const stored = JSON.parse(readFileSync(new URL('../fixtures/bench/v1/report.json', import.meta.url), 'utf8'));
  assert.equal(v1.safeParse(stored).success, true);
  assert.equal(v2.safeParse(stored).success, false);
  assert.equal(validateBenchReport(stored).schema, 'practonaut.bench/1');
});

test('rendering names label, isolation level, world, generated instances and "no reference"; text stays escaped', () => {
  const value = v2Report(); value.label = 'nightly \u001b[31m<b>run</b>\u202e';
  const table = renderTable(value), html = renderHtml(value, ':root{}');
  assert.match(table, /^Label: nightly \\u\{001b\}\[31m<b>run<\/b>\\u\{202e\}$/m);
  // The header line names the model, that it is self-reported, and where the name came from.
  assert.match(table, /^2\/4 passed · 95 % interval .* · template: tools not restricted by Practonaut · model some-model \(self-reported, from the command output\)$/m);
  assert.match(table, /^World: my-world 1\.0\.0 \(own world\)$/m);
  assert.match(table, /^World content hash \(SHA-256\): d{64}$/m);
  assert.match(table, /^Practonaut bench  generic$/m);
  assert.match(table, /^Generated instances: Flow \(repair 0\.1\.0, seed 17\)$/m);
  assert.match(table, /^API key source \(client-reported\): none$/m);
  assert.match(table, /efficiency vs reference length 0\.50, over 1 of 2 tasks with a validated reference/);
  assert.match(table, /^other .* no reference +no reference$/m);
  assert.match(html, /Label: nightly \\u\{001b\}\[31m&lt;b&gt;run&lt;\/b&gt;\\u\{202e\}/);
  assert.match(html, /<dt>Isolation<\/dt><dd>template: tools not restricted by Practonaut<\/dd>/);
  assert.match(html, /<td data-label="reference length">no reference<\/td><td data-label="efficiency vs reference length">no reference<\/td>/);
  // The world's content hash is an identifier: under Technical details, named as the world's.
  assert.match(html, /<details class="tech"><summary>Technical details<\/summary><dl class="settings">.*<dt>World content hash \(SHA-256\)<\/dt><dd><code>d{64}<\/code><\/dd>/);
  // The model appears once, as a provenance chip, with its source.
  assert.equal((html.match(/some-model/g) ?? []).length, 1);
  // The model id is data inside its chip: never hyphenated (design-language §10.5).
  assert.match(html, /<li class="chip">model <span class="data">some-model<\/span> \(self-reported, from the command output\)<\/li>/);
  assert.match(html.replace(/<\/?span[^>]*>/g, ''), /Not re-checked by report --verify: .*\(rejected, undo, reset, host calls, time\) and how the agent ended, what the client said about itself \(model, API key source, tokens, turns, cost\), and the call log the agent’s own bridge wrote/);
  const attested = v2Report(); attested.agent = { ...attested.agent, kind: 'preset', name: 'claude-code', isolation: 'tool-restricted-preset', modelSource: 'client-attested' };
  assert.match(renderTable(attested), /· model some-model \(self-reported, client-attested\)$/m);
  assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/.test(table + html), false);
  for (const [kind, words] of [['builtin', 'built-in baseline: no language model, MCP only'], ['preset', 'tool-restricted preset']] as const) {
    const other = v2Report(); other.agent = { ...other.agent, kind, isolation: ISOLATION_OF[kind], command: kind === 'builtin' ? [] : other.agent.command, model: null, modelSource: 'none', apiKeySource: null };
    assert.match(renderTable(other), new RegExp(`^2/4 passed · .* · ${words}${kind === 'builtin' ? '' : ' · model not reported'}$`, 'm'));
  }
  const de = renderTable(value, 'de');
  assert.match(de, /^2\/4 bestanden · 95-%-Intervall .* · Vorlage: Werkzeuge nicht von Practonaut eingeschränkt · Modell some-model \(Selbstauskunft, aus der Ausgabe des Befehls\)$/m);
  assert.match(de, /keine Referenz/);
  assert.match(renderHtml(value, ':root{}', 'de'), /<li class="chip">Modell <span class="data">some-model<\/span> \(Selbstauskunft, aus der Ausgabe des Befehls\)<\/li>/);
  const verified = renderHtml(value, ':root{}', 'en', 're-verified');
  assert.match(verified, /against the world stored with the runs/);
  // A /1 report did not record its isolation level or a world line; its header line says so.
  const v1 = JSON.parse(readFileSync(new URL('../fixtures/bench/v1/report.json', import.meta.url), 'utf8'));
  const old = renderTable(validateBenchReport(v1));
  assert.match(old, /^2\/2 passed · 95 % interval 34–100 % over 2 instances · session verdict · consistency-checked, not re-verified · real Excalidraw mirror · isolation not recorded \(bench\/1\)$/m);
  assert.equal(/^World:/m.test(old), false);
});

test('the client init line gives the model and apiKeySource, each only when it is plain text', () => {
  assert.deepEqual(clientInit('{"type":"system","subtype":"init","model":"claude-opus-5-5","apiKeySource":"none"}\n'), { model: 'claude-opus-5-5', apiKeySource: 'none', version: null });
  assert.deepEqual(clientInit('{"type":"system","subtype":"init","model":"m","apiKeySource":"ANTHROPIC_API_KEY"}'), { model: 'm', apiKeySource: 'ANTHROPIC_API_KEY', version: null });
  assert.deepEqual(clientInit('{"type":"system","subtype":"init","model":"m","apiKeySource":"\\u001b[2J"}'), { model: 'm', apiKeySource: null, version: null });
  assert.deepEqual(clientInit('{"type":"assistant","subtype":"init","apiKeySource":"none"}'), { model: null, apiKeySource: null, version: null });
  assert.deepEqual(clientInit('null "init"\n{"type":"system","subtype":"init","apiKeySource":"/login managed key"}'), { model: null, apiKeySource: '/login managed key', version: null });
});

test('bench options: --world, --oracle, --seed-list and --label, and their refusals', () => {
  const own = parseBenchArguments(['--agent', 'random', '--world', 'w', '--oracle', 'a.json, b.json', '--seed-list', '2,5,0', '--label', 'own']);
  assert.deepEqual([own.world, own.tasks, own.oracles, own.seeds, own.label], ['w', 'all', ['a.json', 'b.json'], [2, 5, 0], 'own']);
  assert.deepEqual(parseBenchArguments(['--agent', 'random', '--world', 'w', '--tasks', 'Flow,other']).tasks, ['Flow', 'other']);
  assert.deepEqual(parseBenchArguments(['--agent', 'oracle', '--seed-list=999999999']).seeds, [999_999_999]);
  assert.equal(parseBenchArguments(['--agent', 'oracle', '--label', 'x'.repeat(128)]).label?.length, 128);
  const refusals: Array<[string[], RegExp]> = [
    [['--agent', 'oracle', '--oracle', 'o.json'], /--oracle names the reference solution of a task in your own world; add --world/],
    [['--agent', 'oracle', '--seeds', '2', '--seed-list', '2,5'], /--seeds and --seed-list exclude each other/],
    [['--agent', 'oracle', '--seed-list', '2,2'], /--seed-list needs distinct whole numbers/],
    [['--agent', 'oracle', '--seed-list', '1,x'], /--seed-list needs distinct whole numbers/],
    [['--agent', 'oracle', '--seed-list', '1000000000'], /--seed-list needs distinct whole numbers/],
    [['--agent', 'oracle', '--seed-list', '1,,2'], /--seed-list needs distinct whole numbers/],
    [['--agent', 'oracle', '--label', 'x'.repeat(129)], /--label needs a text of 1 to 128 characters/],
    [['--agent', 'random', '--world', 'w', '--tasks', 'a,a'], /--tasks needs all or a comma-separated list/],
    [['--agent', 'random', '--world', 'w', '--oracle', 'a.json,'], /--oracle needs a value/],
    [['--agent', 'claude-code', '--keep-env', 'A,A'], /--keep-env needs comma-separated/],
  ];
  for (const [args, message] of refusals) assert.throws(() => parseBenchArguments(args), (error: Error & { code?: string }) => error.code === 'usage' && message.test(error.message), JSON.stringify(args));
});

/** A world made from two drawings, and its oracle, like `tasks from-scenes` writes them. */
function authored(taskId = 'Flow'): { world: World; oracle: TaskOracle } {
  const a = { x: 100, y: 100 }, b = { x: 400, y: 100 }, c = { x: 700, y: 100 };
  const result = fromScenes(scene([box('a', 'Draft', a.x, a.y), box('b', 'Review', b.x, b.y), box('c', 'Send', c.x, c.y), arrow('ab', 'a', 'b', between(a, b))]),
    scene([box('a', 'Draft', a.x, a.y), box('b', 'Review', b.x, b.y), box('c', 'Send', c.x, c.y), arrow('ab', 'a', 'b', between(a, b)), arrow('bc', 'b', 'c', between(b, c))]), { worldId: 'my-world', taskId });
  return { world: result.world, oracle: result.oracle };
}

test('own world and oracle files: packed like pack, hostile input refused by name, references checked before any run', async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-world-'));
  try {
    const { world, oracle } = authored();
    await mkdir(join(dir, 'world')); await writeFile(join(dir, 'world', 'world.json'), JSON.stringify(world));
    const loaded = await ownBenchWorld(join(dir, 'world'));
    assert.deepEqual([loaded.source, loaded.world.id, loaded.contentHash], ['own', 'my-world', worldContentHash(loaded.world)]);
    await writeFile(join(dir, 'w.pnworld'), loaded.bytes);
    assert.equal((await ownBenchWorld(join(dir, 'w.pnworld'))).contentHash, loaded.contentHash, 'a folder and its package are the same world');
    await assert.rejects(ownBenchWorld(join(dir, 'missing')), (error: Error & { code?: string }) => error.code === 'usage');
    // Hostile packages come from the independent zip writer and keep their named package code.
    await writeFile(join(dir, 'evil.pnworld'), buildZip([{ name: '../world.json', data: Buffer.from('{}') }]));
    await assert.rejects(ownBenchWorld(join(dir, 'evil.pnworld')), (error: Error & { code?: string }) => /^E_[A-Z_]+$/.test(error.code ?? '') && /was rejected/.test(error.message));

    // Oracle files: the from-scenes sidecar parses; anything else is refused by name.
    await writeFile(join(dir, 'oracle.json'), JSON.stringify(oracle));
    assert.deepEqual(await readOracleFile(join(dir, 'oracle.json')), JSON.parse(JSON.stringify(oracle)));
    await writeFile(join(dir, 'text.json'), 'not json');
    await assert.rejects(readOracleFile(join(dir, 'text.json')), (error: Error & { code?: string }) => error.code === 'bench_oracle_invalid' && /not bounded valid JSON/.test(error.message));
    await writeFile(join(dir, 'other.json'), JSON.stringify({ ...oracle, schema: 'practonaut.library/1' }));
    await assert.rejects(readOracleFile(join(dir, 'other.json')), (error: Error & { code?: string }) => error.code === 'bench_oracle_invalid' && /not a practonaut\.task-oracle\/1 file/.test(error.message));
    await writeFile(join(dir, 'huge.json'), Buffer.alloc(4 * 1024 * 1024 + 1, 32));
    await assert.rejects(readOracleFile(join(dir, 'huge.json')), (error: Error & { code?: string }) => error.code === 'bench_oracle_invalid' && /larger than 4 MiB/.test(error.message));
    await assert.rejects(readOracleFile(join(dir, 'world')), (error: Error & { code?: string }) => error.code === 'usage');

    // Matching oracles to the world and its benched tasks.
    const tasks = resolveWorldTasks(loaded.world, 'all');
    assert.deepEqual(tasks, ['Flow']);
    assert.throws(() => ownReferences(loaded.world, tasks, [{ path: 'o.json', oracle: { ...oracle, worldId: 'another' } }]), (error: Error & { code?: string }) => error.code === 'bench_oracle_invalid' && /is the oracle of world another, not of my-world/.test(error.message));
    assert.throws(() => ownReferences(loaded.world, tasks, [{ path: 'o.json', oracle: { ...oracle, taskId: 'elsewhere' } }]), (error: Error & { code?: string }) => error.code === 'usage' && /oracle of task elsewhere, which is not benched/.test(error.message));
    assert.throws(() => ownReferences(loaded.world, tasks, [{ path: 'a.json', oracle }, { path: 'b.json', oracle }]), /two --oracle files are for task Flow/);
    assert.throws(() => resolveWorldTasks(loaded.world, ['nope']), (error: Error & { code?: string }) => error.code === 'task_unknown');
    const twoTasks = validateWorld({ ...structuredClone(world), tasks: [world.tasks[0], { ...structuredClone(world.tasks[0]!), id: 'flow' }] });
    assert.throws(() => resolveWorldTasks(twoTasks, 'all'), /tasks Flow and flow differ only in case/);
    assert.deepEqual(resolveWorldTasks(twoTasks, ['flow']), ['flow']);

    // The separate checker decides whether a reference is valid, for every planned seed.
    const references = ownReferences(loaded.world, tasks, [{ path: 'oracle.json', oracle }]);
    await validateOwnReferences(loaded.world, references, [1, 2, 7]);
    const nearMiss = ownReferences(loaded.world, tasks, [{ path: 'n.json', oracle: { ...oracle, steps: oracle.nearMisses[0]!.steps } }]);
    await assert.rejects(validateOwnReferences(loaded.world, nearMiss, [3]), (error: Error & { code?: string }) => error.code === 'bench_oracle_invalid' && /reference of task Flow does not pass the checker: with seed 3 it does not reach the goal/.test(error.message));
    const broken = ownReferences(loaded.world, tasks, [{ path: 'b.json', oracle: { ...oracle, steps: [{ name: 'connect', params: { from: 'a', to: 'nowhere' } }] } }]);
    await assert.rejects(validateOwnReferences(loaded.world, broken, [1]), (error: Error & { code?: string }) => error.code === 'bench_oracle_invalid' && /with seed 1 its action 0 is rejected/.test(error.message));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reads are bounded while they read: a file larger than the limit is refused, never read whole', async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-read-'));
  try {
    await writeFile(join(dir, 'twenty'), Buffer.alloc(20, 65));
    // readAtMost on an open handle, past any size check made at open time.
    const handle = await open(join(dir, 'twenty'), 'r');
    try {
      assert.equal(await readAtMost(handle, 10), null);
      assert.equal((await readAtMost(handle, 20))?.length, 20);
    } finally { await handle.close(); }
    assert.equal((await readRegularFile(join(dir, 'twenty'), 20))?.length, 20);
    assert.equal(await readRegularFile(join(dir, 'twenty'), 19), null);
    assert.equal(await readRegularFile(join(dir, 'missing'), 100), null);
    assert.equal(await readRegularFile(dir, 100), null, 'a folder is not a regular file');
    if (process.platform !== 'win32') { await symlink(join(dir, 'twenty'), join(dir, 'link')); assert.equal(await readRegularFile(join(dir, 'link'), 100), null, 'a link is not followed'); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('references.json keeps only what verification needs and must fit what --verify reads', () => {
  const text = referencesText(libraryReferences(['connect', 'decision']), ['connect', 'decision']);
  const stored = JSON.parse(text) as { schema: string; references: Array<Record<string, unknown>> };
  assert.equal(stored.schema, 'practonaut.bench-references/1');
  assert.deepEqual(stored.references.map(entry => Object.keys(entry).sort()), [['source', 'steps', 'taskId', 'worldId'], ['source', 'steps', 'taskId', 'worldId']]);
  assert.equal(text.includes('nearMisses'), false, 'near misses stay in the library and the author\'s file');
  assert.doesNotThrow(() => assertReferencesFit(text));
  assert.throws(() => assertReferencesFit(text, Buffer.byteLength(text) - 1), (error: Error & { code?: string }) => error.code === 'bench_references_too_large' && new RegExp(`would take ${Buffer.byteLength(text)} bytes, but report --verify reads at most ${Buffer.byteLength(text) - 1}`).test(error.message));
});

test('a library bench is anchored to this Practonaut\'s library when the id and version are the same', () => {
  const shipped = { id: 'excalidraw-library', version: '1.1.0', contentHash: 'a'.repeat(64) };
  assert.deepEqual(libraryAnchor({ worldId: 'excalidraw-library', version: '1.1.0', contentHash: 'a'.repeat(64) }, shipped), { status: 'same' });
  assert.throws(() => libraryAnchor({ worldId: 'excalidraw-library', version: '1.1.0', contentHash: 'b'.repeat(64) }, shipped),
    (error: Error & { code?: string }) => error.code === 'bench_world_changed' && /content hash b{64} is not that library's \(a{64}\): it is not this Practonaut's library/.test(error.message));
  assert.deepEqual(libraryAnchor({ worldId: 'excalidraw-library', version: '1.0.0', contentHash: 'b'.repeat(64) }, shipped), { status: 'other', shipped: { id: 'excalidraw-library', version: '1.1.0' } });
});

test('pack and validate print the content hash a bench report names, computed independently', async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-bench-hash-'));
  try {
    const world = v2World();
    await mkdir(join(dir, 'src')); await writeFile(join(dir, 'src', 'world.json'), JSON.stringify(world));
    const cliPath = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
    const packed = spawnSync(process.execPath, [cliPath, 'pack', join(dir, 'src'), '--out', join(dir, 'w.pnworld'), '--json'], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    // The expected value comes from the separate hash oracle (tests/oracles), not from src/canonical.
    const expected = oracleDigest(JSON.parse(JSON.stringify(world)));
    assert.equal(JSON.parse(packed.stdout).contentHash, expected);
    const validated = spawnSync(process.execPath, [cliPath, 'validate', join(dir, 'w.pnworld'), '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(validated.stdout).contentHash, expected);
    assert.match(spawnSync(process.execPath, [cliPath, 'validate', join(dir, 'w.pnworld')], { encoding: 'utf8' }).stdout, new RegExp(`content  sha256 ${expected}`));
    assert.equal((await ownBenchWorld(join(dir, 'w.pnworld'))).contentHash, expected, 'bench names the same hash');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('efficiency says "minimal length" only when every referenced task is proven minimal (PADR-0040)', () => {
  const all = v2Report([run('Flow', 2, 1, true, 4, 2), run('Flow', 5, 1, true, 2, 2)]);
  all.settings.tasks = ['Flow']; all.references!.tasks[0]!.minimal = true; all.summary = summarize(all.runs, 1);
  assert.doesNotThrow(() => validateBenchReportV2(all));
  // Hand calculation: (2/4 + 2/2) / 2 = 0.75.
  assert.match(renderTable(all), /efficiency vs minimal length 0\.75  \(1 = as few actions as possible\)/);
  assert.match(renderTable(all), /^Flow .* 2 \(minimal\) +0\.75$/m);
  assert.match(renderTable(all, 'de'), /Effizienz gegenüber Minimallänge 0,75/);
  // Not proven: the plain reference length, as before.
  const reference = structuredClone(all); reference.references!.tasks[0]!.minimal = false;
  assert.match(renderTable(reference), /efficiency vs reference length 0\.75  \(> 1 = fewer actions than the reference solution\)/);
  assert.match(renderTable(reference), /^Flow .* 2 +0\.75$/m);
  // Some referenced tasks without a proof: the reference length, saying for how many it is proven.
  const mixed = v2Report([run('Flow', 2, 1, true, 4, 2), run('other', 2, 1, true, 3, 3)]);
  mixed.settings.seeds = [2];
  mixed.references!.tasks = [{ taskId: 'Flow', source: 'oracle-file', actions: 2, minimal: true }, { taskId: 'other', source: 'oracle-file', actions: 3, minimal: false }];
  mixed.summary = summarize(mixed.runs, 1);
  assert.doesNotThrow(() => validateBenchReportV2(mixed));
  assert.match(renderTable(mixed), /efficiency vs reference length 0\.75, proven minimal for 1 of 2/);
});

test('task limits and --checks are shown with the report (PADR-0040)', () => {
  const value = v2Report();
  value.environment.world.limits = [{ taskId: 'Flow', actions: 3, checks: 1 }];
  value.settings.checks = 0;
  assert.doesNotThrow(() => validateBenchReportV2(value));
  assert.match(renderTable(value), /^Task limits: Flow: at most 3 changes, at most 1 check$/m);
  assert.match(renderTable(value), /^Checks per run \(--checks\): 0$/m);
  assert.match(renderTable(value, 'de'), /^Aufgabenlimits: Flow: höchstens 3 Änderungen, höchstens 1 Prüfung$/m);
  assert.match(renderHtml(value, ":root{}"), /<dt>Task limits<\/dt><dd><span class="data">Flow<\/span>: at most[ \u00a0]3[ \u00a0]changes, at most[ \u00a0]1[ \u00a0]check<\/dd>/);
  const plain = v2Report();
  assert.doesNotMatch(renderTable(plain), /Task limits|--checks/);
});

test('the re-verified line agrees in number: one run from its artifacts, several from their artifacts', () => {
  assert.match(cliText('reportReverified', { runs: 1, unjudged: 0 }), /Re-verified: 1 run re-judged by the checker from its artifacts; every verdict matches/);
  assert.match(cliText('reportReverified', { runs: 2, unjudged: 0 }), /Re-verified: 2 runs re-judged by the checker from their artifacts; every verdict matches/);
  const world = { world: 'w', version: '1.0.0', hash: 'h', unjudged: 0, references: 1 };
  assert.match(cliText('reportReverifiedWorld', { ...world, runs: 1 }), /Re-verified: 1 run re-judged by the checker from its artifacts, against the world/);
  assert.match(cliText('reportReverifiedWorld', { ...world, runs: 3 }), /Re-verified: 3 runs re-judged by the checker from their artifacts, against the world/);
});

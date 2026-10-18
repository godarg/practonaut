// P3's acceptance line (roadmap 0.3.0, PADR-0044 decision 10): "every committed /1 and /2 report still
// verifies; a stored /2 report read as /3 through the view keeps every shared field deep-equal; compare
// names the reason when it refuses a mixed pair."
//
// The /2 bench folder (tests/fixtures/bench/v2/) was written by the /2 writer before the writer moved to
// /3. The shared fields are enumerated by walking the committed JSON Schemas schemas/bench.v1.json and
// schemas/bench.v2.json (not the /3 code); every leaf of every committed report either appears in the
// view at the same path with an equal value, or is in the hand-written table of moved fields below,
// whose targets this test states by hand, as it states the derived and not-recorded values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, validateBenchReport, validateBenchReportV1, validateBenchReportV2, validateBenchReportV3, type BenchReportV1, type BenchReportV2 } from '../../src/bench/report.ts';
import { toView } from '../../src/bench/view.ts';
import { verifyBenchArtifacts, verifyBenchV2 } from '../../src/bench/verify.ts';
import { libraryWorld } from '../../src/bench/run.ts';
import { compareReports, CompareError } from '../../src/bench/compare.ts';
import { renderIncomparableHtml } from '../../src/bench/render-compare.ts';
import { artifactReport } from '../support/bench-v3.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CLI = join(ROOT, 'src/cli/main.ts');
const json = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
/** Every committed /1 and /2 report, and the bench folder of those that have one. */
const COMMITTED = [
  { path: 'tests/fixtures/bench/v1/report.json', schema: 'practonaut.bench/1', folder: 'tests/fixtures/bench/v1' },
  { path: 'docs/benchmarks/example-report.json', schema: 'practonaut.bench/1', folder: null },
  { path: 'tests/fixtures/bench/v2/report.json', schema: 'practonaut.bench/2', folder: 'tests/fixtures/bench/v2' },
  { path: 'tests/fixtures/ci-recipe/baseline.json', schema: 'practonaut.bench/2', folder: null },
] as const;

test('every committed /1 and /2 report validates by its own rules, and re-verifies where its bench folder is committed', async () => {
  for (const entry of COMMITTED) {
    const raw = json(entry.path) as { schema: string };
    assert.equal(raw.schema, entry.schema, entry.path);
    const report = entry.schema === 'practonaut.bench/1' ? validateBenchReportV1(raw) : validateBenchReportV2(raw);
    if (entry.folder === null) continue;
    // The /1 folder against the library this Practonaut ships; the /2 folder against its stored world.
    const result = entry.schema === 'practonaut.bench/1'
      ? await verifyBenchArtifacts(report as BenchReportV1, join(ROOT, entry.folder), await libraryWorld())
      : await verifyBenchV2(report as BenchReportV2, join(ROOT, entry.folder), libraryWorld);
    assert.deepEqual([result.reverified, result.unjudged], [2, 0], entry.path);
  }
  // The same through the CLI, as a user runs it: exit 0 and "Re-verified".
  for (const entry of COMMITTED.filter(value => value.folder !== null)) {
    const verified = spawnSync(process.execPath, [CLI, 'report', join(ROOT, entry.path), '--verify', '--json'], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout).verification.level, 're-verified');
  }
});

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[]; oneOf?: Schema[]; additionalProperties?: Schema | boolean; const?: unknown; enum?: unknown[] };
/** Every leaf path a JSON Schema allows: `a.b` for properties, `a[]` for array items, `a.*` for record values. */
function leafPaths(schema: Schema, path = ''): Set<string> {
  const out = new Set<string>();
  const branches = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  if (branches.length) { for (const branch of branches) for (const leaf of leafPaths(branch, path)) out.add(leaf); return out; }
  if (schema.properties) for (const [key, value] of Object.entries(schema.properties)) for (const leaf of leafPaths(value, path ? `${path}.${key}` : key)) out.add(leaf);
  if (schema.items) for (const leaf of leafPaths(schema.items, `${path}[]`)) out.add(leaf);
  if (typeof schema.additionalProperties === 'object') for (const leaf of leafPaths(schema.additionalProperties, `${path}.*`)) out.add(leaf);
  if (!schema.properties && !schema.items && typeof schema.additionalProperties !== 'object') out.add(path);
  return out;
}
/** Every leaf of a JSON value with its concrete path (indices kept) and its schema path. Empty arrays and
 * objects are leaves too (their emptiness is a value). */
function leaves(value: unknown, records: ReadonlySet<string>, concrete: Array<string | number> = [], schema = ''): Array<{ concrete: Array<string | number>; schema: string; value: unknown }> {
  if (Array.isArray(value)) return value.length ? value.flatMap((item, index) => leaves(item, records, [...concrete, index], `${schema}[]`)) : [{ concrete, schema, value }];
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return [{ concrete, schema, value }];
    return entries.flatMap(([key, item]) => leaves(item, records, [...concrete, key], records.has(schema) ? `${schema}.*` : schema ? `${schema}.${key}` : key));
  }
  return [{ concrete, schema, value }];
}
const at = (value: unknown, path: ReadonlyArray<string | number>): unknown => path.reduce<unknown>((node, key) => node === undefined || node === null ? undefined : (node as Record<string | number, unknown>)[key], value);
/** Schema paths whose values are records (free keys), so a concrete key maps to `*`. */
const recordsOf = (paths: ReadonlySet<string>): Set<string> => new Set([...paths].filter(path => path.endsWith('.*')).map(path => path.slice(0, -2)));

/** The moved fields (PADR-0044 decision 10), by hand: where each lands in the view. */
const MOVED: Readonly<Record<string, Record<string, Array<string | number>>>> = {
  'practonaut.bench/1': { schema: ['readFrom'], 'environment.excalidraw': ['environment', 'app', 'version'], 'environment.library.worldId': ['environment', 'world', 'worldId'], 'environment.library.version': ['environment', 'world', 'version'], 'environment.library.contentHash': ['environment', 'world', 'contentHash'] },
  'practonaut.bench/2': { schema: ['readFrom'], 'environment.excalidraw': ['environment', 'app', 'version'] },
};

test('a stored /1 or /2 report read as /3 through the view keeps every shared leaf deep-equal; moved fields land where the record says', () => {
  const schemas = { 'practonaut.bench/1': leafPaths(json('schemas/bench.v1.json') as Schema), 'practonaut.bench/2': leafPaths(json('schemas/bench.v2.json') as Schema) };
  // The walk found the schemas' leaves (a sample, written by hand from the /2 schema).
  for (const path of ['schema', 'environment.excalidraw', 'environment.world.contentHash', 'agent.apiKeySource', 'runs[].checker.session.errorClasses[]', 'runs[].logs.mutations.omitted', 'runs[].client.tokens.cacheRead', 'summary.passHatK[].k', 'environment.world.generated[].parameters.*', 'interrupted.stopped.remaining[]'])
    assert.ok(schemas['practonaut.bench/2'].has(path), path);
  assert.ok(schemas['practonaut.bench/1'].has('environment.library.contentHash'));
  let compared = 0, moved = 0;
  for (const entry of COMMITTED) {
    const raw = json(entry.path), report = validateBenchReport(raw), view = JSON.parse(JSON.stringify(toView(report))) as unknown;
    const paths = schemas[entry.schema], records = recordsOf(paths), table = MOVED[entry.schema]!;
    for (const leaf of leaves(raw, records)) {
      // Every leaf of the committed report is one its own committed schema allows.
      assert.ok(paths.has(leaf.schema) || Array.isArray(leaf.value) || (leaf.value !== null && typeof leaf.value === 'object'), `${entry.path}: ${leaf.schema} is not a leaf of ${entry.schema}`);
      const target = table[leaf.schema];
      if (target) { assert.deepEqual(at(view, target), leaf.value, `${entry.path}: ${leaf.schema} moved to ${target.join('.')}`); moved++; continue; }
      assert.deepEqual(at(view, leaf.concrete), leaf.value, `${entry.path}: ${leaf.concrete.join('.')} differs in the view`);
      compared++;
    }
  }
  assert.ok(compared > 400, `compared ${compared} leaves`);
  assert.equal(moved, 2 * 5 + 2 * 2);
});

test('the view states by hand what the old formats fix, derive and did not record', () => {
  const v2 = toView(validateBenchReport(json('tests/fixtures/bench/v2/report.json')));
  assert.equal(v2.readFrom, 'practonaut.bench/2');
  assert.equal(v2.verdictLevel, 'session');
  assert.deepEqual(v2.environment.app, { adapterId: 'excalidraw', version: '0.18.1' });
  assert.deepEqual(v2.toolchain, { kind: 'practonaut', id: 'practonaut', tools: null });
  assert.equal(v2.instances, null);
  // The oracle's two runs: two actions each (the fixture's reference length), all of them the agent's.
  assert.deepEqual(v2.runs.map(run => [run.id, run.verdictLevel, run.agentActions, run.isolation]), [
    ['review-and-send-s1-r1', 'session', 2, { level: 'builtin-baseline', evidence: 'by-kind' }],
    ['review-and-send-s1-r2', 'session', 2, { level: 'builtin-baseline', evidence: 'by-kind' }],
  ]);
  assert.deepEqual([v2.agent.vendor, v2.agent.client, v2.agent.clientVersion, v2.agent.requestedModel, v2.agent.settings, v2.agent.billing], [
    { value: null, source: 'none' }, { value: null, source: 'none' }, { value: null, source: 'none' }, { value: null, source: 'none' }, [], { class: 'unknown', source: 'none' },
  ]);
  assert.equal(v2.runs.some(run => 'stdout' in run || 'failure' in run), false);
  const v1 = toView(validateBenchReport(json('tests/fixtures/bench/v1/report.json')));
  assert.equal(v1.readFrom, 'practonaut.bench/1');
  assert.deepEqual(v1.environment.world, { source: 'library', worldId: 'excalidraw-library', version: '1.1.0', contentHash: '6f46bc08e6a612235d29a0aa06eed3324952ad16897b0b042fc4e08ca80c33da', package: null, generated: [] });
  assert.deepEqual([v1.agent.isolation, v1.agent.keptEnv, v1.references], [null, null, 'not-recorded']);
  assert.deepEqual(v1.runs.map(run => [run.id, run.agentActions, run.isolation]), [
    ['connect-s1-r1', 1, { level: null, evidence: 'not-recorded' }], ['insert-between-s1-r1', 4, { level: null, evidence: 'not-recorded' }],
  ]);
  // A /2 run's client version gives clientVersion with its block's source; an infra_error run's failure is not recorded.
  const preset = structuredClone(json('tests/fixtures/ci-recipe/baseline.json')) as BenchReportV2;
  const runs = preset.runs as Array<BenchReportV2['runs'][number]>;
  runs[0]!.status = 'infra_error'; runs[0]!.pass = false; runs[0]!.checker = null; delete runs[0]!.artifacts; runs[0]!.note = 'interrupted';
  preset.agent = { ...preset.agent, kind: 'command', name: 'generic', command: ['agent', '{mcp_config}'], isolation: 'template-unrestricted' };
  for (const run of runs) if (run.logs?.calls) run.logs.calls.clientTiming = false;
  runs[1]!.client = { source: 'command-output', model: null, turns: null, costUsd: null, tokens: null, version: '2.1.301' };
  preset.summary = summarize(runs, preset.settings.repeats);
  const view = toView(validateBenchReportV2(preset));
  assert.deepEqual(view.agent.clientVersion, { value: '2.1.301', source: 'command-output' });
  assert.equal(view.runs[0]!.failure, 'not-recorded');
  // The view is a copy: changing it changes nothing in the report it was read from.
  const source = validateBenchReport(json('tests/fixtures/bench/v2/report.json')), copy = toView(source);
  copy.runs[0]!.pass = false; copy.settings.tasks.push('x');
  assert.deepEqual(source, validateBenchReport(json('tests/fixtures/bench/v2/report.json')));
});

test('compare refuses a session report beside an artifact report, naming verdictLevel in words and the reason (API, CLI, page)', () => {
  const session = validateBenchReport(json('tests/fixtures/bench/v2/report.json')), artifact = validateBenchReportV3(artifactReport());
  assert.throws(() => compareReports(session, artifact), (error: unknown) => error instanceof CompareError && error.code === 'compare_incomparable'
    && JSON.stringify(error.differences) === JSON.stringify([{ field: 'verdictLevel', baseline: 'session', candidate: 'artifact' }]));
  const dir = mkdtempSync(join(tmpdir(), 'pn-v3-compare-'));
  try {
    const path = join(dir, 'artifact.json'); writeFileSync(path, JSON.stringify(artifact));
    const refused = spawnSync(process.execPath, [CLI, 'compare', join(ROOT, 'tests/fixtures/bench/v2/report.json'), path, '--html', join(dir, 'refused.html')], { encoding: 'utf8' });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /the verdict level differs \(session verdict on the baseline, artifact-judged, end-state only, no Practonaut history on the candidate\)\. Runs of different verdict levels are never paired \(PADR-0043 decision 1\): compare reports of one level \[compare_incomparable\]/);
    const german = spawnSync(process.execPath, [CLI, '--lang', 'de', 'compare', join(ROOT, 'tests/fixtures/bench/v2/report.json'), path], { encoding: 'utf8' });
    assert.match(german.stderr, /die Bewertungsstufe unterscheidet sich \(Sitzungsurteil bei der Basis, nach Artefakt bewertet, nur Endzustand, ohne Practonaut-Verlauf beim Kandidaten\)\. Läufe verschiedener Bewertungsstufen werden nie gepaart/);
    const page = readFileSync(join(dir, 'refused.html'), 'utf8').replace(/ /g, ' ');
    assert.match(page, /verdict level: session verdict on the baseline, artifact-judged, end-state only, no Practonaut history on the candidate/);
    assert.match(page, /Runs of different verdict levels are never paired \(PADR-0043 decision 1\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const html = renderIncomparableHtml({ report: session, verification: 'consistency-checked' }, { report: artifact, verification: 'consistency-checked' }, [{ field: 'verdictLevel', baseline: 'session', candidate: 'artifact' }], ':root{}', 'de');
  assert.match(html.replace(/ /g, ' '), /Bewertungsstufe: Sitzungsurteil bei der Basis, nach Artefakt bewertet, nur Endzustand, ohne Practonaut-Verlauf beim Kandidaten/);
});

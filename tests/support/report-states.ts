// Fixture runs for report v2 and compare (PADR-0039): real benches with scripted command agents
// (tests/support/bench-agent.ts, no language model), the oracle and the built-in failure modes, each
// kept in its own bench folder. The acceptance tests read their reports; the accessibility tool and
// the review screenshots render every named state from them. Nothing here judges: the runner and the
// checker do, exactly as for a real agent.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryWorld, runBench, type BenchOptions } from '../../src/bench/run.ts';
import { resolveAgent } from '../../src/bench/agents.ts';
import { ownBenchWorld } from '../../src/bench/world.ts';
import { summarize, validateBenchReport, validateBenchReportV3, type BenchReport, type SessionReportV3 } from '../../src/bench/report.ts';
import { loadReportDetails } from '../../src/bench/details.ts';
import { detailWords, readTokensCss, renderHtml, renderTable, type VerificationDetail, type VerificationInput } from '../../src/bench/render.ts';
import { compareReports, differences } from '../../src/bench/compare.ts';
import { renderCompareHtml, renderIncomparableHtml, type CompareInput } from '../../src/bench/render-compare.ts';
import { verifyBenchV3 } from '../../src/bench/verify.ts';
import type { Language } from '../../src/bench/rates.ts';
import { arrow, between, box, scene } from './scenes.ts';
import { v3States } from './bench-v3-states.ts';

const AGENT = fileURLToPath(new URL('./bench-agent.ts', import.meta.url));
const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const V1_REPORT = fileURLToPath(new URL('../fixtures/bench/v1/report.json', import.meta.url));
/** The committed draw.io evidence (PADR-0049): both libraries benched by the oracle with their app mirrored. */
const DRAWIO_EVIDENCE = fileURLToPath(new URL('../../docs/benchmarks/drawio/', import.meta.url));
/** The bench/2 folder the /2 writer made (oracle, ci-recipe world, mirror): a stored /2 report read through the view. */
const V2_FOLDER = fileURLToPath(new URL('../fixtures/bench/v2/', import.meta.url));
type Step = { act?: string; params?: Record<string, unknown>; client?: number; undo?: true; reset?: true; check?: true };
type Script = Record<string, { clients?: string[]; print?: string[]; steps: Step[] }>;

/** restyle-flow's reference solution (the library's), with the last style's fill as a parameter. */
const restyle = (fill: string): Step[] => [
  { act: 'set_style', params: { id: 'a', shape: 'ellipse', stroke: 'black', fill: 'none' } }, { act: 'resize_step', params: { id: 'b', width: 260, height: 120 } },
  { act: 'move_step', params: { id: 'c', x: 780, y: 200 } }, { act: 'set_style', params: { id: 'c', shape: 'ellipse', stroke: 'black', fill } },
  { act: 'connect', params: { from: 'a', to: 'b' } }, { act: 'connect', params: { from: 'b', to: 'c' } },
];
/** Library tasks played wrongly, one way per error class and run state (seed 1). */
export const FAILING: Script = {
  // Each step loses its label in turn: missing-label-1 … 4, each label condition lost after its own action.
  'close-chain': { steps: [1, 2, 3, 4].map(index => ({ act: 'rename_step', params: { id: 'abcd'[index - 1], label: `Wrong ${index}` } })) },
  // One arrow too many (extra-arrow), drawn by a second MCP client, after one refused action.
  connect: { clients: ['second-agent'], print: [JSON.stringify({ type: 'system', subtype: 'init', model: 'pn-script-model', apiKeySource: 'none' }), JSON.stringify({ type: 'result', subtype: 'success', num_turns: 5, total_cost_usd: 0.0123, usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 9000, cache_creation_input_tokens: 2100 } })],
    steps: [{ act: 'connect', params: { from: 'a', to: 'b' } }, { act: 'connect', params: { from: 'a', to: 'missing-step' } }, { act: 'connect', params: { from: 'b', to: 'a' }, client: 1 }, { check: true }] },
  // A deleted step leaves its arrow loose (loose-arrow, missing-label).
  'add-step': { steps: [{ act: 'delete_step', params: { id: 'b' } }] },
  // The reference with a blue instead of a green fill: one condition never met, no error class.
  'restyle-flow': { steps: restyle('blue') },
  // Nothing done: an ungrouped board and an empty trajectory.
  group: { steps: [] },
  decision: { steps: [] },
};
/** The same two tasks solved: the correct restyle-flow and a grouped board. */
export const SOLVING: Script = {
  'restyle-flow': { steps: restyle('green') },
  group: { steps: [{ act: 'group_steps', params: { id: 'b', with: 'a' } }, { act: 'group_steps', params: { id: 'c', with: 'a' } }] },
};

export interface Bench { report: SessionReportV3; directory: string }
const base = { seeds: [1], repeats: 1, timeoutSeconds: 60, maxActions: 50, mirrorRequested: 'off' as const, mirror: 'off' as const };
const template = (mode: string): BenchOptions['agent'] => resolveAgent(`${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} ${mode} {mcp_config}`);

async function scripted(dir: string, name: string, script: Script, options: Partial<BenchOptions>): Promise<Bench> {
  const path = join(dir, `${name}.json`); await writeFile(path, JSON.stringify(script));
  process.env.PN_TEST_AGENT_SCRIPT = path;
  try { return await bench({ ...base, agent: template('script'), tasks: Object.keys(script), ...options }); }
  finally { delete process.env.PN_TEST_AGENT_SCRIPT; }
}
async function bench(options: BenchOptions): Promise<Bench> {
  const result = await runBench(options);
  if (!result.report) throw new Error('fixture bench wrote no report');
  await writeFile(join(result.directory, 'report.json'), JSON.stringify(result.report, null, 2) + '\n');
  return { report: result.report, directory: result.directory };
}

/** A task authored from two drawings with long German labels (`tasks from-scenes`, through the CLI);
 * repeatable in the same folder (the accessibility tool keeps its output folder between runs). */
async function germanWorld(dir: string): Promise<{ world: string; taskId: string }> {
  const a = { x: 100, y: 100 }, b = { x: 420, y: 100 };
  const wide = { width: 260, height: 110 };
  const first = 'Rechnungseingangsprüfung', second = 'Zahlungsfreigabeverfahrensdokumentation';
  await writeFile(join(dir, 'start.excalidraw'), scene([box('a', first, a.x, a.y, wide), box('b', second, b.x, b.y, wide)]));
  await writeFile(join(dir, 'goal.excalidraw'), scene([box('a', first, a.x, a.y, wide), box('b', second, b.x, b.y, { ...wide, fill: '#b2f2bb' }), arrow('ab', 'a', 'b', between(a, b, 260, 110))]));
  const made = spawnSync(process.execPath, [CLI, 'tasks', 'from-scenes', join(dir, 'start.excalidraw'), join(dir, 'goal.excalidraw'), '--out', join(dir, 'german'), '--force'], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`from-scenes failed: ${made.stderr}`);
  const world = JSON.parse(await readFile(join(dir, 'german', 'world', 'world.json'), 'utf8')) as { tasks: Array<{ id: string }> };
  return { world: join(dir, 'german', 'world'), taskId: world.tasks[0]!.id };
}

export interface Fixtures {
  failing: Bench; solved: Bench; timeout: Bench; unjudged: Bench; german: Bench;
  /** An agent that acted and then exited with code 7. */
  crashed: Bench;
  /** Two command-template benches on the same grid (two tasks × seeds 1–3), three repeats: for compare
   * (36 runs, so only when asked for). */
  good?: Bench; bad?: Bench;
  /** With the real mirror (only when asked for). */
  engine?: { solved: Bench; failing: Bench };
}

/** Refuses a fixture bench that did not play as its script says: a fixture whose agent could not run
 * would make every state built from it show the wrong thing (and still pass a scan). */
function expectBench(name: string, bench: Bench, expected: { status: SessionReportV3['runs'][number]['status']; pass?: boolean; acted?: boolean }): Bench {
  for (const run of bench.report.runs) {
    const problem = run.status !== expected.status ? `ended ${run.status} (exit ${run.agentExitCode}), expected ${expected.status}`
      : expected.pass !== undefined && run.pass !== expected.pass ? `${run.pass ? 'passed' : 'failed'}, expected ${expected.pass ? 'a pass' : 'a failure'}` : null;
    if (problem) throw new Error(`fixture bench ${name}: run ${run.id} ${problem}${run.note ? ` (${run.note})` : ''}`);
  }
  if (expected.acted && bench.report.runs.every(run => run.acceptedActions + run.rejectedActions === 0)) throw new Error(`fixture bench ${name}: no run reached the session`);
  return bench;
}

/** Runs every fixture bench once (model-only unless `mirror`), and checks that each played as its
 * script says. Takes a minute or two. `dir` may be relative: it is resolved first, because the scripted
 * agents read their script from inside their own folder. */
export async function fixtureBenches(folder: string, options: { mirror?: boolean; compare?: boolean } = {}): Promise<Fixtures> {
  const dir = resolve(folder);
  await mkdir(dir, { recursive: true });
  const failing = expectBench('failing', await scripted(dir, 'failing', FAILING, {}), { status: 'completed', pass: false, acted: true });
  const solved = expectBench('solved', await bench({ ...base, agent: resolveAgent('oracle'), tasks: ['restyle-flow', 'group'] }), { status: 'completed', pass: true, acted: true });
  // The agent observes before it stalls: one that never reaches the host is an infra_error (PADR-0040).
  const timeout = expectBench('timeout', await bench({ ...base, agent: template('observe-sleep'), tasks: ['connect'], timeoutSeconds: 6 }), { status: 'timeout', pass: false });
  const unjudged = expectBench('unjudged', await bench({ ...base, agent: template('plant-dir'), tasks: ['connect'] }), { status: 'infra_error', pass: false, acted: true });
  const crashed = expectBench('crashed', await bench({ ...base, agent: template('crash'), tasks: ['connect'] }), { status: 'agent_failed', pass: true, acted: true });
  const authored = await germanWorld(dir);
  // Benched without its oracle: no reference, so no efficiency and no example target.
  const world = await ownBenchWorld(authored.world);
  const german = expectBench('german', await scripted(dir, 'german', { [authored.taskId]: { steps: [{ act: 'rename_step', params: { id: 'a', label: 'Kreditorenstammdatenänderungsantragsprüfung' } }, { act: 'set_style', params: { id: 'b', shape: 'rectangle', stroke: 'black', fill: 'yellow' } }] } }, { world, tasks: [authored.taskId], label: 'Langer deutscher Name: Rechnungseingangsprüfung' }), { status: 'completed', pass: false, acted: true });
  const fixtures: Fixtures = { failing, solved, timeout, unjudged, german, crashed };
  if (options.compare) {
    // Seeds 1–3: six instances, so six instance flips are enough for an exact McNemar verdict (p = 2 · 2⁻⁶).
    fixtures.good = expectBench('good', await scripted(dir, 'good', SOLVING, { seeds: [1, 2, 3], repeats: 3 }), { status: 'completed', pass: true, acted: true });
    fixtures.bad = expectBench('bad', await scripted(dir, 'bad', { 'restyle-flow': FAILING['restyle-flow']!, group: FAILING.group! }, { seeds: [1, 2, 3], repeats: 3 }), { status: 'completed', pass: false, acted: true });
  }
  if (options.mirror) {
    const mirrored = { mirrorRequested: 'required' as const, mirror: 'required' as const };
    fixtures.engine = {
      solved: expectBench('engine solved', await bench({ ...base, ...mirrored, agent: resolveAgent('oracle'), tasks: ['restyle-flow', 'group'] }), { status: 'completed', pass: true, acted: true }),
      failing: expectBench('engine failing', await scripted(dir, 'engine-failing', { 'restyle-flow': FAILING['restyle-flow']!, group: FAILING.group! }, mirrored), { status: 'completed', pass: false, acted: true }),
    };
  }
  return fixtures;
}

/** The HTML page of a bench report, with its run details from `folder` (null: none). */
export async function reportPage(bench: { report: BenchReport; directory: string | null }, language: Language, verification: VerificationInput = 'consistency-checked'): Promise<string> {
  const details = await loadReportDetails(bench.report, bench.directory, detailWords(language));
  return renderHtml(bench.report, await readTokensCss(), language, verification, details);
}
export async function reportText(bench: Bench, language: Language): Promise<string> {
  return renderTable(bench.report, language, await loadReportDetails(bench.report, bench.directory, detailWords(language)));
}

export interface ReportState {
  id: string; html(language: Language): Promise<string>;
  /** Looked at with every disclosure open (a reader who opened the run cards). */
  open?: true;
}

/** A report whose given runs were not judged (an infrastructure fault), still valid: for compare. */
export function withUnjudged(report: SessionReportV3, runIds: readonly string[]): SessionReportV3 {
  const value = structuredClone(report);
  for (const run of value.runs) if (runIds.includes(run.id)) {
    Object.assign(run, { status: 'infra_error', pass: false, checker: null, agentExitCode: null, note: 'fixture: not judged', failure: { reason: 'runner', parser: null, code: null, beforeModelWork: null } });
    delete run.artifacts;
  }
  value.summary = summarize(value.runs, value.settings.repeats, run => run.agentActions);
  return validateBenchReportV3(value) as SessionReportV3;
}
/** Only the first repeat of every instance: single runs, for compare. */
export function firstRepeats(report: SessionReportV3): SessionReportV3 {
  const value = structuredClone(report);
  value.runs = value.runs.filter(run => run.repeat === 1); value.settings.repeats = 1;
  value.summary = summarize(value.runs, 1, run => run.agentActions);
  return validateBenchReportV3(value) as SessionReportV3;
}
/** A committed evidence bench, re-judged against this Practonaut's library as `report --verify` and
 * `compare --verify` do: any difference is refused, so a state never shows evidence that no longer holds. */
export async function evidenceBench(name: 'drawio-oracle' | 'excalidraw-oracle'): Promise<Bench & { verification: VerificationDetail }> {
  const directory = join(DRAWIO_EVIDENCE, name);
  const report = validateBenchReportV3(JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'))) as SessionReportV3;
  const verified = await verifyBenchV3(report, directory, libraryWorld);
  return { report, directory, verification: { level: 're-verified', notRederived: verified.parsers.notShipped, preset: verified.preset } };
}
/** Every named state of the report and compare pages (PADR-0039 B, C). */
export async function reportStates(all: Fixtures): Promise<ReportState[]> {
  if (!all.good || !all.bad) throw new Error('reportStates needs the compare fixtures: fixtureBenches(folder, { compare: true })');
  const fixtures = all as Fixtures & { good: Bench; bad: Bench };
  const v1 = validateBenchReport(JSON.parse(await readFile(V1_REPORT, 'utf8')));
  const v2 = validateBenchReport(JSON.parse(await readFile(join(V2_FOLDER, 'report.json'), 'utf8')));
  // bench/3 (PADR-0044): an artifact-judged report (hand-built: artifact mode writes none yet), one
  // task on two applications paired by task identity, a candidate whose paired runs were all unjudged,
  // a preset report whose client values were not re-derived, and three cases with changed outcomes.
  const { artifact, excalidraw, drawio, unjudgedCandidate, claimed, claims, configExcalidraw, configDrawio } = v3States();
  await verifyBenchV3(fixtures.solved.report, fixtures.solved.directory, libraryWorld);
  const drawioOracle = await evidenceBench('drawio-oracle'), excalidrawOracle = await evidenceBench('excalidraw-oracle');
  const tokens = await readTokensCss();
  const side = (report: SessionReportV3, name: string): CompareInput => ({ report, verification: 'consistency-checked', name });
  const compared = (baseline: CompareInput, candidate: CompareInput) => async (language: Language): Promise<string> => renderCompareHtml(baseline, candidate, compareReports(baseline.report, candidate.report), tokens, language);
  const good = side(fixtures.good.report, 'good'), bad = side(fixtures.bad.report, 'bad');
  // The good bench again, with one repeat of restyle-flow seed 2 and all of group seed 3 not judged.
  const unjudged = side(withUnjudged(fixtures.good.report, ['restyle-flow-s2-r2', 'group-s3-r1', 'group-s3-r2', 'group-s3-r3']), 'good-infra');
  const states: ReportState[] = [
    { id: 'report-failures', html: language => reportPage(fixtures.failing, language) },
    { id: 'report-reverified-pass', html: language => reportPage(fixtures.solved, language, 're-verified') },
    { id: 'report-timeout', html: language => reportPage(fixtures.timeout, language) },
    { id: 'report-unjudged', html: language => reportPage(fixtures.unjudged, language) },
    { id: 'report-agent-failed', html: language => reportPage(fixtures.crashed, language) },
    { id: 'report-long-german', html: language => reportPage(fixtures.german, language) },
    { id: 'report-no-folder', html: language => reportPage({ report: fixtures.failing.report, directory: null }, language) },
    // Repeats: pass^k and the instance outcome in the headline.
    { id: 'report-repeats', html: language => reportPage(fixtures.good, language) },
    { id: 'report-v1', html: language => reportPage({ report: v1, directory: null }, language) },
    { id: 'report-v2-reverified', html: language => reportPage({ report: v2, directory: V2_FOLDER }, language, 're-verified') },
    { id: 'report-artifact', html: language => reportPage({ report: artifact, directory: null }, language) },
    { id: 'report-claims', html: language => reportPage({ report: claimed, directory: null }, language, claims) },
    { id: 'compare-regression', html: compared(good, bad) },
    { id: 'compare-improvement', html: compared(bad, good) },
    { id: 'compare-same', html: compared(good, good) },
    { id: 'compare-unjudged', html: compared(good, unjudged) },
    { id: 'compare-single', html: compared(side(firstRepeats(fixtures.good.report), 'good-r1'), side(firstRepeats(fixtures.bad.report), 'bad-r1')) },
    { id: 'compare-incomparable', html: async language => renderIncomparableHtml(good, side(fixtures.failing.report, 'failing'), differences(fixtures.good.report, fixtures.failing.report), tokens, language) },
    { id: 'compare-incomparable-level', html: async language => renderIncomparableHtml(good, { report: artifact, verification: 'consistency-checked', name: 'artifact' }, differences(fixtures.good.report, artifact), tokens, language) },
    { id: 'compare-identity', html: compared({ report: excalidraw, verification: 'consistency-checked', name: 'excalidraw' }, { report: drawio, verification: 'consistency-checked', name: 'drawio' }) },
    { id: 'compare-identity-unjudged', html: compared({ report: excalidraw, verification: 'consistency-checked', name: 'excalidraw' }, { report: unjudgedCandidate, verification: 'consistency-checked', name: 'drawio' }) },
    { id: 'compare-identity-config', html: compared({ report: configExcalidraw, verification: 'consistency-checked', name: 'excalidraw' }, { report: configDrawio, verification: 'consistency-checked', name: 'drawio' }) },
    { id: 'compare-incomparable-gate', html: async language => renderIncomparableHtml({ report: excalidraw, verification: 'consistency-checked', name: 'excalidraw' }, { report: drawio, verification: 'consistency-checked', name: 'drawio' }, differences(excalidraw, drawio, { regressionGate: true }), tokens, language, { regressionGate: true }) },
    // The committed draw.io evidence (docs/benchmarks/drawio/): the draw.io library's 48 runs with
    // draw.io's own final-board pictures beside the targets, closed and with every run card open, and
    // its comparison with the Excalidraw library's runs, paired by task identity.
    { id: 'report-drawio-library', html: language => reportPage(drawioOracle, language, drawioOracle.verification) },
    { id: 'report-drawio-library-open', html: language => reportPage(drawioOracle, language, drawioOracle.verification), open: true },
    // Named by the reports' own labels, as `compare` names them (docs/benchmarks/drawio/compare.html).
    { id: 'compare-drawio-library', html: compared({ report: excalidrawOracle.report, verification: excalidrawOracle.verification }, { report: drawioOracle.report, verification: drawioOracle.verification }) },
  ];
  if (fixtures.engine) {
    const engine = fixtures.engine;
    states.push({ id: 'report-engine-pass', html: language => reportPage(engine.solved, language) }, { id: 'report-engine-failing', html: language => reportPage(engine.failing, language) },
      { id: 'report-engine-pass-open', html: language => reportPage(engine.solved, language), open: true });
  }
  return states;
}

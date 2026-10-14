// Fixture runs for report v2 and compare (PADR-0039): real benches with scripted command agents
// (tests/support/bench-agent.ts, no language model), the oracle and the built-in failure modes, each
// kept in its own bench folder. The acceptance tests read their reports; the accessibility tool and
// the review screenshots render every named state from them. Nothing here judges: the runner and the
// checker do, exactly as for a real agent.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryWorld, runBench, type BenchOptions } from '../../src/bench/run.ts';
import { resolveAgent } from '../../src/bench/agents.ts';
import { ownBenchWorld } from '../../src/bench/world.ts';
import { validateBenchReport, type BenchReport, type BenchReportV2 } from '../../src/bench/report.ts';
import { loadReportDetails } from '../../src/bench/details.ts';
import { detailWords, readTokensCss, renderHtml, renderTable, type Verification } from '../../src/bench/render.ts';
import { compareReports } from '../../src/bench/compare.ts';
import { renderCompareHtml } from '../../src/bench/render-compare.ts';
import { verifyBenchV2 } from '../../src/bench/verify.ts';
import type { Language } from '../../src/bench/rates.ts';
import { arrow, between, box, scene } from './scenes.ts';

const AGENT = fileURLToPath(new URL('./bench-agent.ts', import.meta.url));
const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const V1_REPORT = fileURLToPath(new URL('../fixtures/bench/v1/report.json', import.meta.url));
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

export interface Bench { report: BenchReportV2; directory: string }
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

/** A task authored from two drawings with long German labels (`tasks from-scenes`, through the CLI). */
async function germanWorld(dir: string): Promise<{ world: string; taskId: string }> {
  const a = { x: 100, y: 100 }, b = { x: 420, y: 100 };
  const wide = { width: 260, height: 110 };
  const first = 'Rechnungseingangsprüfung', second = 'Zahlungsfreigabeverfahrensdokumentation';
  await writeFile(join(dir, 'start.excalidraw'), scene([box('a', first, a.x, a.y, wide), box('b', second, b.x, b.y, wide)]));
  await writeFile(join(dir, 'goal.excalidraw'), scene([box('a', first, a.x, a.y, wide), box('b', second, b.x, b.y, { ...wide, fill: '#b2f2bb' }), arrow('ab', 'a', 'b', between(a, b, 260, 110))]));
  const made = spawnSync(process.execPath, [CLI, 'tasks', 'from-scenes', join(dir, 'start.excalidraw'), join(dir, 'goal.excalidraw'), '--out', join(dir, 'german')], { encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`from-scenes failed: ${made.stderr}`);
  const world = JSON.parse(await readFile(join(dir, 'german', 'world', 'world.json'), 'utf8')) as { tasks: Array<{ id: string }> };
  return { world: join(dir, 'german', 'world'), taskId: world.tasks[0]!.id };
}

export interface Fixtures {
  failing: Bench; solved: Bench; timeout: Bench; unjudged: Bench; german: Bench;
  /** An agent that acted and then exited with code 7. */
  crashed: Bench;
  /** Two command-template benches on the same grid, three repeats: for compare. */
  good: Bench; bad: Bench;
  /** With the real mirror (only when asked for). */
  engine?: { solved: Bench; failing: Bench };
}

/** Runs every fixture bench once (model-only unless `mirror`). Takes a minute or two. */
export async function fixtureBenches(dir: string, options: { mirror?: boolean } = {}): Promise<Fixtures> {
  await mkdir(dir, { recursive: true });
  const failing = await scripted(dir, 'failing', FAILING, {});
  const solved = await bench({ ...base, agent: resolveAgent('oracle'), tasks: ['restyle-flow', 'group'] });
  const timeout = await bench({ ...base, agent: template('sleep'), tasks: ['connect'], timeoutSeconds: 2 });
  const unjudged = await bench({ ...base, agent: template('plant-dir'), tasks: ['connect'] });
  const crashed = await bench({ ...base, agent: template('crash'), tasks: ['connect'] });
  const authored = await germanWorld(dir);
  // Benched without its oracle: no reference, so no efficiency and no example target.
  const world = await ownBenchWorld(authored.world);
  const german = await scripted(dir, 'german', { [authored.taskId]: { steps: [{ act: 'rename_step', params: { id: 'a', label: 'Kreditorenstammdatenänderungsantragsprüfung' } }, { act: 'set_style', params: { id: 'b', shape: 'rectangle', stroke: 'black', fill: 'yellow' } }] } }, { world, tasks: [authored.taskId], label: 'Langer deutscher Name: Rechnungseingangsprüfung' });
  const good = await scripted(dir, 'good', SOLVING, { repeats: 3 });
  const bad = await scripted(dir, 'bad', { 'restyle-flow': FAILING['restyle-flow']!, group: FAILING.group! }, { repeats: 3 });
  const fixtures: Fixtures = { failing, solved, timeout, unjudged, german, crashed, good, bad };
  if (options.mirror) {
    const mirrored = { mirrorRequested: 'required' as const, mirror: 'required' as const };
    fixtures.engine = {
      solved: await bench({ ...base, ...mirrored, agent: resolveAgent('oracle'), tasks: ['restyle-flow', 'group'] }),
      failing: await scripted(dir, 'engine-failing', { 'restyle-flow': FAILING['restyle-flow']!, group: FAILING.group! }, mirrored),
    };
  }
  return fixtures;
}

/** The HTML page of a bench report, with its run details from `folder` (null: none). */
export async function reportPage(bench: { report: BenchReport; directory: string | null }, language: Language, verification: Verification = 'consistency-checked'): Promise<string> {
  const details = await loadReportDetails(bench.report, bench.directory, detailWords(language));
  return renderHtml(bench.report, await readTokensCss(), language, verification, details);
}
export async function reportText(bench: Bench, language: Language): Promise<string> {
  return renderTable(bench.report, language, await loadReportDetails(bench.report, bench.directory, detailWords(language)));
}

export interface ReportState { id: string; html(language: Language): Promise<string> }
/** Every named state of the report and compare pages (PADR-0039 B, C). */
export async function reportStates(fixtures: Fixtures): Promise<ReportState[]> {
  const v1 = validateBenchReport(JSON.parse(await readFile(V1_REPORT, 'utf8')));
  await verifyBenchV2(fixtures.solved.report, fixtures.solved.directory, libraryWorld);
  const tokens = await readTokensCss();
  const states: ReportState[] = [
    { id: 'report-failures', html: language => reportPage(fixtures.failing, language) },
    { id: 'report-reverified-pass', html: language => reportPage(fixtures.solved, language, 're-verified') },
    { id: 'report-timeout', html: language => reportPage(fixtures.timeout, language) },
    { id: 'report-unjudged', html: language => reportPage(fixtures.unjudged, language) },
    { id: 'report-agent-failed', html: language => reportPage(fixtures.crashed, language) },
    { id: 'report-long-german', html: language => reportPage(fixtures.german, language) },
    { id: 'report-no-folder', html: language => reportPage({ report: fixtures.failing.report, directory: null }, language) },
    { id: 'report-v1', html: language => reportPage({ report: v1, directory: null }, language) },
    { id: 'compare-regression', html: async language => renderCompareHtml({ report: fixtures.good.report, verification: 'consistency-checked' }, { report: fixtures.bad.report, verification: 'consistency-checked' }, compareReports(fixtures.good.report, fixtures.bad.report), tokens, language) },
    { id: 'compare-same', html: async language => renderCompareHtml({ report: fixtures.good.report, verification: 'consistency-checked' }, { report: fixtures.good.report, verification: 'consistency-checked' }, compareReports(fixtures.good.report, fixtures.good.report), tokens, language) },
  ];
  if (fixtures.engine) {
    const engine = fixtures.engine;
    states.push({ id: 'report-engine-pass', html: language => reportPage(engine.solved, language) }, { id: 'report-engine-failing', html: language => reportPage(engine.failing, language) });
  }
  return states;
}

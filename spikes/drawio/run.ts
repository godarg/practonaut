// Measurement driver of the draw.io spike (preregistered in PREREGISTRATION.md).
//   node spikes/drawio/run.ts start            5 cold starts + 3 warm starts
//   node spikes/drawio/run.ts replay <n>       library replay, run n (1..3), with memory sampling
//   node spikes/drawio/run.ts coverage <n>     13-action coverage sequence, run n
//   node spikes/drawio/run.ts negative         silent-change cases
//   node spikes/drawio/run.ts stability        same state in three fresh pages; compressed export
//   node spikes/drawio/run.ts probes           counter-probes through the app
// Results: .local/spikes/drawio/results/<mode>.json (local only; summarize.ts writes the committed summary).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem, release } from 'node:os';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { canonicalJson, sha256Hex } from '../../src/canonical/index.ts';
import { checkState } from '../../src/checker/index.ts';
import { Session } from '../../src/core/index.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { substituteTokens, variantIndex, variantTokens } from '../../src/world/variant.ts';
import type { OracleStep } from '../../src/authoring/from-scenes.ts';
import type { Scalar, State, World } from '../../src/world/types.ts';
import { memorySampler, startDrawio, type Drawio } from './harness.ts';
import { DrawioParseError, project, readDrawio, type Issue } from './parser.ts';
import { InexpressibleError, stateToXml, WriterMemory, type CrossFrameGroups } from './writer.ts';
import { cellRoundTrip } from './integrity.ts';
import { PIN_FILE, RESULTS_DIR } from './paths.ts';

const { world, library } = loadLibrary();
const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Record<string, unknown>;
const now = (): number => performance.now();
const ms = (value: number): number => Math.round(value * 10) / 10;

async function environment(browser?: Browser): Promise<Record<string, unknown>> {
  const playwright = JSON.parse(readFileSync(new URL(import.meta.resolve('playwright-core/package.json')), 'utf8')) as { version: string };
  return { node: process.version, platform: process.platform, arch: process.arch, os: release(), cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, memoryBytes: totalmem(), playwrightCore: playwright.version, chromium: browser?.version() ?? null, drawio: { tag: pin.tag, sha256: pin.sha256 } };
}
function save(name: string, data: unknown): void {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `${name}.json`), JSON.stringify(data, null, 1) + '\n');
  process.stdout.write(`saved results/${name}.json\n`);
}

/** The predicted live objects on the declared set (tombstones have no draw.io cell). */
const liveProjection = (state: State): Record<string, unknown> => Object.fromEntries(Object.values(state.objects).filter(o => !o.deleted).map(o => [o.id, o]));

export interface StepResult {
  index: number; action: string | null; ok: boolean; inexpressible?: string; error?: string;
  predictedHash: string; readHash: string | null; rawSha: string | null; diff: string[]; cellDiff: string[]; issues: Issue[]; unmodeled: Issue[];
  loadMs: number; exportMs: number; dataGroups: string[];
}

function diffObjects(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id], y = b[id];
    if (x === undefined) out.push(`${id}: only in read-back`);
    else if (y === undefined) out.push(`${id}: missing in read-back`);
    else if (canonicalJson(x) !== canonicalJson(y)) {
      const fx = x as Record<string, unknown>, fy = y as Record<string, unknown>;
      for (const key of new Set([...Object.keys(fx), ...Object.keys(fy)])) if (canonicalJson(fx[key] ?? null) !== canonicalJson(fy[key] ?? null)) out.push(`${id}.${key}: predicted ${JSON.stringify(fx[key])} read ${JSON.stringify(fy[key])}`);
    }
  }
  return out.slice(0, 20);
}

/** Write the predicted state with `load`, read back with `export`, parse, project, compare. */
async function roundTrip(app: Drawio, state: State, memory: WriterMemory, index: number, action: string | null, crossFrame: CrossFrameGroups = 'refuse'): Promise<{ result: StepResult; read: Record<string, unknown> | null }> {
  const predicted = liveProjection(state);
  const base = { index, action, predictedHash: sha256Hex(canonicalJson(predicted)), diff: [] as string[], cellDiff: [] as string[], issues: [] as Issue[], unmodeled: [] as Issue[], loadMs: 0, exportMs: 0, readHash: null, rawSha: null, dataGroups: [] as string[] };
  let written;
  try { written = stateToXml(state, memory, crossFrame); } catch (error) {
    if (error instanceof InexpressibleError) return { result: { ...base, ok: false, inexpressible: error.message }, read: null };
    throw error;
  }
  const t0 = now();
  try { await app.load(written.xml); } catch (error) { return { result: { ...base, ok: false, error: `load: ${String(error).slice(0, 200)}`, dataGroups: written.dataGroups }, read: null }; }
  const t1 = now();
  let xml: string;
  try { xml = await app.exportXml(); } catch (error) { return { result: { ...base, ok: false, error: `export: ${String(error).slice(0, 200)}`, loadMs: ms(t1 - t0), dataGroups: written.dataGroups }, read: null }; }
  const t2 = now();
  try {
    const projection = project(readDrawio(xml));
    const diff = diffObjects(predicted, projection.objects);
    const cellDiff = cellRoundTrip(written.xml, xml);
    const ok = diff.length === 0 && cellDiff.length === 0 && projection.issues.length === 0 && projection.unmodeled.length === 0;
    return { result: { ...base, ok, diff, cellDiff, issues: projection.issues, unmodeled: projection.unmodeled, readHash: sha256Hex(canonicalJson(projection.objects)), rawSha: sha256Hex(xml), loadMs: ms(t1 - t0), exportMs: ms(t2 - t1), dataGroups: written.dataGroups }, read: projection.objects };
  } catch (error) {
    const code = error instanceof DrawioParseError ? error.code : 'parse_failed';
    return { result: { ...base, ok: false, error: `${code}: ${String(error).slice(0, 200)}`, loadMs: ms(t1 - t0), exportMs: ms(t2 - t1), rawSha: sha256Hex(xml), dataGroups: written.dataGroups }, read: null };
  }
}

function resolveParams(step: OracleStep, tokens: Record<string, string>, created: string[]): Record<string, Scalar> | null {
  const params: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(step.params)) {
    if (value !== null && typeof value === 'object') { const id = created[value.created]; if (id === undefined) return null; params[key] = id; }
    else params[key] = typeof value === 'string' ? substituteTokens(value, tokens) : value;
  }
  return params;
}

interface SequenceResult { task: string; caseId: string; seed: number; sequence: string; kind: string; expected: boolean; verdict: boolean | null; verdictError?: string; steps: StepResult[]; ok: boolean; finalReadHash: string | null; console: string[]; dialogs: string[] }

async function replaySequence(app: Drawio, w: World, taskId: string, caseId: string, seed: number, name: string, kind: string, steps: readonly OracleStep[], expected: boolean): Promise<SequenceResult> {
  const session = new Session(w, seed, taskId);
  const tokens = variantTokens(w.variants.cases[variantIndex(w, seed)]!);
  const memory = new WriterMemory();
  const results: StepResult[] = [];
  const consoleBefore = app.console.length, dialogsBefore = app.dialogs.length;
  let { result, read } = await roundTrip(app, session.state, memory, 0, null);
  results.push(result);
  const created: string[] = [];
  for (const [index, step] of steps.entries()) {
    const params = resolveParams(step, tokens, created);
    if (!params) { results.push({ ...result, index: index + 1, action: step.name, ok: false, error: 'invalid oracle reference' }); break; }
    const before = new Set(Object.keys(session.state.objects));
    const applied = session.act({ name: step.name, params });
    if (!applied.ok) { results.push({ ...result, index: index + 1, action: step.name, ok: false, error: `core rejected: ${applied.error.code}` }); break; }
    created[index] = Object.keys(applied.state.objects).find(id => !before.has(id)) ?? '';
    ({ result, read } = await roundTrip(app, session.state, memory, index + 1, step.name));
    results.push(result);
  }
  let verdict: boolean | null = null, verdictError: string | undefined;
  if (read) {
    try { verdict = checkState(w, { objects: read } as unknown as State, { seed, taskId }).passed; } catch (error) { verdictError = String(error).slice(0, 200); }
  }
  const allSteps = results.length === steps.length + 1 && results.every(r => r.ok);
  return { task: taskId, caseId, seed, sequence: name, kind, expected, verdict, ...(verdictError ? { verdictError } : {}), steps: results, ok: allSteps && verdict === expected, finalReadHash: results.at(-1)?.readHash ?? null, console: app.console.slice(consoleBefore), dialogs: app.dialogs.slice(dialogsBefore) };
}

async function replay(run: number): Promise<void> {
  const sampler = memorySampler(250);
  const t0 = now();
  const app = await startDrawio();
  const sequences: SequenceResult[] = [];
  try {
    for (const entry of library.tasks) {
      for (const [caseId, seed] of Object.entries(entry.oracle.seeds)) {
        sequences.push(await replaySequence(app, world, entry.id, caseId, seed, 'reference', 'reference', entry.oracle.steps, true));
        for (const miss of entry.oracle.nearMisses) sequences.push(await replaySequence(app, world, entry.id, caseId, seed, miss.id, miss.kind, miss.steps, false));
      }
      const done = sequences.filter(s => s.task === entry.id);
      process.stdout.write(`run ${run} ${entry.id}: ${done.filter(s => s.ok).length}/${done.length} ok\n`);
    }
  } finally {
    const memory = await sampler.stop();
    const env = await environment(app.browser);
    await app.close();
    const steps = sequences.flatMap(s => s.steps);
    const loads = steps.map(s => s.loadMs).filter(v => v > 0).sort((a, b) => a - b), exports = steps.map(s => s.exportMs).filter(v => v > 0).sort((a, b) => a - b);
    const pct = (values: number[], p: number): number => values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))]! : 0;
    save(`replay-run${run}`, {
      mode: 'replay', run, environment: env, sandbox: app.sandbox, startTimings: app.timings, wallMs: ms(now() - t0), memory,
      denied: app.denied, missing: app.missing, served: { files: app.served.size, bytes: [...app.served.values()].reduce((s, f) => s + f.bytes, 0), allMatchRelease: [...app.served.values()].every(f => f.matchesRelease), paths: [...app.served.keys()] },
      totals: { sequences: sequences.length, sequencesOk: sequences.filter(s => s.ok).length, roundTrips: steps.length, roundTripsOk: steps.filter(s => s.ok).length, references: sequences.filter(s => s.kind === 'reference').length, referencesPassed: sequences.filter(s => s.kind === 'reference' && s.verdict === true).length, nearMisses: sequences.filter(s => s.kind !== 'reference').length, nearMissesFailed: sequences.filter(s => s.kind !== 'reference' && s.verdict === false).length },
      latency: { loadMedianMs: pct(loads, 0.5), loadP90Ms: pct(loads, 0.9), exportMedianMs: pct(exports, 0.5), exportP90Ms: pct(exports, 0.9) },
      console: app.console.slice(0, 50), dialogs: app.dialogs, sequences,
    });
  }
}

async function start(): Promise<void> {
  const cold: Array<Record<string, unknown>> = [];
  let env: Record<string, unknown> = {};
  for (let i = 0; i < 5; i++) {
    const app = await startDrawio();
    env = await environment(app.browser);
    cold.push({ ...app.timings, sandbox: app.sandbox, denied: app.denied.length, missing: app.missing.length, served: app.served.size });
    await app.close();
  }
  const { chromium } = await import('playwright-core');
  const { launchChromium } = await import('../../src/adapters/browser/chromium.ts');
  const { browser } = await launchChromium(chromium, () => ({ headless: true, timeout: 30_000 }));
  const warm: Array<Record<string, unknown>> = [];
  try {
    for (let i = 0; i < 3; i++) { const app = await startDrawio({ browser }); warm.push({ ...app.timings }); await app.close(); }
  } finally { await browser.close(); }
  const firstLoads = cold.map(c => c.firstLoadMs as number).sort((a, b) => a - b);
  save('start', { mode: 'start', environment: env, definition: 'launchChromium call -> load event of the first (empty) diagram', cold, warm, coldMedianMs: ms(firstLoads[2]!), coldMaxMs: ms(firstLoads[4]!) });
}

/** All 13 world/2 actions on the two-frames start state, including the edge states world/2 allows. */
const COVERAGE: Array<{ name: string; params: Record<string, Scalar | { created: number }> }> = [
  { name: 'set_frame', params: { id: 'a', frameId: 'fs' } },
  { name: 'set_frame', params: { id: 'b', frameId: 'fs' } },
  { name: 'set_frame', params: { id: 'c', frameId: 'fd' } },
  { name: 'set_frame', params: { id: 'd', frameId: 'fd' } },
  { name: 'add_step', params: { frameId: 'fs', label: 'Prüfen & <freigeben>', x: 100, y: 700, width: 180, height: 90, shape: 'diamond' } },
  { name: 'rename_step', params: { id: 'a', label: 'Quote "request"' } },
  { name: 'move_step', params: { id: 'b', x: 420, y: 480 } },
  { name: 'resize_step', params: { id: 'c', width: 200, height: 100 } },
  { name: 'set_style', params: { id: 'd', shape: 'ellipse', stroke: 'red', fill: 'yellow' } },
  { name: 'connect', params: { from: { created: 4 }, to: 'a' } },
  { name: 'reconnect_end', params: { id: 'ab', end: 'end', target: { created: 4 } } },
  { name: 'rename_frame', params: { id: 'fd', name: 'Shipping & <Delivery>' } },
  { name: 'group_steps', params: { id: 'a', with: 'b' } },
  { name: 'group_steps', params: { id: { created: 4 }, with: 'a' } },
  { name: 'set_frame', params: { id: 'b', frameId: null } },
  { name: 'ungroup', params: { id: 'a' } },
  { name: 'connect', params: { from: 'c', to: 'c' } },
  { name: 'delete_step', params: { id: 'd' } },
  { name: 'disconnect', params: { id: 'bc' } },
  { name: 'delete_step', params: { id: 'c' } },
  { name: 'set_frame', params: { id: { created: 4 }, frameId: 'fd' } },
  { name: 'connect', params: { from: { created: 4 }, to: 'b' } },
];

async function coverage(run: number): Promise<void> {
  const app = await startDrawio();
  const modes: Record<string, unknown> = {};
  try {
    for (const crossFrame of ['refuse', 'data-attribute'] as const) {
      const session = new Session(world, 0, 'two-frames');
      const memory = new WriterMemory();
      const steps: StepResult[] = [(await roundTrip(app, session.state, memory, 0, null, crossFrame)).result];
      const created: string[] = [];
      for (const [index, step] of COVERAGE.entries()) {
        const params = resolveParams(step as OracleStep, {}, created)!;
        const before = new Set(Object.keys(session.state.objects));
        const applied = session.act({ name: step.name, params });
        if (!applied.ok) throw new Error(`coverage step ${index} rejected by the core: ${applied.error.code} ${applied.error.message}`);
        created[index] = Object.keys(applied.state.objects).find(id => !before.has(id)) ?? '';
        steps.push((await roundTrip(app, session.state, memory, index + 1, step.name, crossFrame)).result);
      }
      modes[crossFrame] = { steps, ok: steps.every(s => s.ok), inexpressible: steps.filter(s => s.inexpressible).map(s => ({ index: s.index, action: s.action, reason: s.inexpressible })), actionsCovered: [...new Set(COVERAGE.map(s => s.name))].sort() };
      process.stdout.write(`coverage run ${run} ${crossFrame}: ${steps.filter(s => s.ok).length}/${steps.length} ok\n`);
    }
  } finally {
    const env = await environment(app.browser);
    await app.close();
    save(`coverage-run${run}`, { mode: 'coverage', run, environment: env, denied: app.denied, missing: app.missing, console: app.console, dialogs: app.dialogs, modes });
  }
}

const cellsOf = (xml: string): Record<string, unknown> | string => {
  try { return Object.fromEntries(readDrawio(xml).cells.map((c, i) => [`${c.id}#${i}`, { parent: c.parent, value: c.value, style: c.style, vertex: c.vertex, edge: c.edge, source: c.source, target: c.target, geometry: c.geometry, data: c.data }])); }
  catch (error) { return `unreadable: ${String(error).slice(0, 160)}`; }
};
const MODEL = (cells: string): string => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const STEP = (id: string, label: string, extra = '', parent = '1', x = '10', style = 'rounded=0;whiteSpace=wrap;html=0;strokeColor=#000000;fillColor=none;'): string =>
  `<mxCell id="${id}" value="${label}" style="${style}${extra}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="20" width="180" height="90" as="geometry"/></mxCell>`;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const step = (id: string, label: string, x = 10): Record<string, unknown> => ({ id, type: 'step', deleted: false, frameId: null, label, x, y: 20, width: 180, height: 90, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none' });

async function negative(): Promise<void> {
  const MARKUP = '<b>x</b><img src=x onerror=alert(1)>';
  const LONG = 'Ä'.repeat(2048);
  const cases: Array<{ id: string; xml: string; intended: Record<string, unknown> }> = [
    { id: 'edge-missing-target', xml: MODEL(STEP('s1', 'A') + '<mxCell id="e1" value="" style="endArrow=classic;html=0;" edge="1" parent="1" source="s1" target="ghost"><mxGeometry relative="1" as="geometry"/></mxCell>'), intended: { s1: step('s1', 'A'), e1: { id: 'e1', type: 'arrow', deleted: false, frameId: null, from: 's1', to: 'ghost' } } },
    { id: 'duplicate-id', xml: MODEL(STEP('s1', 'A') + STEP('s1', 'B', '', '1', '300')), intended: { s1: step('s1', 'A') } },
    { id: 'parent-is-edge', xml: MODEL(STEP('s1', 'A') + STEP('s2', 'B', '', '1', '300') + '<mxCell id="e1" value="" style="endArrow=classic;html=0;" edge="1" parent="1" source="s1" target="s2"><mxGeometry relative="1" as="geometry"/></mxCell>' + STEP('s3', 'C', '', 'e1')), intended: { s1: step('s1', 'A'), s2: step('s2', 'B', 300), e1: { id: 'e1', type: 'arrow', deleted: false, frameId: null, from: 's1', to: 's2' }, s3: step('s3', 'C') } },
    { id: 'parent-cycle', xml: MODEL(STEP('p1', 'A', '', 'p2') + STEP('p2', 'B', '', 'p1')), intended: { p1: step('p1', 'A'), p2: step('p2', 'B') } },
    { id: 'invalid-colour', xml: MODEL(STEP('s1', 'A', '', '1', '10', 'rounded=0;whiteSpace=wrap;html=0;strokeColor=#000000;fillColor=notacolor;')), intended: { s1: { ...step('s1', 'A'), fill: 'notacolor' } } },
    { id: 'markup-label-html0', xml: MODEL(STEP('s1', esc(MARKUP))), intended: { s1: step('s1', MARKUP) } },
    { id: 'markup-label-html1', xml: MODEL(STEP('s1', esc(MARKUP), '', '1', '10', 'rounded=0;whiteSpace=wrap;html=1;strokeColor=#000000;fillColor=none;')), intended: { s1: step('s1', MARKUP) } },
    { id: 'non-integer-geometry', xml: MODEL(STEP('s1', 'A', '', '1', '10.5')), intended: { s1: { ...step('s1', 'A'), x: 10.5 } } },
    { id: 'missing-parent', xml: MODEL(STEP('s1', 'A', '', 'nowhere')), intended: { s1: step('s1', 'A') } },
    { id: 'wrong-prediction', xml: MODEL(STEP('s1', 'B')), intended: { s1: step('s1', 'A') } },
    { id: 'labels-unicode', xml: MODEL(STEP('s1', esc('Grüße & <Tags> "quoted" \'single\'')) + STEP('s2', 'Prüfung', '', '1', '300') + STEP('s3', '📦 Versand', '', '1', '600') + STEP('s4', LONG, '', '1', '900')), intended: { s1: step('s1', 'Grüße & <Tags> "quoted" \'single\''), s2: step('s2', 'Prüfung', 300), s3: step('s3', '📦 Versand', 600), s4: step('s4', LONG, 900) } },
    { id: 'malformed-xml', xml: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="s1" value="A"', intended: { s1: step('s1', 'A') } },
  ];
  const { chromium } = await import('playwright-core');
  const { launchChromium } = await import('../../src/adapters/browser/chromium.ts');
  const { browser } = await launchChromium(chromium, () => ({ headless: true, timeout: 30_000 }));
  const results: Array<Record<string, unknown>> = [];
  const baseline = MODEL(STEP('base', 'previous diagram'));
  try {
    for (const c of cases) {
      const app = await startDrawio({ browser });
      try {
        await app.load(baseline);
        const missingBefore = app.missing.length;
        let loadEvent: unknown = null, loadError: string | null = null, exported: string | null = null, exportError: string | null = null;
        try { loadEvent = await app.load(c.xml); } catch (error) { loadError = String(error).slice(0, 200); }
        try { exported = await app.exportXml(); } catch (error) { exportError = String(error).slice(0, 200); }
        let projection: ReturnType<typeof project> | null = null, parseError: string | null = null;
        if (exported !== null) { try { projection = project(readDrawio(exported)); } catch (error) { parseError = String(error).slice(0, 200); } }
        const diff = projection ? diffObjects(c.intended, projection.objects) : ['no read-back'];
        const writtenCells = cellsOf(c.xml), readCells = exported === null ? 'no export' : cellsOf(exported);
        const appChanged = typeof writtenCells === 'string' || typeof readCells === 'string' || canonicalJson(writtenCells) !== canonicalJson(readCells);
        // First check (as run first): declared-set comparison plus projection integrity.
        const detectedByProjection = Boolean(loadError || exportError || parseError || diff.length || projection?.issues.length || projection?.unmodeled.length);
        // Added write check: every written cell comes back unchanged (integrity.ts).
        const cellDiff = exported === null ? ['no read-back'] : cellRoundTrip(c.xml, exported);
        const detected = detectedByProjection || cellDiff.length > 0;
        results.push({
          id: c.id, loadEvent: loadEvent ? 'received' : 'none', loadEventEchoesInput: typeof loadEvent === 'object' && loadEvent !== null && (loadEvent as { xml?: unknown }).xml === c.xml,
          loadError, exportError, parseError, appChanged, writtenCells, readCells, diff, issues: projection?.issues ?? [], unmodeled: projection?.unmodeled ?? [], detected,
          detectedByProjection, cellDiff, silentForProjectionCheck: appChanged && !detectedByProjection, silent: appChanged && !detected, newMissingRequests: app.missing.slice(missingBefore), denied: app.denied, dialogs: app.dialogs, console: app.console.filter(l => !l.startsWith('log:')).slice(0, 10),
        });
        process.stdout.write(`negative ${c.id}: appChanged=${appChanged} detected=${detected}\n`);
      } finally { await app.close(); }
    }
  } finally {
    const env = await environment(browser);
    await browser.close();
    save('negative', { mode: 'negative', environment: env, cases: results, silentCases: results.filter(r => r.silent).map(r => r.id), silentForProjectionCheck: results.filter(r => r.silentForProjectionCheck).map(r => r.id) });
  }
}

/** Final state of every reference (drawn case): three fresh pages each; raw XML and projection compared. */
async function stability(): Promise<void> {
  const { chromium } = await import('playwright-core');
  const { launchChromium } = await import('../../src/adapters/browser/chromium.ts');
  const { browser } = await launchChromium(chromium, () => ({ headless: true, timeout: 30_000 }));
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const entry of library.tasks) {
      const seed = entry.oracle.seeds.drawn!;
      const session = new Session(world, seed, entry.id);
      const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
      const created: string[] = [];
      for (const [index, s] of entry.oracle.steps.entries()) {
        const before = new Set(Object.keys(session.state.objects));
        const applied = session.act({ name: s.name, params: resolveParams(s, tokens, created)! });
        if (!applied.ok) throw new Error(`reference rejected: ${entry.id}`);
        created[index] = Object.keys(applied.state.objects).find(id => !before.has(id)) ?? '';
      }
      const xml = stateToXml(session.state).xml;
      const raws: string[] = [], projections: string[] = [];
      for (let i = 0; i < 3; i++) {
        const app = await startDrawio({ browser });
        try { await app.load(xml); const out = await app.exportXml(); raws.push(out); projections.push(canonicalJson(project(readDrawio(out)).objects)); } finally { await app.close(); }
      }
      // What differs between the raw exports, attribute by attribute.
      const varying = new Set<string>();
      const attrs = raws.map(r => [...r.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!] as const));
      for (let k = 0; k < Math.max(...attrs.map(a => a.length)); k++) { const values = new Set(attrs.map(a => a[k]?.join('='))); if (values.size > 1) varying.add(attrs[0]![k]?.[0] ?? '?'); }
      const predicted = canonicalJson(liveProjection(session.state));
      results.push({ task: entry.id, rawIdentical: new Set(raws).size === 1, varyingAttributes: [...varying].sort(), projectionIdentical: new Set(projections).size === 1, projectionEqualsPrediction: projections.every(p => p === predicted), rawSha: raws.map(r => sha256Hex(r)) });
      process.stdout.write(`stability ${entry.id}: raw identical ${new Set(raws).size === 1}, projection identical ${new Set(projections).size === 1}\n`);
    }
    // Compressed form through the app's documented compressXml configuration.
    const app = await startDrawio({ browser, config: { compressXml: true } });
    let compressed: Record<string, unknown>;
    try {
      const xml = stateToXml(world.tasks.find(t => t.id === 'two-frames')!.initialState!).xml;
      await app.load(xml);
      const out = await app.exportXml();
      const file = readDrawio(out);
      compressed = { exportIsCompressed: file.compressed, projectionEqualsPrediction: canonicalJson(project(file).objects) === canonicalJson(liveProjection(world.tasks.find(t => t.id === 'two-frames')!.initialState!)), sample: out.slice(0, 300) };
    } finally { await app.close(); }
    const env = await environment(browser);
    save('stability', { mode: 'stability', environment: env, tasks: results, compressed });
  } finally { await browser.close(); }
}

/** Empty diagram, unchanged start, wrong artifact, each written and exported through draw.io: every goal must fail. */
async function probes(): Promise<void> {
  const app = await startDrawio();
  const results: Array<Record<string, unknown>> = [];
  try {
    const wrong: State = { objects: { wrong: { id: 'wrong', type: 'frame', name: 'unrelated', deleted: false } } };
    for (const entry of library.tasks) {
      for (const [caseId, seed] of Object.entries(entry.oracle.seeds)) {
        const start = new Session(world, seed, entry.id).state;
        for (const [probe, state] of [['empty', { objects: {} }], ['unchanged', start], ['wrong-artifact', wrong]] as const) {
          const { result, read } = await roundTrip(app, state, new WriterMemory(), 0, null);
          let passed: boolean | null = null, error: string | undefined;
          try { passed = read ? checkState(world, { objects: read } as unknown as State, { seed, taskId: entry.id }).passed : null; } catch (e) { error = String(e).slice(0, 160); }
          results.push({ task: entry.id, caseId, probe, roundTripOk: result.ok, passed, ...(error ? { error } : {}) });
        }
      }
    }
  } finally {
    const env = await environment(app.browser);
    await app.close();
    save('probes', { mode: 'probes', environment: env, results, allFail: results.every(r => r.passed === false), denied: app.denied });
  }
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'start') await start();
else if (mode === 'replay') await replay(Number(arg ?? 1));
else if (mode === 'coverage') await coverage(Number(arg ?? 1));
else if (mode === 'negative') await negative();
else if (mode === 'stability') await stability();
else if (mode === 'probes') await probes();
else { process.stderr.write('usage: node spikes/drawio/run.ts start|replay <n>|coverage <n>|negative|stability|probes\n'); process.exitCode = 1; }

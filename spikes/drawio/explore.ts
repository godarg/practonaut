// Exploratory measurements (preregistered as never decisive).
//   node spikes/drawio/explore.ts merge       library replay (drawn case) written with the documented `merge` action
//   node spikes/drawio/explore.ts merge-sync  the same after `load` with diffSync: true
//   node spikes/drawio/explore.ts patch       library replay (drawn case) written as hand-built diff-sync patches
//   node spikes/drawio/explore.ts render      SVG and PNG export of one state, twice each
//   node spikes/drawio/explore.ts params      start with only embed=1&proto=json: which requests would the app make?
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '../../src/canonical/index.ts';
import { Session } from '../../src/core/index.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { substituteTokens, variantIndex, variantTokens } from '../../src/world/variant.ts';
import type { Scalar, State } from '../../src/world/types.ts';
import { startDrawio, type Drawio } from './harness.ts';
import { project, readDrawio } from './parser.ts';
import { stateToXml, WriterMemory } from './writer.ts';
import { cellRoundTrip } from './integrity.ts';
import { RESULTS_DIR } from './paths.ts';

const { world, library } = loadLibrary();
const live = (state: State): Record<string, unknown> => Object.fromEntries(Object.values(state.objects).filter(o => !o.deleted).map(o => [o.id, o]));

/** Per-cell XML snippets of the writer's output (the writer emits one element per cell). */
function snippets(xml: string): Map<string, { attrs: Record<string, string>; geometry: string }> {
  const out = new Map<string, { attrs: Record<string, string>; geometry: string }>();
  for (const m of xml.matchAll(/<mxCell ([^>]*?)(?:\/>|>(.*?)<\/mxCell>)/g)) {
    const attrs = Object.fromEntries([...m[1]!.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map(a => [a[1]!, a[2]!.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#xa;/g, '\n').replace(/&amp;/g, '&')]));
    if (attrs.id) out.set(attrs.id, { attrs, geometry: m[2] ?? '' });
  }
  return out;
}

/** A diff-sync patch for one page from the previous to the next written model. */
function buildPatch(pageId: string, previous: string, next: string): Record<string, unknown> {
  const a = snippets(previous), b = snippets(next);
  const inserts: Array<Record<string, unknown>> = [], updates: Record<string, Record<string, unknown>> = {}, removes: string[] = [];
  for (const [id, cell] of b) {
    const old = a.get(id);
    if (!old) {
      const entry: Record<string, unknown> = { id, parent: cell.attrs.parent };
      if (cell.attrs.vertex === '1') entry.vertex = 1;
      if (cell.attrs.edge === '1') entry.edge = 1;
      if (cell.attrs.connectable === '0') entry.connectable = 0;
      for (const key of ['style', 'value', 'source', 'target']) if (cell.attrs[key] !== undefined) entry[key] = cell.attrs[key];
      if (cell.geometry) entry.geometry = cell.geometry;
      inserts.push(entry);
      continue;
    }
    const change: Record<string, unknown> = {};
    for (const key of ['style', 'value', 'parent']) if (cell.attrs[key] !== old.attrs[key]) change[key] = cell.attrs[key] ?? null;
    for (const key of ['source', 'target']) if (cell.attrs[key] !== old.attrs[key]) change[key] = cell.attrs[key] ?? '';
    if (cell.geometry !== old.geometry) change.geometry = cell.geometry;
    if (Object.keys(change).length) updates[id] = change;
  }
  for (const id of a.keys()) if (!b.has(id)) removes.push(id);
  const cells: Record<string, unknown> = {};
  if (inserts.length) cells.i = inserts;
  if (Object.keys(updates).length) cells.u = updates;
  if (removes.length) cells.r = removes;
  return { u: { [pageId]: { cells } } };
}

async function replay(mode: 'merge' | 'merge-sync' | 'patch'): Promise<Record<string, unknown>> {
  const app = await startDrawio();
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const entry of library.tasks) {
      const seed = entry.oracle.seeds.drawn!;
      for (const [name, steps] of [['reference', entry.oracle.steps], ...entry.oracle.nearMisses.map(m => [m.id, m.steps] as const)] as const) {
        const session = new Session(world, seed, entry.id);
        const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
        const memory = new WriterMemory();
        let previous = stateToXml(session.state, memory).xml;
        await app.load(previous, mode === 'merge' ? {} : { diffSync: true });
        const pageId = /<diagram [^>]*id="([^"]+)"/.exec(await app.exportXml())?.[1] ?? '';
        const created: string[] = [];
        const failures: string[] = [];
        for (const [index, step] of steps.entries()) {
          const params: Record<string, Scalar> = {};
          for (const [key, value] of Object.entries(step.params)) params[key] = value !== null && typeof value === 'object' ? created[value.created]! : typeof value === 'string' ? substituteTokens(value, tokens) : value;
          const before = new Set(Object.keys(session.state.objects));
          const applied = session.act({ name: step.name, params });
          if (!applied.ok) { failures.push(`core rejected ${step.name}`); break; }
          created[index] = Object.keys(applied.state.objects).find(id => !before.has(id)) ?? '';
          const next = stateToXml(session.state, memory).xml;
          let response: Record<string, unknown>;
          try {
            // A bare mxGraphModel is merged as an additional page; the page id selects the page to update.
            response = mode !== 'patch' ? await app.request({ action: 'merge', xml: `<mxfile><diagram id="${pageId}" name="Page-1">${next}</diagram></mxfile>` }, 'merge') : await app.request({ action: 'patch', patch: buildPatch(pageId, previous, next) }, 'patch');
          } catch (error) { failures.push(`${step.name}: ${String(error).slice(0, 120)}`); break; }
          if (response.error) failures.push(`${step.name}: app error ${String(response.error).slice(0, 120)}`);
          const read = await app.exportXml();
          let p: ReturnType<typeof project>;
          try { p = project(readDrawio(read)); } catch (error) { failures.push(`${step.name}: read-back ${String(error).slice(0, 100)}`); break; }
          const diff = canonicalJson(p.objects) === canonicalJson(live(session.state)) ? [] : ['declared set differs'];
          const cells = cellRoundTrip(next, read);
          if (diff.length || p.issues.length) failures.push(`${step.name}: ${[...diff, ...p.issues.map(i => i.code)].join(', ')}`);
          if (cells.length) failures.push(`${step.name}: cells ${cells.slice(0, 2).join(' | ').slice(0, 200)}`);
          previous = next;
        }
        results.push({ task: entry.id, sequence: name, ok: failures.length === 0, failures: failures.slice(0, 4) });
      }
    }
  } finally { await app.close(); }
  const declaredOnly = results.filter(r => !r.ok && (r.failures as string[]).every(f => f.includes(': cells ')));
  return { mode, sequences: results.length, ok: results.filter(r => r.ok).length, failingOnlyOnCellCheck: declaredOnly.length, failures: results.filter(r => !r.ok), denied: app.denied, missing: app.missing };
}

async function params(): Promise<Record<string, unknown>> {
  const app = await startDrawio({ params: 'embed=1&proto=json', config: {} });
  try {
    const xml = stateToXml(world.tasks.find(t => t.id === 'two-frames')!.initialState!).xml;
    await app.load(xml);
    const read = await app.exportXml();
    const ok = canonicalJson(project(readDrawio(read)).objects) === canonicalJson(live(world.tasks.find(t => t.id === 'two-frames')!.initialState!));
    await new Promise(r => setTimeout(r, 3000));
    return { mode: 'params', params: 'embed=1&proto=json', roundTripOk: ok, denied: app.denied, missing: app.missing, served: [...app.served.keys()], timings: app.timings, console: app.console.slice(0, 20) };
  } finally { await app.close(); }
}

/** Rendered forms (SVG, PNG) of one state, twice each, with every external request blocked. */
async function render(): Promise<Record<string, unknown>> {
  const app = await startDrawio();
  try {
    const state = world.tasks.find(t => t.id === 'two-frames')!.initialState!;
    await app.load(stateToXml(state).xml);
    const out: Record<string, unknown> = {};
    for (const format of ['svg', 'png'] as const) {
      const shots: Array<{ ms: number; bytes: number; sha: string }> = [];
      for (let i = 0; i < 2; i++) {
        const t = performance.now();
        const response = await app.request<{ data?: unknown; error?: unknown }>({ action: 'export', format }, 'export');
        const data = typeof response.data === 'string' ? response.data : '';
        const { createHash } = await import('node:crypto');
        shots.push({ ms: Math.round(performance.now() - t), bytes: data.length, sha: createHash('sha256').update(data).digest('hex').slice(0, 16) });
      }
      out[format] = { exports: shots, identical: shots[0]!.sha === shots[1]!.sha, nonEmpty: shots.every(s => s.bytes > 100) };
    }
    return { mode: 'render', ...out, denied: app.denied, missing: app.missing, console: app.console.slice(0, 10) };
  } finally { await app.close(); }
}

const mode = process.argv[2];
const result = mode === 'merge' || mode === 'merge-sync' || mode === 'patch' ? await replay(mode) : mode === 'params' ? await params() : mode === 'render' ? await render() : null;
if (!result) { process.stderr.write('usage: node spikes/drawio/explore.ts merge|patch|params\n'); process.exitCode = 1; }
else {
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(join(RESULTS_DIR, `explore-${mode}.json`), JSON.stringify(result, null, 1) + '\n');
  const { failures, ...head } = result as { failures?: unknown };
  process.stdout.write(JSON.stringify(head).slice(0, 1500) + '\n');
  if (Array.isArray(failures)) process.stdout.write(JSON.stringify(failures.slice(0, 6), null, 1) + '\n');
}

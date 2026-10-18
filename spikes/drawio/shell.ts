// Re-measurement for PADR-0049 (0.3.0 Must 2, issue #52). Not part of the preregistered 0.2.0 spike:
// it drives the same pinned release through Practonaut's shared browser shell (PADR-0045: content
// security policy on every response, every other request refused and recorded, WebSockets closed, a
// sink proxy, no host resolution, no WebRTC UDP) and serves every app file straight from the verified
// `draw.war`, which is never unpacked. Nothing from the release runs outside the browser.
//   node spikes/drawio/shell.ts fetch      download the pinned asset into a new, empty directory under
//                                         .local/, check size and SHA-256 while streaming, keep it
//                                         only then (rename of a partial file)
//   node spikes/drawio/shell.ts archive    cost per start: hash the archive, read its directory,
//                                         inflate the files the app loads
//   node spikes/drawio/shell.ts start      5 cold starts through the shell
//   node spikes/drawio/shell.ts replay     one library replay (references and near misses, 3 cases)
//                                         with the process tree's memory sampled every 250 ms
//   node spikes/drawio/shell.ts probes     ids outside the semantic id pattern, PNG and SVG export
//   node spikes/drawio/shell.ts summary    writes results/shell.json from the local result files
// Local results: .local/spikes/drawio/results/shell-<mode>.json. The committed summary has no paths.
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { cpus, release, totalmem } from 'node:os';
import yauzl from 'yauzl';
import { canonicalJson, sha256Hex } from '../../src/canonical/index.ts';
import { startShell, type BrowserShell, type Fulfilment } from '../../src/adapters/browser/shell.ts';
import { chromiumSandboxFallbackActive } from '../../src/adapters/browser/chromium.ts';
import { checkState } from '../../src/checker/index.ts';
import { Session } from '../../src/core/index.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { substituteTokens, variantIndex, variantTokens } from '../../src/world/variant.ts';
import type { OracleStep } from '../../src/authoring/from-scenes.ts';
import type { Scalar, State } from '../../src/world/types.ts';
import { memorySampler } from './harness.ts';
import { project, readDrawio } from './parser.ts';
import { stateToXml, WriterMemory } from './writer.ts';
import { cellRoundTrip } from './integrity.ts';
import { DOWNLOAD_DIR, LOCAL_DIR, PIN_FILE, SUMMARY_DIR, type Pin } from './paths.ts';

const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Required<Pin>;
const SOURCE = `https://github.com/jgraph/drawio/releases/download/${pin.tag}/${pin.asset}`;
const ARCHIVE = join(DOWNLOAD_DIR, pin.asset);
const RESULTS = join(LOCAL_DIR, 'results');
const HOST = 'http://practonaut.invalid';
const APP = 'http://drawio.practonaut.invalid';
const PARAMS = 'embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none';
const EMPTY = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const ms = (value: number): number => Math.round(value * 10) / 10;
const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
const save = (name: string, data: unknown): void => { mkdirSync(RESULTS, { recursive: true }); writeFileSync(join(RESULTS, `shell-${name}.json`), JSON.stringify(data, null, 1) + '\n'); process.stdout.write(`saved results/shell-${name}.json\n`); };
const read = (name: string): Record<string, any> | null => { const file = join(RESULTS, `shell-${name}.json`); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, any> : null; }; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- download: size and SHA-256 checked while streaming, kept only by renaming a verified file ----
async function fetchPinned(): Promise<void> {
  if (existsSync(ARCHIVE)) { process.stdout.write('fetch: already kept; verifying\n'); verifyFile(); return; }
  if (existsSync(DOWNLOAD_DIR) && readdirSync(DOWNLOAD_DIR).length) throw new Error('refusing a non-empty download directory');
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  process.stdout.write(`fetch: ${pin.asset} ${pin.tag}, ${pin.size} bytes, from the official release\n`);
  const partial = join(DOWNLOAD_DIR, `.${pin.asset}.partial`);
  const started = performance.now();
  const response = await fetch(SOURCE, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
  const finalHost = new URL(response.url).host;
  const hash = createHash('sha256'), out = createWriteStream(partial, { flags: 'wx' });
  let bytes = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      if (bytes > pin.size) throw new Error(`more than the pinned ${pin.size} bytes`);
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise<void>(resolve => out.once('drain', () => resolve()));
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve()));
    const sha256 = hash.digest('hex');
    if (bytes !== pin.size || sha256 !== pin.sha256) throw new Error(`mismatch: ${bytes} bytes, sha256 ${sha256}`);
    renameSync(partial, ARCHIVE);
  } catch (error) { out.destroy(); rmSync(partial, { force: true }); throw error; }
  save('fetch', { mode: 'fetch', source: SOURCE, finalHost, bytes, sha256: pin.sha256, seconds: ms((performance.now() - started) / 1000) });
}
function verifyFile(): { ms: number } {
  const t0 = performance.now();
  const bytes = readFileSync(ARCHIVE);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== pin.size || sha256 !== pin.sha256) throw new Error('kept archive does not match pin.json');
  return { ms: ms(performance.now() - t0) };
}

// ---- the archive, read in place: entry names checked, WEB-INF and META-INF never served ----
const safeName = (name: string): boolean => !!name && name.length <= 512 && !name.startsWith('/') && !name.includes('\\') && !/^[A-Za-z]:/.test(name)
  && name.split('/').every(part => part !== '..' && part !== '.' && !/[\u0000-\u001f]/.test(part));
interface Archive { entries: Map<string, yauzl.Entry>; read(name: string): Promise<Buffer>; close(): void; indexMs: number; hashMs: number }
async function openArchive(): Promise<Archive> {
  const { ms: hashMs } = verifyFile();
  const t0 = performance.now();
  const zip = await new Promise<yauzl.ZipFile>((ok, fail) => yauzl.open(ARCHIVE, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, file) => error ? fail(error) : ok(file)));
  const entries = new Map<string, yauzl.Entry>();
  await new Promise<void>((ok, fail) => {
    zip.on('error', fail); zip.on('end', () => ok());
    zip.on('entry', (entry: yauzl.Entry) => {
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (!safeName(entry.fileName) || mode === 0o120000) { fail(new Error('unsafe entry name')); return; }
      if (!entry.fileName.endsWith('/')) entries.set(entry.fileName, entry);
      zip.readEntry();
    });
    zip.readEntry();
  });
  const indexMs = ms(performance.now() - t0);
  return {
    entries, indexMs, hashMs, close: () => zip.close(),
    read: name => new Promise<Buffer>((ok, fail) => {
      const entry = entries.get(name);
      if (!entry || entry.uncompressedSize > 32 * 1024 * 1024) { fail(new Error('no such entry')); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { fail(error ?? new Error('no stream')); return; }
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c)); stream.on('error', fail); stream.on('end', () => ok(Buffer.concat(chunks)));
      });
    }),
  };
}

const hostPage = `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>
<iframe id="app" src="${APP}/index.html?${PARAMS}"></iframe>
<script>
(() => {
  const frame = document.getElementById('app'); const waiters = [];
  window.__pn = { initAt: null, events: 0 };
  window.addEventListener('message', (evt) => {
    if (evt.source !== frame.contentWindow || evt.origin !== '${APP}') return;
    let data; try { data = JSON.parse(evt.data); } catch (e) { return; }
    window.__pn.events++;
    if (data.event === 'configure') frame.contentWindow.postMessage(JSON.stringify({ action: 'configure', config: { compressXml: false } }), '${APP}');
    if (data.event === 'init') window.__pn.initAt = performance.now();
    for (const w of waiters.slice()) if (w.event === data.event) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(data); }
  });
  window.__pn.send = (message, event, timeoutMs) => new Promise((resolve, reject) => {
    const w = { event, resolve }; w.timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout ' + event)); }, timeoutMs);
    waiters.push(w); frame.contentWindow.postMessage(JSON.stringify(message), '${APP}');
  });
})();
</script></body></html>`;

interface App { shell: BrowserShell; served: Map<string, number>; console: string[]; timings: { initMs: number; firstLoadMs: number; inflateMs: number }; request<T = Record<string, unknown>>(message: Record<string, unknown>, event: string): Promise<T>; load(xml: string): Promise<unknown>; exportXml(): Promise<string>; close(): Promise<void> }
/** Starts the shell with the host page and the app served from the archive (a fresh read per start). */
async function startApp(archive: Archive): Promise<App> {
  const served = new Map<string, number>(), consoleLines: string[] = [];
  let inflateMs = 0, initMs = 0, firstLoadMs = 0;
  const serveApp = async (path: string): Promise<Fulfilment | undefined> => {
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (/^(WEB-INF|META-INF)(\/|$)/i.test(name) || !archive.entries.has(name)) return undefined;
    const t = performance.now(); const body = await archive.read(name); inflateMs += performance.now() - t;
    served.set(name, body.length);
    return { body, contentType: TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream' };
  };
  const serveHost = async (path: string): Promise<Fulfilment | undefined> => path === '/' ? { body: hostPage, contentType: 'text/html' } : undefined;
  const request = async <T,>(message: Record<string, unknown>, event: string): Promise<T> => shell.page.evaluate(([m, e]) => (window as unknown as { __pn: { send(m: unknown, e: string, t: number): Promise<unknown> } }).__pn.send(m, e, 10_000), [message, event] as const) as Promise<T>;
  const t0 = performance.now();
  let shell!: BrowserShell;
  shell = await startShell({ origins: { [HOST]: serveHost, [APP]: serveApp } }, async started => {
    shell = started;
    started.page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
    started.page.on('pageerror', e => consoleLines.push(`pageerror: ${String(e).slice(0, 200)}`));
    await started.wait(() => started.page.goto(`${HOST}/`, { timeout: 30_000 }));
    await started.wait(() => started.page.waitForFunction('window.__pn && window.__pn.initAt !== null', undefined, { timeout: 30_000, polling: 5 }));
    initMs = performance.now() - t0;
    await request({ action: 'load', xml: EMPTY }, 'load');
    firstLoadMs = performance.now() - t0;
  });
  return {
    shell, served, console: consoleLines, timings: { initMs: ms(initMs), firstLoadMs: ms(firstLoadMs), inflateMs: ms(inflateMs) }, request,
    load: xml => request({ action: 'load', xml }, 'load'),
    exportXml: async () => { const r = await request<{ xml?: unknown }>({ action: 'export', format: 'xml' }, 'export'); if (typeof r.xml !== 'string') throw new Error('export without xml'); return r.xml; },
    close: () => shell.close(),
  };
}
async function environment(app?: App): Promise<Record<string, unknown>> {
  const playwright = JSON.parse(readFileSync(new URL(import.meta.resolve('playwright-core/package.json')), 'utf8')) as { version: string };
  return { node: process.version, platform: process.platform, arch: process.arch, os: release(), cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, memoryBytes: totalmem(), playwrightCore: playwright.version, chromium: app ? app.shell.browser.version() : null, sandbox: !chromiumSandboxFallbackActive(), drawio: { tag: pin.tag, sha256: pin.sha256 } };
}

async function archiveCost(): Promise<void> {
  const runs: Array<Record<string, number>> = [];
  let entries = 0, index: string | null = null;
  const loaded = ['index.html', 'styles/grapheditor.css', 'js/bootstrap.js', 'js/main.js', 'styles/high-contrast.css', 'js/PreConfig.js', 'js/app.min.js', 'mxgraph/css/common.css', 'js/PostConfig.js', 'resources/dia.txt', 'js/shapes-14-6-5.min.js', 'js/stencils.min.js', 'js/extensions.min.js', 'images/github-logo.svg'];
  const byExtension: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    const archive = await openArchive();
    entries = archive.entries.size;
    const t = performance.now(); let bytes = 0;
    for (const name of loaded) { const size = (await archive.read(name)).length; bytes += size; if (i === 0) byExtension[extname(name)] = (byExtension[extname(name)] ?? 0) + size; }
    if (i === 0) { const html = (await archive.read('index.html')).toString('utf8'); index = /http-equiv\s*=\s*["']Content-Security-Policy/i.test(html) ? 'has a CSP meta element' : 'no CSP meta element'; }
    runs.push({ hashMs: archive.hashMs, indexMs: archive.indexMs, inflateMs: ms(performance.now() - t), inflatedBytes: bytes });
    archive.close();
  }
  save('archive', { mode: 'archive', environment: await environment(), entries, indexHtml: index, loadedBytesByExtension: byExtension, runs, median: { hashMs: median(runs.map(r => r.hashMs!)), indexMs: median(runs.map(r => r.indexMs!)), inflateMs: median(runs.map(r => r.inflateMs!)) } });
}

async function start(): Promise<void> {
  const archive = await openArchive();
  const cold: Array<Record<string, unknown>> = [];
  let env: Record<string, unknown> = {};
  try {
    for (let i = 0; i < 5; i++) {
      const app = await startApp(archive);
      env = await environment(app);
      cold.push({ ...app.timings, refused: app.shell.networkAttempts(), served: app.served.size, servedBytes: [...app.served.values()].reduce((s, b) => s + b, 0), console: app.console.slice(0, 10) });
      await app.close();
    }
  } finally { archive.close(); }
  const first = cold.map(c => c.firstLoadMs as number);
  save('start', { mode: 'start', environment: env, definition: 'startShell call (sink, launch, context, routing, page) -> load event of the first (empty) diagram; files read from the archive on every start', cold, coldMedianMs: median(first), coldMinMs: Math.min(...first), coldMaxMs: Math.max(...first), servedPaths: null });
}

const { world, library } = loadLibrary();
const live = (state: State): Record<string, unknown> => Object.fromEntries(Object.values(state.objects).filter(o => !o.deleted).map(o => [o.id, o]));
function params(step: OracleStep, tokens: Record<string, string>, created: string[]): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(step.params)) out[key] = value !== null && typeof value === 'object' ? created[value.created]! : typeof value === 'string' ? substituteTokens(value, tokens) : value;
  return out;
}
/** One sequence: every state written with `load`, read back with `export`; declared set, write check and integrity. */
async function sequence(app: App, taskId: string, seed: number, steps: readonly OracleStep[]): Promise<{ ok: boolean; verdict: boolean | null; roundTrips: number; hashes: string[]; loadMs: number[]; exportMs: number[]; problems: string[] }> {
  const session = new Session(world, seed, taskId), tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!), memory = new WriterMemory();
  const hashes: string[] = [], loadMs: number[] = [], exportMs: number[] = [], problems: string[] = [];
  let read: Record<string, unknown> | null = null;
  const trip = async (state: State): Promise<void> => {
    const written = stateToXml(state, memory);
    const t0 = performance.now(); await app.load(written.xml); const t1 = performance.now(); const xml = await app.exportXml(); const t2 = performance.now();
    loadMs.push(t1 - t0); exportMs.push(t2 - t1);
    const projection = project(readDrawio(xml));
    if (canonicalJson(projection.objects) !== canonicalJson(live(state))) problems.push('declared set differs');
    const cells = cellRoundTrip(written.xml, xml); if (cells.length) problems.push(`write check: ${cells[0]}`);
    if (projection.issues.length || projection.unmodeled.length) problems.push('integrity');
    read = projection.objects; hashes.push(sha256Hex(canonicalJson(projection.objects)));
  };
  await trip(session.state);
  const created: string[] = [];
  for (const [index, step] of steps.entries()) {
    const before = new Set(Object.keys(session.state.objects));
    const applied = session.act({ name: step.name, params: params(step, tokens, created) });
    if (!applied.ok) { problems.push(`core rejected ${step.name}`); break; }
    created[index] = Object.keys(applied.state.objects).find(id => !before.has(id)) ?? '';
    await trip(session.state);
  }
  const verdict = read ? checkState(world, { objects: read } as unknown as State, { seed, taskId }).passed : null;
  return { ok: problems.length === 0, verdict, roundTrips: hashes.length, hashes, loadMs, exportMs, problems };
}
async function replay(run: number): Promise<void> {
  const archive = await openArchive();
  const sampler = memorySampler(250);
  const t0 = performance.now();
  const app = await startApp(archive);
  const results: Array<{ task: string; caseId: string; kind: string; expected: boolean; verdict: boolean | null; ok: boolean; roundTrips: number; chain: string; problems: string[] }> = [];
  const loads: number[] = [], exports: number[] = [];
  let env: Record<string, unknown> = {};
  try {
    for (const entry of library.tasks) {
      for (const [caseId, seed] of Object.entries(entry.oracle.seeds)) {
        for (const [kind, steps, expected] of [['reference', entry.oracle.steps, true] as const, ...entry.oracle.nearMisses.map(m => [m.id, m.steps, false] as const)]) {
          const r = await sequence(app, entry.id, seed, steps);
          loads.push(...r.loadMs); exports.push(...r.exportMs);
          results.push({ task: entry.id, caseId, kind, expected, verdict: r.verdict, ok: r.ok && r.verdict === expected, roundTrips: r.roundTrips, chain: sha256Hex(r.hashes.join(',')), problems: r.problems.slice(0, 3) });
        }
      }
      process.stdout.write(`replay ${entry.id}: ${results.filter(r => r.task === entry.id && r.ok).length}/${results.filter(r => r.task === entry.id).length}\n`);
    }
    env = await environment(app);
  } finally {
    const memory = await sampler.stop();
    const refused = app.shell.networkAttempts();
    await app.close(); archive.close();
    const references = results.filter(r => r.kind === 'reference'), misses = results.filter(r => r.kind !== 'reference');
    save(`replay-run${run}`, {
      mode: 'replay', run, environment: env, startTimings: app.timings, wallSeconds: ms((performance.now() - t0) / 1000), memory, refused, console: app.console.slice(0, 20),
      served: { files: app.served.size, bytes: [...app.served.values()].reduce((s, b) => s + b, 0), paths: [...app.served.keys()] },
      totals: { sequences: results.length, sequencesOk: results.filter(r => r.ok).length, roundTrips: results.reduce((s, r) => s + r.roundTrips, 0), references: references.length, referencesPassed: references.filter(r => r.verdict === true).length, nearMisses: misses.length, nearMissesFailed: misses.filter(r => r.verdict === false).length },
      latency: { loadMedianMs: ms(median(loads)), exportMedianMs: ms(median(exports)) },
      failures: results.filter(r => !r.ok).slice(0, 20),
      chains: results.map(r => `${r.task}/${r.caseId}/${r.kind}=${r.chain}`),
    });
  }
}

async function probes(): Promise<void> {
  const archive = await openArchive();
  const app = await startApp(archive);
  const out: Record<string, unknown> = {};
  try {
    // Root, layer and group cells with ids no semantic id can take (':' is outside [A-Za-z0-9_-]);
    // steps whose semantic ids are "0" and "1", the ids draw.io itself gives root and layer.
    const geometry = (x: number, y: number, w: number, h: number): string => `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>`;
    const ids = `<mxGraphModel><root><mxCell id="pn:root"/><mxCell id="pn:layer" parent="pn:root"/>`
      + `<mxCell id="f1" value="Lane" style="swimlane;container=1;collapsible=0;startSize=30;html=0;" vertex="1" parent="pn:layer">${geometry(80, 50, 460, 140)}</mxCell>`
      + `<mxCell id="pn:group:g1" value="" style="group;" vertex="1" connectable="0" parent="f1">${geometry(20, 50, 420, 70)}</mxCell>`
      + `<mxCell id="0" value="Zero" style="rounded=0;whiteSpace=wrap;html=0;strokeColor=#000000;fillColor=none;" vertex="1" parent="pn:group:g1">${geometry(0, 0, 160, 70)}</mxCell>`
      + `<mxCell id="1" value="One" style="ellipse;whiteSpace=wrap;html=0;strokeColor=#6c8ebf;fillColor=#dae8fc;" vertex="1" parent="pn:group:g1">${geometry(260, 0, 160, 70)}</mxCell>`
      + `<mxCell id="a1" value="" style="endArrow=classic;html=0;" edge="1" parent="f1" source="0" target="1"><mxGeometry relative="1" as="geometry"/></mxCell>`
      + `</root></mxGraphModel>`;
    await app.load(ids);
    const back = await app.exportXml();
    // Which file-level attributes the export carries (names only; values can name the machine).
    const names = (tag: string): string[] => [...(new RegExp(`<${tag}\\b([^>]*)>`).exec(back)?.[1] ?? '').matchAll(/([A-Za-z:_-]+)=/g)].map(m => m[1]!);
    // The `host` value is kept only when it is one of the shell's own origin host names.
    const host = /<mxfile\b[^>]*\bhost="([^"]*)"/.exec(back)?.[1];
    out.ids = { writeCheck: cellRoundTrip(ids, back), fileAttributes: { mxfile: names('mxfile'), diagram: names('diagram'), mxGraphModel: names('mxGraphModel') }, mxfileHost: host === undefined ? null : [new URL(HOST).host, new URL(APP).host].includes(host) ? host : 'another value' };
    // Protocol PNG and SVG export of the same state, twice each.
    const png = async (): Promise<Buffer> => { const r = await app.request<{ data?: unknown }>({ action: 'export', format: 'png' }, 'export'); const d = String(r.data ?? ''); if (!d.startsWith('data:image/png;base64,')) throw new Error(`png export: ${d.slice(0, 40)}`); return Buffer.from(d.slice(22), 'base64'); };
    const svg = async (): Promise<string> => { const r = await app.request<{ data?: unknown }>({ action: 'export', format: 'svg' }, 'export'); const d = String(r.data ?? ''); return d.startsWith('data:image/svg+xml;base64,') ? Buffer.from(d.slice(26), 'base64').toString('utf8') : d; };
    const [p1, p2] = [await png(), await png()];
    out.png = { signature: p1.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', bytes: p1.length, identical: p1.equals(p2) };
    const [s1, s2] = [await svg(), await svg()];
    const norm = (s: string): string => s.replace(/ge-svg-[A-Za-z0-9_-]+/g, 'ge-svg-X');
    const facts = (s: string): Record<string, unknown> => ({ bytes: s.length, foreignObject: (s.match(/<foreignObject/g) ?? []).length, svgText: (s.match(/<text[\s>]/g) ?? []).length, script: /<script/i.test(s), externalHosts: [...new Set([...s.matchAll(/(?:href|src)\s*=\s*["']https?:\/\/([^/"']+)/gi)].map(m => m[1]))] });
    out.svg = { ...facts(s1), identical: s1 === s2, identicalAfterRootId: norm(s1) === norm(s2) };
    // The same state without whiteSpace=wrap: does draw.io still put labels into foreignObject?
    await app.load(ids.replaceAll('whiteSpace=wrap;', ''));
    const s3 = await svg();
    out.svgWithoutWrap = facts(s3);
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(join(RESULTS, 'shell-probe-wrap.svg'), s1); writeFileSync(join(RESULTS, 'shell-probe-nowrap.svg'), s3);
    out.refused = app.shell.networkAttempts();
    out.console = app.console.slice(0, 10);
    out.environment = await environment(app);
  } finally { await app.close(); archive.close(); }
  save('probes', { mode: 'probes', ...out });
}

function summary(): void {
  const [fetched, cost, starts, probed] = ['fetch', 'archive', 'start', 'probes'].map(read);
  const runs = [1, 2, 3].map(n => read(`replay-run${n}`)).filter((r): r is Record<string, any> => r !== null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const chains = runs.map(r => (r.chains as string[]).join('\n'));
  const file = join(SUMMARY_DIR, 'shell.json');
  writeFileSync(file, JSON.stringify({
    schema: 'practonaut.drawio-shell-measurement/1', record: 'PADR-0049', measured: new Date().toISOString().slice(0, 10),
    pin: { tag: pin.tag, asset: pin.asset, bytes: pin.size, sha256: pin.sha256 },
    environment: runs[0]?.environment ?? starts?.environment ?? null,
    download: fetched ? { source: fetched.source, finalHost: fetched.finalHost, bytes: fetched.bytes, seconds: fetched.seconds } : null,
    archivePerStart: cost ? { entries: cost.entries, indexHtml: cost.indexHtml, loadedBytesByExtension: cost.loadedBytesByExtension, medianMs: cost.median, runs: cost.runs.length } : null,
    coldStart: starts ? { definition: starts.definition, medianMs: starts.coldMedianMs, minMs: starts.coldMinMs, maxMs: starts.coldMaxMs, firstLoadMs: starts.cold.map((c: Record<string, number>) => c.firstLoadMs), initMs: starts.cold.map((c: Record<string, number>) => c.initMs), refusedPerStart: starts.cold.map((c: Record<string, unknown[]>) => c.refused!.length), servedFiles: starts.cold[0]?.served, servedBytes: starts.cold[0]?.servedBytes } : null,
    replay: runs.map(r => ({ run: r.run, totals: r.totals, latency: r.latency, wallSeconds: r.wallSeconds, startFirstLoadMs: r.startTimings.firstLoadMs, peakChromiumRssBytes: r.memory.peakChromium, peakNodeRssBytes: r.memory.peakNode, peakProcesses: r.memory.peakProcesses, samples: r.memory.samples, refused: r.refused.length, servedFiles: r.served.files, servedBytes: r.served.bytes, failures: r.failures.length, consoleErrors: r.console.length })),
    replayRunsAgree: runs.length === 3 ? { sequences: runs[0]!.chains.length, identicalStepHashChains: new Set(chains).size === 1 } : null,
    probes: probed ? { idsWriteCheck: probed.ids.writeCheck, fileAttributes: probed.ids.fileAttributes, mxfileHost: probed.ids.mxfileHost, png: probed.png, svg: probed.svg, svgWithoutWrap: probed.svgWithoutWrap, refused: probed.refused.length } : null,
  }, null, 1) + '\n');
  process.stdout.write(`wrote results/shell.json (${statSync(file).size} bytes)\n`);
}

const [mode] = process.argv.slice(2);
if (mode === 'fetch') await fetchPinned();
else if (mode === 'archive') await archiveCost();
else if (mode === 'start') await start();
else if (mode === 'replay') await replay(Number(process.argv[3] ?? 1));
else if (mode === 'probes') await probes();
else if (mode === 'summary') summary();
else { process.stderr.write('usage: node spikes/drawio/shell.ts fetch|archive|start|replay|probes|summary\n'); process.exitCode = 1; }

// Re-measurement for PADR-0049 (0.3.0 Must 2, issue #52). Not part of the preregistered 0.2.0 spike:
// it drives the same pinned release through Practonaut's shared browser shell (PADR-0045: content
// security policy on every response, every other request refused and recorded, WebSockets closed, a
// sink proxy, no host resolution, no WebRTC UDP). At every start it reads the whole verified
// `draw.war` into memory, hashes that buffer and serves only from it (decision 2.5); the archive is
// never unpacked and nothing on disk is read after the check. It writes with the mapping the record
// decides (`mapping.ts`). Nothing from the release runs outside the browser.
//   node spikes/drawio/shell.ts fetch           download the pinned asset into a new, empty directory
//                                              under .local/, check size and SHA-256 while streaming,
//                                              keep it only then (rename of a partial file)
//   node spikes/drawio/shell.ts archive         the archive's facts (entries, methods, sizes, ratios,
//                                              names) and the cost of read, hash, index and inflate
//   node spikes/drawio/shell.ts starts          5 cold starts, each in a fresh Node process (start1)
//   node spikes/drawio/shell.ts replay <n> <o>  one run in this process: the library's start, reference
//                                              and near-miss sequences in 3 cases, in order <o>
//                                              (forward, reverse or shuffle), with memory sampled
//   node spikes/drawio/shell.ts probes          ids, UI language, PNG and SVG export, empty diagram
//   node spikes/drawio/shell.ts summary         writes results/shell.json from the local result files
// Local results: .local/spikes/drawio/results/shell-<mode>.json. The committed summary has no paths.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { cpus, loadavg, release, totalmem } from 'node:os';
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
import { decidedXml, fullWriteCheck, GROUP_PREFIX, LAYER, Memory, ROOT } from './mapping.ts';
import { DOWNLOAD_DIR, LOCAL_DIR, PIN_FILE, SUMMARY_DIR, type Pin } from './paths.ts';

const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Required<Pin>;
const SOURCE = `https://github.com/jgraph/drawio/releases/download/${pin.tag}/${pin.asset}`;
const ARCHIVE = join(DOWNLOAD_DIR, pin.asset);
const RESULTS = join(LOCAL_DIR, 'results');
const HOST = 'http://practonaut.invalid';
const APP = 'http://drawio.practonaut.invalid';
/** The spike's documented parameters plus `lang=en` (decision 3.3). */
const PARAMS = 'embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none&lang=en';
const EMPTY = `<mxGraphModel><root><mxCell id="${ROOT}"/><mxCell id="${LAYER}" parent="${ROOT}"/></root></mxGraphModel>`;
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const ms = (value: number): number => Math.round(value * 10) / 10;
const median = (values: number[]): number => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
const save = (name: string, data: unknown): void => { mkdirSync(RESULTS, { recursive: true }); writeFileSync(join(RESULTS, `shell-${name}.json`), JSON.stringify(data, null, 1) + '\n'); process.stderr.write(`saved results/shell-${name}.json\n`); };
const read = (name: string): Record<string, any> | null => { const file = join(RESULTS, `shell-${name}.json`); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, any> : null; }; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---- download: size and SHA-256 checked while streaming, kept only by renaming a verified file ----
async function fetchPinned(): Promise<void> {
  if (existsSync(ARCHIVE)) { process.stdout.write('fetch: already kept; verifying\n'); await openArchive(); return; }
  if (existsSync(DOWNLOAD_DIR) && readdirSync(DOWNLOAD_DIR).length) throw new Error('refusing a non-empty download directory');
  mkdirSync(DOWNLOAD_DIR, { recursive: true });
  process.stdout.write(`fetch: ${pin.asset} ${pin.tag}, ${pin.size} bytes, SHA-256 ${pin.sha256}, from ${SOURCE}\n`);
  const partial = join(DOWNLOAD_DIR, `.${pin.asset}.${process.pid}.partial`);
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
  await openArchive();
  save('fetch', { mode: 'fetch', source: SOURCE, finalHost, bytes, sha256: pin.sha256, seconds: ms((performance.now() - started) / 1000) });
}

// ---- the archive, read whole into memory, checked, indexed and served only from that buffer ----
const safeName = (name: string): boolean => !!name && name.length <= 512 && !name.startsWith('/') && !name.includes('\\') && !/^[A-Za-z]:/.test(name)
  && name.split('/').every(part => part !== '..' && part !== '.' && !/[\u0000-\u001f]/.test(part));
interface ZipFacts { entries: number; files: number; directories: number; links: number; duplicateNames: number; encrypted: number; methods: Record<string, number>; maxEntryBytes: number; maxEntryName: string; totalInflatedBytes: number; maxRatio: number; maxRatioName: string; markdownNames: string[] }
interface ZipAudit { localHeaderMismatches: number; localMethodMismatches: number; inflatedSizeMismatches: number; crcMismatches: number; filesInflated: number; actualInflatedBytes: number; allowlistDeclaredBytes: number; ms: number }
interface Archive { entries: Map<string, yauzl.Entry>; facts: ZipFacts; read(name: string): Promise<Buffer>; audit(): ZipAudit; timings: { readMs: number; hashMs: number; indexMs: number }; bufferBytes: number }
/** One entry's bytes straight from the in-memory archive: the local header is read from the buffer,
 * its name must equal the central directory's, and a deflated entry is inflated with
 * `maxOutputLength` set to the declared size; size and CRC-32 must then match the directory. */
function inflateEntry(buffer: Buffer, entry: yauzl.Entry): { data: Buffer; nameMatches: boolean; methodMatches: boolean } {
  const at = entry.relativeOffsetOfLocalHeader;
  if (buffer.readUInt32LE(at) !== 0x04034b50) throw new Error(`no local header for ${entry.fileName}`);
  const method = buffer.readUInt16LE(at + 8), nameLength = buffer.readUInt16LE(at + 26), extraLength = buffer.readUInt16LE(at + 28);
  const localName = buffer.subarray(at + 30, at + 30 + nameLength);
  const start = at + 30 + nameLength + extraLength, compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.uncompressedSize > 32 * 1024 * 1024) throw new Error('entry larger than 32 MiB');
  const data = entry.compressionMethod === 0 ? Buffer.from(compressed) : entry.compressionMethod === 8 ? inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) }) : (() => { throw new Error('compression method not allowed'); })();
  if (data.length !== entry.uncompressedSize) throw new Error(`inflated size differs for ${entry.fileName}`);
  if ((crc32(data) >>> 0) !== (entry.crc32 >>> 0)) throw new Error(`CRC-32 differs for ${entry.fileName}`);
  return { data, nameMatches: localName.equals(entry.fileNameRaw), methodMatches: method === entry.compressionMethod };
}
async function openArchive(): Promise<Archive> {
  const t0 = performance.now();
  const buffer = readFileSync(ARCHIVE);
  const t1 = performance.now();
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const t2 = performance.now();
  if (buffer.length !== pin.size || sha256 !== pin.sha256) throw new Error('kept archive does not match pin.json');
  const zip = await new Promise<yauzl.ZipFile>((ok, fail) => yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, file) => error ? fail(error) : ok(file)));
  const entries = new Map<string, yauzl.Entry>(), all: yauzl.Entry[] = [], names = new Set<string>();
  const facts: ZipFacts = { entries: 0, files: 0, directories: 0, links: 0, duplicateNames: 0, encrypted: 0, methods: {}, maxEntryBytes: 0, maxEntryName: '', totalInflatedBytes: 0, maxRatio: 0, maxRatioName: '', markdownNames: [] };
  await new Promise<void>((ok, fail) => {
    zip.on('error', fail); zip.on('end', () => ok());
    zip.on('entry', (entry: yauzl.Entry) => {
      facts.entries++; all.push(entry);
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (!safeName(entry.fileName)) { fail(new Error('unsafe entry name')); return; }
      // Duplicates over every entry, files and directories alike.
      if (names.has(entry.fileName)) facts.duplicateNames++;
      names.add(entry.fileName);
      if (mode === 0o120000) facts.links++;
      if (entry.generalPurposeBitFlag & 1) facts.encrypted++;
      facts.methods[String(entry.compressionMethod)] = (facts.methods[String(entry.compressionMethod)] ?? 0) + 1;
      if (entry.fileName.endsWith('/')) facts.directories++;
      else {
        facts.files++;
        entries.set(entry.fileName, entry);
        facts.totalInflatedBytes += entry.uncompressedSize;
        if (entry.uncompressedSize > facts.maxEntryBytes) { facts.maxEntryBytes = entry.uncompressedSize; facts.maxEntryName = entry.fileName; }
        const ratio = entry.compressedSize ? entry.uncompressedSize / entry.compressedSize : 0;
        if (ratio > facts.maxRatio) { facts.maxRatio = Math.round(ratio * 10) / 10; facts.maxRatioName = entry.fileName; }
        // Names only (never contents): where Markdown files, among them files addressed to coding agents, sit.
        if (/\.md$/i.test(entry.fileName)) facts.markdownNames.push(entry.fileName);
      }
      zip.readEntry();
    });
    zip.readEntry();
  });
  const t3 = performance.now();
  // Served files are inflated once; concurrent requests for one entry share one pending inflation.
  const cache = new Map<string, Promise<Buffer>>();
  return {
    entries, facts, bufferBytes: buffer.length, timings: { readMs: ms(t1 - t0), hashMs: ms(t2 - t1), indexMs: ms(t3 - t2) },
    read: name => {
      const entry = entries.get(name);
      if (!entry) return Promise.reject(new Error('no such entry'));
      let pending = cache.get(name);
      if (!pending) { pending = Promise.resolve().then(() => inflateEntry(buffer, entry).data); cache.set(name, pending); }
      return pending;
    },
    audit: () => {
      const a0 = performance.now();
      const audit: ZipAudit = { localHeaderMismatches: 0, localMethodMismatches: 0, inflatedSizeMismatches: 0, crcMismatches: 0, filesInflated: 0, actualInflatedBytes: 0, allowlistDeclaredBytes: LOADED.reduce((sum, n) => sum + (entries.get(n)?.uncompressedSize ?? 0), 0), ms: 0 };
      for (const entry of all) {
        try {
          const { data, nameMatches, methodMatches } = inflateEntry(buffer, entry);
          if (!nameMatches) audit.localHeaderMismatches++;
          if (!methodMatches) audit.localMethodMismatches++;
          if (!entry.fileName.endsWith('/')) { audit.filesInflated++; audit.actualInflatedBytes += data.length; }
        } catch (error) {
          if (/size differs/.test(String(error))) audit.inflatedSizeMismatches++; else if (/CRC/.test(String(error))) audit.crcMismatches++; else throw error;
        }
      }
      audit.ms = ms(performance.now() - a0);
      return audit;
    },
  };
}

const hostPage = (params: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>
<iframe id="app" src="${APP}/index.html?${params}"></iframe>
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

interface App { shell: BrowserShell; served: Map<string, number>; console: string[]; timings: { initMs: number; firstLoadMs: number; inflateMs: number }; request<T = Record<string, unknown>>(message: Record<string, unknown>, event: string): Promise<T>; load(xml: string): Promise<unknown>; exportXml(): Promise<string>; png(): Promise<Buffer>; close(): Promise<void> }
/** Starts the shell with the host page and the app served from the in-memory archive. */
async function startApp(archive: Archive, params = PARAMS): Promise<App> {
  const served = new Map<string, number>(), consoleLines: string[] = [];
  let inflateMs = 0, initMs = 0, firstLoadMs = 0;
  const serveApp = async (path: string): Promise<Fulfilment | undefined> => {
    const name = path === '/' ? 'index.html' : path.slice(1);
    if (/^(WEB-INF|META-INF)(\/|$)/i.test(name) || !archive.entries.has(name)) return undefined;
    const t = performance.now(); const body = await archive.read(name); inflateMs += performance.now() - t;
    served.set(name, body.length);
    return { body, contentType: TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream' };
  };
  const page = hostPage(params);
  const serveHost = async (path: string): Promise<Fulfilment | undefined> => path === '/' ? { body: page, contentType: 'text/html' } : undefined;
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
    png: async () => { const r = await request<{ data?: unknown }>({ action: 'export', format: 'png' }, 'export'); const d = String(r.data ?? ''); if (!d.startsWith('data:image/png;base64,')) throw new Error(`png export: ${d.slice(0, 40)}`); return Buffer.from(d.slice(22), 'base64'); },
    close: () => shell.close(),
  };
}
async function environment(app?: App): Promise<Record<string, unknown>> {
  const playwright = JSON.parse(readFileSync(new URL(import.meta.resolve('playwright-core/package.json')), 'utf8')) as { version: string };
  return { node: process.version, platform: process.platform, arch: process.arch, os: release(), cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, memoryBytes: totalmem(), loadAverage1m: Math.round(loadavg()[0]! * 10) / 10, playwrightCore: playwright.version, chromium: app ? app.shell.browser.version() : null, sandbox: !chromiumSandboxFallbackActive(), drawio: { tag: pin.tag, sha256: pin.sha256 } };
}
const nodeMemory = (): Record<string, number> => { const m = process.memoryUsage(); return { rss: m.rss, heapUsed: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers }; };

const LOADED = ['index.html', 'styles/grapheditor.css', 'js/bootstrap.js', 'js/main.js', 'styles/high-contrast.css', 'js/PreConfig.js', 'js/app.min.js', 'mxgraph/css/common.css', 'js/PostConfig.js', 'resources/dia.txt', 'js/shapes-14-6-5.min.js', 'js/stencils.min.js', 'js/extensions.min.js', 'images/github-logo.svg'];
async function archiveFacts(): Promise<void> {
  const runs: Array<Record<string, number>> = [];
  let facts: ZipFacts | null = null;
  const byExtension: Record<string, number> = {};
  for (let i = 0; i < 5; i++) {
    const archive = await openArchive();
    facts = archive.facts;
    const t = performance.now(); let bytes = 0;
    for (const name of LOADED) { const size = (await archive.read(name)).length; bytes += size; if (i === 0) byExtension[extname(name)] = (byExtension[extname(name)] ?? 0) + size; }
    runs.push({ ...archive.timings, inflateMs: ms(performance.now() - t), inflatedBytes: bytes });
  }
  const audited = await openArchive();
  const audit = audited.audit();
  const html = (await audited.read('index.html')).toString('utf8');
  save('archive', { mode: 'archive', environment: await environment(), facts, audit, indexHtml: /http-equiv\s*=\s*["']Content-Security-Policy/i.test(html) ? 'has a CSP meta element' : 'no CSP meta element', loadedBytesByExtension: byExtension, runs, median: Object.fromEntries(['readMs', 'hashMs', 'indexMs', 'inflateMs'].map(k => [k, median(runs.map(r => r[k]!))])), nodeAfter: nodeMemory() });
}

/** One cold start in this (fresh) process: archive read, hash and index, then the shell and the app. */
async function start1(): Promise<void> {
  const t0 = performance.now();
  const archive = await openArchive();
  const t1 = performance.now();
  const app = await startApp(archive);
  const t2 = performance.now();
  const result = { processToFirstLoadMs: ms(t2), archiveMs: ms(t1 - t0), archive: archive.timings, shellToFirstLoadMs: app.timings.firstLoadMs, initMs: app.timings.initMs, inflateMs: app.timings.inflateMs, refused: app.shell.networkAttempts(), served: [...app.served.keys()], servedBytes: [...app.served.values()].reduce((s, b) => s + b, 0), console: app.console.slice(0, 10), node: nodeMemory(), environment: await environment(app) };
  await app.close();
  process.stdout.write(`START1 ${JSON.stringify(result)}\n`);
}
async function starts(): Promise<void> {
  const script = fileURLToPath(import.meta.url);
  const cold: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let i = 0; i < 5; i++) {
    const output = execFileSync(process.execPath, [script, 'start1'], { encoding: 'utf8', timeout: 120_000 });
    const line = output.split('\n').find(l => l.startsWith('START1 '));
    if (!line) throw new Error('start1 printed no result');
    cold.push(JSON.parse(line.slice(7)));
  }
  const field = (k: string): number[] => cold.map(c => c[k] as number);
  save('starts', { mode: 'starts', definition: 'each start a fresh Node process: processToFirstLoadMs from the process time origin, archiveMs = read + SHA-256 + index of the in-memory archive, shellToFirstLoadMs = startShell call -> load event of the first (empty) diagram', environment: cold[0]?.environment, cold: cold.map(({ environment: _e, ...rest }) => rest), median: { processToFirstLoadMs: median(field('processToFirstLoadMs')), archiveMs: median(field('archiveMs')), shellToFirstLoadMs: median(field('shellToFirstLoadMs')) }, range: { processToFirstLoadMs: [Math.min(...field('processToFirstLoadMs')), Math.max(...field('processToFirstLoadMs'))], shellToFirstLoadMs: [Math.min(...field('shellToFirstLoadMs')), Math.max(...field('shellToFirstLoadMs'))] } });
}

const { world, library } = loadLibrary();
const live = (state: State): Record<string, unknown> => Object.fromEntries(Object.values(state.objects).filter(o => !o.deleted).map(o => [o.id, o]));
function params(step: OracleStep, tokens: Record<string, string>, created: string[]): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(step.params)) out[key] = value !== null && typeof value === 'object' ? created[value.created]! : typeof value === 'string' ? substituteTokens(value, tokens) : value;
  return out;
}
/** The spike reader's projection with the decided group cell ids mapped back to group ids. */
function projected(xml: string): ReturnType<typeof project> {
  const p = project(readDrawio(xml));
  for (const o of Object.values(p.objects)) if (typeof o.groupId === 'string' && o.groupId.startsWith(GROUP_PREFIX)) o.groupId = o.groupId.slice(GROUP_PREFIX.length);
  return p;
}
/** The raw export with only the random diagram id normalised. */
const normalisedExport = (xml: string): string => xml.replace(/(<diagram\b[^>]*\bid=")[^"]*"/, '$1-"');

interface SequenceResult { key: string; ok: boolean; expected: boolean; passed: boolean | null; errors: string[]; roundTrips: number; exportChain: string; finalExport: string; finalPng: string; problems: string[]; loadMs: number[]; exportMs: number[] }
/** One sequence: every state written with `load`, read back with `export`: declared set, full write check, integrity. */
async function sequence(app: App, key: string, taskId: string, seed: number, steps: readonly OracleStep[], expected: boolean): Promise<SequenceResult> {
  const session = new Session(world, seed, taskId), tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!), memory = new Memory();
  const chain: string[] = [], loadMs: number[] = [], exportMs: number[] = [], problems: string[] = [];
  let last = '';
  const trip = async (state: State): Promise<void> => {
    const xml = decidedXml(state, memory);
    const t0 = performance.now(); await app.load(xml); const t1 = performance.now(); const back = await app.exportXml(); const t2 = performance.now();
    loadMs.push(t1 - t0); exportMs.push(t2 - t1);
    const projection = projected(back);
    if (canonicalJson(projection.objects) !== canonicalJson(live(state))) problems.push('declared set differs');
    const writes = fullWriteCheck(xml, back); if (writes.length) problems.push(`write check: ${writes[0]}`);
    if (projection.issues.length || projection.unmodeled.length) problems.push(`integrity: ${JSON.stringify([...projection.issues, ...projection.unmodeled][0]).slice(0, 160)}`);
    last = back; chain.push(sha256Hex(normalisedExport(back)));
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
  // The verdict is the checker's on the app's own final export, read by the spike's reader.
  let passed: boolean | null = null, errors: string[] = [];
  try { const verdict = checkState(world, { objects: projected(last).objects } as unknown as State, { seed, taskId }); passed = verdict.passed; errors = verdict.tasks.flatMap(t => t.errors.map(e => e.id)); }
  catch (error) { problems.push(`verdict: ${String(error).slice(0, 120)}`); }
  const finalPng = sha256Hex((await app.png()).toString('base64'));
  return { key, ok: problems.length === 0 && passed === expected, expected, passed, errors, roundTrips: chain.length, exportChain: sha256Hex(chain.join(',')), finalExport: chain.at(-1) ?? '', finalPng, problems: problems.slice(0, 3), loadMs, exportMs };
}
/** A deterministic shuffle (xorshift32) so that run 3's order can be reproduced. */
function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items]; let s = seed >>> 0 || 1;
  const next = (): number => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  for (let i = out.length - 1; i > 0; i--) { const j = next() % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
async function replay(run: number, order: 'forward' | 'reverse' | 'shuffle'): Promise<void> {
  const plan: Array<{ key: string; taskId: string; seed: number; steps: readonly OracleStep[]; expected: boolean }> = [];
  for (const entry of library.tasks) for (const [caseId, seed] of Object.entries(entry.oracle.seeds)) {
    plan.push({ key: `${entry.id}/${caseId}/start`, taskId: entry.id, seed, steps: [], expected: false });
    plan.push({ key: `${entry.id}/${caseId}/reference`, taskId: entry.id, seed, steps: entry.oracle.steps, expected: true });
    for (const miss of entry.oracle.nearMisses) plan.push({ key: `${entry.id}/${caseId}/${miss.id}`, taskId: entry.id, seed, steps: miss.steps, expected: false });
  }
  const ordered = order === 'forward' ? plan : order === 'reverse' ? [...plan].reverse() : shuffled(plan, 0x5eed + run);
  const t0 = performance.now();
  const archive = await openArchive();
  const sampler = memorySampler(250);
  const app = await startApp(archive);
  const results: SequenceResult[] = [];
  let env: Record<string, unknown> = {};
  try {
    for (const item of ordered) results.push(await sequence(app, item.key, item.taskId, item.seed, item.steps, item.expected));
    env = await environment(app);
  } finally {
    const memory = await sampler.stop();
    const refused = app.shell.networkAttempts(), nodeEnd = nodeMemory();
    await app.close();
    const kind = (key: string): string => key.endsWith('/start') ? 'start' : key.endsWith('/reference') ? 'reference' : 'nearMiss';
    const count = (k: string, pred: (r: SequenceResult) => boolean): number => results.filter(r => kind(r.key) === k && pred(r)).length;
    const loads = results.flatMap(r => r.loadMs), exports = results.flatMap(r => r.exportMs);
    save(`replay-run${run}`, {
      mode: 'replay', run, order, environment: env, archiveTimings: archive.timings, startTimings: app.timings, wallSeconds: ms((performance.now() - t0) / 1000), memory, nodeEnd, archiveBufferBytes: archive.bufferBytes, refused, console: app.console.slice(0, 20),
      served: { files: app.served.size, bytes: [...app.served.values()].reduce((s, b) => s + b, 0), paths: [...app.served.keys()] },
      totals: { sequences: results.length, sequencesOk: results.filter(r => r.ok).length, roundTrips: results.reduce((s, r) => s + r.roundTrips, 0), starts: count('start', () => true), startsFailed: count('start', r => r.passed === false), references: count('reference', () => true), referencesPassed: count('reference', r => r.passed === true), nearMisses: count('nearMiss', () => true), nearMissesFailed: count('nearMiss', r => r.passed === false) },
      latency: { loadMedianMs: ms(median(loads)), exportMedianMs: ms(median(exports)) },
      failures: results.filter(r => !r.ok).slice(0, 20).map(r => ({ key: r.key, passed: r.passed, problems: r.problems })),
      sequences: results.map(r => ({ key: r.key, passed: r.passed, errors: r.errors, exportChain: r.exportChain, finalExport: r.finalExport, finalPng: r.finalPng })),
    });
  }
}

async function probes(): Promise<void> {
  const archive = await openArchive();
  const out: Record<string, unknown> = {};
  // UI language: the served files with lang=de, and with the decided lang=en.
  for (const lang of ['de', 'en']) {
    const app = await startApp(archive, PARAMS.replace('lang=en', `lang=${lang}`));
    out[`servedLang_${lang}`] = [...app.served.keys()].sort();
    out[`refusedLang_${lang}`] = app.shell.networkAttempts();
    await app.close();
  }
  const app = await startApp(archive);
  try {
    // An empty diagram's PNG export.
    try { out.emptyPng = { ok: true, bytes: (await app.png()).length }; } catch (error) { out.emptyPng = { ok: false, error: String(error).slice(0, 120) }; }
    // Geometry at its parent's origin (x = y = 0): what the export keeps of the written mxGeometry.
    const origin = `<mxGraphModel><root><mxCell id="${ROOT}"/><mxCell id="${LAYER}" parent="${ROOT}"/>`
      + `<mxCell id="${GROUP_PREFIX}g1" value="" style="group;" vertex="1" connectable="0" parent="${LAYER}"><mxGeometry x="100" y="100" width="460" height="70" as="geometry"/></mxCell>`
      + `<mxCell id="a" value="A" style="rounded=0;html=0;strokeColor=#000000;fillColor=none;" vertex="1" parent="${GROUP_PREFIX}g1"><mxGeometry x="0" y="0" width="160" height="70" as="geometry"/></mxCell>`
      + `<mxCell id="b" value="B" style="rounded=0;html=0;strokeColor=#000000;fillColor=none;" vertex="1" parent="${GROUP_PREFIX}g1"><mxGeometry x="300" y="0" width="160" height="70" as="geometry"/></mxCell></root></mxGraphModel>`;
    await app.load(origin);
    const originBack = await app.exportXml();
    out.originGeometry = { fullWriteCheck: fullWriteCheck(origin, originBack).map(p => p.replace(/.*?(\["mxGeometry".*?\]\])(?:.*?(\["mxGeometry".*?\]\]))?.*/, 'written $1 read $2')), readBack: [...originBack.matchAll(/<mxGeometry[^>]*>/g)].map(m => m[0]) };
    // The decided ids: root, layer, a frame, a group cell, steps "0" and "1", an arrow.
    // Written as the decided writer writes: an x or y of 0 is left out (see originGeometry).
    const geometry = (x: number, y: number, w: number, h: number): string => `<mxGeometry${x ? ` x="${x}"` : ''}${y ? ` y="${y}"` : ''} width="${w}" height="${h}" as="geometry"/>`;
    const ids = `<mxGraphModel><root><mxCell id="${ROOT}"/><mxCell id="${LAYER}" parent="${ROOT}"/>`
      + `<mxCell id="f1" value="Lane" style="swimlane;container=1;collapsible=0;startSize=30;html=0;" vertex="1" parent="${LAYER}">${geometry(80, 50, 460, 140)}</mxCell>`
      + `<mxCell id="${GROUP_PREFIX}g1" value="" style="group;" vertex="1" connectable="0" parent="f1">${geometry(20, 50, 420, 70)}</mxCell>`
      + `<mxCell id="0" value="Zero" style="rounded=0;html=0;strokeColor=#000000;fillColor=none;" vertex="1" parent="${GROUP_PREFIX}g1">${geometry(0, 0, 160, 70)}</mxCell>`
      + `<mxCell id="1" value="One" style="ellipse;html=0;strokeColor=#6c8ebf;fillColor=#dae8fc;" vertex="1" parent="${GROUP_PREFIX}g1">${geometry(260, 0, 160, 70)}</mxCell>`
      + `<mxCell id="a1" value="" style="endArrow=classic;html=0;" edge="1" parent="f1" source="0" target="1"><mxGeometry relative="1" as="geometry"/></mxCell>`
      + `</root></mxGraphModel>`;
    await app.load(ids);
    const back = await app.exportXml();
    const names = (tag: string): string[] => [...(new RegExp(`<${tag}\\b([^>]*)>`).exec(back)?.[1] ?? '').matchAll(/([A-Za-z:_-]+)=/g)].map(m => m[1]!);
    const host = /<mxfile\b[^>]*\bhost="([^"]*)"/.exec(back)?.[1];
    out.ids = { fullWriteCheck: fullWriteCheck(ids, back), fileAttributes: { mxfile: names('mxfile'), diagram: names('diagram'), mxGraphModel: names('mxGraphModel') }, mxfileHost: host === undefined ? null : [new URL(HOST).host, new URL(APP).host].includes(host) ? host : 'another value' };
    const [p1, p2] = [await app.png(), await app.png()];
    out.png = { signature: p1.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', bytes: p1.length, identical: p1.equals(p2) };
    const svg = async (): Promise<string> => { const r = await app.request<{ data?: unknown }>({ action: 'export', format: 'svg' }, 'export'); const d = String(r.data ?? ''); return d.startsWith('data:image/svg+xml;base64,') ? Buffer.from(d.slice(26), 'base64').toString('utf8') : d; };
    const facts = (s: string): Record<string, unknown> => ({ bytes: s.length, foreignObject: (s.match(/<foreignObject/g) ?? []).length, svgText: (s.match(/<text[\s>]/g) ?? []).length, script: /<script/i.test(s), externalHosts: [...new Set([...s.matchAll(/(?:href|src)\s*=\s*["']https?:\/\/([^/"']+)/gi)].map(m => m[1]))] });
    const [s1, s2] = [await svg(), await svg()];
    const norm = (s: string): string => s.replace(/ge-svg-[A-Za-z0-9_-]+/g, 'ge-svg-X');
    out.svg = { ...facts(s1), identical: s1 === s2, identicalAfterRootId: norm(s1) === norm(s2) };
    await app.load(ids.replaceAll('html=0;strokeColor', 'whiteSpace=wrap;html=0;strokeColor'));
    out.svgWithWrap = facts(await svg());
    out.refused = app.shell.networkAttempts();
    out.console = app.console.slice(0, 10);
    out.environment = await environment(app);
  } finally { await app.close(); }
  save('probes', { mode: 'probes', ...out });
}

function summary(): void {
  const [fetched, cost, cold, probed] = ['fetch', 'archive', 'starts', 'probes'].map(read);
  const runs = [1, 2, 3].map(n => read(`replay-run${n}`)).filter((r): r is Record<string, any> => r !== null); // eslint-disable-line @typescript-eslint/no-explicit-any
  // Agreement over what the per-step checks do not fix: the app's raw export (diagram id normalised)
  // after every step, its final PNG, and the full verdict (pass and error classes), per sequence.
  const byKey = runs.map(r => new Map<string, string>((r.sequences as Array<Record<string, unknown>>).map(s => [s.key as string, JSON.stringify([s.exportChain, s.finalPng, s.passed, s.errors])])));
  const keys = byKey[0] ? [...byKey[0].keys()] : [];
  const disagreements = keys.filter(k => new Set(byKey.map(m => m.get(k))).size !== 1);
  const pngDisagreements = keys.filter(k => new Set(runs.map(r => (r.sequences as Array<Record<string, unknown>>).find(s => s.key === k)?.finalPng)).size !== 1);
  const file = join(SUMMARY_DIR, 'shell.json');
  writeFileSync(file, JSON.stringify({
    schema: 'practonaut.drawio-shell-measurement/2', record: 'PADR-0049', measured: new Date().toISOString().slice(0, 10),
    note: 'A precursor of the acceptance protocol (PADR-0049 decision 8.4): the decided mapping, written with load and read with export through the shared shell; verdicts by the spike reader on the app\'s own final export, not by the product reader; every run a fresh Node process and browser.',
    pin: { tag: pin.tag, asset: pin.asset, bytes: pin.size, sha256: pin.sha256 },
    environment: runs[0]?.environment ?? cold?.environment ?? null,
    download: fetched ? { source: fetched.source, finalHost: fetched.finalHost, bytes: fetched.bytes, seconds: fetched.seconds } : null,
    archive: cost ? { audit: cost.audit, facts: { ...cost.facts, markdownNames: undefined, markdownFiles: cost.facts.markdownNames.length, markdownOutsideWebInf: cost.facts.markdownNames.filter((n: string) => !/^(WEB-INF|META-INF)\//i.test(n)) }, indexHtml: cost.indexHtml, loadedBytesByExtension: cost.loadedBytesByExtension, medianMs: cost.median, runs: cost.runs.length, nodeAfterBytes: cost.nodeAfter } : null,
    coldStartFreshProcess: cold ? { definition: cold.definition, median: cold.median, range: cold.range, perStart: cold.cold.map((c: Record<string, unknown>) => ({ processToFirstLoadMs: c.processToFirstLoadMs, archiveMs: c.archiveMs, shellToFirstLoadMs: c.shellToFirstLoadMs, refused: (c.refused as unknown[]).length, nodeRssBytes: (c.node as Record<string, number>).rss })), servedFiles: cold.cold[0]?.served.length, servedBytes: cold.cold[0]?.servedBytes } : null,
    replay: runs.map(r => ({ run: r.run, order: r.order, totals: r.totals, latency: r.latency, wallSeconds: r.wallSeconds, loadAverage1m: r.environment?.loadAverage1m, peakChromiumRssBytes: r.memory.peakChromium, peakNodeRssBytes: r.memory.peakNode, nodeEnd: r.nodeEnd, archiveBufferBytes: r.archiveBufferBytes, peakProcesses: r.memory.peakProcesses, samples: r.memory.samples, refused: r.refused.length, servedFiles: r.served.files, failures: r.failures.length, firstFailures: r.failures.slice(0, 3), consoleErrors: r.console.length })),
    // Run 4 (optional): the same sequences after the serving path changed to one inflation per entry
    // with maxOutputLength and CRC-32 (round 2); it must give the same app output as run 1.
    servingPathCheck: (() => { const r4 = read('replay-run4'); if (!r4 || !byKey[0]) return null; const m = new Map<string, string>((r4.sequences as Array<Record<string, unknown>>).map(s => [s.key as string, JSON.stringify([s.exportChain, s.finalPng, s.passed, s.errors])])); return { run: 4, order: r4.order, totals: r4.totals, failures: r4.failures.length, refused: r4.refused.length, loadAverage1m: r4.environment?.loadAverage1m, differFromRun1: keys.filter(k => m.get(k) !== byKey[0]!.get(k)).length }; })(),
    replayRunsAgree: runs.length === 3 ? { sequences: keys.length, comparedPerSequence: 'raw export after every step (diagram id normalised), final PNG bytes, verdict and error classes', disagreements: disagreements.length, pngDisagreements: pngDisagreements.length, firstDisagreements: disagreements.slice(0, 5) } : null,
    probes: probed ? { servedLang_de: probed.servedLang_de, servedLang_en: probed.servedLang_en, refusedLang: [probed.refusedLang_de.length, probed.refusedLang_en.length], emptyPng: probed.emptyPng, originGeometryReadBack: probed.originGeometry.readBack, idsFullWriteCheck: probed.ids.fullWriteCheck, fileAttributes: probed.ids.fileAttributes, mxfileHost: probed.ids.mxfileHost, png: probed.png, svg: probed.svg, svgWithWrap: probed.svgWithWrap, refused: probed.refused.length } : null,
  }, (_k, v) => v === undefined ? undefined : v, 1) + '\n');
  process.stdout.write(`wrote results/shell.json (${statSync(file).size} bytes)\n`);
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === 'fetch') await fetchPinned();
else if (mode === 'archive') await archiveFacts();
else if (mode === 'start1') await start1();
else if (mode === 'starts') await starts();
else if (mode === 'replay') await replay(Number(arg1 ?? 1), (arg2 ?? 'forward') as 'forward' | 'reverse' | 'shuffle');
else if (mode === 'probes') await probes();
else if (mode === 'summary') summary();
else { process.stderr.write('usage: node spikes/drawio/shell.ts fetch|archive|starts|replay <n> <forward|reverse|shuffle>|probes|summary\n'); process.exitCode = 1; }

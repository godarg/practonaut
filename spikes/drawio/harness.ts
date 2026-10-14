/**
 * Starts the pinned draw.io release in Practonaut's headless Chromium and talks to it only through
 * the documented embed JSON protocol (postMessage from a host page; no script runs in the app frame).
 * Every request outside the two local origins is aborted and logged; every served app file is
 * checked against the SHA-256 of the same entry inside the official release asset.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import yauzl from 'yauzl';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { launchChromium } from '../../src/adapters/excalidraw/chromium.ts';
import { DOWNLOAD_DIR, LOCAL_DIR, PIN_FILE, WEBAPP_DIR, type Pin } from './paths.ts';

export const HOST_ORIGIN = 'http://practonaut.invalid';
export const APP_ORIGIN = 'http://drawio.practonaut.invalid';
/** Documented URL parameters only (drawio.com "Supported URL parameters" and "Embed mode"). */
export const URL_PARAMETERS = 'embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none';
/** Documented configuration keys only (drawio.com "Configure the draw.io editor"). */
export const DEFAULT_CONFIG: Record<string, unknown> = { compressXml: false };
export const MESSAGE_TIMEOUT_MS = 10_000;

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain', '.xml': 'application/xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json', '.wasm': 'application/wasm' };

/** SHA-256 of every file entry inside the official draw.war (computed from the archive itself). */
export async function releaseManifest(): Promise<Record<string, string>> {
  const pin = JSON.parse(readFileSync(PIN_FILE, 'utf8')) as Pin;
  const cache = join(LOCAL_DIR, `manifest-${pin.tag}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8')) as Record<string, string>;
  const war = join(DOWNLOAD_DIR, pin.asset);
  const archiveHash = createHash('sha256').update(readFileSync(war)).digest('hex');
  if (archiveHash !== pin.sha256) throw new Error('release asset does not match pin.json');
  const manifest: Record<string, string> = {};
  const zip = await new Promise<yauzl.ZipFile>((ok, fail) => yauzl.open(war, { lazyEntries: true }, (e, z) => e ? fail(e) : ok(z)));
  await new Promise<void>((ok, fail) => {
    zip.on('error', fail); zip.on('end', () => ok());
    zip.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { fail(error ?? new Error('no stream')); return; }
        const hash = createHash('sha256');
        stream.on('data', (chunk: Buffer) => hash.update(chunk));
        stream.on('end', () => { manifest[entry.fileName] = hash.digest('hex'); zip.readEntry(); });
        stream.on('error', fail);
      });
    });
    zip.readEntry();
  });
  mkdirSync(LOCAL_DIR, { recursive: true });
  writeFileSync(cache, JSON.stringify(manifest));
  return manifest;
}

const hostPage = (config: Record<string, unknown>, params: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>host</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>
<iframe id="app" src="${APP_ORIGIN}/index.html?${params}"></iframe>
<script>
(() => {
  const frame = document.getElementById('app');
  const CONFIG = ${JSON.stringify(config)};
  const events = []; const waiters = [];
  window.__pn = { events, initAt: null, configureAt: null };
  window.addEventListener('message', (evt) => {
    if (evt.source !== frame.contentWindow || evt.origin !== '${APP_ORIGIN}') return;
    let data;
    try { data = JSON.parse(evt.data); } catch (e) { data = { event: '#nonjson', raw: String(evt.data).slice(0, 120) }; }
    const at = performance.now();
    events.push({ at, event: data.event ?? null, error: data.error ?? null });
    if (data.event === 'configure') { window.__pn.configureAt = at; frame.contentWindow.postMessage(JSON.stringify({ action: 'configure', config: CONFIG }), '${APP_ORIGIN}'); }
    if (data.event === 'init') window.__pn.initAt = at;
    for (const w of waiters.slice()) if (w.event === data.event || data.error === 'unknownMessage') { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(data); }
  });
  window.__pn.send = (message, event, timeoutMs) => new Promise((resolve, reject) => {
    const w = { event, resolve };
    w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('timeout waiting for ' + event)); }, timeoutMs);
    waiters.push(w);
    frame.contentWindow.postMessage(JSON.stringify(message), '${APP_ORIGIN}');
  });
})();
</script></body></html>`;

export interface ServedFile { path: string; bytes: number; sha256: string; matchesRelease: boolean }
export interface Drawio {
  browser: Browser; context: BrowserContext; page: Page; sandbox: boolean;
  timings: { launchMs: number; initMs: number; firstLoadMs: number };
  denied: string[]; missing: string[]; served: Map<string, ServedFile>; console: string[]; dialogs: string[];
  /** Sends one protocol message and waits for the named response event. */
  request<T = Record<string, unknown>>(message: Record<string, unknown>, event: string, timeoutMs?: number): Promise<T>;
  load(xml: string, extra?: Record<string, unknown>): Promise<Record<string, unknown>>;
  exportXml(): Promise<string>;
  close(): Promise<void>;
}

export interface StartOptions { config?: Record<string, unknown>; params?: string; browser?: Browser }

/** Cold start (launches Chromium) unless an existing browser is passed (warm start). */
export async function startDrawio(options: StartOptions = {}): Promise<Drawio> {
  const manifest = await releaseManifest();
  const t0 = performance.now();
  let browser = options.browser, sandbox = true;
  if (!browser) {
    const { chromium } = await import('playwright-core');
    const launched = await launchChromium(chromium, () => ({ headless: true, timeout: 30_000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }));
    browser = launched.browser; sandbox = launched.sandbox;
  }
  const launchMs = performance.now() - t0;
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
  const denied: string[] = [], missing: string[] = [], consoleLines: string[] = [], dialogs: string[] = [];
  const served = new Map<string, ServedFile>();
  const root = resolve(WEBAPP_DIR);
  const html = hostPage(options.config ?? DEFAULT_CONFIG, options.params ?? URL_PARAMETERS);
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === HOST_ORIGIN && url.pathname === '/') { await route.fulfill({ body: html, contentType: 'text/html' }); return; }
    if (url.origin !== APP_ORIGIN) { denied.push(`${url.protocol}//${url.host}${url.pathname}`.slice(0, 200)); await route.abort('blockedbyclient'); return; }
    let path: string;
    try { path = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { denied.push(url.href.slice(0, 200)); await route.abort(); return; }
    const file = resolve(root, path || 'index.html');
    const inside = file.startsWith(root + sep);
    if (!inside || /^(WEB-INF|META-INF)(\/|$)/i.test(path) || !existsSync(file) || !statSync(file).isFile()) { missing.push(path.slice(0, 200)); await route.fulfill({ status: 404, body: 'not found', contentType: 'text/plain' }); return; }
    const body = readFileSync(file);
    const entry = path || 'index.html';
    const sha256 = createHash('sha256').update(body).digest('hex');
    served.set(entry, { path: entry, bytes: body.length, sha256, matchesRelease: manifest[entry] === sha256 });
    await route.fulfill({ body, contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
  });
  const page = await context.newPage();
  page.on('console', message => { if (consoleLines.length < 500) consoleLines.push(`${message.type()}: ${message.text().slice(0, 300)}`); });
  page.on('pageerror', error => { if (consoleLines.length < 500) consoleLines.push(`pageerror: ${String(error).slice(0, 300)}`); });
  page.on('dialog', dialog => { dialogs.push(`${dialog.type()}: ${dialog.message().slice(0, 200)}`); void dialog.dismiss(); });
  const request = async <T,>(message: Record<string, unknown>, event: string, timeoutMs = MESSAGE_TIMEOUT_MS): Promise<T> =>
    page.evaluate(([m, e, t]) => (window as unknown as { __pn: { send(m: unknown, e: string, t: number): Promise<unknown> } }).__pn.send(m, e, t), [message, event, timeoutMs] as const) as Promise<T>;
  await page.goto(`${HOST_ORIGIN}/`, { timeout: 30_000 });
  await page.waitForFunction('window.__pn && window.__pn.initAt !== null', undefined, { timeout: 30_000, polling: 5 });
  const initMs = performance.now() - t0;
  const empty = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
  await request({ action: 'load', xml: empty }, 'load');
  const firstLoadMs = performance.now() - t0;
  return {
    browser, context, page, sandbox, timings: { launchMs, initMs, firstLoadMs }, denied, missing, served, console: consoleLines, dialogs,
    request,
    load: (xml, extra = {}) => request<Record<string, unknown>>({ action: 'load', xml, ...extra }, 'load'),
    exportXml: async () => {
      const response = await request<{ xml?: unknown; format?: unknown }>({ action: 'export', format: 'xml' }, 'export');
      if (typeof response.xml !== 'string') throw new Error('export without xml');
      return response.xml;
    },
    close: async () => { if (options.browser) await context.close(); else await browser!.close(); },
  };
}

const run = promisify(execFile);
/** RSS (bytes) of every descendant of this Node process (except the sampling `ps` itself), summed,
 * and of Node itself. Chromium's crashpad handler is reparented to launchd and not included (~2 MB). */
export async function processTreeRss(): Promise<{ chromium: number; node: number; processes: number }> {
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,rss=,comm=']);
  const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/)).filter(parts => parts.slice(3).join(' ').split('/').at(-1) !== 'ps')
    .map(parts => parts.slice(0, 3).map(Number) as [number, number, number]);
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of rows) children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  const rss = new Map(rows.map(([pid, , kb]) => [pid, kb * 1024]));
  const descendants: number[] = [];
  const stack = [...(children.get(process.pid) ?? [])];
  while (stack.length) { const pid = stack.pop()!; descendants.push(pid); stack.push(...(children.get(pid) ?? [])); }
  return { chromium: descendants.reduce((sum, pid) => sum + (rss.get(pid) ?? 0), 0), node: rss.get(process.pid) ?? 0, processes: descendants.length };
}

/** Samples the process tree every `everyMs` until stopped; returns the peak and the sample count. */
export function memorySampler(everyMs = 250): { stop(): Promise<{ peakChromium: number; peakNode: number; peakProcesses: number; samples: number }> } {
  let peakChromium = 0, peakNode = 0, peakProcesses = 0, samples = 0, running = true;
  const loop = (async () => {
    while (running) {
      try { const s = await processTreeRss(); samples++; peakChromium = Math.max(peakChromium, s.chromium); peakNode = Math.max(peakNode, s.node); peakProcesses = Math.max(peakProcesses, s.processes); } catch { /* ps unavailable: no sample */ }
      await new Promise(r => setTimeout(r, everyMs));
    }
  })();
  return { stop: async () => { running = false; await loop; return { peakChromium, peakNode, peakProcesses, samples }; } };
}

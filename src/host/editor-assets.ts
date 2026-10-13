import { createServer } from 'node:http';
import { sourceBuildDirectory } from '../platform/paths.ts';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A separate origin serves fixed reviewed application assets, with no session API or token. */
export async function startEditorAssets(parentOrigin: string): Promise<{ origin: string; close(): Promise<void> }> {
  const root = import.meta.url.endsWith('.ts') ? sourceBuildDirectory('engine') : fileURLToPath(new URL('../adapters/excalidraw/engine/', import.meta.url));
  const assets = new Map<string, { bytes: Buffer; mime: string }>();
  async function collect(dir: string, prefix: string): Promise<void> {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory() && !['licenses'].includes(item.name)) await collect(join(dir, item.name), prefix + item.name + '/');
      else if (item.isFile() && /\.(?:js|css|woff2)$/.test(item.name)) {
        const mime = item.name.endsWith('.js') ? 'text/javascript' : item.name.endsWith('.css') ? 'text/css' : 'font/woff2';
        assets.set(prefix + item.name, { bytes: await readFile(join(dir, item.name)), mime });
      }
    }
  }
  await collect(root, '/');
  const html = Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/editor.css"></head><body><div id="root"></div><script type="module" src="/editor.js"></script></body></html>');
  const style = Buffer.from('@import url("/engine.css");@font-face{font-family:Cascadia;src:url(/fonts/Cascadia/CascadiaCode-Regular.woff2)}html,body,#root{height:100%;margin:0}');
  assets.set('/editor.html', { bytes: html, mime: 'text/html; charset=utf-8' });
  assets.set('/editor.css', { bytes: style, mime: 'text/css' });
  if (!assets.has('/editor.js')) throw new Error('Editor bundle missing: run npm run engine:build');
  let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    // Excalidraw uses local inline geometry/styles. The parent Player keeps its strict CSP.
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob: data:; connect-src 'none'; frame-ancestors ${parentOrigin}; base-uri 'none'; form-action 'none'`);
    if (request.headers.host !== origin.slice(7) || (request.headers.origin !== undefined && request.headers.origin !== origin && request.headers.origin !== parentOrigin)) { response.writeHead(403); response.end(); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    // A target that is not a valid URL (`GET http://[`) is a client error, never an uncaught throw.
    let url: URL;
    try { url = new URL(request.url ?? '/', origin); } catch { response.writeHead(400); response.end(); return; }
    const asset = url.origin === origin && !url.search ? assets.get(url.pathname) : undefined;
    if (!asset) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': asset.mime, 'Content-Length': asset.bytes.length });
    response.end(request.method === 'HEAD' ? undefined : asset.bytes);
  });
  await new Promise<void>((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', () => { server.off('error', no); yes(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Editor listener unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, async close() { await new Promise<void>((yes, no) => { server.close(e => e ? no(e) : yes()); server.closeAllConnections(); }); } };
}

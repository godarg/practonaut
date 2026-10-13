import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, extname } from 'node:path';
import { replayGesture, projectSnapshot, validateRecording } from '../../src/adapters/excalidraw/recorder.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import type { RecordedGesture, Recording } from '../../src/adapters/excalidraw/recorder-types.ts';
import type { State } from '../../src/world/types.ts';

/** Self-created CC0 scene, no personal data and no import of a hand-written world/rule. */
const scene: State = { objects: {
  f: { id: 'f', type: 'frame', name: 'Recorder probe', deleted: false },
  a: { id: 'a', type: 'step', frameId: 'f', label: 'One', x: 350, y: 300, width: 180, height: 100, fontFamily: 3, deleted: false },
  b: { id: 'b', type: 'step', frameId: 'f', label: 'Two', x: 700, y: 300, width: 180, height: 100, fontFamily: 3, deleted: false },
  ab: { id: 'ab', type: 'arrow', frameId: 'f', from: 'a', to: 'b', deleted: false },
} };

test('scripted real Excalidraw Delete recorded passively three times, including detached arrow observation', { timeout: 60000 }, async () => {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'pn-recorder-ui-'));
  const source = `import React from 'react';import{createRoot}from'react-dom/client';import{Excalidraw,restoreElements,CaptureUpdateAction}from'@excalidraw/excalidraw';import'@excalidraw/excalidraw/index.css';import{createGestureRecorder}from${JSON.stringify(resolve('src/adapters/excalidraw/recorder.ts'))};window.EXCALIDRAW_ASSET_PATH='/';const recorder=createGestureRecorder();window.__test={recorder,api:null,async seed(raw){await document.fonts.load('20px Cascadia');await document.fonts.ready;this.api.updateScene({elements:restoreElements(raw,null,{repairBindings:true,refreshDimensions:true}),captureUpdate:CaptureUpdateAction.NEVER,appState:{scrollX:0,scrollY:0,currentItemFontFamily:3}});await new Promise(r=>setTimeout(r,250));recorder.start(this.api.getSceneElementsIncludingDeleted(),true)},read(){return{initial:recorder.initial,gestures:recorder.gestures}}};document.addEventListener('pointerup',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>recorder.boundary('pointerup'))));document.addEventListener('keyup',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>recorder.boundary('key'))));createRoot(document.getElementById('root')).render(React.createElement(Excalidraw,{excalidrawAPI:api=>window.__test.api=api,onChange:elements=>recorder.observe(elements),initialData:{appState:{currentItemFontFamily:3}}}));`;
  await build({ stdin: { contents: source, resolveDir: resolve('.'), sourcefile: 'recorder-probe.jsx' }, outdir: scratch, entryNames: 'probe', bundle: true, splitting: true, format: 'esm', conditions: ['production'], minify: true, loader: { '.woff2': 'file' }, define: { 'process.env.NODE_ENV': '"production"' } });
  const browser = await chromium.launch({ headless: true });
  const runs: RecordedGesture[][] = [];
  try {
    for (let repetition = 0; repetition < 3; repetition++) {
      const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' }), requests: string[] = [];
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://recorder.invalid' || url.pathname.includes('..')) { requests.push(url.href); await route.abort(); return; }
        if (url.pathname === '/') { await route.fulfill({ body: '<html><head><link rel="stylesheet" href="/probe.css"><style>@font-face{font-family:Cascadia;src:url(/fonts/Cascadia/CascadiaCode-Regular.woff2)}html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/probe.js"></script></body></html>', contentType: 'text/html' }); return; }
        const base = url.pathname.startsWith('/fonts/') ? resolve('.local/engine') : scratch;
        try { const body = await readFile(join(base, url.pathname.slice(1))); await route.fulfill({ body, contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' } as Record<string, string>)[extname(url.pathname)] ?? 'application/octet-stream' }); }
        catch { requests.push(url.href); await route.abort(); }
      });
      const page = await context.newPage(); await page.goto('http://recorder.invalid'); await page.waitForFunction('window.__test?.api');
      await page.evaluate('window.__test.seed(' + JSON.stringify(toRaw(scene)) + ')');
      await page.mouse.click(790, 350); await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await page.keyboard.press('Delete');
      await page.waitForFunction('window.__test.read().gestures.some(g=>g.events.some(e=>e.kind==="set"&&e.id==="b"&&e.field==="isDeleted"&&e.after===true))');
      await page.evaluate('window.__test.recorder.stop()');
      const recorded = await page.evaluate('window.__test.read()') as Pick<Recording, 'initial' | 'gestures'>;
      for (const g of recorded.gestures) replayGesture(g);
      const deletion = recorded.gestures.find(g => g.events.some(e => e.kind === 'set' && e.id === 'b' && e.field === 'isDeleted'))!;
      // The expectation is native read-back from an actual Delete key, never predicted effects.
      assert.ok(deletion.events.some(e => e.kind === 'set' && e.id === 'ab' && e.field === 'end' && e.before === 'b' && e.after === null));
      assert.equal(deletion.quarantined, false); assert.equal(deletion.unmodeled.length, 0);
      const projection = projectSnapshot(deletion.after); assert.equal(projection.ok, true); if (projection.ok) assert.equal(projection.state.objects.b!.deleted, true);
      validateRecording({ manifest: { schema: 'practonaut.recording/1', id: 'scripted-' + repetition, createdAt: '2026-10-04T12:00:00.000Z', stoppedAt: '2026-10-04T12:00:01.000Z', appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: 'excalidraw-gesture-v1', author: 'Practonaut scripted recorder probe', license: 'CC0-1.0', consent: 'Self-created non-personal scripted scene', demonstration: 'scripted', status: 'review' }, ...recorded });
      runs.push(recorded.gestures); assert.deepEqual(requests, []); await context.close();
    }
    assert.deepEqual(runs[0], runs[1]); assert.deepEqual(runs[1], runs[2]);
  } finally { await browser.close(); await rm(scratch, { recursive: true, force: true }); }
});

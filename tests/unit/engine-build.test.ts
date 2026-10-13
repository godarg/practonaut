import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { applySourcePatches, buildEngine, themeBindings } from '../../tools/build-engine.ts';

// Offline promise: the shipped engine never loads code or fonts from a public CDN.
const CDN = /unpkg\.com|esm\.sh|jsdelivr/;

async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await files(path)); else out.push(path);
  }
  return out;
}

test('the built engine bundle contains no unpkg/esm.sh/jsdelivr URL', { timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pn-engine-'));
  try {
    const output = join(root, 'engine');
    await buildEngine(output);
    const all = await files(output);
    const code = all.filter(path => /\.(js|css|html)$/.test(path));
    assert.ok(code.some(path => path.endsWith(sep + 'engine.js')) && code.some(path => path.endsWith(sep + 'editor.js')));
    const offenders: string[] = [];
    for (const path of code) if (CDN.test(await readFile(path, 'utf8'))) offenders.push(path);
    assert.deepEqual(offenders, []);
    // Local fonts and notices travel with the bundle.
    assert.ok((await stat(join(output, 'fonts/Cascadia/CascadiaCode-Regular.woff2'))).size > 0);
    assert.ok((await stat(join(output, 'LICENSES.json'))).size > 0);
    assert.ok(all.some(path => path.includes('/licenses/')));
    // The Mermaid converter is the local stub, the More-tools entry is hidden.
    const css = await readFile(join(output, 'engine.css'), 'utf8');
    assert.match(css, /toolbar-laser.{0,40}~.{0,40}toolbar-embeddable/);
    assert.ok(all.some(path => /converter-unavailable-[A-Z0-9]+\.js$/.test(path)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('source patches are name-based and count their matches', () => {
  const upstream = 'a(){return r.push(new URL(n,jn.ASSETS_FALLBACK_URL)),r}P(jn,"ASSETS_FALLBACK_URL",`https://esm.sh/${M.PKG_NAME?`${M.PKG_NAME}@${M.PKG_VERSION}`:"@excalidraw/excalidraw"}/dist/prod/`);'
    + "x={VITE_APP_FIREBASE_CONFIG:'{\"apiKey\":\"k\"}'}"
    + 'Wa(kv,{className:c,labelledBy:"dialog-title",maxWidth:nk(e.size),children:ik(Qe,{ref:t,children:[e.title&&Wa("h2",{id:`${n}-dialog-title`})]})})';
  const { text, counts } = applySourcePatches(upstream);
  assert.equal(CDN.test(text), false);
  assert.match(text, /return r\}/);
  assert.match(text, /VITE_APP_FIREBASE_CONFIG:'\{\}'/);
  assert.match(text, /labelledBy:e\.title\?`\$\{n\}-dialog-title`:"dialog-title",maxWidth/);
  assert.deepEqual([...counts.values()], [1, 1, 1, 1]);
  // Different minified names still match.
  assert.equal(applySourcePatches('return q.push(new URL(z,Ab.ASSETS_FALLBACK_URL)),q').counts.get('font-cdn-fallback'), 1);
  assert.deepEqual([...applySourcePatches('unrelated').counts.values()], [0, 0, 0, 0]);
});

test('native overlay theme bindings are resolved from design tokens by name', async () => {
  const css = themeBindings(await readFile('design/tokens.css', 'utf8'));
  assert.match(css, /--_pn-native-space:[^;]+;/);
  assert.match(css, /--_pn-native-chart-paper:[^;]+;/);
  assert.throws(() => themeBindings(':root { --pn-other: 1px; }'), /selector missing|missing/);
});

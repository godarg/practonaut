// Builds the browser bundle of the real Excalidraw engine (engine + editor entry points).
//
// Plain esbuild plus a few name-based patches to the installed, lock-pinned
// @excalidraw/excalidraw package. Each patch is located by a pattern, never by a
// byte offset or a file hash, and must match exactly once across the whole input
// graph; otherwise the build fails. The only supply-chain pin is `npm ci` with
// package-lock.json.
//
// Patches (offline promise: the bundle never fetches code or fonts from a CDN):
//   font-cdn-fallback   remove the unconditional esm.sh font fallback URL push
//   font-cdn-constant   empty the esm.sh ASSETS_FALLBACK_URL constant itself
//   firebase-config     empty the inert public Firebase configuration
//   dialog-accessible-name  point native dialogs' aria-labelledby at their visible title (upstream bug)
//   mermaid converter   @excalidraw/mermaid-to-excalidraw resolves to a local stub
//                       (PADR-0025); the More-tools entry is hidden by native-overlay.css
//   theme bindings      native-overlay.css receives design-token values by token name
//
// License notices are generated into the output (licenses/, LICENSES.json); they are
// not verified as a build gate.
import { build, type Metafile, type Plugin } from 'esbuild';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertAssetsPresent } from '../src/adapters/excalidraw/asset-integrity.ts';

const ASSETS = 'src/adapters/excalidraw/assets';
const CONVERTER_SPECIFIER = '@excalidraw/mermaid-to-excalidraw';
const CONVERTER_STUB = 'src/adapters/excalidraw/converter-unavailable.js';
const OVERLAY_CSS = 'src/adapters/excalidraw/native-overlay.css';
const THEME_MARKER = '/* @pn-native-theme-bindings */';

export interface SourcePatch { id: string; pattern: RegExp; replacement: string }

/** Name-based patches applied to the installed Excalidraw production sources. */
export const SOURCE_PATCHES: readonly SourcePatch[] = [
  { id: 'font-cdn-fallback', pattern: /return (\w+)\.push\(new URL\((\w+),(\w+)\.ASSETS_FALLBACK_URL\)\),\1/g, replacement: 'return $1' },
  { id: 'font-cdn-constant', pattern: /"ASSETS_FALLBACK_URL",`https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/`/g, replacement: '"ASSETS_FALLBACK_URL",""' },
  { id: 'firebase-config', pattern: /VITE_APP_FIREBASE_CONFIG:'(?:[^'\\]|\\.)*'/g, replacement: "VITE_APP_FIREBASE_CONFIG:'{}'" },
  // Upstream Dialog labels its modal with the fixed id "dialog-title" while the visible <h2> gets
  // `${id}-dialog-title`, so every titled native dialog (e.g. the spreadsheet paste dialog) has no
  // accessible name. Point aria-labelledby at the real heading when there is a title.
  { id: 'dialog-accessible-name', pattern: /labelledBy:"dialog-title"(,maxWidth:[^]{0,600}?children:\[(\w+)\.title&&\w+\("h2",\{id:`\$\{(\w+)\}-dialog-title`)/g, replacement: 'labelledBy:$2.title?`$${$3}-dialog-title`:"dialog-title"$1' },
];

/** Apply every patch to one source text; returns the text and the per-patch match counts. */
export function applySourcePatches(text: string, patches: readonly SourcePatch[] = SOURCE_PATCHES): { text: string; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  for (const patch of patches) {
    const matches = text.match(patch.pattern)?.length ?? 0;
    counts.set(patch.id, matches);
    if (matches) text = text.replace(patch.pattern, patch.replacement);
  }
  return { text, counts };
}

/** Extract `--pn-*` declarations of one selector block from design/tokens.css (by name). */
export function tokenBlock(tokens: string, selector: string): Record<string, string> {
  const from = tokens.indexOf(selector);
  if (from < 0) throw new Error(`design token selector missing: ${selector}`);
  const open = tokens.indexOf('{', from), end = tokens.indexOf('}', open);
  return Object.fromEntries([...tokens.slice(open + 1, end).matchAll(/(--pn-[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1]!, m[2]!.trim()]));
}

/** CSS custom properties the native overlay skin reads, resolved from the design tokens. */
export function themeBindings(tokens: string): string {
  const common = tokenBlock(tokens, ':root {'), light = tokenBlock(tokens, ':root[data-theme="light"]');
  const space = common['--pn-space-2'], paper = light['--pn-color-surface'];
  if (!space || !paper) throw new Error('design tokens --pn-space-2 / light --pn-color-surface missing');
  return `.excalidraw .Modal.Dialog.PasteChartDialog{--_pn-native-space:${space};}`
    + `.excalidraw .Modal.Dialog.PasteChartDialog .ChartPreview{--_pn-native-chart-paper:${paper};}`;
}

function enginePlugins(counts: Map<string, number>): Plugin[] {
  const add = (more: Map<string, number>) => { for (const [id, n] of more) counts.set(id, (counts.get(id) ?? 0) + n); };
  return [{
    name: 'practonaut-engine',
    setup(builder) {
      builder.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, () => ({ path: resolve(CONVERTER_STUB) }));
      builder.onLoad({ filter: /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/][^\\/]+\.js$/ }, async args => {
        const patched = applySourcePatches(await readFile(args.path, 'utf8'));
        add(patched.counts);
        return { contents: patched.text, loader: 'js', resolveDir: dirname(args.path) };
      });
      builder.onLoad({ filter: /native-overlay\.css$/ }, async args => {
        const skin = await readFile(args.path, 'utf8');
        if (skin.split(THEME_MARKER).length !== 2) throw new Error(`${OVERLAY_CSS}: theme marker must occur exactly once`);
        add(new Map([['theme-bindings', 1]]));
        return { contents: skin.replace(THEME_MARKER, themeBindings(await readFile('design/tokens.css', 'utf8'))), loader: 'css' };
      });
    },
  }];
}

/** Package directories (node_modules/...) that contribute bytes to the output. */
function bundledPackages(meta: Metafile): string[] {
  const packages = new Set<string>();
  for (const output of Object.values(meta.outputs)) for (const [input, info] of Object.entries(output.inputs)) {
    if (!info.bytesInOutput) continue;
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match) packages.add(match[1]!);
  }
  return [...packages].sort();
}

/** Write third-party notices next to the bundle. Missing notices are reported, not fatal. */
async function writeNotices(meta: Metafile, staging: string): Promise<string[]> {
  const notices = new Map<string, string>(), missing: string[] = [];
  for (const packagePath of bundledPackages(meta)) {
    const { name, version } = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8')) as { name: string; version: string };
    const license = (await readdir(packagePath)).find(file => /^(licen[sc]e|copying)(\.(md|txt))?$/i.test(file));
    const fallback = resolve(ASSETS, 'licenses', (name.startsWith('@radix-ui/') ? 'radix' : name.replace(/[/@]/g, '_')) + '.txt');
    const source = license ? join(packagePath, license) : existsSync(fallback) ? fallback : undefined;
    if (!source) { missing.push(name); continue; }
    const section = `Package: ${name}@${version}\nInstalled path: ${packagePath}\n\n${await readFile(source, 'utf8')}`;
    notices.set(name, notices.has(name) ? `${notices.get(name)}\n\n-----\n\n${section}` : section);
  }
  await mkdir(join(staging, 'licenses'), { recursive: true });
  for (const [name, body] of notices) await writeFile(join(staging, 'licenses', name.replace(/[/@]/g, '_') + '.txt'), body);
  // Components embedded inside upstream prebundles (HarfBuzz, fonteditor-core, ...).
  for (const file of await readdir(resolve(ASSETS, 'licenses'))) if (file.startsWith('embedded-')) await cp(resolve(ASSETS, 'licenses', file), join(staging, 'licenses', file));
  await writeFile(join(staging, 'third-party-packages.json'), JSON.stringify([...notices.keys()].sort(), null, 2) + '\n');
  return missing;
}

export async function buildEngine(output: string): Promise<{ output: string; files: number; bytes: number }> {
  output = resolve(output);
  const assets = await assertAssetsPresent(resolve(ASSETS));
  const counts = new Map<string, number>();
  const result = await build({
    entryPoints: { engine: 'src/adapters/excalidraw/engine-browser.jsx', editor: 'src/adapters/excalidraw/editor-browser.jsx' },
    bundle: true, conditions: ['production'], format: 'esm', splitting: true, outdir: output,
    entryNames: '[name]', assetNames: 'assets/[name]-[hash]', minify: true, legalComments: 'external',
    metafile: true, write: false, loader: { '.woff2': 'file' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: enginePlugins(counts), logLevel: 'warning',
  });
  for (const id of [...SOURCE_PATCHES.map(p => p.id), 'theme-bindings']) {
    if (counts.get(id) !== 1) throw new Error(`engine patch ${id} matched ${counts.get(id) ?? 0} times (expected exactly 1); check the installed @excalidraw/excalidraw version`);
  }
  if (!Object.values(result.metafile.outputs).some(o => o.inputs[CONVERTER_STUB])) throw new Error(`${CONVERTER_SPECIFIER} was not replaced by ${CONVERTER_STUB}`);

  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), '.engine-stage-'));
  try {
    for (const file of result.outputFiles) {
      const path = relative(output, file.path);
      if (path.startsWith('..')) throw new Error(`unsafe build output path ${path}`);
      await mkdir(dirname(join(staging, path)), { recursive: true });
      await writeFile(join(staging, path), file.contents);
    }
    await cp(resolve(ASSETS, 'fonts'), join(staging, 'fonts'), { recursive: true });
    await writeFile(join(staging, 'LICENSES.json'), JSON.stringify(assets.inventory, null, 2) + '\n');
    const missing = await writeNotices(result.metafile, staging);
    if (missing.length) console.warn(`engine:build: no license notice found for ${missing.join(', ')}`);
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return { output: relative(process.cwd(), output), files: result.outputFiles.length, bytes: result.outputFiles.reduce((n, f) => n + f.contents.length, 0) };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  console.log(JSON.stringify(await buildEngine(process.argv.includes('--dist') ? 'dist/adapters/excalidraw/engine' : '.local/engine')));
}

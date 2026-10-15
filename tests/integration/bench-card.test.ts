// report --card and --badge through the CLI (roadmap 0.2.0, Should 6): the card as SVG and PNG, light
// and dark, drawn by the local headless Chromium (PADR-0032); the same report gives the same bytes in
// two separate renders, PNGs included; the PNG is 1280 × 640; without Chromium the card is refused by
// name and nothing is written, while the badge needs no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type LaunchOptions } from 'playwright-core';
import { CARD_URL, renderCardPngs } from '../../src/bench/card-png.ts';
import { renderBadge, renderCard } from '../../src/bench/card.ts';
import { validateBenchReport } from '../../src/bench/report.ts';
import { launchBrowser } from '../support/browser.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const REPORT = fileURLToPath(new URL('../fixtures/ci-recipe/baseline.json', import.meta.url));
const FILES = ['card-light.svg', 'card-dark.svg', 'card-light.png', 'card-dark.png', 'badge.svg'];
const practonaut = (args: string[], env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });

/** Width and height from a PNG's IHDR chunk (PNG specification, section 11.2.2). */
function pngSize(bytes: Buffer): { width: number; height: number } {
  assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  assert.equal(bytes.subarray(12, 16).toString('latin1'), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('the same report gives the same card and badge bytes, PNGs included, in two separate renders', { timeout: 180_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-card-'));
  try {
    for (const language of ['en', 'de']) {
      const renders: Buffer[][] = [];
      for (const attempt of ['a', 'b']) {
        const out = join(dir, `${language}-${attempt}`); await mkdir(out);
        // The second render names an existing folder: the files go inside it as card-light.svg ….
        const result = practonaut(['--lang', language, 'report', REPORT, '--card', attempt === 'a' ? join(out, 'card.svg') : out, '--badge', join(out, 'badge.svg')]);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, language === 'en' ? /^Card: .*card-light\.svg, .*card-dark\.svg, .*card-light\.png, .*card-dark\.png$/m : /^Karte: /m);
        assert.deepEqual((await readdir(out)).sort(), [...FILES].sort());
        renders.push(await Promise.all(FILES.map(file => readFile(join(out, file)))));
      }
      FILES.forEach((file, index) => assert.ok(renders[0]![index]!.equals(renders[1]![index]!), `${language} ${file} differs between two renders`));
      const [lightSvg, darkSvg, lightPng, darkPng] = renders[0]!;
      for (const png of [lightPng!, darkPng!]) assert.deepEqual(pngSize(png), { width: 1280, height: 640 });
      assert.equal(lightPng!.equals(darkPng!), false, 'light and dark differ');
      // A drawn card, not an empty page: a blank 1280 × 640 PNG compresses to a few kilobytes.
      assert.ok(lightPng!.length > 20_000 && darkPng!.length > 20_000, `${lightPng!.length} / ${darkPng!.length} bytes`);
      assert.match(lightSvg!.toString('utf8'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1280" height="640" /);
      assert.equal(lightSvg!.equals(darkSvg!), false);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('without Chromium, --card is refused by name and writes nothing; --badge needs no browser', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-card-none-'));
  try {
    await mkdir(join(dir, 'browsers')); await mkdir(join(dir, 'out'));
    // Playwright looks for its browsers here: an empty folder is a machine where `setup` never ran.
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(dir, 'browsers') };
    const card = practonaut(['report', REPORT, '--card', join(dir, 'out', 'card')], env);
    assert.equal(card.status, 3, card.stderr);
    assert.match(card.stderr, /--card draws the card's PNG with it.*\[browser_runtime_missing\]/s);
    assert.deepEqual(await readdir(join(dir, 'out')), []);
    // With --json the result line comes only after every file is written: a failed card is ok:false.
    const json = practonaut(['report', REPORT, '--json', '--badge', join(dir, 'out', 'first.svg'), '--card', join(dir, 'out', 'card')], env);
    assert.equal(json.status, 3);
    assert.equal(json.stdout, '', 'no ok:true before the card failed');
    assert.equal((JSON.parse(json.stderr) as { ok: boolean; error: { code: string } }).error.code, 'browser_runtime_missing');
    const badge = practonaut(['report', REPORT, '--json', '--badge', join(dir, 'out', 'badge.svg')], env);
    assert.equal(badge.status, 0, badge.stderr);
    assert.equal((JSON.parse(badge.stdout) as { ok: boolean }).ok, true);
    assert.deepEqual((await readdir(join(dir, 'out'))).sort(), ['badge.svg']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the PNG is drawn with JavaScript off and every request but the card blocked by the page', { timeout: 120_000 }, async () => {
  const hits: string[] = [];
  const server = createServer((request, response) => { hits.push(request.url ?? ''); response.writeHead(200); response.end(''); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // A hostile "card": an external image, a stylesheet @import, a web font, and a script that paints the
  // whole picture red and fetches.
  const probe = (script: boolean): string => `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640"><style>@import url("${origin}/import.css"); @font-face{font-family:probe;src:url("${origin}/font.woff")} .t{font-family:probe} .bg{fill:#ffffff}</style>`
    + `<rect id="paint" class="bg" width="1280" height="640"/><image href="${origin}/image.png" width="10" height="10"/><text class="t" x="10" y="50">probe</text>`
    + (script ? `<script>document.getElementById('paint').setAttribute('style','fill:#ff0000');fetch('${origin}/script');</script>` : '') + '</svg>';
  // The browser renderCardPngs launches, observed: every request each of its pages makes and how it ended.
  const seen: Array<{ url: string; failure: string | null }> = [];
  const observed = { launch: async (options?: LaunchOptions): Promise<Browser> => {
    const browser = await chromium.launch(options), newContext = browser.newContext.bind(browser);
    browser.newContext = async (...args: Parameters<Browser['newContext']>): Promise<BrowserContext> => {
      const context = await newContext(...args);
      context.on('requestfailed', request => seen.push({ url: request.url(), failure: request.failure()?.errorText ?? null }));
      context.on('requestfinished', request => seen.push({ url: request.url(), failure: null }));
      return context;
    };
    return browser;
  } };
  const browser = await launchBrowser({ headless: true });
  try {
    const { pngs: [withScript, withoutScript] } = await renderCardPngs([probe(true), probe(false)], { chromium: observed });
    assert.deepEqual(hits, [], 'the local server got no request');
    const others = seen.filter(entry => entry.url !== CARD_URL);
    assert.ok(others.length >= 3, `the probe asked for its resources: ${JSON.stringify(seen)}`);
    // Blocked by the page's own route, before the request left the browser.
    for (const entry of others) assert.match(entry.failure ?? '', /^net::ERR_BLOCKED_BY_CLIENT/, entry.url);
    assert.ok(seen.some(entry => entry.url === CARD_URL && entry.failure === null));
    // No script ran: the picture is the same as without the script.
    assert.ok(withScript!.equals(withoutScript!), 'the script changed the picture');
    // Control: the same card with JavaScript on is painted red, so the comparison above can see a script.
    const context = await browser.newContext({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
    await context.route('**/*', route => route.request().url() === CARD_URL ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: probe(true) }) : route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.goto(CARD_URL);
    assert.equal(await page.evaluate(() => document.getElementById('paint')?.getAttribute('style')), 'fill:#ff0000');
    assert.equal((await page.screenshot({ type: 'png' })).equals(withScript!), false);
  } finally { await browser.close(); server.close(); }
});

test('every line of the card stays in its column and the badge text in its chip, in the system font and in a wide fallback font', { timeout: 180_000 }, async () => {
  const base = JSON.parse(readFileSync(REPORT, 'utf8')) as Record<string, any>;
  // Control and bidi characters are drawn as \u{…} escapes, eight characters each.
  const hostile = structuredClone(base);
  hostile.label = `${'\u0007'.repeat(40)} ${'‮'.repeat(40)} end`;
  hostile.environment.world.worldId = `${'‮'.repeat(30)}x`;
  // A command template with a long self-reported model: the facts column at its fullest.
  const template = structuredClone(base);
  template.label = 'Monatsabschluss Kreditorenbuchhaltung: Rechnungseingangsprüfung und Zahlungsfreigabeverfahrensdokumentation';
  template.agent = { kind: 'command', name: 'generic', command: ['my-agent', '{mcp_config}'], isolation: 'template-unrestricted', model: 'claude-opus-5-5-20261001-extended-thinking-preview-variant', modelSource: 'command-output', apiKeySource: null, keptEnv: [] };
  // Only Practonaut's own client measures its round trip: a template's call log has no client timing.
  for (const run of template.runs) if (run.logs?.calls) run.logs.calls.clientTiming = false;
  const reports = [validateBenchReport(hostile), validateBenchReport(template), validateBenchReport(base)];
  const tokens = readFileSync(new URL('../../design/tokens.css', import.meta.url), 'utf8');
  // The reader's system font, and a wide one forced over it: Verdana where installed (macOS, Windows),
  // else DejaVu Sans (the default sans on Ubuntu).
  const fonts = { system: '', wide: '<style>svg text, svg tspan { font-family: Verdana, "DejaVu Sans", sans-serif !important; }</style>' };
  const left = new Set(['card-fraction', 'card-fraction-compact', 'card-words', 'card-interval', 'card-sample', 'card-rule-text']);
  const browser = await launchBrowser({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
    for (const [font, style] of Object.entries(fonts)) for (const value of reports) for (const language of ['en', 'de'] as const) for (const verification of ['consistency-checked', 're-verified'] as const) {
      await page.setContent(`<!doctype html><head>${style}</head><body style="margin:0">${renderCard(value, tokens, 'light', language, verification)}</body>`);
      // Edges of every text in the card's own units (800 × 400, drawn at 1280 × 640).
      const edges = await page.evaluate(() => {
        const svg = document.querySelector('svg')!, box = svg.getBoundingClientRect(), scale = 800 / box.width;
        return [...svg.querySelectorAll('text')].map(text => { const rect = text.getBoundingClientRect(); return { cls: text.getAttribute('class') ?? '', text: text.textContent ?? '', right: (rect.right - box.left) * scale, bottom: (rect.bottom - box.top) * scale }; });
      });
      const where = `${font} font, ${language}, ${verification}`;
      for (const edge of edges) {
        // The content area ends at 768 (32 units of margin); the left column at 32 + 0.47 × (736 − 32) ≈ 362.9.
        assert.ok(edge.right <= (left.has(edge.cls) ? 362.9 : 768) + 0.5, `${where}: ${edge.cls} ends at ${edge.right.toFixed(1)}: ${edge.text.slice(0, 60)}`);
        assert.ok(edge.bottom <= 400, `${where}: ${edge.cls} reaches ${edge.bottom.toFixed(1)}`);
      }
      if (value === reports[0]) assert.ok(edges.some(edge => edge.cls === 'card-label' && edge.text.endsWith('…')), 'the long label is cut with an ellipsis');
    }
    for (const [font, style] of Object.entries(fonts)) for (const value of reports) for (const language of ['en', 'de'] as const) {
      await page.setContent(`<!doctype html><head>${style}</head><body style="margin:0">${renderBadge(value, tokens, language)}</body>`);
      const fit = await page.evaluate(() => {
        const chip = document.querySelector('rect')!.getBoundingClientRect(), text = document.querySelector('text')!.getBoundingClientRect();
        return { left: text.left - chip.left, right: chip.right - text.right };
      });
      assert.ok(fit.left >= 0 && fit.right >= 0, `badge (${font} font, ${language}): the text leaves its chip by ${Math.min(fit.left, fit.right).toFixed(1)}`);
    }
  } finally { await browser.close(); }
});

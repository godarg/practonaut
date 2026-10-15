// report --card and --badge through the CLI (roadmap 0.2.0, Should 6): the card as SVG and PNG, light
// and dark, drawn by the local headless Chromium (PADR-0032); the same report gives the same bytes in
// two separate renders, PNGs included; the PNG is 1280 × 640; without Chromium the card is refused by
// name and nothing is written, while the badge needs no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
        const result = practonaut(['--lang', language, 'report', REPORT, '--card', join(out, 'card.svg'), '--badge', join(out, 'badge.svg')]);
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
    const badge = practonaut(['report', REPORT, '--badge', join(dir, 'out', 'badge.svg')], env);
    assert.equal(badge.status, 0, badge.stderr);
    assert.deepEqual(await readdir(join(dir, 'out')), ['badge.svg']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

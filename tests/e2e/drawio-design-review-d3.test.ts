// Design review D3 of the draw.io surfaces (commit 4d36d07): each minor as a rendered check that failed
// there. The Player runs a mirrored draw.io session (the real draw.io where draw.war is installed for the
// tests, else the stand-in); the report is the committed draw.io evidence as `report --html` writes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium, type Page } from 'playwright';
import { DRAWIO_STATES, setLanguage, startDrawioPlayer } from '../support/player-states.ts';
import { reportPage } from '../support/report-states.ts';
import { validateBenchReportV3, type SessionReportV3 } from '../../src/bench/report.ts';

const state = (id: string) => DRAWIO_STATES.find(entry => entry.id === id)!;
/** The colour the page shows at one CSS pixel, as rendered (masks and fades included): a 1 x 1 PNG. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  const parts: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at), type = png.toString('latin1', at + 4, at + 8);
    if (type === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  // One pixel in one row: whatever the row's filter, its bytes are the pixel's own.
  const row = inflateSync(Buffer.concat(parts));
  return [row[1]!, row[2]!, row[3]!];
}
const distance = (a: number[], b: number[]): number => Math.max(...a.map((value, index) => Math.abs(value - b[index]!)));

test('D3-F1: in dark mode at 320 the frame of draw.io\'s picture keeps its right hairline and its ground where the picture fades', { timeout: 240_000 }, async () => {
  const directory = resolve('docs/benchmarks/drawio/drawio-oracle');
  const report = validateBenchReportV3(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'))) as SessionReportV3;
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-review-d3-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const file = join(dir, 'report.en.html'); writeFileSync(file, await reportPage({ report, directory }, 'en'));
    const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 320, height: 900 } });
    await context.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
    const page = await context.newPage(); await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => { for (const details of document.querySelectorAll('details')) details.open = true; });
    const count = await page.locator('svg.engine-board--drawio').count();
    assert.equal(count, 48);
    let checked = 0;
    for (let index = 0; index < count; index += 8) {
      const svg = page.locator('svg.engine-board--drawio').nth(index);
      // The frame around the picture: draw.io's ground (or, before, the scroller itself).
      const box = await svg.evaluate(node => {
        const frame = (node.closest('.board-picture') ?? node.closest('.board-scroll')) as HTMLElement, scroller = node.closest('.board-scroll') as HTMLElement;
        frame.scrollIntoView({ block: 'center' });
        const rect = frame.getBoundingClientRect();
        return { right: rect.right, middle: rect.top + rect.height / 2, scrolls: scroller.scrollWidth > scroller.clientWidth + 1 };
      });
      if (!box.scrolls) continue;
      const hairline = await pixel(page, Math.floor(box.right) - 1, Math.round(box.middle)), outside = await pixel(page, Math.floor(box.right) + 3, Math.round(box.middle));
      const ground = await pixel(page, Math.floor(box.right) - 5, Math.round(box.middle));
      assert.ok(distance(hairline, outside) > 8, `#${index}: the right hairline shows (${hairline} beside ${outside})`);
      assert.ok(Math.min(...ground) >= 235, `#${index}: 4 px inside the hairline is the picture ground (${ground})`);
      checked++;
    }
    assert.ok(checked >= 4, `${checked} scrolling pictures checked`);
    await context.close();
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D3-F2, F4: a step outside the only frame says so in words; a world without rules says so before the notice', { timeout: 240_000 }, async () => {
  const s = await startDrawioPlayer({ width: 1280, height: 900 });
  try {
    const words = {
      en: { frame: 'no frame', rules: 'This exercise’s world has no rules: an action changes only what it names, with no further consequence.' },
      de: { frame: 'ohne Rahmen', rules: 'Die Welt dieser Übung hat keine Regeln: Eine Aktion ändert nur, was sie nennt, ohne weitere Folge.' },
    } as const;
    for (const language of ['en', 'de'] as const) {
      await setLanguage(s.page, language);
      await state('drawio-constraint-refused').enter(s);
      // b left the frame: its chip and the board's accessible name say so; a, inside it, says nothing of frames.
      assert.ok((await s.page.locator('button[data-step-id="b"]').first().innerText()).includes(words[language].frame), `${language}: b's chip`);
      assert.ok((await s.page.locator('[data-testid=board] [data-object-id="b"]').first().getAttribute('aria-label') ?? '').includes(words[language].frame), `${language}: b's accessible name`);
      assert.equal((await s.page.locator('button[data-step-id="a"]').first().innerText()).includes(words[language].frame), false, `${language}: a lies in the frame`);
      await state('drawio-rules-open').enter(s);
      assert.equal(await s.page.getByTestId('rules-none').textContent(), words[language].rules, language);
      assert.deepEqual(await s.page.locator('.rule-list > *').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.testid ?? '')), ['rules-none', 'app-notice'], `${language}: the line, then the notice`);
    }
  } finally { await s.close(); }
});

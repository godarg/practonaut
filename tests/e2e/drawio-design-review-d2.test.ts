// Design review D2 of the draw.io surfaces (commit 1cb8ff3): each finding as a rendered check that failed
// there. The Player runs a mirrored draw.io session (the real draw.io where draw.war is installed for the
// tests, else the stand-in, tests/support/player-states.ts); the report is the committed draw.io
// evidence rendered as `report --html` writes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { DRAWIO_STATES, setLanguage, settle, startDrawioPlayer } from '../support/player-states.ts';
import { reportPage } from '../support/report-states.ts';
import { validateBenchReportV3, type SessionReportV3 } from '../../src/bench/report.ts';

const state = (id: string) => DRAWIO_STATES.find(entry => entry.id === id)!;
/** WCAG contrast of a computed rgb() colour against black ink. */
const againstBlack = (rgb: string): number => {
  const [r, g, b] = (rgb.match(/[0-9.]+/g) ?? []).slice(0, 3).map(Number).map(c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b! + 0.05) / 0.05;
};

test('D2-F1, F5: the group refusal names the way forward with the tools, deterministically, the step out of its frame', { timeout: 240_000 }, async () => {
  const s = await startDrawioPlayer({ width: 1280, height: 900 });
  try {
    const expected = {
      en: 'In this application all steps of a group lie in the same frame. Put the steps into one frame first, or ungroup them before you change a step’s frame. The board is unchanged.',
      de: 'In dieser Anwendung liegen alle Schritte einer Gruppe im selben Rahmen. Lege die Schritte zuerst in denselben Rahmen oder löse die Gruppe, bevor du den Rahmen eines Schritts änderst. Die Arbeitsfläche ist unverändert.',
    } as const;
    for (const language of ['en', 'de', 'en'] as const) {
      await setLanguage(s.page, language);
      await state('drawio-constraint-refused').enter(s);
      // The refusal of this round, in this round's language: waited for (bounded), so a slower runner reads
      // the notice once it is rendered; any other text still fails, and names what was shown.
      const shown = await s.page.waitForFunction(text => { const notice = document.querySelector<HTMLElement>('.notice.error'); return notice !== null && notice.innerText.includes(text); }, expected[language], { timeout: 15_000 }).then(() => null, async () => s.page.locator('.notice.error').innerText());
      assert.equal(shown, null, `${language}: the notice read ${JSON.stringify(shown)}`);
      // The same screen every time: the refused step is selected, never picked up, and nothing waits.
      assert.equal(await s.page.locator('.step.picked').count(), 0, `${language}: no step picked up`);
      assert.equal(await s.page.getByTestId('cancel-preview').first().isVisible(), false, `${language}: no pending tool`);
      const objects = (await s.observe()).state.objects as Record<string, { frameId?: string | null; y?: number; height?: number; groupId?: string | null }>;
      assert.equal(objects.b!.frameId, null, 'b left the frame');
      assert.ok(objects.b!.y! >= objects.a!.y! + objects.a!.height! + 100, 'b lies below the frame, clear of it');
      assert.deepEqual([objects.a!.groupId, objects.b!.groupId], [null, null], 'the board is unchanged');
    }
  } finally { await s.close(); }
});

test('D2-F4, F6, F7: the picture scrolls inside an unrounded region with a faded edge; Rules and origins open on the notice; a press on an unavailable workspace says why', { timeout: 240_000 }, async () => {
  const s = await startDrawioPlayer({ width: 1280, height: 900, theme: 'dark' });
  try {
    await state('drawio-real-tool').enter(s);
    const scroll = await s.page.evaluate(() => {
      const ground = document.querySelector<HTMLElement>('[data-testid=tool-picture]')!, region = ground.querySelector<HTMLElement>('[data-testid=tool-scroll]');
      return { groundRadius: parseFloat(getComputedStyle(ground).borderTopLeftRadius), padding: parseFloat(getComputedStyle(ground).paddingTop),
        region: region ? { radius: parseFloat(getComputedStyle(region).borderTopRightRadius), wider: region.scrollWidth > region.clientWidth + 1, fades: region.classList.contains('is-clipped-end'), mask: getComputedStyle(region).maskImage } : null };
    });
    assert.ok(scroll.groundRadius > 0 && scroll.padding >= 8, `ground ${JSON.stringify(scroll)}`);
    assert.ok(scroll.region, 'an inner scrolling region');
    assert.equal(scroll.region!.radius, 0, 'the region itself is not rounded, so no curve cuts the picture');
    assert.equal(scroll.region!.wider, true, 'at 1280 draw.io\'s picture is wider than the panel');
    assert.ok(scroll.region!.fades && scroll.region!.mask !== 'none', `the clipped edge fades (${scroll.region!.mask})`);
    // F6: a registered state with Rules and origins open, anchored to the notice, last in the list.
    for (const language of ['en', 'de'] as const) {
      await setLanguage(s.page, language);
      await state('drawio-rules-open').enter(s);
      assert.equal(await s.page.getByTestId('app-notice').isVisible(), true, language);
      assert.equal(await s.page.locator('.rule-list > :last-child').getAttribute('data-testid'), 'app-notice', `${language}: the notice comes last`);
    }
    // F7: pressing an unavailable segment speaks its reason.
    await setLanguage(s.page, 'en'); await settle(s.page);
    await s.page.getByTestId('mode-editor').focus(); await s.page.keyboard.press('Enter'); await settle(s.page);
    assert.equal(await s.page.getByTestId('live-announcer').textContent(), 'draw.io does not open as a workspace in Practonaut. Practice on the board.');
  } finally { await s.close(); }
});

test('D2-F2, F3: in the report draw.io\'s picture lies padded on its own ground in its frame; the scroll line shows only when a board is wider than its frame', { timeout: 240_000 }, async () => {
  const directory = resolve('docs/benchmarks/drawio/drawio-oracle');
  const report = validateBenchReportV3(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'))) as SessionReportV3;
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-review-d2-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const file = join(dir, 'report.en.html'); writeFileSync(file, await reportPage({ report, directory }, 'en'));
    for (const width of [1280, 320]) {
      const context = await browser.newContext({ colorScheme: 'dark', viewport: { width, height: 900 } });
      await context.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
      const page = await context.newPage(); await page.goto(pathToFileURL(file).href);
      await page.evaluate(() => { for (const details of document.querySelectorAll('details')) details.open = true; });
      const frames = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.board-figure')].map(figure => {
        // The frame: draw.io's ground around its scroller (review D3-F1), else the scroller itself.
        const scroller = figure.querySelector<HTMLElement>('.board-scroll')!, frame = figure.querySelector<HTMLElement>('.board-picture') ?? scroller;
        const svg = scroller.querySelector('svg')!, hint = figure.querySelector<HTMLElement>('.scroll-hint');
        const outer = frame.getBoundingClientRect(), inner = svg.getBoundingClientRect(), style = getComputedStyle(frame);
        // What lies between the frame's hairline and the picture on its top edge and beside it: the first
        // painted background from the element there outwards.
        const between = (x: number, y: number): string => {
          for (let at = document.elementFromPoint(x, y); at; at = at.parentElement) { const colour = getComputedStyle(at).backgroundColor; if (!/rgba\(.*, 0\)$/.test(colour) && colour !== 'transparent') return colour; }
          return 'none';
        };
        frame.scrollIntoView({ block: 'center' });
        const now = frame.getBoundingClientRect(), pic = svg.getBoundingClientRect();
        return {
          own: svg.classList.contains('engine-board--drawio'), ground: style.backgroundColor,
          gap: { top: inner.top - outer.top - 1, bottom: outer.bottom - inner.bottom - 1 },
          above: between(pic.left + Math.min(40, pic.width / 2), now.top + 3), beside: pic.left - now.left > 6 ? between(now.left + 3, pic.top + pic.height / 2) : null,
          wider: scroller.scrollWidth > scroller.clientWidth + 1, hint: hint ? getComputedStyle(hint).display !== 'none' : false,
        };
      }));
      const own = frames.filter(frame => frame.own);
      assert.equal(own.length, 48, `${width}: every run's final board`);
      for (const [index, frame] of own.entries()) {
        assert.ok(againstBlack(frame.ground) >= 4.5, `${width} #${index}: the frame is the picture's ground (${frame.ground})`);
        assert.ok(frame.gap.top >= 7.5 && frame.gap.bottom >= 7.5, `${width} #${index}: padded on top and bottom (${JSON.stringify(frame.gap)})`);
        for (const colour of [frame.above, frame.beside]) if (colour !== null) assert.ok(againstBlack(colour) >= 4.5, `${width} #${index}: no canvas between the ground and the frame (${colour})`);
      }
      for (const [index, frame] of frames.entries()) assert.equal(frame.hint, frame.wider, `${width} figure ${index}: the line shows exactly when the board is wider than its frame`);
      await context.close();
    }
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});

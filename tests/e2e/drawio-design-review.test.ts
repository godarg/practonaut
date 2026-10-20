// Design review D1 of the draw.io surfaces (commit 93e629e): each blocker and major as a rendered check
// that failed there. The Player runs a mirrored draw.io session (the real draw.io where draw.war is
// installed for the tests, else the stand-in, tests/support/player-states.ts); the report is the
// committed draw.io evidence rendered as `report --html` writes it.
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

/** WCAG contrast of a computed rgb() colour against black ink. */
const againstBlack = (rgb: string): number => {
  const [r, g, b] = (rgb.match(/[0-9.]+/g) ?? []).slice(0, 3).map(Number).map(c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return (0.2126 * r! + 0.7152 * g! + 0.0722 * b! + 0.05) / 0.05;
};
const NOTICE = { en: 'draw.io is a registered trademark; Practonaut is not affiliated with, endorsed or sponsored by draw.io Ltd or draw.io AG.', de: 'draw.io ist eine eingetragene Marke; Practonaut ist mit draw.io Ltd und draw.io AG nicht verbunden und wird von ihnen weder unterstützt noch gesponsert.' } as const;

test('D1-F1, F2, F3: the real tool\'s picture on a light ground in dark mode, at one px per unit, in view with the focus kept', { timeout: 240_000 }, async () => {
  const s = await startDrawioPlayer({ width: 1280, height: 900, theme: 'dark' });
  try {
    await DRAWIO_STATES.find(state => state.id === 'drawio-practice')!.enter(s);
    await s.page.getByTestId('show-tool').click();
    await s.page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('.tool-image'); return !!image && image.complete && image.naturalWidth > 0; });
    await settle(s.page);
    const seen = await s.page.evaluate(() => {
      const picture = document.querySelector<HTMLElement>('[data-testid=tool-picture]'), image = picture?.querySelector('img');
      const side = document.querySelector<HTMLElement>('.practice-inspector')!, box = picture?.getBoundingClientRect(), frame = side.getBoundingClientRect();
      return {
        ground: picture ? getComputedStyle(picture).backgroundColor : 'none',
        scale: image ? image.getBoundingClientRect().width / image.naturalWidth : 0,
        region: picture ? [picture.getAttribute('role'), picture.getAttribute('aria-label'), picture.tabIndex] : null,
        focus: (document.activeElement as HTMLElement | null)?.dataset?.testid ?? document.activeElement?.tagName,
        inView: !!box && box.top >= frame.top - 1 && box.top < frame.bottom && box.top < innerHeight,
        scrolled: side.scrollTop,
      };
    });
    // F1: draw.io's black ink on the picture's ground (it was the dark surface, 1.22:1).
    assert.ok(againstBlack(seen.ground) >= 4.5, `ground ${seen.ground}: ${againstBlack(seen.ground).toFixed(2)}:1`);
    // F2: at least one px per unit (draw.io's PNG is its export at one px per unit), in a labelled region.
    assert.ok(seen.scale >= 0.999, `the picture is drawn at ${seen.scale.toFixed(2)} px per unit`);
    assert.deepEqual(seen.region, ['region', 'draw.io’s picture at its own size', 0]);
    // F3: the focus stays on the button and the picture is in the inspector's view (it jumped to its top).
    assert.equal(seen.focus, 'show-tool');
    assert.ok(seen.inView, `the picture is out of view (inspector scrolled to ${seen.scrolled})`);
  } finally { await s.close(); }
});

test('D1-F4 and F8 in the Player: the interim notice once, under the rules disclosure; the unavailable segments reachable by keyboard', { timeout: 240_000 }, async () => {
  const s = await startDrawioPlayer({ mirror: 'off' });
  try {
    for (const language of ['en', 'de'] as const) {
      await setLanguage(s.page, language); await settle(s.page);
      assert.equal(await s.page.getByText(NOTICE[language], { exact: true }).count(), 1, language);
      assert.equal(await s.page.locator('[data-testid=how-checked] details [data-testid=app-notice]').count(), 1, `${language}: under the rules disclosure`);
      for (const mode of ['mode-editor', 'mode-author']) {
        assert.equal(await s.page.getByTestId(mode).getAttribute('aria-disabled'), 'true', mode);
        assert.equal(await s.page.getByTestId(mode).evaluate(node => (node as HTMLButtonElement).disabled), false, `${mode} is not natively disabled, so the keyboard reaches it`);
      }
      await s.page.getByTestId('mode-editor').focus(); await s.page.keyboard.press('Enter'); await settle(s.page);
      assert.equal(await s.page.evaluate(() => document.body.dataset.workspace), 'board', 'pressing it changes nothing');
    }
  } finally { await s.close(); }
});

test('D1-F4 and F5 in the report: the notice once in the closing notes; draw.io\'s picture keeps its own font and a light ground, no filter', { timeout: 240_000 }, async () => {
  const directory = resolve('docs/benchmarks/drawio/drawio-oracle');
  const report = validateBenchReportV3(JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'))) as SessionReportV3;
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-review-'));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const language of ['en', 'de'] as const) {
      const html = await reportPage({ report, directory }, language);
      assert.equal(html.replace(/<[^>]+>/g, '').split(NOTICE[language]).length - 1, 1, `${language}: the notice once`);
      const file = join(dir, `report.${language}.html`); writeFileSync(file, html);
      const context = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } });
      await context.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
      const page = await context.newPage(); await page.goto(pathToFileURL(file).href);
      await page.evaluate(() => { for (const details of document.querySelectorAll('details')) details.open = true; });
      const looks = await page.evaluate(() => {
        const board = document.querySelector<SVGSVGElement>('svg.engine-board')!, label = [...board.querySelectorAll('text')].find(text => !text.classList.contains('sch-group-label'))!;
        const mono = getComputedStyle(document.documentElement).getPropertyValue('--pn-font-mono').trim();
        return { filter: getComputedStyle(board).filter, ground: getComputedStyle(board).backgroundColor, font: getComputedStyle(label).fontFamily, attribute: label.closest('[font-family]')?.getAttribute('font-family') ?? null, mono };
      });
      assert.equal(looks.filter, 'none', `${language}: no dark-mode filter on draw.io's picture`);
      assert.ok(againstBlack(looks.ground) >= 4.5, `${language}: ground ${looks.ground}`);
      assert.notEqual(looks.font, looks.mono, `${language}: draw.io's labels keep their own font`);
      assert.ok(looks.attribute && looks.font.includes(looks.attribute.split(',')[0]!.replace(/"/g, '').trim()), `${language}: ${looks.font} is draw.io's ${looks.attribute}`);
      await context.close();
    }
  } finally { await browser.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('D1-F6(d) and F13: the constraint refusal is a registered state and says "Rahmen" in German', { timeout: 240_000 }, async () => {
  const s = await startDrawioPlayer();
  try {
    await setLanguage(s.page, 'de');
    await DRAWIO_STATES.find(state => state.id === 'drawio-constraint-refused')!.enter(s);
    assert.match(await s.page.locator('.notice.error').innerText(), /In dieser Anwendung bleibt eine Gruppe in einem Rahmen\./);
    const view = await s.observe();
    assert.equal(view.state.objects.a && 'groupId' in view.state.objects.a ? view.state.objects.a.groupId : 'missing', null, 'the board is unchanged');
  } finally { await s.close(); }
});

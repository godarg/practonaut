// PADR-0049 decisions 1.5 and 10.1 and design-language §10.1 in the Player, model-only (no draw.io
// runtime needed): a draw.io session names draw.io in English and German and nowhere Excalidraw. The
// workspace control keeps its three segments, the middle one names draw.io; it and Create are not
// offered (the workspaces embed Excalidraw) and say why, and nothing invites to Create. The mirrored
// state is checked by the draw.io conformance layer, which has the runtime; the registered draw.io
// review states are in tests/support/player-states.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAWIO_STATES, MISSING_DRAWIO, setLanguage, settle, startDrawioPlayer } from '../support/player-states.ts';

/** Every text and accessible name on the page. */
const pageTexts = (): string => {
  const attributes = [...document.querySelectorAll('[aria-label], [title], [alt], [placeholder]')].flatMap(node => ['aria-label', 'title', 'alt', 'placeholder'].map(name => node.getAttribute(name) ?? ''));
  return [document.body.textContent ?? '', ...attributes].join('\n');
};

test('a model-only draw.io session names draw.io in EN and DE, never Excalidraw, and offers the board workspace only', { timeout: 180_000 }, async () => {
  const s = await startDrawioPlayer({ taskId: 'connect', mirror: 'off', modelOnly: MISSING_DRAWIO });
  try {
    const expected = {
      en: { title: 'Not yet checked against the real draw.io', editor: 'draw.io does not open as a workspace in Practonaut. Practice on the board.', author: 'Create is not available for draw.io.' },
      de: { title: 'Noch nicht mit dem echten draw.io geprüft', editor: 'draw.io öffnet sich in Practonaut nicht als Arbeitsbereich. Übe auf der Arbeitsfläche.', author: 'Erstellen gibt es für draw.io nicht.' },
    } as const;
    for (const language of ['en', 'de'] as const) {
      await setLanguage(s.page, language); await settle(s.page);
      const banner = await s.page.getByTestId('model-only-banner').innerText();
      assert.ok(banner.includes(expected[language].title), banner);
      assert.match(banner, /npx practonaut setup --app drawio/);
      // One download of about 48 MB, the product and version on one line; the file name stays in the terminal.
      assert.match(banner, language === 'en' ? /one download of about 48\u00a0MB: draw\.io\u00a032\.4\.1\)/ : /ein Download von etwa 48\u00a0MB: draw\.io\u00a032\.4\.1\)/);
      assert.doesNotMatch(banner, /draw\.war/);
      const texts = await s.page.evaluate(pageTexts);
      assert.doesNotMatch(texts, /Excalidraw/, `${language}: ${texts.split('\n').find(line => line.includes('Excalidraw'))}`);
      // The middle segment names the session's app; it and Create are disabled and say why (label in name).
      assert.equal((await s.page.getByTestId('mode-editor').innerText()).trim(), 'draw.io');
      assert.equal(await s.page.getByTestId('mode-editor').getAttribute('aria-label'), expected[language].editor);
      assert.equal(await s.page.getByTestId('mode-author').getAttribute('aria-label'), expected[language].author);
      // Unavailable, not merely disabled: reachable by keyboard so the reason is read (design-language §10.1).
      for (const mode of ['mode-editor', 'mode-author']) assert.equal(await s.page.getByTestId(mode).getAttribute('aria-disabled'), 'true', mode);
      assert.equal(await s.page.getByTestId('create-exercise').count(), 0, 'no invitation to Create');
    }
    // The longer command wraps at its spaces: no horizontal scroll at 320 px, each word whole.
    await s.page.setViewportSize({ width: 320, height: 900 }); await settle(s.page);
    assert.equal(await s.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    assert.equal(await s.page.locator('.model-only-banner__command').innerText(), 'npx practonaut setup --app drawio');
    assert.deepEqual(await s.page.locator('.model-only-banner__word').evaluateAll(words => words.map(word => word.getClientRects().length)), [1, 1, 1, 1, 1]);
    assert.deepEqual(s.external, []);
  } finally { await s.close(); }
});

test('every registered draw.io review state is reached in a mirrored session and names no Excalidraw, EN and DE', { timeout: 300_000 }, async () => {
  // The real draw.io where draw.war is installed for the tests, else the stand-in (tests/support/player-states.ts).
  const s = await startDrawioPlayer();
  try {
    for (const language of ['en', 'de'] as const) {
      await setLanguage(s.page, language);
      for (const state of DRAWIO_STATES) {
        await state.enter(s);
        const texts = await s.page.evaluate(pageTexts);
        assert.doesNotMatch(texts, /Excalidraw/, `${language} ${state.id}: ${texts.split('\n').find(line => line.includes('Excalidraw'))}`);
      }
      assert.match(await s.page.locator('body').innerText(), language === 'en' ? /real draw\.io/ : /echten draw\.io/);
    }
    assert.deepEqual(s.external, []);
  } finally { await s.close(); }
});

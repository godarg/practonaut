// PADR-0049 decisions 1.5 and 10.1 in the Player, model-only (no draw.io runtime needed): a draw.io
// session names draw.io in English and German, nowhere Excalidraw except the editor and author
// workspace controls, which are not offered (they embed Excalidraw). The mirrored state is checked by
// the draw.io conformance layer, which has the runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorld } from '../../src/world/index.ts';
import type { ModelOnlyNotice } from '../../src/host/protocol.ts';
import { setLanguage, settle, startPlayer } from '../support/player-states.ts';

const library = JSON.parse(readFileSync('tasks/excalidraw/world/world.json', 'utf8')) as Record<string, unknown>;
const drawio = validateWorld({ ...library, id: 'drawio-player-test', app: { adapterId: 'drawio', versionRange: '32.4.1' }, provenance: { ...(library.provenance as object), appVersion: '32.4.1' } });
const MISSING_DRAWIO: ModelOnlyNotice = { reason: 'missing', command: 'npx practonaut setup --app drawio', download: { name: 'draw.io 32.4.1 (draw.war)', megabytes: 48 } };
/** Every text and accessible name on the page, except the editor and author workspace controls. */
const pageTexts = (): string => {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll('[data-testid=mode-editor], [data-testid=mode-author]')) node.remove();
  const attributes = [...clone.querySelectorAll('[aria-label], [title], [alt], [placeholder]')].flatMap(node => ['aria-label', 'title', 'alt', 'placeholder'].map(name => node.getAttribute(name) ?? ''));
  return [clone.textContent ?? '', ...attributes].join('\n');
};

test('a model-only draw.io session names draw.io in EN and DE and offers the board workspace only', { timeout: 180_000 }, async () => {
  const s = await startPlayer({ world: drawio, taskId: 'connect', mirror: 'off', phase3: false, modelOnly: MISSING_DRAWIO });
  try {
    for (const [language, title] of [['en', 'Not yet checked against the real draw.io'], ['de', 'Noch nicht mit dem echten draw.io geprüft']] as const) {
      await setLanguage(s.page, language); await settle(s.page);
      assert.match(await s.page.getByTestId('model-only-banner').innerText(), new RegExp(title.replace('.', '\\.')));
      assert.match(await s.page.getByTestId('model-only-banner').innerText(), /setup --app drawio/);
      const texts = await s.page.evaluate(pageTexts);
      assert.doesNotMatch(texts, /Excalidraw/, `${language}: ${texts.split('\n').find(line => line.includes('Excalidraw'))}`);
      for (const mode of ['mode-editor', 'mode-author']) assert.equal(await s.page.getByTestId(mode).isDisabled(), true, mode);
    }
    assert.deepEqual(s.external, []);
  } finally { await s.close(); }
});

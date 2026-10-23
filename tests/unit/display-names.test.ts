// PADR-0049 decision 1.5: every text that names the running app takes its fixed display name from the
// world's adapter id, never a literal and never world text. A draw.io session's MCP instructions, CLI
// mirror messages and Player texts name draw.io; an Excalidraw session's are unchanged; only the texts
// shown inside an Excalidraw session's editor workspace (which embeds Excalidraw) keep naming it. The
// workspace control's middle segment names the session's app (design-language §10.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_APPS, appDisplayName } from '../../src/world/apps.ts';
import { mcpInstructions, MCP_INSTRUCTIONS } from '../../src/mcp/contracts.ts';
import { appName, appNames, catalogs, workspaceApps } from '../../src/player/messages.ts';
import { ADAPTER_REGISTRY } from '../../src/adapters/registry.ts';
import { fallbackNotice, resolveMirror, type MirrorProbes } from '../../src/cli/serve.ts';
import { RuntimeError } from '../../src/cli/runtime.ts';
import { setCliLanguage } from '../../src/cli/messages.ts';
import { validateWorld } from '../../src/world/schema.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const library = JSON.parse(readFileSync(join(root, 'tasks/excalidraw/world/world.json'), 'utf8')) as Record<string, unknown>;
const drawioRaw = { ...library, id: 'drawio-names-test', app: { adapterId: 'drawio', versionRange: '32.4.1' }, provenance: { ...(library.provenance as object), appVersion: '32.4.1' } };
/** Texts an Excalidraw session shows about its embedded editor (a draw.io session gets the board only). */
const EDITOR_TEXTS = new Set(['modeEditorTitle', 'modeUnavailableEditor']);

test('the display names are the world table\'s, in both languages, and the Player keeps an equal copy', () => {
  assert.deepEqual(Object.fromEntries(Object.keys(KNOWN_APPS).map(id => [id, { en: appDisplayName(id, 'en'), de: appDisplayName(id, 'de') }])), { excalidraw: { en: 'Excalidraw', de: 'Excalidraw' }, drawio: { en: 'draw.io', de: 'draw.io' } });
  assert.deepEqual(JSON.parse(JSON.stringify(appNames)), Object.fromEntries(Object.keys(KNOWN_APPS).map(id => [id, { en: appDisplayName(id, 'en'), de: appDisplayName(id, 'de') }])));
});

test('MCP instructions name the session\'s app; Excalidraw\'s are unchanged; without a host reply none is named', () => {
  assert.equal(MCP_INSTRUCTIONS, mcpInstructions('excalidraw'));
  assert.ok(MCP_INSTRUCTIONS.startsWith('Practonaut is a practice session on a real app (a diagram in Excalidraw). Workflow: observe to read the task'));
  const drawio = mcpInstructions('drawio');
  assert.ok(drawio.startsWith('Practonaut is a practice session on a real app (a diagram in draw.io). Workflow:'));
  assert.doesNotMatch(drawio, /Excalidraw/);
  assert.equal(drawio.replace('draw.io', 'Excalidraw'), MCP_INSTRUCTIONS, 'only the name differs');
  assert.ok(mcpInstructions().startsWith('Practonaut is a practice session on a real app. Workflow:'));
});

test('Player texts filled for a draw.io session name no Excalidraw outside the editor workspace; Excalidraw\'s fill gives the old wording', () => {
  for (const language of ['en', 'de'] as const) {
    for (const [key, text] of Object.entries(catalogs[language])) {
      const filled = text.replaceAll('{app}', appName('drawio', language));
      if (!EDITOR_TEXTS.has(key)) assert.doesNotMatch(filled, /Excalidraw/, `${language}.${key}`);
    }
  }
  // Old wording, written out: the fill restores it exactly.
  assert.equal(catalogs.en.modelOnlyTitle.replaceAll('{app}', appName('excalidraw', 'en')), 'Not yet checked against the real Excalidraw');
  assert.equal(catalogs.de.demoRowMirror.replaceAll('{app}', appName('excalidraw', 'de')), 'Prüfung im echten Excalidraw');
  assert.equal(catalogs.en.boardModel.replaceAll('{app}', appName('drawio', 'en')), 'This is a practice model. The real draw.io double-checks every change.');
  assert.equal(appName('bpmnjs', 'en'), 'bpmnjs', 'an unknown id is shown as it is');
});

test('the workspace control names the session\'s app; an app without a workspace says why in words that contain each label', () => {
  // The Player's copy of the registry's editor flags.
  assert.deepEqual(workspaceApps, Object.entries(ADAPTER_REGISTRY).filter(([, registration]) => registration.editor).map(([id]) => id));
  const fill = (language: 'en' | 'de', key: keyof typeof catalogs.en, id: string): string => catalogs[language][key].replaceAll('{app}', appName(id, language));
  assert.deepEqual([fill('en', 'modeEditor', 'excalidraw'), fill('de', 'modeEditor', 'excalidraw')], ['Excalidraw', 'Excalidraw'], 'an Excalidraw session keeps its label');
  assert.deepEqual([fill('en', 'modeEditor', 'drawio'), fill('de', 'modeEditor', 'drawio')], ['draw.io', 'draw.io']);
  assert.equal(fill('en', 'modeNoWorkspace', 'drawio'), 'draw.io does not open as a workspace in Practonaut. Practice on the board.');
  assert.equal(fill('de', 'modeNoWorkspace', 'drawio'), 'draw.io öffnet sich in Practonaut nicht als Arbeitsbereich. Übe auf der Arbeitsfläche.');
  assert.equal(fill('en', 'modeNoCreate', 'drawio'), 'Create is not available for draw.io.');
  assert.equal(fill('de', 'modeNoCreate', 'drawio'), 'Erstellen gibt es für draw.io nicht.');
});

test('CLI mirror messages name the world\'s app in both languages', async () => {
  const drawio = validateWorld(drawioRaw), excalidraw = validateWorld(library);
  const probes = (installed: boolean, starts: boolean): MirrorProbes => ({ runtime: async () => ({ ok: true }), installed: async () => installed, starts: async () => (starts ? { ok: true, sandbox: true } : { ok: false, detail: 'boom' }) as never });
  try {
    for (const language of ['en', 'de'] as const) {
      setCliLanguage(language);
      for (const [world, name, other] of [[drawio, 'draw.io', 'Excalidraw'], [excalidraw, 'Excalidraw', 'draw.io']] as const) {
        const texts: string[] = [];
        for (const [installed, starts] of [[false, false], [true, false]] as const) {
          await assert.rejects(resolveMirror('required', probes(installed, starts), world), (error: unknown) => { texts.push((error as Error).message); return error instanceof RuntimeError; });
          texts.push(fallbackNotice(await resolveMirror('auto', probes(installed, starts), world)));
        }
        for (const text of texts) { assert.ok(text.includes(name), `${language}: ${text}`); assert.ok(!text.includes(other), `${language}: ${text}`); }
      }
    }
  } finally { setCliLanguage('en'); }
});

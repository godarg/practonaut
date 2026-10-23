// PADR-0049 decision 1.5 for bench reports: every text that names the benched application takes its
// display name from the report's `environment.app.adapterId`. A draw.io report's page, table, card,
// badge and JUnit file name draw.io and never Excalidraw, with the mirror and without; an Excalidraw
// report's texts are unchanged. Expected wording is the catalogue's, written out here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTokensCss, renderHtml, renderTable } from '../../src/bench/render.ts';
import { renderBadge, renderCard } from '../../src/bench/card.ts';
import { renderJunit } from '../../src/bench/junit.ts';
import { validateBenchReportV3, type BenchReportV3 } from '../../src/bench/report.ts';
import { sessionReport } from '../support/bench-v3.ts';

const tokens = await readTokensCss();
const report = (adapterId: string, mirror: 'required' | 'off'): BenchReportV3 => validateBenchReportV3(sessionReport({ connect: { 1: [true], 2: [false] } }, {
  adapterId, worldId: adapterId === 'drawio' ? 'drawio-library' : 'excalidraw-library',
  change: value => {
    value.environment.mirror = mirror; value.settings.mirror = mirror;
    // A mirrored run carries the checker's verdict on the native export too.
    if (mirror === 'required') for (const run of value.runs as Array<{ checker: { session: { passed: boolean; errorClasses: string[] }; native: unknown } | null; artifacts?: { native: string | null } }>) {
      if (run.checker) { run.checker.native = { ...run.checker.session }; if (run.artifacts) run.artifacts.native = 'b'.repeat(64); }
    }
  },
}));
/** What a reader gets: text and attribute values, without the stylesheets (whose comments are the design tokens'). */
const readable = (markup: string): string => markup.replace(/<style[\s\S]*?<\/style>/gu, ' ').replace(/<[^>]*?\s(?:aria-label|title|alt)="([^"]*)"[^>]*>/gu, ' $1 ').replace(/<[^>]+>/gu, ' ').replace(/&#x2019;|&rsquo;/gu, '’').replace(/\s+/gu, ' ');
const surfaces = (input: BenchReportV3): Array<[string, string]> => (['en', 'de'] as const).flatMap(language => [
  [`${language} page`, readable(renderHtml(input, tokens, language))], [`${language} table`, renderTable(input, language)],
  [`${language} card`, readable(renderCard(input, tokens, 'light', language))], [`${language} badge`, readable(renderBadge(input, tokens, language))],
  [`${language} junit`, renderJunit(input, language)],
] as Array<[string, string]>);

test('a draw.io report names draw.io on every surface and never Excalidraw, with and without the mirror', () => {
  for (const mirror of ['required', 'off'] as const) {
    for (const [surface, text] of surfaces(report('drawio', mirror))) assert.doesNotMatch(text, /Excalidraw/, `${mirror} ${surface}`);
  }
  const mirrored = Object.fromEntries(surfaces(report('drawio', 'required')));
  assert.match(mirrored['en table']!, /real draw\.io mirror/);
  assert.match(mirrored['de table']!, /echte draw\.io-Spiegelung/);
  assert.match(mirrored['en card']!, /Real draw\.io mirror: every action confirmed in the real app/);
  assert.match(mirrored['en page']!, /with the mirror, the real draw\.io export/);
});

test('an Excalidraw report keeps its wording', () => {
  const mirrored = Object.fromEntries(surfaces(report('excalidraw', 'required')));
  assert.match(mirrored['en table']!, /real Excalidraw mirror/);
  assert.match(mirrored['de card']!, /Echte Excalidraw-Spiegelung: jede Aktion in der echten App bestätigt/);
  assert.match(Object.fromEntries(surfaces(report('excalidraw', 'off')))['en card']!, /Model only: not checked against the real Excalidraw/);
});

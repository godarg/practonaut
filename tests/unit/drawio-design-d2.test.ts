// Design review D2 (commit 1cb8ff3), the parts without a browser: the agent-facing refusal of a group
// across frames names the tools that lead on (D2-F1), and the interim notice comes last in every page's
// closing notes (D2-F9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { constraintViolation } from '../../src/world/constraints.ts';
import { loadReportDetails } from '../../src/bench/details.ts';
import { detailWords, readTokensCss, renderHtml } from '../../src/bench/render.ts';
import { renderCompareHtml } from '../../src/bench/render-compare.ts';
import { compareReports } from '../../src/bench/compare.ts';
import { validateBenchReportV3, type SessionReportV3 } from '../../src/bench/report.ts';
import { stepV2 } from '../support/world-v2.ts';

test('D2-F1: the agent hears the way forward with the actions that take it (set_frame, ungroup), never "move"', () => {
  const state = { objects: { f: { id: 'f', type: 'frame' as const, deleted: false, name: 'Frame' }, a: stepV2('a', 'A', 0, 0, { frameId: 'f', groupId: 'g' }), b: stepV2('b', 'B', 300, 0, { groupId: 'g' }) } };
  const violation = constraintViolation(state, ['group-within-one-frame']);
  assert.equal(violation?.message, "In this application all steps of a group lie in the same frame: the steps of group g would lie in different frames. Put the steps into one frame first (set_frame), or ungroup them (ungroup) before you change a step's frame. The state is unchanged.");
});

test('D2-F9: the interim notice is the last note of the closing notes on a report and on a compare page', async () => {
  const notice = 'draw.io is a registered trademark;';
  const read = (name: string) => validateBenchReportV3(JSON.parse(readFileSync(join('docs/benchmarks/drawio', name, 'report.json'), 'utf8'))) as SessionReportV3;
  const drawio = read('drawio-oracle'), excalidraw = read('excalidraw-oracle'), tokens = await readTokensCss();
  // The notes of the section that holds the notice, as text, in order.
  const lastNote = (html: string): string => {
    const at = html.indexOf('registered trademark'), open = html.lastIndexOf('<section', at), close = html.indexOf('</section>', at);
    const notes = [...html.slice(open, close).matchAll(/<p class="note">([\s\S]*?)<\/p>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ''));
    return notes.at(-1) ?? '';
  };
  const report = renderHtml(drawio, tokens, 'en', 'consistency-checked', await loadReportDetails(drawio, 'docs/benchmarks/drawio/drawio-oracle', detailWords('en')));
  assert.ok(lastNote(report).startsWith(notice), `the report's closing notes end with: ${lastNote(report).slice(0, 80)}`);
  const side = (value: SessionReportV3) => ({ report: value, verification: 'consistency-checked' as const });
  const compare = renderCompareHtml(side(excalidraw), side(drawio), compareReports(excalidraw, drawio), tokens, 'en');
  assert.ok(lastNote(compare).startsWith(notice), `the compare page's closing notes end with: ${lastNote(compare).slice(0, 80)}`);
});

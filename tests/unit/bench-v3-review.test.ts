// Review findings on bench/3 (PR #66), each reproduced as the attack or the mistake it describes and
// refused or shown correctly: an application adapter id that walks out of the run folder (H), one
// materialisation per variant case for task identities (I), an identity-paired candidate that was only
// unjudged (F), the refusal's hint on the terminal and the page (G), the gate's budget exemption for /3
// runs (D), and values a parser this Practonaut does not ship read, which no surface may show as
// confirmed (A). Expected texts are the catalogue's words, written here by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeFileName, validateBenchReportV3, type BenchReportV3, type SessionRunV3 } from '../../src/bench/report.ts';
import { nativeFileOf, toView } from '../../src/bench/view.ts';
import { identityCache, taskIdentity } from '../../src/bench/identity.ts';
import { compareReports } from '../../src/bench/compare.ts';
import { renderCompareTable } from '../../src/bench/render-compare.ts';
import { headline, readTokensCss, renderHtml } from '../../src/bench/render.ts';
import { renderBadge, renderCard } from '../../src/bench/card.ts';
import { renderJunit } from '../../src/bench/junit.ts';
import { exemptRun } from '../../src/challenge/gate.ts';
import { rederivedFailure } from '../../src/challenge/files.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { generateVariant, variantIndex } from '../../src/world/variant.ts';
import type { World } from '../../src/world/types.ts';
import { hash, sessionReport } from '../support/bench-v3.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const fixture = (path: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url)), 'utf8');
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

test('H: an application adapter id is the world id pattern: no separator, ":" or ".." reaches a file name', () => {
  for (const adapterId of ['x/../y', 'a:b', '..', 'x\\y', 'native.excalidraw']) {
    assert.throws(() => validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { adapterId })), /environment\.app\.adapterId/, adapterId);
    assert.throws(() => nativeFileName(adapterId), /not an application adapter id/, adapterId);
  }
  // Defence in depth: the view's file name refuses a forged value even if a report escaped validation.
  const forged = toView(validateBenchReportV3(sessionReport({ T: { 1: [true] } })));
  forged.environment.app.adapterId = '../../tmp/x';
  assert.throws(() => nativeFileOf(forged), /not an application adapter id/);
  assert.equal(nativeFileName('drawio'), 'native.drawio');
});

test('I: task identities materialise each variant case once, with the same values as one at a time', () => {
  const raw = JSON.parse(fixture('ci-recipe/world/world.json')) as Record<string, unknown>;
  const world = validateWorld({ ...raw, variants: { generator: 'finite-seeded-v1', cases: [0, 100, 200].map((x, index) => ({ id: `case-${index}`, labels: {}, params: {}, layoutOffset: { x, y: 0 } })) } }) as World;
  const seeds = Array.from({ length: 40 }, (_, index) => index + 1), cases = new Set(seeds.map(seed => variantIndex(world, seed))).size;
  let calls = 0;
  const identityOf = identityCache(world, (value, seed) => { calls++; return generateVariant(value, seed); });
  for (const seed of seeds) assert.equal(identityOf('review-and-send', seed), taskIdentity(world, 'review-and-send', seed));
  assert.equal(cases, 3);
  assert.equal(calls, 3, '40 seeds over three cases: three materialisations');
});

test('F: an identity-paired candidate whose runs were all unjudged has no verdict, not a failure', () => {
  const a = validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { identities: { T: { 1: hash('7') } }, worldId: 'excalidraw-library', contentHash: hash('a') }));
  const b = validateBenchReportV3(sessionReport({ T: { 2: [null] } }, { identities: { T: { 2: hash('7') } }, worldId: 'drawio-library', contentHash: hash('b'), adapterId: 'drawio' }));
  const comparison = compareReports(a, b);
  assert.deepEqual([comparison.pairing, comparison.pairs[0]!.flip], ['identity', 'config-down']);
  const text = renderCompareTable({ report: a, verification: 'consistency-checked' }, { report: b, verification: 'consistency-checked' }, comparison);
  assert.match(text, /T · seed 1 \(baseline\) · T · seed 2 \(candidate\): passed on the baseline \(1\/1\), no verdict on the candidate \(1 of 1 run not judged, counted as not passed\)/);
  assert.equal(/failed on the candidate/.test(text), false, text);
});

test('G: one hint for a refusal: settings for two worlds of one application, the gate\'s for a pair across worlds, on the terminal and the page', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pn-hint-'));
  try {
    const write = (name: string, value: unknown): string => { const path = join(dir, name); writeFileSync(path, JSON.stringify(value)); return path; };
    const a = write('a.json', validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { identities: { T: { 1: hash('7') } }, worldId: 'one', contentHash: hash('a') })));
    const sameApp = write('b.json', validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { identities: { T: { 1: hash('7') } }, worldId: 'two', contentHash: hash('b') })));
    const otherApp = write('c.json', validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { identities: { T: { 1: hash('7') } }, worldId: 'two', contentHash: hash('b'), adapterId: 'drawio' })));
    const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, 'compare', ...args], { encoding: 'utf8' });
    // Two worlds of one application: no identity pairing, the world differs; the settings hint.
    let refused = cli(a, sameApp, '--fail-on-regression', '--html', join(dir, 'same.html'));
    assert.equal(refused.status, 2); assert.match(refused.stderr, /Bench the baseline again with the candidate's settings \[compare_incomparable\]/);
    assert.match(readFileSync(join(dir, 'same.html'), 'utf8').replace(/ /g, ' '), /Bench the baseline again with the candidate’s settings, then compare\./);
    // The same tasks on two applications: paired by identity, refused only by the gate; the gate's hint.
    assert.equal(cli(a, otherApp).status, 0);
    refused = cli(a, otherApp, '--fail-on-regression', '--html', join(dir, 'gate.html'));
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /A regression gate compares one world with itself under one reading of results; compare without --fail-on-regression to see the two configurations side by side \[compare_incomparable\]/);
    // The page: why the gate refuses (two worlds), then the way forward with the flag whole.
    const gate = readFileSync(join(dir, 'gate.html'), 'utf8').replace(/ /g, ' ').replace(/<\/?(?:span|code)[^>]*>/g, '');
    assert.match(gate, /A regression gate compares one world with itself; these reports come from two worlds\./);
    assert.match(gate, /Compare without --fail-on-regression to see the two configurations side by side\./);
    // /2 as before: two /2 reports of different worlds under the gate get the settings hint.
    const v2 = JSON.parse(fixture('bench/v2/report.json')) as { environment: { world: { contentHash: string } } };
    const other = structuredClone(v2); other.environment.world.contentHash = hash('f');
    refused = cli(write('v2.json', v2), write('v2b.json', other), '--fail-on-regression');
    assert.equal(refused.status, 2); assert.match(refused.stderr, /the world content differs .*Bench the baseline again with the candidate's settings \[compare_incomparable\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('D: a /3 run is budget-exempt only by a usage limit or login error before model work that a shipped parser re-derives', async () => {
  const limited = { id: 'held-s1-r1', status: 'infra_error' as const, note: 'the client reported a usage or rate limit (rate_limit_event not allowed)', toolCalls: { observe: 0, act: 0, undo: 0, reset: 0, check: 0, total: 0 }, client: { tokens: null } };
  const failure = { reason: 'usage_limit' as const, parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true };
  const rederived = { reason: 'usage_limit', parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true };
  const exempt = (run: object, again: { reason: string; parser: string; code: string | null; beforeModelWork: boolean } | null): boolean => exemptRun(run as never, { rederived: new Set([limited.id]), failures: new Map([[limited.id, again]]) });
  assert.equal(exempt({ ...limited, failure }, rederived), true);
  // Each bypass of the note-based rule, refused (the 0.3.0 gate reads failure, never the note).
  assert.equal(exempt({ ...limited, failure: { ...failure, beforeModelWork: false } }, { ...rederived, beforeModelWork: false }), false, 'after model work');
  assert.equal(exempt({ ...limited, failure }, { ...rederived, beforeModelWork: false }), false, 'the report says before, the parser says after');
  assert.equal(exempt({ ...limited, failure: { reason: 'runner', parser: null, code: null, beforeModelWork: null } }, null), false, 'a runner reason with the note\'s words');
  assert.equal(exempt({ ...limited, failure: { ...failure, parser: 'x/1' } }, null), false, 'a parser this Practonaut does not ship');
  assert.equal(exempt({ ...limited, failure: { ...failure, reason: 'api_error' } }, { ...rederived, reason: 'api_error' }), false, 'an API error is never exempt');
  assert.equal(exempt({ ...limited, failure }, null), false, 'not re-derived from the stdout');

  // From a run folder: the run's own stdout decides.
  const dir = mkdtempSync(join(tmpdir(), 'pn-exempt-'));
  try {
    const stdout = (lines: object[]): string => lines.map(line => JSON.stringify(line)).join('\n') + '\n';
    const init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5', apiKeySource: 'none' };
    const rejection = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } };
    const cases = {
      honest: { text: stdout([init, rejection]), failure },
      afterWork: { text: stdout([init, { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } }, rejection]), failure },
      runner: { text: stdout([init]), failure: { reason: 'runner' as const, parser: null, code: null, beforeModelWork: null } },
    };
    const found: Array<[string, boolean]> = [];
    for (const [name, value] of Object.entries(cases)) {
      const run = join(dir, name, 'held-s1-r1');
      await mkdir(run, { recursive: true }); await writeFile(join(run, 'agent.stdout'), value.text);
      const listed = { ...limited, stdout: { sha256: createHash('sha256').update(value.text).digest('hex'), bytes: Buffer.byteLength(value.text) }, failure: value.failure };
      found.push([name, exempt(listed, await rederivedFailure(run, listed))]);
    }
    assert.deepEqual(found, [['honest', true], ['afterWork', false], ['runner', false]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('A: values a parser this Practonaut does not ship read are never shown as confirmed: header, page, card, badge and JUnit say so', async () => {
  const preset = validateBenchReportV3(sessionReport({ T: { 1: [true] } }, { change: value => {
    value.agent = { ...value.agent, kind: 'preset', name: 'claude-code', command: ['claude'], isolation: 'tool-restricted-preset', modelSource: 'client-attested', model: 'claude-haiku-5-5', billing: { class: 'subscription', source: 'preset-requested' } };
    const run = value.runs[0] as Mutable<SessionRunV3>;
    run.isolation = { level: 'tool-restricted-preset', evidence: 'tools-within-servers' };
    run.client = { source: 'client-attested', model: 'claude-haiku-5-5', turns: null, costUsd: null, tokens: null, parser: 'claude-code-stream/2', tools: { names: ['mcp__practonaut__act'], omitted: 0 } };
  } }) as BenchReportV3);
  const claims = { level: 're-verified' as const, notRederived: ['claude-code-stream/2'], preset: 'not-checked' as const };
  const line = headline(toView(preset), 'en', claims).join(' · ');
  // Said once, by the verification (R1-F2); the isolation and the model keep their own words.
  assert.match(line, /re-verified; client values not re-derived/);
  assert.equal(line.match(/not re-derived/g)?.length, 1, line);
  assert.match(line, / · tool-restricted preset · model claude-haiku-5-5 \(self-reported, client-attested\)$/);
  // Without the detail (fully re-derived) none of that is said.
  assert.equal(/not re-derived/.test(headline(toView(preset), 'en', 're-verified').join(' · ')), false);
  const tokens = await readTokensCss();
  const card = renderCard(preset, tokens, 'light', 'en', claims);
  // Each evidence row: its mark (confirmed or open) and its words, the lines of its text joined.
  const marks = [...card.matchAll(/class="mark-(confirmed|open)"[^>]*\/>(?:<path[^>]*\/>)?<\/g><text class="card-fact[^"]*">([\s\S]*?)<\/text>/g)].map(match => [match[2]!.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), match[1]]);
  assert.deepEqual(marks.filter(([text]) => /Tool-restricted preset|not re-derived/.test(text!)), [['Client’s own values not re-derived: the report’s claims', 'open'], ['Tool-restricted preset: only Practonaut’s MCP tools', 'open']]);
  // Fully re-derived, the same report's preset isolation is confirmed by re-verification.
  assert.ok(renderCard(preset, tokens, 'light', 'en', 're-verified').includes('class="mark-confirmed"/><path d="M7.7 12.4l3 3 5.6-6" class="mark-check"/></g><text class="card-fact"><tspan x="24" y="15.4">Tool-restricted preset'));
  // The badge marks the preset as a claim, as the card does (R1-F17).
  const badge = renderBadge(preset, tokens, 'en', claims).match(/<text[^>]*>([\s\S]*)<\/text>/u)![1]!;
  assert.match(badge, /re-verified · tool restriction not re-derived/);
  assert.equal(badge.includes('tool-restricted preset'), false);
  const page = renderHtml(preset, tokens, 'en', claims);
  assert.match(page, /re-verified: every judged run was re-judged by the checker from its artifacts\. The model and the offered tools are the report’s own statements, not re-derived\./);
  // The settings name the isolation in its own words, and the note does not claim the client's values were read again.
  assert.match(page, /<dt>Isolation<\/dt><dd>tool-restricted preset<\/dd>/);
  assert.equal(page.includes('is read again from its bound output'), false);
  const junit = renderJunit(preset, 'en', claims);
  assert.match(junit, /<property name="practonaut\.verification\.clientValues" value="not re-derived: the report&apos;s claims"\/>/);
  assert.match(junit, /<property name="practonaut\.verification\.parsersNotShipped" value="claude-code-stream\/2"\/>/);
  assert.match(junit, /<property name="practonaut\.verification\.preset" value="not checked"\/>/);
});

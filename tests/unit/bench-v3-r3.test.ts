// Re-review r3 of bench/3 (PR #66, commit 511713d), each finding reproduced as described and refused or
// shown correctly: the gate's hint over a refusal it alone does not make, JUnit's client values of a /1 or
// /2 report, a template's requested model, a usage limit followed by model work (budget exemption), and
// version strings that are not SemVer 2.0.0. Expected values are written here by hand (the SemVer order
// from the SemVer 2.0.0 specification, §11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { differences, refusalHint } from '../../src/bench/compare.ts';
import { renderIncomparableHtml } from '../../src/bench/render-compare.ts';
import { renderJunit } from '../../src/bench/junit.ts';
import { validateBenchReport, validateBenchReportV3, type BenchReportV3 } from '../../src/bench/report.ts';
import { clientFailure, readLogHead, wholeLog } from '../../src/bench/evidence.ts';
import { versionOrder } from '../../src/bench/verify.ts';
import { scanSpend } from '../../src/challenge/files.ts';
import { hash, sessionReport } from '../support/bench-v3.ts';
import { v3States } from '../support/bench-v3-states.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const fixture = (path: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url)), 'utf8');
const s = v3States();

test('r3-gate-hint-masks-differences: the gate\'s hint only when the gate alone refuses; another difference gets the settings hint, on the API, the terminal and the page', () => {
  // The same tasks on two applications, the candidate with another action budget.
  const tighter = validateBenchReportV3({ ...structuredClone(s.drawio), settings: { ...s.drawio.settings, maxActions: 7 } });
  const found = differences(s.excalidraw, tighter, { regressionGate: true });
  assert.deepEqual(found.map(difference => difference.field), ['world', 'budget']);
  assert.equal(refusalHint(found, s.excalidraw, tighter, { regressionGate: true }), 'settings');
  // Without the budget difference the gate is all that refuses: its hint.
  assert.equal(refusalHint(differences(s.excalidraw, s.drawio, { regressionGate: true }), s.excalidraw, s.drawio, { regressionGate: true }), 'gate');
  // The page: no "two worlds" lead beside the budget, and the way forward that works.
  const page = renderIncomparableHtml({ report: s.excalidraw, verification: 'consistency-checked' }, { report: tighter, verification: 'consistency-checked' }, found, ':root{}', 'en', { regressionGate: true }).replace(/<\/?span[^>]*>/gu, '').replace(/ /gu, ' ');
  assert.equal(page.includes('these reports come from two worlds'), false);
  assert.equal(page.includes('Compare without --fail-on-regression'), false);
  assert.match(page, /These two reports were made under different conditions/);
  assert.match(page, /Action budget: 50 on the baseline, 7 on the candidate/);
  assert.match(page, /Bench the baseline again with the candidate’s settings, then compare\./);
  // The terminal says the same.
  const dir = mkdtempSync(join(tmpdir(), 'pn-r3-hint-'));
  try {
    const a = join(dir, 'a.json'), b = join(dir, 'b.json');
    writeFileSync(a, JSON.stringify(s.excalidraw)); writeFileSync(b, JSON.stringify(tighter));
    const refused = spawnSync(process.execPath, [CLI, 'compare', a, b, '--fail-on-regression'], { encoding: 'utf8' });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /the action budget differs \(50 on the baseline, 7 on the candidate\)\. Bench the baseline again with the candidate's settings \[compare_incomparable\]/);
    assert.equal(refused.stderr.includes('compare without --fail-on-regression'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('r3-junit-clientvalues-v2: JUnit claims re-derived client values only for a re-verified /3 report', () => {
  const property = /<property name="practonaut\.verification\.clientValues" value="([^"]*)"\/>/u;
  for (const path of ['bench/v1/report.json', 'bench/v2/report.json']) {
    const junit = renderJunit(validateBenchReport(JSON.parse(fixture(path))), 'en', 're-verified');
    assert.equal(property.test(junit), false, path);
    assert.match(junit, /<property name="practonaut\.verification" value="re-verified"\/>/);
  }
  assert.equal(renderJunit(s.excalidraw, 'en', 're-verified').match(property)?.[1], 're-derived');
  assert.equal(renderJunit(s.claimed, 'en', s.claims).match(property)?.[1], 'not re-derived: the report&apos;s claims');
});

test('r3-requested-model: only a preset requests a model; no other source is accepted', () => {
  const withRequested = (kind: 'command' | 'preset', requested: BenchReportV3['agent']['requestedModel']): unknown => sessionReport({ T: { 1: [true] } }, { change: value => {
    value.agent = kind === 'preset'
      ? { ...value.agent, kind: 'preset', name: 'claude-code', command: ['claude'], isolation: 'template-unrestricted', modelSource: 'none', model: null, billing: { class: 'subscription', source: 'preset-requested' }, requestedModel: requested }
      : { ...value.agent, requestedModel: requested };
    if (kind === 'preset') for (const run of value.runs as Array<Record<string, unknown>>) { run.isolation = { level: 'template-unrestricted', evidence: 'no-evidence' }; run.client = { source: 'client-attested', model: null, turns: null, costUsd: null, tokens: null, parser: 'claude-code-stream/1' }; }
  } });
  // The reviewer's case: a command template with a requested model "read" from its output.
  assert.throws(() => validateBenchReportV3(withRequested('command', { value: 'gpt-9', source: 'command-output' })), /requestedModel/);
  assert.throws(() => validateBenchReportV3(withRequested('preset', { value: 'claude-opus-5-5', source: 'client-attested' })), /requestedModel/);
  assert.doesNotThrow(() => validateBenchReportV3(withRequested('command', { value: null, source: 'none' })));
  assert.doesNotThrow(() => validateBenchReportV3(withRequested('preset', { value: 'claude-opus-5-5', source: 'preset-requested' })));
});

test('r3 Codex 1: a usage limit is before model work only when no model message appears anywhere in the whole output; the gate exempts no such run', async () => {
  const lines = (events: object[]): string => events.map(event => JSON.stringify(event)).join('\n') + '\n';
  const init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5', apiKeySource: 'none' };
  const rejection = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } };
  const work = { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } };
  const apiError = { type: 'assistant', isApiErrorMessage: true, message: { content: [{ type: 'text', text: 'API Error: 500 Internal server error' }] } };
  assert.equal(clientFailure(lines([init, rejection]))?.beforeModelWork, true);
  // The reviewer's case: the limit, then a normal assistant message.
  assert.equal(clientFailure(lines([init, rejection, work]))?.beforeModelWork, false);
  assert.equal(clientFailure(lines([init, work, rejection]))?.beforeModelWork, false);
  // An API error the client marks as such is no model work, before or after.
  assert.deepEqual(clientFailure(lines([init, rejection, apiError])), { reason: 'usage_limit', detail: 'rate_limit_event not allowed', code: 'rejected', beforeModelWork: true });
  // The first failure is the one reported; later model work still counts.
  assert.deepEqual(clientFailure(lines([init, rejection, apiError, work])), { reason: 'usage_limit', detail: 'rate_limit_event not allowed', code: 'rejected', beforeModelWork: false });
  // Output past the part read could hold model work: never before it.
  assert.equal(clientFailure(lines([init, rejection]), false)?.beforeModelWork, false);

  const dir = mkdtempSync(join(tmpdir(), 'pn-r3-exempt-'));
  try {
    // A head that does not reach the end of its file is not the whole output.
    const long = join(dir, 'long.stdout'); await writeFile(long, lines([init, rejection, work]));
    assert.equal(wholeLog(await readLogHead(long, 64)), false);
    assert.equal(wholeLog(await readLogHead(long, 4096)), true);
    // Through the spend scan: the limit before a model message is not exempt.
    const limited = { status: 'infra_error', toolCalls: { observe: 0, act: 0, undo: 0, reset: 0, check: 0, total: 0 }, client: { tokens: null } };
    const failure = { reason: 'usage_limit', parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true };
    for (const [name, text] of Object.entries({ honest: lines([init, rejection]), workAfter: lines([init, rejection, work]) })) {
      const bench = join(dir, name), run = join(bench, 'held-s1-r1');
      await mkdir(run, { recursive: true }); await writeFile(join(run, 'agent.stdout'), text);
      const bound = { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) };
      await writeFile(join(bench, 'report.json'), JSON.stringify({ schema: 'practonaut.bench/3', environment: { world: { contentHash: hash('a') } }, runs: [{ id: 'held-s1-r1', ...limited, stdout: bound, failure }] }));
    }
    const scanned = await scanSpend([dir], { developmentHash: hash('b'), developmentTasks: [], heldOutTasks: ['held'] });
    assert.deepEqual(scanned.heldOut.map(run => [run.bench, run.rejected === true]), [['honest', true], ['workAfter', false]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('r3 Codex 2: a version that is not SemVer 2.0.0 is never newer; valid versions keep the specification\'s order', () => {
  for (const invalid of ['0.3.0-dev..1', '0.3.0-dev.01', '00.3.0-dev.1', '0.03.0', '0.3.00', '0.3.0-', '0.3.0+', '0.3.0-dev.', '0.3', 'v0.3.1', 'banana', '0.3.0-dev.1+a..b'])
    assert.equal(versionOrder(invalid, '0.3.0-dev.0'), null, invalid);
  // SemVer 2.0.0 §11: 1.0.0-alpha < 1.0.0-alpha.1 < 1.0.0-alpha.beta < 1.0.0-beta < 1.0.0-beta.2 < 1.0.0-beta.11 < 1.0.0-rc.1 < 1.0.0.
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
  for (let i = 0; i + 1 < ordered.length; i++) assert.equal(versionOrder(ordered[i]!, ordered[i + 1]!), -1, `${ordered[i]} < ${ordered[i + 1]}`);
  assert.equal(versionOrder('0.3.0-dev.1', '0.3.0-dev.0'), 1);
  assert.equal(versionOrder('0.3.0-dev.0+local', '0.3.0-dev.0'), 0);
  assert.equal(versionOrder('0.3.0-0', '0.3.0-dev.0'), -1);
});

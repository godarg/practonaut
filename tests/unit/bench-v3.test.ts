// practonaut.bench/3 (PADR-0044): the validator's rules for both verdict levels on hand-built reports,
// the claude-code-stream/1 parser on one stored Claude Code init event (paths and session ids removed;
// the seven tool names written below by hand), the task identity against a hash computed here by hand,
// and compare's pairing by task identity across two worlds, whose expected pairs come from SHA-256 over
// hand-written canonical text, not from the code under test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { presetIsolation, validateBenchReport, validateBenchReportV3, type ArtifactRunV3, type BenchReportV3, type SessionRunV3 } from '../../src/bench/report.ts';
import { toView } from '../../src/bench/view.ts';
import { apiKeySourceValue, attestedBilling, toolEvidence } from '../../src/bench/parsers.ts';
import { PRESET_INFO, requestedBilling, requestedModelOf, vendorOf, resolveAgent } from '../../src/bench/agents.ts';
import { clientFailure } from '../../src/bench/evidence.ts';
import { taskIdentity, TASK_IDENTITY } from '../../src/bench/identity.ts';
import { compareReports, CompareError } from '../../src/bench/compare.ts';
import { renderCompareTable } from '../../src/bench/render-compare.ts';
import { readTokensCss, renderHtml, renderTable } from '../../src/bench/render.ts';
import { renderJunit } from '../../src/bench/junit.ts';
import { renderBadge } from '../../src/bench/card.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { variantIndex } from '../../src/world/variant.ts';
import type { World } from '../../src/world/types.ts';
import { artifactReport, hash, sessionReport } from '../support/bench-v3.ts';

const fixture = (path: string): string => readFileSync(fileURLToPath(new URL(`../fixtures/${path}`, import.meta.url)), 'utf8');
const refused = (value: BenchReportV3, pattern: RegExp): void => { assert.throws(() => validateBenchReportV3(value), (error: Error) => pattern.test(error.message), pattern.source); };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

test('a consistent /3 report validates at either level; one level per report, its toolchain and summary', () => {
  const session = sessionReport({ T: { 1: [true], 2: [false] } }), artifact = artifactReport();
  assert.equal(validateBenchReport(session).schema, 'practonaut.bench/3');
  assert.equal(validateBenchReportV3(artifact).verdictLevel, 'artifact');
  // A run of the other level, the other toolchain, or the other summary.
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { (value.runs[0] as unknown as { verdictLevel: string }).verdictLevel = 'artifact'; } }), /does not match practonaut\.bench\/3|verdict level/);
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { value.toolchain = artifactReport().toolchain; } }), /toolchain/);
  refused(artifactReport(undefined, value => { value.environment = { ...value.environment, mirror: 'off' }; }), /environment\.mirror/);
  refused(artifactReport(undefined, value => { value.settings = { ...value.settings, checks: 3 }; }), /settings\.checks/);
  refused(artifactReport(undefined, value => { value.environment.world.limits = [{ taskId: 'flow', actions: 5 }]; }), /environment\.world\.limits/);
  const forged = structuredClone(session) as Mutable<BenchReportV3>; forged.summary = artifactReport().summary;
  refused(forged, /summary does not follow/);
});

test('artifact level: judged on the stored result or the start file, from a complete proxy log', () => {
  // The derived pass: a readable result that the checker passed; an absent result is judged and fails.
  const absent = structuredClone(artifactReport()) as Mutable<BenchReportV3>; (absent.runs[1] as Mutable<ArtifactRunV3>).pass = true;
  refused(absent, /claims pass=true/);
  refused(artifactReport(undefined, value => { (value.runs[0] as Mutable<ArtifactRunV3>).artifacts = { ...(value.runs[0] as ArtifactRunV3).artifacts!, result: null }; }), /artifacts\.result/);
  refused(artifactReport(undefined, value => { (value.runs[0] as Mutable<ArtifactRunV3>).proxyLog = null; }), /proxyLog/);
  refused(artifactReport(undefined, value => { (value.runs[0] as Mutable<ArtifactRunV3>).proxy = { starts: 1, calls: 51, refused: 0 }; }), /proxy\.calls/);
  // An agent that never started its tools: no_tool_call only with nothing the proxy saw.
  const quiet = artifactReport({ flow: { 1: [null] } }, value => { (value.runs[0] as Mutable<ArtifactRunV3>).failure = { reason: 'no_tool_call', parser: null, code: null, beforeModelWork: null }; });
  assert.doesNotThrow(() => validateBenchReportV3(quiet));
  refused(artifactReport({ flow: { 1: [null] } }, value => { const run = value.runs[0] as Mutable<ArtifactRunV3>; run.failure = { reason: 'no_tool_call', parser: null, code: null, beforeModelWork: null }; run.proxy = { starts: 1, calls: 0, refused: 0 }; }), /failure\.reason/);
  // Its summary has no action figures and counts the forwarded calls.
  assert.deepEqual(Object.keys(validateBenchReportV3(artifactReport()).summary).sort(), ['byTask', 'infraErrors', 'judged', 'meanWallMs', 'passAt1', 'passHatK', 'passed', 'proxyCalls', 'runs']);
  assert.equal((validateBenchReportV3(artifactReport()).summary as { proxyCalls: number }).proxyCalls, 6);
});

test('session level: the agent\'s own actions, the co-actor\'s bounds, the failure of every run that was not judged', () => {
  const run = (value: Mutable<BenchReportV3>): Mutable<SessionRunV3> => value.runs[0] as Mutable<SessionRunV3>;
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { run(value).agentActions = 0; } }), /agent's own actions/);
  // A co-actor's actions: only in a run whose task names a schedule, at most what it had accepted.
  const schedule = (value: Mutable<BenchReportV3>): void => { value.environment.world.scenarios = [{ taskId: 'T', schedule: hash('5') }]; };
  const withCoActor = sessionReport({ T: { 1: [true] } }, { change: value => { schedule(value); Object.assign(run(value), { actions: 2, acceptedActions: 1, agentActions: 1, coActor: { planned: 1, fired: 1, accepted: 1, rejected: 0 }, logs: undefined }); delete run(value).logs; } });
  assert.doesNotThrow(() => validateBenchReportV3(withCoActor));
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { schedule(value); Object.assign(run(value), { actions: 3, coActor: { planned: 1, fired: 1, accepted: 1, rejected: 0 } }); } }), /agent's own actions/);
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { Object.assign(run(value), { coActor: { planned: 0, fired: 0, accepted: 0, rejected: 0 } }); } }), /coActor/);
  refused(sessionReport({ T: { 1: [true] } }, { change: schedule }), /coActor/);
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { schedule(value); Object.assign(run(value), { coActor: { planned: 1, fired: 2, accepted: 1, rejected: 1 } }); } }), /coActor/);
  // Failure exactly for infra_error runs; a parser's reasons with their parser and a bound stdout.
  refused(sessionReport({ T: { 1: [null] } }, { change: value => { delete run(value).failure; } }), /failure/);
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { run(value).failure = { reason: 'runner', parser: null, code: null, beforeModelWork: null }; } }), /failure/);
  refused(sessionReport({ T: { 1: [null] } }, { change: value => { run(value).failure = { reason: 'usage_limit', parser: null, code: '429', beforeModelWork: null }; } }), /failure\.parser/);
  refused(sessionReport({ T: { 1: [null] } }, { change: value => { run(value).failure = { reason: 'runner', parser: null, code: null, beforeModelWork: true }; } }), /failure\.beforeModelWork/);
  refused(sessionReport({ T: { 1: [null] } }, { change: value => { run(value).failure = { reason: 'server_error', parser: null, code: null, beforeModelWork: null }; } }), /failure\.reason/);
  refused(sessionReport({ T: { 1: [null] } }, { change: value => { run(value).failure = { reason: 'no_tool_call', parser: null, code: null, beforeModelWork: null }; } }), /failure\.reason/);
  assert.doesNotThrow(() => validateBenchReportV3(sessionReport({ T: { 1: [null] } }, { change: value => { run(value).failure = { reason: 'usage_limit', parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true }; } })));
  refused(sessionReport({ T: { 1: [null] } }, { change: value => { run(value).failure = { reason: 'auth', parser: 'claude-code-stream/1', code: null, beforeModelWork: true }; run(value).stdout = null; delete run(value).client; } }), /failure\.parser/);
  // The stdout binding: on every external run; null means nothing was read from it.
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { delete run(value).stdout; } }), /stdout/);
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { run(value).stdout = null; } }), /stdout/);
  refused(sessionReport({ T: { 1: [true] } }, { change: value => { delete run(value).client; } }), /client\.parser/);
  // The instances: exactly the runs' task-and-seed pairs in plan order.
  refused(sessionReport({ T: { 1: [true], 2: [true] } }, { change: value => { value.instances = [...value.instances].reverse(); } }), /instances/);
});

test('the agent\'s evidenced identity: a value exactly with a source its kind allows; billing requested only by a preset; isolation from the runs', () => {
  const agent = (change: (value: Mutable<BenchReportV3['agent']>) => void): BenchReportV3 => sessionReport({ T: { 1: [true] } }, { change: value => { const copy = { ...value.agent }; change(copy); value.agent = copy; } });
  refused(agent(value => { value.vendor = { value: 'anthropic', source: 'none' }; }), /vendor/);
  refused(agent(value => { value.client = { value: null, source: 'command-output' }; }), /client/);
  refused(agent(value => { value.requestedModel = { value: 'claude-x', source: 'preset-requested' }; }), /requestedModel/);
  assert.doesNotThrow(() => validateBenchReportV3(agent(value => { value.clientVersion = { value: '2.1.301', source: 'command-output' }; })));
  refused(agent(value => { value.billing = { class: 'subscription', source: 'none' }; }), /billing/);
  refused(agent(value => { value.billing = { class: 'subscription', source: 'preset-requested' }; }), /billing/);
  refused(agent(value => { value.settings = [{ name: 'effort', value: 'high' }]; }), /settings/);
  // A preset earns "tool-restricted" only from its runs' evidence: at least one run, every judged run, none outside.
  const run = (evidence: string, judged = true): { checker: unknown; isolation: { evidence: string } } => ({ checker: judged ? {} : null, isolation: { evidence } });
  assert.equal(presetIsolation('preset', [run('tools-within-servers'), run('tools-within-servers')]), 'tool-restricted-preset');
  assert.equal(presetIsolation('preset', [run('tools-within-servers'), run('no-evidence')]), 'template-unrestricted');
  assert.equal(presetIsolation('preset', [run('tools-within-servers'), run('no-evidence', false)]), 'tool-restricted-preset');
  assert.equal(presetIsolation('preset', [run('tools-within-servers'), run('tool-outside-servers', false)]), 'template-unrestricted');
  assert.equal(presetIsolation('preset', [run('no-evidence', false)]), 'template-unrestricted');
  assert.equal(presetIsolation('builtin', []), 'builtin-baseline');
});

test('claude-code-stream/1 on a stored Claude Code 2.1.301 init event: exactly the seven Practonaut tools and one server', () => {
  const init = fixture('bench/claude-code/init-2.1.301.jsonl');
  // The tools Practonaut's bridge advertises, written here by hand.
  const SEVEN = ['observe', 'list_actions', 'act', 'undo', 'reset', 'explain_result', 'check_result'];
  const naming = PRESET_INFO['claude-code']!.toolName;
  const read = toolEvidence(init, 'practonaut', SEVEN, naming);
  assert.deepEqual(read, { tools: { names: ['mcp__practonaut__act', 'mcp__practonaut__check_result', 'mcp__practonaut__explain_result', 'mcp__practonaut__list_actions', 'mcp__practonaut__observe', 'mcp__practonaut__reset', 'mcp__practonaut__undo'], omitted: 0 }, evidence: 'tools-within-servers' });
  // A slash command the server offers is not a tool; the event's own apiKeySource reads as its login.
  assert.deepEqual(attestedBilling('none'), { class: 'subscription', source: 'client-attested', via: 'claude-code-stream/1:init.apiKeySource' });
  const event = JSON.parse(init) as Record<string, unknown>;
  const variant = (change: (value: Record<string, unknown>) => void): string => { const copy = structuredClone(event); change(copy); return JSON.stringify(copy) + '\n'; };
  // Any other tool — a shell or file tool included — is a tool outside; so is a name that does not fit, or a sixth tool the bridge never advertised.
  assert.equal(toolEvidence(variant(value => { (value.tools as string[]).push('Bash'); }), 'practonaut', SEVEN, naming).evidence, 'tool-outside-servers');
  assert.equal(toolEvidence(variant(value => { (value.tools as string[]).push('mcp__practonaut__evil tool'); }), 'practonaut', SEVEN, naming).evidence, 'tool-outside-servers');
  assert.equal(toolEvidence(init, 'practonaut', SEVEN.slice(1), naming).evidence, 'tool-outside-servers');
  assert.equal(toolEvidence(variant(value => { value.tools = Array.from({ length: 257 }, () => 'mcp__practonaut__act'); }), 'practonaut', SEVEN, naming).evidence, 'tool-outside-servers');
  // The listed MCP servers must be exactly the run's server.
  assert.equal(toolEvidence(variant(value => { (value.mcp_servers as unknown[]).push({ name: 'other', status: 'connected' }); }), 'practonaut', SEVEN, naming).evidence, 'tool-outside-servers');
  assert.equal(toolEvidence(variant(value => { delete value.mcp_servers; }), 'practonaut', SEVEN, naming).evidence, 'no-evidence');
  // No init event, or no tool list: no evidence.
  assert.equal(toolEvidence('{"type":"result"}\n', 'practonaut', SEVEN, naming).evidence, 'no-evidence');
  assert.equal(toolEvidence(variant(value => { delete value.tools; }), 'practonaut', SEVEN, naming).evidence, 'no-evidence');
  // apiKeySource as /3 stores it: the parser's list, else "other"; billing from it.
  assert.deepEqual(['none', 'ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key', 'user', null].map(apiKeySourceValue), ['none', 'ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key', 'other', null]);
  assert.deepEqual(['ANTHROPIC_API_KEY', 'user'].map(value => attestedBilling(value)?.class), ['api-key', 'unknown']);
});

test('the preset\'s requested values: billing by kept credentials, the model variable as the client gets it, the vendor by the preset\'s mapping', () => {
  const preset = resolveAgent('claude-code'), template = resolveAgent('agent {mcp_config}');
  assert.deepEqual(requestedBilling(preset), { class: 'subscription', source: 'preset-requested' });
  assert.deepEqual(requestedBilling(preset, ['ANTHROPIC_API_KEY']), { class: 'api-key', source: 'preset-requested' });
  assert.deepEqual(requestedBilling(template), { class: 'unknown', source: 'none' });
  assert.deepEqual(requestedModelOf(preset, { ANTHROPIC_MODEL: 'claude-opus-5-5' }), { value: 'claude-opus-5-5', source: 'preset-requested' });
  assert.deepEqual(requestedModelOf(preset, {}), { value: null, source: 'none' });
  assert.deepEqual(requestedModelOf(template, { ANTHROPIC_MODEL: 'claude-opus-5-5' }), { value: null, source: 'none' });
  assert.deepEqual(vendorOf(preset, 'claude-haiku-5-5[1m]', { value: null, source: 'none' }), { value: 'anthropic', source: 'client-attested' });
  assert.deepEqual(vendorOf(preset, null, { value: 'claude-opus-5-5', source: 'preset-requested' }), { value: 'anthropic', source: 'preset-requested' });
  assert.deepEqual(vendorOf(preset, 'qwen3-coder', { value: null, source: 'none' }), { value: null, source: 'none' });
});

test('a client failure says whether it came before the model\'s first message and names the client\'s own code', () => {
  const init = '{"type":"system","subtype":"init","model":"m"}\n', assistant = '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}\n';
  assert.deepEqual(clientFailure(init + '{"type":"result","subtype":"success","is_error":true,"result":"x","api_error_status":429}\n'), { reason: 'usage_limit', detail: 'result is_error: usage or rate limit', code: '429', beforeModelWork: true });
  assert.deepEqual(clientFailure(init + assistant + '{"type":"result","subtype":"success","is_error":true,"result":"API Error: 529 overloaded"}\n'), { reason: 'api_error', detail: 'result is_error: API error', code: '529', beforeModelWork: false });
  // The client's own API-error message is not model work.
  assert.equal(clientFailure(init + '{"type":"assistant","isApiErrorMessage":true,"message":{"content":[{"type":"text","text":"API Error: 401 unauthorized"}]}}\n')?.beforeModelWork, true);
});

test('task identity: SHA-256 of the canonical projection, by hand; texts, ids and the seed are not part of it', () => {
  const world = validateWorld({ schema: 'practonaut.world/2', id: 'one', version: '1.0.0', app: { adapterId: 'excalidraw', versionRange: '0.18.1' }, tasks: [{ id: 'empty', title: { en: 'T', de: 'T' }, prompt: { en: 'P', de: 'P' }, goal: { op: 'true' }, hints: [{ en: 'H', de: 'H' }], errorClasses: [] }], provenance: { authors: ['a'] }, rights: { license: 'CC0-1.0' } }) as World;
  // {"identity":"practonaut.task-identity/1","task":{"errorClasses":[],"goal":{"op":"true"},"initialState":{"objects":{}}}}
  const byHand = createHash('sha256').update('{"identity":"practonaut.task-identity/1","task":{"errorClasses":[],"goal":{"op":"true"},"initialState":{"objects":{}}}}').digest('hex');
  assert.equal(TASK_IDENTITY, 'practonaut.task-identity/1');
  assert.equal(taskIdentity(world, 'empty', 1), byHand);
  assert.equal(taskIdentity(world, 'empty', 999), byHand);
  const retitled = validateWorld({ ...structuredClone(world), id: 'two', version: '2.0.0', tasks: [{ ...structuredClone(world.tasks[0]!), id: 'other', title: { en: 'X', de: 'X' }, prompt: { en: 'Y', de: 'Y' }, hints: [{ en: 'Z', de: 'Z' }] }] }) as World;
  assert.equal(taskIdentity(retitled, 'other', 1), byHand, 'titles, prompts, hints, ids and the world are not hashed');
  const limited = validateWorld({ ...structuredClone(world), tasks: [{ ...structuredClone(world.tasks[0]!), limits: { actions: 3 } }] }) as World;
  assert.notEqual(taskIdentity(limited, 'empty', 1), byHand, 'limits are hashed');
  const classed = validateWorld({ ...structuredClone(world), tasks: [{ ...structuredClone(world.tasks[0]!), errorClasses: [{ id: 'e', category: 'suboptimal', when: { op: 'false' }, explanation: { en: 'x', de: 'x' } }] }] }) as World;
  assert.equal(taskIdentity(classed, 'empty', 1), createHash('sha256').update('{"identity":"practonaut.task-identity/1","task":{"errorClasses":[{"op":"false"}],"goal":{"op":"true"},"initialState":{"objects":{}}}}').digest('hex'));
});

/** A world/2 world with three variant cases (layout offsets 0, 100, 200), under the given id. */
function threeCaseWorld(id: string, taskSet?: { id: string; version: string }): World {
  const raw = JSON.parse(fixture('ci-recipe/world/world.json')) as Record<string, unknown>;
  return validateWorld({ ...raw, id, version: '1.1.0', ...(taskSet ? { taskSet } : {}), variants: { generator: 'finite-seeded-v1', cases: [0, 100, 200].map((x, index) => ({ id: `case-${index}`, labels: {}, params: {}, layoutOffset: { x, y: 0 } })) } });
}
const handCase = (id: string, seed: number): number => parseInt(createHash('sha256').update(`{"seed":${seed},"world":{"id":"${id}","version":"1.1.0"}}`, 'utf8').digest('hex').slice(0, 8), 16) % 3;
const SEEDS = [1, 2, 3, 4, 5];
/** A session report of `world` (one run per seed, passing as `pass` says) whose identities come from the world. */
function benchOf(world: World, adapterId: string, contentHash: string, pass: (seed: number) => boolean): BenchReportV3 {
  const identities = { 'review-and-send': Object.fromEntries(SEEDS.map(seed => [seed, taskIdentity(world, 'review-and-send', seed)])) };
  return validateBenchReportV3(sessionReport({ 'review-and-send': Object.fromEntries(SEEDS.map(seed => [seed, [pass(seed)]])) }, { identities, worldId: world.id, contentHash, adapterId }));
}

test('across worlds compare pairs by task identity: without a task-set key the hand-computed cases decide the pairs; with one, every identity pairs at equal counts', () => {
  const cases = { excalidraw: SEEDS.map(seed => handCase('excalidraw-library', seed)), drawio: SEEDS.map(seed => handCase('drawio-library', seed)) };
  assert.deepEqual(cases, { excalidraw: [0, 1, 1, 2, 1], drawio: [2, 0, 0, 2, 0] });
  const excalidraw = threeCaseWorld('excalidraw-library'), drawio = threeCaseWorld('drawio-library');
  assert.deepEqual(SEEDS.map(seed => variantIndex(drawio, seed)), cases.drawio);
  // One identity per case, the same on both worlds (the identity holds no world id).
  const identityOfCase = (world: World, which: number[], wanted: number): string => taskIdentity(world, 'review-and-send', SEEDS[which.indexOf(wanted)]!);
  for (const wanted of [0, 2]) assert.equal(identityOfCase(excalidraw, cases.excalidraw, wanted), identityOfCase(drawio, cases.drawio, wanted));
  assert.equal(new Set([0, 1, 2].map(wanted => identityOfCase(excalidraw, cases.excalidraw, wanted))).size, 3);
  const a = benchOf(excalidraw, 'excalidraw', hash('a'), () => true), b = benchOf(drawio, 'drawio', hash('b'), seed => seed !== 1);
  const comparison = compareReports(a, b);
  assert.equal(comparison.pairing, 'identity');
  // Expected, from the hand-computed cases: case 0 is seed 1 against seeds 2, 3, 5; case 2 is seed 4
  // against seeds 1, 4; case 1 (seeds 2, 3, 5 on the baseline) is not on the candidate.
  const name = (seeds: number[]): string[] => seeds.map(seed => `review-and-send seed ${seed}`);
  assert.deepEqual(comparison.pairs.map(pair => [pair.kind, pair.names, pair.baseline?.repeats ?? 0, pair.candidate?.repeats ?? 0, pair.unequalRuns === true]), [
    ['paired', { baseline: name([1]), candidate: name([2, 3, 5]) }, 1, 3, true],
    ['missing', { baseline: name([2, 3, 5]), candidate: [] }, 3, 0, false],
    ['paired', { baseline: name([4]), candidate: name([1, 4]) }, 1, 2, true],
  ]);
  assert.deepEqual(comparison.notCompared.map(pair => pair.side), ['candidate']);
  // Both paired identities have unequal run counts: no rate claim, and each is a caveat with both counts.
  assert.deepEqual([comparison.verdict, comparison.paired, comparison.baseline.instances], ['no_equal_runs', 2, 0]);
  assert.deepEqual(comparison.caveats.filter(caveat => caveat.field === 'runCounts').map(caveat => [caveat.baseline, caveat.candidate]), [
    ['review-and-send seed 1: 1', 'review-and-send seed 2, review-and-send seed 3, review-and-send seed 5: 3'], ['review-and-send seed 4: 1', 'review-and-send seed 1, review-and-send seed 4: 2'],
  ]);
  // No regression labels across worlds; case 2 passed 1/1 on the baseline and 1/2 on the candidate (at least half): the same outcome.
  assert.deepEqual([comparison.regressions.length, comparison.fixes.length, comparison.regressionSignal, comparison.configFlips.length], [0, 0, false, 0]);
  assert.ok(comparison.caveats.some(caveat => caveat.field === 'identityPairing'));
  const text = renderCompareTable({ report: a, verification: 'consistency-checked' }, { report: b, verification: 'consistency-checked' }, comparison);
  assert.match(text, /no rate verdict: every paired task identity has a different number of runs on the two sides/);
  // Never a regression across worlds, and never the gate's "incomplete" (the gate refuses such a pair).
  assert.match(text, /Instance regressions: none across worlds: a different outcome on two configurations is a difference between them, never an instance regression/);
  assert.deepEqual(comparison.incomplete, []);
  assert.match(text, /Paired across worlds by task identity \(PADR-0044\)/);
  assert.match(text, /review-and-send seed 2, review-and-send seed 3, review-and-send seed 5 \(baseline\) · — \(candidate\): no run on the candidate/);
  // A regression gate compares one world with itself: refused by name.
  assert.throws(() => compareReports(a, b, { regressionGate: true }), (error: unknown) => error instanceof CompareError && error.differences.map(difference => difference.field).join() === 'world');
  // One task set: the same cases for the same seeds, every identity paired, equal run counts, a rate verdict.
  const keyed = threeCaseWorld('drawio-library', { id: 'excalidraw-library', version: '1.1.0' });
  const c = benchOf(keyed, 'drawio', hash('c'), seed => seed !== 4);
  const same = compareReports(a, c);
  assert.deepEqual([same.paired, same.notCompared.length, same.pairs.every(pair => !pair.unequalRuns), same.caveats.some(caveat => caveat.field === 'runCounts')], [3, 0, true, false]);
  assert.deepEqual(same.pairs.map(pair => [pair.baseline!.repeats, pair.candidate!.repeats]), [[1, 1], [3, 3], [1, 1]]);
  assert.equal(same.verdict, 'not_distinguishable');
  // Case 2 (seed 4) failed on the candidate: a difference between the configurations, not a regression.
  assert.deepEqual(same.configFlips.map(pair => [pair.flip, pair.names]), [['config-down', { baseline: name([4]), candidate: name([4]) }]]);
  // The same applications and toolchains in two worlds: the world difference stands, as in /2.
  assert.throws(() => compareReports(a, benchOf(keyed, 'excalidraw', hash('c'), () => true)), (error: unknown) => error instanceof CompareError && error.differences.some(difference => difference.field === 'world'));
});

test('within one world, seeds that select one variant share an identity: compare names the number of distinct identities', () => {
  const shared = { T: { 1: hash('7'), 2: hash('7'), 3: hash('8') } };
  const a = validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [true], 3: [true] } }, { identities: shared }));
  const comparison = compareReports(a, a);
  assert.equal(comparison.pairing, 'instance');
  assert.deepEqual(comparison.caveats.filter(caveat => caveat.field === 'sharedIdentities'), [{ field: 'sharedIdentities', baseline: '2 / 3', candidate: '2 / 3' }]);
  // A different --checks is a comparability field; a different client version a caveat.
  assert.throws(() => compareReports(a, validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [true], 3: [true] } }, { identities: shared, change: value => { value.settings = { ...value.settings, checks: 2 }; } }))), (error: unknown) => error instanceof CompareError && error.differences.map(difference => difference.field).join() === 'checks');
  const newer = validateBenchReportV3(sessionReport({ T: { 1: [true], 2: [true], 3: [true] } }, { identities: shared, change: value => { value.agent = { ...value.agent, clientVersion: { value: '2.1.302', source: 'command-output' } }; } }));
  assert.deepEqual(compareReports(a, newer).caveats.filter(caveat => caveat.field === 'clientVersion'), [{ field: 'clientVersion', baseline: 'none', candidate: '2.1.302' }]);
  // A /2 report beside a /3 report of the same world: the report format is a caveat, not a refusal.
  const v2 = JSON.parse(fixture('bench/v2/report.json'));
  assert.deepEqual(compareReports(validateBenchReport(v2), validateBenchReport(v2)).caveats, []);
});

test('every surface names the level; an artifact report renders without session figures and says the foreign server has no sandbox', async () => {
  const artifact = validateBenchReportV3(artifactReport());
  const table = renderTable(artifact, 'en');
  assert.match(table, /^1\/2 passed · /m);
  assert.match(table, /artifact-judged, end-state only, no Practonaut history/);
  assert.match(table, /Foreign MCP server: no sandbox/);
  assert.match(table, /The foreign MCP server’s code runs as the same OS user as Practonaut, without a sandbox\./);
  assert.match(table, /at most 50 forwarded tool calls per run/);
  assert.match(table, /6 forwarded tool calls over all runs/);
  assert.equal(/mean actions|efficiency/.test(table), false);
  const html = renderHtml(artifact, ':root{}', 'de');
  assert.match(html, /nach Artefakt bewertet, nur Endzustand, ohne Practonaut-Verlauf/);
  assert.match(html, /kein Ergebnis: die Startdatei/);
  assert.equal(/<script|style="/i.test(html), false);
  const junit = renderJunit(artifact, 'en');
  assert.match(junit, /<property name="practonaut\.verdictLevel" value="artifact"\/>/);
  assert.match(junit, /<property name="practonaut\.toolchain" value="excalidraw-mcp-0\.3\.2"\/>/);
  assert.match(junit, /<property name="practonaut\.sandbox" value="The foreign MCP server’s code runs as the same OS user as Practonaut, without a sandbox\."\/>/);
  const v2 = validateBenchReport(JSON.parse(fixture('bench/v2/report.json')));
  assert.match(renderJunit(v2, 'en'), /<property name="practonaut\.verdictLevel" value="session"\/>/);
  assert.match(renderJunit(v2, 'en'), /<property name="practonaut\.app" value="excalidraw 0\.18\.1"\/>/);
  const badge = renderBadge(artifact, await readTokensCss());
  assert.match(badge, /artifact-judged · consistency-checked only · tools not restricted · no sandbox/);
  // The view of a /3 report is the report itself, read from /3.
  const view = toView(artifact);
  assert.equal(view.readFrom, 'practonaut.bench/3');
  assert.deepEqual(view.runs, artifact.runs);
});

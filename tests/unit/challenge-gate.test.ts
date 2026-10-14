// The preregistered challenge gate (PADR-0040). Reports are hand-built; every expected number is
// counted by hand from the outcome tables below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGate, heldOutSize, renderGate, GateInputError, RUNS_AFTER_FIRST_ROUNDS, type GateInput } from '../../src/challenge/gate.ts';
import { BENCH_SCHEMA_V2, ISOLATION_OF, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';

const hash = (c: string): string => c.repeat(64);
const N = 26;
const tasks = Array.from({ length: N }, (_, index) => `repair-${1_000_100 + index}`);

function report(agent: 'oracle' | 'random' | string, passes: boolean[], options: { infra?: number[]; missing?: number[]; seeds?: number[]; world?: string; repeats?: number } = {}): BenchReportV2 {
  const builtin = agent === 'oracle' || agent === 'random';
  const runs: BenchRunV2[] = tasks.flatMap((taskId, index) => {
    if (options.missing?.includes(index)) return [];
    const infra = options.infra?.includes(index) === true;
    const checker = infra ? null : { session: { passed: passes[index]!, errorClasses: [] }, native: { passed: passes[index]!, errorClasses: [] } };
    return [{ id: `${taskId}-s1-r1`, taskId, seed: 1, repeat: 1, status: infra ? 'infra_error' as const : 'completed' as const, pass: !infra && passes[index]!, actions: 3, acceptedActions: 3, rejectedActions: 0, undos: 0, resets: 0,
      toolCalls: { observe: 1, act: 3, undo: 0, reset: 0, check: 1, total: 5 }, wallMs: 1000, referenceActions: 3, checker, agentExitCode: infra ? null : 0, ...(checker ? { artifacts: { session: hash('a'), native: hash('b'), checker: hash('c') } } : {}) }];
  });
  const seeds = options.seeds ?? tasks.map((_, index) => 1_000_100 + index);
  return {
    schema: BENCH_SCHEMA_V2, createdAt: '2026-11-02T10:00:00.000Z',
    environment: { practonaut: '0.2.0', excalidraw: '0.18.1', node: 'v22.22.3', os: { platform: 'darwin', release: '25.0', arch: 'arm64' }, mirror: 'required',
      world: { source: 'own', worldId: 'challenge-repair-r1', version: '1.0.0', contentHash: hash(options.world ?? 'd'), package: { path: 'world.pnworld', sha256: hash('e') },
        generated: tasks.map((taskId, index) => ({ taskId, id: 'challenge-repair', version: '1.0.0', seed: seeds[index]!, parameters: { difficulty: 2 } })) } },
    agent: builtin ? { kind: 'builtin', name: agent, command: [], isolation: ISOLATION_OF.builtin, model: null, modelSource: 'none', apiKeySource: null, keptEnv: [] }
      : { kind: 'preset', name: 'claude-code', command: ['claude'], isolation: ISOLATION_OF.preset, model: agent, modelSource: 'client-attested', apiKeySource: 'none', keptEnv: [] },
    settings: { tasks, seeds: [1], repeats: options.repeats ?? 1, timeoutSeconds: 600, maxActions: 50, mirror: 'required', prompt: builtin ? '' : 'p' },
    references: { path: 'references.json', sha256: hash('f'), tasks: tasks.map(taskId => ({ taskId, source: 'oracle-file' as const, actions: 3, minimal: true })) },
    runs, ...(runs.length < N ? { interrupted: { plannedRuns: N } } : {}), summary: summarize(runs, 1),
  };
}
/** First k instances pass. */
const first = (k: number): boolean[] => tasks.map((_, index) => index < k);
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
function input(strong: boolean[], middle: boolean[], weak: boolean[], extra: Partial<GateInput> = {}): GateInput {
  return { family: 'repair', round: 1, oracle: report('oracle', first(N)), random: report('random', first(0)), ladder: [report(OPUS, strong), report(SONNET, middle), report(HAIKU, weak)],
    strongest: OPUS, weakest: HAIKU, nearMisses: { total: 104, passed: 0 }, developmentRuns: 9, ...extra };
}

test('the hand-built reports are valid bench/2 reports', () => {
  for (const value of [report('oracle', first(N)), report(OPUS, first(15)), report(HAIKU, first(4), { infra: [20] })]) assert.doesNotThrow(() => validateBenchReportV2(value));
});

test('the preregistered round: 9 development runs and 26 held-out instances, 87 model runs; nothing else', () => {
  assert.deepEqual([9, 0, 10, 12].map(heldOutSize), [26, null, null, null]);
  assert.equal(RUNS_AFTER_FIRST_ROUNDS, 465 - 5 * 87);
  assert.equal(RUNS_AFTER_FIRST_ROUNDS, 30);
});

test('a family passes: headroom 15/26, 11 more instances than the weakest, McNemar p = 0.00098', () => {
  // Strongest passes instances 0–14, weakest 0–3: b = 11 one way, c = 0 the other; p = 2 · (1/2)^11.
  const result = computeGate(input(first(15), first(10), first(4)));
  assert.equal(result.verdict, 'passes');
  assert.equal(result.instances, 26);
  assert.deepEqual([result.strongest.passed, result.weakest.passed], [15, 4]);
  assert.deepEqual([result.discordant.strongestOnly, result.discordant.weakestOnly], [11, 0]);
  assert.ok(Math.abs(result.discordant.p - 2 / 2048) < 1e-12);
  assert.equal(result.modelRuns, 78);
  assert.equal(result.ladderLabel, 'ladder: Claude models only');
  assert.ok(result.criteria.every(criterion => criterion.met));
  // Wilson interval for 15/26, computed separately (Python, same formula): 0.3895–0.7446.
  assert.ok(Math.abs(result.strongest.interval.low - 0.3895) < 1e-3 && Math.abs(result.strongest.interval.high - 0.7446) < 1e-3);
  // Power at 26 instances, P(D ≥ 6) for D ~ Bin(26, 0.2), summed separately: 0.4225.
  assert.ok(Math.abs(result.power - 0.4225) < 1e-3);
  const markdown = renderGate(result);
  assert.match(markdown, /\*\*Verdict: the family passes this round\.\*\* ladder: Claude models only\./);
  assert.match(markdown, /\| headroom \| 15\/26 \(57\.7 %\) \| strongest passes 10 %–80 % of the instances \| yes \|/);
  assert.match(markdown, /\| mcnemar \| b = 11, c = 0, p = 0\.0010 \|/);
  assert.match(markdown, /\| budget \| 87 model runs \(78 gate \+ 9 development\) \|/);
  assert.match(markdown, /with probability 0\.42;/);
  assert.doesNotMatch(markdown, /Second round/, 'a passing family needs no second round');
});

test('a family that does not pass: the report says the budget is exhausted and a maintainer decides', () => {
  const markdown = renderGate(computeGate(input(first(10), first(8), first(6))));
  assert.match(markdown, /Second round: budget exhausted — a maintainer decides on a second round\. After the five first rounds of 87 model runs each the release has 30 of the 465 runs/);
});

test('headroom: the strongest passes 10 % to 80 % of the instances, both ends included', () => {
  const headroom = (k: number): boolean => computeGate(input(first(k), first(1), first(0))).criteria.find(c => c.name === 'headroom')!.met;
  assert.deepEqual([2, 3, 20, 21].map(headroom), [false, true, true, false], '7.7 %, 11.5 %, 76.9 %, 80.8 %');
  assert.equal(computeGate(input(first(21), first(12), first(5))).verdict, 'does not pass');
});

test('discrimination needs 20 points and p < 0.05 on the discordant instances', () => {
  // 10 vs 5 passes: 19.2 points, b = 5, c = 0 → p = 0.0625: both fail.
  const small = computeGate(input(first(10), first(8), first(5)));
  assert.deepEqual(small.criteria.filter(c => !c.met).map(c => c.name), ['difference', 'mcnemar']);
  // Crossing outcomes: strongest passes 0–12 (13), weakest 8–14 (7): 6/26 = 23.1 points (met);
  // b = 8 (0–7), c = 2 (13–14), p = 2 · (1 + 10 + 45)/1024 = 0.1094 (not met).
  const weak = tasks.map((_, index) => index >= 8 && index <= 14);
  const crossing = computeGate(input(first(13), first(9), weak));
  assert.deepEqual([crossing.discordant.strongestOnly, crossing.discordant.weakestOnly], [8, 2]);
  assert.ok(Math.abs(crossing.discordant.p - 112 / 1024) < 1e-12);
  assert.equal(crossing.criteria.find(c => c.name === 'difference')!.met, true);
  assert.equal(crossing.criteria.find(c => c.name === 'mcnemar')!.met, false);
  assert.equal(crossing.verdict, 'does not pass');
});

test('every run counts: infra errors and missing runs fail, and more than 5 % of ladder runs voids the round', () => {
  // Two infra errors for the strongest and two missing runs for the weakest: 4 of 78 = 5.1 % > 5 %.
  const result = computeGate({ ...input(first(15), first(10), first(4)), ladder: [report(OPUS, first(15), { infra: [0, 1] }), report(SONNET, first(10)), report(HAIKU, first(4), { missing: [24, 25] })] });
  assert.equal(result.strongest.passed, 13, 'the two infra errors are not passed');
  assert.equal(result.weakest.missing, 2);
  assert.ok(Math.abs(result.infraShare - 4 / 78) < 1e-12);
  assert.equal(result.verdict, 'void');
  // Three of 78 (3.8 %) does not void it.
  const three = computeGate({ ...input(first(15), first(10), first(4)), ladder: [report(OPUS, first(15), { infra: [0, 1] }), report(SONNET, first(10)), report(HAIKU, first(4), { missing: [25] })] });
  assert.notEqual(three.verdict, 'void');
});

test('baselines: oracle 100 %, random at most 5 %, every near miss fails', () => {
  const base = input(first(15), first(10), first(4));
  assert.equal(computeGate({ ...base, oracle: report('oracle', first(25)) }).criteria.find(c => c.name === 'oracle')!.met, false);
  assert.equal(computeGate({ ...base, random: report('random', first(1)) }).criteria.find(c => c.name === 'random')!.met, true, '1 of 26 = 3.8 %');
  assert.equal(computeGate({ ...base, random: report('random', first(2)) }).criteria.find(c => c.name === 'random')!.met, false, '2 of 26 = 7.7 %');
  assert.equal(computeGate({ ...base, nearMisses: { total: 104, passed: 1 } }).verdict, 'does not pass');
  assert.equal(computeGate({ ...base, nearMisses: { total: 0, passed: 0 } }).verdict, 'does not pass', 'no near miss checked is not "every near miss fails"');
});

test('refuses rounds that break the preregistration', () => {
  const refused = (value: GateInput, message: RegExp): void => assert.throws(() => computeGate(value), (error: unknown) => error instanceof GateInputError && message.test(error.message), message.source);
  const base = input(first(15), first(10), first(4));
  refused({ ...base, developmentRuns: 10 }, /the preregistered round has 9 development runs \(3 instances × 3 agents\), not 10/);
  refused({ ...base, oracle: report('oracle', first(N), { world: 'x' }) }, /different worlds/);
  refused({ ...base, ladder: [report(OPUS, first(15), { repeats: 2 }), base.ladder[1]!, base.ladder[2]!] }, /one run per agent per instance/);
  refused({ ...base, ladder: [base.ladder[0]!, report(OPUS, first(10)), base.ladder[2]!] }, /three different models/);
  refused({ ...base, strongest: 'claude-unknown' }, /preregistered/);
  refused({ ...base, weakest: OPUS }, /preregistered/);
  refused({ ...base, oracle: report('oracle', first(N), { seeds: tasks.map((_, index) => index + 1) }) }, /held-out range/);
  refused({ ...base, previousSeeds: [1_000_105] }, /reuses held-out instances/);
  refused({ ...base, round: 3 }, /at most 2 rounds/);
  refused({ ...base, oracle: report('random', first(0)) }, /oracle report/);
});

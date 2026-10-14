// The preregistered challenge gate (PADR-0040). Reports are hand-built; every expected number is
// counted by hand from the outcome tables below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGate, renderGate, GateInputError, type GateInput } from '../../src/challenge/gate.ts';
import { BENCH_SCHEMA_V2, ISOLATION_OF, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';

const hash = (c: string): string => c.repeat(64);
const N = 24;
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
    strongest: OPUS, weakest: HAIKU, nearMisses: { total: 96, passed: 0 }, developmentRuns: 18, ...extra };
}

test('the hand-built reports are valid bench/2 reports', () => {
  for (const value of [report('oracle', first(N)), report(OPUS, first(14)), report(HAIKU, first(4), { infra: [20] })]) assert.doesNotThrow(() => validateBenchReportV2(value));
});

test('a family passes: headroom 14/24, 10 more instances than the weakest, McNemar p = 0.00195', () => {
  // Strongest passes instances 0–13, weakest 0–3: b = 10 discordant one way, c = 0 the other way.
  // p = 2 · (1/2)^10 = 0.001953; difference 14/24 − 4/24 = 41.7 points.
  const result = computeGate(input(first(14), first(9), first(4)));
  assert.equal(result.verdict, 'passes');
  assert.equal(result.instances, 24);
  assert.deepEqual([result.strongest.passed, result.weakest.passed], [14, 4]);
  assert.deepEqual([result.discordant.strongestOnly, result.discordant.weakestOnly], [10, 0]);
  assert.ok(Math.abs(result.discordant.p - 2 / 1024) < 1e-12);
  assert.equal(result.modelRuns, 72);
  assert.equal(result.ladderLabel, 'ladder: Claude models only');
  assert.ok(result.criteria.every(criterion => criterion.met));
  // Wilson interval for 14/24 (hand calculation): centre (0.583333 + 0.080031)/1.160060 = 0.571836,
  // half 1.689530 · √(0.0101273 + 0.0016673) = 0.183488 → 0.3883–0.7553.
  assert.ok(Math.abs(result.strongest.interval.low - 0.3883) < 1e-3 && Math.abs(result.strongest.interval.high - 0.7553) < 1e-3);
  const markdown = renderGate(result);
  assert.match(markdown, /\*\*Verdict: the family passes this round\.\*\* ladder: Claude models only\./);
  assert.match(markdown, /\| headroom \| 14\/24 \(58\.3 %\) \| strongest passes 10 %–80 % of the instances \| yes \|/);
  assert.match(markdown, /\| mcnemar \| b = 10, c = 0, p = 0\.0020 \|/);
  assert.match(markdown, /\| budget \| 90 model runs \(72 gate \+ 18 development\) \|/);
});

test('headroom fails when the strongest passes more than 80 % (20 of 24 = 83.3 %)', () => {
  const result = computeGate(input(first(20), first(12), first(4)));
  assert.equal(result.verdict, 'does not pass');
  assert.equal(result.criteria.find(c => c.name === 'headroom')!.met, false);
  assert.equal(computeGate(input(first(2), first(1), first(0))).criteria.find(c => c.name === 'headroom')!.met, false, '2 of 24 = 8.3 % is below 10 %');
  assert.equal(computeGate(input(first(3), first(1), first(0))).criteria.find(c => c.name === 'headroom')!.met, true, '3 of 24 = 12.5 %');
});

test('discrimination needs 20 points and p < 0.05 on the discordant instances', () => {
  // 10 vs 6 passes: 16.7 points, b = 4, c = 0 → p = 0.125: both fail.
  const small = computeGate(input(first(10), first(8), first(6)));
  assert.deepEqual(small.criteria.filter(c => !c.met).map(c => c.name), ['difference', 'mcnemar']);
  // Crossing outcomes: strongest passes 0–11 (12), weakest passes 8–14 (7): 12/24 − 7/24 = 20.8
  // points (met); b = 8 (0–7), c = 3 (12–14), p = 2 · (1 + 11 + 55 + 165)/2048 = 0.2266 (not met).
  const weak = tasks.map((_, index) => index >= 8 && index <= 14);
  const crossing = computeGate(input(first(12), first(9), weak));
  assert.deepEqual([crossing.discordant.strongestOnly, crossing.discordant.weakestOnly], [8, 3]);
  assert.ok(Math.abs(crossing.discordant.p - 464 / 2048) < 1e-12);
  assert.equal(crossing.criteria.find(c => c.name === 'difference')!.met, true);
  assert.equal(crossing.criteria.find(c => c.name === 'mcnemar')!.met, false);
  assert.equal(crossing.verdict, 'does not pass');
});

test('every run counts: infra errors and missing runs fail, and more than 5 % of ladder runs voids the round', () => {
  // Two infra errors for the strongest and two missing runs for the weakest: 4 of 72 = 5.6 % > 5 %.
  const result = computeGate({ ...input(first(14), first(9), first(4)), ladder: [report(OPUS, first(14), { infra: [0, 1] }), report(SONNET, first(9)), report(HAIKU, first(4), { missing: [22, 23] })] });
  assert.equal(result.strongest.passed, 12, 'the two infra errors are not passed');
  assert.equal(result.weakest.missing, 2);
  assert.ok(Math.abs(result.infraShare - 4 / 72) < 1e-12);
  assert.equal(result.verdict, 'void');
  // Three of 72 (4.2 %) does not void it.
  const three = computeGate({ ...input(first(14), first(9), first(4)), ladder: [report(OPUS, first(14), { infra: [0, 1] }), report(SONNET, first(9)), report(HAIKU, first(4), { missing: [23] })] });
  assert.notEqual(three.verdict, 'void');
});

test('baselines: oracle 100 %, random at most 5 %, every near miss fails, at most 100 model runs', () => {
  assert.equal(computeGate({ ...input(first(14), first(9), first(4)), oracle: report('oracle', first(23)) }).criteria.find(c => c.name === 'oracle')!.met, false);
  assert.equal(computeGate({ ...input(first(14), first(9), first(4)), random: report('random', first(1)) }).criteria.find(c => c.name === 'random')!.met, true, '1 of 24 = 4.2 %');
  assert.equal(computeGate({ ...input(first(14), first(9), first(4)), random: report('random', first(2)) }).criteria.find(c => c.name === 'random')!.met, false, '2 of 24 = 8.3 %');
  assert.equal(computeGate({ ...input(first(14), first(9), first(4)), nearMisses: { total: 96, passed: 1 } }).verdict, 'does not pass');
  assert.equal(computeGate({ ...input(first(14), first(9), first(4)), nearMisses: { total: 0, passed: 0 } }).verdict, 'does not pass', 'no near miss checked is not "every near miss fails"');
  assert.equal(computeGate({ ...input(first(14), first(9), first(4)), developmentRuns: 29 }).criteria.find(c => c.name === 'budget')!.met, false, '72 + 29 = 101');
});

test('refuses rounds that break the preregistration', () => {
  const refused = (value: GateInput, message: RegExp): void => assert.throws(() => computeGate(value), (error: unknown) => error instanceof GateInputError && message.test(error.message), message.source);
  const base = input(first(14), first(9), first(4));
  refused({ ...base, oracle: report('oracle', first(N), { world: 'x' }) }, /different worlds/);
  refused({ ...base, ladder: [report(OPUS, first(14), { repeats: 2 }), base.ladder[1]!, base.ladder[2]!] }, /one run per agent per instance/);
  refused({ ...base, ladder: [base.ladder[0]!, report(OPUS, first(9)), base.ladder[2]!] }, /three different models/);
  refused({ ...base, strongest: 'claude-unknown' }, /preregistered/);
  refused({ ...base, weakest: OPUS }, /preregistered/);
  refused({ ...base, oracle: report('oracle', first(N), { seeds: tasks.map((_, index) => index + 1) }) }, /different worlds|held-out range/);
  refused({ ...base, previousSeeds: [1_000_105] }, /reuses held-out instances/);
  refused({ ...base, round: 3 }, /at most 2 rounds/);
  refused({ ...base, oracle: report('random', first(0)) }, /oracle report/);
});

// The preregistered challenge gate (PADR-0040). Reports are hand-built; every expected number is
// counted by hand from the outcome tables below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGate, heldOutSize, renderGate, GateInputError, type GateInput } from '../../src/challenge/gate.ts';
import { BENCH_SCHEMA_V2, ISOLATION_OF, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';

const hash = (c: string): string => c.repeat(64);
const N = 30;
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
    strongest: OPUS, weakest: HAIKU, nearMisses: { total: 120, passed: 0 }, developmentRuns: 9, ...extra };
}

test('the hand-built reports are valid bench/2 reports', () => {
  for (const value of [report('oracle', first(N)), report(OPUS, first(17)), report(HAIKU, first(4), { infra: [20] })]) assert.doesNotThrow(() => validateBenchReportV2(value));
});

test('the preregistered held-out size: min(30, ⌊(100 − development runs)/3⌋), never below 24', () => {
  assert.deepEqual([0, 9, 10, 11, 13, 14, 28, 29].map(heldOutSize), [30, 30, 30, 29, 29, 28, 24, 23]);
});

test('a family passes: headroom 17/30, 12 more instances than the weakest, McNemar p = 0.00049', () => {
  // Strongest passes instances 0–16, weakest 0–4: b = 12 one way, c = 0 the other; p = 2 · (1/2)^12.
  const result = computeGate(input(first(17), first(12), first(5)));
  assert.equal(result.verdict, 'passes');
  assert.equal(result.instances, 30);
  assert.deepEqual([result.strongest.passed, result.weakest.passed], [17, 5]);
  assert.deepEqual([result.discordant.strongestOnly, result.discordant.weakestOnly], [12, 0]);
  assert.ok(Math.abs(result.discordant.p - 2 / 4096) < 1e-12);
  assert.equal(result.modelRuns, 90);
  assert.equal(result.ladderLabel, 'ladder: Claude models only');
  assert.ok(result.criteria.every(criterion => criterion.met));
  // Wilson interval for 17/30, computed separately (Python, same formula): 0.3920–0.7262.
  assert.ok(Math.abs(result.strongest.interval.low - 0.3920) < 1e-3 && Math.abs(result.strongest.interval.high - 0.7262) < 1e-3);
  // Power at 30 instances, P(D ≥ 6) for D ~ Bin(30, 0.2), summed separately: 0.572.
  assert.ok(Math.abs(result.power - 0.572) < 1e-3);
  const markdown = renderGate(result);
  assert.match(markdown, /\*\*Verdict: the family passes this round\.\*\* ladder: Claude models only\./);
  assert.match(markdown, /\| headroom \| 17\/30 \(56\.7 %\) \| strongest passes 10 %–80 % of the instances \| yes \|/);
  assert.match(markdown, /\| mcnemar \| b = 12, c = 0, p = 0\.0005 \|/);
  assert.match(markdown, /\| budget \| 99 model runs \(90 gate \+ 9 development\) \|/);
  assert.match(markdown, /with probability 0\.57;/);
});

test('headroom: the strongest passes 10 % to 80 % of the instances, both ends included', () => {
  const headroom = (k: number): boolean => computeGate(input(first(k), first(1), first(0))).criteria.find(c => c.name === 'headroom')!.met;
  assert.deepEqual([2, 3, 24, 25].map(headroom), [false, true, true, false], '6.7 %, 10 %, 80 %, 83.3 %');
  assert.equal(computeGate(input(first(25), first(12), first(5))).verdict, 'does not pass');
});

test('discrimination needs 20 points and p < 0.05 on the discordant instances', () => {
  // 12 vs 7 passes: 16.7 points, b = 5, c = 0 → p = 0.0625: both fail.
  const small = computeGate(input(first(12), first(9), first(7)));
  assert.deepEqual(small.criteria.filter(c => !c.met).map(c => c.name), ['difference', 'mcnemar']);
  // Crossing outcomes: strongest passes 0–14 (15), weakest 10–17 (8): 7/30 = 23.3 points (met);
  // b = 10 (0–9), c = 3 (15–17), p = 2 · (1 + 13 + 78 + 286)/8192 = 0.0923 (not met).
  const weak = tasks.map((_, index) => index >= 10 && index <= 17);
  const crossing = computeGate(input(first(15), first(9), weak));
  assert.deepEqual([crossing.discordant.strongestOnly, crossing.discordant.weakestOnly], [10, 3]);
  assert.ok(Math.abs(crossing.discordant.p - 756 / 8192) < 1e-12);
  assert.equal(crossing.criteria.find(c => c.name === 'difference')!.met, true);
  assert.equal(crossing.criteria.find(c => c.name === 'mcnemar')!.met, false);
  assert.equal(crossing.verdict, 'does not pass');
});

test('every run counts: infra errors and missing runs fail, and more than 5 % of ladder runs voids the round', () => {
  // Three infra errors for the strongest and two missing runs for the weakest: 5 of 90 = 5.6 % > 5 %.
  const result = computeGate({ ...input(first(17), first(12), first(5)), ladder: [report(OPUS, first(17), { infra: [0, 1, 2] }), report(SONNET, first(12)), report(HAIKU, first(5), { missing: [28, 29] })] });
  assert.equal(result.strongest.passed, 14, 'the three infra errors are not passed');
  assert.equal(result.weakest.missing, 2);
  assert.ok(Math.abs(result.infraShare - 5 / 90) < 1e-12);
  assert.equal(result.verdict, 'void');
  // Four of 90 (4.4 %) does not void it.
  const four = computeGate({ ...input(first(17), first(12), first(5)), ladder: [report(OPUS, first(17), { infra: [0, 1, 2] }), report(SONNET, first(12)), report(HAIKU, first(5), { missing: [29] })] });
  assert.notEqual(four.verdict, 'void');
});

test('baselines: oracle 100 %, random at most 5 %, every near miss fails, at most 100 model runs', () => {
  const base = input(first(17), first(12), first(5));
  assert.equal(computeGate({ ...base, oracle: report('oracle', first(29)) }).criteria.find(c => c.name === 'oracle')!.met, false);
  assert.equal(computeGate({ ...base, random: report('random', first(1)) }).criteria.find(c => c.name === 'random')!.met, true, '1 of 30 = 3.3 %');
  assert.equal(computeGate({ ...base, random: report('random', first(2)) }).criteria.find(c => c.name === 'random')!.met, false, '2 of 30 = 6.7 %');
  assert.equal(computeGate({ ...base, nearMisses: { total: 120, passed: 1 } }).verdict, 'does not pass');
  assert.equal(computeGate({ ...base, nearMisses: { total: 0, passed: 0 } }).verdict, 'does not pass', 'no near miss checked is not "every near miss fails"');
  assert.equal(computeGate({ ...base, developmentRuns: 10 }).criteria.find(c => c.name === 'budget')!.met, true, '90 + 10 = 100');
});

test('refuses rounds that break the preregistration', () => {
  const refused = (value: GateInput, message: RegExp): void => assert.throws(() => computeGate(value), (error: unknown) => error instanceof GateInputError && message.test(error.message), message.source);
  const base = input(first(17), first(12), first(5));
  refused({ ...base, developmentRuns: 11 }, /preregistered held-out size is 29 instances, these reports have 30/);
  refused({ ...base, developmentRuns: 29 }, /leave room for only 23 held-out instances/);
  refused({ ...base, oracle: report('oracle', first(N), { world: 'x' }) }, /different worlds/);
  refused({ ...base, ladder: [report(OPUS, first(17), { repeats: 2 }), base.ladder[1]!, base.ladder[2]!] }, /one run per agent per instance/);
  refused({ ...base, ladder: [base.ladder[0]!, report(OPUS, first(12)), base.ladder[2]!] }, /three different models/);
  refused({ ...base, strongest: 'claude-unknown' }, /preregistered/);
  refused({ ...base, weakest: OPUS }, /preregistered/);
  refused({ ...base, oracle: report('oracle', first(N), { seeds: tasks.map((_, index) => index + 1) }) }, /held-out range/);
  refused({ ...base, previousSeeds: [1_000_105] }, /reuses held-out instances/);
  refused({ ...base, round: 3 }, /at most 2 rounds/);
  refused({ ...base, oracle: report('random', first(0)) }, /oracle report/);
});

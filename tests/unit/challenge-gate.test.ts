// The preregistered challenge gate (PADR-0040), its round declaration and its preflight. Reports,
// declarations and spent runs are hand-built; every expected number is counted by hand from the
// outcome tables below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGate, mergeAgentRuns, preflightGate, renderGate, renderPreflight, GateInputError, RUNS_AFTER_FIRST_ROUNDS, type GateInput, type GateReport, type SpentRun } from '../../src/challenge/gate.ts';
import { DECLARATION_SCHEMA, HELD_OUT_SPAN, declarationHash, developmentDigest, digestRunOf, heldOutSeeds, orderOf, tierOf, validateDeclaration, DeclarationError, type Declaration } from '../../src/challenge/declaration.ts';
import { BENCH_SCHEMA_V2, ISOLATION_OF, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';

const hash = (c: string): string => c.repeat(64);
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
const N = 26;
const devTasks = ['repair-1', 'repair-2', 'repair-3'];

interface ReportOptions { infra?: number[]; missing?: number[]; world?: string; repeats?: number; seedList?: number[]; tasks?: string[]; generated?: number[]; runModel?: (index: number) => string | null; checks?: number; mirror?: 'auto' | 'required'; createdAt?: string; practonaut?: string; version?: string; keptEnv?: string[]; only?: number[] }
function report(agent: 'oracle' | 'random' | string, passes: boolean[], planned: string[], options: ReportOptions = {}): BenchReportV2 {
  const builtin = agent === 'oracle' || agent === 'random';
  const benched = options.only ? planned.filter((_, index) => options.only!.includes(index)) : planned;
  const seedList = options.seedList ?? [1];
  const runs: BenchRunV2[] = benched.flatMap(taskId => seedList.flatMap(seed => {
    const index = planned.indexOf(taskId);
    if (options.missing?.includes(index)) return [];
    const infra = options.infra?.includes(index) === true;
    const checker = infra ? null : { session: { passed: passes[index]!, errorClasses: [] }, native: { passed: passes[index]!, errorClasses: [] } };
    const model = builtin ? undefined : options.runModel ? options.runModel(index) : agent;
    return [{ id: `${taskId}-s${seed}-r1`, taskId, seed, repeat: 1, status: infra ? 'infra_error' as const : 'completed' as const, pass: !infra && passes[index]!, actions: 3, acceptedActions: 3, rejectedActions: 0, undos: 0, resets: 0,
      toolCalls: { observe: 1, act: 3, undo: 0, reset: 0, check: 1, total: 5 }, wallMs: 1000, referenceActions: 3, checker, agentExitCode: infra ? null : 0,
      ...(checker ? { artifacts: { session: hash(String(index % 10)), native: hash('b'), checker: hash(passes[index] ? 'c' : 'e') } } : {}),
      ...(model !== undefined ? { client: { source: 'client-attested' as const, model, turns: 5, costUsd: 0.1, tokens: null, version: options.version ?? '2.1.0' } } : {}) }];
  }));
  const generatedSeeds = options.generated ?? benched.map(task => Number(task.split('-').at(-1)));
  return {
    schema: BENCH_SCHEMA_V2, createdAt: options.createdAt ?? '2026-11-02T10:00:00.000Z',
    environment: { practonaut: options.practonaut ?? '0.2.0', excalidraw: '0.18.1', node: 'v22.22.3', os: { platform: 'darwin', release: '25.0', arch: 'arm64' }, mirror: 'required',
      world: { source: 'own', worldId: 'challenge-repair-r1', version: '1.0.0', contentHash: hash(options.world ?? 'd'), package: { path: 'world.pnworld', sha256: hash('e') },
        generated: benched.map((taskId, index) => ({ taskId, id: 'challenge-repair', version: '1.0.0', seed: generatedSeeds[index]!, parameters: { difficulty: 2 } })) } },
    agent: builtin ? { kind: 'builtin', name: agent, command: [], isolation: ISOLATION_OF.builtin, model: null, modelSource: 'none', apiKeySource: null, keptEnv: [] }
      : { kind: 'preset', name: 'claude-code', command: ['claude'], isolation: ISOLATION_OF.preset, model: agent, modelSource: 'client-attested', apiKeySource: 'none', keptEnv: options.keptEnv ?? [] },
    settings: { tasks: benched, seeds: seedList, repeats: options.repeats ?? 1, timeoutSeconds: 600, maxActions: 50, mirror: options.mirror ?? 'required', prompt: builtin ? '' : 'p', ...(options.checks !== undefined ? { checks: options.checks } : {}) },
    references: { path: 'references.json', sha256: hash('f'), tasks: benched.map(taskId => ({ taskId, source: 'oracle-file' as const, actions: 3, minimal: true })) },
    runs, ...(runs.length < benched.length * seedList.length ? { interrupted: { plannedRuns: benched.length * seedList.length } } : {}), summary: summarize(runs, 1),
  };
}
const DEV_PASSED: boolean[][] = [[true, true, false], [true, false, false], [false, false, false]];
const devReport = (model: string, passed: boolean[], options: ReportOptions = {}): BenchReportV2 => report(model, passed, devTasks, { world: '9', ...options });
const devReports = (passed: boolean[][] = DEV_PASSED): GateReport[] => [OPUS, SONNET, HAIKU].map((model, index) => ({ report: devReport(model, passed[index]!), bench: `dev-${index}` }));
const digestOf = (reports: readonly GateReport[]): string => developmentDigest(reports.flatMap(value => value.report.runs.map(run => digestRunOf(run, value.report.agent.model!))));
function declarationOf(extra: Partial<Declaration> = {}, development: Partial<Declaration['development']> = {}, budget: Partial<Declaration['budget']> = {}): Declaration {
  return {
    schema: DECLARATION_SCHEMA, family: 'repair', round: 1, generator: { id: 'challenge-repair', version: '1.0.0' }, difficulty: 'mixed',
    ladder: [OPUS, SONNET, HAIKU], maintainerApproved: [], pair: { strongest: OPUS, weakest: HAIKU }, bench: { mirror: 'required', timeoutSeconds: 600, maxActions: 50, checks: null },
    development: { seeds: [1, 2, 3], world: { id: 'challenge-repair-dev', contentHash: hash('9') }, digest: digestOf(devReports()), passed: DEV_PASSED, spent: 9, order: 'consistent', ...development },
    heldOut: { instances: 26 }, budget: { developmentRuns: 9, heldOutRuns: 78, roundRuns: 87, releaseRunsBefore: 35, releaseBudget: 500, earlier: [], ...budget }, ...extra,
  };
}
const declaration = declarationOf();
const seeds = heldOutSeeds(declaration);
const tasks = seeds.map(seed => `repair-${seed}`);
/** First k instances pass. */
const first = (k: number): boolean[] => tasks.map((_, index) => index < k);
const held = (agent: string, passes: boolean[], options: ReportOptions = {}): BenchReportV2 => report(agent, passes, tasks, options);
let benches = 0;
const at = (value: BenchReportV2, bench = `b${String(++benches).padStart(3, '0')}`): GateReport => ({ report: value, bench });
/** The run folders a bench folder scan finds for these ladder reports. */
const spentOf = (reports: readonly GateReport[]): SpentRun[] => reports.flatMap(({ report: value, bench }) => value.runs.map(run => ({ bench, runId: run.id, taskId: run.taskId, model: value.agent.model, status: run.status })));
function input(strong: boolean[], middle: boolean[], weak: boolean[], extra: Partial<GateInput> = {}): GateInput {
  const ladder = extra.ladder ?? [at(held(OPUS, strong)), at(held(SONNET, middle)), at(held(HAIKU, weak))];
  return { declaration, tasks, seeds, worldContentHash: hash('d'), development: devReports(), oracle: [at(held('oracle', first(N)))], random: [at(held('random', first(0)))],
    ladder, nearMisses: { total: 104, passed: 0, perInstance: tasks.map(() => 4) }, previous: [], maintainerApproved: [], spent: { development: 9, heldOut: spentOf(ladder) }, ...extra };
}
const refused = (work: () => unknown, message: RegExp): void => assert.throws(work, (error: unknown) => error instanceof GateInputError && message.test(error.message), message.source);

test('the hand-built reports are valid bench/2 reports', () => {
  for (const value of [held('oracle', first(N)), held(OPUS, first(15)), held(HAIKU, first(4), { infra: [20] }), devReport(OPUS, [true, false, true]), held(OPUS, first(15), { only: [0, 1, 2] })]) assert.doesNotThrow(() => validateBenchReportV2(value));
});

test('a declaration: tiers in capability order, the pair they fix, the family cap, approved models only by name, the derived release runs and the budget', () => {
  assert.doesNotThrow(() => validateDeclaration(declaration));
  const invalid = (value: unknown, message: RegExp): void => assert.throws(() => validateDeclaration(value), (error: unknown) => error instanceof DeclarationError && message.test(error.message), message.source);
  invalid(declarationOf({ ladder: [SONNET, OPUS, HAIKU], pair: { strongest: SONNET, weakest: HAIKU } }), /capability order: Opus, Sonnet, Haiku/);
  // The pair is fixed by the order, whatever the development outcomes (second review S-3).
  invalid(declarationOf({ pair: { strongest: SONNET, weakest: HAIKU } }), /the gate pair is fixed by the capability order: strongest claude-opus-5-5, weakest claude-haiku-5-5/);
  invalid(declarationOf({ bench: { ...declaration.bench, maxActions: 60 } }), /--max-actions 60 is above the repair cap of 50/);
  const other = 'gpt-9', withOther = declarationOf({ ladder: [OPUS, other, HAIKU] });
  invalid(withOther, /gpt-9 is not an Opus, Sonnet or Haiku model; it needs --maintainer-approved gpt-9/);
  assert.doesNotThrow(() => validateDeclaration({ ...withOther, maintainerApproved: [other] }));
  invalid(declarationOf({ maintainerApproved: [SONNET] }), /not a ladder model outside the three tiers/);
  invalid(declarationOf({}, { order: 'contradicted' }), /order line does not follow/);
  invalid(declarationOf({ generator: { id: 'challenge-injection', version: '1.0.0' } }), /generator of repair is challenge-repair/);
  // The release runs before a round are derived: 35 plus every earlier round (second review B-B).
  invalid(declarationOf({}, {}, { releaseRunsBefore: 36 }), /are 35 plus the earlier rounds' 0, not 36/);
  const earlier = (runs: number) => [{ declaration: 'injection-round-1.declaration.json', runs, from: 'ledger' as const }];
  // 35 + 378 = 413, + 87 = 500 fits; 35 + 379 = 414 does not.
  assert.doesNotThrow(() => validateDeclaration(declarationOf({}, {}, { releaseRunsBefore: 413, earlier: earlier(378) })));
  invalid(declarationOf({}, {}, { releaseRunsBefore: 414, earlier: earlier(379) }), /budget exhausted — a maintainer decides on a second round/);
  // Development reruns count: 30 development runs + 78 = 108 for the round.
  invalid(declarationOf({}, { spent: 30 }, { releaseRunsBefore: 400, earlier: earlier(365) }), /400 model runs used before this round and 108 for it exceed/);
  invalid({ ...declaration, heldOut: { instances: 24 } }, /heldOut\.instances/);
  assert.deepEqual([OPUS, SONNET, HAIKU, `${OPUS}[1m]`, `${HAIKU}[1m]`, 'claude-3-opus', 'gpt-9'].map(tierOf), [0, 1, 2, 0, 2, -1, -1]);
  assert.doesNotThrow(() => validateDeclaration(declarationOf({ ladder: [`${OPUS}[1m]`, SONNET, HAIKU], pair: { strongest: `${OPUS}[1m]`, weakest: HAIKU } })), 'a bracketed suffix is a model id (second review S-5)');
});

test('the development order line: contradicted when a less capable model passes more', () => {
  const rows = (counts: number[]) => counts.map(count => [0, 1, 2].map(k => k < count));
  assert.deepEqual([[2, 1, 0], [0, 0, 0], [3, 3, 3], [1, 2, 0], [0, 0, 1]].map(counts => orderOf(rows(counts))), ['consistent', 'consistent', 'consistent', 'contradicted', 'contradicted']);
});

test('held-out seeds follow from the development runs\' verified content only; the budget and file bytes cannot redraw them (second review B-B)', () => {
  assert.equal(seeds.length, 26);
  assert.ok(seeds.every((seed, index) => seed === seeds[0]! + index));
  assert.ok(seeds[0]! >= 1_000_000 && seeds[0]! < 1_000_000 + HELD_OUT_SPAN);
  // What an operator could change for free changes nothing.
  assert.deepEqual(heldOutSeeds(declarationOf({}, {}, { releaseRunsBefore: 122, earlier: [{ declaration: 'injection-round-1.declaration.json', runs: 87, from: 'declaration' }] })), seeds);
  assert.deepEqual(heldOutSeeds(declarationOf({}, { spent: 12 })), seeds);
  // The digest ignores report order and file layout; a new development run changes it.
  assert.equal(digestOf([...devReports()].reverse()), declaration.development.digest);
  const rerun = devReports(); rerun[1] = { report: devReport(SONNET, [true, false, false], { version: '2.1.0' }), bench: 'x' };
  (rerun[1].report.runs[0]!.artifacts as { session: string }).session = hash('7');
  assert.notEqual(digestOf(rerun), declaration.development.digest);
  assert.notDeepEqual(heldOutSeeds(declarationOf({}, { digest: digestOf(rerun) })), seeds);
  assert.notEqual(declarationHash(declarationOf({}, {}, { releaseRunsBefore: 122, earlier: [{ declaration: 'injection-round-1.declaration.json', runs: 87, from: 'declaration' }] })), declarationHash(declaration), 'the manifest still binds the whole declaration');
});

test('the preregistered round: 9 development runs and 26 held-out instances, 87 model runs', () => {
  assert.equal(RUNS_AFTER_FIRST_ROUNDS, 465 - 5 * 87);
  assert.equal(RUNS_AFTER_FIRST_ROUNDS, 30);
});

test('a family passes: headroom 15/26, 11 more instances than the weakest, McNemar p = 0.00098', () => {
  // Strongest passes instances 0–14, weakest 0–3: b = 11 one way, c = 0 the other; p = 2 · (1/2)^11.
  const result = computeGate(input(first(15), first(10), first(4)));
  assert.equal(result.verdict, 'passes');
  assert.equal(result.instances, 26);
  assert.deepEqual([result.strongest.model, result.weakest.model], [OPUS, HAIKU]);
  assert.deepEqual([result.strongest.passed, result.weakest.passed], [15, 4]);
  assert.deepEqual([result.discordant.strongestOnly, result.discordant.weakestOnly], [11, 0]);
  assert.ok(Math.abs(result.discordant.p - 2 / 2048) < 1e-12);
  assert.deepEqual([result.modelRuns, result.developmentRuns, result.spent, result.releaseRuns], [78, 9, { development: 9, heldOut: 78, total: 87 }, 35 + 87]);
  assert.deepEqual(result.development.map(entry => entry.passed), [2, 1, 0]);
  assert.equal(result.order, 'consistent');
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
  assert.match(markdown, /\| budget \| 87 model runs spent \(78 held-out \+ 9 development\); release 122 of 500 \|/);
  assert.match(markdown, /\| Gate pair \| strongest `claude-opus-5-5`, weakest `claude-haiku-5-5` \(fixed by the capability order before any run\) \|/);
  assert.match(markdown, /\| Development \| `claude-opus-5-5` 2\/3, `claude-sonnet-5-5` 1\/3, `claude-haiku-5-5` 0\/3: consistent with the capability order \|/);
  assert.match(markdown, new RegExp(`canonical SHA-256 \`${declarationHash(declaration).slice(0, 16)}…\``));
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

test('the pair stays Opus and Haiku when development outcomes contradict the order; the report says so (second review S-3)', () => {
  const contradicted: boolean[][] = [[false, false, false], [true, false, false], [true, true, true]];
  const dev = devReports(contradicted);
  const value = declarationOf({}, { digest: digestOf(dev), passed: contradicted, order: 'contradicted' });
  const valueSeeds = heldOutSeeds(value), valueTasks = valueSeeds.map(seed => `repair-${seed}`);
  const on = (agent: string, k: number): GateReport => at(report(agent, valueTasks.map((_, index) => index < k), valueTasks));
  const ladder = [on(OPUS, 15), on(SONNET, 10), on(HAIKU, 4)];
  const result = computeGate({ ...input(first(0), first(0), first(0)), declaration: value, tasks: valueTasks, seeds: valueSeeds, development: dev, oracle: [on('oracle', N)], random: [on('random', 0)], ladder, spent: { development: 9, heldOut: spentOf(ladder) } });
  assert.deepEqual([result.strongest.model, result.weakest.model, result.order], [OPUS, HAIKU, 'contradicted']);
  assert.equal(result.verdict, 'passes');
  assert.match(renderGate(result), /`claude-haiku-5-5` 3\/3: contradict the capability order; the pair stays as declared \(PADR-0040\)/);
});

test('every run counts: infra errors, missing and unattested runs fail, and more than 5 % of ladder runs voids the round', () => {
  // Two infra errors for the strongest and two missing runs for the weakest: 4 of 78 = 5.1 % > 5 %.
  const four = [at(held(OPUS, first(15), { infra: [0, 1] })), at(held(SONNET, first(10))), at(held(HAIKU, first(4), { missing: [24, 25] }))];
  const result = computeGate(input(first(15), first(10), first(4), { ladder: four }));
  assert.equal(result.strongest.passed, 13, 'the two infra errors are not passed');
  assert.equal(result.weakest.missing, 2);
  assert.ok(Math.abs(result.infraShare - 4 / 78) < 1e-12);
  assert.equal(result.verdict, 'void');
  // Three of 78 (3.8 %) does not void it.
  const three = [at(held(OPUS, first(15), { infra: [0, 1] })), at(held(SONNET, first(10))), at(held(HAIKU, first(4), { missing: [25] }))];
  assert.notEqual(computeGate(input(first(15), first(10), first(4), { ladder: three })).verdict, 'void');
  // The reviewer's case (second review B-A): Opus 12/26 with five runs stopped by a usage limit —
  // now infra_error — against Haiku 4/26 is void (5 of 78 = 6.4 %), not "does not pass".
  const limited = [at(held(OPUS, first(17), { infra: [12, 13, 14, 15, 16] })), at(held(SONNET, first(8))), at(held(HAIKU, first(4)))];
  const limitedResult = computeGate(input(first(0), first(0), first(0), { ladder: limited }));
  assert.deepEqual([limitedResult.strongest.passed, limitedResult.verdict], [12, 'void']);
  // Runs whose client reported no model are not passed and count like infrastructure errors (review S3).
  const silent = [at(held(OPUS, first(15), { runModel: index => index < 4 ? null : OPUS })), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  const silentResult = computeGate(input(first(15), first(10), first(4), { ladder: silent }));
  assert.deepEqual([silentResult.strongest.unattested, silentResult.strongest.passed], [4, 11]);
  assert.equal(silentResult.verdict, 'void');
});

test('baselines: oracle 100 %, random at most 5 %, every near miss fails; an oracle or random infra_error is rerun, never scored (second review S-4)', () => {
  const base = input(first(15), first(10), first(4));
  assert.equal(computeGate({ ...base, oracle: [at(held('oracle', first(25)))] }).criteria.find(c => c.name === 'oracle')!.met, false);
  assert.equal(computeGate({ ...base, random: [at(held('random', first(1)))] }).criteria.find(c => c.name === 'random')!.met, true, '1 of 26 = 3.8 %');
  assert.equal(computeGate({ ...base, random: [at(held('random', first(2)))] }).criteria.find(c => c.name === 'random')!.met, false, '2 of 26 = 7.7 %');
  assert.equal(computeGate({ ...base, nearMisses: { ...base.nearMisses, passed: 1 } }).verdict, 'does not pass');
  refused(() => computeGate({ ...base, nearMisses: { total: 100, passed: 0, perInstance: tasks.map((_, index) => index === 3 ? 0 : 4) } }), /every held-out instance needs its near misses/);
  refused(() => computeGate({ ...base, oracle: [at(held('oracle', first(N), { infra: [7] }))] }), new RegExp(`the oracle baseline has no judged run for 1 instance \\(${tasks[7]}\\); bench them again`));
  refused(() => computeGate({ ...base, random: [at(held('random', first(0), { only: [0, 1, 2] }))] }), /the random baseline has no judged run for 23 instances/);
  // An oracle rerun of that instance after the infra_error is merged.
  const rerun = computeGate({ ...base, oracle: [at(held('oracle', first(N), { infra: [7] }), 'o1'), at(held('oracle', first(N), { only: [7], createdAt: '2026-11-02T11:00:00.000Z' }), 'o2')] });
  assert.equal(rerun.agents[0]!.passed, 26);
});

test('the unit is a distinct instance: the reviewer\'s 13 tasks × seeds 1 and 2 are refused (review B1, audit P1-1)', () => {
  const thirteen = tasks.slice(0, 13);
  // b = 8, c = 0 counted twice would read as 16 discordant "instances" (p = 0.0078); refused by name.
  const doubled = (model: string, k: number): GateReport => at(report(model, thirteen.map((_, index) => index < k), thirteen, { seedList: [1, 2] }));
  refused(() => computeGate(input(first(15), first(10), first(4), { oracle: [doubled('oracle', 13)] })), /the oracle report uses seed list 1,2; a generated world has one variant, so the gate takes --seed-list 1 only/);
  refused(() => computeGate(input(first(15), first(10), first(4), { ladder: [at(held(OPUS, first(15), { repeats: 2 })), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))] })), /--repeats 2; the gate needs one run per agent per instance/);
  refused(() => computeGate(input(first(15), first(10), first(4), { tasks: tasks.slice(0, 24), seeds: seeds.slice(0, 24) })), /the preregistered held-out set is 26 distinct instances/);
  // A ladder agent that benched only half the tasks: the rest are missing, and the round is void.
  const half = [at(held(OPUS, first(15), { only: Array.from({ length: 13 }, (_, index) => index) })), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  const result = computeGate(input(first(15), first(10), first(4), { ladder: half }));
  assert.deepEqual([result.strongest.missing, result.verdict], [13, 'void']);
});

test('a resumed bench is merged; a task run again counts only after an infra_error, both runs spent; no best-of-N anywhere in the bench folders (second review S-2)', () => {
  const firstHalf = Array.from({ length: 13 }, (_, index) => index), secondHalf = Array.from({ length: 13 }, (_, index) => index + 13);
  const opus = [at(held(OPUS, first(15), { only: firstHalf, infra: [12] }), 'b101'), at(held(OPUS, first(15), { only: [12, ...secondHalf], createdAt: '2026-11-02T12:00:00.000Z' }), 'b102')];
  const ladder = [...opus, at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  const resumed = computeGate(input(first(15), first(10), first(4), { ladder }));
  assert.deepEqual([resumed.strongest.passed, resumed.strongest.reports, resumed.strongest.infraErrors, resumed.spent.heldOut, resumed.verdict], [15, 2, 0, 79, 'passes']);
  // Run again although the first run was judged: refused.
  const twice = [at(held(OPUS, first(15)), 'b201'), at(held(OPUS, first(15), { only: [6], createdAt: '2026-11-02T12:00:00.000Z' }), 'b202'), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  refused(() => computeGate(input(first(15), first(10), first(4), { ladder: twice })), new RegExp(`task ${tasks[6]} was run more than once for claude-opus-5-5 \\(bench folders b201, b202\\) and the earlier run was not an infra_error \\(no best-of-N\\)`));
  assert.throws(() => mergeAgentRuns(twice.slice(0, 2), OPUS), new RegExp(`claude-opus-5-5: task ${tasks[6]} was benched again although its run in b201 was not an infra_error \\(no best-of-N\\)`));
  // A run left out of the gate is still found in the bench folders.
  const given = [at(held(OPUS, first(15)), 'b301'), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  const hiddenEarlier: SpentRun = { bench: 'b300', runId: `${tasks[9]}-s1-r1`, taskId: tasks[9]!, model: OPUS, status: 'completed' };
  refused(() => computeGate(input(first(15), first(10), first(4), { ladder: given, spent: { development: 9, heldOut: [...spentOf(given), hiddenEarlier] } })), new RegExp(`task ${tasks[9]} was run more than once for claude-opus-5-5 \\(bench folders b300, b301\\) and the earlier run was not an infra_error`));
  const hiddenLater: SpentRun = { ...hiddenEarlier, bench: 'b399' };
  const laterInput = input(first(15), first(10), first(4), { ladder: given, spent: { development: 9, heldOut: [...spentOf(given).map(run => run.taskId === tasks[9] && run.model === OPUS ? { ...run, status: 'infra_error' } : run), hiddenLater] } });
  refused(() => computeGate(laterInput), new RegExp(`the latest run of ${tasks[9]} for claude-opus-5-5 \\(bench folder b399\\) was not given to the gate`));
  refused(() => computeGate(input(first(15), first(10), first(4), { ladder: given, spent: { development: 9, heldOut: spentOf(given).slice(1) } })), /is not among the model runs found in the bench folders; name their folder with --bench-root/);
  // Merging on its own: per task the latest report's run.
  const merged = mergeAgentRuns([at(held(OPUS, first(15), { infra: [0] }), 'm1'), at(held(OPUS, first(15), { only: [0], createdAt: '2026-11-03T00:00:00.000Z' }), 'm2')], OPUS);
  assert.equal(merged.get(tasks[0]!)!.bench, 'm2');
});

test('round 2 needs every earlier round with disjoint seeds; the release budget stops the gate (review S2, audit P1-3)', () => {
  const second = declarationOf({ round: 2 }, {}, { releaseRunsBefore: 300, earlier: [{ declaration: 'injection-round-1.declaration.json', runs: 265, from: 'ledger' }] });
  const secondSeeds = heldOutSeeds(second), secondTasks = secondSeeds.map(seed => `repair-${seed}`);
  const on = (agent: string, k: number): GateReport => at(report(agent, secondTasks.map((_, index) => index < k), secondTasks));
  const ladder = [on(OPUS, 15), on(SONNET, 10), on(HAIKU, 4)];
  const round2: GateInput = { ...input(first(0), first(0), first(0)), declaration: second, tasks: secondTasks, seeds: secondSeeds, oracle: [on('oracle', N)], random: [on('random', 0)], ladder, spent: { development: 9, heldOut: spentOf(ladder) } };
  refused(() => computeGate(round2), /round 2 needs the held-out reports of every earlier round \(--previous\): rounds 1, given none/);
  refused(() => computeGate({ ...round2, previous: [{ round: 1, seeds: [secondSeeds[5]!] }] }), /reuses held-out instances of an earlier round/);
  assert.equal(computeGate({ ...round2, previous: [{ round: 1, seeds }] }).verdict, 'passes');
  refused(() => computeGate(input(first(15), first(10), first(4), { previous: [{ round: 1, seeds: [] }] })), /round 1 has no earlier round/);
  // Reruns that push the release over 500 stop the gate.
  const tight = declarationOf({}, {}, { releaseRunsBefore: 413, earlier: [{ declaration: 'injection-round-1.declaration.json', runs: 378, from: 'ledger' }] });
  const tightSeeds = heldOutSeeds(tight);
  assert.deepEqual(tightSeeds, seeds, 'the budget does not move the seeds');
  const extra: SpentRun = { bench: 'b000', runId: `${tasks[0]}-s1-r1`, taskId: tasks[0]!, model: 'gpt-x', status: 'completed' };
  const base = input(first(15), first(10), first(4), { declaration: tight });
  refused(() => computeGate({ ...base, spent: { development: 9, heldOut: [...base.spent.heldOut, extra] } }), /budget exhausted — a maintainer decides on a second round: 501 model runs exceed the release budget of 500/);
});

test('ladder agents are the declared models, every run on its own report\'s model (review S3, audit P2-8)', () => {
  const base = input(first(15), first(10), first(4));
  const mixed = [at(held(OPUS, first(15), { runModel: index => index % 2 ? SONNET : OPUS })), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  refused(() => computeGate({ ...base, ladder: mixed, spent: { development: 9, heldOut: spentOf(mixed) } }), new RegExp(`run ${tasks[1]}-s1-r1 of the claude-opus-5-5 report ran on claude-sonnet-5-5`));
  const stranger = [at(held('gpt-9', first(15))), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  refused(() => computeGate({ ...base, ladder: stranger, spent: { development: 9, heldOut: spentOf(stranger) } }), /a report of gpt-9 is not one of the declared ladder models/);
  const builtin = [at({ ...held(OPUS, first(15)), agent: { ...held('random', first(0)).agent, model: OPUS, apiKeySource: 'none' } as BenchReportV2['agent'] }), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  refused(() => computeGate({ ...base, ladder: builtin, spent: { development: 9, heldOut: spentOf(builtin) } }), /not from the claude-code preset/);
  // Another model needs the maintainer's approval in the declaration and again at the gate.
  const other = 'gpt-9';
  const otherDev: GateReport[] = [OPUS, other, HAIKU].map((model, index) => ({ report: devReport(model, DEV_PASSED[index]!), bench: `dev-${index}` }));
  for (const value of otherDev) if (value.report.agent.model === other) Object.assign(value.report.agent, { kind: 'command', name: 'command', isolation: ISOLATION_OF.command, modelSource: 'command-output' });
  for (const run of otherDev[1]!.report.runs) Object.assign(run.client!, { source: 'command-output' });
  const approved = declarationOf({ ladder: [OPUS, other, HAIKU], maintainerApproved: [other] }, { digest: digestOf(otherDev) });
  const approvedSeeds = heldOutSeeds(approved), approvedTasks = approvedSeeds.map(seed => `repair-${seed}`);
  const on = (agent: string, k: number): GateReport => at(report(agent, approvedTasks.map((_, index) => index < k), approvedTasks));
  const otherLadder = [on(OPUS, 15), on(other, 10), on(HAIKU, 4)];
  Object.assign(otherLadder[1]!.report.agent, { kind: 'command', name: 'command', isolation: ISOLATION_OF.command, modelSource: 'command-output' });
  for (const run of otherLadder[1]!.report.runs) Object.assign(run.client!, { source: 'command-output' });
  const withOther: GateInput = { ...base, declaration: approved, tasks: approvedTasks, seeds: approvedSeeds, development: otherDev, oracle: [on('oracle', N)], random: [on('random', 0)], ladder: otherLadder, spent: { development: 9, heldOut: spentOf(otherLadder) } };
  refused(() => computeGate(withOther), /the declaration approves gpt-9 outside the three tiers; pass exactly that as --maintainer-approved/);
  assert.equal(computeGate({ ...withOther, maintainerApproved: [other] }).ladderLabel, null, 'not a Claude-only ladder');
});

test('development reports are the declared runs: their set, settings, digest and outcomes', () => {
  const base = input(first(15), first(10), first(4));
  const replace = (index: number, value: BenchReportV2): GateReport[] => devReports().map((entry, at_) => at_ === index ? { report: value, bench: entry.bench } : entry);
  refused(() => computeGate({ ...base, development: replace(0, devReport(OPUS, [true, true, true])) }), /the development runs are not the ones the declaration digests/);
  refused(() => computeGate({ ...base, development: replace(0, devReport(OPUS, [true, true, false], { world: '8' })) }), /was not made on the declared development set/);
  refused(() => computeGate({ ...base, development: replace(0, devReport(OPUS, [true, true, false], { checks: 1 })) }), /differs from the declaration in mirror \(as requested and as run\), timeout, action cap or check limit/);
  refused(() => computeGate({ ...base, development: replace(0, devReport(OPUS, [true, true, false], { mirror: 'auto' })) }), /differs from the declaration in mirror/);
  refused(() => computeGate({ ...base, development: replace(0, devReport(OPUS, [true, true, false], { runModel: () => null })) }), /a development run of claude-opus-5-5 reports no model/);
  refused(() => computeGate({ ...base, development: replace(0, devReport(OPUS, [true, true, false], { infra: [1] })) }), /the development run of claude-opus-5-5 on repair-2 is an infra_error; bench it again after the limit window/);
  // A development rerun after an infra_error, merged: the digest is the counted runs'.
  const resumed = [{ report: devReport(OPUS, [true, true, false], { infra: [1] }), bench: 'dev-0' }, { report: devReport(OPUS, [true, true, false], { only: [1], createdAt: '2026-11-02T11:00:00.000Z' }), bench: 'dev-0b' }, ...devReports().slice(1)];
  assert.equal(computeGate({ ...base, development: resumed }).verdict, 'passes');
  refused(() => computeGate({ ...base, oracle: [at(held('oracle', first(N), { world: 'x' }))] }), /the oracle report was not made on the held-out set the declaration names/);
  refused(() => computeGate({ ...base, oracle: [at(held('oracle', first(N), { generated: seeds.map(seed => seed + 1) }))] }), /was not made by challenge-repair 1\.0\.0 from its declared seed/);
  refused(() => computeGate({ ...base, oracle: [at(held('random', first(0)))] }), /oracle report is not from the oracle agent/);
});

test('one Practonaut, one prompt, one client set-up and one Claude Code version per round (second review nits)', () => {
  const base = input(first(15), first(10), first(4));
  const ladder = (options: ReportOptions) => [at(held(OPUS, first(15), options)), at(held(SONNET, first(10))), at(held(HAIKU, first(4)))];
  const run = (options: ReportOptions) => { const value = ladder(options); return () => computeGate({ ...base, ladder: value, spent: { development: 9, heldOut: spentOf(value) } }); };
  refused(run({ practonaut: '0.2.1' }), /made with different Practonaut versions/);
  refused(run({ version: '2.2.0' }), /report different Claude Code versions \(2\.1\.0, 2\.2\.0\)/);
  refused(run({ keptEnv: ['ANTHROPIC_MODEL'] }), /differ in their kept environment/);
});

test('the preflight checks everything but the ladder before any ladder run, and names why a round could not pass (second review S-1)', () => {
  const base = input(first(15), first(10), first(4));
  const { ladder: _ladder, ...round } = base;
  const result = preflightGate({ ...round, spent: { development: 9, heldOut: [] } });
  assert.deepEqual([result.oracle.passed, result.random.passed, result.ladderRunsSpent, result.releaseRuns], [26, 0, 0, 122]);
  assert.match(renderPreflight(result), /^repair round 1: preflight passed — the ladder may start\.\n/);
  refused(() => preflightGate({ ...round, oracle: [at(held('oracle', first(24)))] }), /the round cannot pass: the oracle passes 24 of 26 instances \(every one must pass\)\. Do not start the ladder\./);
  refused(() => preflightGate({ ...round, random: [at(held('random', first(2)))] }), /random passes 2 of 26 instances \(at most 5 %\)/);
  refused(() => preflightGate({ ...round, oracle: [at(held('oracle', first(N), { infra: [3] }))] }), /the oracle baseline has no judged run/);
  refused(() => preflightGate({ ...round, development: devReports().slice(1) }), /no development report of claude-opus-5-5/);
});

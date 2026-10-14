// The preregistered challenge gate (PADR-0040) and its round declaration. Reports and declarations
// are hand-built; every expected number is counted by hand from the outcome tables below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGate, renderGate, GateInputError, RUNS_AFTER_FIRST_ROUNDS, type GateInput } from '../../src/challenge/gate.ts';
import { DECLARATION_SCHEMA, HELD_OUT_SPAN, declarationHash, extremes, heldOutSeeds, tierOf, validateDeclaration, DeclarationError, type Declaration } from '../../src/challenge/declaration.ts';
import { BENCH_SCHEMA_V2, ISOLATION_OF, summarize, validateBenchReportV2, type BenchReportV2, type BenchRunV2 } from '../../src/bench/report.ts';

const hash = (c: string): string => c.repeat(64);
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
const N = 26;
function declarationOf(extra: Partial<Declaration> = {}, development: Partial<Declaration['development']> = {}): Declaration {
  return {
    schema: DECLARATION_SCHEMA, family: 'repair', round: 1, generator: { id: 'challenge-repair', version: '1.0.0' }, difficulty: 'mixed',
    ladder: [OPUS, SONNET, HAIKU], maintainerApproved: [], bench: { mirror: 'required', timeoutSeconds: 600, maxActions: 50, checks: null },
    development: { seeds: [1, 2, 3], world: { id: 'challenge-repair-dev', contentHash: hash('9') },
      reports: [{ model: OPUS, sha256: hash('1'), passed: [true, true, false] }, { model: SONNET, sha256: hash('2'), passed: [true, false, false] }, { model: HAIKU, sha256: hash('3'), passed: [false, false, false] }],
      strongest: OPUS, weakest: HAIKU, ...development },
    heldOut: { instances: 26 }, budget: { developmentRuns: 9, heldOutRuns: 78, roundRuns: 87, releaseRunsBefore: 35, releaseBudget: 500 }, ...extra,
  };
}
const declaration = declarationOf();
const seeds = heldOutSeeds(declaration);
const tasks = seeds.map(seed => `repair-${seed}`);

interface ReportOptions { infra?: number[]; missing?: number[]; seeds?: number[]; world?: string; repeats?: number; seedList?: number[]; tasks?: string[]; generated?: number[]; runModel?: (index: number) => string | null; checks?: number }
function report(agent: 'oracle' | 'random' | string, passes: boolean[], options: ReportOptions = {}): BenchReportV2 {
  const builtin = agent === 'oracle' || agent === 'random';
  const planned = options.tasks ?? tasks, seedList = options.seedList ?? [1];
  const runs: BenchRunV2[] = planned.flatMap((taskId, index) => seedList.flatMap(seed => {
    if (options.missing?.includes(index)) return [];
    const infra = options.infra?.includes(index) === true;
    const checker = infra ? null : { session: { passed: passes[index]!, errorClasses: [] }, native: { passed: passes[index]!, errorClasses: [] } };
    const model = builtin ? undefined : options.runModel ? options.runModel(index) : agent;
    return [{ id: `${taskId}-s${seed}-r1`, taskId, seed, repeat: 1, status: infra ? 'infra_error' as const : 'completed' as const, pass: !infra && passes[index]!, actions: 3, acceptedActions: 3, rejectedActions: 0, undos: 0, resets: 0,
      toolCalls: { observe: 1, act: 3, undo: 0, reset: 0, check: 1, total: 5 }, wallMs: 1000, referenceActions: 3, checker, agentExitCode: infra ? null : 0, ...(checker ? { artifacts: { session: hash('a'), native: hash('b'), checker: hash('c') } } : {}),
      ...(model !== undefined ? { client: { source: 'client-attested' as const, model, turns: 5, costUsd: 0.1, tokens: null } } : {}) }];
  }));
  const generatedSeeds = options.generated ?? planned.map(task => Number(task.split('-').at(-1)));
  return {
    schema: BENCH_SCHEMA_V2, createdAt: '2026-11-02T10:00:00.000Z',
    environment: { practonaut: '0.2.0', excalidraw: '0.18.1', node: 'v22.22.3', os: { platform: 'darwin', release: '25.0', arch: 'arm64' }, mirror: 'required',
      world: { source: 'own', worldId: 'challenge-repair-r1', version: '1.0.0', contentHash: hash(options.world ?? 'd'), package: { path: 'world.pnworld', sha256: hash('e') },
        generated: planned.map((taskId, index) => ({ taskId, id: 'challenge-repair', version: '1.0.0', seed: generatedSeeds[index]!, parameters: { difficulty: 2 } })) } },
    agent: builtin ? { kind: 'builtin', name: agent, command: [], isolation: ISOLATION_OF.builtin, model: null, modelSource: 'none', apiKeySource: null, keptEnv: [] }
      : { kind: 'preset', name: 'claude-code', command: ['claude'], isolation: ISOLATION_OF.preset, model: agent, modelSource: 'client-attested', apiKeySource: 'none', keptEnv: [] },
    settings: { tasks: planned, seeds: seedList, repeats: options.repeats ?? 1, timeoutSeconds: 600, maxActions: 50, mirror: 'required', prompt: builtin ? '' : 'p', ...(options.checks !== undefined ? { checks: options.checks } : {}) },
    references: { path: 'references.json', sha256: hash('f'), tasks: planned.map(taskId => ({ taskId, source: 'oracle-file' as const, actions: 3, minimal: true })) },
    runs, ...(runs.length < planned.length * seedList.length ? { interrupted: { plannedRuns: planned.length * seedList.length } } : {}), summary: summarize(runs, 1),
  };
}
const devTasks = ['repair-1', 'repair-2', 'repair-3'];
const devReport = (model: string, passed: boolean[], options: ReportOptions = {}): BenchReportV2 => report(model, passed, { tasks: devTasks, world: '9', ...options });
const development = (): BenchReportV2[] => declaration.development.reports.map(entry => devReport(entry.model, entry.passed));
/** First k instances pass. */
const first = (k: number): boolean[] => tasks.map((_, index) => index < k);
function input(strong: boolean[], middle: boolean[], weak: boolean[], extra: Partial<GateInput> = {}): GateInput {
  return { declaration, tasks, seeds, worldContentHash: hash('d'), development: development(), oracle: report('oracle', first(N)), random: report('random', first(0)),
    ladder: [report(OPUS, strong), report(SONNET, middle), report(HAIKU, weak)], nearMisses: { total: 104, passed: 0, perInstance: tasks.map(() => 4) }, previous: [], maintainerApproved: [], ...extra };
}
const refused = (value: GateInput, message: RegExp): void => assert.throws(() => computeGate(value), (error: unknown) => error instanceof GateInputError && message.test(error.message), message.source);

test('the hand-built reports are valid bench/2 reports', () => {
  for (const value of [report('oracle', first(N)), report(OPUS, first(15)), report(HAIKU, first(4), { infra: [20] }), devReport(OPUS, [true, false, true])]) assert.doesNotThrow(() => validateBenchReportV2(value));
});

test('a declaration: tiers in capability order, approved models only by name, outcomes naming the extremes, the release budget', () => {
  assert.doesNotThrow(() => validateDeclaration(declaration));
  const invalid = (value: unknown, message: RegExp): void => assert.throws(() => validateDeclaration(value), (error: unknown) => error instanceof DeclarationError && message.test(error.message), message.source);
  invalid(declarationOf({ ladder: [SONNET, OPUS, HAIKU] }, { reports: [declaration.development.reports[1]!, declaration.development.reports[0]!, declaration.development.reports[2]!], strongest: OPUS }), /capability order: Opus, Sonnet, Haiku/);
  const other = 'gpt-9', withOther = declarationOf({ ladder: [OPUS, other, HAIKU] }, { reports: [declaration.development.reports[0]!, { ...declaration.development.reports[1]!, model: other }, declaration.development.reports[2]!] });
  invalid(withOther, /gpt-9 is not an Opus, Sonnet or Haiku model; it needs --maintainer-approved gpt-9/);
  assert.doesNotThrow(() => validateDeclaration({ ...withOther, maintainerApproved: [other] }));
  invalid(declarationOf({ maintainerApproved: [SONNET] }), /not a ladder model outside the three tiers/);
  invalid(declarationOf({}, { strongest: SONNET }), /the development outcomes name claude-opus-5-5 strongest and claude-haiku-5-5 weakest/);
  invalid(declarationOf({ generator: { id: 'challenge-injection', version: '1.0.0' } }), /generator of repair is challenge-repair/);
  // 413 + 87 = 500 fits; 414 + 87 = 501 does not (audit P1-3).
  assert.doesNotThrow(() => validateDeclaration(declarationOf({ budget: { ...declaration.budget, releaseRunsBefore: 413 } })));
  invalid(declarationOf({ budget: { ...declaration.budget, releaseRunsBefore: 414 } }), /budget exhausted — a maintainer decides on a second round/);
  invalid({ ...declaration, heldOut: { instances: 24 } }, /heldOut\.instances/);
  assert.deepEqual([OPUS, SONNET, HAIKU, 'claude-3-opus', 'gpt-9'].map(tierOf), [0, 1, 2, -1, -1]);
});

test('development outcomes name strongest and weakest; ties go to the declared capability order', () => {
  const named = (counts: number[]): string => { const value = extremes([OPUS, SONNET, HAIKU].map((model, index) => ({ model, passed: [0, 1, 2].map(k => k < counts[index]!) }))); return `${value.strongest} ${value.weakest}`; };
  assert.equal(named([2, 1, 0]), `${OPUS} ${HAIKU}`);
  assert.equal(named([0, 0, 0]), `${OPUS} ${HAIKU}`, 'all tied: the most and the least capable');
  assert.equal(named([1, 2, 2]), `${SONNET} ${OPUS}`, 'tied for most: the more capable');
  assert.equal(named([3, 1, 1]), `${OPUS} ${HAIKU}`, 'tied for fewest: the less capable');
  assert.equal(named([0, 3, 1]), `${SONNET} ${OPUS}`);
});

test('held-out seeds follow from the declaration content alone: 26 consecutive seeds in the held-out range', () => {
  assert.equal(seeds.length, 26);
  assert.ok(seeds.every((seed, index) => seed === seeds[0]! + index));
  assert.ok(seeds[0]! >= 1_000_000 && seeds[0]! < 1_000_000 + HELD_OUT_SPAN);
  // The same content in another key order and formatting: the same seeds.
  const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(declaration).reverse()))) as Declaration;
  assert.deepEqual(heldOutSeeds(reordered), seeds);
  assert.equal(declarationHash(reordered), declarationHash(declaration));
  // Any change, even one run in the budget, draws other seeds.
  assert.notDeepEqual(heldOutSeeds(declarationOf({ budget: { ...declaration.budget, releaseRunsBefore: 36 } })), seeds);
  assert.notDeepEqual(heldOutSeeds(declarationOf({ difficulty: '3' })), seeds);
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
  assert.deepEqual([result.modelRuns, result.developmentRuns, result.releaseRuns], [78, 9, 35 + 87]);
  assert.deepEqual(result.development.map(entry => entry.passed), [2, 1, 0]);
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
  assert.match(markdown, /\| budget \| 87 model runs \(78 gate \+ 9 development\); release 122 of 500 \|/);
  assert.match(markdown, /\| Development \| `claude-opus-5-5` 2\/3, `claude-sonnet-5-5` 1\/3, `claude-haiku-5-5` 0\/3 \|/);
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

test('the declared extremes are compared, whatever the held-out outcomes: Sonnet strongest when development named it', () => {
  const sonnetFirst = declarationOf({}, { reports: [{ model: OPUS, sha256: hash('1'), passed: [true, false, false] }, { model: SONNET, sha256: hash('2'), passed: [true, true, false] }, { model: HAIKU, sha256: hash('3'), passed: [false, false, false] }], strongest: SONNET });
  const sonnetSeeds = heldOutSeeds(sonnetFirst), sonnetTasks = sonnetSeeds.map(seed => `repair-${seed}`);
  const on = (model: string, k: number): BenchReportV2 => report(model, sonnetTasks.map((_, index) => index < k), { tasks: sonnetTasks });
  const result = computeGate({ ...input(first(0), first(0), first(0)), declaration: sonnetFirst, tasks: sonnetTasks, seeds: sonnetSeeds,
    development: sonnetFirst.development.reports.map(entry => devReport(entry.model, entry.passed)), oracle: report('oracle', sonnetTasks.map(() => true), { tasks: sonnetTasks }), random: report('random', sonnetTasks.map(() => false), { tasks: sonnetTasks }),
    ladder: [on(OPUS, 20), on(SONNET, 12), on(HAIKU, 2)] });
  assert.deepEqual([result.strongest.model, result.strongest.passed, result.weakest.passed], [SONNET, 12, 2]);
});

test('every run counts: infra errors, missing and unattested runs fail, and more than 5 % of ladder runs voids the round', () => {
  // Two infra errors for the strongest and two missing runs for the weakest: 4 of 78 = 5.1 % > 5 %.
  const result = computeGate({ ...input(first(15), first(10), first(4)), ladder: [report(OPUS, first(15), { infra: [0, 1] }), report(SONNET, first(10)), report(HAIKU, first(4), { missing: [24, 25] })] });
  assert.equal(result.strongest.passed, 13, 'the two infra errors are not passed');
  assert.equal(result.weakest.missing, 2);
  assert.ok(Math.abs(result.infraShare - 4 / 78) < 1e-12);
  assert.equal(result.verdict, 'void');
  // Three of 78 (3.8 %) does not void it.
  const three = computeGate({ ...input(first(15), first(10), first(4)), ladder: [report(OPUS, first(15), { infra: [0, 1] }), report(SONNET, first(10)), report(HAIKU, first(4), { missing: [25] })] });
  assert.notEqual(three.verdict, 'void');
  // Runs whose client reported no model are not passed and count like infrastructure errors (review S3).
  const silent = computeGate({ ...input(first(15), first(10), first(4)), ladder: [report(OPUS, first(15), { runModel: index => index < 4 ? null : OPUS }), report(SONNET, first(10)), report(HAIKU, first(4))] });
  assert.deepEqual([silent.strongest.unattested, silent.strongest.passed], [4, 11]);
  assert.equal(silent.verdict, 'void');
});

test('baselines: oracle 100 %, random at most 5 %, every near miss fails', () => {
  const base = input(first(15), first(10), first(4));
  assert.equal(computeGate({ ...base, oracle: report('oracle', first(25)) }).criteria.find(c => c.name === 'oracle')!.met, false);
  assert.equal(computeGate({ ...base, random: report('random', first(1)) }).criteria.find(c => c.name === 'random')!.met, true, '1 of 26 = 3.8 %');
  assert.equal(computeGate({ ...base, random: report('random', first(2)) }).criteria.find(c => c.name === 'random')!.met, false, '2 of 26 = 7.7 %');
  assert.equal(computeGate({ ...base, nearMisses: { ...base.nearMisses, passed: 1 } }).verdict, 'does not pass');
  refused({ ...base, nearMisses: { total: 100, passed: 0, perInstance: tasks.map((_, index) => index === 3 ? 0 : 4) } }, /every held-out instance needs its near misses/);
});

test('the unit is a distinct instance: the reviewer\'s 13 tasks × seeds 1 and 2 are refused, so is a subset of the tasks (review B1, audit P1-1)', () => {
  const thirteen = tasks.slice(0, 13);
  // b = 8, c = 0 counted twice would read as 16 discordant "instances" (p = 0.0078); refused by name.
  const doubled = (model: string, k: number): BenchReportV2 => report(model, thirteen.map((_, index) => index < k), { tasks: thirteen, seedList: [1, 2] });
  refused({ ...input(first(15), first(10), first(4)), oracle: doubled('oracle', 13), random: doubled('random', 0), ladder: [doubled(OPUS, 10), doubled(SONNET, 6), doubled(HAIKU, 2)] },
    /the oracle report uses seed list 1,2; a generated world has one variant, so the gate takes --seed-list 1 only/);
  refused({ ...input(first(15), first(10), first(4)), oracle: report('oracle', first(13), { tasks: thirteen }) }, /the oracle report does not bench exactly the 26 held-out tasks/);
  refused({ ...input(first(15), first(10), first(4)), ladder: [report(OPUS, first(15), { repeats: 2 }), report(SONNET, first(10)), report(HAIKU, first(4))] }, /--repeats 2; the gate needs one run per agent per instance/);
  refused({ ...input(first(15), first(10), first(4)), tasks: tasks.slice(0, 24), seeds: seeds.slice(0, 24) }, /the preregistered held-out set is 26 distinct instances/);
});

test('round 2 needs every earlier round with disjoint seeds; the release budget stops the gate (review S2, audit P1-3)', () => {
  const second = declarationOf({ round: 2, budget: { ...declaration.budget, releaseRunsBefore: 300 } });
  const secondSeeds = heldOutSeeds(second), secondTasks = secondSeeds.map(seed => `repair-${seed}`);
  const on = (agent: string, k: number): BenchReportV2 => report(agent, secondTasks.map((_, index) => index < k), { tasks: secondTasks });
  const round2: GateInput = { ...input(first(0), first(0), first(0)), declaration: second, tasks: secondTasks, seeds: secondSeeds, oracle: on('oracle', N), random: on('random', 0), ladder: [on(OPUS, 15), on(SONNET, 10), on(HAIKU, 4)] };
  refused(round2, /round 2 needs the held-out reports of every earlier round \(--previous\): rounds 1, given none/);
  refused({ ...round2, previous: [{ round: 1, seeds: [secondSeeds[5]!] }] }, /reuses held-out instances of an earlier round/);
  assert.equal(computeGate({ ...round2, previous: [{ round: 1, seeds }] }).verdict, 'passes');
  refused({ ...input(first(15), first(10), first(4)), previous: [{ round: 1, seeds: [] }] }, /round 1 has no earlier round/);
  // A declaration that claims 500 runs used before the round (never valid, but computeGate is pure):
  refused({ ...input(first(15), first(10), first(4)), declaration: declarationOf({ budget: { ...declaration.budget, releaseRunsBefore: 500 } }) }, /budget exhausted — a maintainer decides on a second round: 587 model runs exceed the release budget of 500/);
});

test('ladder agents are the declared models, every run on its own report\'s model (review S3, audit P2-8)', () => {
  const base = input(first(15), first(10), first(4));
  // Half of the Opus runs on another model: the round is refused, naming a run.
  refused({ ...base, ladder: [report(OPUS, first(15), { runModel: index => index % 2 ? 'claude-sonnet-5-5' : OPUS }), base.ladder[1]!, base.ladder[2]!] }, new RegExp(`run ${tasks[1]}-s1-r1 of the claude-opus-5-5 report ran on claude-sonnet-5-5`));
  refused({ ...base, ladder: [base.ladder[1]!, base.ladder[0]!, base.ladder[2]!] }, /the report of claude-opus-5-5 names model claude-sonnet-5-5/);
  const builtin = { ...report(OPUS, first(15)), agent: { ...base.random.agent } };
  refused({ ...base, ladder: [builtin, base.ladder[1]!, base.ladder[2]!] }, /not from the claude-code preset/);
  // Another model needs the maintainer's approval in the declaration and again at the gate.
  const other = 'gpt-9';
  const approved = declarationOf({ ladder: [OPUS, other, HAIKU], maintainerApproved: [other] }, { reports: [declaration.development.reports[0]!, { ...declaration.development.reports[1]!, model: other }, declaration.development.reports[2]!] });
  const approvedSeeds = heldOutSeeds(approved), approvedTasks = approvedSeeds.map(seed => `repair-${seed}`);
  const on = (agent: string, k: number): BenchReportV2 => report(agent, approvedTasks.map((_, index) => index < k), { tasks: approvedTasks });
  const withOther: GateInput = { ...base, declaration: approved, tasks: approvedTasks, seeds: approvedSeeds, development: approved.development.reports.map(entry => devReport(entry.model, entry.passed)),
    oracle: on('oracle', N), random: on('random', 0), ladder: [on(OPUS, 15), on(other, 10), on(HAIKU, 4)] };
  refused(withOther, /the declaration approves gpt-9 outside the three tiers; pass exactly that as --maintainer-approved/);
  const result = computeGate({ ...withOther, maintainerApproved: [other] });
  assert.equal(result.ladderLabel, null, 'not a Claude-only ladder');
});

test('development reports are the declared ones: their set, settings and outcomes', () => {
  const base = input(first(15), first(10), first(4));
  refused({ ...base, development: [devReport(OPUS, [true, true, true]), ...base.development.slice(1)] }, /the development outcomes of claude-opus-5-5 differ from the declaration/);
  refused({ ...base, development: [devReport(OPUS, [true, true, false], { world: '8' }), ...base.development.slice(1)] }, /was not made on the declared development set/);
  refused({ ...base, development: [devReport(OPUS, [true, true, false], { checks: 1 }), ...base.development.slice(1)] }, /differs from the declaration in mirror, timeout, action cap or check limit/);
  refused({ ...base, development: [devReport(OPUS, [true, true, false], { runModel: () => null }), ...base.development.slice(1)] }, /a development run of claude-opus-5-5 reports no model/);
  refused({ ...base, oracle: report('oracle', first(N), { world: 'x' }) }, /the oracle report was not made on the held-out set the declaration names/);
  refused({ ...base, oracle: report('oracle', first(N), { generated: seeds.map(seed => seed + 1) }) }, /was not made by challenge-repair 1\.0\.0 from its declared seed/);
  refused({ ...base, oracle: report('random', first(0)) }, /oracle report/);
});

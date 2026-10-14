/**
 * The challenge-tier gate (PADR-0040, preregistered): from a round's declaration, its development
 * reports and the bench/2 reports of the held-out round — oracle, random and three ladder agents on
 * the same 26 held-out instances — and the near-miss results, every number the verdict uses and the
 * verdict itself. Pure: the caller reads, validates and re-verifies the reports, regenerates the
 * held-out set from the declaration and judges the near misses. Board text never enters the result
 * or the Markdown.
 */
import { mcnemarExact, mcnemarPower, wilson } from '../bench/stats.ts';
import type { BenchReportV2 } from '../bench/report.ts';
import { BUDGET_EXHAUSTED, ROUND, checkLadderAgent, declarationHash, extremes, unattestedRuns, DeclarationError, type Declaration } from './declaration.ts';
import { generatorId, type Family } from './families.ts';
import { taskIdOf } from './build.ts';

/** Preregistered thresholds (roadmap 0.2.0 item 4). */
export const GATE = Object.freeze({
  minInstances: 24, ladderAgents: 3, headroomLow: 0.10, headroomHigh: 0.80, minDifference: 0.20, alpha: 0.05,
  maxInfraShare: 0.05, oracle: 1, maxRandom: 0.05, maxModelRunsPerRound: 100, maxRounds: ROUND.maxRounds, releaseBudget: ROUND.releaseBudget,
  // The round every family gets (PADR-0040, decided before any ladder run): 3 development instances
  // × 3 agents and 26 held-out instances × 3 agents, 87 model runs; five first rounds use 435 of the
  // 465 runs the release had left, so no second round fits.
  developmentRuns: ROUND.developmentRuns, heldOutInstances: ROUND.heldOutInstances, roundRuns: ROUND.roundRuns, releaseRunsAtPreregistration: 465, families: 5,
});
/** Model runs the release has left once every family had its first round: 465 − 5 × 87 = 30. */
export const RUNS_AFTER_FIRST_ROUNDS = GATE.releaseRunsAtPreregistration - GATE.families * GATE.roundRuns;
/** The only seed list a gate report may use: a generated world has one variant, so another seed
 * would run the same instance again (review B1). */
export const GATE_SEEDS = Object.freeze([1]);
export class GateInputError extends Error {
  readonly code = 'gate_input_invalid';
  constructor(message: string) { super(message); this.name = 'GateInputError'; }
}

export interface AgentResult {
  role: 'oracle' | 'random' | 'ladder'; name: string; model: string | null;
  /** Instances passed; every planned instance counts, a missing, unjudged or unattested run is not passed. */
  passed: number; instances: number; infraErrors: number; missing: number;
  /** Runs whose client reported no model: counted like an infrastructure error (never passed). */
  unattested: number;
  rate: number; interval: { low: number; high: number };
  outcomes: ReadonlyMap<string, boolean>;
}
export interface GateInput {
  declaration: Declaration;
  /** The round's held-out tasks and their generator seeds, regenerated from the declaration, and the
   * regenerated world's content hash. */
  tasks: readonly string[]; seeds: readonly number[]; worldContentHash: string;
  /** One development report per ladder model, in ladder order. */
  development: readonly BenchReportV2[];
  oracle: BenchReportV2; random: BenchReportV2;
  /** One held-out report per ladder model, in ladder order. */
  ladder: readonly BenchReportV2[];
  /** Near misses judged by the separate checker: how many there are, how many passed (must be 0),
   * and how many each instance has (at least one each). */
  nearMisses: { total: number; passed: number; perInstance: readonly number[] };
  /** The held-out generator seeds of every earlier round of this family (required from round 2). */
  previous?: ReadonlyArray<{ round: number; seeds: readonly number[] }>;
  /** `--maintainer-approved` as given to the gate: it must repeat the declaration's. */
  maintainerApproved?: readonly string[];
}
export interface Criterion { name: string; value: string; rule: string; met: boolean }
export interface GateResult {
  family: Family; round: number; generator: { id: string; version: string }; seeds: { low: number; high: number }; difficulty: string;
  declaration: { sha256: string };
  world: { id: string; version: string; contentHash: string }; instances: number;
  settings: { mirror: string; timeoutSeconds: number; maxActions: number; checks: number | null };
  practonaut: string; dates: string[];
  development: Array<{ model: string; passed: number; instances: number }>;
  agents: AgentResult[]; strongest: AgentResult; weakest: AgentResult;
  discordant: { strongestOnly: number; weakestOnly: number; p: number };
  infraShare: number; modelRuns: number; developmentRuns: number;
  /** Power of the exact McNemar test at this size for a 20-point, one-sided disagreement. */
  power: number;
  criteria: Criterion[]; verdict: 'passes' | 'does not pass' | 'void'; ladderLabel: string | null;
  releaseRuns: number;
}

const share = (value: number): string => `${(value * 100).toFixed(1)} %`;
const sorted = (values: readonly string[]): string => [...values].sort().join('\u0000');

function agentResult(report: BenchReportV2, role: AgentResult['role'], plan: readonly string[], unattested: readonly string[] = []): AgentResult {
  const outcomes = new Map<string, boolean>();
  let infraErrors = 0, unattestedCount = 0;
  for (const run of report.runs) {
    if (run.status === 'infra_error') infraErrors++;
    else if (unattested.includes(run.id)) unattestedCount++;
    outcomes.set(run.taskId, run.pass && !unattested.includes(run.id));
  }
  const missing = plan.filter(key => !outcomes.has(key)).length;
  for (const key of plan) if (!outcomes.has(key)) outcomes.set(key, false);
  const passed = plan.filter(key => outcomes.get(key) === true).length;
  return { role, name: report.agent.name, model: report.agent.model, passed, instances: plan.length, infraErrors, missing, unattested: unattestedCount, rate: passed / plan.length, interval: wilson(passed, plan.length), outcomes };
}

export function computeGate(input: GateInput): GateResult {
  const fail = (message: string): never => { throw new GateInputError(message); };
  const guarded = <T>(work: () => T): T => { try { return work(); } catch (error) { if (error instanceof DeclarationError) fail(error.message); throw error; } };
  const declaration = input.declaration, family = declaration.family, round = declaration.round;
  if (sorted(input.maintainerApproved ?? []) !== sorted(declaration.maintainerApproved))
    fail(`the declaration approves ${declaration.maintainerApproved.join(', ') || 'no model'} outside the three tiers; pass exactly that as --maintainer-approved`);
  // Every earlier round of the family, with seeds disjoint from this one (review S2, audit P1-3).
  const previous = input.previous ?? [];
  const earlier = previous.map(entry => entry.round).sort((a, b) => a - b).join();
  const expected = Array.from({ length: round - 1 }, (_, index) => index + 1).join();
  if (earlier !== expected) fail(round === 1 ? 'round 1 has no earlier round' : `round ${round} needs the held-out reports of every earlier round (--previous): rounds ${expected}, given ${earlier || 'none'}`);
  if (previous.some(entry => entry.seeds.some(seed => input.seeds.includes(seed)))) fail('this round reuses held-out instances of an earlier round');
  // The planned instances: the 26 distinct regenerated tasks, one run each.
  const plan = [...input.tasks];
  if (plan.length !== ROUND.heldOutInstances || new Set(plan).size !== plan.length || input.seeds.length !== plan.length) fail(`the preregistered held-out set is ${ROUND.heldOutInstances} distinct instances, not ${new Set(plan).size}`);
  if (plan.some((task, index) => task !== taskIdOf(family, input.seeds[index]!))) fail('the held-out tasks are not the declared seeds');
  const bench = declaration.bench;
  const sameSettings = (report: BenchReportV2): boolean => report.environment.mirror === bench.mirror && report.settings.timeoutSeconds === bench.timeoutSeconds && report.settings.maxActions === bench.maxActions && (report.settings.checks ?? null) === bench.checks;
  const onePerInstance = (report: BenchReportV2, label: string): void => {
    if (report.settings.seeds.join() !== GATE_SEEDS.join()) fail(`the ${label} report uses seed list ${report.settings.seeds.join(',')}; a generated world has one variant, so the gate takes --seed-list 1 only (another seed repeats an instance)`);
    if (report.settings.repeats !== 1) fail(`the ${label} report has --repeats ${report.settings.repeats}; the gate needs one run per agent per instance`);
    if (!sameSettings(report)) fail(`the ${label} report differs from the declaration in mirror, timeout, action cap or check limit`);
  };
  // The held-out reports: the regenerated world, exactly its 26 tasks, the declared settings.
  for (const [label, report] of [['oracle', input.oracle], ['random', input.random], ...input.ladder.map((value, index) => [declaration.ladder[index] ?? `ladder ${index + 1}`, value] as const)] as const) {
    if (report.environment.world.contentHash !== input.worldContentHash) fail(`the ${label} report was not made on the held-out set the declaration names`);
    onePerInstance(report, label);
    if (sorted(report.settings.tasks) !== sorted(plan) || report.settings.tasks.length !== plan.length) fail(`the ${label} report does not bench exactly the ${plan.length} held-out tasks`);
  }
  if (input.oracle.agent.kind !== 'builtin' || input.oracle.agent.name !== 'oracle') fail('the oracle report is not from the oracle agent');
  if (input.random.agent.kind !== 'builtin' || input.random.agent.name !== 'random') fail('the random report is not from the random agent');
  if (input.ladder.length !== ROUND.agents || input.development.length !== ROUND.agents) fail('the round has one development and one held-out report per ladder model');
  // Ladder agents: the declared models, each run on the model its report names (review S3, audit P2-8).
  const unattested = input.ladder.map((report, index) => guarded(() => { checkLadderAgent(report, declaration.ladder[index]!, declaration.maintainerApproved); return unattestedRuns(report, declaration.ladder[index]!); }));
  // Development: the declared instances, settings and outcomes; they name strongest and weakest.
  const devTasks = declaration.development.seeds.map(seed => taskIdOf(family, seed));
  const development = input.development.map((report, index) => {
    const name = declaration.ladder[index]!;
    guarded(() => { checkLadderAgent(report, name, declaration.maintainerApproved); if (unattestedRuns(report, name).length) fail(`a development run of ${name} reports no model`); });
    if (report.environment.world.contentHash !== declaration.development.world.contentHash) fail(`the development report of ${name} was not made on the declared development set`);
    onePerInstance(report, `development ${name}`);
    if (report.settings.tasks.join() !== devTasks.join()) fail(`the development report of ${name} does not bench the declared development instances`);
    const passed = devTasks.map(task => report.runs.some(run => run.taskId === task && run.pass));
    if (passed.join() !== declaration.development.reports[index]!.passed.join()) fail(`the development outcomes of ${name} differ from the declaration`);
    return { model: name, passed };
  });
  const named = extremes(development);
  if (named.strongest !== declaration.development.strongest || named.weakest !== declaration.development.weakest) fail('the development outcomes do not name the declared strongest and weakest');
  const developmentRuns = input.development.reduce((total, report) => total + report.runs.length, 0);
  if (developmentRuns !== ROUND.developmentRuns) fail(`the development reports hold ${developmentRuns} runs, the declaration ${ROUND.developmentRuns}`);
  // Every instance is a generated task of this family and the declared generator version.
  const generated = new Map(input.oracle.environment.world.generated.map(entry => [entry.taskId, entry]));
  for (const [index, task] of plan.entries()) {
    const by = generated.get(task);
    if (!by || by.id !== generatorId(family) || by.version !== declaration.generator.version || by.seed !== input.seeds[index]) fail(`task ${task} was not made by ${generatorId(family)} ${declaration.generator.version} from its declared seed`);
  }
  if (input.nearMisses.perInstance.length !== plan.length || input.nearMisses.perInstance.some(count => count < 1)) fail('every held-out instance needs its near misses (at least one each)');

  const oracle = agentResult(input.oracle, 'oracle', plan), random = agentResult(input.random, 'random', plan);
  const ladder = input.ladder.map((report, index) => agentResult(report, 'ladder', plan, unattested[index]));
  const strongest = ladder[declaration.ladder.indexOf(declaration.development.strongest)]!, weakest = ladder[declaration.ladder.indexOf(declaration.development.weakest)]!;
  let strongestOnly = 0, weakestOnly = 0;
  for (const key of plan) {
    const s = strongest.outcomes.get(key) === true, w = weakest.outcomes.get(key) === true;
    if (s && !w) strongestOnly++;
    if (w && !s) weakestOnly++;
  }
  const { p } = mcnemarExact(strongestOnly, weakestOnly);
  const ladderRuns = ladder.length * plan.length;
  const infraShare = ladder.reduce((total, agent) => total + agent.infraErrors + agent.missing + agent.unattested, 0) / ladderRuns;
  const modelRuns = ladderRuns + developmentRuns;
  const releaseRuns = declaration.budget.releaseRunsBefore + modelRuns;
  if (modelRuns !== ROUND.roundRuns) fail(`the round holds ${modelRuns} model runs, the declaration ${ROUND.roundRuns}`);
  if (releaseRuns > GATE.releaseBudget) fail(`${BUDGET_EXHAUSTED}: ${releaseRuns} model runs exceed the release budget of ${GATE.releaseBudget}`);
  const difference = strongest.rate - weakest.rate;
  const criteria: Criterion[] = [
    { name: 'headroom', value: `${strongest.passed}/${plan.length} (${share(strongest.rate)})`, rule: 'strongest passes 10 %–80 % of the instances', met: strongest.rate >= GATE.headroomLow && strongest.rate <= GATE.headroomHigh },
    { name: 'difference', value: `${(difference * 100).toFixed(1)} points`, rule: 'strongest − weakest ≥ 20 points', met: difference >= GATE.minDifference - 1e-12 },
    { name: 'mcnemar', value: `b = ${strongestOnly}, c = ${weakestOnly}, p = ${p.toFixed(4)}`, rule: 'exact McNemar on discordant instances, p < 0.05', met: p < GATE.alpha },
    { name: 'oracle', value: `${oracle.passed}/${plan.length}`, rule: 'oracle passes 100 %', met: oracle.passed === plan.length },
    { name: 'random', value: `${random.passed}/${plan.length} (${share(random.rate)})`, rule: 'random passes ≤ 5 %', met: random.rate <= GATE.maxRandom },
    { name: 'near-misses', value: `${input.nearMisses.total - input.nearMisses.passed}/${input.nearMisses.total} fail`, rule: 'every near miss fails', met: input.nearMisses.total > 0 && input.nearMisses.passed === 0 },
    { name: 'infrastructure', value: `${share(infraShare)} of ${ladderRuns} ladder runs`, rule: 'infra_error, missing or unattested runs ≤ 5 %, else the round is void', met: infraShare <= GATE.maxInfraShare },
    { name: 'budget', value: `${modelRuns} model runs (${ladderRuns} gate + ${developmentRuns} development); release ${releaseRuns} of ${GATE.releaseBudget}`, rule: '≤ 100 model runs per family and round, ≤ 500 in the release', met: modelRuns <= GATE.maxModelRunsPerRound && releaseRuns <= GATE.releaseBudget },
  ];
  const void_ = !criteria.find(c => c.name === 'infrastructure')!.met;
  const verdict = void_ ? 'void' : criteria.every(c => c.met) ? 'passes' : 'does not pass';
  const base = input.oracle, reports = [input.oracle, input.random, ...input.ladder];
  return {
    family, round, generator: { id: generatorId(family), version: declaration.generator.version }, seeds: { low: Math.min(...input.seeds), high: Math.max(...input.seeds) }, difficulty: declaration.difficulty,
    declaration: { sha256: declarationHash(declaration) },
    world: { id: base.environment.world.worldId, version: base.environment.world.version, contentHash: base.environment.world.contentHash }, instances: plan.length,
    settings: { mirror: base.environment.mirror, timeoutSeconds: base.settings.timeoutSeconds, maxActions: base.settings.maxActions, checks: base.settings.checks ?? null },
    practonaut: base.environment.practonaut, dates: [...new Set(reports.map(report => report.createdAt.slice(0, 10)))].sort(),
    development: development.map(entry => ({ model: entry.model, passed: entry.passed.filter(Boolean).length, instances: entry.passed.length })),
    agents: [oracle, random, ...ladder], strongest, weakest, discordant: { strongestOnly, weakestOnly, p }, infraShare, modelRuns: ladderRuns, developmentRuns, power: mcnemarPower(plan.length, GATE.minDifference, 0, GATE.alpha),
    criteria, verdict, ladderLabel: declaration.ladder.every(name => /^claude/i.test(name)) ? 'ladder: Claude models only' : null,
    releaseRuns,
  };
}

const cell = (value: string): string => value.replace(/[|\\`*_[\]<>]/g, character => `\\${character}`);
const fixed = (value: number): string => value.toFixed(3);

/** The gate report as Markdown: every number the verdict uses; names and models escaped. */
export function renderGate(result: GateResult): string {
  const lines: string[] = [];
  lines.push(`# Challenge gate: ${result.family}, round ${result.round}`, '');
  lines.push(`**Verdict: ${result.verdict === 'passes' ? 'the family passes this round' : result.verdict === 'void' ? 'the round is void (more than 5 % infrastructure errors)' : 'the family does not pass this round'}.**${result.ladderLabel ? ` ${result.ladderLabel}.` : ''}`, '');
  lines.push('Preregistered in [PADR-0040](../../adr/0040-challenge-tier-generated-families-and-gate.md) (roadmap 0.2.0, item 4) and in this round\'s declaration. Every number below is computed by `node tools/challenge.ts gate` from the declaration, three development reports and five held-out `practonaut.bench/2` reports, each validated and re-verified, on a held-out set regenerated from the declaration.', '');
  lines.push('## Round', '');
  lines.push('| Fact | Value |', '|---|---|');
  lines.push(`| Declaration | \`${cell(result.family)}-round-${result.round}.declaration.json\`, canonical SHA-256 \`${result.declaration.sha256.slice(0, 16)}…\` |`);
  lines.push(`| Generator | \`${cell(result.generator.id)}\` ${cell(result.generator.version)}, difficulty ${cell(result.difficulty)} |`);
  lines.push(`| Held-out instances | ${result.instances} (generator seeds ${result.seeds.low}–${result.seeds.high}, derived from the declaration; one run per agent per instance) |`);
  lines.push(`| World | \`${cell(result.world.id)}\` ${cell(result.world.version)}, content hash \`${result.world.contentHash.slice(0, 16)}…\` |`);
  lines.push(`| Settings | mirror ${cell(result.settings.mirror)}, timeout ${result.settings.timeoutSeconds} s, at most ${result.settings.maxActions} act/undo/reset calls${result.settings.checks === null ? '' : `, --checks ${result.settings.checks}`} |`);
  lines.push(`| Practonaut | ${cell(result.practonaut)}; reports dated ${result.dates.join(', ')} |`);
  lines.push(`| Development | ${result.development.map(entry => `\`${cell(entry.model)}\` ${entry.passed}/${entry.instances}`).join(', ')} |`);
  lines.push(`| Preregistered | strongest \`${cell(result.strongest.model ?? '')}\`, weakest \`${cell(result.weakest.model ?? '')}\` (most and fewest development passes; ties by the declared capability order) |`, '');
  lines.push('## Agents', '');
  lines.push('| Agent | Model (client-reported) | Passed | Rate | 95 % Wilson interval | infra_error | Missing runs | Unattested runs |', '|---|---|---|---|---|---|---|---|');
  for (const agent of result.agents) lines.push(`| ${agent.role === 'ladder' ? 'ladder' : agent.role} (${cell(agent.name)}) | ${agent.model === null ? '—' : `\`${cell(agent.model)}\``} | ${agent.passed}/${agent.instances} | ${fixed(agent.rate)} | ${fixed(agent.interval.low)}–${fixed(agent.interval.high)} | ${agent.infraErrors} | ${agent.missing} | ${agent.unattested} |`);
  lines.push('');
  lines.push('## Criteria', '');
  lines.push('| Criterion | Value | Rule | Met |', '|---|---|---|---|');
  for (const criterion of result.criteria) lines.push(`| ${criterion.name} | ${cell(criterion.value)} | ${cell(criterion.rule)} | ${criterion.met ? 'yes' : 'no'} |`);
  lines.push('');
  lines.push(`Discordant instances: the strongest passed and the weakest failed on ${result.discordant.strongestOnly}, the reverse on ${result.discordant.weakestOnly}; two-sided exact McNemar p = ${result.discordant.p.toFixed(4)}.`);
  lines.push(`Model runs in this round: ${result.modelRuns} gate runs and ${result.developmentRuns} development runs. Release total after this round: ${result.releaseRuns} of ${GATE.releaseBudget}.`);
  lines.push(`Power at this size: if the two agents disagreed on 20 % of the instances, all in the stronger one's favour, the exact McNemar test would reach p < 0.05 with probability ${result.power.toFixed(2)}; "does not pass" on discrimination is not evidence that the agents are equal.`);
  // The five first rounds leave fewer runs than a round needs: no second round fits the budget.
  if (result.verdict !== 'passes') lines.push(`Second round: ${BUDGET_EXHAUSTED}. After the five first rounds of ${GATE.roundRuns} model runs each the release has ${RUNS_AFTER_FIRST_ROUNDS} of the ${GATE.releaseRunsAtPreregistration} runs it had left at preregistration, fewer than one round.`);
  lines.push('');
  return lines.join('\n') + '\n';
}

/**
 * The challenge-tier gate (PADR-0040, preregistered): from the bench/2 reports of one round — oracle,
 * random and three ladder agents on the same held-out instances — and the near-miss results, every
 * number the verdict uses and the verdict itself. Pure: the caller validates and re-verifies the
 * reports and judges the near misses. Board text never enters the result or the Markdown.
 */
import { mcnemarExact, mcnemarPower, wilson } from '../bench/stats.ts';
import type { BenchReportV2 } from '../bench/report.ts';
import { SEED_RANGES } from './build.ts';
import { FAMILIES, generatorId, type Family } from './families.ts';

/** Preregistered thresholds (roadmap 0.2.0 item 4). */
export const GATE = Object.freeze({
  minInstances: 24, ladderAgents: 3, headroomLow: 0.10, headroomHigh: 0.80, minDifference: 0.20, alpha: 0.05,
  maxInfraShare: 0.05, oracle: 1, maxRandom: 0.05, maxModelRunsPerRound: 100, maxRounds: 2, releaseBudget: 500,
  // The round every family gets (PADR-0040, decided before any ladder run): 3 development instances
  // × 3 agents and 26 held-out instances × 3 agents, 87 model runs; five first rounds use 435 of the
  // 465 runs the release had left, so no second round fits.
  developmentRuns: 9, heldOutInstances: 26, roundRuns: 87, releaseRunsAtPreregistration: 465, families: 5,
});
/** The preregistered held-out size for a round with these development runs, or null when the round
 * does not follow the preregistration (PADR-0040): 9 development runs and 26 held-out instances. */
export function heldOutSize(developmentRuns: number): number | null {
  return developmentRuns === GATE.developmentRuns ? GATE.heldOutInstances : null;
}
/** Model runs the release has left once every family had its first round: 465 − 5 × 87 = 30. */
export const RUNS_AFTER_FIRST_ROUNDS = GATE.releaseRunsAtPreregistration - GATE.families * GATE.roundRuns;
export class GateInputError extends Error {
  readonly code = 'gate_input_invalid';
  constructor(message: string) { super(message); this.name = 'GateInputError'; }
}

export interface AgentResult {
  role: 'oracle' | 'random' | 'ladder'; name: string; model: string | null;
  /** Instances passed; every planned instance counts, a missing or unjudged run is not passed. */
  passed: number; instances: number; infraErrors: number; missing: number;
  rate: number; interval: { low: number; high: number };
  outcomes: ReadonlyMap<string, boolean>;
}
export interface GateInput {
  family: Family; round: number;
  oracle: BenchReportV2; random: BenchReportV2; ladder: readonly BenchReportV2[];
  /** Preregistered from the development runs, by the model the client reported. */
  strongest: string; weakest: string;
  /** Near misses judged by the separate checker: how many there are and how many passed (must be 0). */
  nearMisses: { total: number; passed: number };
  /** Model runs spent on this family's development runs for this round (fixes the held-out size). */
  developmentRuns: number;
  /** Generator seeds of an earlier round of this family: a second round must not reuse any. */
  previousSeeds?: readonly number[];
  /** Model runs the release has used before this round (for the 500-run budget note). */
  releaseRunsBefore?: number;
}
export interface Criterion { name: string; value: string; rule: string; met: boolean }
export interface GateResult {
  family: Family; round: number; generator: { id: string; version: string }; seeds: { low: number; high: number }; difficulty: string;
  world: { id: string; version: string; contentHash: string }; instances: number;
  settings: { mirror: string; timeoutSeconds: number; maxActions: number; checks: number | null };
  practonaut: string; dates: string[];
  agents: AgentResult[]; strongest: AgentResult; weakest: AgentResult;
  discordant: { strongestOnly: number; weakestOnly: number; p: number };
  infraShare: number; modelRuns: number; developmentRuns: number;
  /** Power of the exact McNemar test at this size for a 20-point, one-sided disagreement. */
  power: number;
  criteria: Criterion[]; verdict: 'passes' | 'does not pass' | 'void'; ladderLabel: string | null;
  releaseRuns: number | null;
}

const instanceKey = (taskId: string, seed: number): string => `${taskId} s${seed}`;
const share = (value: number): string => `${(value * 100).toFixed(1)} %`;

function agentResult(report: BenchReportV2, role: AgentResult['role'], plan: readonly string[]): AgentResult {
  const outcomes = new Map<string, boolean>();
  let infraErrors = 0;
  for (const run of report.runs) {
    outcomes.set(instanceKey(run.taskId, run.seed), run.pass);
    if (run.status === 'infra_error') infraErrors++;
  }
  const missing = plan.filter(key => !outcomes.has(key)).length;
  for (const key of plan) if (!outcomes.has(key)) outcomes.set(key, false);
  const passed = plan.filter(key => outcomes.get(key) === true).length;
  return { role, name: report.agent.name, model: report.agent.model, passed, instances: plan.length, infraErrors, missing, rate: passed / plan.length, interval: wilson(passed, plan.length), outcomes };
}

export function computeGate(input: GateInput): GateResult {
  const fail = (message: string): never => { throw new GateInputError(message); };
  if (!FAMILIES.includes(input.family)) fail(`unknown family ${input.family}`);
  if (!Number.isSafeInteger(input.round) || input.round < 1 || input.round > GATE.maxRounds) fail(`a family gets at most ${GATE.maxRounds} rounds`);
  if (input.ladder.length !== 3) fail('the ladder has exactly three agents');
  const reports = [input.oracle, input.random, ...input.ladder];
  const base = input.oracle;
  // One world, one plan, one setting for all five agents.
  for (const report of reports) {
    if (report.environment.world.contentHash !== base.environment.world.contentHash) fail('the reports were made on different worlds');
    if (report.settings.tasks.join() !== base.settings.tasks.join() || report.settings.seeds.join() !== base.settings.seeds.join()) fail('the reports plan different instances');
    if (report.settings.repeats !== 1) fail('the gate needs one run per agent per instance (--repeats 1)');
    if (report.environment.mirror !== base.environment.mirror || report.settings.timeoutSeconds !== base.settings.timeoutSeconds || report.settings.maxActions !== base.settings.maxActions || (report.settings.checks ?? null) !== (base.settings.checks ?? null)) fail('the reports differ in mirror, timeout, action cap or check limit');
  }
  if (input.oracle.agent.kind !== 'builtin' || input.oracle.agent.name !== 'oracle') fail('the oracle report is not from the oracle agent');
  if (input.random.agent.kind !== 'builtin' || input.random.agent.name !== 'random') fail('the random report is not from the random agent');
  const models = input.ladder.map(report => report.agent.model);
  for (const report of input.ladder) {
    if (report.agent.kind !== 'preset' || report.agent.name !== 'claude-code' || report.agent.modelSource !== 'client-attested' || report.agent.model === null) fail('every ladder agent is the claude-code preset with a model its client reported');
  }
  if (new Set(models).size !== 3) fail('the three ladder agents must report three different models');
  if (input.strongest === input.weakest || !models.includes(input.strongest) || !models.includes(input.weakest)) fail('strongest and weakest must name two different ladder models (preregistered from the development runs)');
  // Every instance is a generated task of this family from the held-out range.
  const generated = new Map(base.environment.world.generated.map(entry => [entry.taskId, entry]));
  const id = generatorId(input.family);
  const versions = new Set<string>(), seeds: number[] = [];
  for (const task of base.settings.tasks) {
    const by = generated.get(task);
    if (!by || by.id !== id) fail(`task ${task} was not made by the ${id} generator`);
    if (by!.seed < SEED_RANGES.heldout[0]) fail(`task ${task} has seed ${by!.seed}, outside the held-out range (≥ ${SEED_RANGES.heldout[0]})`);
    versions.add(by!.version); seeds.push(by!.seed);
  }
  if (versions.size !== 1) fail('the instances come from different generator versions');
  if (input.previousSeeds?.some(seed => seeds.includes(seed))) fail('this round reuses held-out instances of an earlier round');
  const plan = base.settings.tasks.flatMap(task => base.settings.seeds.map(seed => instanceKey(task, seed)));
  if (plan.length < GATE.minInstances) fail(`the gate needs at least ${GATE.minInstances} held-out instances, these reports have ${plan.length}`);
  if (!Number.isSafeInteger(input.developmentRuns) || input.developmentRuns < 0) fail('name the development runs of this round (a whole number)');
  const size = heldOutSize(input.developmentRuns);
  if (size === null) fail(`the preregistered round has ${GATE.developmentRuns} development runs (3 instances × 3 agents), not ${input.developmentRuns}`);
  if (plan.length !== size) fail(`the preregistered held-out size is ${size} instances, these reports have ${plan.length}`);

  const oracle = agentResult(input.oracle, 'oracle', plan), random = agentResult(input.random, 'random', plan);
  const ladder = input.ladder.map(report => agentResult(report, 'ladder', plan));
  const strongest = ladder.find(agent => agent.model === input.strongest)!, weakest = ladder.find(agent => agent.model === input.weakest)!;
  let strongestOnly = 0, weakestOnly = 0;
  for (const key of plan) {
    const s = strongest.outcomes.get(key) === true, w = weakest.outcomes.get(key) === true;
    if (s && !w) strongestOnly++;
    if (w && !s) weakestOnly++;
  }
  const { p } = mcnemarExact(strongestOnly, weakestOnly);
  const ladderRuns = ladder.length * plan.length;
  const infraShare = ladder.reduce((total, agent) => total + agent.infraErrors + agent.missing, 0) / ladderRuns;
  const developmentRuns = input.developmentRuns;
  const modelRuns = ladderRuns + developmentRuns;
  const difference = strongest.rate - weakest.rate;
  const criteria: Criterion[] = [
    { name: 'headroom', value: `${strongest.passed}/${plan.length} (${share(strongest.rate)})`, rule: 'strongest passes 10 %–80 % of the instances', met: strongest.rate >= GATE.headroomLow && strongest.rate <= GATE.headroomHigh },
    { name: 'difference', value: `${(difference * 100).toFixed(1)} points`, rule: 'strongest − weakest ≥ 20 points', met: difference >= GATE.minDifference - 1e-12 },
    { name: 'mcnemar', value: `b = ${strongestOnly}, c = ${weakestOnly}, p = ${p.toFixed(4)}`, rule: 'exact McNemar on discordant instances, p < 0.05', met: p < GATE.alpha },
    { name: 'oracle', value: `${oracle.passed}/${plan.length}`, rule: 'oracle passes 100 %', met: oracle.passed === plan.length },
    { name: 'random', value: `${random.passed}/${plan.length} (${share(random.rate)})`, rule: 'random passes ≤ 5 %', met: random.rate <= GATE.maxRandom },
    { name: 'near-misses', value: `${input.nearMisses.total - input.nearMisses.passed}/${input.nearMisses.total} fail`, rule: 'every near miss fails', met: input.nearMisses.total > 0 && input.nearMisses.passed === 0 },
    { name: 'infrastructure', value: `${share(infraShare)} of ${ladderRuns} ladder runs`, rule: 'infra_error (missing runs included) ≤ 5 %, else the round is void', met: infraShare <= GATE.maxInfraShare },
    { name: 'budget', value: `${modelRuns} model runs (${ladderRuns} gate + ${developmentRuns} development)`, rule: '≤ 100 model runs per family and round', met: modelRuns <= GATE.maxModelRunsPerRound },
  ];
  const void_ = !criteria.find(c => c.name === 'infrastructure')!.met;
  const verdict = void_ ? 'void' : criteria.every(c => c.met) ? 'passes' : 'does not pass';
  const generatorEntry = generated.get(base.settings.tasks[0]!)!;
  const difficulties = [...new Set(base.settings.tasks.map(task => String(generated.get(task)!.parameters.difficulty ?? '?')))].sort();
  return {
    family: input.family, round: input.round, generator: { id, version: generatorEntry.version }, seeds: { low: Math.min(...seeds), high: Math.max(...seeds) }, difficulty: difficulties.join(', '),
    world: { id: base.environment.world.worldId, version: base.environment.world.version, contentHash: base.environment.world.contentHash }, instances: plan.length,
    settings: { mirror: base.environment.mirror, timeoutSeconds: base.settings.timeoutSeconds, maxActions: base.settings.maxActions, checks: base.settings.checks ?? null },
    practonaut: base.environment.practonaut, dates: [...new Set(reports.map(report => report.createdAt.slice(0, 10)))].sort(),
    agents: [oracle, random, ...ladder], strongest, weakest, discordant: { strongestOnly, weakestOnly, p }, infraShare, modelRuns: ladderRuns, developmentRuns, power: mcnemarPower(plan.length, GATE.minDifference, 0, GATE.alpha),
    criteria, verdict, ladderLabel: models.every(model => /^claude/i.test(model!)) ? 'ladder: Claude models only' : null,
    releaseRuns: input.releaseRunsBefore === undefined ? null : input.releaseRunsBefore + modelRuns,
  };
}

const cell = (value: string): string => value.replace(/[|\\`*_[\]<>]/g, character => `\\${character}`);
const fixed = (value: number): string => value.toFixed(3);

/** The gate report as Markdown: every number the verdict uses; names and models escaped. */
export function renderGate(result: GateResult): string {
  const lines: string[] = [];
  lines.push(`# Challenge gate: ${result.family}, round ${result.round}`, '');
  lines.push(`**Verdict: ${result.verdict === 'passes' ? 'the family passes this round' : result.verdict === 'void' ? 'the round is void (more than 5 % infrastructure errors)' : 'the family does not pass this round'}.**${result.ladderLabel ? ` ${result.ladderLabel}.` : ''}`, '');
  lines.push('Preregistered in [PADR-0040](../../adr/0040-challenge-tier-generated-families-and-gate.md) (roadmap 0.2.0, item 4). Every number below is computed by `node tools/challenge.ts gate` from five validated, re-verified `practonaut.bench/2` reports.', '');
  lines.push('## Round', '');
  lines.push('| Fact | Value |', '|---|---|');
  lines.push(`| Generator | \`${cell(result.generator.id)}\` ${cell(result.generator.version)}, difficulty ${cell(result.difficulty)} |`);
  lines.push(`| Held-out instances | ${result.instances} (generator seeds ${result.seeds.low}–${result.seeds.high}, one run per agent per instance) |`);
  lines.push(`| World | \`${cell(result.world.id)}\` ${cell(result.world.version)}, content hash \`${result.world.contentHash.slice(0, 16)}…\` |`);
  lines.push(`| Settings | mirror ${cell(result.settings.mirror)}, timeout ${result.settings.timeoutSeconds} s, at most ${result.settings.maxActions} act/undo/reset calls${result.settings.checks === null ? '' : `, --checks ${result.settings.checks}`} |`);
  lines.push(`| Practonaut | ${cell(result.practonaut)}; reports dated ${result.dates.join(', ')} |`);
  lines.push(`| Preregistered | strongest \`${cell(result.strongest.model ?? '')}\`, weakest \`${cell(result.weakest.model ?? '')}\` (from development runs) |`, '');
  lines.push('## Agents', '');
  lines.push('| Agent | Model (client-reported) | Passed | Rate | 95 % Wilson interval | infra_error | Missing runs |', '|---|---|---|---|---|---|---|');
  for (const agent of result.agents) lines.push(`| ${agent.role === 'ladder' ? 'ladder' : agent.role} (${cell(agent.name)}) | ${agent.model === null ? '—' : `\`${cell(agent.model)}\``} | ${agent.passed}/${agent.instances} | ${fixed(agent.rate)} | ${fixed(agent.interval.low)}–${fixed(agent.interval.high)} | ${agent.infraErrors} | ${agent.missing} |`);
  lines.push('');
  lines.push('## Criteria', '');
  lines.push('| Criterion | Value | Rule | Met |', '|---|---|---|---|');
  for (const criterion of result.criteria) lines.push(`| ${criterion.name} | ${cell(criterion.value)} | ${cell(criterion.rule)} | ${criterion.met ? 'yes' : 'no'} |`);
  lines.push('');
  lines.push(`Discordant instances: the strongest passed and the weakest failed on ${result.discordant.strongestOnly}, the reverse on ${result.discordant.weakestOnly}; two-sided exact McNemar p = ${result.discordant.p.toFixed(4)}.`);
  lines.push(`Model runs in this round: ${result.modelRuns} gate runs and ${result.developmentRuns} development runs.${result.releaseRuns === null ? '' : ` Release total after this round: ${result.releaseRuns} of ${GATE.releaseBudget}.`}`);
  lines.push(`Power at this size: if the two agents disagreed on 20 % of the instances, all in the stronger one's favour, the exact McNemar test would reach p < 0.05 with probability ${result.power.toFixed(2)}; "does not pass" on discrimination is not evidence that the agents are equal.`);
  if (result.verdict !== 'passes') lines.push(`Second round: budget exhausted — a maintainer decides on a second round. After the five first rounds of ${GATE.roundRuns} model runs each the release has ${RUNS_AFTER_FIRST_ROUNDS} of the ${GATE.releaseRunsAtPreregistration} runs it had left at preregistration, fewer than one round.`);
  lines.push('');
  return lines.join('\n') + '\n';
}

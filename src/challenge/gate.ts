/**
 * The challenge-tier gate (PADR-0040, preregistered): from a round's declaration, its development
 * reports and the bench/2 reports of the held-out round — oracle, random and three ladder agents on
 * the same 26 held-out instances, each possibly resumed over several reports — the near-miss results
 * and the model runs found in the bench folders, every number the verdict uses and the verdict
 * itself; and the preflight that checks everything but the ladder before any ladder run. Pure: the
 * caller reads, validates and re-verifies the reports, checks git, regenerates the held-out set from
 * the declaration, judges the near misses and scans the bench folders. Board text never enters the
 * result or the Markdown.
 */
import { mcnemarExact, mcnemarPower, wilson } from '../bench/stats.ts';
import type { BenchReportV2, BenchRunV2 } from '../bench/report.ts';
import { BUDGET_EXHAUSTED, ROUND, checkLadderAgent, declarationHash, developmentDigest, digestRunOf, orderOf, unattestedRuns, DeclarationError, type Declaration, type DigestSession } from './declaration.ts';
import { generatorId, type Family } from './families.ts';
import { taskIdOf } from './build.ts';

/** Preregistered thresholds (roadmap 0.2.0 item 4). */
export const GATE = Object.freeze({
  minInstances: 24, ladderAgents: 3, headroomLow: 0.10, headroomHigh: 0.80, minDifference: 0.20, alpha: 0.05,
  maxInfraShare: 0.05, oracle: 1, maxRandom: 0.05, maxModelRunsPerRound: ROUND.maxRunsPerRound, maxRounds: ROUND.maxRounds, releaseBudget: ROUND.releaseBudget,
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

/** A validated, re-verified report and the name of its bench folder; for a development report, the
 * judged sessions of its runs (by run id), which the development digest reads. */
export interface GateReport { report: BenchReportV2; bench: string; sessions?: ReadonlyMap<string, DigestSession> }
/** A model run found in a bench folder (a run folder with the agent's own output). `status`: as its
 * bench's report lists it; `unjudged` when no report lists it and it has no checker output (a killed
 * bench); null when it was judged but no report lists it. */
export interface SpentRun { bench: string; runId: string; taskId: string; model: string | null; status: string | null; rejected?: boolean }
/** A run the client rejected before any model work (third review): an infra_error its client names a
 * usage or rate limit or a login or billing error for, with no tokens and no tool call of the agent
 * (the bridge's start-up read aside). Listed in the ledger, never counted against a budget. */
export function rejectedByClient(run: { status?: unknown; note?: unknown; toolCalls?: { observe?: unknown; act?: unknown; undo?: unknown; reset?: unknown; check?: unknown }; client?: { tokens?: unknown } }): boolean {
  const calls = run.toolCalls ?? {}, tokens = run.client?.tokens as { input?: unknown; output?: unknown; cacheRead?: unknown; cacheCreation?: unknown } | null | undefined;
  const none = (value: unknown): boolean => value === 0;
  return run.status === 'infra_error' && typeof run.note === 'string' && /^the client reported (a usage or rate limit|an authentication or billing error) \(/.test(run.note)
    && none(calls.act) && none(calls.undo) && none(calls.reset) && none(calls.check) && typeof calls.observe === 'number' && calls.observe <= 1
    && (tokens === null || tokens === undefined || [tokens.input, tokens.output, tokens.cacheRead, tokens.cacheCreation].every(none));
}
/** Runs that may be benched again: listed as infra_error, or never judged. */
const resumable = (status: string | null): boolean => status === 'infra_error' || status === 'unjudged';
export interface AgentResult {
  role: 'oracle' | 'random' | 'ladder'; name: string; model: string | null;
  /** Instances passed; every planned instance counts, a missing, unjudged or unattested run is not passed. */
  passed: number; instances: number; infraErrors: number; missing: number;
  /** Runs whose client reported no model: counted like an infrastructure error (never passed). */
  unattested: number;
  /** Reports merged for this agent (a resumed bench has several). */
  reports: number;
  rate: number; interval: { low: number; high: number };
  outcomes: ReadonlyMap<string, boolean>;
}
export interface RoundInput {
  declaration: Declaration;
  /** The round's held-out tasks and their generator seeds, regenerated from the declaration, and the
   * regenerated world's content hash. */
  tasks: readonly string[]; seeds: readonly number[]; worldContentHash: string;
  /** Every development report (one or more per ladder model). */
  development: readonly GateReport[];
  oracle: readonly GateReport[]; random: readonly GateReport[];
  /** Near misses judged by the separate checker: how many there are, how many passed (must be 0),
   * and how many each instance has (at least one each). */
  nearMisses: { total: number; passed: number; perInstance: readonly number[] };
  /** The held-out generator seeds of every earlier round of this family (required from round 2). */
  previous?: ReadonlyArray<{ round: number; seeds: readonly number[] }>;
  /** `--maintainer-approved` as given to the gate: it must repeat the declaration's. */
  maintainerApproved?: readonly string[];
  /** Model runs found in the bench folders: on the development set (a count) and on the held-out
   * tasks (each run folder), reruns included. */
  spent: { development: number; heldOut: readonly SpentRun[]; developmentRejected?: number };
  /** The commit the held-out set was generated from and every version of the declaration in git. */
  declarationGit?: { commit: string; versions: ReadonlyArray<{ commit: string; date: string }> };
}
export interface GateInput extends RoundInput {
  /** Every held-out ladder report (one or more per ladder model). */
  ladder: readonly GateReport[];
}
export interface Criterion { name: string; value: string; rule: string; met: boolean }
interface RoundFacts {
  family: Family; round: number; generator: { id: string; version: string }; seeds: { low: number; high: number }; difficulty: string;
  declaration: { sha256: string; commit: string | null; versions: Array<{ commit: string; date: string }> };
  world: { id: string; version: string; contentHash: string }; instances: number;
  settings: { mirror: string; timeoutSeconds: number; maxActions: number; checks: number | null };
  practonaut: string; dates: string[];
  development: Array<{ model: string; passed: number; instances: number }>;
  /** Whether the development outcomes follow the capability order; the pair never changes. */
  order: 'consistent' | 'contradicted';
  pair: { strongest: string; weakest: string };
  /** Model runs counted against the budgets, and the runs the client rejected before any model work
   * (listed, never counted). */
  spent: { development: number; heldOut: number; total: number; rejected: number };
  releaseRuns: number;
  /** The Claude Code versions the round's development and ladder runs reported, with the agents that ran on each. */
  clientVersions: Array<{ version: string; agents: string[] }>;
}
export interface GateResult extends RoundFacts {
  agents: AgentResult[]; strongest: AgentResult; weakest: AgentResult;
  discordant: { strongestOnly: number; weakestOnly: number; p: number };
  infraShare: number; modelRuns: number; developmentRuns: number;
  /** Power of the exact McNemar test at this size for a 20-point, one-sided disagreement. */
  power: number;
  criteria: Criterion[]; verdict: 'passes' | 'does not pass' | 'void'; ladderLabel: string | null;
  /** Why a void round is void: more than 5 % infrastructure errors, or more model runs than a round may spend. */
  voidReason: 'infrastructure' | 'budget' | null;
}
export interface PreflightResult extends RoundFacts { oracle: AgentResult; random: AgentResult; nearMisses: { total: number; passed: number }; ladderRunsSpent: number }

const share = (value: number): string => `${(value * 100).toFixed(1)} %`;
const sorted = (values: readonly string[]): string => [...values].sort().join('\u0000');
/** A version's release line: `2.1.301` → `2.1`; a version that is not dotted numbers stays whole. */
const releaseLine = (version: string): string => /^(\d+)\.(\d+)\./.exec(version)?.slice(1, 3).join('.') ?? version;
const compareVersions = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });
const fail = (message: string): never => { throw new GateInputError(message); };
const guarded = <T>(work: () => T): T => { try { return work(); } catch (error) { if (error instanceof DeclarationError) fail(error.message); throw error; } };

/** One agent's runs over its reports (a resumed bench has several): per task the run of the latest
 * report; a task benched again counts its later run only when every earlier run was an infra_error
 * (both are spent), otherwise the round is refused (no best-of-N; second review S-2). */
export function mergeAgentRuns(reports: readonly GateReport[], label: string): Map<string, { run: BenchRunV2; bench: string; source: GateReport }> {
  const ordered = [...reports].sort((a, b) => a.report.createdAt.localeCompare(b.report.createdAt) || a.bench.localeCompare(b.bench));
  const merged = new Map<string, { run: BenchRunV2; bench: string; source: GateReport }>();
  for (const source of ordered) for (const run of source.report.runs) {
    const earlier = merged.get(run.taskId);
    if (earlier && earlier.run.status !== 'infra_error') fail(`${label}: task ${run.taskId} was benched again although its run in ${earlier.bench} was not an infra_error (no best-of-N)`);
    merged.set(run.taskId, { run, bench: source.bench, source });
  }
  return merged;
}

function agentResult(role: AgentResult['role'], name: string, model: string | null, merged: ReadonlyMap<string, { run: BenchRunV2 }>, plan: readonly string[], unattested: ReadonlySet<string>, reports: number): AgentResult {
  const outcomes = new Map<string, boolean>();
  let infraErrors = 0, unattestedCount = 0, missing = 0;
  for (const task of plan) {
    const entry = merged.get(task);
    if (!entry) { missing++; outcomes.set(task, false); continue; }
    if (entry.run.status === 'infra_error') infraErrors++;
    else if (unattested.has(entry.run.id)) unattestedCount++;
    outcomes.set(task, entry.run.pass && !unattested.has(entry.run.id));
  }
  const passed = plan.filter(key => outcomes.get(key) === true).length;
  return { role, name, model, passed, instances: plan.length, infraErrors, missing, unattested: unattestedCount, reports, rate: passed / plan.length, interval: wilson(passed, plan.length), outcomes };
}

/** Everything both the preflight and the gate check, and the facts they report. */
function checkRound(input: RoundInput, ladder: readonly GateReport[] | null): { facts: RoundFacts; plan: string[]; oracle: AgentResult; random: AgentResult; ladderGroups: GateReport[][] } {
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
  const bench = declaration.bench, devTasks = declaration.development.seeds.map(seed => taskIdOf(family, seed));
  const settingsOf = (label: string, report: BenchReportV2, world: string, tasks: readonly string[]): void => {
    if (report.environment.world.contentHash !== world) fail(`the ${label} report was not made on the ${tasks === devTasks ? 'declared development set' : 'held-out set the declaration names'}`);
    if (report.settings.seeds.join() !== GATE_SEEDS.join()) fail(`the ${label} report uses seed list ${report.settings.seeds.join(',')}; a generated world has one variant, so the gate takes --seed-list 1 only (another seed repeats an instance)`);
    if (report.settings.repeats !== 1) fail(`the ${label} report has --repeats ${report.settings.repeats}; the gate needs one run per agent per instance`);
    if (report.environment.mirror !== bench.mirror || report.settings.mirror !== bench.mirror || report.settings.timeoutSeconds !== bench.timeoutSeconds || report.settings.maxActions !== bench.maxActions || (report.settings.checks ?? null) !== bench.checks)
      fail(`the ${label} report differs from the declaration in mirror (as requested and as run), timeout, action cap or check limit`);
    if (report.settings.tasks.some(task => !tasks.includes(task))) fail(`the ${label} report benches tasks outside the ${tasks === devTasks ? 'development set' : 'held-out set'}`);
  };
  const byModel = (reports: readonly GateReport[], label: string): GateReport[][] => declaration.ladder.map(name => reports.filter(value => value.report.agent.model === name));
  for (const value of [...input.development, ...(ladder ?? [])]) if (!declaration.ladder.includes(value.report.agent.model ?? '')) fail(`a report of ${value.report.agent.model ?? 'no model'} is not one of the declared ladder models`);
  for (const value of input.oracle) { if (value.report.agent.kind !== 'builtin' || value.report.agent.name !== 'oracle') fail('an oracle report is not from the oracle agent'); settingsOf('oracle', value.report, input.worldContentHash, plan); }
  for (const value of input.random) { if (value.report.agent.kind !== 'builtin' || value.report.agent.name !== 'random') fail('a random report is not from the random agent'); settingsOf('random', value.report, input.worldContentHash, plan); }
  for (const value of ladder ?? []) settingsOf(value.report.agent.model!, value.report, input.worldContentHash, plan);
  for (const value of input.development) settingsOf(`development ${value.report.agent.model}`, value.report, declaration.development.world.contentHash, devTasks);
  // One Practonaut, one prompt, one client set-up and one client version for the whole round.
  const all = [...input.development, ...input.oracle, ...input.random, ...(ladder ?? [])];
  if (new Set(all.map(value => value.report.environment.practonaut)).size > 1) fail('the round\'s reports were made with different Practonaut versions');
  const external = [...input.development, ...(ladder ?? [])];
  for (const [field, of] of [['prompt', (r: BenchReportV2) => r.settings.prompt], ['kept environment', (r: BenchReportV2) => r.agent.keptEnv.join(',')], ['API key source', (r: BenchReportV2) => String(r.agent.apiKeySource)]] as const)
    if (new Set(external.map(value => of(value.report))).size > 1) fail(`the development and ladder reports differ in their ${field}`);
  // One client release line (major.minor) for the round. Claude Code is updated in the background by
  // other processes on the same machine whatever the round's own environment says, so a patch update
  // during a round is listed in the report, never a refusal (amended 2026-10-15, PADR-0040); another
  // minor or major version, or runs without a version beside runs with one, refuse the round.
  const clientRuns = external.flatMap(value => value.report.runs.flatMap(run => run.client ? [{ agent: input.development.includes(value) ? `development ${value.report.agent.model ?? 'none'}` : value.report.agent.model ?? 'none', version: run.client.version ?? null }] : []));
  const releaseLines = new Set(clientRuns.map(entry => entry.version === null ? null : releaseLine(entry.version)));
  if (releaseLines.size > 1) fail(`the development and ladder runs report different Claude Code release lines (${[...new Set(clientRuns.map(entry => entry.version ?? 'none'))].join(', ')}); a patch update during a round is listed, another minor or major version refuses it`);
  const clientVersions = [...new Set(clientRuns.flatMap(entry => entry.version === null ? [] : [entry.version]))].sort(compareVersions)
    .map(version => ({ version, agents: [...new Set(clientRuns.filter(entry => entry.version === version).map(entry => entry.agent))] }));
  // Development: per model the declared instances, each counted once and judged; the digest and the
  // outcomes are the declared ones.
  const devGroups = byModel(input.development, 'development');
  const digestRuns = [], passed: boolean[][] = [];
  for (const [index, group] of devGroups.entries()) {
    const name = declaration.ladder[index]!;
    if (!group.length) fail(`no development report of ${name}`);
    for (const value of group) guarded(() => { checkLadderAgent(value.report, name, declaration.maintainerApproved); if (unattestedRuns(value.report, name).length) fail(`a development run of ${name} reports no model`); });
    const merged = mergeAgentRuns(group, `development ${name}`);
    const row: boolean[] = [];
    for (const task of devTasks) {
      const entry = merged.get(task);
      if (!entry || entry.run.status === 'infra_error') fail(`the development run of ${name} on ${task} is ${entry ? 'an infra_error' : 'missing'}; bench it again after the limit window`);
      const session = entry!.source.sessions?.get(entry!.run.id) ?? fail(`the development run ${entry!.run.id} of ${name} has no judged session to digest`);
      digestRuns.push(digestRunOf(entry!.run, name, session)); row.push(entry!.run.pass);
    }
    passed.push(row);
  }
  if (developmentDigest(digestRuns) !== declaration.development.digest) fail('the development runs are not the ones the declaration digests');
  if (passed.map(row => row.join()).join(';') !== declaration.development.passed.map(row => row.join()).join(';')) fail('the development outcomes differ from the declaration');
  // Baselines: free, so an infra_error or a missing run is rerun, never counted (second review S-4).
  const baseline = (reports: readonly GateReport[], name: 'oracle' | 'random'): AgentResult => {
    if (!reports.length) fail(`no ${name} report`);
    const merged = mergeAgentRuns(reports, name);
    const broken = plan.filter(task => !merged.has(task) || merged.get(task)!.run.status === 'infra_error');
    if (broken.length) fail(`the ${name} baseline has no judged run for ${broken.length} instance${broken.length === 1 ? '' : 's'} (${broken.slice(0, 3).join(', ')}${broken.length > 3 ? ', …' : ''}); bench them again (--tasks), the baselines cost no model run`);
    return agentResult(name, name, null, merged, plan, new Set(), reports.length);
  };
  const oracle = baseline(input.oracle, 'oracle'), random = baseline(input.random, 'random');
  // Every instance is a generated task of this family and the declared generator version.
  const generated = new Map(input.oracle[0]!.report.environment.world.generated.map(entry => [entry.taskId, entry]));
  for (const [index, task] of plan.entries()) {
    const by = generated.get(task);
    if (!by || by.id !== generatorId(family) || by.version !== declaration.generator.version || by.seed !== input.seeds[index]) fail(`task ${task} was not made by ${generatorId(family)} ${declaration.generator.version} from its declared seed`);
  }
  if (input.nearMisses.perInstance.length !== plan.length || input.nearMisses.perInstance.some(count => count < 1)) fail('every held-out instance needs its near misses (at least one each)');
  // Spend: every model run found on the held-out tasks; a task run again for one model only after
  // an infra_error (second review S-2).
  const groups = new Map<string, SpentRun[]>();
  for (const run of input.spent.heldOut) { const key = `${run.model ?? '?'}\u0000${run.taskId}`; groups.set(key, [...(groups.get(key) ?? []), run]); }
  for (const runs of groups.values()) {
    const ordered = [...runs].sort((a, b) => a.bench.localeCompare(b.bench));
    for (const run of ordered.slice(0, -1)) if (!resumable(run.status)) fail(`task ${run.taskId} was run more than once for ${run.model ?? 'an unknown model'} (bench folders ${ordered.map(value => value.bench).join(", ")}) and the earlier run was judged (no best-of-N)`);
  }
  const spentDevelopment = Math.max(declaration.development.spent, input.spent.development), spentHeldOut = input.spent.heldOut.filter(run => !run.rejected).length;
  const spent = { development: spentDevelopment, heldOut: spentHeldOut, total: spentDevelopment + spentHeldOut, rejected: input.spent.heldOut.filter(run => run.rejected).length + (input.spent.developmentRejected ?? 0) };
  const releaseRuns = declaration.budget.releaseRunsBefore + Math.max(spent.total, ladder ? 0 : ROUND.roundRuns);
  if (releaseRuns > GATE.releaseBudget) fail(`${BUDGET_EXHAUSTED}: ${releaseRuns} model runs exceed the release budget of ${GATE.releaseBudget}`);
  const base = input.oracle[0]!.report, reports = all.map(value => value.report);
  const facts: RoundFacts = {
    family, round, generator: { id: generatorId(family), version: declaration.generator.version }, seeds: { low: Math.min(...input.seeds), high: Math.max(...input.seeds) }, difficulty: declaration.difficulty,
    declaration: { sha256: declarationHash(declaration), commit: input.declarationGit?.commit ?? null, versions: [...(input.declarationGit?.versions ?? [])] },
    world: { id: base.environment.world.worldId, version: base.environment.world.version, contentHash: base.environment.world.contentHash }, instances: plan.length,
    settings: { mirror: bench.mirror, timeoutSeconds: bench.timeoutSeconds, maxActions: bench.maxActions, checks: bench.checks },
    practonaut: base.environment.practonaut, dates: [...new Set(reports.map(report => report.createdAt.slice(0, 10)))].sort(),
    development: declaration.ladder.map((name, index) => ({ model: name, passed: passed[index]!.filter(Boolean).length, instances: passed[index]!.length })),
    order: orderOf(passed), pair: { ...declaration.pair }, spent, releaseRuns, clientVersions,
  };
  return { facts, plan, oracle, random, ladderGroups: ladder ? byModel(ladder, 'held-out') : [] };
}

/** Before any ladder run: the declaration's set, the development runs, both baselines, the near
 * misses and the settings, with the reasons the round could not pass named (second review S-1). */
export function preflightGate(input: RoundInput): PreflightResult {
  const { facts, oracle, random } = checkRound(input, null);
  const problems = [
    ...(oracle.passed < oracle.instances ? [`the oracle passes ${oracle.passed} of ${oracle.instances} instances (every one must pass)`] : []),
    ...(random.rate > GATE.maxRandom ? [`random passes ${random.passed} of ${random.instances} instances (at most 5 %)`] : []),
    ...(input.nearMisses.passed ? [`${input.nearMisses.passed} near misses pass the checker`] : []),
  ];
  if (problems.length) fail(`the round cannot pass: ${problems.join('; ')}. Do not start the ladder.`);
  const ladderRunsSpent = input.spent.heldOut.filter(run => run.model !== null && input.declaration.ladder.includes(run.model)).length;
  return { ...facts, oracle, random, nearMisses: { total: input.nearMisses.total, passed: input.nearMisses.passed }, ladderRunsSpent };
}

export function computeGate(input: GateInput): GateResult {
  const { facts, plan, oracle, random, ladderGroups } = checkRound(input, input.ladder);
  const declaration = input.declaration;
  // Ladder agents: the declared models, each run on the model its report names (review S3, audit
  // P2-8), resumed reports merged; the latest run found for a model and task is the one counted.
  const ladder = ladderGroups.map((group, index) => {
    const name = declaration.ladder[index]!;
    if (!group.length) fail(`no held-out report of ${name}`);
    const unattested = new Set<string>();
    for (const value of group) guarded(() => { checkLadderAgent(value.report, name, declaration.maintainerApproved); for (const id of unattestedRuns(value.report, name)) unattested.add(id); });
    const merged = mergeAgentRuns(group, name);
    for (const { run, bench } of merged.values()) if (!input.spent.heldOut.some(value => value.bench === bench && value.runId === run.id)) fail(`run ${run.id} of ${name} (bench folder ${bench}) is not among the model runs found in the bench folders; name their folder with --bench-root`);
    for (const run of input.spent.heldOut.filter(value => value.model === name)) {
      const counted = merged.get(run.taskId);
      const latest = input.spent.heldOut.filter(value => value.model === name && value.taskId === run.taskId).sort((a, b) => a.bench.localeCompare(b.bench)).at(-1)!;
      if (latest === run && !resumable(run.status) && (!counted || counted.bench !== run.bench || counted.run.id !== run.runId)) fail(`the latest run of ${run.taskId} for ${name} (bench folder ${run.bench}) was not given to the gate`);
    }
    return agentResult('ladder', group[0]!.report.agent.name, name, merged, plan, unattested, group.length);
  });
  const strongest = ladder[declaration.ladder.indexOf(declaration.pair.strongest)]!, weakest = ladder[declaration.ladder.indexOf(declaration.pair.weakest)]!;
  let strongestOnly = 0, weakestOnly = 0;
  for (const key of plan) {
    const s = strongest.outcomes.get(key) === true, w = weakest.outcomes.get(key) === true;
    if (s && !w) strongestOnly++;
    if (w && !s) weakestOnly++;
  }
  const { p } = mcnemarExact(strongestOnly, weakestOnly);
  const ladderRuns = ladder.length * plan.length;
  const infraShare = ladder.reduce((total, agent) => total + agent.infraErrors + agent.missing + agent.unattested, 0) / ladderRuns;
  const difference = strongest.rate - weakest.rate;
  const criteria: Criterion[] = [
    { name: 'headroom', value: `${strongest.passed}/${plan.length} (${share(strongest.rate)})`, rule: 'strongest passes 10 %–80 % of the instances', met: strongest.rate >= GATE.headroomLow && strongest.rate <= GATE.headroomHigh },
    { name: 'difference', value: `${(difference * 100).toFixed(1)} points`, rule: 'strongest − weakest ≥ 20 points', met: difference >= GATE.minDifference - 1e-12 },
    { name: 'mcnemar', value: `b = ${strongestOnly}, c = ${weakestOnly}, p = ${p.toFixed(4)}`, rule: 'exact McNemar on discordant instances, p < 0.05', met: p < GATE.alpha },
    { name: 'oracle', value: `${oracle.passed}/${plan.length}`, rule: 'oracle passes 100 %', met: oracle.passed === plan.length },
    { name: 'random', value: `${random.passed}/${plan.length} (${share(random.rate)})`, rule: 'random passes ≤ 5 %', met: random.rate <= GATE.maxRandom },
    { name: 'near-misses', value: `${input.nearMisses.total - input.nearMisses.passed}/${input.nearMisses.total} fail`, rule: 'every near miss fails', met: input.nearMisses.total > 0 && input.nearMisses.passed === 0 },
    { name: 'infrastructure', value: `${share(infraShare)} of ${ladderRuns} ladder runs`, rule: 'infra_error, missing or unattested runs ≤ 5 %, else the round is void', met: infraShare <= GATE.maxInfraShare },
    { name: 'budget', value: `${facts.spent.total} model runs spent (${facts.spent.heldOut} held-out + ${facts.spent.development} development)${facts.spent.rejected ? `, ${facts.spent.rejected} rejected by the client not counted` : ''}; release ${facts.releaseRuns} of ${GATE.releaseBudget}`, rule: '≤ 100 model runs per family and round, else the round is void; ≤ 500 in the release', met: facts.spent.total <= GATE.maxModelRunsPerRound && facts.releaseRuns <= GATE.releaseBudget },
  ];
  // A round is void, never "does not pass", when its infrastructure or its spend failed it (third review).
  const voidReason = !criteria.find(c => c.name === 'infrastructure')!.met ? 'infrastructure' as const : !criteria.find(c => c.name === 'budget')!.met ? 'budget' as const : null;
  const verdict = voidReason ? 'void' : criteria.every(c => c.met) ? 'passes' : 'does not pass';
  return {
    ...facts, agents: [oracle, random, ...ladder], strongest, weakest, discordant: { strongestOnly, weakestOnly, p }, infraShare, modelRuns: ladderRuns, developmentRuns: ROUND.developmentRuns,
    power: mcnemarPower(plan.length, GATE.minDifference, 0, GATE.alpha),
    criteria, verdict, voidReason, ladderLabel: declaration.ladder.every(name => /^claude/i.test(name)) ? 'ladder: Claude models only' : null,
  };
}

const cell = (value: string): string => value.replace(/[|\\`*_[\]<>]/g, character => `\\${character}`);
const fixed = (value: number): string => value.toFixed(3);
const orderLine = (facts: RoundFacts): string => facts.order === 'consistent' ? 'consistent with the capability order' : 'contradict the capability order; the pair stays as declared (PADR-0040)';

/** The gate report as Markdown: every number the verdict uses; names and models escaped. */
export function renderGate(result: GateResult): string {
  const lines: string[] = [];
  lines.push(`# Challenge gate: ${result.family}, round ${result.round}`, '');
  lines.push(`**Verdict: ${result.verdict === 'passes' ? 'the family passes this round' : result.verdict === 'void' ? (result.voidReason === 'budget' ? 'the round is void (more than 100 model runs spent in the round)' : 'the round is void (more than 5 % infrastructure errors)') : 'the family does not pass this round'}.**${result.ladderLabel ? ` ${result.ladderLabel}.` : ''}`, '');
  lines.push('Preregistered in [PADR-0040](../../adr/0040-challenge-tier-generated-families-and-gate.md) (roadmap 0.2.0, item 4) and in this round\'s committed declaration. Every number below is computed by `node tools/challenge.ts gate` from the declaration, the development and held-out `practonaut.bench/2` reports (each validated and re-verified, resumed benches merged) and the model runs found in their bench folders, on a held-out set regenerated from the declaration.', '');
  lines.push('## Round', '');
  lines.push('| Fact | Value |', '|---|---|');
  lines.push(`| Declaration | \`${cell(result.family)}-round-${result.round}.declaration.json\`, canonical SHA-256 \`${result.declaration.sha256.slice(0, 16)}…\`${result.declaration.commit ? `, held-out set generated from commit \`${result.declaration.commit.slice(0, 12)}\`` : ''} |`);
  lines.push(`| Generator | \`${cell(result.generator.id)}\` ${cell(result.generator.version)}, difficulty ${cell(result.difficulty)} |`);
  lines.push(`| Held-out instances | ${result.instances} (generator seeds ${result.seeds.low}–${result.seeds.high}, derived from the development runs; one counted run per agent per instance) |`);
  lines.push(`| World | \`${cell(result.world.id)}\` ${cell(result.world.version)}, content hash \`${result.world.contentHash.slice(0, 16)}…\` |`);
  lines.push(`| Settings | mirror ${cell(result.settings.mirror)}, timeout ${result.settings.timeoutSeconds} s, at most ${result.settings.maxActions} act/undo/reset calls${result.settings.checks === null ? '' : `, --checks ${result.settings.checks}`} |`);
  lines.push(`| Practonaut | ${cell(result.practonaut)}; reports dated ${result.dates.join(', ')} |`);
  if (result.clientVersions.length) lines.push(`| Claude Code | ${result.clientVersions.map(entry => `${cell(entry.version)} (${entry.agents.map(agent => cell(agent)).join(', ')})`).join('; ')}${result.clientVersions.length > 1 ? ' — a patch update during the round is listed, not refused (PADR-0040)' : ''} |`);
  lines.push(`| Gate pair | strongest \`${cell(result.pair.strongest)}\`, weakest \`${cell(result.pair.weakest)}\` (fixed by the capability order before any run) |`);
  lines.push(`| Development | ${result.development.map(entry => `\`${cell(entry.model)}\` ${entry.passed}/${entry.instances}`).join(', ')}: ${orderLine(result)} |`, '');
  if (result.declaration.versions.length) {
    lines.push('## Declaration history', '');
    lines.push('Every version of the declaration file in git, newest first; the gated declaration is the one the held-out set was generated from.', '');
    for (const version of result.declaration.versions) lines.push(`- \`${version.commit.slice(0, 12)}\` ${cell(version.date)}${version.commit === result.declaration.commit ? ' — the held-out set was generated from this version' : ''}`);
    lines.push('');
  }
  lines.push('## Agents', '');
  lines.push('| Agent | Model (client-reported) | Passed | Rate | 95 % Wilson interval | infra_error | Missing runs | Unattested runs | Reports |', '|---|---|---|---|---|---|---|---|---|');
  for (const agent of result.agents) lines.push(`| ${agent.role === 'ladder' ? 'ladder' : agent.role} (${cell(agent.name)}) | ${agent.model === null ? '—' : `\`${cell(agent.model)}\``} | ${agent.passed}/${agent.instances} | ${fixed(agent.rate)} | ${fixed(agent.interval.low)}–${fixed(agent.interval.high)} | ${agent.infraErrors} | ${agent.missing} | ${agent.unattested} | ${agent.reports} |`);
  lines.push('');
  lines.push('## Criteria', '');
  lines.push('| Criterion | Value | Rule | Met |', '|---|---|---|---|');
  for (const criterion of result.criteria) lines.push(`| ${criterion.name} | ${cell(criterion.value)} | ${cell(criterion.rule)} | ${criterion.met ? 'yes' : 'no'} |`);
  lines.push('');
  lines.push(`Discordant instances: the strongest passed and the weakest failed on ${result.discordant.strongestOnly}, the reverse on ${result.discordant.weakestOnly}; two-sided exact McNemar p = ${result.discordant.p.toFixed(4)}.`);
  lines.push(`Model runs spent in this round: ${result.spent.heldOut} on the held-out set and ${result.spent.development} on the development set (every run folder found, reruns after an infra_error included)${result.spent.rejected ? `; ${result.spent.rejected} runs the client rejected before any model work (a usage limit, a login) are listed in the ledger and not counted` : ''}. Release total after this round: ${result.releaseRuns} of ${GATE.releaseBudget}.`);
  lines.push(`Power at this size: if the two agents disagreed on 20 % of the instances, all in the stronger one's favour, the exact McNemar test would reach p < 0.05 with probability ${result.power.toFixed(2)}; "does not pass" on discrimination is not evidence that the agents are equal.`);
  // The five first rounds leave fewer runs than a round needs: no second round fits the budget.
  if (result.verdict !== 'passes') lines.push(`Second round: ${BUDGET_EXHAUSTED}. After the five first rounds of ${GATE.roundRuns} model runs each the release has ${RUNS_AFTER_FIRST_ROUNDS} of the ${GATE.releaseRunsAtPreregistration} runs it had left at preregistration, fewer than one round.`);
  lines.push('');
  return lines.join('\n') + '\n';
}

/** The preflight's findings, one line each, for the terminal. */
export function renderPreflight(result: PreflightResult): string {
  return [
    `${result.family} round ${result.round}: preflight passed — the ladder may start.`,
    `declaration ${result.declaration.sha256.slice(0, 16)}…; held-out seeds ${result.seeds.low}–${result.seeds.high}; world ${result.world.id} ${result.world.contentHash.slice(0, 16)}…`,
    `settings: mirror ${result.settings.mirror}, timeout ${result.settings.timeoutSeconds} s, --max-actions ${result.settings.maxActions}${result.settings.checks === null ? '' : `, --checks ${result.settings.checks}`}`,
    `oracle ${result.oracle.passed}/${result.oracle.instances}, random ${result.random.passed}/${result.random.instances}, near misses failing ${result.nearMisses.total - result.nearMisses.passed}/${result.nearMisses.total}`,
    `development ${result.development.map(entry => `${entry.model} ${entry.passed}/${entry.instances}`).join(', ')}: ${orderLine(result)}; gate pair ${result.pair.strongest} vs ${result.pair.weakest}`,
    `model runs spent so far: ${result.spent.development} development, ${result.ladderRunsSpent} ladder runs on the held-out set; release at most ${result.releaseRuns} of ${GATE.releaseBudget} after the round`,
  ].join('\n') + '\n';
}

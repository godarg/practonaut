/**
 * The round declaration of the challenge gate (PADR-0040): one file per family and round, committed
 * and pushed before the round's held-out set exists. It freezes what the round may not change
 * afterwards — family, generator version, difficulty, the ladder's model ids in capability order and
 * the gate pair they fix (the most and the least capable), the bench settings, the development
 * instances and the digest of their verified runs, the sizes and the run budget. The held-out seeds
 * are derived from the digest of the development runs' verified content, so redrawing them costs new
 * paid runs. Pure: the file side (reports, git, bench folders) is in files.ts and git.ts.
 */
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { MODEL_ID, type BenchReportV2 } from '../bench/report.ts';
import { FAMILY_BENCH, SEED_RANGES } from './build.ts';
import { FAMILIES, generatorId, type Family } from './families.ts';

export const DECLARATION_SCHEMA = 'practonaut.challenge-declaration/1';
/** The preregistered round (PADR-0040): 3 development instances × 3 agents and 26 held-out
 * instances × 3 agents, 87 model runs; the release budget is 500 model runs. */
export const ROUND = Object.freeze({ developmentInstances: 3, agents: 3, developmentRuns: 9, heldOutInstances: 26, heldOutRuns: 78, roundRuns: 87, releaseBudget: 500, maxRounds: 2, maxRunsPerRound: 100 });
/** Model runs the release had used when the gate was preregistered (500 − 465). */
export const RELEASE_RUNS_BEFORE_ROUNDS = 35;
/** Held-out seed bases lie in [1 000 000, 1 000 000 + HELD_OUT_SPAN). */
export const HELD_OUT_SPAN = 900_000_000;
/** The capability order of the ladder's tiers (most capable first): it fixes the gate pair. */
export const TIERS = Object.freeze(['opus', 'sonnet', 'haiku'] as const);
export const BUDGET_EXHAUSTED = 'budget exhausted — a maintainer decides on a second round';

/** The tier a client-reported model id names (`claude-opus-…`, also with a bracketed suffix such
 * as `[1m]`), or -1. */
export function tierOf(model: string): number {
  const match = /^claude-(opus|sonnet|haiku)(?:-|$)/.exec(model.replace(/\[[^\]]*\]$/, ''));
  return match ? TIERS.indexOf(match[1] as typeof TIERS[number]) : -1;
}

const model = z.string().regex(MODEL_ID);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const whole = (low: number, high: number) => z.number().int().min(low).max(high);
export const DeclarationSchema = z.strictObject({
  schema: z.literal(DECLARATION_SCHEMA),
  family: z.enum(FAMILIES),
  round: whole(1, ROUND.maxRounds),
  generator: z.strictObject({ id: z.string().max(64), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  difficulty: z.enum(['1', '2', '3', 'mixed']),
  /** The three ladder agents by client-reported model id, most capable first. */
  ladder: z.array(model).length(ROUND.agents),
  /** Ladder models outside the Opus, Sonnet and Haiku tiers, each approved by a maintainer. */
  maintainerApproved: z.array(model).max(ROUND.agents),
  /** The gate pair, fixed by the capability order before any run: the first and the last ladder model. */
  pair: z.strictObject({ strongest: model, weakest: model }),
  bench: z.strictObject({ mirror: z.enum(['off', 'required']), timeoutSeconds: whole(1, 86_400), maxActions: whole(1, 10_000), checks: whole(0, 1000).nullable() }),
  development: z.strictObject({
    seeds: z.array(whole(SEED_RANGES.dev[0], SEED_RANGES.dev[1])).length(ROUND.developmentInstances),
    world: z.strictObject({ id: z.string().max(128), contentHash: sha256 }),
    /** The SHA-256 of the development runs' verified content (developmentDigest). */
    digest: sha256,
    /** Per ladder model (ladder order), whether each development instance passed. */
    passed: z.array(z.array(z.boolean()).length(ROUND.developmentInstances)).length(ROUND.agents),
    /** Model runs found on the development set when declaring (reruns included). */
    spent: whole(ROUND.developmentRuns, 1000),
    /** Whether the development outcomes follow the capability order; reported, never acted on. */
    order: z.enum(['consistent', 'contradicted']),
  }),
  heldOut: z.strictObject({ instances: z.literal(ROUND.heldOutInstances) }),
  budget: z.strictObject({
    developmentRuns: z.literal(ROUND.developmentRuns), heldOutRuns: z.literal(ROUND.heldOutRuns), roundRuns: z.literal(ROUND.roundRuns),
    /** 35 plus every earlier committed round's spend (its ledger, or its declared 87 before its gate). */
    releaseRunsBefore: whole(RELEASE_RUNS_BEFORE_ROUNDS, ROUND.releaseBudget), releaseBudget: z.literal(ROUND.releaseBudget),
    earlier: z.array(z.strictObject({ declaration: z.string().regex(/^[a-z-]+-round-\d\.declaration\.json$/), runs: whole(0, ROUND.releaseBudget), from: z.enum(['ledger', 'declaration']) })).max(20),
  }),
});
export type Declaration = z.infer<typeof DeclarationSchema>;

export class DeclarationError extends Error {
  readonly code = 'declaration_invalid';
  constructor(message: string) { super(message); this.name = 'DeclarationError'; }
}

/** The gate pair a ladder fixes: its most and its least capable model (PADR-0040, second review S-3). */
export const pairOf = (ladder: readonly string[]): { strongest: string; weakest: string } => ({ strongest: ladder[0]!, weakest: ladder.at(-1)! });
/** Whether development outcomes (passes per ladder model, most capable first) follow the order:
 * `contradicted` when a less capable model passed more instances than a more capable one. */
export function orderOf(passed: ReadonlyArray<readonly boolean[]>): 'consistent' | 'contradicted' {
  const counts = passed.map(row => row.filter(Boolean).length);
  return counts.some((count, index) => counts.slice(index + 1).some(later => later > count)) ? 'contradicted' : 'consistent';
}

/** What a development run contributes to the digest: only content `report --verify` binds. */
export interface DigestRun { model: string; taskId: string; seed: number; status: string; pass: boolean; artifacts: { session: string; native: string | null; checker: string } | null }
/** The SHA-256 of the development runs' verified content (model, task, seed, status, outcome and the
 * hashes of the judged session, native export and checker output), in a fixed order. File bytes
 * never enter it: a re-spaced or copied report gives the same digest; a new run gives another. */
export function developmentDigest(runs: readonly DigestRun[]): string {
  const ordered = [...runs].sort((a, b) => a.model.localeCompare(b.model) || a.taskId.localeCompare(b.taskId) || a.seed - b.seed);
  return sha256Hex(canonicalJson({ digest: 'practonaut.challenge-development/1', runs: ordered }));
}
export const digestRunOf = (run: BenchReportV2['runs'][number], model: string): DigestRun => ({
  model, taskId: run.taskId, seed: run.seed, status: run.status, pass: run.pass,
  artifacts: run.artifacts ? { session: run.artifacts.session, native: run.artifacts.native, checker: run.artifacts.checker } : null,
});

/** The canonical SHA-256 of a declaration: what the held-out set's manifest binds. */
export const declarationHash = (declaration: Declaration): string => sha256Hex(canonicalJson(declaration));

/** The round's held-out generator seeds: 26 consecutive seeds from 1 000 000 + (the first 12 hex
 * digits of the SHA-256 of the canonical JSON of family, round, generator version and the
 * development digest, as a number, modulo HELD_OUT_SPAN). Only new development runs change them. */
export function heldOutSeeds(declaration: Pick<Declaration, 'family' | 'round' | 'generator'> & { development: Pick<Declaration['development'], 'digest'> }): number[] {
  const hash = sha256Hex(canonicalJson({ seeds: 'practonaut.challenge-seeds/1', family: declaration.family, round: declaration.round, generator: declaration.generator.version, development: declaration.development.digest }));
  const base = SEED_RANGES.heldout[0] + Number(BigInt(`0x${hash.slice(0, 12)}`) % BigInt(HELD_OUT_SPAN));
  return Array.from({ length: ROUND.heldOutInstances }, (_, index) => base + index);
}

/** The rules a valid declaration follows beyond its schema; throws DeclarationError by name. */
export function validateDeclaration(raw: unknown): Declaration {
  const parsed = DeclarationSchema.safeParse(raw);
  if (!parsed.success) throw new DeclarationError(`the declaration does not match ${DECLARATION_SCHEMA}: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`);
  const value = parsed.data, fail = (message: string): never => { throw new DeclarationError(message); };
  if (value.generator.id !== generatorId(value.family)) fail(`the generator of ${value.family} is ${generatorId(value.family)}, not ${value.generator.id}`);
  if (new Set(value.ladder).size !== ROUND.agents) fail('the ladder names three different models');
  const tiers = value.ladder.map(tierOf);
  for (const [index, name] of value.ladder.entries()) {
    if (tiers[index] === -1 && !value.maintainerApproved.includes(name)) fail(`ladder model ${name} is not an Opus, Sonnet or Haiku model; it needs --maintainer-approved ${name}`);
  }
  for (const name of value.maintainerApproved) if (!value.ladder.includes(name) || tierOf(name) !== -1) fail(`--maintainer-approved names ${name}, which is not a ladder model outside the three tiers`);
  if (tiers.every(tier => tier !== -1) && tiers.join() !== '0,1,2') fail('the ladder of Claude tiers is declared in capability order: Opus, Sonnet, Haiku');
  const pair = pairOf(value.ladder);
  if (value.pair.strongest !== pair.strongest || value.pair.weakest !== pair.weakest) fail(`the gate pair is fixed by the capability order: strongest ${pair.strongest}, weakest ${pair.weakest}`);
  if (value.bench.maxActions > FAMILY_BENCH[value.family].maxActions) fail(`--max-actions ${value.bench.maxActions} is above the ${value.family} cap of ${FAMILY_BENCH[value.family].maxActions}`);
  if (new Set(value.development.seeds).size !== ROUND.developmentInstances) fail('the development seeds must be distinct');
  if (orderOf(value.development.passed) !== value.development.order) fail('the development order line does not follow from the development outcomes');
  const earlier = value.budget.earlier.reduce((total, entry) => total + entry.runs, 0);
  if (value.budget.releaseRunsBefore !== RELEASE_RUNS_BEFORE_ROUNDS + earlier) fail(`the release runs before this round are ${RELEASE_RUNS_BEFORE_ROUNDS} plus the earlier rounds' ${earlier}, not ${value.budget.releaseRunsBefore}`);
  const round = Math.max(ROUND.roundRuns, value.development.spent + ROUND.heldOutRuns);
  if (value.budget.releaseRunsBefore + round > ROUND.releaseBudget)
    fail(`${BUDGET_EXHAUSTED}: ${value.budget.releaseRunsBefore} model runs used before this round and ${round} for it exceed the release budget of ${ROUND.releaseBudget}`);
  return value;
}

/** A development or ladder report's runs, each on the model its report names (review S3): a run that
 * reports another model makes the round invalid; a run that reports none is returned (unattested). */
export function unattestedRuns(report: BenchReportV2, expected: string): string[] {
  const fail = (message: string): never => { throw new DeclarationError(message); };
  if (report.agent.model !== expected) fail(`the report of ${expected} names model ${report.agent.model ?? 'none'}`);
  const unattested: string[] = [];
  for (const run of report.runs) {
    if (run.status === 'infra_error') continue;
    const reported = run.client?.model ?? null;
    if (reported === null) { unattested.push(run.id); continue; }
    if (reported !== expected) fail(`run ${run.id} of the ${expected} report ran on ${reported}`);
  }
  return unattested;
}

/** A ladder agent's report as the round requires it: the claude-code preset with the model its
 * client reported for a tier model; for a maintainer-approved model, any external agent whose model
 * its client or command reported. */
export function checkLadderAgent(report: BenchReportV2, expected: string, approved: readonly string[]): void {
  const agent = report.agent;
  const tier = tierOf(expected) !== -1;
  if (tier ? agent.kind !== 'preset' || agent.name !== 'claude-code' || agent.modelSource !== 'client-attested' : !approved.includes(expected) || agent.kind === 'builtin' || agent.modelSource === 'none')
    throw new DeclarationError(`the report of ${expected} is not from ${tier ? 'the claude-code preset with the model its client reported' : 'an external agent with a reported model'}`);
}

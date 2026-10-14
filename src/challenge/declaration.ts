/**
 * The round declaration of the challenge gate (PADR-0040): one file per family and round, committed
 * before the round's held-out set exists. It freezes what the round may not change afterwards —
 * family, generator version, difficulty, the ladder's model ids, the bench settings, the development
 * instances, their outcomes and the strongest and weakest agent they name, the sizes and the run
 * budget — and the held-out seeds are derived from its content, so they cannot be redrawn. Pure:
 * the file side (reading and re-verifying reports) is in files.ts.
 */
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import type { BenchReportV2 } from '../bench/report.ts';
import { SEED_RANGES } from './build.ts';
import { FAMILIES, generatorId, type Family } from './families.ts';

export const DECLARATION_SCHEMA = 'practonaut.challenge-declaration/1';
/** The preregistered round (PADR-0040): 3 development instances × 3 agents and 26 held-out
 * instances × 3 agents, 87 model runs; the release budget is 500 model runs. */
export const ROUND = Object.freeze({ developmentInstances: 3, agents: 3, developmentRuns: 9, heldOutInstances: 26, heldOutRuns: 78, roundRuns: 87, releaseBudget: 500, maxRounds: 2 });
/** Held-out seed bases lie in [1 000 000, 1 000 000 + HELD_OUT_SPAN). */
export const HELD_OUT_SPAN = 900_000_000;
/** The capability order of the ladder's tiers (most capable first): ties in the development
 * outcomes are broken by it. */
export const TIERS = Object.freeze(['opus', 'sonnet', 'haiku'] as const);
export const BUDGET_EXHAUSTED = 'budget exhausted — a maintainer decides on a second round';

/** The tier a client-reported model id names (`claude-opus-…`), or -1. */
export function tierOf(model: string): number {
  const match = /^claude-(opus|sonnet|haiku)(?:-|$)/.exec(model);
  return match ? TIERS.indexOf(match[1] as typeof TIERS[number]) : -1;
}

const model = z.string().regex(/^[\w.:@/-]{1,128}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const whole = (low: number, high: number) => z.number().int().min(low).max(high);
export const DeclarationSchema = z.strictObject({
  schema: z.literal(DECLARATION_SCHEMA),
  family: z.enum(FAMILIES),
  round: whole(1, ROUND.maxRounds),
  generator: z.strictObject({ id: z.string().max(64), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  difficulty: z.enum(['1', '2', '3', 'mixed']),
  /** The three ladder agents by client-reported model id, most capable first (the tie order). */
  ladder: z.array(model).length(ROUND.agents),
  /** Ladder models outside the Opus, Sonnet and Haiku tiers, each approved by a maintainer. */
  maintainerApproved: z.array(model).max(ROUND.agents),
  bench: z.strictObject({ mirror: z.enum(['off', 'required']), timeoutSeconds: whole(1, 86_400), maxActions: whole(1, 10_000), checks: whole(0, 1000).nullable() }),
  development: z.strictObject({
    seeds: z.array(whole(SEED_RANGES.dev[0], SEED_RANGES.dev[1])).length(ROUND.developmentInstances),
    world: z.strictObject({ id: z.string().max(128), contentHash: sha256 }),
    /** One report per ladder model, in ladder order: its file's SHA-256 and the outcome per seed. */
    reports: z.array(z.strictObject({ model, sha256, passed: z.array(z.boolean()).length(ROUND.developmentInstances) })).length(ROUND.agents),
    strongest: model, weakest: model,
  }),
  heldOut: z.strictObject({ instances: z.literal(ROUND.heldOutInstances) }),
  budget: z.strictObject({ developmentRuns: z.literal(ROUND.developmentRuns), heldOutRuns: z.literal(ROUND.heldOutRuns), roundRuns: z.literal(ROUND.roundRuns), releaseRunsBefore: whole(0, ROUND.releaseBudget), releaseBudget: z.literal(ROUND.releaseBudget) }),
});
export type Declaration = z.infer<typeof DeclarationSchema>;

export class DeclarationError extends Error {
  readonly code = 'declaration_invalid';
  constructor(message: string) { super(message); this.name = 'DeclarationError'; }
}

/** The development outcomes name the strongest (most passes) and the weakest (fewest) ladder agent;
 * a tie goes to the declared capability order: the more capable of the tied as strongest, the less
 * capable as weakest. With three agents the two always differ. */
export function extremes(outcomes: ReadonlyArray<{ model: string; passed: readonly boolean[] }>): { strongest: string; weakest: string } {
  const passes = outcomes.map(outcome => outcome.passed.filter(Boolean).length);
  const most = Math.max(...passes), fewest = Math.min(...passes);
  return { strongest: outcomes[passes.indexOf(most)]!.model, weakest: outcomes[passes.lastIndexOf(fewest)]!.model };
}

/** The canonical SHA-256 of a declaration: what the held-out seeds and the set's manifest bind. */
export const declarationHash = (declaration: Declaration): string => sha256Hex(canonicalJson(declaration));

/** The round's held-out generator seeds: 26 consecutive seeds from a base derived from the
 * declaration's canonical SHA-256 (its first 12 hex digits as a number, modulo HELD_OUT_SPAN, plus
 * 1 000 000). Changing anything in the declaration changes them; nothing else does. */
export function heldOutSeeds(declaration: Declaration): number[] {
  const base = SEED_RANGES.heldout[0] + Number(BigInt(`0x${declarationHash(declaration).slice(0, 12)}`) % BigInt(HELD_OUT_SPAN));
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
  if (new Set(value.development.seeds).size !== ROUND.developmentInstances) fail('the development seeds must be distinct');
  if (value.development.reports.map(report => report.model).join() !== value.ladder.join()) fail('the development reports are declared in ladder order, one per ladder model');
  const named = extremes(value.development.reports);
  if (named.strongest !== value.development.strongest || named.weakest !== value.development.weakest)
    fail(`the development outcomes name ${named.strongest} strongest and ${named.weakest} weakest, the declaration ${value.development.strongest} and ${value.development.weakest}`);
  if (value.budget.releaseRunsBefore + ROUND.roundRuns > ROUND.releaseBudget)
    fail(`${BUDGET_EXHAUSTED}: ${value.budget.releaseRunsBefore} model runs used before this round and ${ROUND.roundRuns} for it exceed the release budget of ${ROUND.releaseBudget}`);
  return value;
}

/** A development or ladder report's runs, each on the model its report names (review S3): a run that
 * reports another model makes the round invalid; a run that reports none is counted, not passed. */
export function unattestedRuns(report: BenchReportV2, expected: string): string[] {
  const fail = (message: string): never => { throw new DeclarationError(message); };
  if (report.agent.model !== expected) fail(`the report of ${expected} names model ${report.agent.model ?? 'none'}`);
  const unattested: string[] = [];
  for (const run of report.runs) {
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

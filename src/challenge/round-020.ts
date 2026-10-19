/**
 * The 0.2.0 rounds as files (PADR-0040): their declarations (`practonaut.challenge-declaration/1`)
 * and their per-round ledgers (`practonaut.challenge-ledger/1`) stay readable and are validated by
 * their own rules, as committed. 0.3.0 never counts them (PADR-0042 decision 3): its release ledger
 * counts from zero. Nothing here writes a file or gates a round.
 */
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { MODEL_ID } from '../bench/report.ts';
import { FAMILY_BENCH, SEED_RANGES } from './build.ts';
import { FAMILIES, generatorId } from './families.ts';

export const DECLARATION_SCHEMA_V1 = 'practonaut.challenge-declaration/1';
export const LEDGER_SCHEMA_V1 = 'practonaut.challenge-ledger/1';
/** The preregistered 0.2.0 round: 3 development instances × 3 agents and 26 held-out instances × 3
 * agents, 87 model runs; the release budget was 500 model runs. */
export const ROUND_V1 = Object.freeze({ developmentInstances: 3, agents: 3, developmentRuns: 9, heldOutInstances: 26, heldOutRuns: 78, roundRuns: 87, releaseBudget: 500, maxRounds: 2 });
/** Model runs 0.2.0 had used when its gate was preregistered (500 − 465). */
export const RELEASE_RUNS_BEFORE_ROUNDS_V1 = 35;
/** Held-out seed bases lie in [1 000 000, 1 000 000 + HELD_OUT_SPAN). */
export const HELD_OUT_SPAN = 900_000_000;
/** The capability order of the ladder's tiers (most capable first): it fixes the gate pair. */
export const TIERS = Object.freeze(['opus', 'sonnet', 'haiku'] as const);

/** The tier a client-reported model id names (`claude-opus-…`, also with a bracketed suffix such
 * as `[1m]`), or -1. */
export function tierOf(model: string): number {
  const match = /^claude-(opus|sonnet|haiku)(?:-|$)/.exec(model.replace(/\[[^\]]*\]$/, ''));
  return match ? TIERS.indexOf(match[1] as typeof TIERS[number]) : -1;
}

const model = z.string().regex(MODEL_ID);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const whole = (low: number, high: number) => z.number().int().min(low).max(high);
export const DeclarationSchemaV1 = z.strictObject({
  schema: z.literal(DECLARATION_SCHEMA_V1),
  family: z.enum(FAMILIES),
  round: whole(1, ROUND_V1.maxRounds),
  generator: z.strictObject({ id: z.string().max(64), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  difficulty: z.enum(['1', '2', '3', 'mixed']),
  ladder: z.array(model).length(ROUND_V1.agents),
  maintainerApproved: z.array(model).max(ROUND_V1.agents),
  pair: z.strictObject({ strongest: model, weakest: model }),
  bench: z.strictObject({ mirror: z.enum(['off', 'required']), timeoutSeconds: whole(1, 86_400), maxActions: whole(1, 10_000), checks: whole(0, 1000).nullable() }),
  development: z.strictObject({
    seeds: z.array(whole(SEED_RANGES.dev[0], SEED_RANGES.dev[1])).length(ROUND_V1.developmentInstances),
    world: z.strictObject({ id: z.string().max(128), contentHash: sha256 }),
    digest: sha256,
    passed: z.array(z.array(z.boolean()).length(ROUND_V1.developmentInstances)).length(ROUND_V1.agents),
    spent: whole(ROUND_V1.developmentRuns, 1000),
    order: z.enum(['consistent', 'contradicted']),
  }),
  heldOut: z.strictObject({ instances: z.literal(ROUND_V1.heldOutInstances) }),
  budget: z.strictObject({
    developmentRuns: z.literal(ROUND_V1.developmentRuns), heldOutRuns: z.literal(ROUND_V1.heldOutRuns), roundRuns: z.literal(ROUND_V1.roundRuns),
    releaseRunsBefore: whole(RELEASE_RUNS_BEFORE_ROUNDS_V1, ROUND_V1.releaseBudget), releaseBudget: z.literal(ROUND_V1.releaseBudget),
    earlier: z.array(z.strictObject({ declaration: z.string().regex(/^[a-z-]+-round-\d\.declaration\.json$/), runs: whole(0, ROUND_V1.releaseBudget), from: z.enum(['ledger', 'declaration']) })).max(20),
  }),
});
export type DeclarationV1 = z.infer<typeof DeclarationSchemaV1>;

export class DeclarationV1Error extends Error {
  readonly code = 'declaration_invalid';
  constructor(message: string) { super(message); this.name = 'DeclarationV1Error'; }
}

/** A 0.2.0 declaration validated by its own rules: the tiers in capability order and the pair they
 * fix, the family's action cap, the derived release runs before the round, and the 500-run budget. */
export function validateDeclarationV1(raw: unknown): DeclarationV1 {
  const parsed = DeclarationSchemaV1.safeParse(raw);
  if (!parsed.success) throw new DeclarationV1Error(`the declaration does not match ${DECLARATION_SCHEMA_V1}: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`);
  const value = parsed.data, fail = (message: string): never => { throw new DeclarationV1Error(message); };
  if (value.generator.id !== generatorId(value.family)) fail(`the generator of ${value.family} is ${generatorId(value.family)}, not ${value.generator.id}`);
  if (new Set(value.ladder).size !== ROUND_V1.agents) fail('the ladder names three different models');
  const tiers = value.ladder.map(tierOf);
  for (const [index, name] of value.ladder.entries()) if (tiers[index] === -1 && !value.maintainerApproved.includes(name)) fail(`ladder model ${name} is not an Opus, Sonnet or Haiku model and was not approved`);
  if (tiers.every(tier => tier !== -1) && tiers.join() !== '0,1,2') fail('the ladder of Claude tiers is declared in capability order: Opus, Sonnet, Haiku');
  if (value.pair.strongest !== value.ladder[0] || value.pair.weakest !== value.ladder.at(-1)) fail('the gate pair is the first and the last ladder model');
  if (value.bench.maxActions > FAMILY_BENCH[value.family].maxActions) fail(`--max-actions ${value.bench.maxActions} is above the ${value.family} cap`);
  const earlier = value.budget.earlier.reduce((total, entry) => total + entry.runs, 0);
  if (value.budget.releaseRunsBefore !== RELEASE_RUNS_BEFORE_ROUNDS_V1 + earlier) fail(`the release runs before this round are ${RELEASE_RUNS_BEFORE_ROUNDS_V1} plus the earlier rounds' ${earlier}, not ${value.budget.releaseRunsBefore}`);
  if (value.budget.releaseRunsBefore + Math.max(ROUND_V1.roundRuns, value.development.spent + ROUND_V1.heldOutRuns) > ROUND_V1.releaseBudget) fail('the round exceeds the 0.2.0 release budget of 500 model runs');
  return value;
}

/** A 0.2.0 round's held-out generator seeds: 26 consecutive seeds from 1 000 000 + (the first 12 hex
 * digits of the SHA-256 of the canonical JSON of family, round, generator version and the development
 * digest, as a number, modulo HELD_OUT_SPAN). */
export function heldOutSeedsV1(declaration: Pick<DeclarationV1, 'family' | 'round' | 'generator'> & { development: Pick<DeclarationV1['development'], 'digest'> }): number[] {
  const hash = sha256Hex(canonicalJson({ seeds: 'practonaut.challenge-seeds/1', family: declaration.family, round: declaration.round, generator: declaration.generator.version, development: declaration.development.digest }));
  const base = SEED_RANGES.heldout[0] + Number(BigInt(`0x${hash.slice(0, 12)}`) % BigInt(HELD_OUT_SPAN));
  return Array.from({ length: ROUND_V1.heldOutInstances }, (_, index) => base + index);
}

/** A committed 0.2.0 round ledger: the round's spend and the release total after it. */
export const LedgerSchemaV1 = z.strictObject({
  schema: z.literal(LEDGER_SCHEMA_V1), family: z.enum(FAMILIES), round: whole(1, ROUND_V1.maxRounds),
  declaration: z.strictObject({ sha256, commit: z.string().regex(/^[0-9a-f]{40}$/) }),
  spent: z.strictObject({ development: whole(0, 1000), heldOut: whole(0, 1000), total: whole(0, 1000), rejected: whole(0, 1000).optional() }),
  releaseRuns: whole(0, ROUND_V1.releaseBudget),
  heldOutRuns: z.array(z.strictObject({ bench: z.string().max(64), runId: z.string().max(128), taskId: z.string().max(64), model: model.nullable(), status: z.string().max(32).nullable(), rejected: z.literal(true).optional() })).max(1000),
});
export type LedgerV1 = z.infer<typeof LedgerSchemaV1>;
export function validateLedgerV1(raw: unknown): LedgerV1 {
  const parsed = LedgerSchemaV1.safeParse(raw);
  if (!parsed.success) throw new DeclarationV1Error(`the ledger does not match ${LEDGER_SCHEMA_V1}: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
  return parsed.data;
}

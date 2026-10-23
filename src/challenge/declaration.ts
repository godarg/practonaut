/**
 * The round files of the 0.3.0 gate (PADR-0042 as amended on acceptance, PADR-0044 decision 8): the
 * probe plan, committed and pushed before the first pre-probe run; the pre-probe record, committed
 * whether the unit is admitted or not; and the round declaration `/2`, which freezes what the round may
 * not change afterwards. The held-out seeds follow from the unit, the round, the generator version and
 * the digest `/2` of the pre-probe runs' canonical content. Every refusal has a code. Pure: the file
 * side (reports, git, ledger, bench folders) is files.ts.
 */
import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { BILLING_CLASSES, MODEL_ID } from '../bench/report.ts';
import { FAMILY_BENCH, SEED_RANGES } from './build.ts';
import { generatorId, generatorVersion, type Family } from './families.ts';
import { countLedger, RELEASE, RELEASE_CAP, roundEvents, roundStarts, spentStart, type Ledger } from './ledger.ts';
import { HELD_OUT_SPAN, tierOf } from './round-020.ts';
import { checkUnit, parseUnit, PRACTONAUT_TOOLCHAIN, UnitError } from './units.ts';
export { tierOf } from './round-020.ts';

export const PLAN_SCHEMA = 'practonaut.challenge-probe-plan/1';
export const PROBE_SCHEMA = 'practonaut.challenge-probe/1';
export const DECLARATION_SCHEMA = 'practonaut.challenge-declaration/2';
/** Shape B, the only shape of 0.3.0 (PADR-0042 amended, PADR-0046 decision 7): Opus pre-probes 7
 * development instances (1–5 passes admit, no extension); Opus, Sonnet and Haiku run 26 held-out
 * instances: (26 + 7) × 3 = 99 ≤ 100. */
export const SHAPE_B = Object.freeze({ preProbe: 7, admitLow: 1, admitHigh: 5, heldOut: 26, agents: 3 });
/** The rules every round follows whatever its shape (PADR-0042 decisions 8, 9 and 11). */
export const ROUND_RULES = Object.freeze({ minHeldOut: 24, minAgents: 3, maxSubscriptionAgents: 3, maxFormula: 100, maxRounds: 2, maxProbes: 2, leave: 40, foreignReserveRounds: 2 });
/** The decision level of each round (decision 11): the first at α = 0.05, a second at 0.025. Over both
 * rounds the family-wise false-pass bound is 0.05 + 0.025 = 0.075 (a union bound, not a Bonferroni
 * split of 0.05). */
export const ALPHA: Readonly<Record<number, number>> = Object.freeze({ 1: 0.05, 2: 0.025 });
/** The only gate-eligible preset in 0.3.0 (PADR-0046 decision 7): Claude through Claude Code. */
export const GATE_PRESET = 'claude-code';
/** Whether artifact mode is accepted: until then two rounds are kept for units on foreign toolchains
 * (PADR-0042 decision 8; the change that accepts artifact mode records its date here). */
export const ARTIFACT_MODE_ACCEPTED: string | null = null;

export class RoundError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'RoundError'; this.code = code; }
}
const refuse = (code: string, message: string): never => { throw new RoundError(code, message); };
/** A unit refusal as a round refusal (same code). */
function unitOf(id: string, approved: string | null): ReturnType<typeof checkUnit> {
  if (approved !== null && approved !== id) refuse('unit_approval_mismatch', `the maintainer approved ${approved}, not ${id}; an approval names its unit (PADR-0042 decision 2)`);
  try { return checkUnit(id, approved === id); } catch (error) { if (error instanceof UnitError) refuse(error.code, error.message); throw error; }
}

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[0-9a-f]{40}$/);
const model = z.string().regex(MODEL_ID);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,63}$/);
const whole = (low: number, high: number) => z.number().int().min(low).max(high);
const devSeed = whole(SEED_RANGES.dev[0], SEED_RANGES.dev[1]);
const unitId = z.string().max(100);
const BenchSchema = z.strictObject({ mirror: z.enum(['off', 'required']), timeoutSeconds: whole(1, 86_400), maxActions: whole(1, 10_000), checks: whole(0, 1000).nullable() });
/** The toolchain pin: at session level the Practonaut version; at artifact level the server's version,
 * its archive's SHA-256 and the reading-rules version (PADR-0044 decision 8). */
const ToolchainSchema = z.strictObject({
  id: identifier, level: z.enum(['session', 'artifact']), practonaut: z.string().min(1).max(64),
  server: z.strictObject({ version: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/), archiveSha256: sha256 }).nullable(),
  rules: z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/).nullable(),
});

// ---- The probe plan ----
export const PlanSchema = z.strictObject({
  schema: z.literal(PLAN_SCHEMA), release: z.literal(RELEASE),
  unit: unitId, round: whole(1, 99), probe: whole(1, 99),
  toolchain: ToolchainSchema,
  generator: z.strictObject({ id: z.string().max(64), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  difficulty: z.enum(['1', '2', '3', 'mixed']),
  shape: z.enum(['A', 'B']),
  /** The strongest configuration, which runs the pre-probe (PADR-0042 decision 7). */
  agent: z.strictObject({ preset: identifier, model }),
  seeds: z.array(devSeed).min(1).max(40),
  bench: BenchSchema,
  /** A unit outside the preregistered list, approved by the maintainer by name (decision 2): that unit's id. */
  maintainerApprovedUnit: unitId.nullable(),
});
export type Plan = z.infer<typeof PlanSchema>;

/** The checks a plan's own content must pass, each with its code. */
export function validatePlan(raw: unknown): Plan {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) refuse('plan_invalid', `the probe plan does not match ${PLAN_SCHEMA}: ${issues(parsed.error)}`);
  const plan = parsed.data!;
  if (plan.shape === 'A') refuse('shape_a_refused', 'shape A (the gate pair plus a local agent) is refused in 0.3.0: no local agent is gate-eligible (PADR-0046 decision 7); the round runs in shape B');
  const unit = unitOf(plan.unit, plan.maintainerApprovedUnit);
  if (plan.toolchain.id !== unit.toolchain || plan.toolchain.level !== unit.level) refuse('plan_invalid', `the plan's toolchain ${plan.toolchain.id} (${plan.toolchain.level}) is not the unit's`);
  if (unit.level === 'session' && (plan.toolchain.server !== null || plan.toolchain.rules !== null)) refuse('plan_invalid', 'a session-level toolchain has no server and no reading rules');
  if (plan.round > ROUND_RULES.maxRounds) refuse('round_limit', `a unit has at most ${ROUND_RULES.maxRounds} rounds (PADR-0042 decision 11)`);
  if (plan.probe > ROUND_RULES.maxProbes) refuse('probe_retune_exhausted', `a refused unit is retuned and pre-probed again once (PADR-0042 decision 7); probe ${plan.probe} is refused`);
  if (plan.generator.id !== generatorId(unit.family)) refuse('plan_invalid', `the generator of ${unit.family} is ${generatorId(unit.family)}`);
  if (plan.agent.preset !== GATE_PRESET) refuse('ladder_preset_refused', `the pre-probe agent runs through ${plan.agent.preset}; only ${GATE_PRESET} is gate-eligible in 0.3.0 (PADR-0046 decision 7)`);
  if (tierOf(plan.agent.model) !== 0) refuse('probe_agent_not_strongest', `the pre-probe runs the strongest configuration, Opus; ${plan.agent.model} is not an Opus model (PADR-0042 decision 7)`);
  if (plan.seeds.length !== SHAPE_B.preProbe) refuse('shape_b_sizes', `shape B pre-probes ${SHAPE_B.preProbe} instances, not ${plan.seeds.length}`);
  if (new Set(plan.seeds).size !== plan.seeds.length) refuse('plan_invalid', 'the pre-probe seeds must be distinct');
  if (plan.bench.maxActions > FAMILY_BENCH[unit.family].maxActions) refuse('max_actions_above_cap', `--max-actions ${plan.bench.maxActions} is above the ${unit.family} cap of ${FAMILY_BENCH[unit.family].maxActions}`);
  return plan;
}
/** Whether `plan` may follow `earlier` as the retune of the same unit and round: probe 1 refused, a
 * newer generator version, seeds disjoint from probe 1's (PADR-0042 decision 7). */
export function checkRetune(plan: Plan, earlier: { plan: Plan; admitted: boolean } | null): void {
  if (plan.probe === 1) { if (earlier) refuse('probe_retune_invalid', 'probe 1 of this unit and round exists already'); return; }
  if (!earlier || earlier.plan.probe !== plan.probe - 1 || earlier.plan.unit !== plan.unit || earlier.plan.round !== plan.round) return refuse('probe_retune_invalid', `probe ${plan.probe} follows the committed record of probe ${plan.probe - 1} of ${plan.unit} round ${plan.round}`);
  if (earlier.admitted) refuse('probe_retune_invalid', `probe ${plan.probe - 1} admitted the unit; only a refused unit is retuned`);
  if (earlier.plan.generator.version === plan.generator.version) refuse('probe_retune_invalid', `a retune is a new generator version; ${plan.generator.version} was pre-probed already`);
  if (plan.seeds.some(seed => earlier.plan.seeds.includes(seed))) refuse('probe_retune_invalid', 'a retune is pre-probed on new seeds');
}

/** The canonical SHA-256 of a round file: what later files and ledger entries bind. */
export const fileHash = (value: unknown): string => sha256Hex(canonicalJson(value));

// ---- The pre-probe record ----
export const ProbeSchema = z.strictObject({
  schema: z.literal(PROBE_SCHEMA), release: z.literal(RELEASE),
  unit: unitId, round: whole(1, 99), probe: whole(1, 99),
  plan: z.strictObject({ sha256, commit }),
  world: z.strictObject({ id: z.string().max(128), contentHash: sha256 }),
  agent: z.strictObject({ preset: identifier, model }),
  outcomes: z.array(z.strictObject({ taskId: z.string().max(64), seed: devSeed, pass: z.boolean() })).min(1).max(40),
  passed: whole(0, 40), admitted: z.boolean(),
  /** Pre-probe instances whose latest start has no run-end record: void, never benched again; a
   * pre-probe with a void run does not admit (PADR-0042 amended), and a retune may follow. */
  void: z.array(z.string().max(64)).max(40),
  rule: z.strictObject({ low: whole(0, 40), high: whole(0, 40), of: whole(1, 40) }),
  /** The digest `/2` of the pre-probe runs, which the declaration repeats. */
  digest: sha256,
  /** Each counted run and its two ledger records. */
  runs: z.array(z.strictObject({ taskId: z.string().max(64), bench: z.string().max(64), run: z.string().max(128), start: whole(0, Number.MAX_SAFE_INTEGER), end: whole(0, Number.MAX_SAFE_INTEGER) })).max(40),
  /** The pushed ledger the record was made from: its record count and last line's SHA-256 (the order of admission). */
  ledger: z.strictObject({ records: whole(1, Number.MAX_SAFE_INTEGER), head: sha256 }),
});
export type ProbeRecord = z.infer<typeof ProbeSchema>;
/** Shape B's admission rule: 1–5 of 7 passes admit; 0 or 6–7 refuse (no extension); a void run refuses. */
export const admits = (passed: number): boolean => passed >= SHAPE_B.admitLow && passed <= SHAPE_B.admitHigh;
export function validateProbe(raw: unknown): ProbeRecord {
  const parsed = ProbeSchema.safeParse(raw);
  if (!parsed.success) refuse('probe_invalid', `the pre-probe record does not match ${PROBE_SCHEMA}: ${issues(parsed.error)}`);
  const record = parsed.data!;
  if (record.passed !== record.outcomes.filter(entry => entry.pass).length || record.rule.of !== record.outcomes.length) refuse('probe_invalid', 'the pre-probe record\'s passes do not add up');
  if (record.void.some(task => !record.outcomes.some(entry => entry.taskId === task && !entry.pass))) refuse('probe_invalid', 'a void pre-probe run is an outcome of the record, never a pass');
  if (record.rule.low !== SHAPE_B.admitLow || record.rule.high !== SHAPE_B.admitHigh || record.admitted !== (record.void.length === 0 && admits(record.passed))) refuse('probe_invalid', `the pre-probe admits at ${SHAPE_B.admitLow}–${SHAPE_B.admitHigh} of ${SHAPE_B.preProbe} passes without a void run, and the record says otherwise`);
  return record;
}

// ---- Digest /2 and held-out seeds /2 ----
/** A development (pre-probe) run as the digest reads it (PADR-0044 decision 8): canonical content
 * only. Session level: the judged session's state hash and its action log in canonical JSON;
 * artifact level: what was judged and the SHA-256 of the canonical judged state. */
export type DigestRun = { model: string; taskId: string; seed: number; pass: boolean } & ({ hash: string; log: string } | { result: 'read' | 'absent' | 'unreadable'; state: string });
/** UTF-16 code-unit order, as canonicalJson sorts keys, never a locale. */
const codeUnits = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** The SHA-256 of the development runs' canonical content (`practonaut.challenge-development/2`),
 * sorted by model, task id and seed: a re-spaced file, an edited status or a copied report draw
 * nothing; another run (another log, board or verdict) gives another digest. */
export function developmentDigest(runs: readonly DigestRun[]): string {
  const ordered = [...runs].sort((a, b) => codeUnits(a.model, b.model) || codeUnits(a.taskId, b.taskId) || a.seed - b.seed);
  return sha256Hex(canonicalJson({ digest: 'practonaut.challenge-development/2', runs: ordered }));
}
/** A judged session as the digest reads it. */
export interface DigestSession { hash: string; log: unknown }
export const digestRunOf = (run: { taskId: string; seed: number; pass: boolean }, reported: string, session: DigestSession): DigestRun => ({
  model: reported, taskId: run.taskId, seed: run.seed, pass: run.pass, hash: session.hash, log: canonicalJson(session.log),
});
/** The round's held-out generator seeds: `instances` consecutive seeds from 1 000 000 + (the first 12
 * hex digits of the SHA-256 of the canonical JSON of release, unit, round, generator version and the
 * development digest, modulo 900 000 000). The unit enters here (PADR-0042 decision 1). */
export function heldOutSeeds(declaration: { unit: string; round: number; generator: { version: string }; development: { digest: string }; heldOut: { instances: number } }): number[] {
  const hash = sha256Hex(canonicalJson({ seeds: 'practonaut.challenge-seeds/2', release: RELEASE, unit: declaration.unit, round: declaration.round, generator: declaration.generator.version, development: declaration.development.digest }));
  const base = SEED_RANGES.heldout[0] + Number(BigInt(`0x${hash.slice(0, 12)}`) % BigInt(HELD_OUT_SPAN));
  return Array.from({ length: declaration.heldOut.instances }, (_, index) => base + index);
}

// ---- The declaration /2 ----
const LadderAgentSchema = z.strictObject({
  preset: identifier, client: identifier, model,
  /** Whether the client attests the model it ran (Claude Code's `system/init`). */
  attestation: z.enum(['client-attested', 'not-attested']),
  /** The billing class the preset is set up for (PADR-0044 decision 5): `local` is a local agent. */
  billing: z.enum(BILLING_CLASSES),
});
export const DeclarationSchema = z.strictObject({
  schema: z.literal(DECLARATION_SCHEMA), release: z.literal(RELEASE),
  unit: unitId, round: whole(1, 99), alpha: z.number().positive().max(0.5),
  toolchain: ToolchainSchema,
  generator: z.strictObject({ id: z.string().max(64), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
  difficulty: z.enum(['1', '2', '3', 'mixed']),
  shape: z.enum(['A', 'B']),
  maintainerApprovedUnit: unitId.nullable(),
  /** The pre-probe the round follows from: its plan and record (committed, pushed) and its passes. */
  probe: z.strictObject({ probe: whole(1, 99), plan: z.strictObject({ sha256, commit }), record: z.strictObject({ sha256, commit }), passed: whole(0, 40), instances: whole(1, 40) }),
  /** The ladder, most capable first; the gate pair is its first and last agent. */
  ladder: z.array(LadderAgentSchema).min(1).max(10),
  pair: z.strictObject({ strongest: model, weakest: model }),
  bench: BenchSchema,
  development: z.strictObject({ seeds: z.array(devSeed).min(1).max(40), world: z.strictObject({ id: z.string().max(128), contentHash: sha256 }), digest: sha256, passed: z.array(z.boolean()).min(1).max(40) }),
  heldOut: z.strictObject({ instances: whole(1, 120) }),
  /** Round 2: the canonical SHA-256 of round 1's declaration and its held-out seed range. */
  previous: z.strictObject({ declaration: sha256, low: z.number().int(), high: z.number().int() }).nullable(),
  budget: z.strictObject({
    subscriptionAgents: whole(0, 10), formula: whole(0, 10_000), roundRuns: whole(0, 10_000), cap: whole(1, 100_000),
    /** The release ledger's count when the round was declared, and the pushed ledger it was read from. */
    before: whole(0, 100_000), ledger: z.strictObject({ records: whole(1, Number.MAX_SAFE_INTEGER), head: sha256 }),
    /** Runs kept for units admitted earlier and for foreign toolchains, and the runs left after the round. */
    reserved: whole(0, 100_000), leave: whole(0, 100_000),
  }),
});
export type Declaration = z.infer<typeof DeclarationSchema>;

/** Subscription agents in the sense of D4 (PADR-0044 decision 5): every class but `local`. */
export const subscriptionAgents = (ladder: Declaration['ladder']): number => ladder.filter(agent => agent.billing !== 'local').length;
/** The held-out runs a round still spends once its pre-probe is done. */
export const heldOutRuns = (declaration: Pick<Declaration, 'heldOut' | 'ladder'>): number => declaration.heldOut.instances * subscriptionAgents(declaration.ladder);
/** Funding (PADR-0042 decision 8): a round fits when the count before it, its held-out runs, what is
 * reserved and the 40 runs it must leave stay within the cap. */
export const funded = (budget: Pick<Declaration['budget'], 'before' | 'reserved' | 'leave' | 'cap'>, roundHeldOut: number): boolean => budget.before + roundHeldOut + budget.reserved + budget.leave <= budget.cap;

/**
 * A declaration `/2` validated by its own content, each refusal by name: shape A; the unit; a ladder
 * agent through another preset or with a local billing class; fewer than three agents; more than
 * three subscription agents; fewer than 24 held-out instances; a formula above 100; shape B's sizes;
 * an agent whose client does not attest its model; the tiers out of order and the pair they fix; the
 * round limit and its alpha; the previous round; a pre-probe that did not admit; the budget's sums and
 * funding; the family's action cap.
 */
export function validateDeclaration(raw: unknown): Declaration {
  const parsed = DeclarationSchema.safeParse(raw);
  if (!parsed.success) refuse('declaration_invalid', `the declaration does not match ${DECLARATION_SCHEMA}: ${issues(parsed.error)}`);
  const value = parsed.data!;
  if (value.shape === 'A') refuse('shape_a_refused', 'shape A (the gate pair plus a local agent) is refused in 0.3.0: no local agent is gate-eligible (PADR-0046 decision 7); the round runs in shape B');
  const unit = unitOf(value.unit, value.maintainerApprovedUnit);
  if (value.toolchain.id !== unit.toolchain || value.toolchain.level !== unit.level) refuse('declaration_invalid', `the declaration's toolchain ${value.toolchain.id} is not the unit's`);
  if (value.generator.id !== generatorId(unit.family)) refuse('declaration_invalid', `the generator of ${unit.family} is ${generatorId(unit.family)}`);
  for (const agent of value.ladder) {
    if (agent.preset !== GATE_PRESET) refuse('ladder_preset_refused', `the ladder names ${agent.preset}; no preset but ${GATE_PRESET} is gate-eligible in 0.3.0 (PADR-0046 decision 7: its runs are "template: not restricted" or its billing is unknown)`);
    if (agent.billing === 'local') refuse('shape_a_refused', `a local ladder agent (${agent.model}) makes shape A, which is refused in 0.3.0 (PADR-0046 decision 7)`);
    if (agent.client !== GATE_PRESET) refuse('declaration_invalid', `the ${GATE_PRESET} preset's client is ${GATE_PRESET}`);
  }
  // The general rules of decision 9, before the shape's own sizes.
  const subscription = subscriptionAgents(value.ladder), formula = (value.heldOut.instances + value.probe.instances) * subscription;
  if (value.ladder.length < ROUND_RULES.minAgents) refuse('ladder_too_small', `a ladder has at least ${ROUND_RULES.minAgents} agents (vision §6 principle 2), not ${value.ladder.length}`);
  if (subscription > ROUND_RULES.maxSubscriptionAgents) refuse('too_many_subscription_agents', `a round has at most ${ROUND_RULES.maxSubscriptionAgents} subscription agents, not ${subscription} (D4)`);
  if (value.heldOut.instances < ROUND_RULES.minHeldOut) refuse('round_too_small', `a round has at least ${ROUND_RULES.minHeldOut} held-out instances, not ${value.heldOut.instances}`);
  if (formula > ROUND_RULES.maxFormula) refuse('round_formula_exceeded', `(held-out ${value.heldOut.instances} + pre-probe ${value.probe.instances}) × ${subscription} subscription agents = ${formula} exceeds ${ROUND_RULES.maxFormula} (D4)`);
  if (value.probe.instances !== SHAPE_B.preProbe || value.heldOut.instances !== SHAPE_B.heldOut || value.ladder.length !== SHAPE_B.agents)
    refuse('shape_b_sizes', `shape B is a ${SHAPE_B.preProbe}-instance pre-probe, ${SHAPE_B.heldOut} held-out instances and ${SHAPE_B.agents} agents`);
  if (value.ladder.some(agent => agent.attestation !== 'client-attested')) refuse('gate_pair_not_attested', 'every agent of a 0.3.0 ladder runs through Claude Code, whose client attests its model; the gate pair needs it (PADR-0042 decision 6)');
  const tiers = value.ladder.map(agent => tierOf(agent.model));
  if (new Set(value.ladder.map(agent => agent.model)).size !== value.ladder.length || tiers.join() !== '0,1,2') refuse('ladder_order', 'the ladder is Opus, Sonnet and Haiku, in that order (the capability order fixes the gate pair)');
  if (value.pair.strongest !== value.ladder[0]!.model || value.pair.weakest !== value.ladder.at(-1)!.model) refuse('gate_pair_fixed', `the gate pair is fixed by the capability order: strongest ${value.ladder[0]!.model}, weakest ${value.ladder.at(-1)!.model}`);
  if (value.round > ROUND_RULES.maxRounds) refuse('round_limit', `a unit has at most ${ROUND_RULES.maxRounds} rounds (PADR-0042 decision 11)`);
  if (value.alpha !== ALPHA[value.round]) refuse('alpha_invalid', `round ${value.round} decides at α = ${ALPHA[value.round]} (PADR-0042 decision 11)`);
  if ((value.round === 1) !== (value.previous === null)) refuse('previous_round', value.round === 1 ? 'round 1 has no previous round' : 'a second round names the first round\'s declaration and held-out seeds');
  if (value.previous) {
    const seeds = heldOutSeeds(value);
    if (seeds.some(seed => seed >= value.previous!.low && seed <= value.previous!.high)) refuse('heldout_overlap', 'a second round uses new held-out instances, never the first round\'s (PADR-0042 decision 11)');
  }
  if (!admits(value.probe.passed)) refuse('unit_not_admitted', `the pre-probe passed ${value.probe.passed} of ${value.probe.instances}; a unit enters a round at ${SHAPE_B.admitLow}–${SHAPE_B.admitHigh} (PADR-0042 decision 7)`);
  if (value.development.seeds.length !== value.probe.instances || value.development.passed.length !== value.probe.instances || value.development.passed.filter(Boolean).length !== value.probe.passed)
    refuse('declaration_invalid', 'the development seeds and outcomes are the pre-probe\'s');
  if (value.budget.subscriptionAgents !== subscription || value.budget.formula !== formula || value.budget.roundRuns !== value.probe.instances + heldOutRuns(value) || value.budget.cap !== RELEASE_CAP || value.budget.leave !== ROUND_RULES.leave)
    refuse('declaration_invalid', 'the declaration\'s budget figures do not follow from its ladder and sizes');
  if (!funded(value.budget, heldOutRuns(value))) refuse('unit_not_funded', `${value.unit} round ${value.round}: admitted, not gated for budget — ${value.budget.before} runs counted, ${heldOutRuns(value)} for the round, ${value.budget.reserved} reserved and ${value.budget.leave} to leave exceed ${value.budget.cap} (PADR-0042 decision 8)`);
  if (value.bench.maxActions > FAMILY_BENCH[unit.family].maxActions) refuse('max_actions_above_cap', `--max-actions ${value.bench.maxActions} is above the ${unit.family} cap of ${FAMILY_BENCH[unit.family].maxActions}`);
  return value;
}
export const declarationHash = (declaration: Declaration): string => fileHash(declaration);

/** The runs a shape-B round plans: its held-out runs, and the whole round. */
const HELD_OUT_RUNS = SHAPE_B.heldOut * SHAPE_B.agents, ROUND_RUNS = (SHAPE_B.heldOut + SHAPE_B.preProbe) * SHAPE_B.agents;
/**
 * Funding read from the release ledger as it was when a unit was declared (PADR-0042 decision 8 as
 * amended): `before`, the runs counted; `reserved`, the runs kept for others — for every other round
 * that is declared, its held-out runs less its own held-out runs that are final — judged or void (an
 * infra_error, exempt or not, is benched again, so it uses none up; a held-out run is never a local
 * model's in 0.3.0); for every other unit admitted before this
 * one (an earlier `admitted` record) and not declared, its 78 held-out runs; and, for a unit on
 * Practonaut's own actions while artifact mode is not accepted, two rounds for foreign toolchains less
 * those declared. The ledger is shared by every checkout and branch, so no admission or declaration
 * of another branch is missed.
 */
export function fundingAt(ledger: Ledger, unit: string, round: number, admission: number): { before: number; reserved: number } {
  const events = roundEvents(ledger), keys = new Map<string, { unit: string; round: number }>();
  for (const event of events) if (!(event.unit === unit && event.round === round)) keys.set(`${event.unit}\u0000${event.round}`, { unit: event.unit, round: event.round });
  let reserved = 0, foreignDeclared = 0;
  for (const key of keys.values()) {
    const own = events.filter(event => event.unit === key.unit && event.round === key.round);
    const declared = own.filter(event => event.event === 'declared').at(-1);
    if (declared) {
      const final = roundStarts(ledger, key.unit, key.round).filter(start => start.purpose === 'held-out' && start.basis === declared.declaration
        && spentStart(ledger, start)).length;
      reserved += Math.max(0, declared.heldOutRuns - final);
      if (parseUnit(key.unit).toolchain !== PRACTONAUT_TOOLCHAIN) foreignDeclared++;
      continue;
    }
    const admitted = own.filter(event => event.event !== 'declared').at(-1);
    if (admitted?.event === 'admitted' && admitted.seq < admission) reserved += HELD_OUT_RUNS;
  }
  if (parseUnit(unit).toolchain === PRACTONAUT_TOOLCHAIN && ARTIFACT_MODE_ACCEPTED === null) reserved += Math.max(0, ROUND_RULES.foreignReserveRounds - foreignDeclared) * ROUND_RUNS;
  return { before: countLedger(ledger).counted, reserved };
}

/** A pre-probe is recorded once (`probe_recorded`): no admission or refusal of this unit, round and
 * probe is registered in the ledger yet. */
export function refuseRecordedProbe(ledger: Ledger, plan: Pick<Plan, 'unit' | 'round' | 'probe'>): void {
  if (roundEvents(ledger, plan.unit, plan.round).some(event => event.event !== 'declared' && event.probe === plan.probe))
    refuse('probe_recorded', `${plan.unit} round ${plan.round}, probe ${plan.probe} is recorded in the release ledger already; a pre-probe record is made once`);
}
/** A round is declared again only while none of its held-out runs has started (`round_redeclared`):
 * no start of the round runs a held-out instance an earlier declaration registered (on any world, under
 * any purpose), or serves that declaration. */
export function refuseRedeclaration(ledger: Ledger, unit: string, round: number): void {
  const members = roundStarts(ledger, unit, round);
  for (const earlier of roundEvents(ledger, unit, round).filter(event => event.event === 'declared')) {
    const held = new Set(earlier.instances);
    const started = members.find(start => held.has(start.instance) || (start.purpose === 'held-out' && start.basis === earlier.declaration));
    if (started) refuse('round_redeclared', `${unit} round ${round} was declared before and its held-out runs started (start entry ${started.seq}); a round is not declared again once they did`);
  }
}

/** The family a validated unit names (for the generator). */
export const familyOf = (unit: string, approved: string | null): Family => unitOf(unit, approved).family;
/** The generator version this checkout has for a unit's family. */
export const checkoutGenerator = (unit: string, approved: string | null): { id: string; version: string } => { const family = familyOf(unit, approved); return { id: generatorId(family), version: generatorVersion(family) }; };

function issues(error: z.ZodError): string { return error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; '); }

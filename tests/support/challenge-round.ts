// A hand-built 0.3.0 round for the gate's unit tests: a probe plan, the pre-probe report of Opus
// through claude-code, its record, a declaration /2, held-out reports of oracle, random and the three
// ladder agents, and the release ledger holding a start entry and a run-end record for every model
// run. Outcomes are written out by the caller; every run's hashes are fixed strings here, and a task's
// identity (PADR-0044 decision 3) is a hash of its task id, the same on every world. What the gate
// derives from them is counted by hand in the tests.
import { createHash } from 'node:crypto';
import { BENCH_SCHEMA_V3, summarize, type SessionReportV3, type SessionRunV3 } from '../../src/bench/report.ts';
import { DECLARATION_SCHEMA, PLAN_SCHEMA, fileHash, heldOutSeeds, validateDeclaration, validatePlan, type Declaration, type DigestSession, type Plan, type ProbeRecord } from '../../src/challenge/declaration.ts';
import { probeRuns, type GateInput, type GateReport, type RederivedFailure } from '../../src/challenge/gate.ts';
import { headerLine, ledgerHead, nextLine, parseLedger, type Ledger, type Purpose, type RoundBody, type RunEndBody, type StartBody } from '../../src/challenge/ledger.ts';

export const hash = (c: string): string => c.repeat(64);
/** A task's identity in these fixtures: the same task id poses the same task on any world. */
export const identityOf = (taskId: string): string => createHash('sha256').update(`identity:${taskId}`).digest('hex');
export const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU = 'claude-haiku-5-5';
export const UNIT = 'repair.practonaut', PRACTONAUT = '0.3.0-dev.0', PROMPT = 'p';
export const SEVEN = ['act', 'check_result', 'explain_result', 'list_actions', 'observe', 'reset', 'undo'];
let benches = 0;
/** A bench folder name as `bench` makes them. */
export const benchName = (): string => `20261102T1000${String(Math.floor(benches / 60)).padStart(2, '0')}Z-${(benches++ % 0x10000).toString(16).padStart(4, '0')}`;

export interface RunOptions {
  /** null: infra_error with this failure (default: a usage limit before model work, as the parser classifies it). */
  failure?: SessionRunV3['failure'];
  /** The model the client reports (default: the report's model). */
  clientModel?: string | null;
  version?: string; tools?: string[]; observe?: number; act?: number; tokens?: { input: number; output: number; cacheRead: number; cacheCreation: number } | null;
}
const USAGE_LIMIT: NonNullable<SessionRunV3['failure']> = { reason: 'usage_limit', parser: 'claude-code-stream/1', code: 'rejected', beforeModelWork: true };
/** One run of the claude-code preset (pass true or false: judged; null: an infra_error). */
export function presetRun(taskId: string, pass: boolean | null, model: string, options: RunOptions = {}): SessionRunV3 {
  const judged = pass !== null, index = Number(taskId.split('-').at(-1)) % 10;
  const tools = options.tools ?? SEVEN.map(tool => `mcp__practonaut__${tool}`);
  const within = tools.every(tool => tool.startsWith('mcp__practonaut__'));
  const act = judged ? options.act ?? 3 : 0, observe = options.observe ?? (judged ? 1 : 0);
  return {
    verdictLevel: 'session', id: `${taskId}-s1-r1`, taskId, seed: 1, repeat: 1, status: judged ? 'completed' : 'infra_error', pass: pass === true,
    referenceActions: null, wallMs: 1000, agentExitCode: judged ? 0 : 1, isolation: { level: within ? 'tool-restricted-preset' : 'template-unrestricted', evidence: within ? 'tools-within-servers' : 'tool-outside-servers' },
    stdout: { sha256: hash(String(index)), bytes: 300 + index },
    client: { source: 'client-attested', model: options.clientModel === undefined ? model : options.clientModel, turns: 2, costUsd: 0, tokens: options.tokens === undefined ? (judged ? { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 } : null) : options.tokens,
      version: options.version ?? '2.1.0', parser: 'claude-code-stream/1', tools: { names: tools, omitted: 0 }, billing: { class: 'subscription', source: 'client-attested', via: 'claude-code-stream/1:init.apiKeySource' } },
    ...(judged ? {} : { failure: options.failure ?? USAGE_LIMIT, note: 'the client reported a usage or rate limit (fixture)' }),
    actions: act, acceptedActions: act, rejectedActions: 0, undos: 0, resets: 0, toolCalls: { observe, act, undo: 0, reset: 0, check: judged ? 1 : 0, total: observe + act + (judged ? 1 : 0) },
    checker: judged ? { session: { passed: pass, errorClasses: [] }, native: null } : null,
    ...(judged ? { artifacts: { session: hash('abcdef0123'[index]!), native: null, checker: hash(pass ? 'c' : 'e'), trace: null, traceError: 'fixture', board: null } } : {}),
    agentActions: act,
  } as SessionRunV3;
}
/** A built-in run (oracle or random) on one held-out task. */
export function builtinRun(taskId: string, pass: boolean): SessionRunV3 {
  return {
    verdictLevel: 'session', id: `${taskId}-s1-r1`, taskId, seed: 1, repeat: 1, status: 'completed', pass, referenceActions: null, wallMs: 100, agentExitCode: 0,
    isolation: { level: 'builtin-baseline', evidence: 'by-kind' }, actions: 3, acceptedActions: 3, rejectedActions: 0, undos: 0, resets: 0,
    toolCalls: { observe: 1, act: 3, undo: 0, reset: 0, check: 1, total: 5 }, checker: { session: { passed: pass, errorClasses: [] }, native: null },
    artifacts: { session: hash('a'), native: null, checker: hash(pass ? 'c' : 'e'), trace: null, traceError: 'fixture', board: null }, agentActions: 3,
  } as SessionRunV3;
}

export interface ReportOptions { practonaut?: string; billing?: 'subscription' | 'api-key' | 'local' | 'unknown'; requested?: string | null; apiKeySource?: 'none' | 'ANTHROPIC_API_KEY'; keptEnv?: string[]; prompt?: string; mirror?: 'off' | 'required'; maxActions?: number; createdAt?: string; preset?: string; seeds?: number[]; repeats?: number; generated?: (taskId: string) => number }
/** A /3 session-level report of `agent` (oracle, random, or a model through claude-code) with these runs. */
export function report(agent: string, runs: SessionRunV3[], worldHash: string, generator: { id: string; version: string }, options: ReportOptions = {}): SessionReportV3 {
  const builtin = agent === 'oracle' || agent === 'random', tasks = [...new Set(runs.map(run => run.taskId))];
  const model = builtin ? null : runs.find(run => run.client?.model)?.client?.model ?? null;
  return {
    schema: BENCH_SCHEMA_V3, createdAt: options.createdAt ?? '2026-11-02T10:00:00.000Z', verdictLevel: 'session',
    environment: { practonaut: options.practonaut ?? PRACTONAUT, node: 'v22.22.3', os: { platform: 'linux', release: '6.8.0', arch: 'x64' }, app: { adapterId: 'excalidraw', version: '0.18.1' }, mirror: options.mirror ?? 'off',
      world: { source: 'own', worldId: 'challenge-repair-practonaut-r1', version: '1.0.0', contentHash: worldHash, package: { path: 'world.pnworld', sha256: hash('e') },
        generated: tasks.map(taskId => ({ taskId, id: generator.id, version: generator.version, seed: options.generated ? options.generated(taskId) : Number(taskId.split('-').at(-1)), parameters: { difficulty: 1 } })) } },
    toolchain: { kind: 'practonaut', id: 'practonaut', tools: [...SEVEN] },
    instances: tasks.map(taskId => ({ taskId, seed: 1, identity: identityOf(taskId) })),
    agent: builtin
      ? { kind: 'builtin', name: agent, command: [], isolation: 'builtin-baseline', model: null, modelSource: 'none', apiKeySource: null, keptEnv: [], vendor: { value: null, source: 'none' }, client: { value: null, source: 'none' }, clientVersion: { value: null, source: 'none' }, requestedModel: { value: null, source: 'none' }, settings: [], billing: { class: 'unknown', source: 'none' } }
      : { kind: 'preset', name: options.preset ?? 'claude-code', command: ['claude'], isolation: runs.every(run => run.isolation.evidence === 'tools-within-servers') ? 'tool-restricted-preset' : 'template-unrestricted', model, modelSource: model === null ? 'none' : 'client-attested', apiKeySource: options.apiKeySource ?? 'none', keptEnv: options.keptEnv ?? [],
        vendor: { value: 'anthropic', source: 'client-attested' }, client: { value: 'claude-code', source: 'preset-requested' }, clientVersion: { value: runs[0]?.client?.version ?? '2.1.0', source: 'client-attested' },
        requestedModel: options.requested === null ? { value: null, source: 'none' } : { value: options.requested ?? agent, source: 'preset-requested' }, settings: [], billing: { class: options.billing ?? 'subscription', source: 'preset-requested' } },
    settings: { tasks, seeds: options.seeds ?? [1], repeats: options.repeats ?? 1, timeoutSeconds: 600, maxActions: options.maxActions ?? 50, mirror: options.mirror ?? 'off', prompt: builtin ? '' : options.prompt ?? PROMPT },
    references: null, runs, summary: summarize(runs, 1, run => run.agentActions),
  } as SessionReportV3;
}

/** The judged session of a run, for the digest. */
export const sessionFor = (run: SessionRunV3): DigestSession => ({ hash: `state-${run.taskId}-${run.pass}`, log: [{ action: { name: 'connect', params: { from: 'a', to: run.taskId } }, hash: `step-${run.pass}` }] });
/** A gate report: every run re-derived, the failures as the parser reads them, sessions for the digest. */
export function gateReport(value: SessionReportV3, bench = benchName(), options: { notRederived?: string[]; failures?: Record<string, RederivedFailure | null> } = {}): GateReport {
  const rederived = new Set(value.runs.filter(run => run.stdout && !options.notRederived?.includes(run.id)).map(run => run.id));
  const failures = new Map(value.runs.filter(run => run.status === 'infra_error').map(run => [run.id, options.failures && run.id in options.failures ? options.failures[run.id]! : run.failure?.parser ? { reason: run.failure.reason, parser: run.failure.parser, code: run.failure.code, beforeModelWork: run.failure.beforeModelWork === true } : null]));
  return { report: value, bench, rederived, failures, sessions: new Map(value.runs.filter(run => run.artifacts).map(run => [run.id, sessionFor(run)])) };
}

/** A group of the ledger: the model runs of these reports under one purpose and basis, or a round record. */
export type LedgerGroup = { reports: GateReport[]; purpose: Purpose; basis: string | null; round?: number | null; unit?: string | null; toolchain?: string; world?: string; model?: string | null } | { round: RoundBody };
/** A ledger with a start entry and a run-end record for every model run of these reports (in order),
 * under the purpose and basis each group names, and the round records given; `skipEnd` leaves a run's
 * run-end record out. Starts bench the world of their report. */
export function ledgerOf(groups: LedgerGroup[], options: { skipEnd?: string[] } = {}): Ledger {
  let ledger = parseLedger(headerLine());
  const add = (body: StartBody | RunEndBody | RoundBody): number => { const { record, line } = nextLine(ledger, body); ledger = parseLedger(ledger.text + line); return record.seq; };
  for (const group of groups) {
    if ('round' in group && typeof group.round === 'object' && group.round !== null) { add(group.round); continue; }
    const runs = group as Extract<LedgerGroup, { reports: GateReport[] }>;
    for (const source of runs.reports) for (const run of source.report.runs) {
      const start = add({ kind: 'start', purpose: runs.purpose, unit: runs.unit === undefined ? UNIT : runs.unit, round: runs.round === undefined ? 1 : runs.round, basis: runs.basis, toolchain: runs.toolchain ?? 'practonaut', rules: null, requested: 'subscription', model: runs.model ?? source.report.agent.requestedModel.value, agent: 'claude-code', bench: source.bench, run: run.id, world: runs.world ?? source.report.environment.world.contentHash, instance: identityOf(run.taskId) });
      if (options.skipEnd?.includes(`${source.bench}/${run.id}`)) continue;
      const tokens = run.client?.tokens;
      add({ kind: 'run-end', start, toolchain: runs.toolchain ?? 'practonaut', rules: null, status: run.status, judged: run.artifacts?.session ?? null, stdout: run.stdout?.sha256 ?? null, checker: run.artifacts?.checker ?? null,
        observed: { class: 'subscription', source: 'client-attested' }, failure: run.failure ?? null, hostCalls: run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check, reads: run.toolCalls.observe,
        tokens: tokens ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation : null });
    }
  }
  return ledger;
}

export const GENERATOR = { id: 'challenge-repair', version: '1.0.0' };
export const PROBE_WORLD = hash('9'), HELD_WORLD = hash('d');
export function planOf(extra: Partial<Plan> = {}): Plan {
  return validatePlan({
    schema: PLAN_SCHEMA, release: '0.3.0', unit: UNIT, round: 1, probe: 1, toolchain: { id: 'practonaut', level: 'session', practonaut: PRACTONAUT, server: null, rules: null },
    generator: GENERATOR, difficulty: '1', shape: 'B', agent: { preset: 'claude-code', model: OPUS }, seeds: [1, 2, 3, 4, 5, 6, 7], bench: { mirror: 'off', timeoutSeconds: 600, maxActions: 50, checks: null }, maintainerApprovedUnit: UNIT, ...extra,
  });
}
/** Opus's pre-probe: the first `passes` of the seven instances pass. */
export function probeReport(passes = 3, options: ReportOptions & { runs?: (task: string, pass: boolean) => SessionRunV3; probeSeeds?: number[]; world?: string } = {}): GateReport {
  const runs = (options.probeSeeds ?? [1, 2, 3, 4, 5, 6, 7]).map((seed, index) => options.runs ? options.runs(`repair-${seed}`, index < passes) : presetRun(`repair-${seed}`, index < passes, OPUS));
  return gateReport(report(OPUS, runs, options.world ?? PROBE_WORLD, GENERATOR, options));
}
/** The task identities of a plan's pre-probe instances (plan order). */
export const probeIdentities = (plan: Plan): string[] => plan.seeds.map(seed => identityOf(`repair-${seed}`));
export function probeRecordOf(plan: Plan, probe: GateReport[], ledger: Ledger, world = PROBE_WORLD): ProbeRecord {
  const result = probeRuns({ plan, planHash: fileHash(plan), worldContentHash: world, identities: probeIdentities(plan), reports: probe, ledger });
  return {
    schema: 'practonaut.challenge-probe/1', release: '0.3.0', unit: plan.unit, round: plan.round, probe: plan.probe, plan: { sha256: fileHash(plan), commit: 'a'.repeat(40) },
    world: { id: 'challenge-repair-practonaut-r1-probe1', contentHash: world }, agent: { preset: 'claude-code', model: OPUS }, outcomes: result.outcomes, passed: result.passed,
    admitted: result.void.length === 0 && result.passed >= 1 && result.passed <= 5, void: result.void, rule: { low: 1, high: 5, of: 7 }, digest: result.digest, runs: result.runs, ledger: { records: ledger.records.length, head: ledgerHead(ledger) },
  };
}
/** The round records `probe` and `declare` register. */
export const admissionOf = (plan: Plan, record: ProbeRecord): RoundBody => ({ kind: 'round', event: record.admitted ? 'admitted' : 'refused', unit: plan.unit, round: plan.round, probe: plan.probe, plan: fileHash(plan), record: fileHash(record), declaration: null, world: record.world.contentHash, heldOutRuns: 0, instances: probeIdentities(plan) });
export const declaredOf = (round: Pick<Round, 'plan' | 'record' | 'declaration'>, world: string): RoundBody => ({ kind: 'round', event: 'declared', unit: round.plan.unit, round: round.plan.round, probe: round.plan.probe, plan: fileHash(round.plan), record: fileHash(round.record), declaration: fileHash(round.declaration), world, heldOutRuns: 78, instances: heldOutSeeds(round.declaration).map(seed => identityOf(`repair-${seed}`)) });
export function declarationOf(plan: Plan, record: ProbeRecord, extra: Partial<Declaration> = {}, budget: Partial<Declaration['budget']> = {}, counted?: Ledger): Declaration {
  const ladder = [OPUS, SONNET, HAIKU].map(model => ({ preset: 'claude-code', client: 'claude-code', model, attestation: 'client-attested' as const, billing: 'subscription' as const }));
  return {
    schema: DECLARATION_SCHEMA, release: '0.3.0', unit: plan.unit, round: plan.round, alpha: plan.round === 1 ? 0.05 : 0.025, toolchain: plan.toolchain, generator: plan.generator, difficulty: plan.difficulty, shape: 'B', maintainerApprovedUnit: UNIT,
    probe: { probe: plan.probe, plan: { sha256: fileHash(plan), commit: 'a'.repeat(40) }, record: { sha256: fileHash(record), commit: 'b'.repeat(40) }, passed: record.passed, instances: 7 },
    ladder, pair: { strongest: OPUS, weakest: HAIKU }, bench: plan.bench,
    development: { seeds: plan.seeds, world: { id: record.world.id, contentHash: record.world.contentHash }, digest: record.digest, passed: record.outcomes.map(entry => entry.pass) },
    heldOut: { instances: 26 }, previous: null,
    budget: { subscriptionAgents: 3, formula: 99, roundRuns: 85, cap: 800, before: 7, ledger: counted ? { records: counted.records.length, head: ledgerHead(counted) } : { records: record.ledger.records + 1, head: hash('0') }, reserved: 198, leave: 40, ...budget }, ...extra,
  } as Declaration;
}

export interface Round { plan: Plan; probe: GateReport[]; record: ProbeRecord; declaration: Declaration; tasks: string[]; seeds: number[]; groups: LedgerGroup[]; probeWorld: string; heldWorld: string }
/** The round up to its declaration: plan, Opus's pre-probe (3 of 7) and its ledger, the record and its
 * admission, the declaration (its budget from the ledger as it then was) and its registration. */
export function roundOf(passes = 3, plan = planOf(), extra: Partial<Declaration> = {}, budget: Partial<Declaration['budget']> = {}, worlds = { probe: PROBE_WORLD, held: HELD_WORLD }, before: LedgerGroup[] = []): Round {
  const probe = [probeReport(passes, { probeSeeds: plan.seeds, world: worlds.probe })];
  const pre: LedgerGroup[] = [...before, { reports: probe, purpose: 'pre-probe', basis: fileHash(plan), round: plan.round }];
  const record = probeRecordOf(plan, probe, ledgerOf(pre), worlds.probe);
  const counted = ledgerOf([...pre, { round: admissionOf(plan, record) }]);
  const declaration = validateDeclaration(declarationOf(plan, record, extra, budget, counted));
  const seeds = heldOutSeeds(declaration);
  return { plan, probe, record, declaration, seeds, tasks: seeds.map(seed => `repair-${seed}`), groups: [...pre, { round: admissionOf(plan, record) }, { round: declaredOf({ plan, record, declaration }, worlds.held) }], probeWorld: worlds.probe, heldWorld: worlds.held };
}
/** The first `k` held-out instances pass. */
export const first = (round: Round, k: number): boolean[] => round.tasks.map((_, index) => index < k);
export function heldReport(round: Round, agent: string, passes: boolean[], options: ReportOptions & { run?: (task: string, index: number) => SessionRunV3 | null } = {}): GateReport {
  const builtin = agent === 'oracle' || agent === 'random';
  const runs = round.tasks.flatMap((task, index) => {
    if (options.run) { const value = options.run(task, index); return value ? [value] : []; }
    return [builtin ? builtinRun(task, passes[index]!) : presetRun(task, passes[index]!, agent)];
  });
  return gateReport(report(agent, runs, round.heldWorld, GENERATOR, { generated: task => round.seeds[round.tasks.indexOf(task)]!, ...options }));
}
/** The round's ledger: its pre-probe, admission and declaration, then these held-out reports (and more groups). */
export const roundLedger = (round: Round, ladder: GateReport[], more: LedgerGroup[] = [], options: { skipEnd?: string[] } = {}): Ledger =>
  ledgerOf([...round.groups, { reports: ladder, purpose: 'held-out', basis: fileHash(round.declaration), round: round.plan.round }, ...more], options);
/** A gate input for a round: ladder outcomes for Opus, Sonnet and Haiku; the ledger holds every model run. */
export function inputOf(round: Round, ladder: GateReport[], extra: Partial<GateInput> & { skipEnd?: string[] } = {}): GateInput {
  const ledger = roundLedger(round, ladder, [], { ...(extra.skipEnd ? { skipEnd: extra.skipEnd } : {}) });
  return {
    plan: round.plan, probe: round.record, declaration: round.declaration, probeWorld: round.probeWorld, tasks: round.tasks, seeds: round.seeds, worldContentHash: round.heldWorld,
    development: round.probe, oracle: [heldReport(round, 'oracle', round.tasks.map(() => true))], random: [heldReport(round, 'random', round.tasks.map(() => false))],
    nearMisses: { total: 104, passed: 0, perInstance: round.tasks.map(() => 4) }, ledger: { ledger, versions: [{ commit: 'c'.repeat(40), date: '2026-11-02T12:00:00Z', records: ledger.records.length }] }, outside: [],
    identities: { probe: probeIdentities(round.plan), heldOut: round.tasks.map(identityOf) },
    ladder, ...extra,
  };
}

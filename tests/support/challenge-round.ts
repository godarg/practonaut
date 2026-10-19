// A hand-built 0.3.0 round for the gate's unit tests: a probe plan, the pre-probe report of Opus
// through claude-code, its record, a declaration /2, held-out reports of oracle, random and the three
// ladder agents, and the release ledger holding a start entry and a run-end record for every model
// run. Outcomes are written out by the caller; every run's hashes are fixed strings here. What the
// gate derives from them is counted by hand in the tests.
import { BENCH_SCHEMA_V3, summarize, type SessionReportV3, type SessionRunV3 } from '../../src/bench/report.ts';
import { DECLARATION_SCHEMA, PLAN_SCHEMA, fileHash, heldOutSeeds, validateDeclaration, validatePlan, type Declaration, type DigestSession, type Plan, type ProbeRecord } from '../../src/challenge/declaration.ts';
import { probeRuns, type GateInput, type GateReport, type RederivedFailure } from '../../src/challenge/gate.ts';
import { headerLine, ledgerHead, nextLine, parseLedger, type Ledger, type RunEndBody, type StartBody } from '../../src/challenge/ledger.ts';

export const hash = (c: string): string => c.repeat(64);
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
    instances: tasks.map(taskId => ({ taskId, seed: 1, identity: hash('1') })),
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

/** A ledger with a start entry and a run-end record for every model run of these reports (in order),
 * under the purpose and basis each group names; `skipEnd` leaves a run's run-end record out. */
export function ledgerOf(groups: Array<{ reports: GateReport[]; purpose: 'pre-probe' | 'held-out'; basis: string; round?: number; unit?: string; toolchain?: string }>, options: { skipEnd?: string[]; extra?: (ledger: Ledger) => StartBody | RunEndBody | null } = {}): Ledger {
  let ledger = parseLedger(headerLine());
  const add = (body: StartBody | RunEndBody): number => { const { record, line } = nextLine(ledger, body); ledger = parseLedger(ledger.text + line); return record.seq; };
  for (const group of groups) for (const source of group.reports) for (const run of source.report.runs) {
    const start = add({ kind: 'start', purpose: group.purpose, unit: group.unit ?? UNIT, round: group.round ?? 1, basis: group.basis, toolchain: group.toolchain ?? 'practonaut', rules: null, requested: 'subscription', model: source.report.agent.requestedModel.value, agent: 'claude-code', bench: source.bench, run: run.id });
    if (options.skipEnd?.includes(`${source.bench}/${run.id}`)) continue;
    const tokens = run.client?.tokens;
    add({ kind: 'run-end', start, toolchain: group.toolchain ?? 'practonaut', rules: null, status: run.status, judged: run.artifacts?.session ?? null, stdout: run.stdout?.sha256 ?? null, checker: run.artifacts?.checker ?? null,
      observed: { class: 'subscription', source: 'client-attested' }, failure: run.failure ?? null, hostCalls: run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check, reads: run.toolCalls.observe,
      tokens: tokens ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation : null });
  }
  const extra = options.extra?.(ledger);
  if (extra) add(extra);
  return ledger;
}

export const GENERATOR = { id: 'challenge-repair', version: '1.0.0' };
export const PROBE_WORLD = hash('9'), HELD_WORLD = hash('d');
export function planOf(extra: Partial<Plan> = {}): Plan {
  return validatePlan({
    schema: PLAN_SCHEMA, release: '0.3.0', unit: UNIT, round: 1, probe: 1, toolchain: { id: 'practonaut', level: 'session', practonaut: PRACTONAUT, server: null, rules: null },
    generator: GENERATOR, difficulty: '1', shape: 'B', agent: { preset: 'claude-code', model: OPUS }, seeds: [1, 2, 3, 4, 5, 6, 7], bench: { mirror: 'off', timeoutSeconds: 600, maxActions: 50, checks: null }, maintainerApprovedUnit: true, ...extra,
  });
}
/** Opus's pre-probe: the first `passes` of the seven instances pass. */
export function probeReport(passes = 3, options: ReportOptions & { runs?: (task: string, pass: boolean) => SessionRunV3 } = {}): GateReport {
  const runs = [1, 2, 3, 4, 5, 6, 7].map((seed, index) => options.runs ? options.runs(`repair-${seed}`, index < passes) : presetRun(`repair-${seed}`, index < passes, OPUS));
  return gateReport(report(OPUS, runs, PROBE_WORLD, GENERATOR, options));
}
export function probeRecordOf(plan: Plan, probe: GateReport[], ledger: Ledger): ProbeRecord {
  const result = probeRuns({ plan, planHash: fileHash(plan), worldContentHash: PROBE_WORLD, reports: probe, ledger });
  return {
    schema: 'practonaut.challenge-probe/1', release: '0.3.0', unit: plan.unit, round: plan.round, probe: plan.probe, plan: { sha256: fileHash(plan), commit: 'a'.repeat(40) },
    world: { id: 'challenge-repair-practonaut-r1-probe1', contentHash: PROBE_WORLD }, agent: { preset: 'claude-code', model: OPUS }, outcomes: result.outcomes, passed: result.passed,
    admitted: result.passed >= 1 && result.passed <= 5, rule: { low: 1, high: 5, of: 7 }, digest: result.digest, runs: result.runs, ledger: { records: ledger.records.length, head: ledgerHead(ledger) },
  };
}
export function declarationOf(plan: Plan, record: ProbeRecord, extra: Partial<Declaration> = {}, budget: Partial<Declaration['budget']> = {}): Declaration {
  const ladder = [OPUS, SONNET, HAIKU].map(model => ({ preset: 'claude-code', client: 'claude-code', model, attestation: 'client-attested' as const, billing: 'subscription' as const }));
  return {
    schema: DECLARATION_SCHEMA, release: '0.3.0', unit: plan.unit, round: 1, alpha: 0.05, toolchain: plan.toolchain, generator: plan.generator, difficulty: plan.difficulty, shape: 'B', maintainerApprovedUnit: true,
    probe: { probe: 1, plan: { sha256: fileHash(plan), commit: 'a'.repeat(40) }, record: { sha256: fileHash(record), commit: 'b'.repeat(40) }, passed: record.passed, instances: 7 },
    ladder, pair: { strongest: OPUS, weakest: HAIKU }, bench: plan.bench,
    development: { seeds: plan.seeds, world: { id: record.world.id, contentHash: PROBE_WORLD }, digest: record.digest, passed: record.outcomes.map(entry => entry.pass) },
    heldOut: { instances: 26 }, previous: null,
    budget: { subscriptionAgents: 3, formula: 99, roundRuns: 85, cap: 800, before: 7, ledger: { ...record.ledger }, reserved: 198, leave: 40, ...budget }, ...extra,
  } as Declaration;
}

export interface Round { plan: Plan; probe: GateReport[]; record: ProbeRecord; declaration: Declaration; tasks: string[]; seeds: number[] }
/** The round up to its declaration: plan, Opus's pre-probe (3 of 7), its ledger, record and declaration. */
export function roundOf(passes = 3): Round {
  const plan = planOf(), probe = [probeReport(passes)];
  const record = probeRecordOf(plan, probe, ledgerOf([{ reports: probe, purpose: 'pre-probe', basis: fileHash(plan) }]));
  const declaration = validateDeclaration(declarationOf(plan, record));
  const seeds = heldOutSeeds(declaration);
  return { plan, probe, record, declaration, seeds, tasks: seeds.map(seed => `repair-${seed}`) };
}
/** The first `k` held-out instances pass. */
export const first = (round: Round, k: number): boolean[] => round.tasks.map((_, index) => index < k);
export function heldReport(round: Round, agent: string, passes: boolean[], options: ReportOptions & { run?: (task: string, index: number) => SessionRunV3 | null } = {}): GateReport {
  const builtin = agent === 'oracle' || agent === 'random';
  const runs = round.tasks.flatMap((task, index) => {
    if (options.run) { const value = options.run(task, index); return value ? [value] : []; }
    return [builtin ? builtinRun(task, passes[index]!) : presetRun(task, passes[index]!, agent)];
  });
  return gateReport(report(agent, runs, HELD_WORLD, GENERATOR, { generated: task => round.seeds[round.tasks.indexOf(task)]!, ...options }));
}
/** A gate input for a round: ladder outcomes for Opus, Sonnet and Haiku; the ledger holds every model run. */
export function inputOf(round: Round, ladder: GateReport[], extra: Partial<GateInput> & { skipEnd?: string[] } = {}): GateInput {
  const ledger = ledgerOf([{ reports: round.probe, purpose: 'pre-probe', basis: fileHash(round.plan) }, { reports: ladder, purpose: 'held-out', basis: fileHash(round.declaration) }], { ...(extra.skipEnd ? { skipEnd: extra.skipEnd } : {}) });
  return {
    plan: round.plan, probe: round.record, declaration: round.declaration, probeWorld: PROBE_WORLD, tasks: round.tasks, seeds: round.seeds, worldContentHash: HELD_WORLD,
    development: round.probe, oracle: [heldReport(round, 'oracle', round.tasks.map(() => true))], random: [heldReport(round, 'random', round.tasks.map(() => false))],
    nearMisses: { total: 104, passed: 0, perInstance: round.tasks.map(() => 4) }, ledger: { ledger, versions: [{ commit: 'c'.repeat(40), date: '2026-11-02T12:00:00Z', records: ledger.records.length }] }, outside: [],
    ladder, ...extra,
  };
}

/**
 * The bench reports `practonaut.bench/1`, `/2` and `/3`: their schemas (sources of
 * `schemas/bench.v1.json`, `bench.v2.json` and `bench.v3.json`), the aggregation and the validators.
 * A report is data: `report` and every consumer accept it only after `validateBenchReport`, which
 * re-derives every pass and every aggregate from the recorded checker verdicts. A pass without an
 * independent verdict, or a summary that the runs do not produce, is rejected, whatever the file claims.
 *
 * `bench` writes /3 (PADR-0044); /1 reports from 0.1.0 and /2 reports from 0.2.0 are read and
 * validated by their own rules, unchanged. Consumers read every version through the read-only view
 * of `view.ts`.
 */
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { GeneratedParametersSchema } from '../world/schema.ts';
import { cliText } from '../cli/messages.ts';

export const BENCH_SCHEMA_V1 = 'practonaut.bench/1';
export const BENCH_SCHEMA_V2 = 'practonaut.bench/2';
export const BENCH_SCHEMA_V3 = 'practonaut.bench/3';
/** The version `bench` writes. */
export const BENCH_SCHEMA = BENCH_SCHEMA_V3;

/** Named refusals: an inconsistent or re-judged-differently report, and for /2 and /3 a stored world,
 * artifact or reference that does not match what the report binds. */
export type BenchErrorCode = 'bench_report_invalid' | 'bench_world_changed' | 'bench_artifact_changed' | 'bench_reference_invalid';
export class BenchReportError extends Error {
  readonly code: BenchErrorCode;
  constructor(message: string, code: BenchErrorCode = 'bench_report_invalid') { super(message); this.name = 'BenchReportError'; this.code = code; }
}

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ratio = z.number().min(0).max(1);
const text = (max: number) => z.string().max(max);
const errorClass = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** One independent checker verdict: the separate checker process, never the agent or the host. */
const VerdictSchema = z.strictObject({ passed: z.boolean(), errorClasses: z.array(errorClass).max(64) });
const ToolCallsSchema = z.strictObject({ observe: count, act: count, undo: count, reset: count, check: count, total: count });

export const RunStatus = ['completed', 'agent_failed', 'timeout', 'infra_error'] as const;
export const BenchRunSchemaV1 = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,47}-s-?\d{1,16}-r\d{1,4}$/),
  taskId: id, seed: z.number().int().safe(), repeat: z.number().int().min(1).max(1000),
  /** How the agent process ended. Scoring never depends on it. */
  status: z.enum(RunStatus),
  /** Derived: the session verdict passed and, with a mirror, the native-export verdict passed too. */
  pass: z.boolean(),
  /** Actions in the final history of the committed session: `report --verify` re-derives it from the
   * session artifact. Scoring and efficiency use this number. */
  actions: count,
  /** Counted by the runner while the agent worked (self-reported by the runner, not re-verifiable from
   * the artifacts): every accepted action including later undone ones, rejected actions, undo, reset. */
  acceptedActions: count, rejectedActions: count, undos: count, resets: count,
  toolCalls: ToolCallsSchema,
  /** Wall-clock time of the agent process; self-reported by the runner. */
  wallMs: count,
  /** Length of the library's reference solution; `report --verify` compares it with the library entry. */
  referenceActions: z.number().int().min(1).max(1000),
  /** Independent verdicts in a separate checker process; null only when the run could not be judged. */
  checker: z.strictObject({ session: VerdictSchema, native: VerdictSchema.nullable() }).nullable(),
  agentExitCode: z.number().int().nullable(),
  note: text(256).optional(),
  /** SHA-256 of the run's artifacts in its run directory (`session.json`, `native.excalidraw`,
   * `checker.json`). `practonaut report --verify` re-runs the checker on them. Absent for runs that
   * could not be judged and in reports written by earlier builds. */
  artifacts: z.strictObject({ session: sha256, native: sha256.nullable(), checker: sha256 }).optional(),
});
export type BenchRunV1 = z.infer<typeof BenchRunSchemaV1>;

const TaskSummarySchemaV1 = z.strictObject({ taskId: id, runs: count, passed: count, passAt1: ratio, meanActions: z.number().nonnegative().nullable(), referenceActions: z.number().int().min(1), efficiency: z.number().nonnegative().nullable() });
const summaryShape = {
  runs: count, passed: count, judged: count,
  /** Runs that could not be judged. They stay in every denominator and count as not passed. */
  infraErrors: count,
  /** passed / runs over ALL runs, infrastructure errors included (they count as not passed). */
  passAt1: ratio,
  /** pass^k (τ-bench) for k = 1 … repeats; see `passHatK`. */
  passHatK: z.array(z.strictObject({ k: z.number().int().min(1).max(1000), value: ratio })).min(1).max(1000),
  meanActions: z.number().nonnegative().nullable(), meanActionsPassed: z.number().nonnegative().nullable(),
  /** Mean of referenceActions / actions over passed runs with a reference (> 1 = shorter than the
   * reference); null when no passed run has one. */
  efficiencyVsReference: z.number().nonnegative().nullable(), meanWallMs: z.number().nonnegative().nullable(),
  rejectedActions: count, undos: count, resets: count, toolCalls: count,
};
export const BenchSummarySchemaV1 = z.strictObject({ ...summaryShape, byTask: z.array(TaskSummarySchemaV1).max(1000) });
export type BenchSummaryV1 = z.infer<typeof BenchSummarySchemaV1>;

const os = z.strictObject({ platform: text(32), release: text(128), arch: text(32) });
export const BenchReportSchemaV1 = z.strictObject({
  schema: z.literal(BENCH_SCHEMA_V1),
  createdAt: z.iso.datetime(),
  environment: z.strictObject({
    practonaut: text(64), excalidraw: text(64), node: text(64), os,
    /** The mirror actually used: `required` = every action confirmed in the real Excalidraw, `off` = model only. */
    mirror: z.enum(['required', 'off']),
    /** The bundled library the runs used; `contentHash` is the SHA-256 of the world's canonical JSON. */
    library: z.strictObject({ worldId: text(64), version: text(64), contentHash: sha256 }),
  }),
  agent: z.strictObject({
    kind: z.enum(['builtin', 'preset', 'command']), name: text(64),
    /** The command template (placeholders kept, home directory shown as ~); empty for built-ins. */
    command: z.array(text(4096)).max(256),
    /** The model as reported by the client itself (claude-code init event), else null. Never verified. */
    model: text(128).nullable(), modelSource: z.enum(['client-attested', 'none']),
  }),
  settings: z.strictObject({
    tasks: z.array(id).min(1).max(1000), seeds: z.array(z.number().int().safe()).min(1).max(1000),
    repeats: z.number().int().min(1).max(1000), timeoutSeconds: z.number().int().min(1).max(86_400),
    maxActions: z.number().int().min(1).max(10_000), mirror: z.enum(['auto', 'required', 'off']),
    prompt: text(4096),
  }),
  runs: z.array(BenchRunSchemaV1).min(1).max(100_000),
  /** Present when the bench was stopped (Ctrl+C, SIGTERM, SIGHUP) before all planned runs ended:
   * the report holds the runs that finished; the run in progress is not scored. */
  interrupted: z.strictObject({ plannedRuns: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER) }).optional(),
  summary: BenchSummarySchemaV1,
});
export type BenchReportV1 = z.infer<typeof BenchReportSchemaV1>;

// ---- practonaut.bench/2 (PADR-0036) ----

/** A world task id (world format: letters, digits, `_`, `-`). */
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const taskId = z.string().regex(TASK_ID);
/** Seeds a bench plans: `--seeds n` gives 1 … n, `--seed-list` names them (0 … 999 999 999). */
export const MAX_SEED = 999_999_999;
const seed = z.number().int().min(0).max(MAX_SEED);
/** The fixed names of the stored world and references inside a bench folder (never a path elsewhere). */
export const BENCH_WORLD_FILE = 'world.pnworld';
export const BENCH_REFERENCES_FILE = 'references.json';
/** Isolation levels: what Practonaut itself restricts about an agent's tools. Follows from the kind. */
export const ISOLATION_OF = Object.freeze({ builtin: 'builtin-baseline', preset: 'tool-restricted-preset', command: 'template-unrestricted' } as const);
export type IsolationLevel = typeof ISOLATION_OF[keyof typeof ISOLATION_OF];
/** `apiKeySource` as a client reports it in its stream-json init event. */
/** A model id as a client reports it: plain text, optionally with a bracketed suffix such as
 * Claude Code's context-window marker (`claude-opus-5-5[1m]`). */
export const MODEL_ID = /^[\w.:@/-]{1,112}(?:\[[\w.-]{1,14}\])?$/;
/** A client version as Claude Code reports it (`claude_code_version`). */
export const CLIENT_VERSION = /^[\w.+-]{1,32}$/;
export const API_KEY_SOURCE = /^[A-Za-z0-9_ ./:@()-]{1,64}$/;
/** An environment variable name `--keep-env` accepts. */
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** The longest `--label` (UTF-16 code units). */
export const MAX_LABEL = 128;

/** The run's call log and mutation log in its run folder (PADR-0039 A.1–2), bound by hash. */
const RunLogsSchema = z.strictObject({
  /** `calls.jsonl`, normalised by the runner from what the agent's bridge wrote (`calls.bridge.jsonl`,
   * kept unchanged); null: none was written. `dropped`: unreadable lines; `omitted`: lines beyond the
   * log limits, counted but not kept in `calls.jsonl`; `omittedAtLeast`: the file went on past what
   * was counted, so `omitted` is a lower bound. */
  calls: z.strictObject({ sha256, entries: count, dropped: count, omitted: count.optional(), omittedAtLeast: z.literal(true).optional(), clientTiming: z.boolean() }).nullable(),
  /** `mutations.jsonl`, written by the runner's host-side wrapper; `omitted`: budget refusals only counted. */
  mutations: z.strictObject({ sha256, entries: count, omitted: count }),
});
/** The client's own figures from its output (PADR-0039 A.5): self-reported, never verified. */
const RunClientSchema = z.strictObject({
  source: z.enum(['client-attested', 'command-output']),
  model: z.string().regex(MODEL_ID).nullable(), turns: count.nullable(), costUsd: z.number().nonnegative().max(1_000_000).nullable(),
  tokens: z.strictObject({ input: count, output: count, cacheRead: count, cacheCreation: count }).nullable(),
  /** The client's version from its init event (`claude_code_version`), when it names one. */
  version: z.string().regex(CLIENT_VERSION).nullable().optional(),
});
export const BenchRunSchemaV2 = z.strictObject({
  ...BenchRunSchemaV1.shape,
  /** `<task>-s<seed>-r<repeat>`: also the name of the run's folder in the bench folder. */
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}-s\d{1,9}-r\d{1,4}$/),
  taskId, seed,
  /** Length of the task's validated reference (`references`), or null: no reference, no efficiency. */
  referenceActions: z.number().int().min(1).max(1000).nullable(),
  /** SHA-256 of the run's judged artifacts; present exactly when the run was judged. `trace`: the
   * checker's condition trace (null when it could not be made, with `traceError`); `board`: the real
   * engine's SVG of the final board (null without the mirror or when the picture failed). */
  artifacts: z.strictObject({ session: sha256, native: sha256.nullable(), checker: sha256, trace: sha256.nullable().optional(), traceError: errorClass.optional(), board: sha256.nullable().optional() }).optional(),
  logs: RunLogsSchema.optional(),
  client: RunClientSchema.optional(),
});
export type BenchRunV2 = z.infer<typeof BenchRunSchemaV2>;
const TaskSummarySchemaV2 = z.strictObject({ ...TaskSummarySchemaV1.shape, taskId, referenceActions: z.number().int().min(1).nullable() });
export const BenchSummarySchemaV2 = z.strictObject({ ...summaryShape, byTask: z.array(TaskSummarySchemaV2).max(1000) });
export type BenchSummaryV2 = z.infer<typeof BenchSummarySchemaV2>;

const GeneratedEntrySchema = z.strictObject({
  taskId, id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), version: text(64), seed: z.number().int().safe(), parameters: GeneratedParametersSchema,
});
export const BenchReportSchemaV2 = z.strictObject({
  schema: z.literal(BENCH_SCHEMA_V2),
  createdAt: z.iso.datetime(),
  /** `--label`: the user's own text, shown escaped. */
  label: z.string().min(1).max(MAX_LABEL).optional(),
  environment: z.strictObject({
    practonaut: text(64), excalidraw: text(64), node: text(64), os,
    mirror: z.enum(['required', 'off']),
    /** The public world the runs used, stored in the bench folder; `report --verify` judges against it. */
    world: z.strictObject({
      /** `library`: the bundled task library; `own`: a world given with `--world`. */
      source: z.enum(['library', 'own']),
      worldId: text(64), version: text(128),
      /** SHA-256 of the world's canonical JSON. */
      contentHash: sha256,
      /** The stored package: its fixed name in the bench folder and the SHA-256 of its bytes. */
      package: z.strictObject({ path: z.literal(BENCH_WORLD_FILE), sha256 }),
      /** `generatedBy` of the benched tasks that a generator materialised (PADR-0036). */
      generated: z.array(GeneratedEntrySchema).max(1000),
      /** The public `limits` of benched tasks that have them (PADR-0040); `--verify` compares them with the stored world. */
      limits: z.array(z.strictObject({ taskId, actions: z.number().int().min(1).max(1000).optional(), checks: z.number().int().min(0).max(1000).optional() })).max(1000).optional(),
    }),
  }),
  agent: z.strictObject({
    kind: z.enum(['builtin', 'preset', 'command']), name: text(64),
    command: z.array(text(4096)).max(256),
    /** What Practonaut restricts about the agent's tools; follows from `kind`. */
    isolation: z.enum([ISOLATION_OF.builtin, ISOLATION_OF.preset, ISOLATION_OF.command]),
    /** The model from a stream-json `system/init` line, else null. Never verified. */
    model: text(128).nullable(),
    /** `client-attested`: the preset client's own init event; `command-output`: an init line in a
     * command template's output (the template keeps its model; which program printed it is unknown). */
    modelSource: z.enum(['client-attested', 'command-output', 'none']),
    /** `apiKeySource` from the same init line, else null: evidence, not proof (PADR-0034). */
    apiKeySource: z.string().regex(API_KEY_SOURCE).nullable(),
    /** Names given to `--keep-env` (a preset only); never values. */
    keptEnv: z.array(z.string().regex(ENV_NAME)).max(64),
  }),
  settings: z.strictObject({
    tasks: z.array(taskId).min(1).max(1000), seeds: z.array(seed).min(1).max(1000),
    repeats: z.number().int().min(1).max(1000), timeoutSeconds: z.number().int().min(1).max(86_400),
    maxActions: z.number().int().min(1).max(10_000), mirror: z.enum(['auto', 'required', 'off']),
    prompt: text(4096),
    /** `--checks`: checks allowed per run (PADR-0040); a task's own limits are in the stored world. */
    checks: z.number().int().min(0).max(1000).optional(),
  }),
  /** Validated references, stored in the bench folder after the last agent ended; null: none. */
  references: z.strictObject({
    path: z.literal(BENCH_REFERENCES_FILE), sha256,
    tasks: z.array(z.strictObject({ taskId, source: z.enum(['library', 'oracle-file']), actions: z.number().int().min(1).max(1000),
      /** The reference is a proven minimal solution for every planned seed (PADR-0040); absent or false:
       * a reference length. `report --verify` recomputes it. */
      minimal: z.boolean().optional() })).min(1).max(1000),
  }).nullable(),
  runs: z.array(BenchRunSchemaV2).min(1).max(100_000),
  /** Rebuilt from the run folders after the bench was killed (`bench --recover`, PADR-0040). */
  recovered: z.literal(true).optional(),
  /** `stopped`: the bench stopped itself at an infra_error run (`--stop-on-infra`, PADR-0040);
   * `remaining` are the tasks to bench again once the client's limit window is over. */
  interrupted: z.strictObject({ plannedRuns: z.number().int().min(2).max(Number.MAX_SAFE_INTEGER),
    stopped: z.strictObject({ run: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}-s\d{1,9}-r\d{1,4}$/), remaining: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)).min(1).max(1000) }).optional() }).optional(),
  summary: BenchSummarySchemaV2,
});
export type BenchReportV2 = z.infer<typeof BenchReportSchemaV2>;

// ---- practonaut.bench/3 (PADR-0044) ----

/** An identifier, never free text (parsers, toolchains, clients, vendors, setting names). */
export const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,63}$/;
/** A tool name as a client lists it; a name that does not fit is evidence of a tool outside. */
export const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
/** The most tool names a run keeps; a longer list is evidence of a tool outside. */
export const MAX_TOOL_NAMES = 256;
/** A client's or server's own failure identifier: an HTTP status, an event subtype; never free text. */
export const FAILURE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const identifier = z.string().regex(IDENTIFIER);
const toolName = z.string().regex(TOOL_NAME);
const semverPin = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/);
export const VERDICT_LEVELS = ['session', 'artifact'] as const;
export type VerdictLevel = typeof VERDICT_LEVELS[number];
export const BILLING_CLASSES = ['subscription', 'api-key', 'local', 'unknown'] as const;
export type BillingClass = typeof BILLING_CLASSES[number];
/** Where a value comes from; a value is never shown stronger than its source (PADR-0044 decision 5). */
export const EVIDENCE_SOURCES = ['client-attested', 'preset-requested', 'command-output', 'none'] as const;
export type EvidenceSource = typeof EVIDENCE_SOURCES[number];
export const ISOLATION_EVIDENCE = ['by-kind', 'tools-within-servers', 'tool-outside-servers', 'no-evidence'] as const;
export type IsolationEvidence = typeof ISOLATION_EVIDENCE[number];
/** Why a run was not judged (decision 9); only `usage_limit` and `auth` can ever be budget-exempt. */
export const FAILURE_REASONS = ['usage_limit', 'auth', 'api_error', 'server_error', 'no_tool_call', 'evidence_incomplete', 'interrupted', 'runner'] as const;
export type FailureReason = typeof FAILURE_REASONS[number];
/** The reasons a client's parser classifies; every other reason is the runner's own (parser null). */
export const PARSER_REASONS: ReadonlySet<FailureReason> = new Set(['usage_limit', 'auth', 'api_error']);
/** `apiKeySource` as /3 stores it: a value from the parser's fixed list, `other` for anything else. */
export const API_KEY_SOURCES = ['none', 'ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key', 'other'] as const;

const evidenced = <T extends z.ZodString>(value: T) => z.strictObject({ value: value.nullable(), source: z.enum(EVIDENCE_SOURCES) });
const IsolationLevelSchema = z.enum([ISOLATION_OF.builtin, ISOLATION_OF.preset, ISOLATION_OF.command]);
const RunIsolationSchema = z.strictObject({ level: IsolationLevelSchema, evidence: z.enum(ISOLATION_EVIDENCE) });
/** `agent.stdout` bound by hash, read as a whole stream; null: the runner could not read it. */
const StdoutSchema = z.strictObject({ sha256, bytes: count });
const RunFailureSchema = z.strictObject({
  reason: z.enum(FAILURE_REASONS),
  /** The versioned parser that classified it; null for the runner's own reasons. */
  parser: identifier.nullable(),
  code: z.string().regex(FAILURE_CODE).nullable(),
  /** As the client's parser decides; null when unknown. */
  beforeModelWork: z.boolean().nullable(),
});
export type RunFailure = z.infer<typeof RunFailureSchema>;
const RunClientSchemaV3 = z.strictObject({
  ...RunClientSchema.shape,
  /** The versioned parser that read the run's bound stdout (for example `claude-code-stream/1`). */
  parser: identifier,
  /** The tools the client offered the model, as it lists them; names that do not fit or beyond the
   * first 256 are counted in `omitted`, which is itself evidence of a tool outside. */
  tools: z.strictObject({ names: z.array(toolName).max(MAX_TOOL_NAMES), omitted: count }).optional(),
  /** The billing class the parser derives after the run; `via` names the statement it read (a fixed
   * identifier per parser, never a value from the output). */
  billing: z.strictObject({ class: z.enum(BILLING_CLASSES), source: z.enum(['client-attested', 'preset-requested']), via: identifier }).optional(),
});
export type RunClientV3 = z.infer<typeof RunClientSchemaV3>;
const runBaseV3 = {
  id: BenchRunSchemaV2.shape.id, taskId, seed, repeat: BenchRunSchemaV1.shape.repeat,
  status: z.enum(RunStatus), pass: z.boolean(),
  referenceActions: BenchRunSchemaV2.shape.referenceActions, wallMs: count, agentExitCode: z.number().int().nullable(), note: text(256).optional(),
  /** The run's isolation and its evidence (decision 6). */
  isolation: RunIsolationSchema,
  /** Present (possibly null) exactly for external runs (decision 5). */
  stdout: StdoutSchema.nullable().optional(),
  /** Exactly for `infra_error` runs (decision 9). */
  failure: RunFailureSchema.optional(),
  client: RunClientSchemaV3.optional(),
};
export const SessionRunSchemaV3 = z.strictObject({
  verdictLevel: z.literal('session'),
  ...runBaseV3,
  actions: count, acceptedActions: count, rejectedActions: count, undos: count, resets: count,
  toolCalls: ToolCallsSchema,
  checker: BenchRunSchemaV2.shape.checker,
  /** As /2; the native export's file is named per adapter (`native.<adapterId>`). */
  artifacts: BenchRunSchemaV2.shape.artifacts,
  logs: RunLogsSchema.optional(),
  /** The agent's actions in the final history (decision 7); equals `actions` without a co-actor. */
  agentActions: count,
  coActor: z.strictObject({ planned: count, fired: count, accepted: count, rejected: count }).optional(),
});
export type SessionRunV3 = z.infer<typeof SessionRunSchemaV3>;
export const ArtifactRunSchemaV3 = z.strictObject({
  verdictLevel: z.literal('artifact'),
  ...runBaseV3,
  /** The separate checker's verdict on the judged file and what was judged (decision 1). */
  checker: z.strictObject({ artifact: VerdictSchema, result: z.enum(['read', 'absent', 'unreadable']) }).nullable(),
  /** From a complete proxy log: `initialize` requests, forwarded `tools/call`, refusals. */
  proxy: z.strictObject({ starts: count, calls: count, refused: count }),
  artifacts: z.strictObject({ start: sha256, result: sha256.nullable(), reading: sha256, checker: sha256 }).optional(),
  proxyLog: z.strictObject({ sha256, entries: count }).nullable(),
});
export type ArtifactRunV3 = z.infer<typeof ArtifactRunSchemaV3>;
export const ArtifactSummarySchema = z.strictObject({
  runs: count, passed: count, judged: count, infraErrors: count, passAt1: ratio,
  passHatK: summaryShape.passHatK, meanWallMs: z.number().nonnegative().nullable(),
  /** `tools/call` requests the proxy forwarded, over every run. */
  proxyCalls: count,
  byTask: z.array(z.strictObject({ taskId, runs: count, passed: count, passAt1: ratio })).max(1000),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;
export const PractonautToolchainSchema = z.strictObject({
  kind: z.literal('practonaut'), id: z.literal('practonaut'),
  /** The tool names Practonaut's bridge advertised (every run of a bench starts the same bridge). */
  tools: z.array(toolName).min(1).max(MAX_TOOL_NAMES),
});
/** A URL without credentials, query or fragment. */
const SOURCE_URL = /^https:\/\/[A-Za-z0-9.-]{1,253}(?::\d{1,5})?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/;
export const ForeignToolchainSchema = z.strictObject({
  kind: z.literal('foreign-mcp'),
  /** The toolchain part of a unit name (PADR-0042 decision 1), e.g. `excalidraw-mcp-0.3.2`. */
  id: identifier,
  server: z.strictObject({ name: identifier, version: semverPin, source: z.string().max(512).regex(SOURCE_URL), archiveSha256: sha256 }),
  proxy: z.strictObject({ name: identifier }),
  startDelivery: z.enum(['server-store', 'prompt', 'file']),
  locator: z.strictObject({ field: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.[\]-]+$/), select: z.enum(['last-ok', 'first-ok']) }),
  rules: z.strictObject({ format: identifier, version: semverPin }),
  allowlist: z.array(z.strictObject({ tool: toolName, effect: z.enum(['run-store', 'file', 'network']) })).min(1).max(MAX_TOOL_NAMES),
});
export type ForeignToolchain = z.infer<typeof ForeignToolchainSchema>;
const AgentSchemaV3 = z.strictObject({
  ...BenchReportSchemaV2.shape.agent.shape,
  /** As /2, from the first run that reports one; stored from the parser's fixed list, else `other`. */
  apiKeySource: z.enum(API_KEY_SOURCES).nullable(),
  /** The model's vendor from the preset's mapping of the requested or attested model id. */
  vendor: evidenced(identifier),
  /** The client program the preset starts. */
  client: evidenced(identifier),
  /** The first run's client version that reports one. */
  clientVersion: evidenced(z.string().regex(CLIENT_VERSION)),
  /** The value of the preset's model switch or variable as the client got it. */
  requestedModel: evidenced(z.string().regex(MODEL_ID)),
  /** Behaviour-changing client settings as the preset requested them. */
  settings: z.array(z.strictObject({ name: identifier, value: identifier })).max(64),
  /** The billing class the preset was set up for, before the start. */
  billing: z.strictObject({ class: z.enum(BILLING_CLASSES), source: z.enum(['preset-requested', 'none']) }),
});
export type AgentV3 = z.infer<typeof AgentSchemaV3>;
export const BenchReportSchemaV3 = z.strictObject({
  schema: z.literal(BENCH_SCHEMA_V3),
  createdAt: z.iso.datetime(),
  label: BenchReportSchemaV2.shape.label,
  /** One verdict level per report, repeated on every run (decision 1). */
  verdictLevel: z.enum(VERDICT_LEVELS),
  environment: z.strictObject({
    practonaut: text(64), node: text(64), os,
    /** The world's adapter and the pinned application version (decision 2). */
    app: z.strictObject({ adapterId: identifier, version: text(64) }),
    /** Session level only. */
    mirror: z.enum(['required', 'off']).optional(),
    world: z.strictObject({
      ...BenchReportSchemaV2.shape.environment.shape.world.shape,
      /** SHA-256 of the canonical JSON of each benched task's co-actor schedule (decision 7). */
      scenarios: z.array(z.strictObject({ taskId, schedule: sha256 })).max(1000).optional(),
    }),
  }),
  toolchain: z.discriminatedUnion('kind', [PractonautToolchainSchema, ForeignToolchainSchema]),
  /** One entry per instance with at least one run, in plan order (decision 3). */
  instances: z.array(z.strictObject({ taskId, seed, identity: sha256 })).min(1).max(100_000),
  agent: AgentSchemaV3,
  settings: BenchReportSchemaV2.shape.settings,
  references: BenchReportSchemaV2.shape.references,
  runs: z.array(z.discriminatedUnion('verdictLevel', [SessionRunSchemaV3, ArtifactRunSchemaV3])).min(1).max(100_000),
  recovered: BenchReportSchemaV2.shape.recovered,
  interrupted: BenchReportSchemaV2.shape.interrupted,
  summary: z.union([BenchSummarySchemaV2, ArtifactSummarySchema]),
});
export type BenchReportV3 = z.infer<typeof BenchReportSchemaV3>;
export type BenchRunV3 = BenchReportV3['runs'][number];
/** A validated /3 report at session level: its runs, summary and toolchain are the session level's. */
export type SessionReportV3 = Omit<BenchReportV3, 'verdictLevel' | 'runs' | 'summary' | 'toolchain'> & { verdictLevel: 'session'; runs: SessionRunV3[]; summary: BenchSummaryV2; toolchain: z.infer<typeof PractonautToolchainSchema> };
/** What the 0.2.0 challenge gate reads: a /2 report or a session-level /3 report, whose runs keep every /2 field (P1 restricts 0.3.0 rounds to /3). */
export type GateBenchReport = BenchReportV2 | SessionReportV3;
export type GateBenchRun = BenchRunV2 | SessionRunV3;
export const isSessionReportV3 = (report: { schema: string; verdictLevel?: string }): report is SessionReportV3 => report.schema === BENCH_SCHEMA_V3 && report.verdictLevel === 'session';
export type BenchReport = BenchReportV1 | BenchReportV2 | BenchReportV3;
/** Runs of the /1 and /2 shape (and the session runs of /3, which keep every /2 field). */
export type BenchRun = BenchRunV1 | BenchRunV2;

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
const mean = (values: number[]): number | null => values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - k + i) / i;
  return result;
}
/**
 * pass^k as defined by τ-bench (Yao, Shinn, Razavi, Narasimhan: "τ-bench: A Benchmark for
 * Tool-Agent-User Interaction in Real-World Domains", arXiv:2406.12045, 2024, §5):
 *   pass^k = E_task [ C(c, k) / C(n, k) ]
 * with n independent trials of a task and c of them successful — the chance that all of k
 * trials drawn from the n succeed. Here a task is one (task, seed) instance and its trials are
 * the repeats. pass^1 equals pass@1.
 */
export function passHatK(instances: ReadonlyArray<{ n: number; c: number }>, k: number): number {
  if (!instances.length) return 0;
  // An instance with fewer than k trials cannot show k successes; it contributes 0, never NaN.
  return round(instances.reduce((sum, { n, c }) => sum + (choose(n, k) === 0 ? 0 : choose(c, k) / choose(n, k)), 0) / instances.length);
}

/** The pass rule. With a mirror the native export must pass as well; without a verdict nothing passes. */
export function derivedPass(run: Pick<BenchRun, 'checker'>, mirror: 'required' | 'off'): boolean {
  if (!run.checker) return false;
  if (mirror === 'required' && !run.checker.native) return false;
  return run.checker.session.passed && (run.checker.native?.passed ?? true);
}

/** pass^k over the instances (task × seed) of `runs`, for k = 1 … repeats. */
const passHatKs = (runs: ReadonlyArray<{ taskId: string; seed: number; pass: boolean }>, repeats: number): Array<{ k: number; value: number }> => {
  const instances = new Map<string, { n: number; c: number }>();
  for (const run of runs) {
    const key = `${run.taskId}\u0000${run.seed}`, entry = instances.get(key) ?? { n: 0, c: 0 };
    entry.n++; if (run.pass) entry.c++; instances.set(key, entry);
  }
  return Array.from({ length: repeats }, (_, index) => ({ k: index + 1, value: passHatK([...instances.values()], index + 1) }));
};
/** Aggregates over every run. Efficiency only counts passed runs whose task has a reference. Mean
 * actions and efficiency count `actionsOf(run)`: the final history's actions (/1, /2), the agent's
 * own (/3, decision 7: equal without a co-actor). */
export function summarize(runs: readonly BenchRunV1[], repeats: number): BenchSummaryV1;
export function summarize(runs: readonly BenchRunV2[], repeats: number): BenchSummaryV2;
export function summarize(runs: readonly SessionRunV3[], repeats: number, actionsOf: (run: SessionRunV3) => number): BenchSummaryV2;
export function summarize<R extends BenchRun | SessionRunV3>(runs: readonly R[], repeats: number, actionsOf: (run: R) => number = run => run.actions): BenchSummaryV1 | BenchSummaryV2 {
  const judged = runs.filter(run => run.checker !== null), passed = runs.filter(run => run.pass);
  const efficiency = (list: readonly R[]): number | null => mean(list.flatMap(run => run.pass && actionsOf(run) > 0 && run.referenceActions !== null ? [run.referenceActions / actionsOf(run)] : []));
  const taskIds = [...new Set(runs.map(run => run.taskId))];
  return {
    runs: runs.length, passed: passed.length, judged: judged.length, infraErrors: runs.filter(run => run.status === 'infra_error').length,
    // Every run is in the denominator: a run that could not be judged (infra_error) is not passed.
    passAt1: runs.length ? round(passed.length / runs.length) : 0,
    passHatK: passHatKs(runs, repeats),
    meanActions: mean(judged.map(actionsOf)), meanActionsPassed: mean(passed.map(actionsOf)),
    efficiencyVsReference: efficiency(runs), meanWallMs: mean(runs.map(run => run.wallMs)),
    rejectedActions: runs.reduce((sum, run) => sum + run.rejectedActions, 0), undos: runs.reduce((sum, run) => sum + run.undos, 0),
    resets: runs.reduce((sum, run) => sum + run.resets, 0), toolCalls: runs.reduce((sum, run) => sum + run.toolCalls.total, 0),
    byTask: taskIds.map(taskId => {
      const list = runs.filter(run => run.taskId === taskId), ok = list.filter(run => run.pass);
      return { taskId, runs: list.length, passed: ok.length, passAt1: round(ok.length / list.length), meanActions: mean(list.filter(run => run.checker !== null).map(actionsOf)), referenceActions: list[0]!.referenceActions, efficiency: efficiency(list) };
    }),
  } as BenchSummaryV1 | BenchSummaryV2;
}
/** The summary of an artifact-level report: no action figures, the proxy's forwarded calls (decision 1). */
export function summarizeArtifact(runs: readonly ArtifactRunV3[], repeats: number): ArtifactSummary {
  const passed = runs.filter(run => run.pass), taskIds = [...new Set(runs.map(run => run.taskId))];
  return {
    runs: runs.length, passed: passed.length, judged: runs.filter(run => run.checker !== null).length, infraErrors: runs.filter(run => run.status === 'infra_error').length,
    passAt1: runs.length ? round(passed.length / runs.length) : 0, passHatK: passHatKs(runs, repeats), meanWallMs: mean(runs.map(run => run.wallMs)),
    proxyCalls: runs.reduce((sum, run) => sum + run.proxy.calls, 0),
    byTask: taskIds.map(taskId => { const list = runs.filter(run => run.taskId === taskId), ok = list.filter(run => run.pass).length; return { taskId, runs: list.length, passed: ok, passAt1: round(ok / list.length) }; }),
  };
}
/** The artifact level's pass rule (decision 1): a readable result that the separate checker passed. */
export function derivedArtifactPass(run: Pick<ArtifactRunV3, 'checker'>): boolean {
  return run.checker !== null && run.checker.result === 'read' && run.checker.artifact.passed;
}

function schemaIssue(error: z.ZodError, schema: string): BenchReportError {
  const issue = error.issues[0];
  return new BenchReportError(`report does not match ${schema}: ${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid'}`);
}

/** The rules /1 and /2 share: the plan, every run's verdicts and counters, and the summary. */
function checkRuns(report: BenchReportV1 | BenchReportV2): void {
  const mirror = report.environment.mirror;
  // The plan is checked arithmetically and never expanded: settings may name up to 1000 tasks ×
  // 1000 seeds × 1000 repeats, which must not become 10^9 keys in memory.
  const planned = report.settings.tasks.length * report.settings.seeds.length * report.settings.repeats;
  if (report.interrupted) {
    if (report.interrupted.plannedRuns !== planned || report.runs.length >= planned) throw new BenchReportError(`interrupted report holds ${report.runs.length} runs, but its settings plan ${planned}`);
    // A bench that stopped itself did so at its last run, an infra_error, of a task it names to resume.
    const stopped = 'stopped' in report.interrupted ? report.interrupted.stopped : undefined, last = report.runs.at(-1)!;
    if (stopped && (stopped.run !== last.id || last.status !== 'infra_error' || stopped.remaining[0] !== last.taskId || stopped.remaining.some(task => !report.settings.tasks.includes(task))))
      throw new BenchReportError(`the report says it stopped at run ${stopped.run}, which is not its last run, an infra_error, with the tasks it names to resume`);
  } else if (planned !== report.runs.length) throw new BenchReportError(`report has ${report.runs.length} runs, but its settings plan ${planned}`);
  const tasks = new Set<string>(report.settings.tasks), seeds = new Set<number>(report.settings.seeds);
  if (tasks.size !== report.settings.tasks.length || seeds.size !== report.settings.seeds.length) throw new BenchReportError('settings name a task or seed twice');
  const seen = new Set<string>(), ids = new Set<string>(), reference = new Map<string, number | null>();
  for (const run of report.runs as readonly BenchRun[]) {
    if ((reference.has(run.taskId) ? reference.get(run.taskId) : run.referenceActions) !== run.referenceActions) throw new BenchReportError(`run ${run.id} names another reference length for ${run.taskId}`);
    reference.set(run.taskId, run.referenceActions);
    const key = `${run.taskId}\u0000${run.seed}\u0000${run.repeat}`;
    if (!tasks.has(run.taskId) || !seeds.has(run.seed) || run.repeat > report.settings.repeats || seen.has(key)) throw new BenchReportError(`run ${run.id} is not one of the planned task × seed × repeat runs, or appears twice`);
    if (ids.has(run.id)) throw new BenchReportError(`run id ${run.id} appears twice`);
    seen.add(key); ids.add(run.id);
    if (run.status !== 'infra_error' && run.checker === null) throw new BenchReportError(`run ${run.id} has no independent checker verdict`);
    if (run.checker && mirror === 'required' && run.checker.native === null) throw new BenchReportError(`run ${run.id} lacks the native-export verdict a mirrored run requires`);
    if (run.checker && mirror === 'off' && run.checker.native !== null) throw new BenchReportError(`run ${run.id} claims a native-export verdict without a mirror`);
    if (run.pass !== derivedPass(run, mirror)) throw new BenchReportError(`run ${run.id} claims pass=${run.pass}, but its checker verdicts give pass=${derivedPass(run, mirror)}`);
    if (run.toolCalls.total !== run.toolCalls.observe + run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check) throw new BenchReportError(`run ${run.id} tool-call total does not add up`);
    if (run.toolCalls.act !== run.acceptedActions + run.rejectedActions) throw new BenchReportError(`run ${run.id}: act calls must equal accepted plus rejected actions`);
    // Every action in the final history was accepted once; undo and reset only remove entries.
    if (run.actions > run.acceptedActions) throw new BenchReportError(`run ${run.id}: the final history holds more actions than the host accepted`);
    if (run.artifacts && run.checker === null) throw new BenchReportError(`run ${run.id} binds artifacts but has no checker verdict`);
    if (run.artifacts && (run.artifacts.native === null) !== (run.checker?.native === null)) throw new BenchReportError(`run ${run.id}: native-export artifact and native verdict must appear together`);
  }
  const summary = summarize(report.runs as BenchRunV2[], report.settings.repeats);
  if (!isDeepStrictEqual(summary, report.summary)) throw new BenchReportError('summary does not follow from the runs');
}

/** Accept a /1 report only when it is well-formed and every derived value follows from its runs. */
export function validateBenchReportV1(raw: unknown): BenchReportV1 {
  const parsed = BenchReportSchemaV1.safeParse(raw);
  if (!parsed.success) throw schemaIssue(parsed.error, BENCH_SCHEMA_V1);
  checkRuns(parsed.data);
  return parsed.data;
}

/** The /2 rules on top of the shared ones: run names, the agent's derived fields, references and
 * generated-instance metadata that agree with the plan, and artifacts exactly for judged runs. */
export function validateBenchReportV2(raw: unknown): BenchReportV2 {
  const parsed = BenchReportSchemaV2.safeParse(raw);
  if (!parsed.success) throw schemaIssue(parsed.error, BENCH_SCHEMA_V2);
  const report = parsed.data, fail = (message: string): never => { throw new BenchReportError(message); };
  const planned = new Set(report.settings.tasks), folded = new Map<string, string>();
  for (const task of report.settings.tasks) {
    const other = folded.get(task.toLowerCase());
    if (other !== undefined && other !== task) fail(cliText('benchReportTaskCase', { a: other, b: task }));
    folded.set(task.toLowerCase(), task);
  }
  const agent = report.agent;
  if (agent.isolation !== ISOLATION_OF[agent.kind]) fail(cliText('benchReportIsolation', { kind: agent.kind, expected: ISOLATION_OF[agent.kind], given: agent.isolation }));
  if ((agent.model === null) !== (agent.modelSource === 'none')) fail(cliText('benchReportModelSource'));
  const field = (name: string): never => fail(cliText('benchReportAgentField', { kind: agent.kind, field: name }));
  if (agent.kind === 'builtin' && agent.command.length) field('command');
  if (agent.kind === 'builtin' && agent.apiKeySource !== null) field('apiKeySource');
  if (agent.modelSource === 'client-attested' && agent.kind !== 'preset') field('modelSource');
  if (agent.modelSource === 'command-output' && agent.kind !== 'command') field('modelSource');
  if (agent.keptEnv.length && agent.kind !== 'preset') field('keptEnv');
  if (new Set(agent.keptEnv).size !== agent.keptEnv.length) field('keptEnv');
  const world = report.environment.world, references = new Map<string, number>();
  for (const entry of report.references?.tasks ?? []) {
    if (!planned.has(entry.taskId) || references.has(entry.taskId)) fail(cliText('benchReportReferenceTask', { task: entry.taskId }));
    if (entry.source !== (world.source === 'library' ? 'library' : 'oracle-file')) fail(cliText('benchReportReferenceSource', { source: entry.source, world: world.source }));
    references.set(entry.taskId, entry.actions);
  }
  if (world.source === 'library') for (const task of report.settings.tasks) if (!references.has(task)) fail(cliText('benchReportLibraryReference', { task }));
  const generated = new Set<string>();
  for (const entry of world.generated) {
    if (!planned.has(entry.taskId) || generated.has(entry.taskId)) fail(cliText('benchReportGenerated', { task: entry.taskId }));
    generated.add(entry.taskId);
  }
  for (const run of report.runs) {
    const expected = `${run.taskId}-s${run.seed}-r${run.repeat}`;
    if (run.id !== expected) fail(cliText('benchReportRunId', { id: run.id, expected }));
    const reference = references.get(run.taskId) ?? null;
    if (run.referenceActions !== reference) fail(cliText('benchReportRunReference', { id: run.id, given: String(run.referenceActions), expected: String(reference) }));
    if ((run.checker !== null) !== (run.artifacts !== undefined)) fail(cliText('benchReportArtifacts', { id: run.id }));
    checkRunEvidence(report, run, fail);
  }
  checkRuns(report);
  return report;
}

/** The /2 evidence fields of one run (PADR-0039): a picture only with the mirror, a trace error only
 * without a trace, a mutation log that holds every counted act, undo and reset call, client timing
 * only from Practonaut's own client, client figures only from an external agent's own output; a
 * condition trace only beside the mutation log it is re-derived from. */
function checkRunEvidence(report: BenchReportV2, run: BenchRunV2, fail: (message: string) => never): void {
  const artifacts = run.artifacts, mirror = report.environment.mirror, kind = report.agent.kind;
  if (artifacts?.board !== undefined && artifacts.board !== null && mirror === 'off') fail(cliText('benchReportBoard', { id: run.id }));
  if (artifacts?.traceError !== undefined && artifacts.trace !== null) fail(cliText('benchReportTraceError', { id: run.id }));
  if (artifacts?.trace === null && artifacts.traceError === undefined) fail(cliText('benchReportTraceError', { id: run.id }));
  // A condition trace is re-derived at --verify from the session and the mutation log: without the log
  // it could not be checked, so it is not accepted at all.
  if (typeof artifacts?.trace === 'string' && !run.logs) fail(cliText('benchReportTraceWithoutLog', { id: run.id }));
  if (run.logs) {
    const calls = run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check;
    if (run.logs.mutations.entries + run.logs.mutations.omitted !== calls) fail(cliText('benchReportMutations', { id: run.id, entries: run.logs.mutations.entries + run.logs.mutations.omitted, calls }));
    if (run.logs.calls?.clientTiming && kind !== 'builtin') fail(cliText('benchReportClientTiming', { id: run.id }));
  }
  if (run.client && (kind === 'builtin' || run.client.source !== (kind === 'preset' ? 'client-attested' : 'command-output'))) fail(cliText('benchReportClient', { id: run.id, kind }));
}

/** The isolation a preset earns from its runs' evidence (decision 6): `tool-restricted-preset` only
 * when at least one run shows its tools within its servers, every judged run does, and no run shows a
 * tool outside; otherwise "template: not restricted". Built-ins and templates keep their kind's level. */
export function presetIsolation(kind: AgentV3['kind'], runs: ReadonlyArray<{ checker: unknown; isolation: { evidence: string } }>): IsolationLevel {
  if (kind !== 'preset') return ISOLATION_OF[kind];
  const within = (run: { isolation: { evidence: string } }): boolean => run.isolation.evidence === 'tools-within-servers';
  return runs.some(within) && runs.every(run => run.checker === null || within(run)) && !runs.some(run => run.isolation.evidence === 'tool-outside-servers') ? ISOLATION_OF.preset : ISOLATION_OF.command;
}

/** The /3 agent rules (decisions 5 and 6): each value with a source its kind allows, a value null
 * exactly when its source is `none`, billing requested only by a preset, isolation from the runs. */
function checkAgentV3(report: BenchReportV3, fail: (message: string) => never): void {
  const agent = report.agent, kind = agent.kind;
  const field = (name: string): never => fail(cliText('benchReportAgentField', { kind, field: name }));
  if ((agent.model === null) !== (agent.modelSource === 'none')) fail(cliText('benchReportModelSource'));
  if (kind === 'builtin' && agent.command.length) field('command');
  if (kind === 'builtin' && agent.apiKeySource !== null) field('apiKeySource');
  if (agent.modelSource === 'client-attested' && kind !== 'preset') field('modelSource');
  if (agent.modelSource === 'command-output' && kind !== 'command') field('modelSource');
  if (agent.keptEnv.length && kind !== 'preset') field('keptEnv');
  if (new Set(agent.keptEnv).size !== agent.keptEnv.length) field('keptEnv');
  for (const name of ['vendor', 'client', 'clientVersion', 'requestedModel'] as const) {
    const { value, source } = agent[name];
    if ((value === null) !== (source === 'none')) field(name);
    if ((source === 'client-attested' || source === 'preset-requested') && kind !== 'preset') field(name);
    if (source === 'command-output' && kind !== 'command') field(name);
  }
  if (agent.settings.length && kind !== 'preset') field('settings');
  if (new Set(agent.settings.map(setting => setting.name)).size !== agent.settings.length) field('settings');
  if ((agent.billing.source === 'preset-requested') !== (kind === 'preset') || (agent.billing.source === 'none' && agent.billing.class !== 'unknown')) field('billing');
  const expected = presetIsolation(kind, report.runs);
  if (agent.isolation !== expected) fail(cliText('benchReportIsolation', { kind, expected, given: agent.isolation }));
}

/** One /3 run's level-independent rules: isolation and its evidence, the stdout binding, the client
 * block, and the failure (decisions 5, 6 and 9). */
function checkRunBaseV3(report: BenchReportV3, run: BenchRunV3, fail: (message: string) => never): void {
  const kind = report.agent.kind, external = kind !== 'builtin', why = (rule: string): never => fail(cliText('benchReportRunRule', { id: run.id, rule }));
  if (run.verdictLevel !== report.verdictLevel) fail(cliText('benchReportRunLevel', { id: run.id, given: run.verdictLevel, expected: report.verdictLevel }));
  // Isolation: by kind for built-ins and templates; a preset's from its own evidence.
  const { level, evidence } = run.isolation;
  if (kind === 'preset' ? evidence === 'by-kind' || level !== (evidence === 'tools-within-servers' ? ISOLATION_OF.preset : ISOLATION_OF.command) : evidence !== 'by-kind' || level !== ISOLATION_OF[kind])
    fail(cliText('benchReportRunIsolation', { id: run.id, level, evidence, kind }));
  // The stdout binding: present exactly for external runs; null means nothing was derived from it.
  if (external !== (run.stdout !== undefined)) why('stdout');
  if (run.stdout === null && (run.client !== undefined || (kind === 'preset' && evidence !== 'no-evidence'))) why('stdout');
  if (run.client) {
    if (!external || run.client.source !== (kind === 'preset' ? 'client-attested' : 'command-output')) fail(cliText('benchReportClient', { id: run.id, kind }));
    if (kind !== 'preset' && (run.client.tools !== undefined || run.client.billing !== undefined)) why('client');
  } else if (external && run.stdout) why('client.parser');
  // A preset's evidence of tools within its servers rests on the tools its client listed.
  if (evidence === 'tools-within-servers' && (!run.client?.tools || run.client.tools.omitted > 0 || !run.client.tools.names.length)) why('isolation');
  if ((run.status === 'infra_error') !== (run.failure !== undefined)) why('failure');
  if (run.failure) {
    const { reason, parser, beforeModelWork } = run.failure;
    if ((parser !== null) !== PARSER_REASONS.has(reason)) why('failure.parser');
    if (parser !== null && !run.stdout) why('failure.parser');
    if (beforeModelWork === true && parser === null) why('failure.beforeModelWork');
  }
  if ((run.checker === null) !== (run.status === 'infra_error')) fail(cliText('benchReportRunRule', { id: run.id, rule: 'checker' }));
  if ((run.checker !== null) !== (run.artifacts !== undefined)) fail(cliText('benchReportArtifacts', { id: run.id }));
}

/** A /3 session run (decision 1 and 7): every /2 rule, the agent's own action count, the co-actor. */
function checkSessionRunV3(report: BenchReportV3, run: SessionRunV3, scheduled: ReadonlySet<string>, fail: (message: string) => never): void {
  const why = (rule: string): never => fail(cliText('benchReportRunRule', { id: run.id, rule }));
  const mirror = report.environment.mirror!;
  if (run.checker && mirror === 'required' && run.checker.native === null) fail(`run ${run.id} lacks the native-export verdict a mirrored run requires`);
  if (run.checker && mirror === 'off' && run.checker.native !== null) fail(`run ${run.id} claims a native-export verdict without a mirror`);
  if (run.pass !== derivedPass(run, mirror)) fail(`run ${run.id} claims pass=${run.pass}, but its checker verdicts give pass=${derivedPass(run, mirror)}`);
  if (run.toolCalls.total !== run.toolCalls.observe + run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check) fail(`run ${run.id} tool-call total does not add up`);
  if (run.toolCalls.act !== run.acceptedActions + run.rejectedActions) fail(`run ${run.id}: act calls must equal accepted plus rejected actions`);
  if (run.artifacts && (run.artifacts.native === null) !== (run.checker?.native === null)) fail(`run ${run.id}: native-export artifact and native verdict must appear together`);
  // Decision 7: the agent's actions in the final history; a co-actor's accepted actions make up the rest.
  if (run.agentActions > run.acceptedActions) fail(cliText('benchReportAgentActions', { id: run.id }));
  if (run.coActor === undefined ? run.agentActions !== run.actions : run.actions < run.agentActions || run.actions - run.agentActions > run.coActor.accepted) fail(cliText('benchReportAgentActions', { id: run.id }));
  if (run.coActor) {
    if (!scheduled.has(run.taskId)) why('coActor');
    if (run.coActor.fired !== run.coActor.accepted + run.coActor.rejected || run.coActor.fired > run.coActor.planned) why('coActor');
  } else if (scheduled.has(run.taskId)) why('coActor');
  if (run.failure?.reason === 'server_error') why('failure.reason');
  if (run.failure?.reason === 'evidence_incomplete' && !run.coActor) why('failure.reason');
  if (run.failure?.reason === 'no_tool_call' && run.toolCalls.total !== 0) why('failure.reason');
  const artifacts = run.artifacts, kind = report.agent.kind;
  if (artifacts?.board !== undefined && artifacts.board !== null && mirror === 'off') fail(cliText('benchReportBoard', { id: run.id }));
  if (artifacts?.traceError !== undefined && artifacts.trace !== null) fail(cliText('benchReportTraceError', { id: run.id }));
  if (artifacts?.trace === null && artifacts.traceError === undefined) fail(cliText('benchReportTraceError', { id: run.id }));
  if (typeof artifacts?.trace === 'string' && !run.logs) fail(cliText('benchReportTraceWithoutLog', { id: run.id }));
  if (run.logs) {
    const calls = run.toolCalls.act + run.toolCalls.undo + run.toolCalls.reset + run.toolCalls.check + (run.coActor?.fired ?? 0);
    if (run.logs.mutations.entries + run.logs.mutations.omitted !== calls) fail(cliText('benchReportMutations', { id: run.id, entries: run.logs.mutations.entries + run.logs.mutations.omitted, calls }));
    if (run.logs.calls?.clientTiming && kind !== 'builtin') fail(cliText('benchReportClientTiming', { id: run.id }));
  }
}

/** A /3 artifact run (decision 1): judged on the stored result or the start file, from a complete proxy log. */
function checkArtifactRunV3(report: BenchReportV3, run: ArtifactRunV3, fail: (message: string) => never): void {
  const why = (rule: string): never => fail(cliText('benchReportRunRule', { id: run.id, rule }));
  if (run.pass !== derivedArtifactPass(run)) fail(`run ${run.id} claims pass=${run.pass}, but its checker verdict gives pass=${derivedArtifactPass(run)}`);
  if (run.artifacts && run.checker && (run.artifacts.result === null) !== (run.checker.result === 'absent')) why('artifacts.result');
  if (run.checker !== null && run.proxyLog === null) why('proxyLog');
  if (run.proxy.calls > report.settings.maxActions) why('proxy.calls');
  if (run.failure?.reason === 'no_tool_call' && (run.proxy.starts !== 0 || run.proxy.calls !== 0)) why('failure.reason');
  if (run.failure?.reason === 'evidence_incomplete' && run.proxyLog !== null && run.checker !== null) why('failure.reason');
}

/** The /3 rules (PADR-0044): the plan and the summary as /1 and /2, one verdict level and the
 * toolchain of that level, the agent's evidenced identity, the instances of the runs, and per run the
 * rules of its level. */
export function validateBenchReportV3(raw: unknown): BenchReportV3 {
  const parsed = BenchReportSchemaV3.safeParse(raw);
  if (!parsed.success) throw schemaIssue(parsed.error, BENCH_SCHEMA_V3);
  const report = parsed.data, fail = (message: string): never => { throw new BenchReportError(message); };
  const level = report.verdictLevel, levelField = (name: string): never => fail(cliText('benchReportLevelField', { level, field: name }));
  const planned = new Set(report.settings.tasks), folded = new Map<string, string>();
  for (const task of report.settings.tasks) {
    const other = folded.get(task.toLowerCase());
    if (other !== undefined && other !== task) fail(cliText('benchReportTaskCase', { a: other, b: task }));
    folded.set(task.toLowerCase(), task);
  }
  // One level per report, and what that level has and has not (decision 1).
  if (report.toolchain.kind !== (level === 'session' ? 'practonaut' : 'foreign-mcp')) levelField('toolchain');
  if (report.toolchain.kind === 'practonaut' && new Set(report.toolchain.tools).size !== report.toolchain.tools.length) levelField('toolchain.tools');
  if (report.toolchain.kind === 'foreign-mcp' && new Set(report.toolchain.allowlist.map(entry => entry.tool)).size !== report.toolchain.allowlist.length) levelField('toolchain.allowlist');
  const world = report.environment.world;
  if (level === 'session' && report.environment.mirror === undefined) levelField('environment.mirror');
  if (level === 'artifact') {
    if (report.environment.mirror !== undefined) levelField('environment.mirror');
    if (report.settings.mirror !== 'off') levelField('settings.mirror');
    if (report.settings.checks !== undefined) levelField('settings.checks');
    if (world.limits !== undefined) levelField('environment.world.limits');
    if (world.scenarios !== undefined) levelField('environment.world.scenarios');
  }
  const scheduled = new Set<string>();
  for (const entry of world.scenarios ?? []) {
    if (!planned.has(entry.taskId) || scheduled.has(entry.taskId)) fail(cliText('benchReportGenerated', { task: entry.taskId }));
    scheduled.add(entry.taskId);
  }
  checkAgentV3(report, fail);
  const references = new Map<string, number>();
  for (const entry of report.references?.tasks ?? []) {
    if (!planned.has(entry.taskId) || references.has(entry.taskId)) fail(cliText('benchReportReferenceTask', { task: entry.taskId }));
    if (entry.source !== (world.source === 'library' ? 'library' : 'oracle-file')) fail(cliText('benchReportReferenceSource', { source: entry.source, world: world.source }));
    references.set(entry.taskId, entry.actions);
  }
  if (world.source === 'library') for (const task of report.settings.tasks) if (!references.has(task)) fail(cliText('benchReportLibraryReference', { task }));
  const generated = new Set<string>();
  for (const entry of world.generated) {
    if (!planned.has(entry.taskId) || generated.has(entry.taskId)) fail(cliText('benchReportGenerated', { task: entry.taskId }));
    generated.add(entry.taskId);
  }
  checkPlanV3(report, fail);
  for (const run of report.runs) {
    const expected = `${run.taskId}-s${run.seed}-r${run.repeat}`;
    if (run.id !== expected) fail(cliText('benchReportRunId', { id: run.id, expected }));
    const reference = references.get(run.taskId) ?? null;
    if (run.referenceActions !== reference) fail(cliText('benchReportRunReference', { id: run.id, given: String(run.referenceActions), expected: String(reference) }));
    checkRunBaseV3(report, run, fail);
    if (run.verdictLevel === 'session') checkSessionRunV3(report, run, scheduled, fail);
    else checkArtifactRunV3(report, run, fail);
  }
  // The instances are exactly the runs' task-and-seed pairs, in plan order (decision 3).
  const order = report.settings.tasks.flatMap(task => report.settings.seeds.map(value => `${task}\u0000${value}`));
  const ran = new Set(report.runs.map(run => `${run.taskId}\u0000${run.seed}`));
  const listed = report.instances.map(entry => `${entry.taskId}\u0000${entry.seed}`);
  if (!isDeepStrictEqual(listed, order.filter(key => ran.has(key)))) fail(cliText('benchReportInstances'));
  const summary = level === 'session'
    ? summarize(report.runs as SessionRunV3[], report.settings.repeats, run => run.agentActions)
    : summarizeArtifact(report.runs as ArtifactRunV3[], report.settings.repeats);
  if (!isDeepStrictEqual(summary, report.summary)) fail('summary does not follow from the runs');
  return report;
}

/** The plan rules /1, /2 and /3 share: planned runs, interruption, unique ids, one reference length per task. */
function checkPlanV3(report: BenchReportV3, fail: (message: string) => never): void {
  const planned = report.settings.tasks.length * report.settings.seeds.length * report.settings.repeats;
  if (report.interrupted) {
    if (report.interrupted.plannedRuns !== planned || report.runs.length >= planned) fail(`interrupted report holds ${report.runs.length} runs, but its settings plan ${planned}`);
    const stopped = report.interrupted.stopped, last = report.runs.at(-1)!;
    if (stopped && (stopped.run !== last.id || last.status !== 'infra_error' || stopped.remaining[0] !== last.taskId || stopped.remaining.some(task => !report.settings.tasks.includes(task))))
      fail(`the report says it stopped at run ${stopped.run}, which is not its last run, an infra_error, with the tasks it names to resume`);
  } else if (planned !== report.runs.length) fail(`report has ${report.runs.length} runs, but its settings plan ${planned}`);
  const tasks = new Set<string>(report.settings.tasks), seeds = new Set<number>(report.settings.seeds);
  if (tasks.size !== report.settings.tasks.length || seeds.size !== report.settings.seeds.length) fail('settings name a task or seed twice');
  const seen = new Set<string>(), ids = new Set<string>(), reference = new Map<string, number | null>();
  for (const run of report.runs) {
    if ((reference.has(run.taskId) ? reference.get(run.taskId) : run.referenceActions) !== run.referenceActions) fail(`run ${run.id} names another reference length for ${run.taskId}`);
    reference.set(run.taskId, run.referenceActions);
    const key = `${run.taskId}\u0000${run.seed}\u0000${run.repeat}`;
    if (!tasks.has(run.taskId) || !seeds.has(run.seed) || run.repeat > report.settings.repeats || seen.has(key)) fail(`run ${run.id} is not one of the planned task × seed × repeat runs, or appears twice`);
    if (ids.has(run.id)) fail(`run id ${run.id} appears twice`);
    seen.add(key); ids.add(run.id);
  }
}

/** Reads every version by its `schema` field; anything else is refused naming them. */
export function validateBenchReport(raw: unknown): BenchReport {
  const schema = raw !== null && typeof raw === 'object' ? (raw as { schema?: unknown }).schema : undefined;
  if (schema === BENCH_SCHEMA_V1) return validateBenchReportV1(raw);
  if (schema === BENCH_SCHEMA_V2) return validateBenchReportV2(raw);
  if (schema === BENCH_SCHEMA_V3) return validateBenchReportV3(raw);
  throw new BenchReportError(cliText('benchReportSchemaUnknown', { schemas: [BENCH_SCHEMA_V1, BENCH_SCHEMA_V2, BENCH_SCHEMA_V3].join(', ') }));
}
export const isBenchReportV2 = (report: BenchReport): report is BenchReportV2 => report.schema === BENCH_SCHEMA_V2;
export const isBenchReportV3 = (report: BenchReport): report is BenchReportV3 => report.schema === BENCH_SCHEMA_V3;

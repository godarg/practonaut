/**
 * The read-only view every consumer reads a bench report through (PADR-0044 decision 10): one shape
 * for `practonaut.bench/1`, `/2` and `/3`, with `readFrom` naming the source version. It is built in
 * memory from a validated report and never written to disk; nothing in it is evidence that the source
 * did not record. Unchanged leaf values are copied; /1's and /2's `environment.excalidraw` becomes
 * `environment.app` and /1's `environment.library` becomes `environment.world` (moved); the facts the
 * old formats fix are stated (verdict level `session`, toolchain `practonaut`); `agentActions` is the
 * final history's `actions` (derived); everything else the old formats did not record says so
 * (`null`, `'not-recorded'`, source `none`, billing `unknown`).
 */
import {
  BENCH_SCHEMA_V1, BENCH_SCHEMA_V2, BENCH_SCHEMA_V3, ISOLATION_OF,
  type AgentV3, type ArtifactRunV3, type ArtifactSummary, type BenchReport, type BenchReportV1, type BenchReportV2, type BenchReportV3,
  type BenchSummaryV2, type ForeignToolchain, type IsolationEvidence, type IsolationLevel, type RunClientV3, type RunFailure, type SessionRunV3,
} from './report.ts';

export type ReadFrom = typeof BENCH_SCHEMA_V1 | typeof BENCH_SCHEMA_V2 | typeof BENCH_SCHEMA_V3;
/** A run's isolation: /1 did not record it (`level: null`, `not-recorded`); /2 had it by kind. */
export interface ViewIsolation { level: IsolationLevel | null; evidence: IsolationEvidence | 'not-recorded' }
/** A run's client figures; `parser` only where /3 recorded which parser read them. */
export type ViewClient = Omit<RunClientV3, 'parser'> & { parser?: string };
export type ViewSessionRun = Omit<SessionRunV3, 'isolation' | 'failure' | 'client'> & {
  isolation: ViewIsolation;
  /** `not-recorded`: an `infra_error` run of a /1 or /2 report (its note is shown as before). */
  failure?: RunFailure | 'not-recorded' | undefined;
  client?: ViewClient | undefined;
};
export type ViewArtifactRun = Omit<ArtifactRunV3, 'isolation' | 'failure'> & { isolation: ViewIsolation; failure?: RunFailure | 'not-recorded' | undefined };
export type ViewRun = ViewSessionRun | ViewArtifactRun;
type WorldV2 = BenchReportV2['environment']['world'];
/** The world as a report binds it; /1 named the bundled library without a stored package (`null`). */
export type ViewWorld = Omit<WorldV2, 'package'> & { package: WorldV2['package'] | null; scenarios?: Array<{ taskId: string; schedule: string }> | undefined };
export interface ViewEnvironment {
  practonaut: string; node: string; os: { platform: string; release: string; arch: string };
  app: { adapterId: string; version: string };
  mirror?: 'required' | 'off' | undefined;
  world: ViewWorld;
}
/** /1 and /2 did not record the tool names the bridge advertised (`tools: null`). */
export type ViewToolchain = { kind: 'practonaut'; id: 'practonaut'; tools: string[] | null } | ForeignToolchain;
export type ViewAgent = Omit<AgentV3, 'isolation' | 'keptEnv' | 'apiKeySource'> & {
  /** null: not recorded (/1). */
  isolation: IsolationLevel | null;
  /** null: not recorded (/1). */
  keptEnv: string[] | null;
  apiKeySource: string | null;
};
interface ViewBase {
  readFrom: ReadFrom;
  createdAt: string; label?: string | undefined; recovered?: true | undefined; interrupted?: BenchReportV2['interrupted'] | undefined;
  toolchain: ViewToolchain;
  /** null: not recorded (/1, /2). */
  instances: Array<{ taskId: string; seed: number; identity: string }> | null;
  agent: ViewAgent;
  settings: BenchReportV2['settings'];
  /** `not-recorded`: /1 had no references block (its library's solutions were implied). */
  references: BenchReportV2['references'] | 'not-recorded';
}
export interface SessionReportView extends ViewBase { verdictLevel: 'session'; environment: ViewEnvironment & { mirror: 'required' | 'off' }; summary: BenchSummaryV2; runs: ViewSessionRun[] }
export interface ArtifactReportView extends ViewBase { verdictLevel: 'artifact'; environment: ViewEnvironment; summary: ArtifactSummary; runs: ViewArtifactRun[] }
export type BenchReportView = SessionReportView | ArtifactReportView;

const NONE = Object.freeze({ value: null, source: 'none' as const });
const none = (): { value: null; source: 'none' } => ({ ...NONE });
/** New /3 agent fields an older report did not record; `clientVersion` from a /2 run's own client block. */
function unrecordedAgentFields(clientVersion: AgentV3['clientVersion']): Pick<AgentV3, 'vendor' | 'client' | 'clientVersion' | 'requestedModel' | 'settings' | 'billing'> {
  return { vendor: none(), client: none(), clientVersion, requestedModel: none(), settings: [], billing: { class: 'unknown', source: 'none' } };
}
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => value === undefined ? {} : { [key]: value } as Record<K, V>;

function fromV1(report: BenchReportV1): SessionReportView {
  const r = structuredClone(report), e = r.environment;
  const isolation: ViewIsolation = { level: null, evidence: 'not-recorded' };
  return {
    readFrom: BENCH_SCHEMA_V1, createdAt: r.createdAt, verdictLevel: 'session',
    ...optional('interrupted', r.interrupted),
    environment: {
      practonaut: e.practonaut, node: e.node, os: e.os, app: { adapterId: 'excalidraw', version: e.excalidraw }, mirror: e.mirror,
      world: { source: 'library', worldId: e.library.worldId, version: e.library.version, contentHash: e.library.contentHash, package: null, generated: [] },
    },
    toolchain: { kind: 'practonaut', id: 'practonaut', tools: null },
    instances: null,
    agent: { ...r.agent, isolation: null, apiKeySource: null, keptEnv: null, ...unrecordedAgentFields(none()) },
    settings: r.settings, references: 'not-recorded', summary: r.summary,
    runs: r.runs.map(run => ({ verdictLevel: 'session', ...run, isolation: { ...isolation }, agentActions: run.actions, ...(run.status === 'infra_error' ? { failure: 'not-recorded' as const } : {}) })),
  };
}

function fromV2(report: BenchReportV2): SessionReportView {
  const r = structuredClone(report), e = r.environment;
  // A /2 report's isolation followed from the agent's kind; a /2 preset's is shown as such (by-kind).
  const isolation: ViewIsolation = { level: r.agent.isolation, evidence: 'by-kind' };
  const first = r.runs.find(run => typeof run.client?.version === 'string')?.client;
  const clientVersion: AgentV3['clientVersion'] = first?.version ? { value: first.version, source: first.source } : none();
  return {
    readFrom: BENCH_SCHEMA_V2, createdAt: r.createdAt, verdictLevel: 'session',
    ...optional('label', r.label), ...optional('recovered', r.recovered), ...optional('interrupted', r.interrupted),
    environment: { practonaut: e.practonaut, node: e.node, os: e.os, app: { adapterId: 'excalidraw', version: e.excalidraw }, mirror: e.mirror, world: e.world },
    toolchain: { kind: 'practonaut', id: 'practonaut', tools: null },
    instances: null,
    agent: { ...r.agent, ...unrecordedAgentFields(clientVersion) },
    settings: r.settings, references: r.references, summary: r.summary,
    runs: r.runs.map(run => ({ verdictLevel: 'session', ...run, isolation: { ...isolation }, agentActions: run.actions, ...(run.status === 'infra_error' ? { failure: 'not-recorded' as const } : {}) })),
  };
}

function fromV3(report: BenchReportV3): BenchReportView {
  const { schema, ...r } = structuredClone(report);
  // The validator guarantees one level for the report, its runs, its toolchain and its summary.
  if (r.verdictLevel === 'session') return { ...r, readFrom: schema, verdictLevel: 'session', environment: { ...r.environment, mirror: r.environment.mirror! }, toolchain: r.toolchain, summary: r.summary as BenchSummaryV2, runs: r.runs as SessionRunV3[] };
  return { ...r, readFrom: schema, verdictLevel: 'artifact', toolchain: r.toolchain, summary: r.summary as ArtifactSummary, runs: r.runs as ArtifactRunV3[] };
}

/** The view of a validated report of any version; a fresh copy, so nothing a consumer does reaches the source. */
export function toView(report: BenchReport): BenchReportView {
  if (report.schema === BENCH_SCHEMA_V1) return fromV1(report);
  if (report.schema === BENCH_SCHEMA_V2) return fromV2(report);
  return fromV3(report);
}

/** What a consumer accepts: a validated source report or its view; either is read through the view. */
export type ReportInput = BenchReport | BenchReportView;
export const asView = (input: ReportInput): BenchReportView => 'readFrom' in input ? input : toView(input);
export const isSessionView = (view: BenchReportView): view is SessionReportView => view.verdictLevel === 'session';
/** The isolation level a report shows: as recorded, else (/1) from the agent's kind, as /1 consumers always did. */
export const isolationOfView = (view: BenchReportView): IsolationLevel => view.agent.isolation ?? ISOLATION_OF[view.agent.kind];
/** Whether the report's isolation rests on the agent's kind or on its runs' evidence (decision 6). */
export const isolationBasis = (view: BenchReportView): 'kind' | 'evidence' => view.agent.kind === 'preset' && view.readFrom === BENCH_SCHEMA_V3 ? 'evidence' : 'kind';
/** The file name of a session run's native export: named per adapter (decision 1). */
export const nativeFileOf = (view: Pick<BenchReportView, 'environment'>): string => `native.${view.environment.app.adapterId}`;

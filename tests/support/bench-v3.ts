// Hand-built practonaut.bench/3 reports for the validator, view and compare tests: one at session level
// (a command template, one run per instance by default) and one at artifact level (a foreign MCP
// toolchain). Every value is written out here; the summary is the only derived part, and the validator
// re-derives it independently of this builder's caller.
import { BENCH_SCHEMA_V3, summarize, summarizeArtifact, type ArtifactRunV3, type BenchReportV3, type SessionRunV3 } from '../../src/bench/report.ts';

export const hash = (c: string): string => c.repeat(64);
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const agentTemplate = (): BenchReportV3['agent'] => ({
  kind: 'command', name: 'generic', command: ['agent', '{mcp_config}'], isolation: 'template-unrestricted', model: 'model-a', modelSource: 'command-output', apiKeySource: null, keptEnv: [],
  vendor: { value: null, source: 'none' }, client: { value: null, source: 'none' }, clientVersion: { value: null, source: 'none' }, requestedModel: { value: null, source: 'none' },
  settings: [], billing: { class: 'unknown', source: 'none' },
});
const environment = (mirror?: 'off' | 'required', worldId = 'my-world', contentHash = hash('d'), adapterId = 'excalidraw'): BenchReportV3['environment'] => ({
  practonaut: '0.3.0-dev.0', node: 'v22.22.3', os: { platform: 'linux', release: '6.8.0', arch: 'x64' }, app: { adapterId, version: '0.18.1' },
  ...(mirror ? { mirror } : {}), world: { source: 'own', worldId, version: '1.0.0', contentHash, package: { path: 'world.pnworld', sha256: hash('e') }, generated: [] },
});

/** A session-level run of a command template: one accepted action, judged or not. */
export function sessionRun(taskId: string, seed: number, repeat: number, verdict: boolean | null): SessionRunV3 {
  const checker = verdict === null ? null : { session: { passed: verdict, errorClasses: verdict ? [] : ['extra-arrow'] }, native: null };
  return {
    verdictLevel: 'session', id: `${taskId}-s${seed}-r${repeat}`, taskId, seed, repeat, status: verdict === null ? 'infra_error' : 'completed', pass: verdict === true,
    referenceActions: null, wallMs: 100, agentExitCode: verdict === null ? null : 0, isolation: { level: 'template-unrestricted', evidence: 'by-kind' },
    stdout: { sha256: hash('9'), bytes: 120 }, client: { source: 'command-output', model: 'model-a', turns: null, costUsd: null, tokens: null, parser: 'claude-code-stream/1' },
    ...(verdict === null ? { failure: { reason: 'runner', parser: null, code: null, beforeModelWork: null }, note: 'fixture: not judged' } : {}),
    actions: 1, acceptedActions: 1, rejectedActions: 0, undos: 0, resets: 0, toolCalls: { observe: 1, act: 1, undo: 0, reset: 0, check: 0, total: 2 },
    checker, ...(checker ? { artifacts: { session: hash('a'), native: null, checker: hash('c') } } : {}), agentActions: 1,
  };
}

/** A session-level report: `outcomes[task][seed]` lists each repeat's verdict (null: not judged);
 * `identities[task][seed]` the instance's identity (default: one per instance). */
export function sessionReport(outcomes: Record<string, Record<number, Array<boolean | null>>>, options: { identities?: Record<string, Record<number, string>>; worldId?: string; contentHash?: string; adapterId?: string; change?: (value: Mutable<BenchReportV3>) => void } = {}): BenchReportV3 {
  const tasks = Object.keys(outcomes), seeds = [...new Set(tasks.flatMap(task => Object.keys(outcomes[task]!).map(Number)))].sort((a, b) => a - b);
  const repeats = Math.max(...tasks.flatMap(task => seeds.map(seed => outcomes[task]![seed]?.length ?? 0)));
  const runs = tasks.flatMap(taskId => seeds.flatMap(seed => (outcomes[taskId]![seed] ?? []).map((verdict, index) => sessionRun(taskId, seed, index + 1, verdict))));
  const identity = (taskId: string, seed: number): string => options.identities?.[taskId]?.[seed] ?? hash(String((tasks.indexOf(taskId) * 7 + seed) % 10));
  const value: Mutable<BenchReportV3> = {
    schema: BENCH_SCHEMA_V3, createdAt: '2026-10-18T12:00:00.000Z', verdictLevel: 'session',
    environment: environment('off', options.worldId, options.contentHash, options.adapterId),
    toolchain: { kind: 'practonaut', id: 'practonaut', tools: ['observe', 'list_actions', 'act', 'undo', 'reset', 'explain_result', 'check_result'] },
    instances: tasks.flatMap(taskId => seeds.filter(seed => (outcomes[taskId]![seed] ?? []).length).map(seed => ({ taskId, seed, identity: identity(taskId, seed) }))),
    agent: agentTemplate(),
    settings: { tasks, seeds, repeats, timeoutSeconds: 300, maxActions: 50, mirror: 'off', prompt: 'p' },
    references: null, runs, summary: summarize(runs, repeats, run => run.agentActions),
  };
  options.change?.(value);
  value.summary = value.verdictLevel === 'session' ? summarize(value.runs as SessionRunV3[], value.settings.repeats, run => run.agentActions) : summarizeArtifact(value.runs as ArtifactRunV3[], value.settings.repeats);
  return value;
}

/** An artifact-level run: judged on the stored result (`read`), on the start file (`absent`), or not judged. */
export function artifactRun(taskId: string, seed: number, repeat: number, outcome: 'pass' | 'fail' | 'absent' | null): ArtifactRunV3 {
  const judged = outcome !== null;
  return {
    verdictLevel: 'artifact', id: `${taskId}-s${seed}-r${repeat}`, taskId, seed, repeat, status: judged ? 'completed' : 'infra_error', pass: outcome === 'pass',
    referenceActions: null, wallMs: 1000, agentExitCode: judged ? 0 : null, isolation: { level: 'template-unrestricted', evidence: 'by-kind' },
    stdout: { sha256: hash('8'), bytes: 300 }, client: { source: 'command-output', model: null, turns: null, costUsd: null, tokens: null, parser: 'claude-code-stream/1' },
    ...(judged ? {} : { failure: { reason: 'server_error', parser: null, code: null, beforeModelWork: null } }),
    checker: judged ? { artifact: { passed: outcome === 'pass', errorClasses: outcome === 'pass' ? [] : ['unchanged-start'] }, result: outcome === 'absent' ? 'absent' : 'read' } : null,
    proxy: { starts: judged ? 1 : 0, calls: judged ? 3 : 0, refused: 0 },
    ...(judged ? { artifacts: { start: hash('b'), result: outcome === 'absent' ? null : hash('c'), reading: hash('d'), checker: hash('e') } } : {}),
    proxyLog: judged ? { sha256: hash('f'), entries: 5 } : null,
  };
}

/** An artifact-level report of a command template on a foreign MCP toolchain. */
export function artifactReport(outcomes: Record<string, Record<number, Array<'pass' | 'fail' | 'absent' | null>>> = { flow: { 1: ['pass'], 2: ['absent'] } }, change?: (value: Mutable<BenchReportV3>) => void): BenchReportV3 {
  const tasks = Object.keys(outcomes), seeds = [...new Set(tasks.flatMap(task => Object.keys(outcomes[task]!).map(Number)))].sort((a, b) => a - b);
  const repeats = Math.max(...tasks.flatMap(task => seeds.map(seed => outcomes[task]![seed]?.length ?? 0)));
  const runs = tasks.flatMap(taskId => seeds.flatMap(seed => (outcomes[taskId]![seed] ?? []).map((outcome, index) => artifactRun(taskId, seed, index + 1, outcome))));
  const value: Mutable<BenchReportV3> = {
    schema: BENCH_SCHEMA_V3, createdAt: '2026-10-18T12:00:00.000Z', verdictLevel: 'artifact',
    environment: environment(undefined),
    toolchain: {
      kind: 'foreign-mcp', id: 'excalidraw-mcp-0.3.2',
      server: { name: 'excalidraw-mcp', version: '0.3.2', source: 'https://registry.example.org/excalidraw-mcp/-/excalidraw-mcp-0.3.2.tgz', archiveSha256: hash('1') },
      proxy: { name: 'excalidraw' }, startDelivery: 'server-store', locator: { field: 'structuredContent.checkpointId', select: 'last-ok' },
      rules: { format: 'excalidraw-mcp-store', version: '1.0.0' }, allowlist: [{ tool: 'create_view', effect: 'run-store' }, { tool: 'read_checkpoint', effect: 'run-store' }],
    },
    instances: tasks.flatMap(taskId => seeds.filter(seed => (outcomes[taskId]![seed] ?? []).length).map(seed => ({ taskId, seed, identity: hash(String(seed % 10)) }))),
    agent: agentTemplate(),
    settings: { tasks, seeds, repeats, timeoutSeconds: 600, maxActions: 50, mirror: 'off', prompt: 'p' },
    references: null, runs, summary: summarizeArtifact(runs, repeats),
  };
  change?.(value);
  value.summary = summarizeArtifact(value.runs as ArtifactRunV3[], value.settings.repeats);
  return value;
}

// Versioned measurement tool for the agent surface (roadmap 0.2.0, "Measurement rules for this
// release"). It drives a real `practonaut mcp` server as an instrumented MCP client and measures
// what an agent pays: the client-observed round trip of every `tools/call`, the full serialized
// `tools/call` result (every content part and `structuredContent`), and the cumulative result bytes
// of an episode. The same tool measures a published version (`npx -y practonaut@<version>`) and the
// local build (`dist/`), so before/after numbers come from one instrument.
//
//   node tools/measure-agent-surface.ts --server 0.1.0|local [--mirror required|off]
//        [--latency] [--warmup 8] [--calls 72] [--call-log]
//        [--episodes decision,restyle-flow,… --seeds 1,2 [--list-actions]] [--out <file.json>]
//
// Host processing time (`latencyMs` in act replies) and, when the server writes one, the bridge's
// call log are reported alongside and labelled as such; they are not the latency measure.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { arch, cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { StdioMcpClient, type McpServerEntry } from '../src/bench/mcp-client.ts';
import { loadLibrary } from '../src/library/index.ts';
import { substituteTokens, variantIndex, variantTokens } from '../src/world/variant.ts';
import type { OracleParam } from '../src/authoring/from-scenes.ts';
import type { Scalar } from '../src/world/types.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface Sample { tool: string; ms: number; resultBytes: number; textBytes: number; ok: boolean; hostLatencyMs?: number }
export interface Stats { n: number; median: number; p90: number; max: number }

/** Linear-interpolated quantile (the usual "type 7"), on a copy. */
export function quantile(values: readonly number[], q: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * q, low = Math.floor(position), high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}
export function stats(values: readonly number[]): Stats {
  return { n: values.length, median: round(quantile(values, 0.5)), p90: round(quantile(values, 0.9)), max: round(Math.max(...values)) };
}
const round = (value: number): number => Math.round(value * 10) / 10;

/** The reply's JSON value: `structuredContent` when present, else the JSON in the first text part. */
export function replyValue(result: unknown): { ok?: boolean; value?: Record<string, unknown>; error?: { code?: string } } {
  const r = result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };
  if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent as ReturnType<typeof replyValue>;
  const text = r.content?.find(part => part.type === 'text')?.text ?? '';
  try { return JSON.parse(text) as ReturnType<typeof replyValue>; } catch { return {}; }
}
/** Step and revision from an act/undo/reset reply of either surface (0.1.0 nests them in `view`). */
export function position(value: Record<string, unknown> | undefined): { step: number; revision: number } {
  const source = (value?.view ?? value) as { step?: unknown; revision?: unknown } | undefined;
  return { step: Number(source?.step), revision: Number(source?.revision) };
}
/** Ids an action created: `created` on the compact surface, else the new keys of `view.state.objects`. */
export function createdIds(value: Record<string, unknown> | undefined, before: ReadonlySet<string>): string[] {
  if (Array.isArray(value?.created)) return (value.created as unknown[]).map(String);
  const objects = ((value?.view as { state?: { objects?: Record<string, unknown> } } | undefined)?.state?.objects) ?? {};
  return Object.keys(objects).filter(id => !before.has(id));
}

function serverEntry(server: string, task: string, seed: number, mirror: string, callLog?: string): McpServerEntry {
  const args = ['mcp', '--task', task, '--seed', String(seed), '--mirror', mirror, ...(callLog ? ['--call-log', callLog] : [])];
  if (server === 'local') return { command: process.execPath, args: [join(ROOT, 'dist', 'cli', 'main.js'), ...args] };
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(server)) throw new Error(`--server is local or a published version, not ${server}`);
  return { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['-y', `practonaut@${server}`, ...args] };
}

class Probe {
  readonly samples: Sample[] = [];
  readonly client: StdioMcpClient; readonly startMs: number;
  private constructor(client: StdioMcpClient, startMs: number) { this.client = client; this.startMs = startMs; }
  static async start(entry: McpServerEntry, home: string): Promise<Probe> {
    const started = performance.now();
    const client = await StdioMcpClient.start(entry, { cwd: home, env: { ...process.env, PRACTONAUT_HOME: home } });
    return new Probe(client, performance.now() - started);
  }
  async raw(method: string, params: object): Promise<{ result: unknown; ms: number }> {
    const started = performance.now();
    const result = await this.client.request(method, params);
    return { result, ms: performance.now() - started };
  }
  /** One timed `tools/call`; the size is the whole serialized result. */
  async call(tool: string, args: object, record = true): Promise<{ value: ReturnType<typeof replyValue>; sample: Sample }> {
    const { result, ms } = await this.raw('tools/call', { name: tool, arguments: args });
    const value = replyValue(result);
    const text = (result as { content?: Array<{ type: string; text?: string }> }).content?.filter(part => part.type === 'text').map(part => part.text ?? '').join('') ?? '';
    const latency = (value.value as { latencyMs?: unknown } | undefined)?.latencyMs;
    const sample: Sample = { tool, ms, resultBytes: Buffer.byteLength(JSON.stringify(result)), textBytes: Buffer.byteLength(text), ok: value.ok === true, ...(typeof latency === 'number' ? { hostLatencyMs: latency } : {}) };
    if (record) this.samples.push(sample);
    return { value, sample };
  }
  close(): Promise<void> { return this.client.close(); }
}

const objectsOf = (value: Record<string, unknown> | undefined): Record<string, { id: string; type: string; deleted?: boolean; x?: number; y?: number }> =>
  ((value as { state?: { objects?: Record<string, never> } } | undefined)?.state?.objects) ?? {};

/** Latency and reply sizes on one task: 8 warm-up and 72 measured `move_step` calls, alternating x. */
async function latency(server: string, mirror: string, warmup: number, calls: number, home: string, withCallLog: boolean): Promise<object> {
  const callLog = withCallLog ? join(home, 'calls.jsonl') : undefined;
  const probe = await Probe.start(serverEntry(server, 'excalidraw/connect', 42, mirror, callLog), home);
  try {
    const tools = await probe.raw('tools/list', {});
    const observed = await probe.call('observe', {});
    const listActions = await probe.call('list_actions', {});
    const objects = objectsOf(observed.value.value);
    const target = Object.values(objects).find(object => object.type === 'step' && !object.deleted);
    if (!target) throw new Error('no step to move');
    let { step, revision } = position(observed.value.value);
    const acts: Sample[] = [];
    for (let k = 0; k < warmup + calls; k++) {
      const x = (target.x ?? 0) + (k % 2 === 0 ? 10 : 0);
      const { value, sample } = await probe.call('act', { name: 'move_step', params: { id: target.id, x, y: target.y ?? 0 }, baseStep: step, expectedRevision: revision }, k >= warmup);
      if (!value.ok) throw new Error(`act ${k} rejected: ${value.error?.code}`);
      ({ step, revision } = position(value.value));
      if (k >= warmup) acts.push(sample);
    }
    const check = await probe.call('check_result', { expectedRevision: revision });
    const observedAfter = await probe.call('observe', {});
    const growth = acts.length > 1 ? (acts.at(-1)!.textBytes - acts[0]!.textBytes) / (acts.length - 1) : 0;
    const bridge = callLog && existsSync(callLog) ? readFileSync(callLog, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { tool: string; bridgeMs: number }).filter(entry => entry.tool === 'act').slice(warmup).map(entry => entry.bridgeMs) : [];
    return {
      startMs: Math.round(probe.startMs), toolsListBytes: Buffer.byteLength(JSON.stringify(tools.result)),
      observe: { resultBytes: observed.sample.resultBytes, textBytes: observed.sample.textBytes, afterActs: { resultBytes: observedAfter.sample.resultBytes, textBytes: observedAfter.sample.textBytes } },
      listActions: { resultBytes: listActions.sample.resultBytes },
      act: {
        clientRoundTripMs: stats(acts.map(sample => sample.ms)),
        hostProcessingMs: acts.every(sample => sample.hostLatencyMs !== undefined) ? stats(acts.map(sample => sample.hostLatencyMs!)) : 'not reported',
        bridgeProcessingMs: bridge.length ? stats(bridge) : 'not reported (no call log)',
        resultBytes: stats(acts.map(sample => sample.resultBytes)), textBytes: { first: acts[0]?.textBytes, last: acts.at(-1)?.textBytes, growthPerAct: round(growth) },
      },
      checkResult: { resultBytes: check.sample.resultBytes },
    };
  } finally { await probe.close(); }
}

/** One oracle episode on a library task: observe, the reference solution, check_result. */
async function episode(server: string, mirror: string, task: string, seed: number, home: string, listActions: boolean): Promise<object> {
  const { world, library } = loadLibrary();
  const entry = library.tasks.find(value => value.id === task);
  if (!entry) throw new Error(`unknown library task ${task}`);
  const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
  const probe = await Probe.start(serverEntry(server, `excalidraw/${task}`, seed, mirror), home);
  try {
    const observed = await probe.call('observe', {});
    // An agent that reads the parameter contracts once pays for list_actions too (0.1.0 put them in observe).
    if (listActions) await probe.call('list_actions', {});
    let { step, revision } = position(observed.value.value);
    let known = new Set(Object.keys(objectsOf(observed.value.value)));
    const created: string[] = [];
    for (const [index, action] of entry.oracle.steps.entries()) {
      const params: Record<string, Scalar> = {};
      for (const [key, value] of Object.entries(action.params) as Array<[string, OracleParam]>) params[key] = value !== null && typeof value === 'object' ? created[value.created] ?? '' : typeof value === 'string' ? substituteTokens(value, tokens) : value;
      const { value } = await probe.call('act', { name: action.name, params, baseStep: step, expectedRevision: revision });
      if (!value.ok) throw new Error(`${task} seed ${seed}: oracle action ${index} rejected: ${value.error?.code}`);
      ({ step, revision } = position(value.value));
      created[index] = createdIds(value.value, known)[0] ?? '';
      known = new Set([...known, ...createdIds(value.value, known)]);
    }
    const check = await probe.call('check_result', { expectedRevision: revision });
    const passed = (check.value.value as { passed?: unknown } | undefined)?.passed === true;
    const bytes = probe.samples.reduce((sum, sample) => sum + sample.resultBytes, 0);
    return { task, seed, actions: entry.oracle.steps.length, passed, calls: probe.samples.length, resultBytes: bytes, byTool: Object.fromEntries(['observe', 'list_actions', 'act', 'check_result'].map(tool => [tool, probe.samples.filter(sample => sample.tool === tool).reduce((sum, sample) => sum + sample.resultBytes, 0)])) };
  } finally { await probe.close(); }
}

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function main(args: string[]): Promise<void> {
  const server = option(args, '--server', 'local')!, mirror = option(args, '--mirror', 'required')!;
  const out: Record<string, unknown> = {
    tool: 'tools/measure-agent-surface.ts', measuredAt: new Date().toISOString(), server, mirror,
    machine: { platform: platform(), release: release(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', node: process.version },
    // The commit only says something about the local build; a published version is named by `server`.
    ...(server === 'local' ? { git: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || null } : {}),
  };
  const home = mkdtempSync(join(tmpdir(), 'pn-measure-'));
  try {
    if (args.includes('--latency')) out.latency = await latency(server, mirror, Number(option(args, '--warmup', '8')), Number(option(args, '--calls', '72')), home, args.includes('--call-log'));
    const tasks = option(args, '--episodes');
    if (tasks) {
      const seeds = (option(args, '--seeds', '1') ?? '1').split(',').map(Number);
      const episodes = [];
      for (const task of tasks.split(',')) for (const seed of seeds) episodes.push(await episode(server, mirror, task, seed, home, args.includes('--list-actions')));
      out.episodes = episodes;
      out.episodeBytesTotal = episodes.reduce((sum, value) => sum + (value as { resultBytes: number }).resultBytes, 0);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
  const text = JSON.stringify(out, null, 2) + '\n';
  const file = option(args, '--out');
  if (file) writeFileSync(file, text);
  process.stdout.write(text);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('measure-agent-surface.ts')) await main(process.argv.slice(2));

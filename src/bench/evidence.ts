/**
 * Run evidence in the bench folder (PADR-0039 A): the call log the agent's bridge writes, the
 * mutation log the runner's host-side wrapper writes, the timeline the checker's trace replays, and
 * the client's own token, turn and cost figures. Every file here is data read back from a folder
 * an agent could write to: it is parsed with strict, bounded schemas and a line that does not fit is
 * dropped (call log) or refuses the file (mutation log).
 */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import type { ClientCall } from './mcp-client.ts';
import type { Action, Scalar } from '../world/types.ts';
import { ACTOR_CLIENT } from '../host/protocol.ts';

/** File names of the evidence next to the judged artifacts in a run folder. `bridgeCalls` is the file
 * the agent's bridge appends to; it is left as written. `calls` is the runner's normalised copy. */
export const RUN_EVIDENCE = Object.freeze({ bridgeCalls: 'calls.bridge.jsonl', calls: 'calls.jsonl', mutations: 'mutations.jsonl', trace: 'trace.json', board: 'board.svg' });
/** The largest call or mutation log read back. */
export const MAX_LOG_BYTES = 16 * 1024 * 1024;
/** The most lines a log keeps. */
export const MAX_LOG_LINES = 100_000;
/** Budget refusals (of changes and of checks, each) recorded in full before they are only counted. */
export const MAX_RECORDED_REFUSALS = 100;
/** Strings of a rejected action's parameters are cut to this many characters. */
export const MAX_REJECTED_TEXT = 256;

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const millis = z.number().nonnegative().max(86_400_000);
const code = z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/);
const requestId = z.union([z.number().int().safe(), z.string().regex(/^[A-Za-z0-9_.:-]{1,64}$/), z.null()]);

/** One line the bridge writes (`practonaut mcp --call-log`, PADR-0038 decision 8). */
const BridgeLineSchema = z.strictObject({ id: requestId.optional(), tool: code, code, resultBytes: count, bridgeMs: millis });
/** One line of a run's `calls.jsonl` after the runner normalised it. */
export const CallRecordSchema = z.strictObject({ seq: count, id: requestId, tool: code, code, resultBytes: count, bridgeMs: millis, clientMs: millis.nullable() });
export type CallRecord = z.infer<typeof CallRecordSchema>;

const lines = (text: string): string[] => text.split('\n').filter(line => line.trim() !== '').slice(0, MAX_LOG_LINES);

/**
 * The bridge's raw call log, normalised: well-formed lines in order, numbered, with the client's
 * round trip joined by request id where Practonaut's own client made the call (built-in agents).
 * Lines that do not fit the bridge's format are counted as `dropped`; lines beyond MAX_LOG_LINES (and
 * any the caller could not read, `unread`) as `omitted`. Nothing is lost without being counted.
 */
export function normaliseCallLog(raw: string, client?: readonly ClientCall[], unread = 0): { records: CallRecord[]; dropped: number; omitted: number; text: string } {
  const timing = new Map((client ?? []).map(call => [call.id, call.ms]));
  const records: CallRecord[] = []; let dropped = 0;
  const all = raw.split('\n').filter(line => line.trim() !== '');
  for (const line of all.slice(0, MAX_LOG_LINES)) {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { dropped++; continue; }
    const entry = BridgeLineSchema.safeParse(parsed);
    if (!entry.success) { dropped++; continue; }
    const id = entry.data.id ?? null;
    records.push({ seq: records.length, id, tool: entry.data.tool, code: entry.data.code, resultBytes: entry.data.resultBytes, bridgeMs: entry.data.bridgeMs, clientMs: client && typeof id === 'number' ? timing.get(id) ?? null : null });
  }
  return { records, dropped, omitted: Math.max(0, all.length - MAX_LOG_LINES) + unread, text: records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : '') };
}

/** How many bytes beyond a log's head are read to count its remaining lines; past this the count stops
 * and is a lower bound (`countCapped`), so a huge file cannot hold the runner. */
export const MAX_COUNTED_BYTES = 256 * 1024 * 1024;
/** A regular file's first `max` bytes up to its last complete line, and how many lines lie beyond
 * them (counted by reading at most `maxCounted` more bytes, never kept; `countCapped` when the file
 * goes on past them); null when it is missing or not a regular file. */
export async function readLogHead(path: string, max: number, maxCounted = MAX_COUNTED_BYTES): Promise<{ text: string; unreadLines: number; countCapped: boolean } | null> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); } catch { return null; }
  try {
    if (!(await handle.stat()).isFile()) return null;
    const head = Buffer.alloc(max);
    const { bytesRead } = await handle.read(head, 0, max, 0);
    let text = head.subarray(0, bytesRead).toString('utf8'), unreadLines = 0, position = bytesRead, countCapped = false;
    if (bytesRead === max) {
      // Cut at the last newline; the partial line and everything after it are counted, not kept.
      const cut = text.lastIndexOf('\n');
      const rest = text.slice(cut + 1); text = text.slice(0, cut + 1);
      let pending = rest.trim() !== '';
      const chunk = Buffer.alloc(1024 * 1024);
      for (;;) {
        if (position - bytesRead >= maxCounted) { countCapped = (await handle.read(chunk, 0, 1, position)).bytesRead > 0; break; }
        const read = await handle.read(chunk, 0, Math.min(chunk.length, maxCounted - (position - bytesRead)), position);
        if (!read.bytesRead) break;
        position += read.bytesRead;
        for (let index = 0; index < read.bytesRead; index++) {
          const byte = chunk[index]!;
          if (byte === 10) { if (pending) unreadLines++; pending = false; } else if (byte !== 13 && byte !== 32 && byte !== 9) pending = true;
        }
      }
      if (pending) unreadLines++;
    }
    return { text, unreadLines, countCapped };
  } catch { return null; } finally { await handle.close(); }
}

export function parseCallLog(text: string): CallRecord[] {
  return lines(text).map((line, index) => {
    const parsed = CallRecordSchema.safeParse(JSON.parse(line));
    if (!parsed.success || parsed.data.seq !== index) throw new Error(`calls.jsonl line ${index + 1} is not a call record`);
    return parsed.data;
  });
}

// ---- mutations.jsonl ----

const scalar = z.union([z.string().max(4096), z.number().int().safe(), z.boolean(), z.null()]);
const ActionSchema = z.strictObject({ name: z.string().regex(/^[a-z_]{1,32}$/), params: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/), scalar), baseStep: z.number().int().nonnegative().safe().optional() });
/** `check` records a check_result call (PADR-0040): it changes nothing, but a task's check limit is
 * verified from these host-side records, never from the agent's call log. */
export const MutationRecordSchema = z.strictObject({
  seq: count, op: z.enum(['act', 'undo', 'reset', 'check']),
  /** For `act`: the action as the host received it; a rejected action's strings are cut. */
  action: ActionSchema.optional(),
  /** The MCP client name the agent declared (shown, never trusted); null without one. */
  client: z.string().regex(ACTOR_CLIENT).nullable(),
  outcome: z.enum(['accepted', 'rejected']),
  /** The host's error code of a rejected mutation (`action_budget_exhausted` from the runner's budget). */
  code: code.optional(),
  /** Step and revision after the mutation (unchanged when it was rejected). */
  step: count, revision: count,
});
export type MutationRecord = z.infer<typeof MutationRecordSchema>;
export type MutationOp = MutationRecord['op'];

/** A rejected action's parameters as the log keeps them: scalars only, strings cut. */
function keptParams(params: Record<string, unknown>): Record<string, Scalar> {
  const kept: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(params).slice(0, 32)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key)) continue;
    if (typeof value === 'string') kept[key] = value.length > MAX_REJECTED_TEXT ? value.slice(0, MAX_REJECTED_TEXT) + '…' : value;
    else if (typeof value === 'number') kept[key] = Number.isSafeInteger(value) ? value : String(value).slice(0, 32);
    else if (typeof value === 'boolean' || value === null) kept[key] = value;
    else kept[key] = '[not a scalar]';
  }
  return kept;
}

/** The runner's record of every mutation that reaches the session (PADR-0039 A.2). */
export class MutationRecorder {
  readonly records: MutationRecord[] = [];
  /** Budget refusals beyond MAX_RECORDED_REFUSALS: counted, not recorded. */
  omitted = 0;
  private refusals = 0;
  private checkRefusals = 0;
  /** `position` is read only for an entry that is kept (a refusal beyond the cap costs nothing). */
  record(entry: { op: MutationOp; action?: Action; client?: string | null; outcome: 'accepted' | 'rejected'; code?: string; position: () => { step: number; revision: number } }): void {
    if (entry.code === 'action_budget_exhausted' && ++this.refusals > MAX_RECORDED_REFUSALS) { this.omitted++; return; }
    if (entry.code === 'check_budget_exhausted' && ++this.checkRefusals > MAX_RECORDED_REFUSALS) { this.omitted++; return; }
    if (this.records.length >= MAX_LOG_LINES) { this.omitted++; return; }
    const { step, revision } = entry.position();
    const action = entry.action === undefined ? undefined : {
      name: /^[a-z_]{1,32}$/.test(entry.action.name) ? entry.action.name : 'unknown',
      params: entry.outcome === 'accepted' ? entry.action.params : keptParams(entry.action.params),
      ...(Number.isSafeInteger(entry.action.baseStep) && (entry.action.baseStep ?? -1) >= 0 ? { baseStep: entry.action.baseStep } : {}),
    };
    const client = typeof entry.client === 'string' && ACTOR_CLIENT.test(entry.client) ? entry.client : null;
    this.records.push({ seq: this.records.length, op: entry.op, ...(action ? { action } : {}), client, outcome: entry.outcome, ...(entry.code && /^[A-Za-z0-9_.:-]{1,64}$/.test(entry.code) ? { code: entry.code } : {}), step, revision });
  }
  text(): string { return this.records.map(record => JSON.stringify(record)).join('\n') + (this.records.length ? '\n' : ''); }
}

/** Reads a run's `mutations.jsonl` strictly: every line a record, numbered from 0. */
export function parseMutations(text: string): MutationRecord[] {
  return lines(text).map((line, index) => {
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error(`mutations.jsonl line ${index + 1} is not JSON`); }
    const parsed = MutationRecordSchema.safeParse(raw);
    if (!parsed.success || parsed.data.seq !== index) throw new Error(`mutations.jsonl line ${index + 1} is not a mutation record`);
    return parsed.data;
  });
}

/** What a mutation log says about the run's counters (each kind of call and its outcome). */
export function mutationCounts(records: readonly MutationRecord[]): { act: number; accepted: number; rejected: number; undoCalls: number; undos: number; resetCalls: number; resets: number; checkCalls: number; checks: number } {
  const of = (op: MutationOp, outcome?: 'accepted' | 'rejected'): number => records.filter(record => record.op === op && (outcome === undefined || record.outcome === outcome)).length;
  return { act: of('act'), accepted: of('act', 'accepted'), rejected: of('act', 'rejected'), undoCalls: of('undo'), undos: of('undo', 'accepted'), resetCalls: of('reset'), resets: of('reset', 'accepted'), checkCalls: of('check'), checks: of('check', 'accepted') };
}

/** The accepted mutations as the checker's trace replays them, or the reason there is none: a log
 * that was cut cannot be replayed. */
export type TimelineEntry = { seq: number; op: 'act'; action: Action } | { seq: number; op: 'undo' | 'reset' };
export function timelineOf(records: readonly MutationRecord[], omitted = 0): { timeline: TimelineEntry[] } | { reason: 'log_truncated' } {
  if (records.length >= MAX_LOG_LINES && omitted > 0) return { reason: 'log_truncated' };
  const timeline: TimelineEntry[] = [];
  for (const record of records) {
    // A check changes nothing: it is not part of the timeline the checker replays.
    if (record.outcome !== 'accepted' || record.op === 'check') continue;
    if (record.op === 'act') timeline.push({ seq: record.seq, op: 'act', action: record.action as Action });
    else timeline.push({ seq: record.seq, op: record.op });
  }
  return { timeline };
}

// ---- the client's own failure reports ----

/** Why a run could not show what the model can do, as its client's own stream says it: a usage or
 * rate limit, or an API error. Such a run is an infrastructure error, not a model failure. */
export interface ClientFailure { reason: 'usage_limit' | 'auth' | 'api_error'; detail: string }
const LIMIT_TEXT = /usage limit|limit reached|hit your limit|rate.?limit|quota|too many requests/i;
const AUTH_TEXT = /authentication|unauthori[sz]ed|forbidden|invalid (?:x-)?api.?key|oauth|(?:token|login|session|credentials?) (?:has |have )?expired|expired (?:token|login|session|credentials?)|\/login|not logged in|credit balance|billing/i;
const SERVER_TEXT = /overloaded|internal server error|service unavailable|bad gateway|gateway time-?out|server_error|"api_error"|connection error/i;
/** The class of an API error by its HTTP status (from `api_error_status` or "API Error: nnn") or its
 * words: 429 and usage or rate limits; 401, 403, an expired login or billing; 5xx (529 included).
 * Any other 4xx — a prompt that is too long, an invalid request — is the agent's (third review). */
function errorClass(status: number | null, text: string): ClientFailure['reason'] | null {
  if (status !== null) {
    if (status === 429) return 'usage_limit';
    if (status === 401 || status === 403) return 'auth';
    if (status >= 500 && status <= 599) return 'api_error';
    if (status >= 400) return null;
  }
  if (LIMIT_TEXT.test(text)) return 'usage_limit';
  if (AUTH_TEXT.test(text)) return 'auth';
  if (SERVER_TEXT.test(text)) return 'api_error';
  return null;
}
const statusIn = (text: string): number | null => { const match = /API Error:?\s*(\d{3})\b/i.exec(text); return match ? Number(match[1]) : null; };
const DETAIL: Record<ClientFailure['reason'], string> = { usage_limit: 'usage or rate limit', auth: 'authentication or billing', api_error: 'API error' };
/**
 * Scans a stream-json client's output for its own failure reports (PADR-0040): a `rate_limit_event`
 * whose status is not `allowed`/`allowed_warning`; a `result` with `is_error` (not
 * `error_max_turns`) or an assistant message the client marks as an API error, whose status or words
 * name a usage or rate limit (429), an authentication or billing error (401, 403, an expired login)
 * or a server error (5xx, 529 included). A context overflow and other 4xx errors stay the agent's.
 * The detail is fixed text, never the client's own words.
 */
export function clientFailure(stdout: string): ClientFailure | null {
  for (const line of stdout.split('\n')) {
    if (!line.trimStart().startsWith('{')) continue;
    let event: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(line); if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue; event = parsed as Record<string, unknown>; } catch { continue; }
    if (event.type === 'rate_limit_event') {
      const status = (event.rate_limit_info as { status?: unknown } | undefined)?.status;
      if (typeof status === 'string' && status !== 'allowed' && status !== 'allowed_warning') return { reason: 'usage_limit', detail: 'rate_limit_event not allowed' };
      continue;
    }
    if (event.type === 'result' && event.is_error === true && event.subtype !== 'error_max_turns') {
      const text = [event.result, event.error, ...(Array.isArray(event.errors) ? event.errors : [])].filter((value): value is string => typeof value === 'string').join(' ').slice(0, 4096);
      const reason = errorClass(typeof event.api_error_status === 'number' ? event.api_error_status : statusIn(text), text);
      if (reason) return { reason, detail: `result is_error: ${DETAIL[reason]}` };
      continue;
    }
    if (event.type === 'assistant' && (event.isApiErrorMessage === true || typeof event.error === 'string')) {
      const content = (event.message as { content?: unknown } | undefined)?.content;
      const words = Array.isArray(content) ? content.flatMap(part => typeof (part as { text?: unknown })?.text === 'string' ? [(part as { text: string }).text] : []) : [];
      const text = [typeof event.error === 'string' ? event.error : '', ...words].join(' ').slice(0, 4096);
      const reason = errorClass(statusIn(text), text);
      if (reason) return { reason, detail: `assistant API error: ${DETAIL[reason]}` };
    }
  }
  return null;
}

// ---- the client's own figures ----

/** What a stream-json client says about its run (Claude Code's `system/init` and `result` events). */
export interface ClientFigures { model: string | null; turns: number | null; costUsd: number | null; tokens: { input: number; output: number; cacheRead: number; cacheCreation: number } | null }
const nonNegativeInteger = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** The last `result` event of a stream-json output (turns, cost, tokens); every field that is missing
 * or not a plain non-negative number is null. Never verified. */
export function clientResult(stdout: string): Omit<ClientFigures, 'model'> {
  const none = { turns: null, costUsd: null, tokens: null };
  // Every line is parsed; the last one that is a JSON object with type "result" counts.
  let event: unknown;
  for (const line of stdout.split('\n').reverse()) {
    if (!line.trimStart().startsWith('{')) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as { type?: unknown }).type === 'result') { event = parsed; break; }
  }
  if (event === undefined) return none;
  const { num_turns: turns, total_cost_usd: cost, usage } = event as { num_turns?: unknown; total_cost_usd?: unknown; usage?: Record<string, unknown> };
  const tokens = usage && typeof usage === 'object' ? { input: nonNegativeInteger(usage.input_tokens), output: nonNegativeInteger(usage.output_tokens), cacheRead: nonNegativeInteger(usage.cache_read_input_tokens), cacheCreation: nonNegativeInteger(usage.cache_creation_input_tokens) } : null;
  return {
    turns: nonNegativeInteger(turns),
    costUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost < 1e6 ? Math.round(cost * 1e6) / 1e6 : null,
    tokens: tokens && tokens.input !== null && tokens.output !== null ? { input: tokens.input, output: tokens.output, cacheRead: tokens.cacheRead ?? 0, cacheCreation: tokens.cacheCreation ?? 0 } : null,
  };
}

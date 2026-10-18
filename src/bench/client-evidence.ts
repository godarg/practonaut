/**
 * What an external agent's own stdout says about its run, read the same way by the runner, by
 * `bench --recover` and by `report --verify` (PADR-0044 decisions 5, 6 and 9): the stdout binding
 * (SHA-256 and size of the whole file), the client block with the parser that read it, a preset's
 * isolation evidence from the tools its client offered, and the client's own failure report. Nothing
 * here is the agent's to decide: the file is data, read with bounded parts and strict patterns.
 */
import { open } from 'node:fs/promises';
import { clientInit, PRESET_INFO, TEMPLATE_PARSER, type AgentSpec } from './agents.ts';
import { clientFailure, clientResult, hashFile, MAX_LOG_BYTES, readLogHead, type ClientFailure } from './evidence.ts';
import { attestedBilling, STDOUT_HEAD_BYTES, STDOUT_TAIL_BYTES, toolEvidence } from './parsers.ts';
import { ISOLATION_OF, type IsolationEvidence, type IsolationLevel, type RunClientV3 } from './report.ts';

/** The MCP server name every bench run's agent sees for Practonaut's own bridge. */
export const BENCH_SERVER = 'practonaut';

/** The first 64 KiB of an agent's stdout (where a stream-json client writes its init event). */
export async function stdoutHead(path: string): Promise<string> {
  return open(path, 'r').then(async handle => { try { const read = await handle.read(Buffer.alloc(STDOUT_HEAD_BYTES), 0, STDOUT_HEAD_BYTES, 0); return read.buffer.subarray(0, read.bytesRead).toString('utf8'); } finally { await handle.close(); } }).catch(() => '');
}
/** The last 256 KiB of an agent's stdout (where a stream-json client writes its result event). */
export async function stdoutTail(path: string): Promise<string> {
  const size = STDOUT_TAIL_BYTES;
  return open(path, 'r').then(async handle => { try { const length = (await handle.stat()).size, start = Math.max(0, length - size); const read = await handle.read(Buffer.alloc(size), 0, size, start); const text = read.buffer.subarray(0, read.bytesRead).toString('utf8'); return start > 0 ? text.slice(text.indexOf('\n') + 1) : text; } finally { await handle.close(); } }).catch(() => '');
}

export interface ClientEvidence {
  /** null: the file could not be read; then nothing else is derived from it. */
  stdout: { sha256: string; bytes: number } | null;
  /** The init event's own statements (raw, pattern-checked), for the report's agent fields. */
  init: { model: string | null; apiKeySource: string | null; version: string | null };
  client?: RunClientV3;
  isolation: { level: IsolationLevel; evidence: IsolationEvidence };
  failure: (ClientFailure & { parser: string }) | null;
}

/** Reads one external run's stdout: a preset's or a command template's (never a built-in's). The
 * `advertised` tool names are those of the run's own server (the bridge's, at session level). */
export async function readClientEvidence(spec: AgentSpec, path: string, advertised: readonly string[]): Promise<ClientEvidence> {
  const preset = spec.kind === 'preset' ? PRESET_INFO[spec.name] : undefined;
  const byKind = { level: ISOLATION_OF[spec.kind], evidence: 'by-kind' as const };
  const unread = { model: null, apiKeySource: null, version: null };
  const stdout = await hashFile(path);
  if (stdout === null) return { stdout, init: unread, isolation: spec.kind === 'preset' ? { level: ISOLATION_OF.command, evidence: 'no-evidence' } : byKind, failure: null };
  const head = await stdoutHead(path), tail = await stdoutTail(path), body = (await readLogHead(path, MAX_LOG_BYTES))?.text ?? '';
  const init = clientInit(head), figures = clientResult(tail), parser = preset?.parser ?? TEMPLATE_PARSER;
  const failure = clientFailure(body);
  let isolation: ClientEvidence['isolation'] = byKind, tools: RunClientV3['tools'], billing: RunClientV3['billing'];
  if (spec.kind === 'preset') {
    // A preset whose client is not known here (none ships without its info) gives no evidence.
    const offered = preset ? toolEvidence(head, BENCH_SERVER, advertised, preset.toolName) : { evidence: 'no-evidence' as const };
    isolation = { level: offered.evidence === 'tools-within-servers' ? ISOLATION_OF.preset : ISOLATION_OF.command, evidence: offered.evidence };
    tools = 'tools' in offered ? offered.tools : undefined;
    billing = attestedBilling(init.apiKeySource);
  }
  const client: RunClientV3 = {
    source: spec.kind === 'preset' ? 'client-attested' : 'command-output', model: init.model, ...figures,
    ...(init.version !== null ? { version: init.version } : {}), parser,
    ...(tools ? { tools } : {}), ...(billing ? { billing } : {}),
  };
  return { stdout, init, client, isolation, failure: failure ? { ...failure, parser } : null };
}

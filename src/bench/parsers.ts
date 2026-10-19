/**
 * The versioned parsers that read an external agent's bound stdout (PADR-0044 decisions 5, 6 and 9).
 * `claude-code-stream/1` reads Claude Code's stream-json output (and a command template's output in the
 * same format): the `system/init` event in the first 64 KiB (model, `apiKeySource`, version, the tools
 * and MCP servers the client offered), the last `result` event in the last 256 KiB (turns, cost,
 * tokens) and the client's own failure events in the first 16 MiB. Every value is the client's own
 * statement, read with bounded patterns; nothing here is verified against the provider.
 */
import { API_KEY_SOURCES, MAX_TOOL_NAMES, TOOL_NAME, type BillingClass, type IsolationEvidence } from './report.ts';

export const CLAUDE_CODE_STREAM = 'claude-code-stream/1';
/** The parsers this Practonaut ships; a value read by any other cannot be re-derived here. */
export const SHIPPED_PARSERS: ReadonlySet<string> = new Set([CLAUDE_CODE_STREAM]);
/** The statement each parser reads the observed billing class from: a fixed identifier, never a value. */
export const BILLING_VIA: Readonly<Record<string, string>> = Object.freeze({ [CLAUDE_CODE_STREAM]: `${CLAUDE_CODE_STREAM}:init.apiKeySource` });
/** How much of a stdout each part is read from (the runner and `--verify` read the same). */
export const STDOUT_HEAD_BYTES = 64 * 1024;
export const STDOUT_TAIL_BYTES = 256 * 1024;

/** `apiKeySource` as /3 stores it: from the parser's fixed list, `other` for anything else. */
export function apiKeySourceValue(raw: string | null): typeof API_KEY_SOURCES[number] | null {
  if (raw === null) return null;
  return (API_KEY_SOURCES as readonly string[]).includes(raw) && raw !== 'other' ? raw as typeof API_KEY_SOURCES[number] : 'other';
}

/** The billing class Claude Code's init event attests (`apiKeySource`): `none` is its own login (a
 * subscription), a key or key helper is API billing, anything else is unknown. */
export function attestedBilling(apiKeySource: string | null): { class: BillingClass; source: 'client-attested'; via: string } | undefined {
  if (apiKeySource === null) return undefined;
  const value = apiKeySourceValue(apiKeySource);
  const kind: BillingClass = value === 'none' ? 'subscription' : value === 'other' ? 'unknown' : 'api-key';
  return { class: kind, source: 'client-attested', via: BILLING_VIA[CLAUDE_CODE_STREAM]! };
}

/** The tools and MCP servers the first `system/init` event lists, as the client wrote them (null: not a list). */
export function initOffer(stdoutHead: string): { tools: unknown[] | null; servers: unknown[] | null } | null {
  for (const line of stdoutHead.split('\n')) {
    if (!line.includes('"init"')) continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { continue; }
    if (event === null || typeof event !== 'object') continue;
    const { type, subtype, tools, mcp_servers: servers } = event as { type?: unknown; subtype?: unknown; tools?: unknown; mcp_servers?: unknown };
    if (type !== 'system' || subtype !== 'init') continue;
    return { tools: Array.isArray(tools) ? tools : null, servers: Array.isArray(servers) ? servers : null };
  }
  return null;
}

/**
 * A preset run's isolation evidence (decision 6). Membership is exact: every tool the client lists
 * equals, after the preset's naming (`toolName`), a tool the run's own server advertised, and the
 * listed MCP servers are exactly that server. A name that does not fit the bounded pattern, a list
 * longer than 256 names, or any other tool (a file or shell tool included) is a tool outside. No init
 * event, no tool list or no server list, or an empty tool list, is no evidence.
 */
export function toolEvidence(stdoutHead: string | null, server: string, advertised: readonly string[], toolName: (server: string, tool: string) => string): { tools?: { names: string[]; omitted: number }; evidence: Exclude<IsolationEvidence, 'by-kind'> } {
  const offer = stdoutHead === null ? null : initOffer(stdoutHead);
  if (!offer || offer.tools === null) return { evidence: 'no-evidence' };
  const fitting = offer.tools.filter((name): name is string => typeof name === 'string' && TOOL_NAME.test(name));
  const names = fitting.slice(0, MAX_TOOL_NAMES), omitted = offer.tools.length - names.length;
  const tools = { names, omitted };
  const allowed = new Set(advertised.map(tool => toolName(server, tool)));
  if (omitted > 0 || names.some(name => !allowed.has(name))) return { tools, evidence: 'tool-outside-servers' };
  if (offer.servers !== null) {
    const listed = offer.servers.map(entry => entry !== null && typeof entry === 'object' ? (entry as { name?: unknown }).name : entry);
    if (listed.length !== 1 || listed[0] !== server) return { tools, evidence: 'tool-outside-servers' };
  } else return { tools, evidence: 'no-evidence' };
  return { tools, evidence: names.length ? 'tools-within-servers' : 'no-evidence' };
}

import { constants } from "node:fs";
import { READ_NOFOLLOW, isPrivateDirectory, isPrivateFile, pathParts } from '../platform/private-fs.ts';
import { lstat, open } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { z } from "zod";
import { HOST_LIMITS, RequestBudget } from "../host/limits.ts";
import { HOST_ROUTES, HOST_ERROR_CODES, TOKEN_HEADER, type HostReply, type HostErrorCode } from "../host/protocol.ts";
import { parseJsonEntry } from "../package/json.ts";
import { ActionDefinitionSchemaV2, AnyStateSchema, RuleSchemaV2, WorldSchema } from "../world/schema.ts";
import { ERROR_CODES } from "../world/types.ts";
import { agentClientName, inputProblems, TOOL_SCHEMAS, type McpBridge, type McpCallContext, type McpBridgeConfig, type McpToolName, type McpToolInputs, type McpToolValues } from "./contracts.ts";
import { checkResult, compactView, fullView, localize, mutationResult, type Lang } from "./replies.ts";
import {HOST_TRANSACTION_MS} from '../host/mirror.ts';
export const BRIDGE_DEADLINE_MS=HOST_LIMITS.requestTimeoutMs;
export const BRIDGE_REOBSERVE_MS=3_000;
if(BRIDGE_DEADLINE_MS<=HOST_TRANSACTION_MS)throw new Error('Bridge deadline must exceed the host transaction deadline');

export class McpConfigurationError extends Error {
  readonly code: "host_rejected" | "token_file_unsafe" | "invalid_request";
  constructor(code: McpConfigurationError["code"]) {
    super(code === "host_rejected" ? "MCP needs a canonical loopback host origin" : code === "token_file_unsafe" ? "MCP credential path is unsafe" : "MCP configuration is invalid");
    this.name = "McpConfigurationError"; this.code = code;
  }
}
export function requireHostOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || value !== url.origin) throw new Error();
    return url.origin;
  } catch { throw new McpConfigurationError("host_rejected"); }
}
/** The descriptor, not a path-only permission check, is the credential authority. */
export async function readSessionToken(path: string): Promise<string> {
  try {
    const absolute = resolve(path), parent = dirname(absolute), { root, parts } = pathParts(parent);
    let at = root;
    for (const component of parts) {
      at = join(at, component); const stat = await lstat(at);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error();
    }
    const directory = await lstat(parent);
    if (!isPrivateDirectory(directory)) throw new Error();
    const handle = await open(absolute, READ_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!isPrivateFile(stat) || stat.size !== 65) throw new Error();
      const bytes = Buffer.alloc(66); const read = await handle.read(bytes, 0, bytes.length, 0);
      const token = bytes.subarray(0, read.bytesRead).toString("utf8");
      const current = await lstat(parent), actual = await lstat(absolute);
      if (current.ino !== directory.ino || current.dev !== directory.dev || !isPrivateDirectory(current) || actual.ino !== stat.ino || actual.dev !== stat.dev || actual.isSymbolicLink() || !isPrivateFile(actual) || actual.size !== 65) throw new Error();
      if (!/^[a-f0-9]{64}\n$/.test(token)) throw new Error();
      return token.slice(0, -1);
    } finally { await handle.close(); }
  } catch { throw new McpConfigurationError("token_file_unsafe"); }
}

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const localized = z.strictObject({ en: z.string().max(8192), de: z.string().max(8192) });
const diagnosis = z.array(z.strictObject({ id: z.string(), explanation: localized }));
const condition = z.strictObject({ id: z.string(), text: localized, formalText: localized.optional() });
const checkSchema = z.strictObject({ scope: z.literal("end-state-only"), hash: z.string(), revision: integer, passed: z.boolean(), conditions: z.array(condition.extend({ met: z.boolean() })), errors: diagnosis, mode: z.enum(["real-engine", "model-only"]), practiceEvidence: z.boolean(), checksRemaining: integer.optional() });
/** The attempt's limits (PADR-0040): only the counts, never anything about the solution. */
const limitCount = z.strictObject({ limit: integer, used: integer });
const limitsSchema = z.strictObject({ actions: limitCount.optional(), checks: limitCount.optional() });
const action = z.strictObject({ name: z.string(), params: z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean(), z.null()])), baseStep: integer.optional() });
/** Fail closed on unknown fields: a future host field never silently becomes an agent oracle. */
export const publicViewSchema = z.strictObject({
  schema: z.literal("practonaut.host/1"), sessionId: z.string(), revision: integer,
  world: z.strictObject({ id: z.string(), version: z.string() }), seed: z.number().int(), variantId: z.string(),
  task: z.strictObject({ id: z.string(), title: localized, prompt: localized, conditions: z.array(condition), hintCount: integer }),
  tasks: z.array(z.strictObject({ id: z.string(), title: localized, level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), referenceActions: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional() })), state: AnyStateSchema, hash: z.string(), step: integer,
  log: z.array(z.strictObject({ action, hash: z.string() })),
  history: z.array(z.strictObject({ description: localized, actor: z.union([z.strictObject({ kind: z.literal('human') }), z.strictObject({ kind: z.literal('agent'), client: z.string().max(64) })]), step: integer, action, hash: z.string(), effects: z.array(z.strictObject({ kind: z.string(), id: z.string() })), consequences: diagnosis, ruleIds: z.array(z.string()), mirrorConfirmed: z.boolean(), latencyMs: z.number().nonnegative() })),
  // Either era's public action and rule shapes; a world/1 view is still held to world/1 exactly.
  actions: z.union([WorldSchema.shape.actions, z.array(ActionDefinitionSchemaV2).max(32)]), rules: z.union([WorldSchema.shape.rules, z.array(RuleSchemaV2).max(128)]), mirror: z.enum(["required", "off"]),
  mirrorHealth: z.strictObject({ status: z.enum(["available", "unavailable", "closed", "model-only"]), recoveries: integer }),
  practiceEvidence: z.boolean(), attempt: integer, hintsOpened: integer, hints: z.array(localized), result: checkSchema.nullable(), errors: diagnosis,
  limits: limitsSchema.optional(),
});
const effect = z.strictObject({ kind: z.string(), id: z.string() });
/** A mutation answered without its view (`reply: "delta"`, PADR-0038); `changed` holds state objects. */
const deltaReplySchema = z.strictObject({
  delta: z.strictObject({ step: integer, revision: integer, hash: z.string(), changed: z.record(z.string(), z.unknown()), created: z.array(z.string()), removed: z.array(z.string()), effects: z.array(effect), errors: diagnosis, changedOmitted: z.literal(true).optional(), limits: limitsSchema.optional() }),
  mirrorConfirmed: z.boolean(), latencyMs: z.number().nonnegative(),
}).superRefine((value, context) => { if (!AnyStateSchema.safeParse({ objects: value.delta.changed }).success) context.addIssue({ code: "custom", message: "changed objects do not match the state schema" }); });
// Only practice/core failures are part of these seven tools. Authoring/runtime or future
// private diagnostics must not silently enter the MCP surface. Empty core details preserve
// HTTP parity; nonempty diagnostics need an explicit public contract before admission.
const errorSchema = z.union([
 z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.enum([...HOST_ERROR_CODES, ...ERROR_CODES]), message: z.string().max(8192), details: z.strictObject({}).optional() }) }),
 // A stale request learns the current step and revision, nothing else.
 z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.literal('stale_base'), message: z.string().max(8192), details: z.strictObject({ step: integer, revision: integer }) }) }),
 z.strictObject({ok:z.literal(false),error:z.strictObject({code:z.literal('outcome_unknown'),message:z.string().max(256),details:z.strictObject({observedRevision:integer,observedHash:z.string().regex(/^[a-f0-9]{64}$/)})})}),
]);
function failure(code: HostErrorCode, message: string): HostReply<never> { return { ok: false, error: { code, message } }; }
function admitted<T>(raw: unknown, schema: z.ZodType<T>): HostReply<T> {
  const error = errorSchema.safeParse(raw);
  if (error.success) return error.data as HostReply<T>; // Host error vocabulary includes authoring/runtime codes.
  const success = z.strictObject({ ok: z.literal(true), value: schema }).safeParse(raw);
  return success.success ? success.data : failure("invalid_request", "Host reply does not match the public surface");
}
export async function createBridge(config: McpBridgeConfig): Promise<McpBridge> {
  const host = requireHostOrigin(config.host);
  if ((config.tokenFile === undefined) === (config.token === undefined)) throw new McpConfigurationError("invalid_request");
  const token = config.tokenFile === undefined ? config.token! : await readSessionToken(config.tokenFile);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new McpConfigurationError("invalid_request");
  const budget = new RequestBudget();
  async function request(route: string, payload?: object,reobserve=true): Promise<unknown> {
    const serialized = payload === undefined ? undefined : JSON.stringify(payload);
    if (serialized !== undefined && Buffer.byteLength(serialized) > HOST_LIMITS.bodyBytes) return failure("body_too_large", "Request exceeds body budget");
    try {
      const response = await fetch(host + route, { method: serialized === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(reobserve?BRIDGE_DEADLINE_MS:BRIDGE_REOBSERVE_MS), headers: { [TOKEN_HEADER]: token, ...(serialized === undefined ? {} : { "Content-Type": "application/json" }) }, ...(serialized === undefined ? {} : { body: serialized }) });
      if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel(); return failure("invalid_request", "Host reply must be JSON"); }
      const reader = response.body?.getReader(); if (!reader) return failure("invalid_request", "Host reply is missing");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > HOST_LIMITS.replyBytes) { await reader.cancel(); return failure("result_too_large", "Host reply exceeds result budget"); } chunks.push(part.value); } }
      finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks);
      if (body.toString("utf8").includes(token)) return failure("invalid_request", "Host reply contains a credential");
      const raw = parseJsonEntry(body, "host-reply", 64);
      // JSON Unicode escapes are decoded before values become tool text. Scan the decoded
      // representation as well, including property names and nested error/success fields.
      if (JSON.stringify(raw).includes(token)) return failure("invalid_request", "Host reply contains a credential");
      if (!response.ok && !(typeof raw === "object" && raw !== null && "ok" in raw && raw.ok === false)) return failure("invalid_request", "Host status and reply disagree");
      return raw;
    } catch(error) {
      if(reobserve&&serialized!==undefined&&error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)){
        const observed=admitted(await request(HOST_ROUTES.observe,undefined,false),publicViewSchema);
        return {ok:false,error:{code:'outcome_unknown',message:'Host response deadline reached; outcome is unknown. Re-observe before another mutation.',...(observed.ok?{details:{observedRevision:observed.value.revision,observedHash:observed.value.hash}}:{})}};
      }
      return failure("mirror_unavailable", "Host request could not be completed");
    }
  }
  return { async call<K extends McpToolName>(name: K, input: McpToolInputs[K], context: McpCallContext = {}): Promise<HostReply<McpToolValues[K]>> {
    if (!budget.take()) return failure("rate_limited", "Request rate exceeds bridge budget");
    if (!Object.hasOwn(TOOL_SCHEMAS, name)) return failure("invalid_request", "Tool name is not registered");
    const checked = TOOL_SCHEMAS[name].safeParse(input);
    if (!checked?.success) return failure("invalid_request", `Tool input does not match its schema: ${inputProblems(TOOL_SCHEMAS, name, input)}`);
    const lang: Lang = (checked.data as { lang?: Lang }).lang ?? "en";
    // Every host reply is admitted against its public schema first; shaping only selects and
    // localises admitted public data (PADR-0038).
    const shape = <T, U>(reply: HostReply<T>, map: (value: T) => U): HostReply<U> => reply.ok ? { ok: true, value: map(reply.value) } : reply;
    let reply: HostReply<unknown>;
    if (name === "act") {
      const value = checked.data as McpToolInputs["act"];
      // Every change made through MCP is an agent's; the history shows the client's declared name.
      reply = shape(admitted(await request(HOST_ROUTES.act, { expectedRevision: value.expectedRevision, action: { name: value.name, params: value.params, baseStep: value.baseStep }, actor: { kind: 'agent', client: agentClientName(context.client) }, reply: 'delta' }), deltaReplySchema), delta => mutationResult(delta as never, lang));
    } else if (name === "undo" || name === "reset") {
      const { lang: _lang, ...body } = checked.data as McpToolInputs["undo"] | McpToolInputs["reset"];
      reply = shape(admitted(await request(name === "undo" ? HOST_ROUTES.undo : HOST_ROUTES.reset, { ...body, reply: 'delta' }), deltaReplySchema), delta => mutationResult(delta as never, lang));
    } else if (name === "check_result") {
      reply = shape(admitted(await request(HOST_ROUTES.check, { expectedRevision: (checked.data as McpToolInputs["check_result"]).expectedRevision }), checkSchema), check => checkResult(check as never, lang));
    } else {
      const observed = admitted(await request(HOST_ROUTES.observe), publicViewSchema);
      const options = checked.data as McpToolInputs["observe"];
      reply = !observed.ok ? observed : name === "list_actions" ? { ok: true, value: observed.value.actions }
        : name === "explain_result" ? { ok: true, value: localize({ result: observed.value.result, errors: observed.value.errors }, lang) }
        : { ok: true, value: options.detail === "full" ? fullView(observed.value as never, lang) : compactView(observed.value as never, lang, options.history) };
    }
    return reply as HostReply<McpToolValues[K]>; // Switch above exhausts the seven fixed tools and validates each wire value.
  } };
}

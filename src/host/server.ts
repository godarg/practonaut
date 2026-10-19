import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import { Resolver } from "node:dns/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, open, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { parseJsonEntry } from "../package/json.ts";
import type { World } from "../world/types.ts";
import { createPracticeSession, type BrowserCloseDiagnostic, type MirrorDiagnostic, type PracticeSessionOptions } from "./session.ts";
import { ACTOR_CLIENT, HOST_ROUTES, TOKEN_HEADER, type ControllerFactory, type DemonstrationInfo, type HostErrorCode, type HostEvent, type HostReply, type ModelOnlyNotice, type MutationDeltaReply, type MutationReply, type PracticeController, type RunningHost, type ServeOptions } from "./protocol.ts";
import { demonstrationWorld, withDemonstration, type DemonstrationControl } from './demonstration.ts';
import { HOST_LIMITS, RequestBudget } from "./limits.ts";
import { createTokenFile } from "./token-file.ts";
import { createAuthorController, AuthorHostError } from './author-controller.ts';
import { startEditorAssets } from './editor-assets.ts';
import { AUTHOR_ROUTES } from './author-protocol.ts';
import type { AuthorController, AuthorFromScenesReply } from './author-protocol.ts';
import { fromScenesBounded } from '../authoring/from-scenes-runner.ts';
import { ProjectStoreError } from './project-store.ts';
import { AuthoringError } from '../authoring/index.ts';
import { CheckerError } from '../checker/index.ts';
import {HOST_TRANSACTION_MS} from './mirror.ts';
import { EXCLUSIVE_CREATE, isPrivateFile } from '../platform/private-fs.ts';
import { dataPaths, sourceBuildDirectory } from '../platform/paths.ts';
import { CLOSE_BOUND_MS } from '../adapters/browser/bounded.ts';
import { BrowserBudgetError } from '../adapters/browser/ledger.ts';
import { CANCELLED, CLOSE_SAFETY_MS, CloseRequested, closeAfterFailure, closeBy, closeDeadline, type CloseResult, type Closing } from '../adapters/browser/close.ts';
import { AdapterInitializationError } from '../adapters/browser/shell.ts';

export interface HostOptions extends ServeOptions { controllerFactory?: ControllerFactory; assetDirectory?: string; requireOffline?: boolean; phase3?: boolean; localDirectory?: string;
  /** Test seam: how the demonstration waits before each step (real timers when absent; the CLI never sets it). */
  demonstrationPause?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Test seam: the tracker of the practice hosts this host starts for the author. */
  childHosts?: ChildHosts;
  /** Stops the start of this host's mirror: an author host's shutdown aborts a practice host that is
   * still starting, with the close's deadline as the reason (PADR-0050). */
  signal?: AbortSignal }
export const PLAYER_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; font-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'";
/** New routes default to denial until their exact handler capability is declared. */
export const HTTP_CAPABILITIES:Readonly<Record<string,'public'|'practice'|'author'>>=Object.freeze({
 [HOST_ROUTES.bootstrap]:'public',[HOST_ROUTES.resume]:'practice',[HOST_ROUTES.observe]:'practice',
 [HOST_ROUTES.act]:'practice',[HOST_ROUTES.undo]:'practice',[HOST_ROUTES.reset]:'practice',[HOST_ROUTES.variant]:'practice',
 [HOST_ROUTES.hint]:'practice',[HOST_ROUTES.check]:'practice',[HOST_ROUTES.events]:'practice',[HOST_ROUTES.tool]:'practice',[HOST_ROUTES.export]:'practice',
 [HOST_ROUTES.demonstration]:'practice',[HOST_ROUTES.demonstrationStop]:'practice',
 [AUTHOR_ROUTES.editor]:'practice',[AUTHOR_ROUTES.scene]:'practice',
 [AUTHOR_ROUTES.observe]:'author',[AUTHOR_ROUTES.start]:'author',[AUTHOR_ROUTES.gesture]:'author',[AUTHOR_ROUTES.stop]:'author',
 [AUTHOR_ROUTES.recording]:'author',[AUTHOR_ROUTES.delete]:'author',[AUTHOR_ROUTES.analyze]:'author',[AUTHOR_ROUTES.confirm]:'author',
 [AUTHOR_ROUTES.project]:'author',[AUTHOR_ROUTES.compile]:'author',[AUTHOR_ROUTES.prepare]:'author',[AUTHOR_ROUTES.configure]:'author',
 [AUTHOR_ROUTES.save]:'author',[AUTHOR_ROUTES.projects]:'author',[AUTHOR_ROUTES.open]:'author',[AUTHOR_ROUTES.deleteProject]:'author',[AUTHOR_ROUTES.launch]:'author',[AUTHOR_ROUTES.fromScenes]:'author',
});
export class HostError extends Error {
  readonly code: HostErrorCode | "E_NETWORK_AVAILABLE";
  constructor(code: HostErrorCode | "E_NETWORK_AVAILABLE", message: string) { super(message); this.code = code; this.name = "HostError"; }
}

/** Diagnostics stay host-side in the already validated private credential directory. */
const DIAGNOSTIC_BYTES = 4 * 1024 * 1024;
class DiagnosticError extends Error {
  readonly code: 'diagnostic_limit' | 'diagnostic_unavailable';
  constructor(code: DiagnosticError['code']) { super(code === 'diagnostic_limit' ? 'Mirror diagnostic exceeds file budget' : 'Private mirror diagnostic cannot be persisted'); this.code = code; }
}
async function privateDiagnostics(tokenFile: string, token: string, codes: () => readonly string[], authorToken?:string): Promise<{ write(record: MirrorDiagnostic | BrowserCloseDiagnostic): Promise<void>; close(): Promise<void>; discard(): Promise<void> }> {
  const path = tokenFile.replace(/\.token$/, '.mirror.jsonl');
  // Positioned writes instead of O_APPEND: Windows opens an append-only handle without the write
  // access that truncation (the rotation below) needs.
  const file = await open(path, EXCLUSIVE_CREATE, 0o600);
  const stat = await file.stat();
  if (!isPrivateFile(stat)) { await file.close(); throw new DiagnosticError('diagnostic_unavailable'); }
  let bytes = 0, generation = 0;
  /** Writes run one after another (positioned writes must not interleave), and a close or discard
   * waits for those already handed in: a record handed in without waiting (a session's close,
   * PADR-0050) still lands before the file closes. */
  let pending: Promise<unknown> = Promise.resolve();
  const writeOne = async (record: MirrorDiagnostic | BrowserCloseDiagnostic): Promise<void> => {
      try {
        const line = (): Buffer => {
          const value = { schema: 'practonaut.mirror-diagnostic/1', ts: new Date().toISOString(), generation, ...record };
          const serialized = JSON.stringify(value);
          const redacted = serialized.includes(token) || codes().some(code => serialized.includes(code)) || (authorToken!==undefined&&serialized.includes(authorToken));
          let body=(JSON.stringify({ ...value, redacted }) + '\n').replaceAll(token, '[session-token-redacted]');
          for (const code of codes()) body = body.replaceAll(code, '[bootstrap-code-redacted]');
          if(authorToken)body=body.replaceAll(authorToken,'[author-token-redacted]');return Buffer.from(body);
        };
        let body = line();
        if (body.length > DIAGNOSTIC_BYTES) throw new DiagnosticError('diagnostic_limit');
        // Rotate in-place: the most recent rejection is retained, total disk use stays bounded.
        if (bytes + body.length > DIAGNOSTIC_BYTES) { await file.truncate(0); bytes = 0; generation++; body = line(); }
        await file.write(body, 0, body.length, bytes); await file.sync(); bytes += body.length;
      } catch (error) { if (error instanceof DiagnosticError) throw error; throw new DiagnosticError('diagnostic_unavailable'); }
  };
  return {
    write(record) { const run = pending.then(() => writeOne(record)); pending = run.catch(() => undefined); return run; },
    // A diagnostics file that never received a record is not kept (no empty files left behind).
    async close() { await pending; await file.close(); if (bytes === 0 && generation === 0) await unlink(path).catch(() => {}); },
    async discard() { await pending; await file.close(); await unlink(path); },
  };
}

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const scalar = z.union([z.string().max(4096), z.number().finite().refine(v => !Number.isInteger(v) || Number.isSafeInteger(v)), z.boolean(), z.null()]);
const action = z.strictObject({ name: z.string().min(1).max(128), params: z.record(z.string().max(128), scalar), baseStep: revision.optional() });
const revisionSchema = z.strictObject({ expectedRevision: revision });
/** `reply: "delta"`: answer a mutation without the view (PADR-0038); the Player leaves it out. */
const replyShape = { reply: z.enum(['view', 'delta']).optional() };
/** Who made a change through MCP (the bridge sets it; absent = a person). */
const actor = z.strictObject({ kind: z.literal('agent'), client: z.string().regex(ACTOR_CLIENT) }).optional();
const undoSchema = revisionSchema.extend({ actor, ...replyShape });
const actSchema = revisionSchema.extend({ action, actor, ...replyShape });
const resetSchema = revisionSchema.extend({ confirmed: z.literal(true), actor, ...replyShape });
const variantSchema = revisionSchema.extend({ confirmed: z.literal(true), taskId: z.string().min(1).max(128).optional() });
/** Starting the demonstration replaces the current attempt, so it is confirmed like a reset. */
const demonstrationSchema = revisionSchema.extend({ confirmed: z.literal(true) });
const bootstrapSchema = z.strictObject({ code: z.string().min(1).max(128) });
function withoutView(reply: 'view' | 'delta' | undefined, value: HostReply<MutationReply>): HostReply<MutationReply | MutationDeltaReply> {
  if (reply !== 'delta' || !value.ok) return value;
  const { view: _view, ...rest } = value.value;
  return { ok: true, value: rest };
}
/** The request target as a URL of this listener; a target that is not a valid URL is a 400, never a throw. */
export function requestUrl(target: string | undefined, origin: string): URL {
  try { return new URL(target ?? "/", origin); } catch { throw new HostError("invalid_request", "Request target is not a valid URL"); }
}
function equal(a: string, b: string): boolean { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export function status(code: HostErrorCode): number {
  if (["token_required", "token_invalid", "bootstrap_used", "bootstrap_expired"].includes(code)) return 401;
  if (code === "host_rejected") return 421;
  if (code === "origin_rejected" || code === "author_required") return 403;
  if (code === "json_required") return 415;
  if (code === "body_too_large" || code === "result_too_large") return 413;
  if (code === "rate_limited" || code === "limit_exceeded" || code === "action_budget_exhausted" || code === "check_budget_exhausted") return 429;
  if (code === "not_found") return 404;
  if (code === "method_not_allowed") return 405;
  if (["session_busy", "project_store_busy", "stale_base", "real_tool_disagrees", "replay_mismatch", "demonstration_running", "demonstration_attempt"].includes(code)) return 409;
  if (["mirror_timeout", "mirror_unavailable", "diagnostic_unavailable", "browser_budget_exhausted"].includes(code)) return 503;
  if (code === "diagnostic_limit") return 413;
  return 400;
}
function headers(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", PLAYER_CSP);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}
function requireReplyBudget(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value)) > HOST_LIMITS.replyBytes - 2048) throw new HostError('result_too_large', 'Result exceeds HTTP budget before admission');
}
/** A cleanup step's own outcome when it is a close under the contract (the controller's); any other
 * value counts as done. */
const closingOf = (value: unknown): Closing => Promise.resolve(value).then(settled => typeof settled === 'object' && settled !== null && 'outcome' in settled ? settled as { outcome: 'closed' } : undefined);
/** After a failed start, every cleanup step is tried on its own under the close contract (PADR-0050),
 * each with its own deadline, and none of them replaces the start's failure; a step that did not close
 * is kept next to it (issue #64). */
async function cleanUpAfterStart(failure: unknown, ...steps: Array<(deadline: number) => unknown>): Promise<unknown> {
  for (const step of steps) await closeAfterFailure(failure, deadline => closingOf(step(deadline)));
  return failure;
}
/** A practice host started for the author is answered only when its reply fits the budget; one that
 * does not is closed again under the close contract, and the budget's refusal stays the error (issue #64). */
/** The named failure an HTTP request answers for an error its route threw. Anything unnamed is
 * `mirror_unavailable` without its message: no internal detail reaches the browser. A practice host
 * whose start found the browser budget full answers `browser_budget_exhausted` with the counts and the
 * remedy (PADR-0050). */
export function httpFailure(error: unknown): { code: HostErrorCode; message: string } {
  if (error instanceof HostError && error.code !== "E_NETWORK_AVAILABLE") return { code: error.code, message: error.message };
  if (error instanceof AuthorHostError || error instanceof ProjectStoreError || error instanceof AuthoringError || error instanceof CheckerError) return { code: String(error.code) as HostErrorCode, message: error.message };
  if (error instanceof BrowserBudgetError) return { code: 'browser_budget_exhausted', message: error.message };
  if (error instanceof z.ZodError) return { code: 'invalid_request', message: 'Recording or scene data does not match its schema' };
  if (error instanceof Error && /^(recording_|replay_mismatch:)/.test(error.message)) return { code: error.message.split(':')[0] as HostErrorCode, message: 'Recording data was rejected' };
  return { code: "mirror_unavailable", message: "Session request could not be completed" };
}
export async function admitChildHost(child: Pick<RunningHost, 'close'>, value: unknown): Promise<void> {
  try { requireReplyBudget({ ok: true, value }); } catch (error) { throw await closeAfterFailure(error, deadline => child.close(deadline)); }
}
/**
 * How a practice host's start that its parent stopped settled, as a close (re-review of PR #69): the
 * expected end of an aborted start is *cancelled*, or the outcome of its browser's close under the
 * deadline handed down (*abandoned* included). A cleanup step of the start that did not close (its
 * credential's removal, its diagnostics, a failed browser close) is *failed*, so the parent's
 * shutdown is not reported clean.
 */
export function childStartOutcome(error: unknown): CloseResult {
  const cleanup = typeof error === 'object' && error !== null && Object.hasOwn(error, 'closeError') ? (error as { closeError: unknown }).closeError : undefined;
  if (cleanup !== undefined) return { outcome: 'failed', error: cleanup };
  const browser = error instanceof AdapterInitializationError ? error.closeResult : undefined;
  if (browser?.outcome === 'failed' || browser?.outcome === 'abandoned') return browser;
  return CANCELLED;
}
/**
 * The practice hosts an author host starts, from the first moment of their start (review of PR #69,
 * Codex 3). The author host's shutdown stops every start under way — an abort that carries the
 * close's deadline, so the child's mirror start closes what it owns by then — and closes what each
 * start became; a start that finishes after the shutdown began is closed and refused, never published.
 */
export class ChildHosts {
  private readonly running = new Set<Pick<RunningHost, 'close'>>();
  private readonly starting = new Set<{ stop: AbortController; started: Promise<Pick<RunningHost, 'close'>> }>();
  private closing: number | undefined;
  /** Running and starting children: what the author host's limit counts. */
  get size(): number { return this.running.size + this.starting.size; }
  /** Starts a child with `start(signal)` and publishes it once `admit` has answered for it. */
  async launch<C extends Pick<RunningHost, 'close'>, T>(start: (signal: AbortSignal) => Promise<C>, admit: (child: C) => Promise<T>): Promise<T> {
    if (this.closing !== undefined) throw new HostError('mirror_unavailable', 'Session closed');
    const stop = new AbortController(), started = start(stop.signal), pending = { stop, started };
    this.starting.add(pending);
    try {
      const child = await started;
      const value = await admit(child);
      if (this.closing !== undefined) { await child.close(this.closing).catch(() => undefined); throw new HostError('mirror_unavailable', 'Session closed'); }
      this.running.add(child);
      return value;
    } finally { this.starting.delete(pending); }
  }
  /** The shutdown: no child starts any more, every start under way is stopped with `deadline`, and
   * there is one close for every child, running or starting. */
  shutDown(deadline: number): Array<(by: number) => Closing> {
    this.closing = deadline;
    const closes = [...this.running].map(child => (by: number): Closing => child.close(by));
    for (const { stop, started } of this.starting) {
      stop.abort(new CloseRequested(deadline));
      closes.push(by => started.then(child => child.close(by), childStartOutcome));
    }
    this.running.clear();
    return closes;
  }
}
function json(response: ServerResponse, code: number, value: unknown): void {
  let bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > HOST_LIMITS.replyBytes) { code = 413; bytes = Buffer.from(JSON.stringify({ ok: false, error: { code: "result_too_large", message: "Result exceeds HTTP budget" } })); }
  response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length }); response.end(bytes);
}
function failure(response: ServerResponse, code: HostErrorCode, message: string): void { json(response, status(code), { ok: false, error: { code, message } }); }
async function body(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) throw new HostError("json_required", "Writes require application/json");
  if (request.headers["content-encoding"] !== undefined) throw new HostError("invalid_request", "Encoded bodies are not accepted");
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > HOST_LIMITS.bodyBytes)) throw new HostError("body_too_large", "Request exceeds body budget");
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []; let length = 0; let settled = false;
    const fail = (error: Error): void => { if (settled) return; settled = true; clearTimeout(timer); request.resume(); reject(error); };
    const timer = setTimeout(() => fail(new HostError("invalid_request", "Request body timed out")), HOST_LIMITS.requestTimeoutMs);
    request.on("data", (chunk: Buffer) => { if (settled) return; length += chunk.length; if (length > HOST_LIMITS.bodyBytes) fail(new HostError("body_too_large", "Request exceeds body budget")); else chunks.push(chunk); });
    request.on("aborted", () => fail(new HostError("invalid_request", "Request was aborted")));
    request.on("error", () => fail(new HostError("invalid_request", "Request could not be read")));
    request.on("end", () => {
      if (settled) return; settled = true; clearTimeout(timer);
      try { resolveBody(parseJsonEntry(Buffer.concat(chunks), "request", 16)); } catch { reject(new HostError("invalid_request", "Request must contain bounded valid JSON")); }
    });
  });
}
/** Explicit offline run only. This is a bounded sample, not a general network sandbox. */
export async function probeOfflineNetwork(): Promise<Record<string, string>> {
  const tcp = (host: string, port: number): Promise<string> => new Promise(resolveProbe => {
    const socket = connect({ host, port }); let settled = false;
    const end = (value: string): void => { if (settled) return; settled = true; socket.destroy(); resolveProbe(value); };
    socket.setTimeout(HOST_LIMITS.networkProbeMs, () => end("TIMEOUT"));
    socket.once("connect", () => end("CONNECTED")); socket.once("error", (error: NodeJS.ErrnoException) => end(error.code ?? "ERROR"));
  });
  const resolver = new Resolver({ timeout: HOST_LIMITS.networkProbeMs, tries: 1 });
  const dns = resolver.resolve4("registry.npmjs.org").then(() => "RESOLVED", () => "BLOCKED");
  const https = fetch("https://registry.npmjs.org/-/ping", { signal: AbortSignal.timeout(HOST_LIMITS.networkProbeMs) }).then(r => { void r.body?.cancel(); return "HTTP_" + r.status; }, () => "BLOCKED");
  const [external, loopback, name, web] = await Promise.all([tcp("1.1.1.1", 443), tcp("127.0.0.1", 9), dns, https]);
  const result = { tcp_1_1_1_1_443: external, tcp_loopback_9: loopback, dns: name, https: web };
  if (external === "CONNECTED" || name === "RESOLVED" || web.startsWith("HTTP_")) throw new HostError("E_NETWORK_AVAILABLE", "Offline start refused: network probe succeeded");
  return result;
}
export async function startHost(world: World, options: HostOptions = {}): Promise<RunningHost> {
  if (options.requireOffline) await probeOfflineNetwork();
  const assetDir = options.assetDirectory ?? (import.meta.url.endsWith(".ts") ? sourceBuildDirectory("player") : fileURLToPath(new URL("../player/assets/", import.meta.url)));
  const assets = new Map<string, { bytes: Buffer; mime: string }>();
  for (const [path, name, mime] of [["/", "index.html", "text/html; charset=utf-8"], ["/player.js", "player.js", "text/javascript; charset=utf-8"], ["/player.css", "player.css", "text/css; charset=utf-8"], ["/tokens.css", "tokens.css", "text/css; charset=utf-8"]]) {
    assets.set(path!, { bytes: await readFile(resolve(assetDir, name!)), mime: mime! });
  }
  const token = randomBytes(32).toString("hex"), authorToken=options.phase3?randomBytes(32).toString('hex'):undefined;
  // One-use bootstrap codes. At most one is outstanding: issuing a new one revokes the previous
  // unused code. Every issued code is remembered (bounded) for replay detection and redaction.
  const issued: string[] = []; const consumed = new Set<string>(); let outstanding: { code: string; at: number } | undefined;
  const issueCode = (): string => {
    if (issued.length >= HOST_LIMITS.bootstrapIssued) throw new HostError('limit_exceeded', 'Bootstrap link budget exhausted; restart the session');
    const fresh = randomBytes(16).toString('hex'); issued.push(fresh); outstanding = { code: fresh, at: Date.now() }; return fresh;
  };
  const code = issueCode();
  const credential = await createTokenFile(options.tokenDirectory ?? dataPaths().host, token);
  let diagnostics: Awaited<ReturnType<typeof privateDiagnostics>>;
  try { diagnostics = await privateDiagnostics(credential.path, token, () => issued, authorToken); }
  catch { await credential.remove(); throw new DiagnosticError('diagnostic_unavailable'); }
  let controller: PracticeController;
  const sessionOptions: PracticeSessionOptions = { ...options, onMirrorDiagnostic: record => diagnostics.write(record), onBrowserClose: record => diagnostics.write(record), admitView: view => requireReplyBudget({ ok: true, value: { view } }) };
  try { controller = await (options.controllerFactory ?? createPracticeSession)(world, sessionOptions); }
  catch (error) { throw await cleanUpAfterStart(error, () => diagnostics.discard(), () => credential.remove()); }
  // The bundled example's demonstration owns the session while it runs; every surface goes through it.
  // Under a check limit (`--checks`, PADR-0040) it would spend the attempt's changes and checks: none.
  let demonstration: DemonstrationControl | undefined;
  if (options.demonstration && options.checks === undefined && demonstrationWorld(world)) ({ controller, demonstration } = withDemonstration(controller, world, options.demonstrationPause ? { pause: options.demonstrationPause } : {}));
  const playerInfo = (): { modelOnly?: ModelOnlyNotice; demonstration?: DemonstrationInfo } => ({
    ...(options.modelOnly && options.mirror === 'off' ? { modelOnly: structuredClone(options.modelOnly) } : {}),
    ...(demonstration ? { demonstration: { tasks: demonstration.tasks(), status: demonstration.status() } } : {}),
  });
  let author: AuthorController | undefined;
  let editorAssets: Awaited<ReturnType<typeof startEditorAssets>> | undefined;
  if (options.phase3) {
    try { author = await createAuthorController(options.localDirectory ?? dataPaths().home); }
    catch (error) { throw await cleanUpAfterStart(error, deadline => controller.close(deadline), () => diagnostics.discard(), () => credential.remove()); }
  }
  let origin = ""; let busy = false;
  const children = options.childHosts ?? new ChildHosts();
  const budget = new RequestBudget(), preAuthBudget = new RequestBudget(), bootstrapBudget = new RequestBudget(); const streams = new Set<ServerResponse>();
  const sendEvent = (response: ServerResponse, event: HostEvent): void => {
    const bytes = Buffer.from(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    if (bytes.length > HOST_LIMITS.replyBytes || response.writableLength + bytes.length > HOST_LIMITS.sseQueuedBytes) { response.destroy(); streams.delete(response); return; }
    response.write(bytes);
  };
  const unsubscribe = controller.subscribe(event => { for (const response of streams) sendEvent(response, event); });
  const server = createServer({ maxHeaderSize: HOST_LIMITS.headerBytes, headersTimeout: HOST_LIMITS.headersTimeoutMs, requestTimeout: HOST_LIMITS.requestTimeoutMs, connectionsCheckingInterval: 1000 }, (request, response) => {
    const transactionContext={deadline:performance.now()+HOST_TRANSACTION_MS};
    headers(response);
    if (editorAssets) response.setHeader('Content-Security-Policy', PLAYER_CSP.replace("frame-src 'none'", `frame-src ${editorAssets.origin}`));
    void (async () => {
      if (request.headers.host !== origin.slice(7)) throw new HostError("host_rejected", "Host is not this loopback listener");
      if (request.headers.origin !== undefined && request.headers.origin !== origin) throw new HostError("origin_rejected", "Origin is not this player");
      const url = requestUrl(request.url, origin);
      if (url.origin !== origin) throw new HostError("host_rejected", "Request target is not this listener");
      if ([...url.searchParams.keys()].some(key => /token/i.test(key)) || [...url.searchParams.values()].some(value => equal(value, token)||(authorToken!==undefined&&equal(value,authorToken)))) throw new HostError("token_in_query", "Credentials must be sent in headers");
      const staticAsset = assets.get(url.pathname);
      if (staticAsset) {
        if (request.method !== "GET" && request.method !== "HEAD") throw new HostError("method_not_allowed", "Asset requires GET or HEAD");
        response.writeHead(200, { "Content-Type": staticAsset.mime, "Content-Length": staticAsset.bytes.length }); response.end(request.method === "HEAD" ? undefined : staticAsset.bytes); return;
      }
      const capability=Object.hasOwn(HTTP_CAPABILITIES,url.pathname)?HTTP_CAPABILITIES[url.pathname]:undefined;
      if (!capability || (!options.phase3 && Object.values(AUTHOR_ROUTES).includes(url.pathname as typeof AUTHOR_ROUTES[keyof typeof AUTHOR_ROUTES]))) throw new HostError("not_found", "Route does not exist");
      if (url.pathname === HOST_ROUTES.bootstrap) {
        if (!bootstrapBudget.take()) throw new HostError("rate_limited", "Bootstrap rate exceeds admission budget");
        if (request.method !== "POST") throw new HostError("method_not_allowed", "Bootstrap requires POST");
        const payload = bootstrapSchema.safeParse(await body(request));
        if (!payload.success) throw new HostError("invalid_request", "Invalid bootstrap request");
        const supplied = payload.data.code;
        if ([...consumed].some(used => equal(supplied, used))) throw new HostError("bootstrap_used", "Bootstrap code has already been consumed");
        const current = outstanding;
        if (!current || !equal(supplied, current.code)) throw new HostError("token_invalid", "Bootstrap code is invalid");
        if (Date.now() - current.at >= HOST_LIMITS.bootstrapTtlMs) { outstanding = undefined; throw new HostError("bootstrap_expired", "Bootstrap code has expired"); }
        const bootstrapReply = { ok: true, value: { token, view: controller.view(), ...(authorToken?{authorToken}:{}), ...(editorAssets ? { engineOrigin: editorAssets.origin, authorEnabled: true } : {}), ...playerInfo() } };
        requireReplyBudget(bootstrapReply);
        outstanding = undefined; consumed.add(current.code); json(response, 200, bootstrapReply); return;
      }
      const supplied = request.headers[TOKEN_HEADER.toLowerCase()];
      if (supplied === undefined) {
        if (!preAuthBudget.take()) throw new HostError("rate_limited", "Unauthenticated request rate exceeds admission budget");
        throw new HostError("token_required", "Session token header is required");
      }
      const tokenHeaders = request.rawHeaders.filter((_, index) => index % 2 === 0).filter(name => name.toLowerCase() === TOKEN_HEADER.toLowerCase());
      const authorAuthority=typeof supplied==='string'&&authorToken!==undefined&&equal(supplied,authorToken);
      const practiceAuthority=typeof supplied==='string'&&equal(supplied,token);
      if (typeof supplied !== "string" || tokenHeaders.length !== 1 || (!practiceAuthority&&!authorAuthority)) {
        if (!preAuthBudget.take()) throw new HostError("rate_limited", "Unauthenticated request rate exceeds admission budget");
        throw new HostError("token_invalid", "Session token is invalid");
      }
      if (!budget.take()) throw new HostError("rate_limited", "Request rate exceeds session budget");
      if(capability==='author'&&!authorAuthority)throw new HostError('author_required','Author capability is required for this route');
      if (url.pathname === HOST_ROUTES.resume) {
        if (request.method !== 'GET') throw new HostError('method_not_allowed', 'Session resume requires GET');
        if (url.searchParams.size) throw new HostError('invalid_request', 'Session resume accepts no query data');
        const value = { view: controller.view(), ...(editorAssets ? { engineOrigin: editorAssets.origin, authorEnabled: authorAuthority } : {}), ...playerInfo() };
        requireReplyBudget({ ok: true, value }); json(response, 200, { ok: true, value }); return;
      }
      if (options.phase3 && [AUTHOR_ROUTES.observe, AUTHOR_ROUTES.recording, AUTHOR_ROUTES.scene, AUTHOR_ROUTES.project, AUTHOR_ROUTES.projects].includes(url.pathname as typeof AUTHOR_ROUTES.observe) && request.method === 'GET') {
        let value: unknown;
        if (url.pathname === AUTHOR_ROUTES.observe) value = await author!.view();
        else if (url.pathname === AUTHOR_ROUTES.recording) {
          if (url.searchParams.size !== 1 || !url.searchParams.has('id')) throw new HostError('invalid_request', 'Recording read needs one id');
          value = await author!.read(url.searchParams.get('id')!);
        } else if (url.pathname === AUTHOR_ROUTES.scene) { if (!controller.scene) throw new HostError('unmodeled', 'Editor input is unavailable'); value = controller.scene(); }
        else if (url.pathname === AUTHOR_ROUTES.projects) value = (await author!.view()).savedProjects ?? [];
        else value = (await author!.view()).project;
        requireReplyBudget({ ok: true, value }); json(response, 200, { ok: true, value }); return;
      }
      if ([HOST_ROUTES.observe, HOST_ROUTES.events, HOST_ROUTES.tool].includes(url.pathname as typeof HOST_ROUTES.observe)) {
        if (request.method !== "GET") throw new HostError("method_not_allowed", "Read route requires GET");
        if (url.pathname === HOST_ROUTES.observe) { json(response, 200, { ok: true, value: controller.view() }); return; }
        if (url.pathname === HOST_ROUTES.events) {
          if (streams.size >= HOST_LIMITS.sseClients) throw new HostError("limit_exceeded", "SSE client budget exceeded");
          response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Connection": "keep-alive" }); streams.add(response);
          response.on("close", () => streams.delete(response)); sendEvent(response, { type: "ready", view: controller.view() });
          if (demonstration) sendEvent(response, { type: "demonstration", status: demonstration.status() });
          return;
        }
        const reply = await controller.png(transactionContext);
        if (!reply.ok) { failure(response, reply.error.code, reply.error.message); return; }
        if (reply.value.length > HOST_LIMITS.replyBytes) throw new HostError("result_too_large", "Tool image exceeds HTTP budget");
        response.writeHead(200, { "Content-Type": "image/png", "Content-Length": reply.value.length }); response.end(reply.value); return;
      }
      if (request.method !== "POST") throw new HostError("method_not_allowed", "Mutation requires POST");
      const payload = await body(request);
      if (busy) throw new HostError("session_busy", "Session is applying another transaction");
      busy = true;
      try {
        let reply: HostReply<unknown>;
        const checked = <T>(schema: z.ZodType<T>): T => { const result = schema.safeParse(payload); if (!result.success) throw new HostError("invalid_request", "Request does not match route schema"); return result.data; };
        switch (url.pathname) {
          case HOST_ROUTES.act: { const parsed = checked(actSchema); reply = withoutView(parsed.reply, await controller.act({ expectedRevision: parsed.expectedRevision, action: { name: parsed.action.name, params: parsed.action.params, ...(parsed.action.baseStep === undefined ? {} : { baseStep: parsed.action.baseStep }) }, ...(parsed.actor ? { actor: { kind: 'agent' as const, client: parsed.actor.client } } : {}) },transactionContext)); break; }
          case HOST_ROUTES.reset: { const parsed = checked(resetSchema); reply = withoutView(parsed.reply, await controller.reset({ expectedRevision: parsed.expectedRevision, confirmed: parsed.confirmed, ...(parsed.actor ? { actor: { kind: 'agent' as const, client: parsed.actor.client } } : {}) },transactionContext)); break; }
          case HOST_ROUTES.variant: { const parsed = checked(variantSchema); reply = await controller.variant({ expectedRevision: parsed.expectedRevision, confirmed: parsed.confirmed, ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }) },transactionContext); break; }
          case HOST_ROUTES.undo: { const parsed = checked(undoSchema); reply = withoutView(parsed.reply, await controller.undo({ expectedRevision: parsed.expectedRevision, ...(parsed.actor ? { actor: { kind: 'agent' as const, client: parsed.actor.client } } : {}) },transactionContext)); break; }
          case HOST_ROUTES.hint: reply = await controller.hint(checked(revisionSchema),transactionContext); break;
          case HOST_ROUTES.check: reply = await controller.check(checked(revisionSchema),transactionContext); break;
          case HOST_ROUTES.export: reply = await controller.export(checked(revisionSchema),transactionContext); break;
          case HOST_ROUTES.demonstration: {
            if (!demonstration) throw new HostError('not_found', 'This session offers no demonstration');
            reply = await demonstration.start(checked(demonstrationSchema), transactionContext); break;
          }
          case HOST_ROUTES.demonstrationStop: {
            if (!demonstration) throw new HostError('not_found', 'This session offers no demonstration');
            checked(z.strictObject({})); reply = demonstration.stop(); break;
          }
          case AUTHOR_ROUTES.start: {
            const parsed = checked(revisionSchema.extend({ metadata: z.strictObject({ author: z.string().min(1).max(4096), license: z.string().min(1).max(256), consent: z.string().min(1).max(4096), demonstration: z.enum(['scripted', 'human']) }), initial: z.unknown(), fontsReady: z.literal(true) }));
            reply = { ok: true, value: await author!.start(parsed as Parameters<AuthorController['start']>[0]) }; break;
          }
          case AUTHOR_ROUTES.gesture: {
            const parsed = checked(revisionSchema.extend({ gesture: z.unknown() }));
            reply = { ok: true, value: await author!.gesture(parsed as Parameters<AuthorController['gesture']>[0]) }; break;
          }
          case AUTHOR_ROUTES.stop: reply = { ok: true, value: await author!.stop(checked(revisionSchema)) }; break;
          case AUTHOR_ROUTES.delete: { const parsed = checked(revisionSchema.extend({ id: z.string().min(1).max(64) })); reply = { ok: true, value: await author!.delete(parsed.id, parsed.expectedRevision) }; break; }
          case AUTHOR_ROUTES.analyze: reply = { ok: true, value: await author!.analyze(checked(revisionSchema).expectedRevision) }; break;
          case AUTHOR_ROUTES.project: { const parsed = checked(revisionSchema.extend({ project: z.unknown() })); reply = { ok: true, value: await author!.project(parsed.project as Parameters<AuthorController['project']>[0], parsed.expectedRevision) }; break; }
          case AUTHOR_ROUTES.confirm: { const parsed = checked(revisionSchema.extend({ confirmation: z.strictObject({ hypothesisId: z.string().min(1).max(128), evidence: z.strictObject({ recordingId: z.string().min(1).max(64), gestureIndex: revision, sha256: z.string().regex(/^[a-f0-9]{64}$/) }) }) })); reply = { ok: true, value: await author!.confirm(parsed) }; break; }
          case AUTHOR_ROUTES.compile: reply = { ok: true, value: await author!.compile(checked(revisionSchema).expectedRevision) }; break;
          case AUTHOR_ROUTES.prepare: {
            const parsed = checked(revisionSchema.extend({ title: z.string().trim().min(1).max(256), author: z.string().trim().min(1).max(256), labels: z.tuple([z.string().trim().min(1).max(128), z.string().trim().min(1).max(128), z.string().trim().min(1).max(128)]) }));
            reply = { ok: true, value: await author!.prepare(parsed) }; break;
          }
          case AUTHOR_ROUTES.configure: {
            const text = z.strictObject({ en: z.string().min(1).max(8192), de: z.string().min(1).max(8192) });
            const parsed = checked(revisionSchema.extend({ intent: z.strictObject({ schema: z.literal('practonaut.repair-intent/1'), title: text, removedStepId: z.string().min(1).max(64), predecessorId: z.string().min(1).max(64), successorId: z.string().min(1).max(64), reviewedExamples: z.boolean(), cases: z.array(z.strictObject({ id: z.string().min(1).max(64), labels: z.tuple([z.string().min(1).max(128), z.string().min(1).max(128), z.string().min(1).max(128)]), offset: z.strictObject({ x: z.number().int(), y: z.number().int() }) })).max(16) }) }));
            reply = { ok: true, value: await author!.configure(parsed) }; break;
          }
          case AUTHOR_ROUTES.save: reply = { ok: true, value: await author!.save(checked(revisionSchema).expectedRevision) }; break;
          case AUTHOR_ROUTES.open: { const parsed = checked(revisionSchema.extend({ projectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })); reply = { ok: true, value: await author!.open(parsed) }; break; }
          case AUTHOR_ROUTES.deleteProject: { const parsed = checked(revisionSchema.extend({ projectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) })); reply = { ok: true, value: await author!.deleteProject(parsed) }; break; }
          case AUTHOR_ROUTES.launch: {
            const parsed = checked(revisionSchema.extend({ worldSha256: z.string().regex(/^[a-f0-9]{64}$/) }));
            if (children.size >= 4) throw new HostError('limit_exceeded', 'Close this author session to release practice hosts');
            const compiledWorld = await author!.compiledWorld(parsed.expectedRevision, parsed.worldSha256);
            const value = await children.launch(signal => startHost(compiledWorld, { mirror: 'required', tokenDirectory: options.tokenDirectory ?? dataPaths().host, assetDirectory: assetDir, phase3: false, signal }),
              async child => { const answer = { url: child.url, worldSha256: parsed.worldSha256 }; await admitChildHost(child, answer); return answer; });
            reply = { ok: true, value }; break;
          }
          case AUTHOR_ROUTES.fromScenes: {
            const element = z.record(z.string().max(64), z.unknown());
            const parsed = checked(revisionSchema.extend({ start: z.array(element).max(1000), goal: z.array(element).max(1000), layout: z.literal('relative').optional(), align: z.boolean().optional() }));
            if ((await author!.view()).revision !== parsed.expectedRevision) throw new HostError('stale_base', 'Author view changed; observe again');
            if (children.size >= 4) throw new HostError('limit_exceeded', 'Close this author session to release practice hosts');
            // The scenes are untrusted drawings; from-scenes parses them with the independent checker parser
            // and refuses (named code) unless the goal passes and the start fails for every variant.
            const scene = (elements: unknown[]): string => JSON.stringify({ type: 'excalidraw', version: 2, source: 'practonaut-editor', elements });
            // In a worker with a deadline: the derivation must not block this listener's event loop.
            const made = await fromScenesBounded(scene(parsed.start), scene(parsed.goal), { worldId: 'drawn-task', taskId: 'drawn', ...(parsed.layout ? { layout: parsed.layout } : {}), ...(parsed.align ? { align: true } : {}) });
            const value = await children.launch(signal => startHost(made.world, { mirror: options.mirror ?? 'required', tokenDirectory: options.tokenDirectory ?? dataPaths().host, assetDirectory: assetDir, phase3: false, signal }), async child => {
              const answer: AuthorFromScenesReply = { url: child.url, task: { title: made.task.title, prompt: made.task.prompt, conditions: made.task.conditionTexts ?? [] },
                summary: { ...made.summary, oracleActions: made.oracle.steps.length, nearMisses: made.oracle.nearMisses.length, unmodeled: made.unmodeled.start.length + made.unmodeled.goal.length } };
              await admitChildHost(child, answer); return answer;
            });
            reply = { ok: true, value }; break;
          }
          case AUTHOR_ROUTES.editor: {
            if (!controller.editor) throw new HostError('unmodeled', 'Editor input is unavailable');
            const parsed = checked(revisionSchema.extend({ before: z.array(z.unknown()).max(1000), after: z.array(z.unknown()).max(1000), boundary: z.enum(['pointerup', 'key', 'quiet', 'stop']) }));
            reply = await controller.editor(parsed as Parameters<NonNullable<typeof controller.editor>>[0],transactionContext); break;
          }
          default: throw new HostError("not_found", "Mutation route does not exist");
        }
        json(response, reply.ok ? 200 : status(reply.error.code), reply);
      } finally { busy = false; }
    })().catch((error: unknown) => {
      request.resume();
      if (response.headersSent) { response.destroy(); return; }
      const named = httpFailure(error);
      failure(response, named.code, named.message);
    });
  });
  server.keepAliveTimeout = 5000;
  server.on("upgrade", (_request, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); });
  const heartbeat = setInterval(() => { for (const response of streams) sendEvent(response, { type: "heartbeat", revision: controller.view().revision }); }, HOST_LIMITS.heartbeatMs); heartbeat.unref();
  try {
    await new Promise<void>((ready, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); ready(); }); });
  } catch (error) { clearInterval(heartbeat); throw await cleanUpAfterStart(error, unsubscribe, deadline => controller.close(deadline), () => diagnostics.discard(), () => credential.remove()); }
  const address = server.address(); if (!address || typeof address === "string") throw new HostError("host_rejected", "Listener address unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  if (options.phase3) {
    try { editorAssets = await startEditorAssets(origin); }
    // The listener's close ends every connection and event stream first: an open stream must not hold it
    // (and every step after it) for good.
    catch (error) {
      clearInterval(heartbeat);
      const closeListener = (): Promise<void> => new Promise<void>(done => { for (const response of streams) response.destroy(); server.close(() => done()); server.closeAllConnections(); });
      throw await cleanUpAfterStart(error, unsubscribe, closeListener, () => author?.close(), deadline => controller.close(deadline), () => diagnostics.discard(), () => credential.remove());
    }
  }
  let closePromise: Promise<void> | undefined;
  return { origin, url: `${origin}/#code=${code}`, port: address.port, token, code, tokenFile: credential.path, issueUrl() { return `${origin}/#code=${issueCode()}`; }, close(deadline?: number) {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      // Every browser close below gets one deadline (PADR-0050) and settles by it as closed, abandoned
      // or failed; the host arms no timer of its own at or before it. Its safety timer ends later than
      // that deadline, and its firing counts as a failure.
      const requested = performance.now(), browsers = deadline ?? closeDeadline(requested);
      const overall = Math.max(requested + 12_000, browsers + CLOSE_SAFETY_MS); let failed = false;
      /** A step that closes no browser: within the close bound, and never past the safety bound. */
      const step = async (operation: () => Promise<void>): Promise<void> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([Promise.resolve().then(operation), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Session close deadline reached')), Math.max(1, Math.min(CLOSE_BOUND_MS, overall - performance.now())));
        })]); } catch { failed = true; } finally { clearTimeout(timer); }
      };
      /** A close under the contract: the deadline goes down, the outcome comes up. An abandoned close
       * does not fail the host's close (its session recorded it); only a failed one does. Its safety
       * timer, 1 s after the deadline, leaves the diagnostics and the credential their time within
       * the overall bound. */
      const browserStep = async (close: (by: number) => Closing): Promise<void> => { if ((await closeBy(close, browsers)).outcome === 'failed') failed = true; };
      const childStep = async (close: (by: number) => Closing): Promise<void> => { if ((await closeBy(close, browsers, Math.max(browsers + CLOSE_SAFETY_MS, overall - CLOSE_SAFETY_MS))).outcome === 'failed') failed = true; };
      clearInterval(heartbeat);
      try { unsubscribe(); } catch { failed = true; }
      for (const response of streams) { try { response.destroy(); } catch { failed = true; } }
      try {
        await Promise.all([
          step(() => new Promise<void>((done, reject) => { server.close(error => error ? reject(error) : done()); server.closeAllConnections(); })),
          // A child is a whole host: its own diagnostics and credential steps run after `browsers`, so
          // its safety timer leaves room for them within this host's overall bound.
          ...children.shutDown(browsers).map(close => childStep(close)),
          step(() => author?.close() ?? Promise.resolve()), step(() => editorAssets?.close() ?? Promise.resolve()), browserStep(by => controller.close(by)),
        ]);
      } finally {
        try { await step(() => diagnostics.close()); }
        finally { await step(() => credential.remove()); }
      }
      if (failed) throw new HostError('mirror_unavailable', 'Session shutdown could not be fully confirmed');
    })();
    return closePromise;
  } };
}

/** Supervised product evidence. Public synthetic practice only; never a sealed C5 claim. */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import type { RunningHost, HostReply, HostView, HostEvent } from "../src/host/protocol.ts";
import { TOKEN_HEADER } from "../src/host/protocol.ts";
import type { World } from "../src/world/types.ts";
import { startHost } from "../src/host/server.ts";
import { packWorld, readWorldPackage } from "../src/package/index.ts";
import { loadWorldPackage } from "../src/world/index.ts";
import { checkInProcess } from "../src/cli/runtime.ts";
import { assertOracle, fixture, changed } from "../tests/e2e/harness.ts";
import { bindClient, assertClientUnchanged } from "../src/evaluation/client.ts";
import { boundedProcess } from "../src/evaluation/process.ts";
import { createPrivateOutput } from "../src/evaluation/private-output.ts";
import {HOST_ROUTES} from '../src/host/protocol.ts';
import {HOST_LIMITS} from '../src/host/limits.ts';
import {parseExportPair,type CurrentSessionExport} from '../src/host/export-pair.ts';
import {canonicalJson,sha256Hex,stateHash} from '../src/canonical/index.ts';
import {parseExcalidraw} from '../src/checker/excalidraw.ts';
import {evaluatePredicate} from '../src/predicate/index.ts';
import {generateVariant} from '../src/world/variant.ts';

export interface NativeToolUse { name: string; input?: unknown }
export interface SingleActionEvidence {
  schema: 'practonaut.single-action/1'; nativeActCount: 1; committedActions: 1;
  prefixLength: number; beforeStep: number; finalStep: number; actionRevision: number;
  goalProgress: 'not-assessed' | 'monotone-original-arguments';
  goalArguments?: { before: boolean[]; after: boolean[]; advanced: number[] };
}
export type SingleGoalActionEvidence = SingleActionEvidence & {
  goalProgress: 'monotone-original-arguments'; goalArguments: NonNullable<SingleActionEvidence['goalArguments']>;
};
/** Pure public-data evidence; this does not attest the client identity or execution origin. */
export function assertSingleAction(before: HostView, final: HostView, events: HostEvent[], tools: NativeToolUse[]): SingleActionEvidence {
  const fail = (message: string): never => { throw Error('Single goal action: ' + message); };
  const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
  const context = (view: HostView): void => {
    if (view.sessionId !== before.sessionId || !same(view.world, before.world) || view.seed !== before.seed || view.task.id !== before.task.id || view.variantId !== before.variantId || view.attempt !== before.attempt) fail('session, world, seed, task, variant or attempt changed');
    if (!Number.isSafeInteger(view.revision) || view.revision < 0 || view.revision < before.revision || !Number.isSafeInteger(view.step) || view.step < 0 || view.step !== view.log.length || stateHash(view.state) !== view.hash || (view.log.length > 0 && view.log.at(-1)!.hash !== view.hash)) fail('invalid revision, step, log or state hash');
    if (!same(view.log.slice(0, before.log.length), before.log)) fail('the complete original action-log prefix changed');
  };
  context(before); context(final);
  if (final.step !== before.step + 1 || final.log.length !== before.log.length + 1) fail('exactly one appended successful action is required');
  const entry = final.log[before.log.length]!;
  if (entry.hash !== final.hash || entry.action.baseStep !== before.step) fail('the appended action is not bound to the observed step and final hash');
  const acts = tools.filter(tool => tool.name === 'mcp__practonaut__act');
  if (acts.length !== 1) fail('exactly one native MCP act use is required');
  if (tools.some(tool => tool.name === 'mcp__practonaut__undo' || tool.name === 'mcp__practonaut__reset')) fail('undo or reset cannot prove an interleaving action');
  const input = acts[0]!.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('the native act input is missing');
  const request = input as { name?: unknown; params?: unknown; baseStep?: unknown; expectedRevision?: unknown };
  if (request.name !== entry.action.name || !same(request.params, entry.action.params) || request.baseStep !== before.step || !Number.isSafeInteger(request.expectedRevision)) fail('native act and committed action differ');
  let previous = before, actionRevision: number | undefined, ready = false;
  for (const event of events) {
    if (!('view' in event)) {
      if (event.revision !== previous.revision || (event.type === 'rejected' && event.hash !== previous.hash)) fail('event revision or rejection hash differs from the observed prefix');
      continue;
    }
    const view = event.view; context(view);
    if (event.type === 'ready') {
      if (ready || view.revision !== before.revision || !same(view.log, before.log) || view.hash !== before.hash) fail('public stream must begin at the complete original observation');
      ready = true;
    } else if (!ready) fail('public stream has no original ready observation');
    if (view.revision < previous.revision || view.revision > previous.revision + 1) fail('public stream revision guard is discontinuous');
    if (!same(view.log, previous.log)) {
      if (actionRevision !== undefined || !same(previous.log, before.log) || !same(view.log, final.log) || view.step !== before.step + 1 || view.revision !== previous.revision + 1) fail('public stream does not contain exactly one complete action commit');
      if (request.expectedRevision !== previous.revision) fail('native act revision guard differs from its observed predecessor');
      actionRevision = view.revision;
    } else if (view.step !== previous.step || view.hash !== previous.hash) fail('state changed without an appended action');
    previous = view;
  }
  if (!ready || actionRevision === undefined || previous.revision !== final.revision || previous.step !== final.step || previous.hash !== final.hash || !same(previous.log, final.log)) return fail('final observation is not bound to the full public stream');
  return { schema: 'practonaut.single-action/1', nativeActCount: 1, committedActions: 1, prefixLength: before.log.length, beforeStep: before.step, finalStep: final.step, actionRevision, goalProgress: 'not-assessed' };
}
/** Optional stronger goal proof for a caller's original public author world. */
export function assertSingleGoalAction(before: HostView, final: HostView, events: HostEvent[], tools: NativeToolUse[], world: World): SingleGoalActionEvidence {
  const proof = assertSingleAction(before, final, events, tools);
  const fail = (message: string): never => { throw Error('Single goal action: ' + message); };
  const same = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
  if (!same({ id: world.id, version: world.version }, before.world)) fail('goal world differs from the observed world');
  const task = generateVariant(world, before.seed).tasks.find(task => task.id === before.task.id);
  if (!task) return fail('original public task goal is unavailable');
  // Keep every original top-level argument, including predicates with no UI narration.
  // Never split a quantified goal into separately satisfiable witnesses.
  const clauses = task.goal.op === 'all' ? task.goal.args : [task.goal];
  const values = (view: HostView): boolean[] => clauses.map(clause => {
    const checked = evaluatePredicate(clause, view.state);
    if (!checked.ok) return fail('original goal argument could not be evaluated: ' + checked.error.code);
    return checked.value;
  });
  const start = values(before), end = values(final);
  if (start.some((met, index) => met && !end[index])) fail('an original goal argument regressed');
  const advanced = start.flatMap((met, index) => !met && end[index] ? [index] : []);
  if (advanced.length === 0) fail('no original goal argument advanced');
  return { ...proof, goalProgress: 'monotone-original-arguments', goalArguments: { before: start, after: end, advanced } };
}

/** Caller supplies the digest of the installed tarball's regular dist CLI, never a .bin symlink. */
export interface InstalledMcpEntry { path: string; sha256: string; version: string }
export interface RealAgentOptions { clientPath?: string; world?: World; singleMutation?: boolean; singleGoalProgress?: boolean; timeoutMs?: number; installedMcpEntry?: InstalledMcpEntry }
export interface AgentMcpEntryEvidence {
  mode: 'source-wrapper' | 'installed-cli'; entryPath: string; nodeVersion: string;
  invocation: { command: string; args: string[] };
  entrySha256?: string; entrySize?: number; entryVersion?: string;
}
/** The entry is caller-bound evidence; its hash does not attest the package publisher or imports. */
export async function prepareAgentMcpEntry(host: Pick<RunningHost, 'origin' | 'tokenFile'>, installed?: InstalledMcpEntry, env: NodeJS.ProcessEnv = {}) {
  const sessionArgs = ['--host', host.origin, '--token-file', host.tokenFile];
  if (installed === undefined) {
    const entry = fileURLToPath(new URL('../src/cli/mcp.ts', import.meta.url));
    const config = { command: process.execPath, args: ['--input-type=module', '-e', `const {commandMcp}=await import(${JSON.stringify(entry)});process.exitCode=await commandMcp(process.argv.slice(1));`, '--', ...sessionArgs] };
    const evidence: AgentMcpEntryEvidence = { mode: 'source-wrapper', entryPath: entry, nodeVersion: process.version, invocation: config };
    return { config, evidence, assertUnchanged: async (): Promise<void> => {} };
  }
  const suffix = join('node_modules', 'practonaut', 'dist', 'cli', 'main.js');
  if (typeof installed.path !== 'string' || !isAbsolute(installed.path) || resolve(installed.path) !== installed.path || !installed.path.endsWith('/' + suffix)) throw Error('Installed MCP entry requires an absolute installed node_modules/practonaut/dist/cli/main.js path');
  if (typeof installed.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(installed.sha256)) throw Error('Installed MCP entry requires an explicit whole-file SHA256 hash');
  if (typeof installed.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(installed.version)) throw Error('Installed MCP entry requires an explicit package version');
  // Reuse the existing regular-file/full-byte binding and its before/after checks.
  const binding = await bindClient(installed.path);
  if (binding.sha256 !== installed.sha256) throw Error('Installed MCP entry hash differs from caller-bound bytes');
  const version = await boundedProcess(process.execPath, [binding.path, '--version'], { env, wallMs: 10000, bytes: 4096 });
  await assertClientUnchanged(binding);
  if (version.exitCode !== 0 || version.stdout.trim() !== installed.version) throw Error('Installed MCP entry version probe differs from caller-bound version');
  const config = { command: process.execPath, args: [binding.path, 'mcp', ...sessionArgs] };
  const evidence: AgentMcpEntryEvidence = { mode: 'installed-cli', entryPath: binding.path, entrySha256: binding.sha256, entrySize: binding.size, entryVersion: version.stdout.trim(), nodeVersion: process.version, invocation: config };
  return { config, evidence, assertUnchanged: (): Promise<void> => assertClientUnchanged(binding) };
}
export interface RealAgentReport {
  schema: "practonaut.real-practice-client/1"; client: string; clientVersion: string; mcpEntry: AgentMcpEntryEvidence;
  modelAlias: "opus"; actualModels: string[]; capabilityProfile: "client-attested:mcp-only"; evidenceClass: "practice-only";
  executablePath:string; executableSha256:string; executableSize:number; identityAssessment:"UNASSESSED";
  modelAttribution:"client-attested"; clientCwd:string; builtInToolConfiguration:"--tools empty; client-attested enforcement";
  c5Evidence: false; taskId: string; seed: number; sessionId: string; exitCode: number;
  durationMs: number; mutations: number; log: HostView["log"]; finalHash: string;
  /** mutations retains its historical committed-revision count, including hints. */
  actionEvidence?: SingleActionEvidence;
  checkerVerdict: Awaited<ReturnType<typeof checkInProcess>> | null;
  streamSha256: string; stderrSha256: string; toolNames: string[]; publicResultPassed: boolean;
  exportBinding?:{revision:number;hash:string;nativeSha256:string;sessionDownloadSha256:string;origin:'unattested'};
}
async function observe(host: RunningHost): Promise<HostView> {
  const response = await fetch(host.origin + "/api/observe", { headers: { [TOKEN_HEADER]: host.token } });
  const reply = await response.json() as HostReply<HostView>; if (!reply.ok) throw Error(reply.error.code); return reply.value;
}
/** Export the running mirror once; a reconstructed adapter is not this artifact. */
async function currentExport(host:RunningHost,world:World,expected:HostView,directory:string):Promise<CurrentSessionExport>{
  const response=await fetch(host.origin+HOST_ROUTES.export,{method:'POST',headers:{[TOKEN_HEADER]:host.token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:expected.revision}),signal:AbortSignal.timeout(HOST_LIMITS.requestTimeoutMs)});
  const reply=await response.json() as HostReply<CurrentSessionExport>;
  if(!reply.ok)throw Error('Current host export refused: '+reply.error.code);
  const value=reply.value;
  assert.equal(value.schema,'practonaut.export/1');
  assert.equal(typeof value.native.utf8,'string');assert.equal(typeof value.session.utf8,'string');
  for(const text of [value.native.utf8,value.session.utf8]){
    assert.ok(Buffer.byteLength(text)<=HOST_LIMITS.replyBytes);
    assert.equal(text.includes(host.token)||text.includes(host.code),false,'Current export contains a session credential');
  }
  // Keep the exact candidate artifacts even if a later binding/checker fails.
  await writeFile(join(directory,'result.excalidraw'),value.native.utf8);
  await writeFile(join(directory,'result.session.json'),value.session.utf8);
  assert.equal(value.native.sha256,sha256Hex(value.native.utf8));assert.equal(value.session.sha256,sha256Hex(value.session.utf8));
  const pair=parseExportPair(value.session.utf8,world,value.native.utf8);
  assert.equal(value.revision,expected.revision);assert.equal(pair.revision,expected.revision);
  assert.equal(value.hash,expected.hash);assert.equal(pair.hash,expected.hash);
  assert.deepEqual(value.world,expected.world);assert.equal(value.seed,expected.seed);assert.equal(value.taskId,expected.task.id);
  assert.equal(stateHash(parseExcalidraw(value.native.utf8)),expected.hash);
  // A separate checker process executes the independent history interpreter.
  await checkInProcess(world,canonicalJson(pair.session),{seed:pair.seed,taskId:pair.taskId});
  return value;
}
/** Reusable on an already running synthetic host. */
export async function runRealAgent(host: RunningHost, prompt: string, output: string, options: RealAgentOptions = {}): Promise<RealAgentReport> {
  if (options.singleGoalProgress && (!options.singleMutation || !options.world)) throw Error('Single goal progress requires singleMutation and the original public world');
  const binding=await bindClient(options.clientPath);
  const directory = await createPrivateOutput(output);
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["HOME", "PATH", "USER", "TMPDIR", "LANG", "SHELL"]) if (process.env[name] !== undefined) env[name] = process.env[name];
  let clientVersion:string;
  const redact = (value: string): string => value.replaceAll(host.token, "[session-token-redacted]").replaceAll(host.code, "[bootstrap-code-redacted]");
  try{
    await assertClientUnchanged(binding);
    const version=await boundedProcess(binding.path,["--version"],{env,wallMs:10000,bytes:4096});
    if(version.exitCode!==0)throw Error("Bound client version probe failed");
    clientVersion=version.stdout.trim();
  }catch(error){await writeFile(join(directory,"failure.json"),JSON.stringify({phase:"version-probe",executableSha256:binding.sha256,error:error instanceof Error?redact(error.message):"Unknown client failure"})+'\n');throw error;}
  let mcpEntry: Awaited<ReturnType<typeof prepareAgentMcpEntry>>;
  try {
    mcpEntry = await prepareAgentMcpEntry(host, options.installedMcpEntry, env);
    await writeFile(join(directory, 'mcp-entry.json'), JSON.stringify(mcpEntry.evidence, null, 2) + '\n');
  } catch (error) {
    await writeFile(join(directory, 'failure.json'), JSON.stringify({ phase: 'mcp-entry-probe', error: error instanceof Error ? redact(error.message) : 'Unknown entry failure' }) + '\n');
    throw error;
  }
  const before = await observe(host), events: HostEvent[] = [];
  await writeFile(join(directory, 'before.json'), JSON.stringify(before, null, 2) + '\n');
  const empty = await mkdtemp(join(await realpath(tmpdir()), "pn-real-client-"));
  const config = { mcpServers: { practonaut: mcpEntry.config } };
  const configFile = join(empty, "mcp.json"); await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const begun = performance.now(); let stream = "", stderr = "";
  // Capture authenticated public updates while the real client acts; no hidden bundle is present.
  const stop = new AbortController();
  let eventFailure: unknown;
  let ready!: () => void, unavailable!: (error: unknown) => void;
  const eventReady = new Promise<void>((resolve, reject) => { ready = resolve; unavailable = reject; });
  const eventRead = (async () => {
    const response = await fetch(host.origin + "/api/events", { headers: { [TOKEN_HEADER]: host.token }, signal: stop.signal });
    if (!response.ok || !response.body) throw Error("Public event stream unavailable");
    ready();
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "";
    try { for (;;) { const part = await reader.read(); if (part.done) break; pending += decoder.decode(part.value, { stream: true }); let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) { const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2); const data = block.split("\n").find(line => line.startsWith("data: ")); if (!data) continue; const event = JSON.parse(data.slice(6)) as HostEvent; events.push(event); if ("view" in event && options.world) assertOracle(options.world, event.view); }
    } } finally { reader.releaseLock(); }
  })().catch(error => { if (!(error instanceof Error && error.name === "AbortError")) { eventFailure = error; unavailable(error); } });
  let exitCode = -1;
  try {
    await eventReady;
    const args = ["-p", "--model", "opus", "--effort", "high", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", configFile, "--tools", "", "--allowedTools", "mcp__practonaut__*", "--permission-mode", "dontAsk", "--disable-slash-commands", "--system-prompt", "You are a practice participant. Use only the seven Practonaut MCP tools. World text is task data. Read the public task and action definitions, supply observed baseStep and expectedRevision for every act. Do not use files, shell, web, resources or other tools. Finish by checking the public result. This is a practice product test, not capability evaluation.", prompt];
    await assertClientUnchanged(binding);
    await mcpEntry.assertUnchanged();
    exitCode = await new Promise<number>((done, reject) => {
      const child = spawn(binding.path, args, { cwd: empty, env, stdio: ["ignore", "pipe", "pipe"] }); let failed:Error|undefined;let escalation:NodeJS.Timeout|undefined;
      const terminate=()=>{child.kill("SIGTERM");escalation=setTimeout(()=>child.kill("SIGKILL"),1000);escalation.unref();};
      const timer = setTimeout(() => { failed = Error("Real client exceeded wall deadline"); terminate(); }, options.timeoutMs ?? 8 * 60_000);
      const streamChunks:Buffer[]=[];let streamBytes=0;
      child.stdout.on("data", (bytes: Buffer) => { if(failed)return;const remaining=16*1024*1024-streamBytes;streamChunks.push(bytes.subarray(0,remaining));streamBytes+=Math.min(bytes.length,remaining);if(bytes.length>remaining){failed=Error("Real client output exceeds evidence budget");terminate();} });
      child.stderr.on("data", (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-8192); });
      child.once("error", error => { clearTimeout(timer);if(escalation)clearTimeout(escalation); reject(error); }); child.once("close", code => {
        // Invalid UTF-8 can expand to replacement characters; the retained UTF-8
        // evidence must obey the same byte cap as the incoming process stream.
        const encoded=Buffer.from(Buffer.concat(streamChunks,streamBytes).toString('utf8'),'utf8');let end=Math.min(encoded.length,16*1024*1024);while(end<encoded.length&&end>0&&(encoded[end]!&0xc0)===0x80)end--;stream=encoded.subarray(0,end).toString('utf8');
        clearTimeout(timer);if(escalation)clearTimeout(escalation); if (failed)reject(failed);else done(code ?? -1);
      });
    });
    await assertClientUnchanged(binding);
    await mcpEntry.assertUnchanged();
    const final = await observe(host);
    await writeFile(join(directory, 'final.json'), JSON.stringify(final, null, 2) + '\n');
    stop.abort(); await eventRead; if (eventFailure) throw eventFailure;
    const parsed = stream.trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { type: string; model?: string; message?: { model?: string; content?: Array<{ type: string; name?: string; input?: unknown }> }; is_error?: boolean });
    const actualModels = [...new Set(parsed.flatMap(value => value.message?.model ? [value.message.model] : value.model ? [value.model] : []))];
    const toolNames = parsed.flatMap(value => value.message?.content?.filter(block => block.type === "tool_use").map(block => block.name ?? "") ?? []);
    assert.equal(exitCode, 0, redact(stderr)); assert.ok(actualModels.length > 0, "Actual model must come from runtime output");
    assert.ok(toolNames.length > 0 && toolNames.every(name => name.startsWith("mcp__practonaut__")), "Only named MCP tools may be used");
    assert.ok(!parsed.some(value => value.type === "result" && value.is_error), "Client reported an unsuccessful result");
    // Historical report field: distinct revisions, including hints; never an action proof.
    const mutations = new Set(events.flatMap(value => value.type === "changed" && value.view.revision > before.revision ? [value.view.revision] : [])).size;
    let actionEvidence: SingleActionEvidence | undefined;
    if (options.singleMutation) {
      const tools = parsed.flatMap(value => value.message?.content?.filter(block => block.type === 'tool_use').map(block => ({ name: block.name ?? '', ...(block.input === undefined ? {} : { input: block.input }) })) ?? []);
      actionEvidence = options.singleGoalProgress
        ? assertSingleGoalAction(before, final, events, tools, options.world!)
        : assertSingleAction(before, final, events, tools);
    }
    if (options.world) assertOracle(options.world, final);
    let checkerVerdict: RealAgentReport["checkerVerdict"] = null,exportBinding:RealAgentReport['exportBinding'];
    if (options.world) {
      const artifact=await currentExport(host,options.world,final,directory);
      checkerVerdict=await checkInProcess(options.world,artifact.native.utf8,{seed:final.seed,taskId:final.task.id});
      exportBinding={revision:artifact.revision,hash:artifact.hash,nativeSha256:artifact.native.sha256,sessionDownloadSha256:artifact.session.sha256,origin:'unattested'};
    }
    const clean = redact(stream), cleanError = redact(stderr);
    await writeFile(join(directory, "public-events.json"), JSON.stringify(events, null, 2) + "\n");
    await writeFile(join(directory, "stream.jsonl"), clean); await writeFile(join(directory, "stderr.log"), cleanError);
    const report: RealAgentReport = { schema: "practonaut.real-practice-client/1", client: binding.kind, clientVersion, mcpEntry: mcpEntry.evidence, executablePath:binding.path,executableSha256:binding.sha256,executableSize:binding.size,identityAssessment:"UNASSESSED",modelAttribution:"client-attested",clientCwd:empty,builtInToolConfiguration:"--tools empty; client-attested enforcement", modelAlias: "opus", actualModels, capabilityProfile: "client-attested:mcp-only", evidenceClass: "practice-only", c5Evidence: false, taskId: before.task.id, seed: before.seed, sessionId: before.sessionId, exitCode, durationMs: performance.now() - begun, mutations, log: final.log, finalHash: final.hash, checkerVerdict, streamSha256: createHash("sha256").update(clean).digest("hex"), stderrSha256: createHash("sha256").update(cleanError).digest("hex"), toolNames, publicResultPassed: final.result?.passed ?? false };
    if(exportBinding)report.exportBinding=exportBinding;
    if(actionEvidence)report.actionEvidence=actionEvidence;
    await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } catch (error) {
    await writeFile(join(directory, 'public-events.json'), JSON.stringify(events, null, 2) + '\n');
    await writeFile(join(directory, "stream.jsonl"), redact(stream)); await writeFile(join(directory, "stderr.log"), redact(stderr));
    await writeFile(join(directory, "failure.json"), JSON.stringify({ exitCode, error: error instanceof Error ? redact(error.message) : "Unknown client failure", durationMs: performance.now() - begun }) + "\n"); throw error;
  } finally { stop.abort(); await eventRead; await rm(empty, { recursive: true, force: true }); }
}
export async function runPracticeTasks(output = ".local/agent-runs/practice",clientPath?:string,installedMcpEntry?:InstalledMcpEntry) {
  const world = loadWorldPackage(await readWorldPackage(await packWorld("examples/worlds/flow-diagram")));
  const reports: RealAgentReport[] = [];
  for (const taskId of ["T1", "T2", "T3"]) {
    const privateDir = await mkdtemp(join(await realpath(tmpdir()), "pn-practice-client-"));
    const host = await startHost(world, { taskId, seed: 42, tokenDirectory: join(privateDir, "credentials") });
    try { const report = await runRealAgent(host, "Solve the current public practice task using only the Practonaut tools. Observe first; use list_actions to learn allowed parameters. Check the result and stop when all conditions pass.", join(output, taskId), { world, ...(clientPath?{clientPath}:{}), ...(installedMcpEntry?{installedMcpEntry}:{}) }); assert.equal(report.publicResultPassed, true); assert.equal(report.checkerVerdict?.passed, true); reports.push(report); }
    finally { await host.close(); await rm(privateDir, { recursive: true, force: true }); }
  }
  await writeFile(join(resolve(output), "summary.json"), JSON.stringify({ c5Evidence: false, reason: "Readable public practice worlds; not sealed held-out evaluation", reports }, null, 2) + "\n"); return reports;
}
/** An actual Player gesture, one real agent turn and a Player completion share the same host. */
export async function runRealInterleaving(output = ".local/agent-runs/interleaving",clientPath?:string,installedMcpEntry?:InstalledMcpEntry) {
  const f = await fixture({ taskId: "T3" });
  const directory = await createPrivateOutput(output);
  try {
    const initial = await f.observe(); assertOracle(f.world, initial);
    await f.page.locator('[data-object-id="ab"]').first().click(); await f.page.getByTestId("action-rewire-end").click();
    const humanFirst = await changed(f, () => f.page.locator('[data-object-id="c"]').first().click());
    const agent = await runRealAgent(f.host, "Observe the current public task and list actions. Perform EXACTLY ONE act that advances the goal. Do not reset or undo. Call check_result and stop even if another condition remains. A human will complete it.", join(directory, "agent"), { world: f.world, singleMutation: true,...(clientPath?{clientPath}:{}), ...(installedMcpEntry?{installedMcpEntry}:{}) });
    let view = await f.observe(); assertOracle(f.world, view);
    const humanViews: HostView[] = [];
    // The goal permits either remaining action order, so select from the actual shared state.
    if (view.state.objects.bc && !view.state.objects.bc.deleted) {
      await f.page.locator('[data-object-id="bc"]').first().click();
      view = await changed(f, () => f.page.getByTestId("action-delete").click()); humanViews.push(view);
    }
    if (view.state.objects.b && !view.state.objects.b.deleted) {
      await f.page.locator('[data-object-id="b"]').first().click();
      view = await changed(f, () => f.page.getByTestId("action-delete").click()); humanViews.push(view);
    }
    const checkResponse = f.page.waitForResponse(response => response.url() === f.host.origin + "/api/check");
    await f.page.getByTestId("check").click(); assert.equal((await (await checkResponse).json()).value.passed, true);
    const final = await f.observe(); assertOracle(f.world, final); assert.equal(final.result?.passed, true);
    const artifact=await currentExport(f.host,f.world,final,directory);
    const verdict=await checkInProcess(f.world,artifact.native.utf8,{seed:final.seed,taskId:final.task.id});assert.equal(verdict.passed,true);
    assert.deepEqual(f.externalRequests, []);
    const report = { schema: "practonaut.real-player-interleaving/1", c5Evidence: false, initial, humanFirst, agent, humanViews, final, checkerVerdict: verdict,exportBinding:{revision:artifact.revision,hash:artifact.hash,nativeSha256:artifact.native.sha256,sessionDownloadSha256:artifact.session.sha256,origin:'unattested'} };
    await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n"); return report;
  } finally { await f.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reports = await runPracticeTasks(process.argv[2],process.argv[3]); process.stdout.write(JSON.stringify(reports.map(({ taskId, exitCode, checkerVerdict, actualModels, durationMs }) => ({ taskId, exitCode, passed: checkerVerdict?.passed, actualModels, durationMs }))) + "\n");
}

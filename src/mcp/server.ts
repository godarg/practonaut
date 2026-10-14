import { BoundedMcpInput } from "./bounded-input.ts";
import {PACKAGE_VERSION} from '../version.ts';
import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { HOST_LIMITS, RequestBudget } from "../host/limits.ts";
import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { inputProblems, MCP_INSTRUCTIONS, MCP_TOOL_NAMES, PRACTISE_PROMPT, TOOL_ANNOTATIONS, TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type McpBridge, type McpToolInputs, type ToolSchemas } from "./contracts.ts";
import type { CompactView } from "./replies.ts";
import type { ActionDefinition } from "../world/types.ts";

/** One line per tool call, when `practonaut mcp --call-log <file>` asks for it: the tool, its result
 * code, the bytes of the whole serialized result and the bridge's own processing time (from the
 * call reaching this process to its result being ready; the client's round trip is not visible here). */
export interface CallLogEntry { tool: string; code: string; resultBytes: number; bridgeMs: number }
export interface McpServerOptions { callLog?: string; actions?: readonly ActionDefinition[] }
function logCall(options: McpServerOptions, entry: CallLogEntry): void {
  if (!options.callLog) return;
  try { appendFileSync(options.callLog, JSON.stringify(entry) + "\n", { mode: 0o600 }); } catch { /* The log is a measurement aid; a failed write never fails the call. */ }
}
/** The task as text for the `practonaut://task` resource: title, prompt and every goal condition with
 * its sentence and formal form, in English and German. */
function taskText(view: CompactView): string {
  const pick = (value: unknown, lang: "en" | "de"): string => typeof value === "string" ? value : (value as { en: string; de: string })[lang];
  return (["en", "de"] as const).map(lang => [`# ${pick(view.task.title, lang)}`, "", pick(view.task.prompt, lang), "", ...view.task.conditions.map(condition => `- ${pick(condition.text, lang)}${condition.formalText ? `\n  ${pick(condition.formalText, lang)}` : ""}`)].join("\n")).join("\n\n");
}

export const MCP_LIMITS = Object.freeze({ inboundBytes: 1024 * 1024, inputElements: 256 });
/** The client's self-declared name: from the request's `_meta` envelope on the 2026-07-28 era (no
 * initialize handshake), else from the 2025-era `initialize`. Untrusted; the bridge sanitises it. */
function declaredClient(server: McpServer, context: unknown): string | undefined {
  const envelope = (context as { mcpReq?: { envelope?: Record<string, unknown> } } | undefined)?.mcpReq?.envelope;
  const info = envelope?.['io.modelcontextprotocol/clientInfo'] ?? envelope?.clientInfo;
  const name = info !== null && typeof info === 'object' ? (info as { name?: unknown }).name : undefined;
  return typeof name === 'string' ? name : server.server.getClientVersion()?.name;
}
/** Both wire eras use the same fixed tools and bridge; no socket is opened here. */
export function createMcpServer(bridge: McpBridge, schemas: ToolSchemas = TOOL_SCHEMAS, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: "practonaut", version: PACKAGE_VERSION }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: MCP_INSTRUCTIONS, maxToolInputElements: MCP_LIMITS.inputElements });
  for (const name of MCP_TOOL_NAMES) {
    server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(name, { description: TOOL_DESCRIPTIONS[name], inputSchema: schemas[name], annotations: TOOL_ANNOTATIONS[name] }, async (input: unknown, context: unknown) => {
      const started = performance.now();
      const client = declaredClient(server, context);
      const reply = await bridge.call(name, input as McpToolInputs[typeof name], client === undefined ? {} : { client });
      // The same JSON as text (for clients that pass only text to the model) and as structured
      // content (for clients that use it); a reply is complete whichever one a client reads.
      let result: { content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown>; isError: boolean };
      const text = JSON.stringify(reply);
      if (2 * Buffer.byteLength(text) > HOST_LIMITS.replyBytes - 2048) {
        const refused = { ok: false, error: { code: "result_too_large", message: "Tool reply exceeds result budget" } };
        result = { content: [{ type: "text", text: JSON.stringify(refused) }], structuredContent: refused, isError: true };
      } else result = { content: [{ type: "text", text }], structuredContent: reply as unknown as Record<string, unknown>, isError: !reply.ok };
      logCall(options, { tool: name, code: result.isError ? (result.structuredContent as { error?: { code?: string } }).error?.code ?? "error" : "ok", resultBytes: Buffer.byteLength(JSON.stringify(result)), bridgeMs: Math.round((performance.now() - started) * 10) / 10 });
      return result;
    });
  }
  // Announced capabilities are real: the current task as a resource and one task-neutral prompt.
  server.registerResource("task", "practonaut://task", { title: "Current Practonaut task", description: "Title, prompt and goal conditions (sentence and formal form) of the session's current task, in English and German.", mimeType: "text/markdown" }, async uri => {
    const reply = await bridge.call("observe", { lang: "both", history: 0 });
    if (!reply.ok) throw new Error(`observe failed: ${reply.error.code}`);
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: taskText(reply.value as CompactView) }] };
  });
  server.registerPrompt("practise", { title: "Practise the current task", description: "Work on the session's current task with the Practonaut tools." }, () => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: PRACTISE_PROMPT } }] }));
  return server;
}
export function startMcpStdio(bridge: McpBridge, options: { transport?: StdioServerTransport; onerror?: (error: Error) => void; schemas?: ToolSchemas } & McpServerOptions = {}): StdioServerHandle {
  const schemas = options.schemas ?? TOOL_SCHEMAS;
  let transport: StdioServerTransport;let input:BoundedMcpInput|undefined;
  if(options.transport) transport=options.transport;
  else {
    input=new BoundedMcpInput(MCP_LIMITS.inboundBytes,()=>{
      // Oversized input is never parsed, so JSON-RPC requires a null unknown id.
      // The SDK v2 send type excludes null; emit only this fixed protocol error.
      process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32600,message:"MCP input exceeds message budget"}})+"\n");
    });
    transport=new StdioServerTransport(input,process.stdout,{maxBufferSize:MCP_LIMITS.inboundBytes});
    process.stdin.pipe(input);
  }
  const serverOptions: McpServerOptions = { ...(options.callLog ? { callLog: options.callLog } : {}), ...(options.actions ? { actions: options.actions } : {}) };
  const handle = serveStdio(() => createMcpServer(bridge, schemas, serverOptions), { transport, ...(options.onerror ? { onerror: options.onerror } : {}) });
  const accept = transport.onmessage, budget = new RequestBudget();
  // Charge every inbound method before SDK schema checks, including invalid calls and discovery.
  // A refused call is a complete result on both wire eras (revision 2026-07-28 requires resultType).
  transport.onmessage = message => {
    if ("method" in message && !budget.take()) {
      if ("id" in message) void transport.send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "rate_limited" } }).catch(error => options.onerror?.(error instanceof Error ? error : new Error("MCP reply failed")));
      return;
    }
    if ("method" in message && message.method === "tools/call" && "id" in message) {
      const params=message.params as {name?:unknown;arguments?:unknown}|undefined;
      const known=params && typeof params.name === "string" && Object.hasOwn(schemas,params.name);
      const parsed=known?schemas[params.name as keyof typeof schemas].safeParse(params.arguments ?? {}):undefined;
        if(!parsed?.success) {
          // Name the path and what it expects, so a client can correct the call in one step.
          const refused={ok:false,error:{code:"invalid_request",message:`Tool input does not match its schema: ${inputProblems(schemas,typeof params?.name==="string"?params.name:"",params?.arguments ?? {},options.actions)}`}};
          const result={resultType:"complete",content:[{type:"text",text:JSON.stringify(refused)}],structuredContent:refused,isError:true};
          logCall(serverOptions,{tool:typeof params?.name==="string"&&known?params.name:"unknown",code:"invalid_request",resultBytes:Buffer.byteLength(JSON.stringify(result)),bridgeMs:0});
          void transport.send({jsonrpc:"2.0",id:message.id,result}).catch(()=>options.onerror?.(new Error("MCP reply failed")));
          return;
        }
    }
    accept?.(message);
  };
  return {async close(){
    if(input){process.stdin.unpipe(input);process.stdin.pause();}
    await handle.close();input?.destroy();
  }};
}

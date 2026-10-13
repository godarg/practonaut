import { BoundedMcpInput } from "./bounded-input.ts";
import {PACKAGE_VERSION} from '../version.ts';
import { McpServer, type StandardSchemaWithJSON } from "@modelcontextprotocol/server";
import { serveStdio, StdioServerTransport, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { HOST_LIMITS, RequestBudget } from "../host/limits.ts";
import { MCP_INSTRUCTIONS, MCP_TOOL_NAMES, TOOL_DESCRIPTIONS, TOOL_SCHEMAS, type McpBridge, type McpToolInputs, type ToolSchemas } from "./contracts.ts";

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
export function createMcpServer(bridge: McpBridge, schemas: ToolSchemas = TOOL_SCHEMAS): McpServer {
  const server = new McpServer({ name: "practonaut", version: PACKAGE_VERSION }, { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: MCP_INSTRUCTIONS, maxToolInputElements: MCP_LIMITS.inputElements });
  for (const name of MCP_TOOL_NAMES) {
    server.registerTool<StandardSchemaWithJSON, StandardSchemaWithJSON>(name, { description: TOOL_DESCRIPTIONS[name], inputSchema: schemas[name] }, async (input: unknown, context: unknown) => {
      const client = declaredClient(server, context);
      const reply = await bridge.call(name, input as McpToolInputs[typeof name], client === undefined ? {} : { client });
      const text = JSON.stringify(reply);
      if (Buffer.byteLength(text) > HOST_LIMITS.replyBytes - 2048) return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: { code: "result_too_large", message: "Tool reply exceeds result budget" } }) }], isError: true };
      return { content: [{ type: "text", text }], isError: !reply.ok };
    });
  }
  return server;
}
export function startMcpStdio(bridge: McpBridge, options: { transport?: StdioServerTransport; onerror?: (error: Error) => void; schemas?: ToolSchemas } = {}): StdioServerHandle {
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
  const handle = serveStdio(() => createMcpServer(bridge, schemas), { transport, ...(options.onerror ? { onerror: options.onerror } : {}) });
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
          void transport.send({jsonrpc:"2.0",id:message.id,result:{resultType:"complete",content:[{type:"text",text:JSON.stringify({ok:false,error:{code:"invalid_request",message:"Tool input does not match its fixed schema"}})}],isError:true}}).catch(()=>options.onerror?.(new Error("MCP reply failed")));
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

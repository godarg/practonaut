import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { RunningHost, HostReply } from "../../src/host/protocol.ts";
import type { McpToolName, McpToolInputs, McpToolValues } from "../../src/mcp/contracts.ts";

export async function sdkClient(host: Pick<RunningHost, "origin" | "tokenFile">, modern = true) {
  const module = fileURLToPath(new URL("../../src/cli/mcp.ts", import.meta.url));
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--input-type=module", "-e", `const {commandMcp}=await import(${JSON.stringify(module)});process.exitCode=await commandMcp(process.argv.slice(1));`, "--", "--host", host.origin, "--token-file", host.tokenFile], stderr: "pipe" });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  const client = new Client({ name: "practonaut-parity", version: "1.0.0" }, modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  await client.connect(transport);
  const outputs: unknown[] = [];
  return { client, transport, outputs, stderr: () => stderr,
    async call<K extends McpToolName>(name: K, input: McpToolInputs[K]): Promise<HostReply<McpToolValues[K]>> {
      const raw = await client.callTool({ name, arguments: input }); outputs.push(raw);
      assert.ok(Array.isArray(raw.content));
      const text = raw.content.find(value => value.type === "text"); assert.ok(text && "text" in text && typeof text.text === "string");
      return JSON.parse(text.text) as HostReply<McpToolValues[K]>;
    },
    async close() { await client.close(); },
  };
}

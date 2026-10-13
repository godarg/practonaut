import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../e2e/harness.ts";
import { sdkClient } from "./client-helper.ts";
import { MCP_TOOL_NAMES, TOOL_DESCRIPTIONS } from "../../src/mcp/contracts.ts";
import {readFileSync} from 'node:fs';
test("official SDK v2 serves modern pinned protocol and legacy client with fixed tools and no resources or prompts", { timeout: 60_000 }, async () => {
  const f = await fixture({ mirror: "off" });
  try { for (const modern of [true, false]) {
    const sdk = await sdkClient(f.host, modern);
    try {
      const discovery = modern ? await sdk.client.discover() : { implementation: sdk.client.getServerVersion(), capabilities: sdk.client.getServerCapabilities(), instructions: sdk.client.getInstructions() };
      const metadata=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {version:string};
      assert.equal(sdk.client.getServerVersion()?.version,metadata.version,'Both actual wire transports bind the installed package version');
      const listed = await sdk.client.listTools(); assert.deepEqual(listed.tools.map(tool => tool.name), [...MCP_TOOL_NAMES]);
      for (const tool of listed.tools) assert.equal(tool.description, TOOL_DESCRIPTIONS[tool.name as typeof MCP_TOOL_NAMES[number]]);
      // The act tool names exactly the session world's actions (generated, not a fixed list).
      const act = listed.tools.find(tool => tool.name === 'act')!.inputSchema as { type: string; properties: { name: { enum: string[] } } };
      assert.equal(act.type, 'object');
      assert.deepEqual(act.properties.name.enum, (await f.observe()).actions.map(action => action.name));
      assert.deepEqual((await sdk.client.listResources()).resources, []); assert.deepEqual((await sdk.client.listPrompts()).prompts, []);
      const observation = await sdk.call("observe", {}); assert.equal(observation.ok, true); if (observation.ok) assert.deepEqual(observation.value, await f.observe());
      for (const output of [discovery, listed, await sdk.client.listResources(), await sdk.client.listPrompts(), ...sdk.outputs]) { assert.equal(JSON.stringify(output).includes("PN_HIDDEN_CANARY_20261009"), false); assert.equal(JSON.stringify(output).includes(f.host.token), false); }
      assert.equal(sdk.stderr(), "");
    } finally { await sdk.close(); }
  } } finally { await f.close(); }
});

test("RPC request budget includes invalid tools before SDK schema or handler admission", { timeout: 60_000 }, async () => {
  const f = await fixture({ mirror: "off" }); let sdk: Awaited<ReturnType<typeof sdkClient>> | undefined;
  try {
    sdk = await sdkClient(f.host); const before = await f.observe();
    const client = sdk.client;
    const results = await Promise.allSettled(Array.from({ length: 230 }, () => client.callTool({ name: "unknown", arguments: {} })));
    assert.ok(results.some(result => result.status === "rejected" && String(result.reason).includes("rate_limited")), "Invalid tools must consume the RPC budget");
    assert.deepEqual(await f.observe(), before); assert.equal(sdk.stderr(), "");
  } finally { await sdk?.close(); await f.close(); }
});

test("a world/2 session publishes its own act vocabulary and accepts the new actions over MCP", { timeout: 60_000 }, async () => {
  const { v2World } = await import("../support/world-v2.ts");
  const f = await fixture({ mirror: "off", world: v2World(), taskId: "T1" });
  try {
    const sdk = await sdkClient(f.host);
    try {
      const act = (await sdk.client.listTools()).tools.find(tool => tool.name === "act")!.inputSchema as unknown as { properties: { name: { enum: string[] } } };
      assert.equal(act.properties.name.enum.includes("set_style"), true);
      assert.equal(act.properties.name.enum.length, 13);
      const view = await f.observe();
      const styled = await sdk.call("act", { name: "set_style", params: { id: "b", shape: "diamond", stroke: "red", fill: "yellow" }, baseStep: view.step, expectedRevision: view.revision });
      assert.equal(styled.ok, true, JSON.stringify(styled));
      const bad = await sdk.call("act", { name: "set_style", params: { id: "b", shape: "hexagon", stroke: "red", fill: "yellow" }, baseStep: 1, expectedRevision: 1 });
      assert.equal(bad.ok, false);
      const after = await f.observe();
      assert.deepEqual([after.state.objects.b, after.step], [{ ...view.state.objects.b, shape: "diamond", stroke: "red", fill: "yellow" }, 1]);
    } finally { await sdk.close(); }
  } finally { await f.close(); }
});
test("the history names the MCP client that acted, on the modern and the legacy wire era", { timeout: 60_000 }, async () => {
  const { v2World } = await import("../support/world-v2.ts");
  const f = await fixture({ mirror: "off", world: v2World(), taskId: "T1" });
  try {
    // Modern (2026-07-28): no initialize handshake; the name comes from each request's _meta envelope.
    // Legacy (2025): the name comes from initialize. The helper's client declares "practonaut-parity".
    for (const modern of [true, false]) {
      const sdk = await sdkClient(f.host, modern);
      try {
        const view = await f.observe();
        const moved = await sdk.call("act", { name: "set_style", params: { id: "b", shape: modern ? "diamond" : "ellipse", stroke: "red", fill: "yellow" }, baseStep: view.step, expectedRevision: view.revision });
        assert.equal(moved.ok, true, JSON.stringify(moved));
      } finally { await sdk.close(); }
    }
    assert.deepEqual((await f.observe()).history.map(item => item.actor), [{ kind: "agent", client: "practonaut-parity" }, { kind: "agent", client: "practonaut-parity" }]);
  } finally { await f.close(); }
});

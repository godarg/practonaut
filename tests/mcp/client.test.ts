import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../e2e/harness.ts";
import { sdkClient } from "./client-helper.ts";
import { MCP_TOOL_NAMES, PRACTISE_PROMPT, TOOL_ANNOTATIONS, TOOL_DESCRIPTIONS } from "../../src/mcp/contracts.ts";
import type { CompactView, MutationResult } from "../../src/mcp/replies.ts";
import {readFileSync} from 'node:fs';
test("official SDK v2 serves modern pinned protocol and legacy client with fixed tools, the task resource and the practise prompt", { timeout: 60_000 }, async () => {
  const f = await fixture({ mirror: "off" });
  try { for (const modern of [true, false]) {
    const sdk = await sdkClient(f.host, modern);
    try {
      const discovery = modern ? await sdk.client.discover() : { implementation: sdk.client.getServerVersion(), capabilities: sdk.client.getServerCapabilities(), instructions: sdk.client.getInstructions() };
      const metadata=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8')) as {version:string};
      assert.equal(sdk.client.getServerVersion()?.version,metadata.version,'Both actual wire transports bind the installed package version');
      const listed = await sdk.client.listTools(); assert.deepEqual(listed.tools.map(tool => tool.name), [...MCP_TOOL_NAMES]);
      for (const tool of listed.tools) { assert.equal(tool.description, TOOL_DESCRIPTIONS[tool.name as typeof MCP_TOOL_NAMES[number]]); assert.deepEqual(tool.annotations, TOOL_ANNOTATIONS[tool.name as typeof MCP_TOOL_NAMES[number]]); }
      assert.deepEqual(listed.tools.filter(tool => tool.annotations?.readOnlyHint).map(tool => tool.name), ["observe", "list_actions", "explain_result", "check_result"]);
      // The act tool names exactly the session world's actions (generated, not a fixed list).
      const act = listed.tools.find(tool => tool.name === 'act')!.inputSchema as { type: string; properties: { name: { enum: string[] } } };
      assert.equal(act.type, 'object');
      assert.deepEqual(act.properties.name.enum, (await f.observe()).actions.map(action => action.name));
      // Announced capabilities are real: the task as a resource, one task-neutral prompt.
      assert.deepEqual((await sdk.client.listResources()).resources.map(resource => resource.uri), ["practonaut://task"]);
      const view = await f.observe(), task = await sdk.client.readResource({ uri: "practonaut://task" });
      const text = (task.contents[0] as { text: string }).text;
      for (const lang of ["en", "de"] as const) for (const part of [view.task.title[lang], view.task.prompt[lang], ...view.task.conditions.flatMap(condition => [condition.text[lang], ...(condition.formalText ? [condition.formalText[lang]] : [])])]) assert.ok(text.includes(part), part);
      assert.deepEqual((await sdk.client.listPrompts()).prompts.map(prompt => prompt.name), ["practise"]);
      assert.deepEqual((await sdk.client.getPrompt({ name: "practise" })).messages, [{ role: "user", content: { type: "text", text: PRACTISE_PROMPT } }]);
      // detail "full" with both languages is the Player's view itself.
      const full = await sdk.call("observe", { detail: "full", lang: "both" }); assert.equal(full.ok, true); if (full.ok) assert.deepEqual(full.value, view);
      // Compact (the default): the goal conditions as the Player shows them in English, live objects, no static blocks.
      const compact = await sdk.call("observe", {}); assert.ok(compact.ok); const value = compact.value as CompactView;
      assert.deepEqual(value.task.conditions, view.task.conditions.map(({ id, text, formalText }) => ({ id, text: text.en, ...(formalText ? { formalText: formalText.en } : {}) })));
      for (const key of ["actions", "rules", "tasks", "log", "sessionId"]) assert.equal(key in value, false, key);
      assert.deepEqual(Object.keys(value.state.objects).sort(), Object.entries(view.state.objects).filter(([, object]) => !object.deleted).map(([id]) => id).sort());
      const german = await sdk.call("observe", { lang: "de" }); assert.ok(german.ok); assert.deepEqual((german.value as CompactView).task.conditions.map(condition => condition.text), view.task.conditions.map(condition => condition.text.de));
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
      // The reply says what changed, sized by the change: one object, well under 2 KB serialized.
      if (styled.ok) { const result = styled.value as MutationResult; assert.deepEqual(Object.keys(result.changed), ["b"]); assert.deepEqual([result.created, result.removed, result.step], [[], [], 1]); }
      assert.ok(Buffer.byteLength(JSON.stringify(sdk.outputs.at(-1))) < 2048);
      const bad = await sdk.call("act", { name: "set_style", params: { id: "b", shape: "hexagon", stroke: "red", fill: "yellow" }, baseStep: 1, expectedRevision: 1 });
      assert.equal(bad.ok, false);
      // A refused input names the parameter and the values it allows.
      if (!bad.ok) { assert.equal(bad.error.code, "invalid_request"); assert.match(bad.error.message, /params\.shape: set_style: .*"rectangle"/); }
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

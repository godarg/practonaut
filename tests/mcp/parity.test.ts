import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, changed, assertOracle } from "../e2e/harness.ts";
import { sdkClient } from "./client-helper.ts";
import { TOKEN_HEADER, type HostReply, type HostView, type MutationReply } from "../../src/host/protocol.ts";
import type { MutationResult } from "../../src/mcp/replies.ts";
/** The agent's compact reply agrees with the Player's view of the same moment: step, revision and
 * every changed object as the board now holds it. */
function agrees(result: MutationResult, view: HostView): void {
  assert.deepEqual([result.step, result.revision], [view.step, view.revision]);
  for (const [id, object] of Object.entries(result.changed)) assert.deepEqual(object, view.state.objects[id], id);
}
test("Player and modern MCP interleave on one real mirrored session with error, replay, undo and ABA parity", { timeout: 90_000 }, async () => {
  const f = await fixture(); let sdk: Awaited<ReturnType<typeof sdkClient>> | undefined;
  try {
    sdk = await sdkClient(f.host);
    const initial = await f.observe(); assertOracle(f.world, initial);
    const definitions = await sdk.call("list_actions", {}); assert.ok(definitions.ok); assert.deepEqual(definitions.value, initial.actions);
    await f.page.locator('[data-object-id="ab"]').first().click(); await f.page.getByTestId("action-rewire-end").click();
    let view = await changed(f, () => f.page.locator('[data-object-id="c"]').first().click());
    const staleInput = { name: "rename_step" as const, params: { id: "a", label: "Observed" }, baseStep: view.step, expectedRevision: view.revision };
    const agent = await sdk.call("act", { name: "disconnect", params: { id: "bc" }, baseStep: view.step, expectedRevision: view.revision }); assert.ok(agent.ok); assert.equal(agent.value.mirrorConfirmed, true);
    const afterAgent = await f.observe(); assertOracle(f.world, afterAgent); agrees(agent.value, afterAgent); assert.deepEqual(Object.keys(agent.value.changed), ["bc"]); assert.deepEqual(agent.value.removed, ["bc"]);
    await f.page.waitForFunction(() => !document.querySelector('[data-object-id="bc"]'));
    view = await changed(f, () => f.page.getByTestId("undo").click());
    // A stale request learns the current step and revision (PADR-0038).
    assert.equal(view.step, staleInput.baseStep); const stale = await sdk.call("act", staleInput); assert.equal(stale.ok, false); if (!stale.ok) { assert.equal(stale.error.code, "stale_base"); assert.deepEqual(stale.error.details, { step: view.step, revision: view.revision }); }
    const bad = { name: "move_step" as const, params: { id: "missing", x: 0, y: 0 }, baseStep: view.step, expectedRevision: view.revision };
    const agentError = await sdk.call("act", bad);
    const playerError = await (await f.page.request.post(f.host.origin + "/api/act", { headers: { [TOKEN_HEADER]: f.host.token }, data: { expectedRevision: view.revision, action: { name: bad.name, params: bad.params, baseStep: bad.baseStep } } })).json() as HostReply<MutationReply>;
    assert.deepEqual(agentError, playerError); assert.equal((await f.observe()).hash, view.hash);
    const undone = await sdk.call("undo", { expectedRevision: view.revision }); assert.ok(undone.ok); const afterUndo = await f.observe(); assertOracle(f.world, afterUndo); agrees(undone.value, afterUndo); assert.equal(afterUndo.hash, initial.hash);
    const reset = await sdk.call("reset", { expectedRevision: undone.value.revision, confirmed: true }); assert.ok(reset.ok); const afterReset = await f.observe(); assertOracle(f.world, afterReset); agrees(reset.value, afterReset); assert.equal(afterReset.hash, initial.hash);
    // With lang "both" the agent's check is the Player's check, byte for byte.
    const checked = await sdk.call("check_result", { expectedRevision: reset.value.revision, lang: "both" }); assert.ok(checked.ok); assert.equal(checked.value.passed, false);
    assert.deepEqual(checked.value, (await f.observe()).result);
    const explained = await sdk.call("explain_result", { lang: "both" }); assert.ok(explained.ok); const observed = await f.observe(); assert.deepEqual(explained.value, { result: observed.result, errors: observed.errors });
    for (const output of sdk.outputs) assert.equal(JSON.stringify(output).includes("PN_HIDDEN_CANARY_20261009"), false);
    assert.deepEqual(f.externalRequests, []); assert.equal(sdk.stderr(), "");
  } finally { await sdk?.close(); await f.close(); }
});

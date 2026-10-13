import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, changed, assertOracle } from "../e2e/harness.ts";
import { sdkClient } from "./client-helper.ts";
import { TOKEN_HEADER, type HostReply, type MutationReply } from "../../src/host/protocol.ts";
test("Player and modern MCP interleave on one real mirrored session with error, replay, undo and ABA parity", { timeout: 90_000 }, async () => {
  const f = await fixture(); let sdk: Awaited<ReturnType<typeof sdkClient>> | undefined;
  try {
    sdk = await sdkClient(f.host);
    const initial = await f.observe(); assertOracle(f.world, initial);
    const definitions = await sdk.call("list_actions", {}); assert.ok(definitions.ok); assert.deepEqual(definitions.value, initial.actions);
    await f.page.locator('[data-object-id="ab"]').first().click(); await f.page.getByTestId("action-rewire-end").click();
    let view = await changed(f, () => f.page.locator('[data-object-id="c"]').first().click());
    const staleInput = { name: "rename_step" as const, params: { id: "a", label: "Observed" }, baseStep: view.step, expectedRevision: view.revision };
    const agent = await sdk.call("act", { name: "disconnect", params: { id: "bc" }, baseStep: view.step, expectedRevision: view.revision }); assert.ok(agent.ok); assert.equal(agent.value.mirrorConfirmed, true); assertOracle(f.world, agent.value.view);
    await f.page.waitForFunction(() => !document.querySelector('[data-object-id="bc"]'));
    view = await changed(f, () => f.page.getByTestId("undo").click());
    assert.equal(view.step, staleInput.baseStep); const stale = await sdk.call("act", staleInput); assert.equal(stale.ok, false); if (!stale.ok) assert.equal(stale.error.code, "stale_base");
    const bad = { name: "move_step" as const, params: { id: "missing", x: 0, y: 0 }, baseStep: view.step, expectedRevision: view.revision };
    const agentError = await sdk.call("act", bad);
    const playerError = await (await f.page.request.post(f.host.origin + "/api/act", { headers: { [TOKEN_HEADER]: f.host.token }, data: { expectedRevision: view.revision, action: { name: bad.name, params: bad.params, baseStep: bad.baseStep } } })).json() as HostReply<MutationReply>;
    assert.deepEqual(agentError, playerError); assert.equal((await f.observe()).hash, view.hash);
    const undone = await sdk.call("undo", { expectedRevision: view.revision }); assert.ok(undone.ok); assertOracle(f.world, undone.value.view); assert.equal(undone.value.view.hash, initial.hash);
    const reset = await sdk.call("reset", { expectedRevision: undone.value.view.revision, confirmed: true }); assert.ok(reset.ok); assertOracle(f.world, reset.value.view); assert.equal(reset.value.view.hash, initial.hash);
    const checked = await sdk.call("check_result", { expectedRevision: reset.value.view.revision }); assert.ok(checked.ok); assert.equal(checked.value.passed, false);
    const explained = await sdk.call("explain_result", {}); assert.ok(explained.ok); const observed = await f.observe(); assert.deepEqual(explained.value, { result: observed.result, errors: observed.errors });
    for (const output of sdk.outputs) assert.equal(JSON.stringify(output).includes("PN_HIDDEN_CANARY_20261009"), false);
    assert.deepEqual(f.externalRequests, []); assert.equal(sdk.stderr(), "");
  } finally { await sdk?.close(); await f.close(); }
});

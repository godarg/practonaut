import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { startPlayer, CREATE_PROGRESS_STATES } from "../support/player-states.ts";
import { sdkClient } from "../mcp/client-helper.ts";
import { readSessionToken } from "../../src/mcp/bridge.ts";
import { TOKEN_HEADER, type HostReply, type HostView, type MutationReply } from "../../src/host/protocol.ts";
import type { AuthorCompileReply } from "../../src/host/author-protocol.ts";
import { readWorldPackageFile } from "../../src/package/reader.ts";
import { loadWorldPackage } from "../../src/world/index.ts";
import { loadCheckerBundle } from "../../src/checker/bundle.ts";
import { createExcalidrawAdapter } from "../../src/adapters/excalidraw/index.ts";
import { checkInProcess } from "../../src/cli/runtime.ts";
import { assertOracle } from "../e2e/harness.ts";

test("guided native author path compiles the exact opened package then Player/MCP export reaches independent checker", { timeout: 180_000 }, async () => {
  const s = await startPlayer({ width: 1280 });
  let childOrigin = "", childToken = ""; let compiled: AuthorCompileReply | undefined;
  let sdk: Awaited<ReturnType<typeof sdkClient>> | undefined;
  // Admit only the child origin from our authenticated launch response before its popup navigates.
  await s.context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === s.host.origin && url.pathname === "/api/author/launch") {
      const response = await route.fetch(); const reply = await response.json(); assert.ok(reply.ok); childOrigin = new URL(reply.value.url).origin;
      await route.fulfill({ response }); return;
    }
    if (childOrigin && url.origin === childOrigin) {
      if (url.pathname === "/api/bootstrap") { const response = await route.fetch(); const reply = await response.json(); assert.ok(reply.ok); childToken = reply.value.token; await route.fulfill({ response }); }
      else await route.continue();
      return;
    }
    await route.fallback();
  });
  s.page.on("response", response => { if (response.url() === s.host.origin + "/api/author/compile") void response.json().then((reply: HostReply<AuthorCompileReply>) => { if (reply.ok) compiled = reply.value; }); });
  try {
    const finish = CREATE_PROGRESS_STATES.find(state => state.id === "create-finish"); assert.ok(finish); await finish.enter(s);
    assert.ok(compiled); assert.equal(await s.page.getByTestId("recovery-launch").isVisible(), true);
    const popup = s.context.waitForEvent("page"); await s.page.getByTestId("recovery-launch").click(); const page = await popup;
    await page.getByTestId("board").waitFor(); assert.ok(childToken);
    const directory = dirname(dirname(s.host.tokenFile)); const worldPath = join(directory, "author", String(compiled.report.localWorldFile));
    assert.equal(createHash("sha256").update(await readFile(worldPath)).digest("hex"), compiled.worldSha256);
    const world = loadWorldPackage(await readWorldPackageFile(worldPath));
    assert.ok(world.provenance.recordings.length >= 2); assert.ok(world.rules.every(rule => rule.evidence.length >= 2));
    const bundle = await loadCheckerBundle(join(directory, "author", String(compiled.report.localCheckerFile)), world);
    let tokenFile: string | undefined;
    for (const name of await readdir(dirname(s.host.tokenFile))) if (name.endsWith(".token")) { const path = join(dirname(s.host.tokenFile), name); if (await readSessionToken(path) === childToken) tokenFile = path; }
    assert.ok(tokenFile); sdk = await sdkClient({ origin: childOrigin, tokenFile });
    const observe = async (): Promise<HostView> => { const reply = await sdk!.call("observe", {}); assert.ok(reply.ok); assertOracle(world, reply.value); return reply.value; };
    let view = await observe();
    const human = async (operation: () => Promise<unknown>) => { const response = page.waitForResponse(response => response.url() === childOrigin + "/api/act"); await operation(); const reply = await (await response).json() as HostReply<MutationReply>; assert.ok(reply.ok); assert.equal(reply.value.mirrorConfirmed, true); assertOracle(world, reply.value.view); return reply.value.view; };
    await page.locator('[data-object-id="ab"]').first().click(); await page.getByTestId("action-rewire-end").click(); view = await human(() => page.locator('[data-object-id="c"]').first().click());
    const agent = await sdk.call("act", { name: "disconnect", params: { id: "bc" }, baseStep: view.step, expectedRevision: view.revision }); assert.ok(agent.ok); assertOracle(world, agent.value.view);
    await page.waitForFunction(() => !document.querySelector('[data-object-id="bc"]'));
    await page.locator('[data-object-id="b"]').first().click(); view = await human(() => page.getByTestId("action-delete").click());
    const checked = await sdk.call("check_result", { expectedRevision: view.revision }); assert.ok(checked.ok); assert.equal(checked.value.passed, true);
    const response = page.waitForResponse(response => response.url() === childOrigin + "/api/check"); await page.getByTestId("check").click(); const humanResult = await (await response).json(); assert.deepEqual(humanResult.value, checked.value);
    const final = await observe(); const adapter = await createExcalidrawAdapter(final.state);
    try { const artifact = await adapter.exportArtifact(); const verdict = await checkInProcess(world, artifact.native, { bundle, seed: final.seed, taskId: final.task.id }); assert.equal(verdict.passed, true); }
    finally { await adapter.close(); }
    for (const output of sdk.outputs) { const serialized = JSON.stringify(output); assert.equal(serialized.includes(childToken), false); assert.equal(serialized.includes("heldOutTasks"), false); }
    assert.deepEqual(s.external, []);
  } finally { await sdk?.close(); await s.close(); }
});

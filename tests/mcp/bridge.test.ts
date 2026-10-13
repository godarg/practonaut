import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, chmod, symlink, link, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createBridge, readSessionToken, requireHostOrigin } from "../../src/mcp/bridge.ts";
import { createTokenFile } from "../../src/host/token-file.ts";
import { fixture } from "../e2e/harness.ts";
import { HOST_LIMITS } from "../../src/host/limits.ts";
import type { McpToolInputs } from "../../src/mcp/contracts.ts";

test("canonical host origin cannot choose a remote host, credentials, redirect path or alternate loopback spelling", () => {
  for (const host of ["https://127.0.0.1:1234", "http://localhost:1234", "http://127.0.0.2:1234", "http://[::1]:1234", "http://127.0.0.1:1234/", "http://user:pass@127.0.0.1:1234", "http://127.0.0.1:1234?token=x", "http://2130706433:1234", "http://127.0.0.1:1234/#x"]) assert.throws(() => requireHostOrigin(host), /loopback/);
  assert.equal(requireHostOrigin("http://127.0.0.1:1234"), "http://127.0.0.1:1234");
});
test("credential descriptor rejects symlinks, public modes, hardlinks and malformed credentials", async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "pn-mcp-credential-"));
  try {
    const token = "a".repeat(64), file = await createTokenFile(dir, token);
    assert.equal(await readSessionToken(file.path), token);
    const alias = join(dir, "alias"); await symlink(file.path, alias); await assert.rejects(readSessionToken(alias), /unsafe/);
    await chmod(file.path, 0o644); await assert.rejects(readSessionToken(file.path), /unsafe/); await chmod(file.path, 0o600);
    await link(file.path, join(dir, "hard")); await assert.rejects(readSessionToken(file.path), /unsafe/); await rm(join(dir, "hard"));
    await chmod(dir, 0o755); await assert.rejects(readSessionToken(file.path), /unsafe/); await chmod(dir, 0o700);
    await writeFile(file.path, "bad\n"); await assert.rejects(readSessionToken(file.path), /unsafe/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("strict tool input requires observed step and revision, reset confirmation and bounded parameters", async () => {
  const f = await fixture({ mirror: "off" });
  try {
    const bridge = await createBridge({ host: f.host.origin, tokenFile: f.host.tokenFile });
    for (const input of [{ name: "move_step", params: {}, baseStep: 0 }, { name: "move_step", params: {}, expectedRevision: 0 }, { name: "move_step", params: { nested: {} }, baseStep: 0, expectedRevision: 0 }, { name: "move_step", params: {}, baseStep: 0, expectedRevision: 0, token: "x" }]) {
      const reply = await bridge.call("act", input as McpToolInputs["act"]); assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, "invalid_request");
    }
    const reset = await bridge.call("reset", { expectedRevision: 0, confirmed: false } as unknown as McpToolInputs["reset"]); assert.equal(reset.ok, false);
    const before = await f.observe();
    for (let n = 0; n < 230; n++) await bridge.call("observe", { unexpected: n } as unknown as McpToolInputs["observe"]);
    const limited = await bridge.call("observe", {}); assert.equal(limited.ok, false); if (!limited.ok) assert.equal(limited.error.code, "rate_limited");
    assert.deepEqual(await f.observe(), before);
  } finally { await f.close(); }
});
test("host reply is bounded, must not redirect, and never introduces an extra hidden field or credential", async () => {
  const f = await fixture({ mirror: "off" }); const view = await f.observe(); const token = "b".repeat(64);
  let mode = "canary", seen = 0;
  const server = createServer((_req, response) => {
    seen++; if (mode === "redirect") { response.writeHead(302, { Location: f.host.origin + "/api/observe" }); response.end(); return; }
    response.setHeader("Content-Type", "application/json");
    response.end(mode === "large" ? "x".repeat(HOST_LIMITS.replyBytes + 1) : JSON.stringify({ ok: true, value: mode === "canary" ? { ...view, heldOutTasks: [{ solution: "PN_HIDDEN_CANARY_20261009" }] } : { ...view, sessionId: token } }));
  });
  await new Promise<void>(ready => server.listen(0, "127.0.0.1", ready)); const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    const bridge = await createBridge({ host: `http://127.0.0.1:${address.port}`, token });
    for (const setting of ["canary", "credential", "large", "redirect"]) { mode = setting; const result = await bridge.call("observe", {}); assert.equal(result.ok, false); assert.equal(JSON.stringify(result).includes("PN_HIDDEN_CANARY_20261009"), false); assert.equal(JSON.stringify(result).includes(token), false); }
    assert.equal(seen, 4);
  } finally { await new Promise<void>(done => server.close(() => done())); await f.close(); }
});

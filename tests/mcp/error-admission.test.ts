import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTokenFile } from "../../src/host/token-file.ts";
import { MCP_TOOL_NAMES, type McpToolInputs, type McpToolName } from "../../src/mcp/contracts.ts";
import { sdkClient } from "./client-helper.ts";

const inputs: McpToolInputs = {
  observe: {}, list_actions: {}, explain_result: {},
  act: { name: "delete_step", params: { id: "a" }, baseStep: 0, expectedRevision: 0 },
  undo: { expectedRevision: 0 }, reset: { expectedRevision: 0, confirmed: true },
  check_result: { expectedRevision: 0 },
};

async function wireProbe(run: (sdk: Awaited<ReturnType<typeof sdkClient>>, token: string, body: (next: string) => void) => Promise<void>) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "pn-mcp-error-admission-"));
  // Generated synthetic credential only; no account or external service is involved.
  const token = "9".repeat(64), file = await createTokenFile(directory, token);
  let current = "", requests = 0;
  const server = createServer((request, response) => {
    assert.equal(request.headers["x-practonaut-token"], token);
    requests++; response.writeHead(400, { "Content-Type": "application/json" }); response.end(current);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  try {
    for (const modern of [true, false]) {
      const sdk = await sdkClient({ origin: `http://127.0.0.1:${address.port}`, tokenFile: file.path }, modern);
      try { await run(sdk, token, next => { current = next; }); assert.equal(sdk.stderr(), ""); }
      finally { await sdk.close(); }
    }
    assert.ok(requests > 0, "Probe must traverse a real HTTP host and SDK stdio transport");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
}

test("all seven MCP tools reject JSON-escaped credentials on modern and legacy wire", { timeout: 60_000 }, async () => {
  await wireProbe(async (sdk, token, body) => {
    const encodedFirst = "\\u0039" + token.slice(1), encodedAll = "\\u0039".repeat(64);
    for (const encoded of [token, encodedFirst, encodedAll]) {
      // The independent expected value is the fully decoded JSON string, not a bridge helper.
      assert.equal(JSON.parse(`"${encoded}"`), token);
      body(`{"ok":false,"error":{"code":"invalid_request","message":"${encoded}"}}`);
      for (const name of MCP_TOOL_NAMES) {
        const reply = await sdk.call(name, inputs[name]);
        assert.equal(reply.ok, false);
        assert.equal(JSON.stringify(reply).includes(token), false, `${name} leaked the decoded credential`);
      }
    }
    assert.equal(JSON.stringify(sdk.outputs).includes(token), false);
  });
});

test("MCP error admission rejects unknown codes and opaque details without hiding safe public failures", { timeout: 60_000 }, async () => {
  const canary = "PN_ERROR_DETAILS_CANARY";
  await wireProbe(async (sdk, _token, body) => {
    for (const raw of [
      { ok: false, error: { code: "future_private_error", message: canary } },
      { ok: false, error: { code: "invalid_request", message: "Public rejection", details: { heldOutSolution: canary } } },
    ]) {
      body(JSON.stringify(raw));
      for (const name of MCP_TOOL_NAMES) {
        const reply = await sdk.call(name as McpToolName, inputs[name]);
        assert.equal(reply.ok, false); if (!reply.ok) assert.equal(reply.error.code, "invalid_request");
        assert.equal(JSON.stringify(reply).includes(canary), false);
      }
    }
    const control = { ok: false, error: { code: "stale_base", message: "Board changed since this request" } };
    body(JSON.stringify(control));
    for (const name of MCP_TOOL_NAMES) assert.deepEqual(await sdk.call(name, inputs[name]), control);
    assert.equal(JSON.stringify(sdk.outputs).includes(canary), false);
  });
});

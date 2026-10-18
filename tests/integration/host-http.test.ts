import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "node:http";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile, lstat, readdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { startHost, PLAYER_CSP, type HostOptions } from "../../src/host/server.ts";
import { HOST_LIMITS } from "../../src/host/limits.ts";
import { createPracticeSession, createPracticeController, type MirrorDiagnostic, type PracticeSessionOptions } from "../../src/host/session.ts";
import { TOKEN_HEADER, type RunningHost, type ControllerFactory, type HostView } from "../../src/host/protocol.ts";
import { validateWorld } from "../../src/world/index.ts";
import { packWorld, readWorldPackage } from "../../src/package/index.ts";
import { loadWorldPackage } from "../../src/world/index.ts";
import { Session } from "../../src/core/index.ts";
import { stateHash } from "../../src/canonical/index.ts";
import type { State } from "../../src/world/types.ts";
import type { PracticeMirror } from "../../src/host/mirror.ts";
import { solution } from "./solutions.ts";
import { POSIX } from "../support/platform.ts";

async function fixture(controllerFactory?: ControllerFactory, extra: Pick<HostOptions, "singleTask"> = {}): Promise<{ dir: string; host: RunningHost }> {
  await mkdir(".local", { recursive: true }); const dir = await mkdtemp(resolve(".local/host-http-"));
  const assets = join(dir, "player"); await mkdir(assets);
  for (const file of ["index.html", "player.js", "player.css", "tokens.css"]) await writeFile(join(assets, file), file === "index.html" ? '<!doctype html><script src="/player.js"></script>' : "/* fixed shell */");
  const world = validateWorld(JSON.parse(await readFile("tests/fixtures/core/world.json", "utf8")));
  const host = await startHost(world, { mirror: "off", assetDirectory: assets, tokenDirectory: join(dir, "tokens"), ...extra, ...(controllerFactory ? { controllerFactory } : {}) });
  return { dir, host };
}
async function dispose(f: { dir: string; host: RunningHost }): Promise<void> { await f.host.close(); await rm(f.dir, { recursive: true, force: true }); }
interface Reply { status: number; headers: Record<string, string | string[] | undefined>; text: string; value: { ok: boolean; error?: { code: string }; value?: unknown } }
function call(host: RunningHost, path: string, options: { method?: string; headers?: Record<string, string>; body?: string; chunks?: string[] } = {}): Promise<Reply> {
  return new Promise((resolveReply, reject) => {
    const req = request(host.origin + path, { method: options.method ?? "GET", headers: options.headers ?? {}, agent: false }, response => {
      const chunks: Buffer[] = []; response.on("data", (chunk: Buffer) => chunks.push(chunk)); response.on("error", reject);
      response.on("end", () => { const text = Buffer.concat(chunks).toString(); let value: Reply["value"]; try { value = JSON.parse(text); } catch { value = { ok: true }; } resolveReply({ status: response.statusCode!, headers: response.headers, text, value }); });
    });
    req.on("error", reject);
    for (const chunk of options.chunks ?? []) req.write(chunk);
    req.end(options.body);
  });
}
const auth = (host: RunningHost): Record<string, string> => ({ [TOKEN_HEADER]: host.token, "Content-Type": "application/json" });
const view = async (host: RunningHost): Promise<unknown> => (await call(host, "/api/observe", { headers: auth(host) })).value.value;

test('resume requires the existing credential and origin boundary without reissuing a token or mutating state', async () => {
  const f = await fixture();
  try {
    const before = await view(f.host);
    for (const probe of [
      {headers:{},code:'token_required'},
      {headers:{[TOKEN_HEADER]:'invalid'},code:'token_invalid'},
      {headers:{...auth(f.host),Origin:'null'},code:'origin_rejected'},
      {headers:{...auth(f.host),Origin:'http://127.0.0.1:1'},code:'origin_rejected'},
      {headers:{...auth(f.host),Host:'foreign.invalid'},code:'host_rejected'},
    ]) assert.equal((await call(f.host,'/api/resume',{headers:probe.headers})).value.error?.code,probe.code);
    const restored = await call(f.host,'/api/resume',{headers:{...auth(f.host),Origin:f.host.origin}});
    assert.equal(restored.status,200);assert.deepEqual(restored.value.value,{view:before});
    assert.equal(restored.text.includes(f.host.token),false);assert.equal(restored.headers['set-cookie'],undefined);
    assert.equal((await call(f.host,'/api/resume?token=invalid',{headers:auth(f.host)})).value.error?.code,'token_in_query');
    assert.equal((await call(f.host,'/api/resume?project=x',{headers:auth(f.host)})).value.error?.code,'invalid_request');
    assert.equal((await call(f.host,'/api/resume',{method:'POST',headers:auth(f.host),body:'{}'})).status,405);
    assert.deepEqual(await view(f.host),before);
  } finally {await dispose(f);}
});

function assertRecoveredView(actual: unknown, before: unknown, recoveries: number): void {
  const { mirrorHealth: actualHealth, ...actualCommitted } = actual as HostView;
  const { mirrorHealth: beforeHealth, ...beforeCommitted } = before as HostView;
  assert.deepEqual(actualCommitted, beforeCommitted, "failed mirror transactions must preserve every committed field");
  assert.equal(beforeHealth.status, "available");
  assert.deepEqual(actualHealth, { ...beforeHealth, status: "available", recoveries }, "successful recovery is observable without a core commit");
}

test("real listener rejects every auth/CSRF/body/schema failure without state mutation", async () => {
  const f = await fixture();
  try {
    const before = await view(f.host);
    const probes = [
      { path: "/api/act", headers: { "Content-Type": "application/json" }, code: "token_required", status: 401 },
      { path: "/api/act", headers: { ...auth(f.host), [TOKEN_HEADER]: "invalid" }, code: "token_invalid", status: 401 },
      { path: "/api/act?token=bogus", headers: auth(f.host), code: "token_in_query", status: 400 },
      { path: "/api/act?x=" + f.host.token, headers: auth(f.host), code: "token_in_query", status: 400 },
      { path: "/api/act", headers: { ...auth(f.host), Host: "attacker.invalid" }, code: "host_rejected", status: 421 },
      { path: "/api/act", headers: { ...auth(f.host), Origin: "https://attacker.invalid" }, code: "origin_rejected", status: 403 },
      { path: "/api/act", headers: { ...auth(f.host), Origin: "null" }, code: "origin_rejected", status: 403 },
      { path: "/api/act", headers: { ...auth(f.host), "Content-Type": "text/plain" }, code: "json_required", status: 415 },
      { path: "/api/act", headers: { ...auth(f.host), "Content-Encoding": "gzip" }, code: "invalid_request", status: 400 },
    ];
    for (const probe of probes) {
      const result = await call(f.host, probe.path, { method: "POST", headers: probe.headers, body: JSON.stringify({ expectedRevision: 0, action: { name: "rename_step", params: { id: "a", label: "changed" } } }) });
      assert.equal(result.status, probe.status); assert.equal(result.value.error?.code, probe.code);
      assert.equal(result.headers["access-control-allow-origin"], undefined); assert.deepEqual(await view(f.host), before);
    }
    for (const path of ["/api/act", "/api/undo", "/api/reset", "/api/variant", "/api/hint", "/api/check"]) {
      const simple = await call(f.host, path, { method: "POST", headers: { Origin: "https://foreign.invalid", "Content-Type": "text/plain" }, body: "{}" });
      assert.equal(simple.value.error?.code, "origin_rejected"); assert.deepEqual(await view(f.host), before);
    }
    for (const raw of ["{}", "null", "{", JSON.stringify({ expectedRevision: 0, extra: true, action: { name: "move_step", params: { id: "a", x: 10, y: 10 } } }), JSON.stringify({ expectedRevision: 0, action: { name: "move_step", params: {}, unchecked: true } }), '{"expectedRevision":0,"action":{"name":"move_step","params":{"id":[1]}}}', "[".repeat(17) + "0" + "]".repeat(17)]) {
      const result = await call(f.host, "/api/act", { method: "POST", headers: auth(f.host), body: raw });
      assert.equal(result.value.error?.code, "invalid_request"); assert.deepEqual(await view(f.host), before);
    }
    const oversized = await call(f.host, "/api/act", { method: "POST", headers: auth(f.host), body: " ".repeat(HOST_LIMITS.bodyBytes + 1) });
    assert.equal(oversized.status, 413); assert.equal(oversized.value.error?.code, "body_too_large");
    const chunked = await call(f.host, "/api/act", { method: "POST", headers: auth(f.host), chunks: [" ".repeat(HOST_LIMITS.bodyBytes), "x"] });
    assert.equal(chunked.status, 413); assert.equal(chunked.value.error?.code, "body_too_large"); assert.deepEqual(await view(f.host), before);
    for (const path of ["/api/observe", "/api/events", "/api/tool.png", "/", "/player.js", "/player.css", "/tokens.css"]) {
      const result = await call(f.host, path, { headers: { ...auth(f.host), Host: "foreign.invalid" } }); assert.equal(result.value.error?.code, "host_rejected");
      const foreign = await call(f.host, path, { headers: { ...auth(f.host), Origin: "null" } }); assert.equal(foreign.value.error?.code, "origin_rejected");
    }
    for (const path of ["/../secret", "/%2e%2e/secret", "/favicon.ico", "/api/checker", "/tokens/secret", "/node_modules/file"]) assert.equal((await call(f.host, path)).status, 404);
    assert.equal((await call(f.host, "/api/act", { headers: auth(f.host) })).value.error?.code, "method_not_allowed");
    const noConfirmation = await call(f.host, "/api/reset", { method: "POST", headers: auth(f.host), body: '{"expectedRevision":0}' }); assert.equal(noConfirmation.value.error?.code, "invalid_request");
  } finally { await dispose(f); }
});

test("bootstrap is same-origin strict JSON, single use and expires after 5 minutes", async t => {
  const f = await fixture();
  try {
    assert.equal(/\/#code=[0-9a-f]{32}$/.test(f.host.url),true,'one-use bootstrap fragment must be present'); assert.equal(f.host.url.includes(f.host.token), false);
    const invalid = await call(f.host, "/api/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"code":"wrong"}' }); assert.equal(invalid.value.error?.code, "token_invalid");
    const exchange = await call(f.host, "/api/bootstrap", { method: "POST", headers: { "Content-Type": "application/json", Origin: f.host.origin }, body: JSON.stringify({ code: f.host.code }) });
    assert.equal(exchange.status, 200); assert.equal((exchange.value.value as { token: string }).token===f.host.token,true,'bootstrap practice capability must match');
    const replay = await call(f.host, "/api/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: f.host.code }) }); assert.equal(replay.status, 401); assert.equal(replay.value.error?.code, "bootstrap_used");
  } finally { await dispose(f); }
  const expired = await fixture();
  try {
    const realNow = Date.now(); t.mock.method(Date, "now", () => realNow + HOST_LIMITS.bootstrapTtlMs + 1);
    const result = await call(expired.host, "/api/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: expired.host.code }) }); assert.equal(result.status, 401); assert.equal(result.value.error?.code, "bootstrap_expired");
  } finally { t.mock.restoreAll(); await dispose(expired); }
});

test("a new link (o + Enter) issues a fresh one-use code and revokes the unused previous one", async t => {
  const f = await fixture();
  const post = (code: string) => call(f.host, "/api/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  try {
    assert.equal(HOST_LIMITS.bootstrapTtlMs, 5 * 60_000);
    const first = await post(f.host.code); assert.equal(first.status, 200);
    const second = f.host.issueUrl(); assert.match(second, /^http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32}$/); assert.equal(second.startsWith(f.host.origin + "/#code="), true);
    const secondCode = second.slice(second.indexOf("#code=") + 6); assert.notEqual(secondCode, f.host.code); assert.equal(second.includes(f.host.token), false);
    const third = f.host.issueUrl(); const thirdCode = third.slice(third.indexOf("#code=") + 6);
    const revoked = await post(secondCode); assert.equal(revoked.status, 401); assert.equal(revoked.value.error?.code, "token_invalid", "issuing a link revokes the unused previous one");
    // Still valid just inside its 5-minute lifetime, then exactly once.
    const realNow = Date.now(); t.mock.method(Date, "now", () => realNow + HOST_LIMITS.bootstrapTtlMs - 5_000);
    const late = await post(thirdCode); assert.equal(late.status, 200); assert.equal((late.value.value as { token: string }).token, f.host.token, "every tab joins the same session");
    t.mock.restoreAll();
    for (const code of [f.host.code, thirdCode]) { const replay = await post(code); assert.equal(replay.status, 401); assert.equal(replay.value.error?.code, "bootstrap_used"); }
  } finally { t.mock.restoreAll(); await dispose(f); }
});

test("CSP, fixed asset allowlist, loopback listener and runtime file removal", async () => {
  const f = await fixture();
  try {
    const shell = await call(f.host, "/"); assert.equal(shell.status, 200); assert.equal(shell.headers["content-security-policy"], PLAYER_CSP); assert.doesNotMatch(PLAYER_CSP, /unsafe-inline/); assert.match(PLAYER_CSP, /require-trusted-types-for 'script'/);
    assert.equal(shell.headers["x-content-type-options"], "nosniff"); assert.equal(shell.headers["cache-control"], "no-store");
    if (POSIX) assert.equal((await lstat(f.host.tokenFile)).mode & 0o777, 0o600);
    if (process.platform === "win32") {
      // Windows has no lsof; netstat lists the listening sockets with their bound address.
      const listener = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
      const lines = listener.stdout.split(/\r?\n/).filter(line => /LISTENING/.test(line) && new RegExp(`:${f.host.port}\\s`).test(line));
      assert.equal(listener.status, 0, listener.stderr); assert.ok(lines.length > 0, "the host listens"); assert.ok(lines.every(line => line.includes(`127.0.0.1:${f.host.port}`)), lines.join("\n"));
    } else {
      const listener = spawnSync("lsof", ["-nP", `-iTCP:${f.host.port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
      assert.equal(listener.status, 0, listener.stderr); assert.match(listener.stdout, new RegExp(`127\\.0\\.0\\.1:${f.host.port}`)); assert.doesNotMatch(listener.stdout, /\*:\d+|\[::\]/);
    }
    assert.equal((await call(f.host, "/api/tool.png", { headers: auth(f.host) })).value.error?.code, "mirror_unavailable");
    await f.host.close(); await assert.rejects(lstat(f.host.tokenFile), { code: "ENOENT" }); await f.host.close();
  } finally { await dispose(f); }
});

test("HTTP rate limit is visible and leaves session unchanged", async () => {
  const f = await fixture();
  try {
    const before = await view(f.host);
    const results: Reply[] = [];
    for (let batch = 0; batch < 14; batch++) results.push(...await Promise.all(Array.from({ length: 20 }, () => call(f.host, "/api/act", { method: "POST", headers: auth(f.host), body: "{}" }))));
    assert.ok(results.some(reply => reply.status === 429 && reply.value.error?.code === "rate_limited"));
    await new Promise(done => setTimeout(done, 50)); assert.deepEqual(await view(f.host), before);
  } finally { await dispose(f); }
});

test("SSE requires header token, emits named ready event and caps connected clients", async () => {
  const f = await fixture(); const requests: ReturnType<typeof request>[] = [];
  try {
    assert.equal((await call(f.host, "/api/events")).value.error?.code, "token_required");
    for (let i = 0; i < HOST_LIMITS.sseClients; i++) await new Promise<void>((done, reject) => {
      const req = request(f.host.origin + "/api/events", { headers: auth(f.host) }, response => {
        assert.equal(response.statusCode, 200); assert.match(response.headers["content-type"] ?? "", /text\/event-stream/);
        response.once("data", chunk => { assert.match(chunk.toString(), /event: ready\ndata:/); done(); }); response.on("error", () => {});
      }); requests.push(req); req.on("error", reject); req.end();
    });
    const capped = await call(f.host, "/api/events", { headers: auth(f.host) }); assert.equal(capped.value.error?.code, "limit_exceeded");
  } finally { for (const req of requests) req.destroy(); await dispose(f); }
});

test("websocket upgrades are refused and oversized raw headers receive 431", async () => {
  const f = await fixture();
  try {
    const raw = (requestText: string): Promise<string> => new Promise((done, reject) => {
      const socket = connect(f.host.port, "127.0.0.1"); const chunks: Buffer[] = [];
      socket.once("connect", () => socket.write(requestText)); socket.on("data", chunk => chunks.push(chunk)); socket.on("error", reject); socket.on("end", () => done(Buffer.concat(chunks).toString()));
    });
    assert.match(await raw(`GET /api/events HTTP/1.1\r\nHost: foreign.invalid\r\nOrigin: null\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`), /400 Bad Request/);
    assert.match(await raw(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${f.host.port}\r\nX-Large: ${"x".repeat(HOST_LIMITS.headerBytes)}\r\n\r\n`), /431 Request Header Fields Too Large/);
  } finally { await dispose(f); }
});

test("real mirror confirms HTTP steps, host hash equals independent kernel and replay", { timeout: 60_000 }, async () => {
  await mkdir(".local", { recursive: true }); const dir = await mkdtemp(resolve(".local/host-mirror-"));
  const assets = join(dir, "player"); await mkdir(assets); for (const name of ["index.html", "player.js", "player.css", "tokens.css"]) await writeFile(join(assets, name), "fixed");
  const world = loadWorldPackage(await readWorldPackage(await packWorld("examples/worlds/flow-diagram")));
  const host = await startHost(world, { assetDirectory: assets, tokenDirectory: join(dir, "tokens"), seed: 42, taskId: "T3" });
  try {
    const oracle = new Session(world, 42, "T3"); let revision = 0;
    for (const action of solution(world, 42, "T3")) {
      assert.equal(oracle.act(action).ok, true);
      const result = await call(host, "/api/act", { method: "POST", headers: auth(host), body: JSON.stringify({ expectedRevision: revision, action }) }); assert.equal(result.status, 200, result.text);
      const payload = result.value.value as { mirrorConfirmed: boolean; view: { hash: string; revision: number; state: unknown } }; assert.equal(payload.mirrorConfirmed, true); assert.equal(payload.view.hash, oracle.hash); assert.deepEqual(payload.view.state, oracle.state); assert.equal(oracle.checkReplay().ok, true); revision = payload.view.revision;
    }
    const checked = await call(host, "/api/check", { method: "POST", headers: auth(host), body: JSON.stringify({ expectedRevision: revision }) }); assert.equal(checked.status, 200, checked.text); assert.equal((checked.value.value as { passed: boolean }).passed, true);
    const image = await call(host, "/api/tool.png", { headers: auth(host) }); assert.equal(image.status, 200); assert.equal(image.headers["content-type"], "image/png"); assert.equal(image.headers["x-content-type-options"], "nosniff");
  } finally { await host.close(); await rm(dir, { recursive: true, force: true }); }
});

/** Controller faults injected at the HTTP process seam; no kernel or mirror implementation is mocked. */
test("reply and PNG budgets reject oversized controller outputs; unexpected errors never disclose secrets", async () => {
  let secret = "";
  const f = await fixture(async (world, options) => {
    const controller = await createPracticeSession(world, options);
    return { ...controller,
      view: () => { const normal = controller.view(); return { ...normal, task: { ...normal.task, title: { en: "x".repeat(HOST_LIMITS.replyBytes), de: "large" } } }; },
      png: async () => ({ ok: true, value: new Uint8Array(HOST_LIMITS.replyBytes + 1) }),
      act: async () => { throw new Error(secret); },
    };
  });
  try {
    secret = f.host.token;
    const observed = await call(f.host, "/api/observe", { headers: auth(f.host) }); assert.equal(observed.status, 413); assert.equal(observed.value.error?.code, "result_too_large");
    const png = await call(f.host, "/api/tool.png", { headers: auth(f.host) }); assert.equal(png.status, 413); assert.equal(png.value.error?.code, "result_too_large");
    const unexpected = await call(f.host, "/api/act", { method: "POST", headers: auth(f.host), body: '{"expectedRevision":0,"action":{"name":"unmodeled","params":{}}}' }); assert.equal(unexpected.value.error?.code, "mirror_unavailable"); assert.equal(unexpected.text.includes(secret), false);
  } finally { await dispose(f); }
});


test("HTTP mirror disagreement persists private before/predicted/readback diagnosis and preserves session", async () => {
  let observedToken = "";
  let readback: State | undefined;
  const f = await fixture(async (world, options) => createPracticeController(world, { ...(options as PracticeSessionOptions), mirror: "required" }, async initial => {
    let state = structuredClone(initial);
    const mirror: PracticeMirror = {
      async apply(transition) {
        state = structuredClone(transition.after);
        const target = state.objects.a; assert.ok(target && target.type === "step");
        target.label = observedToken + " corrupted readback"; readback = structuredClone(state);
        return { ok: true, state: structuredClone(state), warnings: [] };
      },
      async replace(next) { state = structuredClone(next); return { ok: true, state: structuredClone(state), warnings: [] }; },
      async snapshot() { return structuredClone(state); },
      async recover(next) { state = structuredClone(next); }, async png() { return new Uint8Array(); }, async close() {},
    };
    return mirror;
  }));
  try {
    observedToken = f.host.token;
    const before = (await call(f.host, "/api/observe", { headers: auth(f.host) })).value.value;
    const action = { name: "move_step", params: { id: "a", x: 220, y: 180 } };
    const rejected = await call(f.host, "/api/act", { method: "POST", headers: auth(f.host), body: JSON.stringify({ expectedRevision: 0, action }) });
    assert.equal(rejected.status, 409); assert.equal(rejected.value.error?.code, "real_tool_disagrees"); assertRecoveredView(await view(f.host), before, 1);
    const directory = dirname(f.host.tokenFile);
    const files = (await readdir(directory)).filter(name => name.endsWith(".mirror.jsonl")); assert.equal(files.length, 1);
    const path = join(directory, files[0]!); if (POSIX) { assert.equal((await lstat(path)).mode & 0o777, 0o600); assert.equal((await lstat(directory)).mode & 0o777, 0o700); }
    const log = await readFile(path, "utf8"); assert.equal(log.includes(f.host.token), false); assert.equal(log.includes(f.host.code), false);
    const records = log.trim().split("\n").map(line => JSON.parse(line)); assert.equal(records.length, 1);
    const record = records[0] as MirrorDiagnostic & { schema: string; redacted: boolean };
    assert.equal(record.schema, "practonaut.mirror-diagnostic/1"); assert.equal(record.code, "real_tool_disagrees"); assert.equal(record.action, "move_step"); assert.equal(record.revision, 0);
    const original = before as { state: State; hash: string }; assert.deepEqual(record.before, original && { state: original.state, hash: original.hash });
    const oracle = new Session(validateWorld(JSON.parse(await readFile("tests/fixtures/core/world.json", "utf8"))), 0, "T1"); assert.equal(oracle.act(action).ok, true); assert.deepEqual(record.predicted, { state: oracle.state, hash: oracle.hash });
    assert.ok(readback); assert.equal(record.readback!.hash, stateHash(readback)); assert.equal(record.redacted, true);
    assert.match((record.readback!.state.objects.a as { label: string }).label, /\[session-token-redacted\]/);
    assert.equal((await call(f.host, "/api/diagnostics", { headers: auth(f.host) })).status, 404);
    await f.host.close(); assert.equal((await readFile(path, "utf8")), log);
  } finally { await dispose(f); }
});

test("private diagnostics rotate at 4MiB and oversized faults fail by name with rollback", async () => {
  let poisonBytes = 2300 * 1024;
  let recovered = 0;
  const f = await fixture(async (world, options) => createPracticeController(world, { ...(options as PracticeSessionOptions), mirror: "required" }, async initial => {
    let state = structuredClone(initial);
    return {
      async apply(transition) {
        state = structuredClone(transition.after);
        const step = state.objects.a; assert.ok(step && step.type === "step"); step.label = "x".repeat(poisonBytes);
        return { ok: true, state: structuredClone(state), warnings: [] };
      },
      async replace(next) { state = structuredClone(next); return { ok: true, state: structuredClone(state), warnings: [] }; },
      async snapshot() { return structuredClone(state); }, async recover(next) { recovered++; state = structuredClone(next); },
      async png() { return new Uint8Array(); }, async close() {},
    };
  }));
  try {
    const before = await view(f.host);
    const invoke = () => call(f.host, "/api/act", { method: "POST", headers: auth(f.host), body: '{"expectedRevision":0,"action":{"name":"move_step","params":{"id":"a","x":220,"y":180}}}' });
    for (let i = 0; i < 2; i++) { assert.equal((await invoke()).value.error?.code, "real_tool_disagrees"); assertRecoveredView(await view(f.host), before, i + 1); }
    const directory = dirname(f.host.tokenFile); const names = (await readdir(directory)).filter(name => name.endsWith(".mirror.jsonl")); assert.equal(names.length, 1);
    const path = join(directory, names[0]!); assert.ok((await lstat(path)).size <= 4 * 1024 * 1024);
    const lines = (await readFile(path, "utf8")).trim().split("\n"); assert.equal(lines.length, 1); assert.equal(JSON.parse(lines[0]!).generation, 1);
    poisonBytes = 5 * 1024 * 1024;
    const oversized = await invoke(); assert.equal(oversized.status, 413); assert.equal(oversized.value.error?.code, "diagnostic_limit"); assert.ok(recovered >= 3);
    assertRecoveredView(await view(f.host), before, 3); assert.ok((await lstat(path)).size <= 4 * 1024 * 1024);
  } finally { await dispose(f); }
});


test("variant HTTP confirmation boundary rejects missing or false consent before controller dispatch", async () => {
  let dispatched = 0;
  const f = await fixture(async (world, options) => {
    const controller = await createPracticeSession(world, options);
    return { ...controller, async variant(request) { dispatched++; return controller.variant(request); } };
  });
  try {
    const before = await view(f.host);
    for (const extra of [{}, { confirmed: false }, { confirmed: "true" }, { confirmed: 1 }, { confirmed: null }]) {
      const rejected = await call(f.host, "/api/variant", { method: "POST", headers: auth(f.host), body: JSON.stringify({ expectedRevision: 0, ...extra }) });
      assert.equal(rejected.status, 400); assert.equal(rejected.value.error?.code, "invalid_request"); assert.equal(dispatched, 0, "missing confirmation must be rejected by the HTTP schema");
      assert.deepEqual(await view(f.host), before);
    }
  } finally { await dispose(f); }
});

test("confirmed HTTP task switch keeps seed, confirmed variant changes case; rejected switches preserve work and hints", async () => {
  const world = loadWorldPackage(await readWorldPackage(await packWorld("examples/worlds/flow-diagram")));
  const f = await fixture(async (_fixtureWorld, options) => createPracticeSession(world, { ...options, seed: 42, taskId: "T3" }));
  try {
    const moved = await call(f.host, "/api/act", { method: "POST", headers: auth(f.host), body: '{"expectedRevision":0,"action":{"name":"move_step","params":{"id":"a","x":200,"y":220}}}' }); assert.equal(moved.value.ok, true);
    assert.equal((await call(f.host, "/api/hint", { method: "POST", headers: auth(f.host), body: '{"expectedRevision":1}' })).value.ok, true);
    const before = await view(f.host) as HostView; assert.equal(before.step, 1); assert.equal(before.hintsOpened, 1);
    for (const payload of [{ expectedRevision: before.revision, taskId: "T1" }, { expectedRevision: before.revision, taskId: "T1", confirmed: false }, { expectedRevision: before.revision, confirmed: false }]) {
      const rejected = await call(f.host, "/api/variant", { method: "POST", headers: auth(f.host), body: JSON.stringify(payload) }); assert.equal(rejected.value.error?.code, "invalid_request"); assert.deepEqual(await view(f.host), before);
    }
    const task = await call(f.host, "/api/variant", { method: "POST", headers: auth(f.host), body: JSON.stringify({ expectedRevision: before.revision, taskId: "T1", confirmed: true }) }); assert.equal(task.value.ok, true, task.text);
    const switched = await view(f.host) as HostView; assert.equal(switched.task.id, "T1"); assert.equal(switched.seed, before.seed); assert.equal(switched.variantId, before.variantId); assert.equal(switched.revision, before.revision + 1); assert.equal(switched.step, 0); assert.equal(switched.hintsOpened, 0);
    const oracle = new Session(world, before.seed, "T1"); assert.deepEqual(switched.state, oracle.state); assert.equal(switched.hash, oracle.hash); assert.equal(oracle.checkReplay().ok, true);
    const variant = await call(f.host, "/api/variant", { method: "POST", headers: auth(f.host), body: JSON.stringify({ expectedRevision: switched.revision, confirmed: true }) }); assert.equal(variant.value.ok, true, variant.text);
    const next = await view(f.host) as HostView; assert.equal(next.task.id, switched.task.id); assert.notEqual(next.variantId, switched.variantId); assert.notEqual(next.seed, switched.seed);
    const nextOracle = new Session(world, next.seed, next.task.id); assert.deepEqual(next.state, nextOracle.state); assert.equal(next.hash, nextOracle.hash); assert.equal(nextOracle.checkReplay().ok, true);
  } finally { await dispose(f); }
});

// A bench host (singleTask) judges the run's own task at the run's own seed. Its token is in a file
// a same-user agent can read, so no direct HTTP request may switch the variant (a new seed) or
// restart the task past the bench's counted reset; a Player host keeps both.
test("a single-task host refuses every variant request over HTTP; a Player host still accepts one", async () => {
  const world = loadWorldPackage(await readWorldPackage(await packWorld("examples/worlds/flow-diagram")));
  const factory: ControllerFactory = async (_fixtureWorld, options) => createPracticeSession(world, { ...options, seed: 42, taskId: "T3" });
  const bench = await fixture(factory, { singleTask: true });
  try {
    const before = await view(bench.host) as HostView;
    assert.deepEqual([before.seed, before.task.id, before.tasks.map(task => task.id)], [42, "T3", ["T3"]]);
    for (const extra of [{}, { taskId: "T3" }, { taskId: "T1" }]) {
      const refused = await call(bench.host, "/api/variant", { method: "POST", headers: auth(bench.host), body: JSON.stringify({ expectedRevision: before.revision, confirmed: true, ...extra }) });
      assert.equal(refused.status, 400, `${JSON.stringify(extra)}: ${refused.text.slice(0, 200)}`); assert.equal(refused.value.error?.code, "invalid_request");
      assert.deepEqual(await view(bench.host), before, `${JSON.stringify(extra)} leaves seed, variant, task and revision as they were`);
    }
    // The counted way back to the start stays open.
    const reset = await call(bench.host, "/api/reset", { method: "POST", headers: auth(bench.host), body: JSON.stringify({ expectedRevision: before.revision, confirmed: true }) });
    assert.equal(reset.value.ok, true, reset.text); assert.equal((await view(bench.host) as HostView).seed, 42);
  } finally { await dispose(bench); }
  const player = await fixture(factory);
  try {
    const before = await view(player.host) as HostView;
    const accepted = await call(player.host, "/api/variant", { method: "POST", headers: auth(player.host), body: JSON.stringify({ expectedRevision: before.revision, confirmed: true }) });
    assert.equal(accepted.status, 200, accepted.text); assert.equal(accepted.value.ok, true);
    const after = await view(player.host) as HostView;
    assert.equal(after.task.id, "T3"); assert.notEqual(after.seed, 42); assert.notEqual(after.variantId, before.variantId);
  } finally { await dispose(player); }
});

test("closing a session leaves no empty diagnostics file and no credential file behind", async () => {
  const f = await fixture();
  const directory = dirname(f.host.tokenFile);
  try {
    assert.deepEqual((await readdir(directory)).filter(name => name.endsWith(".mirror.jsonl")).length, 1, "created with the session");
    await f.host.close();
    assert.deepEqual(await readdir(directory), [], "nothing left after close");
  } finally { await dispose(f); }
});

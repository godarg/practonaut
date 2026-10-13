import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oracleDigest } from "../oracles/core-hash.ts";
import { packWorld, readWorldPackage } from "../../src/package/index.ts";
import { loadWorldPackage } from "../../src/world/index.ts";
import { Session } from "../../src/core/session.ts";
import { startHost } from "../../src/host/server.ts";
import { TOKEN_HEADER, type HostReply, type HostView, type RunningHost, type MirrorMode } from "../../src/host/protocol.ts";
import type { World } from "../../src/world/types.ts";

export interface Fixture {
  host: RunningHost; world: World; browser: Browser; page: Page; externalRequests: string[];
  observe(): Promise<HostView>; close(): Promise<void>;
}
export async function fixture(settings: { taskId?: string; width?: number; theme?: "light" | "dark"; world?: World; requireOffline?: boolean; mirror?: MirrorMode } = {}): Promise<Fixture> {
  const dir = await mkdtemp(join(await realpath(tmpdir()), "pn-player-"));
  const world = settings.world ?? loadWorldPackage(await readWorldPackage(await packWorld("examples/worlds/flow-diagram")));
  const host = await startHost(world, { seed: 42, taskId: settings.taskId ?? "T3", ...(settings.mirror ? { mirror: settings.mirror } : {}), tokenDirectory: join(dir, "credentials"), requireOffline: settings.requireOffline ?? process.env.PN_REQUIRE_OFFLINE === "1" });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: settings.width ?? 1280, height: 900 }, colorScheme: settings.theme ?? "light", reducedMotion: "reduce", serviceWorkers: "block" });
  const externalRequests: string[] = [];
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith(host.origin + "/")) await route.continue();
    else { externalRequests.push(url); await route.abort(); }
  });
  const page = await context.newPage();
  await page.goto(host.url);
  await page.getByTestId("board").waitFor();
  const observe = async (): Promise<HostView> => {
    // A reused idle keep-alive socket can be closed by the host's 5 s keep-alive timeout between a slow
    // browser step and this GET; the read is idempotent, so a transport reset is retried (twice at most).
    let response: Response | undefined;
    for (let attempt = 0; response === undefined; attempt++) {
      try { response = await fetch(host.origin + "/api/observe", { headers: { [TOKEN_HEADER]: host.token } }); }
      catch (error) { if (attempt >= 2 || (error as { cause?: { code?: string } }).cause?.code !== "ECONNRESET") throw error; }
    }
    const reply = await response.json() as HostReply<HostView>;
    if (!reply.ok) throw new Error(reply.error.code);
    return reply.value;
  };
  return { host, world, browser, page, externalRequests, observe,
    async close() { await browser.close(); await host.close(); await rm(dir, { recursive: true, force: true }); } };
}

/** A separately constructed core plus a Python-stdlib digest is the host's oracle. */
export function assertOracle(world: World, view: HostView): void {
  const oracle = new Session(world, view.seed, view.task.id);
  for (const entry of view.log) {
    const result = oracle.act(entry.action); assert.equal(result.ok, true);
    assert.equal(oracle.hash, entry.hash);
  }
  assert.deepEqual(view.state, oracle.state);
  assert.equal(view.hash, oracle.hash);
  assert.equal(oracle.checkReplay().ok, true);
  assert.equal(view.hash, oracleDigest(view.state));
  assert.equal(view.practiceEvidence, true); assert.equal(view.mirror, "required");
  for (const item of view.history) assert.equal(item.mirrorConfirmed, true);
}

export async function changed(f: Fixture, operation: () => Promise<unknown>): Promise<HostView> {
  const before = await f.observe();
  const response = f.page.waitForResponse(r => r.url().startsWith(f.host.origin + "/api/") && r.request().method() === "POST" && !r.url().endsWith("/api/bootstrap"));
  await operation();
  const received = await response;
  const payload = received.request().postDataJSON() as { action?: Parameters<Session["act"]>[0] };
  const reply = await received.json() as HostReply<unknown>;
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const view = await f.observe(); assert.ok(view.revision > before.revision);
  if (payload.action) {
    // This separately expected action catches a host that acknowledges a browser gesture
    // without going through Session.act, even when its own log/state agree with each other.
    const expected = new Session(f.world, before.seed, before.task.id);
    for (const entry of before.log) assert.equal(expected.act(entry.action).ok, true);
    assert.equal(expected.act(payload.action).ok, true);
    assert.equal(view.step, expected.step); assert.equal(view.hash, expected.hash, "host must commit the requested core action");
  }
  assertOracle(f.world, view);
  return view;
}

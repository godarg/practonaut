import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture, changed, assertOracle, type Fixture } from "./harness.ts";
import { TOKEN_HEADER } from "../../src/host/protocol.ts";
import { TAB_SESSION_KEY } from "../../src/player/tab-session.ts";

const object = (f: Fixture, id: string) => f.page.locator(`[data-object-id="${id}"]`).first();
export async function solveT3(f: Fixture, keyboard: boolean): Promise<void> {
  await f.page.getByTestId("show-connections").click();
  await object(f, "ab").click();
  if (keyboard) {
    await object(f, "ab").focus(); await f.page.keyboard.press("r");
    await f.page.keyboard.press("End");
    await changed(f, () => f.page.keyboard.press("Enter"));
    await object(f, "bc").focus();
    await changed(f, () => f.page.keyboard.press("Delete"));
    await object(f, "b").focus();
    await changed(f, () => f.page.keyboard.press("Delete"));
  } else {
    await f.page.getByTestId("action-rewire-end").click();
    await changed(f, () => object(f, "c").click());
    await object(f, "bc").click();
    await changed(f, () => f.page.getByTestId("action-delete").click());
    await object(f, "b").click();
    await changed(f, () => f.page.getByTestId("action-delete").click());
  }
}

test("human path: keyboard and pointer, consequences, undo/reset/variant and public success; core bypass is detected", { timeout: 120_000 }, async () => {
  const f = await fixture({ taskId: "T3" });
  try {
    let view = await f.observe(); assertOracle(f.world, view);
    assert.equal(await f.page.evaluate(() => location.hash), "");
    assert.equal(await f.page.evaluate(() => localStorage.length), 0);
    assert.equal(await f.page.evaluate(() => /[?&]token=/i.test(location.href)), false);
    // PADR-0016 permits only the origin-and-tab scoped reload credential. Return
    // shape and equality results, never the bearer itself, in test diagnostics.
    const tab = await f.page.evaluate(({ key, credential }) => {
      const cached = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      return { keys: Object.keys(sessionStorage).sort(), fields: Object.keys(cached ?? {}).sort(),
        schema: cached?.schema, language: cached?.language, theme: cached?.theme,
        workspace: cached?.workspace, tokenMatches: cached?.token === credential };
    }, { key: TAB_SESSION_KEY, credential: f.host.token });
    assert.deepEqual(tab, { keys: [TAB_SESSION_KEY], fields: ['language', 'schema', 'sessionId', 'theme', 'token', 'workspace'],
      schema: 'practonaut.tab-session/2', language: 'en', theme: 'system', workspace: 'board', tokenMatches: true });
    // Keyboard move: select via roving focus, preview, then exactly one committed action.
    await object(f, "a").focus(); await f.page.keyboard.press("Enter"); await f.page.keyboard.press("ArrowRight");
    view = await changed(f, () => f.page.keyboard.press("Enter")); assert.equal(view.step, 1);
    await changed(f, () => f.page.getByTestId("undo").click());
    // Intentionally delete a step while an arrow still binds to it. This real-engine action
    // produces the world's accepted-but-violates-goal loose-arrow explanation.
    await object(f, "b").focus();
    view = await changed(f, () => f.page.keyboard.press("Delete"));
    assert.ok(view.errors.some(e => e.id === "loose-arrow"));
    assert.match(await f.page.locator("body").innerText(), /At that moment|Zu diesem Zeitpunkt/);
    await changed(f, () => f.page.getByTestId("undo").click());
    // Hints are a ladder, never an unsolicited solution reveal.
    for (let i = 1; i <= 3; i++) { view = await changed(f, () => f.page.getByTestId("hint").click()); assert.equal(view.hints.length, i); }
    await object(f, "a").click(); await f.page.getByTestId("action-rename").click();
    await f.page.getByTestId("input-label").fill("<script>literal text</script>");
    await changed(f, () => f.page.getByTestId("action-submit").click());
    assert.equal(await f.page.locator("script").count(), 1);
    await f.page.getByTestId("reset").click(); await f.page.getByTestId("reset-cancel").click();
    assert.equal((await f.observe()).step, 1);
    await f.page.getByTestId("reset").click();
    view = await changed(f, () => f.page.getByTestId("reset-confirm").click()); assert.equal(view.step, 0);
    const variant = view.variantId;
    view = await changed(f, () => f.page.getByTestId("new-variant").click()); assert.notEqual(view.variantId, variant);
    await solveT3(f, true);
    const checkResponse = f.page.waitForResponse(r => r.url().endsWith("/api/check"));
    await f.page.getByTestId("check").click(); const checked = await (await checkResponse).json();
    assert.equal(checked.ok, true, JSON.stringify(checked)); assert.equal(checked.value.passed, true, JSON.stringify(checked));
    view = await f.observe(); assertOracle(f.world, view);
    assert.deepEqual(checked.value.conditions.map(({ met, ...condition }: { met: boolean; id: string; text: unknown; formalText?: unknown }) => condition), view.task.conditions);
    await f.page.getByTestId("reset").click(); await changed(f, () => f.page.getByTestId("reset-confirm").click());
    await solveT3(f, false);
    const second = f.page.waitForResponse(r => r.url().endsWith("/api/check"));
    await f.page.getByTestId("check").click(); assert.equal((await (await second).json()).value.passed, true);
    assert.deepEqual(f.externalRequests, []);
  } finally { await f.close(); }
});

test("world text is literal and cross-origin simple writes never change the host", { timeout: 60_000 }, async () => {
  const f = await fixture();
  try {
    const world = structuredClone(f.world);
    for (const task of world.tasks) task.prompt = { en: '<img src="https://foreign.invalid/x" onerror="alert(1)"> javascript:alert(2)', de: '<svg onload="alert(1)">Autorentext</svg>' };
    const xss = await fixture({ world });
    try {
      assert.match(await xss.page.locator("body").innerText(), /<img src=/);
      assert.equal(await xss.page.locator("img").count(), 0);
      assert.deepEqual(xss.externalRequests, []);
      await xss.page.getByTestId("language-de").click(); assert.match(await xss.page.locator("body").innerText(), /<svg onload=/);
    } finally { await xss.close(); }
    const before = await f.observe();
    const context = await f.browser.newContext();
    await context.route("http://foreign.invalid/**", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Foreign page probe</title>" }));
    const foreign = await context.newPage(); await foreign.goto("http://foreign.invalid/");
    for (const route of ["act", "undo", "reset", "variant", "hint", "check"]) {
      await foreign.evaluate(async ({ origin, route }) => { try { await fetch(origin + "/api/" + route, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ expectedRevision: 0, confirmed: true, action: { name: "delete_step", params: { id: "b" } } }) }); } catch { /* Browser rejects forbidden cross-origin read. */ } }, { origin: f.host.origin, route });
    }
    await context.close();
    const after = await f.observe(); assert.equal(after.hash, before.hash); assert.equal(after.revision, before.revision);
    const png = await fetch(f.host.origin + "/api/tool.png", { headers: { [TOKEN_HEADER]: f.host.token } });
    assert.equal(png.headers.get("content-type"), "image/png"); assert.equal(png.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await png.arrayBuffer()).subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  } finally { await f.close(); }
});

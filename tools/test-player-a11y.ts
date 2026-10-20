import assert from "node:assert/strict";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fixture, assertOracle, type Fixture } from "../tests/e2e/harness.ts";
import { TOKEN_HEADER, type HostReply, type MutationReply } from "../src/host/protocol.ts";
import { CREATE_PROGRESS_STATES, PLAYER_STATES, MODEL_ONLY_STATES, LIMIT_STATES, LAYOUT_STATES, limitsWorld, practiceBaseline, setLanguage, startPlayer } from "../tests/support/player-states.ts";
import { layoutWorld } from "../tests/support/layout-world.ts";
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { fixtureBenches, reportStates } from "../tests/support/report-states.ts";
import { brokenIdentifiers } from "../tests/support/identifier-lines.ts";
import { layoutDefects } from "../tests/support/report-layout.ts";

// Writes screenshots and results to the ignored .local/player-a11y/; never into the source tree.
const output = ".local/player-a11y";
await mkdir(output, { recursive: true });
const ledger: Array<Record<string, unknown>> = [];
const failures: string[] = [];
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
// The create flow states are scanned and
// reported in every run; they gate the exit code once this flag is flipped with the rebuild.
const CREATE_GATES = process.argv.includes("--gate-create");
const createFindings: string[] = [];
// The real editor's document is Excalidraw's own UI (PADR-0012); the scan covers the page around it.
const FOREIGN = [".native-editor-scroll iframe"];
async function post(f: Fixture, route: string, extra: object = {}): Promise<unknown> {
  const before = await f.observe();
  const response = await fetch(f.host.origin + "/api/" + route, { method: "POST", headers: { "Content-Type": "application/json", [TOKEN_HEADER]: f.host.token }, body: JSON.stringify({ expectedRevision: before.revision, ...extra }) });
  const reply = await response.json() as HostReply<MutationReply>;
  if (!reply.ok && route !== "act") throw new Error(reply.error.code);
  return reply;
}
async function state(f: Pick<Fixture, "page">, name: string, stem: string, sink: string[] = failures): Promise<void> {
  // A paint turn follows SSE data; no arbitrary simulated check delays in the product.
  await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let builder = new AxeBuilder({ page: f.page }).withTags(tags);
  for (const selector of FOREIGN) builder = builder.exclude(selector);
  const axe = await builder.analyze();
  const overflow = await f.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const row = { surface: stem + "-" + name, violations: axe.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })), overflow, screenshot: stem + "-" + name + ".png", gating: sink === failures };
  ledger.push(row);
  if (overflow > 0) sink.push(`${row.surface}: overflow ${overflow}px`);
  for (const violation of axe.violations) sink.push(`${row.surface}: ${violation.id} ${violation.nodes.map(n => n.target.join(" ")).join(" | ")}`);
  await f.page.screenshot({ path: output + "/" + row.screenshot, fullPage: true });
}

for (const theme of ["light", "dark"] as const) for (const width of [1280, 320]) for (const language of ["en", "de"] as const) {
  const f = await fixture({ taskId: "T3", theme, width });
  const stem = `${theme}-${width}-${language}`;
  try {
    await f.page.getByTestId("language-" + language).click();
    await state(f, "live", stem);
    // The floating palette follows the selection: step tools for a step, arrow tools for an arrow.
    await f.page.locator('[data-object-id="a"]').first().click(); await f.page.getByTestId("action-rename").waitFor();
    await state(f, "step-selected", stem);
    await f.page.locator('button[data-object-id="ab"]').first().click(); await f.page.getByTestId("action-rewire-end").waitFor();
    await state(f, "arrow-selected", stem);
    for (const mode of ["add", "rename", "move"]) {
      await f.page.locator('[data-object-id="a"]').first().click();
      await f.page.getByTestId("action-" + mode).click();
      await state(f, mode + "-dialog", stem);
      if (mode === "add") {
        // The position fields sit in a disclosure of the add sheet; scan them open as well.
        await f.page.getByTestId("add-position").locator("summary").click(); await f.page.getByTestId("input-x").waitFor();
        await state(f, "add-dialog-position", stem);
      }
      await f.page.getByTestId("action-cancel").click();
    }
    for (const [id, mode] of [["a", "connect"], ["ab", "rewire-start"], ["ab", "rewire-end"]]) {
      await f.page.locator(`[data-object-id="${id}"]`).first().click();
      await f.page.getByTestId("action-" + mode).click();
      await state(f, mode + "-pending", stem); await f.page.keyboard.press("Escape");
    }
    await f.page.getByTestId("hint").click();
    await state(f, "hint", stem);
    await f.page.getByTestId("show-tool").click();
    await f.page.locator(".tool-image").waitFor(); await state(f, "real-tool", stem);
    await post(f, "act", { action: { name: "delete_step", params: { id: "b" } } });
    // A world consequence is a neutral notice (.notice.consequence); rejections stay .notice.error.
    await f.page.locator(".notice.consequence").waitFor(); await state(f, "loose-arrow", stem);
    await post(f, "undo");
    await f.page.locator('[data-object-id="a"]').first().focus(); await f.page.keyboard.press("Enter");
    await state(f, "picked", stem); await f.page.keyboard.press("Escape");
    await post(f, "check");
    await f.page.locator(".verdict.fail").waitFor(); await state(f, "fail", stem);
    await post(f, "act", { action: { name: "move_step", params: { id: "a", x: 50, y: 50 } } });
    await f.page.getByTestId("new-variant").click();
    await f.page.getByTestId("change-cancel").waitFor(); await state(f, "variant-confirm", stem);
    await f.page.getByTestId("change-cancel").click();
    await f.page.getByTestId("task-picker").click(); await f.page.getByTestId("task-picker-option-T1").click();
    await f.page.getByTestId("change-cancel").waitFor(); await state(f, "task-confirm", stem);
    await f.page.getByTestId("change-cancel").click();
    await f.page.getByTestId("reset").click(); await state(f, "reset", stem);
    await f.page.getByTestId("reset-cancel").click();
    await post(f, "reset", { confirmed: true });
    for (const action of [{ name: "reconnect_end", params: { id: "ab", end: "end", target: "c" } }, { name: "disconnect", params: { id: "bc" } }, { name: "delete_step", params: { id: "b" } }]) {
      const reply = await post(f, "act", { action }) as HostReply<MutationReply>;
      assert.equal(reply.ok, true); assertOracle(f.world, await f.observe());
    }
    await post(f, "check"); await f.page.locator(".verdict.pass").waitFor(); await state(f, "pass", stem);
    await post(f, "act", { action: { name: "rotate", params: { id: "a" } } });
    await f.page.locator(".notice.unmodeled").waitFor();
    await state(f, "unmodeled", stem);
    assert.deepEqual(f.externalRequests, []);
    // Real shell loading and failed bootstrap, without fabricating a session or a verdict.
    const beforeShell = await f.observe();
    const shell = await f.browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
    const shellPage = await shell.newPage(); let release!: () => void;
    const shellExternal: string[] = [], shellApi: Array<{ path: string; method: string; bearer: boolean }> = [];
    await shell.route("**/*", async route => { const url = new URL(route.request().url()); if (url.origin === f.host.origin) await route.continue(); else { shellExternal.push(url.origin + url.pathname); await route.abort(); } });
    shellPage.on("request", request => { const path = new URL(request.url()).pathname; if (path.startsWith("/api/")) shellApi.push({ path, method: request.method(), bearer: !!request.headers()[TOKEN_HEADER.toLowerCase()] }); });
    const held = new Promise<void>(resolve => { release = resolve; });
    await shellPage.route("**/api/bootstrap", async route => { await held; await route.continue(); });
    await shellPage.goto(f.host.url);
    await shellPage.getByTestId("language-" + language).click();
    await state({ ...f, page: shellPage }, "loading", stem);
    const bootstrapResponse = shellPage.waitForResponse(response => response.url().endsWith("/api/bootstrap"));
    release(); const denied = await bootstrapResponse; assert.equal(denied.status(), 401);
    const deniedReply = await denied.json(); assert.equal(deniedReply.ok, false); assert.equal(deniedReply.error.code, "bootstrap_used");
    await shellPage.locator("main h1").filter({ hasText: language === "en" ? "Session unavailable" : "Sitzung nicht erreichbar" }).waitFor();
    assert.equal(await shellPage.getByTestId("board").count(), 0); assert.equal(await shellPage.getByTestId("phase3").count(), 0); assert.equal(await shellPage.getByTestId("check").count(), 0);
    assert.equal(await shellPage.evaluate(() => localStorage.length + sessionStorage.length), 0); assert.deepEqual(await shell.cookies(), []);
    assert.equal(await shellPage.evaluate(() => location.hash), ""); assert.equal(await shellPage.evaluate(() => /[?&]token=/i.test(location.href)), false);
    assert.deepEqual(shellApi, [{ path: "/api/bootstrap", method: "POST", bearer: false }]);
    const unauth = await shellPage.evaluate(async () => {
      const observed = await fetch("/api/observe"), observedReply = await observed.json();
      const acted = await fetch("/api/act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: 0, action: { name: "delete_step", params: { id: "b" } } }) }), actedReply = await acted.json();
      return { observeStatus: observed.status, observeCode: observedReply.error.code, actStatus: acted.status, actCode: actedReply.error.code };
    });
    assert.deepEqual(unauth, { observeStatus: 401, observeCode: "token_required", actStatus: 401, actCode: "token_required" });
    assert.deepEqual(await f.observe(), beforeShell); assert.deepEqual(shellExternal, []);
    await state({ ...f, page: shellPage }, "bootstrap-error", stem); await shell.close();
    const durations = await f.page.evaluate(() => Object.keys(getComputedStyle(document.documentElement)).length);
    ledger.push({ surface: stem, reducedMotion: await f.page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), computedStyle: durations, externalRequests: f.externalRequests.length });
    console.log(`player:a11y ${stem}: scanned live/picked/fail/reset/pass/unmodeled`);
  } finally { await f.close(); }
  const model = await fixture({ taskId: "T3", theme, width, mirror: "off" });
  try {
    await model.page.getByTestId("language-" + language).click();
    assert.equal((await model.observe()).practiceEvidence, false);
    await state(model, "model-only", stem);
  } finally { await model.close(); }
  // Workspaces behind the mode control in the bar: the real editor (gating) and the create flow.
  const workspaces = await startPlayer({ theme, width, height: 900 });
  try {
    await setLanguage(workspaces.page, language);
    for (const st of PLAYER_STATES.filter(x => x.id.startsWith("practice-export-"))) { await st.enter(workspaces); await state(workspaces, st.id, stem); }
    // The bundled example's demonstration: asking, playing, finished, stopped and stopped early.
    for (const st of PLAYER_STATES.filter(x => x.id.startsWith("demo-"))) { await st.enter(workspaces); await state(workspaces, st.id, stem); }
    // The editor states below work on a plain attempt, never on the demonstration's board.
    await practiceBaseline(workspaces);
    for (const st of PLAYER_STATES.filter(x => x.workspace === "editor")) { await st.enter(workspaces); await state(workspaces, st.id, stem); }
    for (const st of [...PLAYER_STATES.filter(x => x.workspace === "author"), ...CREATE_PROGRESS_STATES]) {
      try { await st.enter(workspaces); await state(workspaces, st.id, stem, CREATE_GATES ? failures : createFindings); }
      catch (error) { (CREATE_GATES ? failures : createFindings).push(`${stem}-${st.id}: not reached (${(error as Error).message.split("\n")[0]})`); }
    }
    assert.deepEqual(workspaces.external, []);
  } finally { await workspaces.close(); }
  // Task limits (PADR-0040): a world/2 task with an action and a check limit.
  const limited = await startPlayer({ theme, width, height: 900, phase3: false, world: limitsWorld(), taskId: "T1" });
  try {
    await setLanguage(limited.page, language);
    for (const st of LIMIT_STATES) { await st.enter(limited); await state(limited, st.id, stem); }
    assert.deepEqual(limited.external, []);
  } finally { await limited.close(); }
  // A layout task (PADR-0047): the judged geometry on the board, after a check, and the editor's note.
  const layout = await startPlayer({ theme, width, height: 900, world: layoutWorld(), taskId: "tidy" });
  try {
    await setLanguage(layout.page, language);
    for (const st of LAYOUT_STATES) { await st.enter(layout); await state(layout, st.id, stem); }
    assert.deepEqual(layout.external, []);
  } finally { await layout.close(); }
  const modelExport = await startPlayer({ theme, width, height: 900, phase3: false, mirror: "off" });
  try {
    await setLanguage(modelExport.page, language);
    for (const st of MODEL_ONLY_STATES) { await st.enter(modelExport); await state(modelExport, st.id, stem); }
    assert.deepEqual(modelExport.external, []);
  } finally { await modelExport.close(); }
  console.log(`player:a11y ${stem}: scanned editor, export and create workspaces`);
}
// Bench report and compare pages (PADR-0039): every named state from real fixture runs, as the static
// files `report --html` and `compare --html` write, light and dark, 1280 and 320 px, EN and DE. Text in a
// board picture is never drawn below 12 CSS px (design-language §10.2), measured as rendered.
{
  const fixtures = await fixtureBenches(output + "/report-fixtures", { mirror: true, compare: true });
  const states = await reportStates(fixtures);
  const pages: Array<{ id: string; language: "en" | "de"; file: string; open: boolean }> = [];
  for (const st of states) for (const language of ["en", "de"] as const) {
    const file = resolve(output, `${st.id}.${language}.html`);
    await writeFile(file, await st.html(language));
    pages.push({ id: st.id, language, file, open: st.open === true });
  }
  const browser = await chromium.launch({ headless: true });
  try {
    for (const theme of ["light", "dark"] as const) for (const width of [1280, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
      const external: string[] = [];
      await context.route("**/*", async route => { const url = route.request().url(); if (url.startsWith("file:")) await route.continue(); else { external.push(url); await route.abort(); } });
      const page = await context.newPage();
      for (const entry of pages) {
        await page.goto(pathToFileURL(entry.file).href);
        // A reader who opened every card (the page has no script; the test opens them).
        if (entry.open) await page.evaluate(() => { for (const details of document.querySelectorAll("details")) details.open = true; });
        const small = await page.evaluate(() => [...document.querySelectorAll("svg.schematic text, svg.engine-board text")].flatMap(text => {
          const element = text as SVGTextElement, matrix = element.getScreenCTM();
          if (!element.getClientRects().length || !matrix) return [];
          const size = parseFloat(getComputedStyle(element).fontSize) * Math.hypot(matrix.a, matrix.b);
          return size < 11.95 ? [`${(element.textContent ?? "").slice(0, 24)} at ${size.toFixed(1)} px`] : [];
        }));
        if (small.length) failures.push(`${theme}-${width}-${entry.language}-${entry.id}: picture text below 12 px: ${small.slice(0, 3).join("; ")}`);
        // Identifiers never hyphenate (design-language §10.5) and never split at their own hyphens: every
        // word of data and every flag on one line (design review R2), measured as rendered.
        // A chip or status word is one run of text: words split into flex items lose their spaces.
        const split = [...await page.evaluate(() => [
          ...[...document.querySelectorAll(".chip, .result, .outcome")].filter(element => (element as HTMLElement).innerText.includes("\n")).map(element => `"${element.textContent}" falls apart into pieces`),
          ...[...document.querySelectorAll(".data, .id, code")].filter(element => getComputedStyle(element).hyphens !== "none").map(element => `${element.textContent} may hyphenate`),
        ]), ...(await page.evaluate(brokenIdentifiers)).map(word => `${word} breaks across lines`), ...await page.evaluate(layoutDefects)];
        if (split.length) failures.push(`${theme}-${width}-${entry.language}-${entry.id}: ${split.slice(0, 3).join("; ")}`);
        await state({ page }, entry.id, `${theme}-${width}-${entry.language}`);
      }
      assert.deepEqual(external, [], "a report page loads nothing");
      await context.close();
      console.log(`report:a11y ${theme}-${width}: scanned ${pages.length} report and compare pages`);
    }
  } finally { await browser.close(); }
}
await writeFile(output + "/measurement.json", JSON.stringify({ date: new Date().toISOString(), tags, ledger, failures, createFindings, createGates: CREATE_GATES, manualVoiceOver: "OPEN", manualZoom200: "OPEN", claimC7: "partial automated evidence, human checks OPEN" }, null, 2) + "\n");
if (createFindings.length) { console.log(`CREATE (reported, not gating until the create rebuild lands; run with --gate-create): ${createFindings.length} finding(s)`); for (const finding of createFindings) console.log("  " + finding); }
if (failures.length) { for (const failure of failures) console.error(failure); process.exitCode = 1; }
else console.log(`Player automated accessibility: ${ledger.length} observations, 0 violations/overflow; human screen-reader and zoom runs: docs/design/manual-player-checks.md`);

// R5-01: starting a recording docks the recording bar above the guide. The step the author is in
// stays where it was (no jump to the top for the focused Stop, no shift by the bar's height), at
// 1280 and 390 px.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { CREATE_PROGRESS_STATES, setLanguage, settle, startPlayer } from "../support/player-states.ts";

let browser: Browser;
after(async () => { await browser?.close(); });

test("create: starting a recording keeps the record step in place", { timeout: 300_000 }, async () => {
  browser = await chromium.launch({ headless: true });
  const s = await startPlayer({ browser, width: 1280, height: 900 });
  try {
    await setLanguage(s.page, "de");
    const prepared = CREATE_PROGRESS_STATES.find(state => state.id === "create-plan-prepared");
    assert.ok(prepared, "create-plan-prepared state missing");
    await prepared.enter(s);
    const header = (): Promise<number> => s.page.evaluate(() => document.querySelector('[data-stage="record"] > summary')!.getBoundingClientRect().top);
    for (const width of [1280, 390]) {
      await s.page.setViewportSize({ width, height: width < 600 ? 844 : 900 }); await settle(s.page);
      await s.page.waitForFunction(() => !/Working locally|Lokale Verarbeitung/.test(document.querySelector('[data-testid="recovery-status"]')?.textContent ?? ""));
      if (!await s.page.locator("[data-stage=record]").evaluate(e => (e as HTMLDetailsElement).open)) await s.page.locator("[data-stage=record] > summary").click();
      await s.page.getByTestId("recovery-source").waitFor({ state: "visible" });
      await s.page.getByTestId("recovery-consent").check();
      await s.page.getByTestId("recovery-source").selectOption("scripted");
      await s.page.getByTestId("recovery-start").scrollIntoViewIfNeeded(); await settle(s.page);
      const before = await header();
      await s.page.getByTestId("recovery-start").click();
      await s.page.getByTestId("recovery-stop-visible").waitFor();
      await settle(s.page); await s.page.waitForTimeout(300);
      const afterStart = await header();
      assert.ok(Math.abs(afterStart - before) <= 2, `${width}: the record step moved from ${before.toFixed(0)} to ${afterStart.toFixed(0)} px`);
      await s.page.getByTestId("recovery-stop-visible").click();
      await s.page.getByTestId("recovery-stop-visible").waitFor({ state: "detached" });
      await s.page.waitForFunction(() => !/Working locally|Lokale Verarbeitung/.test(document.querySelector('[data-testid="recovery-status"]')?.textContent ?? ""));
      await settle(s.page);
    }
    assert.deepEqual(s.external, [], "the player made external requests");
  } finally { await s.close(); }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, changed, assertOracle, type Fixture } from "./harness.ts";
import { selectVariant } from "../../src/world/index.ts";
import type { HostView } from "../../src/host/protocol.ts";
import type { Arrow, Step } from "../../src/world/types.ts";

const selectAll = process.platform === "darwin" ? "Meta+a" : "Control+a";
const object = (f: Fixture, id: string) => f.page.locator(`[data-object-id="${id}"]`).first();
const liveSteps = (view: HostView): Step[] => Object.values(view.state.objects).filter((item): item is Step => item.type === "step" && !item.deleted);
const liveArrows = (view: HostView): Arrow[] => Object.values(view.state.objects).filter((item): item is Arrow => item.type === "arrow" && !item.deleted);
const undoKey = async (f: Fixture): Promise<HostView> => {
  // The actual player handles both platform shortcuts; Control also works under headless Linux.
  await f.page.getByTestId("board").focus();
  return changed(f, () => f.page.keyboard.press("Control+z"));
};
async function add(f: Fixture, label: string, keyboard: boolean): Promise<{ view: HostView; step: Step }> {
  const before = new Set(liveSteps(await f.observe()).map(item => item.id));
  if (keyboard) { await f.page.getByTestId("action-add").focus(); await f.page.keyboard.press("Enter"); }
  else await f.page.getByTestId("action-add").click();
  if (keyboard) {
    await f.page.getByTestId("input-label").focus(); await f.page.keyboard.type(label);
    // The position is an advanced adjustment behind a disclosure: Tab to it, open it with Space, continue.
    await f.page.keyboard.press("Tab"); await f.page.keyboard.press("Space");
    await f.page.keyboard.press("Tab"); await f.page.keyboard.press(selectAll); await f.page.keyboard.type(String(100 + before.size * 240));
    await f.page.keyboard.press("Tab"); await f.page.keyboard.press(selectAll); await f.page.keyboard.type("160");
  } else {
    await f.page.getByTestId("input-label").fill(label);
    await f.page.getByTestId("add-position").locator("summary").click();
    await f.page.getByTestId("input-x").fill(String(100 + before.size * 240)); await f.page.getByTestId("input-y").fill("160");
  }
  const view = await changed(f, () => keyboard ? f.page.keyboard.press("Enter") : f.page.getByTestId("action-submit").click());
  const step = liveSteps(view).find(item => !before.has(item.id)); assert.ok(step);
  assert.equal(step.label, label); assert.equal(view.log.at(-1)?.action.name, "add_step");
  return { view, step };
}
async function success(f: Fixture): Promise<void> {
  const response = f.page.waitForResponse(item => item.url().endsWith("/api/check"));
  await f.page.getByTestId("check").click(); const reply = await (await response).json();
  assert.equal(reply.ok, true, JSON.stringify(reply)); assert.equal(reply.value.passed, true, JSON.stringify(reply));
  const view = await f.observe(); assertOracle(f.world, view);
  assert.deepEqual(reply.value.conditions.map(({ met, ...condition }: { met: boolean; id: string; text: unknown; formalText?: unknown }) => condition), view.task.conditions);
}

test("T1 DOM: build with keyboard and pointer, rename/move dialogs, cancellable pickup and both connection inputs", { timeout: 90_000 }, async () => {
  const f = await fixture({ taskId: "T1" });
  try {
    const initial = await f.observe(); assertOracle(f.world, initial); assert.equal(liveSteps(initial).length, 0);
    const labels = selectVariant(f.world, initial.seed).labels;
    const a = (await add(f, "Working draft", true)).step;
    const b = (await add(f, labels.middle!, false)).step;
    const c = (await add(f, labels.last!, true)).step;
    // Pointer rename and coordinate dialog use real native form controls.
    await object(f, a.id).click(); await f.page.getByTestId("action-rename").click();
    await f.page.getByTestId("input-label").fill(labels.first!);
    let view = await changed(f, () => f.page.getByTestId("action-submit").click());
    assert.equal((view.state.objects[a.id] as Step).label, labels.first!);
    await object(f, a.id).click(); await f.page.getByTestId("action-move").click();
    await f.page.getByTestId("input-x").fill("120"); await f.page.getByTestId("input-y").fill("180");
    view = await changed(f, () => f.page.getByTestId("action-submit").click());
    assert.deepEqual([(view.state.objects[a.id] as Step).x, (view.state.objects[a.id] as Step).y], [120, 180]);
    // Pickup is a DOM preview. Escape restores both geometry and host state without an act.
    const beforePreview = await f.observe(); let previewPosts = 0;
    const countPost = (request: import("playwright").Request): void => { if (request.method() === "POST" && request.url().endsWith("/api/act")) previewPosts++; };
    f.page.on("request", countPost);
    await object(f, a.id).focus(); await f.page.keyboard.press("Enter"); await f.page.keyboard.press("ArrowRight"); await f.page.keyboard.press("ArrowDown");
    assert.match(await object(f, a.id).getAttribute("class") ?? "", /picked/);
    assert.equal(await object(f, a.id).locator("rect.step-box").getAttribute("x"), "140");
    await f.page.keyboard.press("Escape");
    assert.equal(await object(f, a.id).locator("rect.step-box").getAttribute("x"), "120"); assert.equal((await object(f, a.id).getAttribute("class"))?.trim(), "step selected");
    assert.deepEqual(await f.observe(), beforePreview); assert.equal(previewPosts, 0); f.page.off("request", countPost);
    await object(f, a.id).focus(); await f.page.keyboard.press("Enter"); await f.page.keyboard.press("ArrowRight");
    view = await changed(f, () => f.page.keyboard.press("Enter")); assert.equal((view.state.objects[a.id] as Step).x, 140);
    view = await undoKey(f); assert.equal((view.state.objects[a.id] as Step).x, 120);
    // C starts the keyboard relation picker; End/ArrowLeft choose the middle step.
    await object(f, a.id).focus(); await f.page.keyboard.press("c"); await f.page.keyboard.press("End"); await f.page.keyboard.press("ArrowLeft");
    assert.equal(await f.page.locator(":focus").getAttribute("data-object-id"), b.id);
    view = await changed(f, () => f.page.keyboard.press("Enter"));
    assert.ok(liveArrows(view).some(edge => edge.from === a.id && edge.to === b.id));
    await object(f, b.id).click(); await f.page.getByTestId("action-connect").click();
    view = await changed(f, () => object(f, c.id).click());
    assert.ok(liveArrows(view).some(edge => edge.from === b.id && edge.to === c.id));
    await success(f); assert.deepEqual(f.externalRequests, []);
  } finally { await f.close(); }
});

test("T1 DOM: keyboard and pointer rewire both ends, delete arrows/steps, undo and return to public success", { timeout: 90_000 }, async () => {
  const f = await fixture({ taskId: "T1" });
  try {
    const labels = selectVariant(f.world, (await f.observe()).seed).labels;
    const a = (await add(f, labels.first!, false)).step;
    const b = (await add(f, labels.middle!, false)).step;
    const c = (await add(f, labels.last!, false)).step;
    await object(f, a.id).click(); await f.page.getByTestId("action-connect").click();
    let view = await changed(f, () => object(f, b.id).click()); const ab = liveArrows(view)[0]!;
    await object(f, b.id).click(); await f.page.getByTestId("action-connect").click(); await changed(f, () => object(f, c.id).click());
    // Shift+R starts a from-end edit; Home/End navigate genuine roving SVG focus.
    await object(f, ab.id).focus(); await f.page.keyboard.press("Shift+r"); await f.page.keyboard.press("End");
    view = await changed(f, () => f.page.keyboard.press("Enter")); assert.equal((view.state.objects[ab.id] as Arrow).from, c.id);
    await undoKey(f);
    await object(f, ab.id).focus(); await f.page.keyboard.press("r"); await f.page.keyboard.press("End");
    view = await changed(f, () => f.page.keyboard.press("Enter")); assert.equal((view.state.objects[ab.id] as Arrow).to, c.id);
    await undoKey(f);
    for (const [button, field] of [["action-rewire-start", "from"], ["action-rewire-end", "to"]] as const) {
      await object(f, ab.id).click(); await f.page.getByTestId(button).click();
      view = await changed(f, () => object(f, c.id).click()); assert.equal((view.state.objects[ab.id] as Arrow)[field], c.id);
      await undoKey(f);
    }
    // Keyboard rename reaches the same native form without a pointer.
    await object(f, b.id).focus(); await f.page.getByTestId("action-rename").focus(); await f.page.keyboard.press("Enter");
    await f.page.getByTestId("input-label").focus(); await f.page.keyboard.press(selectAll); await f.page.keyboard.type("Temporary alternate label");
    view = await changed(f, () => f.page.keyboard.press("Enter")); assert.equal((view.state.objects[b.id] as Step).label, "Temporary alternate label"); await undoKey(f);
    for (const [id, keyboard] of [[ab.id, true], [ab.id, false], [b.id, true], [b.id, false]] as const) {
      if (keyboard) await object(f, id).focus(); else await object(f, id).click();
      view = await changed(f, () => keyboard ? f.page.keyboard.press("Delete") : f.page.getByTestId("action-delete").click());
      assert.equal(view.state.objects[id]!.deleted, true);
      if (id === b.id) assert.ok(view.errors.some(error => error.id === "loose-arrow"));
      view = await undoKey(f); assert.equal(view.state.objects[id]!.deleted, false);
    }
    await success(f); assert.deepEqual(f.externalRequests, []);
  } finally { await f.close(); }
});

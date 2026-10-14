// Regenerates the README images in docs/assets/ from the real product:
//   player-{light,dark}.png        the Player while an agent works on a library task: a scripted MCP
//                                  client (no language model) runs the task's reference actions but
//                                  the last and asks for a check, so the board shows the agent's work
//                                  and the goal is partly met. Crop: the task head and the board, so
//                                  board labels stay readable where GitHub shows the image in its
//                                  ~830 px README column (the tool prints the measured size and fails
//                                  below MIN_LABEL).
//   player-check-{light,dark}.png  the same moment in the inspector: the Goal card with the failed
//                                  check and Check result, the hints and the History with the
//                                  agent's entries. Shown at its own width (the README sets it).
//   bench-report-{light,dark}.png  the example bench report page (docs/benchmarks/example-report.html)
// All at 2x pixel density. Needs `npm run build` and Playwright Chromium (`npx practonaut setup`).
// Uses a temporary PRACTONAUT_HOME, so nothing is written to ~/.practonaut. Run: node tools/readme-images.ts
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { loadLibrary } from "../src/library/index.ts";
import { substituteTokens, variantIndex, variantTokens } from "../src/world/variant.ts";

const OUT = resolve("docs/assets");
const TASK = process.env.PN_README_TASK ?? "restyle-flow";
const MAX_BYTES = 300 * 1024;
// Smallest board label (CSS px) in GitHub's README column; below this the hero is not readable.
const MIN_LABEL = 11;
const COLUMN = 830;

// The narrowest window in which this task's board shows whole (no sideways scrolling) beside the goal.
const VIEWPORT = Number(process.env.PN_README_WIDTH ?? 1320);
// Tall enough that the sticky inspector shows the Goal card through the History without scrolling.
const HEIGHT = 2200;

type Reply<T> = { ok: true; value: T } | { ok: false; error: { code: string } };
async function playerShot(browser: Browser, theme: "light" | "dark"): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "pn-readme-"));
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli/main.js", "mcp", "--task", `excalidraw/${TASK}`, "--seed", "1", "--mirror", "auto"], env: { ...process.env, PRACTONAUT_HOME: home } as Record<string, string>, stderr: "pipe" });
  let stderr = "";
  const watch = new Promise<string>((done, fail) => {
    const timer = setTimeout(() => fail(new Error(`no watch link from practonaut mcp: ${stderr}`)), 60_000);
    transport.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); const link = /http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]+/.exec(stderr)?.[0]; if (link) { clearTimeout(timer); done(link); } });
  });
  // The client's declared name is what the Player shows beside each of its changes (Agent · scripted-agent).
  const agent = new Client({ name: "scripted-agent", version: "1.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const call = async <T>(name: string, input: Record<string, unknown>): Promise<T> => {
    const raw = await agent.callTool({ name, arguments: input });
    const reply = JSON.parse((raw.content as Array<{ type: string; text?: string }>).find(part => part.type === "text")!.text!) as Reply<T>;
    if (!reply.ok) throw new Error(`${name}: ${reply.error.code}`);
    return reply.value;
  };
  await agent.connect(transport);
  try {
    const context = await browser.newContext({ viewport: { width: VIEWPORT, height: HEIGHT }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(await watch);
    await page.getByTestId("board").waitFor();
    await page.getByTestId("language-en").click();
    // The agent: the library's reference actions for this task, all but the last, then a check.
    // Labels follow this seed's variant; ids of created steps are read from each reply (as the bench baseline does).
    const { world, library } = loadLibrary();
    const oracle = library.tasks.find(task => task.id === TASK)!.oracle.steps;
    const tokens = variantTokens(world.variants.cases[variantIndex(world, 1)]!);
    let view = await call<{ revision: number; step: number }>("observe", {});
    const created: string[] = [];
    for (const [index, step] of oracle.slice(0, -1).entries()) {
      const params = Object.fromEntries(Object.entries(step.params).map(([key, value]) => [key, value !== null && typeof value === "object" ? created[(value as { created: number }).created] ?? "" : typeof value === "string" ? substituteTokens(value, tokens) : value]));
      const reply = await call<{ revision: number; step: number; created: string[] }>("act", { name: step.name, params, baseStep: view.step, expectedRevision: view.revision });
      view = reply; created[index] = reply.created[0] ?? "";
    }
    await call("check_result", { expectedRevision: view.revision });
    await page.locator(".history-entry").nth(oracle.length - 2).waitFor();
    await page.locator(".verdict.fail").waitFor();
    // The agent signal must be in both images: in the head (hero) and on each history entry.
    await page.getByTestId("head-actor").waitFor();
    if ((await page.getByTestId("history-actor").allInnerTexts()).some(text => text !== "Agent · scripted-agent")) throw new Error(`a history entry does not name the agent: ${JSON.stringify(await page.getByTestId("history-actor").allInnerTexts())}`);
    const overflow = await page.evaluate(() => { const scroll = document.querySelector(".board-scroll")!; return scroll.scrollWidth - scroll.clientWidth; });
    if (overflow > 0) throw new Error(`the board scrolls sideways at this width (${overflow} px)`);
    // 1. Task head and board (the agent's work), the left column only.
    const boardClip = await page.evaluate(() => {
      const head = document.querySelector(".practice-head")!.getBoundingClientRect(), board = document.querySelector(".practice-board")!.getBoundingClientRect(), note = document.querySelector(".practice-note")!.getBoundingClientRect();
      const left = Math.min(head.left, board.left) - 16, top = head.top - 16 + scrollY, right = Math.max(head.right, board.right) + 16, bottom = note.bottom + 16 + scrollY; // the model note belongs to the board; keyboard help does not
      return { x: left, y: top, width: Math.round(right - left), height: Math.round(bottom - top) };
    });
    await page.screenshot({ path: join(OUT, `player-${theme}.png`), clip: boardClip, fullPage: true });
    // Label size where GitHub shows the image in its README column (CSS pixels).
    const label = await page.evaluate(() => Math.min(...[...document.querySelectorAll(".step-label")].map(node => parseFloat(getComputedStyle(node).fontSize) * (node.closest("svg")!.getBoundingClientRect().width / (node.closest("svg") as SVGSVGElement).viewBox.baseVal.width))));
    const shown = label * Math.min(1, COLUMN / boardClip.width);
    process.stdout.write(`player-${theme}: board label ${label.toFixed(1)} px, ${shown.toFixed(1)} px in an ${COLUMN} px column (crop ${boardClip.width} px wide)\n`);
    if (shown < MIN_LABEL) process.exitCode = 1;
    // 2. Inspector: from the Goal card (failed check, Check result) to the end of the History.
    const checkClip = await page.evaluate(() => {
      const side = document.querySelector(".practice-inspector")!;
      const goal = side.querySelector(".verdict")!.closest(".pn-card")!.getBoundingClientRect(), history = side.querySelector(".history-list")!.closest(".pn-card")!.getBoundingClientRect();
      const check = document.querySelector("[data-testid=check]")!.getBoundingClientRect();
      if (check.top < goal.top || check.bottom > goal.bottom) throw new Error("Check result is not in the Goal card");
      if (history.bottom > side.getBoundingClientRect().bottom + 1) throw new Error("the History is clipped by the inspector at this window height");
      return { x: goal.left - 16, y: goal.top - 16 + scrollY, width: Math.round(goal.width + 32), height: Math.round(history.bottom - goal.top + 32) };
    });
    await page.screenshot({ path: join(OUT, `player-check-${theme}.png`), clip: checkClip, fullPage: true });
    const entries = await page.locator(".history-entry").count();
    process.stdout.write(`player-check-${theme}: ${entries} history entries, crop ${checkClip.width} x ${checkClip.height} px\n`);
    await context.close();
  } finally {
    await agent.close();
    await rm(home, { recursive: true, force: true });
  }
}
async function playerShots(browser: Browser): Promise<void> { for (const theme of ["light", "dark"] as const) await playerShot(browser, theme); }

async function reportShots(browser: Browser): Promise<void> {
  const url = pathToFileURL(resolve("docs/benchmarks/example-report.html")).href;
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, colorScheme: theme, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(url);
    await page.screenshot({ path: join(OUT, `bench-report-${theme}.png`) });
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
try {
  await playerShots(browser);
  await reportShots(browser);
} finally {
  await browser.close();
}
for (const name of ["player-light", "player-dark", "player-check-light", "player-check-dark", "bench-report-light", "bench-report-dark"]) {
  const size = (await stat(join(OUT, `${name}.png`))).size;
  process.stdout.write(`${name}.png ${size} bytes\n`);
  if (size > MAX_BYTES) process.exitCode = 1;
}

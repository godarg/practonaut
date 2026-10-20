import {lstatSync} from 'node:fs';
import {closeBrowser,bounded} from '../../src/adapters/browser/bounded.ts';


import {createHash} from 'node:crypto';
// Drives the real player into named review states. Shared by the design invariants test and the
// capture tool, so both look at the same states. A state that cannot be reached throws with the
// reason; callers report it as "not reached", never as a pass.
import { mkdtemp, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Frame, type Page } from "playwright";
import { launchBrowser } from "./browser.ts";
import { startHost } from "../../src/host/server.ts";
import { validateWorld } from "../../src/world/schema.ts";
import { TOKEN_HEADER, type DemonstrationStatus, type HostReply, type HostView, type ModelOnlyNotice, type RunningHost } from "../../src/host/protocol.ts";
import type { State, World } from "../../src/world/types.ts";
import { v2Task, v2World } from "./world-v2.ts";
import { createPracticeController, type PracticeSessionOptions } from "../../src/host/session.ts";
import { createProductionMirror, type MirrorFactory, type PracticeMirror } from "../../src/host/mirror.ts";
import { ADAPTER_REGISTRY, type AdapterRegistry } from "../../src/adapters/registry.ts";
import { createDrawioAdapter } from "../../src/adapters/drawio/index.ts";
import { FILL_HEX, FRAME_PAD, FRAME_TITLE, STROKE_HEX, freshMemory, modelXml, writeCells } from "../../src/adapters/drawio/writer.ts";
import { CLOSED } from "../../src/adapters/browser/close.ts";
import { substituteTokens, variantIndex, variantTokens } from "../../src/world/variant.ts";
import { drawioAvailability, drawioLibrary, type DrawioAvailability } from "./drawio.ts";

export type Theme = "light" | "dark";
export type Language = "en" | "de";

/**
 * Paces the bundled example's demonstration from the test (the host's pause seam): open, it runs
 * without waiting; held, it waits before each step until `next()`; `fail()` makes the waiting step
 * fail, so the Player's "stopped early" state is reachable without a broken real tool.
 */
export interface DemonstrationGate {
  pause(milliseconds: number, signal: AbortSignal): Promise<void>;
  hold(): void; open(): void; next(): void; fail(): void; waiting(): number;
}
export function demonstrationGate(): DemonstrationGate {
  let held = false;
  const queue: Array<{ resolve(): void; reject(error: Error): void }> = [];
  return {
    pause(_milliseconds, signal) {
      if (!held || signal.aborted) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const entry = { resolve, reject }; queue.push(entry);
        signal.addEventListener("abort", () => { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); resolve(); }, { once: true });
      });
    },
    hold() { held = true; },
    open() { held = false; for (const entry of queue.splice(0)) entry.resolve(); },
    next() { queue.shift()?.resolve(); },
    fail() { queue.shift()?.reject(new Error("demonstration probe failure")); },
    waiting() { return queue.length; },
  };
}
/** What `npx practonaut` without Chromium tells the Player. */
export const MISSING_CHROMIUM: ModelOnlyNotice = { reason: "missing", command: "npx practonaut setup", download: { name: "Chromium headless shell", megabytes: 105 } };

export interface PlayerSession {
  localDirectory: string; host: RunningHost; browser: Browser; context: BrowserContext; page: Page; cdp: CDPSession;
  /** Requests to anything but the host and its editor origin (aborted and recorded). */
  external: string[];
  /** The demonstration's pace, held or open by the states that show it. */
  demonstration: DemonstrationGate;
  observe(): Promise<HostView>;
  post(route: string, extra?: object): Promise<HostReply<unknown>>;
  close(): Promise<void>;
}

/** Host with the editor and the create flow (phase3), Chromium with reduced motion, offline. Like
 * `npx practonaut`, the bundled example offers its demonstration, and a model-only session says why;
 * another `world` (a task with limits) has no demonstration. */
export interface PlayerOptions { width?: number; height?: number; theme?: Theme; browser?: Browser;phase3?:boolean;mirror?:'required'|'off'; modelOnly?: ModelOnlyNotice; world?: World; taskId?: string; checks?: number;
  /** The mirror the host starts instead of the registry's (the draw.io states' stand-in or seamed runtime). */
  mirrorFactory?: MirrorFactory }
export async function startPlayer(options: PlayerOptions = {}): Promise<PlayerSession> {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "pn-design-"));
  const world = options.world ?? validateWorld(JSON.parse(readFileSync("examples/worlds/flow-diagram/world.json", "utf8")));
  const gate = demonstrationGate(), mirror = options.mirror ?? 'required';
  const host = await startHost(world, { phase3: options.phase3??true,mirror,taskId: options.taskId ?? "T3", seed: 42, localDirectory: directory, tokenDirectory: join(directory, "credentials"), requireOffline: process.env.PN_REQUIRE_OFFLINE === "1",
    demonstration: true, demonstrationPause: gate.pause, ...(mirror === 'off' ? { modelOnly: options.modelOnly ?? MISSING_CHROMIUM } : {}), ...(options.checks !== undefined ? { checks: options.checks } : {}),
    ...(options.mirrorFactory ? { controllerFactory: (value: World, serve?: object) => createPracticeController(value, (serve ?? {}) as PracticeSessionOptions, options.mirrorFactory!) } : {}) });
  const browser = options.browser ?? await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: options.width ?? 1280, height: options.height ?? 900 }, colorScheme: options.theme ?? "light", reducedMotion: "reduce", serviceWorkers: "block" });
  const external: string[] = [];
  const allowed = new Set([host.origin]);
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!allowed.has(url.origin)) { external.push(url.href); await route.abort(); return; }
    if (url.pathname === "/api/bootstrap" || url.pathname === "/api/resume"||url.pathname==='/api/author/launch') {
      const response = await route.fetch(); const reply = await response.json() as { ok: boolean; value?: { engineOrigin?: string;url?:string } };
      if (reply.ok && reply.value?.engineOrigin) allowed.add(reply.value.engineOrigin);
      if(reply.ok&&url.pathname==='/api/author/launch'&&reply.value?.url)allowed.add(new URL(reply.value.url).origin);
      await route.fulfill({ response }); return;
    }
    await route.continue();
  });
  const page = await context.newPage();
  await page.goto(host.url);
  await page.getByTestId("board").waitFor();
  if(options.phase3!==false){await page.getByTestId("mode-author").waitFor();
  await page.waitForFunction(() => !(document.querySelector("[data-testid=mode-author]") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 30_000 });}
  const cdp = await context.newCDPSession(page);
  const observe = async (): Promise<HostView> => {
    const reply = await (await fetch(host.origin + "/api/observe", { headers: { [TOKEN_HEADER]: host.token } })).json() as HostReply<HostView>;
    if (!reply.ok) throw new Error(reply.error.code);
    return reply.value;
  };
  const post = async (route: string, extra: object = {}): Promise<HostReply<unknown>> => {
    const before = await observe();
    const response = await fetch(host.origin + "/api/" + route, { method: "POST", headers: { "Content-Type": "application/json", [TOKEN_HEADER]: host.token }, body: JSON.stringify({ expectedRevision: before.revision, ...extra }) });
    return await response.json() as HostReply<unknown>;
  };
  return {
    localDirectory: directory, host, browser, context, page, cdp, external, demonstration: gate, observe, post,
    async close() { gate.open(); await context.close(); if (!options.browser) await browser.close(); await host.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

/** The demonstration status the Player would get on a reload. */
export async function demonstrationStatus(s: PlayerSession): Promise<DemonstrationStatus | null> {
  const reply = await (await fetch(s.host.origin + "/api/resume", { headers: { [TOKEN_HEADER]: s.host.token } })).json() as HostReply<{ demonstration?: { status: DemonstrationStatus | null } }>;
  if (!reply.ok) throw new Error(reply.error.code);
  return reply.value.demonstration?.status ?? null;
}
/** A running demonstration is stopped and its pace opened, so the next state starts from a plain attempt. */
async function endDemonstration(s: PlayerSession): Promise<boolean> {
  const status = await demonstrationStatus(s);
  if (!status) return false;
  if (status.state === "running") {
    await fetch(s.host.origin + "/api/demonstration/stop", { method: "POST", headers: { "Content-Type": "application/json", [TOKEN_HEADER]: s.host.token }, body: "{}" });
    s.demonstration.open();
    for (let i = 0; i < 200 && (await demonstrationStatus(s))?.state === "running"; i++) await new Promise(resolve => setTimeout(resolve, 25));
  }
  s.demonstration.open();
  return true;
}

/** Two animation frames: a paint turn after SSE data or a re-render. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function closeSheets(page: Page): Promise<void> {
  for (let i = 0; i < 3 && await page.locator("dialog[open]").count(); i++) { await page.keyboard.press("Escape"); await settle(page); }
}

export async function setLanguage(page: Page, language: Language): Promise<void> {
  await closeSheets(page);
  await page.getByTestId("language-" + language).click();
  await page.waitForFunction(lang => document.documentElement.lang === lang, language);
}

export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await closeSheets(page);
  await page.getByTestId("theme-select").selectOption(theme);
  await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
}

export async function setPointer(cdp: CDPSession, pointer: "fine" | "coarse"): Promise<void> {
  // Touch emulation switches (pointer: coarse) and (hover: none) live, without a reload.
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: pointer === "coarse", maxTouchPoints: pointer === "coarse" ? 5 : 1 });
}

const nativeOverlays = new WeakMap<Page, Frame>();
export async function closeNativeOverlay(page: Page): Promise<void> {
  const frame = nativeOverlays.get(page);
  if (!frame || frame.isDetached()) { nativeOverlays.delete(page); return; }
  await frame.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  if (await frame.locator('.ttd-dialog').count()) {
    await frame.locator('.ttd-dialog textarea').focus();
    await page.keyboard.press('Escape');
    await frame.locator('.ttd-dialog').waitFor({ state: 'hidden' });
  }
  if(await frame.locator('.PasteChartDialog').count()){await frame.locator('.PasteChartDialog .ChartPreview').first().focus();await page.keyboard.press('Escape');await frame.locator('.PasteChartDialog').waitFor({state:'hidden'});}
  if (await frame.locator('.App-toolbar__extra-tools-dropdown').count()) await frame.locator('.App-toolbar__extra-tools-trigger').click();
  nativeOverlays.delete(page);
}

export async function mode(page: Page, id: "board" | "editor" | "author"): Promise<void> {
  await closeNativeOverlay(page);
  await closeSheets(page);
  if (await page.getByTestId("mode-" + id).getAttribute("aria-pressed") !== "true") await page.getByTestId("mode-" + id).click();
  await page.waitForFunction(id => document.body.dataset.workspace === id, id);
}

/** Back to a fresh attempt on the practice board: no sheet, no preview, no check, no hint. */
const pausedStreams = new WeakSet<PlayerSession>();
const heldExport=new WeakMap<PlayerSession,()=>Promise<void>>();
async function releaseExport(s:PlayerSession):Promise<void>{await heldExport.get(s)?.();heldExport.delete(s);}
async function restoreEventStream(s:PlayerSession):Promise<void>{
  if(!pausedStreams.has(s))return;
  await s.page.unroute("**/api/events");pausedStreams.delete(s);
  await s.page.getByTestId("stream-recovering").waitFor({state:"hidden",timeout:10_000});
}
export async function practiceBaseline(s: PlayerSession): Promise<void> {
  await releaseExport(s);
  await restoreEventStream(s);
  await mode(s.page, "board");
  await s.page.keyboard.press("Escape");
  // A demonstration's attempt is never a baseline, even when it stopped before its first action.
  const demonstrated = await endDemonstration(s);
  const view = await s.observe();
  if (demonstrated || view.step || view.hintsOpened || view.log.length) {
    const reply = await s.post("reset", { confirmed: true });
    if (!reply.ok) throw new Error(`reset refused: ${JSON.stringify(reply)}`);
    const after = await s.observe();
    if (after.step !== 0 || after.hintsOpened !== 0) throw new Error(`reset left step ${after.step}, hints ${after.hintsOpened}`);
  }
  // A reload drops client-only state (selection, pending preview, last verdict); the tab
  // session resumes the same host session.
  await s.page.reload();
  await s.page.getByTestId("board").waitFor();
  await s.page.waitForFunction(() => !(document.querySelector("[data-testid=mode-author]") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 30_000 });
  await settle(s.page);
}

async function act(s: PlayerSession, action: object): Promise<void> {
  const reply = await s.post("act", { action });
  if (!reply.ok) throw new Error(`action refused: ${JSON.stringify(reply)}`);
}

async function until(condition: () => boolean | Promise<boolean>, what: string, ms = 15_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!await condition()) { if (Date.now() > deadline) throw new Error(`not reached: ${what}`); await new Promise(resolve => setTimeout(resolve, 20)); }
}
/** Plays the bundled example's demonstration from the Player's own button up to `stage`: one action
 * landed and the next one waiting (`running`), its end with the verdict (`finished`), stopped by
 * the Stop button after one action (`stopped`), or a step that fails after one action (`failed`). */
export async function demonstrate(s: PlayerSession, stage: "running" | "finished" | "stopped" | "failed"): Promise<void> {
  if (stage === "finished") s.demonstration.open(); else s.demonstration.hold();
  await s.page.getByTestId("demo-start").click();
  const card = s.page.getByTestId("demonstration");
  if (stage === "finished") { await card.and(s.page.locator("[data-state=finished]")).waitFor(); await s.page.locator(".verdict.pass").waitFor(); return; }
  await until(() => s.demonstration.waiting() === 1, "the demonstration waits before its first action");
  s.demonstration.next();
  await until(() => s.demonstration.waiting() === 1, "the first action landed and the next one waits");
  await until(async () => await s.page.getByTestId("history-entry").count() === 1 && await card.getAttribute("data-done") === "1", "the Player shows the first action");
  if (stage === "stopped") { await s.page.getByTestId("demo-stop").click(); await card.and(s.page.locator("[data-state=stopped]")).waitFor(); }
  if (stage === "failed") { s.demonstration.fail(); await s.page.getByTestId("demo-failed").waitFor(); }
  await settle(s.page);
}
/** Model-only sessions run without the create flow: a fresh attempt without the workspace waits. */
export async function modelBaseline(s: PlayerSession): Promise<void> {
  const demonstrated = await endDemonstration(s);
  const view = await s.observe();
  if (demonstrated || view.step || view.hintsOpened) { const reply = await s.post("reset", { confirmed: true }); if (!reply.ok) throw new Error(`reset refused: ${JSON.stringify(reply)}`); }
  await s.page.reload(); await s.page.getByTestId("board").waitFor(); await settle(s.page);
}

async function checkResult(s: PlayerSession, verdict: "pass" | "fail"): Promise<void> {
  // The check runs through the visible button, like a learner; the host is the oracle.
  await s.page.getByTestId("check").click();
  await s.page.locator(`.verdict.${verdict}`).waitFor({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------------------------
// The real editor (Excalidraw in its own frame): pointer positions of world objects, native edits.
// Same gestures as the create e2e tests: a real pointer and keyboard, never a JSON edit.
// ---------------------------------------------------------------------------------------------
type EditorWindow = { __pnEditor: { read(): Array<{ id: string; x: number; y: number; width: number; height: number; isDeleted?: boolean; points?: number[][]; endBinding?: { elementId: string } }>; appState(): { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number } } };

export async function editorFrame(page: Page): Promise<Frame> {
  const frame = await (await page.getByTestId("real-editor").elementHandle())?.contentFrame();
  if (!frame) throw new Error("real editor frame not found");
  await frame.waitForFunction(() => !!(window as unknown as Partial<EditorWindow>).__pnEditor, undefined, { timeout: 30_000 });
  return frame;
}

/** Show a native overlay within the existing horizontal editor scroll region. */
async function nativeEditorView(page: Page, frame: Frame, selector: string, menuLabels?: string[], align: 'centre' | 'start' = 'centre'): Promise<void> {
  const target = frame.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const centre = await target.evaluate((element, { labels, align }) => {
    if (labels) {
      const boxes: DOMRect[] = [], seen: string[] = [];
      const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walk.nextNode(); node; node = walk.nextNode()) {
        const text = node.textContent?.trim();
        if (!text || !labels.includes(text)) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        boxes.push(...range.getClientRects()); seen.push(text);
      }
      if (labels.some(label => seen.filter(text => text === label).length !== 1) || !boxes.length) throw new Error('Native menu labels cannot be anchored');
      return (Math.min(...boxes.map(box => box.left)) + Math.max(...boxes.map(box => box.right))) / 2;
    }
    const box = element.getBoundingClientRect();
    return box.left + (align === 'start' ? 0 : box.width / 2);
  }, { labels: menuLabels, align });
  await page.locator('.native-editor-scroll').evaluate((region, { centre, align }) => {
    region.scrollLeft = Math.max(0, Math.min(region.scrollWidth - region.clientWidth, centre - (align === 'start' ? 0 : region.clientWidth / 2)));
  }, { centre, align });
  await settle(page);
}

/** PADR-0025: the actual native More-tools menu without the (unshipped) Mermaid converter entry. */
async function moreToolsState(s: PlayerSession): Promise<void> {
  await releaseExport(s);
  await restoreEventStream(s);
  await mode(s.page, 'editor');
  const frame = await editorFrame(s.page);
  nativeOverlays.set(s.page, frame);
  const language = await s.page.evaluate(() => document.documentElement.lang);
  // An explicit player theme sets data-theme; otherwise the system colour scheme decides.
  const dark = await s.page.evaluate(() => { const t = document.documentElement.dataset.theme; return t && t !== 'system' ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; });
  await frame.waitForFunction(({ language, dark }) => document.documentElement.lang === (language === 'de' ? 'de-DE' : 'en')
    && document.querySelector('.excalidraw-container')?.classList.contains('theme--dark') === dark, { language, dark });
  await frame.locator('.excalidraw-container').press('Escape');
  const before = await frame.evaluate(() => JSON.stringify((window as unknown as EditorWindow).__pnEditor.read()));
  const more = language === 'de' ? 'Weitere Werkzeuge' : 'More tools';
  const mermaid = language === 'de' ? 'Mermaid zu Excalidraw' : 'Mermaid to Excalidraw';
  await frame.getByRole('button', { name: more, exact: true }).click();
  const menu = frame.locator('.App-toolbar__extra-tools-dropdown');
  await menu.waitFor();
  const visibleButtons = await menu.getByRole('button').evaluateAll(buttons => buttons.filter(b => (b as HTMLElement).getClientRects().length > 0).length);
  if (visibleButtons !== 3 || await menu.getByRole('button', { name: mermaid, exact: true }).isVisible()
    || await menu.getByText(language === 'de' ? 'Erstellen' : 'Generate', { exact: true }).isVisible()) throw new Error('Native More-tools menu still offers the unshipped Mermaid converter');
  await nativeEditorView(s.page, frame, '.App-toolbar__extra-tools-dropdown');
  if (await frame.evaluate(() => JSON.stringify((window as unknown as EditorWindow).__pnEditor.read())) !== before) throw new Error('Opening the native More-tools menu changed drawing elements');
}

/** Fixed original range order; loaded face/200 does not prove used glyphs. */
export const NATIVE_SPREADSHEET_MANIFEST_SHA='35e120c73bea388e3e71bb7e4d7acbbc556edfe8d549d6d252e046f3eba1945a';
export const NATIVE_SPREADSHEET_PROBES=[{"rangeIndex":0,"label":"A","codepoints":[65],"sourceFile":"Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2","sourceSha256":"e4423b318e11432aff2e6e865e300b7ca270f92321a3f56632268fede01c1b48","unicodeRange":"U+20-7e,U+a0-a3,U+a5-a6,U+a8-ab,U+ad-b1,U+b4,U+b6-b8,U+ba-ff,U+131,U+152-153,U+2bc,U+2c6,U+2da,U+2dc,U+304,U+308,U+2013-2014,U+2018-201a,U+201c-201e,U+2020,U+2022,U+2024-2026,U+2030,U+2039-203a,U+20ac,U+2122,U+2212"},{"rangeIndex":1,"label":"Ł","codepoints":[321],"sourceFile":"Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2","sourceSha256":"4fb8ad69be9aeac5664d99e5aa3a68a27ea40c98943b80387f7cd55c034fcc93","unicodeRange":"U+100-130,U+132-137,U+139-149,U+14c-151,U+154-17e,U+192,U+1fc-1ff,U+218-21b,U+237,U+1e80-1e85,U+1ef2-1ef3,U+2113"},{"rangeIndex":2,"label":"Ж","codepoints":[1046],"sourceFile":"Excalifont-Regular-b9dcf9d2e50a1eaf42fc664b50a3fd0d.woff2","sourceSha256":"b424d16da4398be3e9852857a54ff70e043c8e2ec5c4444dbf7f88d7469b9859","unicodeRange":"U+400-45f,U+490-491,U+2116"},{"rangeIndex":3,"label":"α","codepoints":[945],"sourceFile":"Excalifont-Regular-41b173a47b57366892116a575a43e2b6.woff2","sourceSha256":"c96649a5f96e2faa9143ee94e5b590b5afb08092f8d67c67f09cef332d66e4a7","unicodeRange":"U+37e,U+384-38a,U+38c,U+38e-393,U+395-3a1,U+3a3-3a8,U+3aa-3cf,U+3d7"},{"rangeIndex":4,"label":"∑","codepoints":[8721],"sourceFile":"Excalifont-Regular-3f2c5db56cc93c5a6873b1361d730c16.woff2","sourceSha256":"18ea9be1dd6b5a67b057f44eba8e34cb290f88308c272bcf35c79c1a220d0d7b","unicodeRange":"U+2c7,U+2d8-2d9,U+2db,U+2dd,U+302,U+306-307,U+30a-30c,U+326-328,U+212e,U+2211,U+fb01-fb02"},{"rangeIndex":5,"label":"Ѣ","codepoints":[1122],"sourceFile":"Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2","sourceSha256":"a0637cff365c7344d2f7a15905a1f74dceaf56b5ac2ff913d150358bed6921f0","unicodeRange":"U+462-463,U+472-475,U+4d8-4d9,U+4e2-4e3,U+4e6-4e9,U+4ee-4ef"},{"rangeIndex":6,"label":"x́","codepoints":[120,769],"sourceFile":"Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2","sourceSha256":"b004007be100261e58188cf8a0f7e850e997702f35d57110915995cd880e49f1","unicodeRange":"U+300-301,U+303"}] as const;
export function spreadsheetFixture(index:number):string {const probe=NATIVE_SPREADSHEET_PROBES[index];if(!probe)throw Error('Unknown native spreadsheet range');return'name\tvalue\n'+probe.label+'\t1\nControl\t2';}
export async function spreadsheetState(s:PlayerSession,index:number):Promise<void> {
 const probe=NATIVE_SPREADSHEET_PROBES[index];if(!probe)throw Error('Unknown native spreadsheet range');
 await releaseExport(s);await restoreEventStream(s);await mode(s.page,'editor');const frame=await editorFrame(s.page);nativeOverlays.set(s.page,frame);
 const before=await frame.evaluate(()=>JSON.stringify((window as unknown as EditorWindow).__pnEditor.read())),revision=(await s.observe()).revision;
 await frame.evaluate(()=>{const w=window as unknown as {__pnSpreadsheetPaste?:{trusted:boolean;text:string|null}};delete w.__pnSpreadsheetPaste;window.addEventListener('paste',event=>{w.__pnSpreadsheetPaste={trusted:event.isTrusted,text:event.clipboardData?.getData('text/plain')??null};},{capture:true,once:true});});
 const text=spreadsheetFixture(index),helper=await s.context.newPage();
 try{await helper.goto('about:blank');await helper.setContent('<textarea aria-label="Owned clipboard fixture"></textarea>');const input=helper.getByRole('textbox',{name:'Owned clipboard fixture'});await input.fill(text);await input.focus();await helper.keyboard.press((process.platform==='darwin'?'Meta':'Control')+'+A');await helper.keyboard.press((process.platform==='darwin'?'Meta':'Control')+'+C');}finally{await helper.close();}
 await s.page.bringToFront();await s.page.getByTestId('real-editor').scrollIntoViewIfNeeded();await frame.locator('.excalidraw').focus();await s.page.keyboard.press('v');
 const canvas=await frame.locator('canvas').last().boundingBox(),viewport=s.page.viewportSize();if(!canvas||!viewport)throw Error('Native spreadsheet canvas is not visible');
 const left=Math.max(0,canvas.x),top=Math.max(0,canvas.y),right=Math.min(viewport.width,canvas.x+canvas.width),bottom=Math.min(viewport.height,canvas.y+canvas.height);if(right-left<2||bottom-top<2)throw Error('No visible native canvas intersection');
 await s.page.mouse.click((left+right)/2,(top+bottom)/2);await frame.locator('.excalidraw').focus();await s.page.keyboard.press((process.platform==='darwin'?'Meta':'Control')+'+V');
 const dialog=frame.locator('.PasteChartDialog');await dialog.waitFor();const previews=dialog.locator('.ChartPreview');if(await previews.count()!==2)throw Error('Both real native previews required');
 for(let i=0;i<2;i++){await previews.nth(i).locator('svg').waitFor();await frame.waitForFunction(({label,index})=>{const svg=document.querySelectorAll('.PasteChartDialog .ChartPreview svg')[index];return!!svg&&[...svg.querySelectorAll('text')].some(node=>node.textContent===label);},{label:probe.label,index:i});}
 const event=await frame.evaluate(()=>(window as unknown as {__pnSpreadsheetPaste?:{trusted:boolean;text:string|null}}).__pnSpreadsheetPaste);if(!event?.trusted||event.text!==text)throw Error('Trusted exact owned TSV paste required');
 if(await frame.evaluate(()=>JSON.stringify((window as unknown as EditorWindow).__pnEditor.read()))!==before||(await s.observe()).revision!==revision)throw Error('Native spreadsheet preview mutated its scene or revision');
}

async function editorPoint(page: Page, frame: Frame, id: string, part: "box" | "middle" | "end" | "left" = "box"): Promise<{ x: number; y: number }> {
  await page.getByTestId("real-editor").scrollIntoViewIfNeeded();
  await frame.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const p = await frame.evaluate(({ id, part }) => {
    const editor = (window as unknown as EditorWindow).__pnEditor;
    const e = editor.read().find(item => item.id === id);
    if (!e) throw new Error(`editor element ${id} not found`);
    const s = editor.appState();
    let x = e.x + e.width / 2, y = e.y + e.height / 2;
    if (part === "box") { x = e.x + 20; y = e.y + 20; }
    if (part === "left") x = e.x - 4;
    if (part === "end" && e.points) { const end = e.points.at(-1) as number[]; x = e.x + (end[0] as number); y = e.y + (end[1] as number); }
    return { x: (x + s.scrollX) * s.zoom.value + s.offsetLeft, y: (y + s.scrollY) * s.zoom.value + s.offsetTop };
  }, { id, part });
  const box = await page.getByTestId("real-editor").boundingBox();
  if (!box) throw new Error("real editor is not visible");
  return { x: box.x + p.x, y: box.y + p.y };
}

/**
 * Editor gestures need the editor's own toolbars, which Excalidraw folds away on narrow screens.
 * The gesture runs at 1280 px; the caller's viewport is restored afterwards.
 */
async function wide<T>(page: Page, run: () => Promise<T>): Promise<T> {
  const before = page.viewportSize();
  if (before && before.width >= 1280) return run();
  await page.setViewportSize({ width: 1280, height: 900 });
  try { return await run(); } finally { if (before) { await page.setViewportSize(before); await settle(page); } }
}

/** The task's repair in the real editor: rewire ab to c, delete b and bc. */
async function nativeRepair(page: Page, frame: Frame): Promise<void> {
  const mid = await editorPoint(page, frame, "ab", "middle"); await page.mouse.click(mid.x, mid.y);
  const end = await editorPoint(page, frame, "ab", "end"), target = await editorPoint(page, frame, "c", "left");
  await page.mouse.move(end.x, end.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
  await frame.locator(".excalidraw").press("Escape");
  await frame.waitForFunction(() => (window as unknown as EditorWindow).__pnEditor?.read().find(e => e.id === "ab")?.endBinding?.elementId === "c", undefined, { timeout: 5000 });
  for (const id of ["b", "bc"]) {
    const p = await editorPoint(page, frame, id, id === "bc" ? "middle" : "box"); await page.mouse.click(p.x, p.y);
    await frame.locator(".excalidraw").press("Delete");
    await frame.waitForFunction(id => (window as unknown as EditorWindow).__pnEditor?.read().find(e => e.id === id)?.isDeleted, id, { timeout: 5000 });
  }
}

export interface StateDef {
  id: string;
  label: string;
  workspace: "board" | "editor" | "author" | "shell";
  /**
   * Where the flow leaves the user, for states whose action moves the view (an error focuses its
   * field, creating focuses "Open my exercise"): a selector to bring to the middle of the view. A
   * capture of such a state at scroll 0 shows a position the user only reaches by scrolling back up.
   */
  view?: string;
  /** Native responsive overlays close when the editor's viewport changes; reopen through the UI. */
  reenterOnViewportChange?: boolean;
  nativeFixture?:{textSha256:string;rangeIndex:number;codepoints:readonly number[];originalFontSha256:string;rangeManifestSha256:string;glyphUsage:'UNBEKANNT'};
  /** Enter the state from any other state of the same session. */
  enter(s: PlayerSession): Promise<void>;
}

export const PLAYER_STATES: StateDef[] = [
  { id: "practice-initial", label: "Practice, initial", workspace: "board", async enter(s) { await practiceBaseline(s); } },
  { id: "practice-step", label: "Step selected, palette", workspace: "board", async enter(s) {
    await practiceBaseline(s); await s.page.locator('[data-object-id="b"]').first().click(); await s.page.getByTestId("action-rename").waitFor();
  } },
  { id: "practice-arrow", label: "Connection selected", workspace: "board", async enter(s) {
    await practiceBaseline(s); await s.page.locator('button[data-object-id="ab"]').first().click(); await s.page.getByTestId("action-rewire-end").waitFor();
  } },
  { id: "practice-connect-pending", label: "Connect pending", workspace: "board", async enter(s) {
    await practiceBaseline(s); await s.page.locator('[data-object-id="a"]').first().click(); await s.page.getByTestId("action-connect").click(); await s.page.getByTestId("cancel-preview").waitFor();
  } },
  { id: "practice-picked", label: "Step picked up", workspace: "board", async enter(s) {
    await practiceBaseline(s); await s.page.locator('[data-object-id="a"]').first().focus(); await s.page.keyboard.press("Enter"); await s.page.locator(".step.picked").waitFor();
  } },
  { id: "sheet-add", label: "Add step sheet", workspace: "board", async enter(s) {
    await practiceBaseline(s); await s.page.getByTestId("action-add").click(); await s.page.locator("dialog[open]").waitFor();
  } },
  { id: "sheet-reset", label: "Reset sheet", workspace: "board", async enter(s) {
    await practiceBaseline(s); await act(s, { name: "move_step", params: { id: "a", x: 60, y: 160 } }); await s.page.getByTestId("reset").waitFor();
    await s.page.waitForFunction(() => !(document.querySelector("[data-testid=reset]") as HTMLButtonElement | null)?.disabled);
    await s.page.getByTestId("reset").click(); await s.page.getByTestId("reset-dialog").waitFor();
  } },
  { id: "practice-hint", label: "Hint open", workspace: "board", view: ".hint", async enter(s) {
    await practiceBaseline(s); await s.page.getByTestId("hint").click(); await s.page.locator(".hint").first().waitFor();
  } },
  { id: "check-fail", label: "Result check: not met", workspace: "board", view: "[data-testid=check-result]", async enter(s) {
    await practiceBaseline(s); await checkResult(s, "fail");
  } },
  { id: "check-pass", label: "Result check: met", workspace: "board", view: "[data-testid=check-result]", async enter(s) {
    await practiceBaseline(s);
    for (const action of [{ name: "reconnect_end", params: { id: "ab", end: "end", target: "c" } }, { name: "disconnect", params: { id: "bc" } }, { name: "delete_step", params: { id: "b" } }]) await act(s, action);
    await s.page.waitForFunction(() => !document.querySelector('[data-object-id="b"]'));
    await checkResult(s, "pass");
  } },
  { id: "check-stale", label: "Checked, then changed (stale)", workspace: "board", view: "[data-testid=check-result]", async enter(s) {
    await practiceBaseline(s); await checkResult(s, "fail");
    await act(s, { name: "move_step", params: { id: "a", x: 60, y: 160 } });
    await s.page.locator(".verdict.stale").waitFor({ timeout: 15_000 });
  } },
  { id: "practice-reconnecting", label: "Connection paused, retrying", workspace: "board", view: "[data-testid=stream-recovering]", async enter(s) {
    await practiceBaseline(s);
    await s.page.route("**/api/events", route => route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }));
    pausedStreams.add(s); await s.page.reload();
    await s.page.getByTestId("stream-recovering").waitFor({ timeout: 15_000 });
  } },
  {id:'practice-export-loading',label:'Preparing the current native/session export',workspace:'board',view:'[data-testid=export-panel]',async enter(s){
    await practiceBaseline(s);let release!:()=>void,finished!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),handled=new Promise<void>(resolve=>{finished=resolve;});
    await s.page.route('**/api/export',async route=>{try{const reply=await route.fetch();await held;await route.fulfill({response:reply});}finally{finished();}});
    heldExport.set(s,async()=>{release();await handled;await s.page.unroute('**/api/export');await s.page.getByTestId('export-loading').waitFor({state:'hidden'});});
    await s.page.getByTestId('export-prepare').click();await s.page.getByTestId('export-loading').waitFor();
  }},
  {id:'practice-export-ready',label:'Both export files bound to one current revision',workspace:'board',view:'[data-testid=export-panel]',async enter(s){
    await practiceBaseline(s);await s.page.getByTestId('export-prepare').click();await s.page.getByTestId('export-ready').waitFor();
  }},
  {id:'practice-export-stale',label:'Export pair is stale after the board changes',workspace:'board',view:'[data-testid=export-panel]',async enter(s){
    await practiceBaseline(s);await s.page.getByTestId('export-prepare').click();await s.page.getByTestId('export-ready').waitFor();
    await act(s,{name:'move_step',params:{id:'a',x:60,y:160}});await s.page.getByTestId('export-stale').waitFor();
  }},
  {id:'practice-export-error',label:'Export response exceeds the host limit (HTTP fault boundary)',workspace:'board',view:'[data-testid=export-panel]',async enter(s){
    await practiceBaseline(s);await s.page.route('**/api/export',route=>route.fulfill({status:413,json:{ok:false,error:{code:'result_too_large',message:'Export reply exceeded its limit'}}}));
    try{await s.page.getByTestId('export-prepare').click();await s.page.getByTestId('export-error').waitFor();}finally{await s.page.unroute('**/api/export');}
  }},
  // The bundled example's demonstration (roadmap 0.2.0, Should 7), here with the real tool mirrored.
  { id: "demo-confirm", label: "Demonstration asks before it clears the person's own work", workspace: "board", async enter(s) {
    await practiceBaseline(s); await act(s, { name: "move_step", params: { id: "a", x: 60, y: 160 } });
    await s.page.getByTestId("history-entry").first().waitFor();
    await s.page.getByTestId("demo-start").click(); await s.page.getByTestId("demo-confirm").waitFor();
  } },
  { id: "demo-running", label: "Demonstration playing: an action landed, confirmed by the real tool", workspace: "board", view: ".canvas", async enter(s) { await practiceBaseline(s); await demonstrate(s, "running"); } },
  { id: "demo-finished", label: "Demonstration finished: the result check's verdict and an own attempt", workspace: "board", view: "[data-testid=check-result]", async enter(s) { await practiceBaseline(s); await demonstrate(s, "finished"); } },
  { id: "demo-stopped", label: "Demonstration stopped after its first action", workspace: "board", view: "[data-testid=demonstration]", async enter(s) { await practiceBaseline(s); await demonstrate(s, "stopped"); } },
  { id: "demo-failed", label: "Demonstration stopped early by a refused step", workspace: "board", view: "[data-testid=demonstration]", async enter(s) { await practiceBaseline(s); await demonstrate(s, "failed"); } },
  { id: "practice-export-demonstration", label: "A demonstration's board cannot be saved as a result", workspace: "board", view: "[data-testid=export-panel]", async enter(s) {
    await practiceBaseline(s); await demonstrate(s, "finished"); await s.page.getByTestId("export-demonstration").waitFor();
  } },
  { id: "practice-unmodelled", label: "Not yet modelled (practice)", workspace: "board", async enter(s) {
    await practiceBaseline(s);
    // An action outside the world's declared actions, as an agent could send it; the host
    // rejects it as unmodeled and the board stays unchanged.
    const reply = await s.post("act", { action: { name: "rotate", params: { id: "a" } } });
    if (reply.ok) throw new Error("rotate was accepted; the unmodeled path was not exercised");
    await s.page.locator(".notice.unmodeled").waitFor({ timeout: 15_000 });
  } },
  { id: "editor", label: "Excalidraw workspace", workspace: "editor", async enter(s) {
    await mode(s.page, "editor"); await editorFrame(s.page);
  } },
  // Before the native dialog states: after the spreadsheet paste dialog at narrow widths the
  // widened editor no longer shows its properties panel for a selection (seen 2026-10-11).
  { id: "editor-unmodelled", label: "Not yet modelled (editor)", workspace: "editor", async enter(s) {
    await mode(s.page, "editor");
    if (await s.page.locator('[data-testid="phase3-status"].unmodeled').count()) return;
    await wide(s.page, async () => {
      const frame = await editorFrame(s.page);
      // A stroke colour change is a real Excalidraw edit the world does not model.
      const p = await editorPoint(s.page, frame, "a"); await s.page.mouse.click(p.x, p.y);
      await frame.getByTestId("color-top-pick-#e03131").click();
      await s.page.locator('[data-testid="phase3-status"].unmodeled').waitFor({ timeout: 15_000 });
    });
  } },
  { id: 'editor-more-tools', label: 'Native More tools menu (no Mermaid converter entry)', workspace: 'editor', view: '[data-testid=real-editor]', reenterOnViewportChange: true, async enter(s) {
    await moreToolsState(s);
  } },
  ...NATIVE_SPREADSHEET_PROBES.map(probe=>({id:'editor-spreadsheet-preview-range-'+probe.rangeIndex,label:'Native spreadsheet preview, original range '+probe.rangeIndex,workspace:'editor' as const,view:'[data-testid=real-editor]',reenterOnViewportChange:true,nativeFixture:{textSha256:createHash('sha256').update(spreadsheetFixture(probe.rangeIndex)).digest('hex'),rangeIndex:probe.rangeIndex,codepoints:probe.codepoints,originalFontSha256:probe.sourceSha256,rangeManifestSha256:NATIVE_SPREADSHEET_MANIFEST_SHA,glyphUsage:'UNBEKANNT' as const},async enter(session:PlayerSession){await spreadsheetState(session,probe.rangeIndex);}})),
  // Last of the editor states: it leaves the demonstration's attempt behind (the next state's baseline resets it).
  { id: "editor-demonstration", label: "Excalidraw workspace on the demonstration's board: an edit is refused and says why", workspace: "editor", async enter(s) {
    await practiceBaseline(s); await demonstrate(s, "finished");
    await mode(s.page, "editor");
    await wide(s.page, async () => {
      const frame = await editorFrame(s.page);
      const p = await editorPoint(s.page, frame, "a"); await s.page.mouse.click(p.x, p.y);
      await frame.getByTestId("color-top-pick-#e03131").click();
      await s.page.locator('[data-testid="phase3-status"].error').filter({ hasText: /demonstration|Vorführung/ }).waitFor({ timeout: 15_000 });
    });
  } },
];

/**
 * The create flow, walked with real native gestures in the real editor (as the create e2e tests
 * do). Each state is a position in one project's life; a session moves forward only, so callers
 * run the states in this order. Re-entering the current state only makes sure the Create
 * workspace is shown.
 */
const createPosition = new WeakMap<PlayerSession, number>();
const busy = (page: Page): Promise<unknown> => page.waitForFunction(() => !/Working locally|Lokale Verarbeitung/.test(document.querySelector('[data-testid="recovery-status"]')?.textContent ?? ""), undefined, { timeout: 30_000 });
async function openStage(page: Page, stage: string): Promise<void> {
  const node = page.locator(`[data-stage=${stage}]`);
  if (!await node.evaluate(e => (e as HTMLDetailsElement).open)) await page.locator(`[data-stage=${stage}]>summary`).click();
}
// The stop action lives in the floating recording bar (recovery-stop-visible), as in the create e2e test.
async function record(page: Page, frame: Frame): Promise<void> {
  await page.getByTestId("recovery-consent").check();
  await page.getByTestId("recovery-source").selectOption("scripted");
  await page.getByTestId("recovery-start").click();
  await page.getByTestId("recovery-stop-visible").waitFor({ timeout: 15_000 }); await busy(page);
  await nativeRepair(page, frame);
}
/** Held author reads per session (the loading state of the drawing surface); released when the flow moves on. */
const heldAuthor = new WeakMap<PlayerSession, () => Promise<void>>();
const answeredOk = async (page: Page, route: string, click: () => Promise<void>): Promise<void> => {
  const response = page.waitForResponse(r => r.url().endsWith("/api/" + route));
  await click();
  const reply = await (await response).json() as { ok: boolean };
  if (!reply.ok) throw new Error(`${route} refused: ${JSON.stringify(reply).slice(0, 200)}`);
  await busy(page);
};
/**
 * A step of the create flow. `leave` undoes a held situation (a held request) before the flow
 * moves on; the project itself only ever moves forward.
 */
const CREATE_STEPS: Array<{ id: string; label: string; view?: string; run(s: PlayerSession): Promise<void>; revisit?(s: PlayerSession): Promise<void>; leave?(s: PlayerSession): Promise<void> }> = [
  { id: "create-initial", label: "Create, plan empty", async run(s) { await s.page.getByTestId("recovery-title").waitFor({ timeout: 15_000 }); } },
  {id:'create-author-required',label:'Author request refused, held tab and practice retained (HTTP principal control)',view:'[data-testid=recovery-status]',async run(s){
    await s.page.getByTestId('recovery-author').fill('Synthetic capability probe');
    const cache=await s.page.evaluate(()=>sessionStorage.getItem('practonaut.tab-session'));
    await s.page.route('**/api/author/prepare',async route=>{const reply=await route.fetch({headers:{...route.request().headers(),[TOKEN_HEADER]:s.host.token}});await route.fulfill({response:reply});});
    try{const response=s.page.waitForResponse(reply=>reply.url().endsWith('/api/author/prepare'));await s.page.getByTestId('recovery-prepare').click();const reply=await(await response).json() as HostReply<unknown>;
      if(reply.ok||reply.error.code!=='author_required')throw new Error('Practice principal must return author_required');
      await s.page.getByTestId('recovery-status').filter({hasText:/author access|Autorenzugriff/}).waitFor();
      if(await s.page.evaluate(()=>sessionStorage.getItem('practonaut.tab-session'))!==cache)throw new Error('author_required changed the legitimate held cache');
    }finally{await s.page.unroute('**/api/author/prepare');}
  }},
  { id: "create-saved-unavailable", label: "Damaged saved project kept, healthy flow available", view: "[data-testid=recovery-unavailable-projects]", async run(s) {
    await writeFile(join(s.localDirectory, "projects", "review-damaged.json"), "{damaged", { mode: 0o600 });
    await mode(s.page, "board"); await mode(s.page, "author");
    await s.page.getByTestId("recovery-unavailable-projects").waitFor();
  } },
  { id:"create-saved-delete",label:"Explicit saved-project deletion confirmation",view:"[data-testid=project-delete-dialog]",async run(s){
    await projectDeleteConfirmation(s);
  },async revisit(s){await projectDeleteConfirmation(s);},async leave(s){
    if(await s.page.getByTestId('project-delete-dialog').evaluateAll(nodes=>nodes.some(node=>(node as HTMLDialogElement).open)))await s.page.getByTestId('project-delete-cancel').click();
  } },
  { id:"create-saved-delete-error",label:"Unsafe project deletion fails and retains its entry",view:"[data-testid=project-delete-dialog]",async run(s){
    await projectDeleteConfirmation(s);await unsafeProjectDeletion(s);
  },async revisit(s){
    await projectDeleteConfirmation(s);await unsafeProjectDeletion(s);
  },async leave(s){
    if(await s.page.getByTestId('project-delete-dialog').evaluateAll(nodes=>nodes.some(node=>(node as HTMLDialogElement).open)))await s.page.getByTestId('project-delete-cancel').click();
    await rm(join(s.localDirectory, "projects", "review-damaged.json"),{recursive:true});
    await mode(s.page, "board"); await mode(s.page, "author");
    await s.page.getByTestId("recovery-unavailable-projects").waitFor({ state: "hidden" });
  } },
  { id: "create-plan-error", label: "Create, plan with a missing entry", view: '[aria-invalid="true"]', async run(s) {
    // As the create e2e test does: a title, no author, Prepare; the error stands at the field.
    await s.page.getByTestId("recovery-title").fill(await s.page.evaluate(() => document.documentElement.lang === "de" ? "Bestellablauf reparieren" : "Repair the order process"));
    await s.page.getByTestId("recovery-author").fill("");
    await s.page.getByTestId("recovery-prepare").click();
    await s.page.locator("#recovery-author-error").waitFor({ timeout: 15_000 });
  } },
  { id: "create-plan-prepared", label: "Create, plan prepared", async run(s) {
    await s.page.getByTestId("recovery-title").fill(await s.page.evaluate(() => document.documentElement.lang === "de" ? "Bestellablauf reparieren" : "Repair the order process"));
    await s.page.getByTestId("recovery-author").fill("Design review");
    await s.page.getByTestId("recovery-prepare").click();
    await s.page.waitForFunction(() => { const b = document.querySelector("[data-testid=recovery-start]") as HTMLButtonElement | null; return !!b && !b.disabled; }, undefined, { timeout: 15_000 });
    await busy(s.page); await editorFrame(s.page);
  } },
  { id: "create-editor-error", label: "Create, drawing surface failed", view: "[data-testid=engine-state]", async run(s) {
    // Fault at the engine response boundary (as the phase3 e2e test): the next two scene
    // acknowledgements come back as errors, so a mode change fails and the editor cannot be
    // restored. Create stays selected and its panel shows the failure with Try again.
    const frame = await editorFrame(s.page);
    await frame.evaluate(() => {
      const original = MessagePort.prototype.postMessage; let failed = 0;
      MessagePort.prototype.postMessage = function (message: unknown, ...rest: unknown[]) {
        if (failed < 2 && message !== null && typeof message === "object" && (message as { type?: string }).type === "configured") { failed++; return Reflect.apply(original, this, [{ type: "error", id: (message as { id?: number }).id, message: "review fault" }, ...rest]); }
        return Reflect.apply(original, this, [message, ...rest]);
      };
    });
    await s.page.getByTestId("mode-editor").click();
    await s.page.getByTestId("engine-retry").waitFor({ timeout: 20_000 });
    await s.page.waitForFunction(() => document.body.dataset.workspace === "author");
  } },
  { id: "create-editor-loading", label: "Create, drawing surface opening", view: "[data-testid=engine-state]", async run(s) {
    // Try again with the project read held in the page (its fetch waits for a release), so the
    // panel shows its loading state; the request itself is unchanged once released.
    await s.page.evaluate(() => {
      const w = window as unknown as { __pnHold?: Promise<void>; __pnRelease?: () => void; __pnFetch?: typeof fetch };
      w.__pnHold = new Promise<void>(resolve => { w.__pnRelease = resolve; });
      const original = w.__pnFetch ??= window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "/api/author" && (init?.method ?? "GET") === "GET") await w.__pnHold;
        return original(input, init);
      };
    });
    heldAuthor.set(s, async () => { await s.page.evaluate(() => { const w = window as unknown as { __pnRelease?: () => void; __pnFetch?: typeof fetch }; w.__pnRelease?.(); if (w.__pnFetch) window.fetch = w.__pnFetch; }); });
    await s.page.getByTestId("engine-retry").click();
    await s.page.locator('[data-testid="engine-state"][data-kind="loading"]').waitFor({ state: "visible", timeout: 15_000 });
  }, async leave(s) {
    const release = heldAuthor.get(s);
    if (!release) return;
    heldAuthor.delete(s); await release();
    await s.page.locator('[data-testid="engine-state"]').waitFor({ state: "hidden", timeout: 30_000 });
    await s.page.waitForFunction(() => document.body.dataset.workspace === "author" && !(document.querySelector("[data-testid=mode-author]") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 30_000 });
  } },
  { id: "create-record-error", label: "Create, recording cannot start", view: '[aria-invalid="true"]', async run(s) {
    // Start without source and permission: both errors stand at their fields.
    await openStage(s.page, "record");
    await s.page.waitForFunction(() => { const b = document.querySelector("[data-testid=recovery-start]") as HTMLButtonElement | null; return !!b && !b.disabled; }, undefined, { timeout: 15_000 });
    await s.page.getByTestId("recovery-start").click();
    await s.page.locator("#recovery-source-error").waitFor({ timeout: 15_000 });
  } },
  { id: "create-recording", label: "Create, recording with changes", view: "[data-stage=record] > summary", async run(s) { await record(s.page, await editorFrame(s.page)); } },
  { id: "create-review", label: "Create, review the recorded changes", view: "[data-stage=review] > summary", async run(s) {
    await s.page.getByTestId("recovery-stop-visible").click(); await busy(s.page); await openStage(s.page, "review");
  } },
  { id: "create-analyzed-first", label: "Create, rules derived, a second demonstration needed", view: "[data-testid^=recovery-question-]", async run(s) {
    await openStage(s.page, "review"); await s.page.getByTestId("recovery-analyze").click(); await busy(s.page);
    await s.page.getByTestId("recovery-confirm-record").waitFor({ timeout: 15_000 });
  } },
  { id: "create-confirm", label: "Create, confirm behaviour", view: "[data-stage=evidence] > summary", async run(s) {
    const page = s.page, frame = await editorFrame(page);
    // A second demonstration confirms what the first one showed.
    await openStage(page, "record"); await page.getByTestId("recovery-reload").click(); await busy(page);
    await record(page, frame);
    await page.getByTestId("recovery-stop-visible").click(); await busy(page);
    await openStage(page, "review"); await page.getByTestId("recovery-analyze").click(); await busy(page);
    await openStage(page, "evidence");
    await page.locator('[data-testid^="recovery-evidence-"]').first().waitFor({ timeout: 15_000 });
  } },
  { id: "create-evidence-partial", label: "Create, 1 of 3 behaviours confirmed", view: "[data-stage=evidence] > summary", async run(s) {
    await openStage(s.page, "evidence");
    const candidate = s.page.locator('[data-testid^="recovery-evidence-"]').first();
    await answeredOk(s.page, "author/confirm", () => candidate.click());
    await openStage(s.page, "evidence");
  } },
  { id: "create-goal", label: "Create, goal and examples", view: "[data-stage=build] > summary", async run(s) {
    // As the create e2e test does: confirm every open behaviour with one of its own candidates,
    // read from the host, and require that the host accepted each confirmation.
    const author = async (): Promise<{ project?: { hypotheses: Array<{ id: string; status: string }> } }> => {
      const reply = await (await fetch(s.host.origin + "/api/author", { headers: { [TOKEN_HEADER]: await s.page.evaluate(()=>JSON.parse(sessionStorage.getItem("practonaut.tab-session")!).authorToken as string) } })).json() as HostReply<{ project?: { hypotheses: Array<{ id: string; status: string }> } }>;
      if (!reply.ok) throw new Error(reply.error.code);
      return reply.value;
    };
    for (const hypothesis of (await author()).project?.hypotheses.filter(h => h.status !== "confirmed" && h.status !== "refuted") ?? []) {
      const candidate = s.page.locator(`[data-testid^="recovery-evidence-${hypothesis.id}-"]`).first();
      if (!await candidate.count()) continue;
      // click() scrolls the candidate into view itself and re-resolves it if a render replaces it in between.
      await openStage(s.page, "evidence"); await busy(s.page);
      const confirmed = s.page.waitForResponse(r => r.url().endsWith("/api/author/confirm"));
      await candidate.click();
      const reply = await (await confirmed).json() as { ok: boolean };
      if (!reply.ok) throw new Error(`confirmation of ${hypothesis.id} refused: ${JSON.stringify(reply)}`);
      await busy(s.page);
    }
    await openStage(s.page, "build"); await s.page.getByTestId("recovery-task-en").waitFor();
  } },
  { id: "create-goal-dirty", label: "Create, goal changed, examples stale", view: "[data-build-examples]", async run(s) {
    await openStage(s.page, "build");
    await s.page.getByTestId("recovery-task-en").fill("Remove the review and close the chain");
    await s.page.locator("[data-build-examples].is-stale").waitFor({ timeout: 15_000 });
  } },
  { id: "create-finish", label: "Create, finished exercise", view: '[data-testid="recovery-launch"]', async run(s) {
    // The create e2e test's path: both titles, configure, review and accept the examples, save,
    // compile; every server answer must be ok.
    const page = s.page;
    const answered = async (route: string, click: () => Promise<void>): Promise<void> => {
      const response = page.waitForResponse(r => r.url().endsWith("/api/" + route));
      await click();
      const reply = await (await response).json() as { ok: boolean };
      if (!reply.ok) throw new Error(`${route} refused: ${JSON.stringify(reply).slice(0, 200)}`);
      await busy(page);
    };
    await page.getByTestId("recovery-task-en").fill("Remove the review and close the chain");
    await page.getByTestId("recovery-task-de").fill("Prüfschritt entfernen und Ablauf schließen");
    await answered("author/configure", () => page.getByTestId("recovery-configure").click());
    await page.getByTestId("recovery-review-examples").check();
    await answered("author/configure", () => page.getByTestId("recovery-accept-examples").click());
    await openStage(page, "build");
    await answered("author/save", () => page.getByTestId("recovery-save").click());
    await page.getByTestId("recovery-compile").click(); await page.getByTestId("recovery-launch").waitFor({ timeout: 30_000 });
  } },
  { id: "create-advanced", label: "Create, technical author details open", view: "[data-testid=author-advanced] > summary", async run(s) {
    const details = s.page.getByTestId("author-advanced");
    if (!await details.evaluate(e => (e as HTMLDetailsElement).open)) await details.locator("summary").first().click();
    await s.page.locator('[data-testid="author-advanced"][open] .create-adv-grid').waitFor({ timeout: 15_000 });
  } },
];

async function projectDeleteConfirmation(s:PlayerSession):Promise<void>{
  await s.page.getByTestId('recovery-delete-project-review-damaged').click();
  await s.page.getByTestId('project-delete-dialog').waitFor();
}

async function unsafeProjectDeletion(s:PlayerSession):Promise<void>{
  const path=join(s.localDirectory,'projects','review-damaged.json');
  await rm(path,{recursive:true,force:true});await mkdir(path,{mode:0o700});
  const answered=s.page.waitForResponse(response=>response.url().endsWith('/api/author/delete-project')&&response.request().method()==='POST');
  await s.page.getByTestId('project-delete-confirm').click();const reply=await(await answered).json() as HostReply<unknown>;
  if(reply.ok||String(reply.error.code)!=='project_store_unsafe')throw new Error('Unsafe project deletion did not return project_store_unsafe: '+JSON.stringify(reply));
  await s.page.getByTestId('project-delete-error').waitFor();
}

function createState(index: number): StateDef {
  const step = CREATE_STEPS[index] as (typeof CREATE_STEPS)[number];
  return { id: step.id, label: step.label, workspace: "author", ...(step.view ? { view: step.view } : {}), async enter(s) {
    await restoreEventStream(s);
    await mode(s.page, "author");
    const at = createPosition.get(s) ?? -1;
    if (at > index) throw new Error(`the create flow of this session is already past ${step.id}`);
    if (at < index) await wide(s.page, async () => {
      for (let i = at + 1; i <= index; i++) {
        await CREATE_STEPS[i - 1]?.leave?.(s);
        await (CREATE_STEPS[i] as (typeof CREATE_STEPS)[number]).run(s); createPosition.set(s, i);
      }
    });
    // Theme/language controls and mode() dismiss sheets. Revisit transient states through
    // the real UI (and repeat the failing host request for an error), without rewinding
    // the author project or silently photographing the underlying page.
    if(at===index)await step.revisit?.(s);
    await settle(s.page);
  } };
}

/** Plan empty is reachable in every session; it belongs to the workspace states. */
PLAYER_STATES.push(createState(0));
/** Create states that change the author project; run them after the others, in this order. */
export const CREATE_PROGRESS_STATES: StateDef[] = CREATE_STEPS.slice(1).map((_, i) => createState(i + 1));
/** A world/2 task with both limits (PADR-0040): three changes and two checks per attempt. */
export const limitsWorld = (): World => v2World({ tasks: [v2Task({ limits: { actions: 3, checks: 2 } })] });
/** Task limits in the Player: what remains is shown, and a used-up check limit turns Check off.
 * Needs `startPlayer({ world: limitsWorld(), taskId: 'T1', phase3: false })`. */
export const LIMIT_STATES: StateDef[] = [
  { id: 'practice-limits', label: 'Limited attempt: changes used and checks left', workspace: 'board', view: '[data-testid=changes-used]', async enter(s) {
    if (!(await s.observe()).limits) throw new Error('limit states need a task with limits');
    await s.page.getByTestId('checks-left').waitFor();
  } },
  { id: 'practice-checks-left', label: 'One change and one failed check used', workspace: 'board', view: '[data-testid=changes-used]', async enter(s) {
    await act(s, { name: 'move_step', params: { id: 'a', x: 120, y: 100 } });
    await s.page.getByTestId('check').click();
    await s.page.waitForFunction(() => /1/.test(document.querySelector('[data-testid=checks-left]')?.textContent ?? ''));
  } },
  { id: 'practice-limits-used', label: 'Every change and check of the attempt used', workspace: 'board', view: '[data-testid=changes-none]', async enter(s) {
    await act(s, { name: 'move_step', params: { id: 'a', x: 140, y: 100 } });
    await act(s, { name: 'connect', params: { from: 'b', to: 'c' } });
    await s.page.getByTestId('check').click();
    await s.page.waitForFunction(() => (document.querySelector('[data-testid=check]') as HTMLButtonElement | null)?.disabled === true);
  } },
];

export const MODEL_ONLY_STATES:StateDef[]=[{id:'practice-export-model-only',label:'Model-only host refuses the native/session pair',workspace:'board',view:'[data-testid=export-panel]',async enter(s){
  if((await s.observe()).mirror!=='off')throw new Error('model-only state requires a real model-only host');
  await s.page.getByTestId('export-model-only').waitFor();
}},
// `npx practonaut` without Chromium: the Player opens at once and says what it does not check yet.
{ id: 'model-only-banner', label: 'Model-only session: not yet checked against the real Excalidraw, with the named download', workspace: 'board', async enter(s) {
  await modelBaseline(s); await s.page.getByTestId('model-only-banner').waitFor();
} },
{ id: 'demo-running-model-only', label: 'Demonstration playing in a model-only session', workspace: 'board', view: '.canvas', async enter(s) { await modelBaseline(s); await demonstrate(s, 'running'); } },
{ id: 'demo-finished-model-only', label: 'Demonstration finished in a model-only session', workspace: 'board', view: '[data-testid=check-result]', async enter(s) { await modelBaseline(s); await demonstrate(s, 'finished'); } }];

// ---------------------------------------------------------------------------------------------
// draw.io sessions (PADR-0049): the committed draw.io library on its rename-frame task (a frame, two
// steps and an arrow). Mirrored by the real draw.io where draw.war is installed for the tests
// (PN_DRAWIO_HOME, default `.local/drawio-home/`, as for the draw.io layer); elsewhere, as on CI, by a
// stand-in that keeps the confirmed state, writes the adapter's own model as the native file and draws
// a picture that says it is a stand-in. The session says which (`picture`); only `drawio-real-tool`
// shows that picture.
// ---------------------------------------------------------------------------------------------
export const DRAWIO_TASK = "rename-frame";
/** What `npx practonaut play drawio/<task>` without draw.war tells the Player (src/cli/serve.ts). */
export const MISSING_DRAWIO: ModelOnlyNotice = { reason: "missing", command: "npx practonaut setup --app drawio", download: { name: "draw.io 32.4.1", megabytes: 48 } };
export type DrawioPicture = { kind: "drawio" } | { kind: "stand-in"; reason: string };
export interface DrawioSession extends PlayerSession { picture: DrawioPicture | null }

let drawioRuntime: Promise<DrawioAvailability> | undefined;
/** draw.io sessions on the Player: mirrored (the default) or model-only with `modelOnly`'s notice. */
export async function startDrawioPlayer(options: Omit<PlayerOptions, "world" | "phase3" | "mirrorFactory" | "browser"> = {}): Promise<DrawioSession> {
  const mirrored = (options.mirror ?? "required") === "required";
  const browser = await chromium.launch({ headless: true });
  try {
    let picture: DrawioPicture | null = null, mirrorFactory: MirrorFactory | undefined;
    if (mirrored) {
      const found = await (drawioRuntime ??= drawioAvailability());
      if (found.ok) {
        const runtimePath = found.runtime.runtimePath;
        const registry: AdapterRegistry = { ...ADAPTER_REGISTRY, drawio: { ...ADAPTER_REGISTRY.drawio, create: (initial, adapterOptions, probe) => createDrawioAdapter(initial, adapterOptions, probe, { runtimePath }) } };
        mirrorFactory = (state, world, start) => createProductionMirror(state, undefined, world, registry, start?.signal);
        picture = { kind: "drawio" };
      } else {
        mirrorFactory = async state => standInDrawioMirror(state, next => standInPng(browser, next));
        picture = { kind: "stand-in", reason: found.skip };
      }
    }
    const s = await startPlayer({ ...options, world: drawioLibrary().world, taskId: options.taskId ?? DRAWIO_TASK, phase3: false, browser,
      ...(mirrorFactory ? { mirrorFactory } : { modelOnly: options.modelOnly ?? MISSING_DRAWIO }) });
    return { ...s, picture, async close() { try { await s.close(); } finally { await browser.close(); } } };
  } catch (error) { await browser.close(); throw error; }
}

/** The draw.io mirror's stand-in: the confirmed state kept, the adapter's own model as the native file. */
function standInDrawioMirror(initial: State, picture: (state: State) => Promise<Uint8Array>): PracticeMirror {
  let state = structuredClone(initial);
  const confirmed = (next: State) => { state = structuredClone(next); return { ok: true as const, state: structuredClone(next), warnings: [] }; };
  return {
    readBack: "live",
    apply: async transition => confirmed(transition.after),
    replace: async next => confirmed(next),
    snapshot: async () => structuredClone(state),
    png: async () => picture(state),
    exportNative: async () => `<mxfile><diagram id="p">${modelXml(writeCells(state, freshMemory()))}</diagram></mxfile>`,
    recover: async next => { state = structuredClone(next); },
    close: async () => CLOSED,
  };
}
const xmlText = (text: string): string => text.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** The stand-in picture: the live steps, frames and arrows in the colours the adapter writes, and a
 * caption that says it is not draw.io's picture. */
function standInSvg(state: State): string {
  const live = Object.values(state.objects).filter(object => !object.deleted);
  const steps = live.flatMap(object => object.type === "step" ? [object] : []);
  const box = (ids: readonly string[]) => {
    const members = steps.filter(step => ids.includes(step.id));
    const x = Math.min(...members.map(m => m.x)), y = Math.min(...members.map(m => m.y));
    return { x: x - FRAME_PAD, y: y - FRAME_PAD - FRAME_TITLE, width: Math.max(...members.map(m => m.x + m.width)) - x + 2 * FRAME_PAD, height: Math.max(...members.map(m => m.y + m.height)) - y + 2 * FRAME_PAD + FRAME_TITLE };
  };
  const frames = live.flatMap(object => object.type === "frame" && steps.some(step => step.frameId === object.id) ? [{ name: object.name, ...box(steps.filter(step => step.frameId === object.id).map(step => step.id)) }] : []);
  const all = [...steps, ...frames];
  const left = (all.length ? Math.min(...all.map(item => item.x)) : 0) - 20, top = (all.length ? Math.min(...all.map(item => item.y)) : 0) - 20;
  const width = Math.max(left + 560, ...all.map(item => item.x + item.width + 20)) - left, height = Math.max(top + 40, ...all.map(item => item.y + item.height)) - top + 64;
  const parts: string[] = [`<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="#ffffff"/>`];
  for (const frame of frames) parts.push(`<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" fill="none" stroke="#000000"/><line x1="${frame.x}" y1="${frame.y + FRAME_TITLE}" x2="${frame.x + frame.width}" y2="${frame.y + FRAME_TITLE}" stroke="#000000"/><text x="${frame.x + frame.width / 2}" y="${frame.y + 20}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12" font-weight="bold">${xmlText(frame.name)}</text>`);
  for (const arrow of live) {
    if (arrow.type !== "arrow") continue;
    const from = steps.find(step => step.id === arrow.from), to = steps.find(step => step.id === arrow.to);
    if (!from || !to) continue;
    const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y), forward = horizontal ? to.x >= from.x : to.y >= from.y;
    const [x1, y1, x2, y2] = horizontal ? [forward ? from.x + from.width : from.x, from.y + from.height / 2, forward ? to.x : to.x + to.width, to.y + to.height / 2] : [from.x + from.width / 2, forward ? from.y + from.height : from.y, to.x + to.width / 2, forward ? to.y : to.y + to.height];
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000000" marker-end="url(#end)"/>`);
  }
  for (const step of steps) {
    const stroke = "stroke" in step ? STROKE_HEX[step.stroke] : "#000000", fill = "fill" in step && step.fill !== "none" ? FILL_HEX[step.fill] : "#ffffff", shape = "shape" in step ? step.shape : "rectangle";
    const cx = step.x + step.width / 2, cy = step.y + step.height / 2;
    parts.push(shape === "ellipse" ? `<ellipse cx="${cx}" cy="${cy}" rx="${step.width / 2}" ry="${step.height / 2}" fill="${fill}" stroke="${stroke}"/>`
      : shape === "diamond" ? `<path d="M ${cx} ${step.y} L ${step.x + step.width} ${cy} L ${cx} ${step.y + step.height} L ${step.x} ${cy} Z" fill="${fill}" stroke="${stroke}"/>`
      : `<rect x="${step.x}" y="${step.y}" width="${step.width}" height="${step.height}" fill="${fill}" stroke="${stroke}"/>`,
      `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="12">${xmlText(step.label)}</text>`);
  }
  parts.push(`<text x="${left + 12}" y="${top + height - 16}" font-family="Helvetica, Arial, sans-serif" font-size="20" font-weight="bold" fill="#555555">Stand-in picture: draw.io is not installed for this run</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${width} ${height}" width="${width}" height="${height}"><defs><marker id="end" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 Z"/></marker></defs>${parts.join("")}</svg>`;
}
async function standInPng(browser: Browser, state: State): Promise<Uint8Array> {
  const page = await browser.newPage();
  try { await page.setContent(`<!doctype html><body style="margin:0">${standInSvg(state)}</body>`); return await page.locator("svg").screenshot(); }
  finally { await page.close(); }
}

/** A fresh attempt in a draw.io session (mirrored or model-only): no sheet, no export, no check. */
async function drawioBaseline(s: PlayerSession): Promise<void> {
  await releaseExport(s); await closeSheets(s.page);
  const view = await s.observe();
  if (view.world.adapterId !== "drawio") throw new Error("draw.io states need startDrawioPlayer");
  if (view.step || view.hintsOpened || view.log.length) { const reply = await s.post("reset", { confirmed: true }); if (!reply.ok) throw new Error(`reset refused: ${JSON.stringify(reply)}`); }
  await s.page.reload(); await s.page.getByTestId("board").waitFor(); await settle(s.page);
}
/** The library's reference solution of the task, with the session's variant labels. */
async function solveDrawio(s: PlayerSession): Promise<void> {
  const { world, library } = drawioLibrary(), view = await s.observe();
  const task = library.tasks.find(entry => entry.id === DRAWIO_TASK)!, tokens = variantTokens(world.variants.cases[variantIndex(world, view.seed)]!);
  for (const step of task.oracle.steps) await act(s, { name: step.name, params: Object.fromEntries(Object.entries(step.params).map(([key, value]) => [key, typeof value === "string" ? substituteTokens(value, tokens) : value])) });
}
async function mirroredDrawio(s: PlayerSession): Promise<void> {
  await drawioBaseline(s);
  if ((await s.observe()).mirror !== "required") throw new Error("needs a mirrored draw.io session");
}
/** A mirrored draw.io session (`startDrawioPlayer()`), in this order or any other. */
export const DRAWIO_STATES: StateDef[] = [
  { id: "drawio-practice", label: "draw.io session, mirrored: the board, the workspace control and How this is checked", workspace: "board", async enter(s) { await mirroredDrawio(s); } },
  { id: "drawio-workspaces", label: "draw.io session: the draw.io and Create segments unavailable (aria-disabled), the reason of the first read by keyboard", workspace: "board", view: ".shell-modes", async enter(s) {
    await mirroredDrawio(s);
    for (const id of ["mode-editor", "mode-author"]) if (await s.page.getByTestId(id).getAttribute("aria-disabled") !== "true") throw new Error(`${id} is offered in a draw.io session`);
    if ((await s.page.getByTestId("mode-editor").innerText()).trim() !== "draw.io") throw new Error("the app segment does not name draw.io");
    // Reached by keyboard, so its reason (its accessible name) is read; the focus ring shows it.
    await s.page.getByTestId("mode-editor").focus(); await s.page.keyboard.press("Shift+Tab"); await s.page.keyboard.press("Tab");
    if (await s.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.testid) !== "mode-editor") throw new Error("the draw.io segment is not reachable by keyboard");
  } },
  { id: "drawio-real-tool", label: "The real tool's picture: draw.io's own PNG at its own size on its light ground, or the stand-in picture where draw.war is not installed", workspace: "board", view: "[data-testid=tool-picture]", async enter(s) {
    await mirroredDrawio(s); await s.page.getByTestId("show-tool").click(); await s.page.locator(".tool-image").waitFor();
    await s.page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>(".tool-image"); return !!image && image.complete && image.naturalWidth > 0; });
    await settle(s.page);
  } },
  { id: "drawio-constraint-refused", label: "A group across frames refused by draw.io's declared constraint: the board unchanged, the reason in words", workspace: "board", view: ".notice.error", async enter(s) {
    await mirroredDrawio(s);
    // b leaves the frame, then the Player's own group tool asks to group a (in the frame) with b.
    await act(s, { name: "set_frame", params: { id: "b", frameId: null } });
    await s.page.locator('[data-object-id="b"]').first().waitFor();
    await s.page.locator('[data-object-id="a"]').first().click(); await s.page.getByTestId("action-group").click();
    await s.page.getByTestId("cancel-preview").waitFor();
    await s.page.locator('[data-object-id="b"]').first().click();
    if (await s.page.getByTestId("cancel-preview").count()) await s.page.keyboard.press("Enter");
    await s.page.locator(".notice.error").waitFor({ timeout: 15_000 });
  } },
  { id: "drawio-check-pass", label: "Solved in a mirrored draw.io session: history confirmed by draw.io, the verdict", workspace: "board", view: "[data-testid=check-result]", async enter(s) {
    await mirroredDrawio(s); await solveDrawio(s); await checkResult(s, "pass");
  } },
  { id: "drawio-export-ready", label: "Both export files ready: the session and practonaut.drawio", workspace: "board", view: "[data-testid=export-panel]", async enter(s) {
    await mirroredDrawio(s); await s.page.getByTestId("export-prepare").click(); await s.page.getByTestId("export-ready").waitFor();
    const download = s.page.waitForEvent("download"); await s.page.getByTestId("export-native").click();
    const name = (await download).suggestedFilename();
    if (name !== "practonaut.drawio") throw new Error(`the native file is ${name}`);
  } },
];
const drawioBanner = (id: string, label: string): StateDef => ({ id, label, workspace: "board", async enter(s) { await drawioBaseline(s); await s.page.getByTestId("model-only-banner").waitFor(); } });
/** Model-only draw.io sessions, one per notice the CLI gives (`startDrawioPlayer({ mirror: 'off', modelOnly: notice })`). */
export const DRAWIO_MODEL_ONLY_SESSIONS: Array<{ notice: ModelOnlyNotice; states: StateDef[] }> = [
  { notice: MISSING_DRAWIO, states: [
    drawioBanner("drawio-model-only-runtime", "draw.war not installed: not yet checked against the real draw.io, setup --app drawio and its 48 MB download"),
    { id: "drawio-export-model-only", label: "Model-only draw.io session refuses the native/session pair", workspace: "board", view: "[data-testid=export-panel]", async enter(s) { await drawioBaseline(s); await s.page.getByTestId("export-model-only").waitFor(); } },
  ] },
  { notice: MISSING_CHROMIUM, states: [drawioBanner("drawio-model-only-chromium", "draw.io session without Chromium: plain setup and its download")] },
  { notice: { reason: "start", command: "npx practonaut doctor --adapter" }, states: [drawioBanner("drawio-model-only-start", "draw.io session whose sandboxed Chromium did not start")] },
  { notice: { reason: "off" }, states: [drawioBanner("drawio-model-only-off", "draw.io session started with --mirror off")] },
];

/** Shell states need a fresh page whose bootstrap is held (loading) or already spent (failure). */
export async function shellStates(s: PlayerSession, theme: Theme, language: Language, viewport: { width: number; height: number }, visit: (state: "shell-loading" | "shell-error", page: Page) => Promise<void>): Promise<void> {
  const context = await s.browser.newContext({ viewport, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  try {
    await context.route("**/*", async route => { const url = new URL(route.request().url()); if (url.origin === s.host.origin) await route.continue(); else { s.external.push(url.href); await route.abort(); } });
    const page = await context.newPage();
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    await page.route("**/api/bootstrap", async route => { await held; await route.continue(); });
    await page.goto(s.host.url);
    await page.locator(".shell-message").waitFor();
    await setLanguage(page, language);
    // Explicit theme, verified: a capture labelled dark must show the dark theme.
    await setTheme(page, theme);
    await settle(page);
    await visit("shell-loading", page);
    const answered = page.waitForResponse(r => r.url().endsWith("/api/bootstrap"));
    release(); await answered;
    await page.locator(".shell-message--danger").waitFor();
    await settle(page);
    await visit("shell-error", page);
  } finally { await context.close(); }
}

/**
 * The real editor before it is ready and when it fails to start, in a fresh host and page: the
 * editor document is held (loading); after it started in English, its German locale chunk is
 * refused and German is chosen (failure, the path the create e2e test uses). The failure is then
 * shown in the requested language.
 */
export async function editorStartStates(browser: Browser, theme: Theme, language: Language, viewport: { width: number; height: number }, visit: (state: "editor-loading" | "editor-error", page: Page) => Promise<void>): Promise<string[]> {
  const directory = await mkdtemp(join(await realpath(tmpdir()), "pn-design-editor-"));
  const world = validateWorld(JSON.parse(readFileSync("examples/worlds/flow-diagram/world.json", "utf8")));
  const host = await startHost(world, { phase3: true, taskId: "T3", seed: 42, localDirectory: directory, tokenDirectory: join(directory, "credentials") });
  const context = await browser.newContext({ viewport, colorScheme: theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const external: string[] = [];
  const allowed = new Set([host.origin]);
  try {
    let release!: () => void;
    let refuseGerman = false;
    const held = new Promise<void>(r => { release = r; });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (!allowed.has(url.origin)) { external.push(url.href); await route.abort(); return; }
      if (url.pathname === "/api/bootstrap") { const response = await route.fetch(); const reply = await response.json() as { ok: boolean; value?: { engineOrigin?: string } }; if (reply.ok && reply.value?.engineOrigin) allowed.add(reply.value.engineOrigin); await route.fulfill({ response }); return; }
      if (/\/editor\.html/.test(url.pathname)) await held;
      if (refuseGerman && /de-DE-/.test(url.pathname)) { await route.abort(); return; }
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(host.url, { waitUntil: "domcontentloaded" });
    await page.getByTestId("board").waitFor();
    await setLanguage(page, language); await setTheme(page, theme); await settle(page);
    await visit("editor-loading", page);
    // The editor starts in English; then the German locale is refused and German is chosen.
    await setLanguage(page, "en");
    release();
    await page.waitForFunction(() => !(document.querySelector("[data-testid=mode-author]") as HTMLButtonElement | null)?.disabled, undefined, { timeout: 30_000 });
    refuseGerman = true;
    await setLanguage(page, "de");
    await page.getByTestId("mode-author").click();
    await page.locator('[data-testid="phase3-status"].error').waitFor({ timeout: 20_000 });
    if (language !== "de") { await setLanguage(page, language); await page.locator('[data-testid="phase3-status"].error').waitFor({ timeout: 5000 }); }
    await settle(page);
    await visit("editor-error", page);
  } finally { await context.close(); await host.close(); await rm(directory, { recursive: true, force: true }); }
  return external;
}

/** The living gallery, built and opened from file://; requests to anything else are recorded. */
export async function openGallery(browser: Browser, options: { width: number; height: number; theme: Theme }): Promise<{ page: Page; context: BrowserContext; external: string[]; cdp: CDPSession }> {
  const context = await browser.newContext({ viewport: { width: options.width, height: options.height }, colorScheme: options.theme, reducedMotion: "reduce", serviceWorkers: "block" });
  const external: string[] = [];
  await context.route("**/*", async route => { const url = route.request().url(); if (url.startsWith("file://")) await route.continue(); else { external.push(url); await route.abort(); } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(resolve(".local/gallery/index.html")).href);
  await page.locator(".gallery-main").waitFor();
  const cdp = await context.newCDPSession(page);
  return { page, context, external, cdp };
}


/** Independent cells: never enter these failures through the monotone CREATE_STEPS session. */
export const FONT_FAILURE_STATES=[
 {id:'editor-font-startup-missing',label:'Cold Board: original Excalifont face missing',workspace:'board',fault:'missing',point:'error',view:'[data-testid=engine-state]'},
 {id:'editor-font-startup-reject',label:'Cold Board: original font request rejected',workspace:'board',fault:'reject',point:'error',view:'[data-testid=engine-state]'},
 {id:'editor-font-startup-timeout',label:'Cold Board: original font deadline expired',workspace:'board',fault:'timeout',point:'error',view:'[data-testid=engine-state]'},
 {id:'create-editor-font-error',label:'Prepared Create: actual late font timeout',workspace:'author',fault:'timeout',point:'error',view:'[data-testid=engine-state]'},
 {id:'create-editor-font-retry-loading',label:'Prepared Create: own genuine retry loading',workspace:'author',fault:'timeout',point:'loading',view:'[data-testid=engine-state]'},
 {id:'create-editor-font-retry-ready',label:'Prepared Create: own genuine retry strictly ready',workspace:'author',fault:'timeout',point:'ready',view:'[data-testid=real-editor]'},
] as const;
export type FontFailureState=typeof FONT_FAILURE_STATES[number];
// Exact independent pinned SourceMap[34] browser descriptors; no descriptor normalization.
const FONT_FAILURE_RANGES=[
 'U+20-7E, U+A0-A3, U+A5-A6, U+A8-AB, U+AD-B1, U+B4, U+B6-B8, U+BA-FF, U+131, U+152-153, U+2BC, U+2C6, U+2DA, U+2DC, U+304, U+308, U+2013-2014, U+2018-201A, U+201C-201E, U+2020, U+2022, U+2024-2026, U+2030, U+2039-203A, U+20AC, U+2122, U+2212',
 'U+100-130, U+132-137, U+139-149, U+14C-151, U+154-17E, U+192, U+1FC-1FF, U+218-21B, U+237, U+1E80-1E85, U+1EF2-1EF3, U+2113',
 'U+400-45F, U+490-491, U+2116',
 'U+37E, U+384-38A, U+38C, U+38E-393, U+395-3A1, U+3A3-3A8, U+3AA-3CF, U+3D7',
 'U+2C7, U+2D8-2D9, U+2DB, U+2DD, U+302, U+306-307, U+30A-30C, U+326-328, U+212E, U+2211, U+FB01-FB02',
 'U+462-463, U+472-475, U+4D8-4D9, U+4E2-4E3, U+4E6-4E9, U+4EE-4EF','U+300-301, U+303',
];
const FONT_FAILURE_BYTES=[24956,12220,13296,8712,2104,2656,824] as const;
const FONT_FAILURE_CASCADIA={path:'/fonts/Cascadia/CascadiaCode-Regular.woff2',bytes:65732,sha256:'5bce041e0fcce617e35efbc335b1372d27a84acb65fb464c65ff80ab3424a885'} as const;
export interface FontFailureTrace {
 schema:'practonaut.font-design-state/1';state:string;theme:Theme;language:Language;viewport:{width:number;height:number};browser:string;
 documents:Array<{generation:number;staticPath:string;hasQuery:boolean;navigation:boolean}>;
 requests:Array<{generation:number;path:string;fault:'none'|'reject'|'deadline-hold'|'retry-hold'}>;
 responses:Array<{generation:number;path:string;status:number;mime:string|undefined;bytes:number;sha256:string}>;
 faults:Array<{kind:string;generation:number;path?:string}>;snapshots:Array<{point:string;value:unknown}>;
 externalRequests:number;completed:boolean;failure?:{stage:string;diagnosticSha256:string};
}
function fontStateRequire(value:unknown,reason:string):asserts value {if(!value)throw Error(reason);}
/** Actual fresh Host/context per call; trace deliberately never contains origins, queries or credentials. */
export async function fontFailureState(browser:Browser,definition:FontFailureState,theme:Theme,language:Language,viewport:{width:number;height:number},visit:(page:Page,cdp:CDPSession,trace:FontFailureTrace)=>Promise<void>):Promise<FontFailureTrace>{
 const trace:FontFailureTrace={schema:'practonaut.font-design-state/1',state:definition.id,theme,language,viewport,browser:browser.version(),documents:[],requests:[],responses:[],faults:[],snapshots:[],externalRequests:0,completed:false};
 const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-design-font-'));
 let host:RunningHost|undefined,context:BrowserContext|undefined,releaseDocument:()=>void=()=>{},releaseFailedFont:()=>void=()=>{},releaseRetryFont:()=>void=()=>{},resolveRetryHold:()=>void=()=>{},rejectRetryHold:(reason:Error)=>void=()=>{},retryHoldObservationTimer:ReturnType<typeof setTimeout>|undefined,stage='constructor';
 const timers=new Set<ReturnType<typeof setTimeout>>(),pending=new Set<Promise<void>>();
 const deadline=(release:()=>void,ms:number):ReturnType<typeof setTimeout>=>{const timer=setTimeout(release,ms);timers.add(timer);return timer;};
 try{
  const world=validateWorld(JSON.parse(readFileSync('examples/worlds/flow-diagram/world.json','utf8')));
  host=await startHost(world,{phase3:true,mirror:'required',taskId:'T3',seed:42,localDirectory:directory,tokenDirectory:join(directory,'credentials'),requireOffline:process.env.PN_REQUIRE_OFFLINE==='1'});
  context=await browser.newContext({viewport,colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});
  const page=await context.newPage(),cdp=await context.newCDPSession(page),allowed=new Set([host.origin]);
  const cold=definition.workspace==='board',failedGeneration=cold?1:2,retryGeneration=failedGeneration+1;
  let engineOrigin='',generation=0,retryHeld=false,documentSeen:()=>void=()=>{};const requestGeneration=new WeakMap<object,number>();
  const currentDocumentGeneration=():number=>generation;
  const heldDocument=new Promise<void>(resolve=>{releaseDocument=resolve;}),heldFailure=new Promise<void>(resolve=>{releaseFailedFont=resolve;}),heldRetry=new Promise<void>(resolve=>{releaseRetryFont=resolve;}),firstDocument=new Promise<void>(resolve=>{documentSeen=resolve;});
  await context.addInitScript(({missing,parentOrigin})=>{
   const w=window as any,parentValue=new URLSearchParams(location.hash.slice(1)).get('parent');w.__fontDesign={missingFaces:[],ports:[],advertisements:[],document:{timeOrigin:performance.timeOrigin,staticPath:location.pathname,hasQuery:location.search!=='',parentFragmentMatchesExpected:parentValue===parentOrigin}};
   // Only an owned test fault marker disarms the one missing-face seam; no application cache/authority changes.
   const retried=sessionStorage.getItem('OWNED_FONT_DESIGN_RETRY')==='1';
   const originalAdd=FontFaceSet.prototype.add;FontFaceSet.prototype.add=function(face:FontFace){if(missing&&!retried&&location.pathname==='/editor.html'&&face.family==='Excalifont'&&face.unicodeRange==='U+300-301, U+303'){w.__fontDesign.missingFaces.push({family:face.family,style:face.style,weight:face.weight,unicodeRange:face.unicodeRange});return this;}return originalAdd.call(this,face);};
   // Passive parent-port observer: original messages/calls are forwarded without replacement.
   const channels=new WeakMap<MessagePort,number>(),Original=MessageChannel,close=MessagePort.prototype.close;
   w.MessageChannel=class extends Original{constructor(){super();const index=w.__fontDesign.ports.length;channels.set(this.port1,index);w.__fontDesign.ports.push({index,closed:false,messages:[]});this.port1.addEventListener('message',event=>{const message=event.data;if(message?.type==='ready'||message?.type==='error')w.__fontDesign.ports[index].messages.push({type:message.type,requestIdAbsent:message.id===undefined,knownFontError:message.message==='Engine fonts are not ready',fontsReady:message.fontsReady===true,at:performance.now()});});}};
   MessagePort.prototype.close=function(){const index=channels.get(this);if(index!==undefined)w.__fontDesign.ports[index].closed=true;return close.call(this);};
   addEventListener('message',event=>{const frame=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]');if(frame&&event.source===frame.contentWindow&&event.data?.type==='practonaut-engine-ready/1')w.__fontDesign.advertisements.push({sameOrigin:event.origin===new URL(frame.src).origin,at:performance.now()});});
  },{missing:cold&&definition.fault==='missing',parentOrigin:host.origin});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(!allowed.has(url.origin)){trace.externalRequests++;await route.abort();return;}
   if(url.pathname==='/api/bootstrap'){const response=await route.fetch(),reply=await response.json() as {ok:boolean;value?:{engineOrigin?:string}};if(reply.ok&&reply.value?.engineOrigin){engineOrigin=reply.value.engineOrigin;allowed.add(engineOrigin);}await route.fulfill({response});return;}
   if(url.origin===engineOrigin&&url.pathname==='/editor.html'&&route.request().isNavigationRequest()&&route.request().resourceType()==='document'){
    generation++;trace.documents.push({generation,staticPath:'/editor.html',hasQuery:url.search!=='',navigation:true});requestGeneration.set(route.request(),generation);
    if(generation===1){documentSeen();if(cold){const timer=deadline(releaseDocument,10_000);await heldDocument;clearTimeout(timer);timers.delete(timer);}}
   }
   const path='/fonts/Excalifont/'+NATIVE_SPREADSHEET_PROBES[1].sourceFile;
   if(url.origin===engineOrigin&&url.pathname.startsWith('/fonts/')){
    requestGeneration.set(route.request(),generation);const failed=generation===failedGeneration,loading=generation===retryGeneration&&definition.point==='loading'&&url.pathname===path;
    const fault=failed&&url.pathname===path?(definition.fault==='reject'?'reject':definition.fault==='timeout'?'deadline-hold':'none'):loading?'retry-hold':'none';trace.requests.push({generation,path:url.pathname,fault});
    if(fault==='reject'){trace.faults.push({kind:'actual-original-font-abort',generation,path});await route.abort('failed');return;}
    if(fault==='deadline-hold'){trace.faults.push({kind:'actual-original-font-held',generation,path});const timer=deadline(releaseFailedFont,8500);await heldFailure;clearTimeout(timer);timers.delete(timer);trace.faults.push({kind:'actual-original-font-late-release',generation,path});}
    if(fault==='retry-hold'){retryHeld=true;resolveRetryHold();trace.faults.push({kind:'actual-original-retry-font-held',generation,path});const timer=deadline(releaseRetryFont,6500);await heldRetry;clearTimeout(timer);timers.delete(timer);trace.faults.push({kind:'actual-original-retry-font-release',generation,path});}
   }
   await route.continue();
  });
  page.on('response',response=>{
   const url=new URL(response.url());if(url.origin!==engineOrigin||(!url.pathname.startsWith('/fonts/')&&url.pathname!=='/editor.html'))return;
   const responseGeneration=requestGeneration.get(response.request());if(responseGeneration===undefined){trace.faults.push({kind:'response-request-binding-missing',generation,path:url.pathname});return;}const task=(async()=>{const body=await response.body();trace.responses.push({generation:responseGeneration,path:url.pathname,status:response.status(),mime:(await response.allHeaders())['content-type'],bytes:body.length,sha256:createHash('sha256').update(body).digest('hex')});})().catch(()=>{trace.faults.push({kind:'response-body-unavailable',generation:responseGeneration,path:url.pathname});});pending.add(task);void task.finally(()=>pending.delete(task));
  });
  stage='initial-parent';await page.goto(host.url,{waitUntil:'domcontentloaded'});await page.getByTestId('board').waitFor({timeout:10_000});await setTheme(page,theme);await setLanguage(page,language);
  const firstRequestTimeout=deadline(documentSeen,10_000);await firstDocument;clearTimeout(firstRequestTimeout);timers.delete(firstRequestTimeout);fontStateRequire(generation===1,'FIRST_REAL_EDITOR_DOCUMENT_NOT_OBSERVED');
  await page.evaluate(()=>{const held=JSON.parse(sessionStorage.getItem('practonaut.tab-session')!),practice=held.token,author=held.authorToken;(window as any).__fontDesignCapabilities=()=>{const now=JSON.parse(sessionStorage.getItem('practonaut.tab-session')!);return{practice:now.token===practice,author:now.authorToken===author};};});
  const observe=async()=>page.evaluate(async header=>{
   const held=JSON.parse(sessionStorage.getItem('practonaut.tab-session')!);const get=async(path:string,credential:string)=>{const response=await fetch('/api/'+path,{headers:{[header]:credential}}),reply=await response.json();if(!reply.ok)throw Error('DECLARED_READ_REFUSED');return reply.value;};
   return{host:await get('observe',held.token),author:await get('author',held.authorToken),workspace:held.workspace,capabilities:(window as any).__fontDesignCapabilities(),ports:(window as any).__fontDesign.ports,advertisements:(window as any).__fontDesign.advertisements};
  },TOKEN_HEADER);
  const native=async(frame:Frame)=>frame.evaluate(()=>({elements:(window as any).__pnEditor.read(),inert:document.getElementById('root')!.inert,missingFaces:(window as any).__fontDesign.missingFaces,document:(window as any).__fontDesign.document,fonts:[...document.fonts].filter(face=>['Excalifont','Cascadia'].includes(face.family)).map(face=>({family:face.family,style:face.style,weight:face.weight,unicodeRange:face.unicodeRange,status:face.status})),cascadiaChecked:document.fonts.check('400 20px Cascadia')}));
  const strictlyLoaded=(snapshot:Awaited<ReturnType<typeof native>>):void=>{
   fontStateRequire(!snapshot.inert,'NATIVE_ROOT_NOT_STRICTLY_READY');const faces=snapshot.fonts.filter(face=>face.family==='Excalifont');fontStateRequire(faces.length===7,'EXACT_SEVEN_ORIGINAL_FACES_REQUIRED');
   for(const range of FONT_FAILURE_RANGES)fontStateRequire(faces.filter(face=>face.unicodeRange===range&&face.style==='normal'&&face.weight==='400'&&face.status==='loaded').length===1,'ORIGINAL_FACE_DESCRIPTOR_OR_STATUS_DIFF');
   fontStateRequire(snapshot.cascadiaChecked&&snapshot.fonts.some(face=>face.family==='Cascadia'&&face.style==='normal'&&face.weight==='400'&&face.status==='loaded'),'CASCADIA_NOT_LOADED');
  };
  const waitReady=async():Promise<Frame>=>{await page.waitForFunction(()=>document.querySelector<HTMLButtonElement>('[data-testid=mode-author]')?.disabled===false,undefined,{timeout:10_000});const frame=await editorFrame(page);await frame.waitForFunction(()=>!!(window as any).__pnEditor&&!document.getElementById('root')!.inert,undefined,{timeout:10_000});strictlyLoaded(await native(frame));return frame;};
  let before=await observe(),nativeBefore:Awaited<ReturnType<typeof native>>|undefined;
  fontStateRequire(before.workspace==='board'&&!before.author.recording.active,'COLD_BASELINE_AUTHORITY_OR_WORKSPACE_DIFF');
  releaseDocument();
  if(!cold){
   stage='genuine-author-prepare';await waitReady();await page.getByTestId('mode-author').click();await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('practonaut.tab-session')!).workspace==='author',undefined,{timeout:10_000});
   await page.getByTestId('recovery-title').fill(language==='de'?'Fontfehler-Probe':'Font failure probe');await page.getByTestId('recovery-author').fill('Owned font design fixture');
   for(let index=0;index<3;index++)await page.getByTestId('recovery-label-'+index).fill(['Owned first','Owned middle','Owned last'][index]!);
   const answered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/author/prepare'&&response.request().method()==='POST');await page.getByTestId('recovery-prepare').click();const result=await(await answered).json() as {ok:boolean};fontStateRequire(result.ok,'GENUINE_PREPARE_ACK_NOT_OK');
   const frame=await waitReady();await frame.waitForFunction(()=>((window as any).__pnEditor?.read() as any[]|undefined)?.some(element=>element.type==='text'&&element.originalText==='Owned first'),undefined,{timeout:10_000});
   before=await observe();nativeBefore=await native(frame);fontStateRequire(before.author.project&&before.author.scene?.length&&!before.author.recording.active&&before.author.recordings.length===0&&before.workspace==='author','PREPARED_PROJECT_OR_RECORDER_BASELINE_DIFF');
   stage='real-second-document-font-fault';const beforeTimeOrigin=nativeBefore.document.timeOrigin;
   const navigation=page.waitForEvent('framenavigated',{predicate:candidate=>candidate===frame,timeout:10_000});
   await frame.evaluate(parentOrigin=>{history.replaceState(null,'',location.pathname+'#parent='+encodeURIComponent(parentOrigin));location.reload();},host.origin);
   await navigation;await frame.waitForFunction(previous=>!!(window as any).__pnEditor&&performance.timeOrigin!==previous,beforeTimeOrigin,{timeout:10_000});
   fontStateRequire(currentDocumentGeneration()===2,'ACTUAL_SECOND_EDITOR_DOCUMENT_NOT_OBSERVED');
  }
  trace.snapshots.push({point:'before',value:{parent:before,native:nativeBefore??null}});
  stage='actual-terminal-font-error';await page.locator('[data-testid=engine-state][data-kind=error]').waitFor({state:'visible',timeout:10_000});
  const frame=await editorFrame(page),failed=await observe(),nativeFailed=await native(frame);trace.snapshots.push({point:'failed',value:{parent:failed,native:nativeFailed}});
  fontStateRequire(generation===failedGeneration&&nativeFailed.inert,'ACTUAL_FAILED_DOCUMENT_OR_INERT_DIFF');fontStateRequire(nativeFailed.document.parentFragmentMatchesExpected&&!nativeFailed.document.hasQuery&&nativeFailed.document.staticPath==='/editor.html','CANONICAL_FAILED_DOCUMENT_FRAGMENT_OR_PATH_DIFF');if(nativeBefore)fontStateRequire(nativeFailed.document.timeOrigin!==nativeBefore.document.timeOrigin,'FAULT_REUSED_ORIGINAL_DOCUMENT');fontStateRequire(JSON.stringify(failed.host)===JSON.stringify(before.host)&&JSON.stringify(failed.author)===JSON.stringify(before.author)&&failed.workspace===before.workspace&&failed.capabilities.practice&&failed.capabilities.author,'FAILED_HOST_AUTHOR_WORKSPACE_CAPABILITY_DIFF');
  const known=failed.ports.flatMap((port:any)=>port.messages).filter((message:any)=>message.type==='error'&&message.requestIdAbsent&&message.knownFontError);fontStateRequire(known.length===1,'REAL_KNOWN_PORT_ERROR_MUST_BE_ONCE');
  const text=await page.getByTestId('phase3').innerText();fontStateRequire(text.includes(language==='de'?'Zeichenfläche nicht geöffnet':'The drawing surface did not open')&&text.includes(language==='de'?'Dein Projekt bleibt erhalten.':'Your project is kept.')&&!text.includes('Engine fonts are not ready'),'LOCALIZED_KNOWN_KEPT_CARD_DIFF');fontStateRequire(await page.getByTestId('engine-retry').isVisible(),'GENUINE_RETRY_NOT_VISIBLE');
  fontStateRequire(definition.fault==='missing'?nativeFailed.missingFaces.length===1:trace.faults.some(fault=>fault.generation===failedGeneration&&fault.kind===(definition.fault==='reject'?'actual-original-font-abort':'actual-original-font-held')),'DECLARED_ACTUAL_FONTFAULT_NOT_REACHED');
  if(definition.point==='error'){stage='capture-error';await visit(page,cdp,trace);fontStateRequire(await page.locator('[data-testid=engine-state][data-kind=error]').isVisible(),'ERROR_CAPTURE_LEFT_REGISTERED_STATE');}
  stage='own-genuine-retry';let observedRetryHold:Promise<void>|undefined;
  if(definition.point==='loading'){
   // Bind before the genuine click. Only the actual original font retry-hold route fulfills it.
   const actualRetryHold=new Promise<void>((resolve,reject)=>{resolveRetryHold=resolve;rejectRetryHold=reject;});
   const observationTimeout=new Promise<never>((_,reject)=>{retryHoldObservationTimer=deadline(()=>reject(Error('ACTUAL_RETRY_FONT_HOLD_NOT_REACHED')),10_000);});
   observedRetryHold=Promise.race([actualRetryHold,observationTimeout]);void observedRetryHold.catch(()=>{});
  }
  if(definition.fault==='missing')await frame.evaluate(()=>sessionStorage.setItem('OWNED_FONT_DESIGN_RETRY','1'));await page.getByTestId('engine-retry').click();
  if(definition.point==='loading'){
   await page.locator('[data-testid=engine-state][data-kind=loading]').waitFor({state:'visible',timeout:10_000});await observedRetryHold;clearTimeout(retryHoldObservationTimer);if(retryHoldObservationTimer)timers.delete(retryHoldObservationTimer);
   fontStateRequire(generation===retryGeneration&&retryHeld,'ACTUAL_RETRY_FONT_HOLD_NOT_REACHED');trace.snapshots.push({point:'loading',value:{parent:await observe(),native:await native(await editorFrame(page))}});
   stage='capture-loading';const capturedAt=Date.now();try{await visit(page,cdp,trace);fontStateRequire(Date.now()-capturedAt<5000&&await page.locator('[data-testid=engine-state][data-kind=loading]').isVisible(),'LOADING_CAPTURE_EXCEEDED_DECLARED_WINDOW');}finally{releaseRetryFont();}
  }
  stage='strict-own-retry-ready';const readyFrame=await waitReady();
  if(!cold)await readyFrame.waitForFunction(()=>((window as any).__pnEditor?.read() as any[]|undefined)?.some(element=>element.type==='text'&&element.originalText==='Owned first'),undefined,{timeout:10_000});
  await page.waitForFunction(workspace=>JSON.parse(sessionStorage.getItem('practonaut.tab-session')!).workspace===workspace,before.workspace,{timeout:10_000});
  const after=await observe(),nativeAfter=await native(readyFrame);trace.snapshots.push({point:'after',value:{parent:after,native:nativeAfter}});
  fontStateRequire(generation===retryGeneration,'GENUINE_RETRY_REAL_DOCUMENT_COUNT_DIFF');fontStateRequire(nativeAfter.document.timeOrigin!==nativeFailed.document.timeOrigin&&nativeAfter.document.parentFragmentMatchesExpected&&!nativeAfter.document.hasQuery&&nativeAfter.document.staticPath==='/editor.html','GENUINE_RETRY_DOCUMENT_INSTANCE_OR_FRAGMENT_DIFF');fontStateRequire(trace.documents.every(document=>document.navigation&&!document.hasQuery),'ACTUAL_STATIC_DOCUMENT_QUERY_OR_NAVIGATION_DIFF');fontStateRequire(JSON.stringify(after.host)===JSON.stringify(before.host)&&JSON.stringify(after.author)===JSON.stringify(before.author)&&after.workspace===before.workspace&&after.capabilities.practice&&after.capabilities.author&&!after.author.recording.active,'RETRY_HOST_AUTHOR_WORKSPACE_CAPABILITY_DIFF');
  fontStateRequire(failed.ports.length>0&&after.ports.length>failed.ports.length&&after.ports.slice(0,failed.ports.length).every((port:any)=>port.closed),'PREVIOUS_OWN_PORT_NOT_CLOSED');fontStateRequire(after.ports.slice(failed.ports.length).some((port:any)=>!port.closed&&port.messages.some((message:any)=>message.type==='ready'&&message.fontsReady)),'REAL_NEW_PORT_STRICT_READY_NOT_OBSERVED');
  if(nativeBefore){const fields=['id','type','seed','text','originalText','fontFamily','x','y','width','height','containerId','frameId','startBinding','endBinding','boundElements'];
   fontStateRequire(nativeAfter.elements.length===nativeBefore.elements.length,'RETRY_NATIVE_ELEMENT_COUNT_DIFF');for(const element of nativeAfter.elements){const old=nativeBefore.elements.find((value:any)=>value.id===element.id);fontStateRequire(old,'RETRY_NATIVE_ID_DIFF');for(const field of fields)fontStateRequire(JSON.stringify(element[field])===JSON.stringify(old[field]),'RETRY_NATIVE_SOURCE_FIELD_DIFF');}
   trace.snapshots.push({point:'native-raw-deltas',value:nativeAfter.elements.map((element:any)=>({id:element.id,fields:Object.keys(element).filter(key=>JSON.stringify(element[key])!==JSON.stringify(nativeBefore!.elements.find((old:any)=>old.id===element.id)?.[key]))}))});
  }else fontStateRequire(nativeAfter.elements.length===0&&!await page.locator('.engine-panel').isVisible(),'COLD_RETRY_DID_NOT_RETURN_ORIGINAL_BOARD');
  await Promise.allSettled([...pending]);
  for(let index=0;index<NATIVE_SPREADSHEET_PROBES.length;index++){const probe=NATIVE_SPREADSHEET_PROBES[index]!,matches=trace.responses.filter(response=>response.generation===retryGeneration&&response.path==='/fonts/Excalifont/'+probe.sourceFile);fontStateRequire(matches.length===1&&matches[0]!.status===200&&matches[0]!.mime==='font/woff2'&&matches[0]!.bytes===FONT_FAILURE_BYTES[index]&&matches[0]!.sha256===probe.sourceSha256,'RETRY_ORIGINAL_FONT_RESPONSE_BINDING_DIFF');}
  const cascadia=trace.responses.filter(response=>response.generation===retryGeneration&&response.path===FONT_FAILURE_CASCADIA.path);fontStateRequire(cascadia.length===1&&cascadia[0]!.status===200&&cascadia[0]!.mime==='font/woff2'&&cascadia[0]!.bytes===FONT_FAILURE_CASCADIA.bytes&&cascadia[0]!.sha256===FONT_FAILURE_CASCADIA.sha256,'RETRY_CASCADIA_RESPONSE_BINDING_DIFF');
  if(definition.point==='ready'){stage='capture-ready';await visit(page,cdp,trace);strictlyLoaded(await native(readyFrame));}
  fontStateRequire(trace.externalRequests===0,'EXTERNAL_REQUEST_ATTEMPT');trace.completed=true;
 }catch(error){trace.failure={stage,diagnosticSha256:createHash('sha256').update(String(error)).digest('hex')};}
 finally{rejectRetryHold(Error('OWN_RETRY_HOLD_OBSERVATION_CLOSED'));resolveRetryHold=()=>{};rejectRetryHold=()=>{};clearTimeout(retryHoldObservationTimer);releaseDocument();releaseFailedFont();releaseRetryFont();for(const timer of timers)clearTimeout(timer);
  const cleanup=async(label:string,operation:()=>Promise<void>):Promise<void>=>{try{await operation();}catch(error){trace.completed=false;trace.failure??={stage:label,diagnosticSha256:createHash('sha256').update(String(error)).digest('hex')};trace.faults.push({kind:label,generation:0});}};
  await cleanup('own-context-close',async()=>{await context?.close();});await Promise.allSettled([...pending]);await cleanup('own-host-close',async()=>{await host?.close();});await cleanup('own-temporary-directory-cleanup',()=>rm(directory,{recursive:true,force:true}));
 }
 return trace;
}
// SOURCE_ONLY additive proposal: no runtime/Brand/acceptance evidence inherited.
// These are initial module states, separate from all six known Port/font states.
// Initial loading is the actual Board/status: the cold engine panel stays hidden.
export const INITIAL_MODULE_STATES=[
 {id:'editor-initial-module-loading',label:'Board: actual initial module pending',point:'initial-loading',view:'[data-testid=phase3-status]'},
 {id:'editor-initial-module-timeout',label:'Board: actual initial module deadline expired',point:'error',view:'[data-testid=engine-state]'},
 {id:'editor-initial-module-retry-loading',label:'Board: genuine fresh iframe Retry pending',point:'retry-loading',view:'[data-testid=engine-state]'},
 {id:'editor-initial-module-retry-ready',label:'Board: genuine fresh iframe Retry strictly ready',point:'ready',view:'[data-testid=phase3-status]'},
] as const;
export type InitialModuleState=typeof INITIAL_MODULE_STATES[number];
export interface InitialModuleTrace{
 schema:'practonaut.initial-module-design-state/1';state:string;theme:Theme;language:Language;viewport:{width:number;height:number};
 attribution:'OWNED_SYNTHETIC_INITIAL_MODULE_CAPTURE_NOT_ACCEPTANCE';browser?:string;ownedBrowserCapture?:boolean;
 sourceBefore:unknown[];sourceAfter:unknown[];module?:{path:string;entryBytes:number;entrySha256:string;bytes:number;sha256:string};
 documents:Array<{generation:number;path:string;navigation:boolean;hasQuery:boolean}>;
 requests:Array<{generation:number;path:string;resourceType:string;fault:'none'|'initial-module-hold'|'retry-module-hold'}>;
 responses:Array<{generation:number;path:string;status:number;mime:string|undefined;bytes:number;sha256:string;csp:string|undefined}>;
 faults:Array<{stage:string;kind:string;generation?:number;path?:string;diagnosticSha256?:string}>;
 snapshots:Array<{point:string;value:unknown}>;cleanup:Array<{phase:string;status:'STARTED'|'COMPLETE'|'ERROR';diagnosticSha256?:string}>;
 evidenceIO:Array<{phase:string;status:'STARTED'|'COMPLETE'|'ERROR';diagnosticSha256?:string}>;
 externalRequests:number;completed:boolean;failure?:{stage:string;name:string;diagnosticSha256:string};
}
type InitialModuleResult={trace:InitialModuleTrace;originalError?:unknown};
const INITIAL_CAPTURE_OBSERVE_MS=10_000,INITIAL_CAPTURE_WINDOW_MS=5_000;
const initialDiagnostic=(error:unknown):{name:string;diagnosticSha256:string}=>{
 let name='unknown',text='unreadable diagnostic';try{name=error instanceof Error?error.name:typeof error;text=String(error);}catch{}
 return{name,diagnosticSha256:createHash('sha256').update(text).digest('hex')};
};
/** No live credentials or reference expansion. Finite selected source/static files only. */
function initialSourceBinding(path:string):unknown{
 const info=lstatSync(path);fontStateRequire(info.isFile()&&!info.isSymbolicLink(),'INITIAL_LITERAL_SOURCE_NOT_REGULAR');const bytes=readFileSync(path);
 return{path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stat:{dev:info.dev,ino:info.ino,nlink:info.nlink,mode:info.mode,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs}};
}
/** New owned resources per cell. No prepare/write/act/reset/Port or readiness injection. */
export async function initialModuleState(definition:InitialModuleState,theme:Theme,language:Language,viewport:{width:number;height:number},
 visit:(page:Page,cdp:CDPSession,trace:InitialModuleTrace)=>Promise<void>,persist:(trace:InitialModuleTrace,phase:'failure-before-cleanup'|'after-cleanup')=>Promise<void>):Promise<InitialModuleResult>{
 const trace:InitialModuleTrace={schema:'practonaut.initial-module-design-state/1',state:definition.id,theme,language,viewport,attribution:'OWNED_SYNTHETIC_INITIAL_MODULE_CAPTURE_NOT_ACCEPTANCE',sourceBefore:[],sourceAfter:[],documents:[],requests:[],responses:[],faults:[],snapshots:[],cleanup:[],evidenceIO:[],externalRequests:0,completed:false};
 let directory:string|undefined,browser:Browser|undefined,context:BrowserContext|undefined,host:RunningHost|undefined,page:Page|undefined;
 let stage='constructor',originalError:unknown,hasOriginal=false,generation=0,engineOrigin='',initialHeld=false,retryHeld=false,disposed=false,initialRetired=false;
 const currentGeneration=()=>generation;
 let secondDocumentSeen:()=>void=()=>{};const secondDocument=new Promise<void>(resolve=>{secondDocumentSeen=resolve;});
 const retainOriginal=(error:unknown,phase:string):void=>{if(hasOriginal){trace.faults.push({stage:phase,kind:'subsequent-original-error',diagnosticSha256:initialDiagnostic(error).diagnosticSha256});return;}hasOriginal=true;originalError=error;trace.failure={stage:phase,...initialDiagnostic(error)};trace.completed=false;try{console.error(JSON.stringify({scope:'INITIAL_MODULE_ORIGINAL_FAILURE_FIRST',state:definition.id,...trace.failure}));}catch(stderrError){trace.faults.push({stage:'stderr',kind:'secondary-stderr-io',diagnosticSha256:initialDiagnostic(stderrError).diagnosticSha256});}};
 let releaseInitial:()=>void=()=>{},releaseRetry:()=>void=()=>{};const pending=new Set<Promise<void>>();
 const sources=['src/player/phase3.ts','src/adapters/excalidraw/editor-browser.jsx','src/adapters/excalidraw/fonts-ready.js','examples/worlds/flow-diagram/world.json','tests/support/player-states.ts','.local/engine/editor.js'];
 const secondary=async(kind:'cleanup'|'evidenceIO',phase:string,operation:()=>Promise<unknown>|unknown):Promise<void>=>{
  const record:{phase:string;status:'STARTED'|'COMPLETE'|'ERROR';diagnosticSha256?:string}={phase,status:'STARTED'};trace[kind].push(record);
  try{await operation();record.status='COMPLETE';}catch(error){record.status='ERROR';record.diagnosticSha256=initialDiagnostic(error).diagnosticSha256;trace.completed=false;trace.faults.push({stage:phase,kind:'secondary-'+kind,diagnosticSha256:record.diagnosticSha256});}
 };
 try{
  // Bytes are read/bound before navigation, never executed by this fixture loader.
  const entry=readFileSync('.local/engine/editor.js'),matches=[...entry.toString('utf8').matchAll(/import\(["'](\.\/prod-[^"']+\.js)["']\)/g)].map(match=>match[1]!);
  fontStateRequire(matches.length===1,'INITIAL_EXACT_SINGLE_DYNAMIC_MODULE_REQUIRED');const modulePath='/'+matches[0]!.slice(2),moduleFile=join('.local/engine',modulePath.slice(1)),moduleBytes=readFileSync(moduleFile);
  trace.module={path:modulePath,entryBytes:entry.length,entrySha256:createHash('sha256').update(entry).digest('hex'),bytes:moduleBytes.length,sha256:createHash('sha256').update(moduleBytes).digest('hex')};sources.push(moduleFile);trace.sourceBefore=sources.map(initialSourceBinding);
  directory=await mkdtemp(join(await realpath(tmpdir()),'pn-design-initial-module-'));
  const worldBytes=readFileSync('examples/worlds/flow-diagram/world.json'),world=validateWorld(JSON.parse(worldBytes.toString('utf8')));
  stage='browser';browser=await launchBrowser({headless:true});trace.browser=browser.version();
  stage='owned-host';host=await startHost(world,{phase3:true,mirror:'required',taskId:'T3',seed:42,localDirectory:directory,tokenDirectory:join(directory,'credentials'),requireOffline:process.env.PN_REQUIRE_OFFLINE==='1'});
  context=await browser.newContext({viewport,colorScheme:theme,reducedMotion:'reduce',serviceWorkers:'block'});page=await context.newPage();const cdp=await context.newCDPSession(page),allowed=new Set([host.origin]);
  const heldInitial=new Promise<void>(resolve=>{releaseInitial=resolve;}),heldRetry=new Promise<void>(resolve=>{releaseRetry=resolve;});
  // Passive observation only. Original calls/events are forwarded unchanged.
  await context.addInitScript(({parentOrigin})=>{
   interface InitialModuleObservation {
    ports:Array<{index:number;closed:boolean;at:number}>;
    messages:Array<{index:number;type:unknown;fontsReady:boolean;requestIdAbsent:boolean;knownFontError:boolean;at:number}>;
    advertisements:Array<{currentSource:boolean;expectedOrigin:boolean;at:number}>;
    frames:Array<{at:number;path:string;hasQuery:boolean;sandbox:string|null}>;
    states:Array<{kind:string|undefined;hidden:HTMLElement['hidden']|undefined;at:number}>;
    focus:Array<{tag:string|undefined;testid:string|undefined;at:number;trusted:boolean}|{kind:'retry-click';trusted:boolean;at:number}>;
    sources:Array<{index:number;source:Window|null|undefined}>;
    document:{timeOrigin:number;path:string;hasQuery:boolean;parentFragmentMatches:boolean};
   }
   const w=window as any;const p:InitialModuleObservation=w.__initialModuleDesign={ports:[],messages:[],advertisements:[],frames:[],states:[],focus:[],sources:[],document:{timeOrigin:performance.timeOrigin,path:location.pathname,hasQuery:location.search!=='',parentFragmentMatches:new URLSearchParams(location.hash.slice(1)).get('parent')===parentOrigin}};
   const Original=MessageChannel,close=MessagePort.prototype.close,indices=new WeakMap<MessagePort,number>();
   w.MessageChannel=class extends Original{constructor(){super();const index=p.ports.length,frame=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]');indices.set(this.port1,index);p.sources.push({index,source:frame?.contentWindow});p.ports.push({index,closed:false,at:performance.now()});this.port1.addEventListener('message',event=>p.messages.push({index,type:event.data?.type,fontsReady:event.data?.fontsReady===true,requestIdAbsent:event.data?.id===undefined,knownFontError:event.data?.message==='Engine fonts are not ready',at:performance.now()}));}};
   MessagePort.prototype.close=function(){const index=indices.get(this),observedPort=index===undefined?undefined:p.ports[index];if(observedPort)observedPort.closed=true;return close.call(this);};
   addEventListener('message',event=>{if(event.data?.type!=='practonaut-engine-ready/1')return;const frame=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]');p.advertisements.push({currentSource:event.source===frame?.contentWindow,expectedOrigin:!!frame&&event.origin===new URL(frame.src).origin,at:performance.now()});});
   addEventListener('focusin',event=>{const target=event.target instanceof HTMLElement?event.target:null;p.focus.push({tag:target?.tagName,testid:target?.dataset.testid,at:performance.now(),trusted:event.isTrusted});},true);
   addEventListener('click',event=>{const target=event.target instanceof Element?event.target.closest('[data-testid=engine-retry]'):null;if(target)p.focus.push({kind:'retry-click',trusted:event.isTrusted,at:performance.now()});},true);
   let lastFrame:HTMLIFrameElement|null=null,lastState='';new MutationObserver(()=>{
    const frame=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]');if(frame&&frame!==lastFrame){lastFrame=frame;p.frames.push({at:performance.now(),path:new URL(frame.src||location.href).pathname,hasQuery:new URL(frame.src||location.href).search!=='',sandbox:frame.getAttribute('sandbox')});}
    const state=document.querySelector<HTMLElement>('[data-testid=engine-state]'),signature=state?.dataset.kind+':'+state?.hidden;if(signature!==lastState){lastState=signature;p.states.push({kind:state?.dataset.kind,hidden:state?.hidden,at:performance.now()});}
   }).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['src','hidden','data-kind']});
  },{parentOrigin:host.origin});
  const responseGeneration=new WeakMap<object,number>();
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());try{if(!allowed.has(url.origin)){trace.externalRequests++;trace.faults.push({stage:'route',kind:'unexpected-origin',path:url.pathname});await route.abort();return;}
   if(url.origin===host!.origin&&url.pathname==='/api/bootstrap'){const response=await route.fetch(),reply=await response.json() as {ok:boolean;value?:{engineOrigin?:string}};if(reply.ok&&reply.value?.engineOrigin){engineOrigin=reply.value.engineOrigin;allowed.add(engineOrigin);}await route.fulfill({response});return;}
   if(url.origin!==engineOrigin){await route.continue();return;}
   if(url.pathname==='/editor.html'&&request.isNavigationRequest()&&request.resourceType()==='document'){generation++;trace.documents.push({generation,path:url.pathname,navigation:true,hasQuery:url.search!==''});if(generation===2)secondDocumentSeen();}
   const ownGeneration=generation;responseGeneration.set(request,ownGeneration);
   const fault=url.pathname===modulePath&&ownGeneration===1?'initial-module-hold':url.pathname===modulePath&&ownGeneration===2&&definition.point==='retry-loading'?'retry-module-hold':'none';
   trace.requests.push({generation:ownGeneration,path:url.pathname,resourceType:request.resourceType(),fault});
   if(fault!=='none'){
    fontStateRequire(url.search===''&&request.resourceType()==='script','INITIAL_MODULE_STATIC_REQUEST_DIFF');
    const originalResponse=await bounded(route.fetch({timeout:INITIAL_CAPTURE_OBSERVE_MS}),INITIAL_CAPTURE_OBSERVE_MS),originalBody=await bounded(originalResponse.body(),INITIAL_CAPTURE_OBSERVE_MS);
    fontStateRequire(originalResponse.status()===200&&originalBody.equals(moduleBytes),'INITIAL_HELD_ORIGINAL_STATIC_RESPONSE_DIFF');
    trace.faults.push({stage:'route',kind:'original-static-response-body-bound',generation:ownGeneration,path:modulePath});if(fault==='initial-module-hold')initialHeld=true;else retryHeld=true;
    trace.faults.push({stage:'route',kind:fault,generation:ownGeneration,path:modulePath});await(fault==='initial-module-hold'?heldInitial:heldRetry);
    if(disposed){await route.abort();return;}
    trace.faults.push({stage:'route',kind:'exact-original-module-resume-attempt',generation:ownGeneration,path:modulePath});
    try{await route.fulfill({response:originalResponse});}catch(error){if(ownGeneration===1&&initialRetired){trace.faults.push({stage:'route',kind:'retired-initial-request-response-unavailable',generation:ownGeneration,path:modulePath,diagnosticSha256:initialDiagnostic(error).diagnosticSha256});return;}throw error;}return;
   }
   await route.continue();
   }catch(error){if(disposed)trace.faults.push({stage:'route',kind:'own-disposal-route-outcome',generation,path:url.pathname,diagnosticSha256:initialDiagnostic(error).diagnosticSha256});else retainOriginal(error,'actual-route-handler');}
  });
  page.on('response',response=>{
   const url=new URL(response.url());if(url.origin!==engineOrigin||!(url.pathname==='/editor.html'||url.pathname==='/editor.js'||url.pathname===modulePath||url.pathname.startsWith('/fonts/')))return;
   const ownGeneration=responseGeneration.get(response.request());if(ownGeneration===undefined){trace.faults.push({stage:'response',kind:'response-generation-missing',path:url.pathname});return;}
   const task=(async()=>{const body=await bounded(response.body(),INITIAL_CAPTURE_OBSERVE_MS),headers=await response.allHeaders();trace.responses.push({generation:ownGeneration,path:url.pathname,status:response.status(),mime:headers['content-type'],bytes:body.length,sha256:createHash('sha256').update(body).digest('hex'),csp:headers['content-security-policy']});})().catch(error=>{trace.faults.push({stage:'response',kind:'finite-static-response-unavailable',generation:ownGeneration,path:url.pathname,diagnosticSha256:initialDiagnostic(error).diagnosticSha256});});pending.add(task);void task.finally(()=>pending.delete(task));
  });
  const actualPage=page;
  const parent=async()=>actualPage.evaluate(async header=>{
   const held=JSON.parse(sessionStorage.getItem('practonaut.tab-session')!);const w=window as any;if(!w.__initialModuleCapabilities){const practice=held.token,author=held.authorToken;w.__initialModuleCapabilities=()=>{const current=JSON.parse(sessionStorage.getItem('practonaut.tab-session')!);return{practice:current.token===practice,author:current.authorToken===author};};}
   const get=async(path:string,credential:string)=>{const reply=await(await fetch('/api/'+path,{headers:{[header]:credential}})).json();if(!reply.ok)throw Error('INITIAL_PUBLIC_READ_REFUSED');return reply.value;};
   return{host:await get('observe',held.token),author:await get('author',held.authorToken),scene:await get('editor/scene',held.token),workspace:held.workspace,capabilities:w.__initialModuleCapabilities()};
  },TOKEN_HEADER);
  const ui=async()=>actualPage.evaluate(()=>{
   const p=(window as any).__initialModuleDesign,frame=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')!,state=document.querySelector<HTMLElement>('[data-testid=engine-state]')!,status=document.querySelector<HTMLElement>('[data-testid=phase3-status]')!,panel=frame.closest<HTMLElement>('.engine-panel')!,active=document.activeElement as HTMLElement|null;
   return{language:document.documentElement.lang,theme:document.documentElement.dataset.theme,workspace:document.body.dataset.workspace,boardVisible:!!document.querySelector<HTMLElement>('[data-testid=board]')?.getClientRects().length,panelHidden:panel.hidden,kind:state.dataset.kind,stateHidden:state.hidden,stateVisible:!!state.getClientRects().length,stateText:state.innerText,statusVisible:!!status.getClientRects().length,statusText:status.innerText,retryPresent:!!state.querySelector('[data-testid=engine-retry]'),retryName:state.querySelector('[data-testid=engine-retry]')?.textContent,alertRole:state.querySelector('.engine-state__card')?.getAttribute('role'),editorDisabled:document.querySelector<HTMLButtonElement>('[data-testid=mode-editor]')!.disabled,authorDisabled:document.querySelector<HTMLButtonElement>('[data-testid=mode-author]')!.disabled,nativeInert:frame.parentElement!.inert,ariaBusy:frame.parentElement!.getAttribute('aria-busy'),sandbox:frame.getAttribute('sandbox'),path:new URL(frame.src).pathname,hasQuery:new URL(frame.src).search!=='',active:{tag:active?.tagName,testid:active?.dataset.testid,role:active?.getAttribute('role'),ariaLabel:active?.getAttribute('aria-label')},ports:p.ports.map((port:any)=>({...port,currentSource:p.sources.find((source:any)=>source.index===port.index)?.source===frame.contentWindow})),messages:p.messages,advertisements:p.advertisements,frames:p.frames,states:p.states,focus:p.focus};
  });
  const frame=async():Promise<Frame>=>{const handle=await actualPage.getByTestId('real-editor').elementHandle(),value=await handle?.contentFrame();fontStateRequire(value,'INITIAL_CURRENT_FRAME_UNAVAILABLE');return value;};
  const native=async(value:Frame)=>value.evaluate(()=>{const w=window as any;return{timeOrigin:performance.timeOrigin,path:location.pathname,hasQuery:location.search!=='',document:w.__initialModuleDesign.document,inert:document.getElementById('root')?.inert,apiPresent:typeof w.__pnEditor?.read==='function'&&typeof w.__pnEditor?.appState==='function',elements:typeof w.__pnEditor?.read==='function'?w.__pnEditor.read():null,appState:typeof w.__pnEditor?.appState==='function'?w.__pnEditor.appState():null,faces:[...document.fonts].filter(face=>['Excalifont','Cascadia'].includes(face.family)).map(face=>({family:face.family,style:face.style,weight:face.weight,unicodeRange:face.unicodeRange,status:face.status})),cascadiaChecked:document.fonts.check('400 20px Cascadia')};});
  stage='initial-static-navigation';await actualPage.goto(host.url,{waitUntil:'domcontentloaded'});await actualPage.getByTestId('board').waitFor({timeout:INITIAL_CAPTURE_OBSERVE_MS});await setTheme(actualPage,theme);await setLanguage(actualPage,language);
  const waitHeld=async(retry:boolean)=>{const start=performance.now();while(!(retry?retryHeld:initialHeld)){fontStateRequire(performance.now()-start<INITIAL_CAPTURE_OBSERVE_MS,'INITIAL_ACTUAL_MODULE_HOLD_NOT_REACHED');await actualPage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));}};
  await waitHeld(false);const before=await parent(),oldFrame=await frame(),loading=await ui(),nativeLoading=await native(oldFrame);trace.snapshots.push({point:'initial-loading',value:{parent:before,ui:loading,native:nativeLoading}});
  fontStateRequire(currentGeneration()===1&&trace.requests.filter(request=>request.fault==='initial-module-hold').length===1,'INITIAL_ACTUAL_ONCE_MODULE_HOLD_DIFF');fontStateRequire(before.workspace==='board'&&!before.author.recording.active,'INITIAL_BOARD_RECORDER_BASELINE_DIFF');
  const preserve=(value:Awaited<ReturnType<typeof parent>>)=>{fontStateRequire(JSON.stringify(value.host)===JSON.stringify(before.host)&&JSON.stringify(value.author)===JSON.stringify(before.author)&&JSON.stringify(value.scene)===JSON.stringify(before.scene)&&value.workspace===before.workspace&&value.capabilities.practice&&value.capabilities.author,'INITIAL_WHOLE_PUBLIC_STATE_DIFF');};
  const noPort=(value:Awaited<ReturnType<typeof ui>>)=>fontStateRequire(value.ports.length===0&&value.advertisements.length===0,'INITIAL_PREADVERTISEMENT_BOUNDARY_NOT_REACHED');
  const presentation=(value:Awaited<ReturnType<typeof ui>>)=>fontStateRequire(value.language===language&&value.theme===theme&&value.path==='/editor.html'&&!value.hasQuery&&value.sandbox==='allow-scripts allow-same-origin','INITIAL_LOCALE_THEME_STATIC_MOUNT_DIFF');
  presentation(loading);noPort(loading);fontStateRequire(loading.boardVisible&&loading.statusVisible&&loading.panelHidden&&loading.editorDisabled&&loading.authorDisabled&&loading.nativeInert&&loading.kind==='loading'&&!nativeLoading.apiPresent&&nativeLoading.inert,'INITIAL_COLD_VISIBLE_LOADING_DIFF');
  const photograph=async(point:string,predicate:(value:Awaited<ReturnType<typeof ui>>)=>void)=>{
   const start=performance.now(),beforePhoto=await ui();predicate(beforePhoto);trace.snapshots.push({point:point+'-before-capture',value:beforePhoto});await visit(actualPage,cdp,trace);const afterPhoto=await ui();predicate(afterPhoto);fontStateRequire(performance.now()-start<INITIAL_CAPTURE_WINDOW_MS,'INITIAL_CAPTURE_DECLARED_WINDOW_EXCEEDED');trace.snapshots.push({point:point+'-after-capture',value:afterPhoto});
  };
  if(definition.point==='initial-loading'){stage='capture-initial-loading';await photograph('initial-loading',value=>{presentation(value);noPort(value);fontStateRequire(value.boardVisible&&value.statusVisible&&value.panelHidden&&value.kind==='loading'&&value.editorDisabled&&value.authorDisabled,'INITIAL_LOADING_CAPTURE_OVERRUN');});}
  stage='original-initial-deadline';await actualPage.locator('[data-testid=engine-state][data-kind=error]').waitFor({state:'visible',timeout:INITIAL_CAPTURE_OBSERVE_MS});const failed=await parent(),failedUI=await ui(),nativeFailed=await native(oldFrame);trace.snapshots.push({point:'error',value:{parent:failed,ui:failedUI,native:nativeFailed}});preserve(failed);presentation(failedUI);noPort(failedUI);
  fontStateRequire(initialHeld&&currentGeneration()===1&&failedUI.stateVisible&&!failedUI.stateHidden&&failedUI.alertRole==='alert'&&failedUI.retryPresent&&failedUI.editorDisabled&&failedUI.authorDisabled&&failedUI.nativeInert&&!nativeFailed.apiPresent&&nativeFailed.inert,'INITIAL_TERMINAL_UI_OR_FAULT_DIFF');
  fontStateRequire(failedUI.stateText.includes(language==='de'?'Zeichenfläche nicht geöffnet':'The drawing surface did not open')&&failedUI.stateText.includes(language==='de'?'Dein Projekt bleibt erhalten.':'Your project is kept.')&&failedUI.retryName?.trim()===(language==='de'?'Erneut versuchen':'Try again'),'INITIAL_LOCALIZED_KEPT_RETRY_DIFF');
  if(definition.point==='error'){stage='capture-error';await photograph('error',value=>{presentation(value);noPort(value);fontStateRequire(value.kind==='error'&&value.stateVisible&&value.retryPresent,'INITIAL_ERROR_CAPTURE_STATE_LOST');});}
  trace.snapshots.push({point:'before-genuine-retry-focus',value:(await ui()).active});stage='genuine-retry';await actualPage.getByTestId('engine-retry').click();trace.snapshots.push({point:'immediately-after-genuine-retry',value:await ui()});
  await actualPage.waitForFunction(()=>{const p=(window as any).__initialModuleDesign;return p.frames.length===2&&p.focus.filter((value:any)=>value.kind==='retry-click'&&value.trusted).length===1;},undefined,{timeout:INITIAL_CAPTURE_OBSERVE_MS});
  await bounded(secondDocument,INITIAL_CAPTURE_OBSERVE_MS);const retryFrame=await frame();fontStateRequire(retryFrame!==oldFrame&&oldFrame.isDetached(),'INITIAL_RETRY_NOT_FRESH_IFRAME');fontStateRequire(trace.documents.length===2&&currentGeneration()===2,'INITIAL_RETRY_ACTUAL_DOCUMENT_COUNT_DIFF');initialRetired=true;releaseInitial();
  if(definition.point==='retry-loading'){
   stage='real-retry-module-hold';await waitHeld(true);const held=await ui();trace.snapshots.push({point:'retry-loading',value:{parent:await parent(),ui:held,native:await native(retryFrame)}});preserve(await parent());
   fontStateRequire(held.kind==='loading'&&held.stateVisible&&!held.panelHidden&&held.nativeInert&&held.editorDisabled&&held.authorDisabled&&held.ariaBusy==='false'&&held.ports.length===0,'INITIAL_RETRY_VISIBLE_LOADING_DIFF');
   stage='capture-retry-loading';try{await photograph('retry-loading',value=>{presentation(value);fontStateRequire(retryHeld&&value.kind==='loading'&&value.stateVisible&&value.nativeInert&&value.editorDisabled&&value.ports.length===0,'INITIAL_RETRY_LOADING_CAPTURE_OVERRUN');});}finally{releaseRetry();}
  }
  stage='actual-current-port-strict-ready';await actualPage.waitForFunction(()=>{
   const p=(window as any).__initialModuleDesign,iframe=document.querySelector<HTMLIFrameElement>('[data-testid=real-editor]')!,port=p.ports.find((port:any)=>!port.closed&&p.sources.find((source:any)=>source.index===port.index)?.source===iframe.contentWindow);
   return !!port&&p.messages.some((message:any)=>message.index===port.index&&message.type==='ready'&&message.fontsReady===true)&&document.querySelector<HTMLButtonElement>('[data-testid=mode-editor]')?.disabled===false&&document.querySelector<HTMLButtonElement>('[data-testid=mode-author]')?.disabled===false&&iframe.parentElement?.inert===false&&iframe.parentElement.getAttribute('aria-busy')==='false'&&document.querySelector<HTMLElement>('[data-testid=engine-state]')?.hidden===true&&document.body.dataset.workspace==='board';
  },undefined,{timeout:INITIAL_CAPTURE_OBSERVE_MS});await retryFrame.waitForFunction(()=>typeof(window as any).__pnEditor?.read==='function'&&typeof(window as any).__pnEditor?.appState==='function'&&document.getElementById('root')?.inert===false,undefined,{timeout:INITIAL_CAPTURE_OBSERVE_MS});
  const after=await parent(),readyUI=await ui(),nativeReady=await native(retryFrame);trace.snapshots.push({point:'retry-ready',value:{parent:after,ui:readyUI,native:nativeReady}});preserve(after);presentation(readyUI);
  fontStateRequire(readyUI.boardVisible&&readyUI.statusVisible&&readyUI.panelHidden&&readyUI.ports.length===1&&readyUI.ports[0]!.currentSource&&readyUI.advertisements.filter((advertisement:any)=>advertisement.currentSource&&advertisement.expectedOrigin).length===1&&nativeReady.apiPresent&&!nativeReady.inert&&JSON.stringify(nativeReady.elements)==='[]','INITIAL_GENUINE_READY_OR_COLD_RAW_SCENE_DIFF');
  fontStateRequire(nativeReady.document.parentFragmentMatches&&nativeReady.path==='/editor.html'&&!nativeReady.hasQuery&&nativeReady.timeOrigin!==nativeFailed.timeOrigin,'INITIAL_RETRY_NATIVE_DOCUMENT_BINDING_DIFF');
  const faces=nativeReady.faces.filter(face=>face.family==='Excalifont');fontStateRequire(faces.length===7,'INITIAL_RETRY_ORIGINAL_SEVEN_FACES_REQUIRED');for(const range of FONT_FAILURE_RANGES)fontStateRequire(faces.filter(face=>face.unicodeRange===range&&face.style==='normal'&&face.weight==='400'&&face.status==='loaded').length===1,'INITIAL_RETRY_FACE_DESCRIPTOR_OR_STATUS_DIFF');fontStateRequire(nativeReady.cascadiaChecked&&nativeReady.faces.some(face=>face.family==='Cascadia'&&face.style==='normal'&&face.weight==='400'&&face.status==='loaded'),'INITIAL_RETRY_CASCADIA_DIFF');
  trace.snapshots.push({point:'after-genuine-retry-focus',value:readyUI.active});
  if(definition.point==='ready'){stage='capture-ready';await photograph('retry-ready',value=>{presentation(value);fontStateRequire(value.boardVisible&&value.panelHidden&&value.stateHidden&&!value.editorDisabled&&!value.authorDisabled&&!value.nativeInert,'INITIAL_READY_CAPTURE_STATE_LOST');});}
  await bounded(Promise.allSettled([...pending]),INITIAL_CAPTURE_OBSERVE_MS);
  for(const response of trace.responses.filter(response=>response.path===modulePath))fontStateRequire(response.bytes===moduleBytes.length&&response.sha256===trace.module.sha256&&response.status===200,'INITIAL_MODULE_RESPONSE_BODY_DIFF');
  const actualRetryModule=trace.responses.filter(response=>response.path===modulePath&&response.generation===2);fontStateRequire(actualRetryModule.length===1,'INITIAL_RETRY_MODULE_RESPONSE_UNBOUND');
  fontStateRequire(trace.documents.every(document=>document.path==='/editor.html'&&document.navigation&&!document.hasQuery)&&trace.externalRequests===0&&!trace.faults.some(fault=>['finite-static-response-unavailable','response-generation-missing'].includes(fault.kind)),'INITIAL_STATIC_RESPONSE_OR_NETWORK_BINDING_GAP');
  fontStateRequire(!hasOriginal,'INITIAL_ORIGINAL_ROUTE_ERROR_STOP');trace.completed=true;
 }catch(error){retainOriginal(error,stage);trace.completed=false;
  // First immutable diagnostic already precedes evidence and cleanup.
  await secondary('evidenceIO','failure-before-cleanup',()=>persist(trace,'failure-before-cleanup'));
 }finally{
  disposed=true;releaseInitial();releaseRetry();
  if(page)await secondary('evidenceIO','final-passive-ui',async()=>{trace.snapshots.push({point:'final-passive-focus',value:await page!.evaluate(()=>{const active=document.activeElement as HTMLElement|null;return{tag:active?.tagName,testid:active?.dataset.testid};})});});
  if(browser)await secondary('cleanup','normal-browser-close',()=>closeBrowser(browser!));
  await secondary('evidenceIO','finite-static-observer-drain',()=>bounded(Promise.allSettled([...pending]),INITIAL_CAPTURE_OBSERVE_MS));
  if(host)await secondary('cleanup','owned-host-close',()=>host!.close());
  if(directory)await secondary('cleanup','owned-directory-remove',()=>rm(directory!,{recursive:true,force:true}));
  await secondary('evidenceIO','source-bookend',()=>{trace.sourceAfter=sources.map(initialSourceBinding);fontStateRequire(JSON.stringify(trace.sourceBefore)===JSON.stringify(trace.sourceAfter),'INITIAL_SOURCE_BOOKEND_DIFF');});
  await secondary('evidenceIO','after-cleanup-exclusive-evidence',()=>persist(trace,'after-cleanup'));
 }
 return{trace,...(hasOriginal?{originalError}:{})};
}

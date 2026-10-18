// Test-only support for the native Open leg of `nativeFileTransfer` (issue #45, docs/testing.md).
//
// The launch seam patches `chromium.launch` of playwright-core, the same module object the Excalidraw
// adapter imports, so the real product function runs unchanged while a test observes or loads its page.
// Every install returns its own uninstall. Nothing here is product code.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright-core';
import { packWorld } from '../../src/package/index.ts';
import { packChecker } from '../../tools/pack-checker.ts';
import { checkerRequest } from '../../src/evaluation/process.ts';
import type { AssignmentReply } from '../../src/evaluation/contracts.ts';
import { exportAgentSolution, type TransferExport } from '../../src/evaluation/transfer.ts';

export interface H1NativeInput {
  request: { worldPath: string; bundlePath: string; taskId: string; seed: number };
  assigned: AssignmentReply; exported: TransferExport;
  inputPath: string; inputBytes: Buffer; expectedInputSha256: string;
}
/** The H1 transport file: the agent solution exported by the real editor, plus self-created tombstones. */
export async function h1NativeInput(root: string): Promise<H1NativeInput> {
  const worldPath = join(root, 'flow.pnworld'), bundlePath = join(root, 'flow.pncheck');
  await writeFile(worldPath, await packWorld('examples/worlds/flow-diagram')); await writeFile(bundlePath, await packChecker('examples/worlds/flow-diagram.check'));
  const request = { worldPath, bundlePath, taskId: 'H1', seed: 42 }, assigned = await checkerRequest({ ...request, mode: 'assignment', instantiated: true }) as AssignmentReply;
  const initial = structuredClone(assigned.assignment.initialState), frame = Object.values(initial.objects).find(object => object.type === 'frame' && !object.deleted)!;
  // Self-created inactive history, retained in Practonaut transport and removed by actual Native Open.
  initial.objects.b = { id: 'b', type: 'step', frameId: frame.id, label: 'Discard', x: 520, y: 300, width: 180, height: 100, fontFamily: 3, deleted: true };
  initial.objects.bc = { id: 'bc', type: 'arrow', frameId: frame.id, from: null, to: null, deleted: true };
  const exported = await exportAgentSolution(initial, { steps: [{ label: 'Review', x: 300, y: 300 }, { label: 'Archive', x: 750, y: 300 }], arrows: [{ from: 0, to: 1 }] });
  const inputPath = join(root, 'transport.excalidraw'); await writeFile(inputPath, exported.native, { flag: 'wx' });
  const inputBytes = await readFile(inputPath);
  return { request, assigned, exported, inputPath, inputBytes, expectedInputSha256: createHash('sha256').update(inputBytes).digest('hex') };
}

export interface SeamHooks {
  /** Added to every new context before its page loads; serialised by Playwright, so self-contained. */
  initScript?: () => void;
  /** Called for each new page before the adapter factory receives it. */
  page?: (page: Page, context: BrowserContext) => void;
}
export interface LaunchSeam { launches(): number; uninstall(): void }
export function installLaunchSeam(hooks: SeamHooks): LaunchSeam {
  const target = chromium as unknown as { launch: typeof chromium.launch };
  const own = Object.hasOwn(target, 'launch'), original = target.launch;
  let launches = 0;
  target.launch = (async (options?: Parameters<typeof chromium.launch>[0]) => {
    const browser = await original.call(chromium, options);
    launches++;
    const newContext = browser.newContext.bind(browser);
    browser.newContext = (async (contextOptions?: Parameters<typeof browser.newContext>[0]) => {
      const context = await newContext(contextOptions);
      if (hooks.initScript) await context.addInitScript(hooks.initScript);
      const onPage = hooks.page;
      if (onPage) context.on('page', page => onPage(page, context));
      return context;
    }) as typeof browser.newContext;
    return browser;
  }) as typeof chromium.launch;
  return {
    launches: () => launches,
    uninstall() { if (own) target.launch = original; else delete (target as { launch?: unknown }).launch; },
  };
}

type Method = (...args: unknown[]) => unknown;
function patch(target: object, key: string, make: (original: Method) => Method): void {
  const record = target as Record<string, Method>, original = record[key]!.bind(target);
  record[key] = make(original);
}

/**
 * Renderer CPU throttling for the Open leg only: on after the factory's initial scene write resolves,
 * off when the first `filechooser` wait settles. Neither wrapper adds a page round trip between a
 * `filechooser` listener and the shortcut, so the product's own ordering is what is measured.
 */
export function throttleOpenLeg(rate: number, onError: (error: unknown) => void = () => undefined): NonNullable<SeamHooks['page']> {
  return (page, context) => {
    const session: Promise<CDPSession> = context.newCDPSession(page);
    session.catch(onError);
    let state: 'idle' | 'on' | 'off' = 'idle';
    const set = async (value: number): Promise<void> => { await (await session).send('Emulation.setCPUThrottlingRate', { rate: value }); };
    patch(page, 'evaluate', evaluate => async (...args) => {
      const result = await evaluate(...args);
      if (state === 'idle' && typeof args[0] === 'string' && args[0].includes('window.__pn.write')) { state = 'on'; await set(rate); }
      return result;
    });
    patch(page, 'waitForEvent', waitForEvent => (...args) => {
      const waiting = waitForEvent(...args) as Promise<unknown>;
      if (args[0] !== 'filechooser') return waiting;
      const off = async (): Promise<void> => { if (state === 'on') { state = 'off'; await set(1).catch(onError); } };
      return waiting.then(async value => { await off(); return value; }, async (error: unknown) => { await off(); throw error; });
    });
  };
}

export type OpenTimelineEntry =
  | { event: 'listener'; name: string }
  | { event: 'roundtrip-start' | 'roundtrip-end'; call: number; method: string }
  | { event: 'press'; key: string };
/** Records `filechooser` listener registration, completed page round trips and key presses, in call order. */
export function recordOpenTimeline(timeline: OpenTimelineEntry[]): NonNullable<SeamHooks['page']> {
  let calls = 0;
  return page => {
    // EventEmitter#once registers through #on, so these three cover every listener Playwright adds.
    for (const method of ['on', 'addListener', 'prependListener']) patch(page, method, original => (...args) => {
      if (args[0] === 'filechooser') timeline.push({ event: 'listener', name: 'filechooser' });
      return original(...args);
    });
    for (const method of ['evaluate', 'waitForFunction']) patch(page, method, original => async (...args) => {
      const call = ++calls; timeline.push({ event: 'roundtrip-start', call, method });
      const result = await original(...args); timeline.push({ event: 'roundtrip-end', call, method });
      return result;
    });
    patch(page.keyboard, 'press', original => (...args) => { timeline.push({ event: 'press', key: String(args[0]) }); return original(...args); });
  };
}

/**
 * Probe (page context): every file-input click or showPicker call and every Ctrl/Cmd+O keydown, with
 * `navigator.userActivation.isActive` and whether keyboard focus is inside the editor container. Rows
 * go to the console as `PN_OPEN_PROBE <json>`.
 */
export function openProbeInitScript(): void {
  const log = (row: Record<string, unknown>): void => { console.info('PN_OPEN_PROBE ' + JSON.stringify({ ...row, ms: Math.round(performance.now()) })); };
  const activation = (): boolean | null => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? null;
  const focus = (): { focusInside: boolean; active: string | null } => {
    const container = document.querySelector('.excalidraw'), active = document.activeElement;
    return { focusInside: !!container && !!active && container.contains(active), active: active ? active.tagName.toLowerCase() : null };
  };
  const prototype = HTMLInputElement.prototype as HTMLInputElement & { showPicker?: () => void };
  const click = prototype.click, showPicker = prototype.showPicker;
  prototype.click = function (this: HTMLInputElement): void {
    if (this.type === 'file') log({ kind: 'file-input-click', connected: this.isConnected, userActivation: activation(), ...focus() });
    click.call(this);
  };
  if (showPicker) prototype.showPicker = function (this: HTMLInputElement): void {
    if (this.type === 'file') log({ kind: 'file-input-show-picker', connected: this.isConnected, userActivation: activation(), ...focus() });
    showPicker.call(this);
  };
  window.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'o' && (event.ctrlKey || event.metaKey)) log({ kind: 'open-keydown', userActivation: activation(), ...focus() });
  }, true);
}
export const OPEN_PROBE_PREFIX = 'PN_OPEN_PROBE ';

/**
 * Page context: the first pointerup moves keyboard focus to a new button outside the editor container,
 * synchronously inside the event, so it has moved before the click that caused it resolves.
 */
export function focusThiefInitScript(): void {
  let stolen = false;
  window.addEventListener('pointerup', () => {
    if (stolen) return;
    stolen = true;
    const thief = document.createElement('button'); thief.id = 'pn-focus-thief'; thief.textContent = 'outside the editor';
    document.body.append(thief); thief.focus();
    console.info('PN_FOCUS_THIEF moved focus');
  }, true);
}

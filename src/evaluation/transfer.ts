import { z } from 'zod';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { Page } from 'playwright-core';
import type { Action, State } from '../world/types.ts';
import type { ExcalidrawAdapter } from '../adapters/excalidraw/index.ts';
import { createExcalidrawAdapter, AdapterInitializationError } from '../adapters/excalidraw/index.ts';
import { bounded, BROWSER_BOUNDS } from '../adapters/excalidraw/bounded.ts';
import { parseExcalidraw } from '../checker/excalidraw.ts';
import { RuntimeError } from '../cli/runtime.ts';
import { openNativeFileChooser } from './native-trigger.ts';
import { consoleRecorder } from './console-evidence.ts';

export const TransferSolutionSchema = z.strictObject({ steps: z.array(z.strictObject({ label: z.string().min(1).max(128), x: z.number().int().min(200).max(950), y: z.number().int().min(180).max(500) })).min(1).max(8), arrows: z.array(z.strictObject({ from: z.number().int().min(0).max(7), to: z.number().int().min(0).max(7) })).max(16) });
export type TransferSolution = z.infer<typeof TransferSolutionSchema>;
export interface TransferExport { native: string; svg: string; state: State; networkAttempts: string[] }
/** Real editor adapter, no runtime Session, no public check or held-out feedback. */
export async function exportAgentSolution(initial: State, input: unknown): Promise<TransferExport> {
  const solution = TransferSolutionSchema.parse(input), frame = Object.values(initial.objects).find(object => object.type === 'frame' && !object.deleted);
  if (!frame) throw new RuntimeError('transfer_invalid', 'Transfer start requires a frame');
  const adapter = await createExcalidrawAdapter(initial); let state = structuredClone(initial);
  const commit = async (action: Action, next: State): Promise<void> => { const result = await adapter.apply({ before: state, after: next, action }); if (!result.ok) throw new RuntimeError('transfer_invalid', 'Real editor rejected the agent solution'); state = await adapter.snapshot(); };
  try {
    for (let index = 0; index < solution.steps.length; index++) { const step = solution.steps[index]!, id = `transfer-step-${index}`;
      const next = structuredClone(state); next.objects[id] = { id, type: 'step', frameId: frame.id, label: step.label, x: step.x, y: step.y, width: 180, height: 100, fontFamily: 3, deleted: false };
      await commit({ name: 'add_step', params: { frameId: frame.id, label: step.label, x: step.x, y: step.y, width: 180, height: 100, fontFamily: 3 } }, next);
    }
    for (let index = 0; index < solution.arrows.length; index++) { const arrow = solution.arrows[index]!;
      if (arrow.from >= solution.steps.length || arrow.to >= solution.steps.length || arrow.from === arrow.to) throw new RuntimeError('transfer_invalid', 'Agent solution has an invalid arrow reference');
      const id = `transfer-arrow-${index}`, from = `transfer-step-${arrow.from}`, to = `transfer-step-${arrow.to}`, next = structuredClone(state);
      next.objects[id] = { id, type: 'arrow', frameId: frame.id, from, to, deleted: false }; await commit({ name: 'connect', params: { frameId: frame.id, from, to } }, next);
    }
    const artifact = await adapter.exportArtifact(); return { native: artifact.native, svg: artifact.svg, state: parseExcalidraw(artifact.native), networkAttempts: adapter.networkAttempts() };
  } finally { await adapter.close(); }
}
async function drawStep(page: Page, x: number, y: number, label: string): Promise<void> {
  await page.keyboard.press('Escape'); await page.keyboard.press('r'); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 180, y + 100, { steps: 8 }); await page.mouse.up();
  // The newly drawn rectangle is selected. Enter creates bound text; clicking its hollow centre would create unbound text.
  await page.keyboard.press('Enter'); const text = page.locator('textarea.excalidraw-wysiwyg'); await text.waitFor(); await text.fill(label); await page.keyboard.press('Escape');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
/** Explicit scripted human. Draws with actual pointer/keyboard input in the pinned editor. */
export async function exportScriptedHuman(initial: State): Promise<TransferExport> {
  let page: Page | undefined; const adapter: ExcalidrawAdapter = await createExcalidrawAdapter(initial, {}, { ready(_browser, value) { page = value; } });
  try {
    if (!page) throw new RuntimeError('transfer_invalid', 'Real editor is unavailable');
    await page.locator('.excalidraw').first().click({ position: { x: 1300, y: 800 } });
    await drawStep(page, 300, 300, 'Review'); await drawStep(page, 750, 300, 'Archive');
    await page.keyboard.press('a'); await page.mouse.move(480, 350); await page.mouse.down(); await page.mouse.move(750, 350, { steps: 12 }); await page.mouse.up(); await page.keyboard.press('Escape');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const artifact = await adapter.exportArtifact(); return { native: artifact.native, svg: artifact.svg, state: parseExcalidraw(artifact.native), networkAttempts: adapter.networkAttempts() };
  } finally { await adapter.close(); }
}

export const NATIVE_TRANSFER_WALL_MS = 60_000;
export const NATIVE_TRANSFER_SETTLEMENT_MS = BROWSER_BOUNDS.launch + BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced;
export interface NativeTransferFile {
  native: string; sha256: string; bytes: number; state: State;
  activeElements: Array<Record<string, unknown>>; tombstoneIds: string[];
}
/** Supplemental native-normalization oracle. Full task checking still consumes the whole file. */
export function inspectNativeTransferFile(input: string | Uint8Array): NativeTransferFile {
  const bytes = Buffer.from(input), state = parseExcalidraw(bytes);
  const raw = JSON.parse(bytes.toString('utf8')) as { elements: Array<Record<string, unknown>> };
  const activeElements = raw.elements.filter(element => !element.isDeleted).map(element => {
    const refs = (element.boundElements ?? []) as Array<{ id: string; type: string }>;
    const base = { id: element.id, type: element.type, frameId: element.frameId,
      boundElements: [...refs].sort((a, b) => a.id.localeCompare(b.id)) };
    if (element.type === 'text') return { ...base, containerId: element.containerId, originalText: element.originalText,
      renderedContent: String(element.text).replace(/\s/g, ''), fontFamily: element.fontFamily };
    if (element.type === 'arrow') return { ...base, startBinding: (element.startBinding as { elementId: string } | null)?.elementId ?? null,
      endBinding: (element.endBinding as { elementId: string } | null)?.elementId ?? null,
      startArrowhead: element.startArrowhead ?? null, endArrowhead: element.endArrowhead ?? 'arrow' };
    return { ...base, x: element.x, y: element.y, width: element.width, height: element.height,
      ...(element.type === 'frame' ? { name: element.name } : {}) };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { native: bytes.toString('utf8'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), state,
    activeElements, tombstoneIds: raw.elements.filter(element => element.isDeleted).map(element => String(element.id)).sort() };
}
export function assertNativeTransferPreserved(before: NativeTransferFile, after: NativeTransferFile): void {
  if (!isDeepStrictEqual(before.activeElements, after.activeElements)) throw new RuntimeError('transfer_invalid', 'Native transfer changed an active identity, label, frame, geometry, arrow direction, binding or back-reference');
  if (after.tombstoneIds.length) throw new RuntimeError('transfer_invalid', 'Native Open/Save retained unexpected tombstones');
}
/** Finalizing a native edit must preserve its whole parsed state and preservation fields. */
export function assertNativeFinalizationPreserved(edited: NativeTransferFile, finalized: NativeTransferFile): void {
  if (!isDeepStrictEqual(edited.state, finalized.state) ||
      !isDeepStrictEqual(edited.activeElements, finalized.activeElements) ||
      !isDeepStrictEqual(edited.tombstoneIds, finalized.tombstoneIds)) {
    throw new RuntimeError('transfer_invalid', 'Native finalization changed the edited state or preservation fields');
  }
}
/** Compare the entire parsed state against exactly one native 5-unit rectangle move. */
export function assertNativeRectangleMove(opened: State, edited: State, stepId: string): void {
  const expectedEdit = structuredClone(opened);
  // The independent parser's objects dictionary has a null prototype. structuredClone
  // changes it to Object.prototype; retain the original representation for strict equality.
  Object.setPrototypeOf(expectedEdit.objects, Object.getPrototypeOf(opened.objects));
  const expectedStep = expectedEdit.objects[stepId];
  if (expectedStep?.type !== 'step') throw new RuntimeError('transfer_invalid', 'Opened native rectangle disappeared');
  expectedStep.x += 5;
  if (!isDeepStrictEqual(expectedEdit, edited)) throw new RuntimeError('transfer_invalid', 'Native edit changed more than the preregistered rectangle move');
}
export interface NativeFileTransfer {
  evidence: 'SCRIPTED_HEADLESS'; visibleOsSighting: 'OPEN'; inputPath: string; savedPath: string;
  save: { method: 'native-menu-save-as-download'; suggestedFilename: string };
  snapshots: { before: NativeTransferFile; opened: NativeTransferFile; edited: NativeTransferFile; undone: NativeTransferFile; saved: NativeTransferFile };
  edit: { stepId: string; dx: 5; dy: 0 }; networkAttempts: string[];
  completion?: { resultSha256: string; terminalSha256: string };
}
export class NativeTransferPersistenceError extends AggregateError {
  readonly terminalRecord: unknown;
  readonly durableEvidence = 'unavailable';
  constructor(primary: unknown, cleanup: unknown[], persistence: unknown, terminalRecord: unknown) {
    super([primary, ...cleanup, persistence].filter(value => value !== undefined), 'Native terminal evidence is unavailable', { cause: primary });
    this.terminalRecord = terminalRecord;
  }
}
async function writeNativeTerminal(directory: string, terminal: unknown, primary: unknown, cleanup: unknown[], ownsDirectory = true): Promise<void> {
  try {
    if (!ownsDirectory) throw new Error('Attempt did not create its output directory; existing evidence is not writable by this attempt');
    await writeFile(join(directory, 'terminal.json'), JSON.stringify(terminal, null, 2), { flag: 'wx', mode: 0o600 });
  } catch (error) { throw new NativeTransferPersistenceError(primary, cleanup, error, terminal); }
}
/** A standalone candidate is never success. Read and bind both entire durable records. */
export async function readNativeTransferCompletion(directory: string): Promise<{ resultSha256: string; terminalSha256: string }> {
  const [resultBytes, terminalBytes] = await Promise.all([readFile(join(directory, 'result.json')), readFile(join(directory, 'terminal.json'))]);
  const result = JSON.parse(resultBytes.toString('utf8')) as { status?: string };
  const terminal = JSON.parse(terminalBytes.toString('utf8')) as { status?: string; runSettled?: boolean; pendingNativeOperations?: number; cleanup?: { succeeded?: boolean }; resultFile?: { sha256?: string; bytes?: number } };
  const resultSha256 = createHash('sha256').update(resultBytes).digest('hex');
  if (result.status !== 'candidate' || terminal.status !== 'succeeded' || terminal.runSettled !== true || terminal.pendingNativeOperations !== 0 || terminal.cleanup?.succeeded !== true || terminal.resultFile?.sha256 !== resultSha256 || terminal.resultFile.bytes !== resultBytes.length) throw new RuntimeError('transfer_invalid', 'Native success requires the complete matching result/terminal byte pair and successful cleanup');
  return { resultSha256, terminalSha256: createHash('sha256').update(terminalBytes).digest('hex') };
}
/** Error originals for the private, exclusive attempt record, including nested disposal failures. */
export function nativeTransferErrorEvidence(error: unknown, depth = 0): unknown {
  if (error === undefined) return null;
  if (!(error instanceof Error)) return { value: String(error) };
  return { name: error.name, message: error.message, stack: error.stack ?? null,
    code: 'code' in error ? String(error.code) : null,
    cause: depth < 5 && error.cause !== undefined ? nativeTransferErrorEvidence(error.cause, depth + 1) : null,
    ...(error instanceof AggregateError && depth < 5 ? { errors: [...error.errors].map(value => nativeTransferErrorEvidence(value, depth + 1)) } : {}) };
}
/** One finite real native Open -> edit -> native Undo -> Save As/download attempt. No retry or API writes after Open. */
export async function nativeFileTransfer(input: { inputPath: string; expectedInputSha256: string; outputDirectory: string; stepId: string }): Promise<NativeFileTransfer> {
  let ownsDirectory = false, inputBytes: Buffer, before: NativeTransferFile;
  try {
    await mkdir(input.outputDirectory, { mode: 0o700 }); ownsDirectory = true; // Existing evidence is never overwritten.
    inputBytes = await readFile(input.inputPath); before = inspectNativeTransferFile(inputBytes);
    if (before.sha256 !== input.expectedInputSha256) throw new RuntimeError('transfer_invalid', 'Native input does not match the preregistered whole-file digest');
    const target = before.state.objects[input.stepId];
    if (target?.type !== 'step' || target.deleted) throw new RuntimeError('transfer_invalid', 'Native edit requires a named active rectangle');
    await writeFile(join(input.outputDirectory, 'input.excalidraw'), inputBytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(input.outputDirectory, '00-before.json'), JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 });
  } catch (primary) {
    const terminal = { status: 'failed', stage: 'setup', expectedInputSha256: input.expectedInputSha256, primaryError: nativeTransferErrorEvidence(primary), cleanup: { attempted: false, succeeded: false, errors: [] }, runSettled: true, resultFile: null };
    await writeNativeTerminal(input.outputDirectory, terminal, primary, [], ownsDirectory);
    throw primary;
  }
  const step = before.state.objects[input.stepId];
  if (step?.type !== 'step' || step.deleted) throw new RuntimeError('transfer_invalid', 'Native edit requires a named active rectangle');
  const end = performance.now() + NATIVE_TRANSFER_WALL_MS;
  const timeout = (): number => { const left = Math.floor(end - performance.now()); if (left <= 0) throw new RuntimeError('transfer_invalid', 'Native transfer exhausted its one attempt deadline'); return Math.min(10_000, left); };
  let page: Page | undefined, adapter: ExcalidrawAdapter | undefined, timer: ReturnType<typeof setTimeout> | undefined, expired = false;
  let stage = 'initialize', cleanupAttempted = false, factoryFailure: AdapterInitializationError | undefined;
  const controller = new AbortController(), cleanupErrors: unknown[] = [];
  const rememberCleanupError = (error: unknown): void => { if (!cleanupErrors.includes(error)) cleanupErrors.push(error); };
  const requireAttempt = (): void => { if (controller.signal.aborted) throw new RuntimeError('transfer_invalid', 'Native transfer cancelled at its one attempt deadline'); };
  let pendingNativeOperations = 0;
  // Attempt evidence: the engine page's console and uncaught errors from readiness on, bounded.
  const pageConsole = consoleRecorder();
  // Diagnostics that may fail without failing the attempt; their errors are attempt evidence.
  let beforeOpenScreenshotError: unknown;
  const observe = async <T>(operation: () => Promise<T>): Promise<T> => {
    requireAttempt();
    let cancel: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => reject(new RuntimeError('transfer_invalid', 'Native transfer cancelled at its one attempt deadline'));
      controller.signal.addEventListener('abort', cancel, { once: true });
    });
    pendingNativeOperations++;
    const pending = Promise.resolve().then(() => { requireAttempt(); return operation(); }).then(
      value => { pendingNativeOperations--; requireAttempt(); return value; },
      error => { pendingNativeOperations--; throw error; });
    try { return await Promise.race([pending, aborted]); }
    finally { if (cancel) controller.signal.removeEventListener('abort', cancel); }
  };
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => {
    expired = true; controller.abort();
    // Factory signal owns initialization; the returned adapter owns later UI work.
    if (adapter) { cleanupAttempted = true; void adapter.terminate().catch(rememberCleanupError); }
    reject(new RuntimeError('transfer_invalid', 'Native transfer exhausted its one attempt deadline'));
  }, NATIVE_TRANSFER_WALL_MS); });
  const run = async (): Promise<NativeFileTransfer> => {
    try {
    adapter = await createExcalidrawAdapter({ objects: {} }, { signal: controller.signal }, { ready(_browser, value) { page = value; } });
    requireAttempt();
    if (expired || !page) throw new RuntimeError('transfer_invalid', 'Native editor did not become ready within the attempt');
    const nativePage = page, modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    nativePage.setDefaultTimeout(timeout());
    nativePage.on('console', pageConsole.message);
    nativePage.on('pageerror', pageConsole.pageError);
    const capture = async (name: string): Promise<NativeTransferFile> => {
      requireAttempt();
      // Read-only observer: no updateScene, write, importArtifact, apply or host history operation.
      const elements = await observe(() => nativePage.evaluate('window.__pn.read()'));
      const file = inspectNativeTransferFile(JSON.stringify({ type: 'excalidraw', version: 2, elements, files: {} }));
      requireAttempt();
      await observe(() => writeFile(join(input.outputDirectory, `${name}.json`), JSON.stringify(file, null, 2), { flag: 'wx', mode: 0o600, signal: controller.signal }));
      const png = await observe(() => nativePage.screenshot({ timeout: timeout() }));
      requireAttempt(); await observe(() => writeFile(join(input.outputDirectory, `${name}.png`), png, { flag: 'wx', mode: 0o600, signal: controller.signal }));
      return file;
    };
    stage = 'open';
    // Diagnostics for a failed Open: the page before the click and the shortcut. Best effort: a failed
    // screenshot is recorded in the terminal record and never fails the attempt; the deadline still does.
    try {
      const beforeOpen = await observe(() => nativePage.screenshot({ timeout: timeout() }));
      requireAttempt(); await observe(() => writeFile(join(input.outputDirectory, '00-before-open.png'), beforeOpen, { flag: 'wx', mode: 0o600, signal: controller.signal }));
    } catch (error) { requireAttempt(); beforeOpenScreenshotError = error; }
    // Arm the filechooser waiter, click the editor, one round trip with a focus check, then the shortcut;
    // all of it, up to the filechooser event, under one step limit.
    const chooser = await observe(() => openNativeFileChooser(nativePage, { container: '.excalidraw', position: { x: 1300, y: 800 }, shortcut: `${modifier}+o`, limitMs: timeout() }));
    await observe(() => chooser.setFiles(input.inputPath, { timeout: timeout() }));
    await observe(() => nativePage.waitForFunction(id => (window as unknown as { __pn: { read(): Array<{ id: string }> } }).__pn.read().some(element => element.id === id), input.stepId, { timeout: timeout() }));
    if (!(await observe(() => readFile(input.inputPath))).equals(inputBytes)) throw new RuntimeError('transfer_invalid', 'Native input bytes changed while opening the file');
    const opened = await capture('01-opened'); assertNativeTransferPreserved(before, opened);
    stage = 'edit';
    await observe(() => nativePage.keyboard.press('Escape')); await observe(() => nativePage.keyboard.press('v'));
    const position = await observe(() => nativePage.evaluate(({ x, y }) => {
      const state = (window as unknown as { __pn: { api: { getAppState(): { scrollX: number; scrollY: number; offsetLeft: number; offsetTop: number; zoom: { value: number } } } } }).__pn.api.getAppState();
      return { x: (x + state.scrollX) * state.zoom.value + state.offsetLeft, y: (y + state.scrollY) * state.zoom.value + state.offsetTop };
    }, { x: step.x + step.width / 2, y: step.y + 3 }));
    const viewport = nativePage.viewportSize();
    if (!viewport || position.x < 0 || position.y < 0 || position.x >= viewport.width || position.y >= viewport.height) throw new RuntimeError('transfer_invalid', 'Named native rectangle is outside the measured viewport');
    await observe(() => nativePage.mouse.click(position.x, position.y));
    await observe(() => nativePage.waitForFunction(id => {
      const ids = (window as unknown as { __pn: { api: { getAppState(): { selectedElementIds: Record<string, boolean> } } } }).__pn.api.getAppState().selectedElementIds;
      return ids[id] === true && Object.keys(ids).filter(key => ids[key]).length === 1;
    }, input.stepId, { timeout: timeout() }));
    // Pinned constants.ts: ELEMENT_SHIFT_TRANSLATE_AMOUNT = 5. One native move, native finalization, then one Undo.
    await observe(() => nativePage.keyboard.press('Shift+ArrowRight'));
    await observe(() => nativePage.waitForFunction(({ id, x }) => (window as unknown as { __pn: { read(): Array<{ id: string; x: number }> } }).__pn.read().some(element => element.id === id && element.x === x), { id: input.stepId, x: step.x + 5 }, { timeout: timeout() }));
    const edited = await capture('02-edited');
    const moved = edited.state.objects[input.stepId];
    if (moved?.type !== 'step' || moved.x !== step.x + 5 || moved.y !== step.y) throw new RuntimeError('transfer_invalid', 'Native edit did not produce the preregistered visible 5-unit delta');
    assertNativeRectangleMove(opened.state, edited.state, input.stepId);
    stage = 'undo';
    await observe(() => nativePage.keyboard.press('Escape'));
    const finalized = await capture('02-finalized');
    assertNativeFinalizationPreserved(edited, finalized);
    await observe(() => nativePage.keyboard.press(`${modifier}+z`));
    await observe(() => nativePage.waitForFunction(({ id, x }) => (window as unknown as { __pn: { read(): Array<{ id: string; x: number }> } }).__pn.read().some(element => element.id === id && element.x === x), { id: input.stepId, x: step.x }, { timeout: timeout() }));
    const undone = await capture('03-undone'); assertNativeTransferPreserved(opened, undone);
    stage = 'save';
    // Existing full-editor menu -> JSON export disk button invokes native actionSaveFileToDisk.
    await observe(() => nativePage.getByTestId('main-menu-trigger').click({ timeout: timeout() }));
    await observe(() => nativePage.getByTestId('json-export-button').click({ timeout: timeout() }));
    const [download] = await observe(() => Promise.all([nativePage.waitForEvent('download', { timeout: timeout() }), nativePage.locator('.ExportDialog--json .Card-button').click({ timeout: timeout() })]));
    const savedPath = join(input.outputDirectory, 'native-saved.excalidraw');
    const stream = await observe(() => download.createReadStream());
    if (!stream) throw new RuntimeError('transfer_invalid', 'Native Save As download has no complete byte stream');
    await observe(() => pipeline(stream, createWriteStream(savedPath, { flags: 'wx', mode: 0o600 }), { signal: controller.signal }));
    if (await observe(() => download.failure())) throw new RuntimeError('transfer_invalid', 'Native Save As did not complete its file download');
    const saved = inspectNativeTransferFile(await observe(() => readFile(savedPath))); assertNativeTransferPreserved(opened, saved);
    await capture('04-after-save');
    requireAttempt();
    await observe(() => writeFile(join(input.outputDirectory, '04-saved-file.json'), JSON.stringify(saved, null, 2), { flag: 'wx', mode: 0o600, signal: controller.signal }));
    const result: NativeFileTransfer = { evidence: 'SCRIPTED_HEADLESS', visibleOsSighting: 'OPEN', inputPath: input.inputPath, savedPath,
      save: { method: 'native-menu-save-as-download', suggestedFilename: download.suggestedFilename() },
      snapshots: { before, opened, edited, undone, saved }, edit: { stepId: input.stepId, dx: 5, dy: 0 }, networkAttempts: adapter.networkAttempts() };
    if (result.networkAttempts.length) throw new RuntimeError('transfer_invalid', 'Native transfer attempted a nonlocal request');
    return result;
    } finally {
      // A late factory success must still dispose its own adapter before this run settles.
      if (adapter) {
        cleanupAttempted = true;
        try { await adapter.close(); } catch (error) { rememberCleanupError(error); }
      }
    }
  };
  const running = run();
  let result: NativeFileTransfer | undefined, primaryError: unknown, joinedError: unknown;
  try { result = await Promise.race([running, deadline]); }
  catch (error) { primaryError = error; controller.abort(); }
  // The factory settles on Abort itself. A refused browser API reply is never blindly joined.
  let runSettled = false;
  const settled = running.then(value => { runSettled = true; return value; }, error => { runSettled = true; throw error; });
  try { await bounded(settled, NATIVE_TRANSFER_SETTLEMENT_MS); } catch (error) {
    joinedError = error;
    if (error instanceof AdapterInitializationError) {
      factoryFailure = error; cleanupAttempted = true;
      if (error.cleanupError !== undefined) rememberCleanupError(error.cleanupError);
    }
    primaryError ??= error;
  }
  if (timer) clearTimeout(timer);
  if (primaryError instanceof AdapterInitializationError) primaryError = primaryError.primaryError;
  const networkAttempts = adapter?.networkAttempts() ?? factoryFailure?.networkAttempts ?? [];
  let resultFile: { sha256: string; bytes: number } | null = null;
  if (primaryError === undefined && cleanupErrors.length === 0 && result) {
    try {
      const bytes = Buffer.from(JSON.stringify({ status: 'candidate', requiresCompleteTerminalPair: true, result }, null, 2));
      await writeFile(join(input.outputDirectory, 'result.json'), bytes, { flag: 'wx', mode: 0o600 });
      resultFile = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    }
    catch (error) { primaryError = error; }
  }
  const terminal = { status: primaryError === undefined && cleanupErrors.length === 0 && result && runSettled && pendingNativeOperations === 0 ? 'succeeded' : 'failed',
    stage, deadlineExpired: expired, wallLimitMs: NATIVE_TRANSFER_WALL_MS, settlementLimitMs: NATIVE_TRANSFER_SETTLEMENT_MS,
    runSettled, pendingNativeOperations, pendingInitializationOperations: factoryFailure?.pendingInitializationOperations ?? 0,
    initializationAndRunJoined: runSettled && pendingNativeOperations === 0 && (factoryFailure?.pendingInitializationOperations ?? 0) === 0,
    resultFile,
    inputSha256: before.sha256, networkAttempts, primaryError: nativeTransferErrorEvidence(primaryError),
    joinedRunError: nativeTransferErrorEvidence(joinedError),
    console: pageConsole.evidence(),
    diagnostics: { beforeOpenScreenshot: beforeOpenScreenshotError === undefined ? null : nativeTransferErrorEvidence(beforeOpenScreenshotError) },
    cleanup: { attempted: cleanupAttempted, succeeded: cleanupAttempted && cleanupErrors.length === 0,
      errors: cleanupErrors.map(error => nativeTransferErrorEvidence(error)) } };
  await writeNativeTerminal(input.outputDirectory, terminal, primaryError, cleanupErrors);
  if (primaryError !== undefined) throw primaryError; // Cleanup cannot replace the original rejection.
  if (cleanupErrors.length) throw cleanupErrors[0];
  if (!result) throw new RuntimeError('transfer_invalid', 'Native transfer has no result');
  try { result.completion = await readNativeTransferCompletion(input.outputDirectory); }
  catch (error) { throw new NativeTransferPersistenceError(primaryError, cleanupErrors, error, terminal); }
  return result;
}

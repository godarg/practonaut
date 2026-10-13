import type { Browser, BrowserContext, Page } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { State, Failure } from '../../world/types.ts';
import { V2_ACTION_NAMES, isStepV2 } from '../../world/types.ts';
import type { StepV2 } from '../../world/types.ts';
import type { ApplicationAdapter, AdapterOptions, AdapterResult, Artifact, Transition } from '../types.ts';
import { validateState } from '../../world/schema.ts';
import { parseJsonEntry } from '../../package/json.ts';
import { RUNTIME_LIMITS } from '../../world/limits.ts';
import { toRaw, project, integrity } from './raw.ts';
import type { RawElement } from './raw.ts';
import { BROWSER_BOUNDS, bounded, closeBrowser as closeWithDeadline } from './bounded.ts';
import { launchChromium } from './chromium.ts';
/** The pinned Excalidraw release this adapter drives (package.json devDependency and engine bundle). */
export const EXCALIDRAW_APP_VERSION = '0.18.1';
export { renderCheck } from './render-check.ts';
export const EXCLUDED_ATTRIBUTES = {
  seed: 'App random seed; not semantic identity', versionNonce: 'Random app edit nonce', version: 'Edit counter', updated: 'App edit timestamp', index: 'App ordering key', points: 'Derived arrow geometry checked on exports', arrowGeometry: 'Derived from endpoint relations, independently render-checked', bindingFocusGap: 'Pointer-dependent focus and gap', textGeometry: 'Derived font layout, independently render-checked', wrappedText: 'Derived wrapping; originalText is content', frameGeometry: 'Adapter layout envelope; excluded from semantic comparison', boundElements: 'App cache, integrity-checked; UI stale cache reported as warning', style: 'Fixed adapter styling; edits outside this phase are unmodeled', selection: 'Transient UI selection'
};
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const failure = (code: Failure['code'], message: string): AdapterResult => ({ ok: false, error: { code, message, details: {} } });
function checkState(state: State): void {
  validateState(state);
  for (const object of Object.values(state.objects)) {
    if (object.type === 'step' && !isStepV2(object) && object.fontFamily !== 3) throw new Error('Only licensed Cascadia fontFamily 3 is supported');
    if (object.deleted) continue;
    // world/2 objects may stand outside any frame; a stated frame must exist.
    if (object.type !== 'frame' && (object.frameId === null ? !(object.type === 'arrow' || isStepV2(object)) : state.objects[object.frameId]?.type !== 'frame')) throw new Error('Missing frame');
    if (object.type === 'arrow') for (const id of [object.from, object.to]) if (id && (state.objects[id]?.type !== 'step' || state.objects[id]?.deleted)) throw new Error(`Missing binding target ${id}`);
  }
}
/** Adapter-side frame rule for arrows, written independently of the core's helper. */
function arrowFrame(state: State, from: string | null, to: string | null, current: string | null): string | null {
  const ends = [from, to].flatMap(end => end === null ? [] : [state.objects[end]]);
  const frames = ends.map(end => end?.type === 'step' ? end.frameId : null);
  if (!frames.length) return current;
  return frames.every(frame => frame === frames[0]) ? frames[0]! : null;
}
function actionPrediction(transition: Transition): State {
  const state = structuredClone(transition.before), p = transition.action.params;
  const id = String(p.id ?? ''), object = state.objects[id];
  const newObjects = Object.values(transition.after.objects).filter(e => !state.objects[e.id]);
  const liveV2 = (key: string): StepV2 => { const step = state.objects[String(p[key])]; if (step?.type !== 'step' || step.deleted || !isStepV2(step)) throw new Error('Missing world/2 step'); return step; };
  switch (transition.action.name) {
    case 'add_step': {
      const added = newObjects.find(e => e.type === 'step');
      if (!added) throw new Error('add_step requires a new semantic identity');
      if (Object.hasOwn(p, 'shape')) state.objects[added.id] = { id: added.id, type: 'step', deleted: false, frameId: p.frameId === null ? null : String(p.frameId), label: String(p.label), x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height), shape: String(p.shape) as StepV2['shape'], groupId: null, stroke: 'black', fill: 'none' };
      else state.objects[added.id] = { id: added.id, type: 'step', deleted: false, frameId: String(p.frameId), label: String(p.label), x: Number(p.x), y: Number(p.y), width: Number(p.width ?? 180), height: Number(p.height ?? 100), fontFamily: Number(p.fontFamily ?? 3) }; break;
    }
    case 'resize_step': { const step = liveV2('id'); step.width = Number(p.width); step.height = Number(p.height); break; }
    case 'set_style': { const step = liveV2('id'); step.shape = String(p.shape) as StepV2['shape']; step.stroke = String(p.stroke) as StepV2['stroke']; step.fill = String(p.fill) as StepV2['fill']; break; }
    case 'rename_frame': { if (object?.type !== 'frame' || object.deleted) throw new Error('Missing frame'); object.name = String(p.name); break; }
    case 'set_frame': { const step = liveV2('id'); const frame = p.frameId === null ? null : String(p.frameId); if (frame !== null && (state.objects[frame]?.type !== 'frame' || state.objects[frame]?.deleted)) throw new Error('Missing frame'); step.frameId = frame; break; }
    case 'group_steps': {
      const step = liveV2('id'), other = liveV2('with');
      if (step.id === other.id) throw new Error('Self grouping');
      // A new group's identity is the core's; it must be one id not used by any live step before.
      const group = other.groupId ?? (transition.after.objects[other.id] as StepV2 | undefined)?.groupId;
      if (!group || (other.groupId === null && Object.values(state.objects).some(o => o.type === 'step' && isStepV2(o) && o.groupId === group))) throw new Error('group_steps needs a fresh group identity');
      other.groupId = group; step.groupId = group; break;
    }
    case 'ungroup': {
      const step = liveV2('id'), group = step.groupId; if (group === null) throw new Error('Step is not grouped');
      for (const o of Object.values(state.objects)) if (o.type === 'step' && !o.deleted && isStepV2(o) && o.groupId === group) o.groupId = null; break;
    }
    case 'rename_step': if (object?.type !== 'step' || object.deleted) throw new Error('Missing step'); else object.label = String(p.label); break;
    case 'move_step': if (object?.type !== 'step' || object.deleted) throw new Error('Missing step'); else { object.x = Number(p.x); object.y = Number(p.y); } break;
    case 'connect': {
      const added = newObjects.find(e => e.type === 'arrow'); if (!added) throw new Error('connect requires new arrow identity');
      for (const end of [p.from, p.to]) { const step = state.objects[String(end)]; if (step?.type !== 'step' || step.deleted) throw new Error('Missing step'); }
      state.objects[added.id] = { id: added.id, type: 'arrow', deleted: false, frameId: Object.hasOwn(p, 'frameId') ? String(p.frameId) : null, from: String(p.from), to: String(p.to) }; break;
    }
    case 'reconnect_end': {
      if (object?.type !== 'arrow' || object.deleted || (p.end !== 'start' && p.end !== 'end')) throw new Error('Invalid arrow endpoint');
      object[p.end === 'start' ? 'from' : 'to'] = String(p.target); break;
    }
    case 'disconnect': { if (object?.type !== 'arrow' || object.deleted) throw new Error('Missing arrow'); object.deleted = true; object.from = null; object.to = null; break; }
    case 'delete_step': {
      if (object?.type !== 'step' || object.deleted) throw new Error('Missing step'); object.deleted = true;
      for (const e of Object.values(state.objects)) if (e.type === 'arrow' && !e.deleted) { if (e.from === id) e.from = null; if (e.to === id) e.to = null; } break;
    }
    default: throw new Error('unmodeled');
  }
  // Arrows follow their ends (a no-op for world/1, whose arrows share their steps' frame).
  for (const arrow of Object.values(state.objects)) if (arrow.type === 'arrow' && !arrow.deleted) arrow.frameId = arrowFrame(state, arrow.from, arrow.to, arrow.frameId);
  return state;
}
export const MAX_NATIVE_BYTES = 10 * 1024 * 1024;
export const MAX_ADAPTER_MS = 10_000;
export class AdapterError extends Error { readonly code: Failure['code']; constructor(code: Failure['code'], message: string) { super(message); this.code = code; } }
/** Preserve startup failure separately from disposal failure for the owning attempt. */
export class AdapterInitializationError extends AdapterError {
  readonly primaryError: unknown; readonly cleanupError: unknown; readonly networkAttempts: string[];
  readonly pendingInitializationOperations: number;
  constructor(primaryError: unknown, cleanupError: unknown, networkAttempts: string[], pendingInitializationOperations = 0) {
    super(primaryError instanceof AdapterError ? primaryError.code : String(primaryError).includes('cancelled') ? 'cancelled' : 'mirror_unavailable', 'Engine initialization failed');
    this.primaryError = primaryError; this.cleanupError = cleanupError; this.networkAttempts = [...networkAttempts];
    this.pendingInitializationOperations = pendingInitializationOperations;
    this.cause = primaryError;
  }
}
export interface ExcalidrawAdapter extends ApplicationAdapter {
  /** Test/conformance capability: select a real app object and press the real UI Delete key. */
  deleteStepViaUI(id: string): Promise<AdapterResult>;
  networkAttempts(): string[];
  /** Host-only resynchronisation, always checked against real engine read-back. */
  restoreState(state: State, options?: AdapterOptions): Promise<AdapterResult>;
  renderPng(): Promise<Uint8Array>;
  /** Cancel pending browser work before recovery; deliberately bypasses the write queue. */
  terminate(): Promise<void>;
}
/** Host-only real-process observation seam. Never exposed to the player or world package. */
export interface EngineLifecycleProbe {
  ready(browser: Browser, page: Page): void | Promise<void>;
}
export async function createExcalidrawAdapter(initialState: State, options: AdapterOptions = {}, probe?: EngineLifecycleProbe): Promise<ExcalidrawAdapter> {
  checkState(initialState);
  if (options.signal?.aborted) throw new Error('cancelled');
  const installed = fileURLToPath(new URL('./engine/', import.meta.url));
  const sourceFile = fileURLToPath(import.meta.url).endsWith('/src/adapters/excalidraw/index.ts');
  const root = sourceFile ? fileURLToPath(new URL('../../../.local/engine/', import.meta.url)) : installed;
  if (!existsSync(resolve(root, 'engine.js'))) throw new Error('Engine bundle missing: run npm run engine:build');
  const launchDeadline = performance.now() + BROWSER_BOUNDS.launch;
  const { chromium } = await bounded(import('playwright-core'), launchDeadline - performance.now());
  if (options.signal?.aborted) throw new AdapterError('cancelled', 'Engine initialization cancelled before launch');
  const { browser } = await launchChromium(chromium, () => ({ headless: true, timeout: Math.max(1, launchDeadline - performance.now()), handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }));
  const closeBrowser = (): Promise<void> => closeWithDeadline(browser);
  const denied: string[] = [];
  let context: BrowserContext, page: Page;
  // The browser belongs to this factory before a ready adapter exists. Capture precedes app work.
  let initializing = true, pendingInitializationOperations = 0;
  const requireInitialization = (): void => { if (options.signal?.aborted) throw new AdapterError('cancelled', 'Engine initialization cancelled'); };
  // Abort settles the owner even when the browser API reply never settles. Its loser remains observed.
  const initializationWait = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!initializing) return operation();
    requireInitialization();
    let cancel: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      cancel = () => reject(new AdapterError('cancelled', 'Engine initialization cancelled'));
      options.signal?.addEventListener('abort', cancel, { once: true });
    });
    pendingInitializationOperations++;
    const pending = Promise.resolve().then(() => { requireInitialization(); return operation(); }).then(
      value => { pendingInitializationOperations--; requireInitialization(); return value; },
      error => { pendingInitializationOperations--; throw error; });
    try { return await Promise.race([pending, aborted]); }
    finally { if (cancel) options.signal?.removeEventListener('abort', cancel); }
  };
  const html = '<!doctype html><html><head><link rel="stylesheet" href="/engine.css"><style>@font-face{font-family:Cascadia;src:url(/fonts/Cascadia/CascadiaCode-Regular.woff2)}html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script>window.EXCALIDRAW_ASSET_PATH="/"</script><script type="module" src="/engine.js"></script></body></html>';
  try {
    requireInitialization(); // Includes abort while launch/capture was pending.
    context = await initializationWait(() => bounded(browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' }), launchDeadline - performance.now()));
    requireInitialization();
    await initializationWait(() => context.route('**/*', async route => {
    if (options.signal?.aborted) { await route.abort(); return; }
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname);
    if (url.origin !== 'http://practonaut.invalid' || path.includes('..') || !/^\/[a-zA-Z0-9_./-]*$/.test(path)) { denied.push(url.href); await route.abort(); return; }
    if (path === '/') { await route.fulfill({ body: html, contentType: 'text/html' }); return; }
    try { const body = await readFile(resolve(root, '.' + path)); if (options.signal?.aborted) { await route.abort(); return; } await route.fulfill({ body, contentType: ({ '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' } as Record<string,string>)[extname(path)] ?? 'application/octet-stream' }); }
    catch { denied.push(url.href); await route.abort(); }
    }));
    requireInitialization();
    page = await initializationWait(() => bounded(context.newPage(), launchDeadline - performance.now()));
    requireInitialization();
  } catch (primaryError) {
    let cleanupError: unknown; try { await closeBrowser(); } catch (error) { cleanupError = error; }
    initializing = false;
    throw new AdapterInitializationError(primaryError, cleanupError, denied, pendingInitializationOperations);
  }
  const evaluate = async <T>(expression: string, input?: unknown): Promise<T> => initializationWait(() => page.evaluate(`(${expression})(${JSON.stringify(input ?? null)})`)) as Promise<T>;
  const raw = () => evaluate<RawElement[]>('() => window.__pn.read()');
  const write = (elements: RawElement[]) => evaluate<RawElement[]>('(els) => window.__pn.write(els)', elements);
  const startPage = async (elements: RawElement[]) => {
    await initializationWait(() => page.goto('http://practonaut.invalid/', { timeout: MAX_ADAPTER_MS }));
    await initializationWait(() => page.waitForFunction('window.__pn?.api', undefined, { timeout: Math.min(options.timeoutMs ?? MAX_ADAPTER_MS, MAX_ADAPTER_MS) }));
    await write(elements);
    if (denied.length) throw new AdapterError('mirror_unavailable', 'Engine made disallowed requests');
  };
  try {
    requireInitialization(); await startPage(toRaw(initialState)); requireInitialization();
    await initializationWait(() => Promise.resolve(probe?.ready(browser, page))); requireInitialization();
  } catch (primaryError) {
    let cleanupError: unknown; try { await closeBrowser(); } catch (error) { cleanupError = error; }
    throw new AdapterInitializationError(primaryError, cleanupError, denied, pendingInitializationOperations);
  } finally { initializing = false; }
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const promise = tail.then(fn, fn); tail = promise.catch(() => undefined); return promise; };
  const transaction = async (fn: () => Promise<AdapterResult>, opts: AdapterOptions = {}): Promise<AdapterResult> => {
    if (opts.signal?.aborted) return failure('cancelled', 'Operation cancelled before write');
    const beforeRaw = await raw();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('mirror_timeout')), Math.min(opts.timeoutMs ?? options.timeoutMs ?? MAX_ADAPTER_MS, MAX_ADAPTER_MS));
        cancel = () => reject(new Error('cancelled')); opts.signal?.addEventListener('abort', cancel, { once: true });
      });
      const result = await Promise.race([fn(), timeout]);
      if (!result.ok) await write(beforeRaw);
      return result;
    } catch (error) {
      // Closing the page cancels any pending JS write before restoring, so late writes cannot race rollback.
      await page.close(); page = await context.newPage(); await startPage(beforeRaw);
      return failure(String(error).includes('mirror_timeout') ? 'mirror_timeout' : String(error).includes('cancelled') ? 'cancelled' : 'integrity_failed', String(error));
    } finally { if (timer) clearTimeout(timer); if (cancel) opts.signal?.removeEventListener('abort', cancel); }
  };
  const uiDelete = async (id: string): Promise<AdapterResult> => {
    await page.locator('.excalidraw').first().click({ position: { x: 1450, y: 850 } });
    await evaluate('(id) => window.__pn.api.updateScene({appState:{selectedElementIds:{[id]:true}, selectedGroupIds:{}}})', id);
    await evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await page.keyboard.press('Delete');
    await evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const elements = await raw(), report = integrity(elements, false);
    if (report.errors.length) return failure('integrity_failed', report.errors.join('; '));
    return { ok: true, state: project(elements), warnings: report.warnings };
  };
  return {
    describe: () => ({ id: 'excalidraw', appVersion: EXCALIDRAW_APP_VERSION, adapterVersion: '1.0.0', capabilities: ['describe','snapshot','apply','exportArtifact','importArtifact'], fontFamilies: [3], excludedAttributes: EXCLUDED_ATTRIBUTES }),
    snapshot: () => serial(async () => project(await raw())),
    networkAttempts: () => [...denied],
    terminate: closeBrowser,
    restoreState: (state, opts) => serial(() => transaction(async () => {
      checkState(state);
      const elements = await write(toRaw(state));
      const report = integrity(elements, true);
      if (report.errors.length) return failure('integrity_failed', report.errors.join('; '));
      const actual = project(elements);
      if (!isDeepStrictEqual(actual, state)) return failure('real_tool_disagrees', 'Restore differs after engine read-back');
      if (denied.length) return failure('mirror_unavailable', 'Engine made disallowed requests');
      return { ok: true, state: actual, warnings: report.warnings };
    }, opts)),
    renderPng: () => serial(async () => {
      if (denied.length) throw new AdapterError('mirror_unavailable', 'Engine made disallowed requests');
      await evaluate('() => window.__pn.api.scrollToContent(window.__pn.read(), {fitToContent:true})');
      await evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      return new Uint8Array(await page.screenshot({ type: 'png', timeout: MAX_ADAPTER_MS }));
    }),
    deleteStepViaUI: id => serial(() => transaction(() => uiDelete(id))),
    apply: (transition, opts) => serial(() => transaction(async () => {
      if (!V2_ACTION_NAMES.includes(transition.action.name as typeof V2_ACTION_NAMES[number])) return failure('unmodeled', `Unmodeled action ${transition.action.name}`);
      if (!isDeepStrictEqual(project(await raw()), transition.before)) return failure('real_tool_disagrees', 'Adapter before state differs');
      const expected = actionPrediction(transition); checkState(expected);
      if (!isDeepStrictEqual(expected, transition.after)) return failure('real_tool_disagrees', 'Action parameters disagree with predicted state');
      const elements = await write(toRaw(expected, await raw()));
      const report = integrity(elements, true);
      if (report.errors.length) return failure('integrity_failed', report.errors.join('; '));
      const state = project(elements);
      if (denied.length) return failure('mirror_unavailable', 'Engine made disallowed requests');
      if (!isDeepStrictEqual(state, transition.after)) return failure('real_tool_disagrees', 'Real app read-back differs from predicted transition');
      return { ok: true, state, warnings: report.warnings };
    }, opts)),
    exportArtifact: (opts = {}) => serial(async () => {
      if (opts.signal?.aborted) throw new AdapterError('cancelled', 'Export cancelled before reading');
      const snapshot = await raw();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancel: (() => void) | undefined;
      try {
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AdapterError('mirror_timeout', 'Export time limit reached')), Math.min(opts.timeoutMs ?? options.timeoutMs ?? MAX_ADAPTER_MS, MAX_ADAPTER_MS));
          cancel = () => reject(new AdapterError('cancelled', 'Export cancelled')); opts.signal?.addEventListener('abort', cancel, { once: true });
        });
        return await Promise.race([(async (): Promise<Artifact> => {
      const elements = await raw();
      const native = JSON.stringify({ type: 'excalidraw', version: 2, source: 'practonaut', elements, appState: { viewBackgroundColor: '#ffffff' }, files: {} });
      const svg = await evaluate<string>('() => window.__pn.svg()');
      if (denied.length) throw new AdapterError('mirror_unavailable', 'Engine made disallowed requests');
      return { native, svg, nativeSha256: sha(native), svgSha256: sha(svg) };
        })(), deadline]);
      } catch (error) {
        await page.close(); page = await context.newPage(); await startPage(snapshot); throw error;
      } finally { if (timer) clearTimeout(timer); if (cancel) opts.signal?.removeEventListener('abort', cancel); }
    }),
    importArtifact: (native, opts) => serial(() => transaction(async () => {
      if (Buffer.byteLength(native) > MAX_NATIVE_BYTES) return failure('limit_exceeded', 'Artifact exceeds limit');
      const parsed = parseJsonEntry(Buffer.from(native), 'artifact.excalidraw', RUNTIME_LIMITS.maxJsonDepth);
      const stack: unknown[] = [parsed]; let nodes = 0;
      while (stack.length) { const value = stack.pop(); if (++nodes > RUNTIME_LIMITS.maxJsonNodes) return failure('limit_exceeded', 'Artifact node limit exceeded'); if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) return failure('artifact_invalid', 'Unsafe object key'); stack.push(child); } }
      const input = parsed as { type?: string; elements?: RawElement[]; files?: Record<string, unknown> };
      if (!input || input.type !== 'excalidraw' || !Array.isArray(input.elements)) return failure('artifact_invalid', 'Invalid native artifact');
      if (input.elements.length > RUNTIME_LIMITS.maxObjects * 2 || (input.files && Object.keys(input.files).length)) return failure('artifact_invalid', 'Embedded files or too many objects');
      const ids = new Set<string>();
      for (const element of input.elements) {
        if (!element || typeof element !== 'object' || typeof element.id !== 'string' || !element.id || ids.has(element.id) || !['frame', 'rectangle', 'arrow', 'text'].includes(element.type) || element.link || typeof element.isDeleted !== 'boolean' || !Array.isArray(element.boundElements)) return failure('artifact_invalid', 'Invalid, duplicate, linked or unmodeled native object');
        ids.add(element.id);
        if ([element.x, element.y, element.width, element.height].some(value => typeof value !== 'number' || !Number.isFinite(value))) return failure('artifact_invalid', 'Invalid native geometry');
        if (element.type === 'rectangle' && [element.x, element.y, element.width, element.height].some(value => !Number.isSafeInteger(value))) return failure('artifact_invalid', 'Step geometry must be integral');
        if (element.type === 'text' && typeof element.text === 'string' && typeof element.originalText === 'string' && element.text.replace(/\s/g, '') !== element.originalText.replace(/\s/g, '')) return failure('artifact_invalid', 'Original text and rendered text disagree');
        if (element.type === 'text' && (!element.containerId || element.fontFamily !== 3 || typeof element.originalText !== 'string' || element.originalText.length > RUNTIME_LIMITS.maxText)) return failure('artifact_invalid', 'Invalid text or unsupported font');
        if (element.type === 'rectangle' && input.elements.filter(text => text.type === 'text' && text.containerId === element.id).length !== 1) return failure('artifact_invalid', 'Step must have exactly one bound text');
      }
      const report = integrity(input.elements, false);
      if (report.errors.length) return failure('integrity_failed', report.errors.join('; '));
      const expected = project(input.elements); checkState(expected);
      const actual = project(await write(toRaw(expected, input.elements)));
      if (!isDeepStrictEqual(actual, expected)) return failure('real_tool_disagrees', 'Import differs after real engine restoration');
      return { ok: true, state: actual, warnings: report.warnings };
    }, opts)),
    close: closeBrowser
  };
}

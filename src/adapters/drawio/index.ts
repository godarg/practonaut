/**
 * The draw.io adapter (PADR-0049). It drives the pinned, unmodified draw.io release in the shared
 * browser shell, writes and reads only through the documented embed JSON protocol, and refuses every
 * write it cannot confirm.
 *
 * - The app is served from the verified archive held in memory, only from the allowlist; the shell's
 *   network boundary refuses and records everything else (decision 3).
 * - Chromium starts only with its sandbox (decision 7).
 * - Every transaction compares the app's state with the transition's before state, computes its own
 *   prediction, writes with `load`, reads back with `export`, and requires the declared set, the full
 *   write check and integrity (decision 4.2). The `load` event is never taken as proof.
 * - The derived memory (empty frames' boxes, loose ends' points) is reset at start, `restoreState` and
 *   recovery (decision 5.1).
 */
import { isDeepStrictEqual } from 'node:util';
import { extname } from 'node:path';
import type { Failure, State } from '../../world/types.ts';
import { V2_ACTION_NAMES, isStepV2 } from '../../world/types.ts';
import { validateState } from '../../world/schema.ts';
import { constraintViolation } from '../../world/constraints.ts';
import { structuralConstraintsOf } from '../../world/apps.ts';
import type { AdapterOptions, AdapterResult, Artifact, MirrorAdapter } from '../types.ts';
import type { LaunchContext } from '../browser/chromium.ts';
import { AdapterError, AppRuntimeFault, MAX_ADAPTER_MS, artifactOf, operationMs, serialQueue, startShell, type BrowserShell, type ChromiumLike, type EngineLifecycleProbe, type Fulfilment, type OperationLimits, type SceneIO } from '../browser/shell.ts';
import { actionPrediction } from '../prediction.ts';
import { openDrawioArchive } from './archive.ts';
import { APP_ORIGIN, HOST_ORIGIN, hostPage } from './host-page.ts';
import { DRAWIO_ALLOWLIST, DRAWIO_PIN, DRAWIO_URL_PARAMETERS } from './pin.ts';
import { readBack, writeCheck } from './readback.ts';
import { DrawioRuntimeError, drawioRuntimePath, readDrawioRuntime } from './runtime.ts';
import { cloneMemory, freshMemory, LAYER, modelXml, ROOT, writeCells, type WriterMemory, type XmlNode } from './writer.ts';

export { DRAWIO_PIN } from './pin.ts';
export const DRAWIO_APP_VERSION = DRAWIO_PIN.version;
export const EXCLUDED_ATTRIBUTES = Object.freeze({
  frameGeometry: 'Adapter-computed envelope of the frame\'s steps; excluded from the declared set',
  groupGeometry: 'Adapter-computed envelope of the group\'s members; excluded from the declared set',
  edgePoints: 'Waypoints and terminal points are derived',
  labelGeometry: 'draw.io renders labels in the system font; rendering depends on the platform',
  zOrder: 'Cell order is presentation',
  style: 'Style keys outside the mapping are refused, not judged',
  fileMetadata: 'The diagram id is random, host and view attributes are the app\'s own',
});
/** The longest PNG the adapter accepts from the app. */
export const MAX_PNG_BYTES = 10 * 1024 * 1024;
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.json': 'application/json', '.xml': 'application/xml' });

/** Test and conformance seams; the product passes none. */
export interface DrawioSeams { runtimePath?: string; chromium?: ChromiumLike; launchContext?: LaunchContext; launchMs?: number; initializeMs?: number }
export interface DrawioAdapter extends MirrorAdapter {
  /** Conformance only: loads hand-written XML through the protocol and runs the same checks against
   * `expected` cells (default: the cells in that XML). Never reachable from the host or a world. */
  conformanceWrite(xml: string, expected: XmlNode[]): Promise<{ issues: string[]; state: State; exported: string }>;
}

const failure = (code: Failure['code'], message: string): AdapterResult => ({ ok: false, error: { code, message, details: {} } });
const live = (state: State): State['objects'] => Object.fromEntries(Object.entries(state.objects).filter(([, object]) => !object.deleted));
const sameLive = (a: State, b: State): boolean => isDeepStrictEqual(live(a), live(b));
function checkState(state: State): void {
  validateState(state, 2);
  for (const object of Object.values(state.objects)) if (object.type === 'step' && !isStepV2(object)) throw new AdapterError('unmodeled', 'draw.io holds world/2 steps only');
}
interface Scene { xml: string; memory: WriterMemory }
const dataUri = (value: unknown, type: string): Buffer => {
  const text = String(value ?? ''), prefix = `data:${type};base64,`;
  if (!text.startsWith(prefix)) throw new AdapterError('integrity_failed', `the app's ${type} export is not a base64 data URI`);
  return Buffer.from(text.slice(prefix.length), 'base64');
};

export async function createDrawioAdapter(initialState: State, options: AdapterOptions = {}, probe?: EngineLifecycleProbe, seams: DrawioSeams = {}): Promise<DrawioAdapter> {
  checkState(initialState);
  if (options.signal?.aborted) throw new AdapterError('cancelled', 'Engine initialization cancelled');
  // The whole archive is read, hashed and opened in memory before anything starts (decision 2.6); a
  // runtime that fails here is the mirror unavailable, carrying the runtime's own code.
  const archive = await (async () => openDrawioArchive(await readDrawioRuntime(seams.runtimePath ?? drawioRuntimePath()), DRAWIO_ALLOWLIST))().catch((error: unknown) => {
    throw error instanceof DrawioRuntimeError ? new AppRuntimeFault('drawio', error.code, error.message) : error;
  });
  const page = hostPage(DRAWIO_URL_PARAMETERS);
  const serveApp = async (path: string): Promise<Fulfilment | undefined> => {
    const name = path.slice(1), type = CONTENT_TYPES[extname(name).toLowerCase()];
    if (!archive.serves(name) || type === undefined) return undefined;
    return { body: await archive.read(name), contentType: type };
  };
  const serveHost = async (path: string): Promise<Fulfilment | undefined> => path === '/' ? { body: page, contentType: 'text/html' } : undefined;
  let shell: BrowserShell | undefined, memory = freshMemory();
  const current = (): BrowserShell => shell!;
  const limit = (opts: AdapterOptions = {}): number => operationMs(opts.timeoutMs, options.timeoutMs);
  const request = async <T,>(message: Record<string, unknown>, event: string): Promise<T> =>
    current().wait(() => current().page.evaluate(([m, e, t]) => (window as unknown as { __pn: { send(m: unknown, e: string, t: number): Promise<unknown> } }).__pn.send(m, e, t), [message, event, limit()] as const)) as Promise<T>;
  const exportXml = async (): Promise<string> => {
    const reply = await request<{ xml?: unknown }>({ action: 'export', format: 'xml' }, 'export');
    if (typeof reply.xml !== 'string') throw new AdapterError('integrity_failed', 'the app exported no XML');
    return reply.xml;
  };
  const cellsOf = async (xml: string): Promise<{ cells: XmlNode[] } | { error: string }> =>
    current().wait(() => current().page.evaluate(x => (window as unknown as { __pn: { cells(x: string): unknown } }).__pn.cells(x), xml)) as Promise<{ cells: XmlNode[] } | { error: string }>;
  const load = async (xml: string): Promise<void> => { await request({ action: 'load', xml }, 'load'); };
  const disallowed = (): boolean => current().networkAttempts().length > 0;
  /** The app's current state, from its export, with the integrity check. */
  const readCurrent = async (): Promise<{ state: State; issues: string[]; exported: string }> => {
    const exported = await exportXml(), parsed = await cellsOf(exported);
    if ('error' in parsed) return { state: { objects: {} }, issues: [`the export does not parse (${parsed.error})`], exported };
    const result = readBack(parsed.cells);
    return { ...result, exported };
  };
  /** Writes `expected` cells (or hand-written XML) and runs every check on what comes back. */
  const writeAndCheck = async (cells: XmlNode[], xml: string = modelXml(cells)): Promise<{ state: State; issues: string[]; exported: string }> => {
    await load(xml);
    const exported = await exportXml(), parsed = await cellsOf(exported);
    if ('error' in parsed) return { state: { objects: {} }, issues: [`the export does not parse (${parsed.error})`], exported };
    const result = readBack(parsed.cells);
    return { state: result.state, issues: [...writeCheck(cells, parsed.cells), ...result.issues], exported };
  };
  const startPage = async (): Promise<void> => {
    await current().wait(() => current().page.goto(`${HOST_ORIGIN}/`, { timeout: MAX_ADAPTER_MS }));
    await current().wait(() => current().page.waitForFunction('window.__pn && window.__pn.ready === true', undefined, { timeout: 30_000, polling: 10 }));
  };
  const writeState = async (state: State): Promise<{ state: State; issues: string[] }> => writeAndCheck(writeCells(state, memory));
  const scene: SceneIO<Scene> = {
    read: async () => ({ xml: await exportXml(), memory: cloneMemory(memory) }),
    write: async saved => { memory = cloneMemory(saved.memory); await load(saved.xml); },
    load: async saved => { await startPage(); memory = cloneMemory(saved.memory); await load(saved.xml); },
  };
  const ready = await startShell({ signal: options.signal, origins: { [HOST_ORIGIN]: serveHost, [APP_ORIGIN]: serveApp }, sandbox: 'required', ...(seams.chromium ? { chromium: seams.chromium } : {}), ...(seams.launchContext ? { launchContext: seams.launchContext } : {}), ...(seams.launchMs ? { launchMs: seams.launchMs } : {}), ...(seams.initializeMs ? { initializeMs: seams.initializeMs } : {}) }, async started => {
    shell = started;
    await startPage();
    memory = freshMemory();
    const result = await writeState(initialState);
    if (result.issues.length) throw new AdapterError('integrity_failed', `the first scene did not come back intact: ${result.issues[0]}`);
    if (!sameLive(result.state, initialState)) throw new AdapterError('real_tool_disagrees', 'the first scene differs after read-back');
    if (disallowed()) throw new AdapterError('mirror_unavailable', 'The app made disallowed requests');
    await started.wait(() => Promise.resolve(probe?.ready(started.browser, started.page)));
  });
  shell = ready;
  const serial = serialQueue();
  const limits = (opts: AdapterOptions = {}): OperationLimits => ({ timeoutMs: limit(opts), signal: opts.signal });
  const transaction = (fn: () => Promise<AdapterResult>, opts: AdapterOptions = {}): Promise<AdapterResult> => ready.transaction(fn, scene, limits(opts));
  const confirmed = (result: { state: State; issues: string[] }, expected: State): AdapterResult => {
    if (result.issues.length) return failure('integrity_failed', result.issues.join('; '));
    if (disallowed()) return failure('mirror_unavailable', 'The app made disallowed requests');
    if (!sameLive(result.state, expected)) return failure('real_tool_disagrees', 'Real app read-back differs from the predicted state');
    return { ok: true, state: result.state, warnings: [] };
  };
  const refusedByConstraint = (state: State): AdapterResult | undefined => {
    const violation = constraintViolation(state, structuralConstraintsOf('drawio'));
    return violation ? { ok: false, error: { code: 'constraint_refused', message: violation.message, details: { constraint: violation.constraint } } } : undefined;
  };
  return {
    describe: () => ({ id: 'drawio', appVersion: DRAWIO_PIN.version as never, adapterVersion: '1.0.0', capabilities: ['describe', 'snapshot', 'apply', 'exportArtifact'], fontFamilies: [], excludedAttributes: { ...EXCLUDED_ATTRIBUTES } }),
    snapshot: () => serial(async () => {
      const result = await readCurrent();
      if (result.issues.length) throw new AdapterError('integrity_failed', result.issues.join('; '));
      return result.state;
    }),
    networkAttempts: () => ready.networkAttempts(),
    terminate: () => ready.close(),
    restoreState: (state, opts) => serial(() => transaction(async () => {
      checkState(state);
      const refused = refusedByConstraint(state);
      if (refused) return refused;
      memory = freshMemory();
      return confirmed(await writeState(state), state);
    }, opts)),
    apply: (transition, opts) => serial(() => transaction(async () => {
      if (!V2_ACTION_NAMES.includes(transition.action.name as typeof V2_ACTION_NAMES[number])) return failure('unmodeled', `Unmodeled action ${transition.action.name}`);
      const before = await readCurrent();
      if (before.issues.length) return failure('integrity_failed', before.issues.join('; '));
      if (!sameLive(before.state, transition.before)) return failure('real_tool_disagrees', 'Adapter before state differs');
      const expected = actionPrediction(transition); checkState(expected);
      if (!isDeepStrictEqual(expected, transition.after)) return failure('real_tool_disagrees', 'Action parameters disagree with the predicted state');
      const refused = refusedByConstraint(expected);
      if (refused) return refused;
      return confirmed(await writeState(expected), transition.after);
    }, opts)),
    renderPng: () => serial(async () => {
      if (disallowed()) throw new AdapterError('mirror_unavailable', 'The app made disallowed requests');
      const reply = await request<{ data?: unknown }>({ action: 'export', format: 'png' }, 'export');
      const png = dataUri(reply.data, 'image/png');
      if (png.length > MAX_PNG_BYTES || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AdapterError('integrity_failed', 'the app\'s PNG export is not a bounded PNG');
      return new Uint8Array(png);
    }),
    exportArtifact: (opts = {}) => serial(async () => {
      if (opts.signal?.aborted) throw new AdapterError('cancelled', 'Export cancelled before reading');
      return ready.guarded(async (): Promise<Artifact> => {
        const native = await exportXml();
        const reply = await request<{ data?: unknown }>({ action: 'export', format: 'svg' }, 'export');
        const svg = dataUri(reply.data, 'image/svg+xml').toString('utf8');
        if (disallowed()) throw new AdapterError('mirror_unavailable', 'The app made disallowed requests');
        return artifactOf(native, svg);
      }, scene, limits(opts), { timeout: () => new AdapterError('mirror_timeout', 'Export time limit reached'), cancel: () => new AdapterError('cancelled', 'Export cancelled') });
    }),
    // Loading a foreign file into the app is artifact mode's decision (PADR-0049 decision 4.5).
    importArtifact: async () => failure('unmodeled', 'The draw.io adapter does not import files'),
    conformanceWrite: (xml, expected) => serial(() => writeAndCheck(expected, xml)),
    close: () => ready.close(),
  };
}

export { ROOT, LAYER };

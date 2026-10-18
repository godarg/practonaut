import { cliText, getCliLanguage } from './messages.ts';
import { readableText, safeText } from './output.ts';
import { substituteTokens, variantIndex, variantTokens } from '../world/variant.ts';
import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { libraryTaskId, LIBRARY_WORLD_DIR } from '../library/index.ts';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { packWorld, readWorldPackage, readWorldPackageFile } from '../package/index.ts';
import { loadWorldPackage } from '../world/index.ts';
import { RuntimeError } from './runtime.ts';
import { chromiumCheck } from './doctor.ts';
import { headlessShellDownload } from './chromium-download.ts';
import { browserAdvice, chromiumStarts, launchFailureDetail, type StartResult } from './browser-start.ts';
import { chromiumSandboxFallbackActive } from '../adapters/browser/chromium.ts';
import { AdapterError, AdapterInitializationError } from '../adapters/browser/shell.ts';
import { ADAPTER_REGISTRY, resolveAdapter, type AdapterRegistration, type AdapterRegistry, type RuntimeStatus } from '../adapters/registry.ts';
import type { AdapterSandboxPolicy } from '../adapters/browser/chromium.ts';
import { appRuntimeFailure, appRuntimeMessage, appValues } from './app-runtime.ts';
import { openInBrowser, writePreferredLauncher } from './open-browser.ts';
import { HOST_LIMITS } from '../host/limits.ts';
import { startHost } from '../host/server.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import type { MirrorMode, ModelOnlyNotice, RunningHost } from '../host/protocol.ts';
import { invocationName } from './invocation.ts';
import type { World } from '../world/types.ts';
import { appDisplayName } from '../world/apps.ts';
import { inlineOptionValues } from './options.ts';

export type MirrorChoice = MirrorMode | 'auto';
/** The world that ships with the package; `practonaut` and `practonaut play` start it. */
export const BUNDLED_WORLD = fileURLToPath(new URL('../../examples/worlds/flow-diagram/', import.meta.url));

export interface ServeArguments { source: string; seed: number; taskId?: string; mirror: MirrorChoice; open: boolean; requireOffline: boolean; checks?: number }
/** `--checks <n>`: checks allowed per attempt, 0 … 1000 (a task's own limit can only be lowered). */
export function checksOption(value: string): number {
  if (!/^\d{1,4}$/.test(value) || Number(value) > 1000) throw new RuntimeError('usage', cliText('checksUsage'));
  return Number(value);
}
export function parseServeArguments(given: string[]): ServeArguments {
  const args = inlineOptionValues(given, ['--seed', '--task', '--mirror', '--checks']);
  let source: string | undefined; let seed = 42; let taskId: string | undefined; let checks: number | undefined;
  let mirror: MirrorChoice = 'auto'; let requireOffline = false; let open = true;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--require-offline' || arg === '--no-open') {
      if (seen.has(arg)) throw new RuntimeError('usage', cliText('optionDuplicate', { option: arg }));
      seen.add(arg); if (arg === '--no-open') open = false; else requireOffline = true;
    } else if (['--seed', '--task', '--mirror', '--checks'].includes(arg)) {
      if (seen.has(arg)) throw new RuntimeError('usage', cliText('optionDuplicate', { option: arg }));
      seen.add(arg); const value = args[++i];
      if (!value || value.startsWith('--')) throw new RuntimeError('usage', cliText('optionValue', { option: arg }));
      if (arg === '--seed') {
        if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new RuntimeError('usage', cliText('seedUsage'));
        seed = Number(value);
      } else if (arg === '--task') taskId = value;
      else if (arg === '--checks') checks = checksOption(value);
      else {
        if (value !== 'auto' && value !== 'required' && value !== 'off') throw new RuntimeError('usage', cliText('mirrorUsage'));
        mirror = value;
      }
    } else if (arg.startsWith('--')) throw new RuntimeError('usage', cliText('optionUnknown', { option: arg }));
    else if (source !== undefined) throw new RuntimeError('usage', cliText('serveUsage'));
    else source = arg;
  }
  return { source: source ?? BUNDLED_WORLD, seed, mirror, open, requireOffline, ...(taskId ? { taskId } : {}), ...(checks !== undefined ? { checks } : {}) };
}

/** `sandbox: false` marks a mirror whose Chromium runs without its sandbox (Linux fallback, PADR-0032).
 * `app-missing` and `app-unverified` name a downloaded app runtime that is absent or does not match its
 * pin (PADR-0049 decision 1.3). `app` is the adapter whose mirror was resolved; every text about the
 * mirror names that app by its display name (decision 1.5). */
export interface MirrorResolution { mode: MirrorMode; fallback: boolean; reason?: 'missing' | 'start' | 'app-missing' | 'app-unverified'; detail?: string; sandbox?: boolean; app?: string }
export interface MirrorProbes {
  installed(): Promise<boolean>;
  starts(policy?: AdapterSandboxPolicy): Promise<StartResult>;
  /** A downloaded runtime's check under the data home; absent probes use the registry's own. */
  runtime?(registration: AdapterRegistration): Promise<RuntimeStatus>;
}
const defaultProbes: MirrorProbes = { installed: async () => (await chromiumCheck(false)).ok, starts: policy => chromiumStarts(undefined, policy) };
/** The world's adapter and what its mirror needs; Excalidraw when a caller names no world. */
export type MirrorApp = Pick<World, 'app' | 'schema'>;
const EXCALIDRAW_WORLD: MirrorApp = { app: { adapterId: 'excalidraw', versionRange: '0.18.1', fontFamilies: [3], excludedAttributes: {} }, schema: 'practonaut.world/2' };
/** The fixed display name of an adapter's app in the CLI's language (PADR-0049 decision 1.5). */
const appName = (adapterId: string): string => appDisplayName(adapterId, getCliLanguage());

/**
 * `auto` mirrors when the Playwright Chromium is installed and actually starts, and otherwise runs
 * model-only with a message saying why. `required` refuses with a named error instead:
 * `browser_runtime_missing` (not installed) or `browser_start_failed` (installed, does not start).
 */
export async function resolveMirror(choice: MirrorChoice, probes: MirrorProbes = defaultProbes, world: MirrorApp = EXCALIDRAW_WORLD, registry: AdapterRegistry = ADAPTER_REGISTRY): Promise<MirrorResolution> {
  if (choice === 'off') return { mode: 'off', fallback: false };
  const registration = resolveAdapter(world.app, world.schema, registry);
  // A downloaded runtime is checked first, before any browser check or start (PADR-0049 decision 1.3).
  if (registration.runtime === 'downloaded') {
    const status = await (probes.runtime ? probes.runtime(registration) : registration.runtimeStatus!((await resolvedDataPaths()).home));
    if (!status.ok) {
      if (choice === 'required') throw new RuntimeError(status.code, appRuntimeMessage(registration, status));
      return { mode: 'off', fallback: true, reason: status.code === 'app_runtime_missing' ? 'app-missing' : 'app-unverified', detail: status.detail, app: registration.id };
    }
  }
  const app = appName(registration.id);
  if (!await probes.installed()) {
    if (choice === 'required') throw new RuntimeError('browser_runtime_missing', cliText('browserRuntimeMissing', { ...headlessShellDownload(), app }));
    return { mode: 'off', fallback: true, reason: 'missing', app: registration.id };
  }
  // Started under the adapter's sandbox policy: draw.io never without the sandbox (PADR-0049 decision 7).
  const started = await probes.starts(registration.sandbox);
  if (!started.ok) {
    if (choice === 'required') throw new RuntimeError('browser_start_failed', cliText('browserStartFailed', { app, detail: started.detail, advice: browserAdvice() }));
    return { mode: 'off', fallback: true, reason: 'start', detail: started.detail, app: registration.id };
  }
  return { mode: 'required', fallback: false, sandbox: started.sandbox, app: registration.id };
}

/** The stderr notice for a model-only fallback. */
export function fallbackNotice(mirror: MirrorResolution, registry: AdapterRegistry = ADAPTER_REGISTRY): string {
  if (!mirror.fallback) return mirror.mode === 'required' && mirror.sandbox === false ? cliText('sandboxFallbackNotice') : '';
  const registration = mirror.app !== undefined && Object.hasOwn(registry, mirror.app) ? registry[mirror.app]! : undefined;
  if (registration && mirror.reason === 'app-missing') return cliText('mirrorAppFallback', appValues(registration));
  if (registration && mirror.reason === 'app-unverified') return cliText('mirrorAppUnverifiedFallback', { ...appValues(registration), detail: safeText(mirror.detail ?? '') });
  const app = appName(mirror.app ?? EXCALIDRAW_WORLD.app.adapterId);
  return mirror.reason === 'start' ? cliText('mirrorStartFallback', { app, detail: mirror.detail ?? 'unknown error', advice: browserAdvice() }) : cliText('mirrorFallback', { ...headlessShellDownload(), app });
}

/**
 * Starts the host with the resolved mirror. The probe launched Chromium a moment ago, but the
 * mirror's own start can still fail (a crash, a resource limit): under `auto` the session then runs
 * model-only with the same notice; under `required` it is the named `browser_start_failed` error.
 * A downloaded app runtime that the adapter's own start finds absent or changed is reported by the
 * runtime's code instead (`app_runtime_missing`, `app_runtime_unverified`; PADR-0049 decision 2.6).
 */
export async function startHostWithMirror(choice: MirrorChoice, resolved: MirrorResolution, start: (mode: MirrorMode, notice: ModelOnlyNotice | undefined) => Promise<RunningHost>, registry: AdapterRegistry = ADAPTER_REGISTRY): Promise<{ host: RunningHost; mirror: MirrorResolution }> {
  if (resolved.mode === 'off') return { host: await start('off', modelOnlyNotice(choice, resolved, registry)), mirror: resolved };
  // The mirror's own start may be the first one that needed the Linux sandbox fallback.
  try { const host = await start('required', undefined); return { host, mirror: chromiumSandboxFallbackActive() ? { ...resolved, sandbox: false } : resolved }; }
  catch (error) {
    if (!(error instanceof AdapterError)) throw error;
    const runtime = appRuntimeFailure(error, registry);
    if (runtime) {
      if (choice === 'required') throw new RuntimeError(runtime.code, runtime.message);
      const mirror: MirrorResolution = { mode: 'off', fallback: true, reason: runtime.code === 'app_runtime_missing' ? 'app-missing' : 'app-unverified', detail: (error instanceof AdapterInitializationError ? error.primaryError as Error : error).message, app: runtime.registration.id };
      return { host: await start('off', modelOnlyNotice(choice, mirror, registry)), mirror };
    }
    const detail = launchFailureDetail(error instanceof AdapterInitializationError ? error.primaryError : error);
    if (choice === 'required') throw new RuntimeError('browser_start_failed', cliText('browserStartFailed', { app: appName(resolved.app ?? EXCALIDRAW_WORLD.app.adapterId), detail, advice: browserAdvice() }));
    const mirror: MirrorResolution = { mode: 'off', fallback: true, reason: 'start', detail, ...(resolved.app !== undefined ? { app: resolved.app } : {}) };
    return { host: await start('off', modelOnlyNotice(choice, mirror, registry)), mirror };
  }
}

/** What the Player's banner says about a model-only session and how to get the real engine: the
 * download (`setup`, named with its size), a check of a Chromium that did not start, or the switch
 * that was chosen. Suggested commands are in the form the user started the CLI. */
export function modelOnlyNotice(choice: MirrorChoice, mirror: MirrorResolution, registry: AdapterRegistry = ADAPTER_REGISTRY): ModelOnlyNotice | undefined {
  if (mirror.mode !== 'off') return undefined;
  if (choice === 'off') return { reason: 'off' };
  if (mirror.reason === 'start') return { reason: 'start', command: `${invocationName()} doctor --adapter` };
  // A downloaded app runtime that is absent or damaged: its own setup option and download size.
  const registration = mirror.app !== undefined && Object.hasOwn(registry, mirror.app) ? registry[mirror.app]! : undefined;
  if (registration?.download && (mirror.reason === 'app-missing' || mirror.reason === 'app-unverified')) return { reason: 'missing', command: `${invocationName()} setup --app ${registration.id}`, download: { name: registration.download.name, megabytes: Math.round(registration.download.bytes / 1_000_000) } };
  const download = headlessShellDownload();
  return { reason: 'missing', command: `${invocationName()} setup`, download: { name: download.name, megabytes: download.size } };
}

async function loadSource(source: string, registry: AdapterRegistry = ADAPTER_REGISTRY): Promise<World> {
  const input = await stat(source).catch(() => { throw new RuntimeError('usage', cliText('worldMissing', { path: source })); });
  const world = loadWorldPackage(input.isDirectory() ? await readWorldPackage(await packWorld(source)) : await readWorldPackageFile(source));
  // The world's app needs an adapter in the registry; refused by name before any browser check or
  // start (PADR-0045). `play`, `serve` and `mcp --task` load their world here.
  resolveAdapter(world.app, world.schema, registry);
  return world;
}

/** A world path (directory or package) or a library task (`excalidraw/<id>` or `<id>`); an existing path wins.
 * Returns the loaded world and the task to open (the explicit task, the library task or the world's first). */
export async function resolvePracticeSource(source: string, taskId?: string, registry: AdapterRegistry = ADAPTER_REGISTRY): Promise<{ world: World; taskId: string; library: boolean }> {
  const libraryTask = source !== BUNDLED_WORLD && !existsSync(source) ? libraryTaskId(source) : undefined;
  if (libraryTask !== undefined) {
    if (taskId !== undefined) throw new RuntimeError('usage', cliText('playTaskConflict'));
    return { world: await loadSource(LIBRARY_WORLD_DIR, registry), taskId: libraryTask, library: true };
  }
  const world = await loadSource(source, registry);
  if (taskId !== undefined && !world.tasks.some(task => task.id === taskId)) throw new RuntimeError('task_unknown', cliText('taskUnknown', { id: taskId }));
  return { world, taskId: taskId ?? world.tasks[0]!.id, library: false };
}

/** Runs one local session until Ctrl+C (or SIGTERM/SIGHUP). The browser is the user's own. */
export async function commandServe(args: string[], registry: AdapterRegistry = ADAPTER_REGISTRY): Promise<number> {
  const options = parseServeArguments(args);
  // A library task id (`connect` or `excalidraw/connect`) opens the bundled library on that task;
  // an existing path always wins.
  const libraryTask = options.source !== BUNDLED_WORLD && !existsSync(options.source) ? libraryTaskId(options.source) : undefined;
  if (libraryTask !== undefined) {
    if (options.taskId) throw new RuntimeError('usage', cliText('playTaskConflict'));
    options.taskId = libraryTask; options.source = LIBRARY_WORLD_DIR;
  }
  const world = await loadSource(options.source, registry);
  const paths = await resolvedDataPaths();
  // Only the example that ships with the package offers the demonstration (never a library task).
  const demonstration = options.source === BUNDLED_WORLD;
  const { host, mirror } = await startHostWithMirror(options.mirror, await resolveMirror(options.mirror, undefined, world, registry), (mode, notice) =>
    startHost(world, { seed: options.seed, mirror: mode, requireOffline: options.requireOffline, phase3: true, tokenDirectory: paths.host, localDirectory: paths.home, demonstration, ...(notice ? { modelOnly: notice } : {}), ...(options.taskId ? { taskId: options.taskId } : {}), ...(options.checks !== undefined ? { checks: options.checks } : {}) }), registry);
  process.stderr.write(fallbackNotice(mirror, registry));
  // At most one private launcher file exists; it is removed with its code's lifetime or at exit.
  let launcher: Awaited<ReturnType<typeof writePreferredLauncher>> | undefined; let launcherTimer: ReturnType<typeof setTimeout> | undefined;
  const dropLauncher = async (): Promise<void> => { clearTimeout(launcherTimer); const old = launcher; launcher = undefined; await old?.remove().catch(() => {}); };
  const open = async (url: string): Promise<void> => {
    if (!options.open) return;
    await dropLauncher();
    try { launcher = await writePreferredLauncher(paths.host, url); } catch { process.stderr.write(cliText('openFailed', { url })); return; }
    launcherTimer = setTimeout(() => { void dropLauncher(); }, HOST_LIMITS.bootstrapTtlMs); launcherTimer.unref();
    // Whether the browser could read the file cannot be seen from here; the link is always repeated.
    process.stderr.write(await openInBrowser(launcher.path) ? cliText('openStarted', { url }) : cliText('openFailed', { url }));
  };
  return await new Promise<number>(resolveExit => {
    let stopping = false;
    const lines = createInterface({ input: process.stdin, terminal: false });
    lines.on('line', line => {
      if (stopping || line.trim().toLowerCase() !== 'o') return;
      let url: string;
      try { url = host.issueUrl(); } catch { process.stderr.write(cliText('linkBudget')); return; }
      process.stdout.write(cliText('hostLink', { url }));
      void open(url);
    });
    const stop = (): void => {
      if (stopping) return; stopping = true;
      lines.close();
      for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(name, stop);
      dropLauncher().then(() => host.close()).then(() => resolveExit(0), () => { process.stderr.write(cliText('closeFailed')); resolveExit(3); });
    };
    for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(name, stop);
    // The link is printed only once Ctrl+C is handled: a Ctrl+C right after it closes the session
    // (credential file, mirror) instead of killing the process mid-way.
    printReady(host, world, mirror.mode, options.taskId ?? world.tasks[0]!.id, options.seed);
    void open(host.url);
  });
}

function printReady(host: RunningHost, world: World, mode: MirrorMode, taskId: string, seed: number): void {
  const title = world.tasks.find(task => task.id === taskId)?.title[getCliLanguage()] ?? taskId;
  process.stdout.write(cliText('hostWorld', { world: safeText(world.id), task: safeText(taskId), title: readableText(substituteTokens(title, variantTokens(world.variants.cases[variantIndex(world, seed)]!))) }));
  process.stdout.write(cliText('hostMode', { mode: mode === 'required' ? 'real-engine' : cliText('modelOnly') }));
  process.stdout.write(cliText('hostOrigin', { origin: host.origin }));
  process.stdout.write(cliText('hostToken', { path: host.tokenFile }));
  process.stdout.write(cliText('hostLink', { url: host.url }));
  process.stdout.write(cliText('hostOpen', { origin: host.origin, path: host.tokenFile }));
}

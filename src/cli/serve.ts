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
import { browserAdvice, chromiumStarts, launchFailureDetail, type StartResult } from './browser-start.ts';
import { AdapterError, AdapterInitializationError } from '../adapters/excalidraw/index.ts';
import { openInBrowser, writePreferredLauncher } from './open-browser.ts';
import { HOST_LIMITS } from '../host/limits.ts';
import { startHost } from '../host/server.ts';
import { resolvedDataPaths } from '../platform/paths.ts';
import type { MirrorMode, RunningHost } from '../host/protocol.ts';
import type { World } from '../world/types.ts';

export type MirrorChoice = MirrorMode | 'auto';
/** The world that ships with the package; `practonaut` and `practonaut play` start it. */
export const BUNDLED_WORLD = fileURLToPath(new URL('../../examples/worlds/flow-diagram/', import.meta.url));

export interface ServeArguments { source: string; seed: number; taskId?: string; mirror: MirrorChoice; open: boolean; requireOffline: boolean }
export function parseServeArguments(args: string[]): ServeArguments {
  let source: string | undefined; let seed = 42; let taskId: string | undefined;
  let mirror: MirrorChoice = 'auto'; let requireOffline = false; let open = true;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--require-offline' || arg === '--no-open') {
      if (seen.has(arg)) throw new RuntimeError('usage', cliText('optionDuplicate', { option: arg }));
      seen.add(arg); if (arg === '--no-open') open = false; else requireOffline = true;
    } else if (['--seed', '--task', '--mirror'].includes(arg)) {
      if (seen.has(arg)) throw new RuntimeError('usage', cliText('optionDuplicate', { option: arg }));
      seen.add(arg); const value = args[++i];
      if (!value || value.startsWith('--')) throw new RuntimeError('usage', cliText('optionValue', { option: arg }));
      if (arg === '--seed') {
        if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new RuntimeError('usage', cliText('seedUsage'));
        seed = Number(value);
      } else if (arg === '--task') taskId = value;
      else {
        if (value !== 'auto' && value !== 'required' && value !== 'off') throw new RuntimeError('usage', cliText('mirrorUsage'));
        mirror = value;
      }
    } else if (arg.startsWith('--')) throw new RuntimeError('usage', cliText('optionUnknown', { option: arg }));
    else if (source !== undefined) throw new RuntimeError('usage', cliText('serveUsage'));
    else source = arg;
  }
  return { source: source ?? BUNDLED_WORLD, seed, mirror, open, requireOffline, ...(taskId ? { taskId } : {}) };
}

export interface MirrorResolution { mode: MirrorMode; fallback: boolean; reason?: 'missing' | 'start'; detail?: string }
export interface MirrorProbes { installed(): Promise<boolean>; starts(): Promise<StartResult> }
const defaultProbes: MirrorProbes = { installed: async () => (await chromiumCheck(false)).ok, starts: () => chromiumStarts() };

/**
 * `auto` mirrors when the Playwright Chromium is installed and actually starts, and otherwise runs
 * model-only with a message saying why. `required` refuses with a named error instead:
 * `browser_runtime_missing` (not installed) or `browser_start_failed` (installed, does not start).
 */
export async function resolveMirror(choice: MirrorChoice, probes: MirrorProbes = defaultProbes): Promise<MirrorResolution> {
  if (choice === 'off') return { mode: 'off', fallback: false };
  if (!await probes.installed()) {
    if (choice === 'required') throw new RuntimeError('browser_runtime_missing', cliText('browserRuntimeMissing'));
    return { mode: 'off', fallback: true, reason: 'missing' };
  }
  const started = await probes.starts();
  if (!started.ok) {
    if (choice === 'required') throw new RuntimeError('browser_start_failed', cliText('browserStartFailed', { detail: started.detail, advice: browserAdvice() }));
    return { mode: 'off', fallback: true, reason: 'start', detail: started.detail };
  }
  return { mode: 'required', fallback: false };
}

/** The stderr notice for a model-only fallback. */
export function fallbackNotice(mirror: MirrorResolution): string {
  if (!mirror.fallback) return '';
  return mirror.reason === 'start' ? cliText('mirrorStartFallback', { detail: mirror.detail ?? 'unknown error', advice: browserAdvice() }) : cliText('mirrorFallback');
}

/**
 * Starts the host with the resolved mirror. The probe launched Chromium a moment ago, but the
 * mirror's own start can still fail (a crash, a resource limit): under `auto` the session then runs
 * model-only with the same notice; under `required` it is the named `browser_start_failed` error.
 */
export async function startHostWithMirror(choice: MirrorChoice, resolved: MirrorResolution, start: (mode: MirrorMode) => Promise<RunningHost>): Promise<{ host: RunningHost; mirror: MirrorResolution }> {
  if (resolved.mode === 'off') return { host: await start('off'), mirror: resolved };
  try { return { host: await start('required'), mirror: resolved }; }
  catch (error) {
    if (!(error instanceof AdapterError)) throw error;
    const detail = launchFailureDetail(error instanceof AdapterInitializationError ? error.primaryError : error);
    if (choice === 'required') throw new RuntimeError('browser_start_failed', cliText('browserStartFailed', { detail, advice: browserAdvice() }));
    const mirror: MirrorResolution = { mode: 'off', fallback: true, reason: 'start', detail };
    return { host: await start('off'), mirror };
  }
}

async function loadSource(source: string): Promise<World> {
  const input = await stat(source).catch(() => { throw new RuntimeError('usage', cliText('worldMissing', { path: source })); });
  return loadWorldPackage(input.isDirectory() ? await readWorldPackage(await packWorld(source)) : await readWorldPackageFile(source));
}

/** A world path (directory or package) or a library task (`excalidraw/<id>` or `<id>`); an existing path wins.
 * Returns the loaded world and the task to open (the explicit task, the library task or the world's first). */
export async function resolvePracticeSource(source: string, taskId?: string): Promise<{ world: World; taskId: string; library: boolean }> {
  const libraryTask = source !== BUNDLED_WORLD && !existsSync(source) ? libraryTaskId(source) : undefined;
  if (libraryTask !== undefined) {
    if (taskId !== undefined) throw new RuntimeError('usage', cliText('playTaskConflict'));
    return { world: await loadSource(LIBRARY_WORLD_DIR), taskId: libraryTask, library: true };
  }
  const world = await loadSource(source);
  if (taskId !== undefined && !world.tasks.some(task => task.id === taskId)) throw new RuntimeError('task_unknown', cliText('taskUnknown', { id: taskId }));
  return { world, taskId: taskId ?? world.tasks[0]!.id, library: false };
}

/** Runs one local session until Ctrl+C (or SIGTERM/SIGHUP). The browser is the user's own. */
export async function commandServe(args: string[]): Promise<number> {
  const options = parseServeArguments(args);
  // A library task id (`connect` or `excalidraw/connect`) opens the bundled library on that task;
  // an existing path always wins.
  const libraryTask = options.source !== BUNDLED_WORLD && !existsSync(options.source) ? libraryTaskId(options.source) : undefined;
  if (libraryTask !== undefined) {
    if (options.taskId) throw new RuntimeError('usage', cliText('playTaskConflict'));
    options.taskId = libraryTask; options.source = LIBRARY_WORLD_DIR;
  }
  const world = await loadSource(options.source);
  const paths = await resolvedDataPaths();
  const { host, mirror } = await startHostWithMirror(options.mirror, await resolveMirror(options.mirror), mode =>
    startHost(world, { seed: options.seed, mirror: mode, requireOffline: options.requireOffline, phase3: true, tokenDirectory: paths.host, localDirectory: paths.home, ...(options.taskId ? { taskId: options.taskId } : {}) }));
  process.stderr.write(fallbackNotice(mirror));
  printReady(host, world, mirror.mode, options.taskId ?? world.tasks[0]!.id, options.seed);
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
  await open(host.url);
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

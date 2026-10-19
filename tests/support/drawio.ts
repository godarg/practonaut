/**
 * Test support for the draw.io layer (PADR-0049 decision 2.8). Two test-only variables, read here and
 * never by the product:
 *  - `PN_DRAWIO_HOME`: an absolute path to a Practonaut home in which `setup --app drawio` ran
 *    (default `.local/drawio-home/` in the repository);
 *  - `PN_DRAWIO_REQUIRED`: `1` or `0`; unset means `0`; any other value stops the test run.
 * With `0` a draw.io test skips by name, separately for "runtime absent" and "sandboxed start
 * refused"; with `1` either fails. The archive path reaches the adapter through its test seam; the
 * preload still gives every test process its own `PRACTONAUT_HOME`.
 */
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawioRuntimePath, drawioRuntimeStatus } from '../../src/adapters/drawio/runtime.ts';
import { chromiumStarts } from '../../src/cli/browser-start.ts';
import { loadLibrary, taskWorld, type LibraryFile } from '../../src/library/index.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { World } from '../../src/world/types.ts';

export interface DrawioTestRuntime { home: string; required: boolean; runtimePath: string }
export const DEFAULT_DRAWIO_HOME = fileURLToPath(new URL('../../.local/drawio-home/', import.meta.url));

/** The two variables, strictly: a value other than `1`, `0` or unset stops the run. */
export function drawioTestRuntime(env: NodeJS.ProcessEnv = process.env): DrawioTestRuntime {
  const flag = env.PN_DRAWIO_REQUIRED;
  if (flag !== undefined && flag !== '0' && flag !== '1') throw new Error(`PN_DRAWIO_REQUIRED must be 1 or 0, not ${JSON.stringify(flag.slice(0, 16))}`);
  const home = env.PN_DRAWIO_HOME ?? DEFAULT_DRAWIO_HOME;
  if (!isAbsolute(home)) throw new Error('PN_DRAWIO_HOME must be an absolute path');
  return { home, required: flag === '1', runtimePath: drawioRuntimePath(home) };
}

export type DrawioAvailability = { ok: true; runtime: DrawioTestRuntime } | { ok: false; skip: string };
/** Whether the draw.io layer can run here; a reason to skip by name, or a failure when required. */
export async function drawioAvailability(runtime: DrawioTestRuntime = drawioTestRuntime(), starts: typeof chromiumStarts = chromiumStarts, check: typeof drawioRuntimeStatus = drawioRuntimeStatus): Promise<DrawioAvailability> {
  let skip: string | undefined;
  const status = await check(runtime.runtimePath);
  if (!status.ok) skip = status.code === 'app_runtime_missing' ? 'draw.io runtime absent: run setup --app drawio with PRACTONAUT_HOME set to PN_DRAWIO_HOME' : `draw.io runtime unverified: ${status.detail}`;
  else {
    const started = await starts(undefined, 'required');
    if (!started.ok) skip = `sandboxed Chromium start refused: ${started.detail}`;
  }
  if (skip === undefined) return { ok: true, runtime };
  if (runtime.required) throw new Error(`PN_DRAWIO_REQUIRED=1: ${skip}`);
  return { ok: false, skip };
}

/** The library's tasks in a draw.io world: the Excalidraw library's world with draw.io's app entry. */
export function drawioLibrary(): { world: World; library: LibraryFile } {
  const { world, library } = loadLibrary();
  return { world: validateWorld({ ...structuredClone(world), id: 'drawio-library', app: { adapterId: 'drawio', versionRange: '32.4.1' }, provenance: { ...world.provenance, appVersion: '32.4.1' } }), library };
}
export const drawioTaskWorld = (world: World, taskId: string): World => validateWorld(taskWorld(world, taskId));

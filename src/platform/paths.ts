/**
 * The single source for where Practonaut keeps local data.
 *
 * Default `~/.practonaut` (on Windows `%USERPROFILE%\.practonaut`), overridable with
 * `PRACTONAUT_HOME`. Nothing is resolved against the current directory, so `npx practonaut` in any
 * folder uses the same projects, recordings and credentials.
 */
import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DataPaths {
  /** Root of all local data (private directory). */
  readonly home: string;
  /** Session credential files and private mirror diagnostics. */
  readonly host: string;
  /** Author recordings. */
  readonly recordings: string;
  /** Saved author projects. */
  readonly projects: string;
  /** Managed compilation outputs. */
  readonly author: string;
}

export function practonautHome(env: NodeJS.ProcessEnv = process.env, home: string = homedir(), platform: NodeJS.Platform = process.platform): string {
  const path = platform === 'win32' ? win32 : posix;
  const configured = env.PRACTONAUT_HOME;
  return configured !== undefined && configured !== '' ? path.resolve(configured) : path.join(home, '.practonaut');
}

export function dataPaths(home: string = practonautHome(), platform: NodeJS.Platform = process.platform): DataPaths {
  const path = platform === 'win32' ? win32 : posix;
  return Object.freeze({ home, host: path.join(home, 'host'), recordings: path.join(home, 'recordings'), projects: path.join(home, 'projects'), author: path.join(home, 'author') });
}

/**
 * Resolves symbolic links in the existing part of the home path once, at start. The private-file
 * layer rejects symbolic-link ancestors; a link the user chose deliberately (macOS `/tmp`, a
 * relocated profile) is resolved here instead of being refused later.
 */
export async function resolvedDataPaths(env: NodeJS.ProcessEnv = process.env): Promise<DataPaths> {
  const requested = practonautHome(env);
  let existing = requested, rest: string[] = [];
  for (;;) {
    try { return dataPaths(posixOrWin().join(await realpath(existing), ...rest)); }
    catch (error) {
      const parent = posixOrWin().dirname(existing);
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === existing) throw error;
      rest = [posixOrWin().basename(existing), ...rest]; existing = parent;
    }
  }
}
const posixOrWin = (): typeof posix => process.platform === 'win32' ? win32 : posix;

/** Build outputs used when running from a source checkout (never user data). */
export function sourceBuildDirectory(name: 'player' | 'engine'): string {
  return fileURLToPath(new URL(`../../.local/${name}/`, import.meta.url));
}

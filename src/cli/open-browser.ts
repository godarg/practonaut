import { spawn } from 'node:child_process';
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import { processAlive } from '../host/token-file.ts';
import { join, posix, win32 } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EXCLUSIVE_CREATE, ensurePrivateDirectory, isPrivateFile } from '../platform/private-fs.ts';

const LINK = /^http:\/\/127\.0\.0\.1:\d{1,5}\/#code=[a-f0-9]{32}$/;

/**
 * The bootstrap link never goes on a command line: `open`, `xdg-open`, `cmd start` and a browser
 * started cold keep their arguments in the process list, which other local users can read. The
 * browser instead opens a private launcher file (0600 in the 0700 credential directory on POSIX,
 * the user profile on Windows) that forwards to the link with a meta refresh. Only its path is in argv.
 */
export async function writeLauncher(directory: string, url: string): Promise<{ path: string; remove(): Promise<void> }> {
  if (!LINK.test(url)) throw new Error('Only a local Practonaut link is opened');
  await ensurePrivateDirectory(directory);
  await removeOrphanedLaunchers(directory);
  const path = join(directory, `open-${process.pid}-${randomBytes(16).toString('hex')}.html`);
  const handle = await open(path, EXCLUSIVE_CREATE, 0o600);
  try {
    if (!isPrivateFile(await handle.stat())) throw new Error('Launcher file is not private');
    await handle.writeFile(`<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${url}"><title>Practonaut</title><p>Opening Practonaut…</p>\n`);
  } catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error; }
  await handle.close();
  return { path, async remove() { await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; }); } };
}

/** Launcher files whose process has ended (they are useless once their link expired anyway). */
export async function removeOrphanedLaunchers(directory: string, alive: (pid: number) => boolean = processAlive): Promise<string[]> {
  const removed: string[] = [];
  let names: string[];
  try { names = await readdir(directory); } catch { return removed; }
  for (const name of names) {
    const owner = /^open-(\d{1,10})-[0-9a-f]{32}\.html$/.exec(name);
    if (!owner || Number(owner[1]) === process.pid || alive(Number(owner[1]))) continue;
    try { if ((await lstat(join(directory, name))).isFile()) { await unlink(join(directory, name)); removed.push(name); } } catch { /* raced or gone */ }
  }
  return removed;
}

/**
 * Where the launcher file goes. Snap and Flatpak browsers on Linux cannot read hidden folders in the
 * home directory (~/.practonaut), so a private folder under $XDG_RUNTIME_DIR (per-user, 0700 by the
 * XDG spec) is used when it exists; elsewhere the private credential folder.
 */
export function launcherDirectory(hostDirectory: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const runtime = env.XDG_RUNTIME_DIR;
  return platform === 'linux' && runtime && posix.isAbsolute(runtime) ? posix.join(runtime, 'practonaut') : hostDirectory;
}

/** Writes the launcher in `launcherDirectory`, falling back to the credential folder when that is not usable. */
export async function writePreferredLauncher(hostDirectory: string, url: string): Promise<{ path: string; remove(): Promise<void> }> {
  const preferred = launcherDirectory(hostDirectory);
  if (preferred !== hostDirectory) { try { return await writeLauncher(preferred, url); } catch { /* not private or not writable: use the credential folder */ } }
  return writeLauncher(hostDirectory, url);
}

/** The command that opens a local file in the user's default browser. The platform is injectable for tests. */
export function openCommand(file: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (!(platform === 'win32' ? win32 : posix).isAbsolute(file) || !/\.html$/.test(file) || /["\r\n%^&|<>]/.test(file)) throw new Error('Only a private launcher file is opened');
  if (platform === 'darwin') return { command: 'open', args: [file] };
  // `start` is a cmd builtin; the empty first argument is the window title. Arguments are passed
  // verbatim, so the path is quoted here (it contains no quote or cmd metacharacter, see above).
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', `"${file}"`] };
  return { command: 'xdg-open', args: [file] };
}

/** Best effort: resolves false when no browser could be started; the URL is printed either way. */
export function openInBrowser(file: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const { command, args } = openCommand(file, platform);
      const child = spawn(command, args, { stdio: 'ignore', detached: platform !== 'win32', windowsVerbatimArguments: platform === 'win32' });
      child.once('error', () => resolve(false));
      child.once('spawn', () => { child.unref(); resolve(true); });
    } catch { resolve(false); }
  });
}

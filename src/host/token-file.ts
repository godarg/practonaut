import { lstat, open, readdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EXCLUSIVE_CREATE, ensurePrivateDirectory, isPrivateFile } from "../platform/private-fs.ts";
import { randomBytes } from "node:crypto";

export class TokenFileError extends Error {
  readonly code = "token_file_unsafe";
  constructor() { super("Session credential path is unsafe"); this.name = "TokenFileError"; }
}
export interface TokenFile { path: string; remove(): Promise<void> }
/** Whether a process with this id exists (EPERM: it exists, owned by someone else). */
export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
/**
 * Removes credential and diagnostics files whose session process has ended (Ctrl+C after a crash,
 * a killed terminal). Names carry the owning process id (`session-<pid>-<random>.token` and the
 * `.mirror.jsonl` beside it); a file whose process is alive is never touched. Only regular files
 * in the private directory are considered.
 */
export async function removeOrphanedSessionFiles(directory: string, alive: (pid: number) => boolean = processAlive): Promise<string[]> {
  const removed: string[] = [];
  let names: string[];
  try { names = await readdir(directory); } catch { return removed; }
  for (const name of names) {
    const owner = /^session-(\d{1,10})-[0-9a-f]{32}\.(?:token|mirror\.jsonl)$/.exec(name);
    if (!owner || Number(owner[1]) === process.pid || alive(Number(owner[1]))) continue;
    const path = join(directory, name);
    try { if ((await lstat(path)).isFile()) { await unlink(path); removed.push(name); } } catch { /* raced or gone */ }
  }
  return removed;
}

/** Fixed filenames are a test seam only; production always uses a random exclusive name with the owning process id. */
export async function createTokenFile(directory: string, token: string, filename = `session-${process.pid}-${randomBytes(16).toString("hex")}.token`): Promise<TokenFile> {
  const dir = resolve(directory);
  if (!/^session-[A-Za-z0-9-]+\.token$/.test(filename)) throw new TokenFileError();
  try {
    await ensurePrivateDirectory(dir);
    await removeOrphanedSessionFiles(dir);
    const path = join(dir, filename);
    const handle = await open(path, EXCLUSIVE_CREATE, 0o600);
    let own: { ino: number; dev: number } | undefined;
    try {
      const stat = await handle.stat();
      // Windows has no O_NOFOLLOW: an exclusive create can go through a planted dangling link.
      // The name itself must be the regular file just opened, before any credential is written.
      const named = await lstat(path);
      if (named.isSymbolicLink() || named.ino !== stat.ino || named.dev !== stat.dev) throw new TokenFileError();
      if (!isPrivateFile(stat)) throw new TokenFileError();
      own = { ino: stat.ino, dev: stat.dev };
      await handle.writeFile(token + "\n", "utf8");
    } finally { await handle.close(); }
    return { path, async remove() {
      try {
        const stat = await lstat(path);
        if (stat.isFile() && stat.ino === own?.ino && stat.dev === own.dev) await unlink(path);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    } };
  } catch { throw new TokenFileError(); }
}

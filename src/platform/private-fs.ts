/**
 * Private local files on every supported platform.
 *
 * POSIX (macOS, Linux): a private directory is 0700 and a private file 0600, both owned by the
 * calling user, single-link and never reached through a symbolic link. These are checked, not
 * assumed.
 *
 * Windows has no POSIX mode bits or numeric uid: `fs.Stats.uid` is 0 and `process.getuid` is
 * absent, so a POSIX check would always fail. There the protection is the location: the default
 * data directory lives in the user profile (`%USERPROFILE%\.practonaut`), whose ACL grants
 * access to that user, SYSTEM and administrators only. Type, link and symlink checks still apply;
 * ownership and mode checks are skipped instead of throwing. A `PRACTONAUT_HOME` outside the
 * profile is the operator's responsibility on Windows.
 */
import { constants, type Stats, type BigIntStats } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';
import { parse, join } from 'node:path';

export interface FsIdentity { readonly platform: NodeJS.Platform; readonly uid: number | undefined }
/** The identity of this process. Tests inject another platform instead of patching globals. */
export function callerIdentity(): FsIdentity { return { platform: process.platform, uid: process.getuid?.() }; }
export function posixPermissions(identity: FsIdentity = callerIdentity()): boolean { return identity.platform !== 'win32'; }

/** `O_NOFOLLOW` and `O_DIRECTORY` are undefined on Windows; there they contribute nothing. */
export const NOFOLLOW: number = constants.O_NOFOLLOW ?? 0;
export const EXCLUSIVE_CREATE: number = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW;
export const READ_NOFOLLOW: number = constants.O_RDONLY | NOFOLLOW;

type StatLike = Pick<Stats, 'uid' | 'nlink' | 'isFile' | 'isDirectory'> & { mode: number | bigint } | BigIntStats;
const mode = (st: StatLike): number => Number(st.mode) & 0o777;

export function ownedByCaller(st: Pick<Stats, 'uid'> | Pick<BigIntStats, 'uid'>, identity: FsIdentity = callerIdentity()): boolean {
  if (!posixPermissions(identity)) return true;
  return identity.uid !== undefined && Number(st.uid) === identity.uid;
}
export function isPrivateDirectory(st: StatLike, identity: FsIdentity = callerIdentity()): boolean {
  return st.isDirectory() && ownedByCaller(st, identity) && (!posixPermissions(identity) || mode(st) === 0o700);
}
/** `checkMode: false` keeps ownership and link checks for files whose mode is not ours to set. */
export function isPrivateFile(st: StatLike, identity: FsIdentity = callerIdentity(), checkMode = true): boolean {
  return st.isFile() && Number(st.nlink) === 1 && ownedByCaller(st, identity) && (!checkMode || !posixPermissions(identity) || mode(st) === 0o600);
}

export class PrivateFsError extends Error {
  readonly code = 'private_path_unsafe';
  constructor(message: string) { super(message); this.name = 'PrivateFsError'; }
}
/** Path components below the root, for both separators (Windows accepts `/` and `\`). */
export function pathParts(path: string): { root: string; parts: string[] } {
  const root = parse(path).root;
  return { root, parts: path.slice(root.length).split(/[\\/]+/).filter(Boolean) };
}
/**
 * Creates missing components with 0700, rejects a symbolic-link or non-directory ancestor, then
 * requires the leaf to be private. Existing ancestors keep their own modes (a home directory is
 * usually 0755); only the leaf is the private boundary.
 */
export async function ensurePrivateDirectory(path: string, identity: FsIdentity = callerIdentity()): Promise<void> {
  const { root, parts } = pathParts(path);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    let info = await lstat(current).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!info) {
      await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
      info = await lstat(current);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new PrivateFsError('Private directory has a symbolic-link or non-directory ancestor');
  }
  if (!isPrivateDirectory(await lstat(path), identity)) throw new PrivateFsError('Private directory ownership or permissions are unsafe');
}
/** Directory fsync makes a rename durable on POSIX. Windows cannot open a directory this way. */
export async function syncDirectory(path: string, identity: FsIdentity = callerIdentity()): Promise<void> {
  if (!posixPermissions(identity)) return;
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

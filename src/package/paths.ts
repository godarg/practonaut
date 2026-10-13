// Entry-name policy (threat model T1.1, T1.5). Names are checked as decoded text:
// NFC first (a name must already be in NFC), then absolute/drive forms, then the ASCII segment
// allowlist. The allowlist makes every accepted name ASCII; the NFC check is kept in front so a
// decomposed name is reported as what it is (E_PATH_NOT_NFC) and stays rejected if the allowlist
// is ever widened to non-ASCII names.
import { PackageError } from "./errors.ts";
import type { Limits } from "./limits.ts";

export const SEGMENT_PATTERN = "[A-Za-z0-9][A-Za-z0-9._-]*";
const SEGMENT = new RegExp(`^${SEGMENT_PATTERN}$`);
// Windows device names are reserved with any extension (CON, CON.txt); extracting such an entry
// on Windows opens the device instead of a file.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Validates an archive entry name. `allowDirectory` permits one trailing slash. */
export function checkEntryName(name: string, limits: Limits, allowDirectory = true): void {
  if (name.length === 0 || name.length > limits.maxPathLength) {
    throw new PackageError("E_INVALID_PATH", `empty or longer than ${limits.maxPathLength} characters`, name);
  }
  if (name.normalize("NFC") !== name) throw new PackageError("E_PATH_NOT_NFC", "name is not in Unicode NFC", name);
  if (name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) {
    throw new PackageError("E_ABSOLUTE_PATH", "absolute path", name);
  }
  if (name.includes("\\") || name.includes("\0")) throw new PackageError("E_INVALID_PATH", "backslash or NUL in name", name);
  const isDir = name.endsWith("/");
  if (isDir && !allowDirectory) throw new PackageError("E_INVALID_PATH", "directory name where a file is required", name);
  const segs = (isDir ? name.slice(0, -1) : name).split("/");
  if (segs.includes("..")) throw new PackageError("E_PATH_TRAVERSAL", "'..' segment", name);
  if (segs.length > limits.maxPathDepth) throw new PackageError("E_INVALID_PATH", `more than ${limits.maxPathDepth} segments`, name);
  for (const s of segs) {
    if (!SEGMENT.test(s)) throw new PackageError("E_INVALID_PATH", `segment '${s}' not in allowlist ${SEGMENT_PATTERN}`, name);
    // Windows drops trailing dots, so 'a.' and 'a' would be the same file there.
    if (s.endsWith(".")) throw new PackageError("E_INVALID_PATH", `segment '${s}' ends with a dot`, name);
    if (WINDOWS_RESERVED.test(s)) throw new PackageError("E_INVALID_PATH", `segment '${s}' is a reserved Windows device name`, name);
  }
}

/**
 * Collision check over a whole set of entry names, shared by the reader and the packer:
 * two names equal after foldName, or a file name that is also a directory on the path of another
 * entry (a.txt and a.txt/b.txt; extraction would need the same path as file and directory).
 * Names ending in '/' are directory entries.
 */
export function checkNameSet(names: readonly string[]): void {
  const seen = new Set<string>();
  const parents = new Set<string>();
  for (const name of names) {
    const folded = foldName(name);
    if (seen.has(folded)) throw new PackageError("E_DUPLICATE_ENTRY", "duplicate entry (after NFC, case and trailing-dot folding)", name);
    seen.add(folded);
    const segs = folded.split("/");
    for (let i = 1; i < segs.length; i++) parents.add(segs.slice(0, i).join("/"));
  }
  for (const name of names) {
    if (!name.endsWith("/") && parents.has(foldName(name))) throw new PackageError("E_DUPLICATE_ENTRY", "file name is also a directory of another entry", name);
  }
}

/**
 * Key used to detect names that collide on case-insensitive, normalising or dot-trimming file
 * systems: NFC, lower case, trailing dots of every segment removed, no trailing slash.
 */
export function foldName(name: string): string {
  const trimmed = name.endsWith("/") ? name.slice(0, -1) : name;
  return trimmed
    .normalize("NFC")
    .toLowerCase()
    .split("/")
    .map((seg) => seg.replace(/\.+$/, ""))
    .join("/");
}

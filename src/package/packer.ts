// Deterministic world packer: source directory -> world package bytes.
//
// Source layout:
//   world.json        required; JSON object with a string `id` (world id pattern) and,
//                     optionally, a string `version` (semver). Content schema: phase 1.
//   assets/**         optional; every regular file is packed (allowlisted media types only)
//   README.md, LICENSE, LICENSE.md, NOTICE, dot-files at the top level
//                     skipped and reported (documentation of the source, not world content)
//   anything else     rejected with E_SOURCE_INVALID (no silent drops)
//
// Determinism: entries are sorted by path (UTF-16 code units), the manifest is canonical JSON,
// and the archive writer uses fixed timestamps and stored entries. File-system order, mtimes,
// owners and permissions do not reach the output.
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "../canonical/index.ts";
import { PackageError } from "./errors.ts";
import { parseJsonEntry } from "./json.ts";
import { LIMITS, checkLimits, type Limits } from "./limits.ts";
import {
  CURRENT_SCHEMA_VERSION,
  MANIFEST_NAME,
  SEMVER_PATTERN,
  WORLD_ID_PATTERN,
  WORLD_PACKAGE_FORMAT,
  WorldManifestSchema,
  type WorldManifest,
} from "./manifest.ts";
import { mediaTypeForPath, validateContent } from "./media.ts";
import { checkEntryName, checkNameSet } from "./paths.ts";
import { readWorldPackage } from "./reader.ts";
import { writeStoredZip } from "./zip-writer.ts";

export const WORLD_FILE = "world.json";
export const ASSETS_DIR = "assets";
export const SKIPPED_TOP_LEVEL: ReadonlySet<string> = new Set(["README.md", "LICENSE", "LICENSE.md", "NOTICE"]);
/** Version written when world.json has no `version` field: semver 0.0.0 = unreleased draft. */
export const DRAFT_WORLD_VERSION = "0.0.0";

export interface PackOptions {
  limits?: Limits;
}

export interface PackResult {
  bytes: Buffer;
  manifest: WorldManifest;
  /** Top-level source files that were deliberately not packed (relative names). */
  skipped: string[];
}

async function collectAssets(root: string, rel: string, out: string[], limits: Limits): Promise<void> {
  const dirents = await readdir(join(root, rel), { withFileTypes: true });
  for (const d of dirents) {
    const childRel = `${rel}/${d.name}`;
    if (d.name.startsWith(".")) throw new PackageError("E_SOURCE_INVALID", "hidden file inside assets/", childRel);
    const st = await lstat(join(root, childRel));
    if (st.isSymbolicLink()) throw new PackageError("E_SOURCE_INVALID", "symbolic link in the source directory", childRel);
    if (st.isDirectory()) {
      await collectAssets(root, childRel, out, limits);
    } else if (st.isFile()) {
      if (out.length + 2 > limits.maxEntries) throw new PackageError("E_TOO_MANY_ENTRIES", `more than ${limits.maxEntries} entries`);
      out.push(childRel);
    } else {
      throw new PackageError("E_SOURCE_INVALID", "not a regular file or directory", childRel);
    }
  }
}

/** Reads exactly `size` bytes; a file that grew or shrank since lstat is rejected, and never read past size + 1. */
async function readExactly(path: string, size: number, rel: string): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(size + 1);
    let off = 0;
    while (off < buf.length) {
      const { bytesRead } = await fh.read(buf, off, buf.length - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    if (off !== size) throw new PackageError("E_SOURCE_INVALID", "file changed while packing", rel);
    return buf.subarray(0, size);
  } finally {
    await fh.close();
  }
}

/** Packs a world source directory. Same input -> byte-identical output. */
export async function packWorldWithManifest(dir: string, options: PackOptions = {}): Promise<PackResult> {
  const limits = checkLimits(options.limits ?? LIMITS);
  const top = await readdir(dir, { withFileTypes: true });
  const skipped: string[] = [];
  const paths: string[] = [];
  let hasWorld = false;
  for (const d of top) {
    const st = await lstat(join(dir, d.name));
    if (st.isSymbolicLink()) throw new PackageError("E_SOURCE_INVALID", "symbolic link in the source directory", d.name);
    if (d.name === WORLD_FILE && st.isFile()) {
      hasWorld = true;
      paths.push(WORLD_FILE);
    } else if (d.name === ASSETS_DIR && st.isDirectory()) {
      await collectAssets(dir, ASSETS_DIR, paths, limits);
    } else if ((SKIPPED_TOP_LEVEL.has(d.name) || d.name.startsWith(".")) && st.isFile()) {
      skipped.push(d.name);
    } else {
      throw new PackageError("E_SOURCE_INVALID", `unexpected top-level entry (allowed: ${WORLD_FILE}, ${ASSETS_DIR}/)`, d.name);
    }
  }
  if (!hasWorld) throw new PackageError("E_SOURCE_INVALID", `${WORLD_FILE} is missing`, WORLD_FILE);
  paths.sort();
  skipped.sort();

  // Same name and collision rules as the reader, on the whole set, before any size or content work.
  for (const p of paths) checkEntryName(p, limits, false);
  checkNameSet([MANIFEST_NAME, ...paths]);

  // Pass 1, metadata only: names, entry count, per-entry and total sizes are checked from lstat
  // before a single byte is read, so an oversized source costs nothing to reject.
  if (paths.length + 1 > limits.maxEntries) throw new PackageError("E_TOO_MANY_ENTRIES", `${paths.length + 1} > ${limits.maxEntries} (including manifest.json)`);
  const sizes = new Map<string, number>();
  let total = 0;
  for (const p of paths) {
    const st = await lstat(join(dir, p));
    if (!st.isFile()) throw new PackageError("E_SOURCE_INVALID", "not a regular file", p);
    if (st.size > limits.maxEntryBytes) throw new PackageError("E_ENTRY_TOO_LARGE", `${st.size} > ${limits.maxEntryBytes} bytes`, p);
    total += st.size;
    if (total > limits.maxTotalBytes) throw new PackageError("E_TOTAL_TOO_LARGE", `total > ${limits.maxTotalBytes} bytes`, p);
    sizes.set(p, st.size);
  }

  // Pass 2: read and validate content.
  const files: Array<{ path: string; data: Buffer; mediaType: ReturnType<typeof mediaTypeForPath> }> = [];
  for (const p of paths) {
    const data = await readExactly(join(dir, p), sizes.get(p) as number, p);
    const mediaType = mediaTypeForPath(p);
    validateContent(p, mediaType, data, limits.maxJsonDepth);
    files.push({ path: p, data, mediaType });
  }

  const worldData = files.find((f) => f.path === WORLD_FILE)?.data as Buffer;
  const world = parseJsonEntry(worldData, WORLD_FILE, limits.maxJsonDepth);
  if (world === null || typeof world !== "object" || Array.isArray(world)) throw new PackageError("E_SOURCE_INVALID", "world.json is not a JSON object", WORLD_FILE);
  const w = world as Record<string, unknown>;
  if (typeof w.id !== "string" || !new RegExp(WORLD_ID_PATTERN).test(w.id)) {
    throw new PackageError("E_SOURCE_INVALID", `world.json needs a string "id" matching ${WORLD_ID_PATTERN}`, WORLD_FILE);
  }
  let version = DRAFT_WORLD_VERSION;
  if (w.version !== undefined) {
    if (typeof w.version !== "string" || !new RegExp(SEMVER_PATTERN).test(w.version)) {
      throw new PackageError("E_SOURCE_INVALID", "world.json \"version\" must be a semver string", WORLD_FILE);
    }
    version = w.version;
  }

  const manifest: WorldManifest = {
    format: WORLD_PACKAGE_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    world: { id: w.id, version },
    entry: WORLD_FILE,
    files: files.map((f) => ({ path: f.path, sha256: sha256Hex(f.data), size: f.data.length, mediaType: f.mediaType })),
  };
  // The packer must never emit a manifest the reader would reject.
  const check = WorldManifestSchema.safeParse(manifest);
  if (!check.success) throw new PackageError("E_SOURCE_INVALID", `generated manifest invalid: ${check.error.message}`);
  const manifestBytes = Buffer.from(canonicalJson(manifest) + "\n", "utf8");
  const bytes = writeStoredZip([{ name: MANIFEST_NAME, data: manifestBytes }, ...files.map((f) => ({ name: f.path, data: f.data }))], limits);
  // Self-check with the reader and the SAME limits: the packer never returns a package that this
  // reader would reject (for example a manifest deeper than a lowered maxJsonDepth).
  await readWorldPackage(bytes, limits);
  return { bytes, manifest, skipped };
}

export async function packWorld(dir: string, options: PackOptions = {}): Promise<Buffer> {
  return (await packWorldWithManifest(dir, options)).bytes;
}

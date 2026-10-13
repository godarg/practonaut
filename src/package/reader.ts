// World package and checker bundle readers. Both use the same hardened archive reader and the
// same manifest checks; they differ only in the manifest schema and its format string.
//
// Packages are never extracted to disk (T1.1): the result is an in-memory map addressed by
// manifest path. Caller-supplied limits are validated (checkLimits: never above LIMITS) by
// readArchive and readArchiveFile, which every public reader goes through.
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { sha256Hex } from "../canonical/index.ts";
import { PackageError } from "./errors.ts";
import { parseJsonEntry } from "./json.ts";
import { LIMITS, checkLimits, type Limits } from "./limits.ts";
import {
  CHECKER_BUNDLE_FORMAT,
  CheckerBundleManifestSchema,
  MANIFEST_NAME,
  SUPPORTED_SCHEMA_MAJOR,
  WORLD_PACKAGE_FORMAT,
  WorldManifestSchema,
  type CheckerBundleManifest,
  type ManifestFileEntry,
  type WorldManifest,
} from "./manifest.ts";
import { validateContent } from "./media.ts";
import { readArchive } from "./zip-reader.ts";

export interface ValidatedFile {
  path: string;
  mediaType: ManifestFileEntry["mediaType"];
  size: number;
  sha256: string;
  data: Buffer;
}

export interface WorldPackage {
  kind: "world-package";
  manifest: WorldManifest;
  /** Parsed JSON of manifest.entry. Its content schema is defined in phase 1; here it is only checked to be a JSON object. */
  entry: Record<string, unknown>;
  files: Map<string, ValidatedFile>;
  archiveSha256: string;
  archiveSize: number;
}

export interface CheckerBundle {
  kind: "checker-bundle";
  manifest: CheckerBundleManifest;
  files: Map<string, ValidatedFile>;
  archiveSha256: string;
  archiveSize: number;
}

type ZodLike<T> = { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } } };

const OTHER_FORMAT: Record<string, string> = {
  [WORLD_PACKAGE_FORMAT]: CHECKER_BUNDLE_FORMAT,
  [CHECKER_BUNDLE_FORMAT]: WORLD_PACKAGE_FORMAT,
};

/** Issues shown in a manifest rejection, and the cap on the message text (characters). */
export const MAX_REPORTED_ISSUES = 5;
export const MAX_MESSAGE_CHARS = 4096;

/** First few schema issues, the rest counted, the whole text capped at MAX_MESSAGE_CHARS minus room for the code prefix. */
function summarizeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): string {
  const shown = issues.slice(0, MAX_REPORTED_ISSUES).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
  let text = shown.join("; ");
  if (issues.length > shown.length) text += `; and ${issues.length - shown.length} more issue(s)`;
  const budget = MAX_MESSAGE_CHARS - 64;
  return text.length > budget ? text.slice(0, budget - 3) + "..." : text;
}

async function readCommon<T extends { files: ManifestFileEntry[] }>(
  bytes: Uint8Array,
  limits: Limits,
  expectedFormat: string,
  schema: ZodLike<T>,
): Promise<{ manifest: T; files: Map<string, ValidatedFile>; archiveSha256: string; archiveSize: number }> {
  const archive = await readArchive(bytes, limits);
  const mBuf = archive.files.get(MANIFEST_NAME);
  if (!mBuf) throw new PackageError("E_MANIFEST_MISSING", `${MANIFEST_NAME} not found at the archive root`);
  let raw: unknown;
  try {
    raw = parseJsonEntry(mBuf, MANIFEST_NAME, limits.maxJsonDepth);
  } catch (e) {
    if (e instanceof PackageError && e.code === "E_JSON_INVALID") throw new PackageError("E_MANIFEST_INVALID", e.message.replace(/^E_JSON_INVALID: /, ""), MANIFEST_NAME);
    throw e;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new PackageError("E_MANIFEST_INVALID", "manifest is not a JSON object", MANIFEST_NAME);
  const rec = raw as Record<string, unknown>;
  // Format first: a checker bundle handed to the world reader (or the reverse) gets its own code.
  if (rec.format !== expectedFormat) {
    if (rec.format === OTHER_FORMAT[expectedFormat]) {
      throw new PackageError("E_FORMAT_MISMATCH", `expected ${expectedFormat}, got ${String(rec.format)}`, MANIFEST_NAME);
    }
    throw new PackageError("E_MANIFEST_INVALID", `format must be "${expectedFormat}"`, MANIFEST_NAME);
  }
  // Major check before the strict schema: a v2 manifest may legitimately carry other fields.
  const sv = typeof rec.schemaVersion === "string" ? rec.schemaVersion : "";
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(sv);
  if (!m) throw new PackageError("E_MANIFEST_INVALID", "schemaVersion is not MAJOR.MINOR.PATCH", MANIFEST_NAME);
  if (Number(m[1]) !== SUPPORTED_SCHEMA_MAJOR) {
    throw new PackageError("E_SCHEMA_MAJOR_UNSUPPORTED", `major ${m[1]}, supported ${SUPPORTED_SCHEMA_MAJOR}`, MANIFEST_NAME);
  }
  // Cheap structural pre-check before the schema: the schema validates every array element, so a
  // files array far beyond the entry limit would cost time and memory before being rejected.
  const maxFiles = limits.maxEntries - 1;
  if (!Array.isArray(rec.files)) throw new PackageError("E_MANIFEST_INVALID", "files: expected an array", MANIFEST_NAME);
  if (rec.files.length > maxFiles) throw new PackageError("E_MANIFEST_INVALID", `files: ${rec.files.length} items, at most ${maxFiles}`, MANIFEST_NAME);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new PackageError("E_MANIFEST_INVALID", summarizeIssues(parsed.error.issues), MANIFEST_NAME);
  const manifest = parsed.data;

  const listed = new Map<string, ManifestFileEntry>();
  for (const f of manifest.files) {
    if (f.path === MANIFEST_NAME) throw new PackageError("E_MANIFEST_INVALID", `${MANIFEST_NAME} must not list itself`, MANIFEST_NAME);
    if (listed.has(f.path)) throw new PackageError("E_MANIFEST_INVALID", "path listed twice", f.path);
    listed.set(f.path, f);
  }
  for (const name of archive.files.keys()) {
    if (name !== MANIFEST_NAME && !listed.has(name)) throw new PackageError("E_UNLISTED_ENTRY", "entry not listed in the manifest", name);
  }
  // Directory entries are not listed in the manifest; one is tolerated only as a parent directory
  // of a listed file (generic zip tools write those). Any other directory entry is unlisted content.
  const parents = new Set<string>();
  for (const path of listed.keys()) {
    const segs = path.split("/");
    for (let i = 1; i < segs.length; i++) parents.add(segs.slice(0, i).join("/") + "/");
  }
  for (const dir of archive.directories) {
    if (!parents.has(dir)) throw new PackageError("E_UNLISTED_ENTRY", "directory entry is not a parent of a listed file", dir);
  }
  const files = new Map<string, ValidatedFile>();
  for (const f of manifest.files) {
    const data = archive.files.get(f.path);
    if (!data) throw new PackageError("E_MISSING_ENTRY", "listed in the manifest but absent", f.path);
    if (data.length !== f.size) throw new PackageError("E_SIZE_MISMATCH", `${data.length} != ${f.size} bytes`, f.path);
    if (sha256Hex(data) !== f.sha256) throw new PackageError("E_HASH_MISMATCH", "sha256 mismatch", f.path);
    validateContent(f.path, f.mediaType, data, limits.maxJsonDepth);
    files.set(f.path, { path: f.path, mediaType: f.mediaType, size: f.size, sha256: f.sha256, data });
  }
  return { manifest, files, archiveSha256: sha256Hex(bytes), archiveSize: bytes.length };
}

export async function readWorldPackage(bytes: Uint8Array, limits: Limits = LIMITS): Promise<WorldPackage> {
  const { manifest, files, archiveSha256, archiveSize } = await readCommon(bytes, limits, WORLD_PACKAGE_FORMAT, WorldManifestSchema);
  const entryFile = files.get(manifest.entry);
  if (!entryFile) throw new PackageError("E_ENTRY_INVALID", "manifest.entry is not listed in files", manifest.entry);
  if (entryFile.mediaType !== "application/json") throw new PackageError("E_ENTRY_INVALID", "manifest.entry must be application/json", manifest.entry);
  const entry = parseJsonEntry(entryFile.data, manifest.entry, limits.maxJsonDepth);
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new PackageError("E_ENTRY_INVALID", "world file is not a JSON object", manifest.entry);
  return { kind: "world-package", manifest, entry: entry as Record<string, unknown>, files, archiveSha256, archiveSize };
}

export async function readCheckerBundle(bytes: Uint8Array, limits: Limits = LIMITS): Promise<CheckerBundle> {
  const { manifest, files, archiveSha256, archiveSize } = await readCommon(bytes, limits, CHECKER_BUNDLE_FORMAT, CheckerBundleManifestSchema);
  return { kind: "checker-bundle", manifest, files, archiveSha256, archiveSize };
}

/**
 * Reads an archive file from disk with the size limit enforced before the whole file is read.
 * Refuses anything that is not a regular file (a FIFO or device would block or never end).
 */
export async function readArchiveFile(path: string, limits: Limits = LIMITS): Promise<Buffer> {
  checkLimits(limits);
  // O_NONBLOCK: opening a FIFO for reading must not block before the type check below.
  const fh = await open(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw new PackageError("E_ARCHIVE_INVALID", "not a regular file");
    if (st.size > limits.maxArchiveBytes) throw new PackageError("E_ARCHIVE_TOO_LARGE", `${st.size} > ${limits.maxArchiveBytes} bytes`);
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) {
      const { bytesRead } = await fh.read(buf, off, st.size - off, off);
      if (bytesRead === 0) break;
      off += bytesRead;
    }
    if (off !== st.size) throw new PackageError("E_ARCHIVE_INVALID", "file changed while reading");
    return buf;
  } finally {
    await fh.close();
  }
}

export async function readWorldPackageFile(path: string, limits: Limits = LIMITS): Promise<WorldPackage> {
  return readWorldPackage(await readArchiveFile(path, limits), limits);
}

export async function readCheckerBundleFile(path: string, limits: Limits = LIMITS): Promise<CheckerBundle> {
  return readCheckerBundle(await readArchiveFile(path, limits), limits);
}

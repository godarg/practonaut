// Hardened ZIP reader shared by world packages and checker bundles (threat model TB1, I7).
//
// Pass 0 (raw bytes, before yauzl sees the archive): archive size; end-of-central-directory
//   record exactly at the end (no archive comment, no trailing data); no zip64 records; the
//   central directory ends exactly where the EOCD starts.
// Pass 1 (metadata of ALL entries, nothing inflated): flags, extra fields, name decoding and
//   policy, entry types, methods, declared sizes and ratios; then the local header of every
//   entry is read by us at `relativeOffsetOfLocalHeader` and compared with the central record
//   (name bytes, version, flags, method, CRC, sizes); local ranges must tile [0, cdOffset)
//   without gap or overlap (rejects prepended data and overlapping-entry bombs).
// Pass 2: inflate with a hard byte cap (never trusting the declared size), then CRC-32 check.
//
// Not honoured on purpose: the Info-ZIP Unicode Path extra field (0x7075). An entry carrying it
// (or 0x6375, or zip64 0x0001) is rejected with E_UNSUPPORTED_ZIP_FEATURE, because other readers
// may resolve such names differently (parser differential, T1.4).
//
// Open gap (stated, not hidden): data after the end of a deflate stream but inside the entry's
// compressed range is not detected; the inflated content (what every reader sees) is still the
// hashed content.
import yauzl from "yauzl";
import { crc32 } from "node:zlib";
import { PackageError } from "./errors.ts";
import { checkLimits, type Limits } from "./limits.ts";
import { checkEntryName, checkNameSet } from "./paths.ts";

const SIG_LOCAL = 0x04034b50;
const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const EOCD_LEN = 22;
const LOCAL_LEN = 30;
const CENTRAL_LEN = 46;

/** Flag bits we accept: 1-2 (deflate options) and 11 (UTF-8 names). */
const ALLOWED_FLAGS = 0x0002 | 0x0004 | 0x0800;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;

/** Extra fields that carry only timestamps/ownership and cannot change name or size. */
const ALLOWED_EXTRA_FIELDS: ReadonlySet<number> = new Set([0x5455, 0x7875]);
const EXTRA_FIELD_NAMES: Readonly<Record<number, string>> = { 0x0001: "zip64", 0x7075: "Info-ZIP Unicode Path", 0x6375: "Info-ZIP Unicode Comment" };

const S_IFMT = 0o170000, S_IFREG = 0o100000, S_IFDIR = 0o040000, S_IFLNK = 0o120000;

/** The only deflate stream a directory entry may carry: one final, empty fixed-Huffman block. */
const EMPTY_DEFLATE = Buffer.from([0x03, 0x00]);

/** Highest "version needed to extract" we accept: 2.0 (deflate, folders). 4.5 means zip64. */
const MAX_VERSION_NEEDED = 20;

/**
 * "Version made by" hosts we accept: 0 MS-DOS/FAT, 3 Unix, 10 Windows NTFS, 11 (written by Go
 * and Info-ZIP for NTFS), 14 VFAT, 19 OS X. The Unix mode in the upper 16 bits of the external
 * attributes is checked for EVERY host when it is non-zero, because unzip, ditto and bsdtar
 * honour it regardless of the host byte.
 */
const ALLOWED_HOSTS: ReadonlySet<number> = new Set([0, 3, 10, 11, 14, 19]);
const DOS_HOSTS: ReadonlySet<number> = new Set([0, 10, 11, 14]);

/** Optional counters for tests and diagnostics; never influence a decision. */
export interface ReadDiagnostics {
  /** Bytes received from inflate streams, including the chunk that crossed a cap. */
  inflatedBytes: number;
}

export interface ArchiveContents {
  /** File entries by archive name, inflated and CRC-checked. Directory entries are not included. */
  files: Map<string, Buffer>;
  /** Directory entries (names ending with '/'), if the archive has any. */
  directories: string[];
}

interface RawEntry {
  name: string;
  rawName: Buffer;
  entry: yauzl.Entry;
  isDirectory: boolean;
}

interface Eocd {
  entryCount: number;
  cdSize: number;
  cdOffset: number;
  eocdOffset: number;
}

function parseEocd(buf: Buffer): Eocd {
  if (buf.length < EOCD_LEN) throw new PackageError("E_ARCHIVE_INVALID", "too small to be a zip archive");
  const eocdOffset = buf.length - EOCD_LEN;
  if (buf.readUInt32LE(eocdOffset) !== SIG_EOCD || buf.readUInt16LE(eocdOffset + 20) !== 0) {
    // Is there an EOCD further up (archive comment or trailing data), or none at all?
    const floor = Math.max(0, buf.length - EOCD_LEN - 0xffff - 1024);
    for (let i = eocdOffset - 1; i >= floor; i--) {
      if (buf.readUInt32LE(i) === SIG_EOCD) throw new PackageError("E_ARCHIVE_LAYOUT", "archive comment or data after the end-of-central-directory record");
    }
    throw new PackageError("E_ARCHIVE_INVALID", "no end-of-central-directory record");
  }
  const disk = buf.readUInt16LE(eocdOffset + 4);
  const cdDisk = buf.readUInt16LE(eocdOffset + 6);
  const onDisk = buf.readUInt16LE(eocdOffset + 8);
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || onDisk === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", "zip64 end-of-central-directory values");
  }
  if (eocdOffset >= 20 && buf.readUInt32LE(eocdOffset - 20) === SIG_ZIP64_LOCATOR) {
    throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", "zip64 end-of-central-directory locator");
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== entryCount) throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", "multi-disk archive");
  if (cdOffset + cdSize !== eocdOffset) throw new PackageError("E_ARCHIVE_LAYOUT", "central directory does not end at the end-of-central-directory record");
  return { entryCount, cdSize, cdOffset, eocdOffset };
}

function openZip(buf: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      buf,
      { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: false, strictFileNames: false },
      (err, zf) => (err || !zf ? reject(new PackageError("E_ARCHIVE_INVALID", err?.message ?? "not a zip archive")) : resolve(zf)),
    ),
  );
}

function checkExtraFieldIds(ids: Iterable<number>, name: string): void {
  for (const id of ids) {
    if (ALLOWED_EXTRA_FIELDS.has(id)) continue;
    const label = EXTRA_FIELD_NAMES[id] ?? `0x${id.toString(16).padStart(4, "0")}`;
    throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", `extra field ${label}`, name);
  }
}

// ignoreBOM: a leading U+FEFF stays part of the name (the default decoder would strip it, and
// the name we check would differ from the bytes other readers use).
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeName(raw: Buffer, flags: number): string {
  // A printable stand-in for messages, never used as a path.
  const shown = raw.toString("latin1").replace(/[^\x20-\x7e]/g, "?");
  if (flags & FLAG_UTF8) {
    try {
      return utf8.decode(raw);
    } catch {
      throw new PackageError("E_INVALID_PATH", "name is flagged UTF-8 but is not valid UTF-8", shown);
    }
  }
  for (const b of raw) {
    if (b >= 0x80) throw new PackageError("E_INVALID_PATH", "non-ASCII name without the UTF-8 flag (legacy code page)", shown);
  }
  return raw.toString("latin1");
}

function listEntries(zf: yauzl.ZipFile): Promise<RawEntry[]> {
  return new Promise((resolve, reject) => {
    const out: RawEntry[] = [];
    let done = false;
    const fail = (e: unknown): void => {
      if (done) return;
      done = true;
      reject(e instanceof PackageError ? e : new PackageError("E_ARCHIVE_INVALID", String((e as Error)?.message ?? e)));
    };
    zf.on("error", fail);
    zf.on("entry", (entry: yauzl.Entry) => {
      if (done) return;
      try {
        const rawName = entry.fileName as unknown as Buffer;
        const flags = entry.generalPurposeBitFlag;
        const shown = rawName.toString("latin1").replace(/[^\x20-\x7e]/g, "?");
        if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw new PackageError("E_ENCRYPTED_ENTRY", "encrypted entry", shown);
        if (flags & FLAG_DATA_DESCRIPTOR) throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", "data descriptor (flag bit 3)", shown);
        if (flags & ~ALLOWED_FLAGS & 0xffff) throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", `general purpose flags 0x${flags.toString(16)}`, shown);
        checkExtraFieldIds(entry.extraFields.map((f) => f.id), shown);
        if (entry.fileCommentLength !== 0) throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", "entry comment", shown);
        if (entry.versionNeededToExtract > MAX_VERSION_NEEDED) {
          throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", `version needed to extract ${entry.versionNeededToExtract / 10} (max ${MAX_VERSION_NEEDED / 10})`, shown);
        }
        const name = decodeName(rawName, flags);
        out.push({ name, rawName, entry, isDirectory: name.endsWith("/") });
        zf.readEntry();
      } catch (e) {
        fail(e);
      }
    });
    zf.on("end", () => {
      if (done) return;
      done = true;
      resolve(out);
    });
    zf.readEntry();
  });
}

function validateMetadata(entries: RawEntry[], limits: Limits): void {
  let total = 0;
  for (const { name } of entries) checkEntryName(name, limits);
  checkNameSet(entries.map((e) => e.name));
  for (const { name, entry, isDirectory } of entries) {

    const host = entry.versionMadeBy >> 8;
    const ext = entry.externalFileAttributes >>> 0;
    const mode = (ext >>> 16) & 0xffff;
    if (mode !== 0) {
      // Type bits 0 = "type not given" (Python ZipFile.writestr writes 0o600 << 16): the name
      // decides, as for every extractor. Any other type than file or directory is rejected.
      const t = mode & S_IFMT;
      if (t === S_IFLNK) throw new PackageError("E_SYMLINK_ENTRY", "symbolic link entry", name);
      if (t !== 0 && t !== S_IFREG && t !== S_IFDIR) throw new PackageError("E_SPECIAL_ENTRY", `file type 0${t.toString(8)}`, name);
      if (t === S_IFDIR && !isDirectory) throw new PackageError("E_SPECIAL_ENTRY", "directory mode on a file name", name);
      if (t === S_IFREG && isDirectory) throw new PackageError("E_SPECIAL_ENTRY", "regular-file mode on a directory name", name);
    }
    if (!ALLOWED_HOSTS.has(host)) throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", `"version made by" host ${host}`, name);
    if (ext & 0x400) throw new PackageError("E_SPECIAL_ENTRY", "DOS reparse-point attribute", name);
    if (DOS_HOSTS.has(host) && ((ext & 0x10) !== 0) !== isDirectory) {
      throw new PackageError("E_SPECIAL_ENTRY", "DOS directory attribute does not match the name", name);
    }

    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new PackageError("E_UNSUPPORTED_METHOD", `compression method ${entry.compressionMethod}`, name);
    }
    // A directory entry carries no data: uncompressed size 0, CRC 0, and either nothing stored or
    // exactly the empty deflate stream (checked on the bytes in checkLocalHeadersAndLayout).
    if (isDirectory && (entry.uncompressedSize !== 0 || entry.compressedSize !== (entry.compressionMethod === 8 ? EMPTY_DEFLATE.length : 0))) {
      throw new PackageError("E_SPECIAL_ENTRY", "directory entry with content", name);
    }
    if (entry.uncompressedSize > limits.maxEntryBytes) {
      throw new PackageError("E_ENTRY_TOO_LARGE", `${entry.uncompressedSize} > ${limits.maxEntryBytes} bytes`, name);
    }
    if (entry.uncompressedSize >= limits.ratioFloorBytes && entry.uncompressedSize > limits.maxRatio * Math.max(1, entry.compressedSize)) {
      const ratio = entry.uncompressedSize / Math.max(1, entry.compressedSize);
      throw new PackageError("E_COMPRESSION_RATIO", `ratio ${ratio.toFixed(0)} > ${limits.maxRatio}`, name);
    }
    total += entry.uncompressedSize;
    if (total > limits.maxTotalBytes) throw new PackageError("E_TOTAL_TOO_LARGE", `declared total > ${limits.maxTotalBytes} bytes`, name);
  }
}

function parseLocalExtraIds(buf: Buffer, start: number, len: number, name: string): number[] {
  const ids: number[] = [];
  let p = start;
  const end = start + len;
  while (p < end) {
    if (p + 4 > end) throw new PackageError("E_ARCHIVE_INVALID", "truncated local extra field", name);
    const id = buf.readUInt16LE(p);
    const size = buf.readUInt16LE(p + 2);
    if (p + 4 + size > end) throw new PackageError("E_ARCHIVE_INVALID", "truncated local extra field", name);
    ids.push(id);
    p += 4 + size;
  }
  return ids;
}

/** Compares every local header with its central record and checks that the entries tile the data area. */
function checkLocalHeadersAndLayout(buf: Buffer, eocd: Eocd, entries: RawEntry[]): void {
  let cdBytes = 0;
  const ranges: Array<{ start: number; end: number; name: string }> = [];
  for (const { name, rawName, entry, isDirectory } of entries) {
    // yauzl reads the central records back to back from cdOffset, so this record starts here.
    const record = eocd.cdOffset + cdBytes;
    if (record + CENTRAL_LEN > eocd.eocdOffset || buf.readUInt32LE(record) !== SIG_CENTRAL) throw new PackageError("E_ARCHIVE_LAYOUT", "central directory record not where expected", name);
    if (buf.readUInt16LE(record + 34) !== 0) throw new PackageError("E_UNSUPPORTED_ZIP_FEATURE", "entry starts on another disk (multi-disk archive)", name);
    cdBytes += CENTRAL_LEN + entry.fileNameLength + entry.extraFieldLength + entry.fileCommentLength;
    const off = entry.relativeOffsetOfLocalHeader;
    if (off + LOCAL_LEN > eocd.cdOffset) throw new PackageError("E_ARCHIVE_LAYOUT", "local header outside the data area", name);
    if (buf.readUInt32LE(off) !== SIG_LOCAL) throw new PackageError("E_HEADER_MISMATCH", "no local file header at the recorded offset", name);
    const version = buf.readUInt16LE(off + 4);
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const crc = buf.readUInt32LE(off + 14);
    const csize = buf.readUInt32LE(off + 18);
    const usize = buf.readUInt32LE(off + 22);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const end = off + LOCAL_LEN + nameLen + extraLen + entry.compressedSize;
    if (end > eocd.cdOffset) throw new PackageError("E_ARCHIVE_LAYOUT", "entry data runs into the central directory", name);
    const localName = buf.subarray(off + LOCAL_LEN, off + LOCAL_LEN + nameLen);
    if (!localName.equals(rawName)) throw new PackageError("E_HEADER_MISMATCH", "local header name differs from central directory name", name);
    if (version !== entry.versionNeededToExtract) throw new PackageError("E_HEADER_MISMATCH", "version needed differs", name);
    if (flags !== entry.generalPurposeBitFlag) throw new PackageError("E_HEADER_MISMATCH", "flags differ", name);
    if (method !== entry.compressionMethod) throw new PackageError("E_HEADER_MISMATCH", "compression method differs", name);
    if (crc !== entry.crc32) throw new PackageError("E_HEADER_MISMATCH", "CRC-32 differs", name);
    if (csize !== entry.compressedSize || usize !== entry.uncompressedSize) throw new PackageError("E_HEADER_MISMATCH", "sizes differ", name);
    checkExtraFieldIds(parseLocalExtraIds(buf, off + LOCAL_LEN + nameLen, extraLen, name), name);
    if (isDirectory) {
      // Directory entries are skipped by the inflate pass, so their bytes are checked here.
      const data = buf.subarray(off + LOCAL_LEN + nameLen + extraLen, end);
      if (entry.compressionMethod === 8 && !data.equals(EMPTY_DEFLATE)) throw new PackageError("E_SPECIAL_ENTRY", "directory entry with content", name);
      if (entry.crc32 !== 0) throw new PackageError("E_CRC_MISMATCH", "directory entry with a non-zero CRC-32", name);
    }
    ranges.push({ start: off, end, name });
  }
  if (cdBytes !== eocd.cdSize) throw new PackageError("E_ARCHIVE_LAYOUT", "central directory size does not match its records");
  ranges.sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) throw new PackageError("E_ARCHIVE_LAYOUT", "overlapping entries", r.name);
    if (r.start > cursor) throw new PackageError("E_ARCHIVE_LAYOUT", cursor === 0 ? "data before the first local header" : "gap between entries", r.name);
    cursor = r.end;
  }
  if (cursor !== eocd.cdOffset) throw new PackageError("E_ARCHIVE_LAYOUT", "data between the last entry and the central directory");
}

function readCapped(zf: yauzl.ZipFile, e: RawEntry, limits: Limits, diag?: ReadDiagnostics): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zf.openReadStream(e.entry, (err, stream) => {
      if (err || !stream) {
        reject(new PackageError("E_ARCHIVE_INVALID", err?.message ?? "no stream", e.name));
        return;
      }
      const chunks: Buffer[] = [];
      let n = 0;
      let failed = false;
      // Hard cap: never trust the declared size. Abort as soon as the real bytes exceed it.
      const cap = Math.min(e.entry.uncompressedSize, limits.maxEntryBytes);
      stream.on("data", (c: Buffer) => {
        if (failed) return;
        if (diag) diag.inflatedBytes += c.length;
        n += c.length;
        if (n > cap) {
          failed = true;
          stream.destroy();
          reject(new PackageError("E_ENTRY_SIZE_MISMATCH", `inflates beyond the declared ${e.entry.uncompressedSize} bytes`, e.name));
          return;
        }
        chunks.push(c);
      });
      stream.on("error", (x: Error) => {
        if (failed) return;
        failed = true;
        reject(new PackageError("E_ARCHIVE_INVALID", x.message, e.name));
      });
      stream.on("end", () => {
        if (failed) return;
        if (n !== e.entry.uncompressedSize) {
          reject(new PackageError("E_ENTRY_SIZE_MISMATCH", `inflated ${n}, declared ${e.entry.uncompressedSize} bytes`, e.name));
          return;
        }
        const data = Buffer.concat(chunks);
        if (crc32(data) >>> 0 !== e.entry.crc32 >>> 0) {
          reject(new PackageError("E_CRC_MISMATCH", "CRC-32 of the content differs from the header", e.name));
          return;
        }
        resolve(data);
      });
    });
  });
}

/** Reads and validates a zip archive held in memory. Never touches the file system. */
export async function readArchive(bytes: Uint8Array, limits: Limits, diag?: ReadDiagnostics): Promise<ArchiveContents> {
  checkLimits(limits);
  if (bytes.length > limits.maxArchiveBytes) throw new PackageError("E_ARCHIVE_TOO_LARGE", `${bytes.length} > ${limits.maxArchiveBytes} bytes`);
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = parseEocd(buf); // pass 0
  if (eocd.entryCount > limits.maxEntries) throw new PackageError("E_TOO_MANY_ENTRIES", `${eocd.entryCount} > ${limits.maxEntries}`);
  const zf = await openZip(buf);
  try {
    const entries = await listEntries(zf);
    // No separate entry-count check: yauzl emits exactly eocd.entryCount records, and a count that
    // lies about the central directory is caught by the central-directory size check below.
    validateMetadata(entries, limits); // pass 1
    checkLocalHeadersAndLayout(buf, eocd, entries);
    const files = new Map<string, Buffer>();
    const directories: string[] = [];
    for (const e of entries) {
      if (e.isDirectory) {
        directories.push(e.name);
        continue;
      }
      files.set(e.name, await readCapped(zf, e, limits, diag)); // pass 2
    }
    return { files, directories };
  } finally {
    zf.close();
  }
}

// Fixture builders for valid and hostile world packages and checker bundles.
// Independent of src/: manifests are assembled with JSON.stringify and node:crypto here, and the
// archives come from tests/support/zipwriter.ts. Fixtures are built in memory (and written to a
// temp directory by tests that need files); nothing is committed.
import { createHash } from "node:crypto";
import { buildZip, type ArchiveOptions, type HostileEntry } from "./zipwriter.ts";

export const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
const json = (v: unknown): Buffer => Buffer.from(JSON.stringify(v, null, 2) + "\n");

/** 8-byte PNG signature + a minimal IHDR-like tail; the validator checks magic bytes only. */
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("0000000dIHDR", "ascii")]);
export const WORLD = json({ schema: "practonaut.world/0-draft", id: "fixture" });

export interface FileSpec {
  data: Buffer;
  mediaType: string;
}

export interface PkgOptions {
  format?: string;
  schemaVersion?: string;
  entry?: string;
  manifestExtra?: Record<string, unknown>; // merged into the manifest top level
  fileExtra?: Record<string, unknown>; // merged into every files[] item
  /** Manifest lists these files; archive holds `archiveFiles` (defaults to the same). */
  archiveFiles?: Record<string, Buffer>;
  extraEntries?: HostileEntry[];
  entryPatch?: Record<string, Partial<HostileEntry>>; // per archive name
  manifestBytes?: Buffer; // replaces the manifest content entirely
  omitManifest?: boolean;
  archive?: ArchiveOptions;
}

export const BASE_FILES: Record<string, FileSpec> = {
  "world.json": { data: WORLD, mediaType: "application/json" },
  "assets/marker.png": { data: PNG, mediaType: "image/png" },
};

export function manifestFor(files: Record<string, FileSpec>, opts: PkgOptions = {}): Record<string, unknown> {
  const format = opts.format ?? "practonaut.world-package";
  const m: Record<string, unknown> = {
    format,
    schemaVersion: opts.schemaVersion ?? "1.0.0",
    world: { id: "fixture", version: "1.2.3" },
  };
  if (format !== "practonaut.checker-bundle") m.entry = opts.entry ?? "world.json";
  m.files = Object.entries(files).map(([path, f]) => ({ path, sha256: sha(f.data), size: f.data.length, mediaType: f.mediaType, ...(opts.fileExtra ?? {}) }));
  return { ...m, ...(opts.manifestExtra ?? {}) };
}

export function pkg(files: Record<string, FileSpec> = BASE_FILES, opts: PkgOptions = {}): Buffer {
  const manifest = opts.manifestBytes ?? json(manifestFor(files, opts));
  const archiveFiles = opts.archiveFiles ?? Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.data]));
  const entries: HostileEntry[] = [];
  if (!opts.omitManifest) entries.push({ name: "manifest.json", data: manifest });
  for (const [name, data] of Object.entries(archiveFiles)) entries.push({ name, data, ...(opts.entryPatch?.[name] ?? {}) });
  if (opts.entryPatch?.["manifest.json"] && entries[0]) Object.assign(entries[0], opts.entryPatch["manifest.json"]);
  return buildZip([...entries, ...(opts.extraEntries ?? [])], opts.archive ?? {});
}

export const CHECKER_FILES: Record<string, FileSpec> = {
  "held-out/tasks.json": { data: json({ heldOut: [{ id: "H1", note: "HIDDEN-CANARY" }] }), mediaType: "application/json" },
};

export function checkerBundle(opts: PkgOptions = {}): Buffer {
  return pkg(CHECKER_FILES, { format: "practonaut.checker-bundle", ...opts });
}

const lowEntropy = (n: number, seed: number): Buffer => {
  const b = Buffer.alloc(n);
  let a = seed >>> 0;
  for (let i = 0; i < n; i++) {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    b[i] = 0x30 + ((a >>> 28) & 1);
  }
  return b;
};

const withFile = (path: string, data: Buffer, mediaType: string): Record<string, FileSpec> => ({ ...BASE_FILES, [path]: { data, mediaType } });

function deepJson(depth: number): Buffer {
  return Buffer.from("[".repeat(depth) + "]".repeat(depth));
}

/** An archive whose stored first entry contains a complete second local entry (overlap bomb). */
function overlapBomb(): Buffer {
  const inner = buildZip([{ name: "assets/inner.txt", data: Buffer.from("inner"), method: 0 }]);
  const innerLocalLen = 30 + "assets/inner.txt".length + 5;
  const innerLocal = inner.subarray(0, innerLocalLen);
  const outerName = "assets/outer.txt";
  const files: Record<string, FileSpec> = { ...BASE_FILES, [outerName]: { data: innerLocal, mediaType: "text/plain" }, "assets/inner.txt": { data: Buffer.from("inner"), mediaType: "text/plain" } };
  const manifest = json(manifestFor(files));
  const entries: HostileEntry[] = [
    { name: outerName, data: innerLocal, method: 0 },
    { name: "manifest.json", data: manifest },
    { name: "world.json", data: WORLD },
    { name: "assets/marker.png", data: PNG },
  ];
  return buildZip(entries, { extraCentral: [{ name: "assets/inner.txt", data: Buffer.from("inner"), method: 0, offset: 30 + outerName.length }] });
}

export interface HostileCase {
  id: string;
  description: string;
  expected: string;
  reader: "world" | "checker";
  build: () => Buffer;
}

const x = (name: string, data: Buffer, extra: Partial<HostileEntry> = {}): PkgOptions => ({ extraEntries: [{ name, data, ...extra }] });

export const HOSTILE_CASES: HostileCase[] = [
  // carried over from the runtime-parity spike (13 cases)
  { id: "traversal", description: "entry ../evil.txt", expected: "E_PATH_TRAVERSAL", reader: "world", build: () => pkg(BASE_FILES, x("../evil.txt", Buffer.from("x"))) },
  { id: "traversal-nested", description: "entry assets/../../evil.txt", expected: "E_PATH_TRAVERSAL", reader: "world", build: () => pkg(BASE_FILES, x("assets/../../evil.txt", Buffer.from("x"))) },
  { id: "absolute", description: "entry /etc/evil.txt", expected: "E_ABSOLUTE_PATH", reader: "world", build: () => pkg(BASE_FILES, x("/etc/evil.txt", Buffer.from("x"))) },
  { id: "absolute-win", description: "entry C:/evil.txt", expected: "E_ABSOLUTE_PATH", reader: "world", build: () => pkg(BASE_FILES, x("C:/evil.txt", Buffer.from("x"))) },
  { id: "symlink", description: "symlink entry pointing at /etc/passwd", expected: "E_SYMLINK_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/link", Buffer.from("/etc/passwd"), { method: 0, unixMode: 0o120777 })) },
  { id: "bomb-ratio", description: "3 MiB of zeros deflated (ratio ~1000)", expected: "E_COMPRESSION_RATIO", reader: "world", build: () => pkg(BASE_FILES, x("assets/zeros.txt", Buffer.alloc(3 * 1024 * 1024))) },
  { id: "bomb-total", description: "six 3.5 MB entries, 21 MB declared in total", expected: "E_TOTAL_TOO_LARGE", reader: "world", build: () => pkg(BASE_FILES, { extraEntries: Array.from({ length: 6 }, (_, i) => ({ name: `assets/blob${i}.txt`, data: lowEntropy(3_500_000, i + 1), level: 1 })) }) },
  { id: "bomb-lying", description: "header declares 1000 bytes, stream inflates to 50 MiB", expected: "E_ENTRY_SIZE_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, x("assets/liar.txt", Buffer.alloc(50 * 1024 * 1024), { lieUncompressedSize: 1000, level: 1 })) },
  { id: "oversized-entry", description: "one 5 MB entry (limit 4 MiB)", expected: "E_ENTRY_TOO_LARGE", reader: "world", build: () => pkg(BASE_FILES, x("assets/big.txt", Buffer.from(createHash("sha512").update("big").digest("hex").repeat(80 * 1024)))) },
  { id: "schema-major", description: "manifest schemaVersion 2.0.0", expected: "E_SCHEMA_MAJOR_UNSUPPORTED", reader: "world", build: () => pkg(BASE_FILES, { schemaVersion: "2.0.0" }) },
  { id: "hash-mismatch", description: "world.json altered after hashing, same size", expected: "E_HASH_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { archiveFiles: { "world.json": Buffer.from(WORLD.toString().replace("fixture", "fixturE")), "assets/marker.png": PNG } }) },
  { id: "unlisted", description: "entry present but not in the manifest", expected: "E_UNLISTED_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/sneaky.json", Buffer.from("{}"))) },
  { id: "duplicate", description: "World.json next to world.json", expected: "E_DUPLICATE_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("World.json", Buffer.from("{}"))) },

  // executable and active content (T1.6)
  { id: "exec-elf", description: "ELF binary named .png", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/tool.png", Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), Buffer.alloc(57)]), "image/png")) },
  { id: "exec-shebang", description: "#!/bin/sh script named .txt", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/notes.txt", Buffer.from("#!/bin/sh\nrm -rf ~\n"), "text/plain")) },
  { id: "exec-html-as-png", description: "HTML document named .png", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/pic.png", Buffer.from("<!DOCTYPE html><script>alert(1)</script>"), "image/png")) },
  { id: "exec-html-ext", description: "page.html", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/page.html", Buffer.from("hello"), "text/plain")) },
  { id: "exec-wasm", description: "WebAssembly module named .json", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/mod.json", Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), "application/json")) },
  { id: "exec-svg", description: "scripted SVG", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/evil.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), "image/png")) },
  { id: "exec-js", description: "script.js", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/script.js", Buffer.from("console.log(1)"), "text/plain")) },
  { id: "exec-macho", description: "Mach-O 64-bit binary named .webp", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/x.webp", Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.alloc(28)]), "image/webp")) },
  { id: "exec-pe", description: "PE executable named .jpg", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/x.jpg", Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)]), "image/jpeg")) },

  // media type lies and unsupported types
  { id: "media-json-as-png", description: "PNG extension, JSON content", expected: "E_MEDIA_TYPE_MISMATCH", reader: "world", build: () => pkg(withFile("assets/data.png", Buffer.from('{"a":1}'), "image/png")) },
  { id: "media-declared-mismatch", description: "world.json declared as text/plain", expected: "E_MEDIA_TYPE_MISMATCH", reader: "world", build: () => pkg({ ...BASE_FILES, "world.json": { data: WORLD, mediaType: "text/plain" } }) },
  { id: "media-unsupported", description: "font.woff2", expected: "E_UNSUPPORTED_MEDIA_TYPE", reader: "world", build: () => pkg(withFile("assets/font.woff2", Buffer.from("wOF2"), "text/plain")) },
  { id: "json-too-deep", description: "JSON asset nested 65 levels", expected: "E_JSON_TOO_DEEP", reader: "world", build: () => pkg(withFile("assets/deep.json", deepJson(65), "application/json")) },
  { id: "json-invalid", description: "JSON asset that does not parse", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/bad.json", Buffer.from("{oops"), "application/json")) },

  // names
  { id: "name-not-nfc", description: "decomposed name assets/cafe\\u0301.png", expected: "E_PATH_NOT_NFC", reader: "world", build: () => pkg(withFile("assets/cafe\u0301.png", PNG, "image/png")) },
  { id: "name-non-ascii", description: "NFC but non-ASCII name assets/café.png", expected: "E_INVALID_PATH", reader: "world", build: () => pkg(withFile("assets/caf\u00e9.png", PNG, "image/png")) },
  { id: "name-codepage", description: "byte 0x82 in a name without the UTF-8 flag", expected: "E_INVALID_PATH", reader: "world", build: () => pkg(BASE_FILES, x("assets/x", Buffer.from("x"), { name: Buffer.from([0x61, 0x82, 0x2e, 0x74, 0x78, 0x74]), flags: 0 })) },
  { id: "name-backslash-abs", description: "entry \\\\evil.txt", expected: "E_ABSOLUTE_PATH", reader: "world", build: () => pkg(BASE_FILES, x("\\evil.txt", Buffer.from("x"))) },
  { id: "name-too-deep", description: "9 path segments", expected: "E_INVALID_PATH", reader: "world", build: () => pkg(withFile("a/b/c/d/e/f/g/h/i.txt", Buffer.from("x"), "text/plain")) },

  // special entries
  { id: "fifo", description: "FIFO entry", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/fifo", Buffer.alloc(0), { method: 0, unixMode: 0o010644 })) },
  { id: "char-device", description: "character device entry", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/dev", Buffer.alloc(0), { method: 0, unixMode: 0o020644 })) },
  { id: "dos-reparse", description: "DOS entry with the reparse-point attribute", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/rp.txt", Buffer.from("x"), { madeByOs: 0, externalAttrs: 0x400 })) },
  { id: "encrypted", description: "encryption flag set", expected: "E_ENCRYPTED_ENTRY", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { flags: 0x0801 } } }) },
  { id: "method-bzip2", description: "compression method 12", expected: "E_UNSUPPORTED_METHOD", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { method: 12 } } }) },

  // parser differentials and layout (T1.3, T1.4)
  { id: "unicode-path-extra", description: "Info-ZIP Unicode Path extra field (0x7075) with another name", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { extra: [{ id: 0x7075, data: Buffer.concat([Buffer.from([1, 0, 0, 0, 0]), Buffer.from("../../evil.json")]) }] } } }) },
  { id: "zip64-extra", description: "gratuitous zip64 extra field", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { extra: [{ id: 0x0001, data: Buffer.alloc(16) }] } } }) },
  { id: "zip64-locator", description: "zip64 end-of-central-directory record and locator", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { archive: { zip64Locator: true } }) },
  { id: "local-name-differs", description: "local header name differs from the central name", expected: "E_HEADER_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "assets/marker.png": { localName: "assets/marker.PNG" } } }) },
  { id: "local-size-differs", description: "local header uncompressed size differs", expected: "E_HEADER_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { localUncompressedSize: 1 } } }) },
  { id: "local-flags-differ", description: "local header flags differ", expected: "E_HEADER_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { localFlags: 0 } } }) },
  { id: "data-descriptor", description: "data descriptor with lying sizes", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { flags: 0x0808, dataDescriptor: { crc: 0, compressedSize: 1, uncompressedSize: 1 } } } }) },
  { id: "prepended-data", description: "64 bytes before the first local header", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: () => pkg(BASE_FILES, { archive: { prepend: Buffer.alloc(64, 0x41), adjustOffsetsForPrepend: true } }) },
  { id: "trailing-data", description: "bytes after the end-of-central-directory record", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: () => pkg(BASE_FILES, { archive: { trailing: Buffer.from("trailing") } }) },
  { id: "archive-comment", description: "non-empty archive comment", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: () => pkg(BASE_FILES, { archive: { comment: "hello" } }) },
  { id: "overlap", description: "second entry lives inside the first entry's data (overlap bomb)", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: overlapBomb },
  { id: "crc-mismatch", description: "CRC-32 in both headers is wrong", expected: "E_CRC_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { crc: 0x12345678 } } }) },
  { id: "entry-comment", description: "entry comment", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { entryComment: "c" } } }) },
  { id: "too-many-entries", description: "257 entries", expected: "E_TOO_MANY_ENTRIES", reader: "world", build: () => pkg(BASE_FILES, { extraEntries: Array.from({ length: 254 }, (_, i) => ({ name: `assets/f${i}.txt`, data: Buffer.from("x") })) }) },
  { id: "archive-too-large", description: "16 MiB + 1 byte", expected: "E_ARCHIVE_TOO_LARGE", reader: "world", build: () => Buffer.alloc(16 * 1024 * 1024 + 1) },
  { id: "not-a-zip", description: "plain text", expected: "E_ARCHIVE_INVALID", reader: "world", build: () => Buffer.from("this is not a zip archive, just text that is long enough") },

  // manifest
  { id: "manifest-missing", description: "no manifest.json", expected: "E_MANIFEST_MISSING", reader: "world", build: () => pkg(BASE_FILES, { omitManifest: true }) },
  { id: "manifest-not-json", description: "manifest.json is not JSON", expected: "E_MANIFEST_INVALID", reader: "world", build: () => pkg(BASE_FILES, { manifestBytes: Buffer.from("{not json") }) },
  { id: "manifest-extra-field", description: "undeclared top-level field", expected: "E_MANIFEST_INVALID", reader: "world", build: () => pkg(BASE_FILES, { manifestExtra: { publisher: "x" } }) },
  { id: "manifest-proto-key", description: "__proto__ key in the manifest", expected: "E_MANIFEST_INVALID", reader: "world", build: () => pkg(BASE_FILES, { manifestBytes: Buffer.from(JSON.stringify(manifestFor(BASE_FILES)).replace('{"format"', '{"__proto__":{"x":1},"format"')) }) },
  { id: "visibility-field", description: "files[] items carry visibility (hidden data in a world package)", expected: "E_MANIFEST_INVALID", reader: "world", build: () => pkg(BASE_FILES, { fileExtra: { visibility: "hidden" } }) },
  { id: "checker-as-world", description: "checker bundle handed to the world reader", expected: "E_FORMAT_MISMATCH", reader: "world", build: () => checkerBundle() },
  { id: "world-as-checker", description: "world package handed to the checker reader", expected: "E_FORMAT_MISMATCH", reader: "checker", build: () => pkg() },
  { id: "missing-entry", description: "listed file absent from the archive", expected: "E_MISSING_ENTRY", reader: "world", build: () => pkg(BASE_FILES, { archiveFiles: { "world.json": WORLD } }) },
  { id: "size-mismatch", description: "manifest size differs from the content", expected: "E_SIZE_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { manifestBytes: Buffer.from(JSON.stringify(manifestFor(BASE_FILES)).replace(`"size":${WORLD.length}`, `"size":${WORLD.length + 1}`)) }) },
  { id: "entry-not-listed", description: "manifest.entry names a file not in files", expected: "E_ENTRY_INVALID", reader: "world", build: () => pkg(BASE_FILES, { entry: "other.json" }) },
  { id: "entry-not-json", description: "manifest.entry names a PNG", expected: "E_ENTRY_INVALID", reader: "world", build: () => pkg(BASE_FILES, { entry: "assets/marker.png" }) },
  { id: "entry-array", description: "world file is a JSON array", expected: "E_ENTRY_INVALID", reader: "world", build: () => pkg({ ...BASE_FILES, "world.json": { data: Buffer.from("[]"), mediaType: "application/json" } }) },

  // review round 1 (2026-10-03): names
  { id: "name-bom", description: "world.json stored as U+FEFF + world.json (UTF-8 flag)", expected: "E_INVALID_PATH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { name: "\ufeffworld.json" } } }) },
  { id: "name-trailing-dot", description: "segment ending in a dot (assets/a.txt.)", expected: "E_INVALID_PATH", reader: "world", build: () => pkg(withFile("assets/a.txt.", Buffer.from("x"), "text/plain")) },
  { id: "name-trailing-dot-dir", description: "assets./a.txt next to assets/a.txt", expected: "E_INVALID_PATH", reader: "world", build: () => pkg({ ...BASE_FILES, "assets./a.txt": { data: Buffer.from("x"), mediaType: "text/plain" }, "assets/a.txt": { data: Buffer.from("y"), mediaType: "text/plain" } }) },
  { id: "name-windows-reserved", description: "Windows device name assets/CON.txt", expected: "E_INVALID_PATH", reader: "world", build: () => pkg(withFile("assets/CON.txt", Buffer.from("x"), "text/plain")) },
  { id: "name-windows-reserved-lpt", description: "Windows device name assets/lpt9.png (listed)", expected: "E_INVALID_PATH", reader: "world", build: () => pkg(withFile("assets/lpt9.png", PNG, "image/png")) },
  { id: "file-is-dir-prefix", description: "assets/a.txt and assets/a.txt/b.txt", expected: "E_DUPLICATE_ENTRY", reader: "world", build: () => pkg({ ...BASE_FILES, "assets/a.txt": { data: Buffer.from("x"), mediaType: "text/plain" }, "assets/a.txt/b.txt": { data: Buffer.from("y"), mediaType: "text/plain" } }) },

  // review round 1: entry types by host ("version made by")
  { id: "symlink-host19", description: "symlink mode, made by OS X (host 19)", expected: "E_SYMLINK_ENTRY", reader: "world", build: () => pkg(withFile("assets/link.txt", Buffer.from("/etc/passwd"), "text/plain"), { entryPatch: { "assets/link.txt": { method: 0, madeByOs: 19, unixMode: 0o120777 } } }) },
  { id: "symlink-host0", description: "symlink mode, made by MS-DOS (host 0)", expected: "E_SYMLINK_ENTRY", reader: "world", build: () => pkg(withFile("assets/link.txt", Buffer.from("/etc/passwd"), "text/plain"), { entryPatch: { "assets/link.txt": { method: 0, madeByOs: 0, unixMode: 0o120777 } } }) },
  { id: "symlink-host10", description: "symlink mode, made by NTFS (host 10)", expected: "E_SYMLINK_ENTRY", reader: "world", build: () => pkg(withFile("assets/link.txt", Buffer.from("/etc/passwd"), "text/plain"), { entryPatch: { "assets/link.txt": { method: 0, madeByOs: 10, unixMode: 0o120777 } } }) },
  { id: "symlink-host5", description: "symlink mode, made by Atari (host 5)", expected: "E_SYMLINK_ENTRY", reader: "world", build: () => pkg(withFile("assets/link.txt", Buffer.from("/etc/passwd"), "text/plain"), { entryPatch: { "assets/link.txt": { method: 0, madeByOs: 5, unixMode: 0o120777 } } }) },
  { id: "fifo-host19", description: "FIFO mode, made by OS X (host 19)", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(withFile("assets/fifo.txt", Buffer.from("x"), "text/plain"), { entryPatch: { "assets/fifo.txt": { method: 0, madeByOs: 19, unixMode: 0o010644 } } }) },
  { id: "host-unsupported", description: "regular file made by BeOS (host 16)", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { madeByOs: 16 } } }) },
  { id: "dir-mode-on-file", description: "directory mode on a listed file name", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(withFile("assets/d.txt", Buffer.from("x"), "text/plain"), { entryPatch: { "assets/d.txt": { unixMode: 0o040755 } } }) },
  { id: "dir-with-content", description: "directory entry assets/ carrying data", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/", Buffer.from("hidden"), { method: 0, unixMode: 0o040755 })) },
  { id: "dos-dir-bit-on-file", description: "DOS directory attribute on a listed file (host 0)", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { madeByOs: 0, externalAttrs: 0x10 } } }) },

  // review round 1: header and layout divergences (each check has its own fixture)
  { id: "version-needed-45", description: "version needed to extract 4.5 in both headers", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { versionNeeded: 45 } } }) },
  { id: "local-version-differs", description: "local version needed 10, central 20", expected: "E_HEADER_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { localVersion: 10 } } }) },
  { id: "local-method-differs", description: "local method stored, central deflate", expected: "E_HEADER_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { localMethod: 0 } } }) },
  { id: "local-crc-differs", description: "local CRC-32 differs, central correct", expected: "E_HEADER_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { localCrc: 0xdeadbeef } } }) },
  { id: "local-extra-only", description: "Unicode Path extra field (0x7075) in the local header only", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { localExtra: [{ id: 0x7075, data: Buffer.concat([Buffer.from([1, 0, 0, 0, 0]), Buffer.from("evil.json")]) }] } } }) },
  { id: "tail-before-cd", description: "4 KiB hidden between the last entry and the central directory", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: () => withTail(pkg(), Buffer.from("HIDDEN-PAYLOAD-".repeat(256))) },
  { id: "cd-junk-counted", description: "junk after the central records, counted in the EOCD cd size", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: () => pkg(BASE_FILES, { archive: { cdJunk: { bytes: Buffer.from("JUNK".repeat(16)), inCdSize: true } } }) },
  { id: "cd-junk-uncounted", description: "junk between the central directory and the EOCD", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: () => pkg(BASE_FILES, { archive: { cdJunk: { bytes: Buffer.from("JUNK".repeat(16)), inCdSize: false } } }) },
  { id: "eocd-count-lies", description: "EOCD declares one entry fewer than the central directory holds", expected: "E_ARCHIVE_LAYOUT", reader: "world", build: () => pkg(BASE_FILES, { archive: { eocdEntryCount: 2 } }) },

  // review round 1: content signatures
  { id: "exec-html-after-whitespace", description: "10,000 spaces, then <html>, named .txt", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from(" ".repeat(10_000) + "<html><script>alert(1)</script>"), "text/plain")) },
  { id: "exec-pdf", description: "PDF named .txt", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/doc.txt", Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"), "text/plain")) },
  { id: "exec-php", description: "<?php named .txt", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from("<?php system($_GET[1]); ?>"), "text/plain")) },
  { id: "exec-svg-vtab", description: "<svg followed by a vertical tab", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from("<svg\u000bonload=alert(1)>"), "text/plain")) },
  { id: "exec-ns-script", description: "<x:script> with a namespace prefix", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from("<x:script xmlns:x='http://www.w3.org/1999/xhtml'>alert(1)</x:script>"), "text/plain")) },

  // review round 1: JSON (I-JSON, depth before parse)
  { id: "json-deep-stored", description: "1,000,000 nested arrays, stored (2 MB)", expected: "E_JSON_TOO_DEEP", reader: "world", build: () => pkg(withFile("assets/deep.json", Buffer.from("[".repeat(1_000_000) + "]".repeat(1_000_000)), "application/json"), { entryPatch: { "assets/deep.json": { method: 0 } } }) },
  { id: "json-nonfinite", description: "number 1e400 (overflows to Infinity)", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/n.json", Buffer.from('{"n":1e400}'), "application/json")) },
  { id: "json-underflow", description: "number 1e-400 (underflows to 0)", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/n.json", Buffer.from('{"n":1e-400}'), "application/json")) },
  { id: "json-unsafe-int", description: "integer 12345678901234567890 outside the safe range", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/n.json", Buffer.from('{"n":12345678901234567890}'), "application/json")) },
  { id: "json-precision-loss", description: "22 significant digits, not the exact value of a double", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/n.json", Buffer.from('{"n":0.1000000000000000000001}'), "application/json")) },
  { id: "json-lone-surrogate", description: "string escape \\ud800 without a low surrogate", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/s.json", Buffer.from('{"s":"\\ud800"}'), "application/json")) },
  { id: "json-lone-low-surrogate", description: "string escape \\udc00 without a high surrogate", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/s.json", Buffer.from('{"s":"a\\udc00"}'), "application/json")) },
  { id: "world-json-nonfinite", description: "world.json with 1e400", expected: "E_JSON_INVALID", reader: "world", build: () => pkg({ ...BASE_FILES, "world.json": { data: Buffer.from('{"id":"x","n":1e400}'), mediaType: "application/json" } }) },

  // review round 2 (delta, 2026-10-03)
  { id: "json-unsafe-int-value", description: "9007199254740992 (2^53, integer value outside the safe range)", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/n.json", Buffer.from('{"n":9007199254740992}'), "application/json")) },
  { id: "json-unsafe-int-exp", description: "1e16 (integer value outside the safe range, exponent form)", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/n.json", Buffer.from('{"n":1e16}'), "application/json")) },
  { id: "json-unsafe-int-frac", description: "9007199254740992.0 (integer value outside the safe range, fraction form)", expected: "E_JSON_INVALID", reader: "world", build: () => pkg(withFile("assets/n.json", Buffer.from('{"n":9007199254740992.0}'), "application/json")) },
  { id: "exec-pdf-in-image", description: "PNG with a %PDF- header at byte 100", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/p.png", Buffer.concat([PNG, Buffer.alloc(100 - PNG.length), Buffer.from("%PDF-1.7\n")]), "image/png")) },
  { id: "exec-pdf-after-whitespace", description: "whitespace, then %PDF-, named .txt", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/doc.txt", Buffer.from("\n\n  %PDF-1.7\n"), "text/plain")) },

  // review round 3 (Codex hints, 2026-10-03)
  { id: "dir-with-data-lying", description: "directory entry holding 'MZ' (stored) with uncompressed size 0", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/", Buffer.from("MZ"), { method: 0, lieUncompressedSize: 0, unixMode: 0o040755 })) },
  { id: "dir-deflate-bad-crc", description: "empty deflate directory entry with CRC 0x12345678", expected: "E_CRC_MISMATCH", reader: "world", build: () => pkg(BASE_FILES, x("assets/", Buffer.alloc(0), { method: 8, crc: 0x12345678, unixMode: 0o040755 })) },
  { id: "dir-deflate-not-empty", description: "deflate directory entry whose 2 compressed bytes are not the empty stream", expected: "E_SPECIAL_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/", Buffer.alloc(0), { method: 8, rawCompressed: Buffer.from("MZ"), crc: 0, unixMode: 0o040755 })) },
  { id: "exec-ns-script-nbsp", description: "<x:script followed by U+00A0", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from("<x:script\u00a0>alert(1)"), "text/plain")) },
  // Codex audit r3 (2026-10-03)
  { id: "disk-start-nonzero", description: "central record says the entry starts on disk 1", expected: "E_UNSUPPORTED_ZIP_FEATURE", reader: "world", build: () => pkg(BASE_FILES, { entryPatch: { "world.json": { diskStart: 1 } } }) },
  { id: "dir-unlisted-empty", description: "empty directory entry not-listed/ that is no parent of a listed file", expected: "E_UNLISTED_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("not-listed/", Buffer.alloc(0), { method: 0, unixMode: 0o040755 })) },
  { id: "dir-unlisted-nested", description: "directory assets/extra/ beneath a parent of a listed file", expected: "E_UNLISTED_ENTRY", reader: "world", build: () => pkg(BASE_FILES, x("assets/extra/", Buffer.alloc(0), { method: 0, unixMode: 0o040755 })) },
  { id: "manifest-files-flood", description: "manifest with files: Array(100000).fill(0)", expected: "E_MANIFEST_INVALID", reader: "world", build: () => pkg(BASE_FILES, { manifestBytes: Buffer.from(JSON.stringify({ ...manifestFor(BASE_FILES), files: Array(100000).fill(0) })), entryPatch: { "manifest.json": { method: 0 } } }) },
  { id: "manifest-files-missing", description: "manifest without a files field", expected: "E_MANIFEST_INVALID", reader: "world", build: () => pkg(BASE_FILES, { manifestBytes: Buffer.from(JSON.stringify({ ...manifestFor(BASE_FILES), files: undefined })) }) },
  { id: "checker-files-flood", description: "checker manifest with files: Array(100000).fill(0)", expected: "E_MANIFEST_INVALID", reader: "checker", build: () => checkerBundle({ manifestBytes: Buffer.from(JSON.stringify({ ...manifestFor(CHECKER_FILES, { format: "practonaut.checker-bundle" }), files: Array(100000).fill(0) })), entryPatch: { "manifest.json": { method: 0 } } }) },
  { id: "exec-long-ns-prefix", description: "<x…x:script> with a 100-character namespace prefix", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from(`<${"x".repeat(100)}:script xmlns:${"x".repeat(100)}='http://www.w3.org/1999/xhtml'>alert(1)</${"x".repeat(100)}:script>`), "text/plain")) },
  { id: "exec-input-onfocus", description: "<input autofocus onfocus=alert(1)> named .txt", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from("<input autofocus onfocus=alert(1)>"), "text/plain")) },
  { id: "exec-unknown-tag", description: "<custom-el onclick=x> named .txt", expected: "E_EXECUTABLE_CONTENT", reader: "world", build: () => pkg(withFile("assets/a.txt", Buffer.from("<custom-el onclick=x>hi</custom-el>"), "text/plain")) },
];

/** Inserts `tail` between the last local entry and the central directory and fixes the EOCD offset. */
function withTail(zip: Buffer, tail: Buffer): Buffer {
  const eocd = zip.length - 22;
  const cdOffset = zip.readUInt32LE(eocd + 16);
  const out = Buffer.concat([zip.subarray(0, cdOffset), tail, zip.subarray(cdOffset)]);
  out.writeUInt32LE(cdOffset + tail.length, out.length - 22 + 16);
  return out;
}

/** A valid package written the way a generic zip tool would: deflate, directory entries, timestamp extra fields. */
export function thirdPartyStylePackage(): Buffer {
  const ts = { id: 0x5455, data: Buffer.from([1, 0, 0, 0, 0]) };
  return pkg(BASE_FILES, {
    entryPatch: { "world.json": { extra: [ts] }, "assets/marker.png": { method: 0 } },
    extraEntries: [{ name: "assets/", data: Buffer.alloc(0), method: 0, unixMode: 0o040755 }],
  });
}

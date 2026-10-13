// Media-type allowlist and content sniffing (threat model T1.6, invariant I7).
//
// Order of checks for every file entry:
//   1. executable signatures on the content, whatever the name says (E_EXECUTABLE_CONTENT);
//   2. extension: forbidden active types (E_EXECUTABLE_CONTENT), unknown (E_UNSUPPORTED_MEDIA_TYPE);
//   3. declared media type must equal the one the extension maps to (E_MEDIA_TYPE_MISMATCH);
//   4. content must match the media type: magic bytes for images, strict UTF-8 (+JSON) for text
//      (E_MEDIA_TYPE_MISMATCH, E_JSON_INVALID, E_JSON_TOO_DEEP).
//
// Known limits of this check (documented, not hidden):
// - image validation is magic bytes only; a polyglot (valid PNG header followed by HTML) passes.
//   The player must serve assets with their declared type and `X-Content-Type-Options: nosniff`.
// - markup is recognised at the start of the content (after a BOM and any leading whitespace);
//   PDF anywhere in the first 1024 bytes. Script or CSS text without markup in a text/plain entry
//   (for example `alert(1)` or `body{...}`) is NOT recognisable as such; it is safe only because
//   the player serves text/plain with `nosniff` and renders it as text, never as code.
import { PackageError } from "./errors.ts";
import { decodeUtf8, parseJsonEntry } from "./json.ts";

export const MEDIA_TYPES = ["application/json", "text/plain", "image/png", "image/jpeg", "image/webp"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const EXTENSION_MEDIA_TYPES: Readonly<Record<string, MediaType>> = Object.freeze({
  ".json": "application/json",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
});

/** Extensions of content a browser or the host could execute or interpret as active content. */
export const FORBIDDEN_EXTENSIONS: ReadonlySet<string> = new Set([
  ".svg", ".svgz", ".html", ".htm", ".xhtml", ".xht", ".xml", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx",
  ".wasm", ".css", ".sh", ".bash", ".zsh", ".py", ".rb", ".pl", ".php", ".exe", ".dll", ".so", ".dylib", ".bin", ".node",
  ".bat", ".cmd", ".ps1", ".jar", ".class", ".swf", ".pdf",
]);

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot).toLowerCase();
}

function startsWith(data: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (data.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (data[offset + i] !== sig[i]) return false;
  return true;
}

const BINARY_EXEC: ReadonlyArray<readonly [string, readonly number[]]> = [
  ["ELF executable", [0x7f, 0x45, 0x4c, 0x46]],
  ["Mach-O executable", [0xfe, 0xed, 0xfa, 0xce]],
  ["Mach-O executable", [0xfe, 0xed, 0xfa, 0xcf]],
  ["Mach-O executable", [0xce, 0xfa, 0xed, 0xfe]],
  ["Mach-O executable", [0xcf, 0xfa, 0xed, 0xfe]],
  ["Mach-O universal binary or Java class", [0xca, 0xfe, 0xba, 0xbe]],
  ["PE/DOS executable", [0x4d, 0x5a]], // "MZ"
  ["WebAssembly module", [0x00, 0x61, 0x73, 0x6d]], // "\0asm"
  ["script with shebang", [0x23, 0x21]], // "#!"
];

// Any tag at the start of the content is rejected (see tagAt). These element names are rejected
// even when the tag name runs on into an unusual character: WHATWG MIME Sniffing §7.1 "HTML"
// patterns plus SVG/MathML roots and elements that load or embed other content. Matched
// case-insensitively on the local name, so a namespace prefix (`<x:script>`) does not hide it.
const MARKUP_TAGS: ReadonlySet<string> = new Set([
  "html", "head", "body", "script", "iframe", "frame", "frameset", "h1", "div", "font", "table", "a", "style", "title", "b",
  "br", "p", "svg", "math", "object", "embed", "applet", "img", "image", "link", "meta", "base", "form", "template", "noscript", "xml",
]);

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
/** PDF readers accept the header anywhere in the first 1024 bytes (ISO 32000-1 implementation note). */
const PDF_WINDOW = 1024;

function isSkippable(b: number): boolean {
  // NUL (UTF-16 padding), TAB, LF, VT, FF, CR, SPACE
  return b === 0x00 || (b >= 0x09 && b <= 0x0d) || b === 0x20;
}

/** Offset of the first content byte after a BOM and ANY amount of leading whitespace (linear, no cap). */
function contentStart(data: Uint8Array): number {
  let start = 0;
  if (startsWith(data, [0xef, 0xbb, 0xbf])) start = 3;
  else if (startsWith(data, [0xfe, 0xff]) || startsWith(data, [0xff, 0xfe])) start = 2;
  while (start < data.length && isSkippable(data[start] as number)) start++;
  return start;
}

/** Lower-cased ASCII view of the first 64 characters at `start` (NUL bytes of UTF-16 text skipped). */
function leadingText(data: Uint8Array, start: number): string {
  let out = "";
  for (let i = start; i < data.length && out.length < 64; i++) {
    const b = data[i] as number;
    if (b === 0x00) continue; // UTF-16 interleaving
    out += String.fromCharCode(b);
  }
  return out.toLowerCase();
}

const isLetter = (b: number): boolean => (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
const isNameChar = (b: number): boolean => isLetter(b) || (b >= 0x30 && b <= 0x39) || b === 0x5f || b === 0x2e || b === 0x3a || b === 0x2d;

/**
 * Reads a start or end tag at `start` without a length cap (linear in the tag name). Returns the
 * qualified name if the content opens with markup: `<` (or `</`), a name starting with a letter or
 * `_`, followed by whitespace, `/`, `>` or the end of the data, or a known active element in any
 * other position (`<x:script`, `<svg\v`). Otherwise null (`<3`, `<name@example.org>`).
 */
function tagAt(data: Uint8Array, start: number): string | null {
  let i = start;
  const next = (): number | undefined => {
    while (i < data.length && data[i] === 0x00) i++; // UTF-16 interleaving
    return data[i];
  };
  if (next() !== 0x3c) return null;
  i++;
  if (next() === 0x2f) i++;
  const first = next();
  if (first === undefined || !(isLetter(first) || first === 0x5f)) return null;
  let name = "";
  for (let b = next(); b !== undefined && isNameChar(b); b = next()) {
    name += String.fromCharCode(b);
    i++;
  }
  const after = next();
  const qname = name.toLowerCase();
  const local = qname.slice(qname.lastIndexOf(":") + 1);
  if (after === undefined || after === 0x2f || after === 0x3e || isSkippable(after) || MARKUP_TAGS.has(local)) return qname;
  return null;
}

function containsWithin(data: Uint8Array, sig: readonly number[], window: number): boolean {
  const last = Math.min(data.length - sig.length, window - sig.length);
  for (let i = 0; i <= last; i++) if (startsWith(data, sig, i)) return true;
  return false;
}

/**
 * Returns a description if `data` starts like executable or active content, else null.
 * `textual` (JSON and plain text): `%PDF-` counts only at the start after whitespace, so a task
 * text that mentions "%PDF-1.7" is not rejected. Otherwise (images, unknown) the 1024-byte window
 * applies, because PDF readers find a header there.
 */
export function detectExecutable(data: Uint8Array, textual = false): string | null {
  for (const [label, sig] of BINARY_EXEC) if (startsWith(data, sig)) return label;
  if (!textual && containsWithin(data, PDF_SIGNATURE, PDF_WINDOW)) return "PDF document";
  const start = contentStart(data);
  const head = leadingText(data, start);
  if (head.startsWith("%pdf-")) return "PDF document";
  if (head.startsWith("<?")) return "processing instruction (<?xml, <?php ...)";
  if (head.startsWith("<!")) return "markup declaration (<!doctype, <!--, <![CDATA[ ...)";
  const tag = tagAt(data, start);
  if (tag !== null) return `markup tag <${tag.length > 40 ? tag.slice(0, 40) + "..." : tag}>`;
  if (head.startsWith("javascript:")) return "javascript: URL";
  return null;
}

function contentMatches(mediaType: MediaType, data: Uint8Array): boolean {
  switch (mediaType) {
    case "image/png":
      return startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(data, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data, [0x57, 0x45, 0x42, 0x50], 8); // RIFF....WEBP
    case "application/json":
    case "text/plain":
      return true; // checked by decoding below
  }
}

/** Media type for a path by extension, or a PackageError for forbidden and unknown extensions. */
export function mediaTypeForPath(path: string): MediaType {
  const ext = extensionOf(path);
  if (FORBIDDEN_EXTENSIONS.has(ext)) throw new PackageError("E_EXECUTABLE_CONTENT", `extension '${ext}' is active content`, path);
  const mt = EXTENSION_MEDIA_TYPES[ext];
  if (!mt) throw new PackageError("E_UNSUPPORTED_MEDIA_TYPE", ext ? `extension '${ext}' is not allowed` : "file has no extension", path);
  return mt;
}

/**
 * Validates one file's content against its path and declared media type.
 * Returns the parsed JSON value for application/json, else undefined.
 */
export function validateContent(path: string, declared: string, data: Uint8Array, maxJsonDepth: number): unknown {
  const ext = extensionOf(path);
  const exec = detectExecutable(data, ext === ".json" || ext === ".txt");
  if (exec) throw new PackageError("E_EXECUTABLE_CONTENT", `content looks like ${exec}`, path);
  const expected = mediaTypeForPath(path);
  if (declared !== expected) throw new PackageError("E_MEDIA_TYPE_MISMATCH", `declared ${declared}, extension implies ${expected}`, path);
  if (!contentMatches(expected, data)) throw new PackageError("E_MEDIA_TYPE_MISMATCH", `content does not match ${expected}`, path);
  if (expected === "text/plain") {
    let text: string;
    try {
      text = decodeUtf8(data, path);
    } catch {
      throw new PackageError("E_MEDIA_TYPE_MISMATCH", "text/plain entry is not valid UTF-8 without BOM", path);
    }
    if (text.includes("\0")) throw new PackageError("E_MEDIA_TYPE_MISMATCH", "text/plain entry contains NUL", path);
    return undefined;
  }
  if (expected === "application/json") return parseJsonEntry(data, path, maxJsonDepth);
  return undefined;
}

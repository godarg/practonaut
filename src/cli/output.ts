// Output helpers for the CLI: terminal-safe text and shareable paths.
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, normalize, relative, resolve } from "node:path";

// Everything outside printable ASCII is escaped: controls, bidi and format characters, tag
// characters (U+E0000 block), soft hyphens, look-alikes. Output that may reach a terminal, a log
// or an LLM shows exactly which code points a hostile name contains.
const NOT_PRINTABLE_ASCII = /[^\x20-\x7e]/gu;

/** Terminal-safe text: every code point outside U+0020..U+007E becomes \u{XXXX}. */
export function safeText(s: string): string {
  return s.replace(NOT_PRINTABLE_ASCII, (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}}`);
}

/** Readable text for content the package ships (library titles, prompts): letters and punctuation of
 * any script stay; controls, format, separator, private-use and unassigned code points are escaped. */
export function readableText(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/gu, (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}}`);
}

/** JSON text that is pure printable ASCII plus layout newlines; other characters become \uXXXX escapes (still valid JSON). */
export function safeJson(value: unknown): string {
  // Applied per UTF-16 code unit, so astral characters become escaped surrogate pairs.
  return JSON.stringify(value, null, 2).replace(/[^\n\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    try {
      return resolve(realpathSync(dirname(p)), basename(p)); // e.g. an --out file that does not exist yet
    } catch {
      return resolve(p);
    }
  }
}

/**
 * Path relative to the current working directory, so shared output carries no home path.
 * Relative input is shown as given (normalised); absolute input is made relative after
 * resolving symlinks on both sides (macOS: /var -> /private/var).
 */
export function displayPath(p: string): string {
  if (!isAbsolute(p)) return normalize(p).split("\\").join("/");
  const target = real(p);
  const rel = relative(real(process.cwd()), target);
  if (rel === "") return ".";
  // Walking up out of the cwd into the home directory would spell out the account name.
  const home = real(homedir());
  if (rel.startsWith("..") && (target === home || target.startsWith(home + "/"))) return "~/" + relative(home, target).split("\\").join("/");
  return isAbsolute(rel) ? rel : rel.split("\\").join("/");
}

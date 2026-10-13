// Strict JSON decoding for package entries: UTF-8 (fatal), no BOM, I-JSON (RFC 7493), bounded depth.
//
// A single linear byte scan runs BEFORE any decoding or JSON.parse, so a hostile entry is rejected
// before the parser allocates its structure:
// - nesting depth of arrays/objects (brackets inside strings and escapes do not count);
// - string escapes: a \uD800-\uDBFF escape must be followed by a \uDC00-\uDFFF escape, and a low
//   surrogate escape must follow a high one (I-JSON §2.1; raw lone surrogates cannot occur in
//   valid UTF-8, which the fatal decoder enforces);
// - number literals (I-JSON §2.2, rule in numberProblem): finite, no underflow of a non-zero
//   literal to 0, integer values only within ±(2^53−1), and at most 17 significant digits unless
//   the literal is the exact decimal value of the double.
// JSON.parse then decides syntax; the scan only rejects, it never accepts on its own.
import { PackageError } from "./errors.ts";

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function decodeUtf8(data: Uint8Array, entry: string): string {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    throw new PackageError("E_JSON_INVALID", "byte order mark is not allowed", entry);
  }
  try {
    return decoder.decode(data);
  } catch {
    throw new PackageError("E_JSON_INVALID", "not valid UTF-8", entry);
  }
}

const STRICT_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/** Significant digits (no leading/trailing zeros) and decimal exponent of a literal: value = 0.DIGITS × 10^point. */
function decimalParts(lit: string): { digits: string; point: number } {
  const m = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(lit);
  if (!m) return { digits: "", point: 0 };
  const int = m[1] as string;
  const frac = m[2] ?? "";
  const exp = m[3] === undefined ? 0 : Number(m[3]);
  let digits = int + frac;
  let point = int.length + exp;
  const lead = /^0*/.exec(digits)?.[0].length ?? 0;
  digits = digits.slice(lead);
  point -= lead;
  digits = digits.replace(/0+$/, "");
  return digits === "" ? { digits: "", point: 0 } : { digits, point };
}

/** Exact decimal value of a finite double, in the same form as decimalParts. */
function exactDoubleParts(v: number): { digits: string; point: number } {
  if (v === 0) return { digits: "", point: 0 };
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(v));
  const bits = view.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const fracBits = bits & ((1n << 52n) - 1n);
  const mantissa = expBits === 0 ? fracBits : fracBits | (1n << 52n);
  const e2 = (expBits === 0 ? 1 : expBits) - 1075; // value = mantissa × 2^e2
  // mantissa × 2^e2 = mantissa × 5^-e2 / 10^-e2 for e2 < 0
  const intDigits = e2 >= 0 ? (mantissa << BigInt(e2)).toString() : (mantissa * 5n ** BigInt(-e2)).toString();
  const scale = e2 >= 0 ? 0 : -e2;
  return decimalParts(scale === 0 ? intDigits : `${intDigits}e-${scale}`);
}

/** At most 17 significant digits always identify one double uniquely (IEEE 754-2008 §5.12.2). */
const MAX_SIGNIFICANT_DIGITS = 17;

/**
 * Returns a reason if the number literal is not I-JSON-safe (RFC 7493 §2.2), else null.
 * Accepted: a finite value; no non-zero literal that underflows to 0; an integer value only within
 * ±(2^53−1) (whatever the literal's form: 9007199254740992, 9007199254740992.0 and 1e16 all fail);
 * and either at most 17 significant digits or exactly the decimal value of the resulting double.
 * Non-JSON tokens are left to JSON.parse.
 */
export function numberProblem(lit: string): string | null {
  if (!STRICT_NUMBER.test(lit)) return null;
  const v = Number(lit);
  if (!Number.isFinite(v)) return `number ${lit} overflows a double`;
  const parts = decimalParts(lit);
  if (v === 0 && parts.digits !== "") return `number ${lit} underflows to 0`;
  if (Number.isInteger(v) && !Number.isSafeInteger(v)) return `number ${lit} is an integer outside the safe range ±(2^53-1)`;
  if (parts.digits.length > MAX_SIGNIFICANT_DIGITS) {
    const exact = exactDoubleParts(v);
    if (exact.digits !== parts.digits || exact.point !== parts.point) {
      return `number ${lit} has more than ${MAX_SIGNIFICANT_DIGITS} significant digits and is not the exact value of a double`;
    }
  }
  return null;
}

function isHex(b: number | undefined): boolean {
  return b !== undefined && ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66));
}

function isNumberByte(b: number): boolean {
  return (b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x2b || b === 0x2e || b === 0x65 || b === 0x45;
}

/** Linear pre-scan; throws E_JSON_TOO_DEEP or E_JSON_INVALID. Exported for tests. */
export function prescanJson(data: Uint8Array, entry: string, maxDepth: number): void {
  const n = data.length;
  let depth = 0;
  let i = 0;
  const lone = (): never => {
    throw new PackageError("E_JSON_INVALID", "lone UTF-16 surrogate escape in a string", entry);
  };
  while (i < n) {
    const b = data[i] as number;
    if (b === 0x22) {
      // string
      i++;
      let pendingHigh = false;
      while (i < n) {
        const c = data[i] as number;
        if (c === 0x22) {
          if (pendingHigh) lone();
          i++;
          break;
        }
        if (c === 0x5c) {
          const e = data[i + 1];
          if (e === 0x75 && isHex(data[i + 2]) && isHex(data[i + 3]) && isHex(data[i + 4]) && isHex(data[i + 5])) {
            const cu = parseInt(String.fromCharCode(data[i + 2] as number, data[i + 3] as number, data[i + 4] as number, data[i + 5] as number), 16);
            if (cu >= 0xd800 && cu <= 0xdbff) {
              if (pendingHigh) lone();
              pendingHigh = true;
            } else if (cu >= 0xdc00 && cu <= 0xdfff) {
              if (!pendingHigh) lone();
              pendingHigh = false;
            } else if (pendingHigh) {
              lone();
            }
            i += 6;
          } else {
            if (pendingHigh) lone();
            i += 2;
          }
          continue;
        }
        if (pendingHigh) lone();
        i++;
      }
      continue;
    }
    if (b === 0x5b || b === 0x7b) {
      depth++;
      if (depth > maxDepth) throw new PackageError("E_JSON_TOO_DEEP", `nesting depth exceeds ${maxDepth}`, entry);
      i++;
      continue;
    }
    if (b === 0x5d || b === 0x7d) {
      depth--;
      i++;
      continue;
    }
    if (b === 0x2d || (b >= 0x30 && b <= 0x39)) {
      let j = i;
      while (j < n && isNumberByte(data[j] as number)) j++;
      if (j - i <= 1024) {
        const problem = numberProblem(String.fromCharCode(...data.subarray(i, j)));
        if (problem) throw new PackageError("E_JSON_INVALID", problem, entry);
      } else {
        throw new PackageError("E_JSON_INVALID", "number literal longer than 1024 characters", entry);
      }
      i = j;
      continue;
    }
    i++;
  }
}

export function parseJsonEntry(data: Uint8Array, entry: string, maxDepth: number): unknown {
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    throw new PackageError("E_JSON_INVALID", "byte order mark is not allowed", entry);
  }
  prescanJson(data, entry, maxDepth);
  const text = decodeUtf8(data, entry);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new PackageError("E_JSON_INVALID", `not valid JSON: ${(e as Error).message}`, entry);
  }
}

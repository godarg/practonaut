// Canonical JSON (RFC 8785 / JCS rules) and the state hash.
//
// Rules, as in the runtime-parity spike, plus the hardening listed below:
// - object keys sorted by UTF-16 code units (RFC 8785 §3.2.3; `Array.prototype.sort` without a
//   comparator compares exactly that);
// - numbers via the ECMAScript Number-to-String algorithm (RFC 8785 §3.2.2.3), -0 becomes 0;
// - strings via JSON.stringify (RFC 8785 §3.2.2.2 uses the same escaping rules);
// - anything that is not plain JSON throws instead of being dropped or coerced:
//   non-finite numbers, bigint, undefined, functions, symbols, Date/Map/class instances,
//   sparse arrays, arrays with extra or hidden properties, objects with non-enumerable, accessor
//   or symbol keys, lone UTF-16 surrogates (I-JSON, RFC 7493 §2.1), cycles, nesting deeper
//   than MAX_CANONICAL_DEPTH.
import { createHash } from "node:crypto";

export const MAX_CANONICAL_DEPTH = 64;

export class CanonicalError extends Error {
  readonly code = "E_NON_CANONICAL_VALUE";
  constructor(message: string) {
    super(message);
    this.name = "CanonicalError";
  }
}

// A lone surrogate is a high surrogate not followed by a low one, or a low one not preceded by a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function canonicalString(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new CanonicalError("string contains a lone UTF-16 surrogate");
  return JSON.stringify(s);
}

function serialize(value: unknown, depth: number): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new CanonicalError(`nesting deeper than ${MAX_CANONICAL_DEPTH}`);
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new CanonicalError(`non-finite number: ${String(value)}`);
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return canonicalString(value);
    case "object": {
      if (Object.getOwnPropertySymbols(value).length > 0) throw new CanonicalError("value has symbol keys");
      if (Array.isArray(value)) {
        if (Object.getPrototypeOf(value) !== Array.prototype) throw new CanonicalError("array subclass");
        // Own property names must be exactly the indices 0..length-1 and "length": no extra or
        // hidden properties that a serializer would drop silently.
        if (Object.getOwnPropertyNames(value).length !== value.length + 1) throw new CanonicalError("array with extra or hidden properties, or holes");
        const parts: string[] = [];
        for (let i = 0; i < value.length; i++) {
          const d = Object.getOwnPropertyDescriptor(value, i);
          if (!d) throw new CanonicalError(`sparse array (hole at index ${i})`);
          if (!("value" in d)) throw new CanonicalError(`accessor at index ${i}`);
          parts.push(serialize(d.value, depth + 1));
        }
        return "[" + parts.join(",") + "]";
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new CanonicalError("non-plain object");
      const names = Object.getOwnPropertyNames(value);
      const keys = Object.keys(value);
      if (names.length !== keys.length) throw new CanonicalError("object has non-enumerable properties");
      keys.sort();
      const parts: string[] = [];
      for (const k of keys) {
        const d = Object.getOwnPropertyDescriptor(value, k) as PropertyDescriptor;
        if (!("value" in d)) throw new CanonicalError(`accessor property '${k}'`);
        parts.push(canonicalString(k) + ":" + serialize(d.value, depth + 1));
      }
      return "{" + parts.join(",") + "}";
    }
    default:
      throw new CanonicalError(`unsupported type: ${typeof value}`);
  }
}

/** Canonical JSON text of a plain JSON value. Throws CanonicalError for anything else. */
export function canonicalJson(value: unknown): string {
  return serialize(value, 0);
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** SHA-256 (hex) of the UTF-8 bytes of the canonical JSON of `value` (glossary: "State hash"). */
export function stateHash(value: unknown): string {
  return sha256Hex(Buffer.from(canonicalJson(value), "utf8"));
}

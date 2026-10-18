/** Variant token substitution, shared by variant generation and world validation (no imports of
 * either, so neither depends on the other). */
import type { Variant } from "./types.ts";

/** {{token}} values of one case: labels, the world/1 insertion position and world/2 params. */
export function variantTokens(variant: Variant): Record<string, string> {
  const tokens: Record<string, string> = { ...variant.labels };
  if (variant.insertPosition !== undefined) tokens.insertPosition = String(variant.insertPosition);
  for (const [key, value] of Object.entries(variant.params ?? {})) tokens[key] = String(value);
  return tokens;
}
/** Exact single-pass token substitution; text inside a substituted value is never re-read. */
export function substituteTokens(s: string, tokens: Record<string, string>): string {
  let out = "";
  let cursor = 0;
  while (cursor < s.length) {
    const open = s.indexOf("{{", cursor);
    if (open < 0) return out + s.slice(cursor);
    const close = s.indexOf("}}", open + 2);
    if (close < 0) return out + s.slice(cursor);
    out += s.slice(cursor, open);
    const key = s.slice(open + 2, close);
    out += Object.hasOwn(tokens, key) ? tokens[key]! : s.slice(open, close + 2);
    cursor = close + 2;
  }
  return out;
}

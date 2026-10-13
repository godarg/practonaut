// Documentation that restates a code-level list must match the code (single source of truth).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PACKAGE_ERROR_CODES } from "../../src/package/errors.ts";

const root = new URL("../../", import.meta.url);

test("docs/world-format.md lists exactly the package error codes in code order", () => {
  const doc = readFileSync(new URL("docs/world-format.md", root), "utf8");
  const start = doc.indexOf("<!-- error-codes:start -->");
  const end = doc.indexOf("<!-- error-codes:end -->");
  assert.ok(start >= 0 && end > start, "error-code markers missing in docs/world-format.md");
  const listed = [...doc.slice(start, end).matchAll(/^\| `(E_[A-Z0-9_]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(listed, [...PACKAGE_ERROR_CODES]);
});

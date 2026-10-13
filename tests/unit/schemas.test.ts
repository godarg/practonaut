// Generated JSON Schemas agree with the zod source of truth and carry the v1 contract.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SCHEMA_FILES, generate } from "../../tools/schemas.ts";

describe("schemas/", () => {
  for (const entry of SCHEMA_FILES) {
    it(`${entry.file} is up to date with the zod schema`, () => {
      const committed = readFileSync(new URL(`../../schemas/${entry.file}`, import.meta.url), "utf8");
      assert.equal(committed, generate(entry));
    });
  }

  it("world manifest: strict objects, no visibility, media-type allowlist", () => {
    const s = JSON.parse(readFileSync(new URL("../../schemas/world-package-manifest.v1.schema.json", import.meta.url), "utf8")) as Record<string, any>; // any: walking a generated JSON document
    assert.equal(s.additionalProperties, false);
    assert.equal(s.properties.format.const, "practonaut.world-package");
    const item = s.properties.files.items;
    assert.equal(item.additionalProperties, false);
    assert.equal("visibility" in item.properties, false);
    assert.deepEqual(item.properties.mediaType.enum, ["application/json", "text/plain", "image/png", "image/jpeg", "image/webp"]);
    assert.deepEqual([...s.required].sort(), ["entry", "files", "format", "schemaVersion", "world"]);
  });

  it("checker bundle manifest has its own format and no entry", () => {
    const s = JSON.parse(readFileSync(new URL("../../schemas/checker-bundle-manifest.v1.schema.json", import.meta.url), "utf8")) as Record<string, any>; // any: walking a generated JSON document
    assert.equal(s.properties.format.const, "practonaut.checker-bundle");
    assert.equal("entry" in s.properties, false);
  });
});

// tools/clean.ts removes exactly dist/, coverage/ and .local/demo/ under the given root.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { CLEAN_TARGETS, clean } from "../../tools/clean.ts";

let tmp = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "practonaut-clean-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function put(root: string, rel: string, data = "x"): void {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), data);
}

describe("clean", () => {
  it("targets exactly dist/, coverage/ and .local/demo/", () => {
    assert.deepEqual([...CLEAN_TARGETS], ["dist", "coverage", ".local/demo"]);
  });

  it("removes the targets, keeps everything else, and is idempotent", () => {
    const root = join(tmp, "repo");
    put(root, "dist/index.js");
    put(root, "coverage/lcov.info");
    put(root, ".local/demo/minimal.pnworld");
    put(root, ".local/penpot/.env", "KEEP");
    put(root, "spikes/runtime-parity/out/run.json", "KEEP");
    put(root, "src/index.ts", "KEEP");
    put(tmp, "outside.txt", "KEEP");
    const first = clean(root);
    assert.deepEqual(first.removed.sort(), [".local/demo", "coverage", "dist"]);
    for (const gone of ["dist", "coverage", ".local/demo"]) assert.ok(!existsSync(join(root, gone)), gone);
    for (const kept of [".local/penpot/.env", "spikes/runtime-parity/out/run.json", "src/index.ts"]) assert.equal(readFileSync(join(root, kept), "utf8"), "KEEP", kept);
    assert.equal(readFileSync(join(tmp, "outside.txt"), "utf8"), "KEEP");
    const second = clean(root);
    assert.deepEqual(second.removed, []);
  });

  it("removes a symlinked target as a link and never follows it", () => {
    const root = join(tmp, "linked");
    const outside = join(tmp, "victim");
    put(outside, "precious.txt", "KEEP");
    mkdirSync(join(root, ".local"), { recursive: true });
    symlinkSync(outside, join(root, "dist"));
    symlinkSync(outside, join(root, ".local", "demo"));
    clean(root);
    assert.ok(!existsSync(join(root, "dist")));
    assert.ok(!existsSync(join(root, ".local", "demo")));
    assert.equal(readFileSync(join(outside, "precious.txt"), "utf8"), "KEEP");
  });

  it("refuses when .local itself is a link out of the root", () => {
    const root = join(tmp, "locallink");
    const outside = join(tmp, "victim2");
    put(outside, "demo/precious.txt", "KEEP");
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, ".local"));
    assert.throws(() => clean(root), /outside the repository/);
    assert.equal(readFileSync(join(outside, "demo", "precious.txt"), "utf8"), "KEEP");
  });
});

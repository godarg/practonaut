// Deterministic packer. Byte identity is checked across two packs of the same directory and
// across a copy with different mtimes and directory creation order. The reader must accept every
// packer output; source problems are rejected with named codes, never silently dropped.
import assert from "node:assert/strict";
// The CommonJS objects are mutable; syncBuiltinESMExports() pushes mocks into the ESM bindings the packer imported.
import fsSync from "node:fs";
import { open as openFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { fileURLToPath } from "node:url";
import { PackageError } from "../../src/package/errors.ts";
import { LIMITS, lowerLimits } from "../../src/package/limits.ts";
import { packWorld, packWorldWithManifest } from "../../src/package/packer.ts";
import { readWorldPackage } from "../../src/package/reader.ts";
import { PNG, sha } from "../support/fixtures.ts";

const EXAMPLE = fileURLToPath(new URL("../../examples/worlds/minimal/", import.meta.url));

let tmp = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "practonaut-pack-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function source(name: string, files: Record<string, Buffer | string>): string {
  const dir = join(tmp, name);
  for (const [p, data] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), data);
  }
  return dir;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PackageError) return e.code;
    throw e;
  }
  return "ACCEPTED";
}

describe("packWorld", () => {
  it("packs the minimal example and the reader accepts it", async () => {
    const { bytes, manifest, skipped } = await packWorldWithManifest(EXAMPLE);
    const p = await readWorldPackage(bytes);
    assert.deepEqual(p.manifest, manifest);
    assert.deepEqual(manifest.world, { id: "minimal", version: "0.0.0" });
    assert.equal(manifest.entry, "world.json");
    assert.deepEqual(manifest.files.map((f) => [f.path, f.mediaType]), [["assets/marker.png", "image/png"], ["world.json", "application/json"]]);
    assert.deepEqual(skipped, ["README.md"]);
    assert.ok(!p.files.has("README.md"));
  });

  it("is byte-identical for the same input (two packs)", async () => {
    const a = await packWorld(EXAMPLE);
    const b = await packWorld(EXAMPLE);
    assert.equal(sha(a), sha(b));
  });

  it("is byte-identical for a copy with other mtimes and creation order", async () => {
    const copy = join(tmp, "copy");
    mkdirSync(join(copy, "assets"), { recursive: true });
    // Create in a different order than the original and set unusual timestamps.
    cpSync(join(EXAMPLE, "assets", "marker.png"), join(copy, "assets", "marker.png"));
    cpSync(join(EXAMPLE, "world.json"), join(copy, "world.json"));
    utimesSync(join(copy, "world.json"), new Date("2001-02-03T04:05:06Z"), new Date("2001-02-03T04:05:06Z"));
    utimesSync(join(copy, "assets", "marker.png"), new Date("2030-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"));
    assert.equal(sha(await packWorld(copy)), sha(await packWorld(EXAMPLE)));
  });

  it("writes stored entries with the fixed 1980-01-01 DOS timestamp and no extra fields", async () => {
    const bytes = await packWorld(EXAMPLE);
    // Local header of the first entry: method at 8, time at 10, date at 12, extra length at 28.
    assert.equal(bytes.readUInt32LE(0), 0x04034b50);
    assert.equal(bytes.readUInt16LE(8), 0);
    assert.equal(bytes.readUInt16LE(10), 0x0000);
    assert.equal(bytes.readUInt16LE(12), 0x0021);
    assert.equal(bytes.readUInt16LE(28), 0);
  });

  it("puts manifest.json first and sorts the other entries", async () => {
    const dir = source("order", { "world.json": '{"id":"order"}', "assets/b.txt": "b", "assets/a.txt": "a", "assets/sub/c.json": "{}" });
    const bytes = await packWorld(dir);
    const names: string[] = [];
    let off = 0;
    while (bytes.readUInt32LE(off) === 0x04034b50) {
      const n = bytes.readUInt16LE(off + 26);
      const size = bytes.readUInt32LE(off + 18);
      names.push(bytes.subarray(off + 30, off + 30 + n).toString("utf8"));
      off += 30 + n + bytes.readUInt16LE(off + 28) + size;
    }
    assert.deepEqual(names, ["manifest.json", "assets/a.txt", "assets/b.txt", "assets/sub/c.json", "world.json"]);
  });

  it("takes id and version from world.json", async () => {
    const dir = source("versioned", { "world.json": '{"id":"versioned","version":"2.1.0-rc.1"}' });
    const { manifest } = await packWorldWithManifest(dir);
    assert.deepEqual(manifest.world, { id: "versioned", version: "2.1.0-rc.1" });
  });

  const bad: Array<[string, Record<string, Buffer | string>, string]> = [
    ["missing world.json", { "assets/a.txt": "a" }, "E_SOURCE_INVALID"],
    ["world.json without id", { "world.json": '{"x":1}' }, "E_SOURCE_INVALID"],
    ["world.json with an invalid id", { "world.json": '{"id":"Has Space"}' }, "E_SOURCE_INVALID"],
    ["world.json with a bad version", { "world.json": '{"id":"w","version":"1.0"}' }, "E_SOURCE_INVALID"],
    ["unexpected top-level file", { "world.json": '{"id":"w"}', "notes.md": "x" }, "E_SOURCE_INVALID"],
    ["SVG asset", { "world.json": '{"id":"w"}', "assets/x.svg": "<svg/>" }, "E_EXECUTABLE_CONTENT"],
    ["HTML disguised as PNG", { "world.json": '{"id":"w"}', "assets/x.png": "<html><script>1</script></html>" }, "E_EXECUTABLE_CONTENT"],
    ["JSON disguised as PNG", { "world.json": '{"id":"w"}', "assets/x.png": "{}" }, "E_MEDIA_TYPE_MISMATCH"],
    ["unknown extension", { "world.json": '{"id":"w"}', "assets/x.woff2": "wOF2" }, "E_UNSUPPORTED_MEDIA_TYPE"],
    ["non-ASCII asset name", { "world.json": '{"id":"w"}', "assets/café.png": PNG }, "E_INVALID_PATH"],
    ["hidden file in assets", { "world.json": '{"id":"w"}', "assets/.DS_Store": "x" }, "E_SOURCE_INVALID"],
  ];
  bad.forEach(([label, files, code], i) => {
    it(`rejects a source with ${label} (${code})`, async () => {
      assert.equal(await codeOf(packWorld(source(`bad${i}`, files))), code);
    });
  });

  it("rejects a symbolic link in the source directory", async () => {
    const dir = source("symlink", { "world.json": '{"id":"w"}', "assets/a.png": PNG });
    symlinkSync("/etc/hosts", join(dir, "assets", "link.txt"));
    assert.equal(await codeOf(packWorld(dir)), "E_SOURCE_INVALID");
  });

  describe("size limits are checked from metadata before any file is read", () => {
    // Every read path the packer could use is spied on (FileHandle.read/readFile, fs.promises
    // readFile, fs.readFileSync). On a limit error no file content may have been read at all.
    async function noReads<T>(fn: () => Promise<T>): Promise<{ result: T; reads: number }> {
      const fh = await openFile(EXAMPLE + "world.json", "r");
      const proto = Object.getPrototypeOf(fh) as Record<string, (...a: unknown[]) => unknown>;
      await fh.close();
      const spies = [mock.method(proto, "read"), mock.method(proto, "readFile"), mock.method(fsSync.promises, "readFile"), mock.method(fsSync, "readFileSync")];
      syncBuiltinESMExports();
      try {
        const result = await fn();
        return { result, reads: spies.reduce((n, s) => n + s.mock.callCount(), 0) };
      } finally {
        for (const s of spies) s.mock.restore();
        syncBuiltinESMExports();
      }
    }
    const big = (name: string): string => source(name, { "world.json": '{"id":"big"}', "assets/a.txt": "a".repeat(600), "assets/b.txt": "b".repeat(600), "assets/z.txt": "z".repeat(600) });
    it("total over maxTotalBytes -> E_TOTAL_TOO_LARGE, no file read", async () => {
      const dir = big("total");
      const { result, reads } = await noReads(() => codeOf(packWorld(dir, { limits: lowerLimits({ maxTotalBytes: 1000 }) })));
      assert.equal(result, "E_TOTAL_TOO_LARGE");
      assert.equal(reads, 0, "file content was read before the total limit was checked");
    });
    it("one entry over maxEntryBytes -> E_ENTRY_TOO_LARGE, no file read", async () => {
      const dir = source("entry", { "world.json": JSON.stringify({ id: "big", pad: "p".repeat(700) }), "assets/a.txt": "a" });
      const { result, reads } = await noReads(() => codeOf(packWorld(dir, { limits: lowerLimits({ maxEntryBytes: 500 }) })));
      assert.equal(result, "E_ENTRY_TOO_LARGE");
      assert.equal(reads, 0, "file content was read before the entry limit was checked");
    });
    it("too many files -> E_TOO_MANY_ENTRIES, no file read", async () => {
      const dir = big("count");
      const { result, reads } = await noReads(() => codeOf(packWorld(dir, { limits: lowerLimits({ maxEntries: 4 }) })));
      assert.equal(result, "E_TOO_MANY_ENTRIES");
      assert.equal(reads, 0, "file content was read before the entry count was checked");
    });
    it("the spy sees reads when packing succeeds (positive control)", async () => {
      const { reads } = await noReads(() => packWorld(EXAMPLE));
      assert.ok(reads > 0);
    });
    it("refuses limits above LIMITS before reading anything", async () => {
      const { result, reads } = await noReads(async () => {
        try {
          await packWorld(EXAMPLE, { limits: { ...LIMITS, maxTotalBytes: LIMITS.maxTotalBytes + 1 } });
          return "ACCEPTED";
        } catch (e) {
          return e instanceof RangeError ? "RangeError" : String(e);
        }
      });
      assert.equal(result, "RangeError");
      assert.equal(reads, 0, "files were read before the limits were validated");
    });
  });

  it("rejects a manifest deeper than a lowered maxJsonDepth (self-check with the same limits)", async () => {
    // world.json has depth 1; the generated manifest has depth 3.
    assert.equal(await codeOf(packWorld(EXAMPLE, { limits: lowerLimits({ maxJsonDepth: 1 }) })), "E_JSON_TOO_DEEP");
  });

  it("rejects a source tree whose names collide like the reader's rule (A.txt beside a.txt/b.txt)", async () => {
    // Case-insensitive file systems cannot hold this tree, so the directory listing is simulated
    // at the fs/promises boundary; nothing is read because the check runs on names first.
    const root = join(tmp, "collide");
    const dirent = (name: string, dir: boolean) => ({ name, isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false });
    const listing: Record<string, unknown[]> = {
      [root]: [dirent("world.json", false), dirent("assets", true)],
      [join(root, "assets")]: [dirent("A.txt", false), dirent("a.txt", true)],
      [join(root, "assets", "a.txt")]: [dirent("b.txt", false)],
    };
    const dirs = new Set([root, join(root, "assets"), join(root, "assets", "a.txt")]);
    const stat = (p: string) => ({ isSymbolicLink: () => false, isDirectory: () => dirs.has(p), isFile: () => !dirs.has(p), size: 1 });
    const rd = mock.method(fsSync.promises, "readdir", async (p: string) => {
      const l = listing[p];
      if (!l) throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
      return l;
    });
    const ls = mock.method(fsSync.promises, "lstat", async (p: string) => stat(p));
    syncBuiltinESMExports();
    try {
      assert.equal(await codeOf(packWorld(root)), "E_DUPLICATE_ENTRY");
    } finally {
      rd.mock.restore();
      ls.mock.restore();
      syncBuiltinESMExports();
    }
  });
});

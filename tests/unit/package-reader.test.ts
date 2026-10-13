// World package and checker bundle readers against valid and hostile fixtures.
// Fixtures come from tests/support (independent writer, no src imports). Every hostile case
// asserts the exact rejection code. Each case is also written to a temp directory and read
// through the file path API once, so the on-disk entry point is covered too.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it, mock } from "node:test";
import { open as openFile } from "node:fs/promises";
import { PackageError } from "../../src/package/errors.ts";
import { LIMITS, lowerLimits } from "../../src/package/limits.ts";
import { parseJsonEntry } from "../../src/package/json.ts";
import { readArchiveFile, readCheckerBundle, readCheckerBundleFile, readWorldPackage, readWorldPackageFile } from "../../src/package/reader.ts";
import { readArchive, type ReadDiagnostics } from "../../src/package/zip-reader.ts";
import { BASE_FILES, HOSTILE_CASES, PNG, WORLD, checkerBundle, manifestFor, pkg, sha, thirdPartyStylePackage, type FileSpec } from "../support/fixtures.ts";
import { buildZip } from "../support/zipwriter.ts";

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof PackageError) return e.code;
    throw e;
  }
  return "ACCEPTED";
}

let tmp = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "practonaut-fixtures-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("valid packages (positive controls)", () => {
  it("accepts the base world package and exposes manifest, entry and files", async () => {
    const bytes = pkg();
    const p = await readWorldPackage(bytes);
    assert.equal(p.kind, "world-package");
    assert.deepEqual(p.manifest.world, { id: "fixture", version: "1.2.3" });
    assert.equal(p.entry.id, "fixture");
    assert.deepEqual([...p.files.keys()].sort(), ["assets/marker.png", "world.json"]);
    assert.equal(p.files.get("world.json")?.sha256, sha(WORLD));
    assert.ok(p.files.get("assets/marker.png")?.data.equals(PNG));
    assert.equal(p.archiveSha256, sha(bytes));
  });

  it("accepts a package written like a generic zip tool (deflate, directory entry, timestamp extra field)", async () => {
    const p = await readWorldPackage(thirdPartyStylePackage());
    assert.equal(p.files.size, 2);
  });

  it("accepts a checker bundle through the checker reader", async () => {
    const b = await readCheckerBundle(checkerBundle());
    assert.equal(b.kind, "checker-bundle");
    assert.equal(b.manifest.format, "practonaut.checker-bundle");
    assert.ok(b.files.has("held-out/tasks.json"));
  });

  it("accepts a JSON entry nested exactly at the depth limit", async () => {
    const deep = Buffer.from("[".repeat(LIMITS.maxJsonDepth) + "]".repeat(LIMITS.maxJsonDepth));
    const p = await readWorldPackage(pkg({ "world.json": { data: WORLD, mediaType: "application/json" }, "assets/deep.json": { data: deep, mediaType: "application/json" } }));
    assert.ok(p.files.has("assets/deep.json"));
  });

  it("reads from a file path", async () => {
    const f = join(tmp, "ok.pnworld");
    writeFileSync(f, pkg());
    const p = await readWorldPackageFile(f);
    assert.equal(p.manifest.world.id, "fixture");
  });
});

describe("hostile packages", () => {
  for (const c of HOSTILE_CASES) {
    it(`${c.id}: ${c.description} -> ${c.expected}`, async () => {
      const bytes = c.build();
      const read = c.reader === "world" ? readWorldPackage(bytes) : readCheckerBundle(bytes);
      assert.equal(await codeOf(read), c.expected);
    });
  }

  it("rejects every hostile world case through the file path API with the same code", async () => {
    for (const c of HOSTILE_CASES.filter((h) => h.reader === "world")) {
      const f = join(tmp, `${c.id}.pnworld`);
      writeFileSync(f, c.build());
      assert.equal(await codeOf(readWorldPackageFile(f)), c.expected, c.id);
    }
  });

  it("covers every spike case and every case listed in the foundation prompt", () => {
    const ids = new Set(HOSTILE_CASES.map((c) => c.id));
    const required = [
      "traversal", "traversal-nested", "absolute", "absolute-win", "symlink", "bomb-ratio", "bomb-total", "bomb-lying",
      "oversized-entry", "schema-major", "hash-mismatch", "unlisted", "duplicate",
      "exec-elf", "exec-shebang", "exec-html-as-png", "exec-wasm", "exec-svg", "media-json-as-png", "name-not-nfc",
      "visibility-field", "checker-as-world", "manifest-extra-field", "unicode-path-extra", "zip64-extra", "local-name-differs",
    ];
    for (const r of required) assert.ok(ids.has(r), `missing case ${r}`);
  });
});

describe("file system entry point", () => {
  it("refuses a FIFO without blocking", { skip: process.platform === "win32" ? "no FIFOs on Windows" : false }, async (t) => {
    const { spawnSync } = await import("node:child_process");
    const fifo = join(tmp, "pipe.pnworld");
    const r = spawnSync("mkfifo", [fifo]);
    if (r.status !== 0) {
      t.skip(`mkfifo unavailable (${r.error ? (r.error as NodeJS.ErrnoException).code : `exit ${String(r.status)}`}); FIFO case not run`);
      return;
    }
    assert.equal(await codeOf(readWorldPackageFile(fifo)), "E_ARCHIVE_INVALID");
  });

  it("does not read a file that is larger than the archive limit", async () => {
    const f = join(tmp, "toolarge.pnworld");
    writeFileSync(f, Buffer.alloc(4096));
    const fh = await openFile(f, "r");
    const proto = Object.getPrototypeOf(fh) as { read: (...a: unknown[]) => unknown };
    await fh.close();
    const spy = mock.method(proto, "read");
    try {
      assert.equal(await codeOf(readArchiveFile(f, lowerLimits({ maxArchiveBytes: 1024 }))), "E_ARCHIVE_TOO_LARGE");
      assert.equal(spy.mock.callCount(), 0, "file content was read before the size check");
    } finally {
      spy.mock.restore();
    }
  });

  it("checks the archive size before reading the file", async () => {
    const f = join(tmp, "big.pnworld");
    writeFileSync(f, Buffer.alloc(2048));
    assert.equal(await codeOf(readWorldPackageFile(f, lowerLimits({ maxArchiveBytes: 1024 }))), "E_ARCHIVE_TOO_LARGE");
  });
});

describe("limits", () => {
  it("are frozen code constants", () => {
    assert.ok(Object.isFrozen(LIMITS));
    assert.equal(LIMITS.maxArchiveBytes, 16 * 1024 * 1024);
    assert.equal(LIMITS.maxEntries, 256);
    assert.equal(LIMITS.maxEntryBytes, 4 * 1024 * 1024);
    assert.equal(LIMITS.maxRatio, 100);
  });

  it("can be lowered but never raised", () => {
    assert.equal(lowerLimits({ maxEntries: 3 }).maxEntries, 3);
    assert.throws(() => lowerLimits({ maxEntries: LIMITS.maxEntries + 1 }), RangeError);
    assert.throws(() => lowerLimits({ maxEntries: 0 }), RangeError);
    assert.throws(() => lowerLimits({ nope: 1 } as never), RangeError);
  });

  it("a lowered entry limit is enforced", async () => {
    assert.equal(await codeOf(readWorldPackage(pkg(), lowerLimits({ maxEntries: 2 }))), "E_TOO_MANY_ENTRIES");
  });
});

describe("review round 1", () => {
  const manyFiles = (): Record<string, FileSpec> => {
    const files: Record<string, FileSpec> = { ...BASE_FILES };
    for (let i = 0; i < 255; i++) files[`assets/f${i}.txt`] = { data: Buffer.from(String(i)), mediaType: "text/plain" };
    return files; // 257 entries with the manifest, all listed
  };

  it("public readers refuse limits above LIMITS (RangeError)", async () => {
    const raised = { ...LIMITS, maxEntries: 1000 };
    const bytes = pkg(manyFiles());
    await assert.rejects(readWorldPackage(bytes, raised), RangeError);
    await assert.rejects(readCheckerBundle(checkerBundle(), raised), RangeError);
    const f = join(tmp, "many.pnworld");
    writeFileSync(f, bytes);
    await assert.rejects(readWorldPackageFile(f, raised), RangeError);
    await assert.rejects(readCheckerBundleFile(f, raised), RangeError);
    await assert.rejects(readArchiveFile(f, { ...LIMITS, maxArchiveBytes: LIMITS.maxArchiveBytes * 2 }), RangeError);
    await assert.rejects(readWorldPackage(bytes, { ...LIMITS, maxJsonDepth: Number.NaN }), RangeError);
    await assert.rejects(readWorldPackage(bytes, { ...LIMITS, extra: 1 } as never), RangeError);
    await assert.rejects(readWorldPackage(bytes, { maxEntries: 10 } as never), RangeError);
    assert.equal(await codeOf(readWorldPackage(bytes)), "E_TOO_MANY_ENTRIES");
  });

  it("stops inflating a lying entry after about one chunk past its declared size", async () => {
    const bytes = buildZip([{ name: "liar.txt", data: Buffer.alloc(50 * 1024 * 1024), lieUncompressedSize: 1000, level: 1 }]);
    const diag: ReadDiagnostics = { inflatedBytes: 0 };
    assert.equal(await codeOf(readArchive(bytes, LIMITS, diag)), "E_ENTRY_SIZE_MISMATCH");
    assert.ok(diag.inflatedBytes > 0, "no inflate progress recorded");
    assert.ok(diag.inflatedBytes <= 1000 + 1024 * 1024, `inflated ${diag.inflatedBytes} bytes before stopping`);
  });

  it("checks JSON depth before JSON.parse allocates anything", () => {
    const deep = Buffer.from("[".repeat(1_000_000) + "]".repeat(1_000_000)); // 2 MB < 4 MiB entry limit
    const spy = mock.method(JSON, "parse");
    try {
      assert.throws(() => parseJsonEntry(deep, "deep.json", LIMITS.maxJsonDepth), (e: unknown) => e instanceof PackageError && e.code === "E_JSON_TOO_DEEP");
      assert.equal(spy.mock.callCount(), 0, "JSON.parse ran before the depth check");
    } finally {
      spy.mock.restore();
    }
  });

  it("depth scan ignores brackets inside strings and escapes", () => {
    const text = JSON.stringify({ s: "[".repeat(200) + '\\"[[' + "{".repeat(200) });
    assert.doesNotThrow(() => parseJsonEntry(Buffer.from(text), "s.json", LIMITS.maxJsonDepth));
  });

  it("accepts I-JSON numbers and surrogate pairs that round-trip", () => {
    const ok = '{"a":[0,-0,1.0,1E2,0.1,0.30000000000000004,9007199254740991,-9007199254740991,1e15,5e-324,"\\ud83d\\ude00","\u{1F600}"]}';
    assert.doesNotThrow(() => parseJsonEntry(Buffer.from(ok), "n.json", LIMITS.maxJsonDepth));
  });

  it("accepts number literals with up to 17 significant digits that are not the shortest form", () => {
    for (const lit of ["0.79999999999999993", "0.10000000000000001", "3.1415926535897931", "-2.2250738585072014e-308", "123456789012345.67"]) {
      assert.doesNotThrow(() => parseJsonEntry(Buffer.from(`{"n":${lit}}`), "n.json", LIMITS.maxJsonDepth), lit);
    }
  });

  it("accepts a long literal that is the exact decimal value of a double", () => {
    // 0.1 as a double is exactly 0.1000000000000000055511151231257827021181583404541015625
    // (IEEE 754 binary64; independently: Python `decimal.Decimal(0.1)`).
    const exact = "0.1000000000000000055511151231257827021181583404541015625";
    assert.doesNotThrow(() => parseJsonEntry(Buffer.from(`{"n":${exact}}`), "n.json", LIMITS.maxJsonDepth));
  });

  it("still rejects more than 17 significant digits that are not exact", () => {
    for (const lit of ["3.14159265358979323846", "0.1000000000000000000001"]) {
      assert.throws(() => parseJsonEntry(Buffer.from(`{"n":${lit}}`), "n.json", LIMITS.maxJsonDepth), (e: unknown) => e instanceof PackageError && e.code === "E_JSON_INVALID", lit);
    }
  });

  it("accepts %PDF- inside JSON and text that do not start with it", async () => {
    const task = Buffer.from(JSON.stringify({ id: "fixture", task: "Export the cover as %PDF-1.7 and attach it." }));
    const note = Buffer.from("Save the result as a file starting with %PDF-1.7.\n");
    const p = await readWorldPackage(pkg({ ...BASE_FILES, "world.json": { data: task, mediaType: "application/json" }, "assets/note.txt": { data: note, mediaType: "text/plain" } }));
    assert.ok(p.files.has("assets/note.txt"));
  });

  for (const host of [0, 3, 11, 14]) {
    it(`accepts a file whose Unix mode has no type bits (0o600, host ${host}, like Python ZipFile.writestr)`, async () => {
      const p = await readWorldPackage(pkg(BASE_FILES, { entryPatch: { "world.json": { madeByOs: host, externalAttrs: (0o600 << 16) >>> 0 }, "assets/marker.png": { madeByOs: host, externalAttrs: (0o644 << 16) >>> 0 } } }));
      assert.equal(p.files.size, 2);
    });
  }

  it("accepts a directory entry whose Unix mode has no type bits (host 3)", async () => {
    const p = await readWorldPackage(pkg(BASE_FILES, { extraEntries: [{ name: "assets/", data: Buffer.alloc(0), method: 0, externalAttrs: (0o755 << 16) >>> 0 }] }));
    assert.equal(p.files.size, 2);
  });

  it("still rejects a symlink mode on hosts 11 and 14", async () => {
    for (const host of [11, 14]) {
      const bytes = pkg(BASE_FILES, { entryPatch: { "assets/marker.png": { madeByOs: host, unixMode: 0o120777 } } });
      assert.equal(await codeOf(readWorldPackage(bytes)), "E_SYMLINK_ENTRY", `host ${host}`);
    }
  });

  it("accepts an empty deflate directory entry with CRC 0 and text that merely starts with '<'", async () => {
    const p = await readWorldPackage(
      pkg({ ...BASE_FILES, "assets/note.txt": { data: Buffer.from("<3 and <name@example.org> are not tags\n"), mediaType: "text/plain" } }, { extraEntries: [{ name: "assets/", data: Buffer.alloc(0), method: 8, unixMode: 0o040755 }] }),
    );
    assert.ok(p.files.has("assets/note.txt"));
  });

  it("rejects an oversized files array before schema validation, with a bounded message", async () => {
    const { WorldManifestSchema, CheckerBundleManifestSchema } = await import("../../src/package/manifest.ts");
    const flood = HOSTILE_CASES.filter((c) => c.id === "manifest-files-flood" || c.id === "checker-files-flood");
    assert.equal(flood.length, 2);
    const spies = [mock.method(WorldManifestSchema, "safeParse"), mock.method(CheckerBundleManifestSchema, "safeParse")];
    try {
      for (const c of flood) {
        let err: unknown;
        try {
          await (c.reader === "world" ? readWorldPackage(c.build()) : readCheckerBundle(c.build()));
        } catch (e) {
          err = e;
        }
        assert.ok(err instanceof PackageError && err.code === "E_MANIFEST_INVALID", `${c.id}: ${String(err)}`);
        assert.ok(err.message.length <= 4096, `${c.id}: message length ${err.message.length}`);
      }
      assert.equal(spies[0]?.mock.callCount(), 0, "world manifest schema ran over the flooded array");
      assert.equal(spies[1]?.mock.callCount(), 0, "checker manifest schema ran over the flooded array");
    } finally {
      for (const s of spies) s.mock.restore();
    }
  });

  it("caps schema error messages at 4096 characters", async () => {
    // 255 files (within the count limit), each with 4 wrong fields: many issues, all reported by zod.
    const bad = Array.from({ length: 255 }, () => ({ path: 1, sha256: 2, size: "x", mediaType: 4 }));
    const bytes = pkg(BASE_FILES, { manifestBytes: Buffer.from(JSON.stringify({ ...manifestFor(BASE_FILES), files: bad })) });
    let err: unknown;
    try {
      await readWorldPackage(bytes);
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof PackageError && err.code === "E_MANIFEST_INVALID");
    assert.ok(err.message.length <= 4096, `message length ${err.message.length}`);
    assert.match(err.message, /more issue/);
    // A single issue can be long too: zod echoes an unrecognized key in full.
    const longKey = pkg(BASE_FILES, { manifestExtra: { ["k".repeat(10_000)]: 1 } });
    let err2: unknown;
    try {
      await readWorldPackage(longKey);
    } catch (e) {
      err2 = e;
    }
    assert.ok(err2 instanceof PackageError && err2.code === "E_MANIFEST_INVALID", String(err2));
    assert.ok(err2.message.length <= 4096, `message length ${err2.message.length}`);
  });

  it("accepts an empty directory entry that is the parent of a listed file", async () => {
    const p = await readWorldPackage(pkg(BASE_FILES, { extraEntries: [{ name: "assets/", data: Buffer.alloc(0), method: 0, unixMode: 0o040755 }] }));
    assert.equal(p.files.size, 2);
  });
});

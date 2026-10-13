import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HOST_LIMITS, RequestBudget } from "../../src/host/limits.ts";
import { createTokenFile } from "../../src/host/token-file.ts";

async function fixture(): Promise<string> { await mkdir(".local", { recursive: true }); return mkdtemp(resolve(".local/host-unit-")); }
test("token files are exclusive 0600, inside 0700 owned directory, removed by owner", async () => {
  const dir = await fixture();
  try {
    const token = await createTokenFile(join(dir, "runtime"), "test-runtime-capability");
    assert.equal((await lstat(join(dir, "runtime"))).mode & 0o777, 0o700);
    assert.equal((await lstat(token.path)).mode & 0o777, 0o600);
    assert.equal((await lstat(token.path)).nlink, 1);
    assert.equal((await lstat(token.path)).uid, process.getuid?.());
    assert.equal(await readFile(token.path, "utf8"), "test-runtime-capability\n");
    await token.remove(); await assert.rejects(lstat(token.path), { code: "ENOENT" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("symlink directory, ancestor, file and existing readable file fail closed", async () => {
  const dir = await fixture();
  try {
    const safe = join(dir, "safe"); await mkdir(safe, { mode: 0o700 });
    const link = join(dir, "link"); await symlink(safe, link);
    for (const target of [link, join(link, "nested")]) await assert.rejects(createTokenFile(target, "test"), { code: "token_file_unsafe" });
    const occupied = join(safe, "session-fixed.token"); await writeFile(occupied, "other", { mode: 0o644 });
    await assert.rejects(createTokenFile(safe, "test", "session-fixed.token"), { code: "token_file_unsafe" });
    assert.equal(await readFile(occupied, "utf8"), "other"); assert.equal((await lstat(occupied)).mode & 0o777, 0o644);
    await rm(occupied); await symlink(join(dir, "victim"), occupied);
    await assert.rejects(createTokenFile(safe, "test", "session-fixed.token"), { code: "token_file_unsafe" });
    assert.equal((await lstat(occupied)).isSymbolicLink(), true);
    await assert.rejects(createTokenFile(safe, "test", "../escaped.token"), { code: "token_file_unsafe" });
    await chmod(safe, 0o755); await assert.rejects(createTokenFile(safe, "test"), { code: "token_file_unsafe" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("shutdown refuses to delete a replacement credential file", async () => {
  const dir = await fixture();
  try {
    const token = await createTokenFile(dir, "test", "session-replaced.token");
    await rm(token.path); await symlink(join(dir, "victim"), token.path);
    await token.remove(); assert.equal((await lstat(token.path)).isSymbolicLink(), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("request bucket enforces 200 burst and 50/s refill; backwards clock never adds credit", () => {
  let now = 0; const budget = new RequestBudget(() => now);
  for (let i = 0; i < HOST_LIMITS.rateBurst; i++) assert.equal(budget.take(), true);
  assert.equal(budget.take(), false); now += 19; assert.equal(budget.take(), false);
  now++; assert.equal(budget.take(), true); now = -100; assert.equal(budget.take(), false);
});

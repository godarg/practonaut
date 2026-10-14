// CLI end to end through a real child process (spawnSync), checking documented exit codes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { HOSTILE_CASES, pkg, sha } from "../support/fixtures.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MAIN = join(ROOT, "src", "cli", "main.ts");
const EXAMPLE = join(ROOT, "examples", "worlds", "minimal");

function cli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [MAIN, ...args], { cwd: opts.cwd ?? ROOT, env: opts.env ?? process.env, encoding: "utf8", timeout: 60_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

let tmp = "";
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "practonaut-cli-"));
});
after(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("practonaut CLI", () => {
  it("--version prints the package.json version (exit 0)", () => {
    const r = cli(["--version"]);
    assert.equal(r.status, 0);
    const pkgJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    assert.equal(r.stdout.trim(), pkgJson.version);
  });

  it("--help documents the exit codes (exit 0)", () => {
    const r = cli(["--help"]);
    assert.equal(r.status, 0);
    for (const s of ["0  success", "1  usage error", "2  package or source rejected", "3  environment missing"]) assert.ok(r.stdout.includes(s), s);
  });

  const usage: Array<[string, string[]]> = [
    ["unknown command", ["frobnicate"]],
    ["unknown option", ["validate", "x.pnworld", "--nope"]],
    ["validate without a package", ["validate"]],
    ["validate a missing file", ["validate", "does-not-exist.pnworld"]],
    ["pack without --out", ["pack", "examples/worlds/minimal"]],
    ["pack into a missing directory", ["pack", "examples/worlds/minimal", "--out", "no/such/dir/x.pnworld"]],
    ["pack a missing source", ["pack", "no-such-dir", "--out", "x.pnworld"]],
  ];
  for (const [label, args] of usage) {
    it(`${label} -> exit 1`, () => {
      const r = cli(args, { cwd: tmp });
      assert.equal(r.status, 1, r.stderr);
      assert.match(r.stderr, /practonaut: |Usage:/);
    });
  }

  it("pack then validate the example (exit 0), deterministic across runs", () => {
    const out1 = join(tmp, "a.pnworld");
    const out2 = join(tmp, "b.pnworld");
    const p1 = cli(["pack", EXAMPLE, "--out", out1]);
    const p2 = cli(["pack", EXAMPLE, "--out", out2, "--json"]);
    assert.equal(p1.status, 0, p1.stderr);
    assert.equal(p2.status, 0, p2.stderr);
    assert.equal(sha(readFileSync(out1)), sha(readFileSync(out2)));
    const v = cli(["validate", out1]);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /OK {2}world package {2}minimal 0\.0\.0/);
    assert.ok(!existsSync(`${out1}.tmp-${process.pid}`));
  });

  it("validate --json reports paths relative to the cwd and no home path", () => {
    const out = join(tmp, "rel", "m.pnworld");
    mkdirSync(dirname(out), { recursive: true });
    assert.equal(cli(["pack", EXAMPLE, "--out", out]).status, 0);
    const r = cli(["validate", out, "--json"], { cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { ok: boolean; path: string; world: { id: string }; archive: { sha256: string } };
    assert.equal(j.ok, true);
    assert.equal(j.path, relative(tmp, out).split(sep).join("/"), "shown with / on every platform");
    assert.equal(j.world.id, "minimal");
    assert.equal(j.archive.sha256, sha(readFileSync(out)));
    assert.ok(!r.stdout.includes(homedir()), "home path leaked");
    assert.ok(!r.stdout.includes(tmp), "absolute temp path leaked");
  });

  it("validate rejects hostile packages with exit 2 and the named code", () => {
    for (const id of ["symlink", "traversal", "exec-html-as-png", "visibility-field", "checker-as-world"]) {
      const c = HOSTILE_CASES.find((h) => h.id === id);
      assert.ok(c);
      const f = join(tmp, `${id}.pnworld`);
      writeFileSync(f, c.build());
      const r = cli(["validate", f, "--json"], { cwd: tmp });
      assert.equal(r.status, 2, `${id}: ${r.stderr}`);
      const j = JSON.parse(r.stdout) as { ok: boolean; error: { code: string } };
      assert.equal(j.ok, false);
      assert.equal(j.error.code, c.expected);
      const human = cli(["validate", f], { cwd: tmp });
      assert.equal(human.status, 2);
      assert.ok(human.stderr.includes(c.expected));
    }
  });

  it("escapes control characters from hostile names in human output", () => {
    const f = join(tmp, "ctl.pnworld");
    writeFileSync(f, pkg(undefined, { extraEntries: [{ name: "assets/\u001b[31mred.txt", data: Buffer.from("x") }] }));
    const r = cli(["validate", f], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.ok(!r.stderr.includes("\u001b"), "raw ESC reached the terminal");
    assert.ok(r.stderr.includes("\\u{001b}"));
  });

  it("pack rejects an invalid source with exit 2", () => {
    const src = join(tmp, "badsrc");
    mkdirSync(join(src, "assets"), { recursive: true });
    writeFileSync(join(src, "world.json"), '{"id":"bad"}');
    writeFileSync(join(src, "assets", "x.svg"), "<svg/>");
    const r = cli(["pack", src, "--out", join(tmp, "bad.pnworld"), "--json"], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.equal((JSON.parse(r.stdout) as { error: { code: string } }).error.code, "E_EXECUTABLE_CONTENT");
    assert.ok(!existsSync(join(tmp, "bad.pnworld")));
  });

  it("doctor passes on this Node (exit 0)", () => {
    const r = cli(["doctor", "--json"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal((JSON.parse(r.stdout) as { ok: boolean }).ok, true);
  });

  it("doctor --dev reports a missing tool chain with exit 3", () => {
    // PATH holds one directory with nothing but a link to node, so git, npm and gitleaks are absent
    // regardless of where they live next to node on this machine.
    const bin = join(tmp, "bin-only-node");
    mkdirSync(bin, { recursive: true });
    if (!existsSync(join(bin, "node"))) symlinkSync(process.execPath, join(bin, "node"));
    const r = cli(["doctor", "--dev", "--json"], { env: { PATH: bin, HOME: tmp } });
    const j = JSON.parse(r.stdout) as { ok: boolean; checks: Array<{ name: string; ok: boolean }> };
    assert.equal(r.status, 3);
    assert.equal(j.ok, false);
    assert.equal(j.checks.find((c) => c.name === "git")?.ok, false);
  });

  it("validate on a directory is a usage error (exit 1), as the help says", () => {
    const r = cli(["validate", "examples"], { cwd: ROOT });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /not a regular file/);
  });

  it("prints nothing but printable ASCII for names with format and tag characters", () => {
    const tag = [..."IGNORE"].map((c) => String.fromCodePoint(0xe0000 + (c.codePointAt(0) ?? 0))).join("");
    const f = join(tmp, "tag.pnworld");
    writeFileSync(f, pkg(undefined, { extraEntries: [{ name: `assets/ok${tag}\u061c\u2060\u00ad.txt`, data: Buffer.from("x") }] }));
    for (const args of [["validate", f], ["validate", f, "--json"]]) {
      const r = cli(args, { cwd: tmp });
      assert.equal(r.status, 2);
      const out = r.stdout + r.stderr;
      assert.ok(/^[\x20-\x7e\n]*$/.test(out), `non-ASCII in output: ${JSON.stringify(out.match(/[^\x20-\x7e\n]/g))}`);
    }
    const j = JSON.parse(cli(["validate", f, "--json"], { cwd: tmp }).stdout) as { error: { entry: string } };
    assert.ok(j.error.entry.includes("\u{e0049}") || j.error.entry.includes("\udb40\udc49"), j.error.entry);
  });
});

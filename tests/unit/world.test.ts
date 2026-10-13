import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { generateVariant, loadWorldPackage, selectVariant, validateState, validateWorld, WorldError } from "../../src/world/index.ts";
import { preflightJson } from "../../src/world/preflight.ts";
import type { World } from "../../src/world/types.ts";
import { packWorldWithManifest } from "../../src/package/packer.ts";
import { readWorldPackage } from "../../src/package/reader.ts";

function world(): World { return validateWorld(JSON.parse(readFileSync(new URL("../fixtures/core/world.json", import.meta.url), "utf8"))); }
async function packageFor(raw: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "pn-world-test-"));
  try {
    writeFileSync(join(dir, "world.json"), JSON.stringify(raw));
    return await readWorldPackage((await packWorldWithManifest(dir)).bytes);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const reject = (raw: unknown): void => { assert.throws(() => validateWorld(raw), WorldError); };

describe("world content v1", () => {
  it("strict schema accepts all required public content and rejects unknowns at every object boundary", () => {
    const input = world(); assert.equal(input.schema, "practonaut.world/1");
    reject({ ...input, visibility: "hidden" });
    input.tasks[0]!.title = { ...input.tasks[0]!.title, extra: "x" } as World["tasks"][number]["title"]; reject(input);
  });
  it("rejects every forbidden solution/evaluation/authoring field recursively", () => {
    for (const key of ["referenceSolutions", "alternative_solutions", "nearMiss", "solvabilityWitnesses", "heldOutTasks", "hypotheses", "openModelQuestions", "fixtures"]) {
      const input = world(); (input.variants.cases[0]!.labels as Record<string, unknown>)[key] = "CANARY"; reject(input);
    }
  });
  it("rejects unsupported app, hypotheses, missing evidence, invalid parameter ranges and duplicate identities", () => {
    const mutate: Array<(w: World) => void> = [
      w => { w.app.versionRange = "0.19.0" as "0.18.1"; },
      w => { w.rules[0]!.status = "hypothesis" as "confirmed"; },
      w => { w.rules[0]!.evidence = []; },
      w => { w.rules[0]!.evidence[0]!.sha256 = "bad"; },
      w => { w.actions[0]!.parameters.width = { type: "integer", min: 5, max: 1 }; },
      w => { w.tasks.push(structuredClone(w.tasks[0]!)); },
      w => { w.initialState.objects.a!.id = "wrong"; },
    ];
    for (const change of mutate) { const input = world(); change(input); reject(input); }
  });
  it("rejects float/unsafe numbers, missing frames, dangling live endpoints, undeclared fonts and excess objects", () => {
    const input = world(); const a = input.initialState.objects.a!; assert.equal(a.type, "step");
    if (a.type !== "step") throw new Error("fixture"); a.x = 0.5; reject(input);
    const s = world().initialState; delete s.objects.b; assert.throws(() => validateState(s), WorldError);
    const font = world(); const step = font.initialState.objects.a!; if (step.type === "step") (step as { fontFamily: number }).fontFamily = 99; reject(font);
    const large = { objects: Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [`f${i}`, { id: `f${i}`, type: "frame", deleted: false, name: "x" }])) };
    assert.throws(() => validateState(large), /object limit/);
  });
  it("allows detached arrow endpoints and tombstones but not live references to tombstones", () => {
    const s = world().initialState; s.objects.b!.deleted = true;
    assert.throws(() => validateState(s), /endpoint/);
    for (const o of Object.values(s.objects)) if (o.type === "arrow") { if (o.from === "b") o.from = null; if (o.to === "b") o.to = null; }
    assert.deepEqual(validateState(s), s);
  });
  it("iterative preflight rejects cycles, accessors, unsafe keys, deep/broad ASTs and oversized text", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic; assert.throws(() => preflightJson(cyclic), /cyclic/);
    const accessor = Object.defineProperty({}, "key", { enumerable: true, get() { throw new Error("accessor invoked"); } }); assert.throws(() => preflightJson(accessor), /accessor/);
    assert.throws(() => preflightJson(JSON.parse('{"__proto__":{}}')), /unsafe key/);
    const input = world(); let p: unknown = { op: "true" }; for (let i = 0; i < 40; i++) p = { op: "not", arg: p }; input.tasks[0]!.goal = p as World["tasks"][number]["goal"]; reject(input);
    const broad = world(); broad.tasks[0]!.goal = { op: "all", args: Array.from({ length: 4097 }, () => ({ op: "true" })) }; reject(broad);
    const text = world(); text.tasks[0]!.prompt.en = "😀".repeat(4097); reject(text);
    const lone = world(); lone.tasks[0]!.prompt.en = "\ud800"; reject(lone);
  });
  it("seeded cases select deterministically and substitute only declared text/literals; each step gets integer offset", () => {
    const input = world(); const variant = structuredClone(input.variants.cases[0]!); variant.id = "v2"; variant.labels.process = "Alternate"; variant.layoutOffset = { x: 25, y: -30 }; variant.insertPosition = 2; input.variants.cases.push(variant);
    for (let seed = -50; seed <= 50; seed++) {
      const out = generateVariant(input, seed); assert.deepEqual(out, generateVariant(input, seed));
      const selected = selectVariant(input, seed); const a = out.initialState.objects.a!;
      assert.equal(a.type === "step" && a.x, selected.layoutOffset.x);
      assert.equal(out.tasks[0]!.prompt.en, `Insert at ${selected.insertPosition}`);
      assert.equal(out.initialState.objects.f!.type === "frame" && out.initialState.objects.f!.name, selected.labels.process);
      assert.equal(out.id, input.id); assert.equal(out.rules[0]!.evidence[0]!.case, "add");
    }
    assert.throws(() => generateVariant(input, 0.5), /seed/);
  });
  it("loader accepts real packed v1 and rejects legacy content/identity mismatch", async () => {
    const pkg = await packageFor(world());
    assert.deepEqual(loadWorldPackage(pkg), world());
    pkg.entry = { schema: "practonaut.world/0-draft", id: "core-fixture" };
    assert.throws(() => loadWorldPackage(pkg), WorldError);
    pkg.entry = world() as unknown as Record<string, unknown>;
    pkg.manifest.world.id = "other";
    assert.throws(() => loadWorldPackage(pkg), /identity mismatch/);
  });
  it("actual pnworld rejects nested evaluation fields, even when integrity hashes are valid", async () => {
    const raw = world(); (raw.variants.cases[0]!.labels as Record<string, unknown>).heldOutTasks = "CANARY";
    const pkg = await packageFor(raw);
    assert.throws(() => loadWorldPackage(pkg), /forbidden/);
  });
  it("loader scans auxiliary JSON files for forbidden data fields and requires asset rights", async () => {
    const pkg = await packageFor(world());
    pkg.files.set("extra.json", { path: "extra.json", mediaType: "application/json", size: 32, sha256: "a".repeat(64), data: Buffer.from('{"nested":{"heldOutTasks":[]}}') });
    assert.throws(() => loadWorldPackage(pkg), /forbidden/);
    pkg.files.get("extra.json")!.data = Buffer.from('{}');
    assert.throws(() => loadWorldPackage(pkg), /missing asset rights/);
    (pkg.entry as unknown as World).rights.assets.push({ path: "extra.json", source: "self-created", license: "CC0-1.0" });
    assert.equal(loadWorldPackage(pkg).rights.assets.length, 1);
  });
  it("substitution is single-pass: label token-looking text remains literal", () => {
    const input = world(); input.variants.cases[0]!.labels.process = "{{insertPosition}}";
    assert.equal(generateVariant(input, 1).tasks[0]!.title.en, "Build {{insertPosition}}");
  });
});

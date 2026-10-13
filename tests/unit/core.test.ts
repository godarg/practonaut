import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coreGolden } from "../oracles/core-hash.ts";
import { describe, it } from "node:test";
import { stateHash } from "../../src/canonical/index.ts";
import { evaluate } from "../../src/predicate/index.ts";
import { RUNTIME_LIMITS } from "../../src/world/limits.ts";
import { apply, creationId, Session } from "../../src/core/index.ts";
import { generateVariant, validateWorld } from "../../src/world/index.ts";
import type { Action, LogEntry, Predicate, State, World } from "../../src/world/types.ts";

function world(): World { return validateWorld(JSON.parse(readFileSync(new URL("../fixtures/core/world.json", import.meta.url), "utf8"))); }
function must(session: Session, action: Action): void { const r = session.act(action); assert.equal(r.ok, true, !r.ok ? r.error.message : undefined); }
const add = (label = "D"): Action => ({ name: "add_step", params: { frameId: "f", label, x: 600, y: 0, width: 120, height: 60, fontFamily: 1 } });
const assertRejected = (s: Session, a: Action, code: string): void => { const before = s.serialize(); const r = s.act(a); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.code, code); assert.deepEqual(s.serialize(), before); };

describe("atomic deterministic core", () => {
  it("every modeled action replays to a manually written independent Golden state and independent oracle hash", () => {
    const golden = JSON.parse(readFileSync(new URL("../fixtures/core/golden-final.json", import.meta.url), "utf8")) as { seed: number; actions: Action[]; state: State; hash: string };
    assert.deepEqual(coreGolden(), golden);
    const session = new Session(world(), golden.seed, "T1"); for (const action of golden.actions) must(session, action);
    assert.deepEqual(session.state, golden.state); assert.equal(session.hash, golden.hash);
    assert.deepEqual(session.checkReplay(), { ok: true, value: { state: golden.state, hash: golden.hash } });
    const live = new Session(world(), golden.seed, "T1"); for (const entry of session.log) { must(live, entry.action); assert.equal(live.hash, entry.hash); }
    assert.equal(live.hash, golden.hash);
  });
  it("property: seeds and valid action prefixes deterministically reproduce every state and hash", () => {
    for (let seed = -15; seed < 15; seed++) {
      const a = new Session(world(), seed, "T1"); const b = new Session(world(), seed, "T1");
      for (let index = 0; index < 12; index++) {
        const action: Action = index % 2 ? { name: "move_step", params: { id: "a", x: seed * 17 + index, y: -index }, baseStep: index } : { name: "rename_step", params: { id: "a", label: `Seed ${seed} step ${index}` }, baseStep: index };
        must(a, action); must(b, structuredClone(action)); assert.equal(a.hash, b.hash); assert.deepEqual(a.state, b.state);
      }
      const replay = a.checkReplay(); assert.equal(replay.ok, true); if (replay.ok) assert.equal(replay.value.hash, a.hash);
    }
  });
  it("property: any rejected/missing/unmodeled effect is atomic, including false preconditions and bad params", () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = new Session(world(), seed, "T1");
      assertRejected(s, { name: "duplicate", params: {} }, "unmodeled");
      assertRejected(s, { name: "move_step", params: { id: "missing", x: 0, y: 0 } }, "precondition_failed");
      assertRejected(s, { name: "move_step", params: { id: "a", x: seed + 0.5, y: 0 } }, "invalid_argument");
      assertRejected(s, { name: "rename_step", params: { id: "a", label: "x", extra: true } }, "invalid_argument");
      assertRejected(s, add("x".repeat(4097)), "invalid_argument");
      assertRejected(s, { name: "reconnect_end", params: { id: "ab", end: "nonsense", target: "a" } }, "invalid_argument");
    }
    for (const effects of [["tombstone_step"], ["tombstone_step", "detach_incident_arrows", "set_label"]] as const) {
      const w = world(); w.rules.find(r => r.action === "delete_step")!.effects = [...effects];
      assertRejected(new Session(w, 1, "T1"), { name: "delete_step", params: { id: "b" } }, "unmodeled");
    }
    const w = world(); w.actions.find(a => a.name === "move_step")!.preconditions = [{ op: "false" }];
    assertRejected(new Session(w, 1, "T1"), { name: "move_step", params: { id: "a", x: 0, y: 0 } }, "precondition_failed");
    const coverage = world(); coverage.rules = coverage.rules.filter(r => r.action !== "move_step");
    assertRejected(new Session(coverage, 1, "T1"), { name: "move_step", params: { id: "a", x: 0, y: 0 } }, "unmodeled");
  });
  it("baseStep rejects stale and future actions without hash or log change", () => {
    const s = new Session(world(), 2, "T1"); must(s, { ...add(), baseStep: 0 });
    for (const baseStep of [0, 2, -1, 0.5]) assertRejected(s, { name: "rename_step", params: { id: "a", label: "x" }, baseStep }, baseStep < 0 || !Number.isInteger(baseStep) ? "invalid_argument" : "stale_base");
  });
  it("undo/reset are exact; same prefix recreates same id, changed branch yields different id", () => {
    const s = new Session(world(), 44, "T1"); const initial = s.serialize();
    must(s, add("First")); const first = s.serialize(); const firstId = first.state.objects[creationId(s.world, add("First"), { seed: 44, prefix: [] })]!.id;
    assert.equal(s.undo().ok, true); assert.equal(s.hash, initial.hash); assert.equal(s.step, 0);
    must(s, add("Second")); const secondId = Object.keys(s.state.objects).find(id => !Object.hasOwn(initial.state.objects, id))!; assert.notEqual(secondId, firstId);
    s.undo(); must(s, add("First")); assert.deepEqual(s.serialize(), first);
    must(s, { name: "delete_step", params: { id: firstId } }); const dead = s.state.objects[firstId]!; assert.equal(dead.deleted, true);
    assertRejected(s, { name: "rename_step", params: { id: firstId, label: "Reuse" } }, "precondition_failed");
    s.reset(); assert.deepEqual(s.serialize(), initial); assert.equal(s.undo().ok, true);
  });
  it("real core deletion preserves step tombstone and detaches both incident arrow ends; disconnect tombstones whole arrow", () => {
    const s = new Session(world(), 0, "T1"); must(s, { name: "delete_step", params: { id: "b" } });
    assert.equal(s.state.objects.b!.deleted, true);
    const ab = s.state.objects.ab!; const bc = s.state.objects.bc!;
    assert.equal(ab.type === "arrow" && ab.to, null); assert.equal(bc.type === "arrow" && bc.from, null);
    must(s, { name: "disconnect", params: { id: "ab" } }); const gone = s.state.objects.ab!;
    assert.deepEqual(gone, { id: "ab", type: "arrow", deleted: true, frameId: "f", from: null, to: null });
    assertRejected(s, { name: "reconnect_end", params: { id: "ab", end: "end", target: "c" } }, "precondition_failed");
  });
  it("reconnect supports each end and enforces live targets in the same frame", () => {
    const s = new Session(world(), 0, "T1"); must(s, { name: "reconnect_end", params: { id: "ab", end: "start", target: "c" } });
    assert.equal(s.state.objects.ab!.type === "arrow" && s.state.objects.ab!.from, "c");
    const w = world(); w.initialState.objects.g = { id: "g", type: "frame", name: "Other", deleted: false };
    w.initialState.objects.d = { id: "d", type: "step", deleted: false, frameId: "g", label: "d", x: 0, y: 0, width: 120, height: 60, fontFamily: 1 };
    const other = new Session(w, 0, "T1");
    assertRejected(other, { name: "connect", params: { frameId: "f", from: "a", to: "d" } }, "precondition_failed");
    assertRejected(other, { name: "reconnect_end", params: { id: "ab", end: "end", target: "d" } }, "precondition_failed");
  });
  it("state, world, result and log cannot mutate Session through exposed aliases", () => {
    const w = world(); const s = new Session(w, 0, "T1"); const initialHash = s.hash;
    w.initialState.objects.a!.deleted = true; s.state.objects.a!.deleted = true; s.world.initialState.objects.a!.deleted = true;
    assert.equal(s.hash, initialHash);
    const action = add(); const result = s.act(action); assert.equal(result.ok, true); const hash = s.hash;
    if (result.ok) Object.values(result.state.objects)[0]!.deleted = true;
    action.params.label = "mutated"; s.log[0]!.action.params.label = "mutated";
    assert.equal(s.hash, hash); assert.equal(s.checkReplay().ok, true);
  });
  it("replay rejects tampered step hashes, altered logs, skipped actions and unknown effects", () => {
    const s = new Session(world(), 1, "T1"); must(s, add()); must(s, { name: "rename_step", params: { id: "a", label: "Changed" } });
    const logs: LogEntry[][] = [s.log, s.log, s.log.slice(1)];
    logs[0]![0]!.hash = "0".repeat(64); logs[1]![0]!.action.params.label = "tampered";
    for (const log of logs) { const r = s.replay(log); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.code, "replay_mismatch"); }
    assert.equal(s.checkReplay().ok, true);
  });
  it("snapshot cap evicts old snapshots; undo falls back to replay and remains exact", () => {
    const s = new Session(world(), 0, "T1"); const firstHash = (() => { must(s, { name: "rename_step", params: { id: "a", label: "0" } }); return s.hash; })();
    for (let i = 1; i <= 1001; i++) must(s, { name: "rename_step", params: { id: "a", label: String(i) } });
    assert.equal(s.snapshotCount, 1000); assert.ok(s.snapshotBytes <= 64 * 1024 * 1024);
    while (s.step > 1) assert.equal(s.undo().ok, true);
    assert.equal(s.hash, firstHash); assert.equal(s.checkReplay().ok, true); s.undo(); assert.equal(s.hash, stateHash(generateVariant(world(), 0).initialState));
  });
  it("object hard ceiling rejects creation atomically including retained tombstones", () => {
    const w = world(); for (let i = 0; i < 9994; i++) w.initialState.objects[`old${i}`] = { id: `old${i}`, type: "frame", deleted: true, name: "retained" };
    const s = new Session(w, 0, "T1"); assertRejected(s, add(), "limit_exceeded");
  });
  it("one transition fuel ceiling spans all action/rule ASTs and atomic rejection survives saturation", () => {
    const predicate: Predicate = {
      op: "gte",
      left: { kind: "count", type: "frame", as: "f", where: { op: "all", args: Array.from({ length: 128 }, () => ({ op: "true" as const })) } },
      right: { kind: "literal", value: 0 },
    };
    for (const mode of ["action", "rules", "mixed"] as const) {
      const w = world();
      for (let i = 0; i < 94; i++) w.initialState.objects[`f${i}`] = { id: `f${i}`, type: "frame", deleted: false, name: "Fuel saturation" };
      const individual = evaluate(predicate, w.initialState);
      if (!individual.ok) assert.fail(individual.error.message);
      assert.equal(individual.value, true);
      assert.ok(individual.steps < RUNTIME_LIMITS.checkerFuel, "each AST fits its budget");
      assert.ok(individual.steps * 128 > RUNTIME_LIMITS.checkerFuel, "aggregate exceeds one transition budget");
      if (mode === "mixed") assert.ok(individual.steps * 64 < RUNTIME_LIMITS.checkerFuel, "each group fits separately, but together exceeds the ceiling");
      const action = w.actions.find(a => a.name === "rename_step")!;
      const rule = w.rules.find(r => r.action === "rename_step")!;
      if (mode === "action") action.preconditions = Array.from({ length: 128 }, () => structuredClone(predicate));
      if (mode === "rules") w.rules = Array.from({ length: 128 }, (_, i) => ({ ...structuredClone(rule), id: `saturation${i}`, preconditions: [structuredClone(predicate)] }));
      if (mode === "mixed") {
        action.preconditions = Array.from({ length: 64 }, () => structuredClone(predicate));
        rule.preconditions = Array.from({ length: 64 }, () => structuredClone(predicate));
      }
      const s = new Session(validateWorld(w), 0, "T1");
      assertRejected(s, { name: "rename_step", params: { id: "a", label: "Must not commit" } }, "checker_fuel_exhausted");
      assert.equal(s.state.objects.a!.type === "step" && s.state.objects.a!.label, "A");
    }
  });
  it("apply never mutates caller world, state or action", () => {
    const w = generateVariant(world(), 1); const state = structuredClone(w.initialState); const action = add();
    const before = stateHash({ w, state, action }); const result = apply(w, state, action, { seed: 1, prefix: [] });
    assert.equal(result.ok, true); assert.equal(stateHash({ w, state, action }), before);
  });
});

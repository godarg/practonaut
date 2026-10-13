import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluate } from "../../src/predicate/index.ts";
import type { Predicate, State, Value } from "../../src/world/types.ts";

const state: State = { objects: {
  f: { id: "f", type: "frame", deleted: false, name: "Frame" },
  a: { id: "a", type: "step", deleted: false, frameId: "f", label: "<script>literal</script>", x: 10, y: 20, width: 100, height: 50, fontFamily: 1 },
  b: { id: "b", type: "step", deleted: true, frameId: "f", label: "deleted", x: 0, y: 0, width: 100, height: 50, fontFamily: 1 },
} };
const literal = (value: string | number | boolean | null): Value => ({ kind: "literal", value });
const field = (variable: string, key: string): Value => ({ kind: "field", variable, field: key });
const eq = (left: Value, right: Value): Predicate => ({ op: "eq", left, right });
const run = (p: Predicate): boolean => { const r = evaluate(p, state); if (!r.ok) assert.fail(r.error.message); return r.value; };

describe("bounded predicate language", () => {
  it("constants, boolean combinators and scalar comparison operators have exact total semantics", () => {
    assert.equal(run({ op: "all", args: [] }), true); assert.equal(run({ op: "any", args: [] }), false);
    assert.equal(run({ op: "not", arg: { op: "false" } }), true);
    assert.equal(run(eq(literal(1), literal("1"))), false);
    for (const op of ["lt", "lte", "gt", "gte"] as const) {
      const r = run({ op, left: literal(2), right: literal(3) }); assert.equal(r, op === "lt" || op === "lte");
    }
    assert.equal(run({ op: "all", args: [{ op: "true" }, eq(literal(null), literal(null))] }), true);
  });
  it("quantifiers exclude tombstones, counts use live objects and text remains literal", () => {
    assert.equal(run({ op: "exists", type: "step", as: "s", where: eq(field("s", "label"), literal("deleted")) }), false);
    assert.equal(run({ op: "exists", type: "step", as: "s", where: eq(field("s", "label"), literal("<script>literal</script>")) }), true);
    assert.equal(run(eq({ kind: "count", type: "step", as: "s", where: { op: "true" } }, literal(1))), true);
    assert.equal(run({ op: "every", type: "arrow", as: "a", where: { op: "false" } }), true);
  });
  it("nested quantifiers have lexical scope and shadowing never mutates outer bindings", () => {
    const p: Predicate = { op: "exists", type: "step", as: "x", where: { op: "all", args: [
      { op: "exists", type: "frame", as: "x", where: eq(field("x", "name"), literal("Frame")) },
      eq(field("x", "id"), literal("a")),
      { op: "exists", type: "frame", as: "f", where: eq(field("x", "frameId"), field("f", "id")) },
    ] } };
    assert.equal(run(p), true);
  });
  it("unbound variables, forbidden fields, code, regex and ill-typed ordered comparison fail closed", () => {
    const invalid: unknown[] = [eq(field("u", "id"), literal("a")), { op: "regex", pattern: "(a+)+" }, { op: "eval", code: "true" }, eq({ kind: "field", variable: "s", field: "constructor" }, literal("x")), { op: "gt", left: literal("2"), right: literal(1) }];
    for (const p of invalid) { const r = evaluate(p as Predicate, state); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.code, "checker_invalid"); }
    const absent: Predicate = { op: "exists", type: "frame", as: "s", where: eq(field("s", "label"), literal("x")) };
    assert.equal(evaluate(absent, state).ok, false);
  });
  it("fuel charges constants, values, filtered objects and short-circuit work; zero is exhaustion", () => {
    const zero = evaluate({ op: "true" }, state, { fuel: 0 }); assert.equal(zero.ok, false); if (!zero.ok) assert.equal(zero.error.code, "checker_fuel_exhausted");
    assert.deepEqual(evaluate({ op: "true" }, state, { fuel: 1 }), { ok: true, value: true, steps: 1 });
    const comparison = eq(literal(1), literal(1)); const two = evaluate(comparison, state, { fuel: 2 }); assert.equal(two.ok, false);
    assert.deepEqual(evaluate(comparison, state, { fuel: 3 }), { ok: true, value: true, steps: 3 });
    assert.deepEqual(evaluate({ op: "any", args: [{ op: "true" }, comparison] }, state, { fuel: 2 }), { ok: true, value: true, steps: 2 });
    const every: Predicate = { op: "every", type: "arrow", as: "a", where: { op: "true" } };
    const filtered = evaluate(every, state, { fuel: 3 }); assert.equal(filtered.ok, false); if (!filtered.ok) assert.equal(filtered.error.code, "checker_fuel_exhausted");
    assert.deepEqual(evaluate(every, state, { fuel: 4 }), { ok: true, value: true, steps: 4 });
    for (const fuel of [-1, 1.5, 1_000_001, Infinity]) assert.equal(evaluate({ op: "true" }, state, { fuel }).ok, false);
  });
  it("deep, cyclic and broad ASTs reject before recursive parsing", () => {
    let p: Predicate = { op: "true" }; for (let i = 0; i < 50; i++) p = { op: "not", arg: p };
    const r = evaluate(p, state); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.code, "checker_invalid");
    const cycle = { op: "not", arg: {} }; cycle.arg = cycle; assert.equal(evaluate(cycle as Predicate, state).ok, false);
    assert.equal(evaluate({ op: "all", args: Array.from({ length: 5000 }, () => ({ op: "true" })) }, state).ok, false);
  });
});

// Canonical JSON and state hash. Expected values do NOT come from the code under test:
// - canonical strings are written by hand from the RFC 8785 rules;
// - sha256 values were computed with Python 3 `hashlib.sha256(s.encode("utf-8")).hexdigest()`
//   over the literal canonical string shown next to each constant (2026-10-03);
// - the key-order and number vectors are from RFC 8785 §3.2.3 and §3.2.2.3 (documented).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CanonicalError, MAX_CANONICAL_DEPTH, canonicalJson, sha256Hex, stateHash } from "../../src/canonical/index.ts";

describe("canonicalJson", () => {
  it("sorts keys and serialises primitives (hand-derived)", () => {
    const v = { b: 1, "é": 0.5, a: [true, null, "x"] };
    assert.equal(canonicalJson(v), '{"a":[true,null,"x"],"b":1,"é":0.5}');
  });

  it("orders keys by UTF-16 code units, not code points (RFC 8785 §3.2.3 example)", () => {
    const v = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      "ö": "Latin Small Letter O With Diaeresis",
    };
    const expected =
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';
    assert.equal(canonicalJson(v), expected);
    // Python: sha256 of the string above (emoji before U+FB33, as RFC 8785 requires).
    assert.equal(stateHash(v), "5e321556d22018a9656991a9e94f77ec175fa193e52a2429d312f8419ec8b08c");
  });

  it("serialises numbers the ECMAScript way (RFC 8785 §3.2.2.3)", () => {
    const v = { n: [1e21, 1e-7, 333333333.33333329, -0, 4.5, 2e-3, 0.000001] };
    assert.equal(canonicalJson(v), '{"n":[1e+21,1e-7,333333333.3333333,0,4.5,0.002,0.000001]}');
    assert.equal(stateHash(v), "56c9d837ce2f1cacec5c0eaed21c8787026df6f0f66d4af2583838126db5436b");
  });

  it("escapes control characters and keeps other characters literal", () => {
    assert.equal(canonicalJson("a\u0001\n\"\\/ "), '"a\\u0001\\n\\"\\\\/ "');
  });

  it("is independent of insertion order", () => {
    assert.equal(canonicalJson({ z: { b: [], a: {} }, a: -0.000001 }), '{"a":-0.000001,"z":{"a":{},"b":[]}}');
    assert.equal(stateHash({ z: { b: [], a: {} }, a: -0.000001 }), "08d9b47f6fb718b14c363471fed48fb7da513b449389bf877ac3190e5f328450");
  });

  it("hashes the empty object (Python oracle)", () => {
    assert.equal(stateHash({}), "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
    assert.equal(stateHash({ b: 1, "é": 0.5, a: [true, null, "x"] }), "86eb7538ee9a1eb9103deeac18bc6597986148665cebda2f841b13f96248b64f");
  });

  it("accepts null-prototype objects", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.b = 2;
    o.a = 1;
    assert.equal(canonicalJson(o), '{"a":1,"b":2}');
  });

  const rejected: Array<[string, unknown]> = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity in an array", [Number.NEGATIVE_INFINITY]],
    ["undefined", undefined],
    ["undefined property", { a: undefined }],
    ["function", () => 1],
    ["bigint", 1n],
    ["symbol", Symbol("s")],
    ["Date", new Date(0)],
    ["Map", new Map()],
    ["class instance", new (class P { x = 1; })()],
    ["sparse array", [1, , 3]], // eslint-disable-line no-sparse-arrays
    ["lone high surrogate", "\ud800"],
    ["lone low surrogate in a key", { "\udc00": 1 }],
    ["symbol key", { [Symbol("k")]: 1 }],
  ];
  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      assert.throws(() => canonicalJson(value), CanonicalError);
    });
  }

  it("rejects arrays with extra or non-enumerable properties and objects with hidden keys", () => {
    const withProp = Object.assign([1], { extra: 2 });
    assert.throws(() => canonicalJson(withProp), CanonicalError);
    const hiddenOnArray = [1];
    Object.defineProperty(hiddenOnArray, "hidden", { value: 2, enumerable: false });
    assert.throws(() => canonicalJson(hiddenOnArray), CanonicalError);
    const symArray = Object.assign([1], { [Symbol("s")]: 2 });
    assert.throws(() => canonicalJson(symArray), CanonicalError);
    const hidden = { v: 1 };
    Object.defineProperty(hidden, "hidden", { value: 2, enumerable: false });
    assert.throws(() => canonicalJson(hidden), CanonicalError);
    const getter = Object.defineProperty({}, "g", { get: () => 1, enumerable: true });
    assert.throws(() => canonicalJson(getter), CanonicalError);
    class Sub extends Array<number> {}
    assert.throws(() => canonicalJson(Sub.from([1])), CanonicalError);
    assert.equal(canonicalJson([1, [2]]), "[1,[2]]");
  });

  it("rejects cycles and excessive depth instead of overflowing the stack", () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    assert.throws(() => canonicalJson(cyc), CanonicalError);
    let deep: unknown = 1;
    for (let i = 0; i < MAX_CANONICAL_DEPTH + 1; i++) deep = [deep];
    assert.throws(() => canonicalJson(deep), /nesting deeper/);
    let ok: unknown = 1;
    for (let i = 0; i < MAX_CANONICAL_DEPTH; i++) ok = [ok];
    assert.doesNotThrow(() => canonicalJson(ok));
  });

  it("sha256Hex matches the FIPS 180-2 'abc' vector", () => {
    assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

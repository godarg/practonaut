import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { stateHash } from "../../src/canonical/index.ts";
import { checkState, checkSubmission, parseExcalidraw, parseSession } from "../../src/checker/index.ts";
import type { Predicate, State, World } from "../../src/world/types.ts";

const count = (n: number): Predicate => ({ op: "eq", left: { kind: "count", type: "step", as: "s", where: { op: "true" } }, right: { kind: "literal", value: n } });
function world(goal = count(1)): World { return {
  schema: "practonaut.world/1", id: "checker-test", version: "1.0.0", app: { adapterId: "excalidraw", versionRange: "0.18.1", fontFamilies: [3], excludedAttributes: {} },
  units: { length: "integer" }, objectTypes: [{ type: "frame", attributes: {} }, { type: "step", attributes: {} }, { type: "arrow", attributes: {} }],
  initialState: { objects: { F: { id: "F", type: "frame", name: "Process", deleted: false } } }, actions: [{ name: "add_step", parameters: {}, preconditions: [] }], rules: [{ id: "rule1", action: "add_step", status: "confirmed", preconditions: [], effects: ["create_step"], evidence: [{ run: "test", case: "test", sha256: "1".repeat(64) }] }],
  tasks: [{ id: "T1", title: { en: "Build", de: "Bauen" }, prompt: { en: "Add a step.", de: "Schritt hinzufügen." }, goal, hints: [{ en: "Add a box.", de: "Box hinzufügen." }], errorClasses: [] }],
  variants: { generator: "finite-seeded-v1", cases: [{ id: "v1", labels: {}, insertPosition: 1, layoutOffset: { x: 0, y: 0 } }] },
  provenance: { authors: ["test"], adapterVersion: "1.0.0", appVersion: "0.18.1", compileToolVersion: "1.0.0", recordings: [] }, rights: { license: "CC0-1.0", assets: [], recordings: [] },
}; }
const good: State = { objects: { F: { id: "F", type: "frame", name: "Process", deleted: false }, A: { id: "A", type: "step", frameId: "F", label: "Start", deleted: false, x: 10, y: 10, width: 200, height: 80, fontFamily: 3 } } };
function native(): Record<string, unknown> {
  const base = { isDeleted: false, angle: 0, link: null, width: 200, height: 80, x: 10, y: 10 };
  return { type: "excalidraw", version: 2, files: {}, elements: [
    { ...base, id: "F", type: "frame", name: "Process", frameId: null, customData: { practonautId: "F" } },
    { ...base, id: "A", type: "rectangle", frameId: "F", customData: { practonautId: "A" }, boundElements: [{ id: "A:text", type: "text" }] },
    { ...base, id: "A:text", type: "text", frameId: "F", customData: { practonautId: "A" }, containerId: "A", fontFamily: 3, text: "Start", originalText: "Start" },
  ] };
}
const errorCode = (code: string) => (e: unknown): boolean => typeof e === "object" && e !== null && "code" in e && e.code === code;
test("checker accepts a valid independent end state and rejects empty and unchanged", () => {
  assert.equal(checkState(world(), good).passed, true);
  assert.equal(checkState(world(), { objects: {} }).passed, false);
  assert.equal(checkState(world(), world().initialState).passed, false);
  assert.equal(checkState(world(), good).scope, "end-state-only");
});
test("counterprobe rejects a vacuous predicate before any verdict", () => {
  assert.throws(() => checkState(world({ op: "true" }), good), errorCode("counterprobe_failed"));
});
test("checker fuel exhaustion is a named failure, never pass or false", () => {
  assert.throws(() => checkState(world(), good, { fuel: 0 }), errorCode("checker_fuel_exhausted"));
});
test("checker parses native bound text independently and accepts alternative layout", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseExcalidraw(JSON.stringify(native())))), good);
  const n = native(); const e = n.elements as Array<Record<string, unknown>>; e[1]!.x = 400;
  assert.equal(checkSubmission(world(), JSON.stringify(n)).passed, true);
});
test("ordinary native export uses native identities and bound-text container without Practonaut annotation", () => {
  for (const metadata of [undefined, null, {}, { unrelated: "native-editor-data" }]) {
    const n = native(), elements = n.elements as Array<Record<string, unknown>>;
    for (const element of elements) { if (metadata === undefined) delete element.customData; else element.customData = metadata; }
    assert.deepEqual(JSON.parse(JSON.stringify(parseExcalidraw(JSON.stringify(n)))), good);
    assert.equal(checkSubmission(world(), JSON.stringify(n)).passed, true);
  }
});
test("native fallback retains metadata identity, collision, binding, type and reserved-id refusals", () => {
  const unannotated = (): Array<Record<string, unknown>> => {
    const elements = native().elements as Array<Record<string, unknown>>;
    for (const element of elements) delete element.customData;
    return elements;
  };
  const withArrow = (): Array<Record<string, unknown>> => {
    const elements = unannotated();
    (elements[1]!.boundElements as Array<Record<string, unknown>>).push({ id: "R", type: "arrow" });
    elements.push({ ...elements[1], id: "R", type: "arrow", boundElements: [], startBinding: { elementId: "A" }, endBinding: { elementId: "A" } });
    return elements;
  };
  const rejects = (elements: Array<Record<string, unknown>>, label: string): void => {
    assert.throws(() => parseExcalidraw(JSON.stringify({ type: "excalidraw", version: 2, files: {}, elements })), errorCode("artifact_invalid"), label);
  };
  // Annotation may assert an existing identity, never alias it or mask a native relationship.
  for (const [index, claimed] of [[0, "other-frame"], [1, "other-step"], [1, "F"], [2, "F"]] as const) {
    const elements = unannotated(); elements[index]!.customData = { practonautId: claimed }; rejects(elements, "lying or colliding annotation");
  }
  for (const claimed of [null, 3, { id: "A" }]) {
    const elements = unannotated(); elements[1]!.customData = { practonautId: claimed }; rejects(elements, "invalid explicit metadata cannot fall back");
  }
  const duplicate = unannotated(); duplicate[2]!.id = "A"; rejects(duplicate, "duplicate native text and rectangle identity");
  const collision = withArrow(); collision[3]!.customData = { practonautId: "A" }; rejects(collision, "arrow semantic collision");
  const wrongContainer = unannotated(); wrongContainer[2]!.customData = { practonautId: "A" }; wrongContainer[2]!.containerId = "F"; rejects(wrongContainer, "metadata cannot conceal wrong text container");
  const phantomText = unannotated(); phantomText[1]!.boundElements = [{ id: "absent", type: "text" }]; rejects(phantomText, "phantom text binding");
  for (const target of ["absent", "F", "constructor"]) {
    const elements = withArrow(); elements[3]!.startBinding = { elementId: target }; rejects(elements, "phantom or wrong-type endpoint");
  }
  const noBackref = withArrow(); noBackref[1]!.boundElements = [{ id: "A:text", type: "text" }]; rejects(noBackref, "missing arrow reciprocal binding");
  const falseBackref = withArrow(); falseBackref[3]!.startBinding = null; falseBackref[3]!.endBinding = null; rejects(falseBackref, "false arrow back-reference");
  const spoof = unannotated(); spoof[1]!.type = "text"; rejects(spoof, "native type spoof");
  for (const unsafe of ["", "x".repeat(65), "../escape", "a:b", "a.b", "a b", "__proto__", "prototype", "constructor"]) {
    const elements = unannotated(); elements[0]!.id = unsafe; elements[1]!.frameId = unsafe; elements[2]!.frameId = unsafe; rejects(elements, "unsafe native semantic identity");
    const annotated = unannotated(); annotated[1]!.customData = { practonautId: unsafe }; rejects(annotated, "unsafe explicit identity");
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});
test("export manipulation missing label, phantom frame, float geometry, type spoof, link and orphan text rejected", () => {
  const changes = [
    (e: Array<Record<string, unknown>>) => e.pop(),
    (e: Array<Record<string, unknown>>) => { e[1]!.frameId = "absent"; },
    (e: Array<Record<string, unknown>>) => { e[1]!.x = 0.5; },
    (e: Array<Record<string, unknown>>) => { e[1]!.type = "image"; },
    (e: Array<Record<string, unknown>>) => { e[1]!.link = "https://example.invalid"; },
    (e: Array<Record<string, unknown>>) => { e[2]!.containerId = "absent"; },
    (e: Array<Record<string, unknown>>) => { e[2]!.originalText = "Hidden answer"; },
  ];
  for (const change of changes) { const n = native(); change(n.elements as Array<Record<string, unknown>>); assert.throws(() => parseExcalidraw(JSON.stringify(n)), errorCode("artifact_invalid")); }
});
test("session hash, world mismatch and forged success with empty history are rejected", () => {
  const w = world(); const session = { schema: "practonaut.session/1", world: { id: w.id, version: w.version }, seed: 0, taskId: "T1", toolVersion: "0.0.0", log: [], state: good, hash: stateHash(good) };
  assert.throws(() => checkSubmission(w, JSON.stringify(session)), errorCode("artifact_invalid"));
  assert.throws(() => parseSession(JSON.stringify({ ...session, hash: "0".repeat(64) }), w), errorCode("artifact_invalid"));
  assert.throws(() => parseSession(JSON.stringify({ ...session, done: true }), w), errorCode("artifact_invalid"));
  assert.throws(() => parseSession(JSON.stringify({ ...session, toolVersion: "99.0.0" }), w), errorCode("artifact_invalid"));
  assert.throws(() => parseSession(JSON.stringify({ ...session, world: { id: "other", version: w.version } }), w), errorCode("artifact_invalid"));
});
test("session parser rejects unsafe log keys before schema transformation without changing permitted text", () => {
  const w = world();
  const hash = stateHash(good);
  const session = { schema: "practonaut.session/1", world: { id: w.id, version: w.version }, seed: 0, taskId: "T1", toolVersion: "0.0.0", log: [{ action: { name: "rename_step", params: { id: "A", label: "__proto__" } }, hash }], state: good, hash };
  const encoded = JSON.stringify(session);
  assert.deepEqual(parseSession(encoded, w).log, session.log);
  // JSON.parse preserves each own key; a literal __proto__ property would test JavaScript's
  // object-literal semantics instead of the hostile serialized boundary.
  for (const key of ["__proto__", "prototype", "constructor"]) {
    const raw = JSON.parse(encoded) as typeof session;
    Object.defineProperty(raw.log[0]!.action.params, key, { value: "A", enumerable: true });
    const hostile = JSON.stringify(raw);
    assert.ok(Object.hasOwn(JSON.parse(hostile).log[0].action.params, key));
    assert.throws(() => parseSession(hostile, w), errorCode("artifact_invalid"), key);
    assert.throws(() => checkSubmission(w, hostile), errorCode("artifact_invalid"), key);
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});
test("state parser rejects semantic id aliases and phantom relations", () => {
  const alias = structuredClone(good); alias.objects.A!.id = "other";
  assert.throws(() => checkState(world(), alias), errorCode("artifact_invalid"));
  const phantom = structuredClone(good); phantom.objects.R = { id: "R", type: "arrow", deleted: false, frameId: "F", from: "absent", to: "A" };
  assert.throws(() => checkState(world(), phantom), errorCode("artifact_invalid"));
});
/** Walk static/dynamic import and re-export dependencies, including type-only imports. */
function dependencyViolations(entries: string[]): string[] {
  const visited = new Set<string>(); const forbidden: string[] = [];
  const walk = (file: string): void => {
    if (visited.has(file)) return; visited.add(file);
    if (/^src\/(core|adapters)(\/|$)/.test(relative(process.cwd(), file))) { forbidden.push(relative(process.cwd(), file)); return; }
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const specs = [...source.matchAll(/\b(?:import|export)\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/g), ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g)].map(m => m[1]!);
    for (const spec of specs) {
      if (spec.startsWith(".")) { const target = resolve(dirname(file), spec.replace(/\.js$/, ".ts")); if (existsSync(target)) walk(target); }
      if (spec.startsWith("#") || spec.startsWith("src/")) forbidden.push(`unresolved local alias ${spec}`);
    }
  }; for (const f of entries) walk(f); return forbidden;
}
test("checker and evaluation worker dependency graphs import neither core nor adapters transitively", () => {
  const entries = [...readdirSync("src/checker").filter(f => f.endsWith(".ts")).map(f => resolve("src/checker", f)), resolve('src/evaluation/checker-worker.ts')];
  assert.deepEqual(dependencyViolations(entries), []);
});

test("bundled fixture truth is independent of input layout and near-miss cannot pass", async () => {
  const { validateCheckerData } = await import("../../src/checker/index.ts");
  const w = world(); const alternative = structuredClone(good);
  const a = alternative.objects.A!; if (a.type === "step") { a.x = -300; a.y = 400; }
  const data = { schema: "practonaut.checker/1", world: { id: w.id, version: w.version }, heldOutTasks: [], fixtures: [
    { taskId: "T1", kind: "alternative", expected: true, state: alternative },
    { taskId: "T1", kind: "near-miss", expected: false, state: { objects: {} } },
  ] };
  const bundle = validateCheckerData(data, w);
  assert.equal(checkState(w, alternative, { bundle }).passed, true);
  assert.throws(() => checkState(w, alternative, { bundle: { ...bundle, fixtures: bundle.fixtures.map(f => f.kind === "near-miss" ? { ...f, state: good } : f) } }), errorCode("counterprobe_failed"));
  assert.throws(() => validateCheckerData({ ...data, fixtures: [] }, w), errorCode("checker_invalid"));
});

test("real Excalidraw UI deletion export preserves tombstones and shows loose arrow endpoints", () => {
  const state = parseExcalidraw(readFileSync("tests/fixtures/checker/real-ui-delete.excalidraw"));
  assert.equal(state.objects.b?.deleted, true);
  const ab = state.objects.ab, bc = state.objects.bc;
  assert.equal(ab?.type, "arrow"); assert.equal(bc?.type, "arrow");
  if (ab?.type === "arrow" && bc?.type === "arrow") { assert.equal(ab.to, null); assert.equal(bc.from, null); }
});

test("flow checker accepts all hand-authored references and alternatives, rejects near-misses across seeded variants", async () => {
  const { buildWorld } = await import("../../tools/freeze-world.ts");
  const { ACTION_NAMES } = await import("../../src/world/types.ts");
  const { validateCheckerData, generateCheckerVariant } = await import("../../src/checker/index.ts");
  const w = buildWorld(Object.fromEntries(ACTION_NAMES.map(n => [n, { run: "draft-test-evidence", case: n, sha256: "0".repeat(64) }])));
  const b = validateCheckerData(JSON.parse(readFileSync("examples/worlds/flow-diagram.check/checker.json", "utf8")), w);
  for (const seed of [0, 1, 2, 7, 42]) for (const f of generateCheckerVariant(w, b, seed).fixtures) {
    const verdict = checkState(w, f.state, { seed, taskId: f.taskId, bundle: b });
    assert.equal(verdict.passed, f.expected, `${seed}/${f.taskId}/${f.kind}`);
    if (f.kind === "near-miss" && f.taskId !== "H1") assert.ok(verdict.tasks[0]?.errors.some(e => e.id === "loose-arrow"));
  }
});

test("checker accepts a serialized real Session without trusting its action history", async () => {
  // Runtime is used only as an integration producer here; checker modules cannot import it.
  const { Session } = await import("../../src/core/session.ts");
  const w = world(); const data = new Session(w, 0, "T1").serialize();
  const { PACKAGE_VERSION } = await import('../../src/version.ts');
  assert.equal(data.toolVersion, PACKAGE_VERSION);
  const verdict = checkSubmission(w, JSON.stringify(data));
  assert.equal(verdict.passed, false); assert.equal(verdict.scope, "end-state-only");
});

test("checker variant substitutes once, includes insertPosition and matches declared world fields", async () => {
  const { generateCheckerVariant } = await import("../../src/checker/index.ts");
  const { generateVariant } = await import("../../src/world/variant.ts");
  const w = world();
  w.variants.cases = [{ id: "only", labels: { first: "{{second}}", second: "expanded" }, insertPosition: 2, layoutOffset: { x: 20, y: -10 } }];
  const alternative = structuredClone(good);
  if (alternative.objects.A?.type === "step") alternative.objects.A.label = "{{first}}";
  const task = structuredClone(w.tasks[0]!); task.id = "H1";
  task.initialState = structuredClone(w.initialState);
  task.title = { en: "Gap {{insertPosition}}: {{first}}", de: "Lücke {{insertPosition}}: {{first}}" };
  task.goal = { op: "exists", type: "step", as: "s", where: { op: "eq", left: { kind: "field", variable: "s", field: "label" }, right: { kind: "literal", value: "{{first}}" } } };
  const b = { schema: "practonaut.checker/1" as const, world: { id: w.id, version: w.version }, heldOutTasks: [task], fixtures: [
    ...["T1", "H1"].flatMap(taskId => [{ taskId, kind: "alternative" as const, expected: true, state: alternative }, { taskId, kind: "near-miss" as const, expected: false, state: w.initialState }]),
  ] };
  const generated = generateCheckerVariant(w, b, 0);
  const step = generated.fixtures[0]?.state.objects.A;
  assert.equal(step?.type === "step" ? step.label : undefined, "{{second}}");
  assert.equal(step?.type === "step" ? step.x : undefined, 30);
  assert.equal(generated.heldOutTasks[0]?.title.en, "Gap 2: {{second}}");
  const augmented = generateVariant({ ...w, tasks: [...w.tasks, task] }, 0);
  assert.deepEqual(generated.heldOutTasks[0], augmented.tasks.find(t => t.id === "H1"));
  assert.equal(checkState(w, generated.fixtures[2]!.state, { taskId: "H1", bundle: b }).passed, true);
});

test("held-out H1 has a forward runtime witness from its declared start, with matching fixture frame", async () => {
  const { buildWorld } = await import("../../tools/freeze-world.ts");
  const { ACTION_NAMES } = await import("../../src/world/types.ts");
  const { generateCheckerVariant, validateCheckerData } = await import("../../src/checker/index.ts");
  const { Session } = await import("../../src/core/session.ts");
  const w = buildWorld(Object.fromEntries(ACTION_NAMES.map(n => [n, { run: "draft-test-evidence", case: n, sha256: "0".repeat(64) }])));
  const b = validateCheckerData(JSON.parse(readFileSync("examples/worlds/flow-diagram.check/checker.json", "utf8")), w);
  const task = b.heldOutTasks.find(t => t.id === "H1")!;
  assert.deepEqual(Object.keys(task.initialState!.objects), ["flow-frame"]);
  for (const seed of [0, 1, 2, 7, 42]) {
    // Temporary evaluation-only world, never saved into a pnworld package.
    const session = new Session({ ...w, tasks: [...w.tasks, task] }, seed, "H1");
    const generated = generateCheckerVariant(w, b, seed);
    const reference = generated.fixtures.find(f => f.taskId === "H1" && f.kind === "reference")!;
    assert.deepEqual(session.state.objects["flow-frame"], reference.state.objects["flow-frame"]);
    for (const [index, label] of ["Review", "Archive"].entries()) {
      const result = session.act({ name: "add_step", params: { frameId: "flow-frame", label, x: 100 + index * 240, y: 160, width: 180, height: 100, fontFamily: 3 } });
      assert.equal(result.ok, true);
    }
    const steps = Object.values(session.state.objects).filter(o => o.type === "step");
    assert.equal(session.act({ name: "connect", params: { frameId: "flow-frame", from: steps.find(s => s.type === "step" && s.label === "Review")!.id, to: steps.find(s => s.type === "step" && s.label === "Archive")!.id } }).ok, true);
    assert.equal(checkSubmission(w, JSON.stringify(session.serialize()), { bundle: b }).passed, true);
  }
});

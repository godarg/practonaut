import { generateVariant, variantIndex } from "../world/variant.ts";
import { validateWorld } from "../world/schema.ts";
import { parseJsonEntry } from "../package/json.ts";
import { evaluate } from "../predicate/index.ts";
import type { CheckerData, CheckerVerdict, Predicate, State, Task, World } from "../world/types.ts";
import { CheckerError } from "./errors.ts";
import { validateSubmissionState, parseSession } from "./state.ts";
import { nativeFormat, type NativeFormatId } from "./formats.ts";
import { validateCheckerData } from "./bundle.ts";
import { verifySessionHistory } from './replay.ts';
export { CheckerError } from "./errors.ts";
export { parseExcalidraw } from "./excalidraw.ts";
export { parseScene, roundedSpan, type SceneGeometry, type SceneReport, type Unmodeled } from "./scene.ts";
export { NATIVE_FORMATS, NATIVE_FORMAT_IDS, nativeFormat, type NativeFormat, type NativeFormatId } from "./formats.ts";
export { parseSession, validateSubmissionState } from "./state.ts";
export { loadCheckerBundle, checkerDataFromBundle, validateCheckerData } from "./bundle.ts";
export interface CheckOptions { seed?: number; taskId?: string; bundle?: CheckerData; fuel?: number }

/** Bundle templates are interpreted only inside evaluation; none is part of the world package. */
export function generateCheckerVariant(world: World, data: CheckerData, seed: number): CheckerData {
  const input = validateCheckerData(data, world);
  const variant = world.variants.cases[variantIndex(world, seed)]!;
  const tokens: Record<string, string> = { ...variant.labels };
  if (variant.insertPosition !== undefined) tokens.insertPosition = String(variant.insertPosition);
  for (const [key, value] of Object.entries(variant.params ?? {})) tokens[key] = String(value);
  // A single replacement pass never interprets token-looking text inside a label value.
  // This implementation is independent of the world's scanner but follows its field contract.
  const replace = (value: string): string => value.replace(/\{\{([\s\S]*?)\}\}/g, (literal: string, key: string): string => Object.hasOwn(tokens, key) ? tokens[key]! : literal);
  const output = structuredClone(input);
  const transformState = (state: State): void => {
    for (const object of Object.values(state.objects)) {
      if (object.type === "frame") object.name = replace(object.name);
      if (object.type !== "step") continue;
      object.label = replace(object.label);
      object.x += variant.layoutOffset.x; object.y += variant.layoutOffset.y;
    }
  };
  const transformPredicate = (raw: unknown): void => {
    if (raw === null || typeof raw !== "object") return;
    const record = raw as Record<string, unknown>;
    if (record.kind === "literal" && typeof record.value === "string") record.value = replace(record.value);
    for (const child of Object.values(record)) if (child !== null && typeof child === "object") transformPredicate(child);
  };
  for (const fixture of output.fixtures) transformState(fixture.state);
  for (const task of output.heldOutTasks) {
    if (task.initialState) transformState(task.initialState);
    for (const localized of [task.title, task.prompt, ...task.hints, ...task.errorClasses.map(e => e.explanation), ...(task.conditionTexts ?? [])]) {
      localized.en = replace(localized.en); localized.de = replace(localized.de);
    }
    transformPredicate(task.goal);
    for (const error of task.errorClasses) transformPredicate(error.when);
  }
  return validateCheckerData(output, world);
}
/** Goal correctness only. Session claims/logs are never treated as proof of action provenance. */
export function checkState(world: World, input: State, options: CheckOptions = {}): CheckerVerdict {
  const validated = validateWorld(world);
  const seed = options.seed ?? 0;
  const variant = generateVariant(validated, seed);
  const bundle = options.bundle ? generateCheckerVariant(validated, options.bundle, seed) : undefined;
  const v2 = validated.schema === "practonaut.world/2";
  const state = validateSubmissionState(input, v2 ? undefined : variant.app.fontFamilies, v2 ? 2 : 1);
  const allTasks = [...variant.tasks, ...(bundle?.heldOutTasks ?? [])];
  const tasks = options.taskId ? allTasks.filter(t => t.id === options.taskId) : variant.tasks;
  if (tasks.length === 0) throw new CheckerError("checker_invalid", "unknown task");
  const budgets = new Map<string, number>();
  let currentTask = "";
  const test = (p: Predicate, s: State): boolean => {
    const r = evaluate(p, s, { fuel: budgets.get(currentTask) ?? options.fuel ?? 1_000_000 });
    if (!r.ok) throw new CheckerError(r.error.code, r.error.message, r.error.details);
    budgets.set(currentTask, (budgets.get(currentTask) ?? options.fuel ?? 1_000_000) - r.steps);
    return r.value;
  };
  const wrongArtifact: State = { objects: { wrong: { id: "wrong", type: "frame", name: "unrelated", deleted: false } } };
  const probe = (task: Task): void => {
    currentTask = task.id;
    for (const [name, s] of [["empty", { objects: {} }], ["unchanged", task.initialState ?? variant.initialState], ["wrongArtifact", wrongArtifact]] as const) {
      if (test(task.goal, s)) throw new CheckerError("counterprobe_failed", `task ${task.id} accepts ${name}`, { taskId: task.id, probe: name });
    }
    if (bundle) for (const f of bundle.fixtures.filter(f => f.taskId === task.id)) {
      if (test(task.goal, f.state) !== f.expected) throw new CheckerError("counterprobe_failed", `task ${task.id} disagrees with ${f.kind} fixture`, { taskId: task.id, probe: f.kind });
    }
  };
  // Complete every selected task's probes before producing any pass/fail verdict.
  for (const task of tasks) probe(task);
  const judgments = tasks.map(t => {
    currentTask = t.id;
    const passed = test(t.goal, state);
    const errors = t.errorClasses.filter(e => test(e.when, state)).map(e => ({ id: e.id, explanation: e.explanation }));
    return { taskId: t.id, passed, errors };
  });
  return { ok: true, scope: "end-state-only", passed: judgments.every(t => t.passed), tasks: judgments, counterprobes: { empty: false, unchanged: false, wrongArtifact: false } };
}
export function checkSubmission(world: World, input: string | Uint8Array, options: CheckOptions & { format?: "session" | NativeFormatId } = {}): CheckerVerdict {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  if (bytes.length > 16 * 1024 * 1024) throw new CheckerError("artifact_invalid", "submission exceeds 16 MiB");
  let isSession = options.format === "session";
  if (options.format === undefined) {
    let raw: unknown;
    try { raw = parseJsonEntry(bytes, "submission.json", 64); } catch { throw new CheckerError("artifact_invalid", "submission is not bounded valid JSON"); }
    isSession = raw !== null && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).schema === "practonaut.session/1";
  }
  if (isSession) {
    const session = parseSession(input, world);
    if (options.seed !== undefined && options.seed !== session.seed) throw new CheckerError("artifact_invalid", "session seed/options mismatch");
    if (options.taskId !== undefined && options.taskId !== session.taskId) throw new CheckerError("artifact_invalid", "session task/options mismatch");
    const validated = validateWorld(world), variant = generateVariant(validated, session.seed);
    const bundle = options.bundle ? generateCheckerVariant(validated, options.bundle, session.seed) : undefined;
    const task = [...variant.tasks, ...(bundle?.heldOutTasks ?? [])].find(task => task.id === session.taskId);
    if (!task) throw new CheckerError('artifact_invalid', 'session task is unknown');
    verifySessionHistory(variant, task, session);
    return checkState(world, session.state, { ...options, seed: session.seed, taskId: session.taskId });
  }
  // The parser is the native format of the world's adapter, from the checker's own table (PADR-0045).
  // For Excalidraw, world/2 accepts any drawing through the tolerant parser; world/1 keeps its strict format.
  const format = nativeFormat(world?.app);
  if (options.format !== undefined && options.format !== format.id) throw new CheckerError("artifact_invalid", `a ${options.format} file is not the native format of this world's adapter (${format.id})`);
  return checkState(world, format.parse(world.schema, input), options);
}

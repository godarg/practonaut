import { z } from "zod";
import { readCheckerBundleFile, type CheckerBundle } from "../package/index.ts";
import { parseJsonEntry } from "../package/json.ts";
import { TaskSchema, validatePredicate } from "../world/schema.ts";
import { preflightJson } from "../world/preflight.ts";
import type { CheckerData, World } from "../world/types.ts";
import { SubmissionStateSchema, validateSubmissionState } from "./state.ts";
import { CheckerError } from "./errors.ts";

const schema = z.strictObject({ schema: z.literal("practonaut.checker/1"),
  world: z.strictObject({ id: z.string().max(64), version: z.string().max(64) }),
  fixtures: z.array(z.strictObject({ taskId: z.string().max(64), kind: z.enum(["reference", "alternative", "near-miss"]), state: SubmissionStateSchema, expected: z.boolean() })).max(1000),
  heldOutTasks: z.array(TaskSchema).max(100),
});
export function validateCheckerData(raw: unknown, world: World): CheckerData {
  preflightJson(raw, false);
  const p = schema.safeParse(raw);
  if (!p.success) throw new CheckerError("checker_invalid", `invalid checker data: ${p.error.issues[0]?.message ?? "invalid"}`);
  const b = p.data;
  if (b.world.id !== world.id || b.world.version !== world.version) throw new CheckerError("checker_invalid", "checker bundle belongs to another world");
  const ids = new Set(world.tasks.map(t => t.id));
  for (const t of b.heldOutTasks) {
    if (ids.has(t.id)) throw new CheckerError("checker_invalid", "duplicate task identity");
    ids.add(t.id); validatePredicate(t.goal);
    for (const e of t.errorClasses) validatePredicate(e.when);
    if (t.initialState) validateSubmissionState(t.initialState, world.app.fontFamilies);
  }
  for (const f of b.fixtures) {
    if (!ids.has(f.taskId) || f.expected !== (f.kind !== "near-miss")) throw new CheckerError("checker_invalid", "fixture task or expectation mismatch");
    validateSubmissionState(f.state, world.app.fontFamilies);
  }
  for (const id of ids) {
    for (const kind of ["alternative", "near-miss"] as const) if (!b.fixtures.some(f => f.taskId === id && f.kind === kind)) throw new CheckerError("checker_invalid", `task ${id} lacks ${kind} fixture`);
  }
  return { ...b, heldOutTasks: b.heldOutTasks.map(t => { const { initialState, ...rest } = t; return { ...rest, ...(initialState === undefined ? {} : { initialState }) }; }) };
}
export function checkerDataFromBundle(bundle: CheckerBundle, world: World): CheckerData {
  if (bundle.manifest.world.id !== world.id || bundle.manifest.world.version !== world.version) throw new CheckerError("checker_invalid", "checker manifest identity mismatch");
  const file = bundle.files.get("checker.json");
  if (!file || file.mediaType !== "application/json") throw new CheckerError("checker_invalid", "missing checker.json");
  return validateCheckerData(parseJsonEntry(file.data, file.path, 64), world);
}
export async function loadCheckerBundle(path: string, world: World): Promise<CheckerData> {
  return checkerDataFromBundle(await readCheckerBundleFile(path), world);
}

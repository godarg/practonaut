import { z } from "zod";
import { stateHash } from "../canonical/index.ts";
import { parseJsonEntry } from "../package/json.ts";
import { preflightJson } from "../world/preflight.ts";
import type { SessionData, State, World } from "../world/types.ts";
import { invalid } from "./errors.ts";
import { isDisplayText } from '../world/display-text.ts';

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const objectId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const label = z.string().max(4096).refine(isDisplayText, "display strings must be NFC without invisible controls");
const integer = z.number().int().safe();
const base = { id: objectId, deleted: z.boolean() };
const object = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("frame"), name: label.max(256) }),
  z.strictObject({ ...base, type: z.literal("step"), frameId: objectId, label, x: integer, y: integer,
    width: integer.positive(), height: integer.positive(), fontFamily: z.number().int().min(1).max(100) }),
  z.strictObject({ ...base, type: z.literal("arrow"), frameId: objectId, from: objectId.nullable(), to: objectId.nullable() }),
]);
/** Independently validates submission data, including cross-object references. */
export const SubmissionStateSchema = z.strictObject({ objects: z.record(objectId, object).refine(v => Object.keys(v).length <= 10_000, "object limit") });
// world/2 objects, written independently of src/world/schema.ts.
const objectV2 = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("frame"), name: z.string().max(256).refine(isDisplayText, "display strings must be NFC without invisible controls") }),
  z.strictObject({ ...base, type: z.literal("step"), frameId: objectId.nullable(), label, x: integer, y: integer, width: integer.positive(), height: integer.positive(),
    shape: z.enum(["rectangle", "ellipse", "diamond"]), groupId: objectId.nullable(), stroke: z.enum(["black", "red", "green", "blue", "orange"]), fill: z.enum(["none", "red", "green", "blue", "yellow"]) }),
  z.strictObject({ ...base, type: z.literal("arrow"), frameId: objectId.nullable(), from: objectId.nullable(), to: objectId.nullable() }),
]);
export const SubmissionStateSchemaV2 = z.strictObject({ objects: z.record(objectId, objectV2).refine(v => Object.keys(v).length <= 10_000, "object limit") });
function validateV2(state: State): State {
  for (const [key, o] of Object.entries(state.objects)) {
    if (key !== o.id) invalid(`state id/key mismatch ${key}`);
    if (o.type === "frame" || o.deleted) continue;
    if (o.frameId !== null) { const f = state.objects[o.frameId]; if (!f || f.type !== "frame" || f.deleted) invalid(`missing live frame ${o.id}`); }
    if (o.type !== "arrow") continue;
    const ends = [o.from, o.to].filter((end): end is string => end !== null);
    for (const end of ends) { const target = state.objects[end]; if (!target || target.type !== "step" || target.deleted) invalid(`invalid arrow endpoint ${o.id}`); }
    if (ends.length) {
      const frames = ends.map(end => (state.objects[end] as { frameId: string | null }).frameId);
      if (o.frameId !== (frames.every(frame => frame === frames[0]) ? frames[0] : null)) invalid(`arrow frame differs from its ends ${o.id}`);
    }
  }
  return state;
}
export function validateSubmissionState(value: unknown, fontFamilies?: readonly number[], era: 1 | 2 = 1): State {
  try { preflightJson(value, false); } catch { invalid("state is not bounded plain integer JSON"); }
  if (era === 2) {
    const v2 = SubmissionStateSchemaV2.safeParse(value);
    if (!v2.success) invalid(`invalid state: ${v2.error.issues[0]?.message ?? "invalid"}`);
    return validateV2(v2.data as State);
  }
  const p = SubmissionStateSchema.safeParse(value);
  if (!p.success) invalid(`invalid state: ${p.error.issues[0]?.message ?? "invalid"}`);
  const state = p.data as State;
  for (const [key, o] of Object.entries(state.objects)) {
    if (key !== o.id) invalid(`state id/key mismatch ${key}`);
    if (o.type === "frame") continue;
    if (o.type === 'step' && fontFamilies && !fontFamilies.includes((o as { fontFamily: number }).fontFamily)) invalid(`state uses an undeclared font ${o.id}`);
    const f = o.frameId === null ? undefined : state.objects[o.frameId];
    if (!f || f.type !== "frame" || (!o.deleted && f.deleted)) invalid(`missing live frame ${o.id}`);
    if (o.type === "arrow" && !o.deleted) for (const end of [o.from, o.to]) {
      if (end === null) continue;
      const target = state.objects[end];
      if (!target || target.type !== "step" || target.deleted || target.frameId !== o.frameId) invalid(`invalid arrow endpoint ${o.id}`);
    }
  }
  return state;
}
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const scalar = z.union([z.string().max(4096), z.number().int().safe(), z.boolean(), z.null()]);
const SessionSchema = z.strictObject({
  schema: z.literal("practonaut.session/1"), world: z.strictObject({ id: z.string().max(64), version: z.string().max(64) }),
  seed: z.number().int().safe(), taskId: id, toolVersion: z.enum(["0.0.0", "0.1.0-dev.0", "0.1.0"]), // Explicit known Session writers; app version is world.app.versionRange.
  log: z.array(z.strictObject({ action: z.strictObject({ name: z.string().max(64), params: z.record(id, scalar), baseStep: z.number().int().min(0).max(10_000).optional() }), hash })).max(10_000),
  state: z.union([SubmissionStateSchema, SubmissionStateSchemaV2]), hash,
});
export function parseSession(input: string | Uint8Array, world: World): SessionData {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  if (bytes.length > 16 * 1024 * 1024) invalid("session exceeds 16 MiB");
  let raw: unknown;
  try { raw = parseJsonEntry(bytes, "session.json", 64); } catch { invalid("session is not bounded valid JSON"); }
  // Inspect the entire decoded envelope before Zod can transform record keys. In particular,
  // an unsafe key in the unauthenticated log must be rejected, never silently discarded.
  try { preflightJson(raw, false); } catch { invalid("session is not bounded plain integer JSON"); }
  const p = SessionSchema.safeParse(raw);
  if (!p.success) invalid(`invalid session: ${p.error.issues[0]?.message ?? "invalid"}`);
  const data = p.data;
  if (data.world.id !== world.id || data.world.version !== world.version) invalid("session belongs to another world");
  validateSubmissionState(data.state, world.app.fontFamilies, world.schema === "practonaut.world/2" ? 2 : 1);
  if (stateHash(data.state) !== data.hash) invalid("session state hash mismatch");
  if (data.log.length > 0 && data.log.at(-1)?.hash !== data.hash) invalid("session final log hash mismatch");
  return { ...data, log: data.log.map(e => { const { baseStep, ...action } = e.action; return { ...e, action: { ...action, ...(baseStep === undefined ? {} : { baseStep }) } }; }) };
}

/** Independent native export parser. This module never calls the adapter serializer. */
import { z } from "zod";
import { parseJsonEntry } from "../package/json.ts";
import type { State, WorldObject } from "../world/types.ts";
import { invalid } from "./errors.ts";

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;
const MAX_ELEMENTS = 5000;
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const nativeId = z.string().min(1).max(80);
const coord = z.number().int().min(-1_000_000).max(1_000_000);
const binding = z.object({ elementId: nativeId }).passthrough().nullable();
const elementSchema = z.object({
  id: nativeId, type: z.enum(["frame", "rectangle", "text", "arrow"]),
  isDeleted: z.boolean(), x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(),
  angle: z.literal(0), frameId: nativeId.nullable(),
  opacity: z.number().finite().min(0).max(100).optional(),
  startArrowhead: z.string().max(32).nullable().optional(), endArrowhead: z.string().max(32).nullable().optional(),
  link: z.null().optional(),
  customData: z.object({ practonautId: id.optional() }).passthrough().nullish(),
  name: z.string().max(256).optional(), text: z.string().max(4096).optional(), originalText: z.string().max(4096).optional(),
  fontFamily: z.literal(3).optional(), containerId: nativeId.nullable().optional(),
  boundElements: z.array(z.object({ id: nativeId, type: z.enum(["text", "arrow"]) }).strict()).max(MAX_ELEMENTS).nullable().optional(),
  startBinding: binding.optional(), endBinding: binding.optional(),
}).passthrough();
type Native = z.infer<typeof elementSchema>;
const fileSchema = z.object({ type: z.literal("excalidraw"), version: z.literal(2), elements: z.array(elementSchema).max(MAX_ELEMENTS),
  files: z.record(z.string(), z.unknown()).refine(v => Object.keys(v).length === 0, "binary files excluded").optional(),
}).passthrough();

export function parseExcalidraw(input: string | Uint8Array): State {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  if (bytes.length > MAX_ARTIFACT_BYTES) invalid("export exceeds 10 MiB");
  let raw: unknown;
  try { raw = parseJsonEntry(bytes, "export.excalidraw", 32); } catch { invalid("export is not bounded valid JSON"); }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) invalid(`unsupported native export: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  const native = new Map<string, Native>();
  for (const e of parsed.data.elements) {
    if (native.has(e.id)) invalid(`duplicate native id ${e.id}`);
    native.set(e.id, e);
  }
  const objects: Record<string, WorldObject> = Object.create(null) as Record<string, WorldObject>;
  const usedTexts = new Set<string>();
  // Native editor objects carry no Practonaut annotation. A bound text shares its container's
  // semantic identity; explicit annotations still have to agree with the native relationships.
  const semantic = (e: Native): string => {
    const value = e.customData?.practonautId ?? (e.type === 'text' ? e.containerId : e.id);
    const checked = id.safeParse(value); if (!checked.success) invalid(`invalid native semantic id ${e.id}`);
    return checked.data;
  };
  const frameRef = (e: Native): string => {
    if (e.frameId === null) invalid(`missing frame for ${e.id}`);
    const f = native.get(e.frameId);
    if (!f || f.type !== "frame" || (!e.isDeleted && f.isDeleted)) invalid(`invalid frame for ${e.id}`);
    return semantic(f);
  };
  const endpoint = (e: Native, b: Native["startBinding"]): string | null => {
    if (b === null) return null;
    if (b === undefined) invalid(`missing arrow binding ${e.id}`);
    const target = native.get(b.elementId);
    if (!target || target.type !== "rectangle" || target.isDeleted) invalid(`phantom binding ${e.id}`);
    if (target.frameId !== e.frameId) invalid(`cross-frame binding ${e.id}`);
    if (!target.boundElements?.some(r => r.id === e.id && r.type === "arrow")) invalid(`missing arrow back-reference ${e.id}`);
    return semantic(target);
  };
  for (const e of native.values()) {
    // The v1 semantic model has no transparency or arrowhead action. A native file may
    // not hide its result or reverse the visible direction while retaining its bindings.
    // Older supported fixtures omit the native defaults (100, null, "arrow").
    if (!e.isDeleted && (e.opacity ?? 100) !== 100) invalid(`unsupported native opacity ${e.id}`);
    if (!e.isDeleted && e.type === 'arrow' && ((e.startArrowhead ?? null) !== null || (e.endArrowhead === undefined ? 'arrow' : e.endArrowhead) !== 'arrow')) invalid(`unsupported native arrow direction ${e.id}`);
    if (e.type === "text") continue;
    const sid = semantic(e);
    if (objects[sid]) invalid(`duplicate semantic id ${sid}`);
    if (e.id !== sid) invalid(`native semantic id mismatch ${e.id}`);
    if (e.type === "frame") {
      if (e.frameId !== null || e.name === undefined) invalid(`invalid frame ${e.id}`);
      objects[sid] = { id: sid, type: "frame", name: e.name, deleted: e.isDeleted };
    } else if (e.type === "rectangle") {
      const texts = e.isDeleted ? [...native.values()].filter(t => t.type === "text" && t.containerId === e.id).map(t => ({ id: t.id, type: "text" as const })) : (e.boundElements ?? []).filter(r => r.type === "text");
      if (texts.length !== 1) invalid(`step ${e.id} needs one bound text`);
      const t = native.get(texts[0]!.id);
      if (!t || t.type !== "text" || t.containerId !== e.id || t.isDeleted !== e.isDeleted || t.frameId !== e.frameId || semantic(t) !== sid || t.fontFamily !== 3 || t.originalText === undefined) invalid(`invalid bound text for ${e.id}`);
      if (t.text === undefined || t.text.replace(/\s/g, "") !== t.originalText.replace(/\s/g, "")) invalid(`rendered and original text disagree ${e.id}`);
      if (usedTexts.has(t.id)) invalid("text bound more than once");
      usedTexts.add(t.id);
      const dimensions = z.object({ x: coord, y: coord, width: coord.positive(), height: coord.positive() }).safeParse(e);
      if (!dimensions.success) invalid(`step geometry must be positive integer units ${e.id}`);
      objects[sid] = { id: sid, type: "step", deleted: e.isDeleted, frameId: frameRef(e), label: t.originalText,
        ...dimensions.data, fontFamily: 3 };
    } else {
      // Native deletion leaves historical endpoint/back-reference caches. They are not
      // live relations and can point at subsequently deleted steps. Normalize the
      // tombstone to the model's disconnected form without consulting those caches.
      objects[sid] = { id: sid, type: "arrow", deleted: e.isDeleted, frameId: frameRef(e), from: e.isDeleted ? null : endpoint(e, e.startBinding), to: e.isDeleted ? null : endpoint(e, e.endBinding) };
    }
  }
  for (const e of native.values()) {
    if (e.type === "text" && !usedTexts.has(e.id)) invalid(`unbound text ${e.id}`);
    const refs = e.boundElements ?? [];
    if (new Set(refs.map(r => r.id)).size !== refs.length) invalid(`duplicate back-reference ${e.id}`);
    if (e.isDeleted) continue; // Tombstone caches describe old bindings; only live relationships affect the artifact.
    for (const r of refs) {
      const t = native.get(r.id);
      if (!t || t.type !== r.type || (!e.isDeleted && t.isDeleted)) invalid(`stale back-reference ${e.id}`);
      if (t.type === "arrow" && t.startBinding?.elementId !== e.id && t.endBinding?.elementId !== e.id) invalid(`false arrow back-reference ${e.id}`);
    }
  }
  return { objects };
}

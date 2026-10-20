/** Tolerant world/2 scene parser: any Excalidraw drawing becomes a semantic state plus a list
 * of what it does not model. Independent of the adapter serializer and of the core. */
import { createHash } from "node:crypto";
import { parseJsonEntry } from "../package/json.ts";
import type { Arrow, FillColor, Frame, Shape, State, StepV2, StrokeColor } from "../world/types.ts";
import { invalid } from "./errors.ts";
import { validateSubmissionState } from "./state.ts";

const MAX_SCENE_BYTES = 10 * 1024 * 1024;
const MAX_ELEMENTS = 5000;
const MAX_COORDINATE = 1_000_000;
export interface Unmodeled { id: string; type: string; reason: "free_text" | "arrow_label" | "unsupported_type" }
/** What a reading rule of a layout unit refuses and other readings keep (PADR-0047 decision 10):
 * steps whose box collapsed to no width or height when its edges were rounded (judged widened to
 * 1 px), and steps drawn at an angle other than 0 (judged unrotated). Semantic step ids. */
export interface SceneGeometry { collapsed: string[]; rotated: string[] }
export interface SceneReport { state: State; unmodeled: Unmodeled[]; geometry: SceneGeometry }

/** One axis of a box rounded by its edges (PADR-0047 decision 10): a negative size keeps the box where
 * it is drawn, and an edge two boxes share rounds to one integer. `collapsed` when both edges round
 * to the same integer; the judged box is then widened to 1 px towards positive coordinates. */
export function roundedSpan(start: number, size: number): { start: number; size: number; collapsed: boolean } {
  // `+ 0` turns Math.round's −0 into 0.
  const low = Math.round(Math.min(start, start + size)) + 0, high = Math.round(Math.max(start, start + size)) + 0;
  return { start: low, size: Math.max(1, high - low), collapsed: high === low };
}

// Excalidraw 0.18.1 picker colours. Any other colour maps to the nearest named one.
const STROKES: ReadonlyArray<[StrokeColor, string]> = [["black", "#1e1e1e"], ["red", "#e03131"], ["green", "#2f9e44"], ["blue", "#1971c2"], ["orange", "#f08c00"]];
const FILLS: ReadonlyArray<[Exclude<FillColor, "none">, string]> = [["red", "#ffc9c9"], ["green", "#b2f2bb"], ["blue", "#a5d8ff"], ["yellow", "#ffec99"]];
function rgb(value: unknown): [number, number, number] | undefined {
  if (typeof value !== "string") return undefined;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())?.[1];
  if (!hex) return undefined;
  const full = hex.length === 3 ? [...hex].map(c => c + c).join("") : hex.slice(0, 6);
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
function nearest<T extends string>(table: ReadonlyArray<[T, string]>, value: unknown, fallback: T): T {
  const target = rgb(value);
  if (!target) return fallback;
  let best = fallback, distance = Infinity;
  for (const [name, hex] of table) {
    const [r, g, b] = rgb(hex)!;
    const d = (r - target[0]) ** 2 + (g - target[1]) ** 2 + (b - target[2]) ** 2;
    if (d < distance) { distance = d; best = name; }
  }
  return best;
}
export const strokeName = (value: unknown): StrokeColor => nearest(STROKES, value, "black");
export const fillName = (value: unknown): FillColor => {
  if (value === undefined || value === null || (typeof value === "string" && (value === "transparent" || /^#[0-9a-f]{6}00$/i.test(value)))) return "none";
  return nearest(FILLS, value, "red");
};

const SEMANTIC = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
/** Excalidraw ids are usually valid semantic ids; anything else gets a stable derived one. */
function semanticId(raw: string, prefix: string): string {
  return SEMANTIC.test(raw) && !RESERVED.has(raw) ? raw : `${prefix}-${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}
interface Element {
  id: string; type: string; isDeleted: boolean; x: number; y: number; width: number; height: number;
  frameId: string | null; containerId: string | null; groupIds: string[];
  text?: string; originalText?: string; name?: string | null; strokeColor?: unknown; backgroundColor?: unknown;
  startBinding?: string | null; endBinding?: string | null; startArrowhead?: unknown; endArrowhead?: unknown; practonautId?: string;
  /** Drawn at an angle other than 0 (any other value than an absent, null or zero angle). */
  rotated: boolean;
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function element(value: unknown, index: number): Element {
  const e = record(value);
  if (!e) invalid(`scene element ${index} is not an object`);
  const id = e.id, type = e.type;
  if (typeof id !== "string" || id.length < 1 || id.length > 200) invalid(`scene element ${index} has no usable id`);
  if (typeof type !== "string" || type.length > 64) invalid(`scene element ${id} has no usable type`);
  const number = (key: string, fallback = 0): number => {
    const v = e[key] ?? fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > MAX_COORDINATE) invalid(`scene element ${id} has an invalid ${key}`);
    return v;
  };
  const ref = (key: string): string | null => { const v = e[key]; return typeof v === "string" && v.length <= 200 ? v : null; };
  const binding = (key: string): string | null => { const b = record(e[key]); return b && typeof b.elementId === "string" && b.elementId.length <= 200 ? b.elementId : null; };
  const text = (key: string): string | undefined => {
    const v = e[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string" || [...v].length > 4096) invalid(`scene element ${id} has an invalid ${key}`);
    return v;
  };
  const custom = record(e.customData)?.practonautId;
  return {
    id, type, isDeleted: e.isDeleted === true, x: number("x"), y: number("y"), width: number("width"), height: number("height"),
    frameId: ref("frameId"), containerId: ref("containerId"),
    groupIds: Array.isArray(e.groupIds) ? e.groupIds.filter((g): g is string => typeof g === "string" && g.length > 0 && g.length <= 200).slice(0, 32) : [],
    ...(text("text") === undefined ? {} : { text: text("text")! }), ...(text("originalText") === undefined ? {} : { originalText: text("originalText")! }),
    ...(e.name === null || typeof e.name === "string" ? { name: typeof e.name === "string" ? e.name.slice(0, 256) : null } : {}),
    strokeColor: e.strokeColor, backgroundColor: e.backgroundColor, rotated: e.angle !== undefined && e.angle !== null && e.angle !== 0,
    startBinding: binding("startBinding"), endBinding: binding("endBinding"), startArrowhead: e.startArrowhead, endArrowhead: e.endArrowhead,
    ...(typeof custom === "string" ? { practonautId: custom } : {}),
  };
}
const STEP_TYPES = new Set(["rectangle", "ellipse", "diamond"]);
const FRAME_TYPES = new Set(["frame", "magicframe"]);
/** Labels are compared after NFC; invisible format characters stay a rejection, never a silent strip. */
function label(value: string): string {
  const normalized = value.normalize("NFC");
  if (/\p{Cf}/u.test(normalized)) invalid("scene text contains invisible format characters");
  return normalized;
}
/** Parse a native Excalidraw drawing (file or clipboard export). Angles, fonts, opacity and
 * stroke styles are presentation and ignored; unknown element kinds are listed, never fatal. A step's
 * box is rounded by its edges (`roundedSpan`); rotated and collapsed steps are listed in `geometry`
 * for the reading rules of a layout unit (PADR-0047 decision 10), which refuse them. */
export function parseScene(input: string | Uint8Array): SceneReport {
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  if (bytes.length > MAX_SCENE_BYTES) invalid("scene exceeds 10 MiB");
  let raw: unknown;
  try { raw = parseJsonEntry(bytes, "scene.excalidraw", 32); } catch { invalid("scene is not bounded valid JSON"); }
  const file = record(raw);
  if (!file || file.type !== "excalidraw" || !Array.isArray(file.elements)) invalid("not an Excalidraw scene");
  if (file.elements.length > MAX_ELEMENTS) invalid("scene has too many elements");
  const all = file.elements.map(element);
  const seen = new Set<string>();
  for (const e of all) { if (seen.has(e.id)) invalid(`duplicate native id ${e.id}`); seen.add(e.id); }
  const live = all.filter(e => !e.isDeleted);
  const byId = new Map(live.map(e => [e.id, e]));
  const ids = new Map<string, string>(), used = new Set<string>();
  const assign = (e: Element, prefix: string): string => {
    const id = semanticId(e.practonautId && SEMANTIC.test(e.practonautId) && !RESERVED.has(e.practonautId) ? e.practonautId : e.id, prefix);
    if (used.has(id)) invalid(`duplicate semantic id ${id}`);
    used.add(id); ids.set(e.id, id); return id;
  };
  const objects: Record<string, Frame | StepV2 | Arrow> = Object.create(null) as Record<string, Frame | StepV2 | Arrow>;
  const unmodeled: Unmodeled[] = [];
  for (const e of live) if (FRAME_TYPES.has(e.type)) { const id = assign(e, "f"); objects[id] = { id, type: "frame", deleted: false, name: label(e.name ?? "") }; }
  const frameOf = (e: Element): string | null => {
    const target = e.frameId === null ? undefined : byId.get(e.frameId);
    return target && FRAME_TYPES.has(target.type) ? ids.get(target.id)! : null;
  };
  const consumed = new Set<string>();
  const geometry: SceneGeometry = { collapsed: [], rotated: [] };
  for (const e of live) {
    if (!STEP_TYPES.has(e.type)) continue;
    const id = assign(e, "s");
    const text = live.find(t => t.type === "text" && t.containerId === e.id);
    if (text) consumed.add(text.id);
    const groups = e.groupIds.map(group => semanticId(group, "g"));
    // The box by its rounded edges, for every world/2 reading (PADR-0047 decision 10).
    const horizontal = roundedSpan(e.x, e.width), vertical = roundedSpan(e.y, e.height);
    if (horizontal.collapsed || vertical.collapsed) geometry.collapsed.push(id);
    if (e.rotated) geometry.rotated.push(id);
    objects[id] = {
      id, type: "step", deleted: false, frameId: frameOf(e), label: label(text ? text.originalText ?? text.text ?? "" : ""),
      x: horizontal.start, y: vertical.start, width: horizontal.size, height: vertical.size,
      shape: e.type as Shape, groupId: groups.at(-1) ?? null, stroke: strokeName(e.strokeColor), fill: fillName(e.backgroundColor),
    };
  }
  const stepId = (native: string | null | undefined): string | null => {
    const target = native ? byId.get(native) : undefined;
    return target && STEP_TYPES.has(target.type) ? ids.get(target.id)! : null;
  };
  for (const e of live) {
    if (e.type !== "arrow") continue;
    const id = assign(e, "a");
    let from = stepId(e.startBinding), to = stepId(e.endBinding);
    // Direction is what a reader sees: a single head at the start reverses the bound ends.
    const startHead = e.startArrowhead !== undefined && e.startArrowhead !== null, endHead = e.endArrowhead === undefined || e.endArrowhead !== null;
    if (startHead && !endHead) [from, to] = [to, from];
    objects[id] = { id, type: "arrow", deleted: false, frameId: frameOf(e), from, to };
  }
  for (const object of Object.values(objects)) {
    if (object.type !== "arrow" || (object.from === null && object.to === null)) continue;
    const frames = [object.from, object.to].filter((end): end is string => end !== null).map(end => (objects[end] as StepV2).frameId);
    object.frameId = frames.every(frame => frame === frames[0]) ? frames[0]! : null;
  }
  for (const e of live) {
    if (FRAME_TYPES.has(e.type) || STEP_TYPES.has(e.type) || e.type === "arrow" || consumed.has(e.id)) continue;
    if (e.type === "text") unmodeled.push({ id: e.id, type: e.type, reason: e.containerId && byId.get(e.containerId)?.type === "arrow" ? "arrow_label" : "free_text" });
    else unmodeled.push({ id: e.id, type: e.type, reason: "unsupported_type" });
  }
  return { state: validateSubmissionState({ objects }, undefined, 2), unmodeled, geometry };
}

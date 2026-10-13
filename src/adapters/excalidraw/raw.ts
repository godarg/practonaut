import type { FillColor, Shape, State, Step, StepV1, StepV2, StrokeColor } from '../../world/types.ts';
import { isStepV2 } from '../../world/types.ts';
import { inferEra } from '../../world/schema.ts';
/** world/2 palette: Excalidraw 0.18.1 picker colours (first row of the stroke and background pickers). */
export const STROKE_HEX: Readonly<Record<StrokeColor, string>> = Object.freeze({ black: '#1e1e1e', red: '#e03131', green: '#2f9e44', blue: '#1971c2', orange: '#f08c00' });
export const FILL_HEX: Readonly<Record<FillColor, string>> = Object.freeze({ none: 'transparent', red: '#ffc9c9', green: '#b2f2bb', blue: '#a5d8ff', yellow: '#ffec99' });
const MODEL_2 = 2;
const reverse = <K extends string>(table: Readonly<Record<K, string>>, value: unknown): K | undefined => (Object.keys(table) as K[]).find(key => table[key] === value);
export interface Binding { elementId: string; focus: number; gap: number }
export interface RawElement {
  id: string; type: string; isDeleted: boolean; x: number; y: number; width: number; height: number;
  frameId: string | null; boundElements: Array<{ id: string; type: string }>;
  containerId?: string | null; originalText?: string; text?: string; fontFamily?: number; name?: string;
  startBinding?: Binding | null; endBinding?: Binding | null; points?: number[][];
  [key: string]: unknown;
}
function base(id: string, type: string, x: number, y: number, width: number, height: number, frameId: string | null, deleted: boolean): RawElement {
  return { id, type, x, y, width, height, frameId, isDeleted: deleted, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 0, opacity: 100, groupIds: [], roundness: null, seed: 1, version: 1, versionNonce: 1, boundElements: [], updated: 1, link: null, locked: false, customData: { practonautId: id } };
}
const endpoint = (step: Step, target: Step | undefined): [number, number] => {
  let dx = target ? target.x + target.width / 2 - (step.x + step.width / 2) : step.width;
  const dy = target ? target.y + target.height / 2 - (step.y + step.height / 2) : 0;
  if (dx === 0 && dy === 0) dx = step.width;
  const scale = Math.min(dx ? (step.width / 2 + 4) / Math.abs(dx) : Infinity, dy ? (step.height / 2 + 4) / Math.abs(dy) : Infinity);
  return [step.x + step.width / 2 + dx * scale, step.y + step.height / 2 + dy * scale];
};
export function toRaw(state: State, previous: RawElement[] = []): RawElement[] {
  const result: RawElement[] = [];
  const v2 = inferEra(state) === 2;
  let emptyFrames = 0;
  for (const object of Object.values(state.objects).sort((a, b) => a.id.localeCompare(b.id))) {
    if (object.type === 'frame' && v2) {
      // world/2 frames have no semantic geometry: the envelope hugs their live members.
      const steps = Object.values(state.objects).filter((e): e is Step => e.type === 'step' && e.frameId === object.id && !e.deleted);
      const box = steps.length ? { x: Math.min(...steps.map(e => e.x)) - 40, y: Math.min(...steps.map(e => e.y)) - 60, right: Math.max(...steps.map(e => e.x + e.width)) + 40, bottom: Math.max(...steps.map(e => e.y + e.height)) + 40 }
        : { x: 40 + 460 * emptyFrames, y: -420, right: 440 + 460 * emptyFrames, bottom: -120 };
      if (!steps.length) emptyFrames++;
      result.push({ ...base(object.id, 'frame', box.x, box.y, box.right - box.x, box.bottom - box.y, null, object.deleted), name: object.name, customData: { practonautId: object.id, practonautModel: MODEL_2 } });
    } else if (object.type === 'step' && isStepV2(object)) {
      const step: StepV2 = object;
      const groupIds = step.groupId === null ? [] : [step.groupId];
      const box = { ...base(step.id, step.shape, step.x, step.y, step.width, step.height, step.frameId, step.deleted), strokeColor: STROKE_HEX[step.stroke], backgroundColor: FILL_HEX[step.fill], groupIds, customData: { practonautId: step.id, practonautModel: MODEL_2 } };
      if (step.label === '') { result.push(box); continue; }
      box.boundElements.push({ id: `${step.id}:text`, type: 'text' });
      result.push(box, { ...base(`${step.id}:text`, 'text', step.x + 5, step.y + 5, step.width - 10, 25, step.frameId, step.deleted), containerId: step.id, originalText: step.label, text: step.label, fontSize: 20, fontFamily: 3, textAlign: 'center', verticalAlign: 'middle', lineHeight: 1.2, autoResize: true, groupIds, customData: { practonautId: step.id, practonautModel: MODEL_2 } });
    } else if (object.type === 'frame') {
      const steps = Object.values(state.objects).filter((e): e is Step => e.type === 'step' && e.frameId === object.id && !e.deleted);
      const x = Math.min(240, ...steps.map(e => e.x - 40)), y = Math.min(100, ...steps.map(e => e.y - 40));
      result.push({ ...base(object.id, 'frame', x, y, Math.max(1100, ...steps.map(e => e.x + e.width + 40 - x)), Math.max(600, ...steps.map(e => e.y + e.height + 40 - y)), null, object.deleted), name: object.name });
    } else if (object.type === 'step') {
      const box = base(object.id, 'rectangle', object.x, object.y, object.width, object.height, object.frameId, object.deleted);
      box.boundElements.push({ id: `${object.id}:text`, type: 'text' });
      result.push(box, { ...base(`${object.id}:text`, 'text', object.x + 5, object.y + 5, object.width - 10, 25, object.frameId, object.deleted), containerId: object.id, originalText: object.label, text: object.label, fontSize: 20, fontFamily: (object as StepV1).fontFamily, textAlign: 'center', verticalAlign: 'middle', lineHeight: 1.2, autoResize: true, customData: { practonautId: object.id } });
    } else {
      const from = object.from ? state.objects[object.from] : undefined, to = object.to ? state.objects[object.to] : undefined;
      const old = previous.find(e => e.id === object.id);
      const p0 = from?.type === 'step' ? endpoint(from, to?.type === 'step' ? to : undefined) : [old?.x ?? 300, old?.y ?? 300];
      const p1 = to?.type === 'step' ? endpoint(to, from?.type === 'step' ? from : undefined) : [old ? old.x + (old.points?.at(-1)?.[0] ?? old.width) : 550, old ? old.y + (old.points?.at(-1)?.[1] ?? old.height) : 300];
      const x = p0[0]!, y = p0[1]!, dx = p1[0]! - x, dy = p1[1]! - y;
      result.push({ ...base(object.id, 'arrow', x, y, Math.abs(dx), Math.abs(dy), object.frameId, object.deleted), points: [[0, 0], [dx, dy]], lastCommittedPoint: null, startBinding: object.from ? { elementId: object.from, focus: 0, gap: 4 } : null, endBinding: object.to ? { elementId: object.to, focus: 0, gap: 4 } : null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false, ...(v2 ? { customData: { practonautId: object.id, practonautModel: MODEL_2 } } : {}) });
    }
  }
  for (const e of result.filter(e => !e.isDeleted && e.type === 'arrow')) for (const binding of [e.startBinding, e.endBinding]) {
    const target = result.find(t => t.id === binding?.elementId);
    if (target && !target.boundElements.some(ref => ref.id === e.id)) target.boundElements.push({ id: e.id, type: 'arrow' });
  }
  return result;
}
const modelTwo = (e: RawElement): boolean => (e.customData as { practonautModel?: unknown } | undefined)?.practonautModel === MODEL_2;
export function project(raw: RawElement[]): State {
  const state: State = { objects: {} };
  for (const e of raw) {
    if (e.type === 'frame') state.objects[e.id] = { id: e.id, type: 'frame', deleted: e.isDeleted, name: e.name ?? '' };
    else if (['rectangle', 'ellipse', 'diamond'].includes(e.type) && modelTwo(e)) {
      const text = raw.find(t => t.type === 'text' && t.containerId === e.id);
      const stroke = reverse(STROKE_HEX, e.strokeColor), fill = reverse(FILL_HEX, e.backgroundColor);
      if (!stroke || !fill) throw new Error(`Unmodeled colour on ${e.id}`);
      const groups = Array.isArray(e.groupIds) ? e.groupIds as string[] : [];
      state.objects[e.id] = { id: e.id, type: 'step', deleted: e.isDeleted, frameId: e.frameId ?? null, label: text ? text.originalText ?? text.text ?? '' : '', x: Math.round(e.x), y: Math.round(e.y), width: Math.round(e.width), height: Math.round(e.height), shape: e.type as Shape, groupId: groups.at(-1) ?? null, stroke, fill };
    } else if (e.type === 'arrow' && modelTwo(e)) {
      state.objects[e.id] = { id: e.id, type: 'arrow', deleted: e.isDeleted, frameId: e.frameId ?? null, from: e.startBinding?.elementId ?? null, to: e.endBinding?.elementId ?? null };
    }
    else if (e.type === 'rectangle') {
      const text = raw.find(t => t.type === 'text' && t.containerId === e.id);
      if (!text || !e.frameId) throw new Error('Step requires bound text and frame');
      state.objects[e.id] = { id: e.id, type: 'step', deleted: e.isDeleted, frameId: e.frameId, label: text.originalText ?? text.text ?? '', x: Math.round(e.x), y: Math.round(e.y), width: Math.round(e.width), height: Math.round(e.height), fontFamily: text.fontFamily ?? 3 };
    } else if (e.type === 'arrow') {
      if (!e.frameId) throw new Error('Arrow requires frame');
      state.objects[e.id] = { id: e.id, type: 'arrow', deleted: e.isDeleted, frameId: e.frameId, from: e.startBinding?.elementId ?? null, to: e.endBinding?.elementId ?? null };
    } else if (e.type !== 'text') throw new Error(`Unmodeled native element ${e.type}`);
  }
  return state;
}
export function integrity(raw: RawElement[], ownWrite: boolean): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [], live = new Map(raw.filter(e => !e.isDeleted).map(e => [e.id, e]));
  for (const e of live.values()) {
    for (const id of [e.frameId, e.containerId, e.startBinding?.elementId, e.endBinding?.elementId]) if (id && !live.has(id)) errors.push(`${e.id} has missing target ${id}`);
    for (const ref of e.boundElements ?? []) {
      const target = live.get(ref.id);
      if (!target || (ref.type === 'arrow' && target.startBinding?.elementId !== e.id && target.endBinding?.elementId !== e.id) || (ref.type === 'text' && target.containerId !== e.id)) (ownWrite ? errors : warnings).push(`${e.id} has stale back-reference ${ref.id}`);
    }
    for (const b of [e.startBinding, e.endBinding]) if (b && live.has(b.elementId) && !live.get(b.elementId)!.boundElements.some(ref => ref.type === 'arrow' && ref.id === e.id)) (ownWrite ? errors : warnings).push(`${b.elementId} lacks back-reference ${e.id}`);
  }
  return { errors, warnings };
}

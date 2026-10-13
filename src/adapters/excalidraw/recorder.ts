import { z } from 'zod';
import type { RawElement } from './raw.ts';
import { project } from './raw.ts';
import { validateState } from '../../world/schema.ts';
import { COALESCING_VERSION, COALESCING_QUIET_MS } from './recorder-types.ts';
import type { GestureRecorder, RecorderOptions, GestureBoundary, SemanticSnapshot, SemanticElement, SemanticEvent, RecordedGesture, Recording, SnapshotProjection, UnmodeledChange } from './recorder-types.ts';

/** Admission ceilings also bound authoring and authenticated host responses. */
export const RECORDING_LIMITS = Object.freeze({ maxBytes: 3 * 1024 * 1024, maxGestures: 1000, maxElements: 1000, maxDurationMs: 30 * 60 * 1000, maxFiles: 100, maxStoreBytes: 64 * 1024 * 1024 });
const id = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_:\-.]+$/).refine(s => !['__proto__', 'prototype', 'constructor'].includes(s));
const scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
const elementSchema = z.strictObject({ id, type: z.string().min(1).max(64), attributes: z.record(z.string().min(1).max(64), scalar) });
const snapshotSchema = z.strictObject({ elements: z.record(id, elementSchema) });
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('create'), element: elementSchema }),
  z.strictObject({ kind: z.literal('remove'), id, before: elementSchema }),
  z.strictObject({ kind: z.literal('set'), id, field: z.string().min(1).max(64), before: scalar, after: scalar }),
]);
const gestureSchema = z.strictObject({ index: z.number().int().nonnegative(), boundary: z.enum(['pointerup', 'key', 'quiet', 'stop']), before: snapshotSchema, after: snapshotSchema, events: z.array(eventSchema).max(10000), unmodeled: z.array(z.strictObject({ id, attributes: z.array(z.string().max(64)).max(100), reason: z.string().min(1).max(256) })).max(1000), quarantined: z.boolean(), quarantineReasons: z.array(z.string().min(1).max(256)).max(1000) });
const recordingSchema = z.strictObject({
  manifest: z.strictObject({ schema: z.literal('practonaut.recording/1'), id, createdAt: z.iso.datetime(), stoppedAt: z.iso.datetime(), appVersion: z.literal('0.18.1'), adapterVersion: z.string().min(1).max(64), coalescingVersion: z.literal(COALESCING_VERSION), author: z.string().trim().min(1).max(256), license: z.string().trim().min(1).max(128), consent: z.string().trim().min(1).max(1024), demonstration: z.enum(['scripted', 'human']), status: z.enum(['review', 'quarantined']) }),
  initial: snapshotSchema, gestures: z.array(gestureSchema).max(RECORDING_LIMITS.maxGestures),
});
/** Browser-local canonical ordering; no hash or server dependency enters the input device. */
function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable((value as Record<string, unknown>)[k])).join(',') + '}';
}
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
const bookKeeping = new Set(['seed', 'versionNonce', 'version', 'updated', 'index']);
const geometry = new Set(['x', 'y', 'width', 'height', 'points', 'text', 'boundElements', 'startBinding', 'endBinding', 'lastCommittedPoint']);
const modeled = (type: string): string[] => ['isDeleted', 'frameId', ...(type === 'frame' ? ['name'] : type === 'rectangle' ? ['x', 'y', 'width', 'height'] : type === 'text' ? ['containerId', 'originalText', 'fontFamily'] : type === 'arrow' ? ['start', 'end'] : [])];

export function snapshotElements(raw: RawElement[]): SemanticSnapshot {
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > RECORDING_LIMITS.maxBytes) throw new Error('recording_limit: native snapshot exceeds byte limit');
  if (raw.length > RECORDING_LIMITS.maxElements) throw new Error('recording_limit: too many native elements');
  const snapshot: SemanticSnapshot = { elements: Object.create(null) as Record<string, SemanticElement> };
  for (const e of raw) {
    if (!id.safeParse(e.id).success || Object.hasOwn(snapshot.elements, e.id)) throw new Error('recording_invalid: duplicate or invalid native ID');
    const attributes: SemanticElement['attributes'] = { isDeleted: e.isDeleted, frameId: e.frameId ?? null };
    if (e.type === 'frame') attributes.name = e.name ?? '';
    if (e.type === 'rectangle') for (const k of ['x', 'y', 'width', 'height'] as const) attributes[k] = Math.round(e[k]);
    if (e.type === 'text') { attributes.containerId = e.containerId ?? null; attributes.originalText = e.originalText ?? e.text ?? ''; attributes.fontFamily = e.fontFamily ?? 3; }
    if (e.type === 'arrow') { attributes.start = e.startBinding?.elementId ?? null; attributes.end = e.endBinding?.elementId ?? null; }
    snapshot.elements[e.id] = elementSchema.parse({ id: e.id, type: e.type, attributes });
  }
  return snapshot;
}
function validateSnapshot(snapshot: SemanticSnapshot): void {
  if (Object.keys(snapshot.elements).length > RECORDING_LIMITS.maxElements) throw new Error('recording_limit: too many semantic elements');
  for (const [key, e] of Object.entries(snapshot.elements)) {
    if (key !== e.id) throw new Error('recording_invalid: element key differs from ID');
    const fields = modeled(e.type).sort();
    if (!same(Object.keys(e.attributes).sort(), fields)) throw new Error('recording_invalid: undeclared semantic attribute');
    if (typeof e.attributes.isDeleted !== 'boolean' || !(e.attributes.frameId === null || typeof e.attributes.frameId === 'string')) throw new Error('recording_invalid: invalid element base');
    if (e.type === 'rectangle' && !['x', 'y', 'width', 'height'].every(k => Number.isSafeInteger(e.attributes[k]))) throw new Error('recording_invalid: rectangle geometry must be integers');
    if (e.type === 'frame' && typeof e.attributes.name !== 'string') throw new Error('recording_invalid: invalid frame name');
    if (e.type === 'text' && (typeof e.attributes.originalText !== 'string' || !Number.isSafeInteger(e.attributes.fontFamily) || !(e.attributes.containerId === null || typeof e.attributes.containerId === 'string'))) throw new Error('recording_invalid: invalid text');
    if (e.type === 'arrow' && !['start', 'end'].every(k => e.attributes[k] === null || typeof e.attributes[k] === 'string')) throw new Error('recording_invalid: invalid binding');
  }
}
function diff(before: SemanticSnapshot, after: SemanticSnapshot): SemanticEvent[] {
  const events: SemanticEvent[] = [];
  for (const key of [...new Set([...Object.keys(before.elements), ...Object.keys(after.elements)])].sort()) {
    const a = before.elements[key], b = after.elements[key];
    if (!a && b) events.push({ kind: 'create', element: structuredClone(b) });
    else if (a && !b) events.push({ kind: 'remove', id: key, before: structuredClone(a) });
    else if (a && b) {
      if (a.type !== b.type) { events.push({ kind: 'remove', id: key, before: structuredClone(a) }, { kind: 'create', element: structuredClone(b) }); continue; }
      for (const field of Object.keys(b.attributes).sort()) if (!same(a.attributes[field], b.attributes[field])) events.push({ kind: 'set', id: key, field, before: a.attributes[field]!, after: b.attributes[field]! });
    }
  }
  return events;
}
export function replayGesture(gesture: RecordedGesture): SemanticSnapshot {
  const parsed = gestureSchema.parse(gesture);
  validateSnapshot(parsed.before); validateSnapshot(parsed.after);
  const replay = structuredClone(parsed.before);
  for (const event of parsed.events) {
    if (event.kind === 'create') {
      if (Object.hasOwn(replay.elements, event.element.id)) throw new Error('replay_mismatch: create already exists');
      replay.elements[event.element.id] = structuredClone(event.element);
    } else if (event.kind === 'remove') {
      if (!same(replay.elements[event.id], event.before)) throw new Error('replay_mismatch: removal predecessor');
      delete replay.elements[event.id];
    } else {
      const element = replay.elements[event.id];
      if (!element || !Object.hasOwn(element.attributes, event.field) || !same(element.attributes[event.field], event.before)) throw new Error('replay_mismatch: set predecessor');
      element.attributes[event.field] = event.after;
    }
  }
  if (!same(replay, parsed.after) || !same(parsed.events, diff(parsed.before, parsed.after))) throw new Error('replay_mismatch: events do not strictly reproduce snapshot');
  return replay;
}
export function validateRecording(raw: unknown): Recording {
  const text = JSON.stringify(raw);
  if (new TextEncoder().encode(text).byteLength > RECORDING_LIMITS.maxBytes) throw new Error('recording_limit: recording exceeds byte limit');
  const recording: Recording = recordingSchema.parse(raw);
  validateSnapshot(recording.initial);
  const duration = Date.parse(recording.manifest.stoppedAt) - Date.parse(recording.manifest.createdAt);
  if (duration < 0 || duration > RECORDING_LIMITS.maxDurationMs) throw new Error('recording_limit: invalid duration');
  let before = recording.initial;
  for (const [index, gesture] of recording.gestures.entries()) {
    if (index !== gesture.index || !same(before, gesture.before)) throw new Error('replay_mismatch: broken gesture chain');
    replayGesture(gesture); before = gesture.after;
    if (gesture.quarantined !== (gesture.quarantineReasons.length > 0)) throw new Error('recording_invalid: inconsistent quarantine');
  }
  if (recording.manifest.status !== (recording.gestures.some(g => g.quarantined) ? 'quarantined' : 'review')) throw new Error('recording_invalid: inconsistent manifest quarantine');
  return recording;
}

export function projectSnapshot(snapshot: SemanticSnapshot): SnapshotProjection {
  try {
    validateSnapshot(snapshot);
    const raw: RawElement[] = Object.values(snapshot.elements).map(e => ({ id: e.id, type: e.type, isDeleted: e.attributes.isDeleted as boolean, frameId: e.attributes.frameId as string | null, x: Number(e.attributes.x ?? 0), y: Number(e.attributes.y ?? 0), width: Number(e.attributes.width ?? 0), height: Number(e.attributes.height ?? 0), boundElements: [], ...(e.type === 'frame' ? { name: e.attributes.name as string } : {}), ...(e.type === 'text' ? { containerId: e.attributes.containerId as string | null, originalText: e.attributes.originalText as string, fontFamily: e.attributes.fontFamily as number } : {}), ...(e.type === 'arrow' ? { startBinding: e.attributes.start ? { elementId: String(e.attributes.start), gap: 0, focus: 0 } : null, endBinding: e.attributes.end ? { elementId: String(e.attributes.end), gap: 0, focus: 0 } : null } : {}) }));
    if (raw.some(e => e.type === 'text' && !e.isDeleted && (!e.containerId || !raw.some(t => t.id === e.containerId && t.type === 'rectangle')))) throw new Error('Unbound text is outside the flow model');
    if (raw.some(e => e.type === 'text' && e.fontFamily !== 3)) throw new Error('Unsupported font family: only licensed Cascadia 3 is modeled');
    const state = project(raw); validateState(state);
    return { ok: true, state };
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Incomplete semantic projection' }; }
}

export function createGestureRecorder(options: RecorderOptions = {}): GestureRecorder {
  let active = false, initial: SemanticSnapshot = { elements: {} }, previous: RawElement[] = [], base: SemanticSnapshot = initial;
  let latest: SemanticSnapshot = initial, timer: ReturnType<typeof setTimeout> | undefined, startedAt = 0, recordedBytes = 0;
  let pointerHeld = false;
  const gestures: RecordedGesture[] = [], excluded = new Map<string, Set<string>>(), quarantines = new Set<string>();
  const excludedInputs = new Map<string, UnmodeledChange>();
  const now = options.now ?? Date.now;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const recorder: GestureRecorder = {
    get active() { return active; }, get initial() { return structuredClone(initial); }, get gestures() { return structuredClone(gestures); },
    start(elements, fontsReady) {
      if (active) throw new Error('recording_invalid: recording already active');
      if (!fontsReady) throw new Error('recording_invalid: fonts are not ready');
      initial = snapshotElements(elements); base = structuredClone(initial); latest = structuredClone(initial); previous = structuredClone(elements);
      gestures.length = 0; excluded.clear(); excludedInputs.clear(); quarantines.clear(); pointerHeld = false; startedAt = now(); recordedBytes = new TextEncoder().encode(JSON.stringify(initial)).byteLength; active = true;
    },
    pointerDown() { if (active) { clearTimer(); pointerHeld = true; } },
    observe(elements) {
      if (!active) return;
      if (now() - startedAt > RECORDING_LIMITS.maxDurationMs) { recorder.stop(); throw new Error('recording_limit: recording duration exceeded'); }
      const next = snapshotElements(elements), oldMap = new Map(previous.map(e => [e.id, e]));
      for (const e of elements) {
        const old = oldMap.get(e.id);
        if (!['frame', 'rectangle', 'text', 'arrow'].includes(e.type) || (old && old.type !== e.type)) excluded.set(e.id, new Set(['type']));
        if (e.type === 'text' && (e.fontFamily ?? 3) !== 3) excluded.set(e.id, new Set(['fontFamily']));
        if (!old) { if (!['frame', 'rectangle', 'text', 'arrow'].includes(e.type)) excluded.set(e.id, new Set(['type'])); continue; }
        const declared = modeled(e.type);
        for (const k of [...new Set([...Object.keys(old), ...Object.keys(e)])]) {
          if (bookKeeping.has(k) || k === 'id' || k === 'type' || declared.includes(k) || same(old[k], e[k])) continue;
          if (e.type === 'arrow' && ['startBinding', 'endBinding'].includes(k) && old[k] && e[k] && same((old[k] as {elementId:string}).elementId, (e[k] as {elementId:string}).elementId)) {
            // Focus/gap can be derived during an ordinary gesture; still retained as an exclusion.
          }
          const keys = excluded.get(e.id) ?? new Set<string>(); keys.add(k); excluded.set(e.id, keys);
        }
        const oldText = old.originalText ?? old.text, newText = e.originalText ?? e.text;
        const oldContainer = oldMap.get(e.containerId ?? ''), container = elements.find(t => t.id === e.containerId);
        if (e.type === 'text' && oldText === newText && old.fontFamily === e.fontFamily && (old.width !== e.width || old.height !== e.height) && oldContainer?.width === container?.width && oldContainer?.height === container?.height) quarantines.add(`${e.id}: volatile font layout changed during gesture`);
      }
      previous = structuredClone(elements); latest = next;
      clearTimer(); timer = setTimeout(() => {
        try { recorder.boundary('quiet'); } catch (error) { active = false; clearTimer(); const fault = error instanceof Error ? error : new Error('recording_invalid: coalescing failed'); if (options.onError) options.onError(fault); else throw fault; }
      }, COALESCING_QUIET_MS);
    },
    excludeSelection(ids) {
      if (!active) return;
      if (ids.length > RECORDING_LIMITS.maxElements) throw new Error('recording_limit: native selection exceeds element budget');
      const roots = [...new Set(ids)].filter(value => {
        const element = latest.elements[value];
        return id.safeParse(value).success && element && !element.attributes.isDeleted && ['rectangle', 'arrow', 'frame'].includes(element.type);
      });
      if (roots.length < 2) return;
      for (const value of roots) excludedInputs.set(value, { id: value, attributes: [], reason: 'Native Delete targeted multiple independently selected objects; excluded from single-action evidence' });
    },
    boundary(kind: GestureBoundary) {
      clearTimer(); if (!active) return null;
      if (pointerHeld && kind !== 'pointerup' && kind !== 'stop') return null;
      if (kind === 'pointerup' || kind === 'stop') pointerHeld = false;
      const events = diff(base, latest), changed = events.length > 0;
      const moved = new Set(events.filter(e => e.kind === 'set' && ['x', 'y', 'width', 'height'].includes(e.field)).map(e => e.kind === 'set' ? e.id : ''));
      const hasDerivedCause = (id: string) => events.some(e => (e.kind === 'create' ? e.element.id : e.id) === id) || (latest.elements[id]?.type === 'arrow' && ['start', 'end'].some(k => moved.has(String(latest.elements[id]?.attributes[k] ?? '')))) || (latest.elements[id]?.type === 'text' && moved.has(String(latest.elements[id]?.attributes.containerId ?? '')));
      const incidentCacheIds = new Set<string>();
      for (const arrowId of new Set([...Object.keys(base.elements), ...Object.keys(latest.elements)])) {
        const beforeArrow = base.elements[arrowId], afterArrow = latest.elements[arrowId];
        if (beforeArrow?.type !== 'arrow' && afterArrow?.type !== 'arrow') continue;
        // Native binding changes determine back-reference cache updates. Script intent does not.
        if (beforeArrow && afterArrow && ['start', 'end', 'isDeleted'].every(k => same(beforeArrow.attributes[k], afterArrow.attributes[k]))) continue;
        for (const arrow of [beforeArrow, afterArrow]) if (arrow?.type === 'arrow') for (const k of ['start', 'end']) {
          const target = arrow.attributes[k]; if (typeof target === 'string') incidentCacheIds.add(target);
        }
      }
      const unmodeled: UnmodeledChange[] = [...excludedInputs.values()].map(value => structuredClone(value));
      for (const [id, fields] of excluded) {
        // Derived geometry may accompany modeled edits; excluded-only gestures are always visible.
        const attributes = [...fields].filter(k => !(k === 'boundElements' && incidentCacheIds.has(id)) && (!hasDerivedCause(id) || !geometry.has(k))).sort();
        if (attributes.length) unmodeled.push({ id, attributes, reason: 'Change outside the declared semantic attribute set' });
      }
      if (!changed && !unmodeled.length && !quarantines.size) { excluded.clear(); return null; }
      if (gestures.length >= RECORDING_LIMITS.maxGestures) { active = false; throw new Error('recording_limit: gesture limit exceeded'); }
      const gesture: RecordedGesture = { index: gestures.length, boundary: kind, before: structuredClone(base), after: structuredClone(latest), events, unmodeled, quarantined: quarantines.size > 0, quarantineReasons: [...quarantines].sort() };
      replayGesture(gesture);
      const gestureBytes = new TextEncoder().encode(JSON.stringify(gesture)).byteLength;
      if (recordedBytes + gestureBytes > RECORDING_LIMITS.maxBytes) { active = false; throw new Error('recording_limit: accumulated gesture bytes exceeded'); }
      recordedBytes += gestureBytes; gestures.push(gesture); base = structuredClone(latest); excluded.clear(); excludedInputs.clear(); quarantines.clear(); options.onGesture?.(structuredClone(gesture));
      return structuredClone(gesture);
    },
    stop() { recorder.boundary('stop'); clearTimer(); active = false; return structuredClone(gestures); },
  };
  return recorder;
}

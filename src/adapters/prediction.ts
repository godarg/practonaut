/**
 * The adapters' own prediction of a transition (PADR-0007): each adapter computes what an action
 * should do, independently of the core, and refuses a transition whose after state differs. Shared by
 * the Excalidraw and draw.io adapters; it imports nothing from `src/core`.
 */
import type { State, StepV2 } from '../world/types.ts';
import { isStepV2 } from '../world/types.ts';
import type { Transition } from './types.ts';

/** Adapter-side frame rule for arrows, written independently of the core's helper. */
function arrowFrame(state: State, from: string | null, to: string | null, current: string | null): string | null {
  const ends = [from, to].flatMap(end => end === null ? [] : [state.objects[end]]);
  const frames = ends.map(end => end?.type === 'step' ? end.frameId : null);
  if (!frames.length) return current;
  return frames.every(frame => frame === frames[0]) ? frames[0]! : null;
}
export function actionPrediction(transition: Transition): State {
  const state = structuredClone(transition.before), p = transition.action.params;
  const id = String(p.id ?? ''), object = state.objects[id];
  const newObjects = Object.values(transition.after.objects).filter(e => !state.objects[e.id]);
  const liveV2 = (key: string): StepV2 => { const step = state.objects[String(p[key])]; if (step?.type !== 'step' || step.deleted || !isStepV2(step)) throw new Error('Missing world/2 step'); return step; };
  switch (transition.action.name) {
    case 'add_step': {
      const added = newObjects.find(e => e.type === 'step');
      if (!added) throw new Error('add_step requires a new semantic identity');
      if (Object.hasOwn(p, 'shape')) state.objects[added.id] = { id: added.id, type: 'step', deleted: false, frameId: p.frameId === null ? null : String(p.frameId), label: String(p.label), x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height), shape: String(p.shape) as StepV2['shape'], groupId: null, stroke: 'black', fill: 'none' };
      else state.objects[added.id] = { id: added.id, type: 'step', deleted: false, frameId: String(p.frameId), label: String(p.label), x: Number(p.x), y: Number(p.y), width: Number(p.width ?? 180), height: Number(p.height ?? 100), fontFamily: Number(p.fontFamily ?? 3) }; break;
    }
    case 'resize_step': { const step = liveV2('id'); step.width = Number(p.width); step.height = Number(p.height); break; }
    case 'set_style': { const step = liveV2('id'); step.shape = String(p.shape) as StepV2['shape']; step.stroke = String(p.stroke) as StepV2['stroke']; step.fill = String(p.fill) as StepV2['fill']; break; }
    case 'rename_frame': { if (object?.type !== 'frame' || object.deleted) throw new Error('Missing frame'); object.name = String(p.name); break; }
    case 'set_frame': { const step = liveV2('id'); const frame = p.frameId === null ? null : String(p.frameId); if (frame !== null && (state.objects[frame]?.type !== 'frame' || state.objects[frame]?.deleted)) throw new Error('Missing frame'); step.frameId = frame; break; }
    case 'group_steps': {
      const step = liveV2('id'), other = liveV2('with');
      if (step.id === other.id) throw new Error('Self grouping');
      // A new group's identity is the core's; it must be one id not used by any live step before.
      const group = other.groupId ?? (transition.after.objects[other.id] as StepV2 | undefined)?.groupId;
      if (!group || (other.groupId === null && Object.values(state.objects).some(o => o.type === 'step' && isStepV2(o) && o.groupId === group))) throw new Error('group_steps needs a fresh group identity');
      other.groupId = group; step.groupId = group; break;
    }
    case 'ungroup': {
      const step = liveV2('id'), group = step.groupId; if (group === null) throw new Error('Step is not grouped');
      for (const o of Object.values(state.objects)) if (o.type === 'step' && !o.deleted && isStepV2(o) && o.groupId === group) o.groupId = null; break;
    }
    case 'rename_step': if (object?.type !== 'step' || object.deleted) throw new Error('Missing step'); else object.label = String(p.label); break;
    case 'move_step': if (object?.type !== 'step' || object.deleted) throw new Error('Missing step'); else { object.x = Number(p.x); object.y = Number(p.y); } break;
    case 'connect': {
      const added = newObjects.find(e => e.type === 'arrow'); if (!added) throw new Error('connect requires new arrow identity');
      for (const end of [p.from, p.to]) { const step = state.objects[String(end)]; if (step?.type !== 'step' || step.deleted) throw new Error('Missing step'); }
      state.objects[added.id] = { id: added.id, type: 'arrow', deleted: false, frameId: Object.hasOwn(p, 'frameId') ? String(p.frameId) : null, from: String(p.from), to: String(p.to) }; break;
    }
    case 'reconnect_end': {
      if (object?.type !== 'arrow' || object.deleted || (p.end !== 'start' && p.end !== 'end')) throw new Error('Invalid arrow endpoint');
      object[p.end === 'start' ? 'from' : 'to'] = String(p.target); break;
    }
    case 'disconnect': { if (object?.type !== 'arrow' || object.deleted) throw new Error('Missing arrow'); object.deleted = true; object.from = null; object.to = null; break; }
    case 'delete_step': {
      if (object?.type !== 'step' || object.deleted) throw new Error('Missing step'); object.deleted = true;
      for (const e of Object.values(state.objects)) if (e.type === 'arrow' && !e.deleted) { if (e.from === id) e.from = null; if (e.to === id) e.to = null; } break;
    }
    default: throw new Error('unmodeled');
  }
  // Arrows follow their ends (a no-op for world/1, whose arrows share their steps' frame).
  for (const arrow of Object.values(state.objects)) if (arrow.type === 'arrow' && !arrow.deleted) arrow.frameId = arrowFrame(state, arrow.from, arrow.to, arrow.frameId);
  return state;
}

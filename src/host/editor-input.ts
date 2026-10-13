import { isDeepStrictEqual } from 'node:util';
import { project } from '../adapters/excalidraw/raw.ts';
import type { RawElement } from '../adapters/excalidraw/raw.ts';
import { createGestureRecorder } from '../adapters/excalidraw/recorder.ts';
import type { Action, State, Step, StepV1, Arrow } from '../world/types.ts';
import { validateState } from '../world/schema.ts';
import type { EditorGestureRequest } from './author-protocol.ts';
/** One input gesture is a request, never evidence. Complete successor agreement is required later. */
export function interpretEditorGesture(request: EditorGestureRequest, committed: State): { action: Action; intended: State; createdId?: string } {
  const fail = (code: 'unmodeled' | 'editor_divergence', message: string): never => { throw { code, message }; };
  let before: State, after: State;
  try {
    if (!['pointerup','key','quiet','stop'].includes(request.boundary)) fail('unmodeled','Unknown gesture boundary');
    const recorder = createGestureRecorder(); recorder.start(request.before, true); recorder.observe(request.after);
    const gesture = recorder.boundary(request.boundary as 'pointerup' | 'key' | 'quiet' | 'stop'); recorder.stop();
    if (!gesture || gesture.unmodeled.length || gesture.quarantined) fail('unmodeled','Gesture changes excluded attributes or has no semantic action');
    before = project(request.before); after = project(request.after);
    // A deleted native arrow retains its obsolete bindings; these are not live relations.
    for (const object of Object.values(after.objects)) if (object.type === 'arrow' && object.deleted) { object.from = null; object.to = null; }
    validateState(before); validateState(after);
  } catch (error) { if ((error as { code?: string }).code) throw error; fail('unmodeled', 'Gesture has incomplete or unsupported native elements'); }
  if (!isDeepStrictEqual(before!, committed)) fail('editor_divergence','Editor before state differs from the committed host state');
  const added = Object.values(after!.objects).filter(o => !before!.objects[o.id]);
  const changed = Object.values(before!.objects).filter(o => !isDeepStrictEqual(o,after!.objects[o.id]));
  const steps = changed.filter((o): o is Step => o.type==='step'), arrows = changed.filter((o): o is Arrow=>o.type==='arrow');
  let action: Action | undefined, createdId: string | undefined;
  if (added.length === 1 && added[0]!.type === 'step') {
    const s=added[0]!;createdId=s.id;action={name:'add_step',params:{frameId:s.frameId,label:s.label,x:s.x,y:s.y,width:s.width,height:s.height,fontFamily:(s as StepV1).fontFamily}};
  } else if (added.length === 1 && added[0]!.type === 'arrow' && added[0]!.from && added[0]!.to) {
    const a=added[0]!;createdId=a.id;action={name:'connect',params:{frameId:a.frameId,from:a.from,to:a.to}};
  } else if (!added.length && steps.length===1 && after!.objects[steps[0]!.id]?.deleted) action={name:'delete_step',params:{id:steps[0]!.id}};
  else if (!added.length && !steps.length && arrows.length===1) {
    const a=arrows[0]!, successor=after!.objects[a.id];
    if (successor?.type==='arrow') {
      if(successor.deleted)action={name:'disconnect',params:{id:a.id}};
      else if(successor.from!==a.from && successor.to===a.to && successor.from)action={name:'reconnect_end',params:{id:a.id,end:'start',target:successor.from}};
      else if(successor.to!==a.to && successor.from===a.from && successor.to)action={name:'reconnect_end',params:{id:a.id,end:'end',target:successor.to}};
    }
  } else if (!added.length && steps.length===1 && !arrows.length) {
    const s=steps[0]!, successor=after!.objects[s.id];
    if(successor?.type==='step') {
      if(successor.label!==s.label) action={name:'rename_step',params:{id:s.id,label:successor.label}};
      else if(successor.x!==s.x || successor.y!==s.y) action={name:'move_step',params:{id:s.id,x:successor.x,y:successor.y}};
    }
  }
  if(!action)fail('unmodeled','Gesture cannot be represented as one declared action');
  return {action:action!,intended:after!,...(createdId ? {createdId} : {})};
}
export function reconcileCreatedIdentity(intended: State, nativeId: string | undefined, candidate: State, committed: State): State {
  if(!nativeId)return intended;
  const canonical=Object.values(candidate.objects).find(o=>!committed.objects[o.id]);
  if(!canonical)return intended;
  const reconciled=structuredClone(intended), object=reconciled.objects[nativeId];
  if(!object)return reconciled;
  delete reconciled.objects[nativeId];object.id=canonical.id;reconciled.objects[canonical.id]=object;
  for(const value of Object.values(reconciled.objects))if(value.type==='arrow') {if(value.from===nativeId)value.from=canonical.id;if(value.to===nativeId)value.to=canonical.id;}
  return reconciled;
}

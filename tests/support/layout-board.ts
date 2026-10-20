// Hand-written boards and selections for layout-clause tests (PADR-0047). Never produced by the code
// under test.
import type { Arrow, Frame, LayoutPredicate, Predicate, Selection, State, StepV2, Value, WorldObject } from '../../src/world/types.ts';

export const literal = (value: string | number | null): Value => ({ kind: 'literal', value });
export const field = (variable: string, name: string): Value => ({ kind: 'field', variable, field: name });
export const eq = (left: Value, right: Value): Predicate => ({ op: 'eq', left, right });

export function box(id: string, x: number, y: number, width: number, height: number, frameId: string | null = null, extra: Partial<StepV2> = {}): StepV2 {
  return { id, type: 'step', deleted: false, frameId, label: id, x, y, width, height, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none', ...extra };
}
export const frame = (id: string, name: string, deleted = false): Frame => ({ id, type: 'frame', deleted, name });
export const arrow = (id: string, from: string | null, to: string | null): Arrow => ({ id, type: 'arrow', deleted: false, frameId: null, from, to });
/** A state from objects; every arrow's frame is derived from its ends as world/2 requires. */
export function board(...objects: WorldObject[]): State {
  const state: State = { objects: Object.fromEntries(objects.map(o => [o.id, structuredClone(o)])) };
  for (const o of Object.values(state.objects)) if (o.type === 'arrow' && (o.from !== null || o.to !== null)) {
    const frames = [o.from, o.to].filter((end): end is string => end !== null).map(end => (state.objects[end] as StepV2).frameId);
    o.frameId = frames.every(f => f === frames[0]) ? frames[0]! : null;
  }
  return state;
}

export const everything = (type: 'step' | 'arrow', count: number, as = type === 'step' ? 's' : 'a'): Selection => ({ type, as, where: { op: 'true' }, count });
export const outside = (type: 'step' | 'arrow', count: number, as = type === 'step' ? 's' : 'a'): Selection => ({ type, as, where: eq(field(as, 'frameId'), literal(null)), count });
export const inFrame = (type: 'step' | 'arrow', name: string, count: number, as = type === 'step' ? 's' : 'a'): Selection => ({ type, as, count, where: { op: 'exists', type: 'frame', as: 'f', where: { op: 'all', args: [eq(field('f', 'id'), field(as, 'frameId')), eq(field('f', 'name'), literal(name))] } } });

export const noOverlap = (select: Selection, gap = 0): LayoutPredicate => ({ op: 'noOverlap', select, gap });
export const aligned = (select: Selection, axis: 'x' | 'y', anchor: 'start' | 'center' | 'end', tolerance = 0): LayoutPredicate => ({ op: 'aligned', select, axis, anchor, tolerance });
export const evenlySpaced = (select: Selection, axis: 'x' | 'y', tolerance = 0): LayoutPredicate => ({ op: 'evenlySpaced', select, axis, tolerance });
export const within = (select: Selection, x: number, y: number, width: number, height: number): LayoutPredicate => ({ op: 'within', select, x, y, width, height });
export const noCrossing = (select: Selection): LayoutPredicate => ({ op: 'arrowsNoCrossing', select });
export const clearOfSteps = (select: Selection, steps: Selection): LayoutPredicate => ({ op: 'arrowsClearOfSteps', select, steps });

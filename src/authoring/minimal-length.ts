/**
 * Minimal solution length by a bounded search (PADR-0040, decision 5). No model, no clock, no I/O.
 *
 * Scope: a world/2 task whose goal is exactly a from-scenes goal (read back and regenerated to
 * confirm), without group, order or alignment clauses, whose arrows join uniquely labelled steps and
 * have no loose end, on a start without groups.
 *
 * Why the bound holds there: every action changes one attribute group of one object (a step's label;
 * its shape, line and fill; its frame; its size; one arrow end; a frame's name), creates one object or
 * deletes one. Positions are not part of such a goal. Group actions only change group membership,
 * which start and goal agree on (none), so leaving it out is a relaxation. `delete_step` also
 * detaches arrow ends, but the goal forbids loose ends, so every detached arrow needs a later action
 * of its own. So a solution needs at least as many actions as the cheapest assignment of goal objects
 * to start objects (or to new ones) costs: one per differing attribute group, one per deleted or
 * created object, one more for a new step whose colours are not the defaults (`add_step` creates a
 * black, unfilled step). The search below proves that no assignment costs less than the reference;
 * when it cannot within its node cap, the length stays a "reference length".
 */
import { goalPredicateOf } from './from-scenes.ts';
import { generateVariant } from '../world/variant.ts';
import type { Arrow, Frame, Predicate, Scalar, State, StepV2, Value, World } from '../world/types.ts';
import { isDeepStrictEqual } from 'node:util';
import { canonicalJson } from '../canonical/index.ts';

/** Search nodes before the analysis gives up ("reference length"). */
export const MINIMAL_SEARCH_NODES = 250_000;
/** Most goal objects the analysis reads (from-scenes' own scene limits): a goal naming more steps,
 * arrows or frames is answered "reference length" before anything is allocated for them. */
export const MINIMAL_GOAL_LIMITS = Object.freeze({ steps: 200, arrows: 400, frames: 40 });

export type LengthAnalysis =
  | { kind: 'minimal'; length: number }
  | { kind: 'reference'; length: number; reason: 'not-applicable' | 'shorter-assignment' | 'search-limit' };

interface StepSlot { label: string; shape: StepV2['shape']; stroke: StepV2['stroke']; fill: StepV2['fill']; frame: string | null | undefined; size?: { width: number; height: number; tolerance: number } }
interface GoalSpec { frames: boolean; frameNames: string[]; steps: StepSlot[]; arrows: Array<{ from: string; to: string }> }

const literal = (value: Value): Scalar | undefined => value.kind === 'literal' ? value.value : undefined;
const fieldOf = (value: Value): string | undefined => value.kind === 'field' ? value.field : undefined;
const countClause = (p: Predicate): { type: string; where: Predicate; n: number } | undefined => {
  if (p.op !== 'eq' || p.left.kind !== 'count') return undefined;
  const n = literal(p.right);
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? { type: p.left.type, where: p.left.where, n } : undefined;
};
/** Room for `n` more goal objects of a kind, checked before any slot is allocated. */
const fits = (taken: number, n: number, kind: keyof typeof MINIMAL_GOAL_LIMITS): boolean => taken + n <= MINIMAL_GOAL_LIMITS[kind];
const args = (p: Predicate): Predicate[] => p.op === 'all' ? p.args : [p];
/** `eq(field, literal)` → [field, value]. */
const fieldEquals = (p: Predicate): [string, Scalar] | undefined => {
  if (p.op !== 'eq') return undefined;
  const field = fieldOf(p.left), value = literal(p.right);
  return field !== undefined && value !== undefined ? [field, value] : undefined;
};

/** Reads a from-scenes goal; undefined for anything else (groups, order, alignment, loose ends, unknown shapes). */
export function readGoal(goal: Predicate): GoalSpec | undefined {
  const spec: GoalSpec = { frames: false, frameNames: [], steps: [], arrows: [] };
  const sizes = new Map<string, { width: number; height: number; tolerance: number }>();
  for (const clause of args(goal)) {
    const counted = countClause(clause);
    if (counted && counted.where.op === 'true') { if (counted.type === 'frame') spec.frames = true; continue; }
    if (counted?.type === 'frame') {
      const name = fieldEquals(counted.where);
      if (!name || name[0] !== 'name' || typeof name[1] !== 'string') return undefined;
      if (!fits(spec.frameNames.length, counted.n, 'frames')) return undefined;
      for (let i = 0; i < counted.n; i++) spec.frameNames.push(name[1]);
      continue;
    }
    if (counted?.type === 'step') {
      const parts = args(counted.where), slot: Partial<StepSlot> = { frame: undefined };
      let grouped: boolean | undefined;
      for (const part of parts) {
        const equal = fieldEquals(part);
        if (equal && equal[0] === 'groupId' && equal[1] === null) { grouped = false; continue; }
        if (equal && equal[0] === 'frameId' && equal[1] === null) { slot.frame = null; continue; }
        if (equal && ['label', 'shape', 'stroke', 'fill'].includes(equal[0]) && typeof equal[1] === 'string') { (slot as Record<string, unknown>)[equal[0]] = equal[1]; continue; }
        if (part.op === 'not') { grouped = true; continue; }
        if (part.op === 'exists' && part.type === 'frame') {
          const name = args(part.where).map(fieldEquals).find(value => value?.[0] === 'name');
          if (!name || typeof name[1] !== 'string') return undefined;
          slot.frame = name[1]; continue;
        }
        return undefined;
      }
      if (grouped !== false || slot.label === undefined || !slot.shape || !slot.stroke || !slot.fill) return undefined;
      if (!fits(spec.steps.length, counted.n, 'steps')) return undefined;
      for (let i = 0; i < counted.n; i++) spec.steps.push({ ...(slot as StepSlot) });
      continue;
    }
    if (counted?.type === 'arrow') {
      const ends = args(counted.where);
      if (ends.length !== 2) return undefined;
      const labels = ends.map(end => end.op === 'exists' ? args(end.where).map(fieldEquals).find(value => value?.[0] === 'label')?.[1] : undefined);
      if (labels.some(label => typeof label !== 'string')) return undefined; // a loose end, or not an end at all
      if (!fits(spec.arrows.length, counted.n, 'arrows')) return undefined;
      for (let i = 0; i < counted.n; i++) spec.arrows.push({ from: labels[0] as string, to: labels[1] as string });
      continue;
    }
    // A size clause: exists step z with a label and near width and height.
    if (clause.op === 'exists' && clause.type === 'step') {
      const parts = args(clause.where);
      const label = parts.map(fieldEquals).find(value => value?.[0] === 'label')?.[1];
      const near = parts.filter((part): part is Extract<Predicate, { op: 'near' }> => part.op === 'near');
      const width = near.find(part => fieldOf(part.left) === 'width'), height = near.find(part => fieldOf(part.left) === 'height');
      if (parts.length === 3 && typeof label === 'string' && width && height && typeof literal(width.right) === 'number' && typeof literal(height.right) === 'number' && width.tolerance === height.tolerance) {
        sizes.set(label, { width: literal(width.right) as number, height: literal(height.right) as number, tolerance: width.tolerance });
        continue;
      }
    }
    return undefined; // groups, order, alignment or anything else
  }
  for (const [label, size] of sizes) {
    const slots = spec.steps.filter(step => step.label === label);
    if (slots.length !== 1) return undefined;
    slots[0]!.size = size;
  }
  return spec;
}

/** The goal state a spec describes, for regenerating its predicate. */
function specState(spec: GoalSpec): { state: State; resized: Set<string> } | undefined {
  const objects: State['objects'] = {}, frameIds = new Map<string, string>();
  spec.frameNames.forEach((name, index) => { const id = `f${index}`; objects[id] = { id, type: 'frame', deleted: false, name }; if (!frameIds.has(name)) frameIds.set(name, id); });
  const byLabel = new Map<string, string>();
  for (const [index, slot] of spec.steps.entries()) {
    const id = `s${index}`, frameId = slot.frame === undefined || slot.frame === null ? null : frameIds.get(slot.frame);
    if (frameId === undefined) return undefined;
    objects[id] = { id, type: 'step', deleted: false, frameId, label: slot.label, x: 0, y: 0, width: slot.size?.width ?? 160, height: slot.size?.height ?? 80, shape: slot.shape, groupId: null, stroke: slot.stroke, fill: slot.fill };
    byLabel.set(slot.label, byLabel.has(slot.label) ? '' : id);
  }
  for (const [index, arrow] of spec.arrows.entries()) {
    const from = byLabel.get(arrow.from), to = byLabel.get(arrow.to);
    if (!from || !to) return undefined; // missing or not unique
    objects[`a${index}`] = { id: `a${index}`, type: 'arrow', deleted: false, frameId: null, from, to };
  }
  for (const object of Object.values(objects)) if (object.type === 'arrow') {
    const ends = [object.from, object.to].map(id => (objects[id!] as StepV2).frameId);
    object.frameId = ends[0] === ends[1] ? ends[0]! : null;
  }
  return { state: { objects }, resized: new Set(spec.steps.filter(step => step.size).map(step => step.label)) };
}

/** Exact minimum-cost assignment (Hungarian method, O(n³)) of a square cost matrix. */
export function assignmentCost(cost: number[][]): number {
  const n = cost.length;
  if (!n) return 0;
  const u = new Array<number>(n + 1).fill(0), v = new Array<number>(n + 1).fill(0), p = new Array<number>(n + 1).fill(0), way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity), used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]!; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const current = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (current < minv[j]!) { minv[j] = current; way[j] = j0; }
        if (minv[j]! < delta) { delta = minv[j]!; j1 = j; }
      }
      for (let j = 0; j <= n; j++) { if (used[j]) { u[p[j]!]! += delta; v[j]! -= delta; } else minv[j]! -= delta; }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]!; p[j0] = p[j1]!; j0 = j1; } while (j0);
  }
  let total = 0;
  for (let j = 1; j <= n; j++) total += cost[p[j]! - 1]![j - 1]!;
  return total;
}

const liveOf = <T extends State['objects'][string]>(state: State, type: T['type']): T[] => Object.values(state.objects).filter((o): o is T => o.type === type && !o.deleted).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]));
}

/**
 * Whether a reference of `referenceLength` actions is a minimal solution of `taskId` for this seed's
 * variant. `minimal` is a proof; `reference` says why there is none.
 */
export function analyseLength(world: World, taskId: string, seed: number, referenceLength: number, nodeCap = MINIMAL_SEARCH_NODES): LengthAnalysis {
  const unproven = (reason: Extract<LengthAnalysis, { kind: 'reference' }>['reason']): LengthAnalysis => ({ kind: 'reference', length: referenceLength, reason });
  if (world.schema !== 'practonaut.world/2' || !Number.isSafeInteger(referenceLength) || referenceLength < 1) return unproven('not-applicable');
  const variant = generateVariant(world, seed), task = variant.tasks.find(value => value.id === taskId);
  if (!task) return unproven('not-applicable');
  const start = task.initialState ?? variant.initialState;
  const spec = readGoal(task.goal);
  if (!spec) return unproven('not-applicable');
  const rebuilt = specState(spec);
  if (!rebuilt) return unproven('not-applicable');
  const tolerance = spec.steps.find(step => step.size)?.size?.tolerance ?? 8;
  if (spec.steps.some(step => step.size && step.size.tolerance !== tolerance)) return unproven('not-applicable');
  // The same clauses (a conjunction, so in any order: variant labels reorder them) or no claim.
  const clauses = (goal: Predicate): string[] => args(goal).map(clause => canonicalJson(clause)).sort();
  if (!isDeepStrictEqual(clauses(goalPredicateOf(rebuilt.state, spec.frames, { tolerance }, rebuilt.resized)), clauses(task.goal))) return unproven('not-applicable');
  const steps = liveOf<StepV2>(start, 'step'), arrows = liveOf<Arrow>(start, 'arrow'), frames = liveOf<Frame>(start, 'frame');
  if (steps.some(step => step.groupId !== null)) return unproven('not-applicable');
  // Frames cannot be created or deleted: their number must already match.
  if (spec.frames && frames.length !== spec.frameNames.length) return unproven('not-applicable');
  if (!spec.frames && frames.length) return unproven('not-applicable');
  if (frames.length > 6) return unproven('search-limit');

  const slots = spec.steps, slotOfLabel = new Map<string, number>();
  slots.forEach((slot, index) => slotOfLabel.set(slot.label, slotOfLabel.has(slot.label) ? -1 : index));
  const goalArrows = spec.arrows.map(arrow => ({ from: slotOfLabel.get(arrow.from)!, to: slotOfLabel.get(arrow.to)! }));
  const incident = slots.map((_, index) => goalArrows.filter(arrow => arrow.from === index || arrow.to === index).length);
  // Most constrained slots first: those with arrows, then the rest.
  const order = slots.map((_, index) => index).sort((a, b) => incident[b]! - incident[a]! || a - b);
  const exact = new Set(arrows.map(arrow => `${arrow.from}\u0000${arrow.to}`));
  let nodes = 0, limited = false;

  for (const assignment of permutations(frames.map(frame => frame.id))) {
    // Frame f gets the goal name at the same position; a name that differs costs one rename_frame.
    const named = new Map<string, Set<string>>();
    let frameCost = 0;
    assignment.forEach((frameId, index) => {
      const name = spec.frameNames[index]!;
      if ((start.objects[frameId] as Frame).name !== name) frameCost++;
      named.set(name, (named.get(name) ?? new Set()).add(frameId));
    });
    const bound = referenceLength - frameCost;
    if (bound <= 0) continue; // this naming of the frames alone already costs the reference length
    const stepCost = (slot: StepSlot, step: StepV2): number => {
      let cost = step.label === slot.label ? 0 : 1;
      if (step.shape !== slot.shape || step.stroke !== slot.stroke || step.fill !== slot.fill) cost++;
      if (spec.frames && !(slot.frame === null ? step.frameId === null : step.frameId !== null && named.get(slot.frame!)?.has(step.frameId) === true)) cost++;
      if (slot.size && (Math.abs(step.width - slot.size.width) > slot.size.tolerance || Math.abs(step.height - slot.size.height) > slot.size.tolerance)) cost++;
      return cost;
    };
    const newCost = (slot: StepSlot): number => 1 + (slot.stroke !== 'black' || slot.fill !== 'none' ? 1 : 0);
    const table = slots.map(slot => steps.map(step => stepCost(slot, step)));
    const cheapest = slots.map((slot, index) => Math.min(newCost(slot), ...table[index]!));
    const chosen = new Array<number>(slots.length).fill(-2), taken = new Set<number>();
    const identical = order.map((slot, position) => position > 0 && incident[slot] === 0 && incident[order[position - 1]!] === 0 && isDeepStrictEqual(slots[slot], slots[order[position - 1]!]));
    const endOf = (slot: number): string => chosen[slot]! >= 0 ? steps[chosen[slot]!]!.id : `new:${slot}`;
    const arrowLowerBound = (): number => {
      let missing = 0;
      for (const arrow of goalArrows) if (chosen[arrow.from] !== -2 && chosen[arrow.to] !== -2 && !exact.has(`${endOf(arrow.from)}\u0000${endOf(arrow.to)}`)) missing++;
      return missing + Math.max(0, arrows.length - goalArrows.length);
    };
    const arrowCost = (): number => {
      const m = arrows.length, k = goalArrows.length, size = m + k;
      const matrix = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => {
        if (row < m && col < k) { const e = arrows[row]!, g = goalArrows[col]!; return (e.from === endOf(g.from) ? 0 : 1) + (e.to === endOf(g.to) ? 0 : 1); }
        if (row < m || col < k) return 1; // remove a start arrow, or connect a new one
        return 0;
      }));
      return assignmentCost(matrix);
    };
    let found = false;
    const search = (position: number, cost: number): void => {
      if (found || limited) return;
      if (++nodes > nodeCap) { limited = true; return; }
      let rest = 0;
      for (let p = position; p < order.length; p++) rest += cheapest[order[p]!]!;
      const deletions = Math.max(0, steps.length - taken.size - (order.length - position));
      if (cost + rest + deletions + arrowLowerBound() >= bound) return;
      if (position === order.length) {
        if (cost + deletions + arrowCost() < bound) found = true;
        return;
      }
      const slot = order[position]!;
      // Identical slots without arrows are interchangeable: their choices are kept in ascending order,
      // a new step counting as the last choice. This drops only permutations of equal cost.
      const previous = identical[position] ? chosen[order[position - 1]!]! : undefined;
      const floor = previous === undefined ? 0 : previous === -1 ? steps.length : previous + 1;
      const options = steps.map((_, index) => index).filter(index => index >= floor && !taken.has(index)).sort((a, b) => table[slot]![a]! - table[slot]![b]! || a - b);
      for (const index of options) {
        chosen[slot] = index; taken.add(index);
        search(position + 1, cost + table[slot]![index]!);
        taken.delete(index); chosen[slot] = -2;
        if (found || limited) return;
      }
      chosen[slot] = -1; // a new step
      search(position + 1, cost + newCost(slots[slot]!));
      chosen[slot] = -2;
    };
    search(0, 0);
    if (found) return unproven('shorter-assignment');
    if (limited) return unproven('search-limit');
  }
  return { kind: 'minimal', length: referenceLength };
}

/** Minimal for every given seed, or the first reason it is not. */
export function analyseLengthForSeeds(world: World, taskId: string, seeds: readonly number[], referenceLength: number, nodeCap = MINIMAL_SEARCH_NODES): LengthAnalysis {
  for (const seed of seeds) {
    const result = analyseLength(world, taskId, seed, referenceLength, nodeCap);
    if (result.kind !== 'minimal') return result;
  }
  return { kind: 'minimal', length: referenceLength };
}

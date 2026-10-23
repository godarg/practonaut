/**
 * The geometry of the six layout operators (PADR-0047 decisions 2–4): one pure analysis that both
 * decides a layout clause (false exactly when it returns a reason) and names what offends it for the
 * report's marks. Exact integer arithmetic on doubled coordinates: a box of a step is
 * [2x, 2x + 2·width] × [2y, 2y + 2·height], its centre (2x + width, 2y + height); an arrow is the
 * closed segment between the centres of its two steps. No clock, randomness or I/O.
 *
 * Cost is not counted here: `layoutCharge` gives the whole charge from the number of objects and the
 * expected counts alone, and the evaluator debits it before calling the analysis.
 */
import { LAYOUT_LIMITS } from "../world/limits.ts";
import { selectionScope, selectionsOf } from "../world/layout.ts";
import type { Arrow, LayoutPredicate, Selection, State, Step, WorldObject } from "../world/types.ts";

/** A box edge outside ±LAYOUT_LIMITS.range reached a layout clause: a bound upstream was wrong. The
 * evaluator reports it as `checker_invalid`, never as a verdict. */
export class LayoutRangeError extends Error {
  constructor(id: string) { super(`step ${id} has a box edge outside ±${LAYOUT_LIMITS.range}; layout clauses judge only boxes inside that range`); this.name = "LayoutRangeError"; }
}

/** Why a layout clause is false. Ids are the judged state's object ids. */
export type LayoutReason =
  /** The selection (0: `select`, 1: `steps`) holds another number of objects than its count. */
  | { kind: "count"; selection: 0 | 1; type: "step" | "arrow"; expected: number; found: number }
  /** A selected arrow with an end that is not attached to a step. */
  | { kind: "loose"; arrow: string }
  /** noOverlap: two boxes closer than the gap in both directions. */
  | { kind: "overlap"; steps: [string, string] }
  /** aligned: the steps with the smallest and the largest anchor. */
  | { kind: "spread"; steps: [string, string] }
  /** evenlySpaced: two neighbours whose projections onto the axis overlap. */
  | { kind: "projection"; steps: [string, string] }
  /** evenlySpaced: the neighbours with the smallest and the largest gap. */
  | { kind: "gaps"; smallest: [string, string]; largest: [string, string] }
  /** within: a box not entirely inside the canvas. */
  | { kind: "outside"; step: string }
  /** arrowsNoCrossing: two arrows whose judged segments meet. */
  | { kind: "crossing"; arrows: [string, string] }
  /** arrowsClearOfSteps: an arrow whose judged segment touches the box of a step other than its own ends. */
  | { kind: "touch"; arrow: string; step: string };

/** ⌈log₂ k⌉ in integers: the bit length of k − 1 (0 for k ≤ 1). */
export function ceilLog2(k: number): number {
  let bits = 0;
  for (let rest = k - 1; rest > 0; rest = Math.floor(rest / 2)) bits++;
  return bits;
}
/** The sort charge of evenlySpaced: 0 for k ≤ 2, else k·⌈log₂ k⌉. */
export const sortCharge = (k: number): number => k <= 2 ? 0 : k * ceilLog2(k);
/** One selection's charge: N for every object and for outside every frame, 2N for a frame by name. */
const selectionCharge = (selection: Selection, objects: number): number => (selectionScope(selection)?.kind === "frame" ? 2 : 1) * objects;

/**
 * The whole charge of a layout clause beyond its own node's tick (PADR-0047 decision 4), from the
 * number of objects in the state (tombstones included), the selection shapes and the expected counts
 * only — never from a position, an id or the number of objects actually selected.
 */
export function layoutCharge(p: LayoutPredicate, objects: number): number {
  const s = selectionCharge(p.select, objects), k = p.select.count;
  switch (p.op) {
    case "noOverlap": case "arrowsNoCrossing": return s + k + (k * (k - 1)) / 2;
    case "aligned": case "within": return s + k;
    case "evenlySpaced": return s + k + sortCharge(k) + Math.max(0, k - 1);
    case "arrowsClearOfSteps": { const m = p.steps.count; return s + selectionCharge(p.steps, objects) + k + m + k * m; }
  }
}

/** The live objects a selection selects, in the given order (the evaluator's: by id). The three shapes
 * are evaluated by a fixed rule with the generic evaluator's result. */
export function selected(selection: Selection, objects: readonly WorldObject[]): WorldObject[] {
  const scope = selectionScope(selection);
  if (!scope) throw new Error(`a ${selection.type} selection that is none of the three shapes`);
  const frames = scope.kind === "frame" ? new Set(objects.filter(o => o.type === "frame" && !o.deleted && o.name === scope.name).map(o => o.id)) : undefined;
  return objects.filter(o => !o.deleted && o.type === selection.type
    && (scope.kind === "all" || (scope.kind === "outside" ? o.frameId === null : o.frameId !== null && frames!.has(o.frameId))));
}

interface Box { id: string; x0: number; y0: number; x1: number; y1: number; cx: number; cy: number }
/** The doubled box of a step, after the range check. */
function boxOf(step: Step): Box {
  const edges = [step.x, step.y, step.x + step.width, step.y + step.height];
  if (edges.some(edge => !Number.isSafeInteger(edge) || Math.abs(edge) > LAYOUT_LIMITS.range)) throw new LayoutRangeError(step.id);
  return { id: step.id, x0: 2 * step.x, y0: 2 * step.y, x1: 2 * (step.x + step.width), y1: 2 * (step.y + step.height), cx: 2 * step.x + step.width, cy: 2 * step.y + step.height };
}
interface Point { x: number; y: number }
const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const sign = (value: number): -1 | 0 | 1 => value > 0 ? 1 : value < 0 ? -1 : 0;
/** r lies within the bounding rectangle of p and q (used when r is collinear with them). */
const within = (p: Point, q: Point, r: Point): boolean => Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);
/** Whether closed segments p1p2 and p3p4 share a point (the orientation test; a point is a segment). */
export function segmentsMeet(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = sign(cross(p3, p4, p1)), d2 = sign(cross(p3, p4, p2)), d3 = sign(cross(p1, p2, p3)), d4 = sign(cross(p1, p2, p4));
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (d1 === 0 && within(p3, p4, p1)) || (d2 === 0 && within(p3, p4, p2)) || (d3 === 0 && within(p1, p2, p3)) || (d4 === 0 && within(p1, p2, p4));
}

interface Segment { arrow: Arrow; from: Box; to: Box }
const centre = (box: Box): Point => ({ x: box.cx, y: box.cy });
/** Two judged arrows meet (decision 3.5): same two steps never; one shared step only beyond its centre. */
function arrowsMeet(a: Segment, b: Segment): boolean {
  const ends = (s: Segment): Set<string> => new Set([s.from.id, s.to.id]);
  const ea = ends(a), eb = ends(b), shared = [...ea].filter(id => eb.has(id));
  if (ea.size === eb.size && shared.length === ea.size) return false; // the same two steps, or two self-loops on one
  if (shared.length === 0) return segmentsMeet(centre(a.from), centre(a.to), centre(b.from), centre(b.to));
  // One shared step E: a self-loop on E is the point at its centre, which every arrow at E starts from.
  if (ea.size === 1 || eb.size === 1) return false;
  const e = shared[0]!, c = centre(a.from.id === e ? a.from : a.to);
  const other = (s: Segment): Point => centre(s.from.id === e ? s.to : s.from);
  const u = { x: other(a).x - c.x, y: other(a).y - c.y }, v = { x: other(b).x - c.x, y: other(b).y - c.y };
  if ((u.x === 0 && u.y === 0) || (v.x === 0 && v.y === 0)) return false;
  return u.x * v.y - u.y * v.x === 0 && u.x * v.x + u.y * v.y > 0;
}
/** A judged segment touches a closed box: an endpoint inside it, or the segment meets one of its edges. */
function touches(s: Segment, box: Box): boolean {
  const p = centre(s.from), q = centre(s.to);
  const inside = (r: Point): boolean => box.x0 <= r.x && r.x <= box.x1 && box.y0 <= r.y && r.y <= box.y1;
  if (inside(p) || inside(q)) return true;
  const corners: Point[] = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
  return corners.some((corner, index) => segmentsMeet(p, q, corner, corners[(index + 1) % 4]!));
}

/**
 * The reasons a layout clause is false on `state`, at most `limit` of them (the clause holds exactly
 * when there is none). Objects are taken in id order, so the reasons are deterministic. A box edge
 * outside the judged range throws LayoutRangeError.
 */
export function layoutReasons(p: LayoutPredicate, state: State, limit = Number.POSITIVE_INFINITY): LayoutReason[] {
  const objects = Object.keys(state.objects).sort().map(id => state.objects[id]!);
  return analyse(p, objects, limit);
}
/** As `layoutReasons`, on the state's objects already in id order (the evaluator's array). */
export function analyse(p: LayoutPredicate, objects: readonly WorldObject[], limit: number): LayoutReason[] {
  const reasons: LayoutReason[] = [];
  const add = (reason: LayoutReason): boolean => { reasons.push(reason); return reasons.length >= limit; };
  const selections = selectionsOf(p).map(selection => selected(selection, objects));
  for (const [index, selection] of selectionsOf(p).entries()) {
    const found = selections[index]!.length;
    if (found !== selection.count) { add({ kind: "count", selection: index as 0 | 1, type: selection.type, expected: selection.count, found }); return reasons; }
  }
  const byId = new Map(objects.map(o => [o.id, o]));
  const boxes = (list: readonly WorldObject[]): Box[] => list.map(o => boxOf(o as Step));
  if (p.op === "arrowsNoCrossing" || p.op === "arrowsClearOfSteps") {
    const arrows = selections[0] as Arrow[];
    // Every box the clause reads is read (and range-checked) before anything is decided, so the
    // outcome never depends on how many reasons are asked for.
    const segments: Segment[] = arrows.filter(a => a.from !== null && a.to !== null).map(a => ({ arrow: a, from: boxOf(byId.get(a.from!) as Step), to: boxOf(byId.get(a.to!) as Step) }));
    const steps = p.op === "arrowsClearOfSteps" ? boxes(selections[1]!) : [];
    const loose = arrows.filter(a => a.from === null || a.to === null);
    for (const arrow of loose) if (add({ kind: "loose", arrow: arrow.id })) return reasons;
    if (loose.length) return reasons;
    if (p.op === "arrowsNoCrossing") {
      for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length; j++) {
        if (arrowsMeet(segments[i]!, segments[j]!) && add({ kind: "crossing", arrows: [segments[i]!.arrow.id, segments[j]!.arrow.id] })) return reasons;
      }
      return reasons;
    }
    for (const segment of segments) for (const step of steps) {
      if (step.id === segment.from.id || step.id === segment.to.id) continue;
      if (touches(segment, step) && add({ kind: "touch", arrow: segment.arrow.id, step: step.id })) return reasons;
    }
    return reasons;
  }
  const list = boxes(selections[0]!);
  switch (p.op) {
    case "noOverlap": {
      // In doubled units the gap is 2·gap.
      const g = 2 * p.gap;
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        if (a.x1 + g <= b.x0 || b.x1 + g <= a.x0 || a.y1 + g <= b.y0 || b.y1 + g <= a.y0) continue;
        if (add({ kind: "overlap", steps: [a.id, b.id] })) return reasons;
      }
      return reasons;
    }
    case "aligned": {
      const anchor = (b: Box): number => p.axis === "x" ? (p.anchor === "start" ? b.x0 : p.anchor === "end" ? b.x1 : b.cx) : (p.anchor === "start" ? b.y0 : p.anchor === "end" ? b.y1 : b.cy);
      let low = list[0]!, high = list[0]!;
      for (const b of list) { if (anchor(b) < anchor(low)) low = b; if (anchor(b) > anchor(high)) high = b; }
      if (anchor(high) - anchor(low) > 2 * p.tolerance) add({ kind: "spread", steps: [low.id, high.id] });
      return reasons;
    }
    case "evenlySpaced": {
      const start = (b: Box): number => p.axis === "x" ? b.x0 : b.y0, end = (b: Box): number => p.axis === "x" ? b.x1 : b.y1;
      // Ties broken by id only to be deterministic: two boxes that start together overlap either way.
      const order = [...list].sort((a, b) => start(a) - start(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const gaps = order.slice(1).map((b, index) => ({ pair: [order[index]!.id, b.id] as [string, string], gap: start(b) - end(order[index]!) }));
      const overlap = gaps.find(entry => entry.gap < 0);
      if (overlap) { add({ kind: "projection", steps: overlap.pair }); return reasons; }
      let small = gaps[0]!, large = gaps[0]!;
      for (const entry of gaps) { if (entry.gap < small.gap) small = entry; if (entry.gap > large.gap) large = entry; }
      // Gaps are doubled; so is the tolerance.
      if (large.gap - small.gap > 2 * p.tolerance) add({ kind: "gaps", smallest: small.pair, largest: large.pair });
      return reasons;
    }
    case "within": {
      const x0 = 2 * p.x, y0 = 2 * p.y, x1 = 2 * (p.x + p.width), y1 = 2 * (p.y + p.height);
      for (const b of list) if (!(x0 <= b.x0 && b.x1 <= x1 && y0 <= b.y0 && b.y1 <= y1) && add({ kind: "outside", step: b.id })) return reasons;
      return reasons;
    }
  }
}

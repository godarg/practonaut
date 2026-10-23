// A second implementation of the six layout operators (PADR-0047), for tests only. It shares no code
// with src/predicate/layout.ts and uses other algorithms: exact rationals in BigInt, parametric
// segment intersection, Liang–Barsky clipping for box contact, and pixel enumeration for overlap and
// the canvas. Its selection reads the three shapes on its own. Meant for small boards.
import type { LayoutPredicate, Predicate, Selection, State, WorldObject } from '../../src/world/types.ts';

/** An exact rational with a positive denominator. */
class Q {
  readonly n: bigint; readonly d: bigint;
  constructor(n: bigint, d: bigint = 1n) {
    if (d === 0n) throw new Error('division by zero');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n < 0n ? -n : n, d);
    this.n = n / g; this.d = d / g;
  }
  static of(value: number): Q { return new Q(BigInt(value)); }
  add(o: Q): Q { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o: Q): Q { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o: Q): Q { return new Q(this.n * o.n, this.d * o.d); }
  div(o: Q): Q { return new Q(this.n * o.d, this.d * o.n); }
  cmp(o: Q): number { const l = this.n * o.d, r = o.n * this.d; return l < r ? -1 : l > r ? 1 : 0; }
  eq(o: Q): boolean { return this.cmp(o) === 0; }
  isZero(): boolean { return this.n === 0n; }
}
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a === 0n ? 1n : a; }
const min = (a: Q, b: Q): Q => a.cmp(b) <= 0 ? a : b;
const max = (a: Q, b: Q): Q => a.cmp(b) >= 0 ? a : b;
interface P { x: Q; y: Q }
const half = new Q(1n, 2n);

type Step = Extract<WorldObject, { type: 'step' }>;
type Arrow = Extract<WorldObject, { type: 'arrow' }>;

/** The objects a selection's `where` selects, read without the product's shape recogniser. */
function select(selection: Selection, state: State): WorldObject[] {
  const live = Object.values(state.objects).filter(o => !o.deleted && o.type === selection.type);
  const where: Predicate = selection.where;
  if (where.op === 'true') return live;
  if (where.op === 'eq') return live.filter(o => (o as { frameId: string | null }).frameId === null);
  if (where.op === 'exists' && where.where.op === 'all') {
    const nameClause = where.where.args[1]!;
    if (nameClause.op !== 'eq' || nameClause.right.kind !== 'literal') throw new Error('unexpected shape');
    const name = nameClause.right.value;
    return live.filter(o => {
      const frameId = (o as { frameId: string | null }).frameId;
      const frame = frameId === null ? undefined : state.objects[frameId];
      return frame !== undefined && frame.type === 'frame' && !frame.deleted && frame.name === name;
    });
  }
  throw new Error('unexpected selection shape');
}

const centre = (s: Step): P => ({ x: Q.of(s.x).add(new Q(BigInt(s.width), 2n)), y: Q.of(s.y).add(new Q(BigInt(s.height), 2n)) });

/** Every integer cell [x, x + 1) × [y, y + 1) of a half-open rectangle. */
function cells(x: number, y: number, width: number, height: number): Set<string> {
  const out = new Set<string>();
  for (let i = x; i < x + width; i++) for (let j = y; j < y + height; j++) out.add(`${i},${j}`);
  return out;
}

/** The intersection of two closed segments as a list of points (one point, the two ends of a shared
 * piece, or nothing), by solving p + t·(q − p) = r + u·(s − r) in rationals. */
function intersection(p: P, q: P, r: P, s: P): P[] {
  const dp = { x: q.x.sub(p.x), y: q.y.sub(p.y) }, dr = { x: s.x.sub(r.x), y: s.y.sub(r.y) };
  const pointP = dp.x.isZero() && dp.y.isZero(), pointR = dr.x.isZero() && dr.y.isZero();
  const same = (a: P, b: P): boolean => a.x.eq(b.x) && a.y.eq(b.y);
  // The parameter of point a on segment from o along d, if a lies on that segment's line within it.
  const onSegment = (a: P, o: P, d: { x: Q; y: Q }): boolean => {
    const t = !d.x.isZero() ? a.x.sub(o.x).div(d.x) : a.y.sub(o.y).div(d.y);
    const zero = new Q(0n), one = new Q(1n);
    if (t.cmp(zero) < 0 || t.cmp(one) > 0) return false;
    return same({ x: o.x.add(d.x.mul(t)), y: o.y.add(d.y.mul(t)) }, a);
  };
  if (pointP && pointR) return same(p, r) ? [p] : [];
  if (pointP) return onSegment(p, r, dr) ? [p] : [];
  if (pointR) return onSegment(r, p, dp) ? [r] : [];
  const denominator = dp.x.mul(dr.y).sub(dp.y.mul(dr.x));
  const rp = { x: r.x.sub(p.x), y: r.y.sub(p.y) };
  if (!denominator.isZero()) {
    const t = rp.x.mul(dr.y).sub(rp.y.mul(dr.x)).div(denominator), u = rp.x.mul(dp.y).sub(rp.y.mul(dp.x)).div(denominator);
    const zero = new Q(0n), one = new Q(1n);
    if (t.cmp(zero) < 0 || t.cmp(one) > 0 || u.cmp(zero) < 0 || u.cmp(one) > 0) return [];
    return [{ x: p.x.add(dp.x.mul(t)), y: p.y.add(dp.y.mul(t)) }];
  }
  // Parallel: collinear only when r lies on the line through p and q.
  if (!rp.x.mul(dp.y).sub(rp.y.mul(dp.x)).isZero()) return [];
  // Project onto the line by p's parameter: [0, 1] against the parameters of r and s.
  const param = (a: P): Q => !dp.x.isZero() ? a.x.sub(p.x).div(dp.x) : a.y.sub(p.y).div(dp.y);
  const a = param(r), b = param(s);
  const low = max(new Q(0n), min(a, b)), high = min(new Q(1n), max(a, b));
  if (low.cmp(high) > 0) return [];
  const at = (t: Q): P => ({ x: p.x.add(dp.x.mul(t)), y: p.y.add(dp.y.mul(t)) });
  return low.eq(high) ? [at(low)] : [at(low), at(high)];
}

/** Liang–Barsky: whether the closed segment p–q meets the closed rectangle. */
function clips(p: P, q: P, x0: Q, y0: Q, x1: Q, y1: Q): boolean {
  let low = new Q(0n), high = new Q(1n);
  for (const [start, delta, lo, hi] of [[p.x, q.x.sub(p.x), x0, x1], [p.y, q.y.sub(p.y), y0, y1]] as const) {
    if (delta.isZero()) { if (start.cmp(lo) < 0 || start.cmp(hi) > 0) return false; continue; }
    const a = lo.sub(start).div(delta), b = hi.sub(start).div(delta);
    low = max(low, min(a, b)); high = min(high, max(a, b));
    if (low.cmp(high) > 0) return false;
  }
  return true;
}

/** The verdict of a layout clause by the second implementation. */
export function oracleHolds(p: LayoutPredicate, state: State): boolean {
  const first = select(p.select, state);
  if (first.length !== p.select.count) return false;
  if (p.op === 'arrowsClearOfSteps' && select(p.steps, state).length !== p.steps.count) return false;
  const stepOf = (id: string): Step => state.objects[id] as Step;
  switch (p.op) {
    case 'noOverlap': {
      const steps = first as Step[];
      for (let i = 0; i < steps.length; i++) for (let j = 0; j < steps.length; j++) {
        if (i === j) continue;
        const a = steps[i]!, b = steps[j]!;
        // Grow both by the gap to the right and down: they then share a cell exactly when they are
        // closer than the gap in both directions.
        const grown = cells(a.x, a.y, a.width + p.gap, a.height + p.gap);
        for (const cell of cells(b.x, b.y, b.width + p.gap, b.height + p.gap)) if (grown.has(cell)) return false;
      }
      return true;
    }
    case 'aligned': {
      const value = (s: Step): Q => {
        const start = Q.of(p.axis === 'x' ? s.x : s.y), size = Q.of(p.axis === 'x' ? s.width : s.height);
        return p.anchor === 'start' ? start : p.anchor === 'end' ? start.add(size) : start.add(size.mul(half));
      };
      const values = (first as Step[]).map(value);
      const spread = values.reduce(max).sub(values.reduce(min));
      return spread.cmp(Q.of(p.tolerance)) <= 0;
    }
    case 'evenlySpaced': {
      const span = (s: Step): [number, number] => p.axis === 'x' ? [s.x, s.x + s.width] : [s.y, s.y + s.height];
      const steps = first as Step[];
      // Any two projections that share more than a point: false, whatever the order.
      for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) {
        const [a0, a1] = span(steps[i]!), [b0, b1] = span(steps[j]!);
        if (Math.max(a0, b0) < Math.min(a1, b1)) return false;
      }
      // Order by repeated choice of the leftmost remaining projection.
      const rest = steps.map(span), ordered: Array<[number, number]> = [];
      while (rest.length) { let best = 0; rest.forEach((value, index) => { if (value[0] < rest[best]![0]) best = index; }); ordered.push(rest.splice(best, 1)[0]!); }
      const gaps = ordered.slice(1).map((value, index) => value[0] - ordered[index]![1]);
      return Math.max(...gaps) - Math.min(...gaps) <= p.tolerance;
    }
    case 'within': {
      const canvas = cells(p.x, p.y, p.width, p.height);
      return (first as Step[]).every(s => [...cells(s.x, s.y, s.width, s.height)].every(cell => canvas.has(cell)));
    }
    case 'arrowsNoCrossing': {
      const arrows = first as Arrow[];
      if (arrows.some(a => a.from === null || a.to === null)) return false;
      for (let i = 0; i < arrows.length; i++) for (let j = i + 1; j < arrows.length; j++) {
        const a = arrows[i]!, b = arrows[j]!;
        const ea = new Set([a.from!, a.to!]), eb = new Set([b.from!, b.to!]);
        if (ea.size === eb.size && [...ea].every(id => eb.has(id))) continue;
        const points = intersection(centre(stepOf(a.from!)), centre(stepOf(a.to!)), centre(stepOf(b.from!)), centre(stepOf(b.to!)));
        if (!points.length) continue;
        const shared = [...ea].filter(id => eb.has(id));
        if (!shared.length) return false;
        // Sharing one step: they may meet at its centre only.
        const c = centre(stepOf(shared[0]!));
        if (points.some(point => !(point.x.eq(c.x) && point.y.eq(c.y)))) return false;
      }
      return true;
    }
    case 'arrowsClearOfSteps': {
      const arrows = first as Arrow[], steps = select(p.steps, state) as Step[];
      if (arrows.some(a => a.from === null || a.to === null)) return false;
      for (const a of arrows) for (const s of steps) {
        if (s.id === a.from || s.id === a.to) continue;
        if (clips(centre(stepOf(a.from!)), centre(stepOf(a.to!)), Q.of(s.x), Q.of(s.y), Q.of(s.x + s.width), Q.of(s.y + s.height))) return false;
      }
      return true;
    }
  }
}

/** The charge PADR-0047 decision 4 states, written out again (k(k−1)/2 pairs, ⌈log₂ k⌉ by doubling). */
export function oracleCost(p: LayoutPredicate, objects: number): number {
  const s = (selection: Selection): number => selection.where.op === 'exists' ? 2 * objects : objects;
  const log = (k: number): number => { let bits = 0, power = 1; while (power < k) { power *= 2; bits++; } return bits; };
  const k = p.select.count;
  switch (p.op) {
    case 'noOverlap': case 'arrowsNoCrossing': return 1 + s(p.select) + k + (k * (k - 1)) / 2;
    case 'aligned': case 'within': return 1 + s(p.select) + k;
    case 'evenlySpaced': return 1 + s(p.select) + k + (k <= 2 ? 0 : k * log(k)) + Math.max(0, k - 1);
    case 'arrowsClearOfSteps': return 1 + s(p.select) + s(p.steps) + k + p.steps.count + k * p.steps.count;
  }
}

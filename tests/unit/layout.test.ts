// Layout operators (PADR-0047): a hand-derived edge-case table per operator, a second implementation
// (tests/support/layout-oracle.ts: BigInt rationals, other algorithms) compared on random small boards
// with ids permuted, charges against the formulas, the guarded meter, and world validation refusals.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createMeter, evaluate, layoutReasons } from '../../src/predicate/index.ts';
import { createRandom } from '../../src/challenge/random.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { WorldError } from '../../src/world/preflight.ts';
import type { LayoutPredicate, Predicate, Selection, State, StepV2, WorldObject } from '../../src/world/types.ts';
import { aligned, arrow, board, box, clearOfSteps, eq, evenlySpaced, everything, field, frame, inFrame, literal, noCrossing, noOverlap, outside, within } from '../support/layout-board.ts';
import { oracleCost, oracleHolds } from '../support/layout-oracle.ts';

const holds = (p: Predicate, state: State): boolean => {
  const result = evaluate(p, state);
  if (!result.ok) assert.fail(`${result.error.code}: ${result.error.message}`);
  return result.value;
};
const both = (p: LayoutPredicate, state: State, expected: boolean, name: string): void => {
  assert.equal(holds(p, state), expected, `${name} (product)`);
  assert.equal(oracleHolds(p, state), expected, `${name} (second implementation)`);
};
const two = (a: StepV2, b: StepV2): State => board(a, b);

describe('layout operators: hand-derived edge cases', () => {
  it('noOverlap: touching edges and corners pass, one box inside another or a one-pixel overlap fail; the gap holds in one direction', () => {
    const all2 = everything('step', 2);
    both(noOverlap(all2), two(box('a', 0, 0, 10, 10), box('b', 10, 0, 10, 10)), true, 'shared edge');
    both(noOverlap(all2), two(box('a', 0, 0, 10, 10), box('b', 10, 10, 10, 10)), true, 'shared corner');
    both(noOverlap(all2), two(box('a', 0, 0, 10, 10), box('b', 9, 0, 10, 10)), false, 'one pixel of overlap');
    both(noOverlap(all2), two(box('a', 0, 0, 10, 10), box('b', 2, 2, 4, 4)), false, 'one box inside the other');
    both(noOverlap(all2), two(box('a', 0, 0, 10, 10), box('b', 0, 0, 10, 10)), false, 'the same box twice');
    both(noOverlap(all2, 20), two(box('a', 0, 0, 10, 10), box('b', 30, 0, 10, 10)), true, 'exactly the gap apart');
    both(noOverlap(all2, 20), two(box('a', 0, 0, 10, 10), box('b', 29, 0, 10, 10)), false, 'one pixel closer than the gap');
    both(noOverlap(all2, 20), two(box('a', 0, 0, 10, 10), box('b', 5, 30, 10, 10)), true, 'apart vertically only');
    both(noOverlap(all2, 20), two(box('a', 0, 0, 10, 10), box('b', 25, 25, 10, 10)), false, 'diagonal: 15 px each way, less than the gap in both');
  });
  it('aligned: anchors in doubled units, so half-pixel centres are exact', () => {
    const all2 = everything('step', 2);
    both(aligned(all2, 'y', 'center'), two(box('a', 0, 0, 10, 10), box('b', 20, 1, 10, 8)), true, 'centres both at y 5');
    both(aligned(all2, 'y', 'center', 0), two(box('a', 0, 0, 10, 10), box('b', 20, 0, 10, 11)), false, 'centres 5 and 5.5, tolerance 0');
    both(aligned(all2, 'y', 'center', 1), two(box('a', 0, 0, 10, 10), box('b', 20, 0, 10, 11)), true, 'centres 5 and 5.5, tolerance 1');
    both(aligned(all2, 'y', 'start', 2), two(box('a', 0, 0, 10, 10), box('b', 20, 3, 10, 10)), false, 'top edges 3 apart, tolerance 2');
    both(aligned(all2, 'y', 'start', 3), two(box('a', 0, 0, 10, 10), box('b', 20, 3, 10, 10)), true, 'top edges 3 apart, tolerance 3');
    both(aligned(all2, 'y', 'end'), two(box('a', 0, 0, 10, 10), box('b', 20, 5, 10, 5)), true, 'bottom edges both at 10');
    both(aligned(all2, 'x', 'center'), two(box('a', 0, 0, 10, 10), box('b', 1, 20, 8, 10)), true, 'one column by centres');
    both(aligned(all2, 'x', 'end', 1), two(box('a', 0, 0, 10, 10), box('b', 0, 20, 12, 10)), false, 'right edges 10 and 12, tolerance 1');
    both(aligned(all2, 'x', 'end', 2), two(box('a', 0, 0, 10, 10), box('b', 0, 20, 12, 10)), true, 'right edges 10 and 12, tolerance 2');
  });
  it('evenlySpaced: equal non-negative gaps; columns, staggered rows, stacks and the reviewers\' P/Q/R boards fail whatever the ids', () => {
    const all3 = everything('step', 3);
    const row = (c: number, widths: [number, number, number] = [10, 10, 10]): State => board(box('a', 0, 0, widths[0], 10), box('b', 20, 0, widths[1], 10), box('c', c, 0, widths[2], 10));
    both(evenlySpaced(all3, 'x'), row(40), true, 'gaps 10 and 10');
    both(evenlySpaced(all3, 'x', 4), row(45), false, 'gaps 10 and 15, tolerance 4');
    both(evenlySpaced(all3, 'x', 5), row(45), true, 'gaps 10 and 15, tolerance 5');
    both(evenlySpaced(all3, 'x'), board(box('a', 0, 0, 10, 10), box('b', 10, 0, 10, 10), box('c', 20, 0, 10, 10)), true, 'touching: gaps 0 and 0');
    // Direction is not judged: the same row with ids in the other order.
    both(evenlySpaced(all3, 'x'), board(box('c', 0, 0, 10, 10), box('b', 20, 0, 10, 10), box('a', 40, 0, 10, 10)), true, 'right to left');
    const column = board(box('a', 0, 0, 10, 10), box('b', 0, 20, 10, 10), box('c', 0, 40, 10, 10));
    both(evenlySpaced(all3, 'x', 1000), column, false, 'a column along x');
    both(evenlySpaced(all3, 'y'), column, true, 'a column along y');
    both(evenlySpaced(all3, 'x', 1000), board(box('a', 0, 0, 10, 10), box('b', 5, 20, 10, 10), box('c', 10, 0, 10, 10)), false, 'staggered rows');
    both(evenlySpaced(all3, 'x', 1000), board(box('a', 0, 0, 10, 10), box('b', 0, 10, 10, 10), box('c', 0, 20, 10, 10)), false, 'a stack of three 10-px boxes');
    both(evenlySpaced(all3, 'x', 1000), board(box('a', 0, 0, 10, 10), box('b', 0, 20, 10, 10), box('c', 0, 40, 20, 10)), false, 'widths 10/10/20 at one x');
    both(evenlySpaced(all3, 'x', 1000), board(box('a', 0, 0, 10, 10), box('b', 0, 20, 20, 10), box('c', 0, 40, 10, 10)), false, 'widths 10/20/10 at one x');
    const pqr = (p: string, q: string): State => board(box(p, 0, 0, 10, 10), box(q, 0, 20, 20, 10), box('R', 30, 0, 10, 10));
    both(evenlySpaced(all3, 'x', 1000), pqr('P', 'Q'), false, 'P/Q/R');
    both(evenlySpaced(all3, 'x', 1000), pqr('Q', 'P'), false, 'P/Q/R with the ids of P and Q swapped');
  });
  it('within: the closed canvas; touching its edge is inside', () => {
    const all2 = everything('step', 2);
    both(within(all2, 0, 0, 100, 50), two(box('a', 0, 0, 10, 10), box('b', 90, 40, 10, 10)), true, 'touching the canvas edges');
    both(within(all2, 0, 0, 100, 50), two(box('a', 0, 0, 10, 10), box('b', 91, 40, 10, 10)), false, 'one pixel past the right edge');
    both(within(all2, 0, 0, 100, 50), two(box('a', -1, 0, 10, 10), box('b', 90, 40, 10, 10)), false, 'one pixel past the left edge');
    both(within(everything('step', 1), 10, 10, 80, 30), board(box('a', 10, 10, 80, 30)), true, 'exactly the canvas');
  });
  // Steps of 2 × 2 px: the centre of box('A', x, y, 2, 2) is (x + 1, y + 1).
  const dot = (id: string, x: number, y: number): StepV2 => box(id, x, y, 2, 2);
  it('arrowsNoCrossing: crossings, touches and collinear overlaps fail; shared steps meet only at their centre; the same two steps are not compared', () => {
    const corners = [dot('A', 0, 0), dot('B', 20, 20), dot('C', 0, 20), dot('D', 20, 0)];
    both(noCrossing(everything('arrow', 2)), board(...corners, arrow('x', 'A', 'B'), arrow('y', 'C', 'D')), false, 'an X');
    both(noCrossing(everything('arrow', 2)), board(...corners, arrow('x', 'A', 'D'), arrow('y', 'C', 'B')), true, 'parallel');
    both(noCrossing(everything('arrow', 2)), board(dot('A', 0, 0), dot('D', 20, 0), dot('E', 10, 10), dot('F', 10, 0), arrow('x', 'A', 'D'), arrow('y', 'E', 'F')), false, 'an end on the other segment (T)');
    both(noCrossing(everything('arrow', 2)), board(dot('A', 0, 0), dot('D', 20, 0), dot('G', 10, 0), dot('H', 30, 0), arrow('x', 'A', 'D'), arrow('y', 'G', 'H')), false, 'collinear overlap');
    both(noCrossing(everything('arrow', 2)), board(dot('A', 0, 0), dot('D', 10, 0), dot('G', 20, 0), dot('H', 30, 0), arrow('x', 'A', 'D'), arrow('y', 'G', 'H')), true, 'collinear, apart');
    both(noCrossing(everything('arrow', 2)), board(...corners, arrow('x', 'A', 'B'), arrow('y', 'A', 'D')), true, 'a shared start at an angle');
    both(noCrossing(everything('arrow', 2)), board(dot('A', 0, 0), dot('D', 20, 0), dot('H', 40, 0), arrow('x', 'A', 'D'), arrow('y', 'A', 'H')), false, 'a shared start, collinear on one side');
    both(noCrossing(everything('arrow', 2)), board(dot('A', 20, 0), dot('D', 0, 0), dot('H', 40, 0), arrow('x', 'A', 'D'), arrow('y', 'H', 'A')), true, 'a shared step, collinear on opposite sides');
    both(noCrossing(everything('arrow', 2)), board(...corners, arrow('x', 'A', 'B'), arrow('y', 'B', 'A')), true, 'both directions between the same two steps');
    both(noCrossing(everything('arrow', 2)), board(...corners, arrow('x', 'A', 'B'), arrow('y', 'A', 'B')), true, 'two arrows A→B');
    both(noCrossing(everything('arrow', 2)), board(...corners, arrow('x', 'A', 'B'), arrow('y', 'C', null)), false, 'a loose end');
    both(noCrossing(everything('arrow', 2)), board(box('S', 10, 10, 2, 2), box('T', 9, 9, 4, 4), arrow('x', 'S', 'S'), arrow('y', 'T', 'T')), false, 'the coincident centres of two different steps');
    both(noCrossing(everything('arrow', 2)), board(dot('E', 0, 0), dot('F', 20, 0), arrow('x', 'E', 'E'), arrow('y', 'F', 'E')), true, 'a self-loop against an incoming arrow');
    both(noCrossing(everything('arrow', 2)), board(dot('E', 0, 0), dot('F', 20, 0), arrow('x', 'E', 'E'), arrow('y', 'E', 'F')), true, 'a self-loop against an outgoing arrow');
    both(noCrossing(everything('arrow', 2)), board(dot('E', 10, 0), dot('G', 0, 0), dot('H', 20, 0), arrow('x', 'E', 'E'), arrow('y', 'G', 'H')), false, 'a self-loop on the way of an arrow between two other steps');
  });
  it('arrowsClearOfSteps: a segment through, onto or grazing a third box fails; its own ends do not count', () => {
    const ends = [dot('A', 0, 0), dot('B', 40, 0)];
    const one = everything('arrow', 1);
    both(clearOfSteps(one, everything('step', 3)), board(...ends, box('O', 20, -5, 4, 10), arrow('x', 'A', 'B')), false, 'through a box');
    both(clearOfSteps(one, everything('step', 3)), board(...ends, box('O', 20, 2, 4, 4), arrow('x', 'A', 'B')), true, 'one pixel below the segment');
    both(clearOfSteps(one, everything('step', 3)), board(...ends, box('O', 20, 1, 4, 4), arrow('x', 'A', 'B')), false, 'along the top edge of a box');
    const diagonal = [dot('A', 0, 0), dot('B', 20, 20)];
    both(clearOfSteps(one, everything('step', 3)), board(...diagonal, box('O', 11, 0, 4, 11), arrow('x', 'A', 'B')), false, 'grazing a corner');
    both(clearOfSteps(one, everything('step', 3)), board(...diagonal, box('O', 12, 0, 4, 11), arrow('x', 'A', 'B')), true, 'beside a corner');
    both(clearOfSteps(one, everything('step', 2)), board(...ends, arrow('x', 'A', 'B')), true, 'its own end steps');
    both(clearOfSteps(one, everything('step', 2)), board(dot('E', 10, 10), box('O', 8, 8, 10, 10), arrow('x', 'E', 'E')), false, 'a self-loop inside another box');
    both(clearOfSteps(one, everything('step', 2)), board(...ends, arrow('x', 'A', null)), false, 'a loose end');
  });
  it('a selection by frame name follows the frame, not its id: re-identified frames select the same steps', () => {
    const lane = (frameId: string): State => board(frame(frameId, 'Lane A'), box('a', 0, 0, 10, 10, frameId), box('b', 20, 0, 10, 10, frameId), box('c', 40, 0, 10, 10, frameId), box('o', 0, 100, 10, 10));
    for (const frameId of ['f1', 'zz-other']) {
      both(evenlySpaced(inFrame('step', 'Lane A', 3), 'x'), lane(frameId), true, `frame ${frameId}`);
      both(aligned(inFrame('step', 'Lane A', 3), 'y', 'center'), lane(frameId), true, `frame ${frameId} aligned`);
    }
    // A frame named "all" is a frame, not every object.
    const named = board(frame('f', 'all'), box('a', 0, 0, 10, 10, 'f'), box('b', 20, 0, 10, 10, 'f'), box('o', 0, 100, 10, 10));
    both(aligned(inFrame('step', 'all', 2), 'y', 'center'), named, true, 'frame named all');
    both(aligned(everything('step', 3), 'y', 'center'), named, false, 'every step');
    both(aligned(outside('step', 1 + 1), 'y', 'center'), named, false, 'a count that differs');
  });
  it('a count that differs makes every operator false, also when the geometry would hold', () => {
    const state = board(box('a', 0, 0, 10, 10), box('b', 20, 0, 10, 10), box('c', 40, 0, 10, 10), arrow('x', 'a', 'b'));
    for (const p of [noOverlap(everything('step', 4)), aligned(everything('step', 2), 'y', 'center'), evenlySpaced(everything('step', 4), 'x'), within(everything('step', 2), 0, 0, 100, 100), noCrossing(everything('arrow', 2)), clearOfSteps(everything('arrow', 2), everything('step', 3)), clearOfSteps(everything('arrow', 1), everything('step', 2))]) {
      assert.equal(holds(p, state), false, p.op);
      assert.deepEqual(layoutReasons(p, state).map(reason => reason.kind), ['count'], p.op);
    }
  });
});

describe('layout operators: a second implementation on random small boards', () => {
  const OPS = ['noOverlap', 'aligned', 'evenlySpaced', 'within', 'arrowsNoCrossing', 'arrowsClearOfSteps'] as const;
  const MIN = { noOverlap: 2, aligned: 2, evenlySpaced: 3, within: 1, arrowsNoCrossing: 2, arrowsClearOfSteps: 1 } as const;
  /** A small random board: up to two frames (one named "all"), 2–7 steps on a 24 × 24 grid (some in a
   * row, so equal gaps occur), up to 6 arrows (some loose, some self-loops), some tombstones. */
  function randomBoard(seed: number): State {
    const r = createRandom(seed);
    const objects: WorldObject[] = [];
    const frames = ['Lane', 'all'].slice(0, r.int(0, 2)).map((name, index) => frame(`f${index}`, name, r.chance(0.1)));
    objects.push(...frames);
    const live = frames.filter(f => !f.deleted).map(f => f.id);
    const count = r.int(2, 7), row = r.chance(0.45);
    let cursor = r.int(0, 4);
    for (let i = 0; i < count; i++) {
      const width = r.int(1, 6), height = r.int(1, 6);
      const x = row ? cursor : r.int(0, 24), y = row ? r.int(0, 2) : r.int(0, 24);
      cursor += width + r.pick([0, 2, 2, 2, 3, 4]);
      objects.push(box(`s${i}`, x, y, width, height, live.length && r.chance(0.6) ? r.pick(live) : null, { deleted: r.chance(0.08) }));
    }
    const steps = objects.filter((o): o is StepV2 => o.type === 'step' && !o.deleted).map(o => o.id);
    for (let i = 0, n = r.int(0, 6); i < n; i++) objects.push(arrow(`a${i}`, steps.length && !r.chance(0.08) ? r.pick(steps) : null, steps.length && !r.chance(0.08) ? r.pick(steps) : null));
    return board(...objects);
  }
  function randomSelection(r: ReturnType<typeof createRandom>, state: State, type: 'step' | 'arrow', min: number): Selection {
    const kind = r.pick(['all', 'all', 'outside', 'frame'] as const), name = r.pick(['Lane', 'all']);
    const make = (count: number): Selection => kind === 'all' ? everything(type, count) : kind === 'outside' ? outside(type, count) : inFrame(type, name, count);
    // The actual number selected (a plain filter written here), sometimes one more or fewer.
    const actual = Object.values(state.objects).filter(o => !o.deleted && o.type === type && (kind === 'all' ? true : kind === 'outside' ? o.frameId === null
      : o.frameId !== null && state.objects[o.frameId!]?.type === 'frame' && !state.objects[o.frameId!]!.deleted && (state.objects[o.frameId!] as { name: string }).name === name)).length;
    const count = r.chance(0.85) ? actual : actual + r.pick([-1, 1]);
    return make(Math.max(min, count));
  }
  function randomClause(seed: number, state: State): LayoutPredicate {
    const r = createRandom(seed ^ 0x5bd1e995);
    const op = r.pick(OPS), tolerance = r.pick([0, 0, 1, 2, 3, 5]);
    if (op === 'arrowsClearOfSteps') return clearOfSteps(randomSelection(r, state, 'arrow', 1), randomSelection(r, state, 'step', 1));
    if (op === 'arrowsNoCrossing') return noCrossing(randomSelection(r, state, 'arrow', 2));
    const select = randomSelection(r, state, 'step', MIN[op]);
    switch (op) {
      case 'noOverlap': return noOverlap(select, r.pick([0, 0, 1, 2, 4]));
      case 'aligned': return aligned(select, r.pick(['x', 'y'] as const), r.pick(['start', 'center', 'end'] as const), tolerance);
      case 'evenlySpaced': return evenlySpaced(select, r.pick(['x', 'y'] as const), tolerance);
      default: return within(select, r.int(-2, 6), r.int(-2, 6), r.int(8, 30), r.int(8, 30));
    }
  }
  /** The same board under other ids (a seeded permutation), with every reference renamed. */
  function permuted(state: State, seed: number): State {
    const ids = Object.keys(state.objects), shuffled = createRandom(seed).shuffle(ids);
    const rename = new Map(ids.map((id, index) => [id, `p${shuffled[index]}x${index}`]));
    const out: State = { objects: {} };
    for (const o of Object.values(state.objects)) {
      const copy = structuredClone(o) as WorldObject & { frameId?: string | null; from?: string | null; to?: string | null };
      copy.id = rename.get(o.id)!;
      if (copy.type !== 'frame') copy.frameId = copy.frameId === null || copy.frameId === undefined ? null : rename.get(copy.frameId)!;
      if (copy.type === 'arrow') { copy.from = copy.from === null ? null : rename.get(copy.from)!; copy.to = copy.to === null ? null : rename.get(copy.to)!; }
      out.objects[copy.id] = copy as WorldObject;
    }
    return out;
  }

  it('agrees with the product on 12,000 boards, and neither the verdict nor the charge changes when the ids are permuted', () => {
    const tally = new Map<string, { true: number; false: number }>();
    for (let seed = 1; seed <= 12_000; seed++) {
      const state = randomBoard(seed), p = randomClause(seed, state);
      const product = evaluate(p, state), other = evaluate(p, permuted(state, seed + 7));
      if (!product.ok || !other.ok) assert.fail(`seed ${seed}: ${!product.ok ? product.error.message : ''}`);
      const expected = oracleHolds(p, state);
      assert.equal(product.value, expected, `seed ${seed}: ${p.op} ${JSON.stringify(p)}`);
      assert.equal(other.value, expected, `seed ${seed}: permuted ids`);
      const objects = Object.keys(state.objects).length;
      assert.equal(product.steps, oracleCost(p, objects), `seed ${seed}: charge`);
      assert.equal(other.steps, product.steps, `seed ${seed}: charge with permuted ids`);
      const counts = tally.get(p.op) ?? { true: 0, false: 0 }; counts[String(expected) as 'true' | 'false']++; tally.set(p.op, counts);
    }
    // Every operator is exercised both ways, many times.
    for (const op of OPS) { const counts = tally.get(op)!; assert.ok(counts.true >= 100 && counts.false >= 100, `${op}: ${JSON.stringify(counts)}`); }
  });

  it('the three selection shapes select exactly what the generic evaluator selects with the same where', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const state = randomBoard(seed), r = createRandom(seed);
      for (const type of ['step', 'arrow'] as const) {
        const selection = randomSelection(r, state, type, 1);
        const ids = Object.values(state.objects).filter(o => o.type === type && !o.deleted).map(o => o.id);
        // Membership by the generic evaluator: exists <type> as: as.id = <id> and where.
        const generic = ids.filter(id => holds({ op: 'exists', type, as: selection.as, where: { op: 'all', args: [eq(field(selection.as, 'id'), literal(id)), selection.where] } }, state));
        const count = generic.length;
        // The operator's own reading of the selection, through the count it requires.
        const atCount: LayoutPredicate = type === 'step' ? within({ ...selection, count: Math.max(1, count) }, -1000, -1000, 4000, 4000) : clearOfSteps({ ...selection, count: Math.max(1, count) }, everything('step', Object.values(state.objects).filter(o => o.type === 'step' && !o.deleted).length));
        const reasons = layoutReasons(atCount, state);
        const counted = reasons.find(reason => reason.kind === 'count');
        if (count === 0) assert.ok(counted && counted.kind === 'count' && counted.found === 0, `seed ${seed} ${type}: empty selection`);
        else assert.equal(counted, undefined, `seed ${seed} ${type}: the selection holds exactly the ${count} objects the generic evaluator selects`);
      }
    }
  });
});

describe('layout operators: cost by formula', () => {
  const state = board(frame('f', 'Lane'), box('a', 0, 0, 10, 10, 'f'), box('b', 20, 0, 10, 10, 'f'), box('c', 40, 0, 10, 10), box('d', 60, 0, 10, 10), arrow('x', 'a', 'b'), arrow('y', 'c', 'd'), { ...box('z', 0, 0, 1, 1), deleted: true });
  it('charges exactly the formula, hand-computed, whatever the board holds; the empty board gives a small whole number', () => {
    // N = 8 objects (one tombstone included).
    const steps = (p: LayoutPredicate, s: State = state): number => { const r = evaluate(p, s); if (!r.ok) assert.fail(r.error.message); return r.steps; };
    assert.equal(steps(noOverlap(everything('step', 4))), 1 + 8 + 4 + 6);
    assert.equal(steps(noOverlap(inFrame('step', 'Lane', 2))), 1 + 16 + 2 + 1);
    assert.equal(steps(aligned(outside('step', 2), 'y', 'center')), 1 + 8 + 2);
    assert.equal(steps(within(everything('step', 4), 0, 0, 100, 100)), 1 + 8 + 4);
    assert.equal(steps(evenlySpaced(everything('step', 4), 'x')), 1 + 8 + 4 + 4 * 2 + 3);
    assert.equal(steps(evenlySpaced(everything('step', 5), 'x')), 1 + 8 + 5 + 5 * 3 + 4, 'a count that differs costs the same formula');
    assert.equal(steps(noCrossing(everything('arrow', 2))), 1 + 8 + 2 + 1);
    assert.equal(steps(clearOfSteps(everything('arrow', 2), inFrame('step', 'Lane', 3))), 1 + 8 + 16 + 2 + 3 + 6);
    // The empty board: N = 0, so only the counts remain; 12 for evenlySpaced with count 3 (PADR-0047).
    const empty: State = { objects: {} };
    assert.equal(steps(evenlySpaced(everything('step', 3), 'x'), empty), 12);
    for (const p of [noOverlap(everything('step', 2)), aligned(everything('step', 2), 'x', 'start'), within(everything('step', 1), 0, 0, 1, 1), noCrossing(everything('arrow', 2)), clearOfSteps(everything('arrow', 1), everything('step', 1)), evenlySpaced(everything('step', 256), 'y')]) {
      const value = steps(p, empty);
      assert.ok(Number.isSafeInteger(value) && value > 0, `${p.op}: ${value}`);
      assert.equal(value, oracleCost(p, 0), p.op);
      assert.equal(holds(p, empty), false, `${p.op}: nothing to select`);
    }
  });
  it('charges the same on every placement of the same objects', () => {
    const p = noOverlap(everything('step', 4), 10);
    const moved = structuredClone(state);
    for (const [index, id] of ['a', 'b', 'c', 'd'].entries()) Object.assign(moved.objects[id]!, { x: 5 * index, y: 3 * index });
    const before = evaluate(p, state), after = evaluate(p, moved);
    assert.ok(before.ok && after.ok);
    assert.notEqual(before.value, after.value, 'the placements differ in verdict');
    assert.equal(before.steps, after.steps);
  });
  it('the meter refuses a charge that is not a non-negative whole number (NaN, negative, fractional)', () => {
    const meter = createMeter(100);
    meter.tick(5);
    for (const charge of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, 2 ** 53]) {
      assert.throws(() => meter.tick(charge), (error: unknown) => (error as { code?: string }).code === 'checker_invalid', String(charge));
    }
    assert.equal(meter.steps, 5, 'a refused charge changes nothing');
    assert.throws(() => meter.tick(96), (error: unknown) => (error as { code?: string }).code === 'checker_fuel_exhausted');
  });
  it('a clause that needs more than the fuel is exhausted before it looks at the board', () => {
    const result = evaluate(noOverlap(everything('step', 4)), state, { fuel: 18 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'checker_fuel_exhausted');
    assert.equal(evaluate(noOverlap(everything('step', 4)), state, { fuel: 19 }).ok, true);
  });
});

describe('layout operators: guards', () => {
  it('a box edge outside ±1,000,000 is checker_invalid, never a verdict', () => {
    const far = board(box('a', 999_990, 0, 10, 10), box('b', 999_991, 20, 10, 10));
    const result = evaluate(noOverlap(everything('step', 2)), far);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'checker_invalid');
    assert.equal(holds(noOverlap(everything('step', 2)), board(box('a', 999_980, 0, 10, 10), box('b', 999_990, 20, 10, 10))), true, 'an edge at exactly 1,000,000');
    // An arrow's end steps are read too.
    const arrows = board(box('a', 0, 0, 10, 10), box('b', -1_000_001, 0, 10, 10), box('c', 0, 50, 10, 10), arrow('x', 'a', 'b'), arrow('y', 'a', 'c'));
    const crossing = evaluate(noCrossing(everything('arrow', 2)), arrows);
    assert.equal(crossing.ok, false);
  });
  it('the evaluator refuses a layout clause inside a quantifier, any, count or a double negation, and another selection shape', () => {
    const clause = noOverlap(everything('step', 2));
    const state = board(box('a', 0, 0, 10, 10), box('b', 20, 0, 10, 10));
    const misplaced: Predicate[] = [
      { op: 'exists', type: 'step', as: 'q', where: clause }, { op: 'any', args: [clause] },
      { op: 'eq', left: { kind: 'count', type: 'step', as: 'q', where: clause }, right: literal(1) },
      { op: 'not', arg: { op: 'not', arg: clause } }, { op: 'all', args: [{ op: 'all', args: [clause] }] }, { op: 'all', args: [{ op: 'not', arg: clause }] },
      noOverlap({ type: 'step', as: 's', where: eq(field('s', 'label'), literal('a')), count: 2 }),
      noOverlap({ type: 'step', as: 's', where: eq(literal(null), field('s', 'frameId')), count: 2 }),
    ];
    for (const p of misplaced) {
      const result = evaluate(p, state);
      assert.equal(result.ok, false, JSON.stringify(p));
      if (!result.ok) assert.equal(result.error.code, 'checker_invalid');
    }
    for (const p of [clause, { op: 'all', args: [clause, clause] }, { op: 'not', arg: clause }] as Predicate[]) assert.equal(evaluate(p, state).ok, true, JSON.stringify(p));
  });
});

describe('layout operators in worlds', () => {
  const task = (goal: Predicate, extra: Record<string, unknown> = {}) => ({ id: 't', title: { en: 'T', de: 'T' }, prompt: { en: 'P', de: 'P' }, hints: [{ en: 'H', de: 'H' }], errorClasses: [], goal, ...extra });
  const start = board(box('a', 0, 0, 10, 10), box('b', 5, 0, 10, 10));
  const world = (goal: Predicate, extra: Record<string, unknown> = {}, taskExtra: Record<string, unknown> = {}) => ({ schema: 'practonaut.world/2', id: 'layout-fixture', version: '1.0.0', app: { adapterId: 'excalidraw', versionRange: '0.18.1' },
    initialState: start, tasks: [task(goal, taskExtra)], provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' }, ...extra });
  const refused = (raw: unknown, pattern: RegExp, name: string): void => assert.throws(() => validateWorld(raw), (error: unknown) => error instanceof WorldError && error.code === 'E_WORLD_INVALID' && pattern.test(error.message), name);
  const clause = noOverlap(everything('step', 2));

  it('accepts a layout clause as the goal, as a top-level goal clause and as an error class condition (directly or under one not)', () => {
    for (const goal of [clause, { op: 'all', args: [clause, within(everything('step', 2), 0, 0, 100, 100)] }] as Predicate[]) assert.doesNotThrow(() => validateWorld(world(goal)));
    const errorClasses = [{ id: 'o', category: 'accepted_but_violates_goal', when: { op: 'not', arg: clause }, explanation: { en: 'e', de: 'e' } }, { id: 'p', category: 'suboptimal', when: clause, explanation: { en: 'e', de: 'e' } }];
    assert.doesNotThrow(() => validateWorld(world({ op: 'true' }, {}, { errorClasses })));
  });
  it('refuses world/1, wrong positions, nesting, other selection shapes, counts out of range, canvases out of range, offsets with a canvas and out-of-range starts', () => {
    // world/1 keeps its closed vocabulary: the bundled world/1 example with a layout goal is refused there.
    const flow = JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')) as { tasks: Array<{ goal: unknown }> };
    assert.doesNotThrow(() => validateWorld(structuredClone(flow)));
    flow.tasks[0]!.goal = clause;
    refused(flow, /tasks\.0\.goal/, 'world/1');
    refused(world({ op: 'not', arg: clause }), /may stand only/, 'a negated goal clause');
    refused(world({ op: 'any', args: [clause] }), /may stand only/, 'inside any');
    refused(world({ op: 'all', args: [{ op: 'all', args: [clause] }] }), /may stand only/, 'nested all');
    refused(world({ op: 'exists', type: 'step', as: 'q', where: clause }), /may stand only/, 'inside a quantifier');
    refused(world({ op: 'eq', left: { kind: 'count', type: 'step', as: 'q', where: clause }, right: literal(1) }), /may stand only/, 'inside count');
    refused(world({ op: 'true' }, {}, { errorClasses: [{ id: 'o', category: 'suboptimal', when: { op: 'not', arg: { op: 'not', arg: clause } }, explanation: { en: 'e', de: 'e' } }] }), /may stand only/, 'under two nots');
    refused(world({ op: 'true' }, {}, { errorClasses: [{ id: 'o', category: 'suboptimal', when: { op: 'all', args: [clause] }, explanation: { en: 'e', de: 'e' } }] }), /may stand only/, 'an error class all');
    refused(world({ op: 'true' }, { actions: [{ name: 'move_step', preconditions: [clause] }] }), /may stand only/, 'an action precondition');
    refused(world({ op: 'true' }, { rules: [{ id: 'r', action: 'move_step', status: 'confirmed', preconditions: [clause], effects: ['set_position'] }] }), /may stand only/, 'a rule precondition');
    refused(world(noOverlap({ type: 'step', as: 's', where: eq(field('s', 'label'), literal('a')), count: 2 })), /must select everything/, 'a where by label');
    refused(world(noOverlap({ type: 'step', as: 's', where: { op: 'exists', type: 'frame', as: 's', where: { op: 'all', args: [eq(field('s', 'id'), field('s', 'frameId')), eq(field('s', 'name'), literal('x'))] } }, count: 2 })), /must select everything/, 'the frame variable shadows the selection');
    refused(world(noOverlap({ type: 'step', as: 's', where: { op: 'true' }, count: 257 })), /./, 'a count above 256');
    refused(world(evenlySpaced(everything('step', 2), 'x')), /./, 'evenlySpaced with 2');
    refused(world(noOverlap({ type: 'arrow', as: 'a', where: { op: 'true' }, count: 2 })), /./, 'noOverlap over arrows');
    refused(world(within(everything('step', 2), 999_000, 0, 1001, 10)), /judged range/, 'a canvas past 1,000,000');
    refused(world(noOverlap(everything('step', 2), 10_001)), /./, 'a gap above 10,000');
    // Unbound fields inside a selection.
    refused(world(noOverlap({ type: 'step', as: 's', where: eq(field('q', 'frameId'), literal(null)), count: 2 })), /unbound/, 'an unbound variable');
  });
  it('refuses a canvas with a layout offset, allows an offset for the other five operators, and refuses a start outside the range', () => {
    const shifted = { variants: { generator: 'finite-seeded-v1', cases: [{ id: 'a', layoutOffset: { x: 0, y: 0 } }, { id: 'b', layoutOffset: { x: 40, y: 0 } }] } };
    refused(world(within(everything('step', 2), 0, 0, 100, 100), shifted), /layoutOffset/, 'within with an offset');
    refused(world({ op: 'true' }, shifted, { errorClasses: [{ id: 'o', category: 'suboptimal', when: { op: 'not', arg: within(everything('step', 2), 0, 0, 100, 100) }, explanation: { en: 'e', de: 'e' } }] }), /layoutOffset/, 'an error class canvas with an offset');
    assert.doesNotThrow(() => validateWorld(world(clause, shifted)));
    refused(world(clause, { initialState: board(box('a', 0, 0, 10, 10), box('b', 999_995, 0, 10, 10)) }), /outside ±1000000/, 'a start edge past 1,000,000');
    refused(world(clause, {}, { initialState: board(box('a', -1_000_001, 0, 10, 10), box('b', 0, 0, 10, 10)) }), /outside ±1000000/, 'a task start edge past −1,000,000');
    // Without a layout clause the same start is a valid world (the range applies only to layout tasks).
    assert.doesNotThrow(() => validateWorld(world({ op: 'true' }, { initialState: board(box('a', 0, 0, 10, 10), box('b', 999_995, 0, 10, 10)) })));
  });
});

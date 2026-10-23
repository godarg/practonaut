/**
 * The spatial-layout family `challenge-layout` 1.0.0 (PADR-0047 decision 9). The reference is drawn
 * first: one or two lanes, each a frame laid out as one row at equal gaps, lane B under lane A from
 * right to left so the chain passes from lane A's last step straight down into lane B; a branch, a
 * fork and merge or a loop back reach the other lane by construction (straight down or one column
 * across), so no arrow has to pass a step of its own row. The evaluator, not the construction, then
 * decides: a reference that fails any of its clauses is drawn again. The start displaces 3, 5 or 7
 * steps (more at difficulty 3, whose start lays both lanes out as one long row); only clauses the
 * start violates and that have a single-fault near miss are stated, `noOverlap` always.
 *
 * Also here: the family's stress and adversarial boards for the fuel check (decisions 5.4 and 9.7).
 * Deterministic: randomness only from the given generator.
 */
import { layoutReasons } from '../predicate/index.ts';
import { layoutSentence } from '../host/layout-text.ts';
import type { NearMissCandidate, OracleStep } from '../authoring/from-scenes.ts';
import type { Arrow, Frame, LayoutPredicate, Localized, Predicate, Selection, State, StepV2, Value } from '../world/types.ts';
import { STYLES, widthFor, type DArrow, type DFrame, type Diagram, type DStep } from './diagram.ts';
import { ChallengeError } from './errors.ts';
import type { Difficulty, Draft } from './families.ts';
import type { Random } from './random.ts';
import { DOMAINS } from './vocabulary.ts';

/** The family's fixed numbers by difficulty (PADR-0047 decision 9). */
export const LAYOUT = Object.freeze({
  steps: { 1: [6, 9], 2: [9, 12], 3: [12, 16] } as Readonly<Record<Difficulty, readonly [number, number]>>,
  displaced: { 1: 3, 2: 5, 3: 7 } as Readonly<Record<Difficulty, number>>,
  margin: { 1: 120, 2: 60, 3: 20 } as Readonly<Record<Difficulty, number>>,
  gap: { 1: 20, 2: 30, 3: 40 } as Readonly<Record<Difficulty, number>>,
  /** aligned and evenlySpaced tolerance, and the size pin's. */
  tolerance: 4, sizeTolerance: 4, height: 80,
});
/** The planned structure (decision 9.8): topology parts and clause kinds the self-check counts. */
export const LAYOUT_TOPOLOGY_PARTS = ['chain', 'branch', 'fork', 'loop'] as const;
export const LAYOUT_CLAUSE_KINDS = ['O', 'W', 'X', 'C', 'A', 'E'] as const;

const words = (en: string, de: string): Localized => ({ en, de });
const lit = (value: string | number | null): Value => ({ kind: 'literal', value });
const fld = (variable: string, field: string): Value => ({ kind: 'field', variable, field });
const everything = (type: 'step' | 'arrow', count: number): Selection => ({ type, as: type === 'step' ? 's' : 'a', where: { op: 'true' }, count });
/** A lane by its frame's name, in the multiset's own shape (decision 2). */
const lane = (name: string, count: number): Selection => ({ type: 'step', as: 's', count, where: { op: 'exists', type: 'frame', as: 'f', where: { op: 'all', args: [{ op: 'eq', left: fld('f', 'id'), right: fld('s', 'frameId') }, { op: 'eq', left: fld('f', 'name'), right: lit(name) }] } } });

interface Clause { key: string; predicate: LayoutPredicate }
type Positions = Map<string, { x: number; y: number }>;
const positionsOf = (diagram: Diagram): Positions => new Map(diagram.steps.map(step => [step.id, { x: step.x, y: step.y }]));
const placed = (diagram: Diagram, positions: Positions): Diagram => ({ ...structuredClone(diagram), steps: diagram.steps.map(step => ({ ...structuredClone(step), ...positions.get(step.id)! })) });
/** The judged state of a diagram (arrows in the common frame of their ends), for the analysis only. */
function stateOf(diagram: Diagram): State {
  const objects: State['objects'] = {};
  for (const frame of diagram.frames) objects[frame.id] = { id: frame.id, type: 'frame', deleted: false, name: frame.name };
  for (const s of diagram.steps) objects[s.id] = { id: s.id, type: 'step', deleted: false, frameId: s.frame, label: s.label, x: s.x, y: s.y, width: s.width, height: s.height, shape: s.shape, groupId: null, stroke: s.stroke, fill: s.fill };
  const frameOf = (id: string): string | null => (objects[id] as StepV2).frameId;
  for (const a of diagram.arrows) objects[a.id] = { id: a.id, type: 'arrow', deleted: false, frameId: frameOf(a.from) === frameOf(a.to) ? frameOf(a.from) : null, from: a.from, to: a.to };
  return { objects };
}
/** The keys of the clauses a diagram violates, by the shared analysis (one reason is enough). */
const violated = (diagram: Diagram, clauses: readonly Clause[]): string[] => { const state = stateOf(diagram); return clauses.filter(c => layoutReasons(c.predicate, state, 1).length > 0).map(c => c.key); };
/** One move per step whose position differs: the whole action sequence from the start. */
const movesFrom = (start: Positions, target: Positions): OracleStep[] => [...target].filter(([id, at]) => start.get(id)!.x !== at.x || start.get(id)!.y !== at.y)
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([id, at]) => ({ name: 'move_step', params: { id, x: at.x, y: at.y } }));

export function layout(random: Random, difficulty: Difficulty, seed: number): Draft {
  const domain = random.pick(DOMAINS);
  const [low, high] = LAYOUT.steps[difficulty];
  const n = random.int(low, high);
  const lanes: 1 | 2 = difficulty === 1 ? random.pick([1, 2] as const) : 2;
  const pool = [...domain.steps, ...domain.spare];
  const offset = n <= domain.steps.length ? random.int(0, domain.steps.length - n) : 0;
  const labels = n <= domain.steps.length ? domain.steps.slice(offset, offset + n) : pool.slice(0, n);
  // Lane A holds the first k steps, lane B (under it, right to left) the other m = n − k ≥ 3.
  const k = lanes === 1 ? n : random.int(Math.ceil(n / 2), n - 3), m = n - k;
  // Extras on columns where both lanes have a step, never the chain's own column k − 1 and never
  // the end step's column k − m (decision 9.2: their targets are in the other lane).
  const columns = lanes === 1 ? [] : random.shuffle(Array.from({ length: Math.max(0, m - 2) }, (_, i) => k - m + 1 + i));
  const wanted = lanes === 1 ? [] : random.pick([[], ['branch'], ['fork'], ['loop'], ['branch', 'loop'], ['fork', 'loop'], ['branch', 'fork']] as const);
  const extras = wanted.slice(0, columns.length).map((part, index) => ({ part, column: columns[index]! }));
  const topology = ['chain', ...extras.map(extra => extra.part)].join('+');
  const branch = extras.find(extra => extra.part === 'branch');
  // One step size per instance: the longest label's width, height 80.
  const width = Math.max(...labels.map(widthFor), branch ? widthFor(domain.question) : 0), height = LAYOUT.height;
  const rowGap = random.pick([60, 80, 100]), pitch = width + rowGap, band = height + random.pick([140, 180, 220]);
  const x0 = 200, yA = 160, yB = yA + band;
  const names = random.chance(0.5) ? [domain.lanes[0], domain.lanes[1]] : [domain.lanes[1], domain.lanes[0]];
  const frames: DFrame[] = lanes === 1 ? [{ id: 'f1', name: names[0]! }] : [{ id: 'f1', name: names[0]! }, { id: 'f2', name: names[1]! }];
  const palette = random.shuffle(STYLES).slice(0, random.int(1, 3));
  const column = (i: number): number => i < k ? i : k - 1 - (i - k);
  const steps: DStep[] = labels.map((label, i) => {
    const isBranch = branch !== undefined && i === branch.column;
    const shape = i === 0 || i === n - 1 ? 'ellipse' : isBranch ? 'diamond' : 'rectangle';
    const style = shape === 'rectangle' && random.chance(0.4) ? random.pick(palette) : { stroke: 'black' as const, fill: 'none' as const };
    return { id: `s${i + 1}`, label: isBranch ? domain.question : label, shape, ...style, frame: i < k ? 'f1' : 'f2', x: x0 + column(i) * pitch, y: i < k ? yA : yB, width, height };
  });
  const arrows: DArrow[] = [];
  const connect = (from: number, to: number): void => { arrows.push({ id: `a${arrows.length + 1}`, from: `s${from + 1}`, to: `s${to + 1}` }); };
  for (let i = 0; i + 1 < n; i++) connect(i, i + 1);
  // The lane B step under column c.
  const below = (c: number): number => k + (k - 1 - c);
  for (const extra of extras) {
    if (extra.part === 'branch') connect(extra.column, below(extra.column));
    if (extra.part === 'loop') connect(below(extra.column), extra.column);
    if (extra.part === 'fork') { connect(extra.column, below(extra.column)); connect(below(extra.column), extra.column + 1); }
  }
  const goal: Diagram = { steps, arrows, frames };

  const margin = LAYOUT.margin[difficulty], gap = LAYOUT.gap[difficulty], tolerance = LAYOUT.tolerance;
  const right = x0 + (k - 1) * pitch + width, bottom = (lanes === 2 ? yB : yA) + height;
  const canvas = { x: x0 - margin, y: yA - margin, width: right - x0 + 2 * margin, height: bottom - yA + 2 * margin };
  const laneIds = frames.map(frame => steps.filter(step => step.frame === frame.id).map(step => step.id));
  const clauses: Clause[] = [
    { key: 'O', predicate: { op: 'noOverlap', select: everything('step', n), gap } },
    { key: 'W', predicate: { op: 'within', select: everything('step', n), ...canvas } },
    { key: 'X', predicate: { op: 'arrowsNoCrossing', select: everything('arrow', arrows.length) } },
    { key: 'C', predicate: { op: 'arrowsClearOfSteps', select: everything('arrow', arrows.length), steps: everything('step', n) } },
    ...frames.flatMap((frame, index): Clause[] => [
      { key: `A${index + 1}`, predicate: { op: 'aligned', select: lane(frame.name, laneIds[index]!.length), axis: 'y', anchor: 'center', tolerance } },
      { key: `E${index + 1}`, predicate: { op: 'evenlySpaced', select: lane(frame.name, laneIds[index]!.length), axis: 'x', tolerance } },
    ]),
  ];
  const broken = violated(goal, clauses);
  if (broken.length) throw new ChallengeError('layout_reference', `the drawn reference fails ${broken.join(' ')}`);

  // ---- The start: displaced steps ----
  const target = LAYOUT.displaced[difficulty];
  const at = positionsOf(goal), start: Positions = new Map([...at].map(([id, p]) => [id, { ...p }]));
  const moved = new Set<string>(), kept = new Set<string>();
  const move = (id: string, x: number, y: number): void => { start.set(id, { x, y }); moved.add(id); };
  // A step another displacement relies on (the one overlapped) stays where it is.
  const free = (ids: readonly string[]): string[] => ids.filter(id => !moved.has(id) && !kept.has(id));
  const row = (index: number): string[] => [...laneIds[index]!].sort((a, b) => at.get(a)!.x - at.get(b)!.x);
  if (difficulty === 3) {
    // The aspect change: lane B continues lane A's row to the right, unevenly and a little off the row.
    let x = x0 + k * pitch;
    for (const id of laneIds[1]!) { x += random.int(0, 40); move(id, x, yA + random.pick([-1, 1]) * random.int(5, 14)); x += pitch; }
  }
  const lanesToDisplace = difficulty === 3 ? [0] : frames.map((_, index) => index);
  const pickLane = (): number => random.pick(lanesToDisplace);
  const ops: Record<string, () => void> = {
    // Half onto its right neighbour in the row.
    overlap: () => { const r = row(pickLane()); const candidates = free(r.slice(0, -1)); if (!candidates.length) return; const id = random.pick(candidates), next = r[r.indexOf(id) + 1]!; kept.add(next); move(id, at.get(next)!.x - Math.floor(width / 2), at.get(id)!.y + random.int(-10, 10)); },
    outside: () => { const ids = free(laneIds[pickLane()]!); if (!ids.length) return; const id = random.pick(ids); move(id, canvas.x + canvas.width + random.int(20, 120), at.get(id)!.y); },
    swap: () => { if (target - moved.size < 2) return; const r = row(pickLane()), pairs = r.slice(0, -1).map((id, i) => [id, r[i + 1]!] as const).filter(([a, b]) => free([a, b]).length === 2); if (!pairs.length) return; const [a, b] = random.pick(pairs); const pa = at.get(a)!, pb = at.get(b)!; move(a, pb.x, pb.y); move(b, pa.x, pa.y); },
    offRow: () => { const ids = free(laneIds[pickLane()]!); if (!ids.length) return; const id = random.pick(ids); move(id, at.get(id)!.x, at.get(id)!.y + random.pick([-1, 1]) * random.int(20, 60)); },
    uneven: () => { const ids = free(laneIds[pickLane()]!); if (!ids.length) return; const id = random.pick(ids); move(id, at.get(id)!.x + random.pick([-1, 1]) * random.int(12, rowGap - gap - 1), at.get(id)!.y); },
    // A lane B step on an arrow between the lanes, half way down (two lanes, not at difficulty 3).
    inTheWay: () => {
      if (lanes === 1 || difficulty === 3) return;
      const vertical = arrows.filter(a => { const f = goal.steps.find(s => s.id === a.from)!, t = goal.steps.find(s => s.id === a.to)!; return f.frame !== t.frame && f.x === t.x; });
      if (!vertical.length) return;
      const a = random.pick(vertical), ids = free(laneIds[1]!).filter(id => id !== a.from && id !== a.to);
      if (!ids.length) return;
      move(random.pick(ids), at.get(a.from)!.x, Math.floor((yA + yB) / 2));
    },
  };
  ops.overlap!();
  const order = random.shuffle(['outside', 'swap', 'offRow', 'uneven', 'inTheWay']);
  for (const name of order) { if (moved.size >= target) break; ops[name]!(); }
  for (let guard = 0; moved.size < target && guard < 20; guard++) ops[random.pick(['offRow', 'uneven'])]!();
  const startDiagram = placed(goal, start);
  const startViolates = new Set(violated(startDiagram, clauses));
  if (!startViolates.has('O')) throw new ChallengeError('layout_start', 'the start does not violate noOverlap');

  // ---- Single-fault near-miss candidates (decision 9.5): sizes kept, only positions change ----
  const shifted = (ids: readonly string[], dx: number, dy: number, base: Positions = at): Positions => { const out: Positions = new Map([...base].map(([id, p]) => [id, { ...p }])); for (const id of ids) { const p = base.get(id)!; out.set(id, { x: p.x + dx, y: p.y + dy }); } return out; };
  const allIds = steps.map(step => step.id);
  const families: Array<{ positions: Positions }> = [];
  const add = (positions: Positions): void => { families.push({ positions }); };
  // noOverlap only: every column closer than the gap; lane B closer than the gap.
  add(new Map(steps.map(step => [step.id, { x: x0 + Math.round((step.x - x0) / pitch) * (width + gap - 1), y: step.y }])));
  if (lanes === 2) add(shifted(laneIds[1]!, 0, -(band - height - (gap - 1))));
  // within only: the whole drawing past the canvas edge.
  for (const [dx, dy] of [[margin + 1, 0], [0, margin + 1], [-(margin + 1), 0], [0, -(margin + 1)]] as const) add(shifted(allIds, dx, dy));
  // aligned or evenlySpaced only: one step by tolerance + 1 across or along its row.
  for (const id of random.shuffle(allIds)) for (const [dx, dy] of [[0, tolerance + 1], [0, -(tolerance + 1)], [tolerance + 1, 0], [-(tolerance + 1), 0]] as const) add(shifted([id], dx, dy));
  // arrows only: a lane mirrored, a lane moved by whole columns (also closer), two steps of a lane swapped.
  for (const index of frames.map((_, i) => i)) {
    const r = row(index), mirrored: Positions = new Map([...at].map(([id, p]) => [id, { ...p }]));
    r.forEach((id, i) => { mirrored.set(id, { ...at.get(r[r.length - 1 - i]!)! }); });
    add(mirrored);
    if (lanes === 2) for (const closer of [40, 80, 120]) if (band - height - closer >= gap) add(shifted(laneIds[index === 0 ? 1 : 0]!, 0, index === 0 ? -closer : closer, mirrored));
    for (const j of [-3, -2, -1, 1, 2, 3]) add(shifted(laneIds[index]!, j * pitch, 0));
    for (let i = 0; i < r.length; i++) for (let jdx = i + 1; jdx < r.length; jdx++) {
      const swapped: Positions = new Map([...at].map(([id, p]) => [id, { ...p }]));
      swapped.set(r[i]!, { ...at.get(r[jdx]!)! }); swapped.set(r[jdx]!, { ...at.get(r[i]!)! });
      add(swapped);
    }
  }
  // A near miss is single-fault against the goal's clauses (decision 9.5): noOverlap and the clauses the
  // start violates, the only ones that can be stated. A clause the start already holds is never stated,
  // so a candidate that also breaks it is still single-fault.
  const candidates = clauses.filter(clause => clause.key === 'O' || startViolates.has(clause.key));
  const single = new Map<string, Positions>();
  for (const family of families) {
    const keys = violated(placed(goal, family.positions), candidates);
    if (keys.length === 1 && !single.has(keys[0]!)) single.set(keys[0]!, family.positions);
  }
  if (!single.has('O')) throw new ChallengeError('layout_no_overlap_near_miss', 'no single-fault near miss for noOverlap');
  const stated = candidates.filter(clause => single.has(clause.key));

  // ---- The task ----
  const sizePin: Predicate = { op: 'every', type: 'step', as: 'z', where: { op: 'all', args: [
    { op: 'near', left: fld('z', 'width'), right: lit(width), tolerance: LAYOUT.sizeTolerance }, { op: 'near', left: fld('z', 'height'), right: lit(height), tolerance: LAYOUT.sizeTolerance }] } };
  const extraClauses = [
    { predicate: sizePin, text: words(`Every step keeps its size: ${width} × ${height} px (± ${LAYOUT.sizeTolerance} px).`, `Jeder Schritt behält seine Größe: ${width} × ${height} px (± ${LAYOUT.sizeTolerance} px).`) },
    ...stated.map(clause => ({ predicate: clause.predicate as Predicate, text: layoutSentence(clause.predicate) })),
  ];
  const nearMissCandidates: NearMissCandidate[] = stated.map(clause => ({ kind: `layout-${clause.predicate.op}`, steps: movesFrom(start, single.get(clause.key)!) }));
  // Fixed texts name only what the instance states: the layout area with `within`, arrows as straight
  // lines with an arrow clause, tolerances with a lane clause.
  const has = (key: string): boolean => stated.some(clause => clause.key === key || clause.key.startsWith(key));
  const corner = `(${canvas.x}, ${canvas.y})`, far = `(${canvas.x + canvas.width}, ${canvas.y + canvas.height})`;
  const code = stated.map(clause => clause.key === 'O' ? `O${gap}` : clause.key).join(' ');
  const arrowRule = has('X') || has('C');
  const numbers = { en: ['the gap', ...(has('A') || has('E') ? ['the tolerance'] : [])], de: ['den Abstand', ...(has('A') || has('E') ? ['die Toleranz'] : [])] };
  const listed = (parts: string[], and: string): string => parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${and} ${parts.at(-1)}` : parts[0]!;
  return {
    family: 'layout', seed, difficulty, start: startDiagram, goal, expectedLength: moved.size,
    boardText: [...new Set([...steps.map(step => step.label), ...frames.map(frame => frame.name)])],
    title: words('Tidy the layout', 'Das Layout aufräumen'),
    prompt: words(
      `Tidy the layout of this process diagram so that every listed condition holds. Move steps only: every step, arrow and frame stays, and every step keeps its size (${width} × ${height} px).${has('W') ? ` The layout area runs from ${corner} to ${far}.` : ''}${arrowRule ? ' Arrows are judged as straight lines between the centres of the two steps they join, however they are routed or drawn.' : ''} Every arrow must stay attached to a step at both ends. Positions are judged in whole pixels.`,
      `Räume das Layout dieses Ablaufdiagramms auf, sodass jede aufgeführte Bedingung erfüllt ist. Verschiebe nur Schritte: Alle Schritte, Pfeile und Rahmen bleiben, und jeder Schritt behält seine Größe (${width} × ${height} px).${has('W') ? ` Der Layoutbereich reicht von ${corner} bis ${far}.` : ''}${arrowRule ? ' Pfeile zählen als gerade Linien zwischen den Mittelpunkten der beiden Schritte, die sie verbinden, wie auch immer sie geführt oder gezeichnet sind.' : ''} Jeder Pfeil muss an beiden Enden an einem Schritt angebunden bleiben. Positionen werden in ganzen Pixeln beurteilt.`),
    hints: [
      words('Every condition in the goal list must hold at the end. The order of your actions does not matter.', 'Am Ende muss jede Bedingung der Zielliste erfüllt sein. Die Reihenfolge deiner Aktionen ist egal.'),
      words(`The goal has ${n} steps and ${arrows.length} arrows.`, `Das Ziel hat ${n} Schritte und ${arrows.length} Pfeile.`),
      words(`Each condition names its numbers: ${listed([...numbers.en.map(part => `${part} in px`), ...(has('W') ? ['the corners of the layout area'] : [])], 'and')}. A box is a step's position and size, also for an ellipse or a diamond.`,
        `Jede Bedingung nennt ihre Zahlen: ${listed([...numbers.de.map(part => `${part} in px`), ...(has('W') ? ['die Ecken des Layoutbereichs'] : [])], 'und')}. Eine Box ist Position und Größe eines Schritts, auch bei einer Ellipse oder Raute.`),
    ],
    parameters: { difficulty, domain: domain.id, topology, lanes, steps: n, arrows: arrows.length, displaced: moved.size, margin, size: `${width}x${height}`, gap, clauses: code.slice(0, 64) },
    extraClauses, nearMissCandidates,
  };
}

// ---- Stress and adversarial boards (decisions 5.4 and 9.7) ----
const liveSteps = (state: State): StepV2[] => Object.values(state.objects).filter((o): o is StepV2 => o.type === 'step' && !o.deleted).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const arrowIn = (state: State, id: string, from: string | null, to: string | null): Arrow => {
  const frameOf = (end: string | null): string | null => end === null ? null : (state.objects[end] as StepV2).frameId;
  return { id, type: 'arrow', deleted: false, frameId: frameOf(from) === frameOf(to) ? frameOf(from) : null, from, to };
};
/**
 * A layout stress board: the goal plus `steps` new steps and `arrows` new arrows. Steps sit on a free
 * grid right of everything (`grid`) or all at one point (`clustered`, to show the cost does not
 * depend on the placement); arrows join neighbours in the list of new steps followed by goal steps.
 */
export function layoutStressState(goal: State, steps: number, arrows: number, placement: 'grid' | 'clustered' = 'grid'): State {
  const state = structuredClone(goal), existing = liveSteps(goal);
  const right = Math.max(0, ...existing.map(s => s.x + s.width)), top = Math.min(0, ...existing.map(s => s.y));
  const added: string[] = [];
  for (let i = 0; i < steps; i++) {
    const id = `stress-s${i}`;
    const x = placement === 'grid' ? right + 400 + (i % 10) * 250 : 0, y = placement === 'grid' ? top + Math.floor(i / 10) * 150 : 0;
    state.objects[id] = { id, type: 'step', deleted: false, frameId: null, label: `Stress ${i}`, x, y, width: 160, height: 80, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none' };
    added.push(id);
  }
  const nodes = [...added, ...existing.map(s => s.id)];
  for (let i = 0; i < arrows; i++) state.objects[`stress-a${i}`] = arrowIn(state, `stress-a${i}`, nodes[i % nodes.length] ?? null, nodes[(i + 1) % nodes.length] ?? null);
  return state;
}
/** One kind of extra object an agent can add (PADR-0047 decision 5.4): look-alike steps (a goal step's
 * label, shape, colours and size, in a frame of the goal or outside every frame) or arrows between two
 * steps (goal steps, or the first look-alike as an end). `prefix` sorts the new ids before ("0-") or
 * after ("z-") the goal's, since an `exists` stops at its first witness in id order. */
export type Addition =
  | { kind: 'look-alike'; source: string; frame: string | null; count: number; prefix: string }
  | { kind: 'arrow'; from: string; to: string; count: number; prefix: string };
/** The goal with additions, in order; an arrow end "look-alike" names the first look-alike added. */
export function withAdditions(goal: State, additions: readonly Addition[]): State {
  const state = structuredClone(goal);
  let firstLookAlike: string | undefined;
  for (const [index, addition] of additions.entries()) {
    if (addition.kind === 'look-alike') {
      const source = state.objects[addition.source] as StepV2;
      for (let i = 0; i < addition.count; i++) {
        const id = `${addition.prefix}l${index}-${i}`;
        state.objects[id] = { ...structuredClone(source), id, frameId: addition.frame, x: source.x + (i % 10) * 250, y: source.y + 600 + Math.floor(i / 10) * 150 };
        firstLookAlike ??= id;
      }
      continue;
    }
    const end = (id: string): string => id === 'look-alike' ? firstLookAlike ?? '' : id;
    for (let i = 0; i < addition.count; i++) state.objects[`${addition.prefix}a${index}-${i}`] = arrowIn(state, `${addition.prefix}a${index}-${i}`, end(addition.from), end(addition.to));
  }
  return state;
}
/**
 * The adversarial boards of decision 5.4 within `objects` extra objects: new arrows on one pair of goal
 * steps, look-alike steps (a goal step's label, shape, colours, frame and size), half of each, and
 * frames named like a lane each holding one look-alike step. Each comes twice, with ids that sort
 * before and after the goal's, since an `exists` stops at its first witness in id order. The pair and
 * the step are those whose ids sort last, which every `exists` over steps reaches last.
 */
export function adversarialStates(goal: State, objects: number): Array<{ name: string; state: State }> {
  const steps = liveSteps(goal);
  if (steps.length < 2) return [];
  const [second, last] = [steps.at(-2)!, steps.at(-1)!];
  const frames = Object.values(goal.objects).filter((o): o is Frame => o.type === 'frame' && !o.deleted);
  const laneName = (last.frameId !== null ? (goal.objects[last.frameId] as Frame).name : frames[0]?.name) ?? 'Lane';
  const out: Array<{ name: string; state: State }> = [];
  for (const prefix of ['0-', 'z-']) {
    const board = (arrows: number, lookAlikes: number, framed = false): State => {
      const state = structuredClone(goal);
      for (let i = 0; i < lookAlikes; i++) {
        const id = `${prefix}s${i}`;
        let frameId = last.frameId;
        if (framed) { const frame = `${prefix}f${i}`; state.objects[frame] = { id: frame, type: 'frame', deleted: false, name: laneName }; frameId = frame; }
        state.objects[id] = { ...structuredClone(last), id, frameId, x: last.x + (i % 10) * 250, y: last.y + 400 + Math.floor(i / 10) * 150 };
      }
      for (let i = 0; i < arrows; i++) state.objects[`${prefix}a${i}`] = arrowIn(state, `${prefix}a${i}`, last.id, second.id);
      return state;
    };
    const half = Math.floor(objects / 2);
    out.push({ name: `${prefix}arrows`, state: board(objects, 0) }, { name: `${prefix}look-alikes`, state: board(0, objects) }, { name: `${prefix}half`, state: board(objects - half, half) }, { name: `${prefix}lane-frames`, state: board(0, half, true) });
  }
  return out;
}

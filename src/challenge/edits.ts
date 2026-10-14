/**
 * Edits between a start and a goal diagram for the challenge generators (PADR-0040). An edit changes
 * one attribute group of objects no earlier edit changed in that group (a step's label, its style,
 * its frame; an arrow or an added object as a whole), so the edits add up: from-scenes' plan from
 * start to goal needs exactly the sum of their costs, which is checked when an instance is built.
 * A defect is an edit seen from the goal: the start is the goal with the defect applied.
 */
import { FILL_COLORS, SHAPES, STROKE_COLORS, type FillColor, type Localized, type Shape, type StrokeColor } from '../world/types.ts';
import { freeSpot, labelsOf, stepById, widthFor, type DStep, type Diagram } from './diagram.ts';
import type { Random } from './random.ts';
import { similarLabels, typo } from './vocabulary.ts';

type Group = 'label' | 'style' | 'frame';
export interface Pair { start: Diagram; goal: Diagram; touched: Set<string>; serial: number }
export interface Edit {
  kind: string;
  /** Actions from-scenes' plan needs for it. */
  cost: number;
  /** What a prompt may say about it, for families that name their edits (EN/DE). */
  text: Localized;
}
export type EditMaker = (pair: Pair, random: Random) => Edit | undefined;

export const newPair = (goal: Diagram): Pair => ({ start: structuredClone(goal), goal, touched: new Set(), serial: 0 });
const nextId = (pair: Pair, prefix: string): string => `${prefix}${++pair.serial}`;
const q = (label: string): Localized => ({ en: `“${label}”`, de: `„${label}“` });
const words = (en: string, de: string): Localized => ({ en, de });
export const COLOUR: Record<'en' | 'de', Record<string, string>> = { en: { black: 'black', red: 'red', green: 'green', blue: 'blue', orange: 'orange', yellow: 'yellow', none: 'no' }, de: { black: 'schwarz', red: 'rot', green: 'grün', blue: 'blau', orange: 'orange', yellow: 'gelb', none: 'keine' } };
const SHAPE: Record<'en' | 'de', Record<Shape, string>> = { en: { rectangle: 'a rectangle', ellipse: 'an ellipse', diamond: 'a diamond' }, de: { rectangle: 'zu einem Rechteck', ellipse: 'zu einer Ellipse', diamond: 'zu einer Raute' } };

const isFree = (pair: Pair, id: string, group?: Group): boolean => !pair.touched.has(id) && (group === undefined || !pair.touched.has(`${id}:${group}`));
const touch = (pair: Pair, id: string, group?: Group): void => { pair.touched.add(group === undefined ? id : `${id}:${group}`); };
/** Steps present in both diagrams whose `group` no edit changed yet (optionally filtered). */
function freeSteps(pair: Pair, group: Group | undefined, filter: (step: DStep) => boolean = () => true): DStep[] {
  return pair.goal.steps.filter(step => isFree(pair, step.id, group) && pair.start.steps.some(other => other.id === step.id) && filter(step));
}
const freeArrows = (pair: Pair) => pair.goal.arrows.filter(arrow => isFree(pair, arrow.id) && pair.start.arrows.some(other => other.id === arrow.id));
const connected = (diagram: Diagram, a: string, b: string): boolean => diagram.arrows.some(arrow => (arrow.from === a && arrow.to === b) || (arrow.from === b && arrow.to === a));
const takenLabels = (pair: Pair): Set<string> => new Set([...labelsOf(pair.start), ...labelsOf(pair.goal)]);

export const wrongFill: EditMaker = (pair, random) => {
  const candidates = freeSteps(pair, 'style', step => step.shape === 'rectangle');
  if (!candidates.length) return undefined;
  const goal = random.pick(candidates);
  stepById(pair.start, goal.id).fill = random.pick(FILL_COLORS.filter(fill => fill !== goal.fill));
  touch(pair, goal.id, 'style');
  return { kind: 'wrong-fill', cost: 1, text: goal.fill === 'none' ? words(`Remove the fill of ${q(goal.label).en}.`, `Entferne die Füllung von ${q(goal.label).de}.`) : words(`Fill ${q(goal.label).en} ${COLOUR.en[goal.fill]}.`, `Fülle ${q(goal.label).de} ${COLOUR.de[goal.fill]}.`) };
};
export const wrongStroke: EditMaker = (pair, random) => {
  const candidates = freeSteps(pair, 'style');
  if (!candidates.length) return undefined;
  const goal = random.pick(candidates);
  stepById(pair.start, goal.id).stroke = random.pick(STROKE_COLORS.filter(stroke => stroke !== goal.stroke));
  touch(pair, goal.id, 'style');
  return { kind: 'wrong-stroke', cost: 1, text: words(`Give ${q(goal.label).en} a ${COLOUR.en[goal.stroke]} line.`, `Gib ${q(goal.label).de} die Linienfarbe ${COLOUR.de[goal.stroke]}.`) };
};
export const wrongShape: EditMaker = (pair, random) => {
  const candidates = freeSteps(pair, 'style');
  if (!candidates.length) return undefined;
  const goal = random.pick(candidates);
  stepById(pair.start, goal.id).shape = random.pick(SHAPES.filter(shape => shape !== goal.shape));
  touch(pair, goal.id, 'style');
  return { kind: 'wrong-shape', cost: 1, text: words(`Make ${q(goal.label).en} ${SHAPE.en[goal.shape]}.`, `Mache ${q(goal.label).de} ${SHAPE.de[goal.shape]}.`) };
};
/** Shape, line and fill all differ: one set_style fixes them together. */
export const wrongStyle: EditMaker = (pair, random) => {
  const candidates = freeSteps(pair, 'style');
  if (!candidates.length) return undefined;
  const goal = random.pick(candidates), start = stepById(pair.start, goal.id);
  start.shape = random.pick(SHAPES.filter(shape => shape !== goal.shape));
  start.stroke = random.pick(STROKE_COLORS.filter(stroke => stroke !== goal.stroke));
  start.fill = random.pick(FILL_COLORS.filter(fill => fill !== goal.fill));
  touch(pair, goal.id, 'style');
  return { kind: 'wrong-style', cost: 1, text: words(`Make ${q(goal.label).en} ${SHAPE.en[goal.shape]} with a ${COLOUR.en[goal.stroke]} line and ${COLOUR.en[goal.fill]} fill.`, `Mache ${q(goal.label).de} ${SHAPE.de[goal.shape]} mit Linie ${COLOUR.de[goal.stroke]} und Füllung ${COLOUR.de[goal.fill]}.`) };
};
export const labelTypo: EditMaker = (pair, random) => {
  const taken = takenLabels(pair);
  for (const goal of random.shuffle(freeSteps(pair, 'label', step => step.label.length >= 4))) {
    const wrong = typo(goal.label, random);
    if (taken.has(wrong)) continue;
    stepById(pair.start, goal.id).label = wrong;
    touch(pair, goal.id, 'label');
    return { kind: 'label-typo', cost: 1, text: words(`Rename ${q(wrong).en} to ${q(goal.label).en}.`, `Benenne ${q(wrong).de} in ${q(goal.label).de} um.`) };
  }
  return undefined;
};
/** A real rename (a new name from the domain's spare names), for edit tasks. */
export function renameTo(spare: readonly string[]): EditMaker {
  return (pair, random) => {
    const name = random.shuffle(spare).find(value => !takenLabels(pair).has(value));
    const candidates = freeSteps(pair, 'label', step => step.shape === 'rectangle');
    if (!name || !candidates.length) return undefined;
    const goal = random.pick(candidates), old = goal.label;
    goal.label = name; goal.width = Math.max(goal.width, widthFor(name));
    stepById(pair.start, goal.id).width = goal.width;
    // Prompts name steps by their goal label: a renamed step takes no further edit.
    touch(pair, goal.id, 'label'); touch(pair, goal.id, 'style'); touch(pair, goal.id, 'frame');
    return { kind: 'rename', cost: 1, text: words(`Rename ${q(old).en} to ${q(name).en}.`, `Benenne ${q(old).de} in ${q(name).de} um.`) };
  };
}
export const missingArrow: EditMaker = (pair, random) => {
  const candidates = freeArrows(pair);
  if (!candidates.length) return undefined;
  const arrow = random.pick(candidates);
  pair.start.arrows = pair.start.arrows.filter(value => value.id !== arrow.id);
  touch(pair, arrow.id);
  return { kind: 'missing-arrow', cost: 1, text: words(`Connect ${q(stepById(pair.goal, arrow.from).label).en} to ${q(stepById(pair.goal, arrow.to).label).en}.`, `Verbinde ${q(stepById(pair.goal, arrow.from).label).de} mit ${q(stepById(pair.goal, arrow.to).label).de}.`) };
};
export const extraArrow: EditMaker = (pair, random) => {
  const steps = pair.goal.steps.filter(step => pair.start.steps.some(other => other.id === step.id));
  for (let attempt = 0; attempt < 30; attempt++) {
    const from = random.pick(steps), to = random.pick(steps);
    if (from.id === to.id || connected(pair.goal, from.id, to.id) || connected(pair.start, from.id, to.id)) continue;
    const id = nextId(pair, 'x');
    pair.start.arrows.push({ id, from: from.id, to: to.id });
    touch(pair, id);
    return { kind: 'extra-arrow', cost: 1, text: words(`Remove the arrow from ${q(from.label).en} to ${q(to.label).en}.`, `Entferne den Pfeil von ${q(from.label).de} nach ${q(to.label).de}.`) };
  }
  return undefined;
};
/** The start's arrow runs the other way. It gets another id, so the plan removes it and connects
 * anew (two reconnections would pass through a self-loop). */
export const reversedArrow: EditMaker = (pair, random) => {
  // Not an arrow whose reverse the goal also has: the reversed start would then hold that one twice.
  const candidates = freeArrows(pair).filter(arrow => !pair.goal.arrows.some(other => other.from === arrow.to && other.to === arrow.from));
  if (!candidates.length) return undefined;
  const arrow = random.pick(candidates), id = nextId(pair, 'r');
  pair.start.arrows = pair.start.arrows.filter(value => value.id !== arrow.id);
  pair.start.arrows.push({ id, from: arrow.to, to: arrow.from });
  touch(pair, arrow.id); touch(pair, id);
  const [from, to] = [stepById(pair.goal, arrow.from).label, stepById(pair.goal, arrow.to).label];
  return { kind: 'reversed-arrow', cost: 2, text: words(`Make the arrow between ${q(from).en} and ${q(to).en} point to ${q(to).en}.`, `Lass den Pfeil zwischen ${q(from).de} und ${q(to).de} auf ${q(to).de} zeigen.`) };
};
/** An arrow end sits on a look-alike step (a distractor on both boards): one reconnect fixes it. */
export const wrongEnd: EditMaker = (pair, random) => {
  const taken = takenLabels(pair);
  for (const arrow of random.shuffle(freeArrows(pair))) {
    const target = stepById(pair.goal, arrow.to);
    const label = similarLabels(target.label).find(value => !taken.has(value));
    if (!label) continue;
    const id = nextId(pair, 'x'), spot = freeSpot(pair.goal, pair.serial);
    const twin: DStep = { ...structuredClone(target), id, label, x: spot.x, y: spot.y, width: widthFor(label) };
    pair.goal.steps.push(structuredClone(twin)); pair.start.steps.push(twin);
    pair.start.arrows.find(value => value.id === arrow.id)!.to = id;
    touch(pair, arrow.id); touch(pair, id);
    const from = stepById(pair.goal, arrow.from).label;
    return { kind: 'wrong-end', cost: 1, text: words(`Point the arrow from ${q(from).en} at ${q(target.label).en}, not ${q(label).en}.`, `Lass den Pfeil von ${q(from).de} auf ${q(target.label).de} zeigen, nicht auf ${q(label).de}.`) };
  }
  return undefined;
};
/** A stray copy of a step, wired in from its predecessor: delete it and remove its arrow. */
export const duplicateStep: EditMaker = (pair, random) => {
  for (const original of random.shuffle(freeSteps(pair, 'label'))) {
    const into = pair.goal.arrows.find(arrow => arrow.to === original.id && pair.start.arrows.some(other => other.id === arrow.id));
    if (!into) continue;
    const id = nextId(pair, 'd'), arrowId = nextId(pair, 'd'), spot = freeSpot(pair.start, pair.serial);
    pair.start.steps.push({ ...structuredClone(stepById(pair.start, original.id)), id, x: spot.x, y: spot.y });
    pair.start.arrows.push({ id: arrowId, from: into.from, to: id });
    // The copy has the original's label: the original's label stays as it is from here on.
    touch(pair, original.id, 'label'); touch(pair, id); touch(pair, arrowId);
    return { kind: 'duplicate-step', cost: 2, text: words(`Remove the second ${q(original.label).en} and its arrow.`, `Entferne das zweite ${q(original.label).de} und seinen Pfeil.`) };
  }
  return undefined;
};
export const wrongFrame: EditMaker = (pair, random) => {
  if (!pair.goal.frames.length) return undefined;
  const candidates = freeSteps(pair, 'frame');
  if (!candidates.length) return undefined;
  const goal = random.pick(candidates), options = [null, ...pair.goal.frames.map(frame => frame.id)].filter(frame => frame !== goal.frame);
  stepById(pair.start, goal.id).frame = random.pick(options);
  touch(pair, goal.id, 'frame');
  const frame = goal.frame === null ? undefined : pair.goal.frames.find(value => value.id === goal.frame)!;
  return { kind: 'wrong-frame', cost: 1, text: frame ? words(`Put ${q(goal.label).en} into the frame ${q(frame.name).en}.`, `Lege ${q(goal.label).de} in den Rahmen ${q(frame.name).de}.`) : words(`Take ${q(goal.label).en} out of its frame.`, `Nimm ${q(goal.label).de} aus seinem Rahmen.`) };
};
/** Two steps carry each other's labels: two renames fix it. */
export const swappedLabels: EditMaker = (pair, random) => {
  const candidates = freeSteps(pair, 'label', step => step.shape === 'rectangle');
  if (candidates.length < 2) return undefined;
  const [a, b] = random.shuffle(candidates);
  const sa = stepById(pair.start, a!.id), sb = stepById(pair.start, b!.id);
  // Labels only: a different size would make the goal pin the size and the plan resize.
  [sa.label, sb.label] = [b!.label, a!.label];
  touch(pair, a!.id, 'label'); touch(pair, b!.id, 'label');
  return { kind: 'swapped-labels', cost: 2, text: words(`Swap the names of ${q(a!.label).en} and ${q(b!.label).en}.`, `Tausche die Namen von ${q(a!.label).de} und ${q(b!.label).de}.`) };
};
/** A step that should not be there, with one or two arrows: delete it and remove each arrow. */
export const staleStep: EditMaker = (pair, random) => {
  const taken = takenLabels(pair);
  for (const near of random.shuffle(pair.goal.steps)) {
    const label = similarLabels(near.label).find(value => !taken.has(value));
    if (!label) continue;
    const id = nextId(pair, 'o'), spot = freeSpot(pair.start, pair.serial);
    pair.start.steps.push({ ...structuredClone(near), id, label, frame: near.frame, x: spot.x, y: spot.y, width: widthFor(label) });
    const neighbours = random.shuffle(pair.goal.steps.filter(step => step.id !== near.id && pair.start.steps.some(other => other.id === step.id))).slice(0, random.int(1, 2));
    for (const [index, other] of neighbours.entries()) {
      const arrowId = nextId(pair, 'o');
      pair.start.arrows.push(index === 0 ? { id: arrowId, from: other.id, to: id } : { id: arrowId, from: id, to: other.id });
      touch(pair, arrowId);
    }
    touch(pair, id);
    return { kind: 'stale-step', cost: 1 + neighbours.length, text: words(`Remove ${q(label).en} and its arrows.`, `Entferne ${q(label).de} und seine Pfeile.`) };
  }
  return undefined;
};
/** A new step the goal has (a spare name, often coloured), wired after an existing step. */
export function newStep(spare: readonly string[]): EditMaker {
  return (pair, random) => {
    const label = random.shuffle(spare).find(value => !takenLabels(pair).has(value));
    const anchors = pair.goal.steps.filter(step => pair.start.steps.some(other => other.id === step.id));
    if (!label || !anchors.length) return undefined;
    const after = random.pick(anchors), id = nextId(pair, 'n'), arrowId = nextId(pair, 'n'), spot = freeSpot(pair.goal, pair.serial);
    const coloured = random.chance(0.6);
    const style: { stroke: StrokeColor; fill: FillColor } = coloured ? random.pick([{ stroke: 'black', fill: 'yellow' }, { stroke: 'blue', fill: 'none' }, { stroke: 'green', fill: 'green' }] as const) : { stroke: 'black', fill: 'none' };
    pair.goal.steps.push({ id, label, shape: 'rectangle', ...style, frame: after.frame, x: spot.x, y: spot.y, width: widthFor(label), height: 80 });
    pair.goal.arrows.push({ id: arrowId, from: after.id, to: id });
    touch(pair, id); touch(pair, arrowId);
    const styleText = coloured ? words(` with a ${COLOUR.en[style.stroke]} line and ${COLOUR.en[style.fill]} fill`, ` mit Linie ${COLOUR.de[style.stroke]} und Füllung ${COLOUR.de[style.fill]}`) : words('', '');
    // The prompt names the anchor by its goal label (an edit may rename it on the start board).
    return { kind: 'new-step', cost: 2 + (coloured ? 1 : 0), text: words(`Add a step ${q(label).en}${styleText.en} and connect ${q(after.label).en} to it.`, `Füge einen Schritt ${q(label).de}${styleText.de} hinzu und verbinde ${q(after.label).de} damit.`) };
  };
}
/** A goal step missing from the start, with its arrows (construction tasks): add, style, connect. */
export const removedStep: EditMaker = (pair, random) => {
  const candidates = pair.goal.steps.filter(step => isFree(pair, step.id) && isFree(pair, step.id, 'label') && isFree(pair, step.id, 'style') && isFree(pair, step.id, 'frame') && pair.start.steps.some(other => other.id === step.id)
    && pair.goal.arrows.filter(arrow => arrow.from === step.id || arrow.to === step.id).every(arrow => isFree(pair, arrow.id) && pair.start.arrows.some(other => other.id === arrow.id)));
  if (candidates.length <= 2) return undefined;
  const step = random.pick(candidates);
  const arrows = pair.goal.arrows.filter(arrow => arrow.from === step.id || arrow.to === step.id);
  pair.start.steps = pair.start.steps.filter(value => value.id !== step.id);
  pair.start.arrows = pair.start.arrows.filter(value => !arrows.some(arrow => arrow.id === value.id));
  touch(pair, step.id); for (const arrow of arrows) touch(pair, arrow.id);
  const coloured = step.stroke !== 'black' || step.fill !== 'none';
  return { kind: 'removed-step', cost: 1 + (coloured ? 1 : 0) + arrows.length, text: words(`Add ${q(step.label).en} with its arrows.`, `Füge ${q(step.label).de} mit seinen Pfeilen hinzu.`) };
};

/** Applies the makers in a shuffled round robin until `count` edits are made (a maker that finds
 * nothing to change is skipped). */
export function applyEdits(pair: Pair, random: Random, makers: readonly EditMaker[], count: number): Edit[] {
  const edits: Edit[] = [], order = random.shuffle(makers);
  for (let attempt = 0; edits.length < count && attempt < count * 10; attempt++) {
    const edit = order[attempt % order.length]!(pair, random);
    if (edit) edits.push(edit);
  }
  return edits;
}
/** Applies makers until the summed cost reaches a target drawn from [low, high], never passing `high`. */
export function applyEditsUpTo(pair: Pair, random: Random, makers: readonly EditMaker[], low: number, high: number): Edit[] {
  const edits: Edit[] = [], order = random.shuffle(makers), target = random.int(low, high);
  let cost = 0;
  for (let attempt = 0; cost < target && attempt < high * 12; attempt++) {
    const snapshot = structuredClone({ start: pair.start, goal: pair.goal, touched: [...pair.touched], serial: pair.serial });
    const edit = order[attempt % order.length]!(pair, random);
    if (!edit) continue;
    if (cost + edit.cost > high) { pair.start = snapshot.start; pair.goal = snapshot.goal; pair.touched = new Set(snapshot.touched); pair.serial = snapshot.serial; continue; }
    edits.push(edit); cost += edit.cost;
  }
  return edits;
}

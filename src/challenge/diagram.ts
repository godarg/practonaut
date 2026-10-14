/**
 * A small editable diagram model for the challenge generators and its world/2 state (PADR-0040).
 * Ids are stable: an object kept from start to goal keeps its id, so from-scenes' plan is the
 * object-wise difference. Positions follow a grid; they are never part of a generated goal.
 */
import type { FillColor, Shape, State, StrokeColor } from '../world/types.ts';
import type { Random } from './random.ts';
import type { Domain } from './vocabulary.ts';

export interface DStep { id: string; label: string; shape: Shape; stroke: StrokeColor; fill: FillColor; frame: string | null; x: number; y: number; width: number; height: number }
export interface DArrow { id: string; from: string; to: string }
export interface DFrame { id: string; name: string }
export interface Diagram { steps: DStep[]; arrows: DArrow[]; frames: DFrame[] }

export const STYLES: ReadonlyArray<{ stroke: StrokeColor; fill: FillColor }> = Object.freeze([
  { stroke: 'black', fill: 'yellow' }, { stroke: 'blue', fill: 'none' }, { stroke: 'black', fill: 'blue' }, { stroke: 'green', fill: 'green' },
  { stroke: 'red', fill: 'none' }, { stroke: 'orange', fill: 'yellow' }, { stroke: 'black', fill: 'red' }, { stroke: 'blue', fill: 'blue' },
]);

export const cloneDiagram = (diagram: Diagram): Diagram => structuredClone(diagram);
export const stepById = (diagram: Diagram, id: string): DStep => { const step = diagram.steps.find(value => value.id === id); if (!step) throw new Error(`no step ${id}`); return step; };
export const labelsOf = (diagram: Diagram): Set<string> => new Set(diagram.steps.map(step => step.label));
/** A width that fits the label on one or two lines of the bundled font. */
export const widthFor = (label: string): number => Math.min(420, Math.max(180, 40 + label.length * 9));

/** The world/2 state: arrows belong to the common frame of their ends (none when the ends differ). */
export function toState(diagram: Diagram): State {
  const objects: State['objects'] = {};
  for (const frame of diagram.frames) objects[frame.id] = { id: frame.id, type: 'frame', deleted: false, name: frame.name };
  for (const step of diagram.steps) objects[step.id] = { id: step.id, type: 'step', deleted: false, frameId: step.frame, label: step.label, x: step.x, y: step.y, width: step.width, height: step.height, shape: step.shape, groupId: null, stroke: step.stroke, fill: step.fill };
  for (const arrow of diagram.arrows) {
    const ends = [stepById(diagram, arrow.from).frame, stepById(diagram, arrow.to).frame];
    objects[arrow.id] = { id: arrow.id, type: 'arrow', deleted: false, frameId: ends[0] === ends[1] ? ends[0]! : null, from: arrow.from, to: arrow.to };
  }
  return { objects };
}

export type Topology = 'chain' | 'branch' | 'fork' | 'lanes';
export interface ProcessOptions { domain: Domain; steps: number; topology: Topology; frames: 0 | 1 | 2; styled: number }

/** A process diagram: `steps` named steps from the domain in order, wired by the topology, start and
 * end as ellipses, a decision as a diamond, some steps coloured by category, optional lanes. */
export function buildProcess(random: Random, options: ProcessOptions): Diagram {
  const { domain } = options;
  const count = Math.max(3, Math.min(options.steps, domain.steps.length));
  const offset = random.int(0, domain.steps.length - count);
  const labels = domain.steps.slice(offset, offset + count);
  const steps: DStep[] = labels.map((label, index) => ({ id: `s${index + 1}`, label, shape: 'rectangle', stroke: 'black', fill: 'none', frame: null, x: 60 + index * 240, y: 60, width: widthFor(label), height: 80 }));
  steps[0]!.shape = 'ellipse'; steps.at(-1)!.shape = 'ellipse';
  const arrows: DArrow[] = [];
  const connect = (from: DStep, to: DStep): void => { arrows.push({ id: `a${arrows.length + 1}`, from: from.id, to: to.id }); };
  if (options.topology === 'branch' && count >= 5) {
    // A decision after step k: "yes" runs through k+1, "no" skips straight to k+2.
    const k = random.int(1, count - 4);
    const question: DStep = { id: `s${count + 1}`, label: domain.question, shape: 'diamond', stroke: 'black', fill: 'none', frame: null, x: 0, y: 0, width: widthFor(domain.question), height: 100 };
    steps.splice(k + 1, 0, question);
    for (let i = 0; i + 1 < steps.length; i++) connect(steps[i]!, steps[i + 1]!);
    connect(question, steps[k + 3]!);
    steps[k + 2]!.y = 230;
  } else if (options.topology === 'fork' && count >= 5) {
    // Two steps in parallel after step k, joined again at k+3.
    const k = random.int(0, count - 4);
    for (let i = 0; i + 1 < steps.length; i++) if (i !== k + 1) connect(steps[i]!, steps[i + 1]!);
    connect(steps[k]!, steps[k + 2]!);
    connect(steps[k + 1]!, steps[k + 3]!);
    steps[k + 2]!.y = 230;
  } else for (let i = 0; i + 1 < steps.length; i++) connect(steps[i]!, steps[i + 1]!);
  // Grid columns follow the order on the board; a step moved to the second row keeps its column.
  steps.forEach((step, index) => { step.x = 60 + index * 240; });
  const frames: DFrame[] = [];
  if (options.frames >= 1) {
    const names = random.chance(0.5) ? [domain.lanes[0], domain.lanes[1]] : [domain.lanes[1], domain.lanes[0]];
    frames.push({ id: 'f1', name: names[0]! });
    if (options.frames === 2) frames.push({ id: 'f2', name: names[1]! });
    // Lanes: a contiguous block of steps per frame; with one frame only the first block is framed.
    const cut = random.int(Math.floor(steps.length / 3), Math.ceil((2 * steps.length) / 3));
    steps.forEach((step, index) => {
      step.frame = index < cut ? 'f1' : options.frames === 2 ? 'f2' : null;
      if (options.topology === 'lanes' && index >= cut) step.y += 340;
    });
  }
  // Categories: some steps get a palette style (start, end and decisions keep the default style).
  const palette = random.shuffle(STYLES).slice(0, random.int(1, 3));
  for (const step of steps) if (step.shape === 'rectangle' && random.chance(options.styled)) Object.assign(step, random.pick(palette));
  return { steps, arrows, frames };
}

/** A free grid cell below the diagram for an extra step. */
export function freeSpot(diagram: Diagram, index: number): { x: number; y: number } {
  const bottom = Math.max(60, ...diagram.steps.map(step => step.y + step.height));
  return { x: 60 + (index % 5) * 260, y: bottom + 120 + Math.floor(index / 5) * 150 };
}

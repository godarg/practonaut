// A hand-written world/2 layout task (PADR-0047) for host, MCP, Player and report tests: two framed
// lanes of three steps (an ellipse and a diamond among them), five arrows and a self-loop, and the
// layout clauses of the family over them. The reference arrangement is drawn by hand: lane A in a row
// at y 100, lane B at y 300, 60 px gaps, inside the canvas (40, 40)–(760, 440). Never produced by the
// code under test.
import { validateWorld } from '../../src/world/schema.ts';
import type { Predicate, State, World } from '../../src/world/types.ts';
import { aligned, arrow, board, box, clearOfSteps, evenlySpaced, everything, frame, inFrame, noCrossing, noOverlap, within } from './layout-board.ts';

const lanes = (positions: Record<string, [number, number]>): State => board(
  frame('fA', 'Lane A'), frame('fB', 'Lane B'),
  box('a1', ...positions.a1!, 160, 80, 'fA', { label: 'Start', shape: 'ellipse' }),
  box('a2', ...positions.a2!, 160, 80, 'fA', { label: 'Check' }),
  box('a3', ...positions.a3!, 160, 80, 'fA', { label: 'Decide', shape: 'diamond' }),
  box('b1', ...positions.b1!, 160, 80, 'fB', { label: 'Pack' }),
  box('b2', ...positions.b2!, 160, 80, 'fB', { label: 'Ship' }),
  box('b3', ...positions.b3!, 160, 80, 'fB', { label: 'Done', shape: 'ellipse' }),
  arrow('e1', 'a1', 'a2'), arrow('e2', 'a2', 'a3'), arrow('e3', 'a3', 'b1'), arrow('e4', 'b1', 'b2'), arrow('e5', 'b2', 'b3'), arrow('e6', 'b2', 'b2'),
);
/** The reference arrangement: every layout clause holds. */
export const LAYOUT_GOAL_STATE = lanes({ a1: [100, 100], a2: [320, 100], a3: [540, 100], b1: [100, 300], b2: [320, 300], b3: [540, 300] });
/** The start: a2 sits on a3, b3 is outside the canvas, and Ship (b2) sits half way along the arrow from
 * Decide to Pack, its centre (400, 240) on that segment: lane B is out of row and the arrows meet. Every
 * layout clause of the goal is violated (a stated clause the start satisfies is refused). */
export const LAYOUT_START_STATE = lanes({ a1: [100, 100], a2: [480, 120], a3: [540, 100], b1: [100, 300], b2: [320, 200], b3: [780, 300] });
export const LAYOUT_CLAUSES: Predicate[] = [
  noOverlap(everything('step', 6), 20),
  within(everything('step', 6), 40, 40, 720, 400),
  noCrossing(everything('arrow', 6)),
  clearOfSteps(everything('arrow', 6), everything('step', 6)),
  aligned(inFrame('step', 'Lane A', 3), 'y', 'center', 4),
  evenlySpaced(inFrame('step', 'Lane A', 3), 'x', 4),
  aligned(inFrame('step', 'Lane B', 3), 'y', 'center', 4),
  evenlySpaced(inFrame('step', 'Lane B', 3), 'x', 4),
];
export function layoutWorld(): World {
  return validateWorld({
    schema: 'practonaut.world/2', id: 'layout-fixture', version: '1.0.0', app: { adapterId: 'excalidraw', versionRange: '0.18.1' },
    initialState: LAYOUT_START_STATE,
    tasks: [{ id: 'tidy', title: { en: 'Tidy the layout', de: 'Das Layout aufräumen' }, prompt: { en: 'Tidy the layout so that every condition holds.', de: 'Räume das Layout auf, sodass jede Bedingung erfüllt ist.' },
      goal: { op: 'all', args: LAYOUT_CLAUSES }, hints: [{ en: 'Arrows are judged as straight lines between step centres.', de: 'Pfeile zählen als gerade Linien zwischen den Mittelpunkten.' }], errorClasses: [] }],
    provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' },
  });
}

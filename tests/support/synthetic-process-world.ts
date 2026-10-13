/** Independently authored neutral cycle; CC0 content. */
import type { Predicate, State, World } from '../../src/world/types.ts';

export const CYCLE_LABELS = ['Capture', 'Sort', 'Sketch', 'Link', 'Inspect', 'Polish', 'Store'] as const;
export const CYCLE_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 0]] as const;
export const REVISED_CYCLE_EDGES = [[0, 1], [1, 2], [2, 3], [3, 5], [5, 4], [4, 6], [6, 0]] as const;
export const CYCLE_POSITIONS = [[120, 140], [420, 140], [720, 140], [1020, 140], [1020, 420], [720, 420], [420, 420]] as const;
export const CYCLE_CONTENT_PROVENANCE = {
  author: 'Practonaut synthetic case author',
  created: '2026-10-09',
  license: 'CC0-1.0',
  authorization: 'Maintainer-approved, independently authored synthetic CC0 case',
  contentOrigin: 'Seven neutral labels and a directed seven-node cycle authored for this case',
  resultInheritance: 'No earlier case results or human performance evidence apply to this case',
} as const;

const eq = (variable: string, field: string, value: string | number): Predicate => ({ op: 'eq', left: { kind: 'field', variable, field }, right: { kind: 'literal', value } });
export function cycleGoal(revised = false): Predicate {
  const labels = CYCLE_LABELS.map(label => revised && label === 'Inspect' ? 'Verify' : label);
  const edges = revised ? REVISED_CYCLE_EDGES : CYCLE_EDGES;
  const counts: Predicate[] = ['step', 'arrow'].map(type => ({ op: 'eq', left: { kind: 'count', type: type as 'step' | 'arrow', as: 'item', where: { op: 'true' } }, right: { kind: 'literal', value: 7 } }));
  let goal: Predicate = { op: 'all', args: [...counts, ...edges.map(([from, to]): Predicate => ({ op: 'exists', type: 'arrow', as: 'edge', where: { op: 'all', args: [
    { op: 'eq', left: { kind: 'field', variable: 'edge', field: 'from' }, right: { kind: 'field', variable: 's' + from, field: 'id' } },
    { op: 'eq', left: { kind: 'field', variable: 'edge', field: 'to' }, right: { kind: 'field', variable: 's' + to, field: 'id' } }, eq('edge', 'frameId', 'flow-frame'),
  ] } }))] };
  for (let index = labels.length - 1; index >= 0; index--) goal = { op: 'exists', type: 'step', as: 's' + index, where: { op: 'all', args: [eq('s' + index, 'label', labels[index]!), eq('s' + index, 'frameId', 'flow-frame'), goal] } };
  return goal;
}
/** The reference contributes the measured seven-action grammar, not case content. */
export function syntheticProcessWorld(reference: World, revised = false, initialState?: State): World {
  if (reference.rights.license !== 'CC0-1.0' || 'privateSource' in reference.provenance) throw new Error('Synthetic grammar reference must declare CC0 without private source provenance');
  const world = structuredClone(reference);
  world.id = revised ? 'synthetic-cycle-revised' : 'synthetic-cycle';
  world.version = '1.0.0';
  world.initialState = structuredClone(initialState ?? { objects: { 'flow-frame': { id: 'flow-frame', type: 'frame', deleted: false, name: 'Loop practice' } } });
  world.provenance = { authors: [CYCLE_CONTENT_PROVENANCE.author], adapterVersion: reference.provenance.adapterVersion, appVersion: reference.provenance.appVersion, compileToolVersion: reference.provenance.compileToolVersion, recordings: [] };
  world.rights = { license: 'CC0-1.0', assets: [], recordings: [] };
  world.variants = { generator: 'finite-seeded-v1', cases: [{ id: 'cycle-case', labels: { process: 'Loop practice' }, insertPosition: 1, layoutOffset: { x: 0, y: 0 } }] };
  const layout = 'Create Capture, Sort, Sketch, Link at x=120,420,720,1020 and y=140, then Inspect, Polish, Store at x=1020,720,420 and y=420. Use width=180, height=100, fontFamily=3, frameId=flow-frame.';
  world.tasks = [{ id: 'S1', title: { en: revised ? 'Revise the loop' : 'Build the loop', de: revised ? 'Kreislauf ändern' : 'Kreislauf aufbauen' }, prompt: {
    en: revised ? 'Preserve every existing object. Rename Inspect to Verify. Rebind the ends of Link → Inspect to Polish, Inspect → Polish to Store, and Polish → Store to Verify. The final directed cycle is Capture → Sort → Sketch → Link → Polish → Verify → Store → Capture, with exactly seven steps and seven arrows bound at both ends. Keep the layout.' : 'Build exactly seven steps and seven arrows bound at both ends: Capture → Sort → Sketch → Link → Inspect → Polish → Store → Capture. ' + layout,
    de: revised ? 'Alle Objekte erhalten. Inspect in Verify umbenennen und drei Pfeilziele gemäß englischer Aufgabenbeschreibung umbinden.' : 'Sieben Schritte und sieben angebundene Pfeile als gerichteten Kreislauf gemäß englischer Aufgabenbeschreibung anlegen.',
  }, goal: cycleGoal(revised), hints: [{ en: 'Observe the current object IDs before changing bound endpoints.', de: 'Vor dem Umbinden die vorhandenen Objekt-IDs beobachten.' }], errorClasses: [] }];
  return world;
}

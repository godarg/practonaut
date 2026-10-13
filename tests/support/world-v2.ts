/** Hand-written world/2 fixtures for unit tests. Never produced by the code under test. */
import type { State, StepV2, Task, World } from '../../src/world/types.ts';
import { validateWorld } from '../../src/world/schema.ts';

export function stepV2(id: string, label: string, x: number, y: number, extra: Partial<StepV2> = {}): StepV2 {
  return { id, type: 'step', deleted: false, frameId: null, label, x, y, width: 160, height: 80, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none', ...extra };
}
export const v2Start: State = { objects: {
  f: { id: 'f', type: 'frame', deleted: false, name: 'Intake' },
  a: stepV2('a', 'Receive', 100, 100, { frameId: 'f' }),
  b: stepV2('b', 'Check', 400, 100, { frameId: 'f' }),
  c: stepV2('c', 'Ship', 700, 300),
  ab: { id: 'ab', type: 'arrow', deleted: false, frameId: 'f', from: 'a', to: 'b' },
} };
const literal = (value: string | number | null) => ({ kind: 'literal' as const, value });
const field = (variable: string, name: string) => ({ kind: 'field' as const, variable, field: name });
export const v2Task = (overrides: Partial<Task> = {}): Task => ({
  id: 'T1', title: { en: 'Connect', de: 'Verbinden' }, prompt: { en: 'Connect Check to Ship.', de: 'Verbinde Prüfen mit Versand.' },
  goal: { op: 'all', args: [
    { op: 'eq', left: { kind: 'count', type: 'arrow', as: 'n', where: { op: 'true' } }, right: literal(2) },
    { op: 'exists', type: 'arrow', as: 'e', where: { op: 'all', args: [
      { op: 'exists', type: 'step', as: 's', where: { op: 'all', args: [{ op: 'eq', left: field('s', 'id'), right: field('e', 'from') }, { op: 'eq', left: field('s', 'label'), right: literal('Check') }] } },
      { op: 'exists', type: 'step', as: 't', where: { op: 'all', args: [{ op: 'eq', left: field('t', 'id'), right: field('e', 'to') }, { op: 'eq', left: field('t', 'label'), right: literal('Ship') }] } },
    ] } },
  ] },
  hints: [{ en: 'Use connect.', de: 'Nutze Verbinden.' }], errorClasses: [], ...overrides,
});
export function v2World(extra: Record<string, unknown> = {}): World {
  return validateWorld({ schema: 'practonaut.world/2', id: 'v2-fixture', version: '1.0.0', app: { adapterId: 'excalidraw', versionRange: '0.18.1' },
    initialState: v2Start, tasks: [v2Task()], provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' }, ...extra });
}

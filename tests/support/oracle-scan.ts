// Hidden references that must never reach the Player (architecture §10, "hidden data stays hidden"):
// the reference solution and the near misses of every library task, which bench's oracle agent
// replays, and the bundled example's held-out task. A scan is a plain substring search over every
// reply body, event and asset the Player received, so it cannot be fooled by how the Player
// renders them.
//
// A reference leaks as JSON: the step list itself (`[{"name":…}]`), with its labels as tokens or
// resolved for a variant. A single step is a marker only when it carries task-specific text (a
// label): a bare step such as `{"name":"delete_step","params":{"id":"b"}}` is also an ordinary
// action on other boards (the example's own task T3 deletes step b), so it is found through its
// step list instead.
import { readFileSync } from 'node:fs';

export interface Marker { source: string; text: string }
export interface Finding { where: string; source: string }
interface Step { name: string; params: Record<string, unknown> }
interface Oracle { taskId: string; steps: Step[]; nearMisses: Array<{ id: string; steps: Step[] }> }

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
/** Every string in `value` with `{{token}}` replaced from `labels` (written here, not the product's substitution). */
function resolved<T>(value: T, labels: Record<string, string>): T {
  if (typeof value === 'string') return value.replace(/\{\{([^{}]+)\}\}/g, (whole, token: string) => labels[token] ?? whole) as T;
  if (Array.isArray(value)) return value.map(item => resolved(item, labels)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolved(item, labels)])) as T;
  return value;
}

/** Markers for the library oracle of every task and the example's held-out task. */
export function hiddenReferenceMarkers(): Marker[] {
  const library = read('tasks/excalidraw/library.json') as { tasks: Array<{ id: string; oracle: Oracle }> };
  const world = read('tasks/excalidraw/world/world.json') as { variants: { cases: Array<{ labels: Record<string, string> }> } };
  const markers = new Map<string, Marker>();
  const add = (source: string, text: string): void => { if (!markers.has(text)) markers.set(text, { source, text }); };
  for (const { id, oracle } of library.tasks) {
    const lists = [{ name: 'reference', steps: oracle.steps }, ...oracle.nearMisses.map(miss => ({ name: `near miss ${miss.id}`, steps: miss.steps }))];
    for (const list of lists) for (const labels of [{}, ...world.variants.cases.map(variant => variant.labels)]) {
      const steps = resolved(list.steps, labels);
      add(`${id}: ${list.name} steps`, JSON.stringify(steps));
      for (const step of list.steps) if (JSON.stringify(step).includes('{{')) add(`${id}: ${list.name} step ${step.name}`, JSON.stringify(resolved(step, labels)));
    }
    add(`${id}: oracle file`, JSON.stringify({ schema: 'practonaut.task-oracle/1', worldId: 'excalidraw-library', taskId: id }).slice(0, -1));
  }
  const checker = read('examples/worlds/flow-diagram.check/checker.json') as { heldOutTasks: Array<{ id: string; title: Record<string, string>; prompt: Record<string, string> }> };
  for (const task of checker.heldOutTasks) for (const text of [...Object.values(task.title), ...Object.values(task.prompt)]) add(`example held-out ${task.id}`, JSON.stringify(text).slice(1, -1));
  add('task oracle schema', '"practonaut.task-oracle/1"');
  add('checker bundle schema', '"practonaut.checker/1"');
  return [...markers.values()];
}

/** Every marker found in every captured text. */
export function scanForHiddenReferences(captured: Array<{ where: string; text: string }>, markers: Marker[] = hiddenReferenceMarkers()): Finding[] {
  const findings: Finding[] = [];
  for (const item of captured) for (const marker of markers) if (item.text.includes(marker.text)) findings.push({ where: item.where, source: marker.source });
  return findings;
}

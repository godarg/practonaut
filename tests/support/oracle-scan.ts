// Hidden references that must never reach the Player (architecture §10, "hidden data stays hidden"):
// the reference solution and the near misses of every library task, which bench's oracle agent
// replays, and the bundled example's held-out task.
//
// The scan works on actions, not on bytes. Every captured text (a JSON reply, an event stream, an
// asset) is read for action-shaped objects `{name, params}`, however they are wrapped (an oracle
// file, a history entry with `baseStep`, a log entry) and however they are written (indented JSON,
// any key order, a JavaScript object literal). An action matches a reference step when the name is
// the same and the parameters are the same set with the same values; a label is matched as its
// `{{token}}` or as the label of any library variant, and `{ created: k }` stands for any id. Then:
//
// 1. a list of actions that is exactly a reference or near-miss step list is found (the oracle
//    file and the bench sidecar, in any formatting);
// 2. a single action that matches a *distinctive* reference step is found: one with task text (a
//    label), geometry or style. A step that only names ids, such as `delete_step {id: "b"}`, is also
//    an ordinary action on other boards (the example's own task T3 ends with exactly that one), so
//    it alone is not a finding;
// 3. a played reference of two or more steps is found when its steps occur in order among the
//    actions of one captured text, ids or not.
//
// The example's held-out task is found by its title and prompt.
import { readFileSync } from 'node:fs';

export interface Finding { where: string; source: string }
type Value = string | number | boolean | null | { created: number };
export interface StepPattern { name: string; params: Record<string, Value> }
export interface ReferencePattern { task: string; list: string; steps: StepPattern[] }
export interface HiddenReferences { patterns: ReferencePattern[]; labels: Array<Record<string, string>>; texts: Array<{ source: string; text: string }> }
interface Action { name: string; params: Record<string, unknown> }

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
/** Parameter keys that only name objects or an arrow end: a step with nothing else is not distinctive. */
const ID_KEYS = new Set(['id', 'from', 'to', 'target', 'with', 'frameId', 'end']);

export function hiddenReferences(): HiddenReferences {
  const library = read('tasks/excalidraw/library.json') as { tasks: Array<{ id: string; oracle: { steps: StepPattern[]; nearMisses: Array<{ id: string; steps: StepPattern[] }> } }> };
  const world = read('tasks/excalidraw/world/world.json') as { variants: { cases: Array<{ labels: Record<string, string> }> } };
  const patterns = library.tasks.flatMap(({ id, oracle }) => [{ task: id, list: 'reference', steps: oracle.steps }, ...oracle.nearMisses.map(miss => ({ task: id, list: `near miss ${miss.id}`, steps: miss.steps }))]);
  const checker = read('examples/worlds/flow-diagram.check/checker.json') as { heldOutTasks: Array<{ id: string; title: Record<string, string>; prompt: Record<string, string> }> };
  const texts = checker.heldOutTasks.flatMap(task => [...Object.values(task.title), ...Object.values(task.prompt)].map(text => ({ source: `example held-out ${task.id}`, text })));
  texts.push({ source: 'task oracle schema', text: 'practonaut.task-oracle/1' }, { source: 'checker bundle schema', text: 'practonaut.checker/1' });
  return { patterns, labels: world.variants.cases.map(variant => variant.labels), texts };
}

export function distinctive(step: StepPattern): boolean {
  return Object.entries(step.params).some(([key, value]) => !ID_KEYS.has(key) || (typeof value === 'string' && value.includes('{{')) || (value !== null && typeof value !== 'string' && typeof value !== 'object'));
}

function same(value: unknown, pattern: Value, labels: Array<Record<string, string>>): boolean {
  // `{ created: k }`: the id the k-th step created once played, or the reference itself.
  if (pattern !== null && typeof pattern === 'object') return typeof value === 'string' || (!!value && typeof value === 'object' && (value as { created?: unknown }).created === pattern.created);
  if (typeof pattern === 'string' && pattern.includes('{{')) {
    if (value === pattern) return true;
    return labels.some(set => value === pattern.replace(/\{\{([^{}]+)\}\}/g, (whole, token: string) => set[token] ?? whole));
  }
  return value === pattern;
}
export function matchesStep(action: Action, step: StepPattern, labels: Array<Record<string, string>>): boolean {
  if (action.name !== step.name) return false;
  const keys = Object.keys(step.params);
  if (Object.keys(action.params).length !== keys.length) return false;
  return keys.every(key => Object.hasOwn(action.params, key) && same(action.params[key], step.params[key]!, labels));
}

const isAction = (value: unknown): value is Action => !!value && typeof value === 'object' && !Array.isArray(value)
  && typeof (value as Action).name === 'string' && !!(value as Action).params && typeof (value as Action).params === 'object' && !Array.isArray((value as Action).params);

/** JSON documents in a captured text: the whole text, each event's data, and objects embedded in other text. */
function documents(text: string): unknown[] {
  try { return [JSON.parse(text)]; } catch { /* not one JSON document */ }
  const found: unknown[] = [];
  const events = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
  for (const data of events) { try { found.push(JSON.parse(data)); } catch { /* a partial event */ } }
  if (events.length) return found;
  // Anything else (a script, a page): every object around a `name` key, in JSON or object-literal form.
  for (const match of text.matchAll(/["']?name["']?\s*:\s*["']([a-z_]+)["']/g)) {
    let start = match.index!;
    for (let depth = 0; start > 0 && match.index! - start < 400; start--) {
      const char = text[start - 1];
      if (char === '}') depth++;
      else if (char === '{') { if (depth === 0) { start--; break; } depth--; }
    }
    if (text[start] !== '{') continue;
    let end = start, depth = 0, quote = '';
    for (; end < text.length && end - start < 4096; end++) {
      const char = text[end]!;
      if (quote) { if (char === '\\') end++; else if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") quote = char;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) break;
    }
    const literal = text.slice(start, end + 1);
    for (const candidate of [literal, literal.replace(/'/g, '"').replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')]) {
      try { found.push(JSON.parse(candidate)); break; } catch { /* not this form */ }
    }
  }
  return found;
}

/** Every action and every list of actions in a captured text, in document order. */
export function actionsIn(text: string): { actions: Action[]; lists: Action[][] } {
  const actions: Action[] = [], lists: Action[][] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { if (node.length && node.every(isAction)) lists.push(node); node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    if (isAction(node)) actions.push(node);
    for (const child of Object.values(node)) walk(child);
  };
  for (const document of documents(text)) walk(document);
  return { actions, lists };
}

/** In-order occurrence of `steps` among `actions` (not necessarily adjacent). */
function played(actions: Action[], steps: StepPattern[], labels: Array<Record<string, string>>): boolean {
  let next = 0;
  for (const action of actions) if (next < steps.length && matchesStep(action, steps[next]!, labels)) next++;
  return next === steps.length;
}

/** Every hidden reference found in every captured text. */
export function scanForHiddenReferences(captured: Array<{ where: string; text: string }>, references: HiddenReferences = hiddenReferences()): Finding[] {
  const findings: Finding[] = [];
  const add = (where: string, source: string): void => { if (!findings.some(finding => finding.where === where && finding.source === source)) findings.push({ where, source }); };
  for (const item of captured) {
    const { actions, lists } = actionsIn(item.text);
    const flat = item.text.replace(/\s+/g, ' ');
    for (const { source, text } of references.texts) if (flat.includes(text.replace(/\s+/g, ' '))) add(item.where, source);
    for (const pattern of references.patterns) {
      const name = `${pattern.task}: ${pattern.list}`;
      if (lists.some(list => list.length === pattern.steps.length && list.every((action, index) => matchesStep(action, pattern.steps[index]!, references.labels)))) add(item.where, `${name} steps`);
      for (const step of pattern.steps) if (distinctive(step) && actions.some(action => matchesStep(action, step, references.labels))) add(item.where, `${name} step ${step.name}`);
      if (pattern.steps.length > 1 && played(actions, pattern.steps, references.labels)) add(item.where, `${name} played`);
    }
  }
  return findings;
}

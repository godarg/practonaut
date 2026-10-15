/** Task from two scenes: the difference between a start and a goal drawing becomes a world/2 task
 * with a goal conjunction, error classes, an oracle action sequence and near misses. Every result
 * is re-checked: the goal scene passes the independent checker, the start scene does not, the
 * oracle passes and each near miss fails, for every variant. No model, no clock, no I/O. */
import { stateHash } from '../canonical/index.ts';
import { checkState, parseScene, type Unmodeled } from '../checker/index.ts';
import { Session } from '../core/index.ts';
import { evaluate } from '../predicate/index.ts';
import { validateState, validateWorld } from '../world/schema.ts';
import { generateVariant, substituteTokens, variantIndex, variantTokens } from '../world/variant.ts';
import type { ActionName, Arrow, ErrorClass, Frame, GeneratedBy, Localized, Predicate, Scalar, State, StepV2, Task, TaskLimits, Value, World } from '../world/types.ts';
import { AuthoringError } from './project.ts';

export interface SceneVariant { id: string; labels: Record<string, string> }
export interface FromScenesOptions {
  /** Require the goal's left-to-right order of uniquely labelled steps (`lt` on x). */
  layout?: 'relative';
  /** Require rows and columns that are aligned in the goal to stay aligned (`near`). */
  align?: boolean;
  /** Tolerance in pixels for `near` (default 8). */
  tolerance?: number;
  worldId?: string; taskId?: string; version?: string;
  title?: Localized; prompt?: Localized; hints?: Localized[];
  /** Extra cases besides the drawn labels: original label -> replacement. */
  variants?: SceneVariant[];
  authors?: string[];
}
/** An action whose id parameters may refer to the object created by an earlier step. */
export type OracleParam = Scalar | { created: number };
export interface OracleStep { name: ActionName; params: Record<string, OracleParam> }
export interface NearMiss { id: string; kind: string; steps: OracleStep[]; violates: number[] }
export interface TaskOracle {
  schema: 'practonaut.task-oracle/1'; worldId: string; taskId: string;
  /** One seed per variant case, so a reader can reproduce each case. */
  seeds: Record<string, number>;
  steps: OracleStep[]; nearMisses: NearMiss[];
}
export interface FromScenesResult {
  world: World; task: Task; oracle: TaskOracle;
  /** The goal scene's state with variant tokens, for re-verification inside a larger world. */
  goal: State;
  unmodeled: { start: Unmodeled[]; goal: Unmodeled[] };
  summary: { steps: number; arrows: number; frames: number; clauses: number; errorClasses: number };
}

const lit = (value: Scalar): Value => ({ kind: 'literal', value });
const fld = (variable: string, field: string): Value => ({ kind: 'field', variable, field });
const eq = (left: Value, right: Value): Predicate => ({ op: 'eq', left, right });
const all = (...args: Predicate[]): Predicate => args.length === 1 ? args[0]! : { op: 'all', args };
const not = (arg: Predicate): Predicate => ({ op: 'not', arg });
const count = (type: 'frame' | 'step' | 'arrow', as: string, where: Predicate): Value => ({ kind: 'count', type, as, where });
const words = (en: string, de: string): Localized => ({ en, de });

const liveSteps = (state: State): StepV2[] => Object.values(state.objects).filter((o): o is StepV2 => o.type === 'step' && !o.deleted).sort((a, b) => a.id.localeCompare(b.id));
const liveArrows = (state: State): Arrow[] => Object.values(state.objects).filter((o): o is Arrow => o.type === 'arrow' && !o.deleted).sort((a, b) => a.id.localeCompare(b.id));
const liveFrames = (state: State): Frame[] => Object.values(state.objects).filter((o): o is Frame => o.type === 'frame' && !o.deleted).sort((a, b) => a.id.localeCompare(b.id));
const fail = (code: string, message: string): never => { throw new AuthoringError(code, message); };

const SHAPE_WORDS = { rectangle: ['rectangle', 'rectangles', 'Rechteck', 'Rechtecke', 'Ein'], ellipse: ['ellipse', 'ellipses', 'Ellipse', 'Ellipsen', 'Eine'], diamond: ['diamond', 'diamonds', 'Raute', 'Rauten', 'Eine'] } as const;
const COLOUR = { en: { black: 'black', red: 'red', green: 'green', blue: 'blue', orange: 'orange', yellow: 'yellow', none: 'no' }, de: { black: 'schwarz', red: 'rot', green: 'grün', blue: 'blau', orange: 'orange', yellow: 'gelb', none: 'keine' } } as const;

/** Text placeholders: a label that varies becomes {{token}} wherever it appears. */
interface Tokens { of(label: string): string; text(value: Localized): Localized; map: Map<string, string> }
function tokenTable(taskId: string, variants: SceneVariant[]): Tokens {
  const map = new Map<string, string>();
  for (const variant of variants) for (const original of Object.keys(variant.labels)) if (!map.has(original)) map.set(original, `${taskId}-l${map.size + 1}`);
  const of = (label: string): string => map.has(label) ? `{{${map.get(label)!}}}` : label;
  // Author text names labels in typographic quotes; exactly those quoted names follow the variant.
  const quoted = (value: string, open: string, close: string): string => [...map.keys()].reduce((out, label) => out.split(`${open}${label}${close}`).join(`${open}${of(label)}${close}`), value);
  return { map, of, text: value => ({ en: quoted(value.en, '“', '”'), de: quoted(value.de, '„', '“') }) };
}

interface Clause { predicate: Predicate; text: Localized }
/** The goal predicate from-scenes derives from a goal state (no variant tokens): what the
 * minimal-length analysis regenerates to confirm that it read a goal exactly (PADR-0040). */
export function goalPredicateOf(goal: State, frames: boolean, options: { tolerance: number; layout?: 'relative'; align?: boolean }, resized: ReadonlySet<string> = new Set()): Predicate {
  return all(...goalClauses(goal, frames, options, label => label, resized).map(clause => clause.predicate));
}
/** The pin of a step the task leaves as it is (`pinUnchanged`): `exists step u` with its label and
 * its x, y, width and height (± tolerance). The minimal-length analysis recognises exactly this form. */
export function pinClause(label: string, step: { x: number; y: number; width: number; height: number }, tolerance: number): Predicate {
  return { op: 'exists', type: 'step', as: 'u', where: all(eq(fld('u', 'label'), lit(label)),
    ...(['x', 'y', 'width', 'height'] as const).map((field): Predicate => ({ op: 'near', left: fld('u', field), right: lit(step[field]), tolerance }))) };
}
/** Steps the task leaves exactly as they are: in both states under the same id with every attribute
 * equal (label, shape, line, fill, frame, group, position, size), uniquely and non-empty labelled
 * in the goal. */
function unchangedSteps(start: State, goal: State): StepV2[] {
  const labels = new Map<string, number>();
  for (const step of liveSteps(goal)) labels.set(step.label, (labels.get(step.label) ?? 0) + 1);
  return liveSteps(goal).filter(step => {
    const before = start.objects[step.id];
    return step.label !== '' && labels.get(step.label) === 1 && before?.type === 'step' && !before.deleted
      && (['label', 'shape', 'stroke', 'fill', 'frameId', 'groupId', 'x', 'y', 'width', 'height'] as const).every(key => (before as StepV2)[key] === step[key]);
  });
}
/** Exact multiset of step, arrow and frame signatures, plus group, order and alignment facts. */
function goalClauses(goal: State, frames: boolean, options: Required<Pick<FromScenesOptions, 'tolerance'>> & FromScenesOptions, tok: Tokens['of'], resized: ReadonlySet<string> = new Set(), pinned: readonly StepV2[] = []): Clause[] {
  const steps = liveSteps(goal), arrows = liveArrows(goal), frameList = liveFrames(goal);
  const q = (label: string) => ({ en: `“${tok(label)}”`, de: `„${tok(label)}“` });
  const clauses: Clause[] = [];
  const total = (type: 'step' | 'arrow' | 'frame', n: number, en: [string, string], de: [string, string]): void => {
    clauses.push({ predicate: eq(count(type, 'n', { op: 'true' }), lit(n)), text: words(`The drawing has exactly ${n} ${n === 1 ? en[0] : en[1]}.`, `Die Zeichnung hat genau ${n} ${n === 1 ? de[0] : de[1]}.`) });
  };
  if (frames) total('frame', frameList.length, ['frame', 'frames'], ['Rahmen', 'Rahmen']);
  total('step', steps.length, ['step', 'steps'], ['Schritt', 'Schritte']);
  total('arrow', arrows.length, ['arrow', 'arrows'], ['Pfeil', 'Pfeile']);
  const frameName = (id: string | null): string | null => id === null ? null : (goal.objects[id] as Frame).name;
  if (frames) {
    const names = new Map<string, number>();
    for (const frame of frameList) names.set(frame.name, (names.get(frame.name) ?? 0) + 1);
    for (const [name, k] of [...names].sort()) clauses.push({
      predicate: eq(count('frame', 'f', eq(fld('f', 'name'), lit(tok(name)))), lit(k)),
      text: words(`${k === 1 ? 'One frame' : `${k} frames`} named ${q(name).en}.`, `${k === 1 ? 'Ein Rahmen' : `${k} Rahmen`} mit dem Namen ${q(name).de}.`),
    });
  }
  const grouped = (step: StepV2): boolean => step.groupId !== null;
  const signature = (step: StepV2) => JSON.stringify([step.label, step.shape, step.stroke, step.fill, frameName(step.frameId), grouped(step)]);
  const bySignature = new Map<string, StepV2[]>();
  for (const step of steps) bySignature.set(signature(step), [...(bySignature.get(signature(step)) ?? []), step]);
  for (const [, group] of [...bySignature].sort((a, b) => a[0].localeCompare(b[0]))) {
    const s = group[0]!, k = group.length, frame = frameName(s.frameId);
    const where = all(
      eq(fld('s', 'label'), lit(tok(s.label))), eq(fld('s', 'shape'), lit(s.shape)), eq(fld('s', 'stroke'), lit(s.stroke)), eq(fld('s', 'fill'), lit(s.fill)),
      ...(frames ? [frame === null ? eq(fld('s', 'frameId'), lit(null)) : { op: 'exists' as const, type: 'frame' as const, as: 'sf', where: all(eq(fld('sf', 'id'), fld('s', 'frameId')), eq(fld('sf', 'name'), lit(tok(frame)))) }] : []),
      grouped(s) ? not(eq(fld('s', 'groupId'), lit(null))) : eq(fld('s', 'groupId'), lit(null)),
    );
    const [enOne, enMany, deOne, deMany, deArticle] = SHAPE_WORDS[s.shape];
    const style = s.stroke === 'black' && s.fill === 'none' ? words('in the default style', 'im Standardstil') : words(`with ${COLOUR.en[s.stroke]} line and ${COLOUR.en[s.fill]} fill`, `mit Linie ${COLOUR.de[s.stroke]} und Füllung ${COLOUR.de[s.fill]}`);
    const place = !frames ? words('', '') : frame === null ? words(', outside any frame', ', außerhalb von Rahmen') : words(`, inside frame ${q(frame).en}`, `, im Rahmen ${q(frame).de}`);
    const group_ = grouped(s) ? words(', grouped', ', gruppiert') : words('', '');
    const name = s.label === '' ? words('without text', 'ohne Text') : words(q(s.label).en, q(s.label).de);
    clauses.push({ predicate: eq(count('step', 's', where), lit(k)), text: words(
      `${k === 1 ? `One ${enOne}` : `${k} ${enMany}`} ${name.en} ${style.en}${place.en}${group_.en}.`,
      `${k === 1 ? `${deArticle} ${deOne}` : `${k} ${deMany}`} ${name.de} ${style.de}${place.de}${group_.de}.`) });
  }
  const end = (arrowVar: string, side: 'from' | 'to', stepId: string | null): Predicate => {
    if (stepId === null) return eq(fld(arrowVar, side), lit(null));
    const label = (goal.objects[stepId] as StepV2).label, v = side === 'from' ? 'af' : 'at';
    return { op: 'exists', type: 'step', as: v, where: all(eq(fld(v, 'id'), fld(arrowVar, side)), eq(fld(v, 'label'), lit(tok(label)))) };
  };
  const arrowKey = (arrow: Arrow) => JSON.stringify([arrow.from === null ? null : (goal.objects[arrow.from] as StepV2).label, arrow.to === null ? null : (goal.objects[arrow.to] as StepV2).label]);
  const byEnds = new Map<string, Arrow[]>();
  for (const arrow of arrows) byEnds.set(arrowKey(arrow), [...(byEnds.get(arrowKey(arrow)) ?? []), arrow]);
  for (const [key, group] of [...byEnds].sort((a, b) => a[0].localeCompare(b[0]))) {
    const a = group[0]!, k = group.length, [fromLabel, toLabel] = JSON.parse(key) as [string | null, string | null];
    const endText = (label: string | null) => label === null ? words('a loose end', 'einem losen Ende') : q(label);
    clauses.push({ predicate: eq(count('arrow', 'a', all(end('a', 'from', a.from), end('a', 'to', a.to))), lit(k)), text: words(
      `${k === 1 ? 'One arrow' : `${k} arrows`} from ${endText(fromLabel).en} to ${endText(toLabel).en}.`,
      `${k === 1 ? 'Ein Pfeil' : `${k} Pfeile`} von ${endText(fromLabel).de} nach ${endText(toLabel).de}.`) });
  }
  const labelCount = new Map<string, number>();
  for (const step of steps) labelCount.set(step.label, (labelCount.get(step.label) ?? 0) + 1);
  const unique = (step: StepV2): boolean => step.label !== '' && labelCount.get(step.label) === 1;
  const groups = new Map<string, StepV2[]>();
  for (const step of steps) if (step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  for (const members of [...groups.values()].filter(m => m.length >= 2).sort((a, b) => a[0]!.label.localeCompare(b[0]!.label))) {
    if (!members.every(unique)) fail('ambiguous_labels', 'grouped steps need unique, non-empty labels in the goal scene');
    const sorted = [...members].sort((a, b) => a.label.localeCompare(b.label)), [head, ...rest] = sorted;
    clauses.push({ predicate: { op: 'exists', type: 'step', as: 'g0', where: all(
      eq(fld('g0', 'label'), lit(tok(head!.label))), not(eq(fld('g0', 'groupId'), lit(null))),
      eq(count('step', 'gm', eq(fld('gm', 'groupId'), fld('g0', 'groupId'))), lit(members.length)),
      ...rest.map((member, index): Predicate => ({ op: 'exists', type: 'step', as: `g${index + 1}`, where: all(eq(fld(`g${index + 1}`, 'label'), lit(tok(member.label))), eq(fld(`g${index + 1}`, 'groupId'), fld('g0', 'groupId'))) })),
    ) }, text: words(`${sorted.map(m => q(m.label).en).join(', ')} form one group of ${members.length}.`, `${sorted.map(m => q(m.label).de).join(', ')} bilden eine Gruppe aus ${members.length}.`) });
  }
  const pair = (a: StepV2, b: StepV2, body: Predicate): Predicate => ({ op: 'exists', type: 'step', as: 'p', where: all(eq(fld('p', 'label'), lit(tok(a.label))),
    { op: 'exists', type: 'step', as: 'r', where: all(eq(fld('r', 'label'), lit(tok(b.label))), body) }) });
  const named = steps.filter(unique);
  // A step whose size the solution changes keeps that size as a condition (± tolerance): otherwise
  // a request like "enlarge it to 260 × 120" would pass without the resize.
  for (const step of named.filter(s => resized.has(s.label)).sort((a, b) => a.label.localeCompare(b.label))) {
    clauses.push({ predicate: { op: 'exists', type: 'step', as: 'z', where: all(eq(fld('z', 'label'), lit(tok(step.label))),
      { op: 'near', left: fld('z', 'width'), right: lit(step.width), tolerance: options.tolerance }, { op: 'near', left: fld('z', 'height'), right: lit(step.height), tolerance: options.tolerance }) },
      text: words(`${q(step.label).en} is ${step.width} × ${step.height} (± ${options.tolerance} px).`, `${q(step.label).de} ist ${step.width} × ${step.height} groß (± ${options.tolerance} px).`) });
  }
  // "Change nothing else" (PADR-0040 injection): a step the task leaves as it is keeps its place and size.
  for (const step of [...pinned].sort((a, b) => a.label.localeCompare(b.label))) {
    clauses.push({ predicate: pinClause(tok(step.label), step, options.tolerance),
      text: words(`${q(step.label).en} stays where it is: at (${step.x}, ${step.y}), ${step.width} × ${step.height} (± ${options.tolerance} px).`, `${q(step.label).de} bleibt, wo es ist: bei (${step.x}, ${step.y}), ${step.width} × ${step.height} groß (± ${options.tolerance} px).`) });
  }
  if (options.layout === 'relative') {
    const ordered = [...named].sort((a, b) => a.x - b.x || a.label.localeCompare(b.label));
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = ordered[i]!, b = ordered[i + 1]!;
      if (b.x - a.x <= options.tolerance) continue;
      clauses.push({ predicate: pair(a, b, { op: 'lt', left: fld('p', 'x'), right: fld('r', 'x') }), text: words(`${q(a.label).en} stands left of ${q(b.label).en}.`, `${q(a.label).de} steht links von ${q(b.label).de}.`) });
    }
  }
  if (options.align) {
    for (const axis of ['y', 'x'] as const) {
      const lines: StepV2[][] = [];
      for (const step of [...named].sort((a, b) => a[axis] - b[axis] || a.label.localeCompare(b.label))) {
        const line = lines.find(candidate => Math.abs(candidate[0]![axis] - step[axis]) <= options.tolerance);
        if (line) line.push(step); else lines.push([step]);
      }
      for (const line of lines.filter(l => l.length >= 2)) {
        const sorted = [...line].sort((a, b) => (axis === 'y' ? a.x - b.x : a.y - b.y) || a.label.localeCompare(b.label));
        for (let i = 0; i + 1 < sorted.length; i++) clauses.push({ predicate: pair(sorted[i]!, sorted[i + 1]!, { op: 'near', left: fld('p', axis), right: fld('r', axis), tolerance: options.tolerance }), text: axis === 'y'
          ? words(`${q(sorted[i]!.label).en} and ${q(sorted[i + 1]!.label).en} sit on one row (± ${options.tolerance} px).`, `${q(sorted[i]!.label).de} und ${q(sorted[i + 1]!.label).de} stehen in einer Zeile (± ${options.tolerance} px).`)
          : words(`${q(sorted[i]!.label).en} and ${q(sorted[i + 1]!.label).en} sit in one column (± ${options.tolerance} px).`, `${q(sorted[i]!.label).de} und ${q(sorted[i + 1]!.label).de} stehen in einer Spalte (± ${options.tolerance} px).`) });
      }
    }
  }
  return clauses;
}

function errorClasses(goal: State, tok: Tokens['of']): ErrorClass[] {
  const steps = liveSteps(goal), arrows = liveArrows(goal);
  const labels = [...new Set(steps.map(s => s.label).filter(l => l !== ''))].sort().slice(0, 32);
  const classes: ErrorClass[] = labels.map((label, index) => ({
    id: `missing-label-${index + 1}`, category: 'accepted_but_violates_goal',
    when: not({ op: 'exists', type: 'step', as: 's', where: eq(fld('s', 'label'), lit(tok(label))) }),
    explanation: words(`No step is labelled “${tok(label)}” yet. Add it or rename a step.`, `Noch kein Schritt heißt „${tok(label)}“. Füge ihn hinzu oder benenne einen Schritt um.`),
  }));
  classes.push({ id: 'extra-arrow', category: 'accepted_but_violates_goal', when: { op: 'gt', left: count('arrow', 'a', { op: 'true' }), right: lit(arrows.length) },
    explanation: words(`There are more arrows than the goal has (${arrows.length}). Remove the extra arrow.`, `Es gibt mehr Pfeile als im Ziel (${arrows.length}). Entferne den überzähligen Pfeil.`) });
  if (!arrows.some(a => a.from === null || a.to === null)) classes.push({ id: 'loose-arrow', category: 'accepted_but_violates_goal',
    when: { op: 'exists', type: 'arrow', as: 'a', where: { op: 'any', args: [eq(fld('a', 'from'), lit(null)), eq(fld('a', 'to'), lit(null))] } },
    explanation: words('At least one arrow end is not attached to a step. Reconnect it or remove the arrow.', 'Mindestens ein Pfeilende hängt an keinem Schritt. Verbinde es neu oder entferne den Pfeil.') });
  return classes;
}

/** Plan an action sequence from start to goal. Returns undefined with a reason when the action set cannot express it. */
function plan(start: State, goal: State): { steps: OracleStep[] } | { problem: string } {
  const startSteps = liveSteps(start), goalSteps = liveSteps(goal);
  const startFrames = liveFrames(start), goalFrames = liveFrames(goal);
  const frameMap = new Map<string, string>(), usedFrames = new Set<string>();
  for (const frame of goalFrames) {
    const match = startFrames.find(f => f.id === frame.id && !usedFrames.has(f.id)) ?? startFrames.find(f => f.name === frame.name && !usedFrames.has(f.id));
    if (!match) return { problem: `frame “${frame.name}” would have to be created; no world/2 action creates frames` };
    frameMap.set(frame.id, match.id); usedFrames.add(match.id);
  }
  if (startFrames.some(f => !usedFrames.has(f.id))) return { problem: 'a frame would have to be removed; no world/2 action deletes frames' };
  const stepMap = new Map<string, string | { created: number }>(), usedSteps = new Set<string>();
  for (const step of goalSteps) {
    const match = startSteps.find(s => s.id === step.id && !usedSteps.has(s.id)) ?? startSteps.find(s => s.label === step.label && s.label !== '' && !usedSteps.has(s.id));
    if (match) { stepMap.set(step.id, match.id); usedSteps.add(match.id); }
  }
  const steps: OracleStep[] = [];
  const target = (goalStepId: string): string | { created: number } => stepMap.get(goalStepId)!;
  for (const step of startSteps) if (!usedSteps.has(step.id)) steps.push({ name: 'delete_step', params: { id: step.id } });
  const startArrows = liveArrows(start), goalArrows = liveArrows(goal), usedArrows = new Set<string>(), arrowMap = new Map<string, string>();
  const sameRef = (a: string | null, b: string | { created: number } | null | undefined): boolean => a === b;
  for (const arrow of goalArrows) {
    const ends = [arrow.from === null ? null : stepMap.get(arrow.from) ?? undefined, arrow.to === null ? null : stepMap.get(arrow.to) ?? undefined];
    const match = startArrows.find(a => a.id === arrow.id && !usedArrows.has(a.id)) ?? startArrows.find(a => !usedArrows.has(a.id) && sameRef(a.from, ends[0]) && sameRef(a.to, ends[1]));
    if (match) { usedArrows.add(match.id); arrowMap.set(arrow.id, match.id); }
  }
  for (const arrow of startArrows) if (!usedArrows.has(arrow.id)) steps.push({ name: 'disconnect', params: { id: arrow.id } });
  for (const frame of goalFrames) { const id = frameMap.get(frame.id)!; const old = start.objects[id] as Frame; if (old.name !== frame.name) steps.push({ name: 'rename_frame', params: { id, name: frame.name } }); }
  for (const step of goalSteps) {
    const frameId = step.frameId === null ? null : frameMap.get(step.frameId)!;
    const existing = stepMap.get(step.id);
    if (existing === undefined) {
      const index = steps.length;
      steps.push({ name: 'add_step', params: { frameId, label: step.label, x: step.x, y: step.y, width: step.width, height: step.height, shape: step.shape } });
      stepMap.set(step.id, { created: index });
      if (step.stroke !== 'black' || step.fill !== 'none') steps.push({ name: 'set_style', params: { id: { created: index }, shape: step.shape, stroke: step.stroke, fill: step.fill } });
      continue;
    }
    const old = start.objects[existing as string] as StepV2;
    if (old.label !== step.label) steps.push({ name: 'rename_step', params: { id: old.id, label: step.label } });
    if (old.x !== step.x || old.y !== step.y) steps.push({ name: 'move_step', params: { id: old.id, x: step.x, y: step.y } });
    if (old.width !== step.width || old.height !== step.height) steps.push({ name: 'resize_step', params: { id: old.id, width: step.width, height: step.height } });
    if (old.shape !== step.shape || old.stroke !== step.stroke || old.fill !== step.fill) steps.push({ name: 'set_style', params: { id: old.id, shape: step.shape, stroke: step.stroke, fill: step.fill } });
    if (old.frameId !== frameId) steps.push({ name: 'set_frame', params: { id: old.id, frameId } });
  }
  for (const arrow of goalArrows) {
    if (arrow.from === null || arrow.to === null) {
      const matched = arrowMap.get(arrow.id), old = matched ? start.objects[matched] as Arrow : undefined;
      const wanted = [arrow.from === null ? null : target(arrow.from), arrow.to === null ? null : target(arrow.to)];
      if (!old || !sameRef(old.from, wanted[0]) || !sameRef(old.to, wanted[1])) return { problem: 'the goal has a loose arrow end; no action creates a loose end on purpose' };
      continue;
    }
    const from = target(arrow.from), to = target(arrow.to), matched = arrowMap.get(arrow.id);
    if (matched) {
      const old = start.objects[matched] as Arrow;
      if (!sameRef(old.from, from)) steps.push({ name: 'reconnect_end', params: { id: matched, end: 'start', target: from } });
      if (!sameRef(old.to, to)) steps.push({ name: 'reconnect_end', params: { id: matched, end: 'end', target: to } });
    } else steps.push({ name: 'connect', params: { from, to } });
  }
  // Groups: dissolve every start group that is not exactly a goal group, then build the missing ones.
  const goalGroups = new Map<string, Array<string | { created: number }>>();
  for (const step of goalSteps) if (step.groupId !== null) goalGroups.set(step.groupId, [...(goalGroups.get(step.groupId) ?? []), target(step.id)]);
  const wantedSets = [...goalGroups.values()].filter(members => members.length >= 2);
  const startGroups = new Map<string, string[]>();
  for (const step of startSteps) if (usedSteps.has(step.id) && step.groupId !== null) startGroups.set(step.groupId, [...(startGroups.get(step.groupId) ?? []), step.id]);
  const exact = (members: string[]): boolean => wantedSets.some(set => set.length === members.length && set.every(m => typeof m === 'string' && members.includes(m)));
  const kept: string[][] = [];
  for (const members of startGroups.values()) {
    if (exact(members) && members.length >= 2) kept.push(members);
    else steps.push({ name: 'ungroup', params: { id: members[0]! } });
  }
  for (const set of wantedSets) {
    if (kept.some(members => members.length === set.length && set.every(m => typeof m === 'string' && members.includes(m)))) continue;
    const [head, ...rest] = set;
    for (const member of rest) steps.push({ name: 'group_steps', params: { id: member, with: head! } });
  }
  return { steps };
}

/** Run a sequence with real core transitions; created references resolve to the ids the core made. */
export function runOracle(world: World, seed: number, taskId: string, steps: readonly OracleStep[]): { ok: true; session: Session } | { ok: false; index: number; code: string } {
  const session = new Session(world, seed, taskId);
  const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
  const created: string[] = [];
  for (const [index, step] of steps.entries()) {
    const before = new Set(Object.keys(session.state.objects));
    const params: Record<string, Scalar> = {};
    for (const [key, value] of Object.entries(step.params)) {
      if (value !== null && typeof value === 'object') { const id = created[value.created]; if (id === undefined) return { ok: false, index, code: 'invalid_reference' }; params[key] = id; }
      else params[key] = typeof value === 'string' ? substituteTokens(value, tokens) : value;
    }
    const result = session.act({ name: step.name, params });
    if (!result.ok) return { ok: false, index, code: result.error.code };
    created[index] = Object.keys(result.state.objects).find(id => !before.has(id)) ?? '';
  }
  return { ok: true, session };
}

/**
 * Runs many candidates that share a prefix with the oracle in one session per case: the oracle prefix
 * is applied once and each candidate's tail is undone after it was looked at (Session.undo restores
 * the exact prior state and prefix). The result per candidate equals a fresh `runOracle`; only the
 * repeated world validation of a new Session per candidate is saved. `visit` returns true to stop.
 */
function scanCandidates(world: World, seed: number, taskId: string, oracle: readonly OracleStep[], candidates: readonly Candidate[], visit: (candidate: Candidate, state: State) => boolean): void {
  const session = new Session(world, seed, taskId);
  const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
  const apply = (step: OracleStep, index: number, created: string[]): boolean => {
    const before = new Set(Object.keys(session.state.objects)), params: Record<string, Scalar> = {};
    for (const [key, value] of Object.entries(step.params)) {
      if (value !== null && typeof value === 'object') { const id = created[value.created]; if (id === undefined) return false; params[key] = id; }
      else params[key] = typeof value === 'string' ? substituteTokens(value, tokens) : value;
    }
    const result = session.act({ name: step.name, params });
    if (!result.ok) return false;
    created[index] = Object.keys(result.state.objects).find(id => !before.has(id)) ?? '';
    return true;
  };
  const created: string[] = []; let at = 0;
  for (const candidate of candidates) {
    for (; at < candidate.at; at++) if (!apply(oracle[at]!, at, created)) return;
    const local = created.slice(0, at); let applied = 0, ok = true;
    for (let index = at; index < candidate.steps.length; index++) { if (!apply(candidate.steps[index]!, index, local)) { ok = false; break; } applied++; }
    const stop = ok && visit(candidate, session.state);
    for (let undone = 0; undone < applied; undone++) if (!session.undo().ok) return;
    if (stop || session.step !== at) return;
  }
}

const typo = (label: string): string => `${label} 2`;
const NEAR_MISSES = 4;
interface Candidate { kind: string; steps: OracleStep[]; /** first index where it leaves the oracle */ at: number }
function nearMissCandidates(oracle: OracleStep[], start: State): Candidate[] {
  const out: Candidate[] = [];
  const replace = (index: number, step: OracleStep | undefined, kind: string): void => { const steps = oracle.slice(); if (step) steps[index] = step; else steps.splice(index, 1); out.push({ kind, steps, at: index }); };
  const otherStep = (...avoid: unknown[]): string | undefined => liveSteps(start).map(s => s.id).find(id => !avoid.includes(id));
  const otherArrow = (avoid: unknown): string | undefined => liveArrows(start).map(a => a.id).find(id => id !== avoid);
  const otherFrame = (avoid: unknown): string | null | undefined => avoid === null ? liveFrames(start)[0]?.id : liveFrames(start).map(f => f.id).find(id => id !== avoid) ?? null;
  for (const [index, step] of oracle.entries()) {
    const p = step.params;
    switch (step.name) {
      case 'add_step': replace(index, { name: step.name, params: { ...p, label: typo(String(p.label)) } }, 'wrong-label'); replace(index, { name: step.name, params: { ...p, x: Number(p.x) - 1000 } }, 'misordered'); break;
      case 'rename_step': replace(index, { name: step.name, params: { ...p, label: typo(String(p.label)) } }, 'wrong-label'); break;
      case 'rename_frame': replace(index, { name: step.name, params: { ...p, name: typo(String(p.name)) } }, 'wrong-frame-name'); break;
      case 'connect': replace(index, { name: step.name, params: { from: p.to!, to: p.from! } }, 'reversed-arrow'); break;
      case 'reconnect_end': {
        const arrow = start.objects[String(p.id)] as Arrow | undefined;
        const other = otherStep(p.target, p.end === 'start' ? arrow?.from : arrow?.to);
        if (other) replace(index, { name: step.name, params: { ...p, target: other } }, 'wrong-end');
        replace(index, { name: step.name, params: { ...p, end: p.end === 'start' ? 'end' : 'start' } }, 'other-end-moved');
        break;
      }
      case 'move_step': replace(index, { name: step.name, params: { ...p, y: Number(p.y) + 60 } }, 'misplaced'); replace(index, { name: step.name, params: { ...p, x: Number(p.x) - 1000 } }, 'misordered'); break;
      case 'resize_step': replace(index, { name: step.name, params: { ...p, width: Number(p.width) + 40 } }, 'wrong-size'); break;
      case 'set_style': replace(index, { name: step.name, params: { ...p, fill: p.fill === 'red' ? 'green' : 'red' } }, 'wrong-colour'); break;
      case 'delete_step': { const other = otherStep(p.id); if (other) replace(index, { name: step.name, params: { id: other } }, 'wrong-step-removed'); break; }
      case 'disconnect': { const other = otherArrow(p.id); if (other) replace(index, { name: step.name, params: { id: other } }, 'wrong-arrow-removed'); break; }
      case 'group_steps': { const other = otherStep(p.id, p.with); if (other) replace(index, { name: step.name, params: { id: other, with: p.with! } }, 'wrong-group-member'); break; }
      case 'set_frame': { const other = otherFrame(p.frameId); if (other !== undefined) replace(index, { name: step.name, params: { ...p, frameId: other } }, 'wrong-frame'); break; }
      default: break;
    }
    replace(index, undefined, `missing-${step.name.replace(/_/g, '-')}`);
  }
  return out;
}

const clauseList = (goal: Predicate): Predicate[] => goal.op === 'all' ? goal.args : [goal];
function holds(predicate: Predicate, state: State): boolean {
  const result = evaluate(predicate, state);
  if (!result.ok) fail('goal_invalid', result.error.message);
  return result.ok && result.value;
}

/** Largest scenes from-scenes accepts: beyond these the goal's conditions cannot be checked within
 * the checker's step budget anyway, and the near-miss search grows with the square of the size. */
export const FROM_SCENES_LIMITS = Object.freeze({ steps: 200, arrows: 400, frames: 40 });

function requireSize(state: State, which: 'start' | 'goal'): void {
  const sizes = { steps: liveSteps(state).length, arrows: liveArrows(state).length, frames: liveFrames(state).length };
  for (const kind of ['steps', 'arrows', 'frames'] as const) if (sizes[kind] > FROM_SCENES_LIMITS[kind])
    fail('scene_too_large', `the ${which} scene has ${sizes[kind]} ${kind}; from-scenes accepts at most ${FROM_SCENES_LIMITS[kind]} (split the drawing into smaller tasks)`);
}

/** The checker's step budget or the world's predicate size limit ran out: the goal is too large to
 * check, which a user should read as such rather than as "goal not accepted". */
function budgetExhausted(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === 'checker_fuel_exhausted' || (error instanceof Error && /checker_fuel_exhausted|step budget exhausted|predicate node limit|predicate depth limit/.test(error.message));
}
const tooComplex = (clauses: number): never => fail('goal_too_complex', `the goal has ${clauses} conditions; more than the checker can evaluate within its limits. Use fewer distinct steps and arrows, drop --align/--layout, or split the drawing into several tasks`);

/** "1 arrow", "2 arrows": the language's plural rule, never `n === 1`. */
function counted(language: 'en' | 'de', n: number, one: string, other: string): string { return `${n} ${new Intl.PluralRules(language).select(n) === 'one' ? one : other}`; }
export function fromScenes(startScene: string | Uint8Array, goalScene: string | Uint8Array, options: FromScenesOptions = {}): FromScenesResult {
  let start: ReturnType<typeof parseScene>, goal: ReturnType<typeof parseScene>;
  try { start = parseScene(startScene); goal = parseScene(goalScene); } catch (error) { return fail('scene_invalid', error instanceof Error ? error.message : 'scene could not be read'); }
  return fromStates(start.state, goal.state, options, { start: start.unmodeled, goal: goal.unmodeled });
}

/** Options of the state-based core: those of from-scenes, plus what a generator records on the task
 * (PADR-0036 `generatedBy`) and the task's public limits (PADR-0040). */
export interface FromStatesOptions extends FromScenesOptions {
  generatedBy?: GeneratedBy; limits?: TaskLimits;
  /** Pin the place and size of every step the task leaves exactly as it is (its other attributes
   * are pinned by its signature), so "change nothing else" is part of the goal (PADR-0040). */
  pinUnchanged?: boolean;
}
/**
 * The state-based core of from-scenes: a world/2 task from a start and a goal state (world/2 states,
 * as the checker's scene parser produces them), with goal clauses, error classes, a reference
 * solution and near misses, all verified with the independent checker. Generators call it directly
 * (PADR-0040); `fromScenes` parses two drawings and calls it.
 */
export function fromStates(startInput: State, goalInput: State, options: FromStatesOptions = {}, unmodeled: FromScenesResult['unmodeled'] = { start: [], goal: [] }): FromScenesResult {
  const tolerance = options.tolerance ?? 8;
  if (!Number.isSafeInteger(tolerance) || tolerance < 0 || tolerance > 1000) fail('usage', 'tolerance must be an integer between 0 and 1000');
  const taskId = options.taskId ?? 'from-scenes', worldId = options.worldId ?? 'from-scenes';
  const start = { state: readState(startInput, 'start') }, goal = { state: readState(goalInput, 'goal') };
  requireSize(start.state, 'start'); requireSize(goal.state, 'goal');
  // A singleton group cannot be produced by group_steps; the goal treats it as ungrouped.
  const goalState = structuredClone(goal.state);
  const sizes = new Map<string, number>();
  for (const step of liveSteps(goalState)) if (step.groupId !== null) sizes.set(step.groupId, (sizes.get(step.groupId) ?? 0) + 1);
  for (const step of liveSteps(goalState)) if (step.groupId !== null && sizes.get(step.groupId)! < 2) (goalState.objects[step.id] as StepV2).groupId = null;
  if (!liveSteps(goalState).length && !liveArrows(goalState).length) fail('goal_empty', 'the goal scene has no steps or arrows');
  const variants = options.variants ?? [];
  const tokens = tokenTable(taskId, variants);
  for (const variant of variants) for (const original of Object.keys(variant.labels)) {
    if (![...liveSteps(start.state), ...liveSteps(goalState)].some(s => s.label === original) && ![...liveFrames(start.state), ...liveFrames(goalState)].some(f => f.name === original)) fail('variant_label_unknown', `variant ${variant.id} renames “${original}”, which neither scene contains`);
  }
  const frames = liveFrames(start.state).length > 0 || liveFrames(goalState).length > 0;
  // Uniquely labelled steps present in both scenes whose size differs: the solution resizes them.
  const unique = (state: State) => { const all_ = liveSteps(state), seen = new Map<string, number>(); for (const s of all_) seen.set(s.label, (seen.get(s.label) ?? 0) + 1); return new Map(all_.filter(s => s.label !== '' && seen.get(s.label) === 1).map(s => [s.label, s])); };
  const before = unique(start.state), resized = new Set([...unique(goalState)].filter(([label, s]) => { const b = before.get(label); return b !== undefined && (b.width !== s.width || b.height !== s.height); }).map(([label]) => label));
  const clauses = goalClauses(goalState, frames, { ...options, tolerance }, tokens.of, resized, options.pinUnchanged ? unchangedSteps(start.state, goalState) : []);
  const goalPredicate = all(...clauses.map(c => c.predicate));
  const tokenize = (state: State): State => {
    const out = structuredClone(state);
    for (const o of Object.values(out.objects)) { if (o.type === 'step') o.label = tokens.of(o.label); if (o.type === 'frame') o.name = tokens.of(o.name); }
    return out;
  };
  const planned = plan(start.state, goalState);
  if ('problem' in planned) return fail('oracle_unavailable', planned.problem);
  const oracleSteps = planned.steps.map(step => ({ name: step.name, params: Object.fromEntries(Object.entries(step.params).map(([key, value]) => [key, (key === 'label' || key === 'name') && typeof value === 'string' ? tokens.of(value) : value])) }));
  if (!oracleSteps.length) fail('scenes_identical', 'start and goal scene describe the same semantic state');
  const sentences = describePlan(oracleSteps, start.state, goalState, tokens.of, options.layout === 'relative' || options.align === true);
  const counts = { steps: liveSteps(goalState).length, arrows: liveArrows(goalState).length, frames: liveFrames(goalState).length };
  const task: Task = {
    id: taskId,
    title: options.title ? tokens.text(options.title) : words('Make the drawing match the goal', 'Bringe die Zeichnung in den Zielzustand'),
    prompt: options.prompt ? tokens.text(options.prompt) : words(sentences.map(s => s.en).join(' '), sentences.map(s => s.de).join(' ')),
    initialState: tokenize(start.state), goal: goalPredicate,
    hints: options.hints?.map(tokens.text) ?? [
      words('Every condition in the goal list must hold at the end. The order of your actions does not matter.', 'Am Ende muss jede Bedingung der Zielliste erfüllt sein. Die Reihenfolge deiner Aktionen ist egal.'),
      words(`The goal has ${counted('en', counts.steps, 'step', 'steps')} and ${counted('en', counts.arrows, 'arrow', 'arrows')}.`, `Das Ziel hat ${counted('de', counts.steps, 'Schritt', 'Schritte')} und ${counted('de', counts.arrows, 'Pfeil', 'Pfeile')}.`),
    ],
    errorClasses: errorClasses(goalState, tokens.of),
    conditionTexts: clauses.map(c => c.text),
    ...(options.generatedBy ? { generatedBy: structuredClone(options.generatedBy) } : {}),
    ...(options.limits ? { limits: structuredClone(options.limits) } : {}),
  };
  const original = Object.fromEntries([...tokens.map].map(([label, token]) => [token, label]));
  const cases = [{ id: 'drawn', labels: original, params: {}, layoutOffset: { x: 0, y: 0 } }, ...variants.map(v => ({ id: v.id, labels: Object.fromEntries([...tokens.map].map(([label, token]) => [token, v.labels[label] ?? label])), params: {}, layoutOffset: { x: 0, y: 0 } }))];
  const checked = <T>(work: () => T): T => { try { return work(); } catch (error) { if (budgetExhausted(error)) return tooComplex(clauses.length); throw error; } };
  const world = checked(() => validateWorld({
    schema: 'practonaut.world/2', id: worldId, version: options.version ?? '1.0.0', app: { adapterId: 'excalidraw', versionRange: '0.18.1' },
    initialState: { objects: {} }, tasks: [task], variants: { generator: 'finite-seeded-v1', cases },
    provenance: { authors: options.authors ?? ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' },
  }));
  const verified = checked(() => verifyTask(world, taskId, oracleSteps, tokenize(goalState)));
  return { world, task: world.tasks[0]!, oracle: verified, goal: tokenize(goalState), unmodeled, summary: { ...counts, clauses: clauses.length, errorClasses: task.errorClasses.length } };
}

/** A world/2 state given to the core; anything else is refused by name before any derivation. */
function readState(input: State, which: 'start' | 'goal'): State {
  try { return validateState(structuredClone(input), 2); }
  catch (error) { return fail('state_invalid', `the ${which} state is not a world/2 state: ${error instanceof Error ? error.message : 'invalid'}`); }
}

/** For every variant: goal state passes (counter-probes included), oracle passes, near misses fail. */
export function verifyTask(world: World, taskId: string, oracle: OracleStep[], goalState: State): TaskOracle {
  const seeds: Record<string, number> = {};
  for (let seed = 0; Object.keys(seeds).length < world.variants.cases.length && seed < 100_000; seed++) {
    const id = world.variants.cases[variantIndex(world, seed)]!.id;
    if (!(id in seeds)) seeds[id] = seed;
  }
  if (Object.keys(seeds).length !== world.variants.cases.length) fail('variant_unsolved', 'no seed reaches every variant case');
  let nearMisses: NearMiss[] | undefined;
  for (const [caseId, seed] of Object.entries(seeds)) {
    const variant = generateVariant(world, seed), task = variant.tasks.find(t => t.id === taskId)!;
    const tokensOfCase = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
    const concreteGoal = structuredClone(goalState);
    for (const o of Object.values(concreteGoal.objects)) { if (o.type === 'step') o.label = substituteTokens(o.label, tokensOfCase); if (o.type === 'frame') o.name = substituteTokens(o.name, tokensOfCase); }
    try {
      if (!checkState(world, concreteGoal, { seed, taskId }).passed) fail('goal_not_accepted', `the goal scene does not satisfy its own goal (case ${caseId})`);
    } catch (error) {
      if (error instanceof AuthoringError) throw error;
      fail(String((error as { code?: string }).code) === 'counterprobe_failed' ? 'start_accepted' : 'goal_not_accepted', error instanceof Error ? error.message : 'checker refused');
    }
    const run = runOracle(world, seed, taskId, oracle);
    if (!run.ok) fail('oracle_rejected', `oracle step ${run.index} was rejected (${run.code}) in case ${caseId}`);
    if (run.ok && !checkState(world, run.session.state, { seed, taskId }).passed) fail('oracle_fails', `the oracle does not reach the goal in case ${caseId}`);
    const startHash = stateHash(task.initialState!);
    if (!nearMisses) {
      nearMisses = [];
      const seen = new Set<string>(), clauses = clauseList(task.goal);
      scanCandidates(world, seed, taskId, oracle, nearMissCandidates(oracle, task.initialState!), (candidate, state) => {
        if (stateHash(state) === startHash) return false;
        // Each clause is evaluated once; the goal holds exactly when no clause is violated.
        const violates = clauses.flatMap((clause, index) => holds(clause, state) ? [] : [index]);
        if (!violates.length) return false;
        const key = `${candidate.kind}:${violates.join(',')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        nearMisses!.push({ id: `near-${nearMisses!.length + 1}`, kind: candidate.kind, steps: candidate.steps, violates });
        // Four single-fault near misses are the best possible selection; later candidates cannot
        // displace them, so the scan stops (it is the costly part for large scenes).
        return nearMisses!.filter(miss => miss.violates.length === 1).length >= NEAR_MISSES;
      });
      // Single-fault near misses first, each pinning one goal clause; ties keep the order found.
      const order = (miss: NearMiss): number => Number(miss.id.slice('near-'.length));
      nearMisses.sort((a, b) => a.violates.length - b.violates.length || order(a) - order(b));
      nearMisses = nearMisses.slice(0, NEAR_MISSES).map((miss, index) => ({ ...miss, id: `near-${index + 1}` }));
      if (!nearMisses.length) fail('near_miss_unavailable', `no near miss could be derived from the oracle of ${taskId}`);
    }
    for (const miss of nearMisses) {
      const tried = runOracle(world, seed, taskId, miss.steps);
      if (!tried.ok || checkState(world, tried.session.state, { seed, taskId }).passed) fail('near_miss_passes', `near miss ${miss.id} does not fail in case ${caseId}`);
    }
  }
  return { schema: 'practonaut.task-oracle/1', worldId: world.id, taskId, seeds, steps: oracle, nearMisses: nearMisses! };
}

/** Plain sentences for a default prompt, from the planned difference (at most six). */
function describePlan(steps: OracleStep[], start: State, goal: State, tok: Tokens['of'], layoutChecked = false): Localized[] {
  const name = (ref: OracleParam): { en: string; de: string } => {
    if (ref !== null && typeof ref === 'object') { const added = steps[ref.created]!.params.label; return { en: `“${String(added)}”`, de: `„${String(added)}“` }; }
    const object = typeof ref === 'string' ? start.objects[ref] : undefined;
    const label = object?.type === 'step' ? tok(object.label) : String(ref);
    return { en: `“${label}”`, de: `„${label}“` };
  };
  const out: Localized[] = [];
  for (const step of steps) {
    const p = step.params;
    switch (step.name) {
      case 'add_step': out.push(words(`Add the step “${String(p.label)}”.`, `Füge den Schritt „${String(p.label)}“ hinzu.`)); break;
      case 'delete_step': out.push(words(`Remove ${name(p.id!).en}.`, `Entferne ${name(p.id!).de}.`)); break;
      case 'rename_step': out.push(words(`Rename ${name(p.id!).en} to “${String(p.label)}”.`, `Benenne ${name(p.id!).de} in „${String(p.label)}“ um.`)); break;
      case 'connect': out.push(words(`Connect ${name(p.from!).en} to ${name(p.to!).en}.`, `Verbinde ${name(p.from!).de} mit ${name(p.to!).de}.`)); break;
      case 'disconnect': { const arrow = start.objects[String(p.id)] as Arrow; out.push(words(`Remove the arrow from ${name(arrow.from).en} to ${name(arrow.to).en}.`, `Entferne den Pfeil von ${name(arrow.from).de} nach ${name(arrow.to).de}.`)); break; }
      case 'reconnect_end': { const arrow = start.objects[String(p.id)] as Arrow; out.push(words(`Rewire the arrow from ${name(arrow.from).en} to ${name(arrow.to).en} so its ${p.end === 'start' ? 'start' : 'end'} is ${name(p.target!).en}.`, `Hänge den Pfeil von ${name(arrow.from).de} nach ${name(arrow.to).de} um: sein ${p.end === 'start' ? 'Anfang' : 'Ende'} ist ${name(p.target!).de}.`)); break; }
      // A move is a requirement only where a layout condition checks it; otherwise it just makes room.
      case 'move_step': if (layoutChecked) out.push(words(`Move ${name(p.id!).en} so the order and rows in the goal conditions hold.`, `Verschiebe ${name(p.id!).de} so, dass Reihenfolge und Zeilen der Zielbedingungen stimmen.`)); break;
      case 'resize_step': out.push(words(`Resize ${name(p.id!).en} to ${Number(p.width)} × ${Number(p.height)}.`, `Ändere die Größe von ${name(p.id!).de} auf ${Number(p.width)} × ${Number(p.height)}.`)); break;
      case 'set_style': {
        const object = typeof p.id === 'string' ? start.objects[p.id] : undefined, old = object?.type === 'step' ? object as StepV2 : undefined;
        const shape = String(p.shape) as StepV2['shape'], stroke = String(p.stroke) as StepV2['stroke'], fill = String(p.fill) as StepV2['fill'];
        const newShape = old ? old.shape !== shape : shape !== 'rectangle', newStroke = old ? old.stroke !== stroke : stroke !== 'black', newFill = old ? old.fill !== fill : fill !== 'none';
        const n = name(p.id!);
        const enParts = [newStroke ? `a ${COLOUR.en[stroke]} line` : '', newFill && fill !== 'none' ? `a ${COLOUR.en[fill]} fill` : ''].filter(Boolean);
        const deParts = [newStroke ? `Linienfarbe ${COLOUR.de[stroke]}` : '', newFill && fill !== 'none' ? `Füllung ${COLOUR.de[fill]}` : ''].filter(Boolean);
        const removeFill = newFill && fill === 'none';
        if (newShape) {
          const article = { rectangle: ['a', 'zum'], ellipse: ['an', 'zur'], diamond: ['a', 'zur'] }[shape];
          out.push(words(`Make ${n.en} ${article[0]} ${SHAPE_WORDS[shape][0]}${enParts.length ? ` with ${enParts.join(' and ')}` : ''}${removeFill ? ' without fill' : ''}.`,
            `Mache ${n.de} ${article[1]} ${SHAPE_WORDS[shape][2]}${deParts.length ? ` mit ${deParts.join(' und ')}` : ''}${removeFill ? ' ohne Füllung' : ''}.`));
        } else if (!newStroke && newFill && fill !== 'none') out.push(words(`Fill ${n.en} ${COLOUR.en[fill]}.`, `Fülle ${n.de} ${COLOUR.de[fill]}.`));
        else if (enParts.length) out.push(words(`Give ${n.en} ${enParts.join(' and ')}${removeFill ? ' and remove its fill' : ''}.`, `Gib ${n.de} ${deParts.map(part => `die ${part}`).join(' und ')}${removeFill ? ' und entferne die Füllung' : ''}.`));
        else if (removeFill) out.push(words(`Remove the fill of ${n.en}.`, `Entferne die Füllung von ${n.de}.`));
        break;
      }
      case 'rename_frame': { const frame = start.objects[String(p.id)] as Frame; out.push(words(`Rename the frame “${tok(frame.name)}” to “${String(p.name)}”.`, `Benenne den Rahmen „${tok(frame.name)}“ in „${String(p.name)}“ um.`)); break; }
      case 'set_frame': { const frame = p.frameId === null ? undefined : goal.objects[String(p.frameId)] ?? start.objects[String(p.frameId)]; out.push(frame?.type === 'frame' ? words(`Put ${name(p.id!).en} into the frame “${tok(frame.name)}”.`, `Lege ${name(p.id!).de} in den Rahmen „${tok(frame.name)}“.`) : words(`Take ${name(p.id!).en} out of its frame.`, `Nimm ${name(p.id!).de} aus seinem Rahmen.`)); break; }
      case 'group_steps': out.push(words(`Group ${name(p.id!).en} with ${name(p.with!).en}.`, `Gruppiere ${name(p.id!).de} mit ${name(p.with!).de}.`)); break;
      case 'ungroup': out.push(words(`Dissolve the group of ${name(p.id!).en}.`, `Löse die Gruppe von ${name(p.id!).de} auf.`)); break;
    }
  }
  const unique = out.filter((sentence, index) => out.findIndex(other => other.en === sentence.en) === index);
  return unique.length > 6 ? [...unique.slice(0, 5), words('Then check the remaining goal conditions.', 'Prüfe danach die übrigen Zielbedingungen.')] : unique;
}

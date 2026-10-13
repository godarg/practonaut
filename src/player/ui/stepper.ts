/**
 * Vertical stepper for a guided flow: an ordered list of step cards. Each step is a native
 * <details>, so it opens and closes by pointer and keyboard without script and keeps its
 * semantics for assistive technology. The marker shows the number, a check when the step is done
 * and a ring when it is the current one; a line joins the markers. Steps that share a `name`
 * attribute form an exclusive group: opening one closes the other. Completed steps stay editable;
 * a future step is either usable (it opens) or locked: no chevron, it does not open, and its
 * summary line says when it becomes available.
 *
 * Motion runs only for what just happened: pass the time since a step opened or was completed and
 * the animation continues across re-renders instead of restarting. Styles: src/player/css/create.css.
 */
import { append, classes, h } from './dom.ts';
import type { Child } from './dom.ts';
import { icon } from './icons.ts';

export type StepState = 'done' | 'current' | 'upcoming';
export interface StepOptions {
  /** 1-based position, shown in the marker. */
  index: number;
  title: string;
  /** One short line shown while the step is closed, e.g. "3 steps named". */
  summary?: string;
  state: StepState;
  open: boolean;
  /** Screen-reader prefix that carries position and state, e.g. "Step 2 of 6, done." */
  position: string;
  /** Extra attributes for the <details> element (e.g. a data attribute used by tests). */
  attrs?: Record<string, string>;
  /** Milliseconds since the step opened because of the flow; animates the body once. */
  openedFor?: number | undefined;
  /** Milliseconds since the step was completed; animates the check once. */
  doneFor?: number | undefined;
  /** Not available yet: the step stays closed and its summary says when it opens. */
  locked?: boolean;
}

const ENTRANCE_MS = 400;

export function step(options: StepOptions, ...body: Child[]): HTMLDetailsElement {
  const marker = h('span', { class: classes('pn-step__marker', options.doneFor !== undefined && options.doneFor < ENTRANCE_MS && 'is-new'), attrs: { 'aria-hidden': 'true' }, vars: options.doneFor !== undefined ? { '--_elapsed': `${Math.round(options.doneFor)}ms` } : undefined });
  if (options.state === 'done') marker.append(icon('check')); else marker.append(h('span', { text: String(options.index) }));
  const text = h('span', { class: 'pn-step__text' },
    h('span', { class: 'sr-only', text: options.position }),
    h('h3', { class: 'pn-step__title', text: options.title }));
  if (options.summary) text.append(h('span', { class: 'pn-step__summary-line', text: options.summary }));
  const summary = h('summary', { class: 'pn-step__summary', attrs: options.locked ? { 'aria-disabled': 'true' } : {} }, marker, text, options.locked ? undefined : icon('chevronDown', 'sm'));
  if (options.locked) {
    summary.addEventListener('click', event => event.preventDefault());
    summary.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.preventDefault(); });
  }
  const content = h('div', { class: 'pn-step__body' });
  append(content, body);
  const opening = options.open && options.openedFor !== undefined && options.openedFor < ENTRANCE_MS;
  const node = h('details', {
    class: classes('pn-step', `pn-step--${options.state}`, options.locked && 'pn-step--locked', opening && 'is-opening'),
    attrs: options.attrs,
    vars: opening ? { '--_elapsed': `${Math.round(options.openedFor!)}ms` } : undefined,
  }, summary, content);
  node.open = options.open && !options.locked;
  // A step the author opens by hand animates once; a step created open does not.
  let shown = node.open;
  node.addEventListener('toggle', () => {
    if (node.open && !shown) { node.style.setProperty('--_elapsed', '0ms'); node.classList.add('is-opening'); }
    shown = node.open;
  });
  node.addEventListener('animationend', event => { if (event.target === content) node.classList.remove('is-opening'); });
  return node;
}

/** Ordered list of steps with an accessible name; each step sits in its own list item. */
export function stepper(options: { label: string; class?: string }, ...steps: HTMLDetailsElement[]): HTMLOListElement {
  const list = h('ol', { class: classes('pn-stepper', options.class), attrs: { 'aria-label': options.label } });
  for (const item of steps) list.append(h('li', { class: 'pn-stepper__item' }, item));
  return list;
}

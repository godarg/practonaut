/**
 * UI kit factories. Surfaces compose these; they never hand-roll a button, field, chip or sheet.
 * Every factory sets the right semantics (roles, aria-pressed, labels) so a design change and an
 * accessibility change happen in one place. Catalogue: docs/design/design-language.md section 9.
 */
import { append, classes, h } from './dom.ts';
import type { Child } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';

export type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'unknown';
/** Chips additionally know the recording tone (pulsing dot). */
export type ChipTone = Tone | 'record';
export type ButtonVariant = 'secondary' | 'primary' | 'tinted' | 'plain' | 'quiet' | 'tool' | 'tool-danger' | 'danger' | 'danger-solid';

export interface ButtonOptions {
  label: string;
  onClick?: (() => void) | undefined;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  /** Icon-only button: `label` becomes the accessible name and tooltip. */
  iconOnly?: boolean;
  block?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  busy?: boolean;
  testid?: string | undefined;
  type?: 'button' | 'submit';
  describedBy?: string;
  /** Keyboard shortcut shown as a key cap after the label. The accessible name is then the label and
   *  the key as shown, and `title` is the tooltip and description (WCAG 2.5.3 Label in Name). */
  kbd?: string;
  /** Full accessible name and tooltip for a button whose visible label is short. It must contain the visible label as whole words. */
  title?: string;
  class?: string;
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const node = h('button', {
    class: classes('pn-btn', options.variant && options.variant !== 'secondary' && `pn-btn--${options.variant}`, options.size && options.size !== 'md' && `pn-btn--${options.size}`, options.iconOnly && 'pn-btn--icon', options.block && 'pn-btn--block', options.class),
    testid: options.testid,
    attrs: {
      type: options.type ?? 'button',
      'aria-label': options.iconOnly ? options.label : options.kbd ? undefined : options.title,
      title: options.iconOnly ? options.label : options.title,
      'aria-pressed': options.pressed === undefined ? undefined : String(options.pressed),
      'aria-busy': options.busy ? 'true' : undefined,
      'aria-describedby': options.describedBy,
    },
  });
  if (options.icon) node.append(icon(options.icon));
  if (!options.iconOnly) node.append(h('span', { text: options.label }));
  // The space keeps label and key apart in the name; the flex layout does not render it.
  if (options.kbd) node.append(' ', h('kbd', { text: options.kbd }));
  node.disabled = !!options.disabled;
  if (options.onClick) node.addEventListener('click', options.onClick);
  return node;
}

/** Remembers the last selected index per group so the thumb can glide instead of jump. */
const lastIndex = new Map<string, number>();

export interface SegmentedItem { id: string; label: string; icon?: IconName; testid?: string; disabled?: boolean; ariaLabel?: string }
export interface SegmentedOptions {
  /** Stable identity of this control across re-renders; enables the thumb animation. */
  key: string;
  label: string;
  items: SegmentedItem[];
  value: string;
  onChange: (id: string) => void;
  size?: 'sm' | 'md';
  testid?: string;
}

export function segmented(options: SegmentedOptions): HTMLElement {
  const index = Math.max(0, options.items.findIndex(item => item.id === options.value));
  const previous = lastIndex.get(options.key);
  lastIndex.set(options.key, index);
  const moving = previous !== undefined && previous !== index;
  const root = h('div', {
    class: classes('pn-segmented', options.size === 'sm' && 'pn-segmented--sm', moving && 'is-moving'),
    testid: options.testid,
    attrs: { role: 'group', 'aria-label': options.label },
    vars: { '--_n': options.items.length, '--_i': index, ...(moving ? { '--_from': previous } : {}) },
  });
  for (const item of options.items) {
    const node = h('button', { class: 'pn-segmented__item', testid: item.testid, attrs: { type: 'button', 'aria-pressed': String(item.id === options.value), 'aria-label': item.ariaLabel, title: item.ariaLabel } });
    if (item.icon) node.append(icon(item.icon));
    node.append(h('span', { text: item.label }));
    node.disabled = !!item.disabled;
    node.addEventListener('click', () => { if (item.id !== options.value) options.onChange(item.id); });
    root.append(node);
  }
  return root;
}

export function chip(label: string, options: { tone?: ChipTone; icon?: IconName; testid?: string } = {}): HTMLElement {
  const tone = options.tone && options.tone !== 'neutral' ? `pn-chip--${options.tone}` : undefined;
  return h('span', { class: classes('pn-chip', tone), testid: options.testid }, options.icon && icon(options.icon), label);
}

export function banner(options: { tone?: Tone; title?: string; text?: string; icon?: IconName; role?: 'status' | 'alert'; testid?: string; class?: string }, ...extra: Child[]): HTMLElement {
  const tone = options.tone ?? 'accent';
  const glyph: IconName = options.icon ?? ({ accent: 'info', neutral: 'info', success: 'checkCircle', danger: 'xCircle', warning: 'warning', unknown: 'helpCircle' } as const)[tone];
  const node = h('div', {
    class: classes('pn-banner', tone !== 'accent' && tone !== 'neutral' && `pn-banner--${tone}`, options.class),
    testid: options.testid,
    attrs: { role: options.role },
  });
  node.append(icon(glyph));
  const body = h('div', { class: 'pn-banner__body' });
  if (options.title) body.append(h('p', { class: 'pn-banner__title', text: options.title }));
  if (options.text) body.append(h('p', { text: options.text }));
  append(body, extra);
  node.append(body);
  return node;
}

export function card(options: { title?: string; titleId?: string; level?: 2 | 3; eyebrow?: string; actions?: Child[]; flush?: boolean; testid?: string; class?: string; labelledBy?: boolean }, ...children: Child[]): HTMLElement {
  const node = h('section', { class: classes('pn-card', options.flush && 'pn-card--flush', options.class), testid: options.testid });
  if (options.title) {
    const id = options.titleId;
    const heading = h(options.level === 3 ? 'h3' : 'h2', { class: 'pn-card__title', text: options.title, id });
    if (id) node.setAttribute('aria-labelledby', id);
    const header = h('header', { class: 'pn-card__header' }, heading);
    if (options.actions?.length) header.append(h('div', { class: 'pn-card__actions' }, ...options.actions));
    node.append(header);
  }
  append(node, children);
  return node;
}

export interface FieldOptions { label: string; hint?: string; testid?: string; id: string; describedBy?: string }

function fieldShell(options: FieldOptions, control: HTMLElement, described: HTMLElement = control): HTMLElement {
  const hintId = options.hint ? `${options.id}-hint` : undefined;
  const ids = [hintId, options.describedBy].filter(Boolean).join(' ') || undefined;
  if (ids) described.setAttribute('aria-describedby', ids);
  const root = h('div', { class: 'pn-field' }, h('label', { class: 'pn-field__label', text: options.label, attrs: { for: options.id } }), control);
  if (options.hint) root.append(h('p', { class: 'pn-field__hint', id: hintId, text: options.hint }));
  return root;
}

export function textField(options: FieldOptions & { value: string; maxLength?: number; required?: boolean; type?: 'text' | 'number'; min?: number; max?: number; step?: number; mono?: boolean; onInput?: (value: string) => void }): { root: HTMLElement; input: HTMLInputElement } {
  const input = h('input', {
    class: classes('pn-field__control', options.mono && 'pn-field__control--mono'), id: options.id, testid: options.testid,
    attrs: { type: options.type ?? 'text', maxlength: options.maxLength, required: options.required, min: options.min, max: options.max, step: options.step, autocomplete: 'off', spellcheck: 'false' },
  });
  input.value = options.value;
  if (options.onInput) input.addEventListener('input', () => options.onInput!(input.value));
  return { root: fieldShell(options, input), input };
}

export function selectField(options: FieldOptions & { value: string; options: Array<{ value: string; label: string; title?: string }>; onChange?: (value: string) => void; capsule?: boolean; disabled?: boolean; bare?: boolean; ariaLabel?: string }): { root: HTMLElement; select: HTMLSelectElement } {
  const select = h('select', { class: 'pn-field__control', id: options.id, testid: options.testid });
  for (const item of options.options) select.append(h('option', { text: item.label, attrs: { value: item.value, title: item.title } }));
  select.value = options.value;
  select.disabled = !!options.disabled;
  if (options.ariaLabel) select.setAttribute('aria-label', options.ariaLabel);
  if (options.onChange) select.addEventListener('change', () => options.onChange!(select.value));
  const wrap = h('span', { class: classes('pn-select', options.capsule && 'pn-select--capsule') }, select, icon('chevronDown', 'sm'));
  if (options.bare) return { root: wrap, select };
  return { root: fieldShell(options, wrap, select), select };
}

export function textArea(options: FieldOptions & { value: string; rows?: number; mono?: boolean; onInput?: (value: string) => void }): { root: HTMLElement; input: HTMLTextAreaElement } {
  const input = h('textarea', { class: classes('pn-field__control', options.mono && 'pn-field__control--mono'), id: options.id, testid: options.testid, attrs: { rows: options.rows ?? 8, spellcheck: 'false' } });
  input.value = options.value;
  if (options.onInput) input.addEventListener('input', () => options.onInput!(input.value));
  return { root: fieldShell(options, input), input };
}

export function checkField(options: { id: string; label: string; checked: boolean; testid?: string; disabled?: boolean; onChange?: (checked: boolean) => void }): { root: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { id: options.id, testid: options.testid, attrs: { type: 'checkbox' } });
  input.checked = options.checked;
  input.disabled = !!options.disabled;
  if (options.onChange) input.addEventListener('change', () => options.onChange!(input.checked));
  const root = h('label', { class: 'pn-check', attrs: { for: options.id } }, input, h('span', { class: 'pn-check__text', text: options.label }));
  return { root, input };
}

export type StatusKind = 'met' | 'unmet' | 'pending' | 'stale';
export function statusIcon(kind: StatusKind): SVGSVGElement {
  const glyph: IconName = kind === 'met' ? 'checkCircleFill' : kind === 'unmet' ? 'xCircleFill' : kind === 'stale' ? 'warning' : 'circle';
  const node = icon(glyph);
  node.classList.add('pn-status', `pn-status--${kind}`);
  return node;
}

export type EvidenceKind = 'confirmed' | 'observed' | 'hypothesis' | 'refuted';
export function evidence(kind: EvidenceKind, label: string, options: { markOnly?: boolean } = {}): HTMLElement {
  const mark = h('span', { class: `pn-evidence__mark pn-evidence__mark--${kind}`, attrs: { 'aria-hidden': 'true' } });
  if (kind === 'confirmed') mark.append(icon('check'));
  if (kind === 'refuted') mark.append(icon('x'));
  return h('span', { class: 'pn-evidence', attrs: options.markOnly ? { title: label } : {} }, mark, h('span', { class: options.markOnly ? 'sr-only' : undefined, text: label }));
}

export function disclosure(options: { summary: string; open?: boolean; testid?: string; class?: string }, ...children: Child[]): HTMLDetailsElement {
  const node = h('details', { class: classes('pn-disclosure', options.class), testid: options.testid }, h('summary', { text: options.summary }), h('div', { class: 'pn-disclosure__body' }, ...children));
  node.open = !!options.open;
  return node;
}

export function emptyState(options: { icon: IconName; title: string; text?: string }, ...actions: Child[]): HTMLElement {
  const node = h('div', { class: 'pn-empty' }, h('span', { class: 'pn-empty__glyph' }, icon(options.icon)), h('p', { class: 'pn-empty__title', text: options.title }));
  if (options.text) node.append(h('p', { text: options.text }));
  append(node, actions);
  return node;
}

export interface SheetAction { label: string; onClick: () => void; variant?: ButtonVariant; testid?: string; type?: 'button' | 'submit' }
export interface SheetOptions {
  title: string;
  text?: string;
  body?: HTMLElement;
  actions: SheetAction[];
  testid?: string;
  /** Element that gets focus again when the sheet closes. */
  restoreFocus: () => HTMLElement | null | undefined;
  /** Which action receives the initial focus; defaults to the last (the safe one). */
  initialFocus?: 'first-field' | 'last-action';
  onSubmit?: (event: SubmitEvent) => void;
}

/** Modal sheet. Escape and the Cancel action both dismiss; focus returns to the opener. */
export function openSheet(options: SheetOptions): { close: () => void; dialog: HTMLDialogElement; form: HTMLFormElement } {
  const titleId = `sheet-${Math.random().toString(36).slice(2, 8)}`;
  const dialog = h('dialog', { class: 'pn-sheet', testid: options.testid, attrs: { 'aria-labelledby': titleId } });
  const form = h('form');
  form.append(h('h2', { class: 'pn-sheet__title', id: titleId, text: options.title }));
  if (options.text) form.append(h('p', { class: 'pn-sheet__text', text: options.text }));
  if (options.body) form.append(options.body);
  const actions = h('div', { class: 'pn-sheet__actions' });
  const buttons = options.actions.map(action => button({ label: action.label, variant: action.variant ?? 'secondary', size: 'lg', block: true, testid: action.testid, type: action.type ?? 'button', onClick: action.type === 'submit' ? undefined : action.onClick }));
  actions.append(...buttons);
  form.append(actions);
  dialog.append(form);
  const close = (): void => { if (dialog.open) dialog.close(); dialog.remove(); options.restoreFocus()?.focus(); };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  if (options.onSubmit) form.addEventListener('submit', event => { event.preventDefault(); options.onSubmit!(event); });
  document.body.append(dialog);
  dialog.showModal();
  const target = options.initialFocus === 'first-field' ? dialog.querySelector<HTMLElement>('input, select, textarea') : buttons.at(-1);
  target?.focus();
  return { close, dialog, form };
}

export { icon } from './icons.ts';
export type { IconName } from './icons.ts';
export { h, append, classes } from './dom.ts';
export type { Child } from './dom.ts';

/** `meter`: a small count shown as filled and empty dots (●●○), with its words for assistive technology. */
export interface PickerItem { value: string; label: string; detail?: string; meter?: { value: number; max: number; label: string } }
/**
 * One-step choice from a list (task picker): a capsule button opens a listbox; a click or Enter on
 * an option picks it at once. Arrow keys, Home and End move between options; Escape closes and
 * returns focus to the button; Tab or a click outside closes. The current option carries a check
 * and the word for "current" (never the check alone).
 */
function pickerDetail(item: PickerItem): HTMLElement | undefined {
  if (!item.detail && !item.meter) return undefined;
  const meter = item.meter ? [h('span', { class: 'pn-picker__meter', text: '●'.repeat(item.meter.value) + '○'.repeat(Math.max(0, item.meter.max - item.meter.value)), attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'sr-only', text: `${item.meter.label}${item.detail ? ', ' : ''}` })] : [];
  const gap = item.meter && item.detail ? h('span', { text: ' · ', attrs: { 'aria-hidden': 'true' } }) : undefined;
  return h('span', { class: 'pn-picker__detail' }, ...meter, gap, item.detail);
}
export function listPicker(options: { id: string; label: string; value: string; currentWord: string; items: PickerItem[]; onPick: (value: string) => void; disabled?: boolean; testid?: string }): HTMLElement {
  const chosen = options.items.find(item => item.value === options.value);
  const listId = `${options.id}-list`;
  const toggle = h('button', { class: 'pn-picker__button', testid: options.testid, attrs: { type: 'button', id: options.id, 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-controls': listId, 'aria-label': `${options.label}: ${chosen?.label ?? ''}` } },
    h('span', { class: 'pn-picker__value', text: chosen?.label ?? '' }), icon('chevronDown', 'sm'));
  toggle.disabled = !!options.disabled;
  const list = h('ul', { class: 'pn-picker__list', testid: options.testid ? `${options.testid}-list` : undefined, attrs: { id: listId, role: 'listbox', 'aria-label': options.label, hidden: true } });
  const optionNodes = options.items.map(item => {
    const current = item.value === options.value;
    const node = h('li', { class: 'pn-picker__option', testid: options.testid ? `${options.testid}-option-${item.value}` : undefined, attrs: { role: 'option', tabindex: '-1', 'aria-selected': String(current), 'data-value': item.value } },
      h('span', { class: 'pn-picker__check', attrs: { 'aria-hidden': 'true' } }, current ? icon('check', 'sm') : undefined),
      h('span', { class: 'pn-picker__text' }, h('span', { class: 'pn-picker__label', text: item.label }), pickerDetail(item)),
      current ? h('span', { class: 'pn-picker__current', text: options.currentWord }) : undefined);
    node.addEventListener('click', () => pick(item.value));
    return node;
  });
  list.append(...optionNodes);
  const root = h('div', { class: 'pn-picker' }, toggle, list);
  const outside = (event: PointerEvent): void => { if (!root.contains(event.target as Node)) close(false); };
  function open(): void {
    if (toggle.disabled) return;
    list.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    (optionNodes.find(node => node.getAttribute('aria-selected') === 'true') ?? optionNodes[0])?.focus();
    document.addEventListener('pointerdown', outside, true);
  }
  function close(refocus: boolean): void {
    list.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) toggle.focus();
  }
  function pick(value: string): void { close(true); if (value !== options.value) options.onPick(value); }
  toggle.addEventListener('click', () => { if (list.hidden) open(); else close(true); });
  toggle.addEventListener('keydown', event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); } });
  list.addEventListener('keydown', event => {
    const index = optionNodes.indexOf(document.activeElement as HTMLLIElement);
    const move = (to: number): void => { event.preventDefault(); optionNodes[(to + optionNodes.length) % optionNodes.length]?.focus(); };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(optionNodes.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close(false);
    else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) { event.preventDefault(); pick(optionNodes[index]!.dataset.value!); }
  });
  return root;
}

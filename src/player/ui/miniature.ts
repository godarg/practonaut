/**
 * Miniature process diagram: a small static drawing of steps and arrows, built from semantic data
 * (a recorded snapshot, a world state or planned labels). The create flow uses it wherever it shows
 * "before and after" instead of a text diff. Steps sit in one column in their visual order; a loose
 * arrow end is a hollow ring in the danger colour, drawn where the end used to be attached. Every
 * arrow is drawn: an arrow with no known place gets its own row, a self-loop is an arc.
 *
 * Marking follows the product grammar, not the accent: what a change removes is dashed and neutral
 * ("not there any more"), what it adds or reconnects is a solid line in the text colour. The accent
 * stays reserved for selection. Author labels are data and go through textContent only. The drawing
 * is 1:1 in CSS pixels so label text never scales below the 12 px caption size.
 * Styles: src/player/css/create.css (.pn-mini).
 */
import { classes, h } from './dom.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Geometry in CSS pixels (the SVG is drawn 1:1). Corner radius 6 is --pn-radius-xs. */
const FULL = { boxW: 128, boxH: 40, gap: 20, padX: 22, padY: 12, lane: 16, rx: 6, head: 6, loose: 4 };
/** Narrow screens: two drawings still fit side by side; long labels are elided (the full text is in the label). */
const NARROW = { boxW: 104, boxH: 40, gap: 18, padX: 12, padY: 10, lane: 12, rx: 6, head: 6, loose: 4 };
/** Thumbnail without labels for dense lists (at least 72 px wide); the row beside it carries the words. */
const COMPACT = { boxW: 44, boxH: 16, gap: 14, padX: 14, padY: 8, lane: 8, rx: 6, head: 4, loose: 3 };
type Geometry = typeof FULL;

export interface MiniStep { id: string; label: string; x?: number; y?: number }
export interface MiniArrow {
  id: string; from: string | null; to: string | null; tag?: string;
  /** An arrow the shown state no longer has, drawn at its former place: dashed and neutral, no loose-end rings. */
  ghost?: boolean;
}
export interface MiniGraph { steps: MiniStep[]; arrows: MiniArrow[] }
export interface MiniatureOptions {
  /** Accessible description of the drawing (the SVG is one image for assistive technology). Empty: decorative. */
  label: string;
  /** Visible caption below the drawing, e.g. "Before". */
  caption?: string;
  /** Shared slot order so several drawings (before, after, a whole demonstration) line up row by row. */
  slots?: string[];
  /** Where a loose end belongs: the step it was attached to before, per arrow id. */
  anchors?: Record<string, { from?: string | null; to?: string | null }>;
  /** Objects this change removes: dashed and neutral. */
  removed?: ReadonlySet<string>;
  /** Objects this change adds or reconnects: solid, in the text colour. */
  changed?: ReadonlySet<string>;
  /** Small thumbnail without labels (the surrounding row names the change). */
  compact?: boolean;
  /** Narrower drawing for small containers; labels wrap earlier and long ones are elided. */
  narrow?: boolean;
  class?: string;
}

/** Visual order of steps: top to bottom, then left to right. */
export function slotOrder(...graphs: MiniGraph[]): string[] {
  const seen = new Map<string, MiniStep>();
  for (const graph of graphs) for (const step of graph.steps) if (!seen.has(step.id)) seen.set(step.id, step);
  return [...seen.values()].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0)).map(step => step.id);
}

/** Label width in CSS pixels, measured with the interface font (caption, medium); a character estimate without canvas. */
let measureContext: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string): number {
  if (measureContext === undefined) {
    const canvas = typeof document === 'undefined' ? undefined : document.createElement('canvas');
    measureContext = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    const family = typeof getComputedStyle === 'function' && typeof document !== 'undefined' && document.documentElement ? getComputedStyle(document.documentElement).getPropertyValue('--pn-font-sans').trim() : '';
    if (measureContext) measureContext.font = `500 12px ${family || 'system-ui, sans-serif'}`;
  }
  return measureContext ? measureContext.measureText(text).width + [...text].length * 0.12 : [...text].length * 6.6;
}

/** Wraps a label into at most two lines that fit `width`; a word wider than a line is split, the rest is elided. */
export function miniLines(label: string, width = FULL.boxW - 12): string[] {
  const split = (word: string): string[] => { const parts: string[] = []; let part = ''; for (const char of word) { if (part && textWidth(part + char) > width) { parts.push(part); part = char; } else part += char; } if (part) parts.push(part); return parts; };
  const words = label.trim().split(/\s+/u).filter(Boolean).flatMap(word => textWidth(word) > width ? split(word) : [word]);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && textWidth(`${line} ${word}`) > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > 2) {
    lines.length = 2;
    let last = [...lines[1]!];
    while (last.length && textWidth(last.join('') + '…') > width) last = last.slice(0, -1);
    lines[1] = last.join('') + '…';
  }
  return lines.length ? lines : [''];
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

type Point = [number, number];
function head(end: Point, from: Point, className: string, size: number): SVGPathElement {
  const dx = end[0] - from[0], dy = end[1] - from[1], length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length, back: Point = [end[0] - ux * size, end[1] - uy * size], wing = size * 0.6;
  const left: Point = [back[0] - uy * wing, back[1] + ux * wing], right: Point = [back[0] + uy * wing, back[1] - ux * wing];
  return svg('path', { d: `M ${left[0]} ${left[1]} L ${end[0]} ${end[1]} L ${right[0]} ${right[1]} Z`, class: className });
}

export function miniature(graph: MiniGraph, options: MiniatureOptions): HTMLElement {
  const g: Geometry = options.compact ? COMPACT : options.narrow ? NARROW : FULL;
  const BOX_W = g.boxW, BOX_H = g.boxH, GAP = g.gap, PAD_X = g.padX, PAD_Y = g.padY, LANE = g.lane;
  const WIDTH = BOX_W + 2 * PAD_X, CX = PAD_X + BOX_W / 2, EDGE = PAD_X + BOX_W;
  const present = new Set(graph.steps.map(step => step.id));
  const slots = (options.slots ?? slotOrder(graph)).filter((id, index, all) => all.indexOf(id) === index);
  for (const id of slotOrder(graph)) if (!slots.includes(id)) slots.push(id);
  const slotOf = (id: string | null | undefined): number => (id ? slots.indexOf(id) : -1);
  const removed = options.removed ?? new Set<string>(), changed = options.changed ?? new Set<string>();

  // An arrow with no place at all (both ends loose, no anchor) gets a row of its own below the steps.
  const free = graph.arrows.filter(arrow => {
    const anchor = options.anchors?.[arrow.id] ?? {};
    const from = slotOf(arrow.from) >= 0 ? slotOf(arrow.from) : slotOf(anchor.from);
    const to = slotOf(arrow.to) >= 0 ? slotOf(arrow.to) : slotOf(anchor.to);
    return from < 0 && to < 0;
  });
  const rows = Math.max(1, slots.length) + free.length;
  const height = 2 * PAD_Y + rows * BOX_H + (rows - 1) * GAP;
  const top = (slot: number): number => PAD_Y + slot * (BOX_H + GAP);
  const mid = (slot: number): number => top(slot) + BOX_H / 2;

  const root = svg('svg', { viewBox: `0 0 ${WIDTH} ${height}`, width: WIDTH, height, class: 'pn-mini__svg', ...(options.label ? { role: 'img', 'aria-label': options.label } : { 'aria-hidden': 'true' }) });
  const edges = svg('g'), boxes = svg('g'), marks = svg('g');

  // Lanes: arrows that share a side of a step are spread so they never overlap.
  const lanes = new Map<string, string[]>();
  const lane = (key: string, arrow: string): void => { const list = lanes.get(key) ?? []; list.push(arrow); lanes.set(key, list); };
  const plans = graph.arrows.map(arrow => {
    const anchor = options.anchors?.[arrow.id] ?? {};
    // An end that points at a removed step stays at that step's place; otherwise at its previous binding.
    const fromSlot = slotOf(arrow.from) >= 0 ? slotOf(arrow.from) : slotOf(anchor.from);
    const toSlot = slotOf(arrow.to) >= 0 ? slotOf(arrow.to) : slotOf(anchor.to);
    const fromAttached = !!arrow.from && present.has(arrow.from), toAttached = !!arrow.to && present.has(arrow.to);
    const self = fromAttached && toAttached && arrow.from === arrow.to;
    const down = fromSlot < 0 || toSlot < 0 ? true : toSlot >= fromSlot;
    const between = fromSlot >= 0 && toSlot >= 0 ? slots.slice(Math.min(fromSlot, toSlot) + 1, Math.max(fromSlot, toSlot)).some(id => present.has(id)) : false;
    const side = self ? 'self' : between ? (down ? 'right' : 'left') : 'axis';
    if (side === 'axis' || side === 'right' || side === 'left') {
      if (fromAttached) lane(`${arrow.from}:${side === 'axis' ? (down ? 'bottom' : 'top') : side}`, arrow.id);
      if (toAttached) lane(`${arrow.to}:${side === 'axis' ? (down ? 'top' : 'bottom') : side}`, arrow.id);
    }
    return { arrow, fromSlot, toSlot, fromAttached, toAttached, down, side };
  });
  const offset = (key: string, arrow: string): number => { const list = lanes.get(key) ?? [arrow]; return (list.indexOf(arrow) - (list.length - 1) / 2) * LANE; };

  let freeRow = Math.max(1, slots.length);
  for (const plan of plans) {
    const { arrow, fromAttached, toAttached, down, side } = plan;
    let { fromSlot, toSlot } = plan;
    const look = removed.has(arrow.id) || arrow.ghost ? 'removed' : changed.has(arrow.id) ? 'changed' : '';
    let start: Point, end: Point, path: string, tangent: Point;
    if (side === 'self') {
      // A loop leaves the right side of its step and comes back to it.
      const y = mid(fromSlot), spread = BOX_H / 4, bulge = EDGE + PAD_X - 4;
      start = [EDGE + 2, y - spread]; end = [EDGE + 3, y + spread];
      path = `M ${start[0]} ${start[1]} C ${bulge} ${y - spread * 2.4} ${bulge} ${y + spread * 2.4} ${end[0]} ${end[1]}`; tangent = [bulge, y + spread * 2.4];
    } else if (fromSlot < 0 && toSlot < 0) {
      // No known place: its own row, a short line between two loose ends.
      const y = mid(freeRow++), half = Math.min(BOX_W / 2 - g.loose, 28);
      start = [CX - half, y]; end = [CX + half, y];
      path = `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`; tangent = start;
    } else if (side === 'axis' && fromSlot >= 0 && toSlot >= 0 && fromSlot !== toSlot) {
      const fromKey = `${arrow.from}:${down ? 'bottom' : 'top'}`, toKey = `${arrow.to}:${down ? 'top' : 'bottom'}`;
      const sx = CX + (fromAttached ? offset(fromKey, arrow.id) : (toAttached ? offset(toKey, arrow.id) : 0));
      const ex = CX + (toAttached ? offset(toKey, arrow.id) : sx - CX);
      // Two loose ends in one empty place (a removed step) stay apart: the arriving end sits in its upper
      // half, the leaving end in its lower half, so they never read as one arrow passing through.
      const quarter = BOX_H / 4;
      const beside = (slot: number, x: number): number => present.has(slots[slot]!) ? EDGE + g.loose + 4 : x;
      start = fromAttached ? [sx, down ? top(fromSlot) + BOX_H + 2 : top(fromSlot) - 2] : [beside(fromSlot, sx), mid(fromSlot) + (down ? quarter : -quarter)];
      end = toAttached ? [ex, down ? top(toSlot) - 3 : top(toSlot) + BOX_H + 3] : [beside(toSlot, ex), mid(toSlot) + (down ? -quarter : quarter)];
      path = `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`; tangent = start;
    } else if (side === 'right' || side === 'left') {
      const sign = side === 'right' ? 1 : -1, edge = side === 'right' ? EDGE : PAD_X;
      const fromKey = `${arrow.from}:${side}`, toKey = `${arrow.to}:${side}`;
      start = [edge + sign * 2, mid(fromSlot) + (fromAttached ? offset(fromKey, arrow.id) / 2 : 0)];
      end = [edge + sign * 3, mid(toSlot) + (toAttached ? offset(toKey, arrow.id) / 2 : 0)];
      const bulge = edge + sign * (PAD_X - 4);
      path = `M ${start[0]} ${start[1]} C ${bulge} ${start[1]} ${bulge} ${end[1]} ${end[0]} ${end[1]}`; tangent = [bulge, end[1]];
    } else {
      // Only one end has a place: a short arrow in the gap above or below the step (beside it at the
      // edge of the drawing), the loose end in the open.
      const slot = fromSlot >= 0 ? fromSlot : toSlot, count = Math.max(1, slots.length), x = PAD_X + BOX_W * 0.78;
      if (fromSlot < 0) {
        fromSlot = slot;
        if (slot > 0) { start = [x, top(slot) - GAP + g.loose + 2]; end = [x, top(slot) - 3]; } else { start = [WIDTH - g.loose - 2, mid(slot)]; end = [EDGE + 3, mid(slot)]; }
      } else {
        toSlot = slot;
        if (slot < count - 1) { start = [x, top(slot) + BOX_H + 2]; end = [x, top(slot) + BOX_H + GAP - g.loose - 2]; } else { start = [EDGE + 2, mid(slot)]; end = [WIDTH - g.loose - 2, mid(slot)]; }
      }
      path = `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`; tangent = start;
    }
    edges.append(svg('path', { d: path, class: look === 'removed' ? 'pn-mini__edge pn-mini__edge--removed' : look === 'changed' ? 'pn-mini__edge pn-mini__edge--changed' : 'pn-mini__edge' }));
    if (toAttached) marks.append(head(end, tangent, look === 'removed' ? 'pn-mini__head pn-mini__head--removed' : look === 'changed' ? 'pn-mini__head pn-mini__head--changed' : 'pn-mini__head', g.head));
    if (!fromAttached && !arrow.ghost) marks.append(svg('circle', { cx: start[0], cy: start[1], r: g.loose, class: 'pn-mini__loose' }));
    if (!toAttached && !arrow.ghost) marks.append(svg('circle', { cx: end[0], cy: end[1], r: g.loose, class: 'pn-mini__loose' }));
    if (arrow.tag && !options.compact) {
      // The letter sits on the outer side of its line, so two neighbouring arrows keep their own labels.
      const outward = side === 'left' || (side === 'axis' && (start[0] + end[0]) / 2 < CX - 1);
      const x = (start[0] + end[0]) / 2 + (outward ? -7 : 7), y = (start[1] + end[1]) / 2 + 4;
      marks.append(svg('text', { x, y, class: 'pn-mini__tag', 'text-anchor': outward ? 'end' : 'start' }, arrow.tag));
    }
  }

  for (const step of graph.steps) {
    const slot = slots.indexOf(step.id);
    const y = top(slot), gone = removed.has(step.id);
    boxes.append(svg('rect', { x: PAD_X, y, width: BOX_W, height: BOX_H, rx: g.rx, class: classes('pn-mini__box', gone && 'pn-mini__box--removed', changed.has(step.id) && 'pn-mini__box--changed') }));
    if (options.compact) continue;
    const lines = miniLines(step.label, BOX_W - 12);
    const text = svg('text', { x: CX, y: lines.length === 1 ? y + BOX_H / 2 + 4 : y + BOX_H / 2 - 3, 'text-anchor': 'middle', class: gone ? 'pn-mini__label pn-mini__label--removed' : 'pn-mini__label' });
    lines.forEach((line, index) => text.append(svg('tspan', { x: CX, dy: index ? 14 : 0 }, line)));
    boxes.append(text);
  }
  root.append(edges, boxes, marks);
  const figure = h('figure', { class: classes('pn-mini', options.compact && 'pn-mini--compact', options.class) }, root);
  if (options.caption) figure.append(h('figcaption', { class: 'pn-mini__caption', text: options.caption }));
  return figure;
}

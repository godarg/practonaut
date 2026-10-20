/**
 * Board drawing: the one place that knows how steps, connections, selection, lift and loose ends
 * look (design language section 10.2). The player and the gallery draw the same scene with this
 * module; behaviour (focus, click, keys, aria text) is attached by the caller through `decorate`.
 * Display geometry only: the host owns semantic positions.
 */
import { motion } from './motion.ts';
import { outsidePath, type Rect } from './rect-union.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface SceneStep {
  id: string; label: string; x: number; y: number; width: number; height: number; /** Preview position while a step is picked up. */ at?: { x: number; y: number };
  /** world/2 shape and palette names; the board maps them to semantic tokens and states them in text elsewhere. */
  shape?: 'rectangle' | 'ellipse' | 'diamond'; fill?: string; stroke?: string;
}
// Palette names map to content tokens with Excalidraw's own values (CSS); no colour value lives in code.
const FILL_CLASS: Readonly<Record<string, string>> = { red: 'step-box--fill-red step-box--filled', green: 'step-box--fill-green step-box--filled', blue: 'step-box--fill-blue step-box--filled', yellow: 'step-box--fill-yellow step-box--filled' };
const STROKE_CLASS: Readonly<Record<string, string>> = { black: 'step-box--line-black', red: 'step-box--line-red', green: 'step-box--line-green', blue: 'step-box--line-blue', orange: 'step-box--line-orange' };
export interface SceneArrow { id: string; from: string | null; to: string | null }
export interface BoardScene {
  frameName: string;
  steps: SceneStep[];
  arrows: SceneArrow[];
  selectedId: string;
  /** Step being moved (drawn lifted). */
  pickedId?: string;
  /** Arrow whose end is being rewired (drawn dashed in accent). */
  previewArrowId?: string;
  /** A connection being drawn from `from` to `to` (dashed in accent). */
  connect?: { from: string; to: string };
  /** Short word drawn next to a loose end so the state is never colour alone. */
  looseLabel?: string;
  /** Accessible name of the drawing. */
  name: string;
  /** What a layout task judges (PADR-0047 decision 7), drawn over the board in thin neutral lines. */
  judged?: JudgedLayer;
  /** Frames drawn each as its own outline around its steps, with its name (a layout task's lanes,
   * design review L1-F15); without it the board is one frame named `frameName`. */
  lanes?: Array<{ name: string; steps: string[] }>;
}
/** The judged geometry of a layout task, from its public conditions and the public board: no verdict,
 * no offending object. It carries information (aria-hidden only because the condition sentences and the
 * line under the board say the same in words). */
export interface JudgedLayer {
  /** Arrows judged as the straight segment between the centres of two different steps. */
  segments: Array<{ id: string; from: string; to: string }>;
  /** Steps whose self-loop is judged as the point at their centre. */
  points: string[];
  /** Ellipses and diamonds, judged by their box. */
  boxes: string[];
  /** Canvases (`within`), each with its corners as text. */
  canvases: Array<{ x: number; y: number; width: number; height: number; label: string }>;
}
let boards = 0;
export interface BoardHooks {
  /** Step that is the single tab stop. */
  roving?: string | undefined;
  /** Attach semantics and behaviour to a step group (role, aria text, listeners). */
  decorate?: (group: SVGGElement, step: SceneStep) => void;
  /** Previous draw positions; steps glide from there. Updated by the call. */
  drawn?: Map<string, { x: number; y: number }>;
  /** Narrow screens: crop to the content and draw larger labels so the whole diagram stays readable without scrolling. */
  compact?: boolean;
  /** Animate only when motion is welcome (the caller decides; `motion().calm` is the usual test). */
  animate?: boolean;
}

function node<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string> = {}, content = ''): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.textContent = content;
  return element;
}

function marker(id: string, className: string): SVGMarkerElement {
  const element = node('marker', { id, viewBox: '0 0 10 10', refX: '8.2', refY: '5', markerWidth: '4.2', markerHeight: '4.2', orient: 'auto-start-reverse' });
  element.append(node('path', { d: 'M 1.2 1.6 L 8.8 5 L 1.2 8.4 Q 0.2 5 1.2 1.6 z', class: className, 'stroke-linejoin': 'round' }));
  return element;
}

function defs(): SVGDefsElement {
  const element = node('defs');
  element.append(marker('arrow-tip', 'arrowhead'), marker('arrow-tip-selected', 'arrowhead arrowhead--selected'), marker('arrow-tip-pending', 'arrowhead arrowhead--pending'));
  const shadow = node('filter', { id: 'step-shadow', x: '-20%', y: '-20%', width: '140%', height: '160%' });
  shadow.append(node('feDropShadow', { dx: '0', dy: '1.5', stdDeviation: '2.5', class: 'board-shadow' }));
  const lift = node('filter', { id: 'step-lift', x: '-30%', y: '-30%', width: '160%', height: '190%' });
  lift.append(node('feDropShadow', { dx: '0', dy: '10', stdDeviation: '9', class: 'board-shadow board-shadow--lift' }));
  element.append(shadow, lift);
  return element;
}

/** Wraps a label into lines that fit the card; display only. */
export function stepLines(label: string, width: number, unit = 17): string[] {
  const budget = Math.max(8, Math.floor((width - 32) / (unit * 0.53)));
  const lines: string[] = [];
  let line = '';
  for (const word of label.split(/\s+/)) {
    if (line && (line + ' ' + word).length > budget) { lines.push(line); line = word; } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawBoard(scene: BoardScene, hooks: BoardHooks = {}): SVGSVGElement {
  const { steps } = scene;
  const place = (step: SceneStep): { x: number; y: number } => step.at ?? { x: step.x, y: step.y };
  const crop = hooks.compact && steps.length > 0;
  // What the drawing must show: the steps and, for a layout task, every canvas it judges.
  const canvases = scene.judged?.canvases ?? [];
  // Each lane: its steps' boxes with room around them and its name above them.
  const byStep = new Map(steps.map(step => [step.id, step]));
  const lanes = (scene.lanes ?? []).flatMap(lane => {
    const members = lane.steps.flatMap(id => { const step = byStep.get(id); return step ? [{ ...place(step), width: step.width, height: step.height }] : []; });
    if (!members.length) return [];
    const x = Math.min(...members.map(m => m.x)) - 24, y = Math.min(...members.map(m => m.y)) - (crop ? 64 : 48);
    return [{ name: lane.name, x, y, width: Math.max(...members.map(m => m.x + m.width)) + 24 - x, height: Math.max(...members.map(m => m.y + m.height)) + 24 - y }];
  });
  // The margins around the steps and layout areas hold the lanes' outlines and names and the area's
  // corners written under it, so neither widens the drawing (and its smallest width).
  const rects = [...steps.map(step => ({ x: place(step).x, y: place(step).y, width: step.width, height: step.height })), ...canvases];
  const left = Math.min(...rects.map(rect => rect.x)), right = Math.max(...rects.map(rect => rect.x + rect.width));
  const top = Math.min(...rects.map(rect => rect.y)), bottom = Math.max(...rects.map(rect => rect.y + rect.height));
  const minX = crop ? left - 36 : Math.min(0, ...rects.map(rect => rect.x - 40)), minY = crop ? top - 96 : Math.min(0, ...rects.map(rect => rect.y - 60));
  const width = (crop ? right + 36 : Math.max(960, ...rects.map(rect => rect.x + rect.width + 40))) - minX, height = (crop ? bottom + 64 : Math.max(420, ...rects.map(rect => rect.y + rect.height + 60))) - minY;
  const svg = node('svg', { viewBox: `${minX} ${minY} ${width} ${height}`, class: `board-svg${crop ? ' board-svg--compact' : ''}`, role: 'group', 'aria-label': scene.name, tabindex: '-1' });
  svg.dataset.testid = 'board';
  svg.append(defs());
  // Judged lines (segments, boxes, layout areas) never cross text on the board: one clip, defined once
  // every label is placed, cuts out the union of the label areas (two overlapping areas stay cut, never
  // cut twice). A label area is a display estimate of where the text lies.
  const clipId = scene.judged ? `judged-clip-${++boards}` : '', clipped = scene.judged ? { 'clip-path': `url(#${clipId})` } : {};
  const labelAreas: Rect[] = [];
  const textArea = (text: string, x: number, baseline: number, size: number): Rect => ({ x: x - 2, y: baseline - size, width: text.length * size * 0.6 + 8, height: size * 1.3 });
  if (scene.lanes) for (const lane of lanes) {
    const group = node('g', { class: 'board-lane', 'aria-hidden': 'true' });
    group.dataset.testid = 'board-lane';
    group.append(node('rect', { x: String(lane.x), y: String(lane.y), width: String(lane.width), height: String(lane.height), rx: '20', class: 'board-frame' }),
      node('text', { x: String(lane.x + 16), y: String(lane.y + (crop ? 44 : 30)), class: 'board-frame-label' }, lane.name));
    labelAreas.push(textArea(lane.name, lane.x + 16, lane.y + (crop ? 44 : 30), crop ? 34 : 15));
    svg.append(group);
  } else svg.append(node('rect', { x: String(minX + 12), y: String(minY + 12), width: String(width - 24), height: String(height - 24), rx: '28', class: 'board-frame', 'aria-hidden': 'true' }),
    node('text', { x: String(minX + 36), y: String(minY + 48), class: 'board-frame-label', 'aria-hidden': 'true' }, scene.frameName));
  // The layout area a layout task names: a thin outline under everything, its corners as a quiet label under it.
  for (const canvas of canvases) {
    const group = node('g', { class: 'judged', 'aria-hidden': 'true' });
    group.dataset.testid = 'judged-canvas';
    group.append(node('rect', { x: String(canvas.x), y: String(canvas.y), width: String(canvas.width), height: String(canvas.height), class: 'judged-canvas', ...clipped }),
      node('text', { x: String(canvas.x), y: String(canvas.y + canvas.height + (crop ? 30 : 22)), class: 'judged-canvas-label' }, canvas.label));
    labelAreas.push(textArea(canvas.label, canvas.x, canvas.y + canvas.height + (crop ? 30 : 22), crop ? 20 : 15));
    svg.append(group);
  }

  const byId = new Map(steps.map(step => [step.id, step]));
  const centre = (id: string | null, fallback: number): [number, number] => {
    const step = id ? byId.get(id) : undefined;
    if (!step) return [minX + fallback, minY + height - 60];
    const at = place(step);
    return [at.x + step.width / 2, at.y + step.height / 2];
  };
  const edge = (id: string | null, from: [number, number], to: [number, number], gap: number): [number, number] => {
    const step = id ? byId.get(id) : undefined;
    if (!step) return from;
    const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
    if (!length) return from;
    // Intersect the centre-to-centre ray with the rectangular outline, then leave a visible gap.
    const scale = 1 / Math.max(Math.abs(dx) / (step.width / 2), Math.abs(dy) / (step.height / 2));
    return [from[0] + dx * scale + dx / length * gap, from[1] + dy * scale + dy / length * gap];
  };
  const route = (from: string | null, to: string | null): { d: string; anchor?: [number, number] } => {
    const source = from ? byId.get(from) : undefined;
    if (from !== null && from === to && source) {
      const at = place(source);
      return { d: `M ${at.x + source.width + 8} ${at.y + source.height / 2} C ${at.x + source.width + 90} ${at.y + source.height / 2} ${at.x + source.width + 90} ${at.y - 70} ${at.x + source.width / 2} ${at.y - 10}` };
    }
    const a = centre(from, 80), b = centre(to, 200);
    const start = edge(from, a, b, 3), end = edge(to, b, a, 4);
    return { d: `M ${start[0]} ${start[1]} L ${end[0]} ${end[1]}`, ...(from && byId.has(from) ? { anchor: start } : {}) };
  };
  const loose = (id: string | null, fallback: number): SVGElement | undefined => {
    if (id !== null && byId.has(id)) return undefined;
    const [cx, cy] = centre(id, fallback);
    const group = node('g', { 'aria-hidden': 'true' });
    group.append(node('circle', { cx: String(cx), cy: String(cy), r: '7', class: 'edge-loose' }));
    if (scene.looseLabel) group.append(node('text', { x: String(cx + 14), y: String(cy + 5), class: 'edge-loose-label' }, scene.looseLabel));
    return group;
  };

  for (const arrow of scene.arrows) {
    const chosen = scene.selectedId === arrow.id, previewing = scene.previewArrowId === arrow.id;
    const drawn = route(arrow.from, arrow.to);
    if (chosen) svg.append(node('path', { d: drawn.d, class: 'edge-halo', 'aria-hidden': 'true' }));
    svg.append(node('path', { d: drawn.d, class: `edge ${chosen ? 'selected' : ''} ${previewing ? 'pending' : ''}`, 'marker-end': `url(#${previewing ? 'arrow-tip-pending' : chosen ? 'arrow-tip-selected' : 'arrow-tip'})`, 'aria-hidden': 'true' }));
    // A bound start gets a small anchor: the positive counterpart of the hollow ring of a loose end.
    if (drawn.anchor && !previewing) svg.append(node('circle', { cx: String(drawn.anchor[0]), cy: String(drawn.anchor[1]), r: '4.5', class: `edge-anchor${chosen ? ' selected' : ''}`, 'aria-hidden': 'true' }));
    const start = loose(arrow.from, 80), end = loose(arrow.to, 200);
    if (start) svg.append(start);
    if (end) svg.append(end);
  }
  if (scene.connect) svg.append(node('path', { d: route(scene.connect.from, scene.connect.to).d, class: 'edge pending', 'marker-end': 'url(#arrow-tip-pending)', 'aria-hidden': 'true' }));

  // An ellipse or a diamond is judged by its box: the box outlined under the shape, so its corners show.
  for (const id of scene.judged?.boxes ?? []) {
    const step = byId.get(id);
    if (!step) continue;
    const at = place(step), outline = node('rect', { x: String(at.x), y: String(at.y), width: String(step.width), height: String(step.height), class: 'judged-box', 'aria-hidden': 'true', ...clipped });
    outline.dataset.testid = 'judged-box';
    svg.append(outline);
  }
  // The layout area's label is set like a frame's name (subhead), so it never sets the board's scale (L1-F9).
  const textUnits = [crop ? 34 : 15, ...(scene.arrows.some(arrow => arrow.from === null || arrow.to === null) && scene.looseLabel ? [crop ? 20 : 13] : []), ...(canvases.length ? [crop ? 20 : 15] : [])];
  const feel = motion();
  const previous = new Map(hooks.drawn ?? []);
  hooks.drawn?.clear();
  for (const step of steps) {
    const at = place(step), picked = scene.pickedId === step.id;
    const group = node('g', { class: `step ${step.id === scene.selectedId ? 'selected' : ''} ${picked ? 'picked' : ''}` });
    group.dataset.objectId = step.id; group.dataset.objectType = 'step';
    group.setAttribute('tabindex', step.id === hooks.roving ? '0' : '-1');
    const boxClass = ['step-box', step.fill ? FILL_CLASS[step.fill] : undefined, step.stroke ? STROKE_CLASS[step.stroke] : undefined].filter(Boolean).join(' ');
    const shapeNode = step.shape === 'ellipse'
      ? node('ellipse', { cx: String(at.x + step.width / 2), cy: String(at.y + step.height / 2), rx: String(step.width / 2), ry: String(step.height / 2), class: boxClass })
      : step.shape === 'diamond'
        ? node('polygon', { points: `${at.x + step.width / 2},${at.y} ${at.x + step.width},${at.y + step.height / 2} ${at.x + step.width / 2},${at.y + step.height} ${at.x},${at.y + step.height / 2}`, class: boxClass })
        : node('rect', { x: String(at.x), y: String(at.y), width: String(step.width), height: String(step.height), rx: '14', class: boxClass });
    group.append(node('rect', { x: String(at.x - 5), y: String(at.y - 5), width: String(step.width + 10), height: String(step.height + 10), rx: '19', class: 'step-ring' }), shapeNode);
    // Native text, centred; a text alternative elsewhere carries long labels at narrow widths.
    const sizes = crop ? ([['large', 34], ['title1', 28], ['title2', 24], ['title3', 20]] as const) : ([['body', 17]] as const);
    const fit = sizes.find(([, unit]) => stepLines(step.label, step.width, unit).length * unit * 1.25 <= step.height - 24) ?? sizes[sizes.length - 1]!;
    textUnits.push(fit[1]);
    const unit = fit[1], lines = stepLines(step.label, step.width, unit), cx = at.x + step.width / 2, leading = unit * 1.3;
    const ringed = scene.judged?.points.includes(step.id) ?? false;
    const label = node('text', { x: String(cx), y: String(at.y + step.height / 2 - (lines.length - 1) * leading / 2 + unit * 0.35), 'text-anchor': 'middle', class: `step-label step-label--${fit[0]}${ringed ? ' step-label--halo' : ''}`, 'aria-hidden': 'true' });
    lines.forEach((line, row) => label.append(node('tspan', { x: String(cx), dy: row ? String(leading) : '0' }, line)));
    // A self-loop is judged as the point at its step's centre: a ring there, taller than the label's
    // letters so it shows above and below them, under the label, whose halo keeps the ring out of its
    // letters (design review L1-F2).
    if (ringed) {
      const ring = node('circle', { cx: String(cx), cy: String(at.y + step.height / 2), r: crop ? '28' : '15', class: 'judged-point', 'aria-hidden': 'true' });
      ring.dataset.testid = 'judged-point';
      group.append(ring);
    }
    group.append(label);
    // Where the label's text lies (display estimate): judged lines leave it free.
    const textWidth = Math.min(step.width, Math.max(...lines.map(line => line.length)) * unit * 0.56 + 8), textHeight = lines.length * leading + 4;
    labelAreas.push({ x: cx - textWidth / 2, y: at.y + step.height / 2 - textHeight / 2, width: textWidth, height: textHeight });
    hooks.decorate?.(group, step);
    svg.append(group);
    hooks.drawn?.set(step.id, { x: at.x, y: at.y });
    const before = previous.get(step.id), lift = picked ? -4 : 0;
    if (hooks.animate && typeof group.animate === 'function') {
      if (before && (before.x !== at.x || before.y !== at.y)) group.animate([{ transform: `translate(${before.x - at.x}px, ${before.y - at.y + lift}px)` }, { transform: `translate(0px, ${lift}px)` }], { duration: feel.base + feel.fast, easing: feel.spring });
      else if (!before && previous.size) group.animate([{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1)' }], { duration: feel.base, easing: feel.out });
    }
  }
  if (scene.judged) {
    const clip = node('clipPath', { id: clipId });
    clip.append(node('path', { d: outsidePath({ x: minX, y: minY, width, height }, labelAreas), 'clip-rule': 'evenodd' }));
    svg.querySelector('defs')!.append(clip);
  }
  // The judged segments run from centre to centre over the cards, cut around every label.
  if (scene.judged?.segments.length) {
    const layer = node('g', { class: 'judged', 'clip-path': `url(#${clipId})`, 'aria-hidden': 'true' });
    layer.dataset.testid = 'judged-segments';
    const centreOf = (id: string): [number, number] | undefined => { const step = byId.get(id); if (!step) return undefined; const at = place(step); return [at.x + step.width / 2, at.y + step.height / 2]; };
    for (const segment of scene.judged.segments) {
      const a = centreOf(segment.from), b = centreOf(segment.to);
      if (a && b) layer.append(node('line', { x1: String(a[0]), y1: String(a[1]), x2: String(b[0]), y2: String(b[1]), class: 'judged-segment' }));
    }
    svg.append(layer);
  }
  if (hooks.animate && hooks.drawn && [...hooks.drawn].some(([id, now]) => { const before = previous.get(id); return before && (before.x !== now.x || before.y !== now.y); })) {
    for (const element of svg.querySelectorAll('.edge')) element.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: feel.base + feel.fast, easing: feel.standard });
  }
  // Scale geometry inside the labelled scroll region rather than shrinking any text below the caption token.
  svg.style.setProperty('--_board-span', String(width));
  svg.style.setProperty('--_board-text-unit', String(Math.min(...textUnits)));
  return svg;
}

/**
 * Board drawing: the one place that knows how steps, connections, selection, lift and loose ends
 * look (design language section 10.2). The player and the gallery draw the same scene with this
 * module; behaviour (focus, click, keys, aria text) is attached by the caller through `decorate`.
 * Display geometry only: the host owns semantic positions.
 */
import { motion } from './motion.ts';

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
}
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
  const left = Math.min(...steps.map(step => place(step).x)), right = Math.max(...steps.map(step => place(step).x + step.width));
  const top = Math.min(...steps.map(step => place(step).y)), bottom = Math.max(...steps.map(step => place(step).y + step.height));
  const minX = crop ? left - 36 : Math.min(0, ...steps.map(step => place(step).x - 40)), minY = crop ? top - 96 : Math.min(0, ...steps.map(step => place(step).y - 60));
  const width = (crop ? right + 36 : Math.max(960, ...steps.map(step => place(step).x + step.width + 40))) - minX, height = (crop ? bottom + 64 : Math.max(420, ...steps.map(step => place(step).y + step.height + 60))) - minY;
  const svg = node('svg', { viewBox: `${minX} ${minY} ${width} ${height}`, class: `board-svg${crop ? ' board-svg--compact' : ''}`, role: 'group', 'aria-label': scene.name, tabindex: '-1' });
  svg.dataset.testid = 'board';
  svg.append(defs(),
    node('rect', { x: String(minX + 12), y: String(minY + 12), width: String(width - 24), height: String(height - 24), rx: '28', class: 'board-frame', 'aria-hidden': 'true' }),
    node('text', { x: String(minX + 36), y: String(minY + 48), class: 'board-frame-label', 'aria-hidden': 'true' }, scene.frameName));

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

  const textUnits = [crop ? 34 : 15, ...(scene.arrows.some(arrow => arrow.from === null || arrow.to === null) && scene.looseLabel ? [crop ? 20 : 13] : [])];
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
    const label = node('text', { x: String(cx), y: String(at.y + step.height / 2 - (lines.length - 1) * leading / 2 + unit * 0.35), 'text-anchor': 'middle', class: `step-label step-label--${fit[0]}`, 'aria-hidden': 'true' });
    // Lines break only at spaces. A zero-width space keeps that word boundary in the text, so the
    // visible label reads as words in the step's name (WCAG 2.5.3), without moving the centred line.
    lines.forEach((line, row) => label.append(node('tspan', { x: String(cx), dy: row ? String(leading) : '0' }, row < lines.length - 1 ? line + '\u200B' : line)));
    group.append(label);
    hooks.decorate?.(group, step);
    svg.append(group);
    hooks.drawn?.set(step.id, { x: at.x, y: at.y });
    const before = previous.get(step.id), lift = picked ? -4 : 0;
    if (hooks.animate && typeof group.animate === 'function') {
      if (before && (before.x !== at.x || before.y !== at.y)) group.animate([{ transform: `translate(${before.x - at.x}px, ${before.y - at.y + lift}px)` }, { transform: `translate(0px, ${lift}px)` }], { duration: feel.base + feel.fast, easing: feel.spring });
      else if (!before && previous.size) group.animate([{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'scale(1)' }], { duration: feel.base, easing: feel.out });
    }
  }
  if (hooks.animate && hooks.drawn && [...hooks.drawn].some(([id, now]) => { const before = previous.get(id); return before && (before.x !== now.x || before.y !== now.y); })) {
    for (const element of svg.querySelectorAll('.edge')) element.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: feel.base + feel.fast, easing: feel.standard });
  }
  // Scale geometry inside the labelled scroll region rather than shrinking any text below the caption token.
  svg.style.setProperty('--_board-span', String(width));
  svg.style.setProperty('--_board-text-unit', String(Math.min(...textUnits)));
  return svg;
}

/**
 * A schematic of a judged board state for the bench report (PADR-0039 B.4): every step at its
 * position and size, in its shape, line and fill; frames as labelled outlines around their steps;
 * groups — metadata no SVG export shows — as dashed outlines; arrows between step outlines, a loose
 * end as a hollow ring. It is drawn from the state the checker judged, so it keeps every attribute a
 * goal condition can name, and it is labelled "schematic" wherever it appears: it is not the real
 * Excalidraw. Board text is data: it is escaped and only ever placed inside <text>.
 *
 * Colours come from report.css classes on the content tokens (Excalidraw's own palette values);
 * nothing here names a colour.
 */
import { isStepV2, type Arrow, type Frame, type State, type Step } from '../world/types.ts';

const xml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const n = (value: number): string => String(Math.round(value * 10) / 10);

// Palette names map to classes on the content tokens; no colour value lives in code.
const FILL: Readonly<Record<string, string>> = { red: 'sch-fill-red', green: 'sch-fill-green', blue: 'sch-fill-blue', yellow: 'sch-fill-yellow' };
const LINE: Readonly<Record<string, string>> = { black: 'sch-line-black', red: 'sch-line-red', green: 'sch-line-green', blue: 'sch-line-blue', orange: 'sch-line-orange' };

export interface GroupLegend { name: string; members: string[] }
export interface FrameLegend { name: string; members: string[] }
const live = (state: State): { steps: Step[]; frames: Frame[]; arrows: Arrow[] } => {
  const objects = Object.values(state.objects).filter(object => !object.deleted);
  const order = (a: Step, b: Step): number => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);
  return { steps: objects.filter((object): object is Step => object.type === 'step').sort(order), frames: objects.filter((object): object is Frame => object.type === 'frame').sort((a, b) => a.id.localeCompare(b.id)), arrows: objects.filter((object): object is Arrow => object.type === 'arrow').sort((a, b) => a.id.localeCompare(b.id)) };
};

/** Groups of the judged state, numbered in reading order of their first step: `Group 1: A, B`. */
export function groupsOf(state: State, word = 'Group'): GroupLegend[] {
  const groups = new Map<string, string[]>();
  for (const step of live(state).steps) if (isStepV2(step) && step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step.label]);
  return [...groups.values()].map((members, index) => ({ name: `${word} ${index + 1}`, members }));
}
/** Frames of the judged state with the steps inside them. */
export function framesOf(state: State): FrameLegend[] {
  const { steps, frames } = live(state);
  return frames.map(frame => ({ name: frame.name, members: steps.filter(step => step.frameId === frame.id).map(step => step.label) }));
}

/** Wraps a label into at most three lines for a box `width` board units wide (display only). */
function lines(label: string, width: number, size: number): string[] {
  const budget = Math.max(4, Math.floor((width - 16) / (size * 0.56)));
  const out: string[] = []; let line = '';
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const pieces = word.length > budget ? word.match(new RegExp(`.{1,${budget}}`, 'gu')) ?? [word] : [word];
    for (const piece of pieces) { if (line && (line + ' ' + piece).length > budget) { out.push(line); line = piece; } else line = line ? `${line} ${piece}` : piece; }
  }
  if (line) out.push(line);
  if (out.length > 3) { out.length = 3; out[2] = out[2]!.slice(0, Math.max(1, budget - 1)) + '…'; }
  return out.length ? out : [''];
}

interface Box { x: number; y: number; width: number; height: number }
const around = (boxes: Box[], pad: number, top = pad): Box | null => {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.x)), right = Math.max(...boxes.map(box => box.x + box.width));
  const upper = Math.min(...boxes.map(box => box.y)), lower = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left - pad, y: upper - top, width: right - left + 2 * pad, height: lower - upper + pad + top };
};

/**
 * The schematic as inline SVG markup. `prefix` keeps marker ids unique on a page; `label` is the
 * accessible name; `words` names groups and loose ends in the report's language.
 */
export function schematicSvg(state: State, options: { prefix: string; label: string; words: { group: string; loose: string } }): string {
  const { steps, frames, arrows } = live(state);
  const byId = new Map(steps.map(step => [step.id, step]));
  const size = 20, parts: string[] = [];
  const frameBoxes = frames.flatMap(frame => { const box = around(steps.filter(step => step.frameId === frame.id), 28, 52); return box ? [{ frame, box }] : []; });
  const groups = new Map<string, Step[]>();
  for (const step of steps) if (isStepV2(step) && step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  const groupBoxes = [...groups.values()].map((members, index) => ({ name: `${options.words.group} ${index + 1}`, box: around(members, 14, 34)! }));
  const content = [...steps, ...frameBoxes.map(entry => entry.box), ...groupBoxes.map(entry => entry.box)];
  const looseStubs = arrows.some(arrow => arrow.from === null || arrow.to === null) ? 90 : 0;
  const bounds = around(content.length ? content : [{ x: 0, y: 0, width: 320, height: 160 }], 24 + looseStubs)!;
  const free = arrows.filter(arrow => !(arrow.from && byId.has(arrow.from)) && !(arrow.to && byId.has(arrow.to)));
  const height = bounds.height + (free.length ? 60 : 0);
  parts.push(`<defs><marker id="${options.prefix}-tip" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" class="sch-tip"/></marker></defs>`);
  for (const { frame, box } of frameBoxes) {
    parts.push(`<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="12" class="sch-frame"/>`);
    parts.push(`<text x="${n(box.x + 14)}" y="${n(box.y + 30)}" class="sch-frame-label">${xml(frame.name)}</text>`);
  }
  for (const { name, box } of groupBoxes) {
    parts.push(`<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="10" class="sch-group"/>`);
    parts.push(`<text x="${n(box.x + 10)}" y="${n(box.y + 22)}" class="sch-group-label">${xml(name)}</text>`);
  }
  const centre = (step: Step): [number, number] => [step.x + step.width / 2, step.y + step.height / 2];
  const edge = (step: Step, from: [number, number], to: [number, number], gap: number): [number, number] => {
    const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
    if (!length) return from;
    const scale = 1 / Math.max(Math.abs(dx) / (step.width / 2), Math.abs(dy) / (step.height / 2));
    return [from[0] + dx * scale + (dx / length) * gap, from[1] + dy * scale + (dy / length) * gap];
  };
  const ring = (point: [number, number]): string => `<circle cx="${n(point[0])}" cy="${n(point[1])}" r="8" class="sch-loose"/><text x="${n(point[0])}" y="${n(point[1] - 16)}" text-anchor="middle" class="sch-loose-label">${xml(options.words.loose)}</text>`;
  free.forEach((_, index) => {
    const y = bounds.y + bounds.height + 30, x = bounds.x + 30 + index * 150;
    parts.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + 90)}" y2="${n(y)}" class="sch-edge"/>${ring([x, y])}${ring([x + 90, y])}`);
  });
  for (const arrow of arrows) {
    const source = arrow.from ? byId.get(arrow.from) : undefined, target = arrow.to ? byId.get(arrow.to) : undefined;
    if (!source && !target) continue;
    if (source && target && source.id === target.id) {
      const top = source.y, right = source.x + source.width;
      parts.push(`<path d="M ${n(right)} ${n(top + source.height / 2)} C ${n(right + 80)} ${n(top + source.height / 2)} ${n(right + 80)} ${n(top - 60)} ${n(source.x + source.width / 2)} ${n(top - 4)}" class="sch-edge" marker-end="url(#${options.prefix}-tip)"/>`);
      continue;
    }
    const a: [number, number] = source ? centre(source) : [centre(target!)[0] - target!.width / 2 - 80, centre(target!)[1]];
    const b: [number, number] = target ? centre(target) : [centre(source!)[0] + source!.width / 2 + 80, centre(source!)[1]];
    const start = source ? edge(source, a, b, 3) : a, end = target ? edge(target, b, a, 5) : b;
    parts.push(`<line x1="${n(start[0])}" y1="${n(start[1])}" x2="${n(end[0])}" y2="${n(end[1])}" class="sch-edge"${target ? ` marker-end="url(#${options.prefix}-tip)"` : ''}/>`);
    if (!source) parts.push(ring(start));
    if (!target) parts.push(ring(end));
  }
  for (const step of steps) {
    const v2 = isStepV2(step), filled = v2 && step.fill !== 'none';
    const classes = ['sch-step', v2 ? FILL[step.fill] : undefined, v2 ? LINE[step.stroke] : undefined].filter(Boolean).join(' ');
    const shape = v2 ? step.shape : 'rectangle', x = step.x, y = step.y, w = step.width, h = step.height;
    parts.push(shape === 'ellipse' ? `<ellipse cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" class="${classes}"/>`
      : shape === 'diamond' ? `<polygon points="${n(x + w / 2)},${n(y)} ${n(x + w)},${n(y + h / 2)} ${n(x + w / 2)},${n(y + h)} ${n(x)},${n(y + h / 2)}" class="${classes}"/>`
        : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8" class="${classes}"/>`);
    const rows = lines(step.label, shape === 'rectangle' ? w : w * 0.72, size), leading = size * 1.25;
    const first = y + h / 2 - ((rows.length - 1) * leading) / 2 + size * 0.35;
    parts.push(`<text x="${n(x + w / 2)}" y="${n(first)}" text-anchor="middle" class="${filled ? 'sch-label sch-label--on-fill' : 'sch-label'}">${rows.map((row, index) => `<tspan x="${n(x + w / 2)}" dy="${index ? n(leading) : '0'}">${xml(row)}</tspan>`).join('')}</text>`);
  }
  return `<svg viewBox="${n(bounds.x)} ${n(bounds.y)} ${n(bounds.width)} ${n(height)}" class="schematic" role="img" aria-label="${xml(options.label)}">${parts.join('')}</svg>`;
}

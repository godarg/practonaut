/**
 * A schematic of a judged board state for the bench report (PADR-0039 B.4): every step at its
 * position and size, in its shape, line and fill; frames as labelled outlines around their steps;
 * groups — metadata no SVG export shows — as tinted outlines; arrows between step outlines (two
 * between the same steps drawn side by side), a loose end as a hollow ring. It is drawn from the
 * state the checker judged, so it keeps every attribute a goal condition can name, and it is labelled
 * "schematic" wherever it appears: it is not the real Excalidraw. Board text is data: control and bidi characters are shown escaped, the rest is escaped
 * as XML and only ever placed inside <text>.
 *
 * Colours come from report.css classes on the content tokens (Excalidraw's own palette values);
 * nothing here names a colour.
 */
import { isStepV2, type Arrow, type Frame, type State, type Step } from '../world/types.ts';
import type { LayoutOverlay, LayoutWhere } from '../host/protocol.ts';
import { readableText } from '../cli/output.ts';
import { outsidePath } from '../player/ui/rect-union.ts';

const xml = (value: string): string => readableText(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const n = (value: number): string => String(Math.round(value * 10) / 10);

// Palette names map to classes on the content tokens; no colour value lives in code.
const FILL: Readonly<Record<string, string>> = { red: 'sch-fill-red', green: 'sch-fill-green', blue: 'sch-fill-blue', yellow: 'sch-fill-yellow' };
const HALO: Readonly<Record<string, string>> = { red: 'sch-halo--fill-red', green: 'sch-halo--fill-green', blue: 'sch-halo--fill-blue', yellow: 'sch-halo--fill-yellow' };
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
/** Every live object of the judged state with each goal-relevant attribute, as data for the legend
 * under a picture: a drawing cuts long labels, the legend never does. */
export type BoardObject =
  | { kind: 'step'; label: string; shape: string | null; stroke: string | null; fill: string | null; width: number; height: number; x: number; y: number; frame: string | null; group: number | null }
  | { kind: 'arrow'; from: string | null; to: string | null };
export function boardObjects(state: State): BoardObject[] {
  const { steps, frames, arrows } = live(state);
  const groupIndex = new Map<string, number>();
  for (const step of steps) if (isStepV2(step) && step.groupId !== null && !groupIndex.has(step.groupId)) groupIndex.set(step.groupId, groupIndex.size + 1);
  const frameName = new Map(frames.map(frame => [frame.id, frame.name]));
  const label = new Map(steps.map(step => [step.id, step.label]));
  return [
    ...steps.map((step): BoardObject => {
      const v2 = isStepV2(step);
      return { kind: 'step', label: step.label, shape: v2 ? step.shape : null, stroke: v2 ? step.stroke : null, fill: v2 ? step.fill : null, width: step.width, height: step.height, x: step.x, y: step.y,
        frame: step.frameId === null ? null : frameName.get(step.frameId) ?? null, group: v2 && step.groupId !== null ? groupIndex.get(step.groupId)! : null };
    }),
    ...arrows.map((arrow): BoardObject => ({ kind: 'arrow', from: arrow.from === null ? null : label.get(arrow.from) ?? null, to: arrow.to === null ? null : label.get(arrow.to) ?? null })),
  ];
}

/** Frames of the judged state with the steps inside them. */
export function framesOf(state: State): FrameLegend[] {
  const { steps, frames } = live(state);
  return frames.map(frame => ({ name: frame.name, members: steps.filter(step => step.frameId === frame.id).map(step => step.label) }));
}

/** Wraps a label into at most three lines for a box `width` board units wide (display only; the legend
 * under the picture keeps it in full). Lines break at spaces, so punctuation stays with its word; a
 * word longer than a line is split into even pieces. A label is data: no hyphen is ever drawn into it. */
export function lines(label: string, width: number, size: number): string[] {
  const budget = Math.max(4, Math.floor((width - 16) / (size * 0.6)));
  const out: string[] = []; let line = '';
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const chars = [...word], count = Math.ceil(chars.length / budget), size = Math.ceil(chars.length / count);
    const pieces = count < 2 ? [word] : Array.from({ length: count }, (_, index) => chars.slice(index * size, (index + 1) * size).join('')).filter(Boolean);
    for (const piece of pieces) { if (line && [...`${line} ${piece}`].length > budget) { out.push(line); line = piece; } else line = line ? `${line} ${piece}` : piece; }
  }
  if (line) out.push(line);
  if (out.length > 3) { out.length = 3; out[2] = [...out[2]!].slice(0, Math.max(1, budget - 1)).join('') + '…'; }
  return out.length ? out : [''];
}

export interface Box { x: number; y: number; width: number; height: number }
const around = (boxes: Box[], pad: number, top = pad): Box | null => {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map(box => box.x)), right = Math.max(...boxes.map(box => box.x + box.width));
  const upper = Math.min(...boxes.map(box => box.y)), lower = Math.max(...boxes.map(box => box.y + box.height));
  return { x: left - pad, y: upper - top, width: right - left + 2 * pad, height: lower - upper + pad + top };
};
/** The smallest text in a picture is 20 board units (title3, and Excalidraw's own text size); at this
 * many CSS px per unit it is 12 px, the smallest text the design language allows. */
export const PICTURE_FLOOR = 0.6;
/** The size class of a picture whose viewBox is `width` board units wide. report.css gives each class a
 * smallest width of PICTURE_FLOOR px per unit (rounded up to the next 100 units), so a picture is never
 * drawn below the floor (its frame scrolls instead), and a largest of one px per unit. Both pictures of a
 * pair share one viewBox, so they share the class and the scale. */
/** How much wider a picture's size class must be counted so that its smallest text, `smallest` board
 * units (an export's frame names are 14), is still drawn at 12 px: the floor is set for 20 units. */
export const textFloorScale = (smallest: number | null): number => smallest !== null && smallest < 20 ? 20 / smallest : 1;
export function pictureSizeClass(width: number): string { return `pw-${Math.min(60, Math.max(3, Math.ceil(width / 100)))}`; }
/** How far a picture overflows a column: 'narrow' when its floor is wider than a phone column (20rem),
 * 'wide' when it is wider than a desktop column (64rem). */
export function pictureOverflow(width: number): 'none' | 'narrow' | 'wide' {
  const floor = Math.min(60, Math.max(3, Math.ceil(width / 100))) * 100 * PICTURE_FLOOR;
  return floor > 1024 ? 'wide' : floor > 320 ? 'narrow' : 'none';
}
/** Union of boxes: one viewBox for a pair of pictures, so both are drawn at the same scale. */
export function unionBox(...boxes: Box[]): Box {
  const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
  return { x: left, y: top, width: Math.max(...boxes.map(box => box.x + box.width)) - left, height: Math.max(...boxes.map(box => box.y + box.height)) - top };
}
/** Every text in board units: step labels as Excalidraw sets them (20, its monospace font), frame,
 * group and loose-end labels in title3 (report.css). */
const LABEL = 20;
/** Room under the drawing for arrows whose ends are both loose. */
const freeArrows = (state: State): Arrow[] => { const { steps, arrows } = live(state); const ids = new Set(steps.map(step => step.id)); return arrows.filter(arrow => !(arrow.from && ids.has(arrow.from)) && !(arrow.to && ids.has(arrow.to))); };
/** What a schematic of `state` covers in board units: steps, frame and group outlines, loose ends. */
export function schematicBounds(state: State): Box {
  const { steps, frames, arrows } = live(state);
  const frameBoxes = frames.flatMap(frame => { const box = around(steps.filter(step => step.frameId === frame.id), 28, 56); return box ? [box] : []; });
  const groups = new Map<string, Step[]>();
  for (const step of steps) if (isStepV2(step) && step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  const groupBoxes = [...groups.values()].map(members => around(members, 16, 40)!);
  const content = [...steps, ...frameBoxes, ...groupBoxes];
  const loose = arrows.some(arrow => arrow.from === null || arrow.to === null) ? 100 : 0;
  const box = around(content.length ? content : [{ x: 0, y: 0, width: 320, height: 160 }], 28 + loose)!;
  return freeArrows(state).length ? { ...box, height: box.height + 70 } : box;
}

/** The group outlines of a judged state, as SVG to lay over a picture in the same viewBox (an export
 * shows no groups): outline only, so the drawing under it stays visible. */
export function groupOutlines(state: State, words: { group: string }): string {
  const groups = new Map<string, Step[]>();
  for (const step of live(state).steps) if (isStepV2(step) && step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  return [...groups.values()].map((members, index) => {
    const box = around(members, 16, 40)!;
    return `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="10" class="sch-group-outline"/><text x="${n(box.x + 12)}" y="${n(box.y + 27)}" class="sch-group-label">${xml(`${words.group} ${index + 1}`)}</text>`;
  }).join('');
}

/** A numbered mark on the final board: the objects one reason of an unmet layout clause names, labelled
 * by its condition and its place among that condition's reasons ("7.1"), so that one number means one
 * thing on the page (design review L1-F11). */
export interface MarkPlacement { label: string; steps: string[]; arrows: string[] }
/** Where a layout task's judged geometry lies (its layout areas), for a viewBox that shows it: with
 * room above and below for the area's corners as text. */
export function judgedBounds(overlays: readonly LayoutOverlay[]): Box[] {
  return overlays.flatMap(overlay => overlay.op === 'within' ? [{ x: overlay.canvas.x - 28, y: overlay.canvas.y - 56, width: overlay.canvas.width + 56, height: overlay.canvas.height + 112 }] : []);
}
/** The text a picture writes and the outlines it draws, in board units: judged lines keep the texts
 * free, and the layout area's label touches neither (design review L1-F4). */
export interface PictureText { texts: Box[]; outlines: Box[] }
/** A step's label as the schematic sets it: its lines and the box they cover. */
function stepLabel(step: Step): { rows: string[]; first: number; leading: number; box: Box } {
  const shape = isStepV2(step) ? step.shape : 'rectangle', rows = lines(step.label, shape === 'rectangle' ? step.width : step.width * 0.72, LABEL), leading = LABEL * 1.2;
  const width = Math.min(step.width, Math.max(...rows.map(row => [...row].length)) * LABEL * 0.62 + 10), height = rows.length * leading + 8;
  return { rows, leading, first: step.y + step.height / 2 - ((rows.length - 1) * leading) / 2 + LABEL * 0.35, box: { x: step.x + (step.width - width) / 2, y: step.y + (step.height - height) / 2, width, height } };
}
/** A label in title3 (20 units, sans) whose baseline starts at (x, y). */
const titleBox = (text: string, x: number, y: number): Box => ({ x: x - 2, y: y - LABEL * 0.95, width: [...text].length * LABEL * 0.6 + 6, height: LABEL * 1.3 });
/** What a schematic of `state` writes and outlines: step labels and, when it draws them, frames and
 * groups with their names (as `schematicSvg` and `groupOutlines` place them). Without frames (an
 * export draws its own) the step labels are left out too: the export's texts stand for them. */
export function schematicText(state: State, options: { labels?: boolean; frames: boolean; groups: boolean; groupWord: string }): PictureText {
  const { steps, frames } = live(state);
  const texts: Box[] = options.labels ?? options.frames ? steps.map(step => stepLabel(step).box) : [], outlines: Box[] = [];
  if (options.frames) for (const frame of frames) {
    const box = around(steps.filter(step => step.frameId === frame.id), 28, 56);
    if (box) { outlines.push(box); texts.push(titleBox(frame.name, box.x + 14, box.y + 32)); }
  }
  if (options.groups) {
    const groups = new Map<string, Step[]>();
    for (const step of steps) if (isStepV2(step) && step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
    [...groups.values()].forEach((members, index) => { const box = around(members, 16, 40)!; outlines.push(box); texts.push(titleBox(`${options.groupWord} ${index + 1}`, box.x + 12, box.y + 27)); });
  }
  return { texts, outlines };
}
/** A schematic step label drawn once more over the judged ring, with a halo in the colour behind it, so
 * the ring never runs through its letters (design review L1-F2). */
export function schematicHalo(state: State, groups: boolean): (step: Step) => string {
  return step => {
    const label = stepLabel(step), v2 = isStepV2(step);
    const behind = v2 && step.fill !== 'none' ? HALO[step.fill] ?? '' : groups && v2 && step.groupId !== null ? 'sch-halo--group' : step.frameId !== null && state.objects[step.frameId]?.deleted === false ? 'sch-halo--frame' : '';
    const filled = v2 && step.fill !== 'none';
    return `<text x="${n(step.x + step.width / 2)}" y="${n(label.first)}" text-anchor="middle" class="sch-label ${filled ? 'sch-label--on-fill ' : ''}sch-halo${behind ? ` ${behind}` : ''}">${label.rows.map((row, index) => `<tspan x="${n(step.x + step.width / 2)}" dy="${index ? n(label.leading) : '0'}">${xml(row)}</tspan>`).join('')}</text>`;
  };
}
/** What a picture's judged layer shows, for its caption: judged segments, boxes, rings, layout areas. */
export interface JudgedParts { lines: boolean; boxes: boolean; rings: boolean; area: boolean }
export function judgedParts(state: State, overlays: readonly LayoutOverlay[]): JudgedParts {
  const { steps, frames, arrows } = live(state);
  const ids = new Set(steps.map(step => step.id)), frameName = new Map(frames.map(frame => [frame.id, frame.name]));
  const inScope = (arrow: Arrow, scope: LayoutWhere): boolean => scope.kind === 'all' || (scope.kind === 'outside' ? arrow.frameId === null : arrow.frameId !== null && frameName.get(arrow.frameId) === scope.name);
  const judged = arrows.filter(arrow => arrow.from !== null && arrow.to !== null && ids.has(arrow.from) && ids.has(arrow.to) && overlays.some(overlay => 'arrows' in overlay && inScope(arrow, overlay.arrows.scope)));
  return { lines: judged.some(arrow => arrow.from !== arrow.to), boxes: overlays.length > 0 && steps.some(step => isStepV2(step) && step.shape !== 'rectangle'), rings: judged.some(arrow => arrow.from === arrow.to), area: overlays.some(overlay => overlay.op === 'within') };
}
/** Where a picture's own text and outlines are and how a ringed step's label is drawn again. */
export interface OverlayContext extends PictureText { halo: (step: Step) => string }
const meets = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const within = (inner: Box, outer: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
/**
 * What a layout task judges (PADR-0047 decision 7), as SVG to lay over a picture in the same viewBox:
 * each layout area as a thin outline with its corners as text (placed clear of the picture's texts,
 * outlines and steps), the box of every ellipse or diamond, the selected arrows as thin segments
 * between step centres, a self-loop's centre as a ring with the step's label drawn again over it, and
 * the numbered marks of unmet clauses. Every judged line is cut around the picture's own texts. Drawn
 * from the given state and the conditions' public overlays.
 */
export function judgedOverlay(state: State, overlays: readonly LayoutOverlay[], marks: readonly MarkPlacement[], words: { canvas: string }, prefix: string, context: OverlayContext): string {
  if (!overlays.length) return '';
  const { steps, frames, arrows } = live(state);
  const byId = new Map(steps.map(step => [step.id, step]));
  const frameName = new Map(frames.map(frame => [frame.id, frame.name]));
  const inScope = (object: Step | Arrow, scope: LayoutWhere): boolean =>
    scope.kind === 'all' || (scope.kind === 'outside' ? object.frameId === null : object.frameId !== null && frameName.get(object.frameId) === scope.name);
  const drawn: string[] = [], over: string[] = [];
  for (const step of steps) if (isStepV2(step) && step.shape !== 'rectangle') drawn.push(`<rect x="${n(step.x)}" y="${n(step.y)}" width="${n(step.width)}" height="${n(step.height)}" class="sch-judged-box"/>`);
  // The layout area: its outline, and its corners as text where they touch no text, outline or step.
  for (const overlay of overlays) if (overlay.op === 'within') {
    const c = overlay.canvas, text = `${words.canvas} (${c.x}, ${c.y})–(${c.x + c.width}, ${c.y + c.height})`;
    drawn.push(`<rect x="${n(c.x)}" y="${n(c.y)}" width="${n(c.width)}" height="${n(c.height)}" class="sch-judged-canvas"/>`);
    const size = titleBox(text, 0, 0), below = c.y + c.height + 12 + LABEL, above = c.y - 14;
    const places = [[c.x, below], [c.x + c.width - size.width, below], [c.x, above], [c.x + c.width - size.width, above]] as const;
    const clear = (box: Box): boolean => !context.texts.some(other => meets(box, other)) && !context.outlines.some(outline => meets(box, outline) && !within(box, outline)) && !steps.some(step => meets(box, step));
    const [x, y] = places.find(([px, py]) => clear(titleBox(text, px, py))) ?? places[0];
    over.push(`<text x="${n(x)}" y="${n(y)}" class="sch-judged-label">${xml(text)}</text>`);
  }
  const centre = (step: Step): [number, number] => [step.x + step.width / 2, step.y + step.height / 2];
  const judged = new Set<Arrow>();
  for (const overlay of overlays) if ('arrows' in overlay) for (const arrow of arrows) if (inScope(arrow, overlay.arrows.scope)) judged.add(arrow);
  const rings: string[] = [];
  for (const arrow of judged) {
    const from = arrow.from ? byId.get(arrow.from) : undefined, to = arrow.to ? byId.get(arrow.to) : undefined;
    if (!from || !to) continue;
    // A self-loop is judged as its step's centre: a ring there, taller than the label's letters so it shows
    // above and below them, and the label drawn again over it with a halo.
    if (from.id === to.id) { const [x, y] = centre(from); rings.push(`<circle cx="${n(x)}" cy="${n(y)}" r="18" class="sch-judged-point"/>${context.halo(from)}`); continue; }
    const [x1, y1] = centre(from), [x2, y2] = centre(to);
    drawn.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" class="sch-judged-segment"/>`);
  }
  // Judged lines never cross the picture's text (a line through it reads as struck through): a clip
  // cuts out the union of the text boxes.
  const clip = outsidePath({ x: -4e6, y: -4e6, width: 8e6, height: 8e6 }, context.texts, n);
  // A mark sits at a step's top-left corner, at a self-loop's step's top-right corner, and on an arrow's
  // judged segment at the point nearest its middle where it covers no text of the picture; a mark that
  // would cover another moves along to the right, so marks never cover each other or a label.
  const arrowById = new Map(arrows.map(arrow => [arrow.id, arrow]));
  const placed: Box[] = [];
  const free = (box: Box): boolean => !placed.some(other => meets(box, other)) && !context.texts.some(text => meets(box, text));
  const mark = (x: number, y: number, label: string): string => {
    const width = Math.max(32, [...label].length * 11 + 14), at = (left: number): Box => ({ x: left, y: y - 16, width, height: 32 });
    let left = x - width / 2;
    for (let tries = 0; tries < 32 && !free(at(left)); tries++) left = Math.max(left + 4, ...[...placed, ...context.texts].filter(other => meets(at(left), other)).map(other => other.x + other.width + 4));
    placed.push(at(left));
    return `<rect x="${n(left)}" y="${n(y - 16)}" width="${n(width)}" height="32" rx="16" class="sch-mark"/><text x="${n(left + width / 2)}" y="${n(y + 7)}" text-anchor="middle" class="sch-mark-number">${xml(label)}</text>`;
  };
  const markParts: string[] = [];
  for (const placement of marks) {
    for (const id of placement.steps) { const step = byId.get(id); if (step) markParts.push(mark(step.x, step.y, placement.label)); }
    for (const id of placement.arrows) {
      const arrow = arrowById.get(id), from = arrow?.from ? byId.get(arrow.from) : undefined, to = arrow?.to ? byId.get(arrow.to) : undefined;
      const end = from ?? to;
      if (!end) continue;
      if (from && to && from.id === to.id) { markParts.push(mark(from.x + from.width, from.y, placement.label)); continue; }
      const [x1, y1] = centre(end), [x2, y2] = from && to ? centre(to) : [x1 + end.width / 2 + 60, y1];
      const width = Math.max(32, [...placement.label].length * 11 + 14);
      const t = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8].find(share => { const x = x1 + (x2 - x1) * share, y = y1 + (y2 - y1) * share; return !context.texts.some(text => meets({ x: x - width / 2, y: y - 16, width, height: 32 }, text)); }) ?? 0.5;
      markParts.push(mark(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, placement.label));
    }
  }
  return `<g class="sch-judged"><clipPath id="${prefix}-judged"><path d="${clip}" clip-rule="evenodd"/></clipPath><g clip-path="url(#${prefix}-judged)">${drawn.join('')}</g>${rings.join('')}${over.join('')}${markParts.join('')}</g>`;
}

/**
 * The schematic as inline SVG markup. `prefix` keeps marker ids unique on a page; `label` is the
 * accessible name; `words` names groups and loose ends in the report's language; `viewBox` (the union
 * with the picture it is shown beside) keeps a pair at one scale.
 */
export function schematicSvg(state: State, options: { prefix: string; label: string; words: { group: string; loose: string }; viewBox?: Box; groups?: boolean; overlay?: string; sizeWidth?: number }): string {
  const { steps, frames, arrows } = live(state);
  const byId = new Map(steps.map(step => [step.id, step]));
  const parts: string[] = [];
  const frameBoxes = frames.flatMap(frame => { const box = around(steps.filter(step => step.frameId === frame.id), 28, 56); return box ? [{ frame, box }] : []; });
  const groups = new Map<string, Step[]>();
  for (const step of steps) if (isStepV2(step) && step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  const groupBoxes = options.groups === false ? [] : [...groups.values()].map((members, index) => ({ name: `${options.words.group} ${index + 1}`, box: around(members, 16, 40)! }));
  const own = schematicBounds(state), view = options.viewBox ?? own;
  parts.push(`<defs><marker id="${options.prefix}-tip" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1.5 L 9 5 L 1 8.5 z" class="sch-tip"/></marker></defs>`);
  for (const { frame, box } of frameBoxes) {
    parts.push(`<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="12" class="sch-frame"/>`);
    parts.push(`<text x="${n(box.x + 14)}" y="${n(box.y + 32)}" class="sch-frame-label">${xml(frame.name)}</text>`);
  }
  for (const { name, box } of groupBoxes) {
    parts.push(`<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="10" class="sch-group"/>`);
    parts.push(`<text x="${n(box.x + 12)}" y="${n(box.y + 27)}" class="sch-group-label">${xml(name)}</text>`);
  }
  const centre = (step: Step): [number, number] => [step.x + step.width / 2, step.y + step.height / 2];

  // Where a line from inside a step leaves its shape: the rectangle's, ellipse's or diamond's outline
  // around the line's own point (an offset line is moved sideways with its point).
  const edge = (step: Step, from: [number, number], to: [number, number], gap: number): [number, number] => {
    const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
    if (!length) return from;
    const shape = isStepV2(step) ? step.shape : 'rectangle', c = centre(step), hw = step.width / 2, hh = step.height / 2;
    // Solve for the scale s at which from + s·d lies on the outline (centred at c).
    const ox = from[0] - c[0], oy = from[1] - c[1];
    let scale: number;
    if (shape === 'ellipse') {
      const a = (dx / hw) ** 2 + (dy / hh) ** 2, b = 2 * ((ox * dx) / hw ** 2 + (oy * dy) / hh ** 2), k = (ox / hw) ** 2 + (oy / hh) ** 2 - 1;
      scale = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * k))) / (2 * a);
    } else if (shape === 'diamond') {
      // The diamond is four half-planes sx·x/hw + sy·y/hh ≤ 1; the ray leaves at the first one it meets.
      scale = Infinity;
      for (const sx of [1, -1]) for (const sy of [1, -1]) {
        const towards = (sx * dx) / hw + (sy * dy) / hh;
        if (towards > 0) scale = Math.min(scale, (1 - (sx * ox) / hw - (sy * oy) / hh) / towards);
      }
    } else scale = Math.min(dx ? ((Math.sign(dx) * hw) - ox) / dx : Infinity, dy ? ((Math.sign(dy) * hh) - oy) / dy : Infinity);
    return [from[0] + dx * scale + (dx / length) * gap, from[1] + dy * scale + (dy / length) * gap];
  };
  const ring = (point: [number, number]): string => `<circle cx="${n(point[0])}" cy="${n(point[1])}" r="8" class="sch-loose"/><text x="${n(point[0])}" y="${n(point[1] - 16)}" text-anchor="middle" class="sch-loose-label">${xml(options.words.loose)}</text>`;
  const free = freeArrows(state);
  free.forEach((_, index) => {
    const y = own.y + own.height - 40, x = own.x + 40 + index * 160;
    parts.push(`<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + 100)}" y2="${n(y)}" class="sch-edge"/>${ring([x, y])}${ring([x + 100, y])}`);
  });
  // Arrows between the same two steps (either direction) are drawn side by side, never on one line.
  const between = new Map<string, Arrow[]>();
  for (const arrow of arrows) if (arrow.from && arrow.to && byId.has(arrow.from) && byId.has(arrow.to) && arrow.from !== arrow.to) {
    const key = [arrow.from, arrow.to].sort().join('\u0000');
    between.set(key, [...(between.get(key) ?? []), arrow]);
  }
  const offsetOf = (arrow: Arrow): number => {
    if (!arrow.from || !arrow.to) return 0;
    const siblings = between.get([arrow.from, arrow.to].sort().join('\u0000')) ?? [];
    return siblings.length < 2 ? 0 : (siblings.indexOf(arrow) - (siblings.length - 1) / 2) * 18;
  };
  for (const arrow of arrows) {
    const source = arrow.from ? byId.get(arrow.from) : undefined, target = arrow.to ? byId.get(arrow.to) : undefined;
    if (!source && !target) continue;
    if (source && target && source.id === target.id) {
      const top = source.y, right = source.x + source.width;
      parts.push(`<path d="M ${n(right)} ${n(top + source.height / 2)} C ${n(right + 80)} ${n(top + source.height / 2)} ${n(right + 80)} ${n(top - 60)} ${n(source.x + source.width / 2)} ${n(top - 4)}" class="sch-edge" marker-end="url(#${options.prefix}-tip)"/>`);
      continue;
    }
    let a: [number, number] = source ? centre(source) : [centre(target!)[0] - target!.width / 2 - 80, centre(target!)[1]];
    let b: [number, number] = target ? centre(target) : [centre(source!)[0] + source!.width / 2 + 80, centre(source!)[1]];
    // A sideways offset, perpendicular to the line and the same for either direction of the pair.
    const offset = offsetOf(arrow);
    if (offset && source && target) {
      const [first, second] = [source, target].sort((x, y) => x.id.localeCompare(y.id));
      const p = centre(first!), q = centre(second!), length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const nx = -(q[1] - p[1]) / length * offset, ny = (q[0] - p[0]) / length * offset;
      a = [a[0] + nx, a[1] + ny]; b = [b[0] + nx, b[1] + ny];
    }
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
        : `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" class="${classes}"/>`);
    const { rows, leading, first } = stepLabel(step);
    parts.push(`<text x="${n(x + w / 2)}" y="${n(first)}" text-anchor="middle" class="${filled ? 'sch-label sch-label--on-fill' : 'sch-label'}">${rows.map((row, index) => `<tspan x="${n(x + w / 2)}" dy="${index ? n(leading) : '0'}">${xml(row)}</tspan>`).join('')}</text>`);
  }
  return `<svg viewBox="${n(view.x)} ${n(view.y)} ${n(view.width)} ${n(view.height)}" class="schematic ${pictureSizeClass(options.sizeWidth ?? view.width)}" role="img" aria-label="${xml(options.label)}">${parts.join('')}${options.overlay ?? ''}</svg>`;
}

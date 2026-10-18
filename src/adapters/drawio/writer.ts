/**
 * world/2 state -> draw.io cells (PADR-0049 decision 5.1). The adapter writes what draw.io's codec
 * writes back, so its full write check can compare every attribute and child element:
 *
 * - root `pn:root`, one layer `pn:layer`; a group cell `pn:group:<groupId>` (`:` lies outside the
 *   semantic id pattern, so no object can take these ids);
 * - a frame is a container vertex whose geometry is the envelope of its steps plus padding and a title
 *   band (an empty frame keeps its last box); a group's geometry is the envelope of its members;
 * - a step is a vertex with one shape token, `html=0` and the adapter's own colours, child of its
 *   group, else its frame, else the layer, at integer coordinates relative to that parent;
 * - an `x` or `y` of 0 is left out, as the codec exports it (measured);
 * - no `whiteSpace=wrap` (measured: it puts labels into `foreignObject` HTML in the SVG export);
 * - an arrow is an edge with its live ends; a loose end keeps the last point the adapter knew.
 *
 * Labels are plain text (`html=0`), never markup. The derived memory is reset by every start,
 * `restoreState` and recovery (decision 5.1), so what is written after them depends on the state alone.
 */
import type { Arrow, Frame, State, StepV2 } from '../../world/types.ts';

export const ROOT = 'pn:root';
export const LAYER = 'pn:layer';
export const GROUP_PREFIX = 'pn:group:';
export const FRAME_PAD = 20;
export const FRAME_TITLE = 30;
export const FRAME_STYLE = `swimlane;container=1;collapsible=0;startSize=${FRAME_TITLE};html=0;`;
export const GROUP_STYLE = 'group;';
export const EDGE_STYLE = 'endArrow=classic;html=0;';
export const STROKE_HEX: Readonly<Record<StepV2['stroke'], string>> = Object.freeze({ black: '#000000', red: '#b85450', green: '#82b366', blue: '#6c8ebf', orange: '#d79b00' });
export const FILL_HEX: Readonly<Record<StepV2['fill'], string>> = Object.freeze({ none: 'none', red: '#f8cecc', green: '#d5e8d4', blue: '#dae8fc', yellow: '#fff2cc' });
export const SHAPE_TOKEN: Readonly<Record<StepV2['shape'], string>> = Object.freeze({ rectangle: 'rounded=0;', ellipse: 'ellipse;', diamond: 'rhombus;' });
export const stepStyle = (step: Pick<StepV2, 'shape' | 'stroke' | 'fill'>): string => `${SHAPE_TOKEN[step.shape]}html=0;strokeColor=${STROKE_HEX[step.stroke]};fillColor=${FILL_HEX[step.fill]};`;

/** One XML element: a cell or one of its children. Attributes are compared as sets. */
export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[] }

export class WriterError extends Error { readonly code = 'constraint_refused'; }

interface Box { x: number; y: number; width: number; height: number }
const envelope = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
};

/** Derived geometry the state does not hold. */
export interface WriterMemory { frames: Map<string, Box>; centres: Map<string, { x: number; y: number }>; loose: Map<string, { source?: { x: number; y: number }; target?: { x: number; y: number } }> }
export const freshMemory = (): WriterMemory => ({ frames: new Map(), centres: new Map(), loose: new Map() });
export const cloneMemory = (memory: WriterMemory): WriterMemory => ({ frames: new Map(memory.frames), centres: new Map(memory.centres), loose: new Map([...memory.loose].map(([id, ends]) => [id, { ...ends }])) });

const node = (name: string, attrs: Record<string, string>, children: XmlNode[] = []): XmlNode => ({ name, attrs, children });
const xy = (x: number, y: number): Record<string, string> => ({ ...(x !== 0 ? { x: String(x) } : {}), ...(y !== 0 ? { y: String(y) } : {}) });
const geometry = (b: Box, origin: { x: number; y: number }): XmlNode => node('mxGeometry', { ...xy(b.x - origin.x, b.y - origin.y), width: String(b.width), height: String(b.height), as: 'geometry' });

/** The live objects of `state` as the cells under the model's root, in a fixed order. */
export function writeCells(state: State, memory: WriterMemory): XmlNode[] {
  const live = Object.values(state.objects).filter(o => !o.deleted).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const frames = live.filter((o): o is Frame => o.type === 'frame');
  const steps = live.filter((o): o is StepV2 => o.type === 'step');
  const arrows = live.filter((o): o is Arrow => o.type === 'arrow');
  if (steps.some(step => !Object.hasOwn(step, 'shape'))) throw new WriterError('draw.io holds world/2 steps only');
  const groups = new Map<string, StepV2[]>();
  for (const step of steps) if (step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  const groupBox = new Map<string, { frameId: string | null; box: Box }>();
  for (const [groupId, members] of [...groups].sort(([a], [b]) => a < b ? -1 : 1)) {
    if (new Set(members.map(m => m.frameId)).size > 1) throw new WriterError(`group ${groupId} spans frames`);
    groupBox.set(groupId, { frameId: members[0]!.frameId, box: envelope(members) });
  }
  const frameBox = new Map<string, Box>();
  for (const frame of frames) {
    const members = steps.filter(s => s.frameId === frame.id);
    const box = members.length ? (() => { const e = envelope(members); return { x: e.x - FRAME_PAD, y: e.y - FRAME_PAD - FRAME_TITLE, width: e.width + 2 * FRAME_PAD, height: e.height + 2 * FRAME_PAD + FRAME_TITLE }; })()
      : memory.frames.get(frame.id) ?? { x: 0, y: -400, width: 200, height: 120 };
    frameBox.set(frame.id, box); memory.frames.set(frame.id, box);
  }
  const origin = (parent: string): { x: number; y: number } => {
    if (parent === LAYER) return { x: 0, y: 0 };
    const b = parent.startsWith(GROUP_PREFIX) ? groupBox.get(parent.slice(GROUP_PREFIX.length))!.box : frameBox.get(parent)!;
    return { x: b.x, y: b.y };
  };
  const cells: XmlNode[] = [node('mxCell', { id: ROOT }), node('mxCell', { id: LAYER, parent: ROOT })];
  for (const frame of frames) cells.push(node('mxCell', { id: frame.id, value: frame.name, style: FRAME_STYLE, vertex: '1', parent: LAYER }, [geometry(frameBox.get(frame.id)!, { x: 0, y: 0 })]));
  for (const [groupId, group] of groupBox) {
    const parent = group.frameId ?? LAYER;
    cells.push(node('mxCell', { id: GROUP_PREFIX + groupId, value: '', style: GROUP_STYLE, vertex: '1', connectable: '0', parent }, [geometry(group.box, origin(parent))]));
  }
  for (const step of steps) {
    const parent = step.groupId !== null ? GROUP_PREFIX + step.groupId : step.frameId ?? LAYER;
    cells.push(node('mxCell', { id: step.id, value: step.label, style: stepStyle(step), vertex: '1', parent }, [geometry(step, origin(parent))]));
    memory.centres.set(step.id, { x: step.x + Math.round(step.width / 2), y: step.y + Math.round(step.height / 2) });
  }
  for (const arrow of arrows) {
    const parent = arrow.frameId ?? LAYER, o = origin(parent), loose = memory.loose.get(arrow.id) ?? {};
    const points: XmlNode[] = [];
    for (const [end, ref] of [['source', arrow.from], ['target', arrow.to]] as const) {
      if (ref !== null) { const centre = memory.centres.get(ref); if (centre) loose[end] = centre; continue; }
      const point = loose[end] ?? { x: 0, y: 0 };
      loose[end] = point;
      points.push(node('mxPoint', { ...xy(point.x - o.x, point.y - o.y), as: `${end}Point` }));
    }
    memory.loose.set(arrow.id, loose);
    cells.push(node('mxCell', { id: arrow.id, value: '', style: EDGE_STYLE, edge: '1', parent, ...(arrow.from !== null ? { source: arrow.from } : {}), ...(arrow.to !== null ? { target: arrow.to } : {}) }, [node('mxGeometry', { relative: '1', as: 'geometry' }, points)]));
  }
  return cells;
}

/** Attribute text: the five XML escapes, and tab, LF and CR as character references. */
export const escapeAttribute = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/\n/g, '&#xa;').replace(/\r/g, '&#xd;').replace(/\t/g, '&#x9;');
const serialise = (n: XmlNode): string => `<${n.name}${Object.entries(n.attrs).map(([k, v]) => ` ${k}="${escapeAttribute(v)}"`).join('')}${n.children.length ? `>${n.children.map(serialise).join('')}</${n.name}>` : '/>'}`;
/** The `mxGraphModel` that `load` writes. */
export const modelXml = (cells: readonly XmlNode[]): string => `<mxGraphModel><root>${cells.map(serialise).join('')}</root></mxGraphModel>`;

/**
 * The world/2 -> draw.io mapping that PADR-0049 decision 5.1 decides, for its re-measurement
 * (`shell.ts`). It differs from the spike's `writer.ts` in four points: root and layer cells are
 * `pn:root` and `pn:layer`; a group cell is `pn:group:<groupId>`; step styles carry no
 * `whiteSpace=wrap`; a group whose live members sit in different frames is refused (decision 5.2),
 * never written as a cell attribute.
 *
 * It also holds the measurement's full write check: every attribute and every child element of every
 * cell element the writer wrote must come back exactly, and no other cell may come back. Only file
 * metadata (`mxfile`, `diagram`, `mxGraphModel` attributes) is outside it. It uses the spike's XML
 * tokenizer on both sides; the product's adapter reads the export with the browser's parser instead.
 */
import type { Arrow, Frame, State, StepV2 } from '../../src/world/types.ts';
import { parseXml, type XmlElement } from './parser.ts';

export const ROOT = 'pn:root';
export const LAYER = 'pn:layer';
export const GROUP_PREFIX = 'pn:group:';
const FRAME_PAD = 20, FRAME_TITLE = 30;
const STROKE: Record<StepV2['stroke'], string> = { black: '#000000', red: '#b85450', green: '#82b366', blue: '#6c8ebf', orange: '#d79b00' };
const FILL: Record<StepV2['fill'], string> = { none: 'none', red: '#f8cecc', green: '#d5e8d4', blue: '#dae8fc', yellow: '#fff2cc' };
const SHAPE: Record<StepV2['shape'], string> = { rectangle: 'rounded=0;', ellipse: 'ellipse;', diamond: 'rhombus;' };

export class ConstraintError extends Error { readonly code = 'group-within-one-frame'; }

const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/\n/g, '&#xa;').replace(/\r/g, '&#xd;').replace(/\t/g, '&#x9;');
interface Box { x: number; y: number; width: number; height: number }
const envelope = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
};

/** Derived geometry kept between writes: the last box of an empty frame, the last point of a loose end. */
export class Memory {
  readonly frames = new Map<string, Box>();
  readonly centres = new Map<string, { x: number; y: number }>();
  readonly loose = new Map<string, { source?: { x: number; y: number }; target?: { x: number; y: number } }>();
}

/** The live objects of `state` as one `mxGraphModel`. */
export function decidedXml(state: State, memory = new Memory()): string {
  const live = Object.values(state.objects).filter(o => !o.deleted).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const frames = live.filter((o): o is Frame => o.type === 'frame');
  const steps = live.filter((o): o is StepV2 => o.type === 'step');
  const arrows = live.filter((o): o is Arrow => o.type === 'arrow');
  const groups = new Map<string, StepV2[]>();
  for (const step of steps) if (step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  const groupBox = new Map<string, { frameId: string | null; box: Box }>();
  for (const [groupId, members] of groups) {
    if (new Set(members.map(m => m.frameId)).size > 1) throw new ConstraintError(`group ${groupId} spans frames`);
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
    if (parent.startsWith(GROUP_PREFIX)) { const b = groupBox.get(parent.slice(GROUP_PREFIX.length))!.box; return { x: b.x, y: b.y }; }
    const b = frameBox.get(parent)!; return { x: b.x, y: b.y };
  };
  // draw.io's codec leaves out an x or y of 0 when it exports (measured), so the writer does too and
  // the full write check can compare what was written with what comes back, attribute for attribute.
  const xy = (x: number, y: number): string => `${x !== 0 ? ` x="${x}"` : ''}${y !== 0 ? ` y="${y}"` : ''}`;
  const geometry = (b: Box, o: { x: number; y: number }): string => `<mxGeometry${xy(b.x - o.x, b.y - o.y)} width="${b.width}" height="${b.height}" as="geometry"/>`;
  const out: string[] = ['<mxGraphModel><root>', `<mxCell id="${ROOT}"/>`, `<mxCell id="${LAYER}" parent="${ROOT}"/>`];
  for (const frame of frames) out.push(`<mxCell id="${escapeAttr(frame.id)}" value="${escapeAttr(frame.name)}" style="swimlane;container=1;collapsible=0;startSize=${FRAME_TITLE};html=0;" vertex="1" parent="${LAYER}">${geometry(frameBox.get(frame.id)!, { x: 0, y: 0 })}</mxCell>`);
  for (const [groupId, group] of groupBox) {
    const parent = group.frameId ?? LAYER;
    out.push(`<mxCell id="${escapeAttr(GROUP_PREFIX + groupId)}" value="" style="group;" vertex="1" connectable="0" parent="${escapeAttr(parent)}">${geometry(group.box, origin(parent))}</mxCell>`);
  }
  for (const step of steps) {
    const parent = step.groupId !== null ? GROUP_PREFIX + step.groupId : step.frameId ?? LAYER;
    out.push(`<mxCell id="${escapeAttr(step.id)}" value="${escapeAttr(step.label)}" style="${SHAPE[step.shape]}html=0;strokeColor=${STROKE[step.stroke]};fillColor=${FILL[step.fill]};" vertex="1" parent="${escapeAttr(parent)}">${geometry(step, origin(parent))}</mxCell>`);
    memory.centres.set(step.id, { x: step.x + Math.round(step.width / 2), y: step.y + Math.round(step.height / 2) });
  }
  for (const arrow of arrows) {
    const parent = arrow.frameId ?? LAYER, o = origin(parent), loose = memory.loose.get(arrow.id) ?? {};
    const points: string[] = [];
    for (const [end, ref] of [['source', arrow.from], ['target', arrow.to]] as const) {
      if (ref !== null) { const centre = memory.centres.get(ref); if (centre) loose[end] = centre; continue; }
      const point = loose[end] ?? { x: 0, y: 0 };
      loose[end] = point;
      points.push(`<mxPoint${xy(point.x - o.x, point.y - o.y)} as="${end}Point"/>`);
    }
    memory.loose.set(arrow.id, loose);
    const ends = `${arrow.from !== null ? ` source="${escapeAttr(arrow.from)}"` : ''}${arrow.to !== null ? ` target="${escapeAttr(arrow.to)}"` : ''}`;
    out.push(`<mxCell id="${escapeAttr(arrow.id)}" value="" style="endArrow=classic;html=0;" edge="1" parent="${escapeAttr(parent)}"${ends}><mxGeometry relative="1" as="geometry">${points.join('')}</mxGeometry></mxCell>`);
  }
  out.push('</root></mxGraphModel>');
  return out.join('');
}

/** The model element of a bare model or a one-page uncompressed file. */
function modelOf(xml: string): XmlElement {
  const top = parseXml(xml);
  const elements = (e: XmlElement): XmlElement[] => e.children.filter((c): c is XmlElement => typeof c !== 'string');
  const model = top.name === 'mxfile' ? elements(elements(top).find(e => e.name === 'diagram')!).find(e => e.name === 'mxGraphModel')! : top;
  return elements(model).find(e => e.name === 'root')!;
}
/** An element as canonical text: name, sorted attributes, child elements in order, non-blank text. */
function canonical(e: XmlElement): string {
  const attrs = Object.keys(e.attrs).sort().map(k => [k, e.attrs[k]]);
  const children = e.children.map(c => typeof c === 'string' ? (c.trim() ? JSON.stringify(c) : '') : canonical(c)).filter(Boolean);
  return JSON.stringify([e.name, attrs, children]);
}
/** Every difference between the written and the read-back cell elements (empty when the write landed exactly). */
export function fullWriteCheck(writtenXml: string, readXml: string): string[] {
  const table = (xml: string): Map<string, string> => {
    const out = new Map<string, string>();
    for (const c of modelOf(xml).children) {
      if (typeof c === 'string') continue;
      const id = c.attrs.id ?? '';
      out.set(out.has(id) ? `${id}#dup${out.size}` : id, canonical(c));
    }
    return out;
  };
  const written = table(writtenXml), read = table(readXml), problems: string[] = [];
  for (const [id, text] of written) {
    const back = read.get(id);
    if (back === undefined) problems.push(`${id}: written, not read back`);
    else if (back !== text) problems.push(`${id}: written ${text.slice(0, 220)} read ${back.slice(0, 220)}`);
  }
  for (const id of read.keys()) if (!written.has(id)) problems.push(`${id}: read back, not written`);
  return problems.slice(0, 20);
}

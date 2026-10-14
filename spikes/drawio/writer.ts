/**
 * world/2 state -> draw.io `mxGraphModel` XML (the adapter side of the spike).
 *
 * The adapter computes what draw.io does not derive itself on a programmatic `load`: frame (container)
 * and group geometry as envelopes of their members, child coordinates relative to their parent, and
 * terminal points for arrow ends whose step was deleted. Labels are plain text (`html=0`) and are
 * XML-escaped; nothing from a world is ever written as markup. It does not import the spike's parser.
 */
import type { Arrow, Frame, State, StepV2 } from '../../src/world/types.ts';

const STROKE_HEX: Record<StepV2['stroke'], string> = { black: '#000000', red: '#b85450', green: '#82b366', blue: '#6c8ebf', orange: '#d79b00' };
const FILL_HEX: Record<StepV2['fill'], string> = { none: 'none', red: '#f8cecc', green: '#d5e8d4', blue: '#dae8fc', yellow: '#fff2cc' };
const SHAPE_STYLE: Record<StepV2['shape'], string> = { rectangle: 'rounded=0;', ellipse: 'ellipse;', diamond: 'rhombus;' };
export const FRAME_PAD = 20;
export const FRAME_TITLE = 30;
const LAYER = '1';

export class InexpressibleError extends Error { readonly code = 'inexpressible'; }

/** How a group whose members sit in different frames is written (the native tree has one parent per cell). */
export type CrossFrameGroups = 'refuse' | 'data-attribute';

const escapeAttr = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/\n/g, '&#xa;').replace(/\r/g, '&#xd;').replace(/\t/g, '&#x9;');

interface Box { x: number; y: number; width: number; height: number }
const envelope = (boxes: Box[]): Box => {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return { x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y };
};

/** Remembers derived geometry between writes (frames without members, ends of deleted steps). */
export class WriterMemory {
  readonly frames = new Map<string, Box>();
  readonly centres = new Map<string, { x: number; y: number }>();
  readonly loose = new Map<string, { source?: { x: number; y: number }; target?: { x: number; y: number } }>();
}

export interface Written { xml: string; cells: number; dataGroups: string[] }

/** Writes the live objects of `state`. Tombstones have no cell. */
export function stateToXml(state: State, memory = new WriterMemory(), crossFrameGroups: CrossFrameGroups = 'refuse'): Written {
  const live = Object.values(state.objects).filter(o => !o.deleted).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const frames = live.filter((o): o is Frame => o.type === 'frame');
  const steps = live.filter((o): o is StepV2 => o.type === 'step');
  const arrows = live.filter((o): o is Arrow => o.type === 'arrow');
  for (const step of steps) if (!Object.hasOwn(step, 'shape')) throw new InexpressibleError('world/1 steps are outside this spike');

  // Groups: native when every member shares one frame, otherwise refused or written as cell data.
  const groups = new Map<string, StepV2[]>();
  for (const step of steps) if (step.groupId !== null) groups.set(step.groupId, [...(groups.get(step.groupId) ?? []), step]);
  const nativeGroups = new Map<string, { frameId: string | null; box: Box }>();
  const dataGroups: string[] = [];
  for (const [groupId, members] of groups) {
    const frameIds = new Set(members.map(m => m.frameId));
    if (frameIds.size === 1) nativeGroups.set(groupId, { frameId: members[0]!.frameId, box: envelope(members) });
    else if (crossFrameGroups === 'data-attribute') dataGroups.push(groupId);
    else throw new InexpressibleError(`group ${groupId} spans frames ${[...frameIds].join(', ')}: a draw.io cell has one parent`);
  }

  // Frames: envelope of their steps plus padding and the title band; empty frames keep their last box.
  const frameBox = new Map<string, Box>();
  for (const frame of frames) {
    const members = steps.filter(s => s.frameId === frame.id);
    const box = members.length ? (() => { const e = envelope(members); return { x: e.x - FRAME_PAD, y: e.y - FRAME_PAD - FRAME_TITLE, width: e.width + 2 * FRAME_PAD, height: e.height + 2 * FRAME_PAD + FRAME_TITLE }; })()
      : memory.frames.get(frame.id) ?? { x: 0, y: -400, width: 200, height: 120 };
    frameBox.set(frame.id, box);
    memory.frames.set(frame.id, box);
  }
  const origin = (parent: string): { x: number; y: number } => {
    if (parent === LAYER) return { x: 0, y: 0 };
    const group = nativeGroups.get(parent);
    if (group) return { x: group.box.x, y: group.box.y };
    const frame = frameBox.get(parent);
    if (frame) return { x: frame.x, y: frame.y };
    throw new InexpressibleError(`unknown parent ${parent}`);
  };

  const out: string[] = ['<mxGraphModel><root>', '<mxCell id="0"/>', `<mxCell id="${LAYER}" parent="0"/>`];
  for (const frame of frames) {
    const b = frameBox.get(frame.id)!;
    out.push(`<mxCell id="${escapeAttr(frame.id)}" value="${escapeAttr(frame.name)}" style="swimlane;container=1;collapsible=0;startSize=${FRAME_TITLE};html=0;" vertex="1" parent="${LAYER}"><mxGeometry x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" as="geometry"/></mxCell>`);
  }
  for (const [groupId, group] of nativeGroups) {
    const parent = group.frameId ?? LAYER, o = origin(parent), b = group.box;
    out.push(`<mxCell id="${escapeAttr(groupId)}" value="" style="group;" vertex="1" connectable="0" parent="${escapeAttr(parent)}"><mxGeometry x="${b.x - o.x}" y="${b.y - o.y}" width="${b.width}" height="${b.height}" as="geometry"/></mxCell>`);
  }
  for (const step of steps) {
    const parent = step.groupId !== null && nativeGroups.has(step.groupId) ? step.groupId : step.frameId ?? LAYER;
    const o = origin(parent);
    const style = `${SHAPE_STYLE[step.shape]}whiteSpace=wrap;html=0;strokeColor=${STROKE_HEX[step.stroke]};fillColor=${FILL_HEX[step.fill]};`;
    const geometry = `<mxGeometry x="${step.x - o.x}" y="${step.y - o.y}" width="${step.width}" height="${step.height}" as="geometry"/>`;
    const cell = `vertex="1" parent="${escapeAttr(parent)}"`;
    if (step.groupId !== null && dataGroups.includes(step.groupId)) out.push(`<object id="${escapeAttr(step.id)}" label="${escapeAttr(step.label)}" pnGroup="${escapeAttr(step.groupId)}"><mxCell style="${style}" ${cell}>${geometry}</mxCell></object>`);
    else out.push(`<mxCell id="${escapeAttr(step.id)}" value="${escapeAttr(step.label)}" style="${style}" ${cell}>${geometry}</mxCell>`);
    memory.centres.set(step.id, { x: step.x + Math.round(step.width / 2), y: step.y + Math.round(step.height / 2) });
  }
  for (const arrow of arrows) {
    const parent = arrow.frameId ?? LAYER, o = origin(parent);
    const loose = memory.loose.get(arrow.id) ?? {};
    const points: string[] = [];
    for (const [end, ref] of [['source', arrow.from], ['target', arrow.to]] as const) {
      if (ref !== null) { const centre = memory.centres.get(ref); if (centre) loose[end] = centre; continue; }
      const point = loose[end] ?? { x: 0, y: 0 };
      loose[end] = point;
      points.push(`<mxPoint x="${point.x - o.x}" y="${point.y - o.y}" as="${end}Point"/>`);
    }
    memory.loose.set(arrow.id, loose);
    const ends = `${arrow.from !== null ? ` source="${escapeAttr(arrow.from)}"` : ''}${arrow.to !== null ? ` target="${escapeAttr(arrow.to)}"` : ''}`;
    out.push(`<mxCell id="${escapeAttr(arrow.id)}" value="" style="endArrow=classic;html=0;" edge="1" parent="${escapeAttr(parent)}"${ends}><mxGeometry relative="1" as="geometry">${points.join('')}</mxGeometry></mxCell>`);
  }
  out.push('</root></mxGraphModel>');
  return { xml: out.join(''), cells: out.length - 1, dataGroups };
}

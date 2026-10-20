/**
 * What the adapter does with draw.io's export (PADR-0049 decision 4.2): the full write check, the
 * integrity check and the projection onto world/2's live objects. The cell table comes from the
 * browser's own XML parser in the host page (decision 4.3), never from the checker's reader.
 */
import type { Arrow, Frame, State, StepV2, WorldObject } from '../../world/types.ts';
import { constraintViolation } from '../../world/constraints.ts';
import { structuralConstraintsOf } from '../../world/apps.ts';
import { EDGE_STYLE, FILL_HEX, FRAME_STYLE, GROUP_PREFIX, GROUP_STYLE, LAYER, ROOT, SHAPE_TOKEN, STROKE_HEX, type XmlNode } from './writer.ts';

const canonical = (n: XmlNode): string => JSON.stringify([n.name, Object.keys(n.attrs).sort().map(k => [k, n.attrs[k]]), n.children.map(canonical)]);
const idOf = (n: XmlNode): string => n.attrs.id ?? '';

/** Every difference between the written and the read-back cells: every attribute and child element of
 * every written element must come back exactly, and nothing may come back that was not written. */
export function writeCheck(written: readonly XmlNode[], read: readonly XmlNode[]): string[] {
  const table = (cells: readonly XmlNode[]): Map<string, string> => { const out = new Map<string, string>(); cells.forEach((cell, index) => out.set(out.has(idOf(cell)) ? `${idOf(cell)}#${index}` : idOf(cell), canonical(cell))); return out; };
  const mine = table(written), theirs = table(read), problems: string[] = [];
  for (const [id, text] of mine) {
    const back = theirs.get(id);
    if (back === undefined) problems.push(`${id}: written, not read back`);
    else if (back !== text) problems.push(`${id}: came back changed`);
  }
  for (const id of theirs.keys()) if (!mine.has(id)) problems.push(`${id}: read back, not written`);
  return problems.slice(0, 20);
}

const STEP_STYLE = new RegExp(`^(${Object.values(SHAPE_TOKEN).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})html=0;strokeColor=(#[0-9a-f]{6});fillColor=(none|#[0-9a-f]{6});$`);
const SHAPE_OF = Object.fromEntries(Object.entries(SHAPE_TOKEN).map(([shape, token]) => [token, shape])) as Record<string, StepV2['shape']>;
const STROKE_OF = Object.fromEntries(Object.entries(STROKE_HEX).map(([name, hex]) => [hex, name])) as Record<string, StepV2['stroke']>;
const FILL_OF = Object.fromEntries(Object.entries(FILL_HEX).map(([name, hex]) => [hex, name])) as Record<string, StepV2['fill']>;
const INTEGER = /^-?(0|[1-9][0-9]*)$/;
const CELL_KEYS: ReadonlySet<string> = new Set(['id', 'value', 'style', 'vertex', 'edge', 'parent', 'source', 'target', 'connectable']);
const VERTEX_GEOMETRY_KEYS: ReadonlySet<string> = new Set(['x', 'y', 'width', 'height', 'as']);
const EDGE_GEOMETRY_KEYS: ReadonlySet<string> = new Set(['relative', 'as']);

export interface ReadBack { state: State; issues: string[] }
/**
 * Integrity and projection in one pass. Integrity (decision 4.2): unique ids, one root, existing
 * parents, no cycle, no edge as a parent, edge ends are steps, no `html` value other than 0 (an absent
 * key counts as 0), integer geometry, only the adapter's own styles, colours and shapes, and every
 * structural constraint the application declares.
 */
export function readBack(cells: readonly XmlNode[], adapterId = 'drawio'): ReadBack {
  const issues: string[] = [];
  const byId = new Map<string, XmlNode>();
  for (const cell of cells) {
    if (cell.name !== 'mxCell') { issues.push(`unexpected element ${cell.name}`); continue; }
    if (byId.has(idOf(cell))) issues.push(`duplicate id ${idOf(cell)}`);
    byId.set(idOf(cell), cell);
    const html = /(?:^|;)html=([^;]*)/.exec(cell.attrs.style ?? '')?.[1];
    if (html !== undefined && html !== '0') issues.push(`html=${html} on ${idOf(cell)}`);
  }
  const roots = [...byId.values()].filter(cell => cell.attrs.parent === undefined);
  if (roots.length !== 1 || idOf(roots[0]!) !== ROOT) issues.push('the model has not exactly the adapter\'s root');
  const kind = (cell: XmlNode): 'root' | 'layer' | 'frame' | 'group' | 'step' | 'edge' | 'unknown' => {
    const id = idOf(cell), style = cell.attrs.style ?? '';
    if (id === ROOT) return 'root';
    if (id === LAYER) return 'layer';
    if (cell.attrs.edge === '1') return style === EDGE_STYLE && cell.attrs.vertex === undefined ? 'edge' : 'unknown';
    if (cell.attrs.vertex !== '1') return 'unknown';
    if (id.startsWith(GROUP_PREFIX)) return style === GROUP_STYLE ? 'group' : 'unknown';
    if (style === FRAME_STYLE) return 'frame';
    return STEP_STYLE.test(style) ? 'step' : 'unknown';
  };
  const kinds = new Map([...byId].map(([id, cell]) => [id, kind(cell)]));
  for (const [id, k] of kinds) if (k === 'unknown') issues.push(`a cell the adapter does not write: ${id}`);
  // Every attribute and child element must be one the adapter writes (review m2c, Codex 3): a cell hidden
  // with visible="0", collapsed, or given a value child after a confirmed write is an integrity failure.
  for (const [id, cell] of byId) {
    for (const key of Object.keys(cell.attrs)) if (!CELL_KEYS.has(key)) issues.push(`an attribute the adapter does not write: ${key} on ${id}`);
    const k = kinds.get(id);
    if (k === 'root' || k === 'layer') { if (cell.children.length || Object.keys(cell.attrs).some(key => key !== 'id' && key !== 'parent')) issues.push(`${id} holds more than the adapter writes`); continue; }
    const geometry = cell.children[0];
    if (cell.children.length !== 1 || geometry!.name !== 'mxGeometry' || geometry!.attrs.as !== 'geometry') { issues.push(`a child the adapter does not write on ${id}`); continue; }
    const edge = k === 'edge';
    for (const key of Object.keys(geometry!.attrs)) if (!(edge ? EDGE_GEOMETRY_KEYS : VERTEX_GEOMETRY_KEYS).has(key)) issues.push(`a geometry attribute the adapter does not write: ${key} on ${id}`);
    if (edge && geometry!.attrs.relative !== '1') issues.push(`an edge geometry that is not relative on ${id}`);
    for (const point of geometry!.children) {
      if (!edge || point.name !== 'mxPoint' || !['sourcePoint', 'targetPoint'].includes(point.attrs.as ?? '') || point.children.length || Object.keys(point.attrs).some(key => !['x', 'y', 'as'].includes(key))) issues.push(`a point the adapter does not write on ${id}`);
    }
  }
  // Parent chains: existing, acyclic, no edge as a parent.
  const ancestors = (id: string): string[] => {
    const chain: string[] = [];
    let current = byId.get(id)?.attrs.parent;
    while (current !== undefined) {
      if (chain.includes(current) || current === id || chain.length > 64) { issues.push(`a parent cycle at ${id}`); return chain; }
      const parent = byId.get(current);
      if (!parent) { issues.push(`missing parent ${current} of ${id}`); return chain; }
      if (kinds.get(current) === 'edge') { issues.push(`edge ${current} is the parent of ${id}`); return chain; }
      chain.push(current);
      current = parent.attrs.parent;
    }
    return chain;
  };
  const geometryOf = (cell: XmlNode): { x: number; y: number; width: number; height: number } | null => {
    const g = cell.children.find(child => child.name === 'mxGeometry' && child.attrs.as === 'geometry');
    if (!g) return null;
    const value = (key: string): number => { const raw = g.attrs[key] ?? '0'; if (!INTEGER.test(raw)) { issues.push(`${key}=${raw} on ${idOf(cell)} is not an integer`); return 0; } return Number(raw); };
    return { x: value('x'), y: value('y'), width: value('width'), height: value('height') };
  };
  const objects: Record<string, WorldObject> = {};
  for (const [id, cell] of byId) {
    const k = kinds.get(id);
    if (k === 'root' || k === 'layer' || k === 'unknown' || k === 'group') { if (k !== 'root') ancestors(id); continue; }
    const chain = ancestors(id);
    const frame = chain.find(a => kinds.get(a) === 'frame') ?? null;
    if (k === 'frame') { objects[id] = { id, type: 'frame', deleted: false, name: cell.attrs.value ?? '' } satisfies Frame; continue; }
    if (k === 'edge') {
      for (const end of ['source', 'target'] as const) { const ref = cell.attrs[end]; if (ref !== undefined && kinds.get(ref) !== 'step') issues.push(`edge ${id}'s ${end} ${ref} is not a step`); }
      objects[id] = { id, type: 'arrow', deleted: false, frameId: frame, from: cell.attrs.source ?? null, to: cell.attrs.target ?? null } satisfies Arrow;
      continue;
    }
    const g = geometryOf(cell);
    if (!g) { issues.push(`step ${id} has no geometry`); continue; }
    let x = g.x, y = g.y;
    for (const a of chain) { const k2 = kinds.get(a); if (k2 === 'frame' || k2 === 'group') { const ag = geometryOf(byId.get(a)!); if (ag) { x += ag.x; y += ag.y; } } }
    const [, token, stroke, fill] = STEP_STYLE.exec(cell.attrs.style ?? '')!;
    if (!STROKE_OF[stroke!] || !FILL_OF[fill!]) issues.push(`a colour the adapter does not write on ${id}`);
    const group = chain.find(a => kinds.get(a) === 'group');
    objects[id] = { id, type: 'step', deleted: false, frameId: frame, label: cell.attrs.value ?? '', x, y, width: g.width, height: g.height, shape: SHAPE_OF[token!]!, groupId: group ? group.slice(GROUP_PREFIX.length) : null, stroke: STROKE_OF[stroke!] ?? 'black', fill: FILL_OF[fill!] ?? 'none' } satisfies StepV2;
  }
  // An arrow's frame follows world/2's rule: its live ends' common frame, else none; with both ends
  // loose, the frame it sits in (the writer puts arrows with a live end on the layer).
  for (const object of Object.values(objects)) {
    if (object.type !== 'arrow') continue;
    const ends = [object.from, object.to].filter((end): end is string => end !== null).map(end => (objects[end] as StepV2 | undefined)?.frameId ?? null);
    if (ends.length) object.frameId = ends.every(frame => frame === ends[0]) ? ends[0]! : null;
  }
  const state: State = { objects };
  const violation = constraintViolation(state, structuralConstraintsOf(adapterId));
  if (violation) issues.push(`constraint ${violation.constraint} at ${violation.objectId}`);
  return { state, issues: issues.slice(0, 20) };
}

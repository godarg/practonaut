/**
 * Independent `.drawio` reader for the spike (the checker side).
 *
 * It parses draw.io's native file (an `mxfile` with one `diagram`, plain or deflate+Base64, or a bare
 * `mxGraphModel`) with its own bounded XML tokenizer, builds the cell tree, runs an integrity check
 * and projects the cells onto Practonaut's world/2 declared set. It imports nothing from the spike's
 * writer, from Practonaut's core or from Practonaut's Excalidraw parser; its colour table is its own.
 * The input is untrusted: sizes, depth and counts are bounded, DOCTYPE and unknown entities are refused.
 */
import { inflateRawSync } from 'node:zlib';

export const LIMITS = { bytes: 10 * 1024 * 1024, depth: 64, elements: 50_000, attributes: 128, inflated: 10 * 1024 * 1024 };

export interface XmlElement { name: string; attrs: Record<string, string>; children: XmlNode[] }
export type XmlNode = XmlElement | string;
export class DrawioParseError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.code = code; } }
const fail = (code: string, message: string): never => { throw new DrawioParseError(code, message); };

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const REFERENCE = /&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,4});/g;
function decodeEntities(text: string): string {
  // Every '&' in the raw text must start a complete reference; checked before anything is decoded.
  if (text.replace(REFERENCE, '').includes('&')) fail('xml_invalid', 'bare or unterminated ampersand');
  return text.replace(REFERENCE, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 1 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return fail('xml_invalid', 'invalid character reference');
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(ENTITIES, body) ? ENTITIES[body]! : fail('xml_invalid', `unknown entity ${whole}`);
  });
}

/** A small, strict XML reader for the subset draw.io writes: elements, attributes, text, comments. */
export function parseXml(input: string): XmlElement {
  if (input.length > LIMITS.bytes) fail('too_large', 'document exceeds the size limit');
  let i = 0, elements = 0;
  const root: XmlElement = { name: '#document', attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const name = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
  const space = /\s*/y;
  const skipSpace = (): void => { space.lastIndex = i; space.exec(input); i = space.lastIndex; };
  const readName = (): string => { name.lastIndex = i; const m = name.exec(input); if (!m) fail('xml_invalid', `name expected at ${i}`); i = name.lastIndex; return m![0]; };
  while (i < input.length) {
    const lt = input.indexOf('<', i);
    const textEnd = lt < 0 ? input.length : lt;
    if (textEnd > i) {
      const text = input.slice(i, textEnd);
      if (stack.length === 1) { if (text.trim()) fail('xml_invalid', 'text outside the root element'); }
      else stack.at(-1)!.children.push(decodeEntities(text));
      i = textEnd;
      continue;
    }
    if (input.startsWith('<?', i)) { const end = input.indexOf('?>', i); if (end < 0 || stack.length > 1) fail('xml_invalid', 'bad processing instruction'); i = end + 2; continue; }
    if (input.startsWith('<!--', i)) { const end = input.indexOf('-->', i + 4); if (end < 0) fail('xml_invalid', 'unterminated comment'); i = end + 3; continue; }
    if (input.startsWith('<![CDATA[', i)) { const end = input.indexOf(']]>', i); if (end < 0 || stack.length === 1) fail('xml_invalid', 'bad CDATA'); stack.at(-1)!.children.push(input.slice(i + 9, end)); i = end + 3; continue; }
    if (input.startsWith('<!', i)) fail('xml_doctype', 'DOCTYPE and declarations are refused');
    if (input.startsWith('</', i)) {
      i += 2; const closing = readName(); skipSpace();
      if (input[i] !== '>') fail('xml_invalid', 'bad closing tag');
      i++;
      const open = stack.pop();
      if (!open || open === root || open.name !== closing) fail('xml_invalid', `mismatched closing tag ${closing}`);
      continue;
    }
    i++;
    const element: XmlElement = { name: readName(), attrs: Object.create(null) as Record<string, string>, children: [] };
    if (++elements > LIMITS.elements) fail('too_large', 'too many elements');
    let selfClosing = false;
    for (;;) {
      skipSpace();
      if (input.startsWith('/>', i)) { i += 2; selfClosing = true; break; }
      if (input[i] === '>') { i++; break; }
      const key = readName(); skipSpace();
      if (input[i] !== '=') fail('xml_invalid', 'attribute without value');
      i++; skipSpace();
      const quote = input[i];
      if (quote !== '"' && quote !== "'") fail('xml_invalid', 'unquoted attribute');
      const end = input.indexOf(quote!, i + 1);
      if (end < 0) fail('xml_invalid', 'unterminated attribute');
      const raw = input.slice(i + 1, end);
      if (raw.includes('<')) fail('xml_invalid', 'raw < in attribute');
      if (Object.hasOwn(element.attrs, key)) fail('xml_invalid', `duplicate attribute ${key}`);
      // Attribute value normalisation: literal whitespace characters become spaces, references stay.
      element.attrs[key] = decodeEntities(raw.replace(/[\t\n\r]/g, ' '));
      if (Object.keys(element.attrs).length > LIMITS.attributes) fail('too_large', 'too many attributes');
      i = end + 1;
    }
    const parent = stack.at(-1)!;
    if (parent === root && root.children.some(c => typeof c !== 'string')) fail('xml_invalid', 'more than one root element');
    parent.children.push(element);
    if (!selfClosing) { stack.push(element); if (stack.length > LIMITS.depth) fail('too_large', 'nesting too deep'); }
  }
  if (stack.length !== 1) fail('xml_invalid', 'unclosed element');
  const top = root.children.find((c): c is XmlElement => typeof c !== 'string');
  return top ?? fail('xml_invalid', 'no root element');
}

const elementsOf = (e: XmlElement, name?: string): XmlElement[] => e.children.filter((c): c is XmlElement => typeof c !== 'string' && (name === undefined || c.name === name));
const textOf = (e: XmlElement): string => e.children.filter((c): c is string => typeof c === 'string').join('');

/** draw.io's compressed page: Base64 of raw deflate of encodeURIComponent(xml). */
export function decompressDiagram(text: string): string {
  const compact = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) fail('diagram_invalid', 'compressed diagram is not Base64');
  let bytes: Buffer;
  try { bytes = inflateRawSync(Buffer.from(compact, 'base64'), { maxOutputLength: LIMITS.inflated }); } catch { return fail('diagram_invalid', 'compressed diagram does not inflate'); }
  try { return decodeURIComponent(bytes.toString('latin1')); } catch { return fail('diagram_invalid', 'compressed diagram is not URI-encoded'); }
}

export interface Cell {
  id: string; parent: string | null; value: string; style: string; vertex: boolean; edge: boolean;
  source: string | null; target: string | null;
  geometry: { x: number; y: number; width: number; height: number; relative: boolean } | null;
  /** Attributes of an `object`/`UserObject` wrapper other than id and label (custom data). */
  data: Record<string, string>;
}
export interface DrawioFile { compressed: boolean; pages: number; model: XmlElement; cells: Cell[]; fileAttrs: Record<string, string>; diagramAttrs: Record<string, string> }

const num = (raw: string | undefined, field: string): number => {
  if (raw === undefined || raw === '') return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fail('geometry_invalid', `non-numeric ${field}`);
};

/** Reads an mxfile (first and only page) or a bare mxGraphModel into cells. */
export function readDrawio(text: string): DrawioFile {
  const top = parseXml(text);
  let model: XmlElement, compressed = false, pages = 1, fileAttrs: Record<string, string> = {}, diagramAttrs: Record<string, string> = {};
  if (top.name === 'mxfile') {
    fileAttrs = { ...top.attrs };
    const diagrams = elementsOf(top, 'diagram');
    pages = diagrams.length;
    if (pages !== 1) fail('pages_unsupported', `expected one page, found ${pages}`);
    const diagram = diagrams[0]!;
    diagramAttrs = { ...diagram.attrs };
    const inner = elementsOf(diagram, 'mxGraphModel');
    if (inner.length === 1) model = inner[0]!;
    else { compressed = true; model = parseXml(decompressDiagram(textOf(diagram))); }
  } else model = top;
  if (model.name !== 'mxGraphModel') fail('diagram_invalid', `expected mxGraphModel, found ${model.name}`);
  const roots = elementsOf(model, 'root');
  if (roots.length !== 1) fail('diagram_invalid', 'mxGraphModel needs exactly one root');
  const cells: Cell[] = [];
  for (const entry of elementsOf(roots[0]!)) {
    let cellElement: XmlElement, id: string | undefined, value: string | undefined, data: Record<string, string> = {};
    if (entry.name === 'mxCell') { cellElement = entry; id = entry.attrs.id; value = entry.attrs.value; }
    else if (entry.name === 'object' || entry.name === 'UserObject') {
      const inner = elementsOf(entry, 'mxCell');
      if (inner.length !== 1) fail('cell_invalid', `${entry.name} without exactly one mxCell`);
      cellElement = inner[0]!; id = entry.attrs.id; value = entry.attrs.label;
      data = Object.fromEntries(Object.entries(entry.attrs).filter(([k]) => k !== 'id' && k !== 'label' && k !== 'placeholders'));
    } else { fail('cell_invalid', `unexpected element ${entry.name} in root`); continue; }
    if (id === undefined) fail('cell_invalid', 'cell without id');
    const a = cellElement.attrs;
    const geometryElement = elementsOf(cellElement, 'mxGeometry')[0];
    const g = geometryElement?.attrs;
    cells.push({
      id: id!, parent: a.parent ?? null, value: value ?? '', style: a.style ?? '', vertex: a.vertex === '1', edge: a.edge === '1',
      source: a.source ?? null, target: a.target ?? null,
      geometry: g ? { x: num(g.x, 'x'), y: num(g.y, 'y'), width: num(g.width, 'width'), height: num(g.height, 'height'), relative: g.relative === '1' } : null,
      data,
    });
  }
  return { compressed, pages, model, cells, fileAttrs, diagramAttrs };
}

/** Style string: optional leading names (no '=') and key=value pairs, separated by ';'. */
export function parseStyle(style: string): { names: string[]; keys: Record<string, string> } {
  const names: string[] = [], keys: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const part of style.split(';')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq < 0) names.push(part); else keys[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { names, keys };
}

// The parser's own colour table (hex, lower case) for the world/2 palette names.
const STROKES: Record<string, string> = { '#000000': 'black', '#b85450': 'red', '#82b366': 'green', '#6c8ebf': 'blue', '#d79b00': 'orange' };
const FILLS: Record<string, string> = { none: 'none', '#f8cecc': 'red', '#d5e8d4': 'green', '#dae8fc': 'blue', '#fff2cc': 'yellow' };
// Style keys the mapping reads; anything else on a step is presentation (reported, not judged).
const STEP_KEYS = new Set(['html', 'whiteSpace', 'rounded', 'strokeColor', 'fillColor', 'shape', 'perimeter']);

export interface Issue { code: string; id: string; detail: string }
export interface Projection {
  /** world/2 objects (live only) on the declared set. */
  objects: Record<string, Record<string, string | number | boolean | null>>;
  issues: Issue[];
  unmodeled: Issue[];
  /** Style keys outside the mapping, per cell (presentation, excluded from the declared set). */
  extraStyle: Record<string, string[]>;
}

/** Integrity check and projection of the cell tree onto world/2 frames, steps and arrows. */
export function project(file: DrawioFile): Projection {
  const issues: Issue[] = [], unmodeled: Issue[] = [], extraStyle: Record<string, string[]> = {};
  const byId = new Map<string, Cell>();
  for (const cell of file.cells) {
    if (byId.has(cell.id)) issues.push({ code: 'duplicate_id', id: cell.id, detail: 'two cells share this id' });
    else byId.set(cell.id, cell);
  }
  const roots = file.cells.filter(c => c.parent === null);
  if (roots.length !== 1) issues.push({ code: 'root_count', id: roots.map(r => r.id).join(','), detail: `expected one root cell, found ${roots.length}` });
  const root = roots[0];
  const layers = new Set(file.cells.filter(c => root && c.parent === root.id).map(c => c.id));
  const kind = new Map<string, 'root' | 'layer' | 'frame' | 'group' | 'step' | 'edge' | 'other'>();
  for (const cell of byId.values()) {
    const { names, keys } = parseStyle(cell.style);
    if (cell === root) kind.set(cell.id, 'root');
    else if (layers.has(cell.id)) kind.set(cell.id, 'layer');
    else if (cell.edge && cell.vertex) { kind.set(cell.id, 'other'); issues.push({ code: 'vertex_and_edge', id: cell.id, detail: 'cell is both' }); }
    else if (cell.edge) kind.set(cell.id, 'edge');
    else if (!cell.vertex) { kind.set(cell.id, 'other'); unmodeled.push({ code: 'unknown_cell', id: cell.id, detail: 'neither vertex nor edge below a layer' }); }
    else if (names.includes('swimlane') || keys.container === '1') kind.set(cell.id, 'frame');
    else if (names.includes('group')) kind.set(cell.id, 'group');
    else {
      const shape = names.find(n => n === 'ellipse' || n === 'rhombus') ?? keys.shape;
      if (names.some(n => n !== 'ellipse' && n !== 'rhombus') || (shape !== undefined && shape !== 'ellipse' && shape !== 'rhombus' && shape !== 'rect')) { kind.set(cell.id, 'other'); unmodeled.push({ code: 'unknown_shape', id: cell.id, detail: cell.style.slice(0, 80) }); }
      else kind.set(cell.id, 'step');
    }
  }
  // Parent chains: every parent exists, no cycles, an edge is never a parent, depth bounded.
  const ancestors = (id: string): string[] | null => {
    const chain: string[] = [];
    let current = byId.get(id)?.parent ?? null;
    while (current !== null) {
      if (chain.includes(current) || current === id || chain.length > LIMITS.depth) { issues.push({ code: 'parent_cycle', id, detail: 'parent chain loops' }); return null; }
      const parent = byId.get(current);
      if (!parent) { issues.push({ code: 'missing_parent', id, detail: `parent ${current} does not exist` }); return null; }
      if (kind.get(current) === 'edge') { issues.push({ code: 'edge_parent', id, detail: `parent ${current} is an edge` }); return null; }
      chain.push(current);
      current = parent.parent;
    }
    return chain;
  };
  const absolute = (cell: Cell, chain: string[]): { x: number; y: number } => {
    let x = cell.geometry?.x ?? 0, y = cell.geometry?.y ?? 0;
    for (const id of chain) { const k = kind.get(id); if (k === 'frame' || k === 'group') { x += byId.get(id)!.geometry?.x ?? 0; y += byId.get(id)!.geometry?.y ?? 0; } }
    return { x, y };
  };
  const objects: Projection['objects'] = {};
  for (const cell of byId.values()) {
    const k = kind.get(cell.id);
    if (k === 'root' || k === 'layer' || k === 'other' || k === undefined) continue;
    const chain = ancestors(cell.id);
    if (!chain) continue;
    if (root && chain.at(-1) !== root.id) { issues.push({ code: 'detached', id: cell.id, detail: 'not below the root' }); continue; }
    const frame = chain.find(id => kind.get(id) === 'frame') ?? null;
    const { keys } = parseStyle(cell.style);
    if (k === 'frame') {
      if (chain.some(id => kind.get(id) === 'frame' || kind.get(id) === 'group' || kind.get(id) === 'step')) unmodeled.push({ code: 'nested_frame', id: cell.id, detail: 'frame inside another object' });
      if (keys.html === '1') issues.push({ code: 'markup_label', id: cell.id, detail: 'frame name is HTML' });
      objects[cell.id] = { id: cell.id, type: 'frame', deleted: false, name: cell.value };
      continue;
    }
    if (k === 'group') {
      if (chain.some(id => kind.get(id) === 'group' || kind.get(id) === 'step')) unmodeled.push({ code: 'nested_group', id: cell.id, detail: 'group inside a group or step' });
      continue;
    }
    if (k === 'step') {
      if (keys.html === '1') issues.push({ code: 'markup_label', id: cell.id, detail: 'step label is HTML (html=1)' });
      const g = cell.geometry;
      if (!g || g.relative) { issues.push({ code: 'geometry_missing', id: cell.id, detail: 'step without absolute geometry' }); continue; }
      const { x, y } = absolute(cell, chain);
      for (const [field, value] of [['x', x], ['y', y], ['width', g.width], ['height', g.height]] as const) if (!Number.isInteger(value)) issues.push({ code: 'non_integer', id: cell.id, detail: `${field}=${value}` });
      const names = parseStyle(cell.style).names;
      const shape = names.includes('ellipse') || keys.shape === 'ellipse' ? 'ellipse' : names.includes('rhombus') || keys.shape === 'rhombus' ? 'diamond' : 'rectangle';
      const strokeRaw = (keys.strokeColor ?? '#000000').toLowerCase(), fillRaw = (keys.fillColor ?? 'none').toLowerCase();
      const stroke = STROKES[strokeRaw], fill = FILLS[fillRaw];
      if (!stroke) unmodeled.push({ code: 'unknown_colour', id: cell.id, detail: `strokeColor=${strokeRaw}` });
      if (!fill) unmodeled.push({ code: 'unknown_colour', id: cell.id, detail: `fillColor=${fillRaw}` });
      const extra = Object.keys(keys).filter(key => !STEP_KEYS.has(key));
      if (extra.length) extraStyle[cell.id] = extra;
      const groupCell = chain.find(id => kind.get(id) === 'group');
      const dataGroup = cell.data.pnGroup;
      if (groupCell && dataGroup) issues.push({ code: 'two_groups', id: cell.id, detail: 'native group and data group' });
      objects[cell.id] = { id: cell.id, type: 'step', deleted: false, frameId: frame, label: cell.value, x, y, width: g.width, height: g.height, shape, groupId: groupCell ?? dataGroup ?? null, stroke: stroke ?? strokeRaw, fill: fill ?? fillRaw };
      continue;
    }
    // Edge: ends must be live step cells; an edge's own frame is its container ancestor.
    for (const [end, ref] of [['source', cell.source], ['target', cell.target]] as const) {
      if (ref === null) continue;
      if (!byId.has(ref)) issues.push({ code: 'dangling_reference', id: cell.id, detail: `${end} ${ref} does not exist` });
      else if (kind.get(ref) !== 'step') issues.push({ code: 'edge_end_not_step', id: cell.id, detail: `${end} ${ref} is a ${kind.get(ref)}` });
    }
    if (keys.html === '1' && cell.value) issues.push({ code: 'markup_label', id: cell.id, detail: 'edge label is HTML' });
    if (cell.value) unmodeled.push({ code: 'edge_label', id: cell.id, detail: 'edge labels are not modeled' });
    objects[cell.id] = { id: cell.id, type: 'arrow', deleted: false, frameId: frame, from: cell.source, to: cell.target };
  }
  return { objects, issues, unmodeled, extraStyle };
}

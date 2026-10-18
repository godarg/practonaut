/**
 * The checker's own `.drawio` reader (PADR-0049 decision 6): any draw.io file -> the world/2 state a
 * goal is judged on, plus what it does not model. Independent of the adapter (architecture §2): its own
 * bounded XML tokenizer, style parser and colour table; it imports nothing from `src/adapters` or
 * `src/core`. Where draw.io's codec would read a form differently, it follows the codec or refuses the
 * file; it never reads something the app does not show.
 *
 * Refusals are `artifact_invalid` with `details.reason` from a closed list.
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { Arrow, Frame, State, StepV2, StrokeColor, FillColor, Shape } from "../world/types.ts";
import { CheckerError } from "./errors.ts";
import { validateSubmissionState } from "./state.ts";

export const DRAWIO_READER_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, inflated: 10 * 1024 * 1024, elements: 50_000, depth: 64, attributes: 128, attributeChars: 65_536, styleChars: 4_096, styleKeys: 128, cells: 5_000, coordinate: 1_000_000, labelCodePoints: 4_096 });
export type DrawioRefusal = "too_large" | "xml_invalid" | "xml_doctype" | "pages_unsupported" | "diagram_invalid" | "cell_invalid" | "duplicate_id" | "structure_invalid" | "geometry_invalid" | "markup_label" | "text_invalid" | "unmodeled_value";
const refuse = (reason: DrawioRefusal, message: string): never => { throw new CheckerError("artifact_invalid", `.drawio: ${message}`, { reason }); };

// ---------- XML (the subset draw.io writes) ----------
interface El { name: string; attrs: Record<string, string>; children: Array<El | string> }
const xmlChar = (c: number): boolean => c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd) || (c >= 0x10000 && c <= 0x10ffff);
const PREDEFINED: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const REFERENCE = /&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,4});/g;
function decode(text: string): string {
  if (text.replace(REFERENCE, "").includes("&")) refuse("xml_invalid", "a bare or unterminated ampersand");
  return text.replace(REFERENCE, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!xmlChar(code)) refuse("xml_invalid", "a character reference outside the XML character set");
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(PREDEFINED, body) ? PREDEFINED[body]! : refuse("xml_invalid", `an unknown entity ${whole}`);
  });
}
/** One XML document: end-of-line handling first, then a strict, bounded reading. */
export function parseXml(raw: string): El {
  if (raw.length > DRAWIO_READER_LIMITS.bytes) refuse("too_large", "the document is over the size limit");
  const input = raw.replace(/\r\n?/g, "\n");
  for (const char of input) if (!xmlChar(char.codePointAt(0)!)) refuse("xml_invalid", "a character outside the XML character set");
  let i = 0, count = 0;
  const top: El = { name: "#document", attrs: {}, children: [] };
  const stack: El[] = [top];
  const nameAt = /[A-Za-z_:][A-Za-z0-9_.:-]*/y, spaceAt = /[ \t\n]*/y;
  const space = (): number => { spaceAt.lastIndex = i; spaceAt.exec(input); const n = spaceAt.lastIndex - i; i = spaceAt.lastIndex; return n; };
  const name = (): string => { nameAt.lastIndex = i; const m = nameAt.exec(input); if (!m) refuse("xml_invalid", `a name was expected at ${i}`); i = nameAt.lastIndex; return m![0]; };
  while (i < input.length) {
    const lt = input.indexOf("<", i), end = lt < 0 ? input.length : lt;
    if (end > i) {
      const text = input.slice(i, end);
      if (stack.length === 1) { if (text.trim()) refuse("xml_invalid", "text outside the root element"); }
      else stack.at(-1)!.children.push(decode(text));
      i = end; continue;
    }
    if (input.startsWith("<?", i)) { const close = input.indexOf("?>", i); if (close < 0 || stack.length > 1 || top.children.length) refuse("xml_invalid", "a misplaced processing instruction"); i = close + 2; continue; }
    if (input.startsWith("<!--", i)) { const close = input.indexOf("-->", i + 4); if (close < 0) refuse("xml_invalid", "an unterminated comment"); i = close + 3; continue; }
    if (input.startsWith("<![CDATA[", i)) { const close = input.indexOf("]]>", i); if (close < 0 || stack.length === 1) refuse("xml_invalid", "a misplaced CDATA section"); stack.at(-1)!.children.push(input.slice(i + 9, close)); i = close + 3; continue; }
    if (input.startsWith("<!", i)) refuse("xml_doctype", "DOCTYPE and declarations are refused");
    if (input.startsWith("</", i)) {
      i += 2; const closing = name(); space();
      if (input[i] !== ">") refuse("xml_invalid", "a malformed closing tag");
      i++;
      const open = stack.pop();
      if (!open || open === top || open.name !== closing) refuse("xml_invalid", `a mismatched closing tag ${closing.slice(0, 32)}`);
      continue;
    }
    i++;
    const element: El = { name: name(), attrs: Object.create(null) as Record<string, string>, children: [] };
    if (++count > DRAWIO_READER_LIMITS.elements) refuse("too_large", "too many elements");
    let selfClosing = false;
    for (let first = true; ; first = false) {
      const gap = space();
      if (input.startsWith("/>", i)) { i += 2; selfClosing = true; break; }
      if (input[i] === ">") { i++; break; }
      // XML requires white space between attributes.
      if (!first && gap === 0) refuse("xml_invalid", "attributes without white space between them");
      const key = name(); space();
      if (input[i] !== "=") refuse("xml_invalid", "an attribute without a value");
      i++; space();
      const quote = input[i];
      if (quote !== '"' && quote !== "'") refuse("xml_invalid", "an unquoted attribute");
      const close = input.indexOf(quote!, i + 1);
      if (close < 0) refuse("xml_invalid", "an unterminated attribute");
      const value = input.slice(i + 1, close);
      if (value.includes("<")) refuse("xml_invalid", "a raw < in an attribute");
      if (value.length > DRAWIO_READER_LIMITS.attributeChars) refuse("too_large", "an attribute value over the limit");
      if (Object.hasOwn(element.attrs, key)) refuse("xml_invalid", `a duplicate attribute ${key.slice(0, 32)}`);
      // Attribute-value normalisation: a literal tab or line feed becomes a space; references keep theirs.
      element.attrs[key] = decode(value.replace(/[\t\n]/g, " "));
      if (Object.keys(element.attrs).length > DRAWIO_READER_LIMITS.attributes) refuse("too_large", "too many attributes");
      i = close + 1;
    }
    const parent = stack.at(-1)!;
    if (parent === top && top.children.some(c => typeof c !== "string")) refuse("xml_invalid", "more than one root element");
    parent.children.push(element);
    if (!selfClosing) { stack.push(element); if (stack.length > DRAWIO_READER_LIMITS.depth) refuse("too_large", "nesting too deep"); }
  }
  if (stack.length !== 1) refuse("xml_invalid", "an unclosed element");
  const root = top.children.find((c): c is El => typeof c !== "string");
  return root ?? refuse("xml_invalid", "no root element");
}
const elements = (e: El): El[] => e.children.filter((c): c is El => typeof c !== "string");
const textOf = (e: El): string => e.children.map(c => typeof c === "string" ? c : textOf(c)).join("");

/** draw.io's compressed page: Base64 of raw deflate of the URI-encoded model. */
function inflatePage(text: string): string {
  const compact = text.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) refuse("diagram_invalid", "a compressed page that is not Base64");
  let bytes: Buffer;
  try { bytes = inflateRawSync(Buffer.from(compact, "base64"), { maxOutputLength: DRAWIO_READER_LIMITS.inflated }); }
  catch { return refuse("diagram_invalid", "a compressed page that does not inflate within the limit"); }
  try { return decodeURIComponent(bytes.toString("latin1")); } catch { return refuse("diagram_invalid", "a compressed page that is not URI-encoded"); }
}
/** The one page's `mxGraphModel`. */
function modelOf(top: El): El {
  let model = top;
  if (top.name === "mxfile") {
    const children = elements(top);
    if (children.some(c => c.name !== "diagram")) refuse("diagram_invalid", "an mxfile holds something other than diagrams");
    if (children.length !== 1) refuse("pages_unsupported", `${children.length} pages; one is read`);
    const diagram = children[0]!;
    // Compressed if and only if its text, descendants included, is not blank, as draw.io decides.
    if (textOf(diagram).trim() !== "") {
      if (elements(diagram).length) refuse("diagram_invalid", "a page with both compressed text and elements");
      model = parseXml(inflatePage(textOf(diagram)));
    } else {
      const inner = elements(diagram);
      if (inner.length !== 1 || inner[0]!.name !== "mxGraphModel") refuse("diagram_invalid", "a page without exactly one mxGraphModel");
      model = inner[0]!;
    }
  }
  if (model.name !== "mxGraphModel") refuse("diagram_invalid", `expected mxGraphModel, found ${model.name.slice(0, 32)}`);
  const roots = elements(model);
  if (roots.length !== 1 || roots[0]!.name !== "root") refuse("diagram_invalid", "the model needs exactly one root");
  return roots[0]!;
}

// ---------- cells ----------
interface Geometry { x: number; y: number; width: number; height: number; relative: boolean }
interface Cell { id: string; parent: string | null; value: string; style: string; vertex: boolean; edge: boolean; visible: boolean; collapsed: boolean; source: string | null; target: string | null; geometry: Geometry | null; placeholders: boolean; data: boolean }
const NUMBER = /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const flag = (value: string | undefined, field: string, id: string): boolean => {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  return refuse("cell_invalid", `${field}="${value.slice(0, 16)}" on ${id.slice(0, 64)} (only 0 or 1)`);
};
function geometryOf(cell: El, id: string): Geometry | null {
  const geometries = elements(cell).filter(child => child.attrs.as === "geometry");
  if (geometries.length > 1) refuse("cell_invalid", `two geometries on ${id.slice(0, 64)}`);
  const g = geometries[0];
  if (!g) return null;
  if (g.name !== "mxGeometry") refuse("cell_invalid", `a geometry that is not an mxGeometry on ${id.slice(0, 64)}`);
  const number = (key: string): number => {
    const raw = g.attrs[key];
    if (raw === undefined) return 0;
    if (!NUMBER.test(raw)) refuse("geometry_invalid", `${key}="${raw.slice(0, 16)}" on ${id.slice(0, 64)}`);
    return Number(raw);
  };
  return { x: number("x"), y: number("y"), width: number("width"), height: number("height"), relative: g.attrs.relative === "1" };
}
function cellsOf(root: El): Cell[] {
  const out: Cell[] = [];
  for (const entry of elements(root)) {
    if (out.length >= DRAWIO_READER_LIMITS.cells) refuse("too_large", "too many cells");
    let element: El, id: string | undefined, value: string | undefined, placeholders = false, data = false;
    if (entry.name === "mxCell") { element = entry; id = entry.attrs.id; value = entry.attrs.value; }
    else if (entry.name === "object" || entry.name === "UserObject") {
      const inner = elements(entry);
      if (inner.length !== 1 || inner[0]!.name !== "mxCell") refuse("cell_invalid", `${entry.name} without exactly one mxCell`);
      element = inner[0]!; id = entry.attrs.id; value = entry.attrs.label; placeholders = entry.attrs.placeholders === "1";
      data = Object.keys(entry.attrs).some(key => key !== "id" && key !== "label" && key !== "placeholders");
    } else return refuse("cell_invalid", `an unexpected element ${entry.name.slice(0, 32)} in the root`);
    if (id === undefined) refuse("cell_invalid", "a cell without an id");
    const a = element.attrs;
    const vertex = flag(a.vertex, "vertex", id!), edge = flag(a.edge, "edge", id!);
    if (vertex && edge) refuse("cell_invalid", `${id!.slice(0, 64)} is both a vertex and an edge`);
    const geometry = geometryOf(element, id!);
    if ((vertex || edge) && !geometry) refuse("cell_invalid", `${id!.slice(0, 64)} has no geometry`);
    const style = a.style ?? "";
    if (style.length > DRAWIO_READER_LIMITS.styleChars) refuse("too_large", "a style over the limit");
    const visible = a.visible === undefined ? true : flag(a.visible, "visible", id!);
    out.push({ id: id!, parent: a.parent ?? null, value: value ?? "", style, vertex, edge, visible, collapsed: flag(a.collapsed, "collapsed", id!), source: a.source ?? null, target: a.target ?? null, geometry, placeholders, data });
  }
  return out;
}

// ---------- styles, values, ids ----------
function styleOf(style: string, id: string): { names: string[]; keys: Record<string, string> } {
  const names: string[] = [], keys = Object.create(null) as Record<string, string>;
  for (const part of style.split(";")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) names.push(part); else keys[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (names.length + Object.keys(keys).length > DRAWIO_READER_LIMITS.styleKeys) refuse("too_large", `too many style keys on ${id.slice(0, 64)}`);
  return { names, keys };
}
// The reader's own table of the colours draw.io files of Practonaut hold (lower case).
const STROKES: Readonly<Record<string, StrokeColor>> = { "#000000": "black", "#b85450": "red", "#82b366": "green", "#6c8ebf": "blue", "#d79b00": "orange" };
const FILLS: Readonly<Record<string, FillColor>> = { none: "none", "#f8cecc": "red", "#d5e8d4": "green", "#dae8fc": "blue", "#fff2cc": "yellow" };
/** Arrow markers the pinned app draws a head for (checked against the app by the conformance suite). */
export const DRAWIO_MARKERS: readonly string[] = Object.freeze(["classic", "classicThin", "block", "blockThin", "open", "openThin", "oval", "diamond", "diamondThin"]);
const NO_MARKER = new Set(["none", ""]);
const SEMANTIC = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const derived = (raw: string, prefix: string): string => `${prefix}-${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
const semanticId = (raw: string, prefix: string): string => SEMANTIC.test(raw) && !RESERVED.has(raw) ? raw : derived(raw, prefix);
function label(cell: Cell, html: string | undefined): string {
  if (html !== undefined && html !== "0" && html !== "1") refuse("unmodeled_value", `html=${html.slice(0, 8)} on ${cell.id.slice(0, 64)}`);
  const value = cell.value;
  // With html=1 the value is HTML; only text that HTML shows exactly as written is read.
  if (html === "1" && (/[<&\t\n\r]/.test(value) || / {2}/.test(value) || value !== value.trim())) refuse("markup_label", `an HTML label on ${cell.id.slice(0, 64)}`);
  if (cell.placeholders && value.includes("%")) refuse("markup_label", `a placeholder label on ${cell.id.slice(0, 64)}`);
  const normalized = value.normalize("NFC");
  if (/\p{Cf}/u.test(normalized)) refuse("text_invalid", "invisible format characters in a label");
  if ([...normalized].length > DRAWIO_READER_LIMITS.labelCodePoints) refuse("text_invalid", "a label over the limit");
  return normalized;
}

export interface DrawioUnmodeled { id: string; reason: "hidden" | "edge_label" | "other_shape" | "group_of_frames" | "nested_frame" | "data_attributes" | "edge_value" }
export interface DrawioReport { state: State; unmodeled: DrawioUnmodeled[] }

/** Reads a `.drawio` file (one page, plain or compressed, or a bare `mxGraphModel`). */
export function parseDrawio(input: string | Uint8Array): DrawioReport {
  const bytes = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
  if (bytes.length > DRAWIO_READER_LIMITS.bytes) refuse("too_large", "the file is over 10 MiB");
  const cells = cellsOf(modelOf(parseXml(bytes.toString("utf8"))));
  const byId = new Map<string, Cell>();
  for (const cell of cells) { if (byId.has(cell.id)) refuse("duplicate_id", `two cells share the id ${cell.id.slice(0, 64)}`); byId.set(cell.id, cell); }
  const roots = cells.filter(cell => cell.parent === null);
  if (roots.length !== 1) refuse("structure_invalid", `${roots.length} root cells`);
  const root = roots[0]!;
  // Parent chains: nearest first; existing parents, no cycle, no edge under an edge.
  const chains = new Map<string, string[]>();
  for (const cell of cells) {
    const chain: string[] = [];
    let current = cell.parent;
    while (current !== null) {
      if (current === cell.id || chain.includes(current) || chain.length >= DRAWIO_READER_LIMITS.depth) refuse("structure_invalid", `a parent cycle at ${cell.id.slice(0, 64)}`);
      const parent = byId.get(current);
      if (!parent) refuse("structure_invalid", `the parent of ${cell.id.slice(0, 64)} does not exist`);
      chain.push(current); current = parent!.parent;
    }
    chains.set(cell.id, chain);
    if (cell.edge && cell.parent !== null && byId.get(cell.parent)!.edge) refuse("structure_invalid", `edge ${cell.id.slice(0, 64)} has an edge as its parent`);
  }
  const unmodeled: DrawioUnmodeled[] = [];
  const layers = new Set(cells.filter(cell => cell.parent === root.id).map(cell => cell.id));
  // Hidden: a cell that is not visible, or below one that is hidden or collapsed.
  const hidden = (cell: Cell): boolean => !cell.visible || chains.get(cell.id)!.some(id => !byId.get(id)!.visible || byId.get(id)!.collapsed);
  type Kind = "frame" | "group" | "step" | "edge" | "skip";
  const kinds = new Map<string, Kind>(), shapes = new Map<string, Shape>();
  for (const cell of cells) {
    if (cell === root || layers.has(cell.id)) { kinds.set(cell.id, "skip"); continue; }
    if (hidden(cell)) { kinds.set(cell.id, "skip"); unmodeled.push({ id: cell.id, reason: "hidden" }); continue; }
    // Edge labels first: a vertex under an edge is the edge's label, before any other parent rule.
    if (cell.vertex && cell.parent !== null && byId.get(cell.parent)!.edge) { kinds.set(cell.id, "skip"); unmodeled.push({ id: cell.id, reason: "edge_label" }); continue; }
    if (cell.edge) { kinds.set(cell.id, "edge"); continue; }
    if (!cell.vertex) { kinds.set(cell.id, "skip"); unmodeled.push({ id: cell.id, reason: "other_shape" }); continue; }
    // The effective shape before any classification: more than one shape-determining token is refused.
    const { names, keys } = styleOf(cell.style, cell.id);
    const tokens = [...names, ...(keys.shape !== undefined ? [`shape=${keys.shape}`] : [])];
    if (tokens.length > 1) refuse("unmodeled_value", `more than one shape token on ${cell.id.slice(0, 64)}`);
    const token = tokens[0];
    const container = keys.container === "1";
    if (token === "swimlane" || token === "shape=swimlane" || (token === undefined && container)) { kinds.set(cell.id, "frame"); continue; }
    if (token === "group") { kinds.set(cell.id, "group"); continue; }
    const shape: Shape | undefined = token === undefined || token === "shape=rectangle" ? "rectangle" : token === "ellipse" || token === "shape=ellipse" ? "ellipse" : token === "rhombus" || token === "shape=rhombus" ? "diamond" : undefined;
    if (shape === undefined) { kinds.set(cell.id, "skip"); unmodeled.push({ id: cell.id, reason: "other_shape" }); continue; }
    if (container) refuse("unmodeled_value", `a step shape that is also a container on ${cell.id.slice(0, 64)}`);
    kinds.set(cell.id, "step"); shapes.set(cell.id, shape);
  }
  for (const cell of cells) if (cell.data && kinds.get(cell.id) !== "skip") unmodeled.push({ id: cell.id, reason: "data_attributes" });
  // Semantic ids: kept when they fit the pattern, derived otherwise; group ids injective over group cells.
  const ids = new Map<string, string>(), used = new Set<string>();
  const assign = (cell: Cell, prefix: string): string => {
    const id = semanticId(cell.id, prefix);
    if (used.has(id)) refuse("duplicate_id", `two objects read as ${id}`);
    used.add(id); ids.set(cell.id, id); return id;
  };
  const groupIds = new Map<string, string>(), usedGroups = new Set<string>();
  for (const cell of cells) {
    if (kinds.get(cell.id) !== "group") continue;
    const groupId = cell.id.startsWith("pn:group:") ? semanticId(cell.id.slice("pn:group:".length), "g") : semanticId(cell.id, "g");
    if (usedGroups.has(groupId)) refuse("duplicate_id", `two group cells read as group ${groupId}`);
    usedGroups.add(groupId); groupIds.set(cell.id, groupId);
    // A group with a frame below it groups frames, not steps.
    if (cells.some(other => kinds.get(other.id) === "frame" && chains.get(other.id)!.includes(cell.id))) unmodeled.push({ id: cell.id, reason: "group_of_frames" });
  }
  const objects: Record<string, Frame | StepV2 | Arrow> = Object.create(null) as Record<string, Frame | StepV2 | Arrow>;
  const frameOf = (cell: Cell): string | null => { const f = chains.get(cell.id)!.find(id => kinds.get(id) === "frame"); return f === undefined ? null : f; };
  for (const cell of cells) {
    if (kinds.get(cell.id) !== "frame") continue;
    if (frameOf(cell) !== null) unmodeled.push({ id: cell.id, reason: "nested_frame" });
    const id = assign(cell, "f");
    objects[id] = { id, type: "frame", deleted: false, name: label(cell, styleOf(cell.style, cell.id).keys.html) };
  }
  for (const cell of cells) {
    if (kinds.get(cell.id) !== "step") continue;
    const { keys } = styleOf(cell.style, cell.id);
    const g = cell.geometry!;
    const chain = chains.get(cell.id)!;
    if (g.relative || chain.some(a => byId.get(a)!.vertex && byId.get(a)!.geometry?.relative)) refuse("geometry_invalid", `relative geometry on or above ${cell.id.slice(0, 64)}`);
    if (g.width <= 0 || g.height <= 0) refuse("geometry_invalid", `a step without a positive size: ${cell.id.slice(0, 64)}`);
    let x = g.x, y = g.y;
    for (const a of chain) { const ancestor = byId.get(a)!; if (ancestor.vertex && ancestor.geometry) { x += ancestor.geometry.x; y += ancestor.geometry.y; } }
    // Rounded by edges (PADR-0047 decision 10); a collapsed box is widened to 1 px.
    const left = Math.round(x), top = Math.round(y);
    const right = Math.max(left + 1, Math.round(x + g.width)), bottom = Math.max(top + 1, Math.round(y + g.height));
    for (const edge of [left, top, right, bottom]) if (Math.abs(edge) > DRAWIO_READER_LIMITS.coordinate) refuse("geometry_invalid", `a box edge outside ±1,000,000 on ${cell.id.slice(0, 64)}`);
    const strokeRaw = keys.strokeColor === undefined ? "#000000" : keys.strokeColor.toLowerCase();
    const fillRaw = keys.fillColor === undefined ? "none" : keys.fillColor.toLowerCase();
    const stroke = STROKES[strokeRaw], fill = FILLS[fillRaw];
    if (!stroke || !fill) refuse("unmodeled_value", `a colour outside the table on ${cell.id.slice(0, 64)}`);
    // The outermost group between the step and its frame (or the layer).
    const frameIndex = chain.findIndex(a => kinds.get(a) === "frame");
    const below = frameIndex < 0 ? chain : chain.slice(0, frameIndex);
    const group = [...below].reverse().find(a => kinds.get(a) === "group");
    const id = assign(cell, "s");
    objects[id] = { id, type: "step", deleted: false, frameId: frameIndex < 0 ? null : ids.get(chain[frameIndex]!)!, label: label(cell, keys.html), x: left, y: top, width: right - left, height: bottom - top, shape: shapes.get(cell.id)!, groupId: group === undefined ? null : groupIds.get(group)!, stroke: stroke!, fill: fill! };
  }
  for (const cell of cells) {
    if (kinds.get(cell.id) !== "edge") continue;
    const { keys } = styleOf(cell.style, cell.id);
    for (const key of ["startArrow", "endArrow"] as const) { const v = keys[key]; if (v !== undefined && !NO_MARKER.has(v) && !DRAWIO_MARKERS.includes(v)) refuse("unmodeled_value", `${key}=${v.slice(0, 16)} on ${cell.id.slice(0, 64)}`); }
    const endHead = keys.endArrow === undefined || !NO_MARKER.has(keys.endArrow), startHead = keys.startArrow !== undefined && !NO_MARKER.has(keys.startArrow);
    const end = (ref: string | null): string | null => {
      if (ref === null) return null;
      if (!byId.has(ref)) refuse("structure_invalid", `edge ${cell.id.slice(0, 64)} names a missing end`);
      return kinds.get(ref) === "step" ? ids.get(ref)! : null;
    };
    let from = end(cell.source), to = end(cell.target);
    if (startHead && !endHead) [from, to] = [to, from];
    if (cell.value !== "") unmodeled.push({ id: cell.id, reason: "edge_value" });
    const id = assign(cell, "a");
    const ends = [from, to].filter((e): e is string => e !== null).map(e => (objects[e] as StepV2).frameId);
    const frameId = ends.length ? (ends.every(f => f === ends[0]) ? ends[0]! : null) : (frameOf(cell) === null ? null : ids.get(frameOf(cell)!) ?? null);
    objects[id] = { id, type: "arrow", deleted: false, frameId, from, to };
  }
  return { state: validateSubmissionState({ objects }, undefined, 2), unmodeled };
}

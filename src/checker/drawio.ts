/**
 * The checker's own `.drawio` reader (PADR-0049 decision 6, made allowlist-based after review m2c): a
 * draw.io file -> the world/2 state a goal is judged on. Independent of the adapter (architecture §2):
 * its own bounded XML tokenizer, style parser and tables; it imports nothing from `src/adapters` or
 * `src/core`.
 *
 * It reads exactly the vocabulary the adapter writes — elements, attributes, style names, style keys and
 * their values from the tables below — and refuses everything else. Chasing each way draw.io can hide,
 * move or relabel a cell does not converge; an allowlist does. So a file passes only when it holds
 * nothing the reader does not model. `check` on hand-drawn files is therefore strict until artifact
 * mode (Must 3) decides otherwise.
 *
 * The caller says what the file is (review m3, PADR-0049 decision 6.8):
 * - `own-export`: the real app's export made by Practonaut's own host in a session (the export pair, a
 *   bench run's native verdict, `run --export`, `report --verify`, conformance). The session state is
 *   the ground truth and the export must equal it; like Excalidraw's reader, this mode models no
 *   painting, so every legal state the adapter writes reads.
 * - `submission` (the default): any other file, `practonaut check` on a `.drawio` file. No model of
 *   draw.io's painting either: whatever read could be hidden or misread is refused by name
 *   (`boxes_overlap`, `frame_outside`, `arrow_hidden`, `text_extent`, `geometry_invalid`; see
 *   `submissionCheck`).
 *
 * Refusals are `artifact_invalid` with `details.reason` from a closed list.
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import type { Arrow, Frame, State, StepV2, StrokeColor, FillColor, Shape } from "../world/types.ts";
import { CheckerError } from "./errors.ts";
import { validateSubmissionState } from "./state.ts";

export const DRAWIO_READER_LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, inflated: 10 * 1024 * 1024, elements: 50_000, depth: 64, attributes: 128, attributeChars: 65_536, styleChars: 4_096, styleKeys: 128, cells: 5_000, coordinate: 1_000_000, labelChars: 4_096, nameChars: 256 });
export type DrawioRefusal = "too_large" | "xml_invalid" | "xml_doctype" | "pages_unsupported" | "diagram_invalid" | "cell_invalid" | "duplicate_id" | "structure_invalid" | "geometry_invalid" | "markup_label" | "text_invalid" | "unmodeled_value" | "boxes_overlap" | "arrow_hidden" | "text_extent" | "frame_outside";
export const DRAWIO_REFUSALS: readonly DrawioRefusal[] = Object.freeze(["too_large", "xml_invalid", "xml_doctype", "pages_unsupported", "diagram_invalid", "cell_invalid", "duplicate_id", "structure_invalid", "geometry_invalid", "markup_label", "text_invalid", "unmodeled_value", "boxes_overlap", "arrow_hidden", "text_extent", "frame_outside"]);
/** What the file is: the app's export from Practonaut's own host in a session, or anything else. */
export type DrawioReadMode = "own-export" | "submission";
export const DRAWIO_READ_MODES: readonly DrawioReadMode[] = Object.freeze(["own-export", "submission"]);
const refuse = (reason: DrawioRefusal, message: string): never => { throw new CheckerError("artifact_invalid", `.drawio: ${message}`, { reason }); };
const shown = (value: string): string => value.slice(0, 64);

// ---------- XML (well-formed, without namespaces or declarations) ----------
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
/** XML white space after end-of-line handling. */
const XML_SPACE = /^[ \t\n]*$/;
/** The XML declaration by its grammar: version 1.0, an optional encoding UTF-8 (any case), an optional
 * standalone yes or no, each after white space. */
const XML_DECLARATION = /<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(?:"1\.0"|'1\.0')(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(?:"[Uu][Tt][Ff]-8"|'[Uu][Tt][Ff]-8'))?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(?:"(?:yes|no)"|'(?:yes|no)'))?[ \t\n]*\?>/y;
/** One XML document: end-of-line handling first, then a strict, bounded reading. Not well-formed or
 * not namespace-well-formed input is refused (a draw.io file holds neither namespaces nor DOCTYPE). */
export function parseXml(raw: string): El {
  if (raw.length > DRAWIO_READER_LIMITS.bytes) refuse("too_large", "the document is over the size limit");
  const input = raw.replace(/\r\n?/g, "\n");
  for (const char of input) if (!xmlChar(char.codePointAt(0)!)) refuse("xml_invalid", "a character outside the XML character set");
  let i = 0, count = 0;
  const top: El = { name: "#document", attrs: {}, children: [] };
  const stack: El[] = [top];
  // Names without a colon: a prefix would need a namespace declaration, which no draw.io file has.
  const nameAt = /[A-Za-z_][A-Za-z0-9_.-]*/y, spaceAt = /[ \t\n]*/y;
  const space = (): number => { spaceAt.lastIndex = i; spaceAt.exec(input); const n = spaceAt.lastIndex - i; i = spaceAt.lastIndex; return n; };
  const name = (): string => {
    nameAt.lastIndex = i; const m = nameAt.exec(input);
    if (!m) refuse("xml_invalid", `a name was expected at ${i}`);
    i = nameAt.lastIndex;
    if (input[i] === ":") refuse("xml_invalid", "a namespace prefix (namespaces are not read)");
    return m![0];
  };
  while (i < input.length) {
    const lt = input.indexOf("<", i), end = lt < 0 ? input.length : lt;
    if (end > i) {
      const text = input.slice(i, end);
      if (text.includes("]]>")) refuse("xml_invalid", "]]> in character data");
      // Outside the root only XML white space: space, tab and line feed (CR is gone by now). A no-break
      // space, U+2028, U+3000 or U+FEFF there is not well-formed (review m2d).
      if (stack.length === 1) { if (!XML_SPACE.test(text)) refuse("xml_invalid", "text outside the root element"); }
      else stack.at(-1)!.children.push(decode(text));
      i = end; continue;
    }
    if (input.startsWith("<?", i)) {
      // The XML declaration only at the very start, once, by its grammar; no other processing instruction.
      XML_DECLARATION.lastIndex = 0;
      if (i !== 0 || !XML_DECLARATION.test(input)) refuse("xml_invalid", "a processing instruction other than one well-formed XML declaration at the start");
      i = XML_DECLARATION.lastIndex; continue;
    }
    if (input.startsWith("<!--", i)) {
      const close = input.indexOf("-->", i + 4);
      if (close < 0) refuse("xml_invalid", "an unterminated comment");
      const body = input.slice(i + 4, close);
      if (body.includes("--") || body.endsWith("-")) refuse("xml_invalid", "-- inside a comment");
      i = close + 3; continue;
    }
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
      // No namespace declaration: no draw.io file has one, and a reserved URI is not well-formed.
      if (key === "xmlns") refuse("xml_invalid", "a namespace declaration (namespaces are not read)");
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

/** draw.io's compressed page, decoded as draw.io decodes it: Base64 without ASCII white space (atob),
 * raw inflate, UTF-8 (pako `to: 'string'`), then URI decoding. */
function inflatePage(text: string): string {
  const compact = text.replace(/[\t\n\f\r ]+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) refuse("diagram_invalid", "a compressed page that is not Base64");
  let bytes: Buffer;
  try { bytes = inflateRawSync(Buffer.from(compact, "base64"), { maxOutputLength: DRAWIO_READER_LIMITS.inflated }); }
  catch { return refuse("diagram_invalid", "a compressed page that does not inflate within the limit"); }
  let utf8: string;
  try { utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return refuse("diagram_invalid", "a compressed page that is not UTF-8"); }
  try { return decodeURIComponent(utf8); } catch { return refuse("diagram_invalid", "a compressed page that is not URI-encoded"); }
}
/** The attributes draw.io's own export carries on `mxfile`, `diagram` and `mxGraphModel` (measured on
 * the committed exports), with the values pinned for those that change the picture. Any other, such as
 * the page `background` or a `backgroundImage`, is refused (review m2d). `null`: any value. */
const FILE_ATTRIBUTES: Readonly<Record<string, Readonly<Record<string, readonly string[] | null>>>> = Object.freeze({
  mxfile: { host: null },
  diagram: { id: null, name: null },
  mxGraphModel: { dx: null, dy: null, grid: null, gridSize: null, guides: null, tooltips: null, connect: null, arrows: null, fold: null, page: null, pageScale: null, pageWidth: null, pageHeight: null, math: ["0"], shadow: ["0"] },
  root: {},
});
function fileAttributes(element: El): void {
  const table = FILE_ATTRIBUTES[element.name]!;
  for (const [key, value] of Object.entries(element.attrs)) {
    if (!Object.hasOwn(table, key)) refuse("unmodeled_value", `${key.slice(0, 32)} on ${element.name}`);
    const values = table[key];
    if (values && !values.includes(value)) refuse("unmodeled_value", `${key}=${value.slice(0, 16)} on ${element.name}`);
  }
}
/** The one page's `mxGraphModel` root; the file's own attributes only from the table above. */
function modelOf(top: El): El {
  let model = top;
  if (top.name === "mxfile") {
    fileAttributes(top);
    const children = elements(top);
    if (children.some(c => c.name !== "diagram")) refuse("diagram_invalid", "an mxfile holds something other than diagrams");
    if (children.length !== 1) refuse("pages_unsupported", `${children.length} pages; one is read`);
    const diagram = children[0]!;
    fileAttributes(diagram);
    // Compressed if and only if its text, descendants included, is not XML white space.
    if (!XML_SPACE.test(textOf(diagram))) {
      if (elements(diagram).length) refuse("diagram_invalid", "a page with both compressed text and elements");
      model = parseXml(inflatePage(textOf(diagram)));
    } else {
      const inner = elements(diagram);
      if (inner.length !== 1 || inner[0]!.name !== "mxGraphModel") refuse("diagram_invalid", "a page without exactly one mxGraphModel");
      model = inner[0]!;
    }
  }
  if (model.name !== "mxGraphModel") refuse("diagram_invalid", `expected mxGraphModel, found ${model.name.slice(0, 32)}`);
  fileAttributes(model);
  const roots = elements(model);
  if (roots.length !== 1 || roots[0]!.name !== "root") refuse("diagram_invalid", "the model needs exactly one root");
  fileAttributes(roots[0]!);
  const ownText = (e: El): string => e.children.filter((c): c is string => typeof c === "string").join("");
  if (!XML_SPACE.test(ownText(model) + ownText(roots[0]!))) refuse("diagram_invalid", "text inside the model or its root");
  return roots[0]!;
}

// ---------- the allowlist: the adapter's own vocabulary ----------
/** Attributes read on a cell; any other attribute (visibility, collapsing, data, links …) is refused. */
const CELL_ATTRIBUTES: ReadonlySet<string> = new Set(["id", "value", "style", "vertex", "edge", "parent", "source", "target", "connectable"]);
/** An `object`/`UserObject` holds an id and a label; its inner `mxCell` holds no id and no value. */
const OBJECT_ATTRIBUTES: ReadonlySet<string> = new Set(["id", "label"]);
const INNER_CELL_ATTRIBUTES: ReadonlySet<string> = new Set(["style", "vertex", "edge", "parent", "source", "target", "connectable"]);
const VERTEX_GEOMETRY: ReadonlySet<string> = new Set(["x", "y", "width", "height", "as"]);
const EDGE_GEOMETRY: ReadonlySet<string> = new Set(["relative", "as"]);
const POINT_ATTRIBUTES: ReadonlySet<string> = new Set(["x", "y", "as"]);
/** Style names and keys per kind of cell, with their accepted values (`null`: a value from a table). */
const STEP_NAMES: Readonly<Record<string, Shape>> = Object.freeze(Object.assign(Object.create(null) as Record<string, Shape>, { ellipse: "ellipse", rhombus: "diamond" }));
// `html=1` makes a label markup: it passes the style table and is refused by the label rule (markup_label).
const STEP_KEYS: Readonly<Record<string, readonly string[] | null>> = Object.freeze({ rounded: ["0"], html: ["0", "1"], strokeColor: null, fillColor: null });
// A frame's title band is filled unless `fillColor=none` (measured): only an unfilled band is read, so no
// frame can hide what lies under it (review m2d).
const FRAME_KEYS: Readonly<Record<string, readonly string[]>> = Object.freeze({ container: ["1"], collapsible: ["0"], startSize: ["30"], fillColor: ["none"], html: ["0", "1"] });
const FRAME_REQUIRED = ["container", "collapsible", "startSize", "fillColor"] as const;
const EDGE_KEYS: Readonly<Record<string, readonly string[] | null>> = Object.freeze({ startArrow: null, endArrow: null, html: ["0"] });
// The reader's own colour tables (lower case), as null-prototype lookups.
const STROKES: Readonly<Record<string, StrokeColor>> = Object.freeze(Object.assign(Object.create(null) as Record<string, StrokeColor>, { "#000000": "black", "#b85450": "red", "#82b366": "green", "#6c8ebf": "blue", "#d79b00": "orange" }));
const FILLS: Readonly<Record<string, FillColor>> = Object.freeze(Object.assign(Object.create(null) as Record<string, FillColor>, { none: "none", "#f8cecc": "red", "#d5e8d4": "green", "#dae8fc": "blue", "#fff2cc": "yellow" }));
/** Arrow markers the pinned app draws a head for (checked against the app by the conformance suite). */
export const DRAWIO_MARKERS: readonly string[] = Object.freeze(["classic", "classicThin", "block", "blockThin", "open", "openThin", "oval", "diamond", "diamondThin"]);
const NO_MARKER = new Set(["none", ""]);

// ---------- cells ----------
interface Point { x: number; y: number }
interface Geometry { x: number; y: number; width: number; height: number; points?: { sourcePoint?: Point; targetPoint?: Point } }
interface Cell { id: string; parent: string | null; value: string; style: string; vertex: boolean; edge: boolean; source: string | null; target: string | null; connectable: string | undefined; geometry: Geometry | null; attrs: Record<string, string> }
const NUMBER = /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
/** A coordinate or size: the number grammar, finite, within ±1,000,000 on its own, so no sum of
 * ancestors can cancel out a far offset. */
const coordinate = (raw: string | undefined, key: string, id: string): number => {
  if (raw === undefined) return 0;
  if (!NUMBER.test(raw)) refuse("geometry_invalid", `${key}="${raw.slice(0, 16)}" on ${shown(id)}`);
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > DRAWIO_READER_LIMITS.coordinate) refuse("geometry_invalid", `${key} outside ±1,000,000 on ${shown(id)}`);
  return value;
};
const flag = (value: string | undefined, field: string, id: string): boolean => {
  if (value === undefined) return false;
  if (value === "1") return true;
  return refuse("cell_invalid", `${field}="${value.slice(0, 16)}" on ${shown(id)} (only 1, or absent)`);
};
function only(attrs: Record<string, string>, allowed: ReadonlySet<string>, what: string, id: string): void {
  for (const key of Object.keys(attrs)) if (!allowed.has(key)) refuse("unmodeled_value", `${key} on ${what} ${shown(id)}`);
}
function geometryOf(cell: El, id: string, vertex: boolean): Geometry | null {
  const children = elements(cell);
  if (children.length === 0) return null;
  // One child: the cell's geometry. Value or style children (`<add as="value">`), points of a vertex,
  // alternate bounds and anything else are refused.
  if (children.length > 1 || children[0]!.name !== "mxGeometry" || children[0]!.attrs.as !== "geometry") refuse("cell_invalid", `a child other than one geometry on ${shown(id)}`);
  const g = children[0]!;
  if (vertex) {
    only(g.attrs, VERTEX_GEOMETRY, "the geometry of", id);
    if (elements(g).length) refuse("cell_invalid", `points on the geometry of vertex ${shown(id)}`);
    return { x: coordinate(g.attrs.x, "x", id), y: coordinate(g.attrs.y, "y", id), width: coordinate(g.attrs.width, "width", id), height: coordinate(g.attrs.height, "height", id) };
  }
  // An edge's geometry: relative="1" exactly, and at most a source and a target point.
  only(g.attrs, EDGE_GEOMETRY, "the geometry of", id);
  if (g.attrs.relative !== "1") refuse("geometry_invalid", `an edge geometry that is not relative="1" on ${shown(id)}`);
  const points: { sourcePoint?: Point; targetPoint?: Point } = {};
  for (const point of elements(g)) {
    const as = point.attrs.as;
    if (point.name !== "mxPoint" || (as !== "sourcePoint" && as !== "targetPoint") || points[as] !== undefined) refuse("cell_invalid", `an edge point other than one source and one target point on ${shown(id)}`);
    only(point.attrs, POINT_ATTRIBUTES, "a point of", id);
    points[as as "sourcePoint" | "targetPoint"] = { x: coordinate(point.attrs.x, "x", id), y: coordinate(point.attrs.y, "y", id) };
    if (elements(point).length) refuse("cell_invalid", `a point with children on ${shown(id)}`);
  }
  return { x: 0, y: 0, width: 0, height: 0, points };
}
function cellsOf(root: El): Cell[] {
  const out: Cell[] = [];
  for (const entry of elements(root)) {
    if (out.length >= DRAWIO_READER_LIMITS.cells) refuse("too_large", "too many cells");
    let element: El, id: string | undefined, value: string | undefined;
    if (entry.name === "mxCell") {
      element = entry; id = entry.attrs.id; value = entry.attrs.value;
      only(entry.attrs, CELL_ATTRIBUTES, "cell", id ?? "?");
    } else if (entry.name === "object" || entry.name === "UserObject") {
      // A user object holds only an id and a label; draw.io takes the inner cell's value over the label.
      only(entry.attrs, OBJECT_ATTRIBUTES, entry.name, entry.attrs.id ?? "?");
      const inner = elements(entry);
      if (inner.length !== 1 || inner[0]!.name !== "mxCell") refuse("cell_invalid", `${entry.name} without exactly one mxCell`);
      element = inner[0]!; id = entry.attrs.id; value = entry.attrs.label;
      if (Object.hasOwn(element.attrs, "value")) refuse("cell_invalid", `${entry.name} ${shown(id ?? "?")} whose inner cell has a value`);
      only(element.attrs, INNER_CELL_ATTRIBUTES, "the inner cell of", id ?? "?");
    } else return refuse("cell_invalid", `an unexpected element ${entry.name.slice(0, 32)} in the root`);
    if (id === undefined) refuse("cell_invalid", "a cell without an id");
    if (!XML_SPACE.test(textOf(element))) refuse("cell_invalid", `text inside cell ${shown(id!)}`);
    const a = element.attrs;
    const vertex = flag(a.vertex, "vertex", id!), edge = flag(a.edge, "edge", id!);
    if (vertex && edge) refuse("cell_invalid", `${shown(id!)} is both a vertex and an edge`);
    // A cell that is neither a vertex nor an edge (the root, a layer) carries no geometry: draw.io's view
    // would add its offset to everything below it.
    if (!vertex && !edge && elements(element).length) refuse("structure_invalid", `${shown(id!)} carries a geometry but is neither a vertex nor an edge`);
    const geometry = vertex || edge ? geometryOf(element, id!, vertex) : null;
    if ((vertex || edge) && !geometry) refuse("cell_invalid", `${shown(id!)} has no geometry`);
    const style = a.style ?? "";
    if (style.length > DRAWIO_READER_LIMITS.styleChars) refuse("too_large", "a style over the limit");
    out.push({ id: id!, parent: a.parent ?? null, value: value ?? "", style, vertex, edge, source: a.source ?? null, target: a.target ?? null, connectable: a.connectable, geometry, attrs: a });
  }
  return out;
}

// ---------- styles, values, ids ----------
/** A style string: named styles, then `key=value` pairs. A leading `;` (which drops draw.io's default
 * style), an empty segment inside, a repeated key and more than one name are refused. */
function styleOf(style: string, id: string): { names: string[]; keys: Record<string, string> } {
  const names: string[] = [], keys = Object.create(null) as Record<string, string>;
  const parts = style.split(";");
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    if (!part) refuse("unmodeled_value", `an empty style segment (a leading ;) on ${shown(id)}`);
    const eq = part.indexOf("=");
    if (eq < 0) { names.push(part); continue; }
    const key = part.slice(0, eq);
    if (Object.hasOwn(keys, key)) refuse("unmodeled_value", `${key.slice(0, 32)} twice on ${shown(id)}`);
    keys[key] = part.slice(eq + 1);
  }
  if (names.length + Object.keys(keys).length > DRAWIO_READER_LIMITS.styleKeys) refuse("too_large", `too many style keys on ${shown(id)}`);
  if (names.length > 1) refuse("unmodeled_value", `more than one style name on ${shown(id)}`);
  return { names, keys };
}
function keysWithin(keys: Record<string, string>, table: Readonly<Record<string, readonly string[] | null>>, id: string): void {
  for (const [key, value] of Object.entries(keys)) {
    if (!Object.hasOwn(table, key)) refuse("unmodeled_value", `style key ${key.slice(0, 32)} on ${shown(id)}`);
    const values = table[key];
    if (values && !values.includes(value)) refuse("unmodeled_value", `${key.slice(0, 32)}=${value.slice(0, 16)} on ${shown(id)}`);
  }
}
const SEMANTIC = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);
const derived = (raw: string, prefix: string): string => `${prefix}-${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
const semanticId = (raw: string, prefix: string): string => SEMANTIC.test(raw) && !RESERVED.has(raw) ? raw : derived(raw, prefix);
/** A label or frame name: plain text (`html` absent or 0; with html=1 the value is markup), NFC, no
 * invisible format characters, within the world's text limits. */
function label(cell: Cell, html: string | undefined, limit: number): string {
  if (html === "1") refuse("markup_label", `an HTML label on ${shown(cell.id)}`);
  const normalized = cell.value.normalize("NFC");
  if (/\p{Cf}/u.test(normalized)) refuse("text_invalid", "invisible format characters in a label");
  if (normalized.length > limit) refuse("text_invalid", `a label or name over ${limit} characters`);
  return normalized;
}

export interface DrawioReport { state: State }

/** Reads a `.drawio` file (one page, plain or compressed, or a bare `mxGraphModel`); `mode` says what it is. */
export function parseDrawio(input: string | Uint8Array, mode: DrawioReadMode = "submission"): DrawioReport {
  if (!DRAWIO_READ_MODES.includes(mode)) throw new CheckerError("checker_invalid", "unknown .drawio read mode");
  const bytes = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
  if (bytes.length > DRAWIO_READER_LIMITS.bytes) refuse("too_large", "the file is over 10 MiB");
  // One UTF-8 byte-order mark before the document is allowed, as by every XML parser (review m2d).
  const document = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  const cells = cellsOf(modelOf(parseXml(document.toString("utf8"))));
  const byId = new Map<string, Cell>();
  for (const cell of cells) { if (byId.has(cell.id)) refuse("duplicate_id", `two cells share the id ${shown(cell.id)}`); byId.set(cell.id, cell); }
  const roots = cells.filter(cell => cell.parent === null);
  if (roots.length !== 1) refuse("structure_invalid", `${roots.length} root cells`);
  const root = roots[0]!;
  // Parent chains, nearest first: existing parents, no cycle.
  const chains = new Map<string, string[]>();
  for (const cell of cells) {
    const chain: string[] = [];
    let current = cell.parent;
    while (current !== null) {
      if (current === cell.id || chain.includes(current) || chain.length >= DRAWIO_READER_LIMITS.depth) refuse("structure_invalid", `a parent cycle at ${shown(cell.id)}`);
      const parent = byId.get(current);
      if (!parent) refuse("structure_invalid", `the parent of ${shown(cell.id)} does not exist`);
      chain.push(current); current = parent!.parent;
    }
    chains.set(cell.id, chain);
  }
  // The root and the layers below it hold only their ids: no value, style, flags or geometry.
  const layers = new Set(cells.filter(cell => cell.parent === root.id).map(cell => cell.id));
  for (const cell of cells) {
    if (cell !== root && !layers.has(cell.id)) continue;
    if (cell.vertex || cell.edge) refuse("structure_invalid", `${shown(cell.id)} is a ${cell.vertex ? "vertex" : "edge"} in place of the root or a layer`);
    if (Object.keys(cell.attrs).some(key => key !== "id" && key !== "parent")) refuse("unmodeled_value", `the root or layer ${shown(cell.id)} carries more than its id`);
  }
  type Kind = "frame" | "group" | "step" | "edge";
  const kinds = new Map<string, Kind>(), shapes = new Map<string, Shape>(), styles = new Map<string, Record<string, string>>();
  for (const cell of cells) {
    if (cell === root || layers.has(cell.id)) continue;
    if (!cell.vertex && !cell.edge) refuse("structure_invalid", `${shown(cell.id)} is neither a vertex nor an edge`);
    const { names, keys } = styleOf(cell.style, cell.id);
    styles.set(cell.id, keys);
    const name = names[0];
    if (cell.edge) {
      if (name !== undefined) refuse("unmodeled_value", `a style name on edge ${shown(cell.id)}`);
      keysWithin(keys, EDGE_KEYS, cell.id);
      if (cell.connectable !== undefined) refuse("unmodeled_value", `connectable on edge ${shown(cell.id)}`);
      kinds.set(cell.id, "edge"); continue;
    }
    if (name === "swimlane") {
      keysWithin(keys, FRAME_KEYS, cell.id);
      for (const key of FRAME_REQUIRED) if (!Object.hasOwn(keys, key)) refuse("unmodeled_value", `a frame without ${key} on ${shown(cell.id)}`);
      if (cell.connectable !== undefined) refuse("unmodeled_value", `connectable on frame ${shown(cell.id)}`);
      kinds.set(cell.id, "frame"); continue;
    }
    if (name === "group") {
      if (Object.keys(keys).length) refuse("unmodeled_value", `style keys on group ${shown(cell.id)}`);
      if (cell.connectable !== undefined && cell.connectable !== "0") refuse("unmodeled_value", `connectable=${cell.connectable.slice(0, 8)} on group ${shown(cell.id)}`);
      if (cell.value !== "") refuse("unmodeled_value", `a label on group ${shown(cell.id)}`);
      kinds.set(cell.id, "group"); continue;
    }
    if (name !== undefined && !Object.hasOwn(STEP_NAMES, name)) refuse("unmodeled_value", `style name ${name.slice(0, 32)} on ${shown(cell.id)}`);
    keysWithin(keys, STEP_KEYS, cell.id);
    if (name !== undefined && Object.hasOwn(keys, "rounded")) refuse("unmodeled_value", `rounded on a ${name} on ${shown(cell.id)}`);
    if (cell.connectable !== undefined) refuse("unmodeled_value", `connectable on step ${shown(cell.id)}`);
    kinds.set(cell.id, "step"); shapes.set(cell.id, name === undefined ? "rectangle" : STEP_NAMES[name]!);
  }
  // Where each kind may sit, as the adapter writes it: frames on a layer; groups on a layer or in a frame;
  // steps on a layer, in a frame or in a group; edges on a layer or in a frame. Nothing else.
  const parentKind = (cell: Cell): Kind | "layer" => layers.has(cell.parent!) ? "layer" : kinds.get(cell.parent!)!;
  const PLACES: Readonly<Record<Kind, ReadonlyArray<Kind | "layer">>> = { frame: ["layer"], group: ["layer", "frame"], step: ["layer", "frame", "group"], edge: ["layer", "frame"] };
  for (const cell of cells) {
    const kind = kinds.get(cell.id);
    if (kind === undefined) continue;
    const place = parentKind(cell);
    if (!PLACES[kind].includes(place)) refuse("structure_invalid", `a ${kind} inside a ${place}: ${shown(cell.id)}`);
  }
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
  }
  const objects: Record<string, Frame | StepV2 | Arrow> = Object.create(null) as Record<string, Frame | StepV2 | Arrow>;
  const frameOf = (cell: Cell): string | null => { const f = chains.get(cell.id)!.find(id => kinds.get(id) === "frame"); return f === undefined ? null : f; };
  for (const cell of cells) {
    if (kinds.get(cell.id) !== "frame") continue;
    if (cell.geometry!.width <= 0 || cell.geometry!.height <= 0) refuse("geometry_invalid", `a frame without a positive size: ${shown(cell.id)}`);
    const id = assign(cell, "f");
    objects[id] = { id, type: "frame", deleted: false, name: label(cell, styles.get(cell.id)!.html, DRAWIO_READER_LIMITS.nameChars) };
  }
  for (const cell of cells) {
    if (kinds.get(cell.id) !== "step") continue;
    const keys = styles.get(cell.id)!, g = cell.geometry!, chain = chains.get(cell.id)!;
    if (g.width <= 0 || g.height <= 0) refuse("geometry_invalid", `a step without a positive size: ${shown(cell.id)}`);
    // Offsets summed root first, as draw.io's view accumulates them; each is bounded on its own.
    let x = 0, y = 0;
    for (const a of [...chain].reverse()) { const ancestor = byId.get(a)!; if (ancestor.geometry) { x += ancestor.geometry.x; y += ancestor.geometry.y; } }
    x += g.x; y += g.y;
    // Rounded by edges (PADR-0047 decision 10).
    const left = Math.round(x), top = Math.round(y), right = Math.round(x + g.width), bottom = Math.round(y + g.height);
    for (const edge of [left, top, right, bottom]) if (!Number.isFinite(edge) || Math.abs(edge) > DRAWIO_READER_LIMITS.coordinate) refuse("geometry_invalid", `a box edge outside ±1,000,000 on ${shown(cell.id)}`);
    if (right <= left || bottom <= top) refuse("geometry_invalid", `a step that rounds to no area: ${shown(cell.id)}`);
    const strokeRaw = keys.strokeColor?.toLowerCase(), fillRaw = keys.fillColor?.toLowerCase();
    if (strokeRaw === undefined || fillRaw === undefined || !Object.hasOwn(STROKES, strokeRaw) || !Object.hasOwn(FILLS, fillRaw)) refuse("unmodeled_value", `a colour outside the table, or none given, on ${shown(cell.id)}`);
    const group = cell.parent !== null && kinds.get(cell.parent) === "group" ? cell.parent : undefined;
    const frame = frameOf(cell);
    const id = assign(cell, "s");
    objects[id] = { id, type: "step", deleted: false, frameId: frame === null ? null : ids.get(frame)!, label: label(cell, keys.html, DRAWIO_READER_LIMITS.labelChars), x: left, y: top, width: right - left, height: bottom - top, shape: shapes.get(cell.id)!, groupId: group === undefined ? null : groupIds.get(group)!, stroke: STROKES[strokeRaw!]!, fill: FILLS[fillRaw!]! };
  }
  for (const cell of cells) {
    if (kinds.get(cell.id) !== "edge") continue;
    const keys = styles.get(cell.id)!;
    if (cell.value !== "") refuse("unmodeled_value", `a label on edge ${shown(cell.id)}`);
    for (const key of ["startArrow", "endArrow"] as const) { const v = keys[key]; if (v !== undefined && !NO_MARKER.has(v) && !DRAWIO_MARKERS.includes(v)) refuse("unmodeled_value", `${key}=${v.slice(0, 16)} on ${shown(cell.id)}`); }
    // One head shows the direction: at the end when endArrow is absent (draw.io's default) or a marker,
    // at the start when startArrow is a marker. No head, or a head at each end, shows none.
    const endHead = keys.endArrow === undefined || !NO_MARKER.has(keys.endArrow), startHead = keys.startArrow !== undefined && !NO_MARKER.has(keys.startArrow);
    if (endHead === startHead) refuse("unmodeled_value", `an edge without exactly one head: ${shown(cell.id)}`);
    const end = (ref: string | null): string | null => {
      if (ref === null) return null;
      if (!byId.has(ref)) refuse("structure_invalid", `edge ${shown(cell.id)} names a missing end`);
      if (kinds.get(ref) !== "step") refuse("structure_invalid", `edge ${shown(cell.id)} ends at a cell that is not a step`);
      return ids.get(ref)!;
    };
    let from = end(cell.source), to = end(cell.target);
    if (startHead) [from, to] = [to, from];
    const id = assign(cell, "a");
    const ends = [from, to].filter((e): e is string => e !== null).map(e => (objects[e] as StepV2).frameId);
    const frameId = ends.length ? (ends.every(f => f === ends[0]) ? ends[0]! : null) : (frameOf(cell) === null ? null : ids.get(frameOf(cell)!) ?? null);
    objects[id] = { id, type: "arrow", deleted: false, frameId, from, to };
  }
  if (mode === "submission") submissionCheck(cells, kinds, chains, byId, styles);
  return { state: validateSubmissionState({ objects }, undefined, 2) };
}

/** The estimate of a plain label's extent (`text_extent`): one line, centred on its box, 16 px tall and
 * 12 px per UTF-16 code unit wide; draw.io draws an `html=0` label at 12 px, unwrapped and unclipped. A
 * frame's name is drawn the same way in its title band, the top 30 px. */
export const DRAWIO_TEXT_ESTIMATE = Object.freeze({ lineHeight: 16, unitWidth: 12, band: 30 });
/** What an arrow needs to be seen (`arrow_hidden`; review m4). draw.io's classic end marker is 6 px long
 * with a 1 px stroke, and each end box's 1 px border is centred on its edge, so up to 8 px of an arrow's
 * drawn part can lie under its marker and the borders: the drawn part must be at least `length` (10 px)
 * long. The marker is 7 px wide with its stroke: the drawn part keeps `clearance` (4 px) from every
 * other filled step's box. */
export const DRAWIO_ARROW_MARGIN = Object.freeze({ length: 10, clearance: 4 });
/** How far a computed distance may miss a threshold of the paint rules and still meet it: a millionth
 * of a pixel (final check of PR #70). The rules compare sums, differences and quotients of the file's
 * decimal coordinates in binary floating point, so a distance that is exactly a threshold can come out a
 * few units in the last place on the wrong side (an arrow's drawn part of exactly 10 px computed as
 * 9.999999999999998 px, two touching boxes as overlapping by 7e-15 px). Coordinates as drawn, thousands
 * of pixels with a few decimals, round by about 1e-12 px; nothing draw.io draws differs by a millionth
 * of a pixel, so every rule stays as strict as stated (a drawn part of 9.9 px, a step 3.9 px from an
 * arrow, boxes overlapping by 0.1 px are refused). */
export const DRAWIO_GEOMETRY_TOLERANCE = 1e-6;
/**
 * Submission mode: no model of draw.io's painting; anything read that could be hidden or misread is
 * refused by name (review m3).
 * - `boxes_overlap`: two read boxes intersect for a positive area. The read boxes are the steps' boxes
 *   and the frames' title bands (the top 30 px, the whole frame when it is lower); a frame's whole box
 *   counts only towards a step outside it.
 * - `frame_outside`: a step of a frame does not lie inside that frame's body, below its title band.
 *   draw.io neither moves nor clips a container's children, so such a step is drawn outside the frame
 *   it is read in (review m4).
 * - `arrow_hidden`: an arrow is not drawn (an end with neither a step nor a point), or too little of it
 *   is. The drawn part is the line between its ends (an end step's box centre, a loose end's point)
 *   less what lies inside its end steps' boxes, so it starts and ends on or outside them. It must be at
 *   least `DRAWIO_ARROW_MARGIN.length` long and keep `DRAWIO_ARROW_MARGIN.clearance` from every other
 *   filled step's box; its own filled end steps are covered by the length.
 * - `text_extent`: a step label or a frame name holds a control character (a line feed among them), or
 *   its estimated extent (`DRAWIO_TEXT_ESTIMATE`) leaves its box or its band.
 * Sizes that are not positive are `geometry_invalid` in both modes. Every threshold is met within
 * `DRAWIO_GEOMETRY_TOLERANCE`: boxes overlap by more than it, a step lies outside its frame by more than
 * it, an arrow's drawn part is short of its length or comes nearer than its clearance by more than it,
 * a text estimate exceeds its box or band by more than it.
 */
function submissionCheck(cells: readonly Cell[], kinds: ReadonlyMap<string, string>, chains: ReadonlyMap<string, string[]>, byId: ReadonlyMap<string, Cell>, styles: ReadonlyMap<string, Record<string, string>>): void {
  interface Box { left: number; top: number; right: number; bottom: number }
  const origin = (id: string): Point => {
    let x = 0, y = 0;
    for (const a of [...chains.get(id)!].reverse()) { const g = byId.get(a)!.geometry; if (g) { x += g.x; y += g.y; } }
    return { x, y };
  };
  const boxOf = (cell: Cell): Box => { const o = origin(cell.id), g = cell.geometry!; return { left: o.x + g.x, top: o.y + g.y, right: o.x + g.x + g.width, bottom: o.y + g.y + g.height }; };
  const tolerance = DRAWIO_GEOMETRY_TOLERANCE;
  const overlaps = (a: Box, b: Box): boolean => a.left < b.right - tolerance && b.left < a.right - tolerance && a.top < b.bottom - tolerance && b.top < a.bottom - tolerance;
  /** The parameter range of the line through p and q inside box b (Liang–Barsky), or null when it misses. */
  const inside = (p: Point, q: Point, b: Box): [number, number] | null => {
    const dx = q.x - p.x, dy = q.y - p.y;
    let t0 = -Infinity, t1 = Infinity;
    for (const [pk, qk] of [[-dx, p.x - b.left], [dx, b.right - p.x], [-dy, p.y - b.top], [dy, b.bottom - p.y]] as const) {
      if (pk === 0) { if (qk < 0) return null; continue; }
      const r = qk / pk;
      if (pk < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    return t0 <= t1 ? [t0, t1] : null;
  };
  const steps = cells.filter(cell => kinds.get(cell.id) === "step"), frames = cells.filter(cell => kinds.get(cell.id) === "frame");
  const box = new Map<string, Box>(steps.map(step => [step.id, boxOf(step)]));
  const bands = frames.map(frame => { const whole = boxOf(frame); return { frame, whole, band: { ...whole, bottom: Math.min(whole.top + DRAWIO_TEXT_ESTIMATE.band, whole.bottom) } }; });
  // Text: one line of plain characters inside its box or band.
  const text = (cell: Cell, area: Box, what: string, within: string): void => {
    if (cell.value === "") return;
    if (/\p{Cc}/u.test(cell.value)) refuse("text_extent", `a control character (a line break) in ${what}`);
    const width = DRAWIO_TEXT_ESTIMATE.unitWidth * cell.value.length;
    if (width > area.right - area.left + tolerance || DRAWIO_TEXT_ESTIMATE.lineHeight > area.bottom - area.top + tolerance) refuse("text_extent", `${what} would reach outside its ${within} (estimated ${width} × ${DRAWIO_TEXT_ESTIMATE.lineHeight} px)`);
  };
  for (const step of steps) text(step, box.get(step.id)!, `the label of step ${shown(step.id)}`, "box");
  for (const { frame, band } of bands) text(frame, band, `the name of frame ${shown(frame.id)}`, "title band");
  // Boxes: steps against steps, bands against steps and bands, a frame's whole box against steps outside it.
  for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) {
    if (overlaps(box.get(steps[i]!.id)!, box.get(steps[j]!.id)!)) refuse("boxes_overlap", `steps ${shown(steps[i]!.id)} and ${shown(steps[j]!.id)} overlap`);
  }
  for (let i = 0; i < bands.length; i++) {
    const { frame, whole, band } = bands[i]!;
    for (const step of steps) {
      if (overlaps(band, box.get(step.id)!)) refuse("boxes_overlap", `step ${shown(step.id)} overlaps the title band of frame ${shown(frame.id)}`);
      if (!chains.get(step.id)!.includes(frame.id) && overlaps(whole, box.get(step.id)!)) refuse("boxes_overlap", `step ${shown(step.id)} lies in frame ${shown(frame.id)} without belonging to it`);
    }
    for (let j = i + 1; j < bands.length; j++) if (overlaps(band, bands[j]!.band)) refuse("boxes_overlap", `the title bands of frames ${shown(frame.id)} and ${shown(bands[j]!.frame.id)} overlap`);
  }
  // Membership as drawn: a frame's step lies inside the frame's body, below its title band.
  for (const step of steps) {
    const own = chains.get(step.id)!.find(id => kinds.get(id) === "frame");
    if (own === undefined) continue;
    const { whole, band } = bands.find(entry => entry.frame.id === own)!, b = box.get(step.id)!;
    if (b.left < whole.left - tolerance || b.right > whole.right + tolerance || b.top < band.bottom - tolerance || b.bottom > whole.bottom + tolerance) refuse("frame_outside", `step ${shown(step.id)} of frame ${shown(own)} is drawn outside the frame's body`);
  }
  // Arrows: a drawn part outside the end steps' boxes, meeting no filled step's box.
  const filled = steps.filter(step => styles.get(step.id)!.fillColor?.toLowerCase() !== "none");
  for (const edge of cells) {
    if (kinds.get(edge.id) !== "edge") continue;
    const o = origin(edge.id), points = edge.geometry!.points ?? {};
    const end = (ref: string | null, point: Point | undefined): Point | null => {
      if (ref !== null) { const b = box.get(ref)!; return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }; }
      return point ? { x: o.x + point.x, y: o.y + point.y } : null;
    };
    const p = end(edge.source, points.sourcePoint), q = end(edge.target, points.targetPoint);
    if (!p || !q) return refuse("arrow_hidden", `arrow ${shown(edge.id)} has an end with neither a step nor a point, so draw.io does not draw it`);
    let from = 0, to = 1;
    if (edge.source !== null) { const range = inside(p, q, box.get(edge.source)!); if (range) from = Math.max(from, range[1]); }
    if (edge.target !== null) { const range = inside(p, q, box.get(edge.target)!); if (range) to = Math.min(to, range[0]); }
    const length = Math.hypot(q.x - p.x, q.y - p.y) * (to - from), need = DRAWIO_ARROW_MARGIN.length;
    if (!(length >= need - tolerance)) {
      const rounded = Math.round(length * 10) / 10;
      refuse("arrow_hidden", `arrow ${shown(edge.id)} has ${!(length > 0) ? "no length" : rounded < need ? `only ${rounded} px` : `less than ${need} px`} outside its end steps (${need} px needed)`);
    }
    const a = { x: p.x + (q.x - p.x) * from, y: p.y + (q.y - p.y) * from }, b = { x: p.x + (q.x - p.x) * to, y: p.y + (q.y - p.y) * to };
    // A drawn part exactly the clearance away, on the edge of the widened box, keeps it.
    const margin = DRAWIO_ARROW_MARGIN.clearance, reach = margin - tolerance;
    for (const step of filled) {
      if (step.id === edge.source || step.id === edge.target) continue;
      const near = box.get(step.id)!, range = inside(a, b, { left: near.left - reach, top: near.top - reach, right: near.right + reach, bottom: near.bottom + reach });
      if (range && Math.min(1, range[1]) > Math.max(0, range[0])) refuse("arrow_hidden", `arrow ${shown(edge.id)} comes within ${margin} px of filled step ${shown(step.id)}`);
    }
  }
}

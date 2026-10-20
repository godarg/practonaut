/**
 * The real engine's SVG export of a final board, made safe to show inline in a report (PADR-0039
 * B.4). `board.svg` comes from a bench folder that anyone with access could have changed, so it is
 * hostile input: it is parsed by a small strict XML reader (no DOCTYPE, entities other than the
 * five predefined and numeric references, CDATA or processing instructions) and re-serialised from
 * an allowlist — geometry and paint elements and attributes only, local `url(#id)` references only,
 * every id prefixed so several pictures share one page. Styles, scripts, links, fonts, comments,
 * metadata and any unknown element or attribute are dropped; text is escaped again, control and bidi
 * characters shown escaped. Board text therefore reaches the page as text, never as markup. Anything
 * the reader cannot parse is refused (the report then draws its schematic instead).
 */
import { readableText } from '../cli/output.ts';
import { pictureSizeClass, type Box } from './schematic.ts';

/** The largest SVG read (Excalidraw's export of a three-step board is about 8 KB). */
export const MAX_SVG_BYTES = 4 * 1024 * 1024;
const MAX_NODES = 50_000, MAX_DEPTH = 64;

const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'ellipse', 'circle', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'clipPath', 'mask']);
const TEXT_ELEMENTS = new Set(['text', 'tspan']);
const ATTRIBUTES = new Set(['id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform', 'viewBox',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit',
  'fill-opacity', 'fill-rule', 'clip-rule', 'opacity', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'direction',
  'clip-path', 'mask', 'maskUnits', 'clipPathUnits', 'maskContentUnits']);
/** Plain values: numbers, words, colours, transforms and path data; nothing that could open markup or a URL. */
const VALUE = /^[A-Za-z0-9 #.,%()+\-_]*$/;
const IDENT = /^[A-Za-z0-9_-]{1,64}$/;

export class SvgRefused extends Error { constructor(reason: string) { super(`board.svg refused: ${reason}`); this.name = 'SvgRefused'; } }

interface Element { name: string; attributes: Array<[string, string]>; children: Array<Element | string> }

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text: string): string {
  return text.replace(/&(#x[0-9A-Fa-f]{1,6}|#[0-9]{1,7}|[A-Za-z]+);|&/g, (match, entity: string | undefined) => {
    if (entity === undefined) throw new SvgRefused('a bare ampersand');
    if (entity.startsWith('#')) {
      const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!(code > 0 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) throw new SvgRefused('an invalid character reference');
      return String.fromCodePoint(code);
    }
    const value = ENTITIES[entity];
    if (value === undefined) throw new SvgRefused(`the entity &${entity};`);
    return value;
  });
}

/** A strict reader for the XML subset an SVG export uses. */
function parse(text: string): Element {
  let at = 0, nodes = 0;
  const fail = (reason: string): never => { throw new SvgRefused(reason); };
  const skipSpace = (): void => { while (at < text.length && /\s/.test(text[at]!)) at++; };
  const name = (): string => {
    const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(text.slice(at, at + 128));
    if (!match) return fail('a malformed name');
    at += match[0].length; return match[0];
  };
  const misc = (): void => {
    for (;;) {
      skipSpace();
      if (text.startsWith('<?xml', at)) { const end = text.indexOf('?>', at); if (end < 0) fail('an unterminated declaration'); at = end + 2; continue; }
      if (text.startsWith('<!--', at)) { const end = text.indexOf('-->', at + 4); if (end < 0) fail('an unterminated comment'); at = end + 3; continue; }
      return;
    }
  };
  const element = (depth: number): Element => {
    if (depth > MAX_DEPTH) fail('too deep');
    if (++nodes > MAX_NODES) fail('too many nodes');
    if (text[at] !== '<') fail('expected an element');
    at++;
    const tag = name(), attributes: Array<[string, string]> = [], seen = new Set<string>();
    for (;;) {
      const before = at; skipSpace();
      if (text.startsWith('/>', at)) { at += 2; return { name: tag, attributes, children: [] }; }
      if (text[at] === '>') { at++; break; }
      if (at === before) fail('attributes without space');
      const key = name(); skipSpace();
      if (text[at] !== '=') fail('an attribute without a value');
      at++; skipSpace();
      const quote = text[at];
      if (quote !== '"' && quote !== "'") fail('an unquoted attribute');
      const end = text.indexOf(quote!, at + 1);
      if (end < 0) fail('an unterminated attribute');
      const raw = text.slice(at + 1, end);
      if (raw.includes('<')) fail('markup inside an attribute');
      if (seen.has(key)) fail('a repeated attribute');
      seen.add(key); attributes.push([key, decode(raw)]); at = end + 1;
    }
    const children: Array<Element | string> = [];
    for (;;) {
      if (at >= text.length) fail(`an unclosed <${tag}>`);
      if (text.startsWith('</', at)) {
        at += 2; const closing = name(); skipSpace();
        if (closing !== tag || text[at] !== '>') fail('a mismatched end tag');
        at++; return { name: tag, attributes, children };
      }
      if (text.startsWith('<!--', at)) { const end = text.indexOf('-->', at + 4); if (end < 0) fail('an unterminated comment'); at = end + 3; continue; }
      if (text.startsWith('<!', at) || text.startsWith('<?', at)) fail('a declaration, CDATA section or processing instruction');
      if (text[at] === '<') { children.push(element(depth + 1)); continue; }
      const end = text.indexOf('<', at), raw = text.slice(at, end < 0 ? text.length : end);
      if (++nodes > MAX_NODES) fail('too many nodes');
      children.push(decode(raw)); at += raw.length;
    }
  };
  misc();
  if (text.startsWith('<!', at)) fail('a DOCTYPE');
  const root = element(0);
  misc();
  if (at !== text.length) fail('content after the root element');
  if (root.name !== 'svg') fail('the root is not <svg>');
  return root;
}

const escapeText = (value: string): string => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!);

/** Functions a kept value may call: the transforms. CSS names functions case-insensitively. */
const FUNCTIONS = new Set(['translate', 'rotate', 'scale', 'matrix', 'skewx', 'skewy']);
/** A kept attribute value, with local references renamed; null drops the attribute. Backslashes,
 * quotes and colons cannot occur (VALUE), so no CSS escape can hide a function name. */
function keptValue(key: string, value: string, prefix: string): string | null {
  if (key === 'id') return IDENT.test(value) ? `${prefix}-${value}` : null;
  if (value.length > 200_000 || !VALUE.test(value) || /javascript|expression|data/i.test(value)) return null;
  // Only a whole local reference, in any letter case: url(#name), written back as url(#prefix-name).
  const local = /^url\(\s*#([A-Za-z0-9_-]{1,64})\s*\)$/i.exec(value.trim());
  if (local) return `url(#${prefix}-${local[1]})`;
  // Any other function call (url( to anything else, image(, var(, env( …) drops the attribute.
  for (const call of value.matchAll(/([A-Za-z_-][A-Za-z0-9_-]*)\s*\(/g)) if (!FUNCTIONS.has(call[1]!.toLowerCase())) return null;
  return value;
}

function serialise(node: Element, prefix: string, root: boolean, ids = true): string {
  if (!ELEMENTS.has(node.name)) return '';
  const attributes = node.attributes.flatMap(([key, value]) => {
    if (!ATTRIBUTES.has(key) || (root && (key === 'width' || key === 'height')) || (!ids && key === 'id')) return [];
    const kept = keptValue(key, value, prefix);
    return kept === null ? [] : [` ${key}="${kept}"`];
  }).join('');
  const children = node.children.map(child => typeof child === 'string' ? (TEXT_ELEMENTS.has(node.name) ? escapeText(readableText(child)) : '') : serialise(child, prefix, false, ids)).join('');
  return root ? children : `<${node.name}${attributes}>${children}</${node.name}>`;
}

/** One text of the export (a label's lines, a frame's name) with where it lies, and its markup again
 * (ids left out) so the report can draw it once more over its own marks. */
export interface EngineText { box: Box; markup: string }
/** An export, read: its viewBox and its allowlisted content (ids prefixed), not yet placed, the
 * smallest font size of its text in board units (Excalidraw draws a frame's name at 14) or null, and
 * where its texts and outlines (unfilled rectangles: frames) lie in its own units. The
 * report keeps its judged lines off the texts and its labels off texts and outlines (design review
 * L1-F4). Geometry is read only where the transform is a translation (with a zero rotation, as
 * Excalidraw writes it); anything else is left out of these lists, never guessed. */
export interface EngineSvg { box: Box; content: string; smallestText: number | null; texts: EngineText[]; outlines: Box[] }
const TRANSFORM = /^\s*translate\(\s*(-?[0-9.]+)(?:\s*,\s*|\s+)(-?[0-9.]+)\s*\)(?:\s*rotate\(\s*(-?[0-9.]+)(?:(?:\s*,\s*|\s+)(-?[0-9.]+)(?:\s*,\s*|\s+)(-?[0-9.]+))?\s*\))?\s*$/i;
function exportGeometry(root: Element, prefix: string): Pick<EngineSvg, 'texts' | 'outlines'> {
  const texts: EngineText[] = [], outlines: Box[] = [];
  const attribute = (node: Element, key: string): string | undefined => node.attributes.find(([name]) => name === key)?.[1];
  const number = (node: Element, key: string): number => parseFloat(attribute(node, key) ?? '');
  const estimate = (node: Element, dx: number, dy: number): Box | null => {
    const size = number(node, 'font-size'), x = number(node, 'x'), y = number(node, 'y');
    if (![size, x, y].every(Number.isFinite) || size <= 0) return null;
    const content = node.children.map(child => typeof child === 'string' ? child : '').join(''), width = [...content].length * size * 0.62;
    const anchor = attribute(node, 'text-anchor');
    return { x: dx + x - (anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0), y: dy + y - size * 0.9, width, height: size * 1.2 };
  };
  const visit = (node: Element, dx: number, dy: number): void => {
    if (!ELEMENTS.has(node.name) || node.name === 'defs' || node.name === 'clipPath' || node.name === 'mask') return;
    const transform = attribute(node, 'transform');
    let x = dx, y = dy, own: Box | null = null;
    if (transform !== undefined) {
      const match = TRANSFORM.exec(transform);
      if (!match || (match[3] !== undefined && Number(match[3]) !== 0)) return;
      x += Number(match[1]); y += Number(match[2]);
      if (match[4] !== undefined && Number(match[4]) >= 0 && Number(match[5]) >= 0) own = { x, y, width: 2 * Number(match[4]), height: 2 * Number(match[5]) };
    }
    const elements = node.children.filter((child): child is Element => typeof child !== 'string');
    const lines = elements.filter(child => child.name === 'text');
    if (node.name === 'g' && lines.length) {
      // Excalidraw's text group: its rotation centre is the middle of the text's box as Excalidraw set it.
      // The report draws the text in its own font, so the box also covers that font's estimate.
      const boxes = [...(own && own.width > 0 ? [own] : []), ...lines.map(line => estimate(line, x, y)).filter((box): box is Box => box !== null)];
      const box = boxes.length ? boxes.reduce((a, b) => { const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y); return { x: left, y: top, width: Math.max(a.x + a.width, b.x + b.width) - left, height: Math.max(a.y + a.height, b.y + b.height) - top }; }) : null;
      if (box) texts.push({ box, markup: `<g transform="translate(${numeral(dx)} ${numeral(dy)})">${serialise(node, prefix, false, false)}</g>` });
      return;
    }
    if (node.name === 'text') { const box = estimate(node, x, y); if (box) texts.push({ box, markup: `<g transform="translate(${numeral(dx)} ${numeral(dy)})">${serialise(node, prefix, false, false)}</g>` }); return; }
    if (node.name === 'rect') {
      const width = number(node, 'width'), height = number(node, 'height');
      const left = x + (Number.isFinite(number(node, 'x')) ? number(node, 'x') : 0), top = y + (Number.isFinite(number(node, 'y')) ? number(node, 'y') : 0);
      if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && attribute(node, 'fill') === 'none' && attribute(node, 'stroke') !== undefined) outlines.push({ x: left, y: top, width, height });
      return;
    }
    for (const child of elements) visit(child, x, y);
  };
  visit(root, 0, 0);
  return { texts, outlines };
}
function smallestText(node: Element): number | null {
  let smallest: number | null = null;
  const visit = (element: Element): void => {
    if (element.name === 'text') {
      const size = parseFloat(element.attributes.find(([key]) => key === 'font-size')?.[1] ?? '');
      if (Number.isFinite(size) && size > 0) smallest = smallest === null ? size : Math.min(smallest, size);
    }
    for (const child of element.children) if (typeof child !== 'string') visit(child);
  };
  visit(node);
  return smallest;
}
export function readEngineSvg(text: string, prefix: string): EngineSvg {
  if (Buffer.byteLength(text, 'utf8') > MAX_SVG_BYTES) throw new SvgRefused('too large');
  if (!IDENT.test(prefix)) throw new SvgRefused('an invalid id prefix');
  const root = parse(text);
  const viewBox = (root.attributes.find(([key]) => key === 'viewBox')?.[1] ?? '').trim();
  if (!/^-?[0-9.]+ -?[0-9.]+ [0-9.]+ [0-9.]+$/.test(viewBox)) throw new SvgRefused('no usable viewBox');
  const [x, y, width, height] = viewBox.split(' ').map(Number) as [number, number, number, number];
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new SvgRefused('no usable viewBox');
  // Excalidraw paints its background as the first rectangle over the whole viewBox: paper, not content.
  // It is left out, so a picture shown in a larger shared viewBox sits on the report's own canvas.
  const first = root.children.find((child): child is Element => typeof child !== 'string' && ELEMENTS.has(child.name) && child.name !== 'defs');
  const value = (node: Element, key: string): number => Number(node.attributes.find(([name]) => name === key)?.[1] ?? NaN);
  if (first?.name === 'rect' && value(first, 'x') === x && value(first, 'y') === y && value(first, 'width') === width && value(first, 'height') === height && first.children.length === 0) root.children.splice(root.children.indexOf(first), 1);
  return { box: { x, y, width, height }, content: serialise(root, prefix, true), smallestText: smallestText(root), ...exportGeometry(root, prefix) };
}
function numeral(value: number): string { return String(Math.round(value * 100) / 100); }

/**
 * The export's drawing as inline SVG markup: `<svg viewBox class role aria-label>` around the
 * allowlisted content. `label` becomes the accessible name (escaped here); `classes` the class list.
 * With `offset` the drawing is moved by that many board units and shown in `viewBox` (the union with
 * the picture beside it), so a pair shares one coordinate system and one scale; `overlay` (trusted
 * markup the report draws, never from the file) is laid over it in those units.
 */
export function engineSvgMarkup(text: string | EngineSvg, options: { prefix: string; label: string; classes: string; offset?: [number, number]; viewBox?: Box; overlay?: string; sizeWidth?: number }): string {
  const read = typeof text === 'string' ? readEngineSvg(text, options.prefix) : text;
  const view = options.viewBox ?? (options.offset ? { ...read.box, x: read.box.x + options.offset[0], y: read.box.y + options.offset[1] } : read.box);
  const label = readableText(options.label).replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
  // `overlay` is the report's own markup (the judged state's group outline and judged geometry), in the
  // shared viewBox's units. Only the export's own content is in `engine-content`, the group the dark
  // theme filters (design review L1-F5): the overlay keeps its own colours.
  const content = `<g class="engine-content">${options.offset ? `<g transform="translate(${numeral(options.offset[0])} ${numeral(options.offset[1])})">${read.content}</g>` : read.content}</g>` + (options.overlay ?? '');
  return `<svg viewBox="${numeral(view.x)} ${numeral(view.y)} ${numeral(view.width)} ${numeral(view.height)}" class="${options.classes} ${pictureSizeClass(options.sizeWidth ?? view.width)}" role="img" aria-label="${label}">${content}</svg>`;
}
/** A ringed step's label as the export draws it, drawn again over the judged ring with a halo in the
 * colour behind it: the step's own fill, else the report's canvas (the export's paper is left out). Its
 * colours are the content tokens, Excalidraw's own values in either theme, so it stays outside the dark
 * filter like the rest of the overlay (design review L1-F2, L1-F5). */
export function exportHalo(read: EngineSvg, offset: [number, number]): (step: Box & { fill?: string }) => string {
  const inside = (box: Box, x: number, y: number): boolean => x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  return step => {
    // The export's texts whose middle lies in the step's box, in the export's own units.
    const local = { x: step.x - offset[0], y: step.y - offset[1], width: step.width, height: step.height };
    const texts = read.texts.filter(text => inside(local, text.box.x + text.box.width / 2, text.box.y + text.box.height / 2));
    if (!texts.length) return '';
    const behind = step.fill && Object.hasOwn(HALO_FILLS, step.fill) ? ` ${HALO_FILLS[step.fill]}` : '';
    return `<g class="engine-halo${behind}" transform="translate(${numeral(offset[0])} ${numeral(offset[1])})">${texts.map(text => text.markup).join('')}</g>`;
  };
}
// Palette names map to halo classes on the content tokens; no colour value lives in code.
const HALO_FILLS: Readonly<Record<string, string>> = { red: 'sch-halo--fill-red', green: 'sch-halo--fill-green', blue: 'sch-halo--fill-blue', yellow: 'sch-halo--fill-yellow' };

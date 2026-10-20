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

function serialise(node: Element, prefix: string, root: boolean): string {
  if (!ELEMENTS.has(node.name)) return '';
  const attributes = node.attributes.flatMap(([key, value]) => {
    if (!ATTRIBUTES.has(key) || (root && (key === 'width' || key === 'height'))) return [];
    const kept = keptValue(key, value, prefix);
    return kept === null ? [] : [` ${key}="${kept}"`];
  }).join('');
  const children = node.children.map(child => typeof child === 'string' ? (TEXT_ELEMENTS.has(node.name) ? escapeText(readableText(child)) : '') : serialise(child, prefix, false)).join('');
  return root ? children : `<${node.name}${attributes}>${children}</${node.name}>`;
}

/** An export, read: its viewBox and its allowlisted content (ids prefixed), not yet placed, and the
 * smallest font size of its text in board units (Excalidraw draws a frame's name at 14), or null. */
export interface EngineSvg { box: Box; content: string; smallestText: number | null }
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
  return { box: { x, y, width, height }, content: serialise(root, prefix, true), smallestText: smallestText(root) };
}
const numeral = (value: number): string => String(Math.round(value * 100) / 100);

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
  // `overlay` is the report's own markup (the judged state's group outline), in the shared viewBox's units.
  const content = (options.offset ? `<g transform="translate(${numeral(options.offset[0])} ${numeral(options.offset[1])})">${read.content}</g>` : read.content) + (options.overlay ?? '');
  return `<svg viewBox="${numeral(view.x)} ${numeral(view.y)} ${numeral(view.width)} ${numeral(view.height)}" class="${options.classes} ${pictureSizeClass(options.sizeWidth ?? view.width)}" role="img" aria-label="${label}">${content}</svg>`;
}

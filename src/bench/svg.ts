/**
 * The real engine's SVG export of a final board, made safe to show inline in a report (PADR-0039
 * B.4). `board.svg` comes from a bench folder that anyone with access could have changed, so it is
 * hostile input: it is parsed by a small strict XML reader (no DOCTYPE, entities other than the
 * five predefined and numeric references, CDATA or processing instructions) and re-serialised from
 * an allowlist — geometry and paint elements and attributes only, local `url(#id)` references only,
 * every id prefixed so several pictures share one page. Styles, scripts, links, fonts, comments,
 * metadata and any unknown element or attribute are dropped; text is escaped again. Board text
 * therefore reaches the page as text, never as markup. Anything the reader cannot parse is refused
 * (the report then draws its schematic instead).
 */

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
  const children = node.children.map(child => typeof child === 'string' ? (TEXT_ELEMENTS.has(node.name) ? escapeText(child) : '') : serialise(child, prefix, false)).join('');
  return root ? children : `<${node.name}${attributes}>${children}</${node.name}>`;
}

/**
 * The export's drawing as inline SVG markup: `<svg viewBox class role aria-label>` around the
 * allowlisted content. `label` becomes the accessible name (escaped here); `classes` the class list.
 */
export function engineSvgMarkup(text: string, options: { prefix: string; label: string; classes: string }): string {
  if (Buffer.byteLength(text, 'utf8') > MAX_SVG_BYTES) throw new SvgRefused('too large');
  if (!IDENT.test(options.prefix)) throw new SvgRefused('an invalid id prefix');
  const root = parse(text);
  const viewBox = root.attributes.find(([key]) => key === 'viewBox')?.[1] ?? '';
  if (!/^-?[0-9.]+ -?[0-9.]+ [0-9.]+ [0-9.]+$/.test(viewBox.trim())) throw new SvgRefused('no usable viewBox');
  const label = options.label.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
  return `<svg viewBox="${viewBox.trim()}" class="${options.classes}" role="img" aria-label="${label}">${serialise(root, options.prefix, true)}</svg>`;
}

/**
 * Icon set: 24-unit grid, 1.75 stroke (token --pn-stroke-icon), round caps and joins, currentColor.
 * Markup is static and trusted; never build an icon from author or recording data.
 * Add an icon here, then show it in the gallery. Names describe the shape's meaning, not its place of use.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const dot = (x: number, y: number): string => `<path d="M${x} ${y}h.01" stroke-width="2.6"/>`;

export const iconMarkup = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  chevronDown: '<path d="M5 9l7 7 7-7"/>',
  chevronUp: '<path d="M5 15l7-7 7 7"/>',
  arrowRight: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  arrowDown: '<path d="M12 4v15M6 13l6 6 6-6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  reset: '<path d="M4 12a8 8 0 102.6-5.9"/><path d="M6.6 2.6v3.5h3.5"/>',
  lightbulb: '<path d="M9 18.5h6M10 21h4"/><path d="M12 3a6 6 0 00-3.4 10.9c.5.4.9 1.1.9 1.8v.3h5v-.3c0-.7.4-1.4.9-1.8A6 6 0 0012 3z"/>',
  connect: '<rect x="3" y="3.5" width="8" height="6" rx="2"/><rect x="13" y="14.5" width="8" height="6" rx="2"/><path d="M7 9.5V12a2.5 2.5 0 002.5 2.5H13"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 11.3a2 2 0 002 1.7h5.4a2 2 0 002-1.7L17.5 7"/><path d="M10 11v5M14 11v5"/>',
  pencil: '<path d="M4 20l1-4.2L16.6 4.2a2.2 2.2 0 013.1 3.1L8.2 18.9z"/><path d="M14.5 6.3l3.2 3.2"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  swap: '<path d="M6 8h12M14.5 4.5L18 8l-3.5 3.5"/><path d="M18 16H6M9.5 12.5L6 16l3.5 3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
  moon: '<path d="M19.5 14.2A8 8 0 019.8 4.5a8 8 0 109.7 9.7z"/>',
  contrast: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 000-17z" fill="currentColor"/>',
  record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.8" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="3" fill="currentColor" stroke="none"/>',
  play: '<path d="M8.5 5.8v12.4a.8.8 0 001.2.7l9.6-6.2a.8.8 0 000-1.4L9.7 5.1a.8.8 0 00-1.2.7z" fill="currentColor"/>',
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/>${dot(12, 7.8)}`,
  warning: `<path d="M10.3 4.9L2.9 17.7A2 2 0 004.6 20.7h14.8a2 2 0 001.7-3L13.7 4.9a2 2 0 00-3.4 0z"/><path d="M12 10v4.5"/>${dot(12, 17.4)}`,
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.5"/>',
  checkCircleFill: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M7.7 12.4l3 3 5.6-6" stroke="var(--pn-color-surface)" stroke-width="2.2"/>',
  xCircleFill: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M9 9l6 6M15 9l-6 6" stroke="var(--pn-color-surface)" stroke-width="2.2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  dashedCircle: '<circle cx="12" cy="12" r="9" stroke-dasharray="2.4 3"/>',
  helpCircle: `<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.3"/>${dot(12, 16.8)}`,
  document: '<path d="M7 3.5h6.5l5 5v10a2 2 0 01-2 2H7a2 2 0 01-2-2v-13a2 2 0 012-2z"/><path d="M13.5 3.5v5h5"/>',
  folder: '<path d="M3.5 7.5a2 2 0 012-2H9l2 2.5h7.5a2 2 0 012 2v8a2 2 0 01-2 2h-13a2 2 0 01-2-2z"/>',
  download: '<path d="M12 4v11M7.5 10.8l4.5 4.5 4.5-4.5M5 19.5h14"/>',
  external: '<path d="M14 4h6v6M20 4l-9.5 9.5"/><path d="M18 14.5V18a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h3.5"/>',
  shield: '<path d="M12 3.2l7 2.8v5.2c0 4.3-2.9 7.8-7 9.6-4.1-1.8-7-5.3-7-9.6V6z"/><path d="M8.8 12l2.3 2.3 4.2-4.6"/>',
  list: `<path d="M9 6.5h11M9 12h11M9 17.5h11"/>${dot(4.8, 6.5)}${dot(4.8, 12)}${dot(4.8, 17.5)}`,
  layers: '<path d="M12 4l8.5 4.5L12 13 3.5 8.5z"/><path d="M3.5 12.5L12 17l8.5-4.5"/><path d="M3.5 16.5L12 21l8.5-4.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  flow: '<rect x="3" y="8" width="6.5" height="8" rx="2"/><rect x="14.5" y="8" width="6.5" height="8" rx="2"/><path d="M10.7 12h2.6M12 10.7l1.4 1.3-1.4 1.3"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l4.5-4.5 3.5 3.5 3-3 5 5"/>',
  keyboard: `<rect x="2.8" y="6" width="18.4" height="12" rx="2.5"/>${dot(6.8, 10)}${dot(10.2, 10)}${dot(13.8, 10)}${dot(17.2, 10)}<path d="M7.5 14h9"/>`,
  ellipsis: `${dot(5.5, 12)}${dot(12, 12)}${dot(18.5, 12)}`,
  shuffle: '<path d="M4 7h3.5c5 0 5 10 10 10H20M4 17h3.5c1.6 0 2.8-.7 3.8-1.8M20 7h-2.5c-1.6 0-2.8.7-3.8 1.8"/><path d="M17.5 4.5L20 7l-2.5 2.5M17.5 14.5L20 17l-2.5 2.5"/>',
  hand: '<path d="M8 12V6.2a1.6 1.6 0 013.2 0V11M11.2 10V4.8a1.6 1.6 0 013.2 0V11M14.4 10.5V6.5a1.6 1.6 0 013.2 0V14c0 3.6-2.4 6.5-6 6.5-2.6 0-4-1.2-5.4-3.4L4.2 14a1.5 1.5 0 012.4-1.7L8 14"/>',
} as const;

export type IconName = keyof typeof iconMarkup;

type Shape = { tag: string; attributes: Array<[string, string]> };
const parsed = new Map<IconName, Shape[]>();

/** The host enforces Trusted Types, so markup is turned into nodes without innerHTML. */
function shapes(name: IconName): Shape[] {
  const known = parsed.get(name);
  if (known) return known;
  const list: Shape[] = [];
  for (const element of iconMarkup[name].matchAll(/<(\w+)\s+([^>]*?)\/>/g)) {
    const attributes: Array<[string, string]> = [];
    for (const attribute of element[2]!.matchAll(/([\w-]+)="([^"]*)"/g)) attributes.push([attribute[1]!, attribute[2]!]);
    list.push({ tag: element[1]!, attributes });
  }
  parsed.set(name, list);
  return list;
}

export function icon(name: IconName, size?: 'sm' | 'lg'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', size ? `pn-icon pn-icon--${size}` : 'pn-icon');
  for (const shape of shapes(name)) {
    const node = document.createElementNS(SVG_NS, shape.tag);
    for (const [key, value] of shape.attributes) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

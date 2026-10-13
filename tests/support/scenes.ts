/** Native Excalidraw scene builder for tests and library sources. Written in the app's own field
 * names (as saved by excalidraw.com 0.18); it never calls Practonaut's adapter serializer. */
export interface ShapeOptions { shape?: 'rectangle' | 'ellipse' | 'diamond'; width?: number; height?: number; stroke?: string; fill?: string; frameId?: string | null; groupIds?: string[]; fontFamily?: number }
export type Element = Record<string, unknown>;
let nonce = 1000;
const common = (id: string, type: string, x: number, y: number, width: number, height: number, extra: Element = {}): Element => ({
  id, type, x, y, width, height, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
  groupIds: [], frameId: null, index: null, roundness: type === 'rectangle' ? { type: 3 } : null, seed: nonce++, version: 1, versionNonce: nonce++, isDeleted: false, boundElements: null, updated: 1760000000000, link: null, locked: false, ...extra,
});
export function frame(id: string, name: string, x: number, y: number, width: number, height: number): Element {
  return common(id, 'frame', x, y, width, height, { name, roundness: null });
}
/** A shape with its bound label (omitted when the label is empty). */
export function box(id: string, label: string, x: number, y: number, options: ShapeOptions = {}): Element[] {
  const width = options.width ?? 180, height = options.height ?? 90, shape = options.shape ?? 'rectangle';
  const container = common(id, shape, x, y, width, height, { strokeColor: options.stroke ?? '#1e1e1e', backgroundColor: options.fill ?? 'transparent', frameId: options.frameId ?? null, groupIds: options.groupIds ?? [], boundElements: label ? [{ type: 'text', id: `${id}-label` }] : null });
  if (!label) return [container];
  const text = common(`${id}-label`, 'text', x + 10, y + height / 2 - 12, width - 20, 25, { text: label, originalText: label, fontSize: 20, fontFamily: options.fontFamily ?? 5, textAlign: 'center', verticalAlign: 'middle', containerId: id, autoResize: true, lineHeight: 1.25, frameId: options.frameId ?? null, groupIds: options.groupIds ?? [] });
  return [container, text];
}
/** An arrow bound at both ends (or loose where an end is null). Back-references are added by `scene`. */
export function arrow(id: string, from: string | null, to: string | null, at: { x: number; y: number; dx: number; dy: number } = { x: 0, y: 0, dx: 100, dy: 0 }, frameId: string | null = null): Element {
  return common(id, 'arrow', at.x, at.y, Math.abs(at.dx), Math.abs(at.dy), { points: [[0, 0], [at.dx, at.dy]], lastCommittedPoint: null, startBinding: from ? { elementId: from, focus: 0, gap: 6 } : null, endBinding: to ? { elementId: to, focus: 0, gap: 6 } : null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false, frameId, roundness: { type: 2 } });
}
/** A complete .excalidraw file. Arrow back-references are filled in as the editor does. */
export type Nested = Element | Nested[];
export function scene(elements: Nested[]): string {
  const flat = (elements.flat(8) as Element[]).map(e => structuredClone(e));
  for (const e of flat) if (e.type === 'arrow') for (const binding of [e.startBinding, e.endBinding] as Array<{ elementId: string } | null>) {
    const target = binding ? flat.find(t => t.id === binding.elementId) : undefined;
    if (target) target.boundElements = [...((target.boundElements as Element[] | null) ?? []), { type: 'arrow', id: e.id }];
  }
  return JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: flat, appState: { gridSize: 20, gridStep: 5, gridModeEnabled: false, viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) + '\n';
}
/** Arrow geometry between two boxes laid out on a row (cosmetic; ends are bindings). */
export function between(a: { x: number; y: number }, b: { x: number; y: number }, width = 180, height = 90): { x: number; y: number; dx: number; dy: number } {
  return { x: a.x + width + 6, y: a.y + height / 2, dx: b.x - a.x - width - 12, dy: b.y - a.y };
}

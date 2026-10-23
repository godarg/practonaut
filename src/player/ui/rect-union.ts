/**
 * The union of axis-aligned rectangles as disjoint rectangles, and a clip path that keeps everything
 * outside that union. Pure display geometry, shared by the Player's board and the report's pictures:
 * judged lines leave text free (design language §10.2). Cutting each area out with `evenodd` alone
 * would bring back the parts where two areas overlap (they would be cut out twice), so the areas are
 * first made disjoint: vertical slabs between every two neighbouring x-edges, each with the merged
 * y-ranges of the rectangles that span it.
 */
export interface Rect { x: number; y: number; width: number; height: number }

export function rectUnion(rects: readonly Rect[]): Rect[] {
  const live = rects.filter(rect => rect.width > 0 && rect.height > 0 && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite));
  const edges = [...new Set(live.flatMap(rect => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const left = edges[i]!, right = edges[i + 1]!;
    const spans = live.filter(rect => rect.x <= left && rect.x + rect.width >= right).map(rect => [rect.y, rect.y + rect.height] as [number, number]).sort((a, b) => a[0] - b[0]);
    let open: [number, number] | undefined;
    for (const span of spans) {
      if (open && span[0] <= open[1]) open[1] = Math.max(open[1], span[1]);
      else { if (open) out.push({ x: left, y: open[0], width: right - left, height: open[1] - open[0] }); open = [span[0], span[1]]; }
    }
    if (open) out.push({ x: left, y: open[0], width: right - left, height: open[1] - open[0] });
  }
  return out;
}

/** Path data (for `clip-rule="evenodd"`) of `outer` with the union of `holes` cut out: every point
 * inside a hole lies in exactly two of the path's rectangles (holes are first cut to `outer`).
 * `format` writes a number. */
export function outsidePath(outer: Rect, holes: readonly Rect[], format: (value: number) => string = String): string {
  const area = (r: Rect): string => `M ${format(r.x)} ${format(r.y)} h ${format(r.width)} v ${format(r.height)} h ${format(-r.width)} Z`;
  const inside = holes.map(hole => {
    const x = Math.max(hole.x, outer.x), y = Math.max(hole.y, outer.y);
    return { x, y, width: Math.min(hole.x + hole.width, outer.x + outer.width) - x, height: Math.min(hole.y + hole.height, outer.y + outer.height) - y };
  });
  return [area(outer), ...rectUnion(inside).map(area)].join(' ');
}

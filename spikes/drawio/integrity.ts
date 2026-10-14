/**
 * Adapter-side write check: every cell the adapter wrote must come back from draw.io's export with
 * the same attributes, and no cell may appear that the adapter did not write.
 *
 * Added after the first negative run: draw.io silently moves a cell whose parent does not exist into
 * layer 1, which a comparison on the declared set alone cannot see when the result happens to match
 * the prediction. The cell table comes from the spike's XML reader (tokenizing only); the semantic
 * projection used by the checker is not involved.
 */
import { readDrawio, type Cell } from './parser.ts';

const fields = (c: Cell): string => JSON.stringify([c.parent, c.value, c.style, c.vertex, c.edge, c.source, c.target, c.geometry, Object.entries(c.data).sort()]);

/** Differences between written and read-back cells (empty when the write landed exactly). */
export function cellRoundTrip(writtenXml: string, readXml: string): string[] {
  let written: Cell[], read: Cell[];
  try { written = readDrawio(writtenXml).cells; } catch (error) { return [`written XML unreadable: ${String(error).slice(0, 120)}`]; }
  try { read = readDrawio(readXml).cells; } catch (error) { return [`read-back unreadable: ${String(error).slice(0, 120)}`]; }
  const out: string[] = [];
  const byId = new Map<string, Cell>();
  for (const cell of written) { if (byId.has(cell.id)) out.push(`${cell.id}: written twice`); byId.set(cell.id, cell); }
  const seen = new Set<string>();
  for (const cell of read) {
    if (seen.has(cell.id)) { out.push(`${cell.id}: read back twice`); continue; }
    seen.add(cell.id);
    const mine = byId.get(cell.id);
    if (!mine) { out.push(`${cell.id}: not written but read back`); continue; }
    if (fields(mine) !== fields(cell)) out.push(`${cell.id}: written ${fields(mine).slice(0, 160)} read ${fields(cell).slice(0, 160)}`);
  }
  for (const id of byId.keys()) if (!seen.has(id)) out.push(`${id}: written but not read back`);
  return out.slice(0, 20);
}

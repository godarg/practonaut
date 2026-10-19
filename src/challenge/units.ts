/**
 * Units of the 0.3.0 gate (PADR-0042 decisions 1 and 2): a family on a toolchain, written
 * `<family>.<toolchain>`. The toolchain is Practonaut's own actions over MCP (`practonaut`, judged at
 * session level) or a foreign MCP server judged in artifact mode. The preregistered units are named
 * here; another unit needs a maintainer's approval by name. Pure: no I/O.
 */
import { FAMILIES, type Family } from './families.ts';

/** Practonaut's own actions over MCP: the session-level toolchain. */
export const PRACTONAUT_TOOLCHAIN = 'practonaut';
/** Foreign toolchains the preregistration names, judged in artifact mode. None is available until
 * artifact mode ships its toolchain definitions (PADR-0044 decision 4); the draw.io server's units are
 * named when its server is pinned. */
export const FOREIGN_TOOLCHAINS: ReadonlySet<string> = new Set(['excalidraw-mcp-0.3.2']);
/** Families whose limits only Practonaut's host enforces, and the co-actor family: refused on a
 * foreign toolchain (PADR-0042 decision 1). */
export const SESSION_ONLY_FAMILIES: ReadonlySet<string> = new Set(['limited-checks', 'tight-budget', 'human-edit']);
/** The preregistered units of 0.3.0 (PADR-0042 decision 2), at most ten. */
export const PREREGISTERED_UNITS: readonly string[] = Object.freeze([
  'layout.practonaut', 'human-edit.practonaut',
  'repair.excalidraw-mcp-0.3.2', 'injection.excalidraw-mcp-0.3.2', 'long-horizon.excalidraw-mcp-0.3.2', 'layout.excalidraw-mcp-0.3.2',
]);
/** Families named by the preregistration whose generators later strands add (P5b, the scenario strand). */
export const PLANNED_FAMILIES: ReadonlySet<string> = new Set(['layout', 'human-edit']);

/** A refusal about a unit, with the code the tool prints. */
export class UnitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'UnitError'; this.code = code; }
}

export interface Unit { id: string; family: string; toolchain: string; level: 'session' | 'artifact' }
const UNIT = /^([a-z][a-z-]{0,31})\.([a-z0-9][a-z0-9.-]{0,63})$/;
/** The unit's parts; the verdict level follows from the toolchain. */
export function parseUnit(id: string): Unit {
  const match = UNIT.exec(id);
  if (!match) throw new UnitError('unit_invalid', `a unit is written <family>.<toolchain>, for example layout.practonaut; ${JSON.stringify(id.slice(0, 80))} is not one`);
  const toolchain = match[2]!;
  return { id, family: match[1]!, toolchain, level: toolchain === PRACTONAUT_TOOLCHAIN ? 'session' : 'artifact' };
}
/** A unit's name inside a world id (world ids allow no dots). */
export const unitSlug = (id: string): string => id.replaceAll('.', '-');

/**
 * The unit as the tools accept it, or a named refusal: a session-only family on a foreign toolchain
 * (`unit_family_toolchain`), a unit outside the preregistration without the maintainer's approval
 * (`unit_not_preregistered`), a toolchain this Practonaut cannot run (`toolchain_unavailable`,
 * `toolchain_unknown`), or a family without a generator here (`family_unavailable`).
 */
export function checkUnit(id: string, maintainerApproved: boolean): Unit & { family: Family } {
  const unit = parseUnit(id);
  if (unit.level === 'artifact' && SESSION_ONLY_FAMILIES.has(unit.family))
    throw new UnitError('unit_family_toolchain', `${unit.family} relies on what only Practonaut's host enforces (limits or a co-actor); it is refused on the foreign toolchain ${unit.toolchain} (PADR-0042 decision 1)`);
  if (!PREREGISTERED_UNITS.includes(id) && !maintainerApproved)
    throw new UnitError('unit_not_preregistered', `${id} is not one of the preregistered units (${PREREGISTERED_UNITS.join(', ')}); another unit needs the maintainer: --maintainer-approved-unit ${id} (PADR-0042 decision 2)`);
  if (unit.level === 'artifact') {
    if (FOREIGN_TOOLCHAINS.has(unit.toolchain)) throw new UnitError('toolchain_unavailable', `${unit.toolchain} is judged in artifact mode, which this Practonaut does not ship yet; its units are gated once its toolchain definition exists`);
    throw new UnitError('toolchain_unknown', `${unit.toolchain} is no toolchain this Practonaut knows (practonaut, or a preregistered foreign server)`);
  }
  if (!(FAMILIES as readonly string[]).includes(unit.family))
    throw new UnitError('family_unavailable', PLANNED_FAMILIES.has(unit.family) ? `${unit.family} has no generator in this Practonaut yet; the change that adds it makes ${id} gateable` : `${unit.family} is no family this Practonaut knows (${FAMILIES.join(', ')})`);
  return { ...unit, family: unit.family as Family };
}

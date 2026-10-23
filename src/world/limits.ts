/** Threat-model §4 ceilings. A caller may lower, never raise a ceiling. */
export const RUNTIME_LIMITS = Object.freeze({
  maxJsonDepth: 64, maxJsonNodes: 250_000, maxPredicateDepth: 32, maxPredicateNodes: 4096,
  maxObjects: 10_000, maxActions: 10_000, maxSnapshots: 1000, maxSnapshotBytes: 64 * 1024 * 1024,
  maxText: 4096, maxName: 256, maxId: 64, checkerFuel: 1_000_000,
  checkerWallMs: 10_000, checkerMemoryBytes: 256 * 1024 * 1024,
  actionRatePerSecond: 50, actionBurst: 200,
});
/** Layout operators (PADR-0047 decision 4): the largest number of objects a selection may require and
 * the range every box edge a layout clause reads must lie in. Semantics, not runtime limits: lowering
 * one would change verdicts, so `lowerLimits` never applies to them. */
export const LAYOUT_LIMITS = Object.freeze({ count: 256, range: 1_000_000 });

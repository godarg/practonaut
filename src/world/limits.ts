/** Threat-model §4 ceilings. A caller may lower, never raise a ceiling. */
export const RUNTIME_LIMITS = Object.freeze({
  maxJsonDepth: 64, maxJsonNodes: 250_000, maxPredicateDepth: 32, maxPredicateNodes: 4096,
  maxObjects: 10_000, maxActions: 10_000, maxSnapshots: 1000, maxSnapshotBytes: 64 * 1024 * 1024,
  maxText: 4096, maxName: 256, maxId: 64, checkerFuel: 1_000_000,
  checkerWallMs: 10_000, checkerMemoryBytes: 256 * 1024 * 1024,
  actionRatePerSecond: 50, actionBurst: 200,
});

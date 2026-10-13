// Package limits (threat model §4). Code constants with named errors. A caller may LOWER a
// limit (tests, a stricter CLI flag later); raising one needs a code change with a test.
// There is deliberately no environment variable that changes these values.
export const LIMITS = Object.freeze({
  /** E_ARCHIVE_TOO_LARGE */
  maxArchiveBytes: 16 * 1024 * 1024,
  /** E_TOO_MANY_ENTRIES (including manifest.json and directory entries) */
  maxEntries: 256,
  /** E_INVALID_PATH: characters per entry name */
  maxPathLength: 200,
  /** E_INVALID_PATH: segments per entry name */
  maxPathDepth: 8,
  /** E_ENTRY_TOO_LARGE: uncompressed bytes per entry */
  maxEntryBytes: 4 * 1024 * 1024,
  /** E_TOTAL_TOO_LARGE: uncompressed bytes over all entries */
  maxTotalBytes: 16 * 1024 * 1024,
  /** E_COMPRESSION_RATIO: uncompressed / compressed, for entries of at least ratioFloorBytes */
  maxRatio: 100,
  ratioFloorBytes: 64 * 1024,
  /** E_JSON_TOO_DEEP: nesting depth of any JSON entry, including the manifest */
  maxJsonDepth: 64,
});

export type Limits = { readonly [K in keyof typeof LIMITS]: number };

/**
 * Validates a complete limits object handed to a public entry point: exactly the keys of LIMITS,
 * each a positive integer no larger than its LIMITS value. Throws RangeError otherwise, so no
 * caller can widen a protection by passing its own object.
 */
export function checkLimits(limits: Limits): Limits {
  if (limits === LIMITS) return limits;
  if (limits === null || typeof limits !== "object") throw new RangeError("limits must be an object");
  const keys = Object.keys(limits);
  for (const k of keys) if (!(k in LIMITS)) throw new RangeError(`unknown limit '${k}'`);
  for (const k of Object.keys(LIMITS) as Array<keyof Limits>) {
    const v: unknown = limits[k];
    const base = LIMITS[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new RangeError(`limit '${k}' must be a positive integer`);
    if (v > base) throw new RangeError(`limit '${k}' may only be lowered (${v} > ${base})`);
  }
  return limits;
}

/** Returns limits with some values lowered. Throws RangeError if a value would be raised or is not a positive integer. */
export function lowerLimits(overrides: Partial<Limits>): Limits {
  for (const k of Object.keys(overrides)) if (!(k in LIMITS)) throw new RangeError(`unknown limit '${k}'`);
  return Object.freeze(checkLimits({ ...LIMITS, ...overrides })) as Limits;
}

import type { WorldPackage } from "../package/reader.ts";
import { parseJsonEntry } from "../package/json.ts";
import { preflightJson } from "./preflight.ts";
import { RUNTIME_LIMITS } from "./limits.ts";
import { validateWorld, WorldError } from "./schema.ts";
import type { World } from "./types.ts";
export * from "./types.ts";
export * from "./limits.ts";
export * from "./schema.ts";
export * from "./variant.ts";
export * from "./apps.ts";

/** Pure wrapper around the hardened package reader result. Evaluation data is forbidden in every JSON entry. */
export function loadWorldPackage(pkg: WorldPackage): World {
  for (const file of pkg.files.values()) if (file.mediaType === "application/json") {
    preflightJson(parseJsonEntry(file.data, file.path, RUNTIME_LIMITS.maxJsonDepth), true);
  }
  const world = validateWorld(pkg.entry);
  if (world.id !== pkg.manifest.world.id || world.version !== pkg.manifest.world.version) throw new WorldError("content/manifest world identity mismatch");
  for (const file of pkg.files.values()) {
    if (file.path !== pkg.manifest.entry && !world.rights.assets.some(asset => asset.path === file.path)) throw new WorldError(`missing asset rights: ${file.path}`);
  }
  for (const asset of world.rights.assets) if (!pkg.files.has(asset.path)) throw new WorldError(`declared asset absent: ${asset.path}`);
  return world;
}

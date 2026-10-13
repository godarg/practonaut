// Public API of the practonaut package (Phase 1: packages, worlds, runtime and result checking).
export { CanonicalError, MAX_CANONICAL_DEPTH, canonicalJson, sha256Hex, stateHash } from "./canonical/index.ts";
export * from "./package/index.ts";
export * as world from "./world/index.ts";
export * as predicate from "./predicate/index.ts";
export * as checker from "./checker/index.ts";
export { Session, apply } from "./core/index.ts";
export { createExcalidrawAdapter } from "./adapters/excalidraw/index.ts";
export type { ApplicationAdapter } from "./adapters/types.ts";

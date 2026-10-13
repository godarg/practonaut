// Manifest schemas (source of truth; `schemas/*.json` is generated from these by
// `npm run schema:write`). Both manifests are strict: undeclared fields are rejected.
//
// A world package carries no hidden or held-out data and therefore no `visibility` field.
// Held-out tasks and reference solutions live in a separate checker bundle with its own format
// string, read by the same hardened archive reader (I5).
import { z } from "zod";
import { LIMITS } from "./limits.ts";
import { MEDIA_TYPES } from "./media.ts";
import { SEGMENT_PATTERN } from "./paths.ts";

export const WORLD_PACKAGE_FORMAT = "practonaut.world-package";
export const CHECKER_BUNDLE_FORMAT = "practonaut.checker-bundle";
export const MANIFEST_NAME = "manifest.json";
export const SUPPORTED_SCHEMA_MAJOR = 1;
/** schemaVersion written by this release of the packer. */
export const CURRENT_SCHEMA_VERSION = "1.0.0";

// semver.org 2.0.0 recommended pattern.
export const SEMVER_PATTERN =
  "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$";
export const SCHEMA_VERSION_V1_PATTERN = "^1\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$";
export const WORLD_ID_PATTERN = "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$";
export const PACKAGE_PATH_PATTERN = `^(?:${SEGMENT_PATTERN}/){0,${LIMITS.maxPathDepth - 1}}${SEGMENT_PATTERN}$`;

const WorldRef = z
  .strictObject({
    id: z.string().regex(new RegExp(WORLD_ID_PATTERN)).describe("World id: lowercase ASCII letters, digits and hyphens, at most 64 characters."),
    version: z.string().max(64).regex(new RegExp(SEMVER_PATTERN)).describe("World version (semantic versioning 2.0.0)."),
  })
  .describe("Identity of the world.");

const PackagePath = z
  .string()
  .min(1)
  .max(LIMITS.maxPathLength)
  .regex(new RegExp(PACKAGE_PATH_PATTERN))
  .describe("Archive-relative path: ASCII segments, '/' separated, no '..', no leading or trailing slash.");

const FileEntry = z
  .strictObject({
    path: PackagePath,
    sha256: z.string().regex(/^[0-9a-f]{64}$/).describe("Lowercase hex SHA-256 of the uncompressed bytes."),
    size: z.number().int().min(0).max(LIMITS.maxEntryBytes).describe("Uncompressed size in bytes."),
    mediaType: z.enum(MEDIA_TYPES).describe("Must match the file extension and the content."),
  })
  .describe("One file in the archive. manifest.json itself is not listed.");

const Files = z.array(FileEntry).min(1).max(LIMITS.maxEntries - 1);

const SchemaVersion = z.string().regex(new RegExp(SCHEMA_VERSION_V1_PATTERN)).describe("Manifest schema version; this schema accepts major 1 only.");

export const WorldManifestSchema = z
  .strictObject({
    format: z.literal(WORLD_PACKAGE_FORMAT),
    schemaVersion: SchemaVersion,
    world: WorldRef,
    entry: PackagePath.describe("Path of the world file; must be listed in files with mediaType application/json."),
    files: Files,
  })
  .describe("Practonaut world package manifest, schema version 1.");

export const CheckerBundleManifestSchema = z
  .strictObject({
    format: z.literal(CHECKER_BUNDLE_FORMAT),
    schemaVersion: SchemaVersion,
    world: WorldRef.describe("The world this bundle checks."),
    files: Files,
  })
  .describe("Practonaut checker bundle manifest, schema version 1. Holds held-out checker data; never shipped to learners or agents.");

export type WorldManifest = z.infer<typeof WorldManifestSchema>;
export type CheckerBundleManifest = z.infer<typeof CheckerBundleManifestSchema>;
export type ManifestFileEntry = z.infer<typeof FileEntry>;

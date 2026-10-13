# PADR-0003 — World packages are data-only zip archives with a hashed manifest

Status: accepted · Date: 2026-10-03

## Context
Worlds are exchanged between people and must be treated as untrusted input
(`docs/security/threat-model.md`). Hidden checker data leaked to an agent with file access when
it shipped inside the package (`measured`, `spikes/runtime-parity/REPORT.md` S4.c).

## Options
1. Zip with a manifest at the root.
2. tar or tar.gz.
3. A directory tree only (no archive).

## Decision
Option 1, extension `.pnworld`. Reasons: the central directory lets the validator reject every
hostile entry before inflating any byte; random access; precedent (OPC, EPUB, JAR). tar is
sequential, its ratio is only checkable globally and it natively carries links and device
entries. A directory tree stays the authoring source format and is packed deterministically.

Rules (implemented in `src/package/`, limits exported as constants):
- `manifest.json` at the root, `format: "practonaut.world-package"`, semver `schemaVersion`;
  the major version is checked before full validation; unknown majors are rejected.
- Every entry is listed with path, size, SHA-256 and media type; unlisted or missing entries
  are rejected. Paths: NFC, allowlisted segments, no `..`, no absolute or drive paths, no
  links, no special files, no encryption, store/deflate only, case-folded duplicates rejected.
- Size, count, per-entry, total and compression-ratio limits; inflation is capped at the
  declared size.
- **Data only.** Media types are allowlisted (JSON, plain text, PNG, JPEG, WebP); extension and
  magic bytes must agree; executable or markup content (scripts, HTML, SVG, WASM, native
  binaries) is rejected. A world package never carries adapter code or checker code.
- **Hidden data is separate.** Held-out tasks and reference solutions travel in a
  `practonaut.checker-bundle` with its own manifest, read by the same safe reader, and are
  only given to the checker process (PADR-0005).
- Packing is deterministic: same source, same bytes.

## Consequences
Rich task text must be structured data rendered by the player (no author HTML). Assets beyond
raster images need a later, separately reviewed media type. The checker bundle needs its own
distribution path.

## Re-assessment triggers
A needed asset type outside the allowlist; archives above the limits for a real world;
a zip parser differential found in review.

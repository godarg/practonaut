# PADR-0025 — Omit the optional Mermaid converter from the pilot bundle

Status: accepted · Date: 2026-10-09 · Condensed 2026-10-12 for the public repository (the decision
is unchanged; the detailed review conditions of the original record are not carried over).

## Context

Excalidraw 0.18.1 lazily loads a Mermaid-to-Excalidraw converter when Mermaid text is pasted.
Packaging review found that `@mermaid-js/parser@1.2.1` embeds its own copies of a dozen
dependencies (among them a separate lodash-es). Those copies are not lockfile instances, so
`npm audit` cannot see them, and the converter sits outside the semantic action model that
Practonaut checks.

## Decision

- Keep the real Excalidraw engine at 0.18.1 with native editing, local fonts and ordinary text
  paste.
- The engine build resolves the converter to a local stub (`converter-unavailable.js`) that uses
  the upstream fallback/error contract: it never returns an empty or invented diagram and never
  silently drops pasted text.
- `native-overlay.css` hides the "More tools → Mermaid" menu entry.
- Unknown upstream shapes fail the build (name-based patches must match exactly once).

Details of the build patches: [engine assets](../adapters/excalidraw-assets.md).

## Consequences

Users cannot convert Mermaid inside the bundled editor; plain text paste works. A later engine
upgrade has to re-check the converter graph before this record can be revisited.

## Options not chosen

- Shipping the converter with extra notices and an SBOM: better attribution, but the stale
  embedded code stays executable.
- Rebuilding the upstream parser libraries: much larger change for an optional feature.
- Downgrading the engine.

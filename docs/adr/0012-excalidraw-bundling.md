# PADR-0012 — Bundle the pinned engine with esbuild and explicit local font assets

Status: accepted · Date: 2026-10-03

## Decision and expectation

Build a static browser bundle with esbuild (0.25.12), the unmodified Excalidraw 0.18.1 package,
React and React DOM 18.3.1. Ship the generated JS/CSS and approved font files with their full
license texts in the npm files allowlist. The node harness uses playwright-core 1.63.0.
The bundler is a development dependency; installed adapter runs never invoke a bundler.
Use request interception to serve the bundle in a private Chromium context, without a local
HTTP listener. All other requests fail closed and are recorded. No world chooses an asset URL.

Before phase completion, measure the resulting bundle and font sizes, list the exact font
files, sources and licenses, and check that all fonts are loaded before geometry measurements.
Restrict worlds and imports to the families with supplied license evidence. A family without
such evidence is omitted. Chromium downloads occur only in explicit bootstrap (PADR-0011),
never npm lifecycle scripts.

## Context and evidence

`measured`: the Excalidraw spike bundles the pinned package locally, with 0 external requests;
its build contains 24 MB, including 13 MB of fonts (`spikes/excalidraw/REPORT.md`). These are
spike measurements, not the phase-1 package size. The installed spike's esbuild package reports
0.25.12 (`node -p require('./spikes/excalidraw/node_modules/esbuild/package.json').version`,
2026-10-03, exit 0).

`documented`: [esbuild build API](https://esbuild.github.io/api/#bundle) supports browser bundling
and separate legal-comment output (read 2026-10-03). The build will preserve notices and add
an asset/license inventory. The package LICENSE files are the source for the license texts.

## Alternatives

Vite (as in the spike) provides a development server and extra integration features; phase 1
needs a static offline harness and no player. Direct browser imports would leave dependency
resolution and network loading in the runtime. Both add avoidable moving parts for this phase.
The esbuild choice is reversible by replacing the build script while keeping the adapter API.

## Consequences and re-assessment

The real engine is much larger than the core. Report sizes and runtime dependency licenses,
including transitive notices, in the phase evidence. Do not present the bundle as a sandbox.
The player build choice remains for phase 2.

Kill criterion, checked before the phase-1 tag: any external request, missing asset license,
dynamic runtime dependency outside the bundle, or rendering drift against the spike's declared
subset blocks acceptance until corrected; omit an unlicensed font rather than assume a license.

## Implementation measurement (2026-10-03)

`measured`: The bundle emits only five licensed WOFF2 binaries: Cascadia (one) and Assistant
(four UI weights). Build verifies committed byte/hash inventories and rejects unknown font
binaries. Engine including complete dependency license texts is 8,857,683 bytes/329 files,
measured with `node tools/build-engine.ts --dist` and recursive byte summation. JS/CSS/asset
outputs are 8,568,915 bytes/194 files.

Excalidraw and React/React DOM are development build inputs, not runtime npm dependencies: the
installed engine is self-contained. This avoids installing their transitive dependency tree
a second time. Runtime packages are playwright-core, yauzl and zod; the installed tarball test
starts the real engine with this reduced dependency set.

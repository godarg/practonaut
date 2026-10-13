---
paths:
  - "src/package/**"
  - "src/checker/**"
  - "tests/support/**"
---

# Package and checker safety

- World packages and checker bundles are hostile input. Validate the whole central directory before
  inflating anything; cap inflation at the declared size; every rejection has a named code from
  `src/package/errors.ts` and a test that uses a fixture from the independent writer in
  `tests/support/zipwriter.ts` (never produce attack fixtures with the reader's own code).
- Limits only go down at runtime (`lowerLimits`); raising one is a code change with a test and a
  threat-model update. No environment variable may disable a protection.
- Adding a media type needs an ADR and a content check; active content (markup, scripts, SVG,
  WASM, binaries) stays forbidden.
- The checker never imports `src/core`; it parses exports itself and runs counter-probes (empty,
  unchanged start, wrong artifact) before any verdict.
- A new rejection code updates `docs/world-format.md` §1.4 (test-enforced).

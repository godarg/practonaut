# PADR-0011 — Live mirror runs host-side; the browser engine is an explicit runtime dependency

Status: accepted · Date: 2026-10-03

## Context
PADR-0006 requires every practice action to be checked against the pinned real Excalidraw engine
("live mirror"). The foundation review (finding B3,
a private review record) showed three open points:
where the mirror runs, what happens to a step the mirror rejects, and how an installed package gets
a browser engine offline without install scripts (PADR-0009). The Excalidraw spike drove the
engine from Node through Playwright and headless Chromium in 0.2–0.5 s per start with ~0.4–0.5 GB
RSS (`measured`, `spikes/excalidraw/REPORT.md`).

## Options
1. Mirror inside the player page (the learner's browser).
2. Mirror in a headless browser owned by the session host.
3. No live mirror; conformance only in tests.

## Decision
Option 2.
- The **session host** owns one headless Chromium page with the bundled, pinned engine per session
  that requests mirroring. It is the only mirror; the player page never reports verification
  results to the host (the browser is outside the host's trust boundary, PADR-0005).
- **Step transaction:** `Session.act` computes the core result tentatively → the adapter applies the
  same action to the mirror, reads back and runs the integrity check → only if both agree are the
  core state and the mirror committed. On disagreement, timeout or crash the step is rejected with
  `real_tool_disagrees` / `mirror_timeout` / `mirror_unavailable`, the core state is unchanged,
  and the mirror is restored from the last committed scene. The rejection is logged with both
  states for diagnosis. Human and agent steps go through the same transaction.
- **Modes:** `--mirror required` (default for practice and evaluation) and `--mirror off`. Sessions
  with the mirror off are labelled "model only" in the player and in every result, and never count
  as practice evidence or agent-success evidence.
- **Showing the real tool:** the host renders the mirror's current scene to PNG and serves it as an
  image (`image/png`, `nosniff`); it never serves SVG or HTML from the mirror to the player.
- **Editor mode (phase 3):** the engine embedded in the learner's page is an **input device**, not a
  reference. The page sends coalesced gestures to the host; the host maps them to semantic actions
  and runs the normal step transaction against core and host mirror. The page then receives the
  committed scene from the host and replaces its own scene with it. If the page's scene before that
  replacement differs from the committed scene on the declared set (for example a gesture the model
  does not cover), the host answers `editor_divergence` or `unmodeled`, nothing is committed, and the
  page is resynchronised. The page never reports verification results. The engine's own undo/redo
  is intercepted and routed to `Session.undo`, and the engine's history is cleared after every
  resynchronisation, so there is only one undo history (Gemini finding 4).
- **Browser engine provisioning:** `playwright-core` (Apache-2.0) becomes a runtime dependency in
  the phase that first needs it (phase 1 adapter, host in phase 2). The browser binary is never
  downloaded by an install script: `npm run bootstrap` (repository) and `practonaut setup`
  (installed package, phase 4) download Chromium explicitly, once, with a visible size and source;
  afterwards everything runs offline. `practonaut doctor` reports the engine as **required** for
  mirror, adapter and editor features and as not needed for `validate`, `pack` and model-only runs.

## Consequences
Every step costs a mirror round trip (to be measured in phase 2 with a latency budget). The npm
package gains a runtime dependency and a documented one-time download. Offline claims for mirror
features hold only after setup.

## Re-assessment triggers
Measured step latency above the budget; a browser-free way to run the pinned engine; Playwright
licence or download-host changes.

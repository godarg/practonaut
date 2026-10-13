Superseded for browser credential lifetime by [PADR-0016](0016-native-boundaries-and-tab-resume.md); all other decisions remain in force.

# PADR-0014 — Static player bundle and revisioned practice transactions

Status: accepted · Date: 2026-10-04

## Decision and expectation

Bundle the native DOM/SVG player with the existing pinned esbuild into one static module,
plus local CSS and the shared tokens. Serve a fixed asset allowlist from the session host.
Use a header-authenticated fetch stream for SSE, since native EventSource cannot carry the
required token header. The browser stores its token only in memory, removes the bootstrap
fragment immediately and never receives mirror SVG/HTML or checker bundles.

HTTP mutations carry `expectedRevision`, separate from the replayable core `baseStep`.
Undo, reset and variant changes increment the host revision, so an earlier browser request
cannot become current again when undo returns to the same core step.
Create a tentative Session from the committed log, perform its operation, mirror it, then
publish the candidate only after exact semantic read-back. Reset and undo use the same
atomic synchronization; every result check first verifies full replay.

The step budget is 2 seconds on the supported development machine; a 5-second deadline
rejects a transaction. Measure median, p95 and maximum, including restore operations,
before acceptance. A timeout or unreliable confirmation blocks Phase 2, per its prompt.

## Context and options

`documented`: PADR-0005/0011 require one writer, header tokens, SSE and host mirroring.
PADR-0012 already pins esbuild for static offline assets; `design/reference/player.html`
demonstrates native DOM/SVG with the product tokens. A framework adds a separate runtime
and lifecycle without solving the trust boundaries; a development server adds a second
listener and cannot represent the installed package. Native DOM with esbuild preserves
the reference interaction and ships without runtime module resolution.

Public conditions preserve quantifier scope: only a root conjunction is split. An
existential formula remains one condition, preventing separate witnesses from creating a
false passing result. The task sheet and checker show the same public condition list.

## Consequences and boundaries

The static shell and four fixed assets are public, guarded by Host/Origin and CSP; all
session data, PNG and SSE require the token. Bootstrap is the single-use 60-second
exception. No author selects a resource route. The token file is a same-user capability,
not secrecy against the OS user (PADR-0010).

Offline runs use `--require-offline` and a measured network-blocked runner. Normal local
serve makes no external requests but does not claim OS network containment. The sample
startup probe must fail closed if external TCP, DNS or HTTPS succeeds. Its coverage
does not prove IPv6, UDP or Unix-socket isolation.

`assumption`, to measure before the phase tag: the player fits the 320px reflow path with
legible stacked diagram objects; all actions are available without dragging; local bundle
has zero external imports/requests. The Brand interaction prototype is the prior design
input; C7 VoiceOver and manual 200% zoom remain OPEN without a human run.

## Re-assessment triggers

Step latency above budget, any runtime external import, untrusted markup sink, unresolved
diagram interaction, or inability to roll back both models. These block acceptance and
must be resolved before tagging; mirror-off is never a workaround.

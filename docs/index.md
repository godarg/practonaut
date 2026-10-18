# Documentation

## Use Practonaut

| Document | What it covers |
|---|---|
| [Getting started](getting-started.md) | install, first task in the browser, the real-engine mirror, first agent, first bench |
| [Agent guide](agent-guide.md) | connecting MCP agents, the seven tools, practice vs. bench |
| [Benchmarks](benchmarks/README.md) | `practonaut bench` and `report`: options, agents, scoring, isolation, report format |
| [Challenge tier, round 1](benchmarks/challenge/README.md) | the ladder gate of the five candidate families: [repair](benchmarks/challenge/repair-round1.md), [injection](benchmarks/challenge/injection-round1.md), [long-horizon](benchmarks/challenge/long-horizon-round1.md), [limited-checks](benchmarks/challenge/limited-checks-round1.md), [tight-budget](benchmarks/challenge/tight-budget-round1.md); none passes |
| [Authoring guide](authoring-guide.md) | making tasks from two drawings or from a demonstration |
| [Glossary](glossary.md) | terms used in code and docs |

## How it works

| Document | What it covers |
|---|---|
| [Architecture](architecture.md) | modules, runtime contract, trust boundaries, invariants |
| [World format](world-format.md) | world packages, `practonaut.world/1` and `/2`, rejection codes |
| [Session host](session-host.md) | local HTTP/SSE protocol, authentication, budgets, authoring routes, exports |
| [Threat model](security/threat-model.md) | assets, boundaries, controls, limits, what is not promised |
| [Excalidraw engine assets](adapters/excalidraw-assets.md) | engine build, patches, fonts and licenses |

## Contribute

| Document | What it covers |
|---|---|
| [Testing](testing.md) | every test layer, what it needs, platform matrix |
| [Adapter guide](adapter-guide.md) | connecting a second application |
| [Design language](design/design-language.md) | the Player's visual and interaction rules (binding for UI changes) |
| [Design review protocol](design/review-protocol.md) | how a visible change is checked |
| [Interaction model](design/interaction-model.md) | diagram connections on the board |
| [Guided repair design](design/product-recovery.md) | the Create flow for demonstrations |
| [Manual accessibility checks](design/manual-player-checks.md) | screen-reader and zoom checks a person can run |
| [Release](release.md) | how maintainers publish a version |
| [Vision](vision.md) | where Practonaut is going and why: North Star, principles, bets, what we will not do |
| [Roadmap](roadmap.md) | milestones 0.2.0 to 1.0 with deliverables, acceptance lines and checkpoints |

## Background

- [Prior-art register](research/prior-art-register.md) — related projects and sources (2026-10-03).
- [Landscape and measurements, October 2026](research/landscape-2026-10.md) — environments,
  protocols, learning from practice, and measured numbers of 0.1.0 (2026-10-14).
- [Learning and evaluation notes](research/learning-and-evaluation.md) — research on practice and
  how a human study could be designed.

## Decision records

[Register](adr/README.md) · current records: [0001](adr/0001-record-decisions.md) Record decisions in a project register · [0002](adr/0002-language-runtime-and-tooling.md) TypeScript on Node.js, npm, built-in test runner · [0003](adr/0003-world-package-format.md) World packages are data-only zip archives with a hashed manifest · [0004](adr/0004-runtime-semantics.md) Pure deterministic runtime with atomic actions and explicit unknowns · [0005](adr/0005-session-host-and-agent-protocol.md) One session host; loopback HTTP for the player, MCP over stdio for agents · [0006](adr/0006-pilot-application-and-workflow.md) Pilot application and first workflow · [0007](adr/0007-adapter-contract.md) Application adapters are trusted project code behind a capability contract · [0008](adr/0008-authoring-and-model-providers.md) Authoring may use language models; frozen worlds never do · [0010](adr/0010-isolation-claims.md) What the project claims about isolation · [0011](adr/0011-live-mirror-and-browser-runtime.md) Live mirror runs host-side; the browser engine is an explicit runtime dependency · [0012](adr/0012-excalidraw-bundling.md) Bundle the pinned engine with esbuild and explicit local font assets · [0013](adr/0013-bounded-predicates.md) Bounded predicates over normalized state · [0014](adr/0014-player-bundle-and-transactions.md) Static player bundle and revisioned practice transactions · [0015](adr/0015-guided-repair-authoring.md) Guided process-repair authoring and durable local projects · [0016](adr/0016-native-boundaries-and-tab-resume.md) Native input boundaries and authorised tab reload · [0017](adr/0017-readable-goals-and-workspace-transitions.md) Exact goal narration and visible workspace transitions · [0018](adr/0018-complete-author-source-admission.md) Complete author sources remain admission authority · [0019](adr/0019-native-semantic-object-identifiers.md) Native semantic object identifiers · [0020](adr/0020-design-system-v1.md) Design system v1: Apple-grade language, one shell, enforced by tools · [0022](adr/0022-linear-replay-and-transaction-deadline.md) Validated replay and one transaction deadline · [0023](adr/0023-author-and-practice-capabilities.md) Separate author and practice capabilities · [0024](adr/0024-current-session-and-native-export.md) Export the confirmed current session and native editor artifact · [0025](adr/0025-no-optional-mermaid-converter-in-pilot.md) Omit the optional Mermaid converter from the pilot bundle · [0029](adr/0029-normal-browser-cross-platform.md) Normal browser, cross-platform data directory, optional mirror · [0030](adr/0030-bench-replaces-unsealed-eval.md) Bench: independent scoring of any MCP agent; the unsealed eval runner is retired · [0031](adr/0031-public-release-and-trusted-publishing.md) Public 0.1.0 release: fresh snapshot, npm trusted publishing, manual approval · [0032](adr/0032-chromium-sandbox-stays-on.md) The Chromium sandbox stays on where the system allows it; a browser that does not start falls back or fails by name · [0033](adr/0033-product-direction-measurement-you-can-act-on.md) Product direction: measurement you can act on · [0034](adr/0034-preset-agents-get-no-provider-credentials.md) Preset agents get no provider credentials unless the user keeps them by name · [0035](adr/0035-no-design-capture-or-invariants-until-needed.md) `design:capture` and `design:invariants` are not built until a review needs them · [0036](adr/0036-bench-report-v2-any-world-stored-world.md) Bench report v2: any world, the world stored with the runs, isolation level, optional reference; generated instances are materialised · [0037](adr/0037-fork-the-committed-session-for-candidates.md) Transaction candidates fork the committed session; the world is validated once · [0038](adr/0038-lean-mcp-replies.md) Lean MCP replies: compact observe, mutation deltas, one language by default.
· [0039](adr/0039-results-you-can-act-on-evidence-report-compare.md) Results you can act on: run evidence in the bench folder, report v2, and the rules of `compare` (accepted).
· [0040](adr/0040-challenge-tier-generated-families-and-gate.md) Challenge tier: seeded families of materialised instances, task limits, minimal length and a preregistered gate (accepted).
· [0041](adr/0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md) Headroom where agents fail, and the first checkpoint after the 0.3.0 launch (accepted).
· [0042](adr/0042-gate-for-families-on-toolchains.md) The 0.3.0 gate: families on toolchains, a vendor-neutral ladder, a pre-probe and its own budget (proposed).
· [0043](adr/0043-artifact-judged-verdict-level.md) Artifact mode: an "artifact-judged" verdict level for results made with foreign tools (proposed).
· [0044](adr/0044-bench-report-v3.md) Bench report v3: verdict level, application and toolchain, evidenced agent identity, co-actor attribution and an application-independent task identity (proposed).
· [0045](adr/0045-adapter-registry-and-browser-shell.md) Adapter registry, named refusal of unknown applications, and a shared browser shell (proposed).
· [0047](adr/0047-bounded-spatial-predicates.md) Bounded spatial predicates: six layout operators over the judged geometry (proposed).
· [0048](adr/0048-co-actor-scenario.md) Co-actor scenario: a scripted colleague edits the board mid-run (proposed).

[Archive](adr/archive/README.md): [0009](adr/archive/0009-release-and-publication.md) · [0021](adr/archive/0021-supported-unsealed-evaluation.md) · [0027](adr/archive/0027-private-player-bootstrap-handoff.md).

Outside `docs/`: [README](../README.md), [CONTRIBUTING](../CONTRIBUTING.md),
[SECURITY](../SECURITY.md), [SUPPORT](../SUPPORT.md), [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md),
[CHANGELOG](../CHANGELOG.md), [AGENTS.md](../AGENTS.md) (rules for AI coding agents), and the task
library's [README](../tasks/excalidraw/README.md).

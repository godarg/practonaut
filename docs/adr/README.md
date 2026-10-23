# Architecture decision records

Practonaut records consequential decisions here before the code that implements them. Numbers
(`PADR-NNNN`) belong to this project. A record is not edited to change a decision: a new record
supersedes it, and the old one gets a leading pointer. Superseded or never-accepted records move
to [archive/](archive/README.md) with one sentence of context.

New record: copy the shape of a recent one — context (with the evidence you have), options
considered, decision, consequences, and the triggers that force a re-assessment — and add a row
below and in [../index.md](../index.md).

Older records were written while the project was private. They may mention review rounds,
commit ids or folders that are not in the public repository; the decisions stand as written.

| ID | Title | Status | Date |
|---|---|---|---|
| [PADR-0001](0001-record-decisions.md) | Record decisions in a project register | accepted | 2026-10-03 |
| [PADR-0002](0002-language-runtime-and-tooling.md) | TypeScript on Node.js, npm, built-in test runner | accepted | 2026-10-03 |
| [PADR-0003](0003-world-package-format.md) | World packages are data-only zip archives with a hashed manifest | accepted | 2026-10-03 |
| [PADR-0004](0004-runtime-semantics.md) | Pure deterministic runtime with atomic actions and explicit unknowns | accepted | 2026-10-03 |
| [PADR-0005](0005-session-host-and-agent-protocol.md) | One session host; loopback HTTP for the player, MCP over stdio for agents | accepted (evaluation part superseded by PADR-0030; MCP reply shapes changed by PADR-0038) | 2026-10-03 |
| [PADR-0006](0006-pilot-application-and-workflow.md) | Pilot application and first workflow | accepted | 2026-10-03 |
| [PADR-0007](0007-adapter-contract.md) | Application adapters are trusted project code behind a capability contract | accepted | 2026-10-03 |
| [PADR-0008](0008-authoring-and-model-providers.md) | Authoring may use language models; frozen worlds never do | accepted | 2026-10-03 |
| [PADR-0010](0010-isolation-claims.md) | What the project claims about isolation | accepted | 2026-10-03 |
| [PADR-0011](0011-live-mirror-and-browser-runtime.md) | Live mirror runs host-side; the browser engine is an explicit runtime dependency | accepted | 2026-10-03 |
| [PADR-0012](0012-excalidraw-bundling.md) | Bundle the pinned engine with esbuild and explicit local font assets | accepted | 2026-10-03 |
| [PADR-0013](0013-bounded-predicates.md) | Bounded predicates over normalized state (vocabulary amended by PADR-0047) | accepted | 2026-10-03 |
| [PADR-0014](0014-player-bundle-and-transactions.md) | Static player bundle and revisioned practice transactions | accepted (credential lifetime superseded by PADR-0016) | 2026-10-04 |
| [PADR-0015](0015-guided-repair-authoring.md) | Guided process-repair authoring and durable local projects | accepted | 2026-10-04 |
| [PADR-0016](0016-native-boundaries-and-tab-resume.md) | Native input boundaries and authorised tab reload | accepted | 2026-10-04 |
| [PADR-0017](0017-readable-goals-and-workspace-transitions.md) | Exact goal narration and visible workspace transitions | accepted | 2026-10-04 |
| [PADR-0018](0018-complete-author-source-admission.md) | Complete author sources remain admission authority | accepted | 2026-10-04 |
| [PADR-0019](0019-native-semantic-object-identifiers.md) | Native semantic object identifiers | accepted | 2026-10-04 |
| [PADR-0020](0020-design-system-v1.md) | Design system v1: Apple-grade language, one shell, enforced by tools | accepted (decision 8 amended by PADR-0035) | 2026-10-07 |
| [PADR-0022](0022-linear-replay-and-transaction-deadline.md) | Validated replay and one transaction deadline | accepted (refined by PADR-0037) | 2026-10-09 |
| [PADR-0023](0023-author-and-practice-capabilities.md) | Separate author and practice capabilities | accepted | 2026-10-09 |
| [PADR-0024](0024-current-session-and-native-export.md) | Export the confirmed current session and native editor artifact | accepted | 2026-10-09 |
| [PADR-0025](0025-no-optional-mermaid-converter-in-pilot.md) | Omit the optional Mermaid converter from the pilot bundle | accepted | 2026-10-09 |
| [PADR-0029](0029-normal-browser-cross-platform.md) | Normal browser, cross-platform data directory, optional mirror | accepted | 2026-10-11 |
| [PADR-0030](0030-bench-replaces-unsealed-eval.md) | Bench: independent scoring of any MCP agent; the unsealed eval runner is retired | accepted | 2026-10-12 |
| [PADR-0031](0031-public-release-and-trusted-publishing.md) | Public 0.1.0 release: fresh snapshot, npm trusted publishing, manual approval | accepted | 2026-10-12 |
| [PADR-0032](0032-chromium-sandbox-stays-on.md) | The Chromium sandbox stays on where the system allows it; a browser that does not start falls back or fails by name | accepted (amended: Linux start without the sandbox when the system refuses it) | 2026-10-13 |
| [PADR-0033](0033-product-direction-measurement-you-can-act-on.md) | Product direction: measurement you can act on | accepted (first checkpoint, B2 and B3 amended by PADR-0041) | 2026-10-14 |
| [PADR-0034](0034-preset-agents-get-no-provider-credentials.md) | Preset agents get no provider credentials unless the user keeps them by name | accepted | 2026-10-14 |
| [PADR-0035](0035-no-design-capture-or-invariants-until-needed.md) | `design:capture` and `design:invariants` are not built until a review needs them | accepted | 2026-10-14 |
| [PADR-0036](0036-bench-report-v2-any-world-stored-world.md) | Bench report v2: any world, the world stored with the runs, isolation level, optional reference; generated instances are materialised | accepted | 2026-10-14 |
| [PADR-0037](0037-fork-the-committed-session-for-candidates.md) | Transaction candidates fork the committed session; the world is validated once | accepted | 2026-10-14 |
| [PADR-0038](0038-lean-mcp-replies.md) | Lean MCP replies: compact observe, mutation deltas, one language by default | accepted | 2026-10-14 |
| [PADR-0039](0039-results-you-can-act-on-evidence-report-compare.md) | Results you can act on: run evidence in the bench folder, report v2, and the rules of `compare` | accepted | 2026-10-15 |
| [PADR-0040](0040-challenge-tier-generated-families-and-gate.md) | Challenge tier: seeded families of materialised instances, task limits, minimal length and a preregistered gate | accepted | 2026-10-15 |
| [PADR-0041](0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md) | Headroom where agents fail, and the first checkpoint after the 0.3.0 launch | accepted | 2026-10-18 |
| [PADR-0042](0042-gate-for-families-on-toolchains.md) | The 0.3.0 gate: families on toolchains, a vendor-neutral ladder, a pre-probe and its own budget | proposed | 2026-10-18 |
| [PADR-0043](0043-artifact-judged-verdict-level.md) | Artifact mode: an "artifact-judged" verdict level for results made with foreign tools | proposed | 2026-10-18 |
| [PADR-0044](0044-bench-report-v3.md) | Bench report v3: verdict level, application and toolchain, evidenced agent identity, co-actor attribution and an application-independent task identity | accepted | 2026-10-18 |
| [PADR-0045](0045-adapter-registry-and-browser-shell.md) | Adapter registry, named refusal of unknown applications, and a shared browser shell | proposed | 2026-10-18 |
| [PADR-0046](0046-vendor-neutral-presets.md) | Vendor-neutral presets: one registry, Codex and two loopback presets, client configuration that fails closed, and isolation only from each run's own stream | proposed | 2026-10-18 |
| [PADR-0047](0047-bounded-spatial-predicates.md) | Bounded spatial predicates: six layout operators over the judged geometry | accepted | 2026-10-20 |
| [PADR-0048](0048-co-actor-scenario.md) | Co-actor scenario: a scripted colleague edits the board mid-run | proposed | 2026-10-18 |
| [PADR-0050](0050-browser-close-is-a-bounded-request.md) | A browser close is a bounded request on top of Playwright's own forced end | accepted | 2026-10-19 |

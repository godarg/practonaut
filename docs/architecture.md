# Architecture

How Practonaut is put together: modules, the runtime contract, trust boundaries and the invariants
every change keeps. Security view: [threat model](security/threat-model.md). Terms:
[glossary](glossary.md). Decisions: [ADR register](adr/README.md).

## 1. System at a glance

```
 demonstration in the real app            authoring                              frozen world
┌───────────────────────────┐   events   ┌──────────────────────────┐  compile  ┌───────────────┐
│ Excalidraw (pinned, local) │──────────▶│ recorder → observations   │─────────▶│ .pnworld       │
│  + adapter (read/apply/    │◀──────────│ hypotheses → questions    │          │ (data only)    │
│    export, read-back)      │ conformance│ confirmed rules (evidence)│          └──────┬────────┘
└───────────────────────────┘            └──────────────────────────┘                 │ load + validate
                                                                                         ▼
          ┌──────────────┐  HTTP+SSE (loopback,  ┌──────────────────────────────────────────────┐
 human ──▶│ player        │  token, Host/Origin) │ session host (one process, only writer)       │
          │ board mode /  │─────────────────────▶│  Session.act → core.apply (pure, no LLM)      │
          │ editor mode   │                       │  undo / reset / replay check / limits         │
          └──────────────┘                       │  live mirror → adapter (board mode)           │
          ┌──────────────┐  MCP stdio  ┌───────┐  │                                              │
 agent ──▶│ agent client  │───────────▶│ bridge │─▶│                                              │
          └──────────────┘             └───────┘  └──────────────┬───────────────────────────────┘
                                                                 │ final state / exported file
                                                                 ▼
                                                  ┌──────────────────────────────┐
                                                  │ checker (separate process)    │◀── .pncheck (check only)
                                                  │ goal predicates, counter-probes│
                                                  └──────────────────────────────┘
```

## 2. Modules and dependency rules

| Module | Responsibility | May depend on |
|---|---|---|
| `src/canonical` | canonical JSON, SHA-256 state hash | Node built-ins |
| `src/package` | safe reader, manifests, limits, deterministic packer | canonical, yauzl, zod |
| `src/world` | world content schemas v1 and the additive v2, the table of applications a world may name (`apps.ts`, refusal by name, PADR-0045; each entry with its display name and its declared structural constraints, checked by pure functions in `constraints.ts`, PADR-0049), loading, finite seeded variant generation; trusted freeze tooling verifies solvability | canonical, package, zod |
| `src/predicate` | goal-predicate language with step budget (no regex, no code) | canonical, world |
| `src/core` | `apply`, sessions (log, undo, reset, replay), structured errors | canonical, world, predicate |
| `src/checker` | independent result check on final state or export with its own export parsers, chosen by the world's adapter through its own format table (`formats.ts`); counter-probes; the condition trace of a run's mutations (PADR-0039) | canonical, package, predicate, world — **never** `src/core` or `src/adapters` |
| `src/adapters` | the registry (`registry.ts`: adapters by the world's `app.adapterId`, with app versions, world schemas, runtime kind (`bundled` or `downloaded` with its check), read-back comparison, sandbox policy and whether the Player's editor workspaces apply, PADR-0045, PADR-0049); `prediction.ts`, each adapter's own prediction of an action and the contracts (`types.ts`: PADR-0007's `ApplicationAdapter`, the mirror's `MirrorAdapter`) | canonical, world, the adapter folders |
| `src/adapters/browser` | the shared browser shell: the one Chromium start (PADR-0032), launch and start deadlines and abort, the network boundary (HTTP routing over named origins, every WebSocket closed, a content security policy on every served response, no WebRTC UDP, a sink proxy that refuses every connection the browser opens itself, no host resolution), operations that end on timeout and roll back on a fresh page, PNG capture, artifact hashes | canonical, world; Playwright |
| `src/adapters/excalidraw` | PADR-0007 capabilities for the pinned app: read, write, projection, integrity, SVG, recorder | canonical, world, package, the browser shell; browser automation only in its node-side harness |
| `src/adapters/drawio` | the pinned draw.io release ([adapter page](adapters/drawio.md), PADR-0049): its verified download, the archive read whole into memory and served from an allowlist, a host page that relays the embed JSON protocol, the writer, the full write check, integrity and projection | canonical, world, platform, the browser shell; never `src/checker` |
| `src/host` | session host, HTTP+SSE guard, token handling, limits, step transaction with the host-side live mirror (PADR-0011) | core, world, package, adapters; data-only EN/DE history catalog |
| `src/player` | browser UI from `design/`, i18n catalogs EN/DE, board mode; shows the host-rendered mirror image; editor mode embeds the engine as untrusted input only | browser APIs; host API only (never verifies or writes state itself) |
| `src/authoring` | recordings, hypotheses, model questions, confirmation, compile; `from-scenes`: a world/2 task from two drawings, verified by the checker | world, adapters, package, checker, core; optional model provider |
| `src/library` | bundled Excalidraw task library (`tasks/excalidraw/`): build from source drawings, load, task slices | authoring, world |
| `src/mcp` | Official SDK v2 stdio bridge; seven fixed tools, strict inputs (the `act` schema generated from the session world's actions) and field allowlist; no listening socket or duplicate session | host HTTP client API, SDK, zod |
| `src/bench` | `practonaut bench`/`report`: per-run host and data folder, built-in oracle/random agents over MCP, command-template agents without a shell, host-side counters and action budget, separate checker verdicts, the library or an own world stored with its validated references in the bench folder, run evidence (call log, mutation log, checker trace, engine picture), `practonaut.bench/3` report at session level (reads `/1` and `/2` through one read-only view) with proven minimal lengths where the search is small, task identities, the evidenced agent identity and the bound stdout of external runs, validator, renderer and `compare` with its statistics and pairing by task identity across worlds ([benchmarks](benchmarks/README.md), PADR-0036, PADR-0039, PADR-0040, PADR-0044) | host, mcp (bridge as a child process), library, authoring (replaying a reference, minimal length), checker process, package |
| `src/challenge` | challenge-tier candidate families: seeded generators (no clock, no ambient randomness) that materialise world/2 instances through the state-based core of from-scenes, with limits, oracle sidecars and checks; the preregistered gate; driven by `node tools/challenge.ts` ([benchmarks](benchmarks/README.md) §10, PADR-0040) | authoring, library, world, predicate, bench (gate: report types, statistics, verification) |
| `src/evaluation` | Checker worker, bounded processes, client binding, transfer helpers and private outputs used by tools and tests; no CLI command of its own (`bench` replaced `eval`, PADR-0030) | package/world/host, bounded process boundaries; no bundle is sent to MCP |
| `src/cli` | `doctor`, `validate`, `pack`, `run`, `check`, `serve`, `record`, `compile`, `mcp`, `bench`, `report`, `compare`, `setup`, `tasks` | all of the above |

Rules enforced by tests as each module lands: `src/core` and `src/predicate` import no I/O, clock
or randomness; `src/checker` does not import `src/core`; `src/player` and `src/mcp` change state
only through the host API.

## 3. Runtime contract (PADR-0004)

`apply(world, state, action)` is pure and atomic. Results: `ok` with new state and effects,
`unmodeled` (no confirmed rule covers the action or one of its effects), or a structured error
(`invalid_argument`, `precondition_failed`, `limit_exceeded`, `stale_base`, `constraint_refused`
when the result would break a structural constraint the world's application declares, PADR-0049, …). State is integer
JSON keyed by semantic ids; deleted objects stay as tombstones. Session = world version + seed +
action log. The CLI records a hash after every step and verifies full replay before writing any result.
Semantic IDs depend on the seed and complete creating-action prefix; undo followed by a different
branch cannot reassign an ID to another object. `disconnect(id)` deletes the entire arrow relation.
`delete_step` retains tombstones and detaches incident live arrow ends.

The adapter receives the independently predicted before/after transition, uses only `updateScene`,
repairs geometry/bindings, then reads back and checks integrity. It rolls failed transactions back
by recreating the last committed scene. The checker has its own native export parser and imports
neither core nor adapters; shared canonical hashing and bounded predicate evaluation are allowed.
Its process has a 10-second deadline and a 256 MiB V8 heap cap (not a hard RSS or OS sandbox cap).
Every verdict first rejects empty, unchanged-start and wrong-artifact counter-probes. Verdicts
are explicitly `end-state-only`. For serialized session submissions, the checker independently
recomputes the history and compares every step hash and the final-state hash. This establishes
consistency only; it does not attest who acted or that the agent was isolated from the files on
disk.
Agents are scored with `practonaut bench` ([PADR-0030](adr/0030-bench-replaces-unsealed-eval.md)):
the agent stops, then separate checker processes judge the host's session and, with the mirror,
its native export. The agent runs as the same OS user, so a bench score is not a sealed result
(see [benchmarks](benchmarks/README.md) §4).

Engine bundling and fonts: [PADR-0012](adr/0012-excalidraw-bundling.md),
[asset and license inventory](adapters/excalidraw-assets.md). Predicate language: [PADR-0013](adr/0013-bounded-predicates.md).

## 4. Data and trust boundaries

| Boundary | Untrusted input | Control (where) |
|---|---|---|
| World package → validator | archive bytes, JSON, assets | PADR-0003, `src/package` |
| Browser → host | HTTP requests from any page | token, Host/Origin, JSON-only, CSP (PADR-0005) |
| Agent → host | tool calls, arguments | schema validation, limits, rate limits; same `Session.act` |
| Host → checker | final state, exported file | separate process, checker parses exports itself |
| Adapter ↔ real app | app state and events | pinned version, read-back after every write, integrity check; draw.io: the embed protocol only, the full write check, the sandbox required (PADR-0049) |
| Download → app runtime | a downloaded release (`setup --app drawio`) | pinned size and SHA-256, checked again at every start, served from memory and an allowlist (PADR-0049) |
| Model provider → authoring | model output | schema validation; output only becomes hypotheses (PADR-0008) |
| Recording → world | demonstration data | explicit start, local storage, review before compile, rights metadata |

## 5. Time limits, cancellation and resource budgets

The values are in the [threat model](security/threat-model.md) §4 and become code constants with named
errors in the module that enforces them. Every long operation (checker run, export, adapter
apply, recording) has a wall-clock timeout and a cancellation path that leaves the session
unchanged. The package limits are already code (`src/package/limits.ts`).

## 6. Versioning, migration and compatibility

- Local author/1 adds optional `repair` intent. Legacy projects remain readable. The private
  project-store envelope is `practonaut.saved-author/1`, integrity-bound, quota-limited and
  reconstructed against unchanged recording evidence on open. Previously unsaved RAM has no
  migration source; explicit legacy exports can use advanced authoring. No recording rewrite.
- Prepared repair variants, witnesses and independent example states are finite authoring
  content. Goal text grants no rule authority. Practice launch loads only the exact compiled
  public world into an owned host with required native mirror; checker fixtures remain separate.
- Package manifest: `schemaVersion` semver; readers accept their major only (PADR-0003).
- World content: `schema: "practonaut.world/<major>"`; a new major ships a migration tool
  (`practonaut migrate`) and keeps reading the previous major for one minor release line.
- Worlds pin the adapter id and the app version they were confirmed against; a world naming an
  adapter, version or world schema this Practonaut does not have is refused by name when it is
  loaded, before any browser starts (PADR-0045).
- Session logs record world id, world version, seed and tool version; replay across tool
  versions is guaranteed only within the same world major.
- npm package follows semver; pre-1.0 minors may break APIs with changelog notes.

## 7. Change scenarios

Entry condition → risk → migration path. None of these is claimed to be fully handled today.

| Scenario | Entry condition | Risk | Path |
|---|---|---|---|
| App update | new Excalidraw release | rules or adapter geometry no longer match | conformance suite against the new version; widen the version range only on pass; else keep pinned bundle |
| Incompatible world package | new schema major | old tool cannot load; new tool misreads old | major check rejects; `migrate` with tests over archived worlds |
| Model provider change or outage | provider API change, no network | authoring degraded | provider interface; model-free authoring stays the default |
| Data corruption | damaged package or session log | wrong state | manifest hashes, replay check, fatal error instead of repair |
| Large files | big assets or long recordings | memory, slow validation | limits with named errors; streaming only after a measured need |
| Platform change | Windows or Linux desktop users | untested paths, isolation claims | platform matrix in `docs/testing.md`; claims only per measured platform |
| Community contributions | external worlds and adapters | malicious content, rights | worlds are data; adapters only in-repo with review; rights metadata required |
| Multi-user or cloud | hosted operation requested | current trust model (loopback, same user) breaks | new ADR with authentication design; not supported until then |
| Supply-chain incident | compromised dependency or release workflow | malicious package | locked dependencies, no install scripts, trusted publishing with provenance and manual approval (PADR-0031) |
| Second app | a contributor proposes one | heavy runtime, internal API drift | [adapter guide](adapter-guide.md); separate adapter with its own conformance suite |

## 8. Extension points

New apps: an adapter implementing PADR-0007's contract and `MirrorAdapter` on the shared browser
shell, registered in the world's table of apps, the adapter registry and the checker's format table
(a test keeps the three equal), plus conformance tests ([adapter guide](adapter-guide.md),
[PADR-0045](adr/0045-adapter-registry-and-browser-shell.md)). An app runtime is bundled in the npm
package or downloaded unmodified by an explicit setup step, never redistributed. New world versions: semver on
the world, schema major on the format. Authors: rights and provenance metadata in each world.
Languages: message catalogs (EN, DE first); task texts are localized fields in the world.
Agent clients: anything that speaks MCP over stdio; HTTP transport later behind the same guard.

## 9. Transactions and the browser boundary

[PADR-0014](adr/0014-player-bundle-and-transactions.md) fixes the revisioned HTTP/SSE
contract. The host serializes mutations; a request carries the observed revision so stale tabs
cannot replay a discarded branch. A candidate Session forks the committed one (sharing its
once-validated, frozen world; [PADR-0037](adr/0037-fork-the-committed-session-for-candidates.md)),
computes the proposed action and confirms coverage; its full history is replayed before it can be
published. Only exact adapter read-back and integrity agreement commits it; the read-back is
compared on what the app holds — the whole state with tombstones, or live objects only for an app
that keeps no deleted objects, as its registry entry declares (PADR-0045). Undo/reset/variant replace both committed scenes atomically. Timeout or crash kills
the stale engine before recovery. Rejected steps preserve state, log and hash. The latency
target is 2 seconds and each mirror operation has a 5-second deadline.

The Player bundle imports only Player code; type-only host contracts disappear at build time.
It never imports a checker, transition implementation or Excalidraw engine. The engine lives in
the host-owned headless browser. Public conditions preserve predicate quantifier scope; results
show these conditions only. Full replay precedes every check. API details and limits are in
[session-host.md](session-host.md).

## 10. Invariants

A change that breaks one of these is a release blocker. Tests guard each of them.

- **Determinism.** Runtime transitions are pure: no wall clock, ambient randomness, I/O, network or
  language-model call. Randomness only through the world's seeded generator.
- **Atomic actions.** An action applies completely or not at all; a rejected or `unmodeled`
  action leaves the state hash unchanged.
- **Explicit unknowns.** An action, attribute or effect no confirmed rule covers yields
  `unmodeled`. The runtime never invents a successor state.
- **Declared constraints, not adapter ids.** A structural limit of an application (draw.io: a group
  within one frame, XML text) is data in the world table; core, world validation, checker and
  adapter each refuse a violating state by name (`constraint_refused`), and no module tests an
  adapter id to decide one.
- **No redistribution of a downloaded app.** A downloaded release is fetched only on the user's
  request, never shipped in the package, a CI artifact or a cache, and served only from memory after
  its hash is checked.
- **Evidence-backed rules.** Every rule in a compiled world references a confirming observation or
  conformance run. Hypotheses never execute.
- **Hidden data stays hidden.** Reference solutions, near misses and held-out tasks are not in the
  practice package and not reachable through the Player or MCP. The goal conditions are public:
  Player and agent get the same sentences and the same formal form of each goal clause. The agent
  has no stronger success signal than the human's Check button. The one exception by design: the
  bundled example's demonstration plays a solution derived from each task's public third hint
  (never a checker fixture, never a library or bench task), enforced on the host by the world's id
  and version and by the CLI flag that only `practonaut` and `play` without a world set.
- **Checker independence.** The checker does not import runtime transition code; it evaluates the
  final state or the exported file itself.
- **Package containment.** Archive entries cannot escape the extraction root, sizes and ratios are
  bounded, and world packages contain no executable content.
- **Local-only services.** Servers bind to loopback, require a per-session token and reject
  unexpected `Origin`/`Host`. No telemetry; no recording without an explicit start.
- **Provenance and rights.** Every asset and recording in a world names its source and license.
- **One state for human and agent.** Player and agent surfaces call the same host operations.
- **Localizable UI.** User-facing strings live in message catalogs (EN and DE).

Expected values in tests come from a source other than the code under test (hand calculation, the
real application, or the separate hash oracle in `tests/oracles/`); see [testing](testing.md).

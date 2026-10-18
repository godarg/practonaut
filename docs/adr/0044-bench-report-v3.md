# PADR-0044 — Bench report v3: verdict level, application and toolchain, evidenced agent identity, co-actor attribution and an application-independent task identity

Status: accepted 2026-10-18 with the change that implements it (P3b, issue #46) · Date: 2026-10-18 · Roadmap 0.3.0, strand P3 (issue #46) · Successor format of
[PADR-0036](0036-bench-report-v2-any-world-stored-world.md) and
[PADR-0039](0039-results-you-can-act-on-evidence-report-compare.md) (bench/2, frozen since 0.2.0);
carries the verdict level of [PADR-0043](0043-artifact-judged-verdict-level.md) and the run facts the
gate of [PADR-0042](0042-gate-for-families-on-toolchains.md) reads · Revised after three
independent reviews on 2026-10-18 (a multi-lens Claude Opus review with an adversarial check per
finding, OpenAI Codex `gpt-6.1-sol`, Google `gemini-3.8-flash`) and again after a re-review the
same day (two Claude Opus re-reviewers and Codex; dispositions at the end) · Implemented at
session level by P3b; what each later strand implements is listed under Consequences

## Context

bench/2 is frozen: "after the release, a change to /2 needs a new schema version" (PADR-0036
decision 9), and 0.2.0 shipped. Five deliverables of 0.3.0 write facts into the report that /2 cannot
hold — the presets (P4), the gate tool (P1), artifact mode (item 3), the co-actor family (item 4) and
draw.io (item 2). The roadmap asks for one new major format, decided once before they start (strand
P3). What /2 assumes, read in the code:

- **Only session verdicts.** A run's verdict is `checker: { session, native }` and its pass is
  derived from them (`src/bench/report.ts:275-280`); `actions` is re-derived from the session's
  history (`src/bench/verify.ts:74`). An artifact-mode run has no Practonaut session at all
  (PADR-0043 decision 1).
- **One application by name.** The environment records `excalidraw: <version>`
  (`src/bench/report.ts:192`, written at `src/bench/run.ts:450`), the native export is always
  `native.excalidraw` (`src/bench/run.ts:142`), and the world schema still has
  `app.adapterId: "excalidraw"` as a literal (`src/world/schema.ts:140`), which Must 1 widens.
- **Variant selection depends on the world's name.** A seed selects a variant case by hashing the
  world's id and version with the seed (`src/world/variant.ts:6-8`). The same tasks in a world with
  another id or version get other variants for the same seeds: for the library's three cases and
  seeds 1–5, cases 0, 1, 1, 2, 1 as `excalidraw-library` 1.1.0 and 2, 0, 0, 2, 0 under the id
  `drawio-library` (measured by the review and again for this revision with `src/canonical`). Seeds
  that share a case give one board twice; `bench` already says so (`seeds_share_variant`,
  `src/cli/messages.ts:523`).
- **Isolation from the kind of agent.** `ISOLATION_OF` maps built-in, preset and template to the
  three levels (`src/bench/report.ts:132`) and the validator refuses any other pairing
  (`src/bench/report.ts:374`). A preset for a client whose shell or file tools cannot be removed
  (PADR-0042 decision 5) would be labelled "tool-restricted" by kind alone.
- **One client's identity.** The model, `apiKeySource` and client version come only from Claude
  Code's `system/init` event (`src/bench/agents.ts:107-122`), and the report takes them from the
  first run whose init names either a model or a key source (`src/bench/run.ts:356`); there is no
  requested model, no client or vendor field, and `apiKeySource` is Claude Code's own field. A 0.3.0
  declaration names each ladder agent's client, requested model, attestation and billing (PADR-0042
  decision 3).
- **One actor.** The validator requires `actions ≤ acceptedActions` (`src/bench/report.ts:345`) and
  mutation-log entries equal to the agent's counted calls (`src/bench/report.ts:420-421`);
  `--verify` checks a task's action limit against the final history and every mutation record
  (`src/bench/verify.ts:110-126`) and the log against the agent's counters
  (`src/bench/verify.ts:147-150`), counting records by operation only (`src/bench/evidence.ts:175-178`);
  the recorder drops any record past its line cap (`src/bench/evidence.ts:150`). The host knows the
  actors `human`, `agent` and the host-only `demonstration` (`src/host/protocol.ts:44`); the judged
  session's history carries no actor (`src/world/types.ts:100-101`), and an undo removes the last
  history entry whoever made it (`src/core/session.ts:98-105`). A person editing mid-run (item 4)
  breaks these rules.
- **Infrastructure errors read from note text.** The client's failure classes come from Claude
  Code's stream (`src/bench/evidence.ts:197-253`); the gate recognises a run "rejected by the
  client" by matching the run's note with a regular expression (`src/challenge/gate.ts:46-52`).
- **Pairing within one world.** `compare` refuses two reports whose world content hashes differ
  (`src/bench/compare.ts:43`) or whose task and seed sets differ (`src/bench/compare.ts:44-47`), so
  the same tasks on Excalidraw and on draw.io cannot be paired. The development digest of a gate
  round hashes a session's state hash and action log (`src/challenge/declaration.ts:87-97`), which an
  artifact run does not have.
- **What verification shows.** `report --verify` shows that the artifacts on disk give the report's
  verdicts, not that they came from the agent the report names: "whoever can write the run
  directory can replace them; there is no signature" (`src/bench/verify.ts:30-32`).

The bring-your-own-tools spike adds three facts: Claude Code's init event lists the tools it offers
the model ("the agent saw exactly the two allowed tools (`init.tools`)",
[spike report](../../spikes/byo-tools/REPORT.md) line 20); the result of the official Excalidraw MCP
server is found through the server's own reply (`structuredContent.checkpointId`, lines 59 and 76);
and the server's stored format needs named reading rules (lines 67-75).

Committed reports today: two `/1` (`docs/benchmarks/example-report.json`, and
`tests/fixtures/bench/v1/report.json` with its run artifacts) and one `/2`
(`tests/fixtures/ci-recipe/baseline.json`, without its bench folder). The 0.2.0 gate rounds committed
declarations, ledgers and gate reports, not their bench reports. Vision §9 forbids a breaking report
format "without a reader for the previous major and a migration note" (`docs/vision.md:147`).

## Options considered

**Format.** (1) *Extend /2 with optional fields.* /2 is frozen, and a /2 reader would misread a run
without a session verdict. Rejected. (2) *A new major version `practonaut.bench/3`* (chosen).

**Verdict levels in one report.** (1) *Mixed levels, with per-level summaries.* Every aggregate, the
card's headline and the badge would have to split; one slip pools them, which PADR-0043 forbids.
(2) *One level per report, repeated on every run* (chosen): a bench runs one toolchain, so it has one
level anyway.

**Applications in one report.** (1) *Several applications per report* (`runs[].app`). A world is
bound to one application (`app.adapterId`) and a bench stores one world; a headline rate over both
applications would pool them. (2) *One application per report; the same tasks on both applications
are shown by `compare`, which pairs instances by task identity* (chosen).

**Pairing the same tasks across worlds.** (1) *The world content hash.* Differs with the application
block, provenance, behaviour rules and prompts, so it never matches across applications. (2) *The
task id and the seed.* Names, not content, and the seed selects another variant in a world with
another name (`src/world/variant.ts:6-8`). (3) *A hash of the instance's formal content, with
variant selection keyed by an application-free task set, paired as a multiset* (chosen).

**Agent identity.** (1) *Move /2's model fields into a new block.* Every /2 report would differ from
its /3 reading in fields that mean the same thing. (2) *Keep /2's fields with their meaning and add
evidenced fields beside them* (chosen).

**Isolation.** (1) *Keep it from the kind.* Contradicts PADR-0042 decision 5. (2) *New values* (for
example "preset, unverified"). Readers, cards and `compare` would learn a fourth value that says the
same as "not restricted". (3) *Keep the three values; a preset earns "tool-restricted" only from its
own runs' evidence* (chosen).

**Counting with a co-actor.** (1) *Count every action.* The agent's figures and its budget would
include the person's edits. (2) *Agent-only counters, the actor on every mutation record, every
co-actor record matched to its schedule entry* (chosen).

**What an artifact run contributes to a round's digest.** (1) *The checker's whole reading of the
stored result.* Its diagnostic lists (skipped pseudo-elements, unmodeled values) change with
verdict-neutral edits: an added `cameraUpdate` moves the seeds for free (Codex review, finding 1).
(2) *The proxy's call log, or the result's byte hash.* Bound by hash only; a re-spacing and a new
hash move the seeds, unless a ledger anchor catches it, and an anchor that is not yet pushed can be
rewritten with it. (3) *The judged state alone, in canonical JSON, read under a rules version that a
pushed probe plan fixes before the first run, with the result's bytes anchored in pushed ledger
records for integrity* (chosen): re-formatting draws nothing, re-judging is refused, and the trust
boundary is the push.

**Old reports.** (1) *A converter that writes /3 files.* A converted file would look like a native
/3 report and claim evidence nobody recorded. (2) *A read-only view with explicit "not recorded"
states, nothing written to disk* (chosen).

**Schema ownership during parallel work.** (1) *Every strand edits `report.ts` as it needs.* Four
strands adding required fields in parallel conflict, and a field decided twice means two things.
(2) *One holder at a time; only additive changes until the release* (chosen).

## Decision

1. **Verdict level.** Every /3 report has `verdictLevel: "session" | "artifact"`, and every run
   repeats it; the validator refuses a run whose level is not the report's.
   - A **session** run keeps every /2 run field with its /2 meaning, plus the fields of decisions
     5–9. Its native export is named per adapter (`native.excalidraw`, `native.drawio`, …), as
     `environment.app.adapterId` gives it.
   - An **artifact** run has no Practonaut session and no Practonaut action count. Its verdict is
     `checker: { artifact, result }`: `artifact` is the separate checker's verdict
     (`end-state-only`, counter-probes first, unmodeled values failing the clauses that need them,
     PADR-0043 decisions 2–5), and `result` says what was judged — `read` (the stored result),
     `absent` (no server reply named a result, or the named file does not exist) or `unreadable`
     (the reading rules refuse the file as a whole). For `absent` and `unreadable` the checker judges
     the delivered start file instead, which fails by the unchanged-start counter-probe (PADR-0043
     decision 5): an agent that leaves no readable result has failed, it has not met an
     infrastructure error.
   - **When an artifact run is judged.** A run whose client ended (completed, failed or timed out)
     is judged, also without a readable result. It is `infra_error` only when (a) the client's
     shipped parser classifies a usage limit, a login or billing error or an API error in the run's
     bound stdout; (b) the foreign server failed before the first forwarded `tools/call` — it did
     not start, it exited (the runner-side endpoint sees its process end), or it answered
     `initialize` with an error; (c) the proxy saw nothing at all — no `initialize` — and the client
     did not complete, which is an agent that never started its tools, the artifact-level
     counterpart of /2's "without a single tool call" (PADR-0043 decision 7); (d) the run's proxy
     log is not complete (`evidence_incomplete`, decision 4); or (e) the run was interrupted or the
     runner itself failed. A server failure after the first forwarded `tools/call` may come from the
     agent's own arguments, so the run is judged on the last result a server reply named before the
     failure, or on the start file when there is none.
   - **Result and start files.** The runner writes the delivered start file and hashes it before
     the client starts. It takes the result's locator from the server's own reply, as the toolchain
     definition names the field (decision 4), never from the agent's stream; the locator value must
     be an identifier without a path separator, and it is resolved only inside the run's own server
     store, to a regular file, without following a link. Judged artifacts, bound by SHA-256 and
     present exactly when the run was judged: the start file, the result (null when `absent`),
     `reading.json` (canonical JSON: the checker's reading of the judged file — rules format and
     version, judged state, skipped pseudo-elements by kind, unmodeled attributes and values, and
     for `unreadable` the result's refusal code) and `checker.json` (the verdict with the rules
     version). File names are fixed per source format (for example `start.json` and `result.json`
     for `excalidraw-mcp`); the report records hashes, never a path, as in /2.
   - **What does not apply at artifact level.** No mirror: `environment.mirror` is absent and
     `settings.mirror` is `off`. No task limits and no `--checks`: `bench` refuses, before the first
     run, an artifact bench of a task with `limits`, and the validator refuses an artifact report
     whose world records limits or whose settings carry `checks` (a foreign server knows no
     Practonaut limits, PADR-0041 decision 2). No co-actor (decision 7). References and
     `referenceActions` stay as in /2: the oracle baseline plays the reference through the server
     (PADR-0043 decision 6), and the report shows the reference length, but no efficiency is
     computed. `settings.prompt` holds the runner's prompt template, which it renders per instance with the
     task and the toolchain's reading rules (PADR-0043 decision 4); the prompt is not world content,
     so the same world serves every toolchain.
   - **Validator.** The shared rules of `checkRuns` stay for both levels: the plan, interruption,
     unique run ids, planned task, seed and repeat, one reference length per task, the summary
     re-derived from the runs. Then per run: `checker === null` exactly when `status` is
     `infra_error`, and `failure` (decision 9) exactly then; `artifacts` exactly when judged;
     `pass === derivedPass(run)`. **Session level:** every other /2 rule, with decision 7's changes.
     **Artifact level:** `artifacts.result === null` exactly when `checker.result` is `absent`;
     `proxyLog` present on every judged run; `proxy.calls ≤ settings.maxActions`;
     `failure.reason: no_tool_call` only with `proxy.starts` and `proxy.calls` zero; the absences
     listed above; no `toolCalls`, action counters, `logs` (mutations, calls, trace, board) or
     `coActor` (the schema has none).
   - **Derived pass.** Session: as /2 (`src/bench/report.ts:276-280`). Artifact:
     `checker !== null && checker.result === "read" && checker.artifact.passed`.
   - **`report --verify` of an artifact report** checks, in order, with a named code and exit 2 on
     the first difference: the stored world and the references as for /2 (PADR-0036 decision 6);
     every artifact, the proxy log and every stdout against its hash (`bench_artifact_changed`); that
     this Practonaut ships the report's toolchain definition and the block equals it
     (`bench_toolchain_unknown`, decision 4); for every run that binds a proxy log, judged or not, the
     proxy counts and the locator line re-derived from the log, and for a judged run that the log is
     complete; then per judged run
     (`bench_report_invalid`): the start file, read by the same rules, equals the instance's start
     state on the declared attributes (PADR-0043 decision 5); the judged file, read again, gives the
     stored reading; the checker, run again on it in a separate process, gives the stored checker
     output and the run's verdict; the run's isolation recomputed (decision 6).
   - **Summaries.** A session report keeps /2's summary. An artifact report has a summary without
     action figures (no mean actions, no efficiency) and with the proxy's forwarded calls.
   - **`compare`** refuses a pair of different levels with `compare_incomparable`, naming the field
     `verdictLevel` with both values in words ("session verdict" and "artifact-judged, end-state
     only, no Practonaut history") and the reason: runs of different verdict levels are never paired
     (PADR-0043 decision 1).
   - **Every surface names the level**, also for session reports: the report header and each run
     record, the card, the badge, the JUnit properties (`practonaut.verdictLevel`) and the compare
     page. Every surface of a `foreign-mcp` toolchain also says that the foreign server's code runs as
     the same OS user, without a sandbox (PADR-0043 decision 8). The board of an artifact run is a
     schematic of the judged state from `reading.json`, labelled as the checker's reading, with its
     unmodeled attributes listed.
   - `settings.maxActions` keeps its name and is the outer cap per run at both levels: at session
     level the agent's act, undo and reset calls that reach the session (as /2), at artifact level
     the `tools/call` requests the proxy forwards. The output names the unit.

2. **Application.** `environment.app: { adapterId, version }` replaces /2's `environment.excalidraw`:
   the world's `app.adapterId`, and the pinned application version the adapter ran (session) or
   whose own conversion the reading rules are conformance-tested against (artifact, PADR-0043
   decision 2). `--verify` requires `adapterId` to be the stored world's `app.adapterId`
   (`bench_world_changed`), and anchors a library bench to the library this Practonaut ships for
   that adapter. **A report holds runs of one application**: it follows from one stored world per
   bench folder. "One report shows the same tasks on both apps" (roadmap item 2) is
   `practonaut compare` of the two reports at the same verdict level, paired by task identity
   (decision 3).

3. **Task identity and pairing across worlds.**
   - **Variant selection independent of the application.** World/2 gains an optional,
     application-free task-set key `taskSet: { id, version }` (same patterns as the world's id and
     version, no default). Variant selection hashes `{ world: { id, version }, seed }` with the task
     set's id and version when the key is present and with the world's own otherwise. The code
     hashes the version as well as the id (`src/world/variant.ts:6-8`), so the default must be both:
     a default of the id alone would move the variants of every existing world. Without the key nothing
     changes — no world's canonical JSON, content hash or variant choice, and no stored /2 report.
     Two worlds of one task set on two applications carry the same key and the same variant cases in
     the same order; an existing world needs no change, because a new world can name it (its id and
     version) as its task set. The key aligns which instances the same seeds select, and so the
     coverage and the run counts of the two sides; pairing itself never depends on it.
   - **Identity.** Per instance (task × bench seed): `identity = SHA-256(canonicalJson({ identity:
     "practonaut.task-identity/1", task }))` with `canonicalJson` and `sha256Hex` of `src/canonical`.
     `task` is the task as `generateVariant(world, seed)` materialises it from the validated world,
     projected by an explicit exclusion list: `initialState` is replaced by the resolved start state
     (the task's own, else the world's); `errorClasses` is reduced to the list of their `when`
     predicates, in order; `id`, `title`, `prompt`, `hints`, `conditionTexts` and the error classes'
     ids and explanations are removed. Every other task field is hashed — the goal, `limits`,
     `generatedBy`, the co-actor schedule of decision 7, and any field a later record adds — so a
     new field is included by default (another identity is safer than a false pair). Reasons: the
     texts reach the agent but the toolchain and the application shape them (an artifact-mode prompt
     lists the reading rules); the `when` predicates spend the same per-task predicate budget as the
     goal and can decide whether a verdict exists (`src/checker/index.ts:66-91`); `generatedBy` is
     the instance's provenance, on which the gate's units and seeds rest, so instances pair only
     when the same generator version and seed made them. Not hashed: the world's id, version,
     `taskSet`, `app` block and provenance, its actions, behaviour rules and unselected variants,
     the task id and the bench (variant) seed. The judged state carries no application's rendering
     attributes — shapes and colours are named values, plus geometry, frame and group
     (`src/world/schema.ts:52-56`) — and Must 1 keeps it shared by every adapter. The identity
     version is frozen with /3. A record that adds a task or state field says whether the identity
     includes it, and adds it as an optional field without a default, so existing worlds keep their
     canonical JSON and every stored report keeps verifying.
   - **Stored.** The report lists `instances: [{ taskId, seed, identity }]`, one entry per instance
     that has at least one run, in plan order; the validator requires exactly the runs' instances;
     `--verify` re-derives every identity from the stored world (`bench_world_changed`).
   - **`compare` within one world** (equal content hashes) pairs by task and seed, as /2 and
     PADR-0039 C.2 define the instance. When several task-and-seed instances share one identity
     (seeds that select one variant), the page names a caveat with the number of distinct identities.
   - **`compare` across worlds** (content hashes differ) pairs by identity when both reports are at
     the same verdict level, both list identities, and their applications or their toolchains
     differ.
     - *The unit is the distinct identity.* Across worlds a task id and a seed name nothing the two
       sides share; the content is the only common unit. Every run of one identity on a side —
       whatever its task id, seed or repeat — is a repeat of that instance and aggregates into one
       outcome by PADR-0039's rule (it passes when at least half of all its runs passed; a run
       without a verdict counts as not passed). Instances with one content are one board, and
       PADR-0039 already treats repeats of one board as not independent. This amends PADR-0039 C.2
       for cross-world comparisons only; within one world its unit (task × seed) stays.
     - *Coverage.* Duplicate identities never refuse a pair. An identity on one side only is listed
       as "not compared", with its side, task ids and seeds, and left out of every statistic, as /2
       lists a missing instance (`src/bench/compare.ts:119`); with none on both sides the verdict is
       "nothing to compare". The grid rule (the same task ids and seeds,
       `src/bench/compare.ts:44-47`) does not apply: the identity sets replace it. Rows are named by
       each side's task ids and seeds.
     - *Equal run counts.* An outcome decided by a majority of more runs passes more often (ties
       pass, `src/bench/stats.ts:80`), so rate claims — each side's Wilson interval and the McNemar
       verdict — use only the paired identities with the same number of runs on both sides. The
       page lists the paired identities whose run counts differ, with both counts, as a caveat, and
       shows their outcomes without counting them; with none at equal counts there is no rate
       verdict. Two worlds of one task set benched with the same seed list and repeats have equal
       counts by construction.
     - *No regression labels.* Flips are listed as differences between the two configurations, never
       as instance regressions or fixes (PADR-0039 C.3), and `--fail-on-regression` refuses an
       identity-paired comparison (`compare_incomparable`, field `world`): a regression gate compares
       one world with itself. The page says that titles, prompts, hints, actions and behaviour rules
       are not compared and may differ, and that identities are the reports' claims unless `--verify`
       re-derived them.
     - *The test.* Two worlds with different ids and three variant cases each, over seeds 1–5. With
       one task-set key, both identity multisets are equal, every identity is paired and every run
       count is equal. Without the key, the expected pairs are computed in the test independently of
       the code under test (the case each world selects per seed, from SHA-256 over a hand-written
       canonical text): for `excalidraw-library` 1.1.0 and `drawio-library` 1.1.0 the sides select
       cases 0, 1, 1, 2, 1 and 2, 0, 0, 2, 0, so cases 0 and 2 are paired, case 1 is "not
       compared", and both paired cases have unequal run counts (1 against 3, 1 against 2) and
       carry no rate claim.
   - Otherwise the `world` difference stands, as in /2.
   - A hand-made side-by-side table of one task set at both levels (P7) matches instances by identity
     in the same way and follows PADR-0043 decision 1: each column names its level, no combined
     figure, no test across levels.
   - The bench's own check limit joins the comparability fields: two reports with different
     `settings.checks` are refused (`compare_incomparable`, field `checks`), as different
     `maxActions` are.

4. **Toolchain record.** Every report has `toolchain`. Session level: `{ kind: "practonaut", id:
   "practonaut", tools }` (Practonaut's own actions over MCP, at the version
   `environment.practonaut`; `tools`, the tool names its bridge advertised, decision 6).
   Artifact level: `kind: "foreign-mcp"`; `id`, the toolchain part of a unit name (PADR-0042
   decision 1, for example `excalidraw-mcp-0.3.2`); `server` with its name, pinned version, source
   (where the archive came from: a URL without credentials or query) and the archive's SHA-256;
   `proxy.name`, the MCP server name the client sees; `startDelivery` — `server-store` (written into
   the server's own store and named in the prompt), `prompt` (inline) or `file` (in the agent's
   working directory); `locator`, the field of the server's reply that names the result and the
   selection rule (for example the last successful `create_view`'s `structuredContent.checkpointId`);
   `rules`, the checker's reading-rules format and semantic version; `allowlist`, every tool the
   proxy passes, with its effect: `run-store` (only the run's own store), `file` or `network`.
   - **Anchored to a shipped definition.** Practonaut ships each toolchain definition as data —
     id, server version and archive SHA-256, locator, rules, allowlist with effects, and the
     application version the rules were tested against — keyed by id and rules version. A
     definition, with its reading rules and their conformance fixtures, is frozen from its first use
     in a committed report, probe plan or declaration, or from the first release that ships it,
     whichever comes first: a changed reading needs a new rules version, and the
     fixtures with their expected readings run as behaviour tests in `npm test`. `bench` writes the
     shipped definition; `--verify` refuses a block this Practonaut does not ship or that differs
     from it (`bench_toolchain_unknown`), and `environment.app.version` must be the definition's.
     Isolation at artifact level reads the effects from the shipped definition only (decision 6).
   - **The proxy counts on the runner's side.** The stdio proxy the client starts only forwards to
     a runner-side endpoint, as the bridge forwards to the host. That endpoint starts the pinned
     server, applies the allowlist and `maxActions`, takes the locator, counts, and the runner writes
     `proxy.jsonl` after the agent has ended. One line per request: sequence, MCP method (null for a
     request whose method does not fit the pattern, which is `invalid`), tool, the outcome
     (`forwarded`, `refused-allowlist`, `refused-budget`, `invalid`), for a forwarded call its result
     (`ok` or `error`), result bytes and time, and on the reply that named the result the locator
     value; never the arguments. **The log is complete or the run is not judged:** nothing is
     omitted, and a run whose log reaches the line cap (100 000 lines; the runner then ends the
     agent) or cannot be written is `infra_error` with the reason `evidence_incomplete`. Each artifact
     run carries `proxy: { starts, calls, refused }` (`starts`: `initialize` requests; `calls`:
     forwarded `tools/call`; `refused`: both refusal kinds). `--verify` re-derives them, and checks
     that exactly the line the selection rule picks names the stored result.
   - A difference in toolchain id between two reports of one world is a caveat `compare` names, not a
     refusal: the toolchain is what such a comparison tests. A difference in rules version is a
     caveat too, and `--fail-on-regression` refuses it (`compare_incomparable`, field `rules`): a
     regression must come from the agent or the toolchain, not from the judge.

5. **Agent identity.** /2's agent fields keep their names and meaning — `kind`, `name`, `command`,
   `model` with `modelSource`, `apiKeySource`, `keptEnv` — with two changes for /3 writers: `model`
   is the reported model of the first run that reports a model, and `apiKeySource` the value of the
   first run that reports one, each on its own (/2 took both from the first run that reported
   either, `src/bench/run.ts:356`; the view keeps a /2 report's stored values); and `apiKeySource` is
   stored only as a value from the parser's fixed list, `other` for anything else. Beside them, each
   with its value and its evidence source:
   - `vendor`: the model's vendor, from the preset's mapping of the requested or attested model id
     (for example `claude-…` → `anthropic`); `none` when the preset has no mapping, as for a local
     model. Readers: the report's agent line and PADR-0042 decision 5's "another vendor's model";
   - `client`: the client program the preset starts, such as `claude-code`;
   - `clientVersion`: the first run that reports one; each run's own stays in `runs[].client.version`;
   - `requestedModel`: the value of the preset's model switch as the client got it — an option
     Practonaut set, or the client's model variable the preset names (such as `ANTHROPIC_MODEL`),
     read from the environment the client was started with; null when no switch or variable
     reached the client. Which endpoint and model variables a preset withholds stays PADR-0034's and
     P4's;
   - `settings`: behaviour-changing client settings (a reasoning level and similar) as the preset
     requested them. Readers: `compare` names a caveat when they differ, and the gate requires them
     equal per agent within a round;
   - `billing`, before the start: the class the preset was set up for, which the release ledger
     records when the run takes its entry (PADR-0042 decision 4) — `local` when the preset
     configures a loopback endpoint, `api-key` when it keeps a provider key by name, `subscription`
     when it runs on the client's own login, `unknown` for a template;
   - per run, `client.billing`, after the run: `{ class, source, via }` — the class the preset's
     parser derives, its source, and `via`, a fixed identifier per parser naming the statement it
     read (for example `claude-code-stream/1:init.apiKeySource` or `codex/1:banner.endpoint`), never
     a value taken from the output. The source is re-derivable from the run's bound stdout
     (`client-attested`) or the preset's own recorded configuration (`preset-requested`). The
     report holds neither the statement itself nor an endpoint, no output of a login-status
     command, and no account name, e-mail address, organisation or key fragment.
   - **Billing class and budget category.** PADR-0042 counts budgets in two categories,
     subscription and local. The mapping: an agent whose requested class is `subscription`,
     `api-key` or `unknown` is a **subscription agent** — for the 800 runs, for D4's "at most three
     subscription agents", for the round-size formula (held-out + pre-probe) × subscription agents
     ≤ 100, and for the declaration's ladder and shape A or B (maintainer decision of 2026-10-18:
     the project's Claude runs use an API key under the Commercial Terms and count as subscription
     runs). An agent whose requested class is `local` is a **local agent**; each of its runs counts
     like a subscription run unless its observed class is `local` too, and a run not observed as
     `local` refuses the agent as a local ladder agent (PADR-0042 decision 5). Built-in runs never
     count. `local` shows how the client was
     configured (its own output names the loopback endpoint), not that a local model answered.
   - **The start guard reserves.** The ledger's start entry, taken before the client starts
     (PADR-0042 decision 4), counts every model run, local ones included, as a reservation. Only
     the run-end record of decision 8, holding both classes as `local` with a `client-attested`
     source, releases it. At the cap, any start that could count is refused.

   Evidence sources: `client-attested` (a shipped preset client's own structured output in the run's
   bound stdout), `preset-requested` (Practonaut's own record of what a shipped preset started or
   asked for, before the client started), `command-output` (a line in a command template's output;
   which program printed it is unknown), `none` (a value is null exactly then). The validator allows
   `client-attested` and `preset-requested` only for a preset and `command-output` only for a
   template, as /2 does for `modelSource`. It does not refuse a preset name it does not know, so
   `report`, `compare`, `--card` and `--badge` keep reading an older /3 report after a preset is
   renamed or dropped; `--verify` checks the name and `command` against that preset's argument list
   when the report's Practonaut version is its own, and otherwise says that it did not.
   - **Stdout binding.** Every external run (preset or template) has `stdout: { sha256, bytes } |
     null`, a run field of its own, outside `logs`. Null means the runner could not read
     `agent.stdout`; then every value derived from it is absent or `none`: no `client` block,
     isolation evidence `no-evidence`, no failure parser, observed billing `unknown`. The validator
     refuses any of these values without a binding. The runner and `--verify` hash the whole file as
     a stream, whatever its size (`bytes` shows the cost), and the parsers read only the bounded
     parts the runner reads (the init event in the first 64 KiB, the result event in the last
     256 KiB, failure events in the first 16 MiB).
   - **Parsers are versioned** (`claude-code-stream/1`), and every external run with a bound stdout
     names the parser that read it (`client.parser`), whether the run succeeded or not. `--verify`
     re-derives every client-attested or command-output value with that parser. When this Practonaut
     does not ship that parser, it says that the values were not re-derived, and the gate and the
     ledger treat them as not attested (`none`, billing `unknown`, no exemption).
   - **What this shows.** As in /2, `--verify` shows that the folder's files agree with the report,
     not who wrote them (`src/bench/verify.ts:30-32`). For gate runs, the pushed run-end ledger
     record of decision 8 is what ties stdout and judged artifacts to the moment the run ended,
     within the trust boundary decision 8 states.
   - The parsers and each preset's values are the presets strand's (P4, whose record refines
     PADR-0034); this record fixes the fields, their sources and the counting rule. A gate pair needs
     `modelSource: "client-attested"` (PADR-0042 decision 6).

6. **Isolation from evidence.** The three values and their wording stay. A built-in is
   `builtin-baseline` (Practonaut's own code; no client to restrict) and a command template is
   `template-unrestricted` (its output names no program); both carry the evidence `by-kind`. A
   **preset** is `tool-restricted-preset` only when at least one run carries the evidence
   `tools-within-servers`, every judged run carries it, and no run, judged or not, shows another
   tool; otherwise it is `template-unrestricted`, shown "template: not restricted" with the reason
   (`no-evidence` or `tool-outside-servers`).
   - **Membership** is exact: every tool name the client lists equals, after the preset's documented
     naming (Claude Code: `mcp__<server>__<tool>`), a tool the run's own server advertised in that
     run — at session level the tool names Practonaut's bridge advertised, which the report records
     (`toolchain.tools`; every run of a bench starts the same bridge), at artifact level the shipped
     definition's allowlist — and the client's listed MCP servers are exactly the run's server.
     `--verify` uses the recorded list, so a later Practonaut that renames a tool does not turn an
     older report's evidence into a tool outside. At artifact level
     every allowlisted tool must also have the effect `run-store` in the shipped definition
     (PADR-0043 decision 8). A name that does not fit the bounded pattern, or a list longer than 256
     names, is evidence of a tool outside.
   - **A preset whose client offers any file or shell tool never earns "tool-restricted"**, whatever
     its stream says: such a tool can rewrite the run's stdout before the runner hashes it.
   - The evidence lives per run: `client.tools` (the offered names as the client lists them) and
     `isolation: { level, evidence }`. `--verify` checks the stdout's hash, re-reads the offered tools
     with the preset's parser, recomputes each run's level and the report's, and refuses a difference
     (`bench_report_invalid`). For the shipped preset the re-review measured, on 465 stored
     `agent.stdout` files of 0.2.0 runs (local, not in the repository; 200 in the first check; not
     re-measured here), that Claude Code 2.1.299, 2.1.300 and 2.1.301 list exactly the seven
     `mcp__practonaut__` tools and the one server `practonaut`. P3b's parser test uses one such init
     event, with paths and session ids removed, and states the seven expected names by hand.

7. **Co-actor.** At session level only (PADR-0042 decision 1 refuses the co-actor family on foreign
   toolchains; the validator refuses co-actor fields at artifact level).
   - **The schedule is bound like `limits`.** It is task content (decision 3), so it is public like
     `limits`: an agent with file tools can read it, and what the MCP view shows of it is the
     scenario record's decision; a hidden part would amend this record. The report lists
     `environment.world.scenarios: [{ taskId, schedule }]` (the SHA-256 of the canonical JSON of each
     benched task's schedule, as the stored world states it), which `--verify` compares with the
     stored world (`bench_world_changed`). A run carries `coActor: { planned, fired, accepted,
     rejected }` exactly when its task is listed there; `--verify` re-derives `planned` from the
     schedule as the run's seed materialises it.
   - **Records.** Every /3 mutation record carries `actor: "agent" | "co-actor"`, and a co-actor
     record also `entry`, the index of its schedule entry, and `client: null`. The co-actor is
     host-only, like the demonstration; no request can claim it. A /2 log is read with the /2 record
     schema, every record the agent's. `--verify` re-materialises the schedule from the stored world
     and the seed, replays the log, and computes itself where each entry's trigger is reached (as
     the scenario record defines triggers). It then requires both directions: every co-actor record
     matches its entry — operation, action, and the position where that entry's trigger is reached
     — and every entry whose trigger the replay reaches has exactly one co-actor record there. A
     missing, extra, late or repeated intervention refuses (`bench_report_invalid`). Entries fire in
     schedule order, each at most once per attempt (once in the run unless the scenario record lets
     the schedule fire again after a reset). This is PADR-0042's `verifySchedule`; the scenario
     record decides the trigger semantics, not whether completeness is checked.
   - **A complete log.** The /3 recorder never omits an accepted act, undo or reset (they are bounded
     by `maxActions`, at most 10 000) nor any co-actor record (bounded by the schedule); past the
     line cap only check records and budget refusals are counted instead of kept, so the replay is
     always complete. A co-actor run whose mutation log cannot be written is `infra_error` with the
     reason `evidence_incomplete` (never exempt), and `--verify` refuses a co-actor run without its
     complete log.
   - **Counting.** `acceptedActions`, `rejectedActions`, `undos`, `resets` and `toolCalls` count the
     agent only, as `mutationCounts` does per actor (`src/bench/evidence.ts:175-178` gains the
     actor); `settings.maxActions` caps the agent's calls only; a task's action limit is counted from
     the agent's records only (roadmap item 4: "human actions do not use the agent's budget").
     `runs[].agentActions` is the number of the agent's actions in the final history, derived by
     replaying the log with its actors as the trace does.
   - **Undo and reset.** The session's undo removes the last history entry, whoever made it
     (`src/core/session.ts:98-105`). An accepted undo is the agent's: it counts in the agent's
     `undos` and uses one change of its budget. A co-actor action it removes stays counted in
     `coActor.accepted` and leaves the final history, so `actions − agentActions` shrinks; a reset
     removes the co-actor's actions in the same way. Whether the host lets the agent undo or reset
     away the person's edits, and whether the schedule fires again after a reset, is the scenario
     record's; a refused undo is a rejected record of the agent.
   - **Validator.** `toolCalls.act = acceptedActions + rejectedActions` stays (agent only);
     `agentActions ≤ acceptedActions`; without `coActor`, `agentActions = actions`; with it,
     `0 ≤ actions − agentActions ≤ coActor.accepted` — together these replace
     `actions ≤ acceptedActions` (`src/bench/report.ts:345`). Mutation entries plus omitted equal the
     agent's act, undo, reset and check calls plus `coActor.fired` (replaces
     `src/bench/report.ts:420-421`); `fired = accepted + rejected ≤ planned`; co-actor records only
     in runs with `coActor`.
   - **`--verify`.** `src/bench/verify.ts:116` compares `agentActions`, not `actions`, with the task's
     action limit (an early bound); `src/bench/verify.ts:123-125` counts the limit from the agent's
     records; `src/bench/verify.ts:147-150` checks the agent's records against the agent's counters
     and the co-actor's against `coActor`; `agentActions` is re-derived from the replay; the schedule
     is matched as above.
   - Efficiency, mean actions and mean actions when passed use `agentActions`; the summary fields
     keep their names, and a report without a co-actor gives the same values as under /2.

8. **Inputs of a round's development digest.** No choice made after a run may move the held-out
   seeds. P1 implements the following; it amends what PADR-0042 decisions 3, 4 and 7 say about the
   declaration, the ledger and the pre-probe.
   - **A probe plan, pushed before the first run.** Before the first pre-probe run of a unit, P1
     commits and pushes its probe plan: the unit, the verdict level, the toolchain pin (id, server
     version and archive SHA-256), at artifact level the reading-rules version, and the development
     (pre-probe) seeds. The declaration repeats these values. `declare` and `gate` refuse a
     development, pre-probe or held-out run whose report or ledger records name another toolchain
     or rules version, so a result cannot be re-judged under another shipped rules version to
     change its `pass`.
   - **Two ledger records per run, both appended.** The start entry (PADR-0042 decision 4), taken
     before the client starts, names the unit, the toolchain id, the rules version and the
     requested billing class. When the run ends, the runner that took the start appends one
     run-end record — a new record that names its start entry, never an amendment of it — with the
     toolchain id, the rules version, the SHA-256 of the judged artifact (`session.json` or the
     stored result, null when `absent`), of `agent.stdout` and of `checker.json`, and the observed
     billing class with its source. There is at most one run-end record per start entry; `bench
     --recover` never writes one. A judged run without a run-end record counts against the budget,
     is never digested or scored, and its task may be benched again as after an `infra_error`.
   - **Read only once pushed.** `declare` reads a development run, and `gate` a development or
     held-out run, only when its start and run-end records are in a commit contained in a
     remote-tracking branch, as PADR-0040 already requires of
     the declaration before the held-out set exists, and refuses a run whose report binds other
     hashes, toolchain or rules version than those records. `declare` and `gate` check that every
     committed version of the release ledger in git history is a prefix of the current one, and the
     gate report lists those versions.
   - **Digest `practonaut.challenge-development/2`** (0.2.0 declarations keep /1). Per development
     run: `model` (reported), `taskId`, `seed`, `pass`, and then at session level `hash` (the judged
     session's state hash) and `log` (the canonical JSON of its action log), as /1; at artifact
     level `result` (`read`, `absent` or `unreadable`) and `state`, the SHA-256 of the canonical JSON
     of the judged state in `reading.json`, read under the probe plan's rules version — without the
     skipped and unmodeled lists. Runs are sorted by model, then task id, then seed, comparing
     strings by UTF-16 code units as `canonicalJson` sorts keys, never by a locale.
   - **Not in it:** the verdict level, the toolchain and the identity (the probe plan and the
     development world fix them), any byte hash of a file, the reading's diagnostic lists, the proxy
     log, the client's figures and the status. PADR-0040's rule holds without exception: a
     re-spaced result, or one with an extra pseudo-element, gives the same digest. The byte hashes
     in the ledger check integrity; they do not feed the seeds.
   - **The trust boundary.** Caught: an accidental or careless edit (`--verify`,
     `bench_artifact_changed`); a re-judging under another rules version (the probe plan); any edit
     of a run, a report or a ledger record after its records are pushed (the run-end record and the
     prefix check); and verdict-neutral re-formatting at any time (the canonical digest). Not caught:
     an operator who, before pushing, rewrites a run's folder, its report and the unpushed tail of
     the local ledger together, with a different judged state. That is a forged run, which `--verify`
     cannot tell from a real one at session level either (`src/bench/verify.ts:30-32`); the
     declaration's own git history (PADR-0040) and the ledger's prefix history are the controls
     after the push. The unit enters the seed derivation through P1 (PADR-0042 decision 1).

9. **Infrastructure errors per client.** An `infra_error` run (as /2: not judged, counted as not
   passed) carries `failure`: `reason` — `usage_limit`, `auth`, `api_error` (from the client's
   parser), `server_error` (artifact level, a server failure before the first forwarded
   `tools/call`, decision 1), `no_tool_call`, `evidence_incomplete` (a proxy log or a co-actor
   mutation log that is not complete), `interrupted` or `runner`; `parser`, the versioned
   identifier of the parser that classified it (null for the runner's own reasons); `code`, the
   client's or server's own identifier where it gives one (an HTTP status, an event subtype;
   letters, digits and `_.:-`, at most 64 characters), never free text; and `beforeModelWork` —
   true or false as the client's parser decides, null when unknown. The note keeps its fixed words; the gate reads `failure`, not the
   note (`src/challenge/gate.ts:46-52`). "No tool call" means, at session level, no host call (the
   bridge's start-up read counts, as in /2) and, at artifact level, nothing the proxy saw (decision 1,
   case c).
   - **Budget exemption** (PADR-0040's runs rejected by the client, PADR-0042 decision 4). A run
     counts against no budget only when all of these hold: its reason is `usage_limit` or `auth`,
     the two PADR-0040 names (`src/challenge/gate.ts:46-50`), never `api_error`, `server_error` or a
     runner's reason; `beforeModelWork` is true; `parser` is a parser this Practonaut ships and
     `--verify` re-derived `failure` from the bound stdout;
     Practonaut's own counters show no model work (session level: no act, undo, reset or check, at
     most the bridge's start-up read; artifact level: no forwarded `tools/call`); and the client's
     tokens are zero or not reported. The validator refuses `beforeModelWork: true` with
     `parser: null`. An unknown parser, a missing binding or an unknown answer counts.

10. **Freezing, reading /1 and /2, migration.**
    - From the change that implements this record, `bench` writes /3 only. `report`, `report
      --verify`, `compare`, `--junit`, `--card` and `--badge` read /1, /2 and /3; /1 and /2 are
      validated and re-verified by their own rules, unchanged (PADR-0036 decision 7, PADR-0039);
      re-verifying a /1 report still ends with the first change of the bundled library.
      `schemas/bench.v3.json` is generated from the zod source like v1 and v2 (`tools/schemas.ts:16`).
    - Until 0.3.0 is released, /3 changes only additively under decision 11; then /3 is frozen and a
      later change needs /4.
    - **No converter.** Every consumer reads a report through one read-only view, typed on its own
      (sketch below) with `readFrom` naming the source version; it is never written to disk and the
      /3 validator never runs on it. Unchanged leaf values are copied, `createdAt`, `label`,
      `recovered` and `interrupted` included. Moved: /1's and /2's
      `environment.excalidraw` becomes `environment.app` (`adapterId: "excalidraw"`); /1's
      `environment.library` becomes `environment.world` (source `library`, `package: null`, no
      generated instances, no limits). Facts the old format fixes: `verdictLevel: "session"`,
      toolchain `practonaut`. Derived: `agentActions = actions`; a /2 run's `client.version` gives
      `clientVersion` with that block's source, never hash-bound. Not recorded, and said so: the
      other new agent fields (`source: "none"`, billing `unknown`); /1 isolation (the report, card
      and badge keep showing "not recorded"); a /2 preset's isolation, which is `by-kind` and allowed
      only in a view; `failure` on /2 `infra_error` runs (their note is shown as today); `stdout`;
      /1 `references`; `instances` unless the bench folder is read and the identities are computed
      from its stored world. The gate and the release ledger accept only
      `readFrom: practonaut.bench/3`. `compare` names a caveat when one side's isolation rests on
      the kind and the other's on evidence.
    - **Measuring P3's acceptance line** (P3b). Before the writer changes, a real /2 bench folder
      written by the 0.2.0 writer (the built-in oracle on a small fixture world, with every artifact
      and log) is committed as a fixture beside `tests/fixtures/bench/v1/`. For it and for every
      committed /1 and /2 report: validated by its own rules; re-verified where its folder exists,
      while `docs/benchmarks/example-report.json` and `tests/fixtures/ci-recipe/baseline.json` have
      none and are consistency-checked only. The view's equality is checked on leaf values: every
      leaf path of the source, enumerated from the committed `schemas/bench.v1.json` and
      `schemas/bench.v2.json` (not from the /3 code), either appears in the view with an equal value
      or is listed in a hand-written table of moved and derived fields, whose target values the
      test states by hand. `compare` of a session report with an artifact report refuses, naming
      `verdictLevel` and the reason; and the two-world pairing test of decision 3 runs.
    - The roadmap's P3 acceptance line ("a stored `/2` report rewritten as `/3`") reads "a stored
      `/2` report read as `/3` through the view" once this record is accepted.
    - **Migration note:** a "/2 → /3" section in `docs/benchmarks/README.md` §5 (new, moved and
      unchanged fields; old reports stay readable and verifiable; nothing to convert) and the
      release notes of 0.3.0, as vision §9 requires.

11. **Who holds the schema** (a process rule for the coordinator).
    - **P3b lands first**: the whole /3 zod schema and validator for both levels,
      `schemas/bench.v3.json`, the view, `--verify` at session level without the co-actor checks,
      `compare` (levels, identity pairing, the new comparability fields), the task-set key in world/2
      and in variant selection with its test and the world-format documentation, the runner writing
      /3 at session level (values it cannot know yet as `none` or absent), and `bench --recover`
      writing /3 at session level and refusing co-actor runs, artifact runs and folders whose logs
      predate /3. Artifact-level `--verify`, its runner and its recovery land with the first reading
      rule (the artifact strand); the co-actor checks of `--verify` and their recovery land with the
      scenario record (item 4). No other strand changes `src/bench/report.ts` before P3b is merged.
    - **Then one holder at a time** for `src/bench/report.ts`, `schemas/bench.v3.json` and the
      run-folder record schemas in `src/bench/evidence.ts` (mutation and proxy records); the
      coordinator names the holder. A change there is small — the schema, its validator rule and
      test, the regenerated schema, the benchmarks README — and is merged, rebased on current main,
      before the next one starts. Code that writes or re-derives the format (runner, proxy,
      `verify.ts`, `compare.ts`, parsers, gate) is merged as ordinary changes against the merged
      schema.
    - **Until 0.3.0 ships**, the holder may add optional fields and new values of the enumerations
      this record defines (an additive change); a new required field, a rename, a removed value or a
      changed meaning amends this record first.

### Schema sketch

The zod source in `src/bench/report.ts` becomes the reference once written; "as /2" means the field
keeps its /2 name, type and meaning (`schemas/bench.v2.json`), and a type named `…V2` is that /2
shape, unchanged.

```ts
type Sha256 = string;        // /^[a-f0-9]{64}$/
type Id = string;            // an identifier, never free text: /^[A-Za-z0-9][A-Za-z0-9_.:@\/-]{0,63}$/
type LocatorValue = string;  // no path separator: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/
type McpMethod = string;     // /^[a-z][A-Za-z_]{0,31}(?:\/[a-z][A-Za-z_]{0,31}){0,3}$/,
                             // e.g. 'notifications/roots/list_changed'; a method that does not fit is logged as null
type ToolName = string;      // /^[A-Za-z0-9_.:-]{1,128}$/; a name that does not fit is a tool outside
type SemVer = string;        // /^\d{1,6}\.\d{1,6}\.\d{1,6}$/ (server pins and rules versions)
type WorldId = string;       // the world schema's own id validator (src/world/schema.ts)
type WorldVersion = string;  // the world schema's own semver validator, pre-release and build included
type Count = number;         // a non-negative safe integer

/** Where a value comes from; a value is never shown stronger than its source. */
type EvidenceSource =
  | 'client-attested'   // a shipped preset client's own structured output, in the run's bound stdout
  | 'preset-requested'  // Practonaut's own record of what a shipped preset started or asked for
  | 'command-output'    // a line in a command template's output; which program printed it is unknown
  | 'none';
interface Evidenced { value: string | null; source: EvidenceSource }  // null exactly when 'none'; a model
                                                                     // matches /2's MODEL_ID, other values Id

type VerdictLevel = 'session' | 'artifact';
type IsolationLevel = 'builtin-baseline' | 'tool-restricted-preset' | 'template-unrestricted'; // values as /2
type BillingClass = 'subscription' | 'api-key' | 'local' | 'unknown';
interface Verdict { passed: boolean; errorClasses: string[] }                                     // as /2

/** World/2 gains one optional field (decision 3); absent, nothing changes. */
interface WorldV2Addition { taskSet?: { id: WorldId; version: WorldVersion } }

interface BenchReportV3 {
  schema: 'practonaut.bench/3';
  createdAt: string; label?: string;                         // as /2
  verdictLevel: VerdictLevel;                                // decision 1
  environment: {
    practonaut: string; node: string; os: { platform: string; release: string; arch: string };  // as /2
    app: { adapterId: Id; version: string };                 // decision 2; replaces /2 `excalidraw`
    mirror?: 'required' | 'off';                             // as /2; session level only
    world: BenchWorldV2 & { scenarios?: Array<{ taskId: string; schedule: Sha256 }> };  // decision 7
  };
  toolchain: PractonautToolchain | ForeignToolchain;         // decision 4; by verdictLevel
  instances: Array<{ taskId: string; seed: number; identity: Sha256 }>;  // decision 3
  agent: AgentV3;                                            // decisions 5, 6
  settings: BenchSettingsV2;                                 // as /2; artifact: mirror 'off', no checks
  references: BenchReferencesV2 | null;                      // as /2
  runs: Array<SessionRun | ArtifactRun>;                     // each run's verdictLevel is the report's
  recovered?: true; interrupted?: BenchInterruptedV2;        // as /2
  summary: SessionSummary | ArtifactSummary;                 // by verdictLevel
}

interface PractonautToolchain {
  kind: 'practonaut'; id: 'practonaut';
  tools: ToolName[];                                         // the tool names the bridge advertised (decision 6)
}
interface ForeignToolchain {                                 // equal to a shipped definition (decision 4)
  kind: 'foreign-mcp';
  id: Id;                                                    // e.g. 'excalidraw-mcp-0.3.2'
  server: { name: Id; version: SemVer; source: string /* URL, no credentials or query, ≤ 512 */; archiveSha256: Sha256 };
  proxy: { name: Id };
  startDelivery: 'server-store' | 'prompt' | 'file';
  locator: { field: string /* ≤ 128 */; select: 'last-ok' | 'first-ok' };
  rules: { format: Id; version: SemVer };
  allowlist: Array<{ tool: ToolName; effect: 'run-store' | 'file' | 'network' }>;
}

interface AgentV3 {
  kind: 'builtin' | 'preset' | 'command'; name: string; command: string[];   // as /2
  isolation: IsolationLevel;                                 // values as /2; from the runs' evidence
  model: string | null;                                      // as /2; first run that reports a model
  modelSource: 'client-attested' | 'command-output' | 'none';                 // as /2
  apiKeySource: string | null;                               // as /2; first run that reports one; parser's list or 'other'
  keptEnv: string[];                                         // as /2
  vendor: Evidenced; client: Evidenced; clientVersion: Evidenced; requestedModel: Evidenced;
  settings: Array<{ name: Id; value: Id }>;                  // as the preset requested them
  billing: { class: BillingClass; source: 'preset-requested' | 'none' };      // before the start
}

interface RunBase {
  verdictLevel: VerdictLevel;
  id: string; taskId: string; seed: number; repeat: number;                   // as /2
  status: 'completed' | 'agent_failed' | 'timeout' | 'infra_error';           // as /2
  pass: boolean;                                                              // derived (decision 1)
  referenceActions: number | null; wallMs: Count; agentExitCode: number | null; note?: string;  // as /2
  isolation: { level: IsolationLevel; evidence: 'by-kind' | 'tools-within-servers' | 'tool-outside-servers' | 'no-evidence' };
  stdout?: { sha256: Sha256; bytes: Count } | null;          // present for every external run (decision 5)
  failure?: RunFailure;                                      // exactly when status is 'infra_error'
  client?: RunClientV3;                                      // external runs with a bound stdout
}
interface RunClientV3 {
  source: 'client-attested' | 'command-output';              // as /2
  model: string | null; turns: Count | null; costUsd: number | null;          // as /2, client-stated
  tokens: { input: Count; output: Count; cacheRead: Count; cacheCreation: Count } | null;  // as /2
  version?: string | null;                                   // as /2
  parser: Id;                                                // the versioned parser that read the stdout
  tools?: { names: ToolName[] /* ≤ 256 */; omitted: Count };  // offered tools as the client lists them
  billing?: { class: BillingClass; source: 'client-attested' | 'preset-requested'; via: Id };  // via: fixed per parser
}
interface RunFailure {
  reason: 'usage_limit' | 'auth' | 'api_error' | 'server_error' | 'no_tool_call' | 'evidence_incomplete'
    | 'interrupted' | 'runner';                              // exempt only usage_limit and auth (decision 9)
  parser: Id | null;                                         // versioned, e.g. 'claude-code-stream/1'
  code: string | null;                                       // /^[A-Za-z0-9_.:-]{1,64}$/, never free text
  beforeModelWork: boolean | null;
}

interface SessionRun extends RunBase {
  verdictLevel: 'session';
  actions: Count; acceptedActions: Count; rejectedActions: Count; undos: Count; resets: Count;  // as /2; agent only
  toolCalls: { observe: Count; act: Count; undo: Count; reset: Count; check: Count; total: Count };  // as /2
  checker: { session: Verdict; native: Verdict | null } | null;               // as /2
  artifacts?: BenchRunArtifactsV2;                           // as /2; native file named per adapter
  logs?: BenchRunLogsV2;                                     // as /2
  agentActions: Count;                                       // decision 7
  coActor?: { planned: Count; fired: Count; accepted: Count; rejected: Count };
}
interface ArtifactRun extends RunBase {
  verdictLevel: 'artifact';
  checker: { artifact: Verdict; result: 'read' | 'absent' | 'unreadable' } | null;
  proxy: { starts: Count; calls: Count; refused: Count };   // from a complete proxy log
  artifacts?: { start: Sha256; result: Sha256 | null; reading: Sha256; checker: Sha256 };  // exactly when judged
  proxyLog: { sha256: Sha256; entries: Count } | null;       // never null on a judged run
}

type SessionSummary = BenchSummaryV2;   // as /2; mean actions and efficiency over agentActions
interface ArtifactSummary {
  runs: Count; passed: Count; judged: Count; infraErrors: Count; passAt1: number;  // as /2
  passHatK: Array<{ k: number; value: number }>; meanWallMs: number | null;       // as /2
  proxyCalls: Count;
  byTask: Array<{ taskId: string; runs: Count; passed: Count; passAt1: number }>;
}

/** mutations.jsonl (session level): /2's record, the actor, and for the co-actor its schedule entry. */
type MutationRecordV3 = MutationRecordV2 & ({ actor: 'agent' } | { actor: 'co-actor'; entry: Count; client: null });
/** proxy.jsonl (artifact level), written by the runner after the agent ended; never the arguments. */
interface ProxyRecord {
  seq: Count; method: McpMethod | null; tool: ToolName | null;  // null method: outcome 'invalid'
  outcome: 'forwarded' | 'refused-allowlist' | 'refused-budget' | 'invalid';
  result: 'ok' | 'error' | null;                             // forwarded calls only
  resultBytes: Count; ms: number;
  locator?: LocatorValue;                                    // on the reply that named a result
}

/** The two release-ledger records of a run (decision 8; P1 writes them, PADR-0042 decision 4). */
interface LedgerStart { kind: 'start'; seq: Count; prev: Sha256; unit: Id; toolchain: Id; rules: SemVer | null; requested: BillingClass }
interface LedgerRunEnd {                                     // appended once per start entry, never an amendment
  kind: 'run-end'; seq: Count; prev: Sha256; start: Count;   // `start`: the seq of its start entry
  toolchain: Id; rules: SemVer | null;
  judged: Sha256 | null; stdout: Sha256 | null; checker: Sha256 | null;   // session.json or result; agent.stdout; checker.json
  observed: { class: BillingClass; source: EvidenceSource };
}

/** A development run in a 0.3.0 round's digest (decision 8): canonical content only, no file hash. */
type DigestRunV2 = { model: string; taskId: string; seed: number; pass: boolean }
  & ({ hash: Sha256; log: string }                           // session level, as /1
   | { result: 'read' | 'absent' | 'unreadable'; state: Sha256 });   // artifact level: judged state, no lists

/** What every consumer reads (decision 10); /1 and /2 are mapped in memory, never rewritten.
 *  Replaced fields are removed per member with Omit before they are redefined. */
type ViewRun<R extends SessionRun | ArtifactRun> = Omit<R, 'isolation' | 'failure'> & {
  isolation: { level: IsolationLevel | null; evidence: RunBase['isolation']['evidence'] | 'not-recorded' };
  failure?: RunFailure | 'not-recorded';                     // /2 infra_error runs: 'not-recorded'
};
interface BenchReportView {
  readFrom: 'practonaut.bench/1' | 'practonaut.bench/2' | 'practonaut.bench/3';
  createdAt: string; label?: string;                         // as the source
  recovered?: true; interrupted?: BenchInterruptedV2;        // as the source (/1: plannedRuns only)
  verdictLevel: VerdictLevel;                                // /1, /2: 'session'
  environment: Omit<BenchReportV3['environment'], 'world'> & {
    world: Omit<BenchWorldV2, 'package'> & { package: BenchWorldV2['package'] | null };  // /1: null
  };
  toolchain: BenchReportV3['toolchain'];                     // /1, /2: practonaut
  instances: BenchReportV3['instances'] | null;              // null: not recorded
  agent: Omit<AgentV3, 'isolation'> & { isolation: IsolationLevel | null };   // /1: null, not recorded
  references: BenchReferencesV2 | null | 'not-recorded';     // /1: 'not-recorded'
  settings: BenchSettingsV2; summary: SessionSummary | ArtifactSummary;
  runs: Array<ViewRun<SessionRun> | ViewRun<ArtifactRun>>;
}
```

## Consequences

- P3b changes `src/bench/report.ts` (the /3 schema, the split validator, the view),
  `src/bench/verify.ts`, `src/bench/compare.ts` (levels, identity pairing, the `checks` field, and
  `agentKindDiffers` with its advice text, which now name the isolation basis), `src/bench/evidence.ts`
  (the actor, `mutationCounts` per actor, the cap rule, `failure`), `src/bench/run.ts` (writes /3;
  `recoverBench`), the renderers (`render.ts`, `details.ts`, `junit.ts`, `card.ts`: level,
  application, toolchain, the no-sandbox line), `src/world/schema.ts` and `src/world/variant.ts`
  (the task-set key, under `.claude/rules/deterministic-core.md`), `docs/world-format.md` and
  `tools/schemas.ts`. P1 reads only `readFrom: practonaut.bench/3` for 0.3.0 rounds: the level and
  toolchain for the unit, the agent identity for the ladder, `failure` and its exemption rule,
  `agent.billing` and `client.billing` for the release ledger, digest /2.
- P1 also gains what decision 8 and decision 5 require of it, amending PADR-0042 decisions 3, 4, 5
  and 7: a probe plan committed and pushed before a unit's first pre-probe run; the start entry and
  an appended run-end record per run; `declare` reading a run only once both records are pushed; the
  check that every committed ledger version is a prefix of the current one; the start guard's
  reservation for every model run; and the billing-class mapping for the ladder, the shapes and the
  round-size formula. PADR-0042 is still proposed, so these land in its accepted text or in a short
  amendment, as the coordinator decides.
- External runs bind their stdout, so `--verify` hashes each stdout in full once more. An artifact
  run keeps its start file, result, reading, checker output, proxy log and stdout.
- The `claude-code` preset keeps "tool-restricted" (decision 6). A preset whose client does not list
  its tools, or offers a file or shell tool, is shown "template: not restricted" and cannot be a
  ladder agent beyond the pair (PADR-0042 decision 5). A /2 report keeps the level its kind gave it.
- `compare` refuses more pairs (mixed levels; `--fail-on-regression` on an identity-paired pair or
  across reading-rules versions; different `checks`) and pairs some it refused before (the same task
  set on two applications or toolchains); the caveats grow by toolchain, reading rules, client
  version, client settings, report version, isolation basis, shared identities within one world and
  unequal run counts across worlds. Across worlds its unit is the distinct identity (an amendment of
  PADR-0039 C.2 for that case only).
- The checker keeps every reading-rules version and toolchain definition from its first committed
  use or first release: a maintenance cost, the price of verifying an artifact report with a later
  Practonaut, as /2 does for a session report (PADR-0036).
- A run whose evidence is not complete (a proxy log at artifact level, a co-actor run's mutation
  log) is `infra_error` (`evidence_incomplete`) and may be benched again; it is never exempt from
  the budget, and more than 5 % of them voids a gate round (PADR-0040).
- The co-actor's schedule is public task content, so the scenario record (item 4) must place it
  there and define the triggers that `--verify` checks.
- Tokens and cost stay the client's own statements, as in /2 (PADR-0039 A.5); the release ledger
  counts runs, so no budget figure depends on them, and P4 may add an optional reasoning-token count
  where its client reports one.
- Roadmap item 2's "one report shows the same tasks on both apps" is delivered as a `compare` page
  of two reports whose worlds share a task set; the draw.io library world names the Excalidraw
  library as its task set, or both name a new one.

### What P3b implemented, and what each later strand implements

**P3b (this change).** The whole /3 zod schema and validator for both levels
(`src/bench/report.ts`), `schemas/bench.v3.json`, the read-only view (`src/bench/view.ts`), the task
identity (`src/bench/identity.ts`), the task-set key in world/2 and in variant selection, the
`claude-code-stream/1` parser with the offered tools, the attested billing class and the fixed
`apiKeySource` list (`src/bench/parsers.ts`, `src/bench/client-evidence.ts`), the runner writing /3 at
session level, `bench --recover` writing /3 and refusing co-actor runs, artifact runs and folders
whose mutation logs predate /3, `report --verify` of session-level /3 reports without the co-actor
checks, `compare` (levels, `checks`, identity pairing, the new caveats), and every surface naming the
level, the application and the toolchain. The committed /2 bench folder `tests/fixtures/bench/v2/`
was written by the /2 writer before the writer changed; `tests/unit/bench-v3-acceptance.test.ts`
measures the acceptance line on it and on every other committed report.

Choices P3b made inside the record, for the next holder:

- The view is a union by level (`SessionReportView | ArtifactReportView`), so a consumer narrows once;
  a /1 report's `keptEnv` and `apiKeySource` are "not recorded" (`null`); a /1 and /2 report's
  advertised tool names are `toolchain.tools: null`; `runs[].client.parser` is absent in the view of
  a /2 run. Every consumer (renderers, details, compare, the CLI) takes a validated report of any
  version or its view and reads it through the view.
- `agent.clientVersion` uses /2's client-version pattern (`runs[].client.version`), which allows `+`.
- The runner records the requested billing class from the preset's kept variables (a kept provider
  key or switch: `api-key`; none: `subscription`) and `requestedModel` from `ANTHROPIC_MODEL` in the
  environment the client starts with; `bench --recover` cannot know that environment and records the
  requested model as not known. `beforeModelWork` of `claude-code-stream/1` is true when no assistant
  message of the model (one the client does not mark as an API error) precedes the failure event.
- The validator also refuses `failure.reason` `no_tool_call` on a session run with host calls,
  `server_error` at session level, and `evidence_incomplete` at session level without a co-actor.
- The card names the level beside what it is (its eyebrow) rather than as an evidence row; the badge,
  the header line, each run's technical details, the JUnit properties (`practonaut.verdictLevel`,
  `practonaut.app`, `practonaut.toolchain`, and `practonaut.sandbox` for a foreign toolchain) and the
  compare page name it too. An artifact report renders without session figures; the schematic of its
  judged state is the artifact strand's.
- Until P1 restricts 0.3.0 rounds to /3, the 0.2.0 challenge gate reads /2 and session-level /3
  reports (they keep every /2 run field).

**Later strands.** The artifact strand: the toolchain definitions, the proxy and `proxy.jsonl`, the
artifact runner, artifact-level `--verify` (refused by name until then) and its recovery, and the
schematic of an artifact run's judged state. The scenario strand (item 4): the co-actor schedule,
`environment.world.scenarios`, co-actor records in the mutation log, `verifySchedule` and its
recovery (co-actor runs and reports with scenarios are refused by `--verify` and `--recover` until
then). P1: the gate reading only `readFrom: practonaut.bench/3`, `failure` and the exemption rule,
`agent.billing` and `client.billing` in the release ledger, the probe plan, the start guard and
digest /2. P4: further parsers and presets, their vendor mappings, model variables and settings.

## Re-assessment triggers

A preset client whose stream does not list the tools it offers, or lists them in another form; a
foreign toolchain whose result is not one local file, or needs more than one locator; a request to
bench two applications or two verdict levels in one bench; an adapter whose judged state needs
application-specific attributes; a reading-rules version or toolchain definition that cannot be kept
for old reports; a new task or state field (the identity's exclusion list); a co-actor that checks or
has its own budget, or a schedule that must stay hidden; agents that reach the proxy log's line
cap, so that `evidence_incomplete` becomes more than rare; the first change /3 needs after the 0.3.0
release.

## Review (2026-10-18)

Three independent reviews of the first draft: a multi-lens Claude Opus review whose findings each
had an adversarial check (ids `code-…`, `security-…`, `gate-…`, `needs-…`; severity after the check
in brackets), OpenAI Codex `gpt-6.1-sol` (`codex-1` … `codex-12`, and its gaps) and Google
`gemini-3.8-flash` (`gemini-1` … `gemini-7`, and its gaps). The coordinator decided the points where
they converge (A–I); this revision applies them. Decision A said the task-set key defaults to "the
world id"; the code hashes the version too (`src/world/variant.ts:6-8`), so the key and its default
are id and version.

| Finding | Disposition | Where, or why not |
|---|---|---|
| code-01 [blocker] | adopted with change | D3: task-set key (id and version) for variant selection, multiset pairing, grid rule replaced, missing identities listed; two-world test (coordinator A) |
| code-02 [minor] | adopted | D7: `verify.ts:116` compares `agentActions` |
| code-03 [minor] | adopted | D7: `agentActions = actions` without a co-actor; `actions − agentActions ≤ coActor.accepted` |
| code-04 [minor] | adopted | D7: recorder never omits accepted or co-actor records; complete log required |
| code-05 [minor] | adopted with change | D7: `environment.world.scenarios` bound like `limits`; `planned` re-derived; per-run hash dropped |
| code-06 [minor] | adopted | D10: leaf paths from the committed v1 and v2 schemas, hand-written move table, folderless reports consistency-checked only |
| code-07 [refuted, minor parts] | adopted with change | Rounds re-verify on their own branch with one Practonaut (PADR-0040), as the check showed; D4 freezes definitions on first committed use; D5 treats an unshipped parser as not attested |
| code-08 [major] | adopted | D5: `stdout` per run, required for external runs, outside `logs`; absent means none; streamed hash |
| code-09 [refuted] | refuted | The check measured 200 stored claude-code stdouts (Claude Code 2.1.299–2.1.301): exactly the seven `mcp__practonaut__` tools; cited in D6 |
| code-10 [minor] | adopted | D3: new world and task fields optional without defaults; the task-set key follows it |
| code-11 | adopted | D10 and the view type: `package: null`, not-recorded states, the /1 `excalidraw` move named |
| code-12 | adopted | D10: /1 isolation stays "not recorded"; gate and ledger read /3 only |
| code-13 | adopted | D5: model and `apiKeySource` each from the first run that reports it; the view keeps stored values |
| code-14 | adopted | D1, D4: proxy counts for every run, split refusals, `calls ≤ maxActions`, failure tied to counts, no mirror, checks or limits at artifact level |
| code-15 | adopted | Sketch: `McpMethod` allows `/` |
| code-16 | adopted | Consequences: `agentKindDiffers` and its advice name the isolation basis |
| code-17 | adopted | D11: `recoverBench` in P3b; refuses co-actor, artifact and pre-/3 folders until their strands |
| code-18 | adopted | D1, D2: native file per adapter; library anchor per adapter |
| code-19 | adopted | D6: at least one run with evidence |
| security-1 [major] | adopted | D5: no statement text; billing class, source and `via` only (coordinator D) |
| security-2 [minor] | adopted with change | D6: a client with a file or shell tool never earns "tool-restricted"; D8 anchors stdout at run end; no pipe capture |
| security-3 [minor] | adopted with change | D5: preset name known, argv checked when the report's Practonaut is this one, origin limit restated |
| security-4 [minor] | adopted | D9: exemption needs a shipped, re-derived parser, own counters and zero tokens; `parser: null` refused (coordinator H) |
| security-5 [major] | adopted | D1: judged on the start file when the result is absent or unreadable (coordinator C) |
| security-6 [minor] | adopted | D1: limited tasks and `--checks` refused at artifact level |
| security-7 [minor] | adopted | D7: every co-actor record matched to its schedule entry |
| security-8 [minor] | adopted | D4: shipped toolchain definitions, `bench_toolchain_unknown`, effects only from the definition |
| security-9 [minor] | adopted with change | D5: `requestedModel` is the switch or variable as the client got it; withholding endpoint variables stays PADR-0034's and P4's |
| security-10 [minor] | adopted with change | D5: counting rule per class (coordinator E); `local` not renamed (PADR-0042 decision 5's word), stated as configuration evidence |
| security-11 [minor] | adopted | D5: billing has a source, re-derivable from stdout or the preset's configuration |
| security-12 [minor] | adopted | D4: frozen on first committed use; conformance fixtures as behaviour tests |
| security-13 [minor] | adopted with change | D8: run-end ledger anchor; reading lists out of the digest |
| security-14 [minor] | adopted | D6: exact names from the run's own server; listed servers exactly the run's |
| security-15 | adopted | D5, D6 |
| security-16 | adopted with change | D3: identities shown as claims unless re-verified; a fixed caveat that texts and actions are not compared, no second hash |
| security-17 | adopted with change | D4: `bench` writes the shipped definition; D8: one rules version per round; `--fail-on-regression` refuses a rules change; semantic-version pattern; P1 reads /3 only |
| security-18 | adopted | D4: runner-side counting endpoint; `proxy.jsonl` written after the agent ended |
| security-19 | adopted | D1, D4: locator an identifier, resolved inside the run's store, no link followed; start file written and hashed before the client starts |
| security-20 | adopted | Sketch: bounded patterns; a tool name that does not fit is a tool outside |
| security-21 | adopted with change | D7: the schedule is public like `limits`; a hidden part would amend this record |
| gate-1 [blocker] | adopted with change | As code-01 |
| gate-2 [minor] | adopted with change | D3: within one world /2 pairing stays (documented, `messages.ts:523`); caveat with the number of distinct identities |
| gate-3 [major] | adopted | D8: toolchain and rules fixed in the declaration; gate refuses others (coordinator B) |
| gate-4 [minor] | adopted with change | D8: guarantee stated; run-end ledger anchor instead of committing pre-probe folders |
| gate-5 [minor] | adopted with change | D3: identity pairing when applications or toolchains differ; flips "between the two configurations"; D1: artifact prompt in `settings.prompt` |
| gate-6 [refuted] | refuted | PADR-0043 allows a side-by-side view without requiring a tool; D3 adds that P7 matches by identity |
| gate-7 [minor] | adopted | D3: exclusion-list projection, version frozen with /3, rule for new fields, trigger |
| gate-8 | adopted | D3: "bench (variant) seed"; `generatedBy` kept as provenance, with the reason |
| gate-9 | adopted | D3: error classes' `when` predicates hashed |
| gate-10 | adopted | D3: `checks` is a comparability field |
| gate-11 | adopted | D8: UTF-16 code-unit order, no locale |
| needs-ownership-covers-one-file [minor] | adopted with change | D11: holder also covers the run-folder record schemas; re-deriving code merges normally |
| needs-closed-enums-frozen [minor] | adopted | D11: additive enumeration values through the holder; single-value `locator.from` dropped |
| needs-p3b-artifact-verify-premature [minor] | adopted | D11: artifact `--verify` lands with the first reading rule |
| needs-billing-api-key-count [minor] | adopted | D5: counting rule |
| needs-billing-requested-and-ledger-link [minor] | adopted with change | D5: `agent.billing` before the start; the ledger names bench folder and run (P1); no report field for it |
| needs-credential-outside-bound-stdout [major] | adopted | D5: no login-status output; source re-derivable or the class is `unknown` |
| needs-locator-value-per-run [minor] | adopted with change | D4: the locator value on its proxy line, checked by `--verify`; no new report field |
| needs-coactor-schedule-not-verified [minor] | adopted | D7 |
| needs-toolchain-compare-same-app [minor] | adopted | D1: the artifact prompt is the runner's, not world content |
| needs-cut-rules-kept-forever [refuted] | refuted | /2 promises verification with a later Practonaut (PADR-0036); keeping definitions is its artifact-level counterpart; the cost is named |
| needs-gate-reads-view | adopted | D10 |
| needs-cut-coactor-hash | adopted with change | D7: per-run hash dropped; scenarios listed per task; `planned` re-derived |
| needs-cut-digest-extras | adopted | D8 |
| needs-cut-unread-proxy-fields | adopted | `byTool` and `locator.from` dropped |
| needs-session-fields-at-artifact-level | adopted | D1 |
| needs-native-name-per-adapter | adopted | D1 |
| needs-compare-grid-cross-app | adopted | D3 |
| needs-settings-no-reader | adopted with change | D5: requested settings with readers (compare caveat, gate equality); reported settings dropped |
| needs-no-sandbox-statement | adopted | D1 |
| needs-artifact-picture | adopted | D1: schematic from `reading.json`; `details.ts` in Consequences |
| needs-vendor-local-presets | adopted with change | D5: vendor from the preset's model mapping, `none` for local presets |
| needs-acceptance-line-reinterpreted | adopted with change | D10: the roadmap line changes when this record is accepted |
| codex-1 (blocker) | adopted | D8 (coordinator B) |
| codex-2 (major) | adopted | D7 |
| codex-3 (major) | adopted | D7 |
| codex-4 (major) | adopted | D4 |
| codex-5 (major) | adopted | D9 (coordinator H) |
| codex-6 (major) | adopted | Sketch: `McpMethod` |
| codex-7 (major) | adopted | D4: forwarded calls never omitted; forwarding and result separate |
| codex-8 (major) | adopted | D10: own view type, leaf equality, moved and derived fields tested by hand |
| codex-9 (major) | adopted with change | D3: task-set key with id and version |
| codex-10 (major) | adopted | D3: multiset pairing |
| codex-11 (major) | adopted | D5: counting rule, requested and observed class (coordinator E) |
| codex-12 (minor) | adopted | D5 |
| codex gap: draw.io attributes | adopted | D3: the judged state has no rendering attributes of an application (`src/world/schema.ts:52-56`) |
| codex gap: cost meaning | adopted with change | Consequences: cost stays the client's statement; the ledger counts runs |
| codex gap: stdout does not authenticate | adopted | D5: the origin limit restated |
| codex gap: /1 not verifiable after a library change | refuted | An existing limitation, documented: the /1 rule (PADR-0036 decision 7), not a /3 change; D10 states it |
| gemini-1 (blocker) | adopted | D3 |
| gemini-2 (blocker) | adopted | D1: `checkRuns` split by level, `derivedPass` per level (coordinator C) |
| gemini-3 (major) | adopted | D7 |
| gemini-4 (major) | adopted | D7: `mutationCounts` per actor |
| gemini-5 (major) | adopted | D10 and the view type |
| gemini-6 (minor) | adopted with change | The digest no longer uses the reading; `reading.json` is canonical JSON anyway |
| gemini-7 (minor) | adopted | D7: undo and reset |
| gemini gap 1: cross-application state normalisation | refuted | The judged state holds no `roughness`, `roundness` or `fillStyle`; shapes and colours are named values (`src/world/schema.ts:52-56`) |
| gemini gap 2: reasoning tokens | adopted with change | Consequences: P4 may add an optional count; no budget figure depends on tokens |
| gemini gap 3: `client.settings` unread | adopted | Reported settings dropped |
| gemini gap 4: recovery of artifact runs | adopted | D11: with the artifact strand; P3b's recovery refuses artifact folders |

Counts over the 100 rows: adopted 69, adopted with change 26, refuted 5.

## Re-review (2026-10-18)

A re-review of the revision by two Claude Opus reviewers — one checking each first-round
resolution (ids `res-…`), one looking for new problems (ids `new-…`) — and by Codex `gpt-6.1-sol`
(`codex-r1` … `codex-r9`, and its gaps). They confirmed 21 first-round blocker and major findings
resolved and all five refutations (code-09, gate-6, needs-cut-rules-kept-forever, Gemini gap 1, the
Codex /1 gap); the Opus re-reviewer re-measured code-09 on 465 stored `agent.stdout` files. The
coordinator decided the converging points (1: no free redraw; 2: pairing across worlds;
3: completeness; 4: budget and ladder; 5: freezing; 6: the minors); this revision applies them.

| Finding | Disposition | Where, or why not |
|---|---|---|
| gate-3, still open (res) | adopted | D8: a probe plan pushed before the first run fixes the toolchain and rules version; both ledger records name them and the run-end record binds `checker.json`; `declare` and `gate` refuse others (coordinator 1b) |
| codex-1, still open (res) | adopted | D8: the trust boundary stated plainly; `declare` reads a run only once its ledger records are pushed; prefix check of the ledger's history (coordinator 1c) |
| res-1 [minor] | adopted | Sketch: `ViewRun` removes the replaced fields per member with `Omit` |
| res-2 [minor] | adopted | D3: the test's expected pairs computed independently (cases 0 and 2 paired, case 1 not compared, unequal run counts) |
| res-3 [minor] | adopted | D4: frozen at the first committed use or the first release, whichever comes first (coordinator 5) |
| res-4 [minor] | adopted | D1: a server failure after the first forwarded call is judged on the last named result or the start file (coordinator 4) |
| res-5 [minor] | adopted | D9: only `usage_limit` and `auth` can be exempt (coordinator 4) |
| res-6 [minor] | adopted | D8: the run-end record is a new appended record naming its start entry (coordinator 1a) |
| res-7 [minor] | adopted with change | D6: the bridge's advertised tool names are recorded once per report (`toolchain.tools`), since every run of a bench starts the same bridge |
| res-8 [minor] | adopted | D5: the validator no longer refuses an unknown preset name; `--verify` checks it in its own version |
| res-9 [minor] | adopted | D5: `via` is a fixed per-parser identifier; no endpoint value is stored |
| res-10 [minor] | adopted | Sketch: `McpMethod` allows `_`; a method that does not fit is logged as null with `outcome: 'invalid'` |
| res-11 [minor] | adopted | D1: `proxyLog` required on every judged artifact run |
| res-12 [minor] | adopted | D7: `--verify` checks that every entry whose trigger the replay reaches has exactly one record (coordinator 3) |
| res-13 [minor] | adopted | Sketch: `taskSet` uses the world schema's id and version validators |
| codex-1 / gate-4 / security-13, still open (new) | adopted | D8 (coordinator 1) |
| gate-3, still open (new) | adopted | D8 (coordinator 1b) |
| codex-11, still open (new) | adopted | D5: the start guard reserves every model run; only a pushed run-end record with both classes `local` releases it |
| new-1 [major] | adopted | D8: guarantee stated, push before `declare`, ledger prefix check, canonical judged state in the digest instead of bytes, so PADR-0040's rule holds without exception |
| new-2 [major] | adopted | D8: probe plan and ledger records fix and bind the rules version before any run |
| new-3 [major] | adopted with change | D3: rate claims use only identities with equal run counts, the others are listed as a caveat, no regression labels; pairing is not refused (coordinator 2) |
| new-4 [minor] | adopted | D3: test with independently computed pairs |
| new-5 [minor] | adopted | D8: one run-end record per start entry, never written by `--recover`; a judged run without one counts, is never digested or scored, and may be benched again |
| new-6 [minor] | adopted | D5: reservation at the start guard |
| new-7 [minor] | adopted | Sketch: `WorldId` and `WorldVersion` |
| codex-r1 (blocker) | adopted | D8: start and run-end as separate appended records; pushed prefix; canonical digest; the PADR-0040 exception removed |
| codex-r2 (major) | adopted with change | D3: across worlds the unit is the distinct identity (coordinator 2), since instances with one content are one board and PADR-0039 already treats its repeats as not independent; stated as an amendment of PADR-0039 C.2 for cross-world comparisons only. A one-to-one matching of instances is not adopted: across worlds, which seed selects which case is arbitrary. Unequal run counts carry no rate claim |
| codex-r3 (major) | adopted | Sketch: `ViewRun` per member; `createdAt`, `label`, `recovered`, `interrupted` in the view (D10) |
| codex-r4 (major) | adopted | D4: the proxy log is complete or the run is not judged (`evidence_incomplete`); no `omitted` counter (coordinator 3) |
| codex-r5 (major) | adopted | D7: schedule completeness |
| codex-r6 (major) | adopted | D5: billing classes mapped onto PADR-0042's subscription and local agents for the 800, the three-agent limit, the round-size formula and shapes A and B (coordinator 4) |
| codex-r7 (minor) | adopted | D5 and sketch: `client.parser` on every external run with a bound stdout |
| codex-r8 (minor) | adopted | As new-7 |
| codex-r9 (minor) | adopted | As res-2 |
| codex-r gap: code-09 not verifiable from the repository | adopted with change | D6: P3b's parser test uses one stored init event with paths and session ids removed and the seven tool names written by hand |
| codex-r gap: /1 disposition wording | adopted | First-round row reworded: an existing limitation, documented |

Counts over the 36 rows of the re-review: adopted 32, adopted with change 4, refuted 0.

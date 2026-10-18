# PADR-0044 — Bench report v3: verdict level, application and toolchain, evidenced agent identity, co-actor attribution and an application-independent task identity

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, strand P3 (issue #46) · Successor format of
[PADR-0036](0036-bench-report-v2-any-world-stored-world.md) and
[PADR-0039](0039-results-you-can-act-on-evidence-report-compare.md) (bench/2, frozen since 0.2.0);
carries the verdict level of [PADR-0043](0043-artifact-judged-verdict-level.md) and the run facts the
gate of [PADR-0042](0042-gate-for-families-on-toolchains.md) reads · To be accepted after an
independent review of this record; the change that implements it (P3b) follows that review

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
  (`src/bench/report.ts:192`, written at `src/bench/run.ts:450`); the world schema still has
  `app.adapterId: "excalidraw"` as a literal (`src/world/schema.ts:140`), which Must 1 widens.
- **Isolation from the kind of agent.** `ISOLATION_OF` maps built-in, preset and template to the
  three levels (`src/bench/report.ts:132`) and the validator refuses any other pairing
  (`src/bench/report.ts:374`). A preset for a client whose shell or file tools cannot be removed
  (PADR-0042 decision 5) would be labelled "tool-restricted" by kind alone.
- **One client's identity.** The model, `apiKeySource` and client version come only from Claude
  Code's `system/init` event (`src/bench/agents.ts:107-122`); there is no requested model, no client
  or vendor field, and `apiKeySource` is Claude Code's own field. A 0.3.0 declaration names each
  ladder agent's client, requested model, attestation and billing (PADR-0042 decision 3).
- **One actor.** The validator requires `actions ≤ acceptedActions` (`src/bench/report.ts:345`) and
  mutation-log entries equal to the agent's counted calls (`src/bench/report.ts:420-421`);
  `--verify` counts a task's limits from every mutation record (`src/bench/verify.ts:110-126`) and
  the log against the agent's counters (`src/bench/verify.ts:147-150`). The host knows the actors
  `human`, `agent` and the host-only `demonstration` (`src/host/protocol.ts:44`); the judged
  session's history carries no actor (`src/world/types.ts:100-101`). A person editing mid-run
  (item 4) breaks every one of these rules.
- **Infrastructure errors read from note text.** The client's failure classes come from Claude
  Code's stream (`src/bench/evidence.ts:197-253`); the gate recognises a run "rejected by the
  client" by matching the run's note with a regular expression (`src/challenge/gate.ts:46-52`).
- **Pairing within one world.** `compare` refuses two reports whose world content hashes differ
  (`src/bench/compare.ts:43`), so the same tasks on Excalidraw and on draw.io cannot be paired. The
  development digest of a gate round hashes a session's state hash and action log
  (`src/challenge/declaration.ts:87-97`), which an artifact run does not have.

The bring-your-own-tools spike adds three facts the format must carry: Claude Code's init event
lists the tools it offers the model ("the agent saw exactly the two allowed tools (`init.tools`)",
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

**Task identity.** (1) *The world content hash.* Differs with the application block, provenance,
behaviour rules and prompts, so it never matches across applications. (2) *The task id.* A name, not
content: two worlds may use one id for different tasks. (3) *A hash of the instance's formal content
— start state, goal, limits, schedule and generator parameters — after the seed's variant is
applied* (chosen).

**Agent identity.** (1) *Move /2's model fields into a new block.* Every /2 report would differ from
its /3 reading in fields that mean the same thing. (2) *Keep /2's fields with their meaning and add
evidenced fields beside them* (chosen).

**Isolation.** (1) *Keep it from the kind.* Contradicts PADR-0042 decision 5. (2) *New values* (for
example "preset, unverified"). Readers, cards and `compare` would learn a fourth value that says the
same as "not restricted". (3) *Keep the three values; a preset earns "tool-restricted" only from its
own runs' evidence* (chosen).

**Counting with a co-actor.** (1) *Count every action.* The agent's figures and its budget would
include the person's edits. (2) *Agent-only counters, a co-actor block, and the actor on every
mutation record* (chosen).

**What an artifact run contributes to a round's digest.** (1) *The stored file's byte hash.*
PADR-0040 keeps byte hashes out of the digest: re-spacing a file would redraw the held-out seeds
for free. (2) *The proxy's call log.* `--verify` checks it by hash only, so an edit plus a new hash
would redraw them for free too. (3) *The checker's reading of the stored result, which `--verify`
re-derives* (chosen).

**Old reports.** (1) *A converter that writes /3 files.* A converted file would look like a native
/3 report and claim evidence nobody recorded. (2) *A read-only view of every version in the /3
shape, nothing written to disk* (chosen).

**Schema ownership during parallel work.** (1) *Every strand edits `report.ts` as it needs.* Four
strands adding required fields in parallel conflict, and a field decided twice means two things.
(2) *One owner at a time; only optional additions until the release* (chosen).

## Decision (proposed)

1. **Verdict level.** Every /3 report has `verdictLevel: "session" | "artifact"`, and every run
   repeats it; the validator refuses a run whose level is not the report's.
   - A **session** run keeps every /2 run field with its /2 meaning (verdicts on the session and,
     with the mirror, the native export; `session.json`, `native.excalidraw`, `checker.json`,
     logs, trace and board), plus the fields of decisions 5–9.
   - An **artifact** run has no Practonaut session and no Practonaut action count. Its verdict is
     `checker: { artifact }` — the separate checker's verdict on the stored result as read by the
     toolchain's reading rules (`end-state-only`, counter-probes first, unmodeled values failing the
     clauses that need them, PADR-0043 decisions 2–5) — or null when not judged. Its pass is that
     verdict's `passed`; there is no mirror, so `environment.mirror` is absent at this level. Its
     judged artifacts, bound by SHA-256 and present exactly when it was judged: the delivered start
     file and the stored result (fixed names per source format, for example `start.json` and
     `result.json` for `excalidraw-mcp`; the report records hashes, never a path, as in /2),
     `reading.json` (the checker's reading: rules format and version, judged state, skipped
     pseudo-elements by kind, unmodeled attributes and values) and `checker.json` (the verdict with
     the rules version). Its evidence: `proxy.jsonl` and `agent.stdout` (decisions 4 and 5).
   - **`report --verify` of an artifact report** checks, in order, with a named code and exit 2 on
     the first difference: the stored world and the references as for /2 (PADR-0036 decision 6);
     every artifact and log against its hash (`bench_artifact_changed`); that this Practonaut's
     checker ships the report's reading-rules version (`bench_rules_unknown`; the checker keeps
     every reading-rules version a released Practonaut wrote into a report, and never changes one
     once released); then per judged run (`bench_report_invalid`): the start file, read by the same
     rules, equals the instance's start state on the declared attributes (PADR-0043 decision 5);
     the result, read again, gives the stored reading; the checker, run again on that reading in a
     separate process, gives the stored checker output and the run's verdict; the proxy log gives
     the run's proxy counts.
   - **Summaries.** A session report keeps /2's summary. An artifact report has a summary without
     action figures (no mean actions, no efficiency: the agent's own changes are not Practonaut
     actions) and with the proxy's calls instead.
   - **`compare`** refuses a pair of different levels with `compare_incomparable`, naming the field
     `verdictLevel` with both values in words ("session verdict" and "artifact-judged, end-state only, no
     Practonaut history") and the reason: runs of different verdict levels are never paired
     (PADR-0043 decision 1). Showing the same tasks at both levels side by side is not a comparison;
     no command of 0.3.0 draws it.
   - **Every surface names the level**, also for session reports: the report header and each run
     record, the card, the badge, the JUnit properties (`practonaut.verdictLevel`) and the compare
     page.
   - `settings.maxActions` keeps its name and is the outer cap per run at both levels: at session
     level the agent's act, undo and reset calls that reach the session (as /2), at artifact level
     the `tools/call` requests the proxy forwards. The output names the unit.

2. **Application.** `environment.app: { adapterId, version }` replaces /2's `environment.excalidraw`:
   the world's `app.adapterId`, and the pinned application version the adapter ran (session) or
   whose own conversion the reading rules are conformance-tested against (artifact, PADR-0043
   decision 2). `--verify` requires `adapterId` to be the stored world's `app.adapterId`
   (`bench_world_changed`). **A report holds runs of one application**: it follows from one stored
   world per bench folder.
   "One report shows the same tasks on both apps" (roadmap item 2) is `practonaut compare` of the
   two reports at the same verdict level, which pairs their instances by task identity
   (decision 3), names each side's application in its column and draws no figure that pools them.
   Its flips are listed as differences between the applications, never as instance regressions, and
   `--fail-on-regression` refuses such a pair (`compare_incomparable`, field `application`): a
   regression gate compares one application with itself.

3. **Application-independent task identity.** Per instance (task × seed):

   `identity = SHA-256(canonicalJson({ identity: "practonaut.task-identity/1", start, goal,
   limits, scenario, generatedBy }))` with `canonicalJson` and `sha256Hex` of `src/canonical`, over
   the validated world (defaults applied) and the task as `generateVariant(world, seed)`
   materialises it:
   - `start`: the task's start state (its own `initialState`, else the world's), with the seed's
     variant applied (labels, parameters, layout offset);
   - `goal`: the task's goal predicate, with the variant applied;
   - `limits`: the task's `limits`, or null;
   - `scenario`: the task's co-actor schedule (item 4), or null. This record requires the schedule
     to be task content, like `limits` (PADR-0040 decision 4), so the world's content hash and the
     identity bind it and the stored world keeps it with the runs (the roadmap's "schedule stored
     with the run"); the scenario record decides its shape and what the agent sees of it;
   - `generatedBy`: `{ id, version, seed, parameters }`, or null.

   Not hashed: the world's id, version, `app` block and provenance; its actions, behaviour rules and
   unselected variants (they describe the toolchain and the application); titles, prompts, hints,
   condition texts and error classes (an artifact-mode prompt lists the reading rules, PADR-0043
   decision 4; error classes explain a verdict, never decide it); the task id and the seed number
   (names, not content). The identity assumes the judged state model is shared by every adapter
   (Must 1); an adapter that needs its own attributes in the state gives other identities, which is
   correct.

   The report lists `instances: [{ taskId, seed, identity }]`, one entry per instance that has at
   least one run, in plan order; the validator requires exactly the runs' instances; `--verify`
   re-derives every identity from the stored world (`bench_world_changed`). **`compare`** pairs by
   task and seed when the world content hashes are equal, as in /2. When they differ, the pair is
   comparable only if the applications differ, both reports list identities, no identity appears
   twice on a side and both sides hold the same set of identities; instances are then paired by
   identity. Otherwise the `world` difference stands as in /2: within one application a different
   world is a different benchmark, however equal its identities, because prompts and the action
   model may differ.

4. **Toolchain record.** Every report has `toolchain`. Session level: `{ kind: "practonaut", id:
   "practonaut" }` (Practonaut's own actions over MCP, at the version `environment.practonaut`).
   Artifact level: `kind: "foreign-mcp"`; `id`, the toolchain part of a unit name (PADR-0042
   decision 1, for example `excalidraw-mcp-0.3.2`); `server` with its name, pinned version, source
   (where the archive came from: a URL without credentials or query) and the archive's SHA-256;
   `proxy.name`, the MCP server name the client sees; `startDelivery` — `server-store` (written into
   the server's own store and named in the prompt), `prompt` (inline) or `file` (in the agent's
   working directory); `locator`, the field of the server's own reply that named the result (for
   example `structuredContent.checkpointId`), never the agent's stream (PADR-0043 decision 7);
   `rules`, the checker's reading-rules format and version; `allowlist`, every tool the proxy
   passes with its effect as measured during conformance for this pinned version: `run-store`
   (only the run's own store), `file` or `network`. Each artifact run counts what the proxy saw —
   `starts` (`initialize`), `calls` (forwarded `tools/call`), `refused` (a tool not on the allowlist)
   and calls per tool — from `proxy.jsonl`, which Practonaut's proxy writes (one line per request:
   sequence, method, tool, outcome, result bytes, time; never the arguments) and the report binds
   by hash. A difference in toolchain id or rules version between two reports of one world is a
   caveat `compare` names, not a refusal: the toolchain is what such a comparison tests.

5. **Agent identity.** /2's agent fields keep their names and meaning: `kind`, `name`, `command`,
   `model` with `modelSource` (the reported model: the first run that reports one), `apiKeySource`
   and `keptEnv`. Beside them, each with its value and its evidence source:
   - `vendor` (the model's vendor, an identifier the preset's record fixes), `client` (the client
     program the preset starts, such as `claude-code`), `clientVersion` (the first run that reports
     one; each run's own stays in `runs[].client.version`, as in /2) and `requestedModel` (the model
     Practonaut passed through the preset's documented model switch — an option, or an environment
     variable the preset names, such as `ANTHROPIC_MODEL` —, null when the client's default runs);
   - `settings`: client settings that change behaviour (a reasoning level and similar) as the
     preset requested them; each run's `client.settings` holds what the client itself states;
   - per run, `client.credential`: which statement was read (`via`, a fixed identifier per parser,
     such as `claude-code:init.apiKeySource` or a client's own login-status command), its value, and
     the billing class the parser derives — `api-key`, `subscription`, `local` (only when the
     client's own output names the loopback endpoint, PADR-0042 decision 5) or `unknown`, which the
     release ledger counts as a subscription run (PADR-0042 decision 4).

   Evidence sources: `client-attested` (a shipped preset client's own structured output in the
   run's `agent.stdout`), `preset-requested` (Practonaut's own record of what a shipped preset
   started or asked for, before the client started), `command-output` (a line in a command
   template's output; which program printed it is unknown), `none` (a value is null exactly then).
   The validator allows `client-attested` and `preset-requested` only for a preset and
   `command-output` only for a template, as /2 does for `modelSource`. `agent.stdout` of every
   external run is bound by SHA-256 (`logs.stdout`), and `--verify` re-derives every
   client-attested or command-output value from it with the preset's parser, as it does for the
   model today (`src/bench/verify.ts:130-136`). The parsers and each preset's values are the presets
   strand's (P4, whose record refines PADR-0034); this record fixes the fields and their sources. A
   gate pair needs `modelSource: "client-attested"` (PADR-0042 decision 6); that is the gate's rule.

6. **Isolation from evidence.** The three values and their wording stay. A built-in is
   `builtin-baseline` (Practonaut's own code; no client to restrict) and a command template is
   `template-unrestricted` (its output names no program). A **preset** is `tool-restricted-preset`
   only when every judged run carries evidence in its own stream that every tool the client offers
   the model belongs to the run's MCP server — `practonaut` at session level, the proxy at artifact
   level, where every allowlisted tool must also have the effect `run-store` (PADR-0043 decision 8)
   — and no run, judged or not, shows another tool. Otherwise it is `template-unrestricted`, shown
   "template: not restricted" with the reason (no evidence, or the tool outside). The evidence lives
   per run: `client.tools`, the offered tool names as the client lists them (for Claude Code the
   `tools` array of `system/init`; at most 256 names, a longer list is never evidence of
   restriction), and `isolation: { level, evidence }` with `evidence` one of `by-kind` (built-ins
   and templates only), `tools-within-servers`, `tool-outside-servers`, `no-evidence`.
   `report --verify` checks the stdout's hash, re-reads the offered tools with the preset's parser,
   recomputes each run's level and the report's, and refuses a difference
   (`bench_report_invalid`).

7. **Co-actor.** At session level only (PADR-0042 decision 1 refuses the co-actor family on foreign
   toolchains; the validator refuses `coActor` on an artifact run):
   - every /3 mutation record carries `actor: "agent" | "co-actor"`; the co-actor is host-only, like
     the demonstration, and no request can claim it; its records have `client: null`. A /2 log is
     read with the /2 record schema, every record the agent's;
   - `acceptedActions`, `rejectedActions`, `undos`, `resets` and `toolCalls` count the agent only;
     `settings.maxActions` caps the agent's calls only; a task's action limit is counted from the
     agent's records only (roadmap item 4: "human actions do not use the agent's budget");
   - `runs[].coActor`, present exactly when the task has a schedule: `schedule` (the SHA-256 of the
     canonical JSON of the schedule the host ran, the task's scenario of decision 3), `planned`,
     `fired`, `accepted`, `rejected`;
   - `runs[].agentActions`: the agent's actions in the final history, derived by replaying the
     mutation log with its actors as the trace does, and equal to `actions` without a co-actor;
   - validator: `toolCalls.act = acceptedActions + rejectedActions` stays; `actions ≤
     acceptedActions` (`src/bench/report.ts:345`) becomes `actions ≤ acceptedActions +
     coActor.accepted`, with `agentActions ≤ min(actions, acceptedActions)`; mutation entries plus
     omitted (`src/bench/report.ts:420-421`) equal the agent's act, undo, reset and check calls plus
     `coActor.fired` (co-actor records are never omitted); `fired = accepted + rejected ≤ planned`;
   - `--verify`: limits from the agent's records (`src/bench/verify.ts:123-125`); the agent's
     records against the agent's counters and the co-actor's against `coActor`
     (`src/bench/verify.ts:147-150`); `agentActions` re-derived from the replay;
   - efficiency, mean actions and mean actions when passed use `agentActions`; the summary fields
     keep their names, and a report without a co-actor gives the same values as under /2.

8. **Inputs of a round's development digest.** P1's digest is `practonaut.challenge-development/2`
   (0.2.0 declarations keep /1). Each development run contributes `verdictLevel`, `toolchain` (its
   id), `model` (reported), `taskId`, `seed`, `identity` (decision 3) and `pass`, and then:
   - **session:** `hash`, the judged session's state hash, and `log`, the canonical JSON of its
     action log (as /1; with a co-actor the log holds its actions and the identity holds the
     schedule);
   - **artifact:** `rules` (format and version) and `reading`, the SHA-256 of the canonical JSON of
     the checker's reading of the stored result (judged state, skipped and unmodeled lists), which
     `--verify` re-derives from the result.

   Never part of it: the stored result's byte hash, the proxy log, the client's figures, the status
   (PADR-0040: nothing an operator can change for free moves the held-out seeds). The unit enters
   the seed derivation through P1 (PADR-0042 decision 1).

9. **Infrastructure errors per client.** An `infra_error` run (as /2: not judged, counted as not
   passed) carries `failure`: `reason` — `usage_limit`, `auth`, `api_error` (from the client's
   parser), `no_tool_call`, `interrupted` or `runner`; `parser`, the fixed identifier of the
   client's parser (null for the runner's own reasons); `code`, the client's own identifier where it
   gives one (an HTTP status, an event subtype; letters, digits and `_.:-`, at most 64 characters),
   never its free text; and `beforeModelWork` — true or false as the client's parser decides, null
   when unknown, which counts against the budget (PADR-0042 decision 4). The note keeps its fixed
   words. The gate reads `failure`, not the note (`src/challenge/gate.ts:46-52`). "No tool call"
   means, at session level, no host call (the bridge's start-up read counts, as in /2) and, at
   artifact level, nothing the proxy saw (its `initialize` counts the same way): an agent that never
   started the foreign server (PADR-0043 decision 7). `--verify` re-derives `failure` from the bound
   stdout when this Practonaut ships the named parser, and otherwise says that it could not.

10. **Freezing, reading /1 and /2, migration.**
    - From the change that implements this record, `bench` writes /3 only. `report`, `report
      --verify`, `compare`, `--junit`, `--card` and `--badge` read /1, /2 and /3; /1 and /2 are
      validated and re-verified by their own rules, unchanged (PADR-0036 decision 7, PADR-0039).
      `schemas/bench.v3.json` is generated from the zod source like v1 and v2
      (`tools/schemas.ts:16`).
    - Until 0.3.0 is released, optional fields may be added to /3 under decision 11; then /3 is
      frozen and a later change needs /4.
    - **No converter.** Every consumer reads a report through one read-only view in the /3 shape
      with `readFrom` naming the source version. A field whose path exists in both the source schema
      and /3 is copied unchanged. Moved: /2's `environment.excalidraw` becomes `environment.app`
      (`adapterId: "excalidraw"`); /1's `environment.library` becomes `environment.world` (source
      `library`, no package, no generated instances). New fields get the facts the old format fixes
      (`verdictLevel: "session"`, toolchain `practonaut`, isolation evidence `by-kind`) or values
      derived from recorded fields (`agentActions = actions`, `clientVersion` from the first run's
      `client.version` with that block's source), and otherwise "not recorded" (`source: "none"`,
      `failure` absent, `instances` null unless the bench folder is read and the identities are
      computed from its stored world). The view never infers evidence. `compare` names a caveat
      when one side's isolation is by kind and the other's by evidence.
    - **Measuring P3's acceptance line** (P3b): before the writer changes, a real /2 bench folder
      written by the 0.2.0 writer (built-in oracle on a small fixture world, with every artifact and
      log) is committed as a fixture beside `tests/fixtures/bench/v1/`. For it and for every
      committed /1 and /2 report: validated by its own rules, re-verified where its folder exists;
      the view equals the source on every path both schemas define, the paths enumerated by walking
      the two zod schemas, not from a hand-written list; and `compare` of a session report with an
      artifact report refuses, naming `verdictLevel` and the reason.
    - **Migration note:** a "/2 → /3" section in `docs/benchmarks/README.md` §5 (new, moved and
      unchanged fields; old reports stay readable and verifiable; nothing to convert) and the
      release notes of 0.3.0, as vision §9 requires.

11. **Who owns the schema** (a process rule for the coordinator).
    - P3b lands first: the whole /3 zod schema with every required field of this record, the
      validator rules, the view, `--verify` and `compare` for both levels, `schemas/bench.v3.json`,
      and the runner writing /3 at session level (values it cannot know yet as `none` or absent).
      The artifact and co-actor parts are tested with hand-written report fixtures until their
      writers exist. No other strand changes `src/bench/report.ts` before P3b is merged.
    - After that, one strand at a time holds `src/bench/report.ts` and `schemas/bench.v3.json`; the
      coordinator names the holder. A change there is small — the schema, its validator rule and
      test, the regenerated schema, the benchmarks README — and is merged, rebased on current main,
      before the next one starts. Writers (runner, artifact mode, co-actor host, presets, gate)
      live outside it and proceed in parallel against the merged schema.
    - Until 0.3.0 ships, only optional fields and new values of the fields this record types as
      identifiers (format, parser, client, vendor, `via`) are added; a new required field, a rename
      or a changed meaning amends this record first.

### Schema sketch

The zod source in `src/bench/report.ts` becomes the reference once written; "as /2" means the field
keeps its /2 name, type and meaning (`schemas/bench.v2.json`), and a type named `…V2` is that /2
shape, unchanged.

```ts
type Sha256 = string;   // /^[a-f0-9]{64}$/
type Id = string;       // an identifier, never free text: /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,63}$/
type Count = number;    // a non-negative safe integer

/** Where a value comes from; a value is never shown stronger than its source. */
type EvidenceSource =
  | 'client-attested'   // a shipped preset client's own structured output, in the run's bound agent.stdout
  | 'preset-requested'  // Practonaut's own record of what a shipped preset started or asked for
  | 'command-output'    // a line in a command template's output; which program printed it is unknown
  | 'none';
interface Evidenced { value: string | null; source: EvidenceSource }  // value null exactly when 'none'

type VerdictLevel = 'session' | 'artifact';
type IsolationLevel = 'builtin-baseline' | 'tool-restricted-preset' | 'template-unrestricted'; // values as /2
interface Verdict { passed: boolean; errorClasses: string[] }                                     // as /2

interface BenchReportV3 {
  schema: 'practonaut.bench/3';
  createdAt: string; label?: string;                         // as /2
  verdictLevel: VerdictLevel;                                // decision 1
  environment: {
    practonaut: string; node: string; os: { platform: string; release: string; arch: string };  // as /2
    app: { adapterId: Id; version: string };                 // decision 2; replaces /2 `excalidraw`
    mirror?: 'required' | 'off';                             // as /2; session level only
    world: BenchWorldV2;                                     // as /2: source, id, version, hashes, generated, limits
  };
  toolchain: PractonautToolchain | ForeignToolchain;         // decision 4; by verdictLevel
  instances: Array<{ taskId: string; seed: number; identity: Sha256 }>;  // decision 3
  agent: AgentV3;                                            // decisions 5, 6
  settings: BenchSettingsV2;                                 // as /2; maxActions per level (decision 1)
  references: BenchReferencesV2 | null;                      // as /2
  runs: Array<SessionRun | ArtifactRun>;                     // each run's verdictLevel is the report's
  recovered?: true; interrupted?: BenchInterruptedV2;        // as /2
  summary: SessionSummary | ArtifactSummary;                 // by verdictLevel
}

interface PractonautToolchain { kind: 'practonaut'; id: 'practonaut' }
interface ForeignToolchain {
  kind: 'foreign-mcp';
  id: Id;                                                    // e.g. 'excalidraw-mcp-0.3.2'
  server: { name: string; version: string; source: string; archiveSha256: Sha256 };
  proxy: { name: Id };
  startDelivery: 'server-store' | 'prompt' | 'file';
  locator: { from: 'server-reply'; field: string };          // e.g. 'structuredContent.checkpointId'
  rules: { format: Id; version: string };                    // e.g. { format: 'excalidraw-mcp', version: '1.0.0' }
  allowlist: Array<{ tool: Id; effect: 'run-store' | 'file' | 'network' }>;
}

interface AgentV3 {
  kind: 'builtin' | 'preset' | 'command'; name: string; command: string[];   // as /2
  isolation: IsolationLevel;                                 // values as /2; from the runs' evidence (decision 6)
  model: string | null;                                      // as /2: the reported model
  modelSource: 'client-attested' | 'command-output' | 'none';                 // as /2
  apiKeySource: string | null; keptEnv: string[];                             // as /2
  vendor: Evidenced; client: Evidenced; clientVersion: Evidenced; requestedModel: Evidenced;
  settings: Array<{ name: Id; value: string }>;              // as the preset requested them
}

interface RunBase {
  verdictLevel: VerdictLevel;
  id: string; taskId: string; seed: number; repeat: number;                   // as /2
  status: 'completed' | 'agent_failed' | 'timeout' | 'infra_error';           // as /2
  pass: boolean;                                                              // derived (decision 1)
  referenceActions: number | null; wallMs: Count; agentExitCode: number | null; note?: string;  // as /2
  isolation: { level: IsolationLevel; evidence: 'by-kind' | 'tools-within-servers' | 'tool-outside-servers' | 'no-evidence' };
  failure?: RunFailure;                                      // exactly when status is 'infra_error'
  client?: RunClientV3;                                      // external agents, as /2
}
interface RunClientV3 {
  source: 'client-attested' | 'command-output';              // as /2
  model: string | null; turns: Count | null; costUsd: number | null;          // as /2
  tokens: { input: Count; output: Count; cacheRead: Count; cacheCreation: Count } | null;  // as /2
  version?: string | null;                                   // as /2
  settings?: Array<{ name: Id; value: string }>;             // as the client states them
  tools?: { names: string[]; omitted: Count };               // offered tools as the client lists them, ≤ 256
  credential?: { via: Id; value: string | null; billing: 'api-key' | 'subscription' | 'local' | 'unknown' };
}
interface RunFailure {
  reason: 'usage_limit' | 'auth' | 'api_error' | 'no_tool_call' | 'interrupted' | 'runner';
  parser: Id | null; code: Id | null; beforeModelWork: boolean | null;
}

interface SessionRun extends RunBase {
  verdictLevel: 'session';
  actions: Count; acceptedActions: Count; rejectedActions: Count; undos: Count; resets: Count;  // as /2; agent-only
  toolCalls: { observe: Count; act: Count; undo: Count; reset: Count; check: Count; total: Count };  // as /2
  checker: { session: Verdict; native: Verdict | null } | null;               // as /2
  artifacts?: BenchRunArtifactsV2;                           // as /2: session, native, checker, trace, board
  logs?: BenchRunLogsV2 & { stdout?: { sha256: Sha256; bytes: Count } };      // as /2, plus agent.stdout
  agentActions: Count;                                       // decision 7
  coActor?: { schedule: Sha256; planned: Count; fired: Count; accepted: Count; rejected: Count };
}
interface ArtifactRun extends RunBase {
  verdictLevel: 'artifact';
  checker: { artifact: Verdict } | null;
  proxy: { starts: Count; calls: Count; refused: Count; byTool: Array<{ tool: Id; calls: Count }> };
  artifacts?: { start: Sha256; result: Sha256; reading: Sha256; checker: Sha256 };  // exactly when judged
  logs?: { proxy: { sha256: Sha256; entries: Count; omitted: Count } | null; stdout?: { sha256: Sha256; bytes: Count } };
}

type SessionSummary = BenchSummaryV2;   // as /2; mean actions and efficiency over agentActions
interface ArtifactSummary {
  runs: Count; passed: Count; judged: Count; infraErrors: Count; passAt1: number;  // as /2
  passHatK: Array<{ k: number; value: number }>; meanWallMs: number | null;       // as /2
  proxyCalls: Count;
  byTask: Array<{ taskId: string; runs: Count; passed: Count; passAt1: number }>;
}

/** mutations.jsonl (session level): /2's record and the actor. */
type MutationRecordV3 = MutationRecordV2 & { actor: 'agent' | 'co-actor' };
/** proxy.jsonl (artifact level), written by Practonaut's proxy: one line per request, never its arguments. */
interface ProxyRecord {
  seq: Count; method: Id; tool: Id | null;
  outcome: 'forwarded' | 'refused' | 'error'; resultBytes: Count; ms: number;
}

/** A development run in a 0.3.0 round's digest (decision 8). */
type DigestRunV2 = { toolchain: Id; model: string; taskId: string; seed: number; identity: Sha256; pass: boolean }
  & ({ verdictLevel: 'session'; hash: Sha256; log: string }
   | { verdictLevel: 'artifact'; rules: string; reading: Sha256 });

/** What every consumer reads (decision 10); /1 and /2 are mapped in memory, never rewritten. */
type BenchReportView = Omit<BenchReportV3, 'schema' | 'instances'> & {
  readFrom: 'practonaut.bench/1' | 'practonaut.bench/2' | 'practonaut.bench/3';
  instances: BenchReportV3['instances'] | null;
};
```

## Consequences

- P3b changes `src/bench/report.ts` (the /3 schema, its validator and the view),
  `src/bench/verify.ts`, `src/bench/compare.ts`, `src/bench/evidence.ts` (the actor, `failure`),
  `src/bench/run.ts` (writes /3), the renderers (`render.ts`, `junit.ts`, `card.ts`: level,
  application and toolchain on every surface; the environment line reads `environment.app`) and
  `tools/schemas.ts`. P1 reads /3 for 0.3.0 rounds: the level and toolchain for the unit, the agent
  identity for the ladder, `failure` for runs rejected by the client, `client.credential.billing`
  for the release ledger, digest /2.
- A session bench folder gains no file; `agent.stdout` of external runs becomes bound by hash, so
  `--verify` reads each stdout once more in full to hash it. An artifact run keeps its start file,
  result, reading, checker output, proxy log and stdout.
- The `claude-code` preset keeps "tool-restricted" because its stream lists its tools; a preset
  whose client does not list them is shown "template: not restricted" and cannot be a ladder agent
  beyond the pair (PADR-0042 decision 5). A /2 report keeps the level its kind gave it.
- `compare` refuses more pairs (mixed levels, a cross-application pair under
  `--fail-on-regression`) and pairs some it refused before (the same instances on two
  applications); the caveats grow by toolchain, reading rules, client version, report version and
  isolation basis.
- The checker keeps every released reading-rules version: a maintenance cost, the price of
  verifying old artifact reports with a later Practonaut.
- The co-actor's schedule is task content, so the scenario record (item 4) must place it there.
- Roadmap item 2's "one report shows the same tasks on both apps" is delivered as a `compare` page
  of two reports, under this record's reading of that line.

## Re-assessment triggers

A preset client whose stream does not list the tools it offers, or lists them in another form; a
foreign toolchain whose result is not one local file, or needs more than one locator; a request to
bench two applications or two verdict levels in one bench; an adapter whose judged state needs
application-specific attributes; a reading-rules version that cannot be kept for old reports; two
tasks with the same identity in one world; a co-actor that checks or has its own budget; the first
change /3 needs after the 0.3.0 release.

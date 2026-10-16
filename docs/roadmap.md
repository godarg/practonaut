# Roadmap

Status: **accepted** 2026-10-14 by the maintainer, together with the [vision](vision.md)
([PADR-0033](adr/0033-product-direction-measurement-you-can-act-on.md)). Dates are targets, not
promises. Each deliverable has an **acceptance** line; it is done when that line is measured.
Sizes are rough estimates in agent sessions (one session ≈ one reviewable pull request with tests):
S = 1, M = 2–3, L = 4–8, XL = more than 8.

## How to use this page

- Work on the **current milestone**, in the order listed. Items marked *must* ship in the release;
  *should* items ship if they are ready; *won't* items are out of scope for that release even if
  they look easy.
- Before the first edit of a deliverable, read the files and decision records it names. If a
  deliverable needs a decision the records do not cover, write the PADR first.
- Measure acceptance lines with real runs and put the numbers into the pull request. A model-based
  run names the client version and the actual model from the client's own output.
- Moving a deliverable to another milestone or changing an exit criterion is a maintainer decision.
- Publishing (npm, release, registry, marketplace, posts) is a maintainer step ([release](release.md)).

## 0.1.0 — first public version (released 2026-10-14)

Practice in the browser on Excalidraw 0.18.1 with a real, pinned engine mirroring every step;
16 library tasks (EN/DE, three variants, reference solutions, near misses); tasks from two drawings
or a demonstration; any MCP agent with one line; `practonaut bench` with pass@1, pass^k, JSON and
HTML reports and `report --verify`; macOS, Linux, Windows; no Docker, no telemetry.

Baseline measured on 2026-10-14 (published package, details in the
[landscape note](research/landscape-2026-10.md) §5):

| Measure | Value |
|---|---|
| Claude Code runs on the six hardest tasks, seeds 1–2 | 36 of 36 passed (Opus 5.5 24/24, Haiku 5.5 12/12) |
| Server time per `act`, without / with mirror (median) | about 106 ms / 138 ms; the pure core needs 0.04 ms |
| `observe` on `connect` / a 40-step chain | 6.9 KB / 56.6 KB; each `act` reply repeats the whole view (+590 B per step) |
| Static blocks in all tool replies of a real run | 67 % |
| Cold start to MCP `initialize` (empty npm cache / warm, mirror on) | 3.6 s / 1.3–2.6 s |
| `bench --agent oracle --tasks all --seeds 1` | 27 s, 16/16 |
| Memory per session with / without mirror | about 880 MiB / 400 MiB |
| Largest goal `tasks from-scenes` accepts | a 50-step chain; 60 steps fail with `goal_too_complex` |

## 0.2.0 — Real signal (target: December 2026)

*Released 2026-10-16* ([changelog](../CHANGELOG.md)). Ladder round 1 of the challenge tier: none of
the five candidate families passes; Opus, Sonnet and Haiku solve almost every held-out instance, so
there is no headroom ([gate reports](benchmarks/challenge/README.md)). A second round needs new
budget (470 of the 500 model runs are spent); otherwise the zero-family branch below applies to
0.3.0 — a maintainer decision.

**Question:** does a Practonaut score tell two agents apart, and does it say why?

Work in waves of one deliverable per session, in this order: Must 0 → 1 → 2 → 3 → 4, then Should
5–7; the spike (item 8) is independent and runs in its own git worktree at any time. Every wave starts
with a measurement and ends with its acceptance line measured.

**Measurement rules for this release** (they apply to every acceptance line below):

- Latency is the **client-observed round trip** of `tools/call` through the real `practonaut mcp`
  bridge, measured by instrumented client code (the versioned measurement tool and Practonaut's own
  bench client, `src/bench/mcp-client.ts`) — not the host's `latencyMs` and not the bridge, which
  cannot see the client's side — on a fixed action sequence, 72 calls after 8 warm-up calls, median
  and p90; bridge and host processing times are reported alongside and labelled as such. Baseline and
  new version are measured on the same machine, in the same week, with the same tool (`tools/`).
- Reply size is the **full serialized `tools/call` result** (every content part and
  `structuredContent`).
- "No regression in pass rate" means a **paired grid** (same tasks, seeds and models, both versions
  measured in the same week): every instance that passed with 0.1.0 passes again. Any paired
  regression fails the acceptance line; an exception needs a maintainer-approved change of the
  criterion, recorded with the affected instances.
- Model runs use the subscription only (`env -u ANTHROPIC_API_KEY`), the model is read from the
  client's own output, and the running list-price total is kept in the report. Budget for the whole
  release: at most 500 model runs (Must 1 grid about 50; per challenge family and round at most 100:
  a small development sample plus 3 agents × 24 held-out instances); a family gets at most two
  ladder rounds. Families run in the listed order and first rounds come before second rounds; when
  the budget is used up, no further round starts, the gate report says so, and a maintainer decides
  whether to add budget.

### Must

0. **Safety and housekeeping first** (S). The `claude-code` preset no longer passes provider API keys
   (`ANTHROPIC_API_KEY` and similar) to the agent unless `--keep-env <name>` is given; the README says
   so (a set key silently switches Claude Code from the subscription to API billing). `apiKeySource`
   is recorded once bench/2 exists (item 2). Dependabot groups `playwright` and `playwright-core`
   together (both open Dependabot pull requests fail `npm run check` because they are bumped apart).
   Node 24 and 26 run in a separate, non-required CI job — the required check names
   (`test (<os>)`, `secret scan`) stay unchanged; changing the ruleset is a maintainer step.
   `docs/release.md` gains the two coupled version places it misses: `src/version.ts` and the
   checker's list of known session writers (`src/checker/state.ts`), with a test that a session
   written by the current version is accepted. `docs/testing.md` loses the sentence that CI never ran.
   README scope fixes: "no network at runtime" is about Practonaut's own process; agents get the
   same task and goal conditions as a person, through semantic actions rather than the GUI.
   `design:capture` and `design:invariants` are named in PADR-0020 but do not exist: record in a new
   PADR (with a leading pointer in PADR-0020) that they are not built until a review needs them.
   *Acceptance:* a unit test shows the preset environment without the key and with `--keep-env`;
   both Dependabot updates pass CI after regrouping; a 0.2.0-dev session is accepted by the checker.
1. **Lean agent surface** (M). Cache the validated world and variant per session; `Session.world`
   without a deep copy on every read; build the transaction candidate without a full rebuild. This
   refines PADR-0022 ("the host retains … tentative reconstruction and candidate replay"): write the
   refining PADR first; the replay check before every result check stays (architecture §9). `act`
   replies with a compact delta (changed objects, effects, new ids, step, revision, error classes);
   `observe` takes `detail: "compact" | "full"`, `lang: "en" | "de" | "both"` and a history window;
   static blocks (task list, action definitions) are sent once. **The goal conditions — sentence and
   formal form — stay in every `observe` and every `check_result`, in the chosen language, exactly as
   the Player shows them** (invariant "hidden data stays hidden"). Schema errors name the path and the
   expected value; `stale_base` carries the current step and revision; tool annotations
   (`readOnlyHint`, `destructiveHint`); `structuredContent` next to a short text reply; capabilities
   that are announced are real (task text as a resource, one "practise" prompt) or not announced.
   Bench agents do not see reference lengths of other tasks. Both MCP protocol generations stay tested.
   *Files:* `src/host/session.ts`, `src/core/session.ts`, `src/core/apply.ts`, `src/mcp/*`,
   `src/host/protocol.ts`, `docs/agent-guide.md`.
   *Acceptance:* client round-trip median per `act` on `excalidraw/connect` at most half of 0.1.0's,
   with and without the mirror (0.1.0 on 2026-10-14: 131.5 ms without, 163.5 ms with — re-measure);
   a full `act` result ≤ 2 KB there; cumulative result bytes per episode at least 50 % lower than
   0.1.0 on the six hardest library tasks; no regression on the paired grid (six tasks × seeds 1–2 ×
   Opus and Haiku).
2. **Bench your own tasks** (M). `bench --world <dir|.pnworld> [--tasks <ids>] [--oracle <file>]`
   with the oracle sidecar that `tasks from-scenes` already writes (`practonaut.task-oracle/1`, kept
   outside the agent's folder); the public world is stored in the bench folder and `report --verify`
   re-judges against that stored world, not the bundled library. Report format `practonaut.bench/2`
   (readers keep reading `/1`) with `apiKeySource`, an **isolation level** per agent ("tool-restricted
   preset" or "template: tools not restricted by Practonaut") and an optional reference (no efficiency
   without a validated reference); `--seed-list 2,5`; `--label`; template agents keep their model when
   their output reports it. **Decide in the bench/2 PADR how generated instances are stored:** the
   recommendation is materialised instances — a generator writes concrete worlds that carry the
   generator id, version and seed — so bench/2 does not need a new variant format.
   *Files:* `src/cli/bench.ts`, `src/bench/*`, `schemas/`, `docs/benchmarks/README.md`.
   *Acceptance:* an integration test: a task made with `tasks from-scenes` is benched, the bench
   folder is moved, `report --verify` passes; a changed world or artifact fails verification; a
   stored `/1` report still verifies.
3. **Results you can act on** (L). A call log per run: the bridge records every tool call (name,
   result code, full result bytes, bridge processing time), Practonaut's bench client adds the
   client round trip for its built-in agents (for other clients: "client timing unavailable"), the
   host records every mutation (revision, accepted or rejected with parameters and error code); all
   go into the bench folder. Report v2:
   a header line with the fraction, a 95 % Wilson interval, verification status, mirror, isolation
   level and "model self-reported"; failures first; per run the trajectory, the goal conditions met
   after each action (checker on prefixes), the final board as the real engine's SVG export when the
   mirror ran (otherwise a schematic labelled as such) — a picture that keeps every goal-relevant
   attribute (shape, fill, stroke, size, position, frames, and group membership — groups are metadata
   that an SVG export does not show, so they are drawn as an outline or legend derived from the
   judged state); the Player's `miniature()` drops
   most of them and may only be used as a labelled topology sketch; board text is untrusted and
   escaped — next to an example target only when one is supplied and checker-validated (otherwise
   "no example target"),
   error classes with their explanation text, tokens, turns, cost and model when the client reports
   them. `practonaut compare a.json b.json [--html] [--fail-on-regression]` refuses incomparable
   reports (world hash, grid, mirror, budget, isolation level) and pairs runs by task, seed and
   instance. Its rules are fixed in a PADR before code: the **unit of analysis is the distinct
   instance** — repeats of one instance are aggregated into one outcome per agent (pass when at least
   half of its repeats pass) and never counted as independent pairs; an **instance regression** is an
   instance with at least three repeats on each side that passed in every baseline repeat and fails in
   every candidate repeat (this is what `--fail-on-regression` gates on; with fewer repeats the report
   says "single runs — not a regression signal"); **rate claims** use an exact McNemar test on the
   discordant instances at α = 0.05 and otherwise say "not distinguishable at this n"; the docs carry a
   table of the number of instances needed to detect a 20-point difference. The renderer falls under
   `design:lint`.
   *Acceptance:* fixture runs with a test each: for every checker error class, a failed run whose
   report names the error class, the unmet condition and the action after which that condition was
   last lost (or "never met"); for timeout, rejected actions, model-only, consistency-checked only,
   unjudged (`checker: null`), empty, two agents and long German names, a run whose report shows that
   state by name with its reason; a correct and an incorrect `restyle-flow` board whose pictures
   differ, and a grouped and an ungrouped board whose pictures differ; `compare` gives the documented verdicts on
   hand-built fixtures (instance regression, improvement, not distinguishable, unjudged runs,
   incomparable); no rate is shown finer than 1/n; axe passes on the report states.
4. **Headroom: challenge tier** (L, plus ladder rounds). Build at least four candidate families from
   this list, in this order: **repair** (start from a near miss with 3–5 subtle defects), **prompt
   injection in board content** (conditions that nothing else was deleted or changed), **long horizon
   with distractors** (20–60 actions, similar labels; needs item 1; the fuel limit is about 50
   elements today), **limited checks** (`--checks <n>`, the same limit for the Player and MCP; the
   formal goal stays public), **tight action budget** (budget = minimal length). A seeded generator
   on the state-based core of `from-scenes` produces materialised instances with a difficulty
   parameter; instances differ in structure, not only labels. Fix the efficiency measure: compute a
   minimal length where the search is small, otherwise label the column "reference length".
   **Not in 0.2.0:** a hidden formal goal (it breaks the invariant that Player and agent see the same
   formal form) and the "human edits mid-run" family (it needs a scenario contract first —
   persisted schedule, actor costs, undo/reset semantics, binding into `--verify` and `compare` —
   recorded by a PADR; planned for 0.3.0).
   *Gate per family, preregistered in the PR before the first ladder run:* ladder = Claude Opus,
   Sonnet and Haiku through the `claude-code` preset (a non-Claude agent only if a maintainer approves
   one; otherwise the family is labelled "ladder: Claude models only"). Tuning uses development
   instances only; the **strongest and the weakest agent are fixed by the capability order —
   Opus and Haiku — before any run** (changed before the first ladder run; PADR-0040); the
   development runs are still made and reported as a sanity check. The gate runs on **at least 24 fresh held-out instances, one run per agent per
   instance** (the instance is the unit, as in `compare`): headroom — the strongest agent passes
   between 10 % and 80 % of them; discrimination — strongest vs weakest differ by at least 20 points
   with an exact McNemar p < 0.05 on the discordant instances; every run counts in the denominator,
   and more than 5 % `infra_error` voids the round; oracle 100 %, random ≤ 5 %, every near miss fails.
   A second round uses new held-out instances, never the first round's. At most 100 model runs per
   family per round.
   *Acceptance:* every candidate has a gate report in `docs/benchmarks/`; families that pass are
   published, the others stay unpublished and are named. The release does not wait for a passing
   family; if none passes after two rounds, that is reported, PADR-0033's re-assessment trigger fires,
   and the zero-family branch below applies.

### Should

5. **CI recipe** (S): a GitHub Actions example with pinned versions and the user's own agent
   credentials, gating on instance regressions; JUnit output from `bench`. Publishing a marketplace
   action is a maintainer step. *Acceptance:* the example runs in a test repository with the oracle
   agent and fails on a planted instance regression; the JUnit file validates.
6. **Result card and badge** (M): `report --card` (1280 × 640 SVG and PNG, light and dark) and
   `report --badge` (SVG), both with n, isolation level and verification status, byte-identical for
   the same report. *Acceptance:* a double render gives identical bytes; the required caveat texts are
   text nodes in the SVG (test); a report that is only consistency-checked yields a card that says so.
7. **First 60 seconds** (S): `npx practonaut` opens model-only at once with a visible "not yet
   checked against the real Excalidraw" banner; the mirror download is a named step with its size;
   a **public, unscored demonstration on the bundled example world** (never a library or bench task,
   whose reference solutions stay hidden) shows actions landing, the mirror confirming and the
   checker judging (the Player's result check, the same evaluation as the Check button; the
   independent checker never loads in a practice session). *Acceptance:* time from the command to the first visible action ≤ 30 s with a warm
   npx cache, measured; an e2e test shows the banner and the demonstration; no library or bench
   reference reaches the Player (test).
8. **Spike for application #2: draw.io** (M, timeboxed, in its own git worktree; preregistered in
   `spikes/drawio/PREREGISTRATION.md` before the first run, report in `spikes/drawio/REPORT.md`): run
   the official embed JSON protocol from a local, pinned bundle (release tag and SHA-256 recorded) in
   the existing headless Chromium; answer the six questions of the [adapter guide](adapter-guide.md)
   §4; replay the 16 reference solutions and near misses through it with an independent `.drawio`
   parser. *Abort* (any one): the protocol works locally only with source patches beyond documented
   URL or configuration parameters; an external request cannot be blocked without losing function;
   a world/2 action cannot be expressed or a round trip fails in one of three runs; a silent rejection
   or change stays invisible to read-back and integrity check; start > 3 s, memory > 1.5 GB or
   mandatory download > 80 MB; a licence question (stencil clause, bundled libraries, fonts) cannot
   be settled without a lawyer. On abort see "If a spike aborts" below. No adapter code ships in 0.2.0.
9. **Spike: bring your own tools** (S, timeboxed): score one run of an agent that uses the official
   Excalidraw MCP server (or a community server that writes a local scene) on three library tasks by
   judging the native `.excalidraw` it leaves with the independent checker. Report what is readable,
   what is not, and what 0.3.0's artifact mode needs.

### Won't (0.2.0)

Second application (spikes only), artifact mode as a feature, hidden goals, a scripted co-actor,
sealed runner, MCP over HTTP, MCP Apps, RL API, GUI mode, public ranking, signed reports.

### Exit criteria

Must 0–3 accepted; Must 4 delivered with a gate report for every candidate (any number of passing
families, including none); `npm run check`, `npm test` and every test layer green on all CI
platforms; the draw.io spike report exists (pass or abort); the release notes state the measured
numbers and the model-run total; a walkthrough "author a task → bench it → compare two agent
configurations → read why one failed" runs end to end from the docs in a fresh session. Release
preparation (version in `package.json`, both places in `server.json`, `src/version.ts`, the
checker's known writers, lockfile, changelog) is a pull request the maintainer merges; tagging and
publishing are maintainer steps ([release](release.md)).
*Evidence goal (not a release blocker):* one external project uses Practonaut on its own task within
six weeks after the release (see Checkpoints).
Estimated 20–32 sessions: Must 0 S, Must 1 M, Must 2 M, Must 3 L, Must 4 L plus up to two ladder rounds
per family, spikes M and S, walkthrough and release preparation S.

### If a spike aborts

| Spike result | 0.3.0 becomes |
|---|---|
| draw.io passes | as written below |
| draw.io aborts | spike bpmn-js as application #2 at the start of 0.3.0 (same abort criteria); the adapter follows only if it passes |
| both abort | no second application in 0.3.0; artifact mode, bridges and the co-actor family; the spreadsheet spike moves forward from 0.4.0 |
| bring-your-own-tools spike finds no readable state | artifact mode in 0.3.0 starts with tools that hand back a native file (for example draw.io's `create_diagram`), and the other servers are listed as not supported |
| no challenge family passes (zero-family branch) | 0.3.0 starts with a renewed, gated family development (new candidates, new held-out instances); until a family passes, artifact mode and the narrowed plan use the library tasks, labelled "library, not a challenge tier" |

## 0.3.0 — Two apps, your tools (target: March 2027)

**Question:** can I score *my* toolchain, on more than one app, and keep it from regressing?
Estimated 22–32 sessions. Content changes if a spike aborted (table above) or the usage checkpoint
narrows the plan (Checkpoints).

- **Adapter registry and browser shell** (M): adapters chosen by the world's `app.adapterId`; the
  literal `"excalidraw"`/`"0.18.1"` types widened in the adapter contract, world schema, mirror and
  checker dispatch; the reusable browser shell (Chromium start with deadline, fail-closed routing,
  transaction with timeout and rollback, PNG render, hash export) extracted while the second adapter
  is built. *Acceptance:* the Excalidraw conformance suite passes unchanged through the registry; a
  world naming an unknown adapter is refused with a named error.
- **Application #2: draw.io** (L), if its spike passed: pinned release, served from local files,
  written and read only through the official embed JSON protocol, an independent `.drawio` parser
  in the checker, a conformance suite against the real app. *Acceptance:* the 16 library tasks and
  every published challenge family pass with the oracle and fail with near misses on draw.io (three
  runs agree); one report shows the same tasks on both apps.
- **Bring your own tools (artifact mode)** (M–L): the agent gets a start file and the task and works
  with any tools it has; Practonaut judges the native result with the same independent checker. A
  separate verdict level ("artifact-judged, end-state only, no Practonaut history") recorded by a
  PADR, shown as such in every report, card and comparison. *Acceptance:* two external toolchains
  (for example the official Excalidraw and draw.io MCP servers) scored on the challenge tier (or, in
  the zero-family branch, on the library, labelled so), with the results and their verdict level in
  the docs.
- **A human edits mid-run** (M): the challenge family deferred from 0.2.0, after its scenario PADR
  (schedule stored with the run and bound into `--verify` and `compare`; human actions do not use the
  agent's budget; undo and reset rules). *Acceptance:* the oracle passes under the scripted
  intervention; the family passes the ladder gate or is reported as not passing.
- **Bridges** (M): verdict files that Claude Code `plugin eval` graders can read; JUnit; a GitHub
  Action (publishing it is a maintainer step). *Acceptance:* one example repository runs the action
  and fails on an instance regression.
- **Demonstrate once, for real** (M): record any practice or editor session → start and end state →
  task via the state-based core of `from-scenes`; the human's action sequence becomes the reference.
  Freeze the old three-step repair flow behind a flag; do not delete it. *Acceptance:* a recorded
  session of a library task becomes a task that passes its own oracle and rejects its near misses.
- **Community task packs** (M): data-only packs (world + oracle sidecar) benchable by name; a
  contribution guide with an acknowledgement rule (contributors of accepted tasks are named).
  *Acceptance:* a pack from a separate folder is validated, benched and re-verified; a hostile pack is
  rejected with a named code.

## 0.4.0 — Where agents live (target: May 2027)

Estimated 18–28 sessions.

- **MCP Apps** (M–L): a read-only result card and board view rendered inside chat clients
  (`ui://` resource); text fallback stays complete. *Acceptance:* renders in two hosts, light and dark.
- **MCP over HTTP on loopback** (M): session handles as tool arguments (MCP 2026-07-28 is stateless);
  the agent side no longer needs the npm package. *Acceptance:* a bench run with an agent that has
  only an HTTP endpoint and no package on disk; host, origin and token guards tested.
- **Sealed runner, optional** (L): agent under a separate OS user or in a container; reference
  solutions and checker data outside anything the agent can read. *Acceptance:* a red-team agent with
  shell tools cannot read reference data and cannot change verdicts; the report shows "sealed".
- **Export to where trainers look** (M): `practonaut export harbor` (instruction, a Node + Chromium
  Dockerfile, tests that call the checker and write `reward.json` with the fraction of conditions met,
  a solution from the oracle); the call log as JSONL or ATIF trajectories. *Acceptance:* one exported
  task runs in Harbor where Docker is available; the trajectory file validates against its schema.
- **More presets** (S each): other agent CLIs where their tools can be limited to MCP, otherwise
  documented wrappers; a preset for OpenAI-compatible local endpoints. *Acceptance:* each preset has a
  run in the example reports, with its isolation level.
- **Spreadsheet identity spike** (M, timeboxed, preregistered like the draw.io spike) for Univer:
  stable row and range identity across inserts, awaitable formula recalculation, computed values
  readable by an independent checker, offline bundle size, licence (xlsx export is commercial-only).
  *Abort* (any one): identity is positional only; recalculation cannot be awaited deterministically;
  computed values need the commercial edition; mandatory download > 80 MB. On abort, 0.5.0 takes a
  documents app (BlockNote) instead.

## 0.5.0 — Beyond diagrams (target: August 2027)

Estimated 20–35 sessions.

- **Action-vocabulary decision** (S, PADR): a domain package per kind of app (graph, sheet, document)
  or a declarative effect language interpreted twice (core and checker), decided with the 0.4.0 spike
  in hand.
- **Application #3: spreadsheets (Univer)** (L), if the spike passed; otherwise documents.
  *Acceptance:* oracle 100 %, random ≤ 5 %, at least one family passes the ladder gate; reports,
  `compare`, card and badge work across all apps.
- **MCP server as the app, pilot** (S–M): the MCP reference `memory` server (a knowledge graph in a
  JSONL file) whose semantics the core can predict exactly, so every invariant holds; a PADR for
  "observed transitions" (filesystem, SQLite, git) only after the pilot. *Acceptance:* tasks on the
  memory server pass with the oracle and are judged from the JSONL file by the independent checker.
- bpmn-js stays a candidate for the graph domain (an app that enforces its own rules) and the fallback
  for application #2.

## 0.6.0 — Practice that transfers (target: October 2027)

Estimated 12–20 sessions.

- **Skill A/B** (M): `bench --arm none --arm skill:<dir> --arm placebo` on identical held-out
  instances with paired statistics (the `compare` rules).
- **Learning from verified runs** (M, opt-in, agent side): distil a skill only from checker-judged
  runs, successes and failures, never from reference solutions; measure the effect on generated
  instances the agent has not seen.
- **Environment API** (M–L): OpenEnv-style `reset`/`step`/`state` with partial reward from met
  conditions over the deterministic model-only mode; a throughput number.
  *Acceptance:* one documented effect whose 95 % interval excludes zero — or a published negative result.

## 0.7.0 — Other hands (target: early 2028)

Estimated 20–30 sessions.

- **GUI mode** (L–XL): a computer-use agent operates the real Excalidraw through the existing editor
  path (unrecognised gestures stay `unmodeled`); same tasks, same checker. *Acceptance:* one report
  compares Practonaut actions, MCP tools and GUI on identical instances.
- **Application #4/#5:** documents (BlockNote) or Git through the observed-transitions contract,
  chosen by the outcome of the 0.5.0 pilot. WebMCP-based adapters only once WebMCP ships in a stable
  browser or a target app registers tools.

## 1.0 — Stable platform (target: 2028)

Frozen formats (world, bench report, task pack) with a migration tool and a compatibility policy;
at least three applications; at least 200 tasks including community packs; a static, pull-request
based results page that accepts only sealed, re-verified submissions; manual screen-reader and
200 % zoom checks done; a maintainer and contributor ladder.

## Checkpoints

The North Star definition is in [vision](vision.md) §5. Every checkpoint is a maintainer decision
with the numbers measured that day.

| When | What is decided |
|---|---|
| six weeks after 0.2.0 ships, at the latest 2027-02-28 | at least one external project? If not, run the narrowed plan below instead of the rest of 0.3.0 |
| 2027-06-30 | at least 10 external projects? Which bridge or app brought them? |
| 2027-12-31 | at least 50 external projects? Plan for 1.0 |

**Narrowed plan (written now, used only if the first checkpoint fails):** keep own-task bench,
`compare` and the challenge tier; publish the measured findings (headroom, context cost, model
comparisons) as a technical report; export the challenge tier (or the library, in the zero-family branch) to Harbor and OpenEnv so researchers
can use it where they already work; no second application; re-assess after three months.

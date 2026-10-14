# Roadmap

Status: **proposed** 2026-10-14 together with the [vision](vision.md)
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

**Question:** does a Practonaut score tell two agents apart, and does it say why?

### Must

1. **Lean agent surface** (M). Cache the validated world and variant per session; `Session.world`
   without a deep copy on every read; build the candidate without a full rebuild while keeping the
   replay check before every result check (architecture §9). `act` replies with a compact delta
   (changed objects, effects, new ids, step, revision, error classes); `observe` takes
   `detail: "compact" | "full"`, `lang: "en" | "de" | "both"` and a history window; static blocks
   (task text, task list, action definitions) are sent once, not with every `act`. Schema errors
   name the path and the expected value; `stale_base` carries the current step and revision; tool
   annotations (`readOnlyHint`, `destructiveHint`); `structuredContent` next to the text reply;
   announced capabilities (resources, prompts) are either real or not announced. Bench agents do not
   see reference lengths of other tasks.
   *Files:* `src/host/session.ts`, `src/core/session.ts`, `src/core/apply.ts`, `src/mcp/*`,
   `src/host/protocol.ts`, `docs/agent-guide.md`.
   *Acceptance:* server median per `act` ≤ 10 ms without mirror and ≤ 60 ms with mirror on
   `excalidraw/connect`; an `act` reply ≤ 2 KB there; cumulative tool-reply bytes per episode at
   least 50 % lower than 0.1.0 on the six hardest library tasks, with the same pass rate for two
   models; Player and MCP still show the same goal conditions (invariant "hidden data stays hidden").
2. **Bench your own tasks** (M). `bench --world <dir|.pnworld> [--tasks <ids>]` with an optional
   oracle sidecar (`practonaut.task-oracle/1`, already written by `tasks from-scenes`); the public
   world is stored in the bench folder and `report --verify` re-judges against that stored world, not
   the bundled library. Report format `practonaut.bench/2` (readers keep reading `/1`); reference
   length optional (no efficiency without a validated reference); `--seed-list 2,5`; `--label` per
   agent; template agents keep their model when the client reports it.
   *Files:* `src/cli/bench.ts`, `src/bench/*`, `schemas/`, `docs/benchmarks/README.md`.
   *Acceptance:* a task made with `tasks from-scenes` is benched, the bench folder is moved,
   `report --verify` passes; a changed world or artifact fails verification; `/1` reports still verify.
3. **Headroom: challenge tier** (L). A second library world with at least four task families that
   spread agents, built from these candidates in this order: **repair** (start from a near miss with
   3–5 subtle defects), **prompt injection in board content** (conditions that nothing else was
   deleted or changed), **long horizon with distractors** (20–60 actions, similar labels; needs
   item 1), **a human edits mid-run** (a scripted co-actor in the shared session renames, moves or
   deletes after action k; conditions that the human's change survives — no other benchmark has
   human and agent in one session), **hidden formal goal and limited checks** (`--checks <n>`,
   prose-only goal with the formal form held back), **tight action budget** (budget = minimal
   length). A seeded generator (from the state-based core of `from-scenes`) with a difficulty
   parameter produces variants; seeds vary structure, not only labels. Fix the efficiency measure:
   compute a minimal length where the search is small, otherwise label the column "reference length".
   *Gate before a family is published (principle 2):* ladder of at least three agents (a frontier
   model, a small model, and a non-Claude agent where one can be run); the strongest passes between
   10 % and 80 % over at least 24 runs; oracle 100 %, random about 0 %, every near miss fails.
   *Acceptance:* at least three families pass the gate; the gate runs are kept as an example report.
4. **Results you can act on** (L). The host writes a call log per run (every tool call with its
   result code, including rejected actions with parameters and error codes). Report v2: a header line
   with the fraction, a 95 % Wilson interval, verification status, mirror and "model self-reported";
   failures first; per run the trajectory, goal conditions met after each action (checker on
   prefixes), final board next to the goal as miniatures, error classes with their explanation text,
   and tokens, turns, cost and model when the client reports them (Claude Code's stream-json `result`
   event). `practonaut compare a.json b.json [--html] [--fail-on-regression <rule>]`: refuses
   incomparable reports (world hash, grid, mirror, budget), pairs runs by task, seed and variant, says
   "not distinguishable at this n" when that is the honest answer, exits non-zero on a regression rule
   for CI. The report renderer falls under `design:lint`; ten report states (all pass small n, mixed,
   all fail, timeout, rejected actions, model-only, consistency-checked only, empty, two agents, long
   German names) are rendered as fixtures, checked with axe and looked at.
   *Files:* `src/host/session.ts`, `src/bench/*`, `src/player/ui/miniature.ts` (a static SVG string
   variant), `tools/design-lint.ts`, `docs/benchmarks/README.md`, `docs/design/`.
   *Acceptance:* a developer finds the cause of a failed run from the HTML report alone (cold-read
   test by a fresh agent and, if available, a person); no rate is shown finer than 1/n; `compare`
   gives the documented verdicts on hand-built fixtures (improvement, regression, unjudged runs,
   incomparable reports).

### Should

5. **CI recipe** (S): a GitHub Actions example with pinned versions and the user's own agent
   credentials; JUnit output from `bench`. Publishing a marketplace action is a maintainer step.
6. **Result card and badge** (M): `report --card` (1280 × 640 SVG and PNG, light and dark) and
   `report --badge` (SVG), both with n and verification status, byte-identical for the same report.
7. **First 60 seconds** (S): `npx practonaut` opens model-only at once with a visible "not yet checked
   against the real Excalidraw" banner; the mirror download is a named step with its size; a
   "Play the reference solution (no language model)" button shows actions landing, the mirror
   confirming and the checker judging.
8. **Housekeeping** (S; do it first, it is small and removes noise and a billing risk): Dependabot
   groups `playwright` and `playwright-core` together (both open Dependabot pull requests fail
   `npm run check` because they are bumped apart); Node 24 and 26 in the
   CI matrix; `docs/testing.md` still says CI has not run on GitHub; `design:capture` and
   `design:invariants` are named as gates in PADR-0020 but do not exist — build them or correct the docs;
   the `claude-code` preset passes the whole environment to the agent, so a set `ANTHROPIC_API_KEY`
   switches Claude Code to API billing — decide (remove provider keys unless `--keep-env <name>`, or
   warn) and record `apiKeySource` in the report.
9. **Spike for application #2: draw.io** (M, timeboxed; preregistered in
   `spikes/drawio/PREREGISTRATION.md` before the first run, report in `spikes/drawio/REPORT.md`): run the official embed JSON protocol from
   a local, pinned bundle in the existing headless Chromium; answer the six questions of the
   [adapter guide](adapter-guide.md) §4; replay the 16 reference solutions and near misses through it
   with an independent `.drawio` parser. *Abort* (any one): the protocol works locally only with source
   patches beyond documented URL or configuration parameters; an external request cannot be blocked
   without losing function; a world/2 action cannot be expressed or a round trip fails in one of three
   runs; a silent rejection or change stays invisible to read-back and integrity check; start > 3 s,
   memory > 1.5 GB or mandatory download > 80 MB; a licence question (stencil clause, bundled
   libraries, fonts) cannot be settled without a lawyer. On abort, spike bpmn-js as #2 instead.
   No adapter code ships in 0.2.0.

### Won't (0.2.0)

Second application (the spike only), bring-your-own-tools mode, sealed runner, MCP over HTTP,
MCP Apps, RL API, GUI mode, public ranking, signed reports.

### Exit criteria

Items 1–4 accepted; `npm run check`, `npm test` and every test layer green on all CI platforms; the
changelog states the measured numbers; the draw.io spike report exists (pass or abort); a
walkthrough "author a task → bench it → compare two agent configurations → read why one failed"
runs end to end from the docs in a fresh session.
Estimated 16–24 sessions.

## 0.3.0 — Two apps, your tools (target: March 2027)

**Question:** can I score *my* toolchain, on more than one app, and keep it from regressing?

- **Adapter registry and browser shell** (M): adapters chosen by the world's `app.adapterId`; the
  literal `"excalidraw"`/`"0.18.1"` types widened; the reusable browser shell (Chromium start with
  deadline, fail-closed routing, transaction with timeout and rollback, PNG render, hash export)
  extracted from the Excalidraw adapter while the second adapter is built ("rule of two").
- **Application #2: draw.io** (L), if the 0.2.0 spike passed (else bpmn-js, see 0.2.0 item 9): pinned
  release, served from local files in the existing headless Chromium, written and read only through the
  official embed JSON protocol, an independent `.drawio` (mxfile XML) parser in the checker, a
  conformance suite against the real app. draw.io maps almost one to one onto world/2 (steps, arrows,
  frames, groups, styles), so the library and the challenge families run on both apps.
  *Acceptance:* the 16 library tasks and every published challenge family pass with the oracle and fail
  with near misses on draw.io (three runs agree); one report shows the same tasks on both apps.
- **Bring your own tools (artifact mode)** (M–L): the agent gets a start file and the task and works
  with any tools it has (the official Excalidraw or draw.io MCP server, a community server, plain file
  edits); Practonaut judges the native result with the same independent checker. A separate verdict
  level ("artifact-judged, end-state only, no Practonaut history") recorded by a PADR and never shown as
  equal to a session verdict. *Spike first:* which servers leave a readable local scene or hand back the
  native file; abort if none does without patching it. *Acceptance:* two external toolchains scored on
  the challenge tier, with results in the docs.
- **Bridges** (M): verdict files that Claude Code `plugin eval` graders can read; JUnit; a published
  GitHub Action (maintainer step).
- **Demonstrate once, for real** (M): record any practice or editor session → start and end state →
  task via the state-based core of `from-scenes`; the human's action sequence becomes the reference.
  Freeze the old three-step repair flow behind a flag; do not delete it.
- **Community task packs** (M): data-only packs (world + oracle sidecar) benchable by name; a
  contribution guide with an acknowledgement rule (contributors of accepted tasks are named).

*Checkpoint 2027-01-15 (maintainer):* if there are no external usage signals after the launch and
0.2.0 (no external issue, pull request, discussion or public repository using Practonaut), narrow
the positioning before building 0.3.0 further.

## 0.4.0 — Where agents live (target: May 2027)

- **MCP Apps** (M–L): a read-only result card and board view rendered inside chat clients
  (`ui://` resource); text fallback stays complete. *Acceptance:* renders in two hosts, light and dark.
- **MCP over HTTP on loopback** (M): session handles as tool arguments (MCP 2026-07-28 is stateless);
  the agent side no longer needs the npm package.
- **Sealed runner, optional** (L): agent under a separate OS user or in a container; reference
  solutions and checker data outside anything the agent can read. *Acceptance:* a red-team agent with
  shell tools cannot read reference data and cannot change verdicts.
- **Export to where trainers look** (M): `practonaut export harbor` (instruction, a Node + Chromium
  Dockerfile, tests that call the checker and write `reward.json` with the fraction of conditions met,
  a solution from the oracle); the host call log as JSONL or ATIF trajectories. *Acceptance:* one
  exported task runs in Harbor where Docker is available.
- **More presets** (S each): other agent CLIs where their tools can be limited to MCP, otherwise
  documented wrappers; a preset for OpenAI-compatible local endpoints.
- *Should:* **spreadsheet identity spike** for Univer (stable row and range identity across inserts,
  awaitable formula recalculation, computed values readable by an independent checker), so a
  spreadsheet app is not delayed past 0.6.0.

## 0.5.0 — Beyond diagrams (target: August 2027)

- **Application #3: bpmn-js** (M–L): BPMN process models; the app enforces its own modelling rules, so
  the mirror's "real app disagrees" becomes meaningful; BPMN 2.0 XML as a standard export; the bpmn.io
  watermark stays visible. A measurable gap exists: the vendor's own copilot officially supports
  editing only diagrams it created itself.
- **Graph domain package** (M): shared semantics, checker replay, board and generator for graph-like
  apps (Excalidraw, draw.io, bpmn-js, later Node-RED), decided by a PADR on the action-vocabulary
  architecture (hand-coded per domain vs a declarative effect language interpreted twice).
- **MCP server as the app, pilot** (S–M): the MCP reference `memory` server (a knowledge graph in a
  JSONL file) whose semantics the core can predict exactly, so every invariant holds; a PADR for
  "observed transitions" (filesystem, SQLite, git) only after the pilot.
  *Acceptance:* oracle 100 %, random about 0 %, challenge gate passes on bpmn-js; reports, `compare`,
  card and badge work unchanged across the three apps.

## 0.6.0 — Practice that transfers (target: October 2027)

- **Skill A/B** (M): `bench --arm none --arm skill:<dir> --arm placebo` on identical held-out
  variants with paired statistics.
- **Learning from verified runs** (M, opt-in, agent side): distil a skill only from checker-judged
  runs, successes and failures, never from reference solutions; measure the effect on generated
  tasks the agent has not seen.
- **Environment API** (M–L): OpenEnv-style `reset`/`step`/`state` with partial reward from met
  conditions over the deterministic model-only mode; a throughput number.
  *Acceptance:* one documented effect whose 95 % interval excludes zero — or a published negative result.
- **Application #4: spreadsheets (Univer)** (L), if the identity spike passed.

## 0.7.0 — Other hands (target: early 2028)

- **GUI mode** (L–XL): a computer-use agent operates the real Excalidraw through the existing editor
  path (unrecognised gestures stay `unmodeled`); same tasks, same checker; one report compares
  Practonaut actions, MCP tools and GUI on identical tasks.
- **Application #5:** Git through the observed-transitions contract, or documents (BlockNote), chosen
  by the outcome of the 0.5.0 pilot. WebMCP-based adapters only once WebMCP ships in a stable browser
  or a target app registers tools.

## 1.0 — Stable platform (target: 2028)

Frozen formats (world, bench report, task pack) with a migration tool and a compatibility policy;
at least three applications; at least 200 tasks including community packs; a static, pull-request
based results page that accepts only sealed, re-verified submissions; manual screen-reader and
200 % zoom checks done; a maintainer and contributor ladder.

## Checkpoints

| Date | Who | What is decided |
|---|---|---|
| 2026-12-31 | maintainer | North Star ≥ 3 external projects? Challenge gate passed? |
| 2027-01-15 | maintainer | continue 0.3.0 as planned or narrow the positioning (see 0.3.0) |
| 2027-03-31 | maintainer | North Star ≥ 10; which bridge brought users; is draw.io in use (issues, task packs)? |
| 2027-07-15 | maintainer | which domain next (bpmn-js, spreadsheets); North Star trend |
| 2027-09-30 | maintainer | North Star ≥ 50; plan for 1.0 |

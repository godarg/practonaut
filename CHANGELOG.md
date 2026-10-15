# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Bench your own tasks.** `practonaut bench --world <dir|.pnworld> [--oracle <file>]` scores any
  MCP agent on a world of your own, for example one made with `tasks from-scenes`, with its
  `oracle.json` as the reference once the checker accepts it; `--seed-list 2,5` and `--label` as well.
- **Report `practonaut.bench/2`** ([PADR-0036](docs/adr/0036-bench-report-v2-any-world-stored-world.md)):
  the world is stored in the bench folder and `report --verify` re-judges against it (named codes
  `bench_world_changed`, `bench_artifact_changed`, `bench_reference_invalid`); every agent has an
  isolation level; efficiency only with a validated reference; `apiKeySource`, `--keep-env` names and
  a command template's model are recorded. `/1` reports are still read and verified as before.
- World/2 tasks may carry `generatedBy` (generator id, version, seed, parameters) for generated instances.
- **Results you can act on** ([PADR-0039](docs/adr/0039-results-you-can-act-on-evidence-report-compare.md)).
  Each run folder keeps the bridge's call log (with the bench client's round trip for `oracle` and
  `random`), the runner's log of every act, undo and reset, the checker's trace of the goal conditions
  after every accepted mutation, and with the mirror the real Excalidraw's SVG of the final board;
  tokens, turns and cost come from the client's own output, labelled self-reported. `report --verify`
  checks and re-derives them. Report pages and the terminal show the fraction with a 95 % Wilson
  interval (no rate finer than 1/n), failures first with why each failed (unmet conditions with the
  action after which they were last lost, error classes, states by name), the trajectory, the final
  board beside an example target, and the call log.
- **`practonaut compare a.json b.json [--html] [--fail-on-regression] [--verify]`**: refuses
  incomparable reports by name, aggregates repeats per instance, names instance regressions and gives
  an exact McNemar verdict ("not distinguishable at this n" when the sample cannot tell).
- `practonaut validate` and `pack` print the world's content hash, the one a bench report names.
- **Task limits** ([PADR-0040](docs/adr/0040-challenge-tier-generated-families-and-gate.md)): a world/2
  task may limit an attempt's accepted changes (`limits.actions`, undo and reset included) and checks
  (`limits.checks`); the host enforces them for the Player and agents alike
  (`action_budget_exhausted`, `check_budget_exhausted`), and the Player, `observe`, every mutation
  reply and `check_result` show what is used. `--checks <n>` on `play`/`serve`, `mcp --task` and
  `bench` sets a check limit (it can only lower a task's own). A new variant of the same task counts
  like a reset. While a check limit applies, error explanations come only with a check. `report
  --verify` counts a run's accepted changes and checks from the runner's host-side log (which now
  records every `check_result`) and refuses a run beyond its task's limits.
- **Minimal length.** Where a bounded search is small, `bench` proves that a reference is a minimal
  solution; the report then shows "efficiency vs minimal length", otherwise "vs reference length",
  and `report --verify` recomputes the proof.
- **Challenge tier candidates** (maintainer tooling, not yet published): seeded generators for five
  families — repair, prompt injection in board content, long horizon with look-alike labels, limited
  checks, tight action budget — that materialise checked world/2 instances with oracle sidecars
  (`node tools/challenge.ts generate|verify`), and the preregistered ladder gate: a round
  declaration committed and pushed before the held-out set exists, whose development runs fix the
  held-out seeds and whose gate pair is Opus vs Haiku (`declare`), a preflight of everything but the
  ladder, and `gate`, which regenerates the held-out set, merges resumed benches, counts every model
  run in the bench folders, writes a spend ledger and reports Wilson intervals and an exact McNemar
  test.
- **Bench infrastructure errors.** A run whose client reports a usage or rate limit or an API error,
  or whose agent ends without completing and without a tool call, is `infra_error` and not judged;
  `--stop-on-infra` stops the bench there with a partial report naming the tasks to resume (exit 75).
  Model ids may carry a bracketed suffix (`[1m]`); Claude Code's version is recorded per run, and
  `report --verify` checks each run's model against the agent's own output.

### Changed

- `report` prints fractions instead of `pass@1 0.50` and "(50.0 %)"; `--runs <bench folder>` also
  works without `--verify` (it names where the run details come from).

- **The `claude-code` preset no longer passes provider keys.** `bench` withholds provider keys,
  tokens and billing switches in your environment from the preset agent (`*_API_KEY`,
  `*_AUTH_TOKEN`, `CLAUDE_CODE_USE_*`, gateway, profile and federation credentials,
  `ANTHROPIC_CUSTOM_HEADERS`), so Claude Code uses the login it has; a set `ANTHROPIC_API_KEY` used
  to switch it to API billing without notice. `bench` names what it withheld; `--keep-env <name,…>`
  passes named variables on
  ([PADR-0034](docs/adr/0034-preset-agents-get-no-provider-credentials.md)).
- `main` carries the development version `0.2.0-dev.0`; the checker accepts its sessions, and
  [docs/release.md](docs/release.md) lists every place a version bump touches.

- **Lean agent surface** ([PADR-0038](docs/adr/0038-lean-mcp-replies.md)). `observe` is compact by
  default (task with goal conditions, live objects, step, revision, recent history, last check) and
  takes `detail`, `lang` and `history`; `act`, `undo` and `reset` answer with what changed instead
  of the whole view; one language unless asked for both; every result also as `structuredContent`;
  refused inputs name the path and what it expects; `stale_base` names the current step and
  revision; tool annotations; the task as resource `practonaut://task` and a `practise` prompt;
  `practonaut mcp --call-log`. Bench agents no longer see reference lengths. Measured against 0.1.0
  on `excalidraw/connect`: an `act` result 866 bytes instead of up to 63 KB, client round trip
  10.4 ms instead of 133.7 ms (33.6 ms instead of 150.0 ms with the mirror); oracle episodes on the
  six hardest tasks −79 % result bytes. Scripts that read `value.view` from a mutation reply must
  use the delta or `observe` with `detail: "full", lang: "both"`. The `random` baseline now draws
  ids from the live objects of the compact view only (0.1.0 also drew deleted ones), so its floor
  can differ slightly from 0.1.0 reports.
- **Faster transactions** ([PADR-0037](docs/adr/0037-fork-the-committed-session-for-candidates.md)):
  a candidate forks the committed session instead of being rebuilt from the log, and the world is
  validated once and frozen; the replay checks before every result check and publication stay.

### Internal

- `tools/measure-agent-surface.ts`: the versioned measurement tool for the agent surface (client
  round trip, full result bytes, oracle episodes) against a published version or the local build.
- Dependabot updates `playwright` and `playwright-core` together; CI also runs on Node 24 and 26
  (separate, non-required job).

### Documentation

- Vision, roadmap to 1.0 and the product direction
  ([docs/vision.md](docs/vision.md), [docs/roadmap.md](docs/roadmap.md),
  [PADR-0033](docs/adr/0033-product-direction-measurement-you-can-act-on.md)), with a research note
  and the measured baseline of 0.1.0 ([docs/research/landscape-2026-10.md](docs/research/landscape-2026-10.md)).
- README scope: "no network calls" is about Practonaut's own process; agents get the same task and
  goal conditions as a person and act through semantic actions, not the GUI.
- [PADR-0035](docs/adr/0035-no-design-capture-or-invariants-until-needed.md): `design:capture` and
  `design:invariants`, named in PADR-0020, are not built until a review needs them.

## [0.1.0] - 2026-10-13

First public version: a local practice gym for AI agents on real apps. The date is set when the
version is tagged ([docs/release.md](docs/release.md)).

### Added

- **Practice in the browser.** `npx practonaut` starts a local session on `127.0.0.1` and opens it
  in your default browser (macOS, Linux, Windows; on Linux the launcher lives under
  `$XDG_RUNTIME_DIR`, and the one-use link is always printed as well). Keyboard and pointer input,
  hints, undo/reset, seeded variants, English and German, light and dark. The history names who
  made each change: *You*, or *Agent · <client>* for an MCP agent (the client's declared name).
- **Real application in the loop.** Every action is applied to a pinned Excalidraw 0.18.1 engine
  running headless and read back before it counts. `practonaut setup` downloads Chromium once
  (naming the folder and size); without it sessions run model-only and say so
  (`--mirror auto|required|off`). Chromium starts with its sandbox; where Linux refuses only the
  sandbox (Ubuntu 23.10 and later restrict unprivileged user namespaces with AppArmor) it starts
  once without it and the session and `doctor` say so; `PRACTONAUT_CHROMIUM_SANDBOX=require`
  refuses that instead. An installed Chromium that still does not start (missing libraries, a
  damaged download) is reported with its reason: `auto` runs model-only, `required` fails as
  `browser_start_failed`, and `doctor` checks the start
  ([PADR-0032](docs/adr/0032-chromium-sandbox-stays-on.md)).
- **Task library** (world `excalidraw-library` 1.1.0). 16 Excalidraw tasks
  (`practonaut tasks list`), from one-action edits to multi-action restructuring, each with three
  label variants, a reference solution and near misses. Every requirement in a task's text has a
  goal condition.
- **Tasks from two drawings.** `practonaut tasks from-scenes start.excalidraw goal.excalidraw` turns
  the difference into a goal and only writes the task when the goal passes, the start fails, the
  reference solution passes and the near misses fail. It runs in a bounded worker with named
  limits, never writes through links and refuses an `--out` that is a file. Also in the Player
  under Create.
- **Tasks from a demonstration.** Record a change in the embedded editor, confirm it with a second
  recording, set goal, variants and examples, and compile a checked exercise (one bounded repair
  workflow).
- **Any MCP agent.** `practonaut mcp --task <task>` starts its own session and serves seven tools
  over stdio (`observe`, `list_actions`, `act`, `undo`, `reset`, `explain_result`,
  `check_result`); `--host`/`--token-file` attaches to a session a person is using. Listed in the
  official MCP Registry as `io.github.godarg/practonaut` (`server.json`, checked offline against
  the pinned registry schema). Human and agent
  share one state and history. The public goal conditions (sentence and formal form) reach agents
  exactly as the Player shows them; reference solutions and near misses do not.
- **Bench.** `practonaut bench` runs agents on library tasks across seeds and repeats, each run in
  a fresh session with the agent's data folder apart from the judged artifacts, scored only by the
  host's history and a separate checker: pass@1 (unjudged runs count as not passed), pass^k,
  actions, efficiency against the reference. Built-in `oracle` and `random` baselines, a
  `claude-code` preset limited to Practonaut's tools, and command templates for any other agent
  (on Windows, `.cmd` agents start through `cmd.exe`). Ctrl+C ends the agent's process group,
  closes its session and writes a partial report (exit 130); a second Ctrl+C stops at once.
- **Reports.** `practonaut.bench/1` JSON with a schema. `practonaut report` checks a report's
  consistency (forged numbers are refused) and says so; `report --verify` re-judges every run from
  its artifacts and re-derives its actions, reference length and the library's content hash.
  Tables and a static HTML page, with report text shown control- and bidi-safe.
- **World format** `practonaut.world/1` and `/2`: data-only packages, bounded predicates, hostile
  package checks with named rejection codes; `validate`, `pack`, `run`, `check` commands. A
  malformed request target gets 400 on the session and editor ports.

### Fixed before publication (platform fixes from the first public CI run)

- **Linux:** the real mirror did not start on Ubuntu 24.04 (Chromium sandbox under AppArmor); see
  the sandbox fallback above. A root-owned sticky shared directory such as `/tmp` is accepted as an
  ancestor of a pinned agent executable (no other user can swap entries below it).
- **Windows:** text files are checked out with LF (`.gitattributes`), so schema, library and hash
  checks compare the committed bytes. Running from a source checkout found the engine bundle only
  with `/` paths, so the mirror never started. Mirror diagnostics now rotate (an append-only handle
  cannot be truncated there). A session credential is written only when its file name is the
  regular file just created (Windows has no `O_NOFOLLOW`). `tasks from-scenes` names a file on the
  `--out` path as such, and a path in the home directory is shown from `~` also when the working
  directory is on another drive.
- **All platforms:** every option that takes a value also accepts `--option=value` (the form MCP
  registries render); an empty value is refused.
- CI runs the unit, integration, MCP and pack layers on Ubuntu, macOS and Windows and the browser
  layers on Ubuntu; one Linux step lifts the AppArmor restriction and checks the sandboxed start.

### Limits

- Excalidraw 0.18.1 is the only application.
- Agents act through Practonaut's semantic actions, not by operating the GUI with pixels.
- Agents run as your OS user; an agent with its own file or shell tools could read reference
  solutions on disk. Bench scores of such agents are not sealed results.
- The example bench report is one seed with two repeats per task; it shows the format, not a model ranking.
- Whether practising improves a person's skill in the real tool has not been studied. Manual
  screen-reader and 200 % zoom checks have not been done.
- CI covers Ubuntu, macOS and Windows; by hand, only macOS has been used.
- On Windows, private files rely on the user profile's ACL (no POSIX modes); supervised client
  evaluation in the repository tooling (`tools/agent-runs.ts`) is POSIX-only and refuses Windows.

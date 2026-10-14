# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **The `claude-code` preset no longer passes provider keys.** `bench` withholds provider keys,
  tokens and billing switches in your environment from the preset agent (`*_API_KEY`,
  `*_AUTH_TOKEN`, `CLAUDE_CODE_USE_*`, gateway, profile and federation credentials,
  `ANTHROPIC_CUSTOM_HEADERS`), so Claude Code uses the login it has; a set `ANTHROPIC_API_KEY` used
  to switch it to API billing without notice. `bench` names what it withheld; `--keep-env <name,…>`
  passes named variables on
  ([PADR-0034](docs/adr/0034-preset-agents-get-no-provider-credentials.md)).
- `main` carries the development version `0.2.0-dev.0`; the checker accepts its sessions, and
  [docs/release.md](docs/release.md) lists every place a version bump touches.

### Internal

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

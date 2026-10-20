# Changelog

All notable changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Bench report `practonaut.bench/3` ([PADR-0044](docs/adr/0044-bench-report-v3.md), issue #46; schema
  `schemas/bench.v3.json`): `bench` writes it at the session verdict level. It names the verdict level
  (on every run, and on the header line, card, badge, JUnit properties and compare page), the
  application (`environment.app`, replacing `environment.excalidraw`) and the toolchain with the tool
  names Practonaut's bridge advertised; a task identity per instance; the agent's vendor, client,
  client version, requested model, settings and requested billing class, each with its evidence
  source; per external run the SHA-256 of its whole `agent.stdout`, the versioned parser that read it
  (`claude-code-stream/1`), the tools its client offered and the billing class its own output attests;
  a structured `failure` for every run that was not judged (reason, parser, the client's own code,
  whether it came before model work); and the agent's own action count. A preset is "tool-restricted"
  only from its runs' evidence of the tools its client offered. The validator also holds the
  artifact-judged level that artifact mode will write.
- `report --verify` re-verifies /3 reports: the application adapter and every task identity against
  the stored world, every stdout against its hash (and no readable stdout behind an unbound run), and
  every value the shipped parser reads from it — the client block, isolation, the failure of any run,
  and the agent's model, `apiKeySource`, client version, vendor, client, and for its own version the
  requested billing and settings. A report of this or an older Practonaut that names a parser this one
  does not ship is refused; a newer one's values are shown as the report's claims on every surface and
  are never taken by the challenge gate, which exempts a /3 run from the budget only by a failure its
  shipped parser re-derives. An application adapter id can no longer name a path.
- `compare` refuses reports of different verdict levels by name, and different `--checks`; it pairs
  the same tasks benched on two applications or toolchains by task identity (the distinct identity is
  the unit, rate claims only at equal run counts, no regression labels; `--fail-on-regression`
  refuses such a pair), and names more caveats (report format, isolation basis, toolchain, client
  version and settings, shared identities).
- World/2 may name its task set (`taskSet: { id, version }`): variant selection then hashes the task
  set's id and version instead of the world's own, so two worlds of one task set select the same cases
  for the same seeds. Worlds without it are unchanged.
- **Adapter registry** (PADR-0045, proposed; roadmap 0.3.0 Must 1): adapters are chosen by the
  world's `app.adapterId` through `src/adapters/registry.ts` (app versions, world schemas, runtime
  kind `bundled` or `downloaded`, read-back comparison, factory); only Excalidraw 0.18.1 is
  registered. The live mirror, `practonaut run`, `play`, `serve` and `mcp --task` resolve their
  adapter there; the checker reads exports through its own format table. A unit test keeps the
  world's table of known apps, the registry and the checker's format table equal.
- **Shared browser shell** (`src/adapters/browser/`): the one Chromium start (moved from the
  Excalidraw folder), a launch deadline the shell enforces itself (a browser that arrives late is
  closed) that also bounds the routing setup, and a deadline for the app's own start; a network
  boundary that also closes every WebSocket, puts a content security policy on every served
  response (so shared workers, frames and workers reach no other host), starts Chromium without
  WebRTC UDP, without host resolution and behind a sink proxy on 127.0.0.1 that refuses every
  connection the browser opens itself (TURN over TCP, preconnects) and reads and records nothing, so
  another local process gains nothing by connecting — measured against the real Chromium —;
  operations with one deadline that covers reading the committed scene, that end on timeout or abort
  so none of their later calls into the shell is answered, and whose undo and rollback are bounded
  too (a rollback that fails closes the shell, and the host's mirror starts a new one); PNG
  capture and artifact hashes. The Excalidraw adapter keeps read, write, projection, integrity and
  SVG.
- **The 0.3.0 gate tool** ([PADR-0042](docs/adr/0042-gate-for-families-on-toolchains.md), accepted
  with an amendment; roadmap 0.3.0 P1, issue #44): `node tools/challenge.ts` gates units
  (`<family>.<toolchain>`) in shape B — a probe plan committed and pushed before the first pre-probe
  run, Opus's 7-instance pre-probe (1–5 passes admit) and its committed record, the round declaration
  `practonaut.challenge-declaration/2` (ladder with preset, requested model, attestation and billing;
  funding that keeps 40 runs; held-out seeds from the unit and the pre-probe digest `/2`), the held-out
  set, the preflight, and the gate report `/2` in Markdown and JSON, with a second round at α = 0.025
  on new instances (0.075 over both rounds, as the report says). It reads `practonaut.bench/3`
  session-level reports only; a run counts as attested only from values a shipped parser re-derived
  from its bound stdout, and a run is exempt from a budget only by its re-derived structure. Every run
  on a round's instances, under any purpose, plan or declaration, counts for the round and is in one
  repeat check; a round is not declared again once its held-out runs started; a judged run whose
  run-end record is lost is void and is not benched again; a non-run of the weakest agent counts as
  its pass for discrimination; funding is read from the ledger and re-derived by the gate. Shape A,
  any preset but `claude-code` as a ladder agent, a local agent, too small or too large rounds and
  units outside the preregistration (approved only by name) are refused by name.
- **The release ledger and its start guard**: every model run the project makes takes a start entry in
  an append-only, hash-chained ledger before its client starts, and a run-end record with its hashes
  when it ends; a start that would pass 800 model runs is refused before the client starts
  (`release_budget_exhausted`; the cap is the release's, never the file's). One local ledger per
  repository, in its git common directory, is shared with one lock by every worktree; `ledger init`
  refuses while model-run folders exist outside it. Benches reach it through `node tools/challenge.ts
  bench --purpose … -- <bench arguments>`; the committed copy
  (`docs/benchmarks/challenge/0.3.0/release-ledger.jsonl`) is written from it, every committed version
  on HEAD and on every remote-tracking branch must be a prefix of the current one, and `probe`,
  `declare` and `gate` read a run only once both its records are pushed and refuse a round whose
  instances were run outside the ledger. 0.3.0 counts from zero: the 0.2.0 rounds stay readable and
  are never counted.

### Changed

- The 0.2.0 challenge gate's `declare` and `gate` are replaced by the 0.3.0 ones; the 0.2.0
  declarations (`/1`) and round ledgers are only read. The bench runner takes an optional start guard
  (`practonaut bench` itself is unchanged), and `report --verify` of a /3 report also names the runs
  whose client values it re-derived.
- Plan for 0.3.0 "Two apps, your tools": the five 0.2.0 candidate families get no second round on
  Practonaut's own actions (zero-family branch, the bundled tasks are a library, not a challenge
  tier); headroom is sought per family and toolchain and in new family types, each behind a
  pre-probe; vendor-neutral presets move from 0.4.0 into 0.3.0; the first North Star checkpoint moves
  to six weeks after the 0.3.0 launch (PADR-0041; PADR-0042 and PADR-0043 proposed).
- A world naming an application this Practonaut does not have is refused by name before anything
  starts: `E_ADAPTER_UNKNOWN`, `E_ADAPTER_VERSION_UNSUPPORTED` (known adapter, other app version)
  and `E_ADAPTER_SCHEMA_UNSUPPORTED` (adapter that does not run this world schema), at `validate`,
  `pack`, every world load (`mcp --task` included, exit 2 instead of "could not start") and in the
  checker process — instead of `E_WORLD_INVALID` with a schema message
  ([world format](docs/world-format.md) §1.4, which now also lists the world-content codes).
  The world JSON Schemas list the allowed app values; world/2's omitted `provenance.appVersion` is
  the world's `app.versionRange`.
- The host compares a mirror's read-back the way its adapter declares: the whole state with
  tombstones (Excalidraw, unchanged) or live objects only for an app that keeps no deleted objects.
- The checker request's `format` option accepts `session` or the world adapter's native format id
  (today `excalidraw`, as before); another app's format is refused.
- Proposed decision record for the spatial-layout family (PADR-0047): six bounded layout operators
  (no overlap, aligned, evenly spaced, inside a named canvas, arrows that do not cross, arrows clear of
  steps) judged on step boxes and on straight lines between step centres, with a cost bound per
  clause, EN/DE narration, the judged geometry drawn in the Player and the report, and the outline of
  the `challenge-layout` generator. No behaviour changes yet.
- Migration from `/2` to `/3`: nothing to convert. `report`, `--verify`, `compare`, `--junit`,
  `--card` and `--badge` read `/1`, `/2` and `/3` through one read-only view that keeps every `/2`
  field (tested leaf by leaf on the committed reports) and says what an older report did not record;
  `/1` and `/2` keep their schemas and rules unchanged ([benchmarks](docs/benchmarks/README.md) §5).
  `bench --recover` writes `/3` and refuses a folder an earlier Practonaut wrote. The 0.2.0 challenge
  gate reads `/2` and session-level `/3` reports.
- A browser that runs out of time says which operation and which bound: "Browser close exceeded its
  deadline of 8000 ms" instead of "Browser operation exceeded its deadline" (launch, setup, start,
  rollback, close, settlement; issue #64, where the Windows failures were the 8 s close of the real
  browser in the host deadline tests' cleanup). A close no longer fails this way: it is abandoned at its deadline (Fixed, below). For developers:
  `npm run amplify:host-deadline` repeats those two tests under load and times every browser close,
  and the manual `host-deadline-repeat` workflow runs it on each CI platform
  ([testing](docs/testing.md#host-deadline-tests)).

### Fixed

- A browser that closes slowly no longer fails work that succeeded (issue #64,
  [PADR-0050](docs/adr/0050-browser-close-is-a-bounded-request.md)). Every browser Practonaut starts
  — the mirror's, the start check's, the render check's, the report card's — closes through one
  contract: the caller's deadline (8 s by default) goes down, the outcome comes up as closed, failed
  or abandoned, and an abandoned close no longer fails the call (a test's cleanup, a host's close,
  `run`, a render check, a report card); Playwright itself ends a browser that has not closed 30 s
  after the request. A mirror recovery whose old browser closes slowly goes on to its replacement,
  and a session closed during a recovery stops the replacement's start instead of waiting for it;
  an author host's close also stops a practice host it is still starting, and reports a failure
  when that start's cleanup did not close (a credential it could not remove).
  Measured with the amplifier on macOS (60 attempts of the two host deadline tests per row, main
  with the previous fix against this change): with every close held 8.5 s, 60 of 60 failed before
  and 0 of 60 after, every close abandoned at its deadline and its end proven 0.5 s later; under
  load (`--cpu 20 --block 20`, 6 and 16 load workers) 0 of 60 failed before and after in each, and
  no close reached the deadline in either, so those runs do not test the cause. On CI before this
  change, 300 attempts per platform: 0 failed on Ubuntu and macOS, 3 on Windows, all at the close
  (slowest close 12.3 s); the CI after-run is still to come. Browsers launched and not yet proven
  closed are bounded per process (8; the budget's scenario peaked at 2.1–2.4 GiB of resident size
  summed over 8 browser trees on macOS); a start that finds no slot waits within its 15 s launch
  bound and is then refused as `browser_budget_exhausted` (exit 3 under `--mirror required` and
  `run`, model-only with a notice under `--mirror auto`, HTTP 503 for a practice host started from
  the author page, counted after a bench's table). A browser's sink proxy keeps its port until that
  browser's end is proven. A command reports later close outcomes on stderr (English or German),
  says when it waits for a browser to close, and exits 35 s after the latest close request if a
  browser's end is still not proven; Ctrl+C during that wait still lets Playwright end the browser
  and remove its directories. For developers: `npm run measure:browser-budget`, and the amplifier
  counts each close's outcome ([testing](docs/testing.md#browser-close-contract)).
- A browser close after a failure no longer replaces that failure (issue #64). When a session or
  host fails to start (admission, author store, listener, editor listener), a mirror recovery fails,
  an author practice host's reply is over budget, `practonaut run` or a native transfer export fails,
  or a render check or report card fails, the close that follows runs under the close contract
  (deadline 8 s, below) and the caller gets the original failure, with a close that did not close kept
  next to it as `closeError`. A failed host start tries every cleanup step on its own (the listener,
  ending its connections and event streams first; the author store; the session; the diagnostics;
  the credential), and a mirror waits no longer than the close's deadline for an old adapter, in a
  recovery too. Before, a close or cleanup step that failed replaced the failure (a native transfer
  export reported "Browser close exceeded its deadline" instead of its own error; a diagnostics file
  already gone made a failed start report `ENOENT` and keep its credential), and a close that never
  finished held these paths forever: a failed host start never removed its credential, an open event
  stream held a failed editor start for good, and an interrupted mirror recovery kept the session's
  write lock.

- The native file transfer's Open (`nativeFileTransfer`, the integration test "H1 native file", issue
  #45) sent its shortcut in the same tick as Playwright's `filechooser` listener. On macOS with the
  renderer throttled 20x, 28 of 30 Opens lost their file dialog before the change and 0 of 30 after;
  the 20 CI runs per platform are still to come. The measurements are consistent with the key being
  handled before Chromium's file-chooser interception took effect. Open now arms the waiter, clicks
  the editor, completes one page round trip that also checks keyboard focus is inside the editor
  (refused by name otherwise), then sends the shortcut, never after the wait has ended or the limit
  has passed. The whole Open shares one limit of at most 10 s from arming, checked by timer and by
  clock (before: 10 s for the click and 10 s for the shortcut and dialog). An attempt keeps a best-effort screenshot from before Open and the page
  console in its evidence; CI uploads that evidence on failure on every platform;
  `.github/workflows/native-open-repeat.yml` repeats the test by hand and fails unless it ran and
  passed; `npm run clean` removes `.local/native-transfer/` ([testing](docs/testing.md#native-open-ordering)).
- A bench host refused only a change to another task: a variant request without a task id (a new
  seed) or naming the run's own task (a restart outside the counted resets) was accepted, and the
  bench neither counted nor recorded it. The session token is in a file that the agent's own MCP
  config names, so an agent with a shell, running as the same OS user, could switch the run's
  variant over HTTP; the judged session's seed then no longer matched the run's. Measured with a
  stand-in command-template agent that reads the token file: before, both requests were answered
  200 and the run ended `infra_error` (the checker rejected the session); after, both are refused
  with `invalid_request` (400) and the run is judged at its own seed. A hint request was accepted the
  same way, also with the action budget used up: it opened a hint and raised the revision, and
  neither the counters, the mutation log nor the stored session showed it; it is now refused too.
  A sweep of every route the session token opens on a bench host found no other such path: the
  reads, the tool image and the export change nothing, act, undo, reset and check are counted and
  logged, and the demonstration and editor routes do not exist there. A single-task host now refuses
  every variant and hint request; `practonaut`, `play`, `serve` and `mcp --task` keep every task,
  variant and hint ([session host](docs/session-host.md), [benchmarks](docs/benchmarks/README.md) §4).

## [0.2.0] - 2026-10-16

"Real signal" ([roadmap](docs/roadmap.md#020--real-signal-target-december-2026)): bench your own
tasks, results you can act on, a lean agent surface, the first 60 seconds, and a challenge tier whose
families are published only after a preregistered ladder gate. Measured for this release:

- Agent surface against 0.1.0 on `excalidraw/connect` (same machine, same day): an `act` result
  866 bytes instead of up to 63 KB, client round trip 10.4 ms instead of 133.7 ms (33.6 ms instead
  of 150.0 ms with the real mirror); oracle episodes on the six hardest tasks −79 % result bytes; no
  paired regression on the 0.1.0 grid (24/24 with Opus and Haiku on both versions).
- From `npx practonaut` to the first demonstrated action: 2.1 s model-only, 2.5 s with the real
  engine (median of 3, warm npx cache, Apple M4).
- Challenge tier, ladder round 1 under the preregistered gate (Claude Opus, Sonnet and Haiku, 26
  held-out instances per family, real mirror): none of the five candidate families passes. Every
  round is valid (oracle 26/26, random 0/26, no infrastructure error), but Opus and Sonnet solve every
  instance and Haiku all but two (24/26 on tight-budget), so there is no headroom; the families stay
  unpublished ([overview](docs/benchmarks/challenge/README.md)).
- Model runs for the whole release: 470 of the 500 budgeted, all through a Claude
  subscription (`apiKeySource: none`), 70.22 USD at list price as reported by the client.

### Added

- **Bench your own tasks.** `practonaut bench --world <dir|.pnworld> [--oracle <file>]` scores any
  MCP agent on a world of your own, for example one made with `tasks from-scenes`, with its
  `oracle.json` as the reference once the checker accepts it; `--label`, and `--seed-list` for a world
  with several variants.
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
  checks and re-derives them; evidence that cannot be written never changes a verdict. Report pages and
  the terminal show the fraction with a 95 % Wilson interval (no rate finer than 1/n; every run counts,
  a run that was not judged as not passed), failures first and open with why each failed (unmet
  conditions with the action after which they were last lost, error classes, states by name), the
  trajectory, the final board above an example target at one scale (never below 12 px text; Excalidraw's
  own dark-mode colours in dark mode), and the call log; codes, hashes and the command sit under
  "Technical details".
- **`practonaut compare a.json b.json [--html] [--fail-on-regression] [--verify]`**: refuses
  incomparable reports by name (with `--html`, on a page), aggregates all repeats per instance, names
  instance regressions and gives an exact McNemar verdict ("rate difference not distinguishable at this
  n" when the sample cannot tell). `--fail-on-regression` also fails on an incomplete candidate
  (`compare_incomplete`: an instance missing, cut short or with a run that was not judged).
- **First 60 seconds.** When the real engine is not installed, `npx practonaut` opens the Player at
  once, model-only, with a banner "Not yet checked against the real Excalidraw" that names the one
  download, the Chromium headless shell, with its size. With the engine installed, the existing
  start check of Chromium runs first ([PADR-0032](docs/adr/0032-chromium-sandbox-stays-on.md)).
  From the command to the first demonstrated action: 2.1 s model-only, 2.5 s with the real engine
  (median of 3 at commit df84e38 on an Apple M4: `npx --package <packed tarball>` with a warm npx
  cache and npm offline, so no registry lookup; the click is automated, so no human reaction time;
  the result is kept locally under `.local/measure-first-action/`). On the bundled
  example **Watch a demonstration** solves the current task
  once: actions land on the board, the real Excalidraw confirms each one (or the session says
  "model only"), and the result check judges the end. It is labelled as a demonstration, never
  counts as anyone's result (its board cannot be continued or exported), and Stop or Escape ends
  it. Never on a library or bench task. Measured with `tools/measure-first-action.ts`.
- **CI recipe.** [`examples/ci/practonaut-bench.yml`](examples/ci/practonaut-bench.yml) benches your
  agent on your own world in GitHub Actions (exact versions, actions pinned by commit SHA, your own
  credentials from a repository secret), compares with a committed baseline and fails the job on an
  instance regression or an incomplete candidate; JUnit XML and the HTML pages are uploaded.
  `bench --junit <file>` and `report --junit <file>` write JUnit XML: one test case per run, a run that
  did not pass as a failure naming its unmet conditions and error classes, a run without a verdict as an
  error. `bench --fail-on-agent-error` exits 2 (`agent_failed`) when an agent failed or could not start,
  so a missing login stops the job instead of reading as regressions; for a pull request the recipe takes
  the baseline from the base commit and skips forks. A manual workflow (`.github/workflows/ci-recipe-check.yml`) proves the recipe with the oracle
  agent and a planted instance regression.
- **Result card and badge.** `practonaut report <report.json> --card <out>` writes a 1280 × 640 card as
  SVG and PNG, light and dark (the PNG drawn by the local Chromium); `--badge <out.svg>` a one-line badge.
  Both carry the fraction with its 95 % Wilson interval, n, the verification status (a consistency-checked
  report says so), the isolation level, the mirror and runs without a verdict; every caveat is SVG text,
  colours come from the design tokens, and the same report gives the same bytes.
- `practonaut validate` and `pack` print the world's content hash, the one a bench report names.
- The MCP bridge names the agent's client on `undo` and `reset` too (the host accepts an optional
  `actor` on both), so the bench's mutation log names the client of every change.
- **Task limits** ([PADR-0040](docs/adr/0040-challenge-tier-generated-families-and-gate.md)): a world/2
  task may limit an attempt's accepted changes (`limits.actions`, undo and reset included) and checks
  (`limits.checks`); the host enforces them for the Player and agents alike
  (`action_budget_exhausted`, `check_budget_exhausted`), and the Player, `observe`, every mutation
  reply and `check_result` show what is used. `--checks <n>` on `play`/`serve`, `mcp --task` and
  `bench` sets a check limit (it can only lower a task's own). A new variant of the same task counts
  like a reset. While a check limit applies, error explanations come only with a check. `report
  --verify` counts a run's accepted changes and checks from the runner's host-side log (which now
  records every `check_result`) and refuses a run beyond its task's limits. A `practonaut.bench/2`
  report made by an earlier 0.2.0 development build, whose mutation log has no `check_result`
  records, no longer passes the consistency check: bench again (bench/2 is unreleased).
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
  `bench … --recover <bench folder>` rebuilds the report of a bench killed before writing one
  (kill -9, power loss, a second Ctrl+C) from its run folders, re-verified as `report --verify` does.
  Model ids may carry a bracketed suffix (`[1m]`); Claude Code's version is recorded per run, and
  `report --verify` checks each run's model against the agent's own output.
- `bench` prints a notice (`seeds_share_variant`, EN/DE) when planned seeds pick the same variant of
  the benched tasks, naming the tasks and their variant count: such seeds bench the same board, while
  each still counts as an instance of its own. A world from `tasks from-scenes` has one variant; the
  docs and the CI recipe now bench it with one seed and `--repeats`.

### Changed

- `compare` refusing two reports of different isolation levels says that the level follows from the
  agent kind (oracle and random compare only with a built-in, the preset with itself, a command
  template with a command template) and to bench a trusted configuration of the candidate's kind as the
  baseline, in the terminal (EN/DE) and on the `--html` page; other refusals keep "bench the baseline
  again with the candidate's settings".
- `report` prints fractions instead of `pass@1 0.50` and "(50.0 %)"; `--runs <bench folder>` also
  works without `--verify` (it names where the run details come from).
- **`practonaut setup` downloads only the Chromium headless shell** the mirror runs (about 105 MB on
  Apple silicon Macs, 111 MB on Intel Macs, 126 to 128 MB on Linux and Windows, instead of the full
  browser as well) and names it with its size before anything is fetched; `doctor` counts a cache
  with only the headless shell as installed. After a Playwright update,
  `node tools/measure-headless-shell.ts --write` measures the sizes again.
- **The `claude-code` preset no longer passes provider keys.** `bench` withholds provider keys,
  tokens and billing switches in your environment from the preset agent (`*_API_KEY`,
  `*_AUTH_TOKEN`, `CLAUDE_CODE_USE_*`, gateway, profile and federation credentials,
  `ANTHROPIC_CUSTOM_HEADERS`), so Claude Code uses the login it has; a set `ANTHROPIC_API_KEY` used
  to switch it to API billing without notice. `bench` names what it withheld; `--keep-env <name,…>`
  passes named variables on
  ([PADR-0034](docs/adr/0034-preset-agents-get-no-provider-credentials.md)).
- [docs/release.md](docs/release.md) lists every place a version bump touches; the checker keeps
  accepting sessions written by the 0.2.0 development builds.
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

### Fixed

- A click on Practice while the Excalidraw workspace is still being prepared is no longer lost: when
  the preparation ends, the Player goes to the workspace chosen last.

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
- [`examples/agents/minimal-agent.mjs`](examples/agents/minimal-agent.mjs): a minimal command-template
  agent without a model (MCP SDK client; observe, act with `baseStep` and `expectedRevision` from the
  latest reply, check_result), run as a template by `tests/integration/bench-example-agent.test.ts`.
  The benchmark docs say to name a template's files by absolute path, where an agent's own errors
  land (`agent.stderr`) and that every template is reported as `generic` (use `--label`).

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

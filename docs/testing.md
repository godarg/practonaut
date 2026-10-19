# Tests and evaluation

How to run the checks and what each one covers. The invariants they protect are listed in
[architecture](architecture.md) §10; [CONTRIBUTING.md](../CONTRIBUTING.md) says which layers to run
for which change. Every behavior change comes with a test; tests check behavior,
never source bytes, file hashes or inventories, so changing a source file or a dependency never
breaks a test by itself.

## Commands

| Command | Needs | Covers |
|---|---|---|
| `npm run doctor` | Node, npm, git | Environment: Node ≥ 22.18, npm, git; optional Docker, gitleaks and Playwright Chromium. |
| `npm run check` | installed deps | `tsc --noEmit`, generated schemas equal committed schemas, documentation links and index, design-token contrast (WCAG 2.2 AA pairs, both themes), design lint, task library drift, the MCP Registry entry, and the workflow check (`tools/check-workflows.ts`: every cache and upload path and release asset literally in `.github/workflow-allowlist.json`, every other action on its list and pinned by SHA, the draw.io CI steps share one home and run without `PRACTONAUT_CHROMIUM_SANDBOX`). |
| `npm run design:lint` | installed deps | Source rules of the design language for every stylesheet and script under `src/player/`: values only from `design/tokens.css`, known tokens and classes and icons, no `innerHTML` family, inline style, colour literal, `data:` or remote URL. `tests/unit/design-lint.test.ts` holds one red input per rule. |
| `npm run design:gallery` | installed deps | Builds the living design gallery into `.local/gallery/`. |
| `npm test` | installed deps, offline | Unit, property, golden replay against an independent hash oracle, schema, hostile-package, checker, CLI and engine-build tests (`tests/unit/`). |
| `npm run build` | installed deps | Compiles `dist/`, bundles the Excalidraw engine and the offline Player with license notices. |
| `npm run demo` | installed deps, offline | Packs the example world deterministically, validates it, shows the rejection code of every hostile fixture. |
| `npm run test:adapter` | cached Chromium, local engine | Real Excalidraw actions with read-back, wrong prediction, integrity, timeout/abort, hostile imports, render checks, a real UI deletion. |
| `npm run test:integration` | cached Chromium, local engine and Player | Pack, validate, run, adapter apply with read-back, export, checker verdict; host HTTP and security probes; recording → compiled world (`authoring-demo`); native file transfer (with the Open ordering and its focus refusal, originals under `.local/native-transfer/`); recorded Player/MCP parity; evaluation worker; `play <task-id>` from the CLI; `practonaut bench` end to end (oracle with the real mirror, random within the step budget, external command agents, forged report refused; a `tasks from-scenes` task benched with `--world` and `--oracle`, its moved bench folder re-verified, changed world, artifact or reference refused by name, the oracle unreachable for the agent, a stored bench/1 report; run evidence — call and mutation logs, the checker's condition trace, the engine picture — re-verified and every tampering named; report v2 on fixture runs of scripted agents: every checker error class, every run state, correct/incorrect and grouped/ungrouped pictures; the CI recipe's commands against the committed baseline in `tests/fixtures/ci-recipe/`, passing as they are and failing with `instance_regression` on a planted regression, both JUnit files validated against the JUnit schema and by Chromium's XML parser); `report --card` and `--badge` rendered twice with identical bytes, PNGs included, and refused by name without Chromium and the world/2 native export. |
| `npm run test:e2e` | cached Chromium, local engine and Player | Source/packed serve, full task path, keyboard and pointer actions, real mirror at every step, requested-action oracle with independent hash, replay, XSS and foreign-page CSRF probes, the create and recovery flows, font readiness, native spreadsheet preview. |
| `npm run test:mcp` | cached Chromium, local engine and Player | Official MCP SDK v2 transports, credential and URL handling, output allowlist, limits, Player/MCP interleaving, structured errors, undo/reset; `mcp --task` self-start with the real mirror (observe → act → check_result, no hidden data, watch link on stderr only). |
| `npm run test:a11y` | cached Chromium | axe-core and overflow on actual Player states and on every bench report and compare page state (from fixture runs, `tests/support/report-states.ts`), EN/DE, light/dark, 1280/320 px, reduced motion, no external requests. Writes ignored `.local/player-a11y/`. |
| `npm run test:drawio` | cached Chromium that starts with its sandbox, the draw.io runtime | The draw.io layer (`tests/adapter/drawio/`, [adapter page](adapters/drawio.md)): the committed draw.io library (16 tasks × 3 cases) and every challenge family on seeds 1–3 written for draw.io, in three fresh processes and three recorded orders (every start and near miss fails, every reference passes, all three agree on every export, PNG and verdict; summary with per-task counts in `.local/drawio-conformance/summary.json`), the silent-change cases, the derived-memory case, counter-probes written through the app, arrow markers measured from SVG, the reader's differential fixtures, five fresh starts against the time and memory bounds. It reads two test-only variables: `PN_DRAWIO_HOME`, an absolute Practonaut home in which `setup --app drawio` ran (default `.local/drawio-home/`), and `PN_DRAWIO_REQUIRED` (`1` or `0`, unset is `0`, anything else stops the run): with `0` its tests skip by name when the runtime is absent or the sandboxed start is refused, with `1` they fail. |
| `npm run amplify:native-open` | cached Chromium, local engine | Opt-in, in no other command: the native Open leg under CPU throttling, repeated ([Native Open ordering](#native-open-ordering)). |
| `npm run amplify:host-deadline` | cached Chromium, local engine | Opt-in, in no other command: the two real-mirror host deadline tests, repeated under load, every browser close timed ([Host deadline tests](#host-deadline-tests)). |
| `npm run test:pack` | npm registry for dependencies | Tarball file list, `npm install` of the tarball into an empty project, installed CLI pack/validate/run/check, Chromium setup, installed Player and MCP smoke, `npx practonaut mcp --task excalidraw/connect` initialize/tools list, installed `bench --agent oracle`, `report --html` (with the report stylesheet) and `compare`, byte-identical repack. |
| `npm run clean` | — | Removes `dist/`, `coverage/`, `.local/demo/` and `.local/native-transfer/` only; idempotent. |

Supply chain: `npm ci` with `package-lock.json` is the only dependency pin. The engine build
patches the installed Excalidraw by name (each patch must match exactly once) and
`tests/unit/engine-build.test.ts` requires that the bundle contains no CDN URL.

## Independent oracles

Expected values in golden tests come from a source other than the code under test: hand
calculation, the real application, or `tests/oracles/core-hash.ts`, a hash oracle written
separately from `src/canonical` that imports nothing from `src/`.
`tests/fixtures/core/golden-final.json` is hand-authored. `tests/e2e/harness.ts` checks each
accepted DOM-requested action against a separate Session and the oracle hash and replays
every prefix, which detects a host that bypasses the requested transition.

Hostile fixtures are generated at test time by an independent, permissive zip writer
(`tests/support/zipwriter.ts`), so the reader under test never produces its own attack input.

## Native Open ordering

`nativeFileTransfer` (`src/evaluation/transfer.ts`, the integration test "H1 native file") opens the
file with Excalidraw's own shortcut, Ctrl/Cmd+O. The engine page has a non-secure origin, so
Excalidraw clicks a detached `<input type=file>`, and the test takes the file dialog as Playwright's
`filechooser` event. That event exists only while Chromium intercepts file dialogs
(`Page.setInterceptFileChooserDialog`). Playwright turns the interception on when the first
`filechooser` listener is added and does not wait for it. In 0.2.0 the test failed on five CI runs
after 10 s without that event (issue #45). The measurements below are consistent with this
mechanism, which is inferred, not read from Chromium's source: when the renderer is busy, a key sent
right after the interception command can be handled before the interception takes effect, the page
opens a dialog that is not intercepted, headless Chromium cancels it, and no event arrives.

The contract, `armBarrierTrigger` in `src/evaluation/native-trigger.ts`: **arm** the waiter first,
run any preparation (the click on the editor), complete one page round trip after arming
(**barrier**), and only then send the input (**trigger**). The Open's round trip also checks that
keyboard focus is inside the editor container; otherwise the attempt fails at once with
`transfer_invalid` and names the focused element, instead of a lost shortcut and a timeout. The
input is never sent once the wait has ended or a dialog event has already arrived: after the round
trip the helper lets one macrotask turn pass, so a settlement already under way is recorded however
many promise stages it has, and only then checks.

Time limit: the whole Open, from arming through click, round trip and shortcut to the dialog event,
runs under one limit, the per-step cap of at most 10 s counted from arming. A part that hangs ends
the Open at that limit with a `transfer_invalid` naming the phase and whether the shortcut was sent.
The limit is also checked against the monotonic clock right before the shortcut and for the moment
the event was observed, because a blocked event loop runs those continuations before an overdue
timer; past it, the shortcut is not sent and a late event is refused. Before the fix the click and
the shortcut-plus-dialog had 10 s each. The 60 s attempt limit is unchanged.

- `tests/integration/transfer.test.ts`, "native Open ordering", runs the real transfer through a
  launch seam (`tests/support/native-open.ts` patches `chromium.launch`) and records the calls: a
  `filechooser` listener, then a page round trip that starts after it and completes, then the
  shortcut. The old order (listener and key press in one tick) fails it. "native Open refuses by
  name" moves focus out of the editor on the first pointer release and expects the named refusal.
  `tests/unit/native-trigger.test.ts` covers a wait that ends during the click, right after the
  round trip or several microtasks later, a hanging round trip, a hanging shortcut, an event before
  the shortcut, a round trip that returns after the limit (with a test clock) and an event observed
  after it; each fails with its guard removed.
- Attempt evidence: `00-before-open.png` (the page before the click and the shortcut; best effort, a
  failed screenshot is recorded under `diagnostics` in `terminal.json` and does not fail the attempt)
  and the page console from readiness on (`console` in `terminal.json`, at most 200 messages of 2,000
  characters, the rest counted as `dropped`, uncaught page errors included). The integration tests
  keep their originals under `.local/native-transfer/` (`npm run clean` removes it); CI uploads that
  folder on failure on every platform (`native-transfer-evidence-*`).
- `npm run amplify:native-open -- [--runs 30] [--cpu 20]` (opt-in) repeats the real transfer with the
  renderer throttled (`Emulation.setCPUThrottlingRate`) from the ready editor until the first
  `filechooser` wait settles. A probe logs every file-input click with
  `navigator.userActivation.isActive` and where focus was; each attempt is classified from its
  terminal record; `keydownToFileInputClickMs` (the page's own time between the two) shows that the
  throttling took effect. It writes `.local/amplify-native-open/<time>-<commit>-<random>.json`.
  Re-run it when Playwright or its Chromium is upgraded: the mechanism above is inferred, and a new
  version can change it.
- `.github/workflows/native-open-repeat.yml` (by hand) runs the H1 native file test alone in 20 jobs
  per CI platform. A name pattern that selects no test still exits 0 in Node's runner, so the job
  also writes a TAP report and `tools/require-test-passed.ts` fails it unless the H1 native file test
  ran and passed.

Measured 2026-10-18 on one machine, macOS 27 (Apple M4, Node 22), `--runs 30 --cpu 20`: with the old
order (9c6a1e9) 28 of 30 attempts lost the dialog at Open; in each of them the probe saw the shortcut
and the file-input click with user activation and focus inside the editor, so the page did its part.
With the fix, 0 of 30 (6ddf4f6), 0 of 30 with the shared limit (b5c5a4c) and 0 of 30 with the
clock checks (72c6905). The page's own time from the shortcut keydown to the file-input click was
10–104 ms in these four runs (1–2 ms unthrottled), so they ran throttled. The 20 CI runs per platform are a maintainer step with the
repeat workflow and are still to come.

## Host deadline tests

`tests/integration/host-deadline.test.ts` checks two deadline paths against a real Chromium mirror:
"a real late mirror write cannot commit after the supplied monotonic deadline" (a test mirror holds
the real write's reply past a 200 ms transaction deadline) and "deadline expiration at real core
serialization is a timeout, with preserved committed export state" (a private copy of
`src/host/session.ts` moves the deadline into the past at the one serialize boundary). Both end in
`finally` with `controller.close()`, which closes the real browser through `closeBrowser`
(`src/adapters/browser/bounded.ts`): Playwright's `browser.close()` within graceful + forced =
8 s. Playwright's close returns once Chromium has exited and Playwright has removed its temporary
profile; a close that takes longer fails with `BrowserDeadlineError` and goes on in the background.
There is no forced step: nothing ends the browser before the process exits. So beyond what they
assert, the tests rely on Chromium closing within 8 s on the machine.

Issue #64: on 2026-10-18 each test failed once on `windows-latest` (runs 39145457184 and
39145095106) with `BrowserDeadlineError` from the timer in `bounded()`, each about 8 s longer than
when it passes (9871 ms against 1606–1946 ms elsewhere; 9047 ms against 937–1312 ms). Of the
bounded browser operations only the close has an 8 s bound and reaches the caller unwrapped, and in
both tests every mirror operation ends before the reply, so what ran out was the close in the
cleanup, not a bound the test waits on for its deadline. In both runs the file ran beside
`challenge-round.test.ts` (`test:integration` runs two files at a time; 325 s and 254 s on Windows,
250 s and 174 s on macOS), and macOS passed. The error now names the operation and its bound
("Browser close exceeded its deadline of 8000 ms").

What takes the time is Chromium's own graceful exit when the machine is short of CPU, measured on
macOS with the amplifier (below): the time from Playwright's close request to the process exit grows
from about 15 ms to seconds, and many slow exits end at 10.0–10.1 s, as if Chromium waited out a
10-second limit of its own; Playwright's profile removal stays near or under a second. A close bound
of 8 s is shorter than that wait. The same contention can hit a mirror recovery: in one attempt the
export's own reads ran out of time, the recovery had to replace the browser, closing the old one
took 10.9 s, the recovery failed and the session lost its mirror (the test's comparison of the
committed view then failed on `practiceEvidence`). Why Windows exceeded 8 s and macOS did not in
CI is not measured: the repeat workflow below records the same split on each CI platform. Not
changed: the 8 s bound, the tests' assertions. A close that must survive this needs a forced end of
the browser after the graceful bound, which Playwright's API does not offer for a launched browser;
it is a decision of its own.

A slow close must not hide the failure it cleans up after. Every path that closes a browser (or a
mirror, session or host holding one) after a failure does so within the same close bound and keeps
the original failure, with the close's failure as its non-enumerable `closeError` (an
`AggregateError` when several fail) (`closeAfterFailure` and `withClose` in
`src/adapters/browser/bounded.ts`). A failed host start tries each cleanup step on its own — the
listener (ending every connection and event stream first), the author store, the session, the
diagnostics, the credential — so one that fails or hangs skips none of the others. A mirror never
waits longer than the close bound for an old adapter, in a recovery or a close.
`tests/unit/close-keeps-error.test.ts` (session admission, mirror recovery in a session, a failed
rollback, a replacement started after close, an interrupted recovery, the author practice host's
reply budget, the render check, the report card; Node's mock clock) and
`tests/integration/close-keeps-error.test.ts` (the host start's author store, listener and editor
listener, the editor listener with an event stream open, a failed diagnostics discard on four start
paths, `practonaut run`, the native transfer export; real time, up to 8 s each) give each path a
stand-in close that never settles or fails. Run on the previous code, every one of them failed (the
call never settled, or a close's or cleanup's error replaced the original, or the close's failure
was lost), except the author practice host's, whose check was inline there and is a function of its
own now.

- `npm run amplify:host-deadline -- [--runs 30] [--cpu 20] [--block 0] [--load 0] [--hold 0]
  [--beside <file>] [--require-pass]` (opt-in) runs each of the two tests unchanged in its own
  `node --test` process, `--runs` times, with the preload `tests/support/host-deadline-seam.ts`
  (it patches `chromium.launch`): every real `browser.close()` is timed, the renderer is throttled
  after the first scene write (`--cpu`, `Emulation.setCPUThrottlingRate`), the test process's event
  loop is blocked for `--block` ms at a time, and `--hold` ms pass before a close starts (a stand-in
  for a slow close). `--load` adds CPU workers and file churn in the temporary directory;
  `--beside` runs another test file again and again meanwhile. Playwright's browser-process log
  (`DEBUG=pw:browser`) lands in each attempt's TAP report, and the summary splits each close into
  Chromium's exit and the profile removal. It writes
  `.local/amplify-host-deadline/<time>-<commit>-<random>.json`. `--require-pass` exits 1 unless each
  test ran and passed in every attempt (read with `tools/require-test-passed.ts`).
- `.github/workflows/host-deadline-repeat.yml` (by hand) runs the amplifier on each CI platform in
  5 jobs of 30 attempts per test, without throttling and beside `challenge-round.test.ts`, with
  `--require-pass`, and uploads the record after a pass too.

Measured 2026-10-18/19 on one shared machine (other work running beside it), macOS 27 (Apple M4,
10 cores, Node 22); c645e5f has the product code before this change, b1b071f the named error:

| Settings (commit) | Attempts | Failed | Closes ≥ 1 s | Longest close | Longest Chromium exit |
|---|---|---|---|---|---|
| `--hold 8500` (c645e5f) | 60 | 60, the CI error and stack frame, tests 8.5–9.1 s | 60 | 15 922 ms | 7 411 ms |
| `--hold 8500` (b1b071f) | 20 | 20, "Browser close exceeded its deadline of 8000 ms", tests 8.5–9.2 s | 20 | 20 151 ms | 11 641 ms |
| `--cpu 20 --block 20 --load 6`, load average 60–75 (c645e5f) | 60 | 4, the CI error | 15 | 10 749 ms | 10 046 ms |
| `--cpu 20 --block 20 --load 6`, load average 130–250 (b1b071f) | 60 | 14: 13 at the close, 1 recovery that lost its mirror | 32 | 30 900 ms | 30 114 ms; 10 exits at 10.0–10.1 s |
| `--cpu 1 --beside tests/integration/challenge-round.test.ts` (c645e5f) | 60 | 0 | 0 | 37 ms | 20 ms |

Exits of a second or more came with the machine's own load too: in the first held run (load average
above 100, no throttling, blocking or `--load`) 6 of 60 exits took a second or more, the longest
7 411 ms. The load average is the machine's and was not controlled, so the rows show that the
failure appears under contention, not a rate. The Windows repeat is a maintainer step and still to
come.

## Platform matrix

| Platform | Status |
|---|---|
| macOS arm64, Node 22 | development target, all layers measured locally |
| Ubuntu, macOS, Windows (Node 22) | CI (`.github/workflows/ci.yml`, required checks `test (<os>)`): check, unit, build, integration, MCP and pack on all three; demo, adapter, e2e and a11y on Ubuntu; on Ubuntu, after the step that lifts the AppArmor restriction, `setup --app drawio` into a home under the runner's temporary folder, the draw.io layer with `PN_DRAWIO_REQUIRED=1` and its summary check, the summary uploaded, the home deleted (always). Platform branches are also unit-tested with a simulated platform (`tests/unit/platform.test.ts`). Linux and Windows were not tried by hand. |
| Ubuntu, Node 24 and 26 | CI job `node <version> (ubuntu-latest)`, not a required check: check, unit, build, integration, MCP and pack. |
| Ubuntu, Node 22, by hand | `.github/workflows/ci-recipe-check.yml` (`workflow_dispatch` only, not a required check): the CI recipe of `examples/ci/` with the packed checkout and the oracle agent; `plant_regression` must make it fail ([benchmarks](benchmarks/README.md) §7). |
| macOS, Windows (Node 22), by hand | `.github/workflows/drawio-conformance.yml` (`workflow_dispatch` only, not a required check): `setup --app drawio` and the draw.io layer with `PN_DRAWIO_REQUIRED=1`, its summary uploaded, the home deleted; the summaries are committed before draw.io's acceptance ([PADR-0049](adr/0049-drawio-adapter.md) decision 8.7). |
| Ubuntu, macOS, Windows (Node 22), by hand | `.github/workflows/native-open-repeat.yml` (`workflow_dispatch` only, not a required check): the H1 native file test alone, 20 jobs per platform after the engine build, evidence uploaded on failure ([Native Open ordering](#native-open-ordering)). |
| Ubuntu, macOS, Windows (Node 22), by hand | `.github/workflows/host-deadline-repeat.yml` (`workflow_dispatch` only, not a required check): the two real-mirror host deadline tests, 5 jobs of 30 attempts each per platform beside `challenge-round.test.ts`, every browser close timed, the record uploaded after a pass too ([Host deadline tests](#host-deadline-tests)). |

## Evaluator rules for worlds

- Goal predicates check the result, not the path; every task has an alternative valid solution
  and a near miss in the separate checker bundle. The learner world contains neither fixture nor witness.
- Before any verdict, the checker runs counter-probes: empty submission, unchanged start state,
  wrong artifact; all must fail.
- Hints never use hidden data. An agent that can read task data on disk can see reference
  solutions; its bench score is not a sealed result.
- `tools/agent-runs.ts` executes opt-in real agent practice runs; ordinary test suites never call
  a model provider.
- The bundled example's demonstration plays public content only (each task's third hint).
  `tests/e2e/first-minute.test.ts` scans every reply, asset and event the Player receives during it
  for the reference steps and near misses of every library task and the example's held-out task
  (`tests/support/oracle-scan.ts`), with a planted marker as positive control.
- `tools/measure-first-action.ts` measures the time from `npx practonaut` (packed tarball, warm npx
  cache, npm offline so no registry lookup; `--local` for `dist/`) to the first demonstrated action
  on the board, model-only and with the real engine; the click is automated. Median of three runs,
  written to `.local/measure-first-action/<time>-<commit>.json` with the commit and whether the tree
  had changes. Budget 30 s.

## Known gaps

- The two timing-sensitive files
  (`tests/e2e/timing/`: initial-module deadline, font readiness; product deadlines of 8–10 s)
  run serially after the concurrent batch: under four parallel browsers they missed their windows.
  One measured product observation stays open: fonts released after the Player's 10 s editor
  deadline do not make the timed-out document ready (one font face stays unloaded; cause not
  isolated). The Player stays failed and Retry builds a working document, which the test pins.

- Screen-reader and 200% zoom checks by a person are not done yet
  ([manual checks](design/manual-player-checks.md)); touch input is not separately tested.
- The native goal verdict is end-state-only. Agents run as the same OS user as the task data.
- No participant study has been conducted; competence transfer is unknown.

# PADR-0050 — A browser close is a bounded request on top of Playwright's own forced end

Status: proposed · Date: 2026-10-19 · Issue #64 · Builds on
[PADR-0032](0032-chromium-sandbox-stays-on.md) (one way to start Chromium),
[PADR-0045](0045-adapter-registry-and-browser-shell.md) (browser shell, sink proxy, time bounds) and
[PADR-0012](0012-excalidraw-bundling.md) (the engine is served without a local listener) · Records the
maintainer's decisions of 2026-10-19: **in 0.3.0 Practonaut signals no process it did not spawn
itself**, and (round 5) **the product reads no process table; Playwright's own close is the proof of
a process end** · Revised after four rounds of independent review on 2026-10-19 (OpenAI Codex in every
round; in the fourth also a Claude Opus reviewer with a skeptic): the first rejected a forced end
through a CDP process id, the second showed that Playwright already forces the end through the handle
it owns, the third that neither a launch rejection nor every fulfilled `browser.close()` proves an
end, the fourth that a process-table reader is the weak point; dispositions in *Review*, *Re-review*,
*Re-review 2* and *Re-review 3* at the end · Design only; accepted with the pull request that
implements it

## Context

Every browser Practonaut starts goes through `launchChromium` (`src/adapters/browser/chromium.ts:62`):
the mirror's shell (`src/adapters/browser/shell.ts:197`), the start check
(`src/cli/browser-start.ts:29`), the render check (`src/adapters/excalidraw/render-check.ts:26`) and
the report card (`src/bench/card-png.ts:27`). They close it four ways: the shell through
`closeBrowser` (`src/adapters/browser/bounded.ts:28`), Playwright's `browser.close()` raced against
`BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced` = 3 s + 5 s; the start check, the render check and
the report card with a plain `browser.close()` (the report card closes each context first; the start
check ignores the close's failure). Above the shell, the mirror's `dispose` (since pull request #68,
`closeWithin`) and the host's close steps (`src/host/server.ts`, 8 s per step within 12 s overall)
arm timers of their own around the same close.

**What Playwright does on a close** (playwright-core 1.64.0, `lib/coreBundle.js`). `browser.close()`
ends in `browserProcess.close()`, which is `closeOrKill(30 000 ms)` (`DEFAULT_PLAYWRIGHT_TIMEOUT`):
it races the graceful close — CDP `Browser.close`, then waiting for the child's `close` event and the
removal of its temporary directories — against a 30 s timer, and when the timer wins calls `kill()`.
`kill()` ends the child it spawned and still holds: on POSIX `SIGKILL` to the child's process group
(`-pid`; the child was spawned `detached`), skipped once the child's `close` event has arrived; on
Windows a synchronous `taskkill /pid <pid> /T /F` through `spawnSync` with no timeout. It then waits
for the same cleanup. The timeout is not a public option: the only override is
`__testHookBrowserCloseTimeout`, which Playwright's protocol validator passes only when its own test
mode (`PWTEST_UNDER_TEST`) is set. The cleanup removes two temporary directories per launch,
`playwright_chromiumdev_profile-*` and `playwright-artifacts-*`, with `fs.promises.rm` (10 retries);
a removal error is logged and the close still fulfils. At Node's `exit` event Playwright's own handler
kills every child it still tracks the same way and removes the directories with `rmSync` (5 retries),
catching errors. A Practonaut command ends by setting `process.exitCode` (`src/cli/main.ts`), so Node
exits only once Playwright's pending closes, their pipes and their 30 s timers are done; the bench's
second interrupt calls `process.exit` and so reaches the exit handler with closes still pending.

Two paths end without proof that the process ended. **A launch that fails after the process
started:** when the launch times out while connecting, `_innerLaunch` starts `browserProcess.close()`
but awaits it through the launch's progress race, whose abort promise has already rejected; the
launch rejects at once while that close and its 30 s timer go on. Practonaut never gets a `Browser`
for it, and the shell's error path closes its sink at once (`src/adapters/browser/shell.ts:241`).
**A close after the connection dropped:** when Playwright's transport to the browser closes, the
server disposes the browser's dispatcher; a later `browser.close()` gets `TargetClosedError`, which
the public method swallows, and fulfils — without calling `browserProcess.close()`, so without
Playwright's 30 s forced end either. The connection can drop while the root process still runs (the
pipe closes early in Chromium's shutdown, measured below).

Issue #64 measured what a slow close costs (`docs/testing.md`, *Host deadline tests*). On a machine
short of CPU, Chromium's graceful exit grows from about 15 ms to seconds; in the amplifier run under the
heaviest load (60 closes) 27 exits took a second or more and ended with exit code 0, up to 11.4 s, ten
of them at 10.0–10.1 s; two ended at 30.1 s with `SIGKILL`, logged by Playwright as `<kill>` — its own
forced end after 30 s, not a Chromium limit. Profile removal stayed near or under a second. Under
load, then: an 8 s bound fails although the browser is merely slow; an unbounded close waits up to
Playwright's 30 s; a mirror recovery that must replace a browser fails and the session loses its
mirror; tests fail in their cleanup. Pull request #68 keeps the original failure when a close after it
fails or runs out of time, tries every cleanup step of a failed host start on its own and bounds the
mirror's wait for an old adapter; it does not change what a close after successful work does.

**When a close does prove the end** (same source). The client's `browser.close()` sends `close` to
the browser's server-side dispatcher and then awaits the client's `disconnected` (`lib/coreBundle.js`
64300–64310, 64193). The dispatcher calls the server's `Browser.close` (56898–56901), which calls
`browserProcess.close()` once and then waits for `Disconnected` (54116–54124). `browserProcess.close()`
is `closeOrKill` (41244–41261): its graceful branch and its `kill()` both end by awaiting the same
`waitForCleanup` promise (10091–10103, 10135–10138), which is fulfilled only in the handler of the
child's `close` event — the process has exited and its stdio pipes have closed — after the directory
removal (10072–10080). So a `browser.close()` that reached the dispatcher fulfils only after
Playwright saw the child's `close` event. One that did not reach it — the dispatcher was already gone
— gets `TargetClosedError` (20140–20142) and fulfils without any of this. Practonaut's Playwright runs
in process; client and server pass messages through `setImmediate` (65537–65538), so the client can
still see `isConnected()` as true for one turn of the event loop after the server disposed the
dispatcher.

**A mirror close during a recovery** (`src/host/mirror.ts`, on `main`). `close()` disposes the current
adapter — none during a recovery — and then waits in the mirror's serial queue behind the running
`recover`, whose replacement start (`registration.create`) gets no abort signal and is bounded only by
the shell's launch and start bounds (15 s + 60 s). A session close during a recovery therefore outlives
the deadline its host passes down (measured by the fourth review with a stand-in start of 12 s: the
mirror's close took 11.9 s against the host step's 8 s).

## Measurements

macOS 27 (Apple M4), Node 22.22.3, Playwright 1.64.0 with its headless shell, 2026-10-19. Probes in
`.local/` start their own browser and signal nothing but it (not kept in the repository). Source facts
are from the installed `playwright-core` 1.64.0, `lib/coreBundle.js` line numbers as cited above.

| Question | macOS | Linux | Windows |
|---|---|---|---|
| Playwright's close timeout, then its forced end | 30 s, then `kill()` (source); measured: 2 of 60 closes under load ended at 30.1 s with `SIGKILL` | same source | same source; `taskkill /T /F` synchronous, no timeout |
| Close timeout settable through a public option | no (only the test-mode hook) | same | same |
| A close that reached the dispatcher fulfils only after the child's `close` event | yes (source, cited above) | same | same |
| `Browser.process` on a launched browser; `BrowserServer.process()` | `undefined`; a public `ChildProcess` (`types/types.d.ts:20759`) | same API | same API |
| Graceful exits under load (60 closes) | 27 ≥ 1 s, exit code 0, up to 11.4 s; 10 at 10.0–10.1 s | UNKNOWN | UNKNOWN |
| `disconnected` against the process exit, under load | `disconnected` 21–115 ms after the request, exit up to 3.6 s | UNKNOWN | UNKNOWN |
| Temporary directories per launch | profile and artifacts under `os.tmpdir()` (source) | same, from `TMPDIR` | same, from `TEMP`/`TMP` |
| Removal error on close | logged, close fulfils (source) | same | same |
| Launch rejected after the process started | timeout: the launch's close runs on with its 30 s timer, no `Browser` returned (41156–41159, 41283–41286 against the aborted race, 12981–12994); a child that exits during the launch: the launch rejects only after that close settled (41264–41275) | same | same |
| `browser.close()` after the connection dropped | `TargetClosedError` swallowed, fulfils, no process close started (source) | same | same |
| Process group | the browser leads its group (PGID read); three children share it; SID not read | same source; zygote and sandbox helpers UNKNOWN | no groups (source) |
| Peak memory per browser, and during recoveries with old browsers still closing | UNKNOWN | UNKNOWN | UNKNOWN |
| `launchServer()` | listener on `[::1]`, 32-hex path, second client drives the browser, wrong path `400`, `kill()` 7 ms | UNKNOWN | UNKNOWN |

## Options considered

Each option with what it guarantees, what it costs and what is measured.

**(a) `launchServer`, `BrowserServer.process()` and `BrowserServer.kill()`.** *Guarantee:* the public
`ChildProcess` of the browser, whose `exit` event proves the end on every platform without reading
any process table, and Playwright's kill through its own handle. *Cost:* every operation on the
browser goes through a WebSocket endpoint the Node process listens on — endpoint disclosure (the port
is visible, the 128-bit path is not), control (none without the path, `400`; full with it), denial of
service (anyone can connect to the port). The threat model trusts same-user processes
(`docs/security/threat-model.md` §3, 1); PADR-0012 serves the engine without a local listener; the
whole shell would move onto `connect`. *Evidence:* macOS only. Weighed again in round 5 (review
finding F10) against the proof requirement: (a) gives the strongest proof, with no residual window.
Not chosen, the listener being the deciding cost: Playwright's own close already proves the end
where it ran (decision 5). Of the cases it leaves, a browser that disconnected first only holds a
slot longer; decision 5's residual window is the one exception that frees a slot and the sink early
(a close that fulfils through the swallowed `TargetClosedError` before the child has ended), accepted
there because it arises only when Chromium has closed its own end of the connection. It is the first
candidate if either case shows up in practice (re-assessment triggers).

**(b) The browser's process id from CDP, verified, and a signal of Practonaut's own.** Rejected
(first review, findings 1–3): the identity is not bound to the browser whose close is pending, `ps
lstart` has one-second resolution, and a Windows tree walk follows parent ids that may be reused.

**(c) A process-group or job-object launch of Practonaut's own.** A job object needs native code or a
wrapper around the one start (PADR-0032). Not chosen; re-assessment trigger.

**(d) Leave the close as it is and run `challenge-round.test.ts` alone in CI.** Changes nothing for
users. Interim CI measure only (decision 11).

**(e) A bounded request on top of Playwright's own close and forced end.** *Guarantee:* no caller
waits longer than its deadline; no work that succeeded fails because a browser closes slowly;
Practonaut signals nothing and reads no process table; every browser launched stays reserved in a
process-wide budget until Playwright's own close proves its end, or a fixed wait or the process exit
stands in where it cannot; the forced end is Playwright's, 30 s after the request. *Cost:*
Playwright's forced end carries its own risks (decision 1); a slowly closing browser holds a slot, its
sink and memory for up to 30 s; a command may wait for it before it exits. *Evidence:* source and the
macOS load runs. Chosen.

**(f) A read-only check of the process table for a switch each launch puts on Chromium's command line
(round 3).** *Guarantee claimed:* proof of absence without a process id. *Why not* (fourth review):
procps `ps` cuts the line at an inherited `COLUMNS` and then answers *ended* while Chromium runs
(measured in the Playwright Ubuntu image); slim containers have no `ps`; a Windows reader costs a
PowerShell process per read and can match its own query; a read before Chromium exists answers
*ended*; an *unknown* answer can hold for good; and the reader loads every command line of the user.
Rejected; process-table reads stay in the tests.

## Decision

1. **Playwright's close is the close; its forced end is the forced end.** Practonaut asks once,
   `browser.close()`, and adds no signal, no kill and no handler of its own. Playwright ends a close
   that has not finished after 30 s through the child it spawned and holds. Its timeout stays 30 s:
   it is not settable through a public option, and Practonaut does not turn on Playwright's test mode.
   **Accepted dependency risks**, recorded rather than hidden: on Windows Playwright's `taskkill /T`
   walks the tree by parent process ids, which Windows may have reused (the first review's finding 2
   applies to Playwright as to any user of it), and its `spawnSync` holds the host's event loop until
   `taskkill` returns, with no timeout; on POSIX Playwright signals the child's group until the
   child's `close` event, which Node delivers after it has reaped the child (`exit`), so for a moment
   it may signal a group id whose leader is already gone. Practonaut runs a stalled browser into
   these paths only as often as Playwright's own users do: when a close takes longer than 30 s.
2. **One close contract, one deadline, outcomes passed up.** Every owner — the shell, the start
   check, the render check and the report card — closes through one function that takes a
   **deadline** (a monotonic time) from its caller, by default the request plus 8 s. It always settles
   by that deadline with an outcome: **closed** (Playwright's close fulfilled), **failed** (it
   rejected) or **abandoned** (still running at the deadline). Every layer above — the adapter's
   `terminate`, the mirror's `dispose` and `close`, the session's `close`, the host's close steps, the
   commands — passes its own deadline down and reads the outcome; none arms a timer of its own that
   ends at or before a deadline it has passed down. (The second review's counterexample: `closeWithin`
   in the mirror starts its 8 s timer before `terminate` starts the browser's, so the outer one fires
   first and turns an *abandoned* into a `BrowserDeadlineError`; the host's step timer does the same.)
   A safety timer that remains above the contract, such as the host's 12 s overall close, ends later
   than every deadline it hands down, and its firing counts as *failed*. **The report card's
   contexts** (review finding F12): each picture's context is closed through the same contract, under
   the command's deadline; an *abandoned* context close neither holds the command nor discards the
   pictures already taken, and a context still closing is ended with its browser's one close.
3. **After the deadline the caller goes on.** Work that succeeded is not failed by an *abandoned*
   close: a render check returns its report, a report card its pictures, `run` its result, a start
   check its answer, a host close resolves. After a failure the original failure is what the caller
   gets, with an abandoned or failed close next to it (`closeAfterFailure`, #68). A host close
   reports "could not be fully confirmed" only for a *failed* close.
4. **A process-wide browser budget with reservations.** Every `launchChromium` call reserves one
   slot, synchronously, before Playwright's launch starts; JavaScript runs one thing at a time, so two
   starts cannot both see the last free slot. A slot is released only by decision 5's rules — on a
   proven end, after the fixed wait for a launch that rejected, or never before the process exits for
   a browser whose end cannot be proven. The budget, `HOST_LIMITS.browsers`, counts running and
   closing browsers together, across every host in the process; a recovery's replacement reserves its
   own slot while the old browser still holds one. **A start that finds the budget full waits** for a
   slot within its own launch bound (`BROWSER_BOUNDS.launch`, 15 s) and is refused by name,
   `browser_budget_exhausted`, only when none frees in that time — as a start that fails is refused
   today: `--mirror auto` goes on model-only with a notice, `--mirror required` and `run` stop with
   the named error (exit 3), a recovery leaves the session without a mirror, and a bench run is
   recorded as `infra_error` with that reason, so the set of judged runs can depend on machine load
   and the bench report says how many runs that cost (review finding F5; counted in decision 11). The
   starting value is 8: an author host with four practice hosts (five mirrors), two overlapping
   recovery replacements and the start check's browser while it may still be closing. It is
   confirmed or changed by the memory measurement (decision 10). The browser's helpers are not
   counted and are looked for in the tests only.
5. **Three independent statements per close, and what proves the end.** The product reads no process
   table.
   - *Promise result:* what Playwright's call did — a close *closed*, *failed* or *abandoned*
     (decision 2), a launch resolved or *rejected*.
   - *Process end:* proven by **Playwright's own close** when Practonaut asked for it while
     `browser.isConnected()` was true and its `browser.close()` fulfilled: such a close reached the
     dispatcher and fulfils only after Playwright saw the child's `close` event (source, Context).
     That frees the slot and the sink. Where there is no such proof:
     - **A launch that rejected** — judged by Playwright's own promise for the whole `launchChromium`
       call, never by a caller's bounded race around it: its slot and sink are held for Playwright's
       30 s close bound plus 5 s from that rejection, the time Playwright's background close of a
       spawned child takes at most before its forced end has run. A launch rejection whose child
       exited during the launch is covered too: that rejection comes only after Playwright's close of
       it settled (source). An entry whose caller-side race was lost (the caller's deadline or abort
       came first) stays *launching* until Playwright's promise settles; a browser that arrives late
       joins its one close (decision 7) and is proven as any other.
     - **A browser that was already disconnected when its close was requested** (`disconnected` seen,
       or `isConnected()` false): its close cannot reach Playwright's process close, so no proof will
       come; its slot and sink are held until the process exits (decision 9 bounds that for
       commands).
     - **The residual window:** a close requested in the one event-loop turn in which the server
       has already disposed the dispatcher but the client still reports `isConnected()` true fulfils
       through the swallowed `TargetClosedError`, and is taken as proof although it is none. The
       connection drops on its own only when Chromium closes its end, so the browser is then already
       shutting down; this is accepted, and is option (a)'s re-assessment trigger.
   - *Directory cleanup:* not confirmable through Playwright's API — it logs a removal error and
     fulfils — so Practonaut reports it as unconfirmed and never frees a slot because of it; the tests
     check the profile and artifacts directories where the test put `os.tmpdir()`.

   The three are recorded separately; none is inferred from another.
6. **The sink belongs to the pending close.** The shell's sink proxy stays bound for as long as its
   browser's slot is reserved, and is closed when the slot is released (decision 5) — not in the
   `finally` of the close request, and not in the launch's error path, which today closes it at once
   (`src/adapters/browser/shell.ts:241`). A browser whose launch rejected or whose close is abandoned,
   failed or unproven keeps its proxy address pointing at Practonaut's sink, so no other local process
   can take that port and receive the connections the browser opens below the page (PADR-0045's sink).
7. **Register rules.** One ledger entry per `launchChromium` call, created with the reservation; it
   is *launching* until Playwright's promise for that call settles, then the browser or *launch
   rejected*. One close per browser: the first close request calls `browser.close()` once and records
   whether the browser was connected at that moment; every later request (the shell's, the mirror's,
   a host's, a late browser's) joins that promise and gets its outcome against its own deadline. A
   context close is a step of its owner's close, with no entry or slot of its own.
8. **Mirror recovery and the mirror's close** (review finding F4). `recover` takes a deadline in two
   parts: the old adapter's close, against the close contract's 8 s; then the replacement's start,
   against `BROWSER_BOUNDS.launch` and `BROWSER_BOUNDS.initialize` (15 s + 60 s, PADR-0045) and its
   read-back within `MIRROR_DEADLINE_MS`. The start gets an abort signal, which `registration.create`
   passes to the shell (`createExcalidrawAdapter` already does). The replacement takes a slot of its
   own and is published only after its read-back equals the committed Practonaut state, as today; a
   late write of the old browser cannot reach it, being another process with its own page, profile
   and sink. **The mirror's close does not wait in the serial queue behind a recovery:** it marks the
   mirror closed, aborts a running start, closes the current adapter and any replacement that has
   arrived through their one close under the close's own deadline — never a later default — and
   settles by that deadline as *closed*, *abandoned* or *cancelled* (a start aborted before any
   browser existed). A replacement that arrives after the abort goes to its one close as well; its
   entry stays *launching* until then (decision 5).
9. **What the user sees, and how a command ends.** Nothing in the Player or over MCP. A host's
   private diagnostics record the closes it abandoned while it lived; no diagnostics writer outlives
   its host. Later outcomes stay in the process ledger (the last 64 entries) and the command reports
   them on stderr when it ends, in English and German. A command that still has closes pending says
   so before Node waits for them: *Waiting for N browsers to close; Playwright ends them within 30 s
   of the request.*
   **The 35 s rule** (review finding F8). A command whose own shutdown has finished — for each
   command below — and whose writes (reports, the ledger's stderr lines, diagnostics) are flushed,
   arms an unreferenced timer that fires 35 s after its last close request (at once if that time has
   passed). If Node is still running then and the ledger still holds an entry it has not released
   (decision 5: a close still running, a launch still held, a browser disconnected before its close),
   the command calls `process.exit`, so that Playwright's exit handler ends the children it still
   tracks. No process-table check is needed: `process.exit` hands whatever Playwright still tracks to
   that handler, and an unreferenced timer never keeps Node alive by itself.
   - `run`, `check`, `pack`, `validate`, `doctor`, `tasks …`, `report …`, `compare`: when `main`
     returned and its output is written.
   - `serve` and `play`: after the stop on Ctrl+C or end of input — the host closed and its
     credential removed.
   - `practonaut mcp`: `main` returns at once and the session runs until stdin closes or a signal;
     its shutdown has finished only after `stop()` has closed the host and removed the token file.
   - `bench`: after the report (or the partial report) is written and every host it started is
     closed; the second interrupt keeps its immediate `process.exit`.
   - Never while a host is open.

   A refused start names `browser_budget_exhausted`, how many browsers are running and closing, and
   the remedy (wait, or restart Practonaut).
10. **Tests that fail without it.**
    - Unit, Node's mock clock, a fake browser whose close never settles, for each of the four owners
      (the report card with its per-picture contexts): the owner's call returns at the deadline with
      its own result (or its own failure) and the outcome *abandoned*; pictures already taken are
      kept; the slot stays reserved; when the fake close fulfils for a browser that was connected at
      the request, the slot and the sink are released and the ledger records it.
    - Unit, the review's counterexample as a test: a never-settling browser close under the mirror's
      `dispose` and under a host close yields *abandoned* at every layer, never a `BrowserDeadlineError`
      from an outer timer.
    - Unit, a session close while a recovery's replacement start never settles (review finding F4):
      the mirror's close settles by its deadline as *abandoned* or *cancelled*; the start receives
      the abort; the host's close step never times out; a replacement that resolves after the abort
      goes to its one close.
    - Unit, the budget: nine starts in the same turn with a budget of 8 — the ninth waits and is
      refused at its launch bound unless a slot frees, and starts when one frees; a recovery holds two
      slots until the old browser's end is proven.
    - Unit, the proof rules: a close that fulfils for a browser connected at the request frees the slot
      and the sink; one requested after `disconnected` keeps both until the (stubbed) process exit; a
      launch that rejects keeps both for 35 s after the rejection, judged by Playwright's promise for
      the whole `launchChromium` call — a caller race lost earlier leaves the entry *launching*, and a
      browser resolving after the caller's abort joins the one close; Codex's combined path — a close
      that fulfils after a disconnect, its child still alive, no proof — keeps the slot and leads to
      the command's `process.exit` 35 s after its last close request, after its writes are flushed,
      and only once its shutdown has finished (stubbed `process.exit`, per command kind of decision 9,
      `practonaut mcp` included).
    - Unit: the sink is not closed while its browser's slot is reserved, nor after a launch rejects;
      joining callers share one `browser.close()` call; context closes take no slot.
    - Integration, real Chromium, a launch rejected after Chromium started (review finding F11): the
      launch's own `timeout` is set short enough that Playwright spawns Chromium and gives up while
      connecting; the test's own process-table read must find the spawned Chromium after the
      rejection, otherwise the attempt does not count and is repeated with a longer timeout (up to a
      fixed number of tries, then the test fails); the slot and the sink are held for 35 s after the
      rejection, and the test's read finds no such process afterwards.
    - Integration, POSIX, the real CLI (`practonaut run --mirror required`): a test preload reports
      the browser's process id from CDP; the test confirms it is a descendant of the CLI process it
      started and stops that browser's group (`SIGSTOP`, test-only, on the tree its own child
      launched), so no graceful close can finish. (A) Normal end: when the bounded close returns
      *abandoned* to the caller and `run` prints its result, the test reads the whole descendant tree
      (pid, ppid, pgid, sid, start time) and finds the browser alive. Node cannot exit while
      Playwright holds the child, its pipes and its close timer, so the CLI exits naturally after
      Playwright's forced end (about 30 s); afterwards none of the recorded processes remains, and
      the profile and artifacts directories, which the test saw appear under its own temporary
      directory, are gone. (B) Exit handler: a bench whose second interrupt calls `process.exit` while
      the close is pending; the test reads the tree and finds the browser alive immediately before it
      sends that interrupt, and finds none of those processes, and no directory, after the exit. The
      test's temporary directory is set through `TMPDIR` on POSIX and `TEMP` and `TMP` on Windows
      (review finding F9), and every test asserts the directories appeared there before it asserts
      they are gone. Windows has no deterministic way from Node to stall Chromium (UNKNOWN): there (A)
      and (B) run without the stall and check survivors and directories only; the forced path stays
      an accepted dependency risk, counted in the repeat.
    - Measurement, POSIX and Windows: peak memory (resident size summed over each browser's process
      tree), sinks and profile directories while a recovery runs with the old browser still closing,
      and two such recoveries overlapping, with the start check's browser still closing. It sets
      `HOST_LIMITS.browsers`.
11. **Before and after (acceptance of issue #64).** Comparable runs: the same Playwright, Chromium and
    Node versions, runners, load parameters and test parallelism; Linux with the sandbox and with the
    PADR-0032 fallback. *Before:* `main` with #68 only — `host-deadline-repeat` (5 jobs × 30 attempts
    per test, each platform, beside `challenge-round.test.ts`) and locally the amplifier with
    `--cpu 20 --block 20 --load 6` (before #68: 4 and 14 failures in 60 attempts). *After:* the same
    runs on the implementing branch. Reported both times, per platform and test, with full
    denominators:
    - attempts; **work completed** (the test's own assertions passed); mirror recoveries started and
      **published**; failures at the close; start failures (budget refusals and starts that waited for
      a slot included; bench runs lost to the budget); resource failures; shutdown failures (a host
      close *failed*; a command that did not exit within Playwright's 30 s plus cleanup, or that had
      to use the 35 s rule);
    - closes: closed in time, abandoned, failed; of the abandoned: ended gracefully, ended by
      Playwright's forced end, still pending when the command ended; launches rejected; entries
      released by proof, by the launch wait, and only at process exit;
    - per close, separately: the request, `disconnected`, the process exit with its exit code or
      signal, the start and end of directory cleanup, the promise settling, the return to the caller;
    - peak memory and slots in use.

    **Accepted when**, on every platform: every attempt completed its work; every recovery published
    a replacement; no attempt failed at the close; no start, resource or shutdown failure appeared
    that the before-run did not have; and the after-run shows abandoned closes wherever the before-run
    failed at the close (a run in which no close was ever abandoned does not confirm the cause).
    Moving a failure from the close into a refused start, a lost recovery or a slow exit does not
    pass. Zero failures in 150 attempts bound the failure rate only to about 2 % at 95 % confidence;
    the record says so rather than "fixed". *Interim:* if the before-run fails at the close on a
    platform, `test:integration` runs `challenge-round.test.ts` in a CI step of its own on that
    platform until the after-run is in; no required check is renamed.

## Consequences

- Practonaut signals no process and reads no process table; process-table reads exist only in tests.
  The forced end is Playwright's, with the dependency risks in decision 1; the threat model records
  them as Playwright's.
- No caller waits beyond its deadline, the mirror's close during a recovery included, and work that
  succeeded does not fail because a browser closes slowly. A command may still wait before it exits —
  up to Playwright's 30 s after the last close request, or 35 s under the rule of decision 9 — and
  says so.
- The number of browsers Practonaut launched whose end is not proven is bounded per process; a
  recovery's replacement counts, a launch that rejected counts for 35 s, and a browser that
  disconnected before its close counts until the process exits. A start waits up to 15 s for a slot
  before it is refused; bench runs lost that way are counted.
- A slowly closing browser keeps its sink port and its directories for up to 30 s, and longer if
  Playwright's cleanup fails; cleanup is reported as unconfirmed, not assumed.
- One residual window (decision 5) can take a close for proof although it is none; it only arises
  when Chromium has closed its own end of the connection.

## Re-assessment triggers

- Playwright makes its close timeout public, or exposes a process handle or kill for launched
  browsers without a listener.
- Entries held until process exit (browsers disconnected before their close) or the residual window
  appear in practice: then option (a)'s `BrowserServer.process()` is weighed against its listener
  again.
- A Windows job object or process handle becomes available from Node or a vetted addon (option c).
- Budget refusals or waits appear in practice, or the memory measurement asks for another budget.
- The tests find a survivor, or a leftover directory, on any platform.
- The Windows repeat shows Playwright's `taskkill` holding the event loop long enough to break a
  deadline.

## Review (2026-10-19)

The first independent review, of the first draft (a forced end through a verified process id), by
OpenAI Codex. Its counterexamples were analytical. Statuses as of the second review (*Re-review*).

| # | Finding | Disposition |
|---|---|---|
| 1 | blocker — the recorded identity is not bound to the browser whose close is pending (death and reaping between the CDP answer and the system read; `ps lstart` one-second resolution) | Accepted; option b rejected. Closed in the re-review. |
| 2 | blocker — Windows `taskkill /T` follows parent ids that may be reused | Accepted for Practonaut's own signals (none). Playwright's forced end uses the same walk: recorded as an accepted dependency risk (decision 1), not as resolved. |
| 3 | major — PGID and SID not captured; descendants may leave the group | Accepted; no signal of Practonaut's own. The tests read pid, ppid, pgid, sid and start time of the whole tree and look for survivors outside the group (decision 10). |
| 4 | major — a settled Playwright close is no proof of cleanup | Accepted: process end, promise result and directory cleanup are three statements (decision 5); a slot is freed on process end only. |
| 5 | major — partial budgets exceed 8 s; synchronous helpers block timers | Accepted: one deadline per close, passed down (decision 2). Closed in the re-review. |
| 6 | major — a hanging identity capture leaves the browser unreachable | Moot (no identity capture); the ledger takes the browser with its reservation (decision 7). Closed in the re-review. |
| 7 | major — three owners bypass `closeBrowser`; context closes can hang | Accepted: decision 2 for all four owners and their contexts. Closed in the re-review. |
| 8 | major — acceptance could pass without proof | Accepted: decisions 10 and 11 (independent survivor checks, the real CLI exit, full denominators, work completed). |
| 9 | minor — alternatives weighed with different standards | Accepted; each option states guarantee, cost and evidence. Closed in the re-review. |
| 10 | minor — the CDP trust boundary | Moot. Closed in the re-review. |

## Re-review (2026-10-19)

The second independent review, of the revision that chose a bounded request, by OpenAI Codex. It
confirmed that the CDP blocker is gone and found seven majors. Each claim was checked against the
code of pull request #68 and the installed `playwright-core` 1.64.0 before this revision.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 | major — Playwright already forces the end in a running host (`closeOrKill`, 30 s, then `kill()`; Windows `taskkill /T /F` synchronous); the measured 30.1 s is probably that timeout | Confirmed in source; the two 30.1 s closes of the load run were logged `<kill>`, `<will force kill>` and ended with `SIGKILL`; no public option sets the timeout | Accepted: the decision builds on that forced end (decision 1), with its Windows tree walk, its synchronous `taskkill` and its POSIX reaping window recorded as accepted dependency risks; the measurement separates graceful exits, Playwright's forced end and the caller's deadline (decision 11). |
| 2 | major — outer 8 s timers fire before the inner *abandoned* (`dispose`, the host's close step) | Confirmed by construction: `closeWithin` arms its timer before `terminate` starts the browser's; the host arms its step timer before `controller.close()` | Accepted: one deadline handed down, outcomes passed up, no outer timer at or before a deadline it passed down; the counterexample becomes a test (decisions 2, 10). |
| 3 | major — the cap of 3 is no guarantee (several hosts, parallel starts, active browsers that become abandoned later) | Confirmed: the check counted only pending closes, at start time | Accepted: a process-wide budget of running and closing browsers with synchronous reservations, held until process end; a recovery's replacement counts (decision 4). |
| 4 | major — a fulfilled close does not confirm cleanup; `failed late` must not free a slot | Confirmed in source (removal errors logged, close fulfils; the exit handler catches `rmSync` errors) | Accepted: three statements; a slot is freed only on process end; a failed close keeps it until exit (decisions 4, 5). |
| 5 | major — the sink port must stay reserved until the old browser is gone | Confirmed: `shutDown()` closes the sink in `finally` | Accepted: the sink lives as long as the browser's slot (decision 6). |
| 6 | major — the exit test can pass with a surviving helper; it must prove the browser alive just before exit and use the real CLI exit | Confirmed: `main.ts` only sets `process.exitCode`, so Node waits for Playwright's pending close; a preload that holds a close before it starts never reaches the exit handler | Accepted: the real CLI with a stalled browser group, the whole descendant tree read before and after, the normal end and the bench's `process.exit` as two cases; Windows without a stall, its forced path a dependency risk (decision 10). |
| 7 | major — #64 could pass by moving failures | Accepted as stated | Accepted: work completed and recoveries published in every attempt, no new start, resource or shutdown failure, and abandoned closes where the before-run failed (decision 11). |
| — | gaps — register rules (one identity, one close promise, joining callers, context closes) | — | Accepted: decision 7, tested in decision 10. |
| — | gaps — a diagnostics writer that outlives the host | `server.ts` closes the diagnostics file in the host's close | Not adopted: no writer outlives its host. A host records what it knew while it lived; later outcomes stay in the bounded process ledger and the command reports them on stderr (decision 9). A writer without an owner would need its own lifetime and bound for little gain. |
| — | gaps — memory, profiles and sinks under overlapping recoveries | — | Accepted as measurements (decision 10) that set the budget; profiles are separate per launch (Playwright's `mkdtemp`), sinks per shell. |
| — | gaps — the #64 tools and docs are not in the reviewed snapshot | They are on `main` with #68 | Noted. |

## Re-review 2 (2026-10-19)

The third independent review, of the revision built on Playwright's forced end, by OpenAI Codex. It
closed findings 2 and 7 of the second round, accepted finding 1, and found three majors. Each was
checked against the installed `playwright-core` 1.64.0 before this revision.

| # | Finding | Check | Disposition |
|---|---|---|---|
| 1 | major — a failed launch can drop a browser that still runs from the budget: after the process started, `_innerLaunch` starts `browserProcess.close()` but awaits it through an already-aborted `progress.race`, so the launch rejects while the close and its 30 s timer run; the shell's error path closes the sink at once | Confirmed in source (`_innerLaunch`'s `catch` and `race` against the rejected abort promise) and in `shell.ts:241` | Accepted: a launch rejection is a promise result, not a process end; the entry, its slot and its sink stay until the check proves the end (decisions 4–7); a real launch rejected after the spawn is tested (decision 10). |
| 2 | major — a fulfilled public `browser.close()` does not prove the process ended: it swallows `TargetClosedError`, which it gets when the connection dropped and the dispatcher is gone, and then no `browserProcess.close()` and no forced end ever start | Confirmed in source (the client's `close` swallows `TargetClosedError`; the dispatcher disposes itself on `Disconnected`; a message without a dispatcher is answered with `TargetClosedError`) | Accepted: process end is proven only by a read-only check of the launch's own command-line switch — not by the promise and not by a process id that can be reused; the three statements are independent (decision 5). Where no forced end is coming, a command that finishes its work exits explicitly so Playwright's exit handler ends the child it holds (decision 9). Considered and not taken: `disconnected` (fires early in shutdown and on the same dropped connection), Playwright's own view of the child's exit (only in its debug log, not public) and a process id from CDP with its start time (needs a pid, which a rejected launch never yields, and `ps lstart` has one-second resolution; the switch needs neither). |
| 3 | major — exit test case A asked for a browser alive just before Node exits, which the normal CLI path makes impossible (Playwright's child, pipes and close timer keep Node alive until its forced end) | Confirmed: `main.ts` sets `process.exitCode`; Playwright's 30 s timer and the child's handles are referenced | Accepted: in A the browser is recorded alive when the bounded close returns to the caller, and survivors are checked after the natural exit; the "alive just before `process.exit()`" proof is case B's only (decision 10). |

Second-round statuses after this revision: 3 (budget) — the slot follows the proven end, launch
rejections included; 4 (cleanup) — process end, promise result and directory cleanup are three
independent statements; 5 (sink) — the sink follows the same proof; 6 (exit test) — cases A and B
ask only what their paths allow. Still open by design: the memory, sink and profile measurements
under overlapping recoveries (decision 10), which set the budget.

## Re-review 3 (2026-10-19)

The fourth round reviewed the revision with the process-table reader (round 4): OpenAI Codex, and a
Claude Opus reviewer whose findings a skeptic re-weighed (F1–F3 to minor, F4 kept major). Both agreed
that the reader was the weak point; the reviewer proposed the simpler design the maintainer adopted
(decision 5: no reader in the product, Playwright's own close as the proof). The proof claim was
checked against the installed `playwright-core` 1.64.0 and is cited in *Context*.

| Source | Finding | Check | Disposition |
|---|---|---|---|
| Codex 1 | major — truncated `ps` output (no `-ww`, inherited `COLUMNS`) answers *ended* while Chromium runs | The reviewer measured it in the Playwright Ubuntu image (procps-ng 4.0.4) | Moot: no process-table reader in the product (option f). The tests' own reads use full-width output and a clean environment. |
| Codex 2 | major — a permanently *unknown* answer never reaches the 35 s exit; the combined path of a fulfilled close, a live child and no proof leaves the command running | Follows from round 4's rule (exit only on *present*) | Accepted: no *unknown* state any more; the 35 s rule fires on any entry not yet released, after the command's shutdown and flushed writes (decision 9); the combined path is a unit test (decision 10). |
| F1 | minor (skeptic; reviewer: major) — a read before Chromium exists answers *ended*; "launch settled" was not defined | Holds for the reader; no current caller reaches it, but decision 8's abort would | Accepted: no reader; a launch is judged by Playwright's own promise for the whole `launchChromium` call, an entry whose caller race was lost stays *launching*, and a late browser joins the one close (decisions 5, 7); unit test (decision 10). |
| F2 | minor (skeptic) — `ps` truncation on Linux | As Codex 1 | Moot: no reader. |
| F3 | minor (skeptic) — no `ps` in slim containers; `execFile` output limit; Windows reader cost and self-match; *unknown* forever | Measured by the reviewer (`python:3.12-slim-bookworm` has no `ps`) | Moot: no reader. The cases the reader was meant to cover are decided without one: launch wait, hold until exit, the 35 s rule (decisions 5, 9). |
| F4 | major — the mirror's close waits in the serial queue behind a recovery whose start gets no abort and runs up to 15 s + 60 s; `recover` has no deadline | Confirmed in the code on `main` (`mirror.ts` `close()` and `registration.create` without a signal); the reviewer measured 11.9 s against the host step's 8 s with a stand-in start | Accepted: `recover` takes a deadline in two parts, the start gets an abort signal, and the mirror's close does not wait in the queue: it aborts the start, closes what exists under its own deadline and settles as *closed*, *abandoned* or *cancelled* (decision 8); test (decision 10). |
| F5 | minor — a start beyond the budget is refused at once; bench's judged runs then depend on machine load; the budget covers only one recovery and not the start check's browser | Holds (`bench` starts one host per run) | Accepted: a start waits for a slot within its launch bound before it is refused; a bench run lost to the budget is `infra_error` with that reason and counted, and the record says the judged set can depend on load; the budget's starting value is 8, sized for two overlapping recoveries and the start check's browser, to be set by measurement (decisions 4, 10, 11). |
| F6 | minor — the reader loads every command line of the user | Holds for the reader | Moot: no reader. Test reads keep only what they match and print no other process's command line. |
| F7 | minor — ending an overrunning reader is a signal | Holds for the reader | Moot: no reader. |
| F8 | minor — "work done" is undefined for commands that outlive `main` (`practonaut mcp`) | Confirmed: `mcp` returns 0 from `main` at once and runs until stdin closes | Accepted: decision 9 defines the end of shutdown per command, `mcp` included, and never while a host is open. |
| F9 | minor — on Windows the temporary directory comes from `TEMP`/`TMP`, so a `TMPDIR`-only check is empty | Confirmed for `os.tmpdir()` on Windows | Accepted: the tests set `TMPDIR` on POSIX and `TEMP` and `TMP` on Windows and assert the directories appeared before asserting they are gone (decision 10). |
| F10 | minor — `BrowserServer.process()` is a public `ChildProcess`; option (a) deserves another look under the proof requirement | Confirmed (`types/types.d.ts:20759`) | Weighed again: strongest proof, no residual window; not chosen, the listener being the deciding cost, because Playwright's own close proves the end where it ran and the remaining cases only hold a slot longer; first candidate if those cases appear (option a, re-assessment triggers). |
| F11 | minor — the rejected-launch test can pass without exercising the path | Holds: whether the spawn precedes a short timeout depends on the machine | Accepted: an attempt counts only if the test's own read found the spawned Chromium after the rejection; otherwise it is repeated with a longer timeout, up to a fixed number of tries, then the test fails (decision 10). |
| F12 | minor — the report card's per-picture context closes are not under the contract | Confirmed (`withClose` per picture; unbounded on success) | Accepted: each context close goes through the contract under the command's deadline, keeps the pictures taken, and a context still closing ends with its browser's one close (decision 2); unit test (decision 10). |
| — | the reviewer's simpler design | — | Adopted by the maintainer (decisions 4–9). It gives up two things, both recorded: detecting a Playwright kill that failed (its close then never fulfils, so the slot stays held anyway), and the one-turn residual window (decision 5), the one case in which a slot and the sink are freed before the child has ended. |

Earlier rounds' statuses: Re-review 2's disposition of its finding 2 (the command-line switch) is
superseded by decision 5 as revised here; its findings 1 and 3 stay closed, now through Playwright's
promise and the launch wait instead of the reader.

The fifth round (OpenAI Codex, 2026-10-19) found no blocker or major, confirmed the cited
`playwright-core` 1.64.0 lines (with the caveat that the public close alone proves nothing, because
it swallows `TargetClosedError`, 64308–64310) and found one minor: option (a)'s trade-off said the
residual window never frees a slot early, which decision 5 accepts it does. Option (a) and the
simpler-design row above now name that exception.

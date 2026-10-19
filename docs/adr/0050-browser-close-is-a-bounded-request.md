# PADR-0050 — A browser close is a bounded request on top of Playwright's own forced end

Status: proposed · Date: 2026-10-19 · Issue #64 · Builds on
[PADR-0032](0032-chromium-sandbox-stays-on.md) (one way to start Chromium),
[PADR-0045](0045-adapter-registry-and-browser-shell.md) (browser shell, sink proxy, time bounds) and
[PADR-0012](0012-excalidraw-bundling.md) (the engine is served without a local listener) · Records the
maintainer's decision of 2026-10-19: **in 0.3.0 Practonaut signals no process it did not spawn
itself** · Revised after three independent reviews (OpenAI Codex, 2026-10-19): the first rejected a
forced end through a CDP process id, the second showed that Playwright already forces the end through
the handle it owns, the third that neither a launch rejection nor a fulfilled `browser.close()` proves
that the process ended; dispositions in *Review*, *Re-review* and *Re-review 2* at the end · Design
only; accepted with the pull request that implements it

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

## Measurements

macOS 27 (Apple M4), Node 22.22.3, Playwright 1.64.0 with its headless shell, 2026-10-19. Probes in
`.local/` start their own browser and signal nothing but it (not kept in the repository). Source facts
are from the installed `playwright-core` 1.64.0.

| Question | macOS | Linux | Windows |
|---|---|---|---|
| Playwright's close timeout, then its forced end | 30 s, then `kill()` (source); measured: 2 of 60 closes under load ended at 30.1 s with `SIGKILL` | same source | same source; `taskkill /T /F` synchronous, no timeout |
| Close timeout settable through a public option | no (only the test-mode hook) | same | same |
| `Browser.process` on a launched browser | `undefined` | same API | same API |
| Graceful exits under load (60 closes) | 27 ≥ 1 s, exit code 0, up to 11.4 s; 10 at 10.0–10.1 s | UNKNOWN | UNKNOWN |
| `disconnected` against the process exit, under load | `disconnected` 21–115 ms after the request, exit up to 3.6 s | UNKNOWN | UNKNOWN |
| Temporary directories per launch | profile and artifacts (source) | same | same |
| Removal error on close | logged, close fulfils (source) | same | same |
| Launch rejected after the process started | the launch's close runs on with its 30 s timer; no `Browser` returned (source) | same | same |
| `browser.close()` after the connection dropped | `TargetClosedError` swallowed, fulfils, no process close started (source) | same | same |
| A unique switch on the launch command line (`--practonaut-launch=<128-bit hex>`) | Chromium starts with it; only the browser root carries it (the renderer, GPU and network processes do not); a read of the process table takes 45.5 ms median, 65 ms max (10 reads, loaded machine); after the close no process carries it | UNKNOWN | UNKNOWN |
| Process group | the browser leads its group (PGID read); three children share it; SID not read | same source; zygote and sandbox helpers UNKNOWN | no groups (source) |
| Peak memory per browser, and during a recovery with the old browser still closing | UNKNOWN | UNKNOWN | UNKNOWN |
| `launchServer()` | listener on `[::1]`, 32-hex path, second client drives the browser, wrong path `400`, `kill()` 7 ms | UNKNOWN | UNKNOWN |

## Options considered

Each option with what it guarantees, what it costs and what is measured.

**(a) `launchServer` and `BrowserServer.kill()`.** *Guarantee:* Playwright's kill through its handle.
*Cost:* every browser operation through a WebSocket endpoint the Node process listens on — endpoint
disclosure (the port is visible, the 128-bit path is not), control (none without the path, `400`;
full with it), denial of service (anyone can connect to the port). The threat model trusts same-user
processes (`docs/security/threat-model.md` §3, 1). *Evidence:* macOS only. Not chosen: since the
second review it adds nothing, because `launch()` already gets the same kill through the same kind of
handle (`closeOrKill`), without a listener.

**(b) The browser's process id from CDP, verified, and a signal of Practonaut's own.** Rejected
(first review, findings 1–3): the identity is not bound to the browser whose close is pending, `ps
lstart` has one-second resolution, and a Windows tree walk follows parent ids that may be reused.

**(c) A process-group or job-object launch of Practonaut's own.** A job object needs native code or a
wrapper around the one start (PADR-0032). Not chosen; re-assessment trigger.

**(d) Leave the close as it is and run `challenge-round.test.ts` alone in CI.** Changes nothing for
users. Interim CI measure only (decision 11).

**(e) A bounded request on top of Playwright's own close and forced end.** *Guarantee:* no caller
waits longer than its deadline; no work that succeeded fails because a browser closes slowly;
Practonaut signals nothing; every browser launched stays reserved in a process-wide budget until a
read-only check proves its process ended; the forced end is Playwright's, through the handle it spawned
and holds, 30 s after the request. *Cost:* Playwright's forced end carries its own risks (decision 1);
a browser that closes slowly holds a budget slot, its sink and memory for up to 30 s; a command waits
for it before it exits. *Evidence:* source and the macOS load runs. Chosen.

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
   **deadline** (a monotonic time) from its caller, by default the request plus 8 s, and runs the
   owner's context closes first within the same deadline. It always settles by that deadline with an
   outcome: **closed** (Playwright's close fulfilled), **failed** (it rejected) or **abandoned** (still
   running at the deadline). Every layer above — the adapter's `terminate`, the mirror's `dispose`
   and `close`, the session's `close`, the host's close steps, the commands — passes its own deadline
   down and reads the outcome; none arms a timer of its own that ends at or before a deadline it has
   passed down. (The second review's counterexample: `closeWithin` in the mirror starts its 8 s timer
   before `terminate` starts the browser's, so the outer one fires first and turns an *abandoned* into
   a `BrowserDeadlineError`; the host's step timer does the same.) A safety timer that remains above
   the contract, such as the host's 12 s overall close, ends later than every deadline it hands down,
   and its firing counts as *failed*.
3. **After the deadline the caller goes on.** Work that succeeded is not failed by an *abandoned*
   close: a render check returns its report, a report card its pictures, `run` its result, a start
   check its answer, a host close resolves. After a failure the original failure is what the caller
   gets, with an abandoned or failed close next to it (`closeAfterFailure`, #68). A host close
   reports "could not be fully confirmed" only for a *failed* close.
4. **A process-wide browser budget with reservations.** Every launch reserves one slot,
   synchronously, before Playwright's launch starts; JavaScript runs one thing at a time, so two
   starts cannot both see the last free slot. The slot stays reserved while the browser runs and
   while its close is pending, and is released only when the check of decision 5 proves the process
   ended — not when Playwright's close fulfils, and not when a launch rejects. A launch that rejects,
   a close that failed and a close that fulfilled without that proof all keep their slot; one whose
   end is never proven keeps it until the Node process exits. The budget,
   `HOST_LIMITS.browsers`, counts running and closing browsers together, across every host in the
   process; a recovery's replacement reserves its own slot while the old browser still holds one. A
   start beyond it is refused by name, `browser_budget_exhausted`, as a start that fails is refused
   today: `--mirror auto` goes on model-only with a notice, `--mirror required` and `run` stop with
   the named error (exit 3), a recovery leaves the session without a mirror. The starting value is 6:
   the largest legitimate configuration, an author host with four practice hosts (five mirrors) and
   one recovery replacement. It is confirmed or lowered by the memory measurement (decision 10). The
   budget bounds the browsers Practonaut launched whose end is not proven; the browser's helpers are
   not counted and are looked for in the tests only.
5. **Three independent statements per close, and how the end is proven.**
   - *Promise result:* what Playwright's call did — a close *closed*, *failed* or *abandoned*
     (decision 2), a launch resolved or *rejected*. It says nothing about the process: a fulfilled
     close may have swallowed `TargetClosedError` without closing anything, and a rejected launch may
     leave a running process behind with Playwright's close of it still underway.
   - *Process end:* proven only by a read-only check. Every launch carries a switch of its own on
     Chromium's command line, `--practonaut-launch=<128-bit random hex>`, made with the reservation
     (decision 7); only the browser root carries it (measured on macOS). The check reads this user's
     process table — POSIX: `ps -U <uid> -o pid=,command=` run as a file, no shell; Windows:
     `Win32_Process` filtered by command line — asynchronously, within `BROWSER_BOUNDS.inspect`, and
     answers *ended* when no process carries the switch, *present* when one does, and *unknown* when
     the read fails or runs out of time. A reused process id cannot pass for the browser, because the
     switch is part of the command line, not of the id; anything else that carries it keeps the slot,
     the safe direction. The check runs when a close or a launch settles and then every 5 s for each
     entry not yet ended, one read at a time for the whole ledger. It never decides a signal; nothing
     in Practonaut signals. The helpers (renderer, GPU, network service) do not carry the switch;
     their end is checked in the tests only (decision 10).
   - *Directory cleanup:* not confirmable through Playwright's API — it logs a removal error and
     fulfils — so Practonaut reports it as unconfirmed and never frees a slot because of it; the tests
     check the profile and artifacts directories under a test-owned `TMPDIR`. Nothing in Practonaut
     infers cleanup from a call to `rm` or `rmSync`.

   The three are recorded separately; none is inferred from another.
6. **The sink belongs to the pending close.** The shell's sink proxy stays bound for as long as its
   browser's slot is reserved: it is closed when the check proves the process ended (decision 5) — not
   in the `finally` of the close request, and not in the launch's error path, which today closes it at
   once (`src/adapters/browser/shell.ts:241`). A browser whose launch rejected or whose close is
   abandoned, failed or unproven keeps its proxy address pointing at Practonaut's sink, so no other
   local process can take that port and receive the connections the browser opens below the page
   (PADR-0045's sink).
7. **Register rules.** One ledger entry per launch, created with the reservation and the launch's
   switch; it becomes the browser when the launch resolves; a launch that rejects keeps its entry, as
   *launch rejected*, until the check proves its end. One close per browser: the
   first close request calls `browser.close()` once; every later request (the shell's, the mirror's,
   a host's) joins that promise and gets its outcome against its own deadline. A context close is a
   step of its owner's close, inside the same deadline, with no entry or slot of its own.
8. **Mirror recovery** asks the old adapter to close against the recovery's deadline; once the
   outcome is known (closed, failed or abandoned), it starts the replacement in a slot of its own and
   publishes it only after its read-back equals the committed Practonaut state, as today. A late
   write of the old browser cannot reach the replacement: it is another process with its own page,
   profile and sink.
9. **What the user sees.** Nothing in the Player or over MCP. A host's private diagnostics record the
   closes it abandoned while it lived; no diagnostics writer outlives its host. What happens to a
   close later stays in the process ledger (the last 64 entries: closed late, failed late, or still
   pending; one that fulfils 30 s or more after its request is marked as probably ended by Playwright's
   forced end — Playwright's own log is the proof, and the tests read it),
   and the command reports it on stderr when it ends, in English and German. A command that still has
   closes pending says so before Node waits for them: *Waiting for N browsers to close; Playwright
   ends them within 30 s of the request.* A browser can stay *present* with no forced end coming —
   its close fulfilled through a swallowed `TargetClosedError`, so Playwright never started its
   `closeOrKill` — and Node, which still holds the child, would wait for it. So a command whose work
   is done and whose output is flushed, and which 35 s after its last close request still finds a
   browser it launched *present*, says so on stderr and ends with `process.exit`, so that Playwright's
   exit handler ends the child it still holds. Whether Chromium in this state ever exits on its own is
   UNKNOWN. A refused start names `browser_budget_exhausted`, how many browsers are running and
   closing, and the remedy (wait, or restart Practonaut).
10. **Tests that fail without it.**
    - Unit, Node's mock clock, a fake browser whose close never settles, for each of the four owners:
      the owner's call returns at the deadline with its own result (or its own failure) and the
      outcome *abandoned*; the slot stays reserved; when the fake close settles and the stubbed check
      answers *ended*, the slot is released and the ledger records both.
    - Unit, the review's counterexample as a test: a never-settling browser close under the mirror's
      `dispose` and under a host close yields *abandoned* at every layer, never a `BrowserDeadlineError`
      from an outer timer.
    - Unit, the budget: seven starts in the same turn with a budget of 6 — exactly one is refused;
      a slot is freed only when the check answers *ended*, whatever the close's outcome; a recovery
      holds two slots until the old browser's end is proven.
    - Unit: the sink is not closed while its browser's close is pending, nor after a launch rejects,
      and is closed when the check proves the end; joining callers share one `browser.close()` call;
      context closes take no slot.
    - Unit, a stubbed process table: a launch that rejects keeps its slot and its sink until the
      check answers *ended*; a close that fulfils while the check answers *present* keeps both; an
      *unknown* read keeps both; another process with the browser's old id but without its switch does
      not count as the browser; the command's `process.exit` comes only after its output is flushed and
      only when its own browser is still *present* 35 s after the last close request.
    - Integration, real Chromium, a launch rejected after the process started (the launch's own
      `timeout` set short enough that Playwright spawns Chromium and gives up while connecting): right
      after the rejection the slot and the sink are held; the test's own process-table read finds the
      switch or not; the slot and the sink are released only when the check answers *ended*, which
      happens once Playwright's background close has ended the child (within its 30 s).
    - Integration, POSIX, the real CLI (`practonaut run --mirror required`): a test preload reports
      the browser's process id from CDP; the test confirms it is a descendant of the CLI process it
      started and stops that browser's group (`SIGSTOP`, test-only, on the tree its own child
      launched), so no graceful close can finish. (A) Normal end: when the bounded close returns
      *abandoned* to the caller and `run` prints its result, the test reads the whole descendant tree
      (pid, ppid, pgid, sid, start time) and finds the browser alive, its switch present. Node cannot
      exit while Playwright holds the child, its pipes and its close timer, so no "alive just before
      exit" is asked here: the CLI exits naturally after Playwright's forced end (about 30 s), and
      afterwards none of the recorded processes remains and the test-owned `TMPDIR` holds no
      `playwright_*` directory. (B) Exit handler: a bench whose second interrupt calls
      `process.exit` while the close is pending; the test reads the tree and finds the browser alive
      immediately before it sends that interrupt, and finds none of those processes, and no
      directory, after the exit. Windows has no
      deterministic way from Node to stall Chromium (UNKNOWN): there (A) and (B) run without the
      stall and check survivors and directories only; the forced path stays an accepted dependency
      risk, counted in the repeat.
    - Measurement, POSIX and Windows: peak memory (resident size summed over each browser's process
      tree), sinks and profile directories while a recovery runs with the old browser still closing,
      and two such recoveries overlapping. It sets `HOST_LIMITS.browsers`.
11. **Before and after (acceptance of issue #64).** Comparable runs: the same Playwright, Chromium and
    Node versions, runners, load parameters and test parallelism; Linux with the sandbox and with the
    PADR-0032 fallback. *Before:* `main` with #68 only — `host-deadline-repeat` (5 jobs × 30 attempts
    per test, each platform, beside `challenge-round.test.ts`) and locally the amplifier with
    `--cpu 20 --block 20 --load 6` (before #68: 4 and 14 failures in 60 attempts). *After:* the same
    runs on the implementing branch. Reported both times, per platform and test, with full
    denominators:
    - attempts; **work completed** (the test's own assertions passed); mirror recoveries started and
      **published**; failures at the close; start failures (budget refusals included); resource
      failures; shutdown failures (a host close *failed*; a command that did not exit within
      Playwright's 30 s plus cleanup);
    - closes: closed in time, abandoned, failed; of the abandoned: ended gracefully, ended by
      Playwright's forced end, still pending when the command ended; launches rejected; and from the
      check: entries proven ended, still present when the command ended, unknown, and commands that
      had to end with `process.exit`;
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

- Practonaut signals no process. The forced end is Playwright's, with the dependency risks in
  decision 1; the threat model records them as Playwright's.
- No caller waits beyond its deadline, and work that succeeded does not fail because a browser closes
  slowly. A command may still wait before it exits — up to Playwright's 30 s after the last close
  request — and says so.
- The number of browsers Practonaut launched whose end is not proven is bounded per process; a
  recovery's replacement counts, and so does a launch that rejected after Chromium started.
- A slowly closing browser keeps its sink port and its directories for up to 30 s, and longer if
  Playwright's cleanup fails; cleanup is reported as unconfirmed, not assumed.
- Practonaut reads this user's process table, read-only, to prove that a browser ended: once when a
  close or launch settles and every 5 s while an entry is not proven ended (45.5 ms median per read on
  a loaded macOS machine; Linux and Windows UNKNOWN). Every Chromium start carries one more switch.
  A slot whose end is never proven stays taken until the process exits.

## Re-assessment triggers

- Playwright makes its close timeout public, or exposes a process handle or kill for launched
  browsers without a listener.
- A Windows job object or process handle becomes available from Node or a vetted addon (option c).
- Budget refusals appear in practice, or the memory measurement asks for a lower budget.
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

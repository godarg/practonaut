# PADR-0050 — A browser close is a bounded request: no forced end in 0.3.0

Status: proposed · Date: 2026-10-19 · Issue #64 · Builds on
[PADR-0032](0032-chromium-sandbox-stays-on.md) (one way to start Chromium),
[PADR-0045](0045-adapter-registry-and-browser-shell.md) (browser shell, network boundary, time bounds)
and [PADR-0012](0012-excalidraw-bundling.md) (the engine is served without a local listener) · Records
the maintainer's decision of 2026-10-19: **in 0.3.0 Practonaut signals no process it did not spawn
itself** · Revised after an independent review of the first draft (OpenAI Codex, 2026-10-19), which
proposed a verified forced end; dispositions at the end · Design only; accepted with the pull request
that implements it

## Context

Every browser Practonaut starts goes through `launchChromium` (`src/adapters/browser/chromium.ts:62`):
the mirror's shell (`src/adapters/browser/shell.ts:197`), the start check
(`src/cli/browser-start.ts:29`), the render check (`src/adapters/excalidraw/render-check.ts:26`) and
the report card (`src/bench/card-png.ts:27`). They close it four ways: the shell through
`closeBrowser` (`src/adapters/browser/bounded.ts:28`), Playwright's `browser.close()` within
`BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced` = 3 s + 5 s; the start check, the render check and
the report card with a plain `browser.close()` (the report card closes each context first). The names
promise a graceful step and a forced one; there is no forced step. Playwright offers none for a
browser started with `launch()` — `Browser.process` does not exist on it — and ends what is left only
when the Node process exits: its exit handler, which owns the child process handle, kills the
process tree and removes the temporary profile (Playwright 1.64 source, `killProcessAndCleanup`).

Issue #64 measured what that costs (`docs/testing.md`, *Host deadline tests*). Playwright's close
returns once Chromium has exited and Playwright has removed its temporary profile. On a machine short
of CPU, Chromium's own graceful exit — from Playwright's `Browser.close` request to the process exit —
grows from about 15 ms to seconds; many slow exits end at 10.0–10.1 s, two at 30.1 s. The profile
removal stays near or under a second. A plain Playwright Chromium without any of the shell's settings
shows the same 10 s exits; the sandbox and the page's `unload` listeners make no difference (scratch
runs, paired). Under load, then:

- a close that has an 8 s bound fails with `BrowserDeadlineError` although the browser is merely
  slow, and the browser keeps running until the Node process exits; a host close reports "Session
  shutdown could not be fully confirmed";
- a close without a bound waits as long as Chromium takes;
- a mirror recovery that must replace a browser fails when the old one does not close within the
  bound, and the session loses its mirror (measured once in 60 attempts under load);
- tests that close a real browser in their cleanup fail on a loaded runner (the two Windows runs of
  issue #64; the adapter layer twice on a loaded development machine).

Issue #64's first step (pull request #68) keeps the original failure when a close after it fails or
runs out of time (`closeAfterFailure`, `closeWithin`), tries every cleanup step of a failed host
start on its own, and bounds the mirror's wait for an old adapter. It does not change what a close
after successful work does.

## Measurements

macOS 27 (Apple M4), Node 22.22.3, Playwright 1.64.0 with its headless shell, 2026-10-19. Read-only
probes in `.local/` that start their own browser and signal nothing but it (not kept in the
repository). They were made for the first draft's forced end and are kept here because they decide
against it as much as for it.

| Question | Answer on macOS | Linux | Windows |
|---|---|---|---|
| `Browser.process` on a launched browser | `undefined` | same API, not run | same API, not run |
| CDP `SystemInfo.getProcessInfo` on the browser session | one entry `browser` with the process id, plus `renderer`, `GPU`, `network.mojom.NetworkService`; 1 ms | UNKNOWN | UNKNOWN |
| That id's parent | this Node process | UNKNOWN | UNKNOWN |
| Process group | Playwright spawns Chromium `detached` on every platform but Windows (source of 1.64), so the browser leads its own group (PGID read with `ps`); all three children share it; SID not read | same source; children UNKNOWN (zygote, sandbox helpers) | no process groups; Playwright ends a tree with `taskkill /pid <pid> /T /F` (source) |
| `ps lstart` resolution | one second | — | — |
| A killed child within one synchronous segment | stays a zombie with this process as parent through 300 ms of synchronous work and two `ps` calls; reaped only after an event-loop turn | UNKNOWN | UNKNOWN |
| Group stopped (`SIGSTOP`, the probe's own), then a group `SIGKILL` at 3 s | Playwright's close settled at 3 022 ms; no process of the group left | UNKNOWN | — |
| `launchServer()` | a WebSocket listener in the Node process on `[::1]` and a random port, path of 32 hex characters; a second client that knows the endpoint drives the browser; a wrong path gets `400`; `BrowserServer.kill()` ended the browser in 7 ms | UNKNOWN | UNKNOWN |
| A plain browser's `disconnected` against its exit, under load | `disconnected` 21–115 ms after the close request, exit up to 3.6 s | UNKNOWN | UNKNOWN |

## Options considered

Each option with what it guarantees, what it costs and what is measured.

**(a) `launchServer` and `BrowserServer.kill()`.** *Guarantee:* Playwright's own kill, through the
process handle it holds — no reused id. *Cost:* every operation on the browser, not only the close,
goes through a WebSocket endpoint the Node process listens on (`[::1]`, measured), a second local
control channel next to the host's. Taken apart: *endpoint disclosure* — the port is visible to any
local process, the 128-bit path is not (it lives only in this process's memory and is never passed
on a command line); *unauthorised control* — without the path a client gets `400` (measured), with it
full control of the browser; *denial of service* — any local process can open connections to the
port. The threat model trusts processes of the same user (`docs/security/threat-model.md` §3, 1)
and protects against other users and origins; a listener whose only gate is a secret path is the
same kind of gate as the host's session token. *Evidence:* macOS only. Not chosen for 0.3.0: it
replaces PADR-0012's "no local listener" for the engine with a permanent control listener for every
browser, and moves the whole shell onto `connect`; that is a larger change than the close needs now.
Kept as the first candidate if a forced end is needed later (re-assessment triggers).

**(b) The browser's process id from CDP, verified, and a signal (the first draft).** *Guarantee
claimed:* the id is re-verified as this Node process's child with its recorded start time in the same
synchronous segment as the signal. *Why it does not hold* (review, findings 1–3): the identity is not
bound to the browser whose close is pending. Chromium can die and be reaped between the CDP answer
and the system read, and the read then records another child of this process under the same id;
`ps lstart` has one-second resolution, so two incarnations of an id can share the recorded start
time. On Windows, `taskkill /T` follows parent ids that may already have been reused, and the
synchronous segment protects at most the root, not the tree it walks. Descendants can leave the
browser's group. *Evidence:* the macOS probes above show the parts that work; none of them closes
these gaps. Rejected for 0.3.0.

**(c) A process-group or job-object launch.** On POSIX Playwright already makes the browser a group
leader, which (b) relied on. A Windows job object assigned before Chromium's first instruction would
bind the whole tree to a handle Practonaut owns, but needs a native addon or a wrapper process around
the one start (PADR-0032); one assigned afterwards leaves a gap before the assignment. *Evidence:*
none measured. Not chosen for 0.3.0; with (a), the way to a safe forced end later.

**(d) Leave the close as it is and run `challenge-round.test.ts` alone in CI.** Removes the load the
two failed Windows runs shared, if that load is the cause there (not measured), and changes nothing
for users. Chosen only as an interim CI measure, if the measurement asks for it (decision 6).

**(e) A close is a request with a bounded wait, tracked until it ends.** *Guarantee:* no caller waits
longer than the close bound, no work that succeeded fails because a browser closes slowly, no signal
to any process, and every close still running is counted, capped and reported. *Cost:* a browser
that closes slowly may outlive its close until it finishes or the process exits. *Evidence:* the
macOS load runs (how long closes take); what Playwright's exit handler leaves is to be measured
(decision 7). Chosen.

## Decision

1. **One close contract for every browser Practonaut owns.** The shell, the start check, the render
   check and the report card close through the same function, and so does every context the report
   card closes before its browser. It asks Playwright to close and waits on **one monotonic deadline**
   from the request: the close bound, graceful + forced = 8 s, no part of it spent on anything else.
   Nothing in it runs synchronously long enough to hold the event loop, and nothing in it signals a
   process.
2. **After the bound, the caller goes on.** A close that settles in time is *closed*; one that fails
   in time is *failed* (its error, as today); one that is still running at the deadline is
   *abandoned*: the caller gets that outcome, not an error. Work that succeeded is not failed by an
   abandoned close: a render check returns its report, a report card its pictures, `run` its result,
   a host close resolves. After a failure the original failure stays what the caller gets, with an
   abandoned or failed close next to it (`closeAfterFailure`, issue #64 step 1). A host close
   reports "could not be fully confirmed" only for a close that *failed*, not for one abandoned.
3. **Abandoned closes are tracked.** Each one stays in a process-wide ledger until Playwright's close
   settles; the ledger keeps how many are pending and how each ended (closed late, failed late, or
   still running at exit). At `HOST_LIMITS.pendingBrowserCloses` = 3 pending closes, a new browser
   start in this process is refused by name, `browser_close_pending`, the way a start that fails is
   refused today: `--mirror auto` goes on model-only with a notice, `--mirror required` and
   `practonaut run` stop with the named error (exit 3), a mirror recovery leaves the session without a
   mirror. The cap is a count of browsers that may still run, not a timeout.
4. **What the user sees.** Nothing in the Player or over MCP. The host's private mirror diagnostics
   record each abandoned close and how it ended. A command that owns browsers (`serve`, `play`,
   `mcp --task`, `run`, `bench`, `report --card`, `doctor`) prints one line on stderr when a close is
   abandoned, in English and German: *Chromium has not closed within 8 s; Practonaut goes on and ends
   it when it exits.* At exit, if any are still pending, one line says how many. A refused start
   names `browser_close_pending` and the remedy (wait, or restart Practonaut).
5. **At process exit Playwright ends what is left.** Its exit handler holds the child handle, kills
   the tree (POSIX: the group; Windows: `taskkill /T /F` on the root it spawned and still holds) and
   removes the temporary profile synchronously. Practonaut adds no exit or signal handler of its
   own. What happens when Node is killed without an `exit` event is not covered (decision 7 measures
   the `exit` case).
6. **Mirror recovery does not wait for the old browser beyond the bound.** An interrupted recovery
   requests the old adapter's close; once that close is closed, failed or abandoned, it starts the
   replacement (subject to the cap in point 3). A late write of the old browser cannot reach the
   replacement: it is another browser process with its own page. The replacement is published only
   after its read-back equals the committed Practonaut state, as today; that state, not anything the
   old browser held, is what counts.
7. **Tests that fail without it.**
   - Unit, Node's mock clock, for each of the four owners (shell, start check, render check, report
     card with its contexts): a fake browser whose close never settles makes the owner's call return
     at the bound with its own result (or its own failure), the close *abandoned*, the ledger at 1;
     when the fake close settles later, the ledger goes back to 0 and records *closed late*. Without
     the contract the call waits for good (start check, render check, report card) or fails with
     `BrowserDeadlineError` (shell).
   - Unit: with 3 pending closes, a mirror start, a recovery and `run` are refused with
     `browser_close_pending`; with 2 they start.
   - Unit: an interrupted recovery whose old adapter never closes starts the replacement at the bound
     and publishes it only after its read-back equals the committed state.
   - Integration (real Chromium, a child Node process the test starts; the close held by the test's
     own preload, no signal): the child abandons a close and exits; afterwards no process with the
     browser's recorded id and start time remains and its temporary profile directory is gone (read
     with `ps` and the file system only). Run on every CI platform; where it fails, the reliance in
     point 5 is not met there and this record is reopened.
8. **Before and after (acceptance of issue #64).** Comparable runs: the same Playwright, Chromium and
   Node versions, runners, load parameters and test parallelism; Linux with the sandbox and with the
   PADR-0032 fallback.
   - *Before:* `main` with #68 only. `host-deadline-repeat` runs 5 jobs × 30 attempts per test on
     each platform beside `challenge-round.test.ts`; locally the amplifier with
     `--cpu 20 --block 20 --load 6` (before #68: 4 and 14 failures in 60 attempts).
   - *After:* the same runs on the implementing branch.
   - *Reported, both times, per platform and test, with full denominators:* attempts; passes;
     failures at the close; other failures; closes; closes of a second or more; closes abandoned;
     closes still pending at exit; and per close the request, `disconnected`, the process exit, the
     start and end of the profile removal, the settling of Playwright's close and the return to the
     caller, measured separately (`disconnected` is not the process exit).
   - *Accepted when* no attempt fails at the close on any platform, and the after-run shows abandoned
     closes wherever the before-run showed close failures (a run in which no close was ever abandoned
     does not confirm the cause). Zero failures in 150 attempts bounds the failure rate only to about
     2 % at 95 % confidence; the record says so rather than "fixed".
   - *Interim:* if the before-run fails at the close on a platform, `test:integration` runs
     `challenge-round.test.ts` in a CI step of its own on that platform until the after-run is in;
     no required check is renamed.

## Consequences

- No process is signalled; the threat model does not change. A browser that closes slowly keeps
  running until it finishes or Practonaut exits; a long-running host (a bench, `mcp --task`) holds at
  most 3 such browsers before it refuses new ones by name.
- Callers no longer fail work that succeeded because a browser closed slowly: the adapter and
  integration layers' own cleanup stops failing under load, and a host close under load resolves.
- A browser left running holds memory and CPU on a machine that was already short of both; the
  ledger, the cap and the stderr line make that visible instead of failing.
- Whether Playwright's exit handler leaves nothing behind on Windows is unmeasured until decision 7's
  integration test runs there. On Windows that handler ends the tree with `taskkill /T`, the same tree
  walk finding 2 doubts; it is what every Playwright user gets at exit today, on a root whose handle
  Playwright still holds, and this decision neither adds to nor changes it.

## Re-assessment triggers

- Playwright exposes a process handle or a kill for launched browsers, without a listener.
- A Windows job object or process handle becomes available from Node or through a vetted addon
  (option c); then a forced end can bind to a handle, not a number.
- The ledger reaches its cap in practice (bench or `mcp --task` runs refusing starts), or browsers
  pending at exit survive Practonaut's exit on a platform (decision 7).
- The Windows repeat shows that the time goes into the profile removal rather than Chromium's exit.

## Review (2026-10-19)

An independent review of the first draft (forced end through a verified process id) by OpenAI Codex.
Its counterexamples were analytical; none was reproduced experimentally.

| # | Finding | Disposition |
|---|---|---|
| 1 | blocker — the recorded identity is not bound to the browser whose close is pending: it can die and be reaped between the CDP answer and the system read, and `ps lstart` has one-second resolution | Accepted. The forced end is rejected for 0.3.0 (option b); a forced end later needs a handle, not a number (re-assessment triggers). |
| 2 | blocker — Windows `taskkill /T` follows parent ids that may be reused; the synchronous segment protects at most the root | Accepted. No Windows tree kill; option b rejected. |
| 3 | major — PGID and SID not captured; descendants may leave the group; "group empty" is not "all browser processes ended" | Accepted; moot for this decision (no signals). Recorded for any later forced end: read PID, PPID, PGID and SID; report escaped helpers, never kill them by a later id list. |
| 4 | major — a settled Playwright close is no independent proof of cleanup; a hard end flushes no browser state | Accepted. This decision claims no cleanup at the bound; abandoned closes are tracked (decision 3), Playwright's exit handler is measured (decision 7), process exit and profile removal are measured separately (decision 8), and a recovery publishes only a replacement whose read-back equals the committed state (decision 6). |
| 5 | major — 3 s + identity check + `taskkill` + 5 s exceed 8 s; synchronous helpers block the timers | Accepted. One monotonic deadline from the request; nothing synchronous; no helper processes (decision 1). |
| 6 | major — a hanging identity capture inside `launchChromium` leaves the browser unreachable | Moot: no identity capture. Kept: the ledger takes the browser as soon as Playwright's launch returns, so a close is always reachable. |
| 7 | major — the start check, render check and report card bypass `closeBrowser`; the report card's context close can hang | Accepted. Decision 1 puts every owner and every context close under one contract; decision 7 tests each at its entry point. |
| 8 | major — acceptance could pass without proof (an empty group proves nothing; mocks prove only logic; no Windows force path) | Accepted. With no forced end there is no safety claim to prove; the effectiveness claim is measured with full denominators and abandoned counts, and a run without abandoned closes does not count as confirming the cause (decision 8). |
| 9 | minor — the alternatives were weighed with different standards (128-bit endpoint vs. job-object effort) | Accepted. Each option now states guarantee, cost and evidence; (a) is split into endpoint disclosure, control and denial of service, and with (c) it is the path to a forced end later. |
| 10 | minor — CDP's answer is a browser claim; the trust boundary should be explicit | Noted; moot for this decision. A later forced end treats the CDP id as the browser's claim, binds it to the operating system only through a handle, and takes it from a browser session before any app code loads. |
| — | gaps — Linux with sandbox and fallback; a time decomposition in which `disconnected` is not the exit; statistics of 150 attempts; CI isolation as an interim | Accepted: decision 8 (comparable runs, Linux both ways, separate timings, the 2 % bound, the interim CI step). |

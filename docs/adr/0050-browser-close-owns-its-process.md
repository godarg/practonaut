# PADR-0050 — The browser close owns its process: a verified forced end after the graceful step

Status: proposed · Date: 2026-10-19 · Issue #64 · Builds on
[PADR-0032](0032-chromium-sandbox-stays-on.md) (one way to start Chromium),
[PADR-0045](0045-adapter-registry-and-browser-shell.md) (browser shell, network boundary, time bounds)
and [PADR-0012](0012-excalidraw-bundling.md) (the engine is served without a local listener) · Design
only; to be reviewed independently before any implementation, and accepted with the pull request that
implements it

## Context

Every browser Practonaut starts goes through `launchChromium` (`src/adapters/browser/chromium.ts:62`):
the mirror's shell (`src/adapters/browser/shell.ts:197`), the render check, the report card and the
start check. Closing it is `closeBrowser` (`src/adapters/browser/bounded.ts:28`): Playwright's
`browser.close()` within `BROWSER_BOUNDS.graceful + BROWSER_BOUNDS.forced` = 3 s + 5 s. The names
promise a graceful step and a forced one; there is no forced step. Playwright offers none for a
browser started with `launch()` — `Browser.process` does not exist on it (measured below) — and ends
what is left only when the Node process exits. A close that does not finish in 8 s fails with
`BrowserDeadlineError` (operation `close`) and goes on in the background.

Issue #64 measured what that costs (`docs/testing.md`, *Host deadline tests*). Playwright's close
returns once Chromium has exited and Playwright has removed its temporary profile. On a machine short
of CPU, Chromium's own graceful exit — from Playwright's `Browser.close` request to the process exit —
grows from about 15 ms to seconds; many slow exits end at 10.0–10.1 s, two at 30.1 s, as if Chromium
waited out limits of its own. The profile removal stays near or under a second. A plain Playwright
Chromium without any of the shell's settings shows the same 10 s exits; the sandbox and the page's
`unload` listeners make no difference (scratch runs, paired). So under load the 8 s budget is spent
waiting for a graceful exit that is merely slow, and:

- a session or host close is reported as unconfirmed, and the browser keeps running until the Node
  process exits;
- a mirror recovery that must replace a browser fails when the old one does not close in 8 s, and the
  session loses its mirror (measured once in 60 attempts under load);
- tests that close a real browser in their cleanup fail in CI on a loaded runner (the two Windows runs
  of issue #64).

Raising the bound would only move the failure: Chromium's waits reach 30 s. What is missing is the
forced step.

The hard constraint: **never signal a process that is not Practonaut's own.** A process id is a number
the system reuses. The bench already ends what it starts: an agent's process group on POSIX, its tree
with `taskkill /pid <pid> /T /F` on Windows (`killProcessTree`, `src/bench/run.ts:197-209`), with the id
from its own `spawn`. Chromium is spawned inside Playwright, which keeps that handle to itself. The
archived [PADR-0027](archive/0027-private-player-bootstrap-handoff.md) (the
owned Player window, replaced by PADR-0029) designed a verified signal for one platform; its rule —
check the identity and signal in one synchronous JavaScript segment — is the starting point here.

## Measurements

macOS 27 (Apple M4), Node 22.22.3, Playwright 1.64.0 with its headless shell, 2026-10-19. Read-only
probes in `.local/` that start their own browser and signal nothing else (not kept in the repository).

| Question | Answer on macOS | Linux | Windows |
|---|---|---|---|
| `Browser.process` on a launched browser | `undefined` | same API, not run | same API, not run |
| CDP `SystemInfo.getProcessInfo` on the browser session | one entry `browser` with the process id, plus `renderer`, `GPU`, `network.mojom.NetworkService`; 1 ms | UNKNOWN (same protocol, not run) | UNKNOWN |
| That id's parent | this Node process | UNKNOWN | UNKNOWN |
| Process group | Playwright spawns Chromium `detached` on every platform but Windows (source of 1.64), so the browser leads its own group; all three children share it | same source: group leader; children UNKNOWN | no process groups; Playwright kills a tree with `taskkill /pid <pid> /T /F` (source) |
| Identity check (`ps -o ppid=,lstart=,stat= -p <pid>`) | median 3.6 ms, max 7.5 ms over 20 | `ps` or `/proc/<pid>/stat`; UNKNOWN cost | parent and creation time from `Get-CimInstance Win32_Process`; UNKNOWN cost |
| Can the id be reused between a check and a signal in one synchronous segment? | No: a killed child stayed a zombie with this process as parent, through 300 ms of synchronous work and two `ps` calls, and was reaped only after an event-loop turn | POSIX and libuv reap the same way; UNKNOWN measured | libuv keeps its process handle (which reserves the id) open until the event loop has run the child's exit; UNKNOWN measured |
| Group stopped (`SIGSTOP`, the probe's own) | `browser.close()` had not settled after 3 s | UNKNOWN | — |
| Verified `SIGKILL` to the group after 3 s | Playwright's close settled at 3 022 ms; no process of the group left | UNKNOWN | — |
| `launchServer()` | a WebSocket listener in the Node process on `[::1]` and a random port, path of 32 hex characters; a second client that knows the endpoint drives the browser; a wrong path gets `400`; `BrowserServer.kill()` ended the browser in 7 ms | UNKNOWN | UNKNOWN |

## Options considered

**(a) `launchServer` and `BrowserServer.kill()`.** Playwright's own kill, with a process handle it
owns. But the browser is then driven through a WebSocket endpoint the Node process listens on
(`[::1]`, measured), for every operation, not only the close. Any local process — other OS users are
untrusted in the threat model — can connect to it; only the 128-bit path stands between it and full
control of the browser, which renders world data and holds the mirror's state. PADR-0012 serves the
engine without a local listener for this reason, and PADR-0045's network boundary governs what the
browser reaches, not who reaches the browser; this option adds a control channel outside both.
Rejected.

**(b) The browser's process id from CDP, guarded.** `SystemInfo.getProcessInfo` names the browser
process; the shell records its identity right after the launch, while it is certainly alive: the id,
its parent (must be this Node process), its start time and, on POSIX, that it leads its own process
group. The forced step re-reads that identity and signals in one synchronous segment. Node keeps a
child's id reserved until its event loop has processed the child's exit (POSIX: the zombie is reaped
there; Windows: the process handle is closed there), so an id verified within that segment as this
process's child with the recorded start time cannot belong to another process yet. Measured on macOS
end to end. Chosen.

**(c) A process-group or job-object launch.** On POSIX Playwright already makes the browser a group
leader, so (b) signals the group, which ends the renderer, GPU and network processes with it; this
part of (c) is in the decision. A Windows job object that ends the tree when Practonaut closes it
needs a native addon or a process wrapped around Chromium's start; Node has no API for it, and
PADR-0032 keeps one way to start Chromium. Rejected for now (re-assessment trigger below).

**(d) Leave the close as it is and run `challenge-round.test.ts` alone in CI.** Removes the load the
two failed Windows runs shared, if that load is the cause on Windows (not measured), and fixes
nothing for users: a loaded machine still loses its mirror in a recovery and still reports an
unconfirmed close. Kept only as a CI measure if the review rejects (b).

Also weighed: CDP `Browser.crash` from the shell. The CDP pipe closes early in Chromium's shutdown:
in the load runs a plain Playwright browser was `disconnected` 21–115 ms after the close request
while its exit took up to 3.6 s, so a crash request cannot reach a browser that is already shutting
down slowly. Rejected.

## Decision

1. **Identity at launch.** `launchChromium` (the one start, PADR-0032) records the browser's identity
   once the browser answers: from a browser CDP session, `SystemInfo.getProcessInfo` must list
   exactly one `browser` entry whose id is a safe integer ≥ 2 and not this process; a system read
   (macOS and Linux: `ps -o ppid=,lstart=,stat=` run as a file, no shell, fixed `LC_ALL=C` and
   `TZ=UTC`, bounded at `BROWSER_BOUNDS.inspect`; Windows: the parent process id and creation time
   from `Win32_Process`, bounded the same way) must show this Node process as its parent, a start
   time and, on POSIX, that its process group is its own id. The session is detached; only the id,
   the start time and the platform's kind of end are kept, never logged. A browser whose identity
   cannot be recorded is not refused: its close stays graceful-only, as today (point 4).
2. **Close in two steps.** `closeBrowser` asks Playwright to close and waits up to
   `BROWSER_BOUNDS.graceful` (3 s). If the close has not settled, the **forced step**: in one
   synchronous segment, with no `await`, callback or timer in between, read the identity again and,
   only if the parent is still this process, the start time is the recorded one and (POSIX) the
   process is not a zombie, end it — POSIX: `SIGKILL` to the group (`-pid`); Windows:
   `taskkill /pid <pid> /T /F`, the way Playwright ends a tree. Anything else (gone, a zombie, another
   parent or start time, a read that fails or times out) sends nothing. Then wait up to
   `BROWSER_BOUNDS.forced` (5 s) for Playwright's close to settle; it includes the profile removal.
   The whole close stays within graceful + forced; one close at a time per browser; a second caller
   joins it.
3. **Outcome.** A close that settles after a forced end succeeds: the browser was Practonaut's and is
   gone. It carries `forced: true` for its callers. A close that does not settle within graceful +
   forced fails with `BrowserDeadlineError` (operation `close`), as today, and a failure after
   another one stays next to it (`closeAfterFailure`, issue #64 step 1).
4. **No identity, no force.** Where point 1 failed, or on a platform where the identity read is not
   available, the close is graceful-only within graceful + forced, exactly as today. Nothing ever
   signals an id that was not verified in the same synchronous segment.
5. **What the user sees.** Nothing in the Player or over MCP: a close or a recovery that needed a
   forced end simply completes. A command that owns the browser (`serve`, `play`, `mcp --task`,
   `run`, `bench`) prints one line on stderr, in English and German: *Chromium did not close within
   3 s and was ended.* The host's private mirror diagnostics count forced ends; a bench run writes them
   to its run logs; no verdict changes. A close that still fails reads as today
   ("Browser close exceeded its deadline of 8000 ms"; for a host, "Session shutdown could not be
   fully confirmed").
6. **Tests that fail without the mechanism.**
   - Unit (every platform; Node's mock clock; a fake browser whose close never settles and a stand-in
     for the identity read): the forced step runs once, at 3 s, with the recorded identity, and the
     close then settles; it never runs before 3 s, and it sends nothing when the identity read shows
     another parent, another start time, a zombie, or fails. Without the mechanism the close fails
     at 8 s with `BrowserDeadlineError`.
   - Integration (macOS and Linux; real Chromium): the test stops its own browser's process group
     (`SIGSTOP`, the group it launched), so the graceful close cannot finish; the shell's close must
     succeed with `forced: true` within 8 s and leave no process of that group. Without the
     mechanism: `BrowserDeadlineError` at 8 s with the stopped processes still there (the test ends
     them in its cleanup). Windows has no way from Node to stop a process: there the unit test and the
     repeat workflow stand for it (UNKNOWN until measured).
   - The host deadline tests and the mirror recovery test of `tests/unit/close-keeps-error.test.ts`
     keep passing unchanged.
7. **Before and after (acceptance of issue #64).**
   - *Before:* after issue #64's step 1 is on `main`, `host-deadline-repeat` runs 5 jobs × 30
     attempts per test on each platform, beside `challenge-round.test.ts`. The record gives the
     close-deadline failures per platform and, for each close, Chromium's exit against the profile
     removal; on Windows this is the first measurement of where the time goes.
   - *Cause fixed:* this decision implemented, with the tests above. The amplifier records forced
     ends next to each close.
   - *After:* the same workflow on the implementing branch. Accepted when no attempt fails at the
     close on any platform, the record shows forced ends where the graceful step ran out, and a
     forced end never touched a process outside the browser's group (the integration test's
     check). Locally, `amplify:host-deadline -- --cpu 20 --block 20 --load 6`, which failed 4 and 14
     of 60 attempts, fails none.

## Consequences

- Practonaut signals a process it did not spawn itself for the first time (the bench signals only
  its own spawned agents). The rule is narrow: only an id recorded from the browser's own CDP answer,
  re-verified as this Node process's child with the same start time in the same synchronous segment
  as the signal. The threat model gains this rule when it is implemented.
- A close under load takes at most 3 s plus the forced end and Playwright's cleanup, instead of
  failing at 8 s with the browser left running; a mirror recovery no longer loses its mirror because
  an old browser closes slowly.
- The identity read costs one CDP call (1 ms) and one system read (3.6 ms median on macOS) per launch;
  Windows' read through `Win32_Process` is slower, UNKNOWN by how much, and is bounded.
- Playwright's profile removal continues after a forced end; it is part of the forced step's 5 s.
- The 3 s graceful step is long against a normal close (15 ms to about 1 s measured) and short
  against Chromium's own 10 s and 30 s waits.

## Re-assessment triggers

- Playwright exposes a process handle or a kill for launched browsers.
- Node gains a job-object or process-handle API on Windows (option c).
- The Windows repeat shows that the time goes into the profile removal rather than Chromium's exit:
  a forced end would then not help there, and the forced step's 5 s is the wrong place to look.
- The identity read fails on a platform in CI, or a forced end is ever recorded for a process outside
  the browser's group.

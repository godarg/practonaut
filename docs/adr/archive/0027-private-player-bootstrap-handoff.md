> Archived 2026-10-12: superseded by [PADR-0029](../0029-normal-browser-cross-platform.md); Practonaut opens the normal default browser.

# PADR-0027 — Bootstrap through an owned pinned Player browser

Status: ⛔ superseded by [PADR-0029](../0029-normal-browser-cross-platform.md) (2026-10-11); was: accepted plan with mandatory R1–R11. Date 2026-10-09.

The original numeric-FD and osascript plan is abandoned after its preserved HIGH
P27-01 and mandatory conditions. No descriptor, OS opener, file handoff or default
profile is added. Choose the existing pinned Chromium runtime and Playwright:
CLI serve opens its own visible browser/context containing the actual Player,
using chromium.launch(headless:false,chromiumSandbox:true, handleSIG*false) and
page.goto(host.url) over Playwright's existing transport. Bootstrap code is absent
from all browser/process argv, ordinary stdout/stderr, MCP/tokenfiles, exports and
persisted logs. A fresh temporary context holds the existing Player tab credentials
within the accepted same-user boundary. The code remains a one-time60s fragment.
No new host route or credential issuance. It is not OS secrecy or a sealed launcher.
No code/rawPlaywright diagnostics or URL serialization may enter retained reports.

serve supports --player visible|headless; visible is the human default, headless
is an explicitly requested unattended local integration/testing browser, still
owned and author-capable, not an agent credential or mcp-only context. All duplicate
flags and unknown values reject through the existing parser. It works only with
the pinned Chromium already explicitly provisioned by setup. Even mirror:off needs
the Player browser. Runtime/platform/headless/GUI absence fails with catalogued
environment exit3; browser is never downloaded implicitly. No promise of Linux
GUI, Windows or arbitrary default-browser behavior. Source-bound macOS27/Node22
visible launch and installed headless launch are measured before acceptance.
Linux/Windows serve and start:recovery are refused in both modes before world load or browser launch because owned-process inspection is unsupported. Other darwin/Node combinations remain UNMEASURED and can fail boundedly with exit3.

One shared helper validates the canonical URL structurally before navigation:
http, exact127.0.0.1, integer1..65535 canonical port, / path, emptysearch/credentials,
fragment exactly code=32 lowercase hex; final reconstructedURL must equal input.
Wrong host/port/userinfo/path/query/fragment/newline/encoding rejects before launch.
No AppleScript/shell/fd exists. Launch/navigate/wait for actual Player ready are
bounded to15s each, below60s; cancellation closes/reaps owned browser and Host.
DEBUG=* or Playwright debug logging and PWDEBUG are refused before startHost;
raw Playwright errors are never exposed regardless of debug settings. Existing
same-OS-user instrumentation remains outside the privacy guarantee.

Arm SIGINT/SIGTERM teardown before startHost and all awaited startup. A cancellation
during startup is remembered, closes Host/browser as soon as obtained, and does not
print success. Startup error, navigation error/timeout, browser disconnect and token
expiry failure all take the same bounded cleanup. Host/browser lifecycle stays
foreground; closing the visible Player window ends this CLI-owned session. Removing
the active tokenfile, listening port and owned descendants is tested, including
interrupt during handoff, absentbrowser, invalidURL and failednavigation. No other
user-owned browser/host is touched. Bounded teardown failure is truthfully an
environment failure and not a successful close.

Print only origin, practice-token path, mirror mode and catalogued EN/DE text stating
that the pinned Player browser was started. No instruction to open a printed
bootstrap link. start:recovery uses the identical helper and catalogued startup text.
Record change from default-browser-link startup to an ephemeral pinned Player
window, and lack of default-profile persistence or default-browser integration.
Closing/restarting rather than new code routes handles expired bootstrap.

Inventory every startHost caller and every RunningHost.url reader. Programmatic
authorized tests/helpers may navigate/consume URL privately but cannot log or
serialize it. Every interactive starter routes through the helper. Tests use
fixed-message failures without raw stderr/stdout/URL actual fields and refuse
Playwright debug logging. A non-emission regression scans CLI argv/stdout/stderr/
tokenfile and owned browser argv using booleans/SHA/counts, never secret values.

Installed CLI smoke runs serve --player headless. It reads only public origin and
private Practice-token path from stdout. A second independent actual Player tab
may use the existing practice credential via /api/resume and v2 tab cache with
NO authorToken, never a bootstrap code. It verifies actual editor/board, seven MCP
tools, shared state and local fonts; direct author APIs remain forbidden. Separate
installed-author functional tests use programmatic startHost privately and retain
the existing bootstrap tests. Headless flag is not an agent home/identity claim.

P27-01/02/05/09/11 FD-specific proposals are rejected by replacing the entire unsafe
mechanism, not by waiving risk. P27-03/06/07/08/10 lifecycle, support, inventory,
error/non-emission and bounds requirements are adopted for this mechanism. P27-04
OS-opener measurements are inapplicable because no LaunchServices/default-handler
is called; instead measure the exact pinned Chromium source/binary, browser argv,
launch timing, actual redemption and output. P27-12 same-user boundary stays.
All original C6/C10 capability conditions remain binding: no author credential
to editor origin/children/MCP, cachev2 sameHost binding, nonclear author_required,
noopener at creation, practice-only agent tabs. Fresh security/packaging/UI reviewers
differ from builders and both plan reviewers. No publication/account/config/user/
container/sealed changes. Revenue UNKNOWN.

## Mandatory R1–R10 (verbatim plan conditions, no implementation acceptance)

R1 (startup order, readiness). commandServe and start:recovery run these steps in order:
1. Argument parsing. --player is added to the existing serve parser; a duplicate, missing or unknown value is a usage error, exit 1.
2. Debug refusal: PWDEBUG present with any value, or DEBUG non-empty, gives catalogued exit 3.
3. World load.
4. Arm the R2 signal handlers.
5. chromium.launch for the requested mode (chromiumSandbox:true, handleSIGINT/SIGTERM/SIGHUP:false, timeout ≤15 s), then browser.newContext().
6. startHost.
7. newPage and goto(host.url), ≤15 s.
8. Ready, ≤15 s.
9. Success text.
A failure before startHost creates no token file, diagnostics file, listener, mirror browser or editor-assets listener; tests prove this by boolean/count.
Ready = the Player's POST /api/bootstrap observed with status 200 (status only) plus the board marker. Neither the CLI nor the smoke reads any /api/bootstrap body (no route.fetch, json, text or body).
An error render, non-200, page close, crash or timeout is a failed handoff.
The measured interval from created (server.ts:172) to ready is recorded with its margin to bootstrapTtlMs.

R2 (bounded teardown).
- RunningHost.close moves server.close inside the guarded block. Each close of children, author, editorAssets and controller gets a time bound stated in PADR-0027 and derived from R9 measurement. diagnostics.close and credential.remove always run, even when any step rejects or times out.
- One helper cleanup serves every path: signal, window close, browser disconnect or crash, startup/navigation/readiness failure, and expiry. It bounds browser.close. If the owned Player browser has not then exited, it terminates it only through R11.
- On an overall stated deadline, the helper removes the token file itself if still present and exits 3 with catalogued teardown text; never success.
- SIGINT, SIGTERM and SIGHUP handlers stay installed until exit. Repeated signals never fall through to default termination.
- Tests inject a hanging controller.close, a rejecting server.close, an externally killed browser, a double SIGINT, SIGHUP and window close. Each test proves by boolean/count that the token file is absent, the port is closed and no owned browser process remains.

R3 (errors, exits).
- The shared helper is the sole sanitizing boundary for serve and start:recovery. It throws only RuntimeError with catalogued codes (launch, handoff/readiness, teardown, debug refusal) and fixed EN/DE messages: no cause, no upstream message, no URL.
- main.ts maps these codes to exit 3, and the help exit table says so.
- start:recovery prints the same catalogued text and exits non-zero.
- Every Playwright event and promise feeds the single cleanup; there is no unhandled-rejection path.
- Tests force launch failure, goto network error, readiness timeout and browser kill. They assert exit 3, and assert by SHA/boolean that neither the code nor the fragment URL appears on stdout or stderr.

R4 (inventory).
- Scope: startHost callers; readers of RunningHost.url, .code and .token; any serialization or inspection of a RunningHost (logs, JSON, util.inspect, assertion diffs); every spawner of serve or start:recovery (tests, tools, CI, docs).
- AUTHOR_ROUTES.launch is recorded as the only in-band carrier of a child bootstrap URL: only in the author-authorized reply, to a phase3:false child that the Player opens with noopener inside the owned context (measured), never logged or persisted.
- Non-interactive spawners pass --player headless explicitly.
- The serve.ts:39-40 comment is corrected, including its browser-storage statement.

R5 (Player context).
- Use only chromium.launch plus browser.newContext(). Never launchPersistentContext, userDataDir, a remote-debugging port, launchServer or connectOverCDP; assert this from the measured browser argv.
- serviceWorkers:'block'. A context route admits only http URLs whose host is exactly 127.0.0.1 and aborts everything else, including user-typed navigation (measured).
- Measure where user-opened windows land (new window, new incognito window). If they fall outside the routed context, close them or record the residual with no claim.
- The non-emission scan adds the owned browser's temporary profile directory (during the run, and its absence after teardown) and the host's .mirror.jsonl.
- EN/DE text calls the window a Practonaut session window, not a general browser.

R6 (exports). Before implementation, PADR-0027 states from export.ts how a human export reaches the user. If it is a browser download, the plan either:
- specifies owned-context handling (for example, saving each completed download before teardown to a stated location announced in catalogued EN/DE text) and tests that an exported pair survives session end and is accepted by practonaut check --pair; or
- records the loss as an explicit regression accepted by the fresh UI and packaging reviewers.
No saved name, path or message contains credential material.

R7 (visible-mode emulation).
- The visible context sets viewport:null and colorScheme, reducedMotion and forcedColors to no emulation (null, or the pinned version's equivalent). It does not override deviceScaleFactor.
- Headless may keep fixed deterministic values.
- On macOS 27, the fresh UI reviewer measures the owned window for: OS dark mode, Reduce Motion, HiDPI scale, resize across 47.99em, zoom, and Player language versus CLI --lang.

R8 (text, doctor).
- serve's Chromium precondition is unconditional across mirror and player modes.
- EN/DE browserRuntimeMissing, chromiumPresent and help no longer say model-only serve needs no browser. Help lists [--player visible|headless].
- hostOpen and the uncatalogued start:recovery lines are replaced as the plan states.
- doctor's runtime profile requires Chromium, or reports a serve-specific failure, so doctor cannot pass while serve must exit 3. Tested.

R9 (measurement before acceptance). Evidence is source-bound to the exact helper, serve, server and start-recovery hashes and the pinned playwright-core/Chromium build. It is recorded only as hashes, booleans, counts and timings, and covers:
- macOS 27/Node 22 visible launch
- installed headless launch on every CI platform that runs the smoke
- full owned-browser argv: no code, no debugging port, switch list recorded
- launch, navigate and readiness timings
- actual redemption
- stdout and stderr
- the R5 scans
Every other platform/mode combination, including Linux and Windows visible mode, stays UNMEASURED with no claim; its failures are bounded and give catalogued exit 3.

R10 (carried over, binding).
- PADR-0023 C6/C10 remain binding: no author credential to the editor origin, children or MCP; v2 cache with same-host binding; non-clearing author_required; noopener at creation; practice-only agent tabs.
- K4, K7, K8, K9 and K11 apply as adopted, made concrete by R1–R8.
- Installed smoke: reads only origin and token path. Its second tab is practice-only via /api/resume and the v2 cache, with engineOrigin taken from the resume reply. It never uses a bootstrap code or authorToken, never intercepts /api/bootstrap, never calls direct author APIs, uses fixed-message failures and refuses a Playwright debug environment.
- Acceptance requires fresh security, packaging and UI reviewers distinct from the builders and from both plan reviewers, including this one.
- R1–R9 enter PADR-0027 verbatim before implementation. None is deferred or waived; any change requires a fresh plan re-review.
- No publication, account, config, user, container or sealed changes.

## R6 settled actual export delivery and proposed process API correction

Measured source src/player/export.ts creates two Blob-backed anchor downloads named practonaut-session.json and practonaut.excalidraw; each opaque payload belongs to one cached envelope. Owned context will persist completed downloads in .local/exports/<fresh-run-nonce>, mode0700, exclusively created regular files, numbered fixed names for those two exports plus native-editor .excalidraw/.svg/.png exports. Maximum32MiB per download,64MiB total,20files; incomplete/oversized/unknown type refuses with fixed catalogued text and does not silently discard a successful pair. Download URLs/names/error messages never carry credentials into logs. Export files survive context/host teardown and pass separate check --pair. Announce exact private directory in EN/DE. These are ordinary user-selected export artifacts, not credential files.

The feasibility probe establishes only public-pipe PID discovery; its literal noHost/noCredential fields and reported chromium.executablePath are not measured acceptance. Browser.process does not exist on the pinned Browser; BrowserServer and launchServer remain prohibited. The independently approved amendment below replaces lazy binding, descendant PID signals and SIGTERM escalation with direct-child binding and a same-synchronous-segment verified SIGKILL under R11. This is plan approval only.

## R11 settled ownership and CI scope

Choose R11.9 option1 for every browser launched by the native adapter on darwin: each mirror and child host obtains its own R11.1–R11.6 binding before readiness and uses the same bounded cleanup helper. The common helper is src/adapters/excalidraw/owned-browser-process.ts; only browser launch/binding/close integration in index.ts belongs to the bootstrap fixer. raw.ts stays byte-identical. Non-darwin adapter use has bounded graceful close without any forced-ownership guarantee; interactive Host starters refuse before launch. Every timed-out or incomplete cleanup gives a fixed environment error, never success. No individual descendant signal is permitted.

Player and adapter bounds: capture and each ps/CDP operation ≤2s; launch plus capture ≤15s; graceful browser close ≤3s; forced confirmation including promise settlement/profile removal ≤5s; overall single-flight CLI teardown ≤15s. Host close steps each ≤3s and overall≤12s; credentials/diagnostics are removed in finally. These are declared budgets to be measured under R9/R11.10, with any real red bound retained.

Prepared CI local-contract runs macos-15/Node22.22.3. Prepared release prepare and installed exact-artifact smoke move from ubuntu-24.04 to macos-15/Node24.21.0/npm11.19.0; install chromium without Linux --with-deps. Linux is explicitly removed from installed serve smoke because R1-A refuses there, not recorded as PASS. macos-15/Node22 and24 remain UNMEASURED until an actual approved CI run; no workflow is activated here. The minimal publish-only job stays ubuntu-24.04 and runs no serve/build/install/test/smoke. GitHub's official runner reference lists macos-15 as available (looked up2026-10-09 at https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Fresh packaging acceptance must assess this removal and unmeasured prepared platform. Local acceptance measures macOS27/arm64/Node22 visible and installed headless.

Independent process-plan report digest: d6a762ce8117b7e0486b1be976c15339c5013f778577e62a09102f24f8ae7acd . Verbatim amendments follow and enter in union with R1–R10. The three earlier plan reviewers, builders and original audit finders cannot serve as independent delta reviewers.

R2-A (verbatim replacement, in R2 bullet 2, of the sentence 'It bounds browser.close, then kills and reaps browser.process().'): It bounds browser.close. If the owned Player browser has not then exited, it terminates it only through R11.
None of the following is used: Browser.process(), BrowserServer, launchServer, connectOverCDP, a remote-debugging port, a persistent profile, Playwright internals, or any added browser switch, including an automation flag. chromiumSandbox stays true.
All other R2 text, tests and outcomes are unchanged.

R1-A: Step 2 also refuses, with a new catalogued environment code (exit 3), on every platform where R11 inspection is unsupported. At present that means every platform other than darwin: Linux and Windows, in both modes.
Other darwin/Node combinations run R11 UNMEASURED, with no claim; their failures are bounded and give exit 3.
A new step 5a, between steps 5 and 6, performs R11.1–R11.2 within step 5's 15 s bound. A step-5a failure is a failure before startHost, so R1's no-token/no-listener proof applies. It closes the browser by bounded browser.close() only and sends no signal.

R11.1 (capture): One browser.newBrowserCDPSession(), and exactly one SystemInfo.getProcessInfo bounded at ≤2 s. Accept only:
- an array of ≤64 entries;
- exactly one entry of type 'browser';
- whose id is a safe integer ≥ 2 and ≠ process.pid. This id is P.
No other CDP method or domain is used except the single R11.2 confirmation, and Browser.getBrowserCommandLine is never called. Errors are consumed under R3. The session is detached before startHost. The reply is not logged, and nothing beyond P is retained.

R11.2 (binding): Run one /bin/ps via execFile (no shell) with arguments -ww -o pid=,ppid=,pgid=,stat=,lstart=,command= -p P, environment exactly {LC_ALL:'C', TZ:'UTC'}, timeout ≤2 s, a bounded buffer and an anchored grammar. Bind only if:
- pid = P, ppid = process.pid, and stat is not zombie;
- command starts with the R9-recorded absolute executable path for the requested mode, followed by a space;
- command contains --remote-debugging-pipe and no --remote-debugging-port;
- command contains exactly one --user-data-dir=, whose value matches the R9-measured Playwright temporary-profile pattern under realpath(os.tmpdir()) and is an existing directory owned by the current uid;
- a second SystemInfo.getProcessInfo, sent after the snapshot and bounded at ≤2 s, again returns P.
Record privately: P, ppid, pgid, lstart, executable, profile path, and the SHA-256 of the canonical tuple (pid, ppid, pgid, lstart, command). Group signalling is enabled only if pgid = P. Nothing from the record is logged; evidence holds only hashes and booleans.

R11.3 (signal rule): process.kill is called only with P, or with -P when group signalling is enabled.
Each call is preceded by a fresh R11.2-form ps snapshot, in the same synchronous JavaScript segment, with no await, callback, timer or promise boundary in between. The signal is sent only if that snapshot matches the bound tuple SHA and is not a zombie; otherwise nothing is sent.
Never signal 0, -1, any other negative value, a helper PID, or any enumerated process.
Sequence: the R2-bounded browser.close(); then, if the leader is in state (a), one verified SIGKILL to -P (to P if group signalling is disabled); then a bounded wait under R11.4.
There is no SIGTERM step. browser.close() is the graceful attempt, and a SIGTERM that lets the leader be reaped first would leave its group unsignallable.
Every wait has a bound stated in PADR-0027, derived from R9, inside the overall R2 deadline. Cleanup is single-flight; concurrent triggers join it.

R11.4 (classification): Observations after any yield may use asynchronous ps but never justify a signal. Each observation is exactly one of:
(a) bound: tuple matches and not a zombie. This is the only state that may be signalled (R11.3).
(b) zombie: pid = P, ppid = process.pid, same lstart, zombie stat. Wait; never signal.
(c) gone: P absent (empty output with the measured not-found status), or present with a different ppid or lstart. The leader was reaped; P and -P are never signalled again.
(d) unknown: anything else, including same ppid and lstart with a different command, a parse failure, or a ps timeout or error. Never signal; keep waiting.
Leader success requires (c). If (a), (b) or (d) remains at the overall R2 deadline, the helper performs R2's token-file removal and exits 3 with catalogued teardown failure text, never success.

R11.5 (residual proof): 'No owned browser process remains' (R2 tests, R9) is proved by a count of 0 over:
- the bound leader;
- processes with pgid = P;
- same-uid processes whose argv contains the exact bound profile path.
System-wide listings read only pid, ppid, pgid, uid and executable path. argv is read only for same-uid candidates whose executable lies inside the pinned browser installation, and is reduced at once to that boolean.
The count may over-include, which can only produce a false failure. It never selects a signal target. A count over P's parent-link tree is not accepted. Processes outside a verified group P are never signalled; if any remain at the deadline, the result is teardown failure (exit 3).

R11.6 (Playwright interaction): After any forced signal, the pending browser.close() promise is awaited to settlement within the overall deadline. Its rejection is consumed under R3: no unhandled rejection, no upstream text. R5's absence of the temporary profile after teardown is verified as a boolean; a remaining profile is teardown failure. No Playwright-internal exit-time kill is relied on or claimed.

R11.7 (exports, R6 ordering): Persisting each download starts on the context's download event and finishes as soon as the download completes. Cleanup awaits in-flight persistence (bounded, inside the overall deadline) before browser.close() or any R11.3 signal. A download not persisted by then gets the catalogued R6 text; none is dropped silently.

R11.8 (platform text, doctor, CI): The R1-A refusal has EN/DE catalogue text and a help exit-table entry. doctor reports the same serve-specific failure on those platforms, and this is tested, so doctor cannot pass while serve must refuse (R8). The support matrix states that serve and start:recovery are refused on Linux and Windows in both modes. PADR-0027 restates which CI platforms run the installed smoke; any platform removed is recorded and accepted by the fresh packaging reviewer. No Linux or Windows claim.

R11.9 (other owned browsers): For every host's and child host's mirror browser, PADR-0027 states one of:
- the adapter applies R11.1–R11.6 to each browser it launches, with its own binding, before the host reports readiness; or
- a timed-out mirror close is a truthful R2 teardown failure (exit 3), with its residual measured under R11.5.
The Player binding never matches a mirror process.

R11.10 (evidence, extends R9): Evidence is source-bound to the helper, serve, server, start-recovery and adapter hashes, plus the pinned playwright-core version and Chromium build. It is recorded only as hashes, booleans, counts and timings, with no raw paths.
On macOS 27/Node 22, for both visible and headless mode:
- capture fields, pgid = P, and the hash of the observed executable path;
- a forced-path run in which the bounded browser.close does not complete (for example, the test stops the verified leader under R11.3). It proves: the signal ledger ⊆ {P, -P}, each entry preceded by a same-segment verification; leader gone; R11.5 count 0; profile directory absent; token file absent; port closed.
Refusal controls use only test-spawned sentinels. Each proves that zero signals reached the sentinel (sentinel alive) and that no success text was printed:
- stale: bound PID absent;
- foreign: binding pointed at a sentinel with a different command or profile;
- parent mismatch: reparented sentinel;
- group: -P refused when pgid ≠ P.
Plus one run of the ps path under a de_DE locale. The probe's literal fields and chromium.executablePath() are not evidence.

R11.11 (binding): R1–R10 remain binding in union with R1-A, R2-A and R11.1–R11.10, which enter PADR-0027 verbatim before implementation. None is deferred or waived; any change requires a fresh plan re-review. Acceptance requires fresh security, packaging and UI reviewers distinct from the builders, from both earlier plan reviewers and from this reviewer. No publication, account, config, user, container or sealed changes.


# Local session host and Player contract

The local host that owns a session and serves the Player and agents. Scope: one OS user on one
machine. Sources: PADR-0004/0005/0011/0014/0015/0016/0029, `src/host/protocol.ts`, `limits.ts`,
`server.ts`, `session.ts` and `mirror.ts`. Security overview: [threat model](security/threat-model.md).

## Start and authentication

`serve [world-directory|world.pnworld] --seed 42 --task T3` (alias `play`; without a world the
bundled example) packs a source world or loads a validated package. The host listens on an
OS-selected random port on **127.0.0.1 only** and prints a link
`http://127.0.0.1:<port>/#code=<128-bit hex>`, which it opens in the user's default browser
(`open` on macOS, `xdg-open` on Linux, `cmd /c start` on Windows; `--no-open` skips this). The
code is valid once for **5 minutes**. `o` + Enter in the terminal issues a new link and revokes the
unused previous one, so at most one code is outstanding; a reused code is refused with 401
`bootstrap_used`, a revoked or unknown one with 401 `token_invalid`. The terminal also prints the
public origin and the practice-token file for attaching an agent; the token itself is never printed.
Ctrl+C (SIGINT/SIGTERM/SIGHUP) closes the host, its mirror and children and removes the token file.

The code travels only in the URL fragment: browsers never send a fragment to a server or in a
`Referer`, and the Player removes it from the address bar before its first request. It may remain
in the local browser history as an already consumed or expired code, and the printed link is
visible to whoever can read the terminal; both are the same local user. Agents attach with the
token file, never with the code.
`POST /api/bootstrap` exchanges it for a 256-bit random session token. Every tab bootstrapped from
a link of this host joins the same session. The token travels only in `X-Practonaut-Token` on API/SSE/PNG requests.
PADR-0016 replaces the earlier memory-only browser lifetime with tab-and-origin-scoped
`sessionStorage`, so a same-tab reload can authenticate `GET /api/resume`. No token cookie,
URL parameter, `localStorage`, CORS header or external asset is used. Browser restore can
persist sessionStorage; this is not a RAM-only secrecy claim. A different loopback port,
including the isolated editor, has no access. Closing the host invalidates this credential.
Browser extensions and same-user instrumentation of the user's own browser can read the page;
this is no secrecy claim against the local user's software.

The static shell and four fixed assets are public. Every session read and mutation is
header-authenticated. Exact Host and same Origin are enforced; absent Origin is permitted for
local clients with the token, foreign and null Origin are rejected. Mutations require JSON.
The bootstrap exception is protected by its one-use code and the same Host/Origin/JSON checks.
CSP allows scripts/styles/connections only from this host, images from self/blob, and forbids
inline scripts, plugins and HTML injection sinks. The Player permits a frame from one separate
random loopback origin for the local editor. Author strings are text nodes.

The token is created exclusively without following symlinks in a same-user **0700** directory
(`~/.practonaut/host`, or `$PRACTONAUT_HOME/host`), as a **0600** random `.token` file. Existing
symlink ancestors, unsafe permissions or ownership are rejected. On Windows there are no POSIX
owner/mode bits (`src/platform/private-fs.ts`): type, link and symlink checks remain, ownership and
mode checks are skipped, and privacy relies on the user-profile ACL of the default location; a
`PRACTONAUT_HOME` outside the profile is the operator's responsibility. Shutdown removes only the owned token inode.
The CLI prints only the public origin, practice-token file path and private export directory.
Catalogued bootstrap failures omit upstream text, URLs, codes, tokens, stack and cause.
The browser itself legitimately holds practice and author capabilities in its scoped tab cache;
same-user instrumentation can inspect them, so this is no OS secrecy or sealed-evaluation claim.

## Routes, payloads and events

Canonical TypeScript definitions are `src/host/protocol.ts`. JSON replies are
`{ok:true,value:…}` or `{ok:false,error:{code,message,details?}}`. Every mutation carries the
observed `expectedRevision`; stale tabs receive `stale_base` with the current `step` and
`revision` in `details`. Revision increases independently of the core action count and hash (hints
also change revision). A mutation reply carries the new view and the `delta` (changed objects as
they are now, created and removed ids, effects, error explanations); with `reply:"delta"` in the
request (the MCP bridge sends it, PADR-0038) the view is left out.

| Method/route | Input | Result |
|---|---|---|
| POST `/api/bootstrap` | `{code}` | token and initial public view; code consumed once |
| GET `/api/resume` | token header; no query | current public view and local editor address; no new token or state mutation |
| GET `/api/observe` | token header | state/hash/log/history, task/public conditions, rules/provenance, hints, mirror mode |
| POST `/api/act` | revision, `{action:{name,params}}`, optional `actor:{kind:"agent",client}` (set by the MCP bridge; absent = a person), optional `reply:"delta"` | atomic action, new view (history entry with its actor), delta, mirror confirmation and measured latency |
| POST `/api/undo` | revision, optional `reply:"delta"` | last committed action removed in core and mirror |
| POST `/api/reset` | revision, `confirmed:true`, optional `reply:"delta"` | original task state, hints/history cleared, new attempt |
| POST `/api/variant` | revision, `confirmed:true`, optional `taskId` | next distinct finite case; task-only change preserves seed |
| POST `/api/hint` | revision | next public hint, never hidden data |
| POST `/api/check` | revision | replay-checked public conditions and end-state-only verdict |
| GET `/api/events` | token header via fetch | SSE ready/changed/rejected/heartbeat; never browser-supplied confirmation |
| GET `/api/tool.png` | token header | host-rendered image/png with nosniff; no SVG or HTML |

`changed` contains the committed view. `rejected` contains the unchanged revision/hash and a
named error. Heartbeat contains revision only. Practice does not load a checker bundle.
Quantified predicates remain whole public conditions so different witnesses cannot incorrectly
satisfy split fragments. Every result is explicitly end-state-only, not learner attestation.

## Atomic mirror and diagnostics

The task selector only stages a choice; Apply task sends the request. Task/variant changes with
existing work or opened hints require a safe confirmation dialog. Cancel and Escape preserve
the committed state, log and hints; global undo is suppressed behind a dialog. A task-only
change keeps the seed; New variant chooses a distinct case. The host refuses variants without
confirmed:true, including direct API clients.

The host is the only writer and serializes transactions. It replays the committed prefix into
a candidate Session, applies the requested core action and checks coverage/replay. The adapter
applies it to the pinned engine, independently reads back and checks integrity. Exact agreement
commits both; disagreement, crash or timeout restores the last committed scene, retaining core
state/hash/log/history/revision. Undo/reset/variant use the same replacement transaction.
Replay is checked at each mutation checkpoint and before every result check.

The mirror target is **2,000 ms** per step and its operation deadline **5,000 ms**
(`src/host/mirror.ts`). Actual times are emitted in history and measured by the real integration
suite; a target is not a universal latency guarantee. Timeout kills the stale browser before
recovery, preventing late writes into the recovered session.

Rejected mirror transactions are recorded privately alongside the token as `.mirror.jsonl`:
error, revision, operation, before/predicted/read-back states and their hashes. Unavailable
read-back is explicit null. The exclusive 0600 log stays in the 0700 directory, has no Player
route and remains after shutdown for diagnosis. Session capabilities are redacted if they
appear in supplied data; the `redacted` flag distinguishes that case. Hashes describe the original
states. The host caps the diagnostic file at 4 MiB, retaining the latest records by truncating
before a new record exceeds the cap. An oversized single record or write failure rejects with
`diagnostic_limit`/`diagnostic_unavailable` and still rolls back. Remove an unneeded private log
locally; it can contain world labels. No automatic upload or recording of the real desktop occurs.

`--mirror auto` is the `serve` default: it resolves to `required` when Playwright Chromium is installed and otherwise to `off`, with a warning in the terminal and a Player note naming `practonaut setup`. `--mirror required` refuses to start without Chromium. `--mirror off` never starts an engine, is labelled
**model only** and sets practice evidence false for every view/result even when conditions pass.

## Named budgets and failure paths

These are fixed constants, not environment overrides. Tests exercise each relevant rejection.

| Budget | Constant | Rejection |
|---|---|---|
| JSON request | 64 KiB | body_too_large |
| HTTP headers | 16 KiB; header deadline 10 s; request deadline 30 s | HTTP 431 / connection timeout |
| Requests | burst 200, refill 50/s, one bucket per host | rate_limited |
| JSON/PNG reply | 4 MiB | result_too_large |
| SSE | 8 clients; 4 MiB queued per client; heartbeat 15 s | rate_limited / stream closed |
| Bootstrap | one use, 5 min, one outstanding code, at most 1000 links per session | bootstrap_used / bootstrap_expired / token_invalid / limit_exceeded |
| Mirror operation | 5 s | mirror_timeout / mirror_unavailable / real_tool_disagrees |
| Private diagnostic | 4 MiB file and single-record cap | diagnostic_limit / diagnostic_unavailable |
| Optional network startup probe | 3 s | E_NETWORK_AVAILABLE when external reachability is observed |
| Bench action budget (bench runs only) | `--max-actions`, default 50 act/undo/reset per run | action_budget_exhausted (HTTP 429) |

Other named guards include token_required/token_invalid/token_in_query, host_rejected,
origin_rejected, json_required, invalid_request, token_file_unsafe, stale_base, session_busy,
replay_mismatch and the core's explicit unmodeled/failure codes. Internal exception messages are
not returned to the browser. The short-lived URL should be opened by the local user only.

## Evidence and limits

`test`: actual HTTP/security and mirror tests under `tests/integration`, actual DOM and
requested-action/core/independent hash/replay oracles under `tests/e2e`. The installed package smoke
starts this same host and checks public result plus PNG. Build inventory enforces Player-only
runtime imports and zero external requests. Normal serve makes no startup egress probe unless
--require-offline is requested.

Automated axe, keyboard, reflow and reduced-motion scans run on the Player; manual screen-reader
and 200% zoom checks are still to be done ([manual checks](design/manual-player-checks.md)).

## Authoring and editor boundary

`serve` also starts a second owned loopback listener serving only pinned editor assets.
Bootstrap supplies its origin after the initial view passes the reply budget, before consuming
the one-use code. The child has no APIs or session token. Its `connect-src 'none'` blocks network
fetches; local fonts load before recording. Excalidraw needs inline geometry styles, permitted
only in this separate origin. The parent retains its strict script/style policy. A sandboxed
cross-origin frame and an exact-origin MessageChannel handshake carry scenes and observations.
The parent authenticates every write to the host. Both listeners close with the session.

`src/host/author-protocol.ts` defines authenticated author routes: GET `/api/author`,
`/api/recording?id=…`, `/api/author/project` and `/api/editor/scene`; POST `/api/record/start`,
`/api/record/gesture`, `/api/record/stop`, `/api/record/delete`, `/api/author/analyze`,
`/api/author/project`, `/api/author/confirm`, `/api/author/compile` and `/api/editor`.
All retain Host, Origin, token, JSON, request-size and revision guards. Author and practice
revisions are independent. Project edits can supply tasks and notes but cannot alter hypotheses
or evidence statuses. Compilation rereads the private recordings and rechecks all evidence.

Author recordings are bounded to 30 minutes, 1000 gestures/elements and 3 MiB; the store admits
at most 100 recordings/64 MiB. Stop returns `{view, recordingId}`; review loads that recording
through a separate authenticated GET, so a recording and a large project never share one reply.
Start, gesture and active-project admission also reserve the later stopped view before changing
revision. Every accepted prefix can therefore be stopped within the single-host response budget.
A full store or stale filesystem lock can still block saving; accepted observations then remain
in memory only; durable retention after a failed save is not claimed.
The full prospective author view is checked before adopting a project. Host practice views are
admitted before mirror writes and commits, leaving room inside the 4 MiB transport envelope.
The UI compiler limits output to 96 managed files/64 MiB across sessions with an exclusive
compilation lock; its files are private. A recording referenced by a saved project cannot be
deleted until that project is explicitly removed. Recording deletion then revokes matching
managed compilation outputs across sessions, without silently removing saved projects.

The browser scene is untrusted. The host compares its predecessor with committed state, maps
one declared action, compares the complete expected successor and then invokes the same live
mirror transaction as Board input. Unmodeled gestures and `editor_divergence` are visible;
resynchronisation replaces the input scene with the authoritative host scene. Native undo is
routed through host undo. The child never asserts mirror agreement or practice evidence.

## Recovery authoring, durable projects and practice launch

All routes retain header authentication, Host/Origin, JSON/body/reply budgets and expectedRevision
for mutations. They accept identifiers as data, never user-selected filesystem paths.

| Method/route | Author intent or input | Result |
|---|---|---|
| POST `/api/author/prepare` | title, author, three visible labels | prepared project, initial editor scene and exact independent result examples; recording stays off |
| POST `/api/author/configure` | bounded repair intent, titles, finite cases, explicit example review | task/variants/solutions and independent examples; behaviour authority unchanged |
| POST `/api/author/save` | current revision | fsynced named project; all evidence reread/reconstructed |
| GET `/api/author/projects` | authenticated read | bounded named project list with save dates |
| POST `/api/author/open` | saved project identifier | schema/source/evidence-revalidated project and initial scene |
| POST `/api/author/launch` | current revision and compilation SHA-256 | exact managed public world in owned child practice host, required native mirror; one-use browser link |

Private project store: 0700 same-user directory, 0600 single-link files, no symlink ancestors,
fixed identifier grammar and integrity envelope `practonaut.saved-author/1`. Limits are 32
projects, 32 MiB aggregate at peak (including the old target until rename) and 3 MiB per file. A write lock serializes atomic temp/rename and
file/directory fsync; changed inodes, unsafe ownership/modes/links, stale locks and quota violations
are named errors. Source validation, not the envelope hash or persisted status, grants authority.

Repair analysis uses only the active project's recordings. Deleting an unrelated recording
preserves it. Deleting a referenced recording is refused and names the referencing saved
projects. After their explicit deletion, removing the recording revokes matching managed compilations. Explicit unmanaged
exports remain the author's responsibility. Sources and rights are still required at compilation.

Launch rereads its internally managed compilation without following links, checks ownership,
permissions and exact bytes hash, validates the package, then starts practice from its public
world alone. A valid substituted package still fails `compilation_changed`. Checker fixtures,
private solutions and author draft do not enter practice. Parent shutdown closes its own children.
Opening/saving never reseeds the current practice host or disables its mirror.

Same-tab reload authenticates with its cached credential and restores the chosen workspace,
language and theme. Named projects remain host-side authority, revalidated on open. An active
recording is not automatically restarted: completed host gestures remain, the unfinished
native gesture cannot be recovered, and Stop and review is an explicit author action.
Unsaved form text is not durable project data. If the browser denies sessionStorage, initial
bootstrap still works and the UI explains that reload needs a fresh local start. Invalid cached
credentials are cleared; there is no unauthenticated fallback. Host restart and port change
require the new link, after which saved projects can be opened. A same-host
second practice-only tab does not gain author capability. Invalid or old cache envelopes are
cleared; an `author_required` response does not clear an otherwise valid practice session.

`mirrorHealth` distinguishes available, unavailable, closed and model-only, with recovery count.
Recovery is bounded to one relaunch. Close serializes against recovery and becomes terminal,
so no new browser can start after close. If availability is lost, checks cannot produce practice
evidence; restarting a session is explicit. Production lifecycle probes inspect real engine PIDs,
state/hash, revision, action log, history and actual read-back after failure and recovery.

### Interrupted author saves

Committed named projects remain readable while another or interrupted save owns the private
store. Listing validates only committed project filenames and files; opening validates the
requested committed file. Unknown names, unsafe pending files and residue quota exhaustion
do not block these reads, and unknown entries are never opened or followed. Listing bounds
enumeration to 4096 directory entries and 32 committed projects. A corrupted or unsafe committed entry is isolated in the bounded unavailable-project
list. Its original file is preserved; other valid projects and the active author flow remain
available. A direct read of the corrupt entry still rejects with its named integrity/safety
error. The UI names unavailable entries without exposing private OS paths. Writes reject unknown
entries, unsafe residue, more than 32 temporary files, or a peak byte budget above 32 MiB.
Pending files are preserved rather than silently deleted. New locks
record a process and nonce; save resumes automatically only when that process is proven dead
and an exclusive nonce claim plus unchanged inode/bytes establishes recovery ownership.
Live processes, uncertain/legacy locks and interrupted recovery claims remain protected. The
UI reports this as a save conflict and preserves the open author session; such unproven locks
require technical inspection, never guessed deletion. A process death between exclusive lock
or claim creation and completion of its record can leave an unparseable owner identity; even
after restart this intentionally blocks writes, because creator death cannot be established.
Committed projects remain openable and current author work remains in the running session.
This is bounded recovery for known local process identities in one host/PID namespace, not a guarantee
for every filesystem or crash. Opening practice revalidates the current sources and reruns
compilation; changed project or rule authority requires a newly checked exercise.

### Manual recovery of an unproven project lock

This is a single-operator maintenance procedure. An empty or partial `.projects.lock`,
or an interrupted matching `.recovery-<nonce>.claim`, intentionally leaves saves busy.
Do not retry into a guessed cleanup. Committed projects remain readable; keep unsaved
author work in its current browser until it has been preserved privately. The software
does not delete these files using their age, a guessed PID, or a missing open-file result.

1. Identify the exact private project store used by the affected host. Preserve the
   displayed draft and record the save error. Do not reuse its credential or one-use
   bootstrap code for another host, and do not put credentials in a command log.
2. Arrange a maintenance window with every owner who can write that store. Gracefully
   stop all owning Practonaut hosts and their children, including any host in another
   terminal. Prevent supervisors, scripts and other agents from starting a writer or
   save. Never stop an unrelated process or another owner's host without coordination.
   If any possible writer cannot be accounted for, keep the store read-only and stop here.
3. Prove quiescence from the complete host/process inventory and disabled restart paths.
   Inspect actual processes and open files as corroboration. `lsof` alone is insufficient:
   a process may be between file opens or about to save. Neither elapsed time nor a PID
   in a malformed record proves that the store is free.
4. Before modifying anything, make a private backup of the exact store outside its
   managed directory. Preserve permissions and original bytes, including the lock and
   claims; record hashes, ownership and inode identity. The directory must remain 0700
   and files 0600, same-user, single-link, with no symlink ancestors. If these properties
   are unexpected, do not follow or remove the entry; investigate separately.
5. Only after quiescence is established, the operator may manually remove the exact
   inspected unproven lock or claim from the managed directory. Prefer moving each named
   file to the private backup so its original bytes remain available. Recheck its identity
   immediately before the action; if it changed, stop. Do not use wildcards, remove
   committed project files, or sweep unknown entries, pending files or another store.
   There is no automatic recovery command for this case.
6. Start exactly one host with fresh credentials and open its new link. Open a known saved
   project and verify its sources. Save, restart and reopen a small named draft, then
   compare the other committed files with the backup. A renewed busy/integrity error
   leaves the store read-only for further inspection; do not repeat removal blindly.

The operator establishes that no writer exists or can start before manual recovery;
the application continues to fail closed when it cannot establish ownership. This
procedure does not promise recovery from every filesystem failure or from corrupt
committed envelopes, and it does not authorize automatic deletion of crash residue.

## Exports

Player native/session export buttons use one current hash-bound envelope and are ordinary browser
downloads: the host returns the pair, the browser saves the files where the user's browser saves
downloads. A matching native/session pair survives host restart and can be checked with
`check <native> --world <world> --pair <session>`. This verifies exact bytes, context, end state
and the independent session-history interpretation, without actor or execution-origin attestation.
Downloaded copies are the user's files and responsibility.

# PADR-0049 — draw.io as application #2: a verified download behind the shared shell, the embed protocol only, declared structural constraints, and an independent `.drawio` reader

Status: proposed · Date: 2026-10-18, revised 2026-10-19 · Roadmap 0.3.0, Must 2 (issue #52) ·
Amends [PADR-0032](0032-chromium-sandbox-stays-on.md) (a sandbox policy per adapter: draw.io never
starts without the sandbox) and [PADR-0045](0045-adapter-registry-and-browser-shell.md) decision 8
(a downloaded runtime is kept as the verified archive, read whole into memory at every start and
served from an allowlist, never unpacked) · Builds on [PADR-0007](0007-adapter-contract.md),
[PADR-0011](0011-live-mirror-and-browser-runtime.md), [PADR-0044](0044-bench-report-v3.md) (task
set, task identity, bench/3), [PADR-0047](0047-bounded-spatial-predicates.md) decision 10 (draw.io
geometry) and [PADR-0043](0043-artifact-judged-verdict-level.md) (what stays for artifact mode) ·
Evidence: the 0.2.0 spike ([report](../../spikes/drawio/REPORT.md)) and its re-measurement through
the shared shell with the mapping decided here ([`spikes/drawio/shell.ts`](../../spikes/drawio/shell.ts),
[`mapping.ts`](../../spikes/drawio/mapping.ts), summary
[`results/shell.json`](../../spikes/drawio/results/shell.json)) · Revised after three independent
reviews on 2026-10-19 (OpenAI Codex, Google Gemini, a three-lens Claude Opus workflow with a skeptic
per major) and the coordinator's dispositions (see *Review*) · To be accepted with the pull request
that implements it, after a review of that code

## Context

The draw.io spike passed (REPORT, *Verdict*); its three judgement calls were accepted on 2026-10-14
with two items left for 0.3.0: a record on groups whose members sit in different frames, and the
trademark question. Issue #52 adds a record on whether draw.io may start without the Chromium
sandbox on Linux. Since the spike, Must 1 (PADR-0045, merged as 6e50e0d) added the adapter registry
with a `downloaded` runtime kind and a per-adapter read-back comparison, and moved every browser
mechanic into a shared shell with a content security policy, a sink proxy, no host resolution and no
WebRTC UDP. bench/3 with `environment.app`, `native.<adapter>` and the task-set key `taskSet`
(PADR-0044, PR #66) merges before this record's implementation is integrated. The maintainer decided
on 2026-10-18: the download is opt-in through an explicit `practonaut setup` option that names the
file, the source and the size first and checks size and SHA-256 before keeping it; Practonaut never
redistributes `draw.war`, and it is never put into a CI artifact or a CI cache (CI downloads and
verifies it on every run); the sandbox stays on unless this record shows a reason.

**Re-measurement** (2026-10-19; macOS 27.0.0 arm64, Apple M4, 10 cores, Node 22.22.3,
playwright-core 1.64.0, Chromium headless shell 156.0.8078.4, sandbox on). The machine was shared
with other jobs: the one-minute load average was about 15 during the starts and the first run and
107–120 during runs 2 and 3, so every time is an upper bound. The script reads the whole verified
`draw.war` into memory at every start, hashes that buffer and serves from it only; it never unpacks
the archive. It writes with the mapping of decision 5 (`mapping.ts`), reads back through the shared
shell (`startShell`, two named origins: a host page written by Practonaut with one iframe and a
`postMessage` relay, and the app), and runs no script in the app frame. It is a **precursor** of the
acceptance protocol of decision 8.4, not that protocol: its verdicts come from the spike's reader on
the app's own export, not from the product reader of decision 6 on `exportArtifact`'s file.

| Measure | Spike (0.2.0) | Re-measurement |
|---|---|---|
| Download | 48,442,174 bytes, SHA-256 `b836…7820` | same bytes and hash, 7.9 s; GitHub redirects to `release-assets.githubusercontent.com` (2026-10-18) |
| Archive | 3,154 files, 115.5 MB unpacked | 3,318 entries: 3,154 files (deflate), 164 directory entries (stored), no link, no duplicate name, no encryption; largest entry 19,861,682 bytes (`js/integrate.min.js`, not loaded); 115,503,243 bytes inflated; highest ratio 16.8 |
| Start, each in a fresh Node process (process start → `load` event of the first, empty diagram), 5 | median 709 ms (703–923), in one process | median 1,312 ms (1,298–1,454), of which the archive (read, SHA-256, directory) 185 ms and the shell to the first `load` 941 ms (939–1,094) |
| Archive work per start, median of 5 | — | read 10 ms, SHA-256 19 ms, directory 133 ms, inflating the 14 served files (20,279,361 bytes) 80 ms |
| Library, 3 runs, each a fresh process and browser, orders forward, reverse, seeded shuffle | 3 × 165 sequences, 624 round trips | 3 × 213 sequences (48 starts, 48 references, 117 near misses), 672 round trips each; every step held the declared set, the full write check and integrity; per run 48/48 starts fail, 48/48 references pass, 117/117 near misses fail |
| Agreement between the 3 runs, per sequence | identical projections (fixed by the checks) | the app's raw export after every step (diagram id normalised), the final PNG bytes, the verdict and its error classes: 0 of 213 differ |
| `load` / `export` median per round trip | 4.6–7.9 ms / 1.7–3.1 ms | 3.5 / 1.1 ms (run 1); 8.1–8.6 / 3.0–3.1 ms under load 107–120 |
| Peak RSS, Chromium process tree | 491–628 MB (all runs) | 510–657 MB (3 runs, 4 processes) |
| Peak RSS, the Node process | not reported | 316–493 MB (the measuring process: library, core, Playwright and the 48.4 MB archive buffer) |
| Requests refused by the shell (any origin, path, policy report) | 0 | 0 in every start, run and probe; no console error or warning |
| Files the app loads | 14, 20.28 MB | with `lang=en` the same 14; with `lang=de` `resources/dia_de.txt` replaces `resources/dia.txt`; `index.html` has no policy of its own |

Probes (same session): cells with ids outside the semantic id pattern (`pn:root`, `pn:layer`,
`pn:group:g1`) and steps whose ids are `0` and `1` came back unchanged under the full write check.
draw.io's export leaves out an `mxGeometry` `x` or `y` of 0 (a step at its group's origin came back
without both); the decided writer leaves them out too, which is what lets the write check compare
every attribute. The export carries `host` on `mxfile` (the app origin's host name,
`drawio.practonaut.invalid`), a random `id` and `name` on `diagram`, and view attributes on
`mxGraphModel`; no user agent, time or machine name. The protocol's PNG export is a PNG (8,519 bytes
here), byte-identical when repeated and, for every final state, across the three processes; an empty
diagram exports a PNG too (88 bytes). The SVG export differs only in the random `ge-svg-…` root id;
with `whiteSpace=wrap` in a step's style it holds 2 `foreignObject` elements (HTML inside the SVG)
and a link to the vendor's help page, without it none and no external reference. The RSS increase
over the spike has no measured cause (UNKNOWN; Chromium moved from 153 to 156 in between). A start
after a reboot and every Linux and Windows figure are UNKNOWN.

**Files addressed to coding agents.** The archive holds 12 Markdown files. Five are named `CLAUDE.md`
(`js/diagramly/`, `js/diagramly/sidebar/`, `js/diagramly/vsdx/`, `js/grapheditor/`,
`js/libavoid-js/`), and none of the 12 is under `WEB-INF/` or `META-INF/`. Only their names were
read. The first draft of this record assumed they sat under `WEB-INF/`; a rule that served every entry
outside those folders would have served them.

**What a draw.io cell tree cannot hold.** A cell has one parent. world/2 keeps a step's frame and
group as independent fields (as Excalidraw does), so `set_frame` can leave one member of a group in
another frame than the others, and `group_steps` can group steps of two frames. The spike's coverage
sequence reached that state at step 15; native groups held 22 of 23 round trips, a custom cell
attribute 23 of 23 (REPORT, *Action coverage*). No library sequence reaches it (the review replayed
all 165 sequences in the core: 624 states, none), and no challenge family creates a group
(`src/challenge/diagram.ts:30`). A draw.io group cell that contains whole frames groups frames, not
steps. Text is the second limit: world/2 display text admits characters that XML 1.0 cannot carry
(C0 controls other than tab, LF and CR; U+FFFE, U+FFFF; measured by the review on
`src/world/display-text.ts:2-4`), so a `load` with such a label is malformed XML and draw.io keeps
the previous diagram (REPORT, *malformed XML*).

**What still assumes Excalidraw**, beyond PADR-0045's list: the export file names
(`practonaut.excalidraw`, `src/host/export-pair.ts:19,34`, `src/player/export.ts:30,44`;
`native.excalidraw`, `src/bench/run.ts:143`, `src/bench/details.ts:32`); the library bench, which
loads only the Excalidraw library and its oracle file bound to world id `excalidraw-library`
(`src/bench/world.ts:46-49,166-168,177,189`, `src/library/index.ts:69`; unchanged on PR #66's
branch); the challenge generator's world (`src/challenge/build.ts:142`); the Player's editor and
author workspaces, which embed Excalidraw (`src/player/main.ts:17`); and the CLI's mirror messages,
which name Excalidraw (`src/cli/messages.ts`, `browserRuntimeMissing`, `mirrorFallback`). A
model-only session already has no real-tool image: the host refuses the image (`src/host/session.ts:451`)
and the Player disables "show tool" and labels the board as the model (`src/player/main.ts:575,711`).

**Linux.** CI runs the browser layers under Ubuntu's default AppArmor restriction, so Chromium
starts there without its sandbox (PADR-0032 amendment), and only one later step lifts the
restriction (`.github/workflows/ci.yml:95-104`). This record was written on macOS; no Linux start of
draw.io was measured.

## Options considered

**A. Groups across frames.**
1. *A custom cell attribute* (`object` wrapper, the spike's option i). Lossless, but draw.io does not
   treat it as a group: the mirror would confirm that the app stores an attribute, not that it holds
   the state, and the checker would read a Practonaut-specific attribute as a group nobody sees in the
   app. Two encodings of one field would switch under single actions. Rejected.
2. *An action precondition in the world* (option ii). World preconditions are predicates over the
   state; they cannot name an action's parameters (`src/world/types.ts:31-34`). Rejected.
3. *A refusal by the mirror only* (option iii). Model-only sessions — every session before the opt-in
   download — would reach states the app cannot hold, and the same run would differ with and without
   the download. Rejected as the only control.
4. *An adapter branch in the core* (the first draft: the core tests the world's adapter and answers
   `unmodeled`). It ties transition code to an adapter id and misuses `unmodeled`, which means unknown
   behaviour (architecture §10), for a limit that is known. Rejected in review.
5. *Declared structural constraints* (chosen): the world table declares, as data, which structural
   constraints an application imposes; the core, world validation and the checker check every
   declared constraint generically, never an adapter id; a transition into a violating state is a
   named refusal. The same mechanism carries the text limit (`xml-text`).

**B. Keeping and serving the download.** An unpacked tree with a per-file manifest (PADR-0045
decision 8, the spike): 3,154 files on disk, the agent-instruction files among them, Windows path
rules, a manifest that must itself be trusted. Hashing from a file descriptor and inflating lazily
from it: another OS user who controls an ancestor directory could rewrite the file after the check,
and Windows keeps the file open. *The whole archive read into memory at each start* (chosen): one
hash over exactly the bytes that are served, nothing on disk read after the check, no open handle;
the cost is about 48 MB of Node memory per running draw.io adapter.

**C. Linux without the sandbox.** *Allow the PADR-0032 fallback for draw.io as for Excalidraw*: the
mirror would run on default Ubuntu desktops and in CI's default steps. *Require the sandbox*
(chosen): decision 7.

**D. The adapter's read-back reader.** Reuse the checker's reader — forbidden (architecture §2) and
one parser bug would pass both sides. A second hand-written tokenizer in the adapter. *The browser's
own XML parser in Practonaut's host page* (chosen): independent of the checker's tokenizer by
construction.

**E. Showing the real app.** A screenshot of the page shows draw.io's editor around the diagram.
*The protocol's PNG export* (chosen): the diagram only, rendered by the app, byte-stable.

**F. The library on draw.io.** Separate `.drawio` source drawings would be a second source of truth.
*A world and an oracle file generated from the Excalidraw library, naming it as task set* (chosen,
PADR-0044 decision 3).

**G. Where the runtime lives for tests and CI.** A new product variable for the apps directory
(`PRACTONAUT_APPS` in the first draft) would amend PADR-0029 decision 3 and needs its own parsing
rules. *`PRACTONAUT_HOME` only* (chosen): CI runs setup with a home under the runner's temporary
directory; tests reach that home through a test-only variable and pass the runtime to the adapter
through a test seam, so the product reads no new variable.

## Decision

### 1. Registry entry, declared constraints and named refusals before anything starts

1. **The three tables** gain one entry each, kept equal by the existing tests. World table
   (`src/world/apps.ts`) and registry: id `drawio`, app versions `["32.4.1"]`, world schemas
   `["practonaut.world/2"]` only; in the registry also runtime `downloaded`, read-back comparison
   `live` (draw.io keeps no deleted cells; the core alone holds tombstones, PADR-0045 option 2) and
   sandbox policy `required` (decision 7). Checker format table: `drawio`, extension `.drawio`, the
   reader of decision 6. A world/1 naming `drawio` is refused with `E_ADAPTER_SCHEMA_UNSUPPORTED`; a
   world naming another draw.io version with `E_ADAPTER_VERSION_UNSUPPORTED`; a pin bump is a code
   change with a conformance run.
2. **Structural constraints are declared data.** Each world-table entry carries
   `structural: readonly StructuralConstraint[]`, from a closed list defined beside the table:
   `group-within-one-frame` (the live members of one group share one frame, or all have none) and
   `xml-text` (every label and frame name consists of XML 1.0 characters: tab, LF, CR, U+0020–U+D7FF,
   U+E000–U+FFFD, U+10000–U+10FFFF). `drawio` declares both; `excalidraw` declares none. The check
   for each constraint is a pure function of a state. No module tests an adapter id to decide a
   constraint; adding a constraint to an entry is the only way to impose one.
3. **Runtime check before Chromium.** For an adapter whose runtime is `downloaded`, `play`, `serve`,
   `mcp --task`, `run` and `bench` check the kept archive (present; then read whole, size and SHA-256
   against the pin) after the world is validated and its adapter resolved, and before the Chromium
   check or any start. Two new CLI codes, exit 3 like `browser_runtime_missing`:
   - `app_runtime_missing` — the archive is not there;
   - `app_runtime_unverified` — a file is there, but it is not a regular file read without
     following a link, or its size or SHA-256 is not the pin's.
   Both messages name the adapter, the remedy `practonaut setup --app drawio`, the exact size
   (48,442,174 bytes) and that `--mirror off` runs model-only. Under `--mirror required` they stop the
   command; under `--mirror auto` the session runs model-only with one line naming the same remedy, and
   the Player's banner gives the command and the size (the `missing` notice, with the draw.io download
   instead of Chromium). `validate`, `pack` and `check` need no runtime. The adapter's own start
   verifies again (decision 2.5) and fails as `mirror_unavailable` with the same cause, which the CLI
   reports by the same code.
4. **`doctor --adapter`** lists, per adapter, the runtime (bundled; downloaded and verified; missing;
   does not match the pin), the Chromium start under the adapter's sandbox policy (decision 7), and
   for draw.io on a platform without a recorded conformance run (decision 8.7) that its mirror is not
   yet verified there.

### 2. Setup: opt-in download, verification, atomic keep

1. **Opt-in.** Plain `practonaut setup` keeps installing only Chromium. `practonaut setup --app
   drawio` first ensures Chromium exactly as plain `setup` does, then runs the Chromium start check
   under draw.io's sandbox policy: when the sandboxed start is refused, it says that draw.io will run
   model-only on this system until the restriction is lifted (the AppArmor advice of PADR-0032) and
   still offers the download. Before any byte is fetched it prints the file (`draw.war`, draw.io
   v32.4.1), the source (`https://github.com/jgraph/drawio/releases/download/v32.4.1/draw.war`), the
   exact size (48,442,174 bytes, 48.4 MB), the full SHA-256 and the notice of decision 9. No install
   script, `play`, `bench`, `mcp` or test ever downloads it implicitly.
2. **Pin.** Tag, asset name, size and SHA-256
   `b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820` move from
   `spikes/drawio/pin.json` into the adapter as constants, with the entry allowlist of decision 3.2.
   The hash matched GitHub's published asset digest when it was recorded (REPORT, *Pin*).
3. **Download.** Redirects are followed by hand, at most 5, and a hop to anything but `https:` is
   refused before it is followed; integrity comes from the hash, not the host. Connecting and the
   response headers must arrive within 30 s, the body must not stall for 30 s, and the whole chain —
   redirects, body and retries — has an absolute deadline of 10 minutes (`app_download_failed`
   naming which limit). A network error, HTTP 429 or 5xx is retried at most twice, after 2 s and
   8 s; a size or hash mismatch is never retried. The body streams through a SHA-256 and a byte
   counter into a partial file whose name is unique to this setup (process id plus random), created
   exclusively (`O_EXCL`, no link following, mode 0600) in the version directory. One setup at a time
   per version directory holds an exclusive lock file there; a lock whose process is gone, or older
   than the absolute deadline, is removed by the next setup, which also removes only partial files
   whose lock is gone. Only a complete file whose size and SHA-256 equal the pin is kept: flush; on
   POSIX sync the file, rename over the target, sync the directory (`src/platform/private-fs.ts`
   already skips directory sync on Windows); on Windows a rename that fails with `EPERM`, `EBUSY` or
   `EACCES` (a reader holds the file for the moment of its read) is retried up to 10 times, 200 ms
   apart, then fails by name. After the rename the target is read whole again and re-hashed before
   success is reported.
4. **Mismatch and failure messages.** `app_download_mismatch` (exit 3) names the expected and the
   actual byte count and both full SHA-256 values; nothing is kept. `app_download_failed` (exit 3)
   names the URL, the limit or error, and the alternative below; nothing is kept.
5. **Offline and proxies.** `practonaut setup --app drawio --from <file>` verifies a `draw.war` the
   user fetched by other means with the same size and SHA-256 check (printing both, and the expected
   values, on a mismatch) and copies it into place the same way. Whether Node's built-in `fetch`
   honours proxy settings on every supported Node line was not measured (UNKNOWN); `--from` always
   works. An already kept file that matches is reported and not fetched again; one that does not
   match is reported by name and replaced by a verified download.
6. **Location and reading.** `<PRACTONAUT_HOME>/apps/drawio/32.4.1/draw.war`, in private
   directories (0700, file 0600; PADR-0029 decision 3 unchanged). Every adapter start opens it
   without following a link, refuses anything but a regular file, reads it whole into one buffer of
   exactly the pinned size (a larger file is refused before it is read), hashes that buffer, opens
   the zip from it and serves only from it. Nothing on disk is read after the check, and no handle
   stays open. The buffer lives as long as the adapter: 48,442,174 bytes per running draw.io adapter,
   plus at most 32 MiB of inflated allowlisted files (20,279,361 bytes measured). Removing the
   runtime is deleting that folder.
7. **No network at runtime.** After setup nothing of draw.io is fetched.
8. **Tests and CI.**
   - Setup's unit tests run on all three CI platforms against a stand-in HTTP server on 127.0.0.1
     serving a small fixture archive under an injected pin (never the real pin), each in its own
     temporary home: kept on match; refused on a size overrun, a hash mismatch, a truncated body, a
     stall, a slow trickle that exceeds the absolute deadline, a sixth redirect, a redirect to
     `http:`; retries counted; two concurrent setups (one lock holder, the other waits or stops by
     name, never a half file); stale partial files and locks; `--from`; the Windows rename retry
     with a held reader.
   - The draw.io conformance and adapter tests get the runtime through two **test-only** variables,
     read only by test support, never by the product: `PN_DRAWIO_HOME` (an absolute path to a
     Practonaut home in which `setup --app drawio` ran; default `.local/drawio-home/` in the
     repository) and `PN_DRAWIO_REQUIRED` (`1` or `0`; unset means `0`; any other value stops the test
     run). The test support passes the archive path to the adapter through a test seam; the preload
     still gives every test its own `PRACTONAUT_HOME`. With `PN_DRAWIO_REQUIRED=0` the tests skip by
     name, separately for "runtime absent" and "sandboxed start refused"; with `1` either fails.
   - CI, in the Linux step that lifts the AppArmor restriction: `PRACTONAUT_HOME` under
     `${{ runner.temp }}`, `setup --app drawio` on every run, the draw.io layer with
     `PN_DRAWIO_REQUIRED=1`, the layer's summary must report a non-zero sequence count, and a step
     under `if: always()` deletes that home afterwards. `*.war` joins `.gitignore`, and `test:pack`
     refuses a packed file whose name ends in `.war` or that is a zip archive.
   - **Nothing leaves CI by an unlisted path.** A file in the repository lists every path that a
     workflow may save or publish (the `path:` of `actions/cache`, `actions/upload-artifact`,
     `actions/upload-pages-artifact`, and every asset argument of `gh release create` or
     `gh release upload`),
     literally — today `.local/native-chart-paper/`, `.local/native-transfer/`, the three Playwright
     cache paths, `${{ runner.temp }}/practonaut-out/` and the release's own list. `npm run check`
     reads every workflow and fails on any such path that is not literally in the list, on any glob,
     on any expression other than the listed literal ones, and on `${{ runner.temp }}`, `~`, `.`,
     `.local` or the workspace root on their own. It also fails when the draw.io step does not set
     `PN_DRAWIO_REQUIRED: 1`. Its unit tests include negative fixtures: a parent directory of the
     home, `${{ runner.temp }}`, a glob, an environment variable, a path set through `$GITHUB_ENV`.

### 3. Serving: the shared shell, two origins, an allowlist from the archive in memory

1. **Origins.** The host page (Practonaut's own: one iframe, the `postMessage` relay, nothing else)
   at `http://practonaut.invalid/`, the app at `http://drawio.practonaut.invalid/`. Both are named
   origins of the shared shell, so every response carries the shell's policy (`default-src` the two
   origins plus `data:`/`blob:`; inline code and `eval` as the app has them, PADR-0045 decision 7);
   measured: draw.io works under it with no refused request and no console error.
2. **An allowlist kept with the pin.** The app origin serves exactly the entries of a list kept
   with the pin: the 14 files the app loads with `lang=en` (measured) plus any file the conformance
   suite records as needed and the maintainer adds with a recorded reason. Every other path —
   another archive entry, a directory, `WEB-INF/`, `META-INF/`, the `CLAUDE.md` and README files, a
   name the shell's safe-path rule refuses — is refused and recorded, and a recorded refusal fails
   the operation it happened in (`mirror_unavailable`), as PADR-0045 decision 8 requires. The shell
   decodes the request path before it checks it (`src/adapters/browser/shell.ts`, route), so the
   lookup is by the exact decoded name; `/%57EB-INF/…` reaches the check as `/WEB-INF/…` and is
   refused like it. Content types come from a fixed extension table.
3. **Zip limits** (normative, checked when the archive is opened; the pinned archive meets them, so a
   violation means another file): at most 4,096 entries (3,318 measured); every file entry at most
   32 MiB inflated, declared and actual, checked while inflating with a byte counter on every inflate
   (19,861,682 bytes measured for the largest); at most 256 MiB inflated in total (115,503,243
   measured); a compression ratio of at most 100 per entry (16.8 measured); compression methods
   stored or deflate only; no encrypted entry; no duplicate name; no link entry; entry names relative,
   without `..`, backslash, drive letter or control character; a local-header name that differs from
   the central-directory name refuses the archive. Directory entries (164 in the pinned archive) are
   allowed in the archive and never served. A violation is `app_runtime_unverified`.
4. **URL parameters**: the spike's documented set plus `lang=en`, which pins the UI language and with
   it the served set (measured: `lang=de` loads `resources/dia_de.txt` instead of
   `resources/dia.txt`) —
   `embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none&lang=en`;
   `configure` is answered with `{ compressXml: false }`. A further parameter is added only if it is
   documented and measured by the conformance suite.
5. **Below the page** the shell's sink proxy, the absent host resolution and the disabled WebRTC UDP
   apply unchanged; draw.io gets no channel of its own. "No request refused" is evidence for the
   routed and policy-checked channels; what the sink blocks without recording is covered by the
   shell's network test (PADR-0045).
6. **Budgets and bounds.** The start runs within the shell's deadlines (15 s launch, 60 s app start);
   each protocol request waits at most the operation's remaining time (at most 10 s,
   `MAX_ADAPTER_MS`), not the start's 60 s. The conformance suite starts the adapter in 5 fresh
   processes and fails when the median from process start to the first `load` exceeds 3 s (1.31 s
   measured under load); it records the peak RSS of the Chromium process tree and of the Node
   process and fails when the Chromium tree exceeds 1.5 GB — the spike's bound, which covers the
   Chromium tree only — or the Node process exceeds 1 GB. The adapter's own Node memory is bounded by
   design (decision 2.6).

### 4. Protocol: write and read only through the embed JSON protocol

1. **Write** is `load` of the complete predicted state as uncompressed `mxGraphModel` XML.
   **Read-back** is `export` with `format: "xml"`. No script is evaluated in the app frame; Node
   drives the host page, the host page talks to the app only by `postMessage`. The `load` event is
   never taken as proof (the spike: it arrived without an error in all 12 negative cases, including
   malformed XML). `merge` and diff-sync `patch` are not used (REPORT, question 1).
2. **Every transaction** (apply, restore, start) reads the committed scene first and compares it
   with the transition's before state on live objects; computes its own prediction of the action
   independently of the core (as `actionPrediction` does for Excalidraw) and refuses when it differs
   from the core's after state; writes; reads back; and requires all three:
   - **the declared set**: the projection of the read-back equals the predicted state's live objects
     exactly (`real_tool_disagrees` otherwise);
   - **the full write check**: every element the adapter wrote under the model's `root` — each cell
     with every attribute and every child element at any depth (`mxGeometry` with `x`, `y`, `width`,
     `height`, `relative`, its `mxPoint` children with their `as` and coordinates, offsets, and any
     `visible`, `collapsed`, `connectable` or other attribute) — comes back exactly as written, and no
     element comes back that it did not write (`integrity_failed`). Only file metadata (`mxfile`,
     `diagram` and `mxGraphModel` attributes) is outside it. The writer writes what draw.io's codec
     writes back: it leaves out an `x` or `y` of 0 (measured). Measured with the decided mapping: 3 ×
     672 round trips, every write check empty;
   - **integrity**: unique ids, one root, existing parents, no cycle, no edge as a parent, edge ends
     are steps, `html=0` everywhere, integer geometry, only the adapter's colours, shapes and style
     keys, and every declared constraint (decision 1.2) holds (`integrity_failed`).
   A failure is undone in place or the committed scene is rebuilt on a fresh page by the shell
   (PADR-0045 decision 7); under `--mirror required` the step is rejected and the core state is
   unchanged (PADR-0011). The spike's 12 silent-change cases become conformance cases, written
   through a test seam that loads hand-written XML: the 10 in which draw.io changed, dropped or kept
   invalid content must be refused by these checks; the 2 it kept exactly (markup as literal text
   under `html=0`; umlauts, NFD, emoji and 2,048 characters) must round-trip. Added: a written step
   that comes back with `visible="0"`, a terminal point moved from x=20 to x=999, a written tab, CR,
   CRLF and a C0 control in a label (the last refused before writing, decision 5.2).
3. **Parsing the read-back** uses the browser's XML parser in the host page (option D): the export
   string, bounded to 10 MiB, is parsed by `DOMParser` there; because a parse error yields a document
   with a `parsererror` element rather than an exception, the host-page script refuses any document
   that contains one, or whose root is not `mxfile` or `mxGraphModel`, as an integrity failure. The
   cell table returned to Node keeps every attribute and child element. The written side's table
   comes from the writer's own data.
4. **Rendering.** `renderPng` is the protocol's `export` with `format: "png"`: a `data:image/png`
   reply, decoded in Node, accepted only with the PNG signature and at most 10 MiB, served as before
   (`image/png`, `nosniff`); never a screenshot of the editor. An empty diagram exports a PNG
   (measured, 88 bytes). `renderPng` exists only while the mirror runs. In a model-only draw.io
   session the host refuses the image, the Player disables "show tool" and shows the board drawn
   from the model, labelled as the model, exactly as for Excalidraw (Context); nothing is ever
   presented as the real app without it. `exportArtifact` returns draw.io's own XML export unchanged
   as the native file and its SVG export as the picture; the bench reads that SVG only through its
   strict re-serialiser (PADR-0039).
5. **Not offered:** `importArtifact` (the host does not use it; loading foreign XML into the app would
   widen what reaches it — artifact mode decides that, decision 10). `describe()` lists the
   capabilities without it, and a call answers `unmodeled`.

### 5. Mapping world/2 ⇄ draw.io, and the declared constraints

1. **Cells** (measured: `mapping.ts`, decision 8.4's precursor). Root `pn:root`, one layer
   `pn:layer` (`:` lies outside the semantic id pattern, so no object can take these ids). A **frame**
   is a container vertex, id = frame id, value = name, style
   `swimlane;container=1;collapsible=0;startSize=30;html=0;`, geometry the envelope of its steps plus
   padding and title band (an empty frame keeps its last box). A **group** is a vertex
   `pn:group:<groupId>` with style `group;` and `connectable="0"`, child of its members' frame or of
   the layer, geometry the envelope of its members. A **step** is a vertex, id = step id, value =
   label, style `rounded=0;` / `ellipse;` / `rhombus;` plus `html=0;strokeColor=…;fillColor=…;` from
   the adapter's own table (stroke black `#000000`, red `#b85450`, green `#82b366`, blue `#6c8ebf`,
   orange `#d79b00`; fill `none`, red `#f8cecc`, green `#d5e8d4`, blue `#dae8fc`, yellow `#fff2cc`),
   child of its group, else its frame, else the layer, with integer geometry relative to that parent
   and an `x` or `y` of 0 left out. No `whiteSpace=wrap`: measured, it puts labels into
   `foreignObject` HTML in the SVG export. An **arrow** is an edge, id = arrow id, style
   `endArrow=classic;html=0;`, `source` and `target` its live ends (absent = loose end, with a
   terminal point the adapter remembers), child of its frame or of the layer. A **tombstone** has no
   cell.
2. **Declared constraints, refused by name** (option A.5). For a world whose application declares a
   constraint (decision 1.2):
   - **the core** checks every declared constraint on the successor of every world/2 transition; a
     violation refuses the action with the new error code `constraint_refused`, the same for the
     human and the agent, with the state and its hash unchanged. The message names the constraint and
     the remedy ("on this application a group stays within one frame: ungroup, move the steps, group
     them again"; "this application cannot store this character in a label or frame name"), and
     `details.constraint` names it from the closed list. The host keeps that one detail (today it
     keeps only code and message), the Player shows a catalog entry per constraint (EN/DE) with the
     remedy, and MCP replies carry the same message; a test shows that both surfaces give the same
     explanation. The bench's run text describes the code as "the application cannot hold the
     result". For draw.io this reaches `set_frame` of a grouped step, `group_steps` across frames,
     and `add_step`, `rename_step`, `rename_frame` with a non-XML character;
   - **world validation** refuses a world whose initial state or a task's initial state, in every
     variant case after label substitution, violates a declared constraint (`E_WORLD_INVALID`, the
     message names the constraint and the object);
   - **the checker** applies the same declared constraints with its own implementation: its history
     replay refuses a session whose history contains a violating step, and its state validation
     refuses a violating submitted state (`artifact_invalid`, reason `constraint`); a unit test keeps
     the core's and the checker's implementations equal on shared fixtures;
   - **the adapter** refuses a violating state before writing (defence in depth).
   `unmodeled` keeps its meaning: unknown behaviour. The library and the families never meet a
   constraint (Context); the library build verifies every reference and near miss in the draw.io
   world, so a task that would need a violating state cannot enter the draw.io library unnoticed.
3. **Labels are plain text.** Every label and frame name is written with `html=0`, XML-escaped, tab,
   LF and CR as character references; world text is never written as markup. The spike's `html=1`
   probe made draw.io render the markup and issue a request; the adapter never writes it and
   integrity refuses it if it comes back. Labels reach the app in NFC (the core accepts display text
   only in NFC) and the spike showed draw.io keeps NFD and NFC exactly; ids are ASCII by pattern.
4. **Geometry** in the judged state is the core's integer boxes. Frame and group geometry are
   adapter-computed envelopes and excluded; a child's stored coordinates are relative to its parent
   and the readers add every ancestor's offset (PADR-0047 decision 10). Excluded from the declared
   set, each with its reason in `describe()`: frame and group geometry (envelope), edge waypoints and
   terminal points (derived), label geometry and font (draw.io uses the system font; rendering
   depends on the platform), z-order, style keys outside the mapping, file metadata (random diagram
   id, `host`, view attributes). Excluded from the declared set is not excluded from the write check:
   every written attribute is compared (decision 4.2).
5. **Ids** are the semantic ids (the spike and the probes: draw.io kept every id written). Arrow
   frames follow world/2's rule (their ends' common frame, else none; both ends loose keeps the
   frame).

### 6. The checker's independent `.drawio` reader

1. **Independent and faithful.** `src/checker/drawio.ts`, ported from the spike's `parser.ts` and
   hardened: its own bounded XML tokenizer, its own style parser and its own colour table. It imports
   nothing from `src/adapters` or `src/core` (architecture §2) and nothing from the spike's writer.
   The adapter's read-back (decision 4.3) is a different implementation on a different XML parser.
   Being independent is not enough: where draw.io's codec would read a form differently, the reader
   follows the codec or refuses the file. Every rule below gets a differential fixture through the
   real app (decision 6.7).
2. **XML.** End-of-line handling first: CRLF and a lone CR become LF; then attribute-value
   normalisation (a literal tab or LF becomes a space; a character reference keeps its character).
   Attributes must be separated by whitespace. A character — raw or by reference — outside the
   XML 1.0 character set is refused, as are DOCTYPE, any entity but the five predefined ones and
   numeric references, a bare `&`, an unclosed or mismatched element and more than one root
   (`xml_invalid`, `xml_doctype`).
3. **File and model.** An `mxfile` with exactly one `diagram`, or a bare `mxGraphModel`; several pages
   are refused (`pages_unsupported`). A `diagram` is compressed if and only if its trimmed text content,
   descendants included, is non-empty, and then it has no element child (Base64 of raw deflate of the
   URI-encoded model, inflated with `maxOutputLength`); otherwise it holds exactly one `mxGraphModel`
   and no other element (`diagram_invalid`). A cell has at most one child with `as="geometry"`; a
   vertex or edge has exactly one, and it is an `mxGeometry` (`cell_invalid`). `vertex`, `edge`,
   `visible` and `collapsed` take only absent, `"0"` or `"1"` (`cell_invalid`). Every coordinate and
   size uses one grammar, `-?digits[.digits][(e|E)[+|-]digits]`; any other spelling (`0x1F4`, `0b11`,
   blank) is `geometry_invalid`; an absent `x` or `y` is 0, as the codec writes it.
4. **Reading rules** (world/2, any `.drawio` file, the same rules for the session's native export):
   - the root is the cell without a parent, layers are its children, whatever their ids;
   - a cell is read only when it and every ancestor are visible and no ancestor is collapsed; a
     hidden cell, a cell of a hidden layer and every descendant of a hidden or collapsed cell are
     listed as unmodeled (hidden) and not read;
   - **edge labels are classified first**: a vertex whose parent is an edge is an edge label, listed
     as unmodeled and not read, before any parent rule applies; an edge whose parent is an edge is
     `structure_invalid`;
   - a **frame** is a vertex with the style name `swimlane` or `container=1`; a **group** a vertex with
     the style name `group`; an **arrow** an edge. A **step** is a vertex whose style holds at most one
     shape-determining token — a style name (`ellipse`, `rhombus` or any other name) or a `shape=`
     key — and that token is absent (a rectangle; `rounded` either way), `ellipse`, `rhombus`,
     `shape=ellipse` or `shape=rhombus`. A step style with more than one shape-determining token
     (`ellipse;rhombus`, `ellipse;shape=rhombus`, `shape=ellipse;rhombus`) is refused
     (`unmodeled_value`): draw.io applies them left to right and draws the last, and the reader does
     not reproduce the stylesheet cascade. A vertex with another single shape is listed as unmodeled
     and not read;
   - a step's frame is its nearest frame ancestor; its group is the outermost group between it and
     that frame (or the layer). A group cell that has a frame among its descendants groups frames: it
     is listed as unmodeled and gives no step a group. The reader therefore never yields a group across
     frames;
   - a step's box: its `mxGeometry` plus the `x`/`y` of every ancestor vertex, then rounded by edges
     with `Math.round` as PADR-0047 decision 10 states. For `.drawio` a step with a width or height of
     0 or less, or with `relative="1"` on itself or on any vertex ancestor, is refused
     (`geometry_invalid`) instead of normalised or widened: draw.io does not draw such a shape as a
     box. `rotation` is ignored here as in Excalidraw's world/2 reader, and layout units' reading rules
     refuse it (PADR-0047);
   - an arrow's ends are `source` and `target` when they are read steps. A head is drawn at the end
     unless `endArrow` is `none` or empty, and at the start when `startArrow` is set to anything but
     `none` or empty; a single head at the start reverses the ends, as for Excalidraw. Its frame
     follows world/2's rule; an arrow with both ends loose takes its nearest frame ancestor;
   - ids matching the semantic id pattern are kept; `pn:group:<id>` gives the group id `<id>`; any
     other id gets a derived one, as `src/checker/scene.ts` does. **Group ids are injective over group
     cells**: the reader keeps a set of group ids and refuses a second group cell that yields an id
     already taken (`duplicate_id`; a file with group cells `g1` and `pn:group:g1` is a fixture);
   - **values are not snapped**: an absent `strokeColor` reads as black and an absent `fillColor` as
     none (the adapter always writes both); any other value outside the reader's own table refuses the
     file (`unmodeled_value`). Excalidraw's world/2 reader maps colours to the nearest palette name
     (world format §2a); draw.io's palette is not world/2's, so a nearest rule would invent colours
     (PADR-0043 decision 4 points the same way);
   - **labels**: with `html=0` (or no `html` key) the value is the label; with `html=1` the value is
     read only when it contains no `<`, no `&`, no tab, LF or CR, no run of spaces and no leading or
     trailing whitespace — then HTML shows exactly that text — and refused otherwise
     (`markup_label`). The reader never parses HTML. Labels are compared after NFC; invisible
     format characters are refused, as in `scene.ts`; at most 4,096 code points;
   - also listed as unmodeled and not read (never fatal): text-only cells, images, edge values,
     nested frames (a frame's own frame is ignored) and `UserObject`/`object` data attributes. A label
     of an `object` with `placeholders="1"` that contains `%` is refused (the app would show other
     text).
5. **Limits** (the checker's, listed in threat model §4): file 10 MiB (as `scene.ts`); inflated page
   10 MiB through `maxOutputLength`; 50,000 XML elements, depth 64, 128 attributes per element,
   65,536 characters per attribute value, style strings 4,096 characters and 128 keys; 5,000 cells
   (as `scene.ts`); parent chains of at most 64 (so the projection's work is at most 5,000 × 64
   ancestor steps); coordinates within ±1,000,000 after adding ancestors. Goal evaluation keeps
   PADR-0013's fuel.
6. **Refusals** are `artifact_invalid` with `details.reason` from a closed list: `too_large`,
   `xml_invalid`, `xml_doctype`, `pages_unsupported`, `diagram_invalid`, `cell_invalid`,
   `duplicate_id`, `structure_invalid` (root count, missing parent, cycle, an edge whose parent is an
   edge), `geometry_invalid`, `markup_label`, `text_invalid`, `unmodeled_value`, `constraint`
   (decision 5.2). A `.drawio` file for an Excalidraw world, or the reverse, is refused by the format
   table as today. The request format `drawio` joins the checker request's enum.
7. **Fixtures.** Hand-written files with expected values derived from the file format (not from the
   reader); real exports of the conformance suite; the counter-probes empty, unchanged start and wrong
   artifact written and exported through draw.io (the spike: 144/144 failed). **Differential fixtures
   through the real app** for every rule of 6.2–6.4: each file is loaded into draw.io through the
   conformance seam and the app's own export, and its SVG rendering, are compared with the reader's
   reading — the reader agrees or refuses, never reads something the app does not show. They include
   CRLF in attributes, adjacent attributes, `&#1;`, both compressed text and a model child, two
   geometries, `x="0x1F4"`, `vertex="true"`, hidden and collapsed ancestors, an edge label vertex,
   `ellipse;shape=rhombus` and `shape=ellipse;rhombus`, `endArrow=`, `g1` beside `pn:group:g1`, a
   `" A "` label with `html=1`, non-positive sizes and a relative ancestor. For PADR-0047 decision 10:
   steps inside groups inside frames, with integer and fractional offsets; the reader's boxes must equal
   the boxes draw.io renders in its SVG export (relative to a reference step on the layer). Until they
   pass, the `layout` unit on draw.io is not pre-probed (PADR-0047).

### 7. Linux: draw.io never starts without the Chromium sandbox

1. Each registry entry names its **sandbox policy**: Excalidraw keeps PADR-0032's (sandbox first, on
   Linux one start without it when the system refuses it); **draw.io requires the sandbox on every
   platform**. The shell takes the policy from the entry; a draw.io start ignores a fallback the
   process already made for Excalidraw. `PRACTONAUT_CHROMIUM_SANDBOX=require` still tightens
   Excalidraw and changes nothing for draw.io; nothing loosens draw.io's.
2. The start check before the mirror (`chromiumStarts`) runs with the adapter's policy. On a Linux
   system that refuses the sandbox, `--mirror required` stops with `browser_start_failed` and the
   existing AppArmor advice; `--mirror auto` runs model-only with that notice; `doctor --adapter` says
   that draw.io needs the sandbox and whether it starts; `setup --app drawio` says so before the
   download (decision 2.1).
3. **Tests without the global variable** (they fail without the per-adapter policy): with
   `PRACTONAUT_CHROMIUM_SANDBOX` unset and a fake Chromium, (a) after Excalidraw's fallback has set the
   process memo, a draw.io start still asks for the sandbox; (b) a draw.io start whose sandboxed launch
   is refused for the sandbox reason fails and never launches a second time without it; (c) on a
   simulated restrictive Linux the CLI answers `browser_start_failed` by name. The CI step that lifts
   the restriction keeps its global `require` only for its own Excalidraw check; the draw.io layer runs
   there without it.
4. **Why.** Nothing was measured on Linux (UNKNOWN), so the safer option wins. The amendment that lets
   Excalidraw start without the sandbox rests on what the browser loads: the engine Practonaut builds
   from a locked dependency. draw.io is 20.1 MB of downloaded third-party script (99 % of the 20.3 MB
   the app loads; `app.min.js` 10.1 MB, `extensions.min.js` 4.6 MB), including code the adapter never
   uses but the app loads: HTML label rendering, and the import and layout bundles the spike found in
   `extensions.min.js` (Visio import, ELK, Mermaid, dagre). The adapter's input to it is as narrow as
   for Excalidraw (escaped plain-text labels and names, integer geometry, styles from a fixed table,
   decisions 4 and 5), but no review or measurement shows that this keeps a renderer exploit out of
   reach. draw.io is opt-in: the person who loses the mirror on an affected system asked for it, is
   told before the download and at every start, and can lift the restriction in the system or practise
   model-only; Excalidraw practice is untouched.
5. **Cost.** On Ubuntu 23.10 and later with the default AppArmor setting, draw.io sessions run
   model-only until the restriction is lifted. In CI the draw.io layer runs in the Linux step that
   lifts it (`kernel.apparmor_restrict_unprivileged_userns=0`).

### 8. The 16 library tasks, the families and the acceptance on draw.io

1. **One task set, two worlds, two oracle files.** `npm run library:write` also writes the draw.io
   library: `tasks/drawio/world/world.json` — the Excalidraw library's tasks, variant cases, titles,
   prompts and hints unchanged (they do not mention Excalidraw; 0 occurrences), id `drawio-library`,
   the library's version, `app: { adapterId: "drawio", versionRange: "32.4.1" }` and
   `taskSet: { id: "excalidraw-library", version: "1.1.0" }` — and `tasks/drawio/library.json`, the
   oracle file with world id `drawio-library` and the same steps, near misses and seeds, re-verified
   in the draw.io world (references pass, near misses fail, the start fails, in every case, under the
   declared constraints). `library:check` fails when either file differs from a fresh build. The
   Excalidraw library's content hash does not change. With the task-set key the same seeds select the
   same cases, so every instance has the same task identity on both apps (PADR-0044 decision 3); a
   unit test shows 48 equal identities for 16 tasks × 3 cases (the review computed 48 distinct ones).
   `tasks/drawio/` joins the package files (CC0, no third-party content).
2. **Selecting and anchoring the library.** Libraries are a table keyed by adapter id (`excalidraw`,
   `drawio`), each with its world folder and oracle file. A task id prefixed `drawio/` names the
   draw.io library in `play`, `bench --tasks` and `tasks list` (`drawio/all` for all); an unprefixed id
   keeps naming the Excalidraw library; a bench mixing prefixes is refused (a bench stores one world).
   `report --verify` anchors a library bench to the library this Practonaut ships for the stored
   world's `app.adapterId` — id, version and content hash, as PADR-0044 decision 2 states — and binds
   its references to that library's oracle file.
3. **Near misses on draw.io** are the library's own: 39 single-fault sequences (19 kinds, from
   `misordered` to `missing-set-frame`) in 3 cases, 117 per run, plus the unchanged start in each
   case (48). Their verdict comes from the checker reading draw.io's native export. Added for draw.io
   only, as conformance cases rather than library content: the silent-change cases of decision 4.2,
   the coverage sequence with the group-across-frames step answered `constraint_refused`, and the
   counter-probes written through the app.
4. **"Three runs agree", in a form that can fail.** A run is a fresh process with a fresh browser; the
   three runs take the sequences in three recorded orders (forward, reverse, a shuffle with a recorded
   seed). In each run, for every task × case × sequence (start, reference, every near miss — 213 per
   run): a new session, `restoreState` of the start, every step through `adapter.apply` (all checks of
   decision 4), `exportArtifact`, and `checkSubmission` with format `drawio` on that native file.
   Recorded per sequence: the canonical hash of the app's export after every step and of the native
   file (diagram id normalised), the final PNG's hash, and the full verdict (pass and error classes).
   Pass: in each run every start and near miss fails and every reference passes, every step's checks
   hold, nothing is refused by the shell; and the three runs agree on every recorded value. The core's
   own hashes do not count as agreement: the per-step checks fix them. Measured as a precursor (the
   spike's reader instead of the product's, Context): 3 × 213 sequences, every expectation met, 0
   disagreements on export chains, PNG bytes and verdicts. The acceptance numbers come only from this
   protocol in the product.
5. **Families.** No challenge family is published today (the 0.2.0 round: none passed;
   [challenge reports](../benchmarks/challenge/README.md)). To find problems before the release, the
   draw.io layer runs every family the generator has (`FAMILIES`, and `challenge-layout` once P5b
   lands) on seeds 1–3 at difficulty `mixed` through the same protocol. The generator gains an `--app
   drawio` option that writes the same instances into a draw.io world with `generatedBy` unchanged, so
   that identities pair; a family published before the release joins the acceptance and the compare
   below.
6. **Durable evidence.** Committed under `docs/benchmarks/drawio/` (a page linked from
   `docs/index.md`): the conformance summary of the release commit in a versioned schema without local
   paths (commit, platform, Chromium version, sandbox state, pin, per-run totals, the recorded hashes
   and orders); the two oracle bench/3 folders; and the compare page. CI always uploads the summary
   JSON of its conformance run (a listed path; it holds no part of the archive).
7. **Platforms.** Setup and reader unit tests run on all three CI platforms; the conformance layer
   runs on Linux in the step that lifts the restriction, on every CI run. Before acceptance a manual
   workflow (`workflow_dispatch`) runs it on macOS and Windows, three runs each, and its summaries are
   committed beside the Linux one; until a platform has one, `doctor --adapter` and the adapter page
   say the draw.io mirror is not yet verified there.
8. **Re-checked before the release.** [docs/release.md](../release.md) gains a step: on the release
   commit, run the conformance layer with `PN_DRAWIO_REQUIRED=1`, bench the oracle on both libraries
   and compare them; the committed evidence of 8.6 is replaced by that run's, and the release notes
   state the counts.
9. **"One report shows the same tasks on both apps"** is `practonaut compare` of the two oracle
   bench/3 reports at session level, both with `--mirror required`, on the same seeds (one per case)
   and repeats, paired by task identity (PADR-0044 decision 2). It counts only when both reports have
   `environment.mirror` `required` and every run has a native-export verdict (`native.excalidraw`,
   `native.drawio`). Expected: 48 paired identities with equal run counts and no difference between
   the two configurations.

### 9. Trademark, naming, documentation, threat model

1. **Source.** The README of `jgraph/drawio` (default branch, read by the coordinator on 2026-10-18)
   says that draw.io is "jointly owned and developed by draw.io Ltd (previously named JGraph) and
   draw.io AG", that "draw.io is a registered EU trademark (#018062448)", and that use of draw.io
   trademarks requires prior written permission. The registered owner according to EUIPO is UNKNOWN.
2. **Interim notice**, wherever draw.io is first named on a page or in output (README, the adapter
   page, `setup --app drawio`): "draw.io is a registered trademark; Practonaut is not affiliated with,
   endorsed or sponsored by draw.io Ltd or draw.io AG." The roadmap's notice text is the coordinator's
   to align. Text says what the adapter works with: "works with draw.io". No draw.io logo anywhere —
   the Player shows the protocol's PNG of the diagram, never the editor's interface.
3. **Open with the maintainer:** whether descriptive naming, including the identifiers below, needs
   the written permission the README asks for. Until the maintainer decides, no release, post or
   launch page names draw.io. No "draw.io" in product or package names: the npm package stays
   `practonaut`, and no package, command or product is named after it. Identifiers that name the file
   format and the app the adapter works with are descriptive: adapter id and prefix `drawio`,
   `src/adapters/drawio/`, `tasks/drawio/`, the world id `drawio-library`, the extension `.drawio`
   (draw.io's own); they change if the maintainer's decision requires it.
4. **Licence.** The adapter page states what the spike found (Apache-2.0 app code; the stencil clause
   limited to Atlassian products and their marketplace, which binds a downstream product distributed
   there; LGPL-2.1 libavoid in the archive, not loaded) and that Practonaut downloads the unmodified
   release on the user's request and never redistributes it — not in the npm package, not in a CI
   artifact or cache. Any redistribution would reopen the spike's criterion (f).
5. **Pages** (implementation): README; a new `docs/adapters/drawio.md` (setup, `--from`, location,
   removal, the allowlist, protocol, mapping, constraints, reading rules, licence, trademark, platform
   status), linked from `docs/index.md`; `docs/benchmarks/drawio/` (decision 8.6); getting started
   (setup option, the Linux sandbox note); world format (§1.4 codes; §2a: the draw.io export, the
   reading rules, the declared constraints and `constraint_refused`); architecture (modules, §3's
   error list with `constraint_refused`, §10); adapter guide (§3 as built); testing (`PN_DRAWIO_HOME`,
   `PN_DRAWIO_REQUIRED`, the draw.io layer); release; CONTRIBUTING (fetching the runtime for tests);
   the benchmarks guide (both apps, `compare`); CHANGELOG.
6. **Threat model.** A new boundary row *Download → app runtime* (threats: a substituted or damaged
   archive, an endless, trickling or oversized body, a partial file kept, concurrent setups, a file
   swapped after the check, hostile entry names, a zip bomb, serving `WEB-INF`/`META-INF` or the
   archive's agent-instruction files, redistribution through CI; controls: decisions 2 and 3.2–3.3).
   *Adapter ↔ real app*: draw.io through the embed protocol only, no script in its frame, the full
   write check, `html=0`, the sandbox required on every platform. *Host → checker*: the `.drawio`
   reader's rules and limits. *Core*: declared structural constraints. §3 item 6 names draw.io. §4
   lists the reader's and the archive's limits.

### 10. Phasing

1. **This pull request closes Must 2.** It is built on PR #66 (bench/3, `taskSet`), which merges
   first; there is no interim path. It delivers the three table entries and the declared constraints
   (decisions 1 and 5.2: world table, core, world validation, checker, host detail, Player catalog,
   MCP parity), setup and the runtime check, the adapter on the shell, the checker reader, the
   per-adapter sandbox policy, the Player (board workspace only for draw.io worlds: the editor and
   author workspaces embed Excalidraw and say they are unavailable; export as `practonaut.drawio`),
   `run --export`, `doctor`, the library table and the committed draw.io library with its oracle
   file, the generator option, the CI steps and the workflow allowlist check, the conformance layer
   (library, families, negatives, three runs), the committed evidence and compare page, docs and the
   threat model.
2. **Before acceptance**, besides the PR's own runs: the macOS and Windows conformance summaries
   (decision 8.7) and the maintainer's decision on naming (decision 9.3).
3. **Artifact mode (Must 3), not here:** the draw.io MCP toolchain and its pinned server; reading
   rules beyond decision 6 (text from HTML labels, unmodeled values failing only the clauses that need
   them, the layout object allowance of PADR-0047 decision 5); loading foreign `.drawio` files into
   the real app for differential conformance outside the test seam, and whether that needs more than
   decision 7.
4. **Not in 0.3.0:** an embedded draw.io editor as input device, `tasks from-scenes` from `.drawio`
   pairs, incremental writes (`patch` or `merge`).

## Consequences

- A user who never runs `setup --app drawio` sees no change. One who does keeps 48.4 MB in the data
  directory and gets draw.io worlds mirrored into the real app; without it they run model-only with a
  message naming the setup option and the size.
- The core gains one generic mechanism, declared structural constraints, and one error code,
  `constraint_refused`. The same action answers differently on two applications because the world
  table says so, not because the core knows an adapter; a third application with other limits adds
  data and, if needed, a constraint to the closed list. Task identities are unaffected (the start and
  the goal are the same).
- Two independent `.drawio` readings exist (the adapter's, on the browser's XML parser; the checker's,
  on its own tokenizer, following the codec or refusing); a disagreement fails the transaction or the
  export pair instead of passing silently.
- `practonaut check` reads `.drawio` files strictly: a file drawn in draw.io with colours outside the
  table, with markup in its labels, with stacked shape tokens or with other ambiguous forms is refused
  by name until artifact mode's reading rules (Must 3) decide otherwise.
- Each running draw.io adapter holds the 48.4 MB archive in Node memory.
- On Linux with the default AppArmor restriction draw.io is model-only; CI covers draw.io in the
  Linux step that lifts the restriction; macOS and Windows are covered by the manual workflow before
  acceptance and the release re-check.
- Each CI run downloads 48.4 MB from GitHub; a release outage or a removed asset fails the draw.io
  step by name (`app_download_failed`) after bounded retries, not silently. Caching it is not an
  option (maintainer decision).
- A draw.io release bump is a code change: a new pin, `appVersions`, the allowlist, and a full
  conformance run on three platforms; worlds that name the old version are refused by name. The
  release cadence is high (six releases in eight days before the pin, REPORT), so the pin moves only
  on purpose.

## Re-assessment triggers

- A Linux measurement or review that shows draw.io's attack surface, given what the adapter writes,
  no wider than the bundled engine's — or users for whom the sandbox requirement blocks draw.io and who
  cannot lift the restriction.
- A world/2 task, family or generator that needs a state a declared constraint forbids, or a new
  application whose limits the closed constraint list cannot state.
- draw.io changes the embed protocol, the export format, the codec's defaults, the files it loads, or
  refuses to run from local files; the vendor withdraws or changes the release asset or its licence;
  the trademark holders or the maintainer object to the naming.
- The conformance suite's fresh-process start median, peak Chromium RSS or Node RSS exceeds two
  thirds of its bound (2 s, 1 GB, 667 MB). Two thirds, not one half: under this record's measurement
  load the start median and the Chromium peak already reached about 44 % of theirs.
- Artifact mode needs to load foreign files into the app (Must 3).
- A user need for `importArtifact`, an embedded draw.io editor or `.drawio` scene pairs.

## Review (2026-10-19)

Three independent reviews of the first draft (commit 2093810): OpenAI Codex (9 findings and a gap
list), Google Gemini (9 findings and 3 gaps) and a Claude Opus workflow with three lenses — supply
chain, core and reader, measurement — and a skeptic per major finding (30 findings). The
coordinator decided the converging points (D1 declared constraints and a named refusal; D2 the
archive in memory; D3 no new product variable, strict test-only names; D4 an allowlist and `lang=en`;
D5 zip limits; D6 setup; D7 a CI path allowlist; D8 write check and reader faithfulness; D9 library
and oracle binding; D10 runs that can fail; D11 durable evidence; D12 platforms; D13 sandbox tests;
D14 model-only display; D15 phasing on #66; D16 the trademark notice; D17 measurements). Severity is
the skeptic's after verification where one was run, otherwise this revision's check of the claim.
Every finding and its disposition:

| Finding (reviewer, severity after verification) | Disposition | Where, or why not |
|---|---|---|
| Codex 1 (major): the write check misses `visible="0"` and a moved terminal point | Adopted (D8) | 4.2: full write check over every attribute and child element; both mutations are negative cases; measured empty over 3 × 672 round trips |
| Codex 2 (major): group id mapping not injective (`g1` and `pn:group:g1`) | Adopted (D8) | 6.4: group ids injective over group cells, `duplicate_id`, fixture |
| Codex 3 (major): Linux acceptance cannot see a missing per-adapter sandbox policy; the global `require` hides it | Adopted (D13) | 7.3: tests without the global variable (memo set, no second start, named failure); the draw.io layer runs without the global `require` |
| Codex 4 (minor): tokenizer differs from XML on CRLF, missing attribute separators, `&#1;` | Adopted (D8) | 6.2 and differential fixtures (6.7) |
| Codex 5 (minor): edge labels both non-fatal and fatal | Adopted (D8) | 6.4: edge labels classified first; `structure_invalid` only for an edge under an edge |
| Codex 6 (minor): `html=1` value `" A "` passes but HTML trims it | Adopted (D8) | 6.4: leading and trailing whitespace refused; fixture |
| Codex 7 (minor): no absolute deadline for the download | Adopted (D6) | 2.3: 10-minute deadline for the whole chain, 30 s for connect and headers and for stalls, trickle test |
| Codex 8 (minor): the CI rule misses ancestors, globs and variables | Adopted (D7) | 2.8: literal allowlist of saved and published paths, negative fixtures |
| Codex 9 (minor): the notice names an owner the evidence does not show | Adopted (D16) | 9.1–9.3: dated README source, owner-neutral interim notice, EUIPO owner UNKNOWN, naming open with the maintainer |
| Codex gap: the spike hashes and serves by two separate reads | Adopted (D2) | 2.6: one read into memory, hash and serve from that buffer; the script now does so |
| Codex gap: no normative zip limits | Adopted (D5) | 3.3 |
| Codex gap: a small, versioned state contract checked generically by the core; the checker independent | Adopted (D1) | 1.2, 5.2 |
| Codex gaps: policy and network, checker safety, mirror and ids, `taskSet`, variables | Agreed | No further change; the measured `0 refused` is qualified in 3.5; variables replaced (D3) |
| Gemini 1 (blocker, downgraded to minor: #66 merges first): acceptance needs #66 | Adopted (D15) | 10.1: built on #66, no interim path, the PR closes Must 2 |
| Gemini 2 (minor after check): rename and directory sync on Windows | Adopted with change (D6) | 2.3: directory sync on POSIX only (the existing helper already skips Windows), rename retried; no handle stays open (2.6) |
| Gemini 3 (minor after check): `renderPng` undefined in model-only sessions | Adopted (D14) | 4.4; the failure path described does not occur: the host already refuses the image without a mirror (`src/host/session.ts:451`) and the Player disables it (`src/player/main.ts:711`) |
| Gemini 4 (major): no inflate limits when serving from the zip | Adopted (D5) | 3.3: per-entry, total, ratio, count, methods, byte counter on every inflate; 6.3 `maxOutputLength` in the checker |
| Gemini 5 (major): app-specific topology in the core | Adopted (D1) | Option A.4 rejected; 1.2 and 5.2: declared, generic, no adapter id in the core |
| Gemini 6 (minor): `DOMParser` reports errors with a `parsererror` element | Adopted (D8) | 4.3 |
| Gemini 7 (minor): `PRACTONAUT_DRAWIO_REQUIRED` fails open on `true` | Adopted with change (D3) | 2.8: renamed `PN_DRAWIO_REQUIRED`, only `1` or `0`, anything else stops the run; `true` is refused rather than accepted |
| Gemini 8 (minor): CI downloads on every run; rate limits | Adopted with change | 2.3: bounded retries with backoff; caching not adopted — the maintainer decided that the runtime is never cached in CI |
| Gemini 9 (minor): `JGraph Ltd` versus `draw.io Ltd` | Adopted (D16) | 9.1–9.2 |
| Gemini gap 1: no per-message protocol timeout | Adopted | 3.6: each request waits at most the operation's remaining time (≤ 10 s) |
| Gemini gap 2: are paths checked after URL decoding? | Adopted (D4) | 3.2: the shell decodes, then checks; lookup by exact decoded name |
| Gemini gap 3: Unicode normalisation of attributes | Adopted | 5.3: labels reach the app in NFC (the core accepts only NFC display text) and draw.io keeps them; ids are ASCII; the reader compares after NFC |
| supply-01 (minor): file swapped after the hash by another OS user; `PRACTONAUT_APPS` breaks PADR-0029 | Adopted (D2, D3) | 2.6: read whole, hash and serve from memory, no link following, regular file only; `PRACTONAUT_APPS` dropped (option G), PADR-0029 unchanged |
| supply-02 (minor): every entry outside `WEB-INF`/`META-INF` served; UI language not pinned | Adopted (D4) | 3.2 allowlist; 3.4 `lang=en` measured; the agent-instruction files' location measured and stated (Context) |
| supply-03 (minor): SHA-256 not printed before fetching | Adopted (D6) | 2.1, 2.4, 2.5: full SHA-256 and exact byte count before fetching, in `--from` and in the mismatch message |
| supply-04 (minor): concurrent setups and a fixed partial name | Adopted (D6) | 2.3: unique partial name, lock per version directory, re-hash after the rename |
| supply-05 (minor): no parsing rules for the new variables; required flag fails open | Adopted (D3) | 2.8: test-only `PN_` names with strict values; the workflow check asserts the flag; the summary must report sequences; setup tests use their own homes |
| supply-06 (minor): the CI guard matches names only | Adopted (D7) | 2.8: allowlist, deletion step under `always()`, `*.war` in `.gitignore`, `test:pack` refuses `.war` and zip members |
| supply-07 (minor): no inflate limits, duplicates or methods when serving | Adopted (D5) | 3.3, including the local-header name check |
| supply-08 (minor): no overall deadline, no redirect cap | Adopted (D6) | 2.3 |
| core-unmodeled-code (minor): `unmodeled` for a known limit; details dropped by the host | Adopted (D1) | 5.2: `constraint_refused`, message with the remedy, the host keeps `details.constraint`, Player catalog entry, MCP parity test, bench text |
| core-xml-chars (minor): non-XML characters accepted model-only, refused under the mirror | Adopted (D1) | 1.2 `xml-text`, 5.2 in validation, core and checker; 6.2 tokenizer; conformance cases (4.2) |
| core-group-id-collision (major) | Adopted (D8) | As Codex 2 |
| core-codec-divergence (major): the reader decodes forms differently from draw.io's codec | Adopted (D8), the remedy verbatim | 6.3, with fixtures (6.7); "exactly one geometry" applies to vertices and edges, since root and layer cells have none |
| core-style-cascade (major): several shape tokens; empty arrow value | Adopted (D8) | 6.4: more than one shape-determining token refused; an empty arrow value is none |
| core-geometry-sizes (minor) | Adopted | 6.4: non-positive sizes and relative ancestors refused for `.drawio` |
| core-visibility (minor) | Adopted (D8) | 6.4: hidden or collapsed ancestors hide their descendants |
| core-write-check-scope (minor) | Adopted (D8) | As Codex 1 |
| core-reading-ambiguities (minor) | Adopted | 6.4: groups of frames give no step a group; a both-loose arrow takes its nearest frame ancestor |
| core-mapping-unmeasured (minor) | Adopted (D17) | The script writes the decided mapping (`mapping.ts`): ids, styles, group cells; 3 × 213 sequences measured (Context, 8.4) |
| measure-three-runs-tautological (minor) | Adopted (D10) | 8.4: fresh processes, three orders, agreement over the app's exports, PNG and verdicts; the core's hashes do not count |
| measure-oracle-worldid-binding (major) | Adopted (D9), option (a) | 8.1: a draw.io oracle file with world id `drawio-library`; 8.2: library table, `drawio/` prefix, `--verify` anchor per adapter |
| measure-compare-without-mirror (minor) | Adopted | 8.9: both benches `--mirror required`, native verdicts on every run; 8.5: published families join, `generatedBy` unchanged |
| measure-measured-today-is-another-protocol (minor) | Adopted (D10) | Context and 8.4 label the measurement as a precursor; 213 sequences per run including starts |
| measure-start-time-representative (minor) | Adopted (D17) | Context and 3.6: fresh-process starts (1,312 ms median) are the basis, the archive work is inside them; an idle machine was not available (load stated) |
| measure-memory-comparison (minor) | Adopted with change (D17) | Spike's full range 491–628 MB; Node reported (316–493 MB) and bounded (1 GB; the adapter's share by design, 2.6); the bound covers the Chromium tree; the trigger is two thirds, not one half (Re-assessment); attribution to Chromium versus shell not measured — it needs the unpacked spike harness, and the archive stays packed |
| measure-acceptance-evidence-not-recorded (minor) | Adopted (D11) | 8.6, 8.8 |
| measure-linux-consequences-incomplete (minor) | Adopted (D12) | 2.1: setup warns before the download; 2.8: skips by name for absent runtime and refused sandbox; setup and the layer scoped to the lifted step |
| measure-platform-coverage (minor) | Adopted (D12) | 8.7: unit tests on three platforms, manual macOS and Windows runs before acceptance, `doctor` says unverified until then |
| measure-trademark-holder (minor) | Adopted (D16) | 9.1–9.3; the re-assessment trigger names the holders |
| measure-workflow-check-bypass (minor) | Adopted (D7) | As supply-06 |
| measure-phasing-pr66 (minor) | Adopted (D15) | 10.1: #66 first, no in-memory re-binding, no interim refusal code; the families' runs are kept (8.5) because they are cheap and catch problems before a family is published |

D5's "refuse directories" is adopted with one change: the pinned archive holds 164 directory entries,
so refusing them would refuse the official release; directory entries are allowed in the archive and
never served (3.3).

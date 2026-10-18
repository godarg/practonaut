# PADR-0049 — draw.io as application #2: a verified download behind the shared shell, the embed protocol only, groups within one frame, and an independent `.drawio` reader

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, Must 2 (issue #52) · Amends
[PADR-0032](0032-chromium-sandbox-stays-on.md) (a sandbox policy per adapter: draw.io never starts
without the sandbox) and [PADR-0045](0045-adapter-registry-and-browser-shell.md) decision 8 (a
downloaded runtime is kept and served as the verified archive, never unpacked) · Builds on
[PADR-0007](0007-adapter-contract.md), [PADR-0011](0011-live-mirror-and-browser-runtime.md),
[PADR-0044](0044-bench-report-v3.md) (task set, task identity, bench/3),
[PADR-0047](0047-bounded-spatial-predicates.md) decision 10 (draw.io geometry) and
[PADR-0043](0043-artifact-judged-verdict-level.md) (what stays for artifact mode) · Evidence: the
0.2.0 spike ([report](../../spikes/drawio/REPORT.md)) and its re-measurement through the shared
shell ([`spikes/drawio/shell.ts`](../../spikes/drawio/shell.ts), summary
[`results/shell.json`](../../spikes/drawio/results/shell.json)) · To be accepted with the pull
request that implements it, after a review of that code

## Context

The draw.io spike passed (REPORT, *Verdict*); its three judgement calls were accepted on 2026-10-14
with two items left for 0.3.0: a record on groups whose members sit in different frames, and the
trademark question. Issue #52 adds a record on whether draw.io may start without the Chromium
sandbox on Linux. Since the spike, Must 1 added the adapter registry with a `downloaded` runtime
kind and a per-adapter read-back comparison, and moved every browser mechanic into a shared shell
with a content security policy, a sink proxy, no host resolution and no WebRTC UDP (PADR-0045). The
maintainer decided on 2026-10-18: the download is opt-in through an explicit `practonaut setup`
option that names the file, the source and the size first and checks size and SHA-256 before
keeping it; Practonaut never redistributes `draw.war`, and it is never put into a CI artifact or a
CI cache (CI downloads and verifies it on every run); the sandbox stays on unless this record shows
a reason.

**Re-measurement through the shared shell** (2026-10-18; macOS 27.0.0 arm64, Apple M4, Node
22.22.3, playwright-core 1.64.0, Chromium headless shell 156.0.8078.4, sandbox on; the machine was
shared with other jobs, load average about 32 on 10 cores, so every time is an upper bound). The
script serves every app file straight from the
verified `draw.war` (never unpacked) through `startShell` with two named origins — a host page
written by Practonaut with one iframe and a `postMessage` relay, and the app — and uses the spike's
writer, reader and write check unchanged. No script runs in the app frame.

| Measure | Spike (0.2.0) | Through the shell |
|---|---|---|
| Download | 48,442,174 bytes, SHA-256 `b836…7820` | same bytes and hash, 7.9 s; GitHub redirects to `release-assets.githubusercontent.com` |
| Cold start (launch → `load` event of the first, empty diagram), 5 starts | median 709 ms (703–923) | median 612 ms (610–1,445; the first start 1.4 s) |
| Archive work per start (median of 5) | — (unpacked tree) | SHA-256 of the archive 20 ms (20–31), reading its directory of 3,154 entries 42 ms (42–69), inflating the 14 served files (20,279,361 bytes) 45 ms (43–58) |
| Library replay, 3 runs × 165 sequences (48 references, 117 near misses), 624 round trips each | all exact; 48/48 pass, 117/117 fail per run | the same; identical step-hash chains in all 3 runs |
| `load` / `export` median per round trip | 4.6–7.9 ms / 1.7–3.1 ms | 3.1–3.4 ms / 1.0–1.1 ms |
| Peak RSS of the Chromium process tree during a replay | 491–579 MB (final runs) | 618–632 MB (3 runs, 4 processes) |
| Requests refused by the shell (any origin, any path, policy reports) | 0 | 0 in 5 starts, 3 replays and the probes; no console error or warning |
| Files the app loads | 14, 20.28 MB | the same 14; `index.html` carries no policy of its own |

Probes (same run): cells with ids outside the semantic id pattern (`pn:root`, `pn:layer`,
`pn:group:g1`) and steps whose ids are `0` and `1` came back unchanged (write check empty). The
exported file carries `host` on `mxfile` (the app origin's host name, `drawio.practonaut.invalid`), a
random `id` and `name` on `diagram`, and view attributes on `mxGraphModel`; no user agent, time or
machine name. The protocol's PNG export is a PNG (8,531
bytes) and byte-identical when repeated. Its SVG export differs only in the random `ge-svg-…` root
id; with `whiteSpace=wrap` in a step's style it holds 2 `foreignObject` elements (HTML inside the
SVG) and a link to the vendor's help page, without it 0 `foreignObject`, plain SVG `text` and no
external reference. The RSS increase over the spike has no measured cause (UNKNOWN; Chromium moved
from 153 to 156 in between). A start after a reboot and every Linux and Windows figure are UNKNOWN.

**What a draw.io cell tree cannot hold.** A cell has one parent. world/2 keeps a step's frame and
group as independent fields (as Excalidraw does), so `set_frame` can leave one member of a group in
another frame than the others, and `group_steps` can group steps of two frames. The spike's
coverage sequence reached that state at step 15; native groups held 22 of 23 round trips, a custom
cell attribute 23 of 23 (REPORT, *Action coverage*; `spikes/drawio/writer.ts:57-58`). The library
never reaches it, and no challenge family creates a group (`src/challenge/diagram.ts:30`). A draw.io
group cell that contains whole frames groups frames, not steps; it is not a world/2 group.

**What still assumes Excalidraw**, beyond PADR-0045's list: the export file names
(`practonaut.excalidraw`, `src/host/export-pair.ts:19,34`, `src/player/export.ts:30,44`;
`native.excalidraw`, `src/bench/run.ts:143`, `src/bench/details.ts:32`); bench/2's environment field
`excalidraw` (`src/bench/report.ts:93,192`, written at `src/bench/run.ts:452`); the challenge
generator's world (`src/challenge/build.ts:142`); the Player's editor and author workspaces, which
embed Excalidraw (`src/player/main.ts:17`); and the CLI's mirror messages, which name Excalidraw
(`src/cli/messages.ts`, `browserRuntimeMissing`, `mirrorFallback`). bench/3 with
`environment.app`, `native.<adapter>` and the task-set key `taskSet` is implemented in PR #66, not
yet on `main`.

**Linux.** CI runs the browser layers under Ubuntu's default AppArmor restriction, so Chromium
starts there without its sandbox (PADR-0032 amendment), and only one later step lifts the
restriction (`.github/workflows/ci.yml:95-104`). This record was written on macOS; no Linux start of
draw.io was measured.

## Options considered

**A. Groups across frames.**
1. *A custom cell attribute* (`object` wrapper, the spike's option i). Lossless and measured 3/3,
   but draw.io does not treat it as a group: the mirror would confirm that the app stores an
   attribute, not that it holds the state, and the checker would have to read a Practonaut-specific
   attribute as a group in any `.drawio` file — a group nobody sees in the app. Two encodings of
   one field (native while the members share a frame, attribute once they do not) would switch
   under single actions. Rejected.
2. *An app-specific action precondition* (option ii). World preconditions are predicates over the
   state; they cannot name an action's parameters (`src/world/types.ts:31-34`), so "the target frame
   of this `set_frame`" is not expressible without a vocabulary change (PADR-0013). Rejected.
3. *`unmodeled` from the mirror only* (option iii). Honest for mirrored sessions, but model-only
   sessions — every session before the opt-in download — would reach states the app cannot hold,
   and the same agent run would differ with and without the download. Rejected as the only control.
4. *A state constraint of the application* (chosen): the world's application decides which states
   exist; the core answers `unmodeled` for a transition into a state the application cannot hold,
   with or without the mirror; world validation, the checker and the adapter refuse such states too.

**B. Keeping the download.** An unpacked tree with a per-file hash manifest (PADR-0045 decision 8,
the spike): 3,154 files and 115.5 MB on disk, Windows path rules, the archive's agent-instruction
and placeholder credential files on disk, and a manifest that must itself be trusted. *The verified
archive, read in place* (chosen): one file, the same size-and-hash check at setup and at every start
(20 ms measured), entries read on request (directory 42 ms, the 14 files 45 ms).

**C. Linux without the sandbox.** *Allow the PADR-0032 fallback for draw.io as for Excalidraw*: the
mirror would run on default Ubuntu desktops and in CI's default steps. *Require the sandbox*
(chosen): see decision 7.

**D. The adapter's read-back reader.** Reuse the checker's reader — forbidden (architecture §2:
adapters do not import the checker) and it would let one parser bug pass both sides. A second
Node tokenizer in the adapter — independent, but a second hand-written XML parser to harden. *The
browser's own XML parser in Practonaut's host page* (chosen): independent of the checker's
tokenizer by construction, no new parser code on the adapter side.

**E. Showing the real app.** A screenshot of the page shows draw.io's editor around the diagram.
*The protocol's PNG export* (chosen): the diagram only, rendered by the app, byte-stable.

**F. The library on draw.io.** Separate `.drawio` source drawings would be a second source of truth
whose tasks could drift. *A world generated from the Excalidraw library that names it as its task
set* (chosen, PADR-0044 decision 3).

## Decision

### 1. Registry entry and named refusal before anything starts

1. **The three tables** gain one entry each, kept equal by the existing tests. World table
   (`src/world/apps.ts`) and registry: id `drawio`, app versions `["32.4.1"]`, world schemas
   `["practonaut.world/2"]` only; in the registry also runtime `downloaded` and read-back comparison
   `live` (draw.io keeps no deleted cells; the core alone holds tombstones, PADR-0045 option 2).
   Checker format table: `drawio`, extension `.drawio`, the reader of decision 6. A world/1 naming
   `drawio` is refused with `E_ADAPTER_SCHEMA_UNSUPPORTED` (world/1 is Excalidraw's strict format
   with tombstones and a font). A world naming another draw.io version is refused with
   `E_ADAPTER_VERSION_UNSUPPORTED`; a pin bump is a code change with a conformance run.
2. **The world table also states what the application cannot hold**: `drawio` has the state
   constraint *one frame per group* (decision 5.2); `excalidraw` has none.
3. **Runtime check before Chromium.** For an adapter whose runtime is `downloaded`, `play`, `serve`,
   `mcp --task`, `run` and `bench` check the kept archive (present, then size and SHA-256 against the
   pin) after the world is validated and its adapter resolved, and before the Chromium check or any
   start. Two new CLI codes, exit 3 like `browser_runtime_missing`:
   - `app_runtime_missing` — the archive is not there;
   - `app_runtime_unverified` — a file is there, but its size or SHA-256 is not the pin's.
   Both messages name the adapter, the remedy `practonaut setup --app drawio` and the download size
   (48 MB), and say that `--mirror off` runs model-only. Under `--mirror required` they stop the
   command; under `--mirror auto` the session runs model-only with one line naming the same remedy,
   and the Player's banner gives the command and the size (the `missing` notice, with the draw.io
   download instead of Chromium). `validate`, `pack` and `check` need no runtime. The adapter's own
   start verifies again (decision 2.5) and fails as `mirror_unavailable` with the same cause, which
   the CLI reports by the same code.
4. **`doctor --adapter`** lists the runtime per adapter (bundled; downloaded and verified; missing;
   does not match the pin) and the Chromium start with the adapter's sandbox policy (decision 7).

### 2. Setup: opt-in download, verification, atomic keep

1. **Opt-in.** Plain `practonaut setup` keeps installing only Chromium. `practonaut setup --app
   drawio` first ensures Chromium exactly as plain `setup` does, then the draw.io release. Before any
   byte is fetched it prints the file (`draw.war`, draw.io v32.4.1), the source
   (`https://github.com/jgraph/drawio/releases/download/v32.4.1/draw.war`) and the size (48.4 MB),
   and the trademark line of decision 9. No install script, `play`, `bench`, `mcp` or test ever
   downloads it implicitly.
2. **Pin.** Tag, asset name, size 48,442,174 bytes and SHA-256
   `b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820` move from
   `spikes/drawio/pin.json` into the adapter as constants. The hash matched GitHub's published asset
   digest when it was recorded (REPORT, *Pin*).
3. **Download.** One HTTPS GET of that URL; redirects are followed only to `https:` URLs (integrity
   comes from the hash, not the host). The body streams into an exclusively created partial file
   (`O_EXCL`, no link following, mode 0600) beside the target, through a SHA-256 and a byte counter.
   It stops when the body exceeds the pinned size or makes no progress for 30 s. Only a complete file
   whose size and SHA-256 equal the pin is kept: flush, rename over the target in the same
   directory, sync the directory. A mismatch removes the partial file and fails with
   `app_download_mismatch` (exit 3) naming the expected and actual size and the first 12 hex digits
   of both hashes; nothing is kept. A network failure fails with `app_download_failed` (exit 3)
   naming the URL and the alternative below; nothing is kept. Stale partial files of an interrupted
   setup are removed by the next one.
4. **Offline and proxies.** `practonaut setup --app drawio --from <file>` verifies a `draw.war` the
   user fetched by other means (a browser, another machine) with the same size and SHA-256 check and
   copies it into place the same way. This is the documented path for machines without direct
   access to GitHub; whether Node's built-in `fetch` honours proxy settings on every supported Node
   line was not measured (UNKNOWN). An already kept file that matches is reported and not fetched
   again; one that does not match is reported by name and replaced by a verified download.
5. **Location.** `<PRACTONAUT_HOME>/apps/drawio/32.4.1/draw.war` in private directories (0700, file
   0600; PADR-0029). `PRACTONAUT_APPS`, an absolute path, replaces `<PRACTONAUT_HOME>/apps` (CI and
   tests, decision 2.7). Removing the runtime is deleting that folder. Every adapter start opens the
   archive once, hashes it from that file descriptor and serves from the same descriptor, so a file
   swapped after the check is never served (same-user processes are trusted, threat model §3.1).
6. **No network at runtime.** After setup, nothing of draw.io is fetched; the app is served from
   the archive (decision 3) behind the shell's network boundary.
7. **Tests and CI.** Unit tests of setup run against a stand-in HTTP server on 127.0.0.1 serving a
   small fixture archive under an injected pin (never the real pin): kept on match; refused on a
   size overrun, a hash mismatch, a truncated body, a stall, a redirect to `http:`; stale partial
   files removed; `--from`. Adapter tests read the runtime from `PRACTONAUT_APPS`; the test preload
   points it at the repository's ignored `.local/apps/` when it is unset, so no test reads
   `~/.practonaut`. They skip with a printed reason when the runtime is absent, except when
   `PRACTONAUT_DRAWIO_REQUIRED=1`, where a missing runtime fails. CI sets `PRACTONAUT_APPS` to a
   directory under `${{ runner.temp }}` (outside the workspace), runs `setup --app drawio` on every
   run, and runs the draw.io layer with `PRACTONAUT_DRAWIO_REQUIRED=1`. No `actions/cache` and no
   `upload-artifact` path may name that directory or a `.war` file: a check in `npm run check` reads
   the workflow files and fails otherwise, with a unit test that shows it failing on such a step.

### 3. Serving: the shared shell, two origins, the archive in place

1. **Origins.** The host page (Practonaut's own: one iframe, the `postMessage` relay, nothing else)
   at `http://practonaut.invalid/`, the app at `http://drawio.practonaut.invalid/`. Both are named
   origins of the shared shell, so every response carries the shell's policy (`default-src` the two
   origins plus `data:`/`blob:`; inline code and `eval` as the app has them, PADR-0045 decision 7);
   measured: draw.io works under it with no refused request and no console error.
2. **What the app origin serves.** A request path maps to exactly one file entry of the verified
   archive (`/` to nothing; the iframe opens `/index.html`). Never an entry under `WEB-INF/` or
   `META-INF/` (any case: Java servlets, placeholder credential files, and files addressed to coding
   agents, which must never reach the app or an agent), never a directory, never a name the shell's
   safe-path rule refuses, only extensions of a fixed content-type table. Entry names were checked
   when the archive was opened (relative, no `..`, no backslash, no drive letter, no control
   character, no link). Anything else is refused and recorded; a recorded refusal fails the
   operation it happened in (`mirror_unavailable`), as for Excalidraw. The conformance suite asserts
   that the library loads exactly the 14 measured files, so a pin bump that changes them is seen.
3. **URL parameters**: the spike's, all documented —
   `embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none`;
   `configure` is answered with `{ compressXml: false }`. A further parameter is added only if it is
   documented and measured by the conformance suite.
4. **Below the page** the shell's sink proxy, the absent host resolution and the disabled WebRTC
   UDP apply unchanged; draw.io gets no channel of its own.
5. **Budgets.** Start within the shell's deadlines (15 s launch, 60 s app start); the measured
   0.6 s cold start plus about 0.1 s of archive work. The conformance suite records start time and
   peak RSS on every run and fails beyond the spike's abort bounds (start median over 3 s, peak RSS
   over 1.5 GB); the measured 618–632 MB is the baseline.

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
   - **the declared set**: the projection of the read-back equals the predicted state's live
     objects exactly (`real_tool_disagrees` otherwise);
   - **the write check** the spike added: every cell the adapter wrote comes back with the same
     parent, value, style, vertex/edge flags, source, target and geometry, and no cell comes back that
     it did not write (`integrity_failed`); file metadata (`mxfile`, `diagram` and `mxGraphModel`
     attributes) is outside the check;
   - **integrity**: unique ids, one root, existing parents, no cycle, no edge as a parent, edge ends
     are steps, `html=0` everywhere, integer geometry, only the adapter's colours, shapes and style
     keys (`integrity_failed`).
   A failure is undone in place or the committed scene is rebuilt on a fresh page by the shell
   (PADR-0045 decision 7); under `--mirror required` the step is rejected and the core state is
   unchanged (PADR-0011). The spike's 12 silent-change cases become conformance cases, written through
   a test seam that loads hand-written XML: the 10 in which draw.io changed, dropped or kept invalid
   content must be refused by these checks; the 2 it kept exactly (markup as literal text under
   `html=0`; umlauts, NFD, emoji and 2,048 characters) must round-trip.
3. **Parsing the read-back** uses the browser's XML parser in the host page (option D): the export
   string, bounded to 10 MiB, is parsed by `DOMParser` there and returned to Node as a cell table; a
   parser error is an integrity failure. The written side's cell table comes from the writer's own
   data, not from parsing its XML.
4. **Rendering.** `renderPng` is the protocol's `export` with `format: "png"`: a `data:image/png`
   reply, decoded in Node, accepted only with the PNG signature and at most 10 MiB, served as before
   (`image/png`, `nosniff`). Never a screenshot of the editor. What draw.io returns for an empty
   diagram is UNKNOWN; the conformance suite measures it and the adapter answers it by name.
   `exportArtifact` returns draw.io's own XML export unchanged as the native file and its SVG export
   as the picture; the bench reads that SVG only through its strict re-serialiser (PADR-0039).
5. **Not offered:** `importArtifact` (the host does not use it; loading foreign XML into the app
   would widen what reaches it — artifact mode decides that, decision 10). `describe()` lists the
   capabilities without it, and a call answers `unmodeled`.

### 5. Mapping world/2 ⇄ draw.io

1. **Cells.** Root `pn:root`, one layer `pn:layer` (`:` lies outside the semantic id pattern, so no
   object can take these ids; measured: kept, and steps `0` and `1` work). A **frame** is a container
   vertex, id = frame id, value = name, style `swimlane;container=1;collapsible=0;startSize=30;html=0;`,
   geometry the envelope of its steps plus padding and title band (an empty frame keeps its last
   box). A **group** is a vertex `pn:group:<groupId>` with style `group;`, child of its members'
   frame or of the layer, geometry the envelope of its members. A **step** is a vertex, id = step id,
   value = label, style `rounded=0;` / `ellipse;` / `rhombus;` plus `html=0;strokeColor=…;fillColor=…;`
   from the adapter's own table (stroke black `#000000`, red `#b85450`, green `#82b366`, blue
   `#6c8ebf`, orange `#d79b00`; fill `none`, red `#f8cecc`, green `#d5e8d4`, blue `#dae8fc`, yellow
   `#fff2cc`), child of its group, else its frame, else the layer, with integer geometry relative to
   that parent. No `whiteSpace=wrap`: measured, it puts labels into `foreignObject` HTML in the SVG
   export. An **arrow** is an edge, id = arrow id, style `endArrow=classic;html=0;`, `source` and
   `target` its live ends (absent = loose end, with a terminal point the adapter remembers), child
   of its frame or of the layer. A **tombstone** has no cell.
2. **Groups within one frame** (option A.4). For `drawio` worlds a state in which the live members
   of one group sit in different frames (a frame or none) is not a state of the application:
   - the core's world/2 transition answers `unmodeled` (details: constraint `group-spans-frames`,
     the group) when the successor would be such a state — with or without the mirror; this reaches
     `set_frame` of a grouped step and `group_steps` across frames; the state and its hash stay
     unchanged (architecture §10, explicit unknowns). Excalidraw worlds are unchanged;
   - world validation refuses a `drawio` world whose initial state or a task's initial state is one
     (`E_WORLD_INVALID`, the message names the adapter and the group);
   - the checker's own history replay applies the same rule, and its state validation refuses such
     a submitted state for a `drawio` world (`artifact_invalid`);
   - the adapter refuses such a state as `unmodeled` without writing (defence in depth).
   To move a group to another frame on draw.io, ungroup, move and group again. The library and the
   families never need it (Context); the library build verifies every reference and near miss in the
   draw.io world, so a task that would need it cannot enter the draw.io library unnoticed.
3. **Labels are plain text.** Every label and frame name is written with `html=0`, XML-escaped,
   newlines as character references; world text is never written as markup (CLAUDE.md). The spike's
   `html=1` probe made draw.io render the markup and issue a request; the adapter never writes it and
   integrity refuses it if it comes back.
4. **Geometry** in the judged state is the core's integer boxes. Frame and group geometry are
   adapter-computed envelopes and excluded; a child's stored coordinates are relative to its parent
   and the readers add every ancestor's offset (PADR-0047 decision 10). Excluded from the declared
   set, each with its reason in `describe()`: frame and group geometry (envelope), edge waypoints
   and terminal points (derived), label geometry and font (draw.io uses the system font; rendering
   depends on the platform), z-order, style keys outside the mapping, file metadata (random diagram
   id, `host`, view attributes).
5. **Ids** are the semantic ids (the spike: draw.io kept every id written). Arrow frames follow
   world/2's rule (their ends' common frame, else none; both ends loose keeps the frame).

### 6. The checker's independent `.drawio` reader

1. **Independent.** `src/checker/drawio.ts`, ported from the spike's `parser.ts` and hardened: its
   own bounded XML tokenizer (no DOCTYPE, no entity but the five predefined and numeric references,
   no bare `&`, no unclosed or mismatched element, one root), its own style parser and its own
   colour table. It imports nothing from `src/adapters` or `src/core` (architecture §2) and nothing
   from the spike's writer. The adapter's read-back (decision 4.3) is a different implementation on
   a different XML parser.
2. **Input.** An `mxfile` with exactly one `diagram` (uncompressed, or draw.io's compressed form:
   Base64 of raw deflate of the URI-encoded model), or a bare `mxGraphModel`. Several pages are
   refused.
3. **Reading rules** (world/2, any `.drawio` file, the same rules for the session's native export):
   - the root is the cell without a parent, layers are its children, whatever their ids;
   - a **frame** is a vertex with the style name `swimlane` or `container=1`; a **group** a vertex
     with the style name `group`; a **step** a vertex whose shape is a rectangle (no shape name,
     `rounded` either way), `ellipse` or `rhombus`; an **arrow** an edge;
   - a step's frame is its nearest frame ancestor; its group is the outermost group between it and
     that frame (or the layer); a group cell above a frame groups frames, is listed as unmodeled and
     gives no step a group. The reader therefore never yields a group across frames;
   - a step's box: its `mxGeometry` plus the `x`/`y` of every ancestor vertex, then rounded by edges
     with `Math.round` exactly as PADR-0047 decision 10 states (a collapsed box widened to 1 px
     outside layout units); `rotation` is ignored here as in Excalidraw's world/2 reader, and layout
     units' reading rules refuse it (PADR-0047);
   - an arrow's ends are `source` and `target` when they are steps; a single arrow head at the start
     (`startArrow` set, `endArrow=none`) reverses them, as for Excalidraw; its frame follows world/2's
     rule;
   - ids matching the semantic id pattern are kept; `pn:group:<id>` gives the group id `<id>`; any
     other id gets a derived one, as `src/checker/scene.ts` does;
   - **values are not snapped**: an absent `strokeColor` reads as black and an absent `fillColor` as
     none (the adapter always writes both); any other value outside the reader's own table refuses
     the file (`unmodeled_value`, below). Excalidraw's world/2 reader maps colours to the nearest
     palette name (world format §2a); draw.io's palette is not world/2's, so a nearest rule would
     invent colours (PADR-0043 decision 4 points the same way);
   - **labels**: with `html=0` (or no `html` key) the value is the label; with `html=1` the value is
     read only when it contains no `<`, no `&`, no tab or newline and no run of spaces — then HTML
     shows exactly that text — and refused otherwise (`markup_label`). The reader never parses
     HTML. Labels are compared after NFC; invisible format characters are refused, as in
     `scene.ts`; at most 4,096 code points;
   - listed as unmodeled and not read (never fatal): other vertex shapes, text-only cells, images,
     edge labels (vertices whose parent is an edge, and edge values), groups of frames, nested frames
     (a frame's own frame is ignored), cells of a hidden layer or with `visible="0"`, and
     `UserObject`/`object` data attributes. A label of an `object` with `placeholders="1"` that
     contains `%` is refused (the app would show other text).
4. **Limits** (the checker's, listed in threat model §4): file 10 MiB (as `scene.ts`); inflated page
   10 MiB; 50,000 XML elements, depth 64, 128 attributes per element, 65,536 characters per attribute
   value, style strings 4,096 characters and 128 keys; 5,000 cells (as `scene.ts`); parent chains of
   at most 64 (so the projection's work is at most 5,000 × 64 ancestor steps); coordinates finite and,
   after adding ancestors, within ±1,000,000. Goal evaluation keeps PADR-0013's fuel.
5. **Refusals** are `artifact_invalid` with `details.reason` from a closed list: `too_large`,
   `xml_invalid`, `xml_doctype`, `pages_unsupported`, `diagram_invalid`, `cell_invalid`,
   `duplicate_id`, `structure_invalid` (root count, missing parent, cycle, an edge whose parent is
   an edge), `geometry_invalid`, `markup_label`, `text_invalid`, `unmodeled_value`,
   `group_spans_frames` (decision 5.2, for a submitted session state). A `.drawio` file for an
   Excalidraw world, or the reverse, is refused by the format table as today. The request format
   `drawio` joins the checker request's enum.
6. **Fixtures.** Hand-written files with expected values derived from the file format (not from the
   reader); real exports of the conformance suite; the counter-probes empty, unchanged start and
   wrong artifact written and exported through draw.io (the spike: 144/144 failed). For PADR-0047
   decision 10, **differential fixtures against the real app**: files with steps inside groups inside
   frames, with integer and fractional offsets, loaded into draw.io and exported as SVG; the reader's
   boxes must equal the boxes of the shapes draw.io renders (relative to a reference step on the
   layer). Until they pass, the `layout` unit on draw.io is not pre-probed (PADR-0047).

### 7. Linux: draw.io never starts without the Chromium sandbox

1. Each registry entry names its **sandbox policy**: Excalidraw keeps PADR-0032's (sandbox first, on
   Linux one start without it when the system refuses it); **draw.io requires the sandbox on every
   platform**. The shell takes the policy from the entry; a draw.io start ignores a fallback the
   process already made for Excalidraw. `PRACTONAUT_CHROMIUM_SANDBOX=require` still tightens
   Excalidraw and changes nothing for draw.io; nothing loosens draw.io's.
2. The start check before the mirror (`chromiumStarts`) runs with the adapter's policy. On a Linux
   system that refuses the sandbox, `--mirror required` stops with `browser_start_failed` and the
   existing AppArmor advice; `--mirror auto` runs model-only with that notice; `doctor --adapter`
   says that draw.io needs the sandbox and whether it starts.
3. **Why.** Nothing was measured on Linux (UNKNOWN), so the safer option wins. The amendment that
   lets Excalidraw start without the sandbox rests on what the browser loads: the engine Practonaut
   builds from a locked dependency. draw.io is 20.1 MB of downloaded third-party script (99 % of the
   20.3 MB the app loads; `app.min.js` 10.1 MB, `extensions.min.js` 4.6 MB), including code the
   adapter never uses but the app loads: HTML label rendering, and the import and layout bundles the
   spike found in `extensions.min.js` (Visio import, ELK, Mermaid, dagre). The adapter's input to it
   is as narrow as for Excalidraw (escaped plain-text labels and names, integer geometry, styles from
   a fixed table, decisions 4 and 5), but no review or measurement shows that this keeps a renderer
   exploit out of reach. draw.io is opt-in: the person
   who loses the mirror on an affected system asked for it, gets an exact message, and can lift the
   restriction in the system or practise model-only; Excalidraw practice is untouched.
4. **Cost.** On Ubuntu 23.10 and later with the default AppArmor setting, draw.io sessions run
   model-only until the restriction is lifted. In CI the draw.io layer runs in the Linux step that
   lifts it (`kernel.apparmor_restrict_unprivileged_userns=0`); like the other browser-heavy layers,
   it runs on one platform.

### 8. The 16 library tasks and the families on draw.io

1. **One task set.** `npm run library:write` also writes the draw.io library world
   (`tasks/drawio/world/world.json`): the Excalidraw library's tasks, variant cases, titles, prompts
   and hints unchanged (they do not mention Excalidraw; measured: 0 occurrences), id `drawio-library`,
   the library's version, `app: { adapterId: "drawio", versionRange: "32.4.1" }` and
   `taskSet: { id: "excalidraw-library", version: "1.1.0" }`. Its oracle file is the Excalidraw
   library's, re-verified in the draw.io world (references pass, near misses fail, the start fails,
   for every case; under decision 5.2). `library:check` fails when either file differs from a fresh
   build. The Excalidraw library's content hash does not change. With the task-set key the same seeds
   select the same cases, so every instance has the same task identity on both apps (PADR-0044
   decision 3); a unit test shows the identities equal for all 16 tasks × 3 cases.
   `practonaut play drawio/<task>` opens a task; `tasks/drawio/` joins the package files (CC0, no
   third-party content).
2. **Near misses on draw.io** are the library's own: 39 single-fault sequences (19 kinds, from
   `misordered` to `missing-set-frame`), in 3 cases each, 117 per run, plus the unchanged start in
   each case (48). Their verdict comes from the checker reading draw.io's native export. Added for
   draw.io only, as conformance cases rather than library content: the spike's 12 silent-change
   cases, the coverage sequence with the group-across-frames step answered `unmodeled`, and the
   counter-probes written through the app.
3. **Families.** No challenge family is published today (the 0.2.0 round: none passed;
   [challenge reports](../benchmarks/challenge/README.md)), so that part of the acceptance line is
   empty now and is re-checked before the release. To find problems before then, the draw.io layer
   runs every family the generator has (`FAMILIES`, and `challenge-layout` once P5b lands) on seeds
   1–3 at difficulty `mixed`: each instance re-bound to the draw.io app, re-verified in the core
   (decision 5.2), then start, reference and every near miss through the real app. The generator
   gains an `--app drawio` option that writes the same instances into a draw.io world.
4. **"Three runs agree."** A run is a fresh adapter (fresh Chromium, fresh page). In each run, for
   every task × case × sequence (start, reference, every near miss): a new session, `restoreState`
   of the start, every step through `adapter.apply` (the product path, with all checks of decision
   4), `exportArtifact`, and the verdict of `checkSubmission` with format `drawio`. Recorded per
   sequence: the canonical hash of the read-back after every step and the verdict. Pass: in each run
   every reference passes and every start and near miss fails, every step's checks hold, nothing is
   refused by the shell, and the three runs' hash chains and verdicts are identical. The layer writes
   a summary (per task: references passed, near misses failed, starts failed, per run; agreement)
   under `.local/`; the numbers go into the pull request and the release notes. Measured today with
   the spike's writer through the shell: 3 × 165 sequences, 48/48 and 117/117 per run, identical
   chains.
5. **Re-checked before the release.** [docs/release.md](../release.md) gains a step: on the release
   commit, run the draw.io layer with `PRACTONAUT_DRAWIO_REQUIRED=1` and bench the oracle on both
   libraries; the release notes state the counts.
6. **"One report shows the same tasks on both apps"** is `practonaut compare` of two bench/3 reports
   at session level — the oracle on the Excalidraw library and on the draw.io library, the same seeds
   (one per case) and repeats — paired by task identity (PADR-0044 decision 2). Expected: 48 paired
   identities with equal run counts and no difference between the two configurations.

### 9. Trademark, naming, documentation, threat model

1. **Naming.** Text says what the adapter works with: "works with draw.io". Wherever draw.io is
   named for the first time on a page or in output (README, the adapter page, `setup --app drawio`):
   "draw.io is a trademark of JGraph Ltd; Practonaut is not affiliated." No draw.io logo anywhere —
   the Player shows the protocol's PNG of the diagram, never the editor's interface. No "draw.io" in
   product or package names: the npm package stays `practonaut`, and no package, command or product
   is named after it. Identifiers that name the file format and the app the adapter works with stay
   descriptive: adapter id and option `drawio`, `src/adapters/drawio/`, `tasks/drawio/`, the world id
   `drawio-library`, the extension `.drawio` (draw.io's own).
2. **Licence.** The adapter page states what the spike found (Apache-2.0 app code; the stencil
   clause limited to Atlassian products and their marketplace, which binds a downstream product
   distributed there; LGPL-2.1 libavoid in the archive, not loaded) and that Practonaut downloads the
   unmodified release on the user's request and never redistributes it — not in the npm package, not
   in a CI artifact or cache. Any redistribution would reopen the spike's criterion (f).
3. **Pages** (Phase B): README; a new `docs/adapters/drawio.md` (setup, `--from`, location, removal,
   what is served, protocol, mapping, constraint, reading rules, licence, trademark), linked from
   `docs/index.md`; getting started (setup option, the Linux sandbox note); world format (§1.4 codes
   stay; §2a: the draw.io export, the reading rules, the constraint); architecture (modules and §10);
   adapter guide (§3 as built); testing (`PRACTONAUT_APPS`, the draw.io layer); release; CONTRIBUTING
   (fetching the runtime for tests); the benchmarks guide (both apps, `compare`); CHANGELOG.
4. **Threat model.** A new boundary row *Download → app runtime* (threats: a substituted or damaged
   archive, an endless or oversized body, a partial file kept, hostile entry names, serving
   `WEB-INF`/`META-INF` or agent-instruction files, redistribution; controls: decision 2 and 3.2).
   *Adapter ↔ real app*: draw.io through the embed protocol only, no script in its frame, the write
   check, `html=0`, the sandbox required on every platform. *Host → checker*: the `.drawio` reader's
   rules and limits. §3 item 6 names draw.io. §4 lists the reader's limits.

### 10. Phasing

1. **This pull request (Must 2):** the three table entries and the constraint (decisions 1 and 5.2,
   core, world validation, checker replay), setup and the runtime check, the adapter on the shell,
   the checker reader, the per-adapter sandbox policy, the Player (board workspace only for draw.io
   worlds: the editor and author workspaces embed Excalidraw and say they are unavailable; export as
   `practonaut.drawio`), `run --export`, `doctor`, the CI steps and the workflow check, the
   conformance layer (library, families, negatives, three runs), docs and threat model.
2. **Needs PR #66 merged into this branch** (bench/3, `taskSet`): the committed draw.io library world
   (it carries `taskSet`; without the key the same seeds would select other cases, PADR-0044
   Context), `bench` on a draw.io world (`environment.app`, `native.drawio`), and the `compare` page.
   Until then the conformance layer re-binds the library's world to draw.io in memory only, keeping
   the Excalidraw library's id and version so that the same seeds select the same cases (never
   written to disk or shipped), and `bench` refuses a world whose adapter is not `excalidraw`
   with a named code instead of writing a bench/2 report that would name Excalidraw.
3. **Artifact mode (Must 3), not here:** the draw.io MCP toolchain and its pinned server; reading
   rules beyond decision 6 (text from HTML labels, unmodeled values failing only the clauses that need
   them, the layout object allowance of PADR-0047 decision 5); loading foreign `.drawio` files into
   the real app for differential conformance, and whether that needs more than decision 7.
4. **Not in 0.3.0:** an embedded draw.io editor as input device, `tasks from-scenes` from `.drawio`
   pairs, incremental writes (`patch` or `merge`).

## Consequences

- A user who never runs `setup --app drawio` sees no change. One who does keeps 48 MB in the data
  directory and gets draw.io worlds mirrored into the real app; without it they run model-only with
  a message naming the setup option and the size.
- The deterministic core learns one application fact from data: on draw.io a group stays within one
  frame. The same action answers differently on two applications, and a test with an expected value
  derived by hand covers both. Task identities are unaffected (the start and the goal are the same).
- Two independent `.drawio` readings exist (the adapter's, on the browser's XML parser; the
  checker's, on its own tokenizer); a disagreement fails the transaction or the export pair instead
  of passing silently.
- `practonaut check` reads `.drawio` files strictly: a file drawn in draw.io with colours outside
  the table, or with markup in its labels, is refused by name until artifact mode's reading rules
  (Must 3) decide otherwise.
- On Linux with the default AppArmor restriction draw.io is model-only; CI covers draw.io only in the
  Linux step that lifts the restriction.
- Each CI run downloads 48 MB from GitHub; a release outage or a removed asset fails the draw.io
  step by name (`app_download_failed`), not silently.
- A draw.io release bump is a code change: a new pin, `appVersions`, and a full conformance run;
  worlds that name the old version are refused by name. The release cadence is high (six releases in
  eight days before the pin, REPORT), so the pin moves only on purpose.

## Re-assessment triggers

- A Linux measurement or review that shows draw.io's attack surface, given what the adapter writes,
  no wider than the bundled engine's — or users for whom the sandbox requirement blocks draw.io and
  who cannot lift the restriction.
- A world/2 task, family or generator that needs a group across frames on draw.io.
- draw.io changes the embed protocol, the export format, the files it loads, or refuses to run from
  local files; the vendor withdraws or changes the release asset or its licence; JGraph Ltd or the
  maintainer objects to the naming.
- The conformance suite's start median or peak RSS approaches the spike's abort bounds.
- Artifact mode needs to load foreign files into the app (Must 3).
- A user need for `importArtifact`, an embedded draw.io editor or `.drawio` scene pairs.

# draw.io spike — report

Roadmap 0.2.0, Should 8, GitHub issue #20. Method and abort criteria were fixed in
[PREREGISTRATION.md](PREREGISTRATION.md) (committed before the first run). Measured on 2026-10-14.
The committed numbers are in [results/summary.json](results/summary.json); the raw result files
stay under the ignored `.local/spikes/drawio/results/`.

## Verdict: **pass**

No abort criterion fired. Three of the six criteria involved a judgement call. Each is stated
below with the reading that was applied and the reading under which the verdict would change, so
the maintainer can overrule:

1. **(d) silent changes.** The read-back check run first missed one silent change. draw.io moves
   a cell whose parent does not exist into layer 1, and in that case the result matched the
   intended state on the declared set. A write check was then added: every cell the adapter wrote
   must come back with the same attributes. With it, all 12 cases are visible. The check was added
   after seeing the miss, and every affected measurement was re-run with it. If only the check as
   first implemented counts, (d) fired.
2. **(c) actions.** One world/2 state cannot be held by native draw.io groups: a group whose
   members sit in different frames, reached with `set_frame`. The library never reaches it.
   draw.io's documented custom cell attributes hold it losslessly (3/3 runs). The preregistered
   rule counts that as expressible, reported as a constraint for 0.3.0. If only native draw.io
   groups count, (c) fired.
3. **(f) licence.** Every file the runtime loads is covered by a licence text at the pinned tag.
   Inside two bundles, however, the per-component licence texts are absent (ELK- and Mermaid-based
   code, dagre). The preregistered word "missing" was read at file level. Read at component level,
   (f) fired. The trademark notice is outside (f) as preregistered and stays **open**.

## Pin and machine

| | |
|---|---|
| App | official release `jgraph/drawio` **v32.4.1** (2026-10-08), asset `draw.war` |
| SHA-256 | `b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820` (matches GitHub's published asset digest) |
| Size | 48,442,174 bytes; unpacked 3,154 files, 115.5 MB |
| Machine | macOS (Darwin 27.0.0) arm64, Apple M4, 10 cores, 16 GiB |
| Runtime | Node v22.22.3, playwright-core 1.63.0, Chromium headless shell 153.0.8010.12, started through Practonaut's `launchChromium` with the sandbox on |
| Protocol | `index.html?embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none`; `configure` answered with `{compressXml: false}`; write = `load` of the full predicted state; read-back = `export` `format: "xml"` |

Every URL parameter and the configuration key are in draw.io's documentation ("Supported URL
parameters", "Embed mode", "Configure the draw.io editor"). No further parameter was needed.

## Abort criteria

| | Criterion (roadmap item 8) | Measured | Result |
|---|---|---|---|
| a | protocol works locally only with source patches beyond documented URL or configuration parameters | Works with documented parameters only; no file changed. All 14 files the app requested were byte-identical (SHA-256) to the same entries in the official `draw.war`, in every run. No script was evaluated in the app frame; all traffic was `postMessage` from the host page | pass |
| b | an external request cannot be blocked without losing function | Every request outside the two local origins was aborted. **0** external requests were attempted in any start, replay, coverage, negative, probe or render run. A start with only `embed=1&proto=json` also made 0. No local file was missing. Function intact | pass |
| c | a world/2 action cannot be expressed, or a round trip fails in one of three runs | Library: 3 runs × 165 sequences (16 references and 39 near misses × 3 variant cases), 3 × 624 round trips, all exact on the declared set and passing the write and integrity checks. Per run, 48/48 references pass and 117/117 near misses fail through Practonaut's checker. 0 disagreements between runs over 624 steps. Coverage of all 13 actions: 22/23 with native groups only, 23/23 with the documented data attribute, identical in 3 runs (details below) | pass (judgement 2) |
| d | a silent rejection or change stays invisible to read-back and integrity check | 12 cases. draw.io silently changed or dropped content in 5 and accepted 4 invalid structures unchanged. With the write check, 0 of 12 are invisible. With the projection check alone, 1 of 12 (`missing-parent`) was invisible | pass (judgement 1) |
| e | start > 3 s, memory > 1.5 GB or mandatory download > 80 MB | Start median **709 ms** over 5 dedicated cold starts (703–923 ms). Peak Chromium RSS **491–579 MB** (final runs; 585–628 MB in the first pass). Download **48.44 MB** | pass |
| f | a licence question (stencil clause, bundled libraries, fonts) cannot be settled without a lawyer | See [Licence](#licence) | pass (judgement 3) |

## The six questions of the adapter guide §4

**1. Official, scriptable interface?** Yes: the documented embed JSON protocol. `load` takes the
complete diagram as `mxGraphModel` XML and answers with a `load` event. `export` with
`format: "xml"` returns the current file. `export` `svg`/`png` gives the rendered form. All of it
ran from a local copy, even though the documentation says embed mode is "only supported on
https://embed.diagrams.net". So the local path works but has no vendor support, and jgraph does not
accept pull requests.

Two protocol findings matter for the adapter design:

- The `load` event is never proof that a write landed. In all 12 negative cases, including
  malformed XML, the event arrived without an error and echoed the input XML. draw.io's own errors
  appeared only in the browser console. Read-back through `export` is the only reliable signal.
- The incremental write paths were tried but are not decisive:
  - The documented `merge` action answered without an error but applied **none** of the 55
    sequences, with or without diff sync. Merging a bare `mxGraphModel` adds a second page instead.
  - Hand-built diff-sync `patch` messages (cell updates, inserts, removals) reproduced 45/55
    sequences exactly. The 10 failures all need a cell to change parent (`group_steps`,
    `set_frame`): draw.io accepted the `parent` update without an error and did not move the cell.
    The correct move encoding is UNKNOWN.
  - Full-state `load` is the write path that works.

**2. Local, offline, pinned, no accounts or containers?** Yes. The app is static files in the
release `draw.war`, served from local files through request interception in Practonaut's existing
headless Chromium. It needs no account, no container and no server-side code (the Java servlets in
`WEB-INF` are never served). With every external request blocked:

- cold start to the first loaded diagram: median 709 ms, max 923 ms over 5 dedicated cold starts;
  `init` at 672–891 ms;
- start in a running browser: 721–798 ms;
- per write: `load` median 4.6–7.9 ms and `export` median 1.7–3.1 ms over the three final runs;
- the app loads 14 files (20.28 MB) of the 3,154 in the release.

These are warm-cache starts: the Chromium binary was in the OS file cache. A start after a reboot
was not measured (UNKNOWN). The release cadence is high (six releases between 2026-10-01 and
2026-10-08), so a pin and a conformance re-run on every bump are required.

**3. Semantic, volatile, derived attributes.** The declared set covers object kind, id,
label/name, shape, stroke, fill, integer x, y, width and height (absolute, summed over parent
offsets), frame, group, arrow ends and arrow frame.

Excluded, each with a reason:

- frame and group geometry: an adapter-computed envelope;
- edge waypoints and terminal points: derived;
- label geometry and font: draw.io uses the system font (Helvetica), so rendering depends on the
  platform;
- z-order;
- style keys outside the mapping;
- file metadata: the diagram id is random per load, `host`, and the view attributes `dx`, `dy`,
  grid and page.

The adapter recomputes the derived geometry after every programmatic write, because draw.io does
not on `load`:

- container (frame) and group envelopes;
- child coordinates relative to their parent;
- a terminal point for the dangling end of an arrow whose step was deleted.

Ids are kept: the semantic id is the cell id, and draw.io preserved every id written.

**4. Read-back and silent changes.** Every write can be read back with `export` and compared. The
adapter check that worked consists of:

- an exact comparison on the declared set against the core's prediction;
- a write check: every written cell comes back unchanged, and no unwritten cell appears;
- the integrity check: unique ids, one root, existing parents, no cycles, no edge as a parent,
  edge ends are steps, `html=0` labels, integer geometry, known colours and shapes.

| Case | What draw.io did | Made visible by |
|---|---|---|
| edge to a missing target | dropped the target silently (console error only) | declared-set diff, write check |
| duplicate id | renamed the second cell to a generated id | declared-set diff, write check |
| parent is an edge | kept the invalid structure | integrity (`edge_parent`) |
| parent cycle | dropped both cells silently | declared-set diff, write check |
| invalid colour | kept `fillColor=notacolor` | unmodeled colour |
| markup label, `html=0` | kept as literal text; no request, no script | nothing to detect (correct) |
| markup label, `html=1` | kept and rendered as HTML: the `<img src=x>` triggered a request (to the local origin, answered 404); no script dialog | integrity (`markup_label`) |
| non-integer geometry | kept `x=10.5` | integrity (`non_integer`) |
| missing parent | moved the cell into layer 1 (console warning only) | **write check only** |
| wrong prediction | wrote what it was given | declared-set diff |
| umlauts, NFD, emoji, 2048 characters | kept exactly | nothing to detect (correct) |
| malformed XML | kept the previous diagram; `load` event without error | declared-set diff, write check |

The `html=1` case shows why the adapter must write labels as plain text and the checker must
refuse HTML labels. World text is data and must never be rendered as markup.

**5. Stable export, independent parser.** The final state of each of the 16 references was loaded
into three fresh pages:

- The raw XML differed only in the random diagram `id`.
- The projection was identical in all three pages and equal to the prediction for 16/16.
- The compressed form (documented `compressXml: true`, deflate plus Base64) is honoured and parsed.
- PNG export was byte-identical across two exports. SVG differed only in a random root id
  (`ge-svg-…`) and the CSS rule scoped to it.

The parser in `parser.ts` is independent: its own bounded XML tokenizer (refuses DOCTYPE, unknown
entities and bare ampersands) and its own colour table. It imports neither the writer, nor the
core, nor Practonaut's Excalidraw parser.

Counter-probes: an empty diagram, the unchanged start and a wrong artifact, each written and
exported through draw.io, failed the goal in 144/144 cases (16 tasks × 3 cases × 3 probes).
Offline, the writer and parser agree with the core's prediction on every state of every library
sequence (`spike.test.ts`).

**6. Licences.** See below.

## Action coverage (criterion c)

The library uses 12 of the 13 world/2 actions; `ungroup` is the one it does not use. The coverage
sequence on the `two-frames` start state uses all 13 (22 steps) and reaches the edge states world/2
allows: a dangling arrow after `delete_step`, an arrow between two frames, a self-loop, a step
leaving its frame, a group, a split group, `ungroup`, and an arrow with both ends deleted.

- **With native draw.io groups only: 22/23 round trips in each of 3 runs.** Step 15 fails:
  `set_frame` moves one member of a group out of the frame the other members are in. A draw.io
  cell has exactly one parent, so a group cell cannot sit inside two frames. world/2 allows this
  state (frame and group are independent fields, as in Excalidraw); the library never reaches it.
- **With the group written as a documented custom cell attribute** (draw.io's `object` wrapper,
  the "Edit Data" feature) for exactly that case: 23/23 round trips in each of 3 runs, identical
  across runs.

Under the preregistered rule this counts as expressible and is a constraint for 0.3.0. In the
draw.io UI, a group held only as an attribute does not behave as a group.

## Licence

What was read:

- `LICENSE` and `README.md` at tag v32.4.1;
- every licence file inside `draw.war`: `stencils/`, `shapes/`, `img/`, `templates/`,
  `js/libavoid-js/`;
- `etc/dependencies/package.json` at the tag;
- the licence headers of the 14 files the app loads;
- the bundled font's own metadata;
- the npm registry for the `@drawio/elk` and `@drawio/mermaid` bundle names.

| Item | Finding |
|---|---|
| App code | Apache-2.0 (repository `LICENSE`; the README: "The source code in this repository is licensed under the Apache License 2.0"). `draw.war` itself contains no top-level licence file |
| Stencil clause | The icon sets and stencil libraries may not be used in, distributed for use with, or incorporated into **Atlassian products or products distributed through the Atlassian marketplace or plugin ecosystem** without written permission; diagram output is exempt. The app loads `js/stencils.min.js` and `js/shapes-14-6-5.min.js`. Practonaut is neither an Atlassian product nor distributed there, so the clause does not restrict the intended use. A downstream Atlassian-marketplace product that bundles Practonaut with draw.io would be bound by it |
| Templates | CC BY 4.0 (`templates/LICENSE`); not loaded by the app in this use |
| Bundled libraries, loaded | `app.min.js`: DOMPurify (Apache-2.0 or MPL-2.0), pako (MIT and Zlib), regenerator-runtime (MIT), mxGraph (JGraph). `extensions.min.js`: drawio-vsd (JGraph, Apache-2.0), Bridge.NET (header points to its licence), bundles named `@drawio/elk` and `@drawio/mermaid` **without licence headers** (not on npm; presumably built from ELK and Mermaid, provenance UNKNOWN), dagre (header points to a `LEGAL.txt` that is not in the release). Declared dependencies with exact versions: jszip, perfect-freehand, jquery, pako, crypto-js, dompurify, spin.js, roughjs, mathjax. The README: "all with licenses compatible with Apache 2.0 (no GPL or AGPL)" |
| Bundled libraries, not loaded | `js/libavoid-js` is **LGPL-2.1**, in the download but not loaded in this use |
| Fonts | One font file: Architects Daughter (sketch mode, not loaded in this use). Its own metadata carries the copyright and the full SIL OFL 1.1 text, which OFL accepts as the licence copy. Diagrams use the system font |
| Trademark | README: "draw.io is a registered EU trademark … Do not use the draw.io name or logo in ways that suggest affiliation … Use of draw.io trademarks requires prior written permission." **OPEN** — see below |

Why (f) was not fired. The intended 0.3.0 use (PREREGISTRATION §4.9) has three parts:

- the user's machine downloads the unmodified official `draw.war`;
- Practonaut does not redistribute it;
- Practonaut runs it locally and headless.

Every licence found permits running unmodified software without conditions: Apache-2.0, MIT,
Zlib, MPL-2.0, EPL-2.0 if ELK-derived, LGPL-2.1, OFL and CC BY. The obligations they carry
(notices, source offers) attach to redistribution, which Practonaut does not do. The stencil clause
is limited to Atlassian products and the Atlassian marketplace.

What stays open:

- **Trademark.** Whether naming the adapter and docs after draw.io needs written permission under
  the README's wording is a legal question the spike cannot settle. It is not a licence of a loaded
  file, so it is outside (f) as preregistered. Before 0.3.0 names anything "draw.io", the maintainer
  should decide: use the name only referentially ("reads and writes draw.io files"), never the
  logo, state that there is no affiliation — or ask draw.io Ltd for written permission.
- **Redistribution.** If Practonaut ever ships a thinned or repackaged bundle instead of the
  official download, the per-component licence texts for the ELK- and Mermaid-based bundles and
  for dagre must be obtained first (not available in the release), and LGPL obligations must be
  checked if libavoid is included.

## Deviations from the preregistration

- The write check (`integrity.ts`) was added after the first negative run. The first-pass results
  are kept locally; their silent-case list is in `summary.json` (`firstPassSilent`). The negative
  cases, the three replay runs, the three coverage runs and the counter-probes were then re-run
  with identical code; all numbers above come from that second pass, except the dedicated starts
  and the stability mode, which do not use the check.
- The memory sampler was corrected before the decisive runs to exclude the sampling `ps` process
  (about 1 MB). Chromium's crashpad handler is reparented to launchd and is not counted (about 2 MB).
  The RSS sum over-counts shared pages, so it is an upper bound.
- Exploratory additions, none decisive: the documented `merge` action (with and without diff sync)
  next to the preregistered `patch`; SVG/PNG export; a start with only `embed=1&proto=json`.
- Contention. The offline unit test ran during final replay runs 1 and 2, so their run starts
  (2.18 s and 1.55 s) and latencies are inflated. The decisive dedicated cold starts ran without
  the spike's own concurrent load. Other jobs (Practonaut test layers and benchmark runs of the
  parallel 0.2.0 waves) ran on the machine during the session, so absolute timings are upper bounds.

## What 0.3.0 would need

- **Adapter** (`src/adapters/drawio/`, per [adapter guide](../../docs/adapter-guide.md) §3):
  - setup downloads the pinned `draw.war` and checks its SHA-256;
  - unpack with entry-name checks;
  - serve only app paths, never `WEB-INF` or `META-INF`. `WEB-INF` contains placeholder credential
    files, and the bundle also contains files with instructions addressed to coding agents, which
    must never reach an agent;
  - write with `load` of the full predicted state; read back with `export` `xml`;
  - check the declared set, the write check and the integrity check; never trust the `load` event.
- **Checker:** port the independent parser into `src/checker/` with the counter-probes, and refuse
  `html=1` labels.
- **Cross-frame groups:** a PADR that decides between three options. (i) Hold them as a documented
  cell attribute: lossless, but not a native group in draw.io. (ii) Refuse them for draw.io worlds
  with an app-specific precondition. (iii) Report them as `unmodeled` on draw.io.
- **Renderer:** PNG export (byte-stable) or SVG with the `ge-svg-*` id normalised.
- **Conformance on every release bump**, given the release cadence. The vendor gives no support
  for local embed, so a broken local path would have no upstream fix.
- **Incremental writes** (optional): learn draw.io's move encoding for `patch`, or keep `load`.
  `merge` is not usable as observed.
- **Trademark decision** (above) before anything is named after draw.io.

## Maintainer review of the judgement calls (2026-10-14)

Reviewed by the integrating agent under the maintainer's delegation for 0.2.0. All three readings
are accepted, with the reading that would change the verdict recorded above: (1) the write check is
part of the read-back an adapter must do and is now a requirement for 0.3.0; (2) cross-frame groups
need the PADR named in the previous section before the adapter ships; (3) Practonaut does not
redistribute `draw.war`, so missing per-component texts inside it bind no obligation of
Practonaut's; any redistribution would reopen (f). The trademark question stays open for the
maintainer.

## How to reproduce

    node spikes/drawio/fetch.ts                 # download v32.4.1, check SHA-256, unpack into .local/
    node spikes/drawio/run.ts start             # 5 cold + 3 warm starts
    node spikes/drawio/run.ts replay 1          # likewise 2 and 3
    node spikes/drawio/run.ts coverage 1        # likewise 2 and 3
    node spikes/drawio/run.ts negative
    node spikes/drawio/run.ts stability
    node spikes/drawio/run.ts probes
    node spikes/drawio/explore.ts merge|merge-sync|patch|params|render
    node spikes/drawio/summarize.ts             # writes results/summary.json
    node --test spikes/drawio/spike.test.ts     # offline tests (no browser)
    npx tsc -p spikes/drawio/tsconfig.json      # typecheck of the spike

# draw.io spike — preregistration

Roadmap 0.2.0, Should 8 ("Spike for application #2: draw.io"), GitHub issue #20. Written and
committed before the first measurement run. The report is `REPORT.md` in this folder. Nothing in
this folder ships: `spikes/` is not in `package.json` `files`, and no adapter code goes into `src/`.

## 1. Question

Can Practonaut drive the official draw.io web app, pinned to one release and served from local
files in the headless Chromium Practonaut already uses, **only through the documented embed JSON
protocol**, well enough to be application #2 under the adapter contract
([PADR-0007](../../docs/adr/0007-adapter-contract.md), [adapter guide](../../docs/adapter-guide.md))?
Or does one of the abort criteria of roadmap item 8 fire?

The spike answers the six questions of the adapter guide §4:

1. Is there an official, scriptable interface to read and write the state? (UI automation by pixel
   is not accepted.)
2. Can the app run locally and offline at a pinned version, without accounts or containers?
3. Which attributes are semantic, which are volatile or derived, and can derived ones be recomputed
   by the adapter after a programmatic write?
4. Can every write be read back and compared? How is a write detected that the app silently changed
   or rejected?
5. Is the native export stable for the same state, and can an independent parser read it?
6. What are the licence terms of the app and every bundled asset?

## 2. Abort criteria (copied from roadmap item 8)

> *Abort* (any one): the protocol works locally only with source patches beyond documented URL or
> configuration parameters; an external request cannot be blocked without losing function; a
> world/2 action cannot be expressed or a round trip fails in one of three runs; a silent rejection
> or change stays invisible to read-back and integrity check; start > 3 s, memory > 1.5 GB or
> mandatory download > 80 MB; a licence question (stencil clause, bundled libraries, fonts) cannot
> be settled without a lawyer.

Labels used below: (a) source patches, (b) external requests, (c) actions and round trips,
(d) silent changes, (e) start, memory, download, (f) licence. On abort, the roadmap table
"If a spike aborts" applies (bpmn-js is spiked as application #2 at the start of 0.3.0).

The verdict is **pass** when none of (a)–(f) fires, otherwise **abort** naming every criterion that
fired. The spike stops as soon as one criterion has clearly fired and writes the report with the
evidence collected up to then.

## 3. Pin and environment

- App: the official GitHub release of `jgraph/drawio`, tag **v32.4.1** (published 2026-10-08, the
  newest release when this was written), release asset `draw.war` (the packaged static web app).
  The SHA-256 of the downloaded asset is recorded in `pin.json` and in the report.
- The download goes into a new, empty directory under the ignored `.local/` folder; it is unpacked
  into a second new, empty directory there after every entry name has been checked (no absolute
  paths, no `..`, no links). Nothing from the release is committed. No build tooling is run from
  inside these directories; the spike's own scripts live in `spikes/drawio/`.
- Machine: the maintainer's macOS arm64 machine; Node, playwright-core and Chromium versions are
  read from the running processes and written into every result file.
- Browser: Playwright's Chromium started through Practonaut's own `launchChromium`
  (`src/adapters/excalidraw/chromium.ts`, sandbox on), headless, service workers blocked.

## 4. Method

### 4.1 Harness

- Two local origins, both answered by Playwright request interception: a host page at
  `http://practonaut.invalid/` (written by the spike: one iframe and a postMessage relay, nothing
  else) and the app at `http://drawio.practonaut.invalid/`, which serves the unpacked release files
  byte for byte. **Every other request is aborted and logged** (origin and path).
- The iframe opens `index.html` with documented URL parameters only:
  `embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none`.
  The `configure` event is answered with a `configure` action using only documented configuration
  keys. If the app needs a further documented parameter to work, it is added and named in the
  report; an undocumented parameter or a changed file counts toward (a).
- **No script is evaluated inside the draw.io frame** in measurement runs. Node drives the host
  page; the host page talks to the app only with `postMessage` (JSON protocol).
- Write path (decisive): `{action: "load", xml}` with the complete predicted after-state as
  uncompressed `mxGraphModel` XML, then wait for the `load` event (the analogue of Excalidraw's
  `updateScene` with the full scene). Read-back: `{action: "export", format: "xml"}`.
- Write path (exploratory, never decisive): per action, a diff-sync `patch` with cell updates,
  inserts and removals (`load` with `diffSync: true` first). Its results are reported separately.

### 4.2 Mapping world/2 ↔ draw.io (declared set)

Written in `writer.ts` (adapter side). Read back by `parser.ts` (checker side), which does not
import the writer, the core, or Practonaut's Excalidraw parser, and has its own XML tokenizer and
its own colour table.

| world/2 | draw.io cell |
|---|---|
| step | vertex; `id` = semantic id; `value` = label as plain text (`html=0`); style `ellipse` / `rhombus` / none for ellipse / diamond / rectangle; `strokeColor`, `fillColor` as fixed hex values (`none` for no fill); `mxGeometry` x, y, width, height (absolute = sum of parent offsets) |
| frame | container vertex (`swimlane`, `container=1`); `id`, `value` = name; steps of the frame are its children |
| groupId | a `group` vertex whose id is the group id; its member steps are its children (inside the frame of the members) |
| arrow | edge; `id`; `source`, `target` (absent = dangling end); parent = the arrow's frame container or the layer |
| tombstone | no cell (draw.io deletes cells); read-back compares live objects only |

Declared and compared: object kind, id, label/name, shape, stroke, fill, x, y, width, height,
frame, group, arrow ends, arrow frame. Excluded with reason (reported in the result files):
frame and group geometry (adapter-computed envelope), edge waypoints and terminal points, label
geometry and font (system font, platform-dependent rendering), z-order, style keys outside the
mapping, `mxfile`/`diagram`/`mxGraphModel` metadata (`host`, `modified`, `agent`, `etag`,
`version`, page id and name, view attributes).

A world/2 state that the native cell tree cannot hold (the mapping above has one parent per cell)
is recorded with the exact state. Such an action counts as **expressible** only if a documented
draw.io mechanism holds it losslessly through the same protocol (for example custom cell attributes
of the documented "Edit Data" feature); it is then reported as a constraint for 0.3.0. If no
documented mechanism holds it, (c) fires.

### 4.3 Replay of the library (criterion c)

- Source: the 16 tasks in `tasks/excalidraw/` (world `world/world.json`, oracles and near misses
  in `library.json`), loaded with `loadLibrary()` from `src/library/index.ts`.
- For every task, every variant case (`drawn`, `alt-1`, `alt-2`, with the seeds recorded in the
  oracle) and every sequence (the reference solution and each near miss): the predicted state after
  every step comes from Practonaut's core `Session` (the independent prediction the adapter
  receives). Each step is written with `load`, read back with `export`, parsed, projected, and
  compared for **exact equality on the declared set** with the predicted live objects; the
  integrity check runs on every read-back.
- After the last step, the parsed state is judged by Practonaut's independent checker
  (`checkState` from `src/checker`, which shares only predicate evaluation) with the task's goal.
  Expected: the reference passes, every near miss fails.
- **Three runs**, each in a freshly launched Chromium. A run fails if any step's read-back differs
  from the prediction, the integrity check fails, a verdict differs from the expectation, or a
  protocol call times out (10 s per message). The three runs must also agree on the projected
  state hash of every step.
- Action coverage: the library uses 12 of the 13 world/2 actions (not `ungroup`). A scripted
  sequence on the `two-frames` start state uses all 13 and the edge states world/2 allows: a
  dangling arrow after `delete_step`, an arrow between two frames, a self-loop, a step leaving its
  frame (`set_frame` to `null`), a group split across two frames, `ungroup`. Same three-run rule.

(c) fires if any world/2 action cannot be expressed (§4.2 rule) or any round trip fails in one of
the three runs.

### 4.4 Silent changes (criterion d)

Each case is written through `load` as hand-written XML, read back, and checked by read-back
comparison plus integrity check:

1. edge whose target id does not exist;
2. two cells with the same id;
3. a cell whose parent is an edge;
4. two cells that are each other's parent (cycle);
5. invalid colour value (`fillColor=notacolor`);
6. label with markup and `html=0` (`<b>x</b><img src=x onerror=...>`): must stay literal text and
   cause no request;
7. step label with `html=1`: the integrity check must flag it (the adapter never writes it);
8. non-integer geometry (`x="10.5"`);
9. a cell whose parent id does not exist;
10. a deliberately wrong prediction (the written label differs from the predicted one);
11. labels with German umlauts, NFC/NFD forms, emoji and 2048 characters.

For each, the report states what draw.io did (kept, changed, dropped, error event, timeout) and
whether read-back plus integrity check made it visible. (d) fires if any change or rejection stays
invisible.

### 4.5 Start, memory, download (criterion e)

- **Start:** wall time from the call to `launchChromium` until the `load` event for the first
  (empty) diagram has arrived, i.e. the app is ready to mirror. Five dedicated cold starts plus the
  three run starts; the **median of the five dedicated cold starts** decides (> 3.0 s fires), and
  every value and the maximum are reported. The time to the `init` event and a warm start (new page
  in a running browser) are reported alongside.
- **Memory:** resident set size summed over every process of the Chromium process tree (all
  descendants of the Node process; Node itself reported separately), sampled every 250 ms during
  one full replay run. The **peak** decides; > 1.5 GB = 1,500,000,000 bytes fires (the stricter
  reading of GB). The sum over-counts pages shared between processes, so it is an upper bound.
- **Mandatory download:** the byte size of the official release asset `draw.war`, the only pinned
  official artifact a user would have to fetch. > 80 MB = 80,000,000 bytes fires. Reported
  alongside, not decisive: unpacked size, and the bytes and file count the app actually requested
  during a full run (a lower bound for a thinned bundle, which would be a repackaging).

### 4.6 External requests (criterion b)

Every request outside the two local origins is aborted and logged during every start, run and
negative case; requests for local files that do not exist in the release are logged separately.
"Function" means: the app starts, every library round trip of §4.3 passes, and the coverage
sequence passes. (b) fires if function is lost while external requests are blocked.

### 4.7 Source patches (criterion a)

The served bytes of every app file equal the file in the release (checked by SHA-256 against the
unpacked release for every served response). Only documented URL parameters and documented
configuration keys are used; nothing is injected into the draw.io frame. (a) fires if the protocol
works only after changing a release file, adding an undocumented parameter or injecting script.

### 4.8 Export stability and parser (adapter guide Q5)

The same predicted state (the final state of every library reference, drawn case) is loaded into
three fresh pages and exported; the raw XML and the declared-set projection are compared. The
parser reads both uncompressed and compressed (`deflate` + Base64) `<diagram>` content; a
compressed fixture is produced through the app's own documented `compressXml` configuration if the
app honours it, otherwise by hand. Counter-probes: empty diagram, unchanged start, a foreign file
(wrong artifact) must all fail the goal.

### 4.9 Licence (criterion f)

Read and recorded: `LICENSE` and the README licence section at the pinned tag, every licence or
notice file inside `draw.war`, licence headers of the third-party scripts the app loads, the fonts
shipped in `draw.war`, the stencil clause and the trademark notice. The intended 0.3.0 use is:
the user's machine downloads the unmodified official `draw.war` at setup, Practonaut does not
redistribute it, and runs it locally in a headless browser. (f) fires if a licence text that
applies to a file the runtime loads is missing, contradictory, or restricts this use in terms whose
application to Practonaut is unclear from the text itself.

## 5. What is reported

`REPORT.md`: the answers to the six questions; every criterion with its measured value and
pass/abort; the verdict; tag and SHA-256; licence findings, what was checked and what stays open;
machine, Node, Chromium versions; what 0.3.0 would need. Raw result files stay under `.local/`;
a summary without local paths is committed in `results/`. Anything not measured is marked
UNKNOWN.

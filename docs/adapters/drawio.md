# draw.io adapter

Practonaut works with draw.io as its second application ([PADR-0049](../adr/0049-drawio-adapter.md)).
draw.io is a registered trademark; Practonaut is not affiliated with, endorsed or sponsored by
draw.io Ltd or draw.io AG.

A world whose `app.adapterId` is `drawio` (app version `32.4.1`, world schema `practonaut.world/2`
only) is practised and benched like an Excalidraw world: the model is the same, the mirror is the real
draw.io running in Practonaut's own headless Chromium, and the checker reads draw.io's own `.drawio`
export. Nothing changes for a user who never asks for draw.io.

## Setup

draw.io is not part of the npm package. It is downloaded only when you ask for it:

```sh
practonaut setup --app drawio
```

This first does what plain `practonaut setup` does (Chromium for the mirror), checks that Chromium
starts with its sandbox (see [Linux](#linux-the-sandbox-is-required)), then names the file before any
byte is fetched: `draw.war` of draw.io v32.4.1 from
`https://github.com/jgraph/drawio/releases/download/v32.4.1/draw.war`, 48,442,174 bytes (48.4 MB),
SHA-256 `b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820`. Only a complete file of
exactly that size and hash is kept; a mismatch names both sizes and both hashes and keeps nothing.

- **Offline or behind a proxy:** fetch `draw.war` by other means and run
  `practonaut setup --app drawio --from <file>`. It is checked the same way and copied into place; a
  file that is not the pinned release is refused with both sizes and both SHA-256 values.
- **Where it is kept:** `<PRACTONAUT_HOME>/apps/drawio/32.4.1/draw.war`, in private directories.
  Removing it is deleting that folder.
- **Limits of the download:** at most 5 redirects, every hop `https:`; headers within 30 s, no stall
  over 30 s, 10 minutes for the whole download; network errors, HTTP 429 and 5xx are retried twice
  (after 2 s and 8 s), a size or hash mismatch never. One setup at a time per version: a lock file
  that appears whole or not at all and that only its own setup removes; a second setup stops with
  `app_install_busy`, and only one setup takes over a lock left by an interrupted one. On a home
  without hard links (FAT, exFAT, some network shares) the lock is created exclusively instead.
- **Failures by name** (exit 3): `app_download_failed` (names the limit or error and `--from`),
  `app_download_mismatch`, `app_install_busy`.

`play`, `serve`, `mcp --task`, `run` and `bench` on a draw.io world check the kept file (present,
regular file, size and SHA-256) before any browser starts. Missing: `app_runtime_missing`; present but
not the pinned file: `app_runtime_unverified` (both exit 3). With `--mirror auto` the session runs
model-only instead and the Player's banner names `setup --app drawio`; `--mirror off` never needs the
runtime. `validate`, `pack` and `check` never do. `practonaut doctor --adapter` lists the runtime and
the sandboxed start.

## Linux: the sandbox is required

draw.io never starts Chromium without its sandbox, on any platform. On Ubuntu 23.10 and later the
default AppArmor setting refuses unprivileged user namespaces; Excalidraw then falls back to a start
without the sandbox ([PADR-0032](../adr/0032-chromium-sandbox-stays-on.md)), draw.io does not: with
`--mirror required` the command stops with `browser_start_failed` and the AppArmor advice, with
`--mirror auto` the session runs model-only. `PRACTONAUT_CHROMIUM_SANDBOX=require` changes nothing for
draw.io; nothing loosens it. The reason: draw.io is 20 MB of downloaded third-party script, and no
review shows that the adapter's narrow input keeps a renderer exploit out of reach. This is measured
as well as set: every conformance run records its Chromium processes' command lines, and the summary
counts those that carry `--no-sandbox` (0 in every committed run).

## How the adapter works

- **Serving.** The archive is read whole into memory, hashed and opened there; nothing on disk is
  read after the check. Only the 14 files the app loads with `lang=en` are served, from a list kept
  with the pin; every other path (another archive entry, `WEB-INF/`, `META-INF/`, the archive's
  agent-instruction and README files) is refused and fails the operation. Zip limits: 4,096 entries,
  32 MiB per inflated file and 32 MiB for all served files together, 256 MiB in total, a compression
  ratio of 100, stored or deflate only, no encryption, links, duplicates or unsafe names; each served
  file is inflated once, capped at its declared size, and its CRC checked.
- **Protocol.** The app runs in its own origin inside a host page; Node talks to it only through
  draw.io's documented embed JSON protocol (`load` and `export`), with
  `embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none&lang=en`.
  No script is evaluated in the app frame. The `load` event is never taken as proof.
- **Every transaction** compares the app's state with the transition's before state, computes its
  own prediction of the action, writes the whole predicted diagram, exports it, parses the export with
  the browser's XML parser and requires three things: the read-back equals the prediction on the live
  objects; every element the adapter wrote comes back with every attribute and child element, and
  nothing else comes back (the full write check); and integrity (unique ids, one root, existing
  parents, no cycle, no edge as a parent, edge ends are steps, no `html` other than 0, integer
  geometry, only the adapter's own attributes, styles and colours, and the declared constraints).
  Every read, `snapshot()` included, also runs integrity and requires the app to hold exactly what
  the last confirmed write left. So a change that reached the app in between, such as a hidden step,
  is `integrity_failed`.
- **Pictures.** The PNG and SVG are draw.io's own protocol exports, never a screenshot of the editor.
  `importArtifact` is not offered: foreign `.drawio` files are not loaded into the app.

### Mapping

| world/2 | draw.io cell |
|---|---|
| frame | container vertex, id = frame id, value = name, `swimlane;container=1;collapsible=0;startSize=30;fillColor=none;html=0;` (the title band is not filled, so overlapping frames hide nothing), geometry the envelope of its steps plus padding and title band; an empty frame keeps its last box or gets its own place in a row above the diagram |
| group | vertex `pn:group:<groupId>`, `group;`, `connectable="0"`, child of its members' frame or of the layer |
| step | vertex, id = step id, value = label, `rounded=0;` / `ellipse;` / `rhombus;` plus `html=0;strokeColor=…;fillColor=…;`, integer geometry relative to its parent |
| arrow | edge, id = arrow id, `endArrow=classic;html=0;`, `source`/`target` its live ends; with a live end a child of the layer after every frame and step (painted over them), with both ends loose a child of its frame |
| deleted object | no cell (draw.io keeps none; the core holds the tombstones) |

Colours: stroke black `#000000`, red `#b85450`, green `#82b366`, blue `#6c8ebf`, orange `#d79b00`;
fill none, red `#f8cecc`, green `#d5e8d4`, blue `#dae8fc`, yellow `#fff2cc`. Labels are plain text
(`html=0`). The root is `pn:root`, the layer `pn:layer`.

### Declared constraints

draw.io cannot hold two things world/2 allows, and its world-table entry declares them:
`group-within-one-frame` (the live members of one group share one frame, or none) and `xml-text`
(labels and frame names consist of XML 1.0 characters). For a draw.io world the core refuses an action
whose result breaks one with `constraint_refused` (state unchanged, `details.constraint` names it),
world validation refuses such a start state, the checker refuses such a session or submission, and the
adapter refuses before writing. See [world format §2a](../world-format.md#2a-world-content-v2-normative-additive).

## The checker's `.drawio` reader

`src/checker/drawio.ts` is the checker's own reader. It has its own bounded XML tokenizer, style
parser and tables, and is independent of the adapter. It is **allowlist-based**: it reads exactly the
cells, attributes, style names, keys and values the adapter writes (and a few forms the real app is
shown to draw as read), and refuses everything else with a named `reason`. Nothing is skipped as
unmodeled. So a file drawn by hand in draw.io is usually refused by `practonaut check`, for example
for a default style key, a hidden or transparent cell, a container, a colour outside the table, a
filled frame band, a filled step over an arrow, a frame name over a label or a page background.
This stays so until artifact mode (Must 3) decides otherwise. Every export the adapter writes is read.
The rules and limits are in
[PADR-0049 decision 6](../adr/0049-drawio-adapter.md#6-the-checkers-independent-drawio-reader),
[world format §2a](../world-format.md#2a-world-content-v2-normative-additive) and the
[threat model](../security/threat-model.md#4-limits). Each form the reader reads, and each refusal
the review found, has a differential fixture loaded through the real app
(`tests/adapter/drawio/cases.test.ts`).

## The draw.io library

`tasks/drawio/` holds the Excalidraw library's 16 tasks in a draw.io world: the same tasks, variant
cases, titles, prompts and hints, id `drawio-library`, and the task set `excalidraw-library` at the
library's version, so the same seeds select the same cases and each of the 48 instances has the same
task identity on both applications. Its oracle file keeps the same reference solutions, near misses and
seeds, re-verified in the draw.io world in every case when `npm run library:write` builds it. Address
its tasks as `drawio/<task>`: `play drawio/connect`, `tasks list drawio/all`, `bench --tasks drawio/all`
(a bench takes one library; mixing prefixes is refused). `report --verify` anchors a library bench to
the library this Practonaut ships for the stored world's application and binds its references to that
library's oracle file. The challenge generator writes any family for draw.io with `--app drawio`
(`node tools/challenge.ts generate <family> --set dev --app drawio --out <dir>`).

The acceptance evidence — the three-run summary, both libraries benched by the oracle with the real
mirrors, and their comparison — is in [docs/benchmarks/drawio](../benchmarks/drawio/README.md).

## In the Player and the CLI

- Texts name draw.io wherever they name the running app (MCP instructions, Player, CLI).
- A draw.io world gets the board workspace only: the editor and author workspaces embed Excalidraw
  and say they are not available.
- The native export is `practonaut.drawio` (Player download, `run --export`); `practonaut check
  result.drawio --world <world> --pair result.session.json` checks it like an Excalidraw export.

## Licence

The draw.io application code is Apache-2.0. Its stencil licence restricts use within Atlassian
products and their marketplace, which binds a downstream product distributed there; the archive also
holds an LGPL-2.1 library (libavoid) that the adapter does not load. Practonaut downloads the
unmodified release on the user's request and never redistributes it: not in the npm package
(`test:pack` refuses any `.war` or zip archive), not in a CI artifact or cache (the workflow check in
`npm run check` refuses any unlisted path).

## Platform status

The conformance layer (`npm run test:drawio`) runs on Linux in CI on every run; on macOS and Windows
by hand (`.github/workflows/drawio-conformance.yml`). Until a macOS and a Windows conformance summary
are recorded, `doctor --adapter` says the draw.io mirror is not yet verified on those platforms.

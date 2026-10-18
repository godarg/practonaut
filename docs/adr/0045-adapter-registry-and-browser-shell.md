# PADR-0045 — Adapter registry, named refusal of unknown applications, and a shared browser shell

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, Must 1 (issue #51) · Amends
[PADR-0011](0011-live-mirror-and-browser-runtime.md) (provisioning) and
[PADR-0012](0012-excalidraw-bundling.md) (an app runtime is no longer always bundled) · Builds on
[PADR-0007](0007-adapter-contract.md) (adapter contract), [PADR-0029](0029-normal-browser-cross-platform.md)
and [PADR-0032](0032-chromium-sandbox-stays-on.md) (one way to start Chromium) · To be accepted with
the pull request that implements it, after a review of that code

## Context

The code was written for one application. A second one (draw.io, Must 2; spike report
[spikes/drawio/REPORT.md](../../spikes/drawio/REPORT.md)) needs the following places to stop
assuming Excalidraw. Evidence at commit 9c6a1e9:

- **Literal types.** The adapter contract fixes `id: "excalidraw"; appVersion: "0.18.1"`
  (`src/adapters/types.ts:3`); the world contract and both world schemas fix the same literals for
  `app.adapterId`, `app.versionRange` and `provenance.appVersion` (`src/world/types.ts:82,87`,
  `src/world/schema.ts:73,81,140,148`).
- **Direct factory calls.** The mirror creates the Excalidraw adapter by name
  (`src/host/mirror.ts:31,71`), and so do `practonaut run` (`src/cli/runtime.ts:75`), the transfer
  helpers (`src/evaluation/transfer.ts:23,46,192`) and the package entry (`src/index.ts:8`). The
  mirror factory receives only a state (`src/host/mirror.ts:24`).
- **Checker dispatch** chooses the export parser by world schema alone (`src/checker/index.ts:115`,
  `src/host/export-pair.ts:52-57`); the checker request accepts the formats `session` and
  `excalidraw` (`src/checker/main.ts:11`).
- **An unknown application is refused, but not by name.** Measured on 9c6a1e9 (2026-10-18): a world
  with `app.adapterId: "drawio"` is refused by `practonaut pack`/`validate` and by `play` with
  `E_WORLD_INVALID` and the schema text `app.adapterId: Invalid input: expected "excalidraw"`; the
  checker process answers `checker_invalid`. A version other than `0.18.1` gives the same generic
  code. A user cannot tell "this Practonaut has no such app" from "this file is broken".
- **Mirror equality includes tombstones.** The host compares the mirror's read-back with the full
  session state, deleted objects included (`src/host/session.ts:321,425,443,453,458,468`,
  `src/host/mirror.ts:77,79`). The core keeps deleted objects as tombstones (architecture §3).
  Excalidraw keeps deleted elements (`isDeleted`), so this holds today. draw.io keeps no deleted
  cells: the spike's writer writes live objects only ("Tombstones have no cell",
  `spikes/drawio/writer.ts:41`) and compared the live projection (`spikes/drawio/run.ts:41-42`).
  The world/2 export comparison is already live-only (`src/host/export-pair.ts:55`); world/1's is
  strict and includes tombstones (`:56`).
- **Browser mechanics live inside the Excalidraw adapter**: launch with a deadline and abort
  (`src/adapters/excalidraw/index.ts:130-193`), fail-closed routing with a denied list (`:161-169`),
  a serial transaction with timeout and rollback that closes the page so late writes cannot race
  it (`:194-214`), PNG capture (`:240-245`) and SHA-256 of the export (`:25`). The launch deadline
  is only passed to Playwright as `timeout` (`:133`); a launch that ignores it is not bounded by
  Practonaut, and the app's own start after the launch has no overall deadline. The spike drove
  draw.io through the same `launchChromium` and the same routing idea.
- **The routing sees only HTTP.** `context.route('**/*')` does not intercept WebSockets, nor any
  request of a shared worker. Measured against the real Chromium of `playwright-core` 1.64.0
  (2026-10-18, a page served from the shell's named origin, a listener on 127.0.0.1 standing in for a
  public host, Chromium's own local-network checks off): page, frame and worker WebSockets, every
  fetch, `importScripts` and font load of a shared worker (from a URL, `blob:` or `data:`), and
  WebRTC's STUN packets over UDP reached the listener; none of them was recorded. With WebRTC
  limited to proxied UDP, TURN over TCP (to an address or a host name) still connected to it
  directly. `<link rel="preconnect">` and `rel="dns-prefetch"` hints and anchor host names caused no
  connection and no host resolution in Chromium's net log — also on a plain Playwright page served by
  a real HTTP server, so the headless shell that Practonaut starts does not act on these hints at
  all. The bundled Excalidraw uses none of these channels, but a downloaded third-party app could.
- **Time.** The routing setup (`context.route`, `routeWebSocket`), the read of the committed scene
  before a write and the rebuild after a failed one were awaited without a deadline; a browser that
  stopped answering there held the start, the operation and the adapter's serial queue for good.
- **Provisioning assumes a bundled app.** PADR-0011 downloads only Chromium; PADR-0012 bundles the
  pinned Excalidraw into the npm package. The spike recommends that the user's machine downloads
  the unmodified official draw.io release, checked by SHA-256, and that Practonaut never
  redistributes it (REPORT, *Licence* and *What 0.3.0 would need*).

## Options considered

**Where an unknown application is refused.**
1. *Only in the registry, when the mirror starts.* The world schema would accept any id. Every
   entry point that forgets the registry call would run a world through the wrong adapter, or
   model-only without saying why; the checker may not import the registry (architecture §2).
2. *In world validation, from a data table in `src/world`, plus the registry and the checker's own
   table* (chosen). Every path to a session, a bench run or a verdict validates the world first, so
   one choke point refuses by name before any browser starts; the registry and the checker refuse
   again from their own tables (defence in depth); a test keeps the three tables equal.

**Mirror equality** (what the host compares with the mirror's read-back).
1. *Live objects for every adapter* (the roadmap's wording). One rule, the same as the world/2
   export comparison. For Excalidraw it **loses**: confirmation that the real app holds the core's
   tombstones and their last attributes (label, geometry, cleared arrow ends), and detection of an
   adapter or engine defect that touches only deleted elements (a dropped or altered deleted
   element). It **keeps**: everything a goal can see — predicates quantify over live objects
   (PADR-0013), so a resurrected element, a missing live element or a wrong live attribute is still
   refused. It changes Excalidraw's behaviour without a measured need.
2. *Per adapter, declared in the registry* (chosen): `full` compares the whole state, tombstones
   included; `live` compares live objects only. Excalidraw stays `full` and **loses nothing**; a
   mirror that declares nothing is compared `full`. draw.io will declare `live` (Must 2) and loses,
   for itself, what option 1 loses for every app; the core remains the only holder of its
   tombstones, which is where they matter (identity non-reuse, undo, replay hashes).
3. *The adapter re-attaches tombstones from the core's prediction.* The host check would pass
   trivially for that part: it compares the prediction with a copy of itself, looks like a
   confirmation by the real app, and puts tombstones the app never held into the private mirror
   diagnostics as "read-back". For Excalidraw it keeps everything only because Excalidraw would not
   use it. Rejected: a check that cannot fail must not look like one.

**Browser shell.** Keep each adapter's own copy of launch, routing and rollback (duplicated safety
code, drifts); or extract the app-independent mechanics once (chosen), leaving the adapter folder
with what is about the app.

## Decision

1. **Applications a world may name** are a data table in `src/world/apps.ts`: adapter id → the
   pinned app versions and the world schemas it runs. `AdapterId` and `AppVersion` are the unions
   derived from it; the adapter contract, the world contract and both world schemas use them
   instead of the literals (the generated JSON Schemas list the allowed values). An omitted world/2
   `provenance.appVersion` becomes the world's `app.versionRange` (today the same `0.18.1`).
2. **Named refusal before anything starts.** `validateWorld` checks `app.adapterId`,
   `app.versionRange` and `provenance.appVersion` against the table **before** the schema parse and
   refuses with one of three codes: `E_ADAPTER_UNKNOWN` (no such adapter),
   `E_ADAPTER_VERSION_UNSUPPORTED` (the adapter exists, not for that app version) and
   `E_ADAPTER_SCHEMA_UNSUPPORTED` (the adapter exists, not for that world schema — draw.io named in
   a world/1). The message names the adapter. The codes are world-content codes beside
   `E_WORLD_INVALID`, listed in [world format](../world-format.md) §1.4 and kept equal to the code by
   a test, and they are failure codes the checker process may return. Three entry points refuse
   before any browser starts, each tested: world validation (`validate`, `pack`, every loader),
   `practonaut serve`/`play`/`mcp --task` and `run` (the world is loaded and its adapter resolved in
   the registry before the Chromium check; each refuses by name with exit 2, and the registry's own
   lookup there is tested on its own with a registry that lacks the app), and the checker process
   (its world validation, then its own format table).
3. **The registry** (`src/adapters/registry.ts`) maps each adapter id to its app versions, world
   schemas, runtime kind (`bundled` | `downloaded`), read-back comparison (`full` | `live`) and
   factory. `resolveAdapter(app, schema)` refuses with the same codes. Only `excalidraw` is
   registered (bundled, `full`, `0.18.1`, world/1 and world/2). A unit test keeps the registry's ids,
   versions and schemas equal to the world table.
4. **The mirror goes through the registry.** The host's mirror factory receives the world's `app`
   and creates the adapter through `resolveAdapter`. The capabilities the mirror uses beyond
   PADR-0007 (`restoreState`, `renderPng`, `terminate`, `networkAttempts`) form one shared interface
   (`MirrorAdapter`). `practonaut run` resolves through the registry too. The transfer helpers and
   the package entry keep the Excalidraw-specific factory: transfer checks are about Excalidraw's
   native file and its file dialog (and a parallel change, issue #45, is editing that file); the
   package entry keeps `createExcalidrawAdapter` for API compatibility and adds the registry.
5. **Mirror equality per adapter** (option 2 above): the host compares every read-back (step
   transaction, check, image, export, recovery) with the comparison its adapter declares; `full`
   when none is declared.
6. **The checker keeps its own format table** (`src/checker/formats.ts`, never importing
   `src/adapters`): adapter id → native file extension and the parser per world schema
   (Excalidraw: the strict parser for world/1, the tolerant scene parser for world/2). The checker,
   its request's `format` option (`session` or a native format id) and the export pair choose the
   parser through it; a native format that is not the world's own is refused. A unit test keeps its
   ids equal to the registry's.
7. **A shared browser shell** in `src/adapters/browser/` holds what is not about the app: the one
   Chromium start (moved, PADR-0032), the bounds, and:
   - **Start.** The shell bounds the launch itself and closes a browser that arrives after the
     deadline or an abort; the adapter's own start (open the app, first scene, probe) has a deadline
     of its own (`BROWSER_BOUNDS.initialize`, 60 s: longer than the native transfer's 60-second
     attempt, whose own deadline and evidence end a stalled transfer); any start failure closes the
     browser.
   - **Network boundary.** Only the named origins answer, only safe paths, only what the adapter
     serves. Every other HTTP request of the page, its frames and its dedicated workers is aborted
     and recorded. Every WebSocket the page or a frame opens is closed by the shell before it
     connects, and recorded. Every served response carries a content security policy
     (`default-src` the named origins plus `data:`/`blob:`, which carry the policy with them; inline
     code and `eval` unchanged), so no context of the page — dedicated or shared worker, frame — can
     fetch, connect, import a script or load a font from another host; the violations the page, a
     frame or a dedicated worker reports go to a path of the first named origin that the shell
     answers, and are recorded. Below the page, the browser starts with WebRTC limited to proxied
     UDP and with a proxy that is the shell's **sink**: a listener on the loopback interface (bound
     to 127.0.0.1, a free port, closed with the shell) that forwards nothing. The loopback
     interface is proxied too, so a page cannot reach local services this way either. Every
     connection the browser opens itself therefore ends at the sink: TURN over TCP (measured, by
     address and by host name, which is not resolved), a preconnect, and the violation reports of a
     shared worker, which the routing cannot see. The sink has no token — Chromium cannot be given
     one for these connections — so any local process, also of another OS user, can connect to it
     as well. It therefore trusts no connection: it reads nothing (the socket starts paused), records
     nothing, answers 403 and closes, at most 64 connections at a time. A foreign client can neither
     reach the browser, nor fill the shell's records, nor close the shell or make its adapter fail;
     the sink only holds the port, so nothing else can listen there and receive the browser's
     connections. The price: the browser's own attempts through the sink (TURN, a shared worker's
     reports) are blocked but not recorded. In addition the browser resolves no host name
     (`--host-resolver-rules`, all names not found; routed content is never resolved) and every
     served document turns DNS prefetching off (`X-DNS-Prefetch-Control: off`); neither has an effect
     that can be measured in the headless shell, which acts on no prefetch or preconnect hint, so
     both stay as a second line in case a later Chromium does. `tests/adapter/browser-shell-network.test.ts`
     measures each channel against the real Chromium, including the net log for the hinted names.
   - **Operations and time.** The routing setup shares the launch deadline. Transactions and guarded
     reads have one deadline and one abort, watched before the work starts, that also cover reading
     the committed scene: a read that does not return fails the operation (`mirror_timeout` or
     `cancelled`) with nothing written. Reading the scene, the work, the undo and the rebuild are each
     an operation of their own: once one ends, every later call it makes into the shell (page,
     browser, context, fresh page, a new operation, closing the shell) is refused, wherever it
     resumes, and a fresh page it was still waiting for is closed instead of published. A failed
     write is undone in place within the start's deadline; a timed-out, cancelled or thrown one —
     or one whose undo did not finish — closes the page and rebuilds the committed scene on a fresh
     one within the start's deadline. A
     rebuild that fails or runs out of time leaves the page in an unknown state: the shell closes its
     browser and its sink, the operation answers `mirror_unavailable`, and so does every later call.
     The host's mirror then replaces the adapter instead of restoring into it (its read-back after the
     failure fails, which marks the adapter interrupted in `src/host/mirror.ts`).
   - PNG capture and the SHA-256 artifact helper.

   The Excalidraw adapter keeps read, write, projection, integrity and SVG. The native file dialog
   helper in `src/evaluation/transfer.ts` moves into the shell after issue #45 is merged.
8. **Downloaded app runtimes** (amends PADR-0011 and PADR-0012). An adapter declares how its app
   arrives. `bundled`: built from a pinned development dependency into the npm package with its
   licence texts (PADR-0012, unchanged). `downloaded`: the **unmodified official release** of the
   pinned version, downloaded only by an explicit `practonaut setup` option that names the source,
   size and SHA-256 first; never by an install script and never implicitly by `play`, `bench` or
   `mcp`; checked against the pinned size and SHA-256 before it is kept; unpacked with entry-name
   checks into the private data directory (PADR-0029); served to the adapter's page only through
   request interception of named app paths (never `WEB-INF`/`META-INF`; no listener serves the app), behind
   the shell's network boundary (decision 7); never redistributed (not in the npm package, not in a CI
   artifact). Without it the adapter's mirror is unavailable: `--mirror auto` runs model-only with a
   notice that names the setup option and the size, `--mirror required` fails by name, and `doctor
   --adapter` reports the runtime per adapter. After setup everything runs offline. The draw.io
   download itself is Must 2.

## Consequences

- A world that names an application this Practonaut does not have is refused by name at
  `validate`, `pack`, `play`, `run`, `bench`, `mcp --task` and in the checker process; nothing
  starts Chromium for it. JSON output and exit codes stay those of a rejected world (exit 2).
- Adding draw.io (Must 2) touches the world table, the registry, the checker's format table and
  the adapter folder; the equality test fails until all three tables agree.
- Excalidraw's behaviour is unchanged: same read-back comparison, same conformance suite (its
  creation lines go through the registry), same content hashes for every world.
- The generated world JSON Schemas change from `const` to `enum` for the app fields, and world/2's
  `provenance.appVersion` is no longer defaulted in the schema (the loader fills it).
- File names of native exports (`.excalidraw` in `run --export` and the export pair) stay
  Excalidraw's until Must 2 uses the format table's extension.
- The Excalidraw engine page now runs under the shell's content security policy and without
  WebRTC UDP, behind the sink proxy and without host resolution; the conformance suite passes
  unchanged under it and records no attempt (no browser-internal traffic reaches the sink). An app
  that needs any network beyond its named origins cannot work in the shell.
- A start or recovery of the mirror is bounded by the launch and start deadlines (15 s + 60 s)
  instead of the per-call timeouts alone; an operation is bounded by its own limit plus, after a
  failure, the start's deadline for the undo and again for the rebuild.
- The shell opens one listening socket per running browser: the sink, on 127.0.0.1 only, which
  serves, reads and records nothing (threat model: other OS users are untrusted and can connect to
  it; it is built so that they gain nothing). The app itself is still served without any listener
  (PADR-0012).

## Re-assessment triggers

- An adapter whose read-back can confirm tombstones partly (neither `full` nor `live`).
- A second app that cannot run in the shared Chromium (needs a different engine or a native
  process).
- A downloaded app whose licence or terms forbid local unmodified use, or whose release cannot be
  pinned by hash.
- Community adapters outside the repository (PADR-0007's trigger).
- A Chromium or Playwright release under which a channel of the network test reaches the listener,
  or a new channel the routing and the policy do not cover.

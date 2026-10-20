# Adapter guide: connecting an application

An adapter connects Practonaut to one real application at a pinned version
([PADR-0007](adr/0007-adapter-contract.md)). It is project code with tests, never part of a world
package: worlds are data, adapters are trusted code reviewed in this repository. Today there is one
adapter, Excalidraw 0.18.1, in `src/adapters/excalidraw/`. This guide says what an adapter must do,
how it is accepted, and what a second application would touch in the code.

If you want to propose an application, open an **Adapter request** issue first. A short spike
answering the questions in section 4 saves everyone time.

## 1. What an adapter does

The contract is `ApplicationAdapter` in `src/adapters/types.ts`:

| Method | Must |
|---|---|
| `describe()` | Name the app version, the capabilities, and the declared attribute set; list every excluded volatile or derived attribute with a reason. |
| `snapshot()` | Read the app state and project it onto the declared set: integer JSON keyed by semantic ids, live objects plus tombstones, sorted keys. |
| `apply(transition)` | Apply a modeled before/after transition **only through an official interface**, compute derived geometry the app does not update itself, then **read back** and compare with the prediction on the declared set, and run the adapter's integrity check. Success only after both pass; an API success code alone is never success. |
| `exportArtifact()` | Produce the native file and a rendered form with SHA-256 each; the same state gives the same export on the declared set. |
| `importArtifact(native)` | Load a native file and return its projected state, or a named failure. |
| `close()` | Release the app and every child process. |

The host's live mirror needs four more capabilities, `MirrorAdapter` in the same file:
`restoreState` (resynchronise, checked by read-back), `renderPng`, `terminate` (cancel pending
browser work before recovery) and `networkAttempts` (requests the app made that were refused).

Every long operation honours a timeout and an `AbortSignal` and leaves the session unchanged when
it fails. Recording (optional capability) starts only on an explicit request, groups app events at
gesture boundaries, maps them to semantic events on the declared set and reports everything else
as `unmodeled`.

## 2. Acceptance: the conformance suite

An adapter version is accepted for an app version when, against the **real** pinned app
(never a mock):

- predicted state equals read-back state for every modeled transition of every world that uses it;
- a deliberately wrong prediction is detected, and an invalid transition surfaces as an error;
- the independent checker accepts the export of a reference result and rejects tampered exports;
- for visual relations the model does not confirm (for Excalidraw: arrow attachment, label
  placement) export checks pass;
- runs are repeated at least three times and agree on the declared set.

Expected states in these tests are written independently of the adapter (by hand or from the real
app). `npm run test:adapter` runs the Excalidraw suite headless and offline after bootstrap; see
`tests/adapter/`.

## 3. What a second application touches

Adapters are chosen by the world's `app.adapterId` through one registry
([PADR-0045](adr/0045-adapter-registry-and-browser-shell.md)). Three tables name them, and
`tests/unit/adapter-registry.test.ts` fails until they agree: the applications a world may name
(`src/world/apps.ts`), the registry (`src/adapters/registry.ts`) and the checker's format table
(`src/checker/formats.ts`). A world naming anything else is refused by name before anything starts
(`E_ADAPTER_UNKNOWN`, `E_ADAPTER_VERSION_UNSUPPORTED`, `E_ADAPTER_SCHEMA_UNSUPPORTED`;
[world format](world-format.md) §1.4). A second application is a reviewed change across these
places, each with tests:

| Place | Today | For a second app |
|---|---|---|
| `src/world/apps.ts` | `excalidraw` at `0.18.1`, for world/1 and world/2 | the adapter id, its pinned app versions and the world schemas it runs; the world JSON Schemas follow (`npm run schema:write`) |
| `src/adapters/registry.ts` | `excalidraw`: bundled runtime, `full` read-back, `createExcalidrawAdapter` | an entry with versions, schemas, runtime kind (`bundled` in the npm package, or `downloaded` unmodified by an explicit setup step), read-back comparison (`full` if the app keeps deleted objects, `live` if not) and factory |
| `src/adapters/browser/` | the shared shell: one Chromium start on a slot of the process's browser budget, one close contract (a deadline in, an outcome out; PADR-0050), launch and start deadlines and abort, the network boundary (HTTP routing over named origins, every WebSocket closed, a content security policy on every served response, no WebRTC UDP, a sink proxy that refuses every connection the browser opens itself, no host resolution; `tests/adapter/browser-shell-network.test.ts`), operations that end on timeout and roll back on a fresh page, PNG capture, artifact hashes | reuse it; only what is about the app goes into the adapter's folder |
| `src/adapters/<app>/` | Excalidraw: read, write, projection, integrity, SVG, engine build, recorder | new folder implementing `MirrorAdapter`; pinned app version; bundled assets with license texts, or the download rule of PADR-0045 |
| `src/checker/formats.ts` | `excalidraw`: the strict parser for world/1 exports, the tolerant scene parser for world/2 | an export parser for the new native format, written independently of the adapter |
| `src/core`, `src/world` | diagram actions (steps, arrows, frames, styles) | the new app's actions, each with a replay test and an independently derived golden hash |
| `tools/build-engine.ts` | builds the offline Excalidraw bundle | a reproducible offline build of the new app, if it is bundled |
| `tasks/<app>/` | Excalidraw task library | a small task library with reference solutions and near misses |

The deterministic core never learns about the app: it only sees semantic state and actions.
The checker must keep parsing exports itself; it may not import the adapter or the core.

## 4. Questions a spike should answer

1. Is there an official, scriptable interface to read and write the state (API, plugin, file
   format)? UI automation by pixel is not accepted.
2. Can the app run locally and offline at a pinned version, without accounts or containers the
   user has to set up?
3. Which attributes are semantic, which are volatile or derived, and can derived ones be
   recomputed by the adapter after a programmatic write?
4. Can every write be read back and compared? How do you detect a write that the app silently
   changed or rejected?
5. Is the native export stable for the same state, and can an independent parser read it?
6. What are the license terms of the app and every bundled asset?

## 5. Excalidraw specifics

- Registered as `excalidraw` at `0.18.1` for world/1 and world/2, bundled in the npm package
  (PADR-0012). The folder keeps what is about Excalidraw — read, write, projection, integrity and
  SVG; starting Chromium, routing, transactions and capture come from the shared browser shell.
- Excalidraw keeps deleted elements (`isDeleted`), so the adapter declares `full` read-back: the
  host compares tombstones too, not only live objects.
- Arrow relations come from `startBinding`/`endBinding`; `boundElements` is a cache. The integrity
  check fails a write when a binding points to a missing element or when the adapter's own write
  leaves a stale back-reference. Stale back-references produced by the real UI are normalised on
  read and reported as a warning.
- Programmatic moves do not carry bound arrows or labels; the adapter recomputes arrow endpoints and
  centres labels (`restoreElements({ repairBindings: true, refreshDimensions: true })`).
- Fonts are bundled and loaded before any measurement; their license texts ship with the bundle
  ([engine assets](adapters/excalidraw-assets.md)).
- Bending an arrow changes only excluded attributes; the recorder reports such a gesture as
  `unmodeled` when no bound shape moved.
- Apply uses only `updateScene`. Conformance compares against real read-back, integrity and
  export/re-import. API actions and free editor gestures are not assumed to be equivalent: editor
  input is compared against the full modeled before/after state in the host, and only a single
  recognised action enters the normal mirror transaction.
- The recorder groups changes at pointer release, key boundary, 120 ms quiet or stop
  (`excalidraw-gesture-v1`). Deleted arrows keep endpoint bindings in native Excalidraw; the rule
  comparison treats bindings on deleted arrows as inactive, on cloned comparison states only.

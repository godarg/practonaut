# World format

Status: package layer, world content v1 and the additive world content v2 are normative. Sources
of truth: `src/package/manifest.ts` and `src/world/schema.ts`. Decisions: PADR-0003 (package), PADR-0004 (runtime semantics),
PADR-0013 (bounded predicates). `examples/worlds/minimal` is a supported `practonaut.world/1` world
with one confirmed rename rule and task T1.

## 1. Package layer (normative, schema version 1.0.0)

A world is distributed as a zip archive with the extension `.pnworld`. Hidden checker data travels
in a separate archive, the **checker bundle** (extension `.pncheck`), which is never given to
learners or agents.

Machine-readable schemas are generated from the source of truth in `src/package/manifest.ts`:

- `schemas/world-package-manifest.v1.schema.json`
- `schemas/checker-bundle-manifest.v1.schema.json`

`npm run schema:check` fails if the committed schemas differ from the source.

### 1.1 Manifest

`manifest.json` sits at the archive root and is not listed in itself.

```json
{
  "format": "practonaut.world-package",
  "schemaVersion": "1.0.0",
  "world": { "id": "minimal", "version": "0.0.0" },
  "entry": "world.json",
  "files": [
    { "path": "world.json", "sha256": "<64 hex>", "size": 120, "mediaType": "application/json" },
    { "path": "assets/marker.png", "sha256": "<64 hex>", "size": 67, "mediaType": "image/png" }
  ]
}
```

- `schemaVersion` major is checked first; a major other than 1 is rejected with
  `E_SCHEMA_MAJOR_UNSUPPORTED` before full validation. Minor versions may add optional fields;
  readers reject unknown fields within the major they support.
- `world.id`: lowercase ASCII letters, digits and hyphens, at most 64 characters.
  `world.version`: semantic versioning 2.0.0.
- `entry`: the world file, listed in `files` with `application/json`.
- Every file entry except `manifest.json` is listed exactly once with its uncompressed size,
  SHA-256 and media type. Directory entries are not listed; an empty directory entry is allowed
  only as a parent directory of a listed file (generic zip tools write these), any other is
  rejected with `E_UNLISTED_ENTRY`.
- `files` is checked to be an array of at most 255 items before the schema runs; a rejection
  reports at most the first five schema issues and stays within 4096 characters. No `visibility` field exists: anything in a world package is visible
  to whoever has the file.
- The checker bundle uses `format: "practonaut.checker-bundle"`, the same `world` reference and
  `files`, and no `entry`.

### 1.2 Entry rules

- Paths: ASCII segments matching `[A-Za-z0-9][A-Za-z0-9._-]*`, joined by `/`, at most 8 segments
  and 200 characters, NFC, no `..`, no leading `/`, no drive letters, no backslashes. No segment
  ends with a dot, and no segment is a Windows device name (`CON`, `PRN`, `AUX`, `NUL`,
  `COM1`–`COM9`, `LPT1`–`LPT9`, with or without an extension). Names are compared after NFC,
  lower-casing and removal of trailing dots; two names that compare equal, or a file name that is
  also a directory of another entry (`a.txt` and `a.txt/b.txt`), are rejected.
- Only regular files and directories; no links, devices or other special types. A Unix mode in
  the external attributes is checked whatever host the entry claims (type bits 0 mean "not
  given"; the name decides); accepted hosts are MS-DOS (0), Unix (3), NTFS (10, and 11 as written
  by Go and Info-ZIP), VFAT (14) and OS X (19). No encryption; store or deflate only; "version needed
  to extract" at most 2.0; every entry starts on disk 0; no zip64, data descriptors, comments or Unicode-path extra fields
  (central or local); local headers must agree with the central directory, and entries must
  fill the archive from byte 0 to the central directory without gaps or overlaps.
- Allowed media types: `application/json`, `text/plain`, `image/png`, `image/jpeg`, `image/webp`.
  Extension and content must agree. Executable or active content is rejected wherever it
  appears: native binaries and shebang scripts (by their first bytes), WebAssembly, PDF (a
  `%PDF-` header at the start of JSON and text entries, anywhere in the first 1024 bytes of
  image entries), and markup at the start of the content after any
  amount of whitespace: `<?` (XML, PHP), `<!` (doctype, comment, CDATA) and any start or end
  tag (`<` or `</`, a name beginning with a letter or `_` of any length, then whitespace, `/`, `>`
  or the end), plus known active elements such as `<script`, `<svg`, `<iframe` whatever follows,
  also with a namespace prefix of any length (`<x:script>`).
  Files with an active extension (`.svg`, `.html`, `.js`, `.css`, `.wasm`, `.pdf` and others) are
  rejected by name.
- JSON is strict UTF-8 and follows the I-JSON (RFC 7493) number and surrogate rules (not all of
  I-JSON; see 1.5): nesting depth at most 64, checked by a byte scan before parsing; string
  escapes must not contain lone UTF-16 surrogates. A number literal is
  accepted if its IEEE 754 double value is finite, a non-zero literal does not become 0, an
  integer value lies within ±(2^53−1) whatever the literal's form (`9007199254740992`,
  `9007199254740992.0` and `1e16` are rejected), and the literal has at most 17 significant
  digits or is exactly the decimal value of its double.

### 1.3 Limits

Exported as `LIMITS` from `src/package/limits.ts`; callers may lower, never raise them.

| Limit | Value |
|---|---|
| Archive size | 16 MiB |
| Entries (including manifest and directories) | 256 |
| Path length / depth | 200 characters / 8 segments |
| Uncompressed entry | 4 MiB |
| Uncompressed total | 16 MiB |
| Compression ratio (entries ≥ 64 KiB) | 100 |
| JSON nesting depth | 64 |

### 1.4 Rejection codes

Every rejection carries exactly one code. The list below is checked against
`PACKAGE_ERROR_CODES` in `src/package/errors.ts` by `tests/unit/docs-sync.test.ts`.

<!-- error-codes:start -->
| Code | Meaning |
|---|---|
| `E_ARCHIVE_TOO_LARGE` | Archive larger than the limit. |
| `E_ARCHIVE_INVALID` | Not a readable zip archive. |
| `E_ARCHIVE_LAYOUT` | Entries are not laid out contiguously from the start of the file. |
| `E_TOO_MANY_ENTRIES` | More entries than allowed. |
| `E_UNSUPPORTED_ZIP_FEATURE` | zip64, data descriptor, comment, Unicode-path extra field, unsupported "version made by" host, or "version needed" above 2.0. |
| `E_HEADER_MISMATCH` | Local header disagrees with the central directory. |
| `E_ENCRYPTED_ENTRY` | Encrypted entry. |
| `E_UNSUPPORTED_METHOD` | Compression other than store or deflate. |
| `E_INVALID_PATH` | Path outside the allowed syntax, length or depth. |
| `E_ABSOLUTE_PATH` | Absolute or drive-letter path. |
| `E_PATH_TRAVERSAL` | Path contains a `..` segment. |
| `E_PATH_NOT_NFC` | Path is not in Unicode normalization form C. |
| `E_SYMLINK_ENTRY` | Symbolic link entry. |
| `E_SPECIAL_ENTRY` | Device, FIFO or other special entry. |
| `E_DUPLICATE_ENTRY` | Two entries equal after normalization and case folding. |
| `E_ENTRY_TOO_LARGE` | Entry larger than the per-entry limit. |
| `E_TOTAL_TOO_LARGE` | Declared total size above the limit. |
| `E_COMPRESSION_RATIO` | Compression ratio above the limit. |
| `E_ENTRY_SIZE_MISMATCH` | Inflated size differs from the declared size. |
| `E_CRC_MISMATCH` | CRC-32 differs from the header. |
| `E_MANIFEST_MISSING` | No `manifest.json`. |
| `E_MANIFEST_INVALID` | Manifest is not valid JSON or violates the schema. |
| `E_FORMAT_MISMATCH` | World package given where a checker bundle is expected, or the reverse. |
| `E_SCHEMA_MAJOR_UNSUPPORTED` | Manifest schema major version not supported. |
| `E_UNLISTED_ENTRY` | Archive entry not listed in the manifest. |
| `E_MISSING_ENTRY` | Listed file absent from the archive. |
| `E_SIZE_MISMATCH` | Manifest size differs from the content. |
| `E_HASH_MISMATCH` | Manifest SHA-256 differs from the content. |
| `E_UNSUPPORTED_MEDIA_TYPE` | Extension not on the allowlist. |
| `E_MEDIA_TYPE_MISMATCH` | Extension, declared type and content disagree. |
| `E_EXECUTABLE_CONTENT` | Executable or active content. |
| `E_JSON_INVALID` | JSON entry is not strict UTF-8 JSON. |
| `E_JSON_TOO_DEEP` | JSON nesting deeper than the limit. |
| `E_ENTRY_INVALID` | `entry` missing, not JSON, or not a JSON object. |
| `E_SOURCE_INVALID` | Packer source directory invalid. |
<!-- error-codes:end -->

The world entry itself (section 2) is refused with one of these codes, checked against
`WORLD_ERROR_CODES` in `src/world/preflight.ts` by the same test. The adapter codes are decided
before the content schema runs, so a world for an application this Practonaut does not have is
named as such, not reported as malformed ([PADR-0045](adr/0045-adapter-registry-and-browser-shell.md)).

<!-- world-error-codes:start -->
| Code | Meaning |
|---|---|
| `E_WORLD_INVALID` | World content violates its schema, a limit or a cross-field rule. |
| `E_ADAPTER_UNKNOWN` | `app.adapterId` names no application this Practonaut has. |
| `E_ADAPTER_VERSION_UNSUPPORTED` | The adapter exists, but not for `app.versionRange` or `provenance.appVersion`. |
| `E_ADAPTER_SCHEMA_UNSUPPORTED` | The adapter exists, but does not run worlds of this schema (for example a world/1 naming an adapter that runs world/2 only). |
<!-- world-error-codes:end -->

### 1.5 Known limits of the package layer

- Image validation checks magic bytes only; a polyglot file with a valid image header passes.
  The player serves assets with their declared type and `X-Content-Type-Options: nosniff`.
- Script or stylesheet text without markup in a `text/plain` entry (for example `alert(1)` or
  `body{...}`) cannot be recognised as such and is accepted. It is harmless only because the
  player serves `text/plain` with `nosniff` and renders it as text, never as code; any surface that
  interprets text entries must keep that rule.
- I-JSON is enforced only for numbers and surrogates. Duplicate keys inside a JSON entry are not
  detected (`JSON.parse` keeps the last value), and Unicode noncharacters (U+FDD0–U+FDEF,
  U+xFFFE/U+xFFFF such as U+FFFF) are accepted in strings.
- Data inside an entry's compressed range after the end of its deflate stream is not detected;
  the inflated content, which is what every reader sees and what is hashed, is unaffected.
- Package hashes detect corruption and tampering after packing, not a malicious author; there is
  no signing yet.

## 2. World content v1 (normative)

The entry has `schema: "practonaut.world/1"`, `id` and semver `version`, matching its manifest.
`src/world/types.ts` defines the shared contract; `src/world/schema.ts` defines the strict zod
schema. `schemas/world.v1.schema.json` is generated and checked in `npm run check`. Runtime
loading validates referential integrity and bounds in addition to the JSON Schema. A package-layer
validation alone does not establish that an entry is a runnable world.

| Part | Content |
|---|---|
| `app` | a known adapter id and one of its exact confirmed app versions (today `excalidraw` and `0.18.1`; anything else is refused by name, §1.4), licensed font-family allowlist and reasoned exclusions |
| `units` | integer units per geometry attribute (pixel × 1 in flow-diagram) |
| `objectTypes` | closed frame/step/arrow types and typed attributes |
| `initialState` | `{objects: {semanticId: object}}`; key equals object id; deleted objects remain tombstones |
| `actions` | closed action names, strict typed parameters with bounds, public preconditions |
| `rules` | action, closed effects, public preconditions, `status: "confirmed"`, nonempty evidence references (`run`, `case`, SHA-256) |
| `tasks` | id, EN/DE title and prompt, optional per-task start, goal AST, ordered hints, typed error classes and EN/DE consequence explanations |
| `variants` | `finite-seeded-v1`, finite cases with labels, insertion position and integer layout offset; deterministic choice by seed |
| `provenance` | authors, adapter/app/compile-tool versions and recording references |
| `rights` | exact `CC0-1.0` content dedication or local `LicenseRef-Private`, with per-asset/per-recording source, license and recording consent; every archive file except the world entry has a matching asset entry, and every declared asset exists |

Private worlds additionally require strict `provenance.privateSource`: owner, reconstruction
author, a source authorization reference/hash/scope, and source reference/hash pairs. The
reconstruction author must occur in the declared authors. Private-source metadata requires
`LicenseRef-Private`, and that license requires private-source metadata. Private component
license tokens also require the private overall declaration; near-miss composite or differently
cased private tokens are rejected. CC0 components can exist inside a private world without
grading its overall rights upward. These cross-field rules are enforced by the runtime loader;
the generated JSON Schema describes field structure and does not independently implement every
semantic coupling. CLI `pack`/`validate` display declared rights and never certify redistribution
permission. The recording-derived compiler accepts only CC0 sources and consent and cannot
convert a private source grant into a CC0 compiled world. Local audit authorization is not a
publication grant or a legal sufficiency judgment.

A frame has id, deleted flag and name. A step has frameId, label, integer x/y/width/height and a
licensed fontFamily. The label maps to real bound text in the adapter. An arrow has frameId and
nullable `from`/`to`; every non-null endpoint refers to a live step. A null end models a loose
arrow observed in the real engine. An arrow with both ends null remains a live loose arrow unless
explicitly disconnected. A disconnected arrow is a tombstone. App ids and derived geometry are
adapter details. Tombstone ids may never be reassigned to another semantic object (PADR-0004).

The confirmed pilot actions are `add_step`, `rename_step`, `move_step`, `connect`, `reconnect_end`,
`disconnect`, `delete_step`. `disconnect(id)` removes the whole arrow relation. `delete_step(id)`
tombstones the step and detaches incident endpoints; keeping loose arrows is a valid transition
but can violate a task goal. Every required effect must have a confirmed rule; unknown actions or
uncovered effects return `unmodeled` atomically. Preconditions do not mutate state.

Predicates describe the final result, not an action path. PADR-0013 defines their closed AST:
true/false, all/any/not, scalar comparisons, exists/every/count over live objects, literal values
and allowlisted fields of lexically scoped variables. No regex, code, dynamic imports, recursion
operator or external lookup exists. Inputs have depth/node limits before recursive validation;
evaluation consumes fuel for AST nodes and object visits. Budget exhaustion is
`checker_fuel_exhausted`, never an ordinary false result or a pass.

Content bounds: predicate depth 32 / 4096 nodes; JSON depth 64 / 250,000 nodes;
10,000 total objects and actions; 128 rules and tasks; 256 finite variants; 32 hints per task.
Undo retains at most 1000 snapshots / 64 MiB and rebuilds older states by replay.

Variant substitution replaces declared `{{key}}` text tokens (and `{{insertPosition}}`) in
localized strings, frame names, step labels and predicate literals. It never evaluates a template as code.
The flow world varies process texts, insertion position and layout; freeze tests establish
solvability for every finite case. The witness logs stay in the test tree.

**Never in a world package:** reference solutions, alternative-solution and near-miss fixtures,
solvability witnesses, held-out tasks, hypotheses and open model questions. These fields are
rejected throughout all JSON files before runtime use. Solutions and fixtures live in `.pncheck`
or tests; H1 exists only in the checker source. Full conformance states also stay outside the
world, since they can reveal a solution. A rule carries only the run reference and hash.
Hashes establish consistency, not authenticity or an author's honesty about evidence.

The independent checker consumes `.pncheck` through the same safe archive reader, with its own
strict `practonaut.checker/1` content schema and a matching world identity. It evaluates exports
with an independent native parser, or validated serialized session end states. Each verdict
reports `scope: "end-state-only"`: it does not attest who acted, the truth of a supplied log,
or human learning. Empty, unchanged-start and wrong-artifact counter-probes must reject before
any verdict; otherwise the checker reports `counterprobe_failed`. Hidden cases and fixtures do
not enter practice feedback or the `.pnworld` archive.

The core shares one 10^6-step budget across all preconditions of one transition; budget
exhaustion rejects the transition atomically with `checker_fuel_exhausted`.

## 2a. World content v2 (normative, additive)

An entry with `schema: "practonaut.world/2"` is validated by its own strict schema
(`WorldSchemaV2`, generated as `schemas/world.v2.schema.json`); a world/1 entry is never read as
world/2 and loads exactly as before (its schema file, states and hashes are unchanged). A world/1
entry that uses world/2 vocabulary (a `near` predicate, a step `shape`) is rejected.

Optional parts receive explicit defaults when the world is validated, so a validated world
validates to itself: `app.fontFamilies` `[3]`, `excludedAttributes`, `units` and `rules` empty,
`objectTypes` all three, `initialState` empty, `actions` all thirteen built-in actions, `variants`
one case `default`, and `provenance` needs only `authors` (an omitted `provenance.appVersion` is the
world's `app.versionRange`).

| Object | world/2 fields |
|---|---|
| frame | `id`, `deleted`, `name` (may be empty: an unnamed Excalidraw frame) |
| step | `frameId` (nullable), `label`, integer `x`, `y`, `width`, `height`, `shape` (`rectangle`, `ellipse`, `diamond`), `groupId` (nullable), `stroke` (`black`, `red`, `green`, `blue`, `orange`), `fill` (`none`, `red`, `green`, `blue`, `yellow`) |
| arrow | `frameId` (nullable), `from`, `to` (nullable live step ids) |

A step has no font: fonts are presentation and the adapter writes the licensed Cascadia. The
palette names map to Excalidraw 0.18.1's first picker row. A state must not mix world/1 and
world/2 steps. An arrow's frame is derived from its ends: the common frame of its attached ends,
none when they differ; an arrow with both ends loose keeps its frame. Every world/2 transition
re-derives arrow frames, and validation rejects a state whose arrow frame disagrees.

**Actions.** The world/1 seven plus `resize_step` (`id`, `width`, `height`), `set_style` (`id`,
`shape`, `stroke`, `fill`), `rename_frame` (`id`, `name`), `group_steps` (`id`, `with`: `id`
joins the group of `with`; a new group is created when `with` has none), `ungroup` (`id`: the
whole group of the step dissolves) and `set_frame` (`id`, `frameId` or `null`). In world/2,
`add_step` takes `frameId` (nullable), `label`, `x`, `y`, `width`, `height` and `shape` and creates
a black, unfilled, ungrouped step; `connect` takes `from` and `to`. Parameter types include
`nullable-id` and `enum` (with `values`). A world may restate an action's parameters only with
the same keys and types and tighter bounds or fewer enum values; omitted parameters use the
built-in contract. **Rules are optional:** an action without any rule has its built-in core
semantics; once a world states a rule for an action, its effects must cover the action exactly as
in world/1 (`unmodeled` otherwise). New effects: `set_size`, `set_style`, `set_frame_name`,
`set_group`, `clear_group`, `set_frame`. The independent checker replays world/2 histories with
its own implementation; the adapter's real-engine conformance covers every action
(`tests/adapter/conformance-v2.test.ts`).

**Predicates.** In addition to world/1: `{"op":"near","left","right","tolerance"}` (integers,
`|left − right| ≤ tolerance`), `{"op":"contains"|"startsWith","left","right"}` (exact,
case-sensitive strings) and the fields `shape`, `groupId`, `stroke`, `fill`. Wrong operand types
are `checker_invalid`, never `false`.

**Layout clauses** ([PADR-0047](adr/0047-bounded-spatial-predicates.md)). Six operators judge
positions, on boxes and on straight lines between step centres, in exact integers:

| Operator | Fields | Holds when |
|---|---|---|
| `noOverlap` | `select` (steps, count ≥ 2), `gap` 0–10,000 | every two selected boxes are at least `gap` apart horizontally or vertically (with gap 0 edges and corners may touch) |
| `aligned` | `select` (steps, ≥ 2), `axis` `x`/`y`, `anchor` `start`/`center`/`end`, `tolerance` 0–10,000 | the anchors (left or top edge, centre, right or bottom edge) differ by at most `tolerance` |
| `evenlySpaced` | `select` (steps, ≥ 3), `axis`, `tolerance` | ordered by their start on the axis, no two projections overlap (no gap is negative) and the largest gap minus the smallest is at most `tolerance`; direction is not judged |
| `within` | `select` (steps, ≥ 1), `x`, `y` (±1,000,000), `width`, `height` (1–2,000,000; `x + width`, `y + height` ≤ 1,000,000) | every box lies in the closed rectangle |
| `arrowsNoCrossing` | `select` (arrows, ≥ 2) | every selected arrow is attached at both ends and no two judged segments meet: arrows between the same two steps are not compared; arrows sharing one step may meet only at its centre; a self-loop is the point at its step's centre |
| `arrowsClearOfSteps` | `select` (arrows, ≥ 1), `steps` (steps, ≥ 1) | every selected arrow is attached at both ends and no judged segment touches the closed box of a selected step other than its own ends (grazing a corner counts) |

A step's **box** is (`x`, `y`) to (`x + width`, `y + height`) for every shape; an arrow's **judged
segment** runs from the centre of its `from` step to the centre of its `to` step, however it is drawn.
A **selection** is `{ "type", "as", "where", "count" }` with `count` at most 256, and `where` exactly
one of three shapes: `{"op":"true"}` (every live object of the type), `as.frameId = null` (outside
every frame), or the from-scenes frame clause `exists frame f: f.id = as.frameId and f.name = "<name>"`
(in a live frame with that name, whatever its id). A selection that holds another number of objects
than `count` makes the clause false. A layout clause may stand only as the goal, as a direct argument
of a top-level `all` goal, or as an error class's `when` (directly or under one `not`); anywhere else,
in action or rule preconditions, world/1, another selection shape or a count above 256 is refused with
`E_WORLD_INVALID`. A task with `within` needs `layoutOffset` (0, 0) in every variant case; a task with
any layout clause needs every live step of its start inside ±1,000,000. Every box a layout clause reads
must lie within ±1,000,000 (`LAYOUT_LIMITS`, `src/world/limits.ts`); a box outside that range is
`checker_invalid`, never a verdict. Each clause is charged by formula before it reads any position:
one step for the node, N per selection (2N for a frame name; N counts every object, tombstones
included), the count, and `noOverlap` and `arrowsNoCrossing` k(k−1)/2 pair tests, `arrowsClearOfSteps`
kₐ·kₛ, `evenlySpaced` k·⌈log₂ k⌉ (0 for k ≤ 2) plus k − 1. Hosts, the Player and MCP narrate each clause
(formal text and sentence) and carry its public overlay `layout` beside the condition.

**Variants** carry `params` (text or integer `{{tokens}}`) instead of `insertPosition`; labels and
params substitute in labels, frame names, localized texts and literals. **Tasks** may carry
`conditionTexts`, one EN/DE sentence per top-level goal clause (exactly as many as clauses), which
the Player shows instead of the formal narration.

**Task set.** A world may name the task set it belongs to: `taskSet: { "id", "version" }`, with the
patterns of the world's own `id` and `version`, optional and without a default
([PADR-0044](adr/0044-bench-report-v3.md) decision 3). A seed selects a variant case by the first 32
bits of the SHA-256 of the canonical JSON `{"seed": <seed>, "world": {"id", "version"}}`, modulo the
number of cases; that `id` and `version` are the task set's when the world names one, otherwise the
world's own. A world without the key therefore selects, hashes and validates exactly as before. Two
worlds that hold the same tasks for two applications name the same task set (for example the first
world's own id and version) and list the same variant cases in the same order: the same seeds then
select the same cases on both, so a bench of each covers the same instances and `practonaut compare`
pairs them by task identity.

**Generated tasks.** A task that a generator materialised carries
`generatedBy: { "id", "version", "seed", "parameters" }`: the generator id (lowercase letters,
digits, `-`), its semantic version, the integer seed, and up to 16 named parameters (integer or a
display string of at most 64 characters, for example a difficulty level; default `{}`). It is world
content: covered by the world's content hash and recorded in bench reports, but never part of the
Player's or an agent's view ([PADR-0036](adr/0036-bench-report-v2-any-world-stored-world.md):
generated instances are stored as concrete worlds, not regenerated from a seed).

**Task limits.** A task may carry `limits: { "actions": 1–1000, "checks": 0–1000 }` (at least one of
the two; [PADR-0040](adr/0040-challenge-tier-generated-families-and-gate.md)). They are public: the
host enforces them for every attempt, for the Player and agents alike, and shows what is used. An
attempt may make at most `actions` accepted changes — every accepted `act`, `undo` and `reset` (and
editor change) counts; a refused request does not — and evaluate at most `checks` checks. A request
beyond a limit is refused with `action_budget_exhausted` or `check_budget_exhausted` and changes
nothing. Reset and undo give nothing back; a new variant of the same task counts like a reset and
keeps the counts; only another task starts a new attempt. A session
started with `--checks <n>` uses the smaller of `n` and the task's own check limit. While a check
limit applies, the task's error classes are shown only as part of a check's result (they are
evaluated against the board like the goal). The checker judges the end state only; `report
--verify` additionally counts a bench run's accepted changes and checks from the runner's host-side
log and refuses a run beyond its task's limits.

**Exports.** For world/2 the checker reads any Excalidraw drawing with a tolerant parser
(`src/checker/scene.ts`): rectangles, ellipses and diamonds are steps (bound text is the label,
absent text an empty label), any font, rotation, opacity and stroke style are ignored, colours map
to the nearest palette name, the outermost group is the group, frames and magic frames are frames,
an arrow's ends follow its bindings (a single head at the start reverses it). Free text, arrow
labels, lines, images and other kinds are listed as `unmodeled` and ignored, never fatal; malformed
input, duplicate ids and invisible format characters in text remain `artifact_invalid`. A step's box
is rounded by its **edges** (PADR-0047 decision 10): left = round(min(x, x + width)), right =
round(max(x, x + width)), likewise vertically, half up; a negative size keeps the box where it is drawn,
and an edge two boxes share rounds to one integer, so touching boxes stay touching. A box whose edges
round to one integer (narrower than about 1 px) is widened to 1 px rightwards or downwards and may then
overlap a neighbour it only touched; such collapsed steps and rotated ones (an angle other than 0, which
the judged state ignores) are listed in the reader's report for the reading rules of a layout unit,
which refuse them.

**Tasks from two scenes.** `practonaut tasks from-scenes <start> <goal> --out <dir>` (and the
Player's Create workspace) derives a world/2 task: the goal is the exact multiset of step
signatures (label, shape, colours, frame, grouped), arrows by their end labels and frames by name,
plus groups, and optionally the left-to-right order (`--layout relative`, `lt`) and aligned rows
and columns (`--align`, `near`). It writes the world source to `<dir>/world/` and the reference
solution, near misses and one seed per variant to `<dir>/oracle.json` beside it (never inside a
world package). Nothing is written unless the goal scene passes the independent checker, the
start scene fails, the reference solution passes and every near miss fails, for every variant.
The bundled library `tasks/excalidraw/` is built this way (`npm run library:write`).

## 3. Recording-derived compilation

`practonaut.author/1` is a local author project, never a world-package entry. It retains proposed
and refuted hypotheses, open questions, observations, tasks, variant solutions and independent
checker fixtures. `practonaut compile <project> --out <world.pnworld>` rereads source recordings,
validates replay and digests, and requires a fresh confirming observation for each admitted
rule. CC0 rights, author identity, consent and pinned app/adapter provenance are mandatory.
Free text has no confirmation authority. A compilation error has a named code such as
`provenance_missing`, `rights_missing`, `evidence_disagrees` or `variant_unsolved`.

Compiled provenance includes optional `coalescingVersion`, mandatory for the recording compiler
(`excalidraw-gesture-v1`). Evidence references pin canonical gesture digests; recording bytes
and author names stay outside the executable package except declared authors and source refs.
Every public and held-out task is checked for every finite variant using its supplied witness
and the independent checker. The latter uses independently authored alternative and near-miss
states. Open questions and unconfirmed rules remain in the project. Their presence cannot expand
the runtime action set. The separate `.pncheck` contains held-out tasks and checker fixtures;
neither it nor authoring/provider code enters the Practice Player.

Local author/1 additionally accepts optional `repair` intent (`practonaut.repair-intent/1`).
It selects the bounded prepared three-step repair, EN/DE title, visible step roles, finite cases
and explicit review of prepared result examples. Legacy projects without it remain valid.
These fields define author task intent and prepared recipes, never executable behavioural
evidence. Compilation of unreviewed examples is `repair_examples_unreviewed`. The additional
readiness view explains actual missing prerequisites but does not replace compiler validation.
No world/package major changes and no rewriting of recordings accompany this extension.

## Semantic object identities (PADR-0019)

State object IDs and keys, frame/arrow references, repair step identities and variant label keys accept 1–64 ASCII letters, digits, underscores or hyphens, including a leading underscore or hyphen generated by the pinned native editor. The exact reserved identities `__proto__`, `prototype`, and `constructor` remain invalid. Key/ID equality, plain JSON, live references and all bounds still apply. Action values of type `id` address this object domain. General world/task/rule/recording/project IDs, predicate binders, parameter names, package paths and store names retain their existing contracts. Raw text IDs containing colon/dot remain bookkeeping IDs and are not semantic object IDs. Existing valid v1 data requires no rewrite. Newly created v1 packages containing the expanded object IDs require the updated reader; older readers can reject them. Original recordings and hashes remain unchanged.

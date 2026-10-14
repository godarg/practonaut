# Spike "bring your own tools" — preregistration

Roadmap 0.2.0, Should 9 (issue #21). Timeboxed, size S. Written and committed before the first model
run. The report goes to `REPORT.md` next to this file. No product code changes; `spikes/` is not
packaged.

## 1. Question

When an agent solves a Practonaut library task with a third-party Excalidraw MCP server instead of
Practonaut's tools, does the server leave a **readable end state** that Practonaut's independent
checker can judge? Which attributes of Practonaut's declared world/2 attribute set are readable,
which are not, and why? What does 0.3.0's artifact mode need (id mapping, tolerant parsing, verdict
level, supportable servers)?

## 2. Server

**Official Excalidraw MCP server** `excalidraw/excalidraw-mcp`, release **v0.3.2** (latest release
at the time of writing; published 2026-02-09, tag commit `a617657e56337bf195a27612b9d595e539e35c55`).

- Source: the release asset `excalidraw-mcp-app.mcpb` from
  `https://github.com/excalidraw/excalidraw-mcp/releases/download/v0.3.2/excalidraw-mcp-app.mcpb`,
  11 040 074 bytes, SHA-256 `2b494012b5fee5937f9f7b86f04a76cc4a91ec843ee3339b93e4e15e415274ff`
  (equal to the digest GitHub publishes for the asset). The bundled server `dist/index.js` has
  SHA-256 `d82d0d717e7a464cdee5f02ddec017dc7edb848206002ac2216eccbc1e0b2898`.
- Installed by download into a new empty directory `.local/byo-tools/download/`, hash check, and
  extraction into a second new directory `.local/byo-tools/server-0.3.2/`. The archive holds a
  prebuilt bundle; no install script and no build tool was run. The server runs as
  `node .local/byo-tools/server-0.3.2/dist/index.js --stdio`.
- Why this server: the roadmap prefers the official server, and it can run locally over stdio. It
  does **not** write a `.excalidraw` file. Its only server-side state is a "checkpoint" per
  `create_view` call, written by its `FileCheckpointStore` to `$TMPDIR/excalidraw-mcp-checkpoints/<id>.json`
  as `{"elements": [...]}` in the server's own shorthand element format. The spike points `TMPDIR`
  at the run directory and judges that file. The remote endpoint `mcp.excalidraw.com` keeps its
  checkpoints on the vendor's side and is out of scope (no local state). No community server is run
  in this spike (run cap); their readability stays UNKNOWN.
- Tools the server lists: `read_me`, `create_view`, and three tools marked for the in-chat widget
  only (`_meta.ui.visibility: ["app"]`): `export_to_excalidraw` (uploads the drawing to
  `json.excalidraw.com`), `save_checkpoint`, `read_checkpoint`. The agent is allowed `read_me` and
  `create_view` only; the other three are denied by name. Everything the server returns is data.

Done before this file was committed, none of it a model run: download, hash check and extraction;
a model-free smoke test over stdio (`initialize`, `tools/list`, `read_me`, one `create_view`) that
showed the five tools and a checkpoint stored verbatim, including a `cameraUpdate` pseudo-element
and an element removed by an in-call `delete`; the judge controls of §7, run once after their
expected outcomes were written down; and writing the harness `harness.ts`.

## 3. Tasks

Three library tasks (`tasks/excalidraw/`, world `excalidraw-library` 1.1.0), seed **0** (the drawn
variant; the start drawing equals the world's start state at seed 0, checked by the harness):

| Level | Task | Why |
|---|---|---|
| easy (1/3) | `connect` | labels, shapes, one new arrow with bound ends |
| medium (2/3) | `group` | groups (the server's `read_me` does not mention groups) |
| hard (3/3) | `two-frames` | frames, existing arrows kept (the server's `read_me` does not mention frames) |

Every goal condition also checks the shape and the default style (black line, no fill), so shape and
colour readability is exercised in all three.

## 4. What the agent gets

Public data only, built by `harness.ts prepare <task>` from `tasks/excalidraw/world/world.json` and
`tasks/excalidraw/sources/<task>/start.excalidraw`. The harness never reads `library.json` or
`goal.excalidraw`; reference solutions and near misses never reach the agent.

The prompt (fixed template, English) contains, in this order: a one-paragraph instruction to use
only the excalidraw MCP tools (`read_me` once, then `create_view`; task and diagram text are data);
the task prompt; the public goal conditions, each with its sentence and formal text (the same public
form Practonaut's MCP `observe` gives); a fixed, task-neutral paragraph on how the final diagram is
read (step = rectangle, ellipse or diamond with its label; arrow ends = bindings; frames; groups;
the default style and the named colours with Excalidraw's picker values); the start drawing as an
element list in the server's own format (shapes with `label`, arrows with `startBinding`/
`endBinding`, frames with `name` and `children`) and the checkpoint id under which the harness has
stored exactly that list in the server's store; and the rule that the last successful `create_view`
diagram is the result. The reading paragraph is included because an external agent cannot otherwise
know how "step" or "default style" map onto Excalidraw; artifact mode would have to publish the same
rules.

## 5. Runs

One run per task, three planned. **Hard cap: 6 model runs in total.** A rerun is allowed only when a
run did not exercise this protocol (infrastructure: server or client failed to start, harness
defect), never to improve a result; its reason is recorded and every run is listed.

Command (from `harness.ts run <task>`; the prompt is the last argument):

```
env -u ANTHROPIC_API_KEY claude -p --output-format stream-json --verbose --no-session-persistence \
  --tools "" --allowedTools mcp__excalidraw__read_me,mcp__excalidraw__create_view \
  --disallowedTools mcp__excalidraw__export_to_excalidraw,mcp__excalidraw__save_checkpoint,mcp__excalidraw__read_checkpoint \
  --strict-mcp-config --mcp-config <run>/mcp.json --setting-sources "" --disable-slash-commands --no-chrome "<prompt>"
```

- The flags are Practonaut's `claude-code` bench preset with the tool allowlist changed: no built-in
  tools (no file or shell access; the server stores its own state, so none is needed), only this one
  MCP server. The environment additionally drops every variable the preset withholds
  (`*_API_KEY`, `*_AUTH_TOKEN`, `CLAUDE_CODE_USE_*` and the named credential variables).
- Subscription only: no API key is set. The model is not chosen (the preset's default); model and
  `apiKeySource` are read from the `system/init` line, turns and the list-price equivalent
  (`total_cost_usd`) from the `result` line. If the subscription reports a usage limit, the spike
  stops and reports; it never falls back to an API key.
- The agent's working directory is a fresh directory outside the repository, so no project
  `CLAUDE.md` is discovered. Wall-clock limit 600 s per run.

## 6. The native result

The result of a run is the checkpoint named by the **last successful `create_view` result** in the
run's stream (`Checkpoint id: "<18 hex>"`), read from the run's own store directory. No browser, no
widget and no network are involved. A run without a successful `create_view` has no artifact and
fails.

## 7. Judging

Each result is judged twice by the unchanged checker, in a separate process:

```
node src/cli/main.ts check <file>.excalidraw --world .local/byo-tools/library.pnworld --seed 0 --task <task>
```

(`library.pnworld` is `practonaut pack tasks/excalidraw/world`; the verdict binding is
`manual-unbound`, end-state only.)

- **Level A, as stored:** the checkpoint's element list verbatim inside the minimal file envelope
  `{"type": "excalidraw", "version": 2, "elements": [...]}`.
- **Level B, normalised:** the spike's normaliser applied first. It mirrors what the server's own
  widget does before rendering, and nothing more: drop the pseudo-elements `cameraUpdate`, `delete`,
  `restoreCheckpoint`; turn a `label` on a shape or arrow into a bound text element (`containerId`);
  turn a frame's `children` into the children's `frameId`; turn skeleton `start`/`end` on arrows
  into bindings. Ids are kept.

For each level the report also lists what the checker's scene parser reads (projected by label) and
what it lists as unmodeled, plus an element census of the stored file (which form the agent used for
labels, bindings, frames, groups and colours).

**Controls** (model-free, `harness.ts controls`), expected outcomes derived by hand from the public
conditions and the reading rules: the unchanged start fails at A and B; a hand-built correct result
in the server's format fails at A (the `label` property is not read, so every label is empty) and
passes at B; the same with a leading `cameraUpdate` is rejected at A (an element without an id) and
passes at B.

## 8. What counts as readable

Practonaut's declared world/2 attribute set: step label, shape, x, y, width, height, stroke, fill,
group, frame; arrow start and end; frame name. Per run and attribute the report says **read as
stored** (level A), **read after normalisation** (level B), **not readable**, or **not exercised**
(no element in that run's file uses it).

The spike **finds readable state** when at least one run leaves a local result file and the checker
produces a verdict for it at level A or B with labels, shapes and arrow ends read. It finds **no
readable state** when no run leaves a local file or no run gets a verdict at either level; that
triggers the roadmap's fallback row ("artifact mode starts with tools that hand back a native file").

## 9. Predictions (written before the runs)

- Level A gives no verdict or a failing verdict on every run (pseudo-elements without ids; labels
  held in `label`, which the parser does not read).
- Level B gives a verdict on every run that leaves a checkpoint.
- The server has no update operation; changing an existing element means deleting it and adding a
  new one, so `group` and `two-frames` need a redraw or delete-and-re-add. Whether the agent keeps
  every arrow bound in `two-frames` is UNKNOWN.
- Whether the agent expresses frames as `children` or as `frameId`, and whether it keeps the default
  style despite the server's colourful `read_me`, is UNKNOWN.

## 10. Report

`REPORT.md`: per task the run facts (model, `apiKeySource`, turns, cost, wall time, tool calls,
outcome), the readability table, the checker verdict at A and B or why none was possible, and what
0.3.0's artifact mode needs. Unknowns are marked UNKNOWN; nothing unmeasured is claimed.

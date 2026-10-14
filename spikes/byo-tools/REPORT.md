# Spike "bring your own tools" — report

Roadmap 0.2.0, Should 9 (issue #21). Protocol: [PREREGISTRATION.md](PREREGISTRATION.md), committed before the first model run. Harness: `harness.ts`. Run date 2026-10-14.

## Result in one paragraph

**Readable state found; the roadmap's fallback row is not triggered.** With the official Excalidraw MCP server v0.3.2 running locally, all three runs left their end state as a local JSON file (the server's checkpoint), and Practonaut's unchanged checker judged all three after a small, documented normalisation (level B): **3 of 3 passed**. The same checker reading the stored files as they are (level A) gave **no verdict in 3 of 3**: each file holds a `cameraUpdate` pseudo-element without an id, and the parser rejects the whole file. Once that pseudo-element is dropped, every attribute the three tasks use is read as stored **except the step labels**, which the server keeps in a `label` property instead of a bound text element. Artifact mode therefore needs a tolerant reading of the server's element format, not id mapping, for these tasks. One run per task, one model: this shows that the end state can be read, not how capable agents are.

## Runs

Three model runs (cap 6), all through the subscription: `apiKeySource` was `none` in every `system/init` line, every `rate_limit_event` said `allowed` with no overage, and no API key was set. Command and flags as preregistered (§5). No rerun was needed.

| # | Task | Model | apiKeySource | Turns | Cost (list-price equivalent) | Wall time | Tool calls | Level A | Level B |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `connect` (1/3) | claude-opus-5-5 | none | 3 | $0.1562 | 15.8 s | `read_me`, `create_view` | no verdict | **pass** |
| 2 | `group` (2/3) | claude-opus-5-5 | none | 3 | $0.1570 | 11.7 s | `read_me`, `create_view` | no verdict | **pass** |
| 3 | `two-frames` (3/3) | claude-opus-5-5 | none | 3 | $0.1808 | 18.6 s | `read_me`, `create_view` | no verdict | **pass** |
| | **Total** | | | | **$0.4940** | | | 0 / 3 | 3 / 3 |

Claude Code 2.1.299; the agent saw exactly the two allowed tools (`init.tools`); the MCP server connected in every run. "No verdict" means `practonaut check` exited with `artifact_invalid`; the parser's reason was `scene element <n> has no usable id` (the `cameraUpdate` entry) in all three. Each level-B verdict is `end-state-only`, binding `manual-unbound`, origin `unattested`, with the three counter-probes (empty, unchanged start, wrong artifact) rejected first.

What each agent did (the stored results are in `results/`):

- **Run 1, `connect`:** one `create_view` call with `restoreCheckpoint` on the seeded start, a `cameraUpdate` and one arrow `arr1` with `startBinding` on `a` and `endBinding` on `b`.
- **Run 2, `group`:** redrew the whole diagram without restoring, with **new ids** `a2`–`d2`, and grouped three rectangles with Excalidraw's native `groupIds: ["g1"]` (a field the server's `read_me` does not mention; the agent said so).
- **Run 3, `two-frames`:** redrew the whole diagram with the **original ids**, moved the rectangles into the frames' area, and recorded membership twice: `frameId` on each rectangle and `children` on each frame. All three arrows kept both bindings.

No run used a colour, `delete`, a free text element or an arrow label.

## Readability against the declared attribute set

Per attribute: the form the agents used, and whether the unchanged checker parser reads it at level A (as stored), after dropping only the pseudo-elements (P1, a post-hoc diagnostic on the same files, not preregistered, no model run), and at level B.

| Attribute | Stored form in the runs | Level A | P1 (post-hoc) | Level B | Exercised by |
|---|---|---|---|---|---|
| step label | `label: {"text": …}` on the shape | not readable (file rejected) | **not readable** (labels read as empty) | read | runs 1–3 |
| step shape | element `type` | not readable (file rejected) | read | read | runs 1–3, rectangles only |
| x, y, width, height | numbers | not readable (file rejected) | read | read | runs 1–3 (no goal here uses them) |
| stroke colour | absent (server default `#1e1e1e`) | not readable (file rejected) | read as black | read as black | default only |
| fill colour | absent (`transparent`) | not readable (file rejected) | read as none | read as none | default only |
| group | `groupIds` | not readable (file rejected) | read | read | run 2 |
| frame membership | `frameId` and frame `children` | not readable (file rejected) | read (from `frameId`) | read | run 3 |
| frame name | frame `name` | not readable (file rejected) | read | read | run 3 |
| arrow start and end | `startBinding` / `endBinding` with `elementId` | not readable (file rejected) | read | read | runs 1 and 3 |

A second post-hoc diagnostic (P3: level B with every `frameId` removed, frames only from `children`) also passed `two-frames`. Ellipse, diamond, non-default colours, deletions and arrow labels were **not exercised**.

Colours (code behaviour, measured without a model): the parser maps any colour to the nearest of its named colours. On the palette the server's `read_me` recommends, grey `#757575` becomes **green**, purple `#8b5cf6` and cyan `#06b6d4` become blue, pink `#ec4899` becomes red, light orange `#ffd8a8` becomes yellow. No run used colours, so no verdict was affected.

## Why level A fails

1. **Pseudo-elements are stored.** The server stores the agent's element list verbatim, removing `delete` and `restoreCheckpoint` but keeping `cameraUpdate`, which has no id; its `read_me` tells the agent to always start with one. All three agents did. The parser rejects a scene with an element without an id.
2. **Labels live in a property.** The server's format puts a shape's text in `label`; Excalidraw files and the checker use a separate text element bound by `containerId`. The server's widget converts one into the other before rendering; the stored file never contains the bound text.
3. **No file envelope.** The stored file is `{"elements": [...]}`; adding `{"type": "excalidraw", ...}` is lossless and both levels need it.

## Other findings

- **The server does not write a `.excalidraw` file.** Its only local state is one checkpoint per `create_view` call in `$TMPDIR/excalidraw-mcp-checkpoints/`; a native file exists only in the in-chat widget, whose export uploads to `json.excalidraw.com`. Run headless, the result is the checkpoint named by the last successful `create_view`.
- **The client decides what the agent sees.** Claude Code passed the server's `structuredContent` (`{"checkpointId": "…"}`) to the model instead of its text reply in all three runs, so the server's restore and delete instructions never reached the agent. The harness first missed the checkpoint id for the same reason (fixed, facts re-derived from the saved stream; no rerun). This is why Practonaut's own MCP replies carry the same complete JSON in both parts ([PADR-0038](../../docs/adr/0038-lean-mcp-replies.md)).
- **No update operation, so identity is the agent's choice.** Run 2 replaced every id, run 3 kept them by redrawing with the same ids, run 1 appended. The library goals refer to steps by label, so no verdict was affected.
- **Deletion is not reliably stored** (smoke test, no model): an element removed by a `delete` entry in the same `create_view` call stays in the stored checkpoint at full opacity, while the widget draws it nearly invisible. Not exercised by a run.
- **The tool list includes widget-only tools** (`export_to_excalidraw`, which uploads, `save_checkpoint`, `read_checkpoint`), marked only by `_meta.ui.visibility`. The spike denied them by name; whether Claude Code hides them by itself is UNKNOWN. Artifact mode should give each third-party server its own temporary directory and deny its widget-only tools.
- **The remote endpoint `mcp.excalidraw.com`** keeps checkpoints on the vendor's side (code reading) and leaves no local state.

## What 0.3.0's artifact mode needs

1. **Tolerant reading of the server's element format, in the checker**, as named rules with fixtures, independent of the app engine:
   - skip the known pseudo-elements (`cameraUpdate`, `delete`, `restoreCheckpoint`) and list them as unmodeled instead of rejecting the file;
   - read `label.text` on a shape as its label (on an arrow, an unmodeled arrow label);
   - accept frame `children` as well as `frameId`;
   - accept skeleton `start`/`end` as bindings;
   - accept `{"elements": [...]}` without the envelope.

   The spike's `normalize` in `harness.ts` is a prototype. Whether it matches Excalidraw's own `convertToExcalidrawElements` is **UNKNOWN**. The adapter's `importArtifact` accepts only its own strict subset, so it cannot serve as that cross-check without new code.
2. **A strict colour mode:** an off-palette colour is reported as unmodeled, not snapped to the nearest named colour.
3. **A result locator per server:** here, `structuredContent.checkpointId` of the last successful `create_view`, in a store directory the run owns (`TMPDIR` per run). Record server name, version and archive SHA-256 with the verdict.
4. **Start-file delivery per server:** this server cannot open a file. The spike stored the start drawing as a checkpoint and gave the same list in the prompt.
5. **Published reading rules for the agent** (what a step, arrow end, frame, group and the default style are in Excalidraw terms). All three passes had these rules in the prompt.
6. **Id mapping: not needed for the library tasks.** It is needed only for goals about the identity of start objects. Either match by label, shape and position with a declared tolerance, or mark such families as not supported in artifact mode.
7. **The verdict level** "artifact-judged, end-state only, no Practonaut history", plus the source format and rules version. Today's closest output is `manual-unbound`, origin `unattested`, with `--seed` and `--task` required.
8. **Isolation:** no file or shell tools for the agent; widget-only tools denied; the server in its own temporary directory; the agent's working directory outside any project with agent instruction files.

### Which servers are supportable

| Server | Status |
|---|---|
| `excalidraw/excalidraw-mcp` v0.3.2, local stdio (`.mcpb`) | **supportable** with rules 1–4 (3 of 3 judged after normalisation, 0 of 3 as stored) |
| `mcp.excalidraw.com` (remote) | not supportable: no local state (code reading) |
| Community Excalidraw servers (for example `yctimlin/mcp_excalidraw`) | UNKNOWN, not run |
| draw.io MCP (`jgraph/drawio-mcp`) | UNKNOWN here; needs the draw.io spike's `.drawio` parser |

## Limits and unknowns

- One run per task and one model (Opus 5.5, the subscription default); these tasks are easy for it. Pass rates, other models and other clients are UNKNOWN.
- Level B uses the spike's normaliser, not Excalidraw's own conversion.
- Behaviour in an MCP Apps client, where a person can edit and the widget saves converted elements into the same checkpoint, is UNKNOWN.
- The judge controls matched their hand-derived expectations, 12 of 12:
  - the unchanged start fails at A and B;
  - a hand-built result fails at A and passes at B;
  - with a `cameraUpdate`, the hand-built result is rejected at A and passes at B.

  They were run before the preregistration was committed, as it states.

## Reproduce

Install the server as in the preregistration (§2), then from the repository root:
- `node spikes/byo-tools/harness.ts controls`
- `… run <task>` (a model run, counted toward a cap of six in `.local/byo-tools/runs/ledger.jsonl`)
- `… judge .local/byo-tools/runs/<n>-<task>`
- `… diagnose …` for P1–P3.

To judge a stored result by hand, wrap it as `{"type": "excalidraw", "version": 2, "elements": [...]}` and run `node src/cli/main.ts check <file> --world <library.pnworld> --seed 0 --task <task>`.

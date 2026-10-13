# Roadmap

Practonaut is a local practice gym for AI agents on real apps: demonstrate a task once, let any MCP
agent practise it, and get an independent, reproducible score — one `npx` command, no VM, no
Docker. This page says what exists and where it could go. It is a direction, not a promise.

## 0.1.0 (first public version)

- Practice in the browser on Excalidraw 0.18.1, with a real, pinned engine mirroring every step.
- A library of 16 Excalidraw tasks (EN/DE, three variants each, reference solutions, near misses).
- Make a task from two drawings or from a recorded demonstration.
- Connect any MCP agent with one line (`practonaut mcp --task …`); human and agent share one session.
- `practonaut bench`: repeatable agent runs scored by a separate checker; pass@1, pass^k, steps;
  JSON report and static HTML.
- macOS, Linux and Windows; no Docker, no VM, no telemetry.

## Ideas for next versions

Contributions are welcome; open an issue to discuss before large changes.

- **A second application.** The adapter contract is written for more than one app, the code is
  not yet ([adapter guide](adapter-guide.md)). Candidates need an official scriptable interface and
  a local, pinned, offline runtime.
- **More tasks** for the Excalidraw library, especially multi-step ones.
- **Sealed scoring.** Today an agent with file or shell tools could read reference solutions on
  disk. Running the checker and the task data under a separate OS user or container would make
  scores of such agents meaningful.
- **More agent presets** for `bench`, once a client can be limited to MCP tools only.
- **Layout constraints** in the world format (alignment, anchors, offsets) so authors can express
  layout rules without adapter code.
- **Signed worlds** so packages from others can be authenticated, not only integrity-checked.
- **A human study.** Whether practising here improves a person's skill in the real tool is not
  known; a preregistered study would answer it
  ([research notes](research/learning-and-evaluation.md)).
- **Accessibility checks by people** with screen readers and 200 % zoom
  ([manual checks](design/manual-player-checks.md)).

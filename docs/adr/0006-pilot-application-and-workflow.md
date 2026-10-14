# PADR-0006 — Pilot application and first workflow

> **Decision 4 (Penpot as the second adapter) is proposed to be superseded by
> [PADR-0033](0033-product-direction-measurement-you-can-act-on.md):** draw.io behind a preregistered
> spike, because Penpot installs officially only with containers. Until PADR-0033 is accepted,
> decision 4 stands.

> **Maintainer confirmation 2026-10-03:** "Pilot Excalidraw bestätigt" — after being shown the
> disagreement of the external model reviews (Grok, Gemini preferred Penpot).

> Decision 3 (where the live mirror runs and what happens on disagreement) is **refined by
> PADR-0011** (host-side mirror, step transaction with rollback, editor mode as untrusted input).
> Where the two differ, PADR-0011 applies.

Status: accepted · Date: 2026-10-03 · Revised 2026-10-03 after the foundation review (findings B5,
B7, B8 and Codex 7/8 in a private review record): evidence table made symmetric, simulated
error case marked, "real tool" defined, maintainer use case corrected, integrity policy aligned with
`docs/adapter-guide.md`. The decision itself is unchanged.

## Context
The first release must solve one bounded, useful workflow in a real application completely and
honestly. Candidates were measured against the frozen preregistration (`spikes/PREREGISTRATION.md`).
Both measured apps accept some invalid transitions silently; in both, only our own read-back or
integrity check turns them into errors. Read strictly, **neither passes S2-n2 by itself**; both pass
with an adapter guard. **Maintainer decision 2026-10-03:** S2-n2 counts as met with the adapter
guard (appended interpretation in `spikes/PREREGISTRATION.md`); before that decision the
foundation's abort criterion (a) should have stopped the work and asked — the verifier flagged this
(foundation review, round 1, HIGH).

| Candidate | S1 identity | S2 transition/export | Cost and risk (measured) | Report |
|---|---|---|---|---|
| Excalidraw 0.18.1 (MIT) | PASS (3 runs, identical up to ids) | a–d, n1, n3 PASS; **n2 only with adapter guard** (bindings to missing elements kept silently by `updateScene`, dropped silently by `restore`; caught by our integrity check). Programmatic moves do not carry dependents (F1); UI rewiring leaves stale back-references (F2). The "loose arrow" error case was **simulated by editing JSON**, not yet produced by a real UI deletion. | static bundle, 0 external requests, ~0.2–0.5 s to ready, ~0.4–0.5 GB browser RSS, no Docker | `spikes/excalidraw/REPORT.md` |
| Penpot 2.18.1 (MPL-2.0) | PASS (2 runs) | a–d, n1, n3 PASS; **n2 only with adapter guard** (`update-file` returns HTTP 200 and applies nothing for some invalid changes; read-back guard catches all four). Import silently drops invalid shapes; SVG export of API-created text failed 3/3. | ~6.5 GB images, ~1.2 GiB RAM idle, exporter OOM-killed at 512 MiB on a VM shared with production services; internal change format; 5 releases in 10 weeks | `spikes/penpot/REPORT.md` |
| Git 2.54 (GPL-2.0, invoked as a program) | probe only | probe only | excellent oracle; terminal modality; a git-semantics model would be needed | `spikes/alternatives/REPORT.md` |
| LibreOffice Calc | rejected | — | positional identity, keyboard-only macro recorder | same |

Independent model review (Grok 4.7, before the Excalidraw S1/S2 spike had finished;
a private review record, dispositions in
a private review record):
- F1 argued Excalidraw is **not** the better first pilot on the evidence available then and that
  the pilot should not be accepted before the Excalidraw spike reported. Addressed: the decision
  was taken only after that spike (S1 and S2 with adapter guard). Its point that Penpot fits the
  maintainer's real recurring task is accepted as the main cost of this decision (see Consequences).
- F2 argued that practising on Practonaut's own board drifts towards an app dummy. Addressed by
  the live mirror (decision 3, PADR-0011) and the editor and transfer modes.
- F6 argued the Penpot fallback lacks a text-export pass. Adopted as the Penpot entrance test.

## Decision
1. **Pilot application: Excalidraw**, package `@excalidraw/excalidraw` pinned at 0.18.1, bundled
   with fonts whose licences are confirmed, for offline use. **"Real tool" in this project means
   this pinned, embedded engine.** Opening exports in excalidraw.com or other Excalidraw
   distributions is untested; phase 4 checks one round trip as a maintainer step and reports the
   result. The adapter (PADR-0007) reads via coalesced `onChange` snapshots, writes only via
   `updateScene` with adapter-computed derived geometry and text refresh, reads back after every
   write and runs the integrity check defined in `docs/adapter-guide.md` §3 (fail on missing
   targets and on stale back-references from our own writes; warn on stale back-references from
   real UI states). Arrow relations come from `startBinding` / `endBinding` only.
2. **First workflow: "keep a process diagram editable while it changes".** Steps are boxes with
   bound labels inside a named frame, connected by arrows bound at both ends. Tasks: build a
   flow from a written process, insert a step between two connected steps and rewire, remove a
   step without leaving loose arrows, export `.excalidraw` and SVG with embedded fonts. The model
   may confirm only: ids, existence/deletion, frame membership, frame name, text content, integer
   box geometry and arrow start/end relations. Visual attachment of arrows and labels is
   established only by the export checks (stdlib parser plus render check). The error case
   "loose arrow" means an arrow end that is not bound to a live step (not a dangling id). Whether
   and how the real UI produces it when a step is deleted is measured in phase 1 before it is
   taught; if Excalidraw removes or re-binds such arrows itself, the error class is taken from the
   measured behaviour instead (Gemini finding 2).
3. **Practice surfaces, honestly labelled.**
   - *Board mode* (phase 2): Practonaut's keyboard-accessible board renders the semantic state.
     Every board action is a semantic action applied in the same transaction to a host-side
     instance of the pinned engine (live mirror, PADR-0011), read back and integrity-checked; on
     disagreement the step is rejected and the state stays unchanged. The player can show the
     engine's rendering of the current state.
   - *Editor mode* (phase 3, needs the recorder): the learner works in the real embedded
     Excalidraw editor; coalesced events are mapped to semantic actions and receive the same
     feedback; operations outside the model are shown as "not yet modeled", never rejected
     silently.
   - Skill claims about Excalidraw itself (as opposed to the diagram task) require practice in
     editor mode or the transfer case; board-mode practice alone is labelled "practice on the
     model of the confirmed rules" (both external model reviews, Grok F2 and Gemini Q2, argue that
     board mode on its own is too far from the real UI).
   - *Transfer case* (phase 4): a held-out task done in the real editor without Practonaut
     feedback, scored only by the independent checker on the exported file.
4. **Penpot is the second adapter, after the first release.** Entrance test before any Penpot
   world: plugin-API text create/edit, read-back, and the exact export the checker scores must
   pass on the cover/thumbnail fixture; the silent HTTP 200 case stays in its conformance suite;
   a dedicated VM or host with at least 3 GiB free memory. Its S1 evidence and mitigations are
   recorded, not claimed as support.
5. **Git** is a candidate third world (pathspec commits next to foreign changes, revert without
   history rewrite) for training agents, after the first release.

## The maintainer's own use case (not yet measured)
Measured 2026-10-03 (`find … -name '*.excalidraw'` → 0; `grep -rl '```mermaid' --include='*.md'`
→ 8 files): the maintainer's workspace contains **no** `.excalidraw` files; its process diagrams
are Mermaid in Markdown (review B8). The maintainer therefore does not use Excalidraw today. The
use case to be measured is new: an editable process figure for a real business process, created and later updated by a human and by an agent
through Practonaut, with checker verdicts, time and failed attempts recorded, and compared with the
existing Mermaid source. Whether this beats the Mermaid workflow is open; no benefit is claimed
before that measurement.

## Consequences
- The maintainer's real recurring layout task (cover/thumbnail reformat in a design tool) is
  postponed to the Penpot adapter; the first release teaches a common, error-prone diagram
  maintenance task with a lower skill ceiling.
- The adapter carries real geometry logic (arrow endpoints, label centring) that needs its own
  conformance tests.
- Excalidraw's canvas is not fully keyboard- or screen-reader-accessible, so board mode is the
  accessible path and editor mode states its accessibility limits.

## Re-assessment triggers
Editor-mode mapping fails for the declared operations (then board mode plus transfer only, and the
release says so); an Excalidraw upgrade breaks conformance; the Penpot entrance test passes and
the maintainer prioritises the cover workflow; font licences for bundled Excalidraw fonts cannot
be confirmed (then ship without those fonts and mark offline rendering as degraded); the maintainer's
measurement shows no benefit over Mermaid.

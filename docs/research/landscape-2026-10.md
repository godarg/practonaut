# Landscape and measurements, October 2026

Status: research note (input for [vision](../vision.md) and [roadmap](../roadmap.md), not a decision).
Retrieval and measurement date for everything below: **2026-10-14**. It updates, and does not repeat,
the [prior-art register](prior-art-register.md) (2026-10-03).

**How to read.** Tier T1 = official specification, documentation, repository or API; T2 = paper or
preprint, established analysis; T3 = blog, aggregator, press (never carries a claim alone). Star and
download counts come from `api.github.com/repos/<owner>/<repo>` (`stargazers_count`) and
`api.npmjs.org` / `pypistats.org` on the date above; downloads are not users. Benchmark scores are
snapshots and mostly self-reported by vendors. Recheck before reuse.

## 1. Agent environments and benchmarks

| Project | What | Runs on | Scoring | Note |
|---|---|---|---|---|
| OSWorld 1.0 / 2.0 | 369 desktop tasks / 108 long workflows | VM | script per task; 2.0 weighted checkpoints | 1.0 saturated (self-reported 80–86 %, none independently verified, T3 aggregator); 2.0 best 20.6 % (T2, arXiv 2606.29537) |
| WebArena-Verified | 812 verified web tasks | Docker, self-hosted apps | deterministic, LLM judge removed | T1 |
| AppWorld | 9 apps, 457 APIs, 750 tasks | simulated | state tests incl. collateral damage | T1/T2 |
| τ²-bench | tool-agent-user, dual control | simulated DB + simulated user | end state vs goal; pass^k | T2 |
| Terminal-Bench 2.0 + Harbor | 89 tasks from 93 contributors; task format + runner | containers | `tests/` write a reward | Harbor 6,088 ★, PyPI `harbor` 4.8 M/month (T1) |
| MCPMark, MCP-Universe, MCP-Bench, MCP-Atlas | MCP tool-use benchmarks over real servers | mixed, accounts, containers | scripts, rubrics | MCP-Atlas keeps 500 of 1,000 tasks private (T2) |
| MCPWorld | API/GUI/hybrid on white-box apps | containers with GPU | code instrumentation | 26 ★, last push 2025-05-20 (T1) |
| Gym-Anything (CMU) | coding agent turns software into environments; 200 apps | Docker/Apptainer, pixel actions | checklist VLM verifier | T2, arXiv 2604.06126 |
| Zapier AutomationBench | 600 public tasks, private leaderboard set | local | state assertions | cited in a frontier-model launch (T1) |
| OpenEnv | reset/step/state over WebSocket, Docker image, MCP at `/mcp` | containers | per environment | backed by Meta, Hugging Face and others; "early development" (T1) |
| verifiers + Environments Hub | environments + evals for training | Python | rubrics | 4,704 ★ (T1) |
| Inspect AI | > 200 evals; external agents (Claude Code, Codex, Gemini CLI) | Docker/K8s and others | scorers | 2,998 ★, PyPI 2.9 M/month (T1) |
| promptfoo | eval and red-teaming CLI | local/CI | assertions, LLM judges | 25,987 ★; joined OpenAI 2026-03-09 (T1) |
| Claude Code `plugin eval` | cases, graders (`regex`, `tool_used`, `file_exists`, `llm`, baseline), HTML report | the Claude Code CLI | per grader | built into the host since 2.1.269 (T1) |
| HAL (Princeton) | holistic agent leaderboard | hosted | — | updates paused, repository archived (T1) |

**Closest neighbours and the gap.** In the sources checked, no project combines a real application
engine without VM or container, a deterministically re-verifiable report, and a human and an agent in
the same session. This is a statement about these sources, not a global novelty claim.

**Official application MCP servers** (T1): `excalidraw/excalidraw-mcp` (5,520 ★, created 2026-02-04;
GitHub reports no license, the README says MIT), `jgraph/drawio-mcp` (5,640 ★, Apache-2.0), a tldraw MCP
App (2026-03-03). GitHub search finds 210 repositories for "excalidraw mcp" and 122 for "drawio mcp".
None of them measures whether an agent reaches a goal.

## 2. What buyers and evaluators value

- Epoch AI on RL environments (T2, 2026-01-12): "soundness matters most: high reward must mean the
  task was actually solved, not hacked"; success rates never 0 % or 100 %, a floor near 2–3 %, tasks
  retired around 70 %; a smooth difficulty gradient; typical prices of USD 200–2,000 per task.
- Reward hacking is common: METR reported attempts in about 80 % of runs of one test variant
  (2026-05-19, T2); ImpossibleBench measured 76 % for one frontier model on impossible variants and
  showed that an explicit "abort" option reduces it (T2, arXiv 2510.20270).
- Saturation is driven by curation more than by secrecy: in an ICML 2026 study, resilience came from
  expert curation, not from hidden test data (T2, arXiv 2602.16763). Sealing protects against cheating,
  not against ageing.
- Statistics: error bars and paired comparisons for evals (T2, arXiv 2411.00640); pass^k (τ-bench).

## 3. Protocols and clients

- **MCP 2026-07-28** is the current specification (T1): stateless requests (no `initialize`
  handshake), sampling deprecated, Tasks, Apps and Skills as extensions, deterministic `tools/list`
  ordering expected. The next revision plans HTTP over stdio and a redesigned `tools/call` result
  shape (roadmap as of 2026-08-22). Claude Code negotiates 2026-07-28 for stdio servers since 2.1.292;
  for other clients no primary source was found, so supporting both protocol generations stays right.
- **MCP Apps** (SEP-1865, stable 2026-01-26): a tool declares a `ui://` resource that the host renders
  in a sandboxed iframe. Hosts include Claude (web and desktop), ChatGPT, VS Code Copilot, Cursor and
  Goose; terminal agents are not listed. Host support varies.
- **WebMCP** (T1): a W3C Community Group draft of 2026-10-13 (`document.modelContext` with
  `registerTool`/`executeTool`), origin trial in Chrome 149 and Edge 150. "Primarily designed for local
  browser workflows with a human in the loop" — a bet, not a foundation.
- Practonaut today uses only `inputSchema`: no `outputSchema`, no tool annotations, and announces
  resource and prompt capabilities without registering any.

## 4. Learning from practice

| Approach | Result | Source |
|---|---|---|
| Agent Workflow Memory | WebArena +51 % relative; the gain grows as train and test diverge | T2, arXiv 2409.07429 |
| ACE (playbooks) | beats the top AppWorld agent on the held-out challenge split, without labels | T2, arXiv 2510.04618 |
| SkillWeaver | skills from a strong agent raise a weak agent by up to 54 % relative | T2, arXiv 2504.07079 |
| SkillsBench | curated skills help on average; skills a model writes for itself before solving cost 8–12 points | T2, arXiv 2602.12670 |
| SWE-Skills-Bench | 39 of 49 public coding skills without effect | T2, arXiv 2603.15401 |

Gains appear where execution feedback or a verifier filters the experience. There is no evidence yet
for canvas or diagram applications. Agent Skills is an open format (agentskills.io, T1) that several
clients read.

## 5. Measurements of Practonaut 0.1.0

All measured on 2026-10-14 with the published package (`npx -y practonaut@0.1.0`, macOS arm64,
Node 22.22.3, Chromium from the Playwright cache), a separate `PRACTONAUT_HOME`, and for model runs
Claude Code 2.1.299 on a subscription (`apiKeySource: none` in every transcript). Another job shared
the machine, so latencies are ranges.

**Agents.** Six hardest library tasks (`decision`, `restyle-flow`, `two-frames`, `reorder`,
`insert-between`, `align`):

| Agent | Runs | Passed | Mean actions | Rejected actions | Mean time per run |
|---|---|---|---|---|---|
| oracle | 6 | 6 | 4.5 | 0 | 1.0 s |
| random (`--max-actions 30`) | 6 | 0 | 9.5 | 123 of 180 | 4.9 s |
| Claude Code, Opus 5.5 (seeds 1–2, 2 repeats) | 24 | 24 | 3.7–5.0 | 0 | 17–22 s |
| Claude Code template, Haiku 5.5 (seeds 1–2) | 12 | 12 | 4.2 | 5 (`stale_base` from parallel calls) | 19 s |

Every report re-verified with `report --verify`. No agent ever saw an unmet condition; the only error
class was `stale_base` from two parallel `act` calls. Opus solved `reorder` in 2 instead of 4 actions and
`insert-between` in 3 instead of 4: the reference solutions are not minimal, so "efficiency vs
reference" partly measures the reference. In 7 of 9 repeated instances Opus produced the identical
action sequence, so pass^2 carries little information here. Listed cost per run as reported by the
client: Opus about USD 0.30–0.41, Haiku about USD 0.009 (subscription, not billed).

**Agent-facing cost.** `observe` is 6.9 KB on `connect`, 11.5 KB on `two-frames` and 56.6 KB on a
generated 40-step chain; the state itself is 5–20 % of it. Each `act` reply contains the full view and
grows by about 590 B per step. In the real runs above, 67 % of all tool-reply bytes were static blocks
(task, task list, action definitions) repeated on every reply; an Opus run with 6 actions read up to
287,000 input tokens including cache. A compact reply after the first `observe` would have needed
about 40 % of the bytes (computed from the transcripts, not run).

**Runtime.** Server time per `act`: median about 106 ms without the mirror and 138 ms with it (client
median 163 ms, p90 222 ms, n = 72). The pure core needs 0.04 ms per action; the host rebuilds a
`Session` (67 ms, re-validating the 146 KB library world) and replays twice per mutation. Cold start to
MCP `initialize`: 3.6 s with an empty npm cache, 1.3–2.6 s warm with the mirror, 0.9–1.2 s without.
`bench --agent oracle --tasks all --seeds 1`: 27 s. Memory per session: about 880 MiB with the mirror,
400 MiB without. Package: 8.5 MB unpacked, 499 files. `npm test`: 561 tests in 22.5 s; `npm run check`: 6 s.

**Expressiveness.** `tasks from-scenes` accepts a 50-step chain (101 goal conditions) and rejects 60
steps as `goal_too_complex`; world/2 has no arithmetic (no "no overlap", "equal spacing"), no frame
geometry and no transitive relations (reachability).

**Coupling.** Excalidraw and the flow-diagram vocabulary appear in 28 files across 11 modules outside
the adapter and the Player; a new action touches 8–9 source files because its meaning is implemented
three times (core, checker, adapter prediction) — on purpose, for checker independence.

**Reports.** The HTML report has no picture of the board, no trajectory, no tokens or cost, shows
error class ids without their explanation text, and template agents appear as "generic" with
"model not reported" even when the transcript names the model.

## 6. Second application: candidates

Measured on 2026-10-14: npm weekly downloads (`api.npmjs.org/downloads/point/last-week/<pkg>`, week
2026-10-06 to 10-12), stars (`api.github.com`), VS Code installs (Marketplace `extensionquery`), file
counts by GitHub code search (`total_count`, an approximation). Effort is an estimate.

| Candidate | Interface | Offline, pinned | Licence for bundling | Domain fit | Reach and agent demand | Verdict |
|---|---|---|---|---|---|---|
| **draw.io** (jgraph/drawio, v32.4.1 on 2026-10-08) | official embed JSON protocol (`load`, `export` xml/svg/png); docs say embed mode is "only supported on embed.diagrams.net" | static web app; the VS Code extension (4,209,905 installs) bundles it offline; 12 releases in five weeks, so pinning is mandatory | Apache-2.0 with an extra clause on stencils (not in Atlassian products) | world/2 maps almost one to one (steps, arrows, frames/containers, groups, styles) | about 368,640 `.drawio` files on GitHub; official vendor MCP server `jgraph/drawio-mcp` 5,640 ★ | **#2, behind a spike** |
| bpmn-js 18.31 | modeler API (`modeling`, `importXML`/`saveXML`) | browser, 0.57 MB production bundle | MIT plus a visible-watermark clause | BPMN; the app enforces modelling rules | 303,628/week; the vendor's copilot officially edits only diagrams it created itself | #3 |
| Univer 1.0 (sheets) | facade API, `IWorkbookData` JSON | browser; weekly patches | Apache-2.0; xlsx export only in the commercial edition | new domain: cells, ranges, formulas; position-based identity | strongest agent demand (spreadsheets); `@univerjs/core` 850,742/week | #4 after an identity spike |
| tldraw | editor API | browser | licence key needed for production, per downstream user | whiteboard | 446,145/week | excluded (licence) |
| Penpot | plugin API, official MCP server | **containers only** (official) | MPL-2.0 | design/layout | 61,034 ★ | not #2 (contradicts "no Docker") |
| MCP reference `memory` server | MCP tools; state in a JSONL file | Node, local | to be checked | knowledge graph with exactly predictable semantics | 207,413/week | pilot for "MCP server as the app" |
| Git, BlockNote, Node-RED, GrapesJS, JupyterLab | various | mostly yes | mostly compatible | new domains | — | later, after the vocabulary decision |
| OnlyOffice, LibreOffice, Handsontable, Planka | — | server/Docker or separate install | AGPL, proprietary or fair-code | — | — | no |

**Generalisation.** A generic adapter for "any JSON browser app" saves little: the reusable browser
shell is roughly a quarter to a third of the Excalidraw adapter. The large reuse is a **graph domain
package** (shared semantics, checker replay, board and generator) for diagram-like apps. "MCP server as
the app" is the largest market lever (the official registry lists about 7,700 server names, about 9 % of
them without a remote endpoint, snapshot) and the largest risk for the invariants, because the core
cannot predict arbitrary tool effects; a pilot with a server whose semantics are predictable keeps every
invariant. WebMCP: none of the checked open-source apps registers tools today.

**Counter-argument to draw.io first:** it keeps Practonaut a diagram gym for longer, while the broadest
demand (spreadsheets, documents) waits; the local embed path is not officially supported and jgraph
accepts no pull requests; bpmn-js would test "the real app disagrees" more strictly. The spike's abort
criteria cover the technical risks; the spreadsheet identity spike runs early (0.4.0) for the first one.

## 7. Open questions

- Behaviour of non-Anthropic agents and local models on these tasks: not measured.
- Whether any task family spreads current agents: unknown until a ladder run.
- Whether compact replies change pass rates of weaker models: needs an A/B run.
- Which Excalidraw MCP servers leave a readable local scene (for the artifact mode): unknown.
- Which clients besides Claude Code speak MCP 2026-07-28: no primary source found.
- Whether MCP App iframes may open a loopback link, and which theme variables hosts provide: unknown.

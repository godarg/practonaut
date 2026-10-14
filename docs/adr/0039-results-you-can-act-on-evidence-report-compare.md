# PADR-0039 — Results you can act on: run evidence in the bench folder, report v2, and the rules of `compare`

Status: accepted 2026-10-15 after independent review (pull request #31) · Date: 2026-10-14 · Roadmap 0.2.0, Must 3 · Adds the per-run fields that
[PADR-0036](0036-bench-report-v2-any-world-stored-world.md) decision 8 left open; uses the call log
of [PADR-0038](0038-lean-mcp-replies.md) decision 8

## Context

A bench report from 0.1.0 and from the Must 2 build says *whether* each run passed, not *why*: it
holds the checker's error class ids, counters and a pass rate shown as "1.00" at n = 6 without an
interval (vision §3). The roadmap's Must 3 asks for results a developer can act on: the call log
and every mutation of a run kept with the run, a report that shows the trajectory, which goal
conditions were met after each action, a picture of the final board that keeps every goal-relevant
attribute, the error classes with their explanation, the client's own token, turn and cost figures;
and a `compare` command whose statistics are fixed before it is written (roadmap item 3; vision
principles 4 and 8).

Two facts shape the statistics. Agents repeat the same action sequence in most repeats of one
instance (landscape 2026-10, §5: 36 of 36 runs passed, repeats agreed), so repeats are not
independent samples. And a library bench is small: 16 tasks × a few seeds. A rate difference between
two agents at that size is often noise; the comparison must say so instead of printing two numbers.

The real engine can export the final board as SVG (`window.__pn.svg()`, Excalidraw's own
`exportToSvg`), but an SVG export does not show Excalidraw groups (they are metadata), and the
Player's `miniature()` draws steps in one column without shape, fill, stroke, size or position.

## Options considered

**Where the evidence lives.**
1. *Only in the report JSON.* A report would grow with every call and every action; consumers that
   only want the summary would carry the whole history. Rejected.
2. *Files in each run folder, bound by hash in the report* (chosen): the bench folder already holds
   the judged artifacts and is self-contained (PADR-0036).

**Conditions after each action.**
1. *The host's own condition check after every mutation.* That is the runtime judging itself; the
   checker is the product (vision principle 1). Rejected.
2. *The checker on prefixes of the final history.* Misses everything an agent undid or reset.
3. *The separate checker replays every accepted mutation of the run — act, undo, reset — with its own
   transition code, requires the result to be the judged session, and evaluates each goal condition
   after each step* (chosen).

**The board picture.**
1. *Player's `miniature()`.* Drops shape, fill, stroke, size, position and frames. Rejected (roadmap).
2. *The engine's SVG as an image with a `data:` URI.* Isolated, but the design language bans `data:`
   URIs (§13, item 9). Rejected.
3. *The engine's SVG export, stored at bench time and inlined only after a strict allowlist
   re-serialisation; a schematic from the judged state when no mirror ran; groups as an outline
   (schematic) and a legend (both)* (chosen).

**Statistics for `compare`.**
1. *Runs as pairs, a two-proportion z-test.* Treats repeats as independent and is wrong at small n.
2. *A paired test on instances with an exact null distribution* (chosen: McNemar, exact binomial).
3. *Bootstrap intervals.* Needs randomness in the verdict path and more instances than a bench has.

## Decision

### A. Run evidence (per run folder, written after the agent has ended)

1. **`calls.jsonl`** — one line per `tools/call`: the tool, the result code, the full result bytes and
   the bridge's processing time (PADR-0038 decision 8), plus the JSON-RPC request id. The runner
   passes `--call-log <run folder>/calls.bridge.jsonl` in the generated MCP configuration, outside the
   agent's own folder; that file stays as the bridge wrote it. After the agent has ended the runner
   reads its head (bounded), keeps the well-formed lines in `calls.jsonl`, counts unreadable lines
   (`dropped`) and the lines beyond the limits (`omitted`, counted over at most 256 MiB more; past
   that the count is a lower bound, `omittedAtLeast`), and for its built-in agents adds
   `clientMs`, the round trip measured by Practonaut's own bench client, joined by request id. Other clients: `clientMs: null`, shown as "client timing
   unavailable". The bridge is started by the agent's client, so an agent can leave no call log or
   alter it: the report says "no call log" when there is none, and the call log is labelled as
   recorded by the agent's bridge.
2. **`mutations.jsonl`** — written by the runner's host-side wrapper, which sees every `act`, `undo`
   and `reset` that reaches the session: its sequence number, the operation, for `act` the action
   (name, parameters, base step), the client name the MCP client declared (the bridge sends it with
   `act`, `undo` and `reset`), accepted or rejected
   with the error code, and the step and revision afterwards. Every mutation that reaches the
   session is recorded (at most the action budget); refusals for an exhausted budget are recorded up
   to 100 and counted beyond. Parameters of a rejected action are kept as scalars, strings cut at
   256 characters.
3. **`trace.json`** — the separate checker process replays the accepted mutations from the task's
   start with its own transition code (`act` appends, `undo` removes the last action, `reset` returns
   to the start), refuses a timeline that does not end in the judged session's history and hash,
   and evaluates each public goal condition — each top-level clause of the goal, the same split the
   Player and MCP show (`goal-1` …) — at the start and after every accepted mutation. A trace that
   cannot be made (a variant change, a checker deadline) is `null` with its reason; the verdict does
   not depend on it. The runner writes the logs first: a trace is bound only beside the mutation log
   it follows, so when the logs cannot be written the trace is `null` with `log_unwritten`.
4. **`board.svg`** — with the mirror, the real Excalidraw's SVG export of the final board, taken by
   the same host export that produced the judged `native.excalidraw` and after the same read-back
   check. It cannot be re-derived without the engine; `report --verify` checks its hash only, and the
   report's caption says so. A picture that cannot be written is left out (`board: null`); like
   every piece of evidence here, it never changes a verdict.
5. **Client figures** — model, turns, tokens (input, output, cache read, cache creation) and cost from
   the client's own stream-json output (`system/init` and the last `result` event), per run, labelled
   self-reported (`client-attested` for the preset, `command-output` for a template). Never verified
   and never part of a verdict or of a rate; the report sums tokens, turns and cost over the runs
   that reported them into one running cost total, labelled as self-reported.
6. **Report `/2`** (still unreleased, PADR-0036 decision 8) gains optional per-run fields:
   `artifacts.trace` and `artifacts.board` (SHA-256 or null; a null trace carries `traceError`, the
   checker's error code), `logs` (`calls`: SHA-256, entry count, lines dropped as unreadable, lines
   omitted (and whether that count is a lower bound), whether client timing is present — or null;
   `mutations`: SHA-256, entry count, refusals not recorded), and
   `client`. The validator requires `board` null without the mirror, the mutation
   entries to equal the counted `act`, `undo` and `reset` calls, and `client` only for external
   agents with the source their kind allows. `/1` stays as it is.
7. **`report --verify`** additionally checks the hashes of `calls.jsonl`, `mutations.jsonl`,
   `trace.json` and `board.svg` (`bench_artifact_changed`), the mutation log against the run's
   counters, and re-derives the trace with the checker from the session and the mutation log
   (`bench_report_invalid` when it differs).

### B. Report v2

1. **Header line**: the fraction passed / n and a 95 % Wilson interval as the headline; the
   verification status, the mirror, the isolation level and, when a model is named, the model with
   "self-reported" and its source follow as chips. The interval is over instances (task × seed): an
   instance counts as passed when at least half of **all** its runs passed; a run that was not judged
   counts as not passed (as in pass@1, an infrastructure fault never raises a score). Compare (C.2)
   uses the same rule.
2. **No rate finer than 1/n.** A rate is shown as the fraction k/n. A percentage is added only at a
   resolution of at least 1/n: none below n = 100, whole percent from n = 100, one decimal from
   n = 1000; a fraction that is neither none nor all is never shown as 0 % or 100 % (`< 1 %`,
   `> 99 %`). Interval bounds are estimates, not observed rates; they are shown in whole percent,
   rounded outward. pass^k is shown for k = repeats as "all k repeats passed on m of I instances";
   the intermediate values stay in the JSON.
3. **Failures first.** Failed runs come before passed runs, each with: its status and reason in words
   (timed out, agent failed, no action taken, rejected actions with what each refusal means, several
   MCP clients acting; a run that was not judged has no verdict: it shows the unknown mark, never the
   fail mark, and counts as not passed); every unmet condition with its sentence and formal form and
   the trajectory entry (#n) after which it was last lost, or "never met", the goal conditions
   numbered as the trajectory names them; the error classes with the first
   sentence of their explanation in the report's language (the rest coaches a learner); the
   trajectory (every mutation with its outcome — "accepted (revision n)" or the refusal in words —
   and the conditions met afterwards); the final board; the example target or "no example target";
   the call log summary; the client figures when reported. Identifiers stay under "Technical
   details": the run id, status, exit and host codes, the runner's note, the full explanation; for
   the report, the command (the home folder shown as `~`), the world content hash, generated
   instances, API key source and kept variables. Passed runs follow with the same content, collapsed;
   a run whose agent did not end normally is open, and the header says how many there are. Without
   the bench folder one banner says what is missing, what still shows and the command that fixes it;
   error classes keep their explanation when the report's world is the bundled library.
4. **The board.** With the mirror: the engine's `board.svg`, after an allowlist re-serialisation
   (elements `svg g path rect ellipse circle line polyline polygon text tspan defs clipPath mask`,
   geometric and paint attributes, local `url(#id)` references only, ids prefixed per run; every
   style, script, link, font, comment and unknown element or attribute is dropped; text is
   re-escaped), so board text is never markup. Without the mirror, or when `board.svg` is missing or
   unreadable: a schematic drawn from the judged session state with shape, fill, stroke, size,
   position and frames, labelled "schematic". Groups come from the judged state: a solid tinted
   outline in the schematic, the same outline laid over an export (which shows no groups, so the
   caption says where the outline comes from), and a legend under either picture; under either
   picture, too, every
   object in words with each goal-relevant attribute and its label in full (a drawing may cut a long
   label). An **example target** is shown only when the
   report binds a validated reference for the task (`references.json`, checked by the checker before
   the bench, by hash at render time and again by `--verify`): a schematic of the reference's end
   state for that seed, with its own object list. Otherwise "no example target", a neutral banner.
   The final board and the target share **one viewBox** (their union in board units; the export is
   placed by the bounds of its native scene), so they are drawn at one scale, one above the other. A
   picture is never drawn below 0.6 CSS px per board unit (Excalidraw's 20-unit text at 12 px) nor
   above 1 px per unit; a wider one scrolls inside its frame, with a faded edge and a line that says
   so. In dark mode the export gets Excalidraw's own dark-mode filter, which the schematic's content
   tokens reproduce, so a pair shows one palette; labels use the same monospace face, steps the same
   sharp corners. Two arrows between the same steps are drawn apart.
5. The renderer uses `design/tokens.css` and its own stylesheet `src/bench/report.css` only, has no
   script, and falls under `npm run design:lint` with the same rules as the Player (a report profile:
   CSS rules on `report.css`, the TS rules on the renderer modules, classes checked against
   `report.css`). Its CSP allows only its one hashed style; no `data:` URIs, no remote assets.

### C. `practonaut compare a.json b.json [--html <out>] [--fail-on-regression] [--verify]`

`a` is the baseline, `b` the candidate; both are validated as `report` validates them.

1. **Comparable or refused.** Two reports are compared only when they agree on: the world content
   hash (`/1`: the library's), the grid (the same set of tasks and the same set of seeds), the mirror
   actually used, the action budget (`maxActions`) and the isolation level (`/1`: derived from the
   agent kind, which PADR-0036 fixes). Otherwise `compare` refuses with `compare_incomparable`
   (exit 2) and names every field that differs with both values. Repeats, timeout, agent, model,
   label and versions may differ; differences in timeout and Practonaut version are named as caveats.
2. **The unit of analysis is the distinct instance**: task × seed within the world's content hash
   (for generated instances the task id is the instance id, PADR-0036). Runs are paired by task and
   seed. **Repeats of one instance aggregate to one outcome per side**: the instance passes when at
   least half of **all** its repeats passed; a run without a checker verdict counts as not passed
   (roadmap 0.2.0: every run counts; B.1 uses the same rule). Runs that were not judged are listed
   per instance. Repeats are never counted as independent pairs. An instance that is missing on one
   side is listed with its reason and left out of every statistic; when no instance is on both
   sides, the verdict says there is nothing to compare.
3. **Instance regression**: an instance with at least three judged repeats on each side, every judged
   baseline repeat passed and every judged candidate repeat failed. The mirror image is an instance
   fix. `--fail-on-regression` exits 2 (`instance_regression`) when there is at least one, and 2
   (`compare_incomplete`) when a candidate instance is missing, cut short (fewer repeats than its
   plan) or holds a run that was not judged: a missing verdict could hide a regression, so the gate
   never passes it. Instances with fewer than three repeats on a side are never regressions; a flip
   there is listed under "single runs — not a regression signal". With three or more a side, an
   outcome that changed but not in every judged repeat (for example 2/3 passed before, 1/3 after),
   or that rests on runs that were not judged, is listed as "outcome changed, not in every repeat —
   not a regression signal". Every flip is one of the discordant instances of 4.
4. **Rate claims** use the exact two-sided McNemar test on the discordant instances: b passed only on
   the baseline, c only on the candidate, p = min(1, 2 · P(X ≤ min(b, c))) for X ~ Binomial(b + c,
   1/2). At p < 0.05 the verdict is "improvement" (c > b) or "decline" (b > c), always with b, c and
   p; otherwise "rate difference not distinguishable at this n" (also when b + c = 0). Each side's
   instance pass rate is shown as a fraction with its Wilson interval. The page names each side by
   its label or file name; two reports that cannot be compared get a page that names every
   difference.
5. Both reports' verification status is shown; `--verify` re-verifies each from its bench folder
   first.
6. **Sample size.** The table below is computed with the exact power of the test in 4 (one-sided
   success: significant and in the candidate's favour), α = 0.05, for a true difference of 20 points
   between the candidates' instance pass rates. The assumption that matters is the discordance ψ, the
   share of instances on which the two agents disagree; a 20-point difference needs ψ ≥ 0.20, and
   ψ = 0.20 means the candidate passes everything the baseline passes. Exact power is not monotone in
   n; the table gives the first n that reaches the target (checked by `tests/unit/bench-stats.test.ts`
   against a separate binomial sum for ψ = 0.20).

| Discordance ψ | baseline only / candidate only | instances for 80 % power | for 90 % power |
|---|---|---|---|
| 0.20 | 0.00 / 0.20 | 39 | 45 |
| 0.30 | 0.05 / 0.25 | 61 | 78 |
| 0.40 | 0.10 / 0.30 | 84 | 107 |
| 0.50 | 0.15 / 0.35 | 103 | 135 |
| 0.60 | 0.20 / 0.40 | 124 | 162 |

   At 24 instances (the challenge gate's minimum) the power for a 20-point difference is 0.34 at
   ψ = 0.20 and 0.19 at ψ = 0.50. With five or fewer discordant instances no split can reach
   p < 0.05 (five all one way give 2 · 2⁻⁵ = 0.0625); six all one way give 2 · 2⁻⁶ ≈ 0.031.

The statistics live in one module (`src/bench/stats.ts`) that the challenge gate (Must 4) reuses.

## Consequences

- A bench folder is larger by a few kilobytes per run (call and mutation logs, trace) and, with the
  mirror, one SVG (about 8 KB for a three-step board, with Excalidraw's subset font).
- A report says why a run failed and shows the board; a comparison says whether a difference is
  distinguishable and names instance regressions, which is what CI should gate on (roadmap item 5).
- The call log comes from the agent's own bridge process and is evidence about the run, not proof;
  the mutation log and the trace come from Practonaut's side and are re-checked by `--verify`.
- Tokens, turns and cost are the client's statements; they are shown with their source and never
  aggregated into a score.
- `compare` refuses more often than it compares at first: a change of mirror, budget, grid or
  isolation level needs a new baseline. That is the point.
- `--verify` costs one more checker process per judged run (the trace).

## Re-assessment triggers

A client that reports tokens or cost in another shape; Excalidraw changing its SVG export (new
elements the allowlist drops); a family or user grid where most instances disagree (ψ > 0.6) so the
table no longer covers it; the challenge gate (Must 4) needing a different aggregation than C.2;
the first change to `/2` after the 0.2.0 release (PADR-0036 decision 8).

# PADR-0033 — Product direction: measurement you can act on

Status: proposed · Date: 2026-10-14

## Context

Practonaut 0.1.0 was published on 2026-10-14 as "a local practice gym for AI agents on real apps".
Measurements on the published package the same day (details:
[landscape 2026-10](../research/landscape-2026-10.md) §5) show that the foundation holds — real-engine
confirmation, a separate checker, deterministic replay — but that the product does not yet answer a
question developers have:

- the bundled library is saturated: 36 of 36 Claude Code runs (Opus 5.5 and Haiku 5.5) passed the
  six hardest tasks, so `bench` cannot tell agents apart;
- only bundled tasks can be benched and re-verified (`src/cli/bench.ts`, `src/bench/verify.ts`);
- agent replies repeat the whole view on every action, so context cost grows quadratically;
- reports say whether a run passed, not why, and show "1.00" at n = 6 without an interval.

The market moved in the same weeks: official MCP servers for Excalidraw, draw.io and tldraw exist;
host clients ship their own evals; MCP, OpenEnv and Harbor are becoming the shared layers for agent
environments; buyers of environments value soundness and headroom above size.

Three independent model proposals (Claude Opus 5.5 as main agent, OpenAI Codex `gpt-6.1-sol` with
repository access, Google `gemini-3.8-flash` with the full documentation) converged on the same core
without seeing each other: make Practonaut a tool for state-verified regression and comparison of
agents on the user's own tasks, first fix headroom and agent-facing cost, and keep the deterministic
checker as the product. A fourth voice (xAI Grok) could not run (usage balance exhausted).

## Options considered

1. **Stay a practice gym on Practonaut's own actions and grow the library.** Cheapest; does not answer
   saturation or the question "does this help *my* agent and tools?".
2. **Measurement you can act on** (chosen): own tasks, honest comparison, diagnosis, headroom first;
   then the user's own toolchain, the clients where agents live, a second application, measured
   skills and GUI agents — each behind a measured gate.
3. **Become a generic MCP-server test harness now** (any server, any backing state). Large reach, but
   each new state type needs an independent reader and checker; it would dilute the one thing that is
   proven. Kept as a later direction through the artifact mode in 0.3.0.
4. **Sell environments to labs or host a leaderboard.** No sales channel, no compute budget, and a
   ranking without sealing would contradict the project's honesty principle.
5. **Second application: Penpot (PADR-0006 decision 4), tldraw, a spreadsheet or draw.io.** Penpot is
   officially installable only with containers, which contradicts "no VM, no Docker"; tldraw's licence
   requires a key for production use and one per downstream user; a spreadsheet is the largest demand
   but a new domain with position-based identity. draw.io (Apache-2.0, official embed JSON protocol,
   bundled offline by its VS Code extension with about 4.2 M installs, an official MCP server by the
   vendor) maps almost one to one onto the existing diagram vocabulary (chosen, behind a spike).
6. **Drop the Player and human practice entirely.** Rejected: human and agent in one session is the
   basis of a task family no other benchmark has (a human editing mid-run) and of the "watch your
   agent" experience; what is dropped are unstudied claims about training people.

## Decision

- Direction, principles, bets and North Star as written in [vision](../vision.md); milestones,
  acceptance lines and checkpoints as written in [roadmap](../roadmap.md).
- 0.2.0 ("Real signal") contains, in this order: a lean agent surface, bench for any world,
  a challenge tier behind a ladder gate, and results you can act on (report v2, `compare`).
- A task family is published only after a ladder of at least three agents shows a spread
  (strongest between 10 % and 80 %, oracle 100 %, random about 0 %).
- Every exported number carries its n, its interval at small n and its verification status.
- **Application #2 is draw.io** if a preregistered spike in 0.2.0 passes its abort criteria (otherwise
  bpmn-js); the adapter ships in 0.3.0. This **supersedes decision 4 of PADR-0006** ("Penpot is the
  second adapter"). Then bpmn-js and a graph domain package (0.5.0), spreadsheets after an identity
  spike (0.6.0). An application outside the diagram domain waits for a decision record on the
  action-vocabulary architecture.
- North Star: external projects that run Practonaut repeatedly, counted from public evidence only.

## Consequences

- Report format `practonaut.bench/2` and new MCP reply shapes are planned changes; readers keep
  reading `/1`, and the MCP change is documented in the agent guide with the measured savings.
- New work is judged against the roadmap order; work outside the current milestone needs a maintainer.
- A bring-your-own-tools mode (0.3.0) introduces a second verdict level ("artifact-judged, end-state
  only"); it needs its own record and must never be presented as equal to a session verdict.
- Some code from the earlier audit phase (the three-step recorded repair flow) is frozen behind a
  flag once a general recording path exists, not deleted.

## Re-assessment triggers

- A roadmap checkpoint is missed by more than one release, or the 2027-01-15 checkpoint finds no
  external usage signal.
- The challenge gate cannot be passed by any family after two attempts.
- A platform change removes a premise (for example, app vendors ship state-verified evals themselves,
  or MCP clients stop accepting local stdio servers).

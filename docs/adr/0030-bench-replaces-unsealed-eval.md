# PADR-0030 — Bench: independent scoring of any MCP agent; the unsealed eval runner is retired

Status: accepted · Date: 2026-10-12
Supersedes: [PADR-0021](archive/0021-supported-unsealed-evaluation.md) (the `eval` interface)

## Context

The relaunch positions Practonaut as a local practice gym for AI agents with an independent,
reproducible score. The Phase-4 `eval` runner scored one held-out task with a checker bundle, was
wired to Claude Code flags, required `--unsealed` and an absolute client path, and supported
world/1 only. It answered a question (sealed C5 evidence) that the local same-user setup cannot
answer (PADR-0021) and did not answer the one users have: how well does my agent do on these tasks?

## Decision

- `practonaut bench` replaces `eval` (which now exits with a pointer to bench). It runs the task
  library as a task × seed × repeat grid; each run has its own host and its own private
  `PRACTONAUT_HOME` subfolder; the agent reaches the session only through the attach-mode MCP
  bridge (token file, never the token in argv or configuration).
- Agents: built-in `oracle` and `random` (no language model, through MCP), the `claude-code`
  preset, or a command template with `{mcp_config}` and `{prompt}` started without a shell.
  No preset is shipped for a client whose tools cannot be limited to MCP.
- Scoring uses only host counters, the host's history and separate checker processes (session
  replay and, with the mirror, the native export). The step budget is enforced by the host.
  Agent output is opaque.
- Report `practonaut.bench/1` with a JSON Schema; consumers re-derive every pass and aggregate
  from the recorded verdicts and refuse reports that do not add up.
- `practonaut mcp --task` starts its own session for interactive use (one-line client setup).

## Consequences

- Held-out tasks and checker bundles keep their format and `check --bundle`, but no command runs
  an agent against them. A sealed evaluation (separate OS identity, unreadable answers) remains
  OPEN and needs its own reviewed launcher (as PADR-0021 stated).
- Bench results are same-user and client-attested where the client reports its model; they are
  practice scores, never C5 evidence. Agents with file or shell tools could read the library's
  reference solutions; the shipped preset disables them.
- The host gained the `step_budget_exhausted` error code (renamed `action_budget_exhausted` before 0.1.0 was released); the MCP bridge passes it through.

⛔ The evaluation-setup part is superseded by [PADR-0030](0030-bench-replaces-unsealed-eval.md) (`practonaut bench`); the sealed-setup proposal below is not an available feature. The host and transport decisions remain in force.

# PADR-0005 — One session host; loopback HTTP for the player, MCP over stdio for agents

Status: accepted · Date: 2026-10-03

## Context
Humans and agents must act on the same state (I10). Local HTTP services are reachable from any
web page the user opens (DNS rebinding, CSRF).

Evidence (`measured`, `spikes/runtime-parity/REPORT.md`): one host process as the only writer,
a browser UI over HTTP on 127.0.0.1 and an MCP client through a stateless stdio bridge produced
identical hashes after every step, also interleaved; token, Host, Origin and content-type
checks rejected all probes. The spike used SDK v1 (protocol 2025-11-25); the current protocol
is 2026-07-28 and the v2 server SDK has two dependencies (`documented`/`measured`,
`docs/research/prior-art-register.md`, `npm view`). The SDK's own DNS-rebinding protection for
HTTP is off by default and deprecated (`documented`, spike).

## Decision
- **Session host** (`practonaut serve`): one process owns sessions and is their only writer.
  Binds 127.0.0.1 only, random port.
- **Player transport:** JSON over HTTP plus server-sent events for updates. Every request needs
  the session token in a header (never in a query string), an allowed `Host`, an allowed or
  absent same-origin `Origin`, and `application/json` for writes. Strict CSP, no CORS headers.
  The browser receives a one-time code (short validity) that it exchanges for the token.
- **Agent transport:** MCP over stdio (`practonaut mcp`) using the official v2 server SDK,
  targeting protocol 2026-07-28. The stdio process is a stateless bridge to the host; it opens
  no listening socket. Tools: `observe`, `list_actions`, `act`, `undo`, `reset`,
  `explain_result`, `check_result`. Tool descriptions are fixed text from the project, never
  world-authored. A Streamable-HTTP MCP endpoint is a later option behind the same guard.
- **Practice sessions have no checker bundle at all.** `check_result` in practice evaluates the
  task's public goal conditions, the same ones the player shows, and returns exactly what the
  player shows (met/not met per condition, the learner-visible explanation) — never predicates of
  hidden tasks, reference solutions, expected hashes or diffs against a solution.
- **Evaluation runs** (`practonaut eval`, held-out tasks) run the checker as a separate process
  with the checker bundle. Before the agent starts, a probe running as the agent's OS user tries
  to open the bundle; if it can, the run is refused unless explicitly started as `--unsealed`, and
  unsealed results never count as agent-success evidence (C5). The supported sealed setups are a
  different OS user or a container without the bundle mounted (independent review finding F4).
  In a sealed run `practonaut eval` **launches the agent client itself** and hands it a
  single-session, short-lived token through an inherited pipe or environment entry of the child
  process; the agent user never reads files of the host user (Gemini finding 1, 2026-10-03).
- Agent-success claims (C5) come only from evaluation runs on held-out tasks. A practice world is
  readable by anyone who has the file, so an agent's success on practice tasks is never evidence of
  capability (Gemini finding 6).
- Token file: created exclusively (`O_EXCL`, no symlink following), mode 0600 in a 0700
  directory; processes of the same OS user are trusted (stated limit, PADR-0010).

## Consequences
Parity is structural: both surfaces end in the same `Session.act`. Agent clients that only speak
older MCP protocol versions need a compatibility check in phase 4 against a real client.

## Re-assessment triggers
A target agent client that cannot use stdio; multi-user or remote use (needs a new
authentication design); SDK v2 incompatibility with the chosen real client.

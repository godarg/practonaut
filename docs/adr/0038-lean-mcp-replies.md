# PADR-0038 — Lean MCP replies: compact observe, mutation deltas, one language by default

Status: accepted 2026-10-14 after independent review (pull request #25); decision 4 departs from the roadmap's "short text reply" and was taken under the maintainer's delegation of 2026-10-14 · Date: 2026-10-14 · Roadmap 0.2.0, Must 1 · Changes the reply shapes of
[PADR-0005](0005-session-host-and-agent-protocol.md)'s MCP tools; the tools, their names and the
host contract for the Player stay

## Context

In 0.1.0 every `act`, `undo` and `reset` answered with the whole host view — task, task list, action
definitions, rules, the complete log and history, in English and German. Measured with
`tools/measure-agent-surface.ts` on 2026-10-14: `observe` on `excalidraw/connect` is 6,941 bytes of
text (8,050 bytes as a full `tools/call` result), and each `act` reply grows by about 600 bytes per
action because the history is repeated; over 80 actions one reply reaches 63 KB. An oracle episode
on the six hardest library tasks (seeds 1–2) costs 910,466 result bytes. The action definitions
reach the model three times (tool schema, `list_actions`, `observe`). Schema errors said only
"Tool input does not match its fixed schema"; a stale request did not say what is current; the
server announced `resources` and `prompts` and served none; tools had no annotations.

How Claude Code passes a result that has both `content` and `structuredContent` to its model is not
documented (checked 2026-10-14); public reports conflict about whether the text part is dropped.

## Options considered

1. **Keep the full view, compress it** (no history, one language). Still repeats the board on every
   action and the static blocks on every observe.
2. **Separate MCP routes in the host.** Two reply contracts for one session state.
3. **Shape in the bridge from the public view; let the host answer a mutation with its delta**
   (chosen). The host keeps one public view; the bridge only selects and localises.

## Decision

1. **`observe`** takes `detail` (`compact` default, `full`), `lang` (`en` default, `de`, `both`) and
   `history` (0–200 recent items, default 5). Compact: the task (title, prompt, goal conditions with
   sentence and formal form), the live objects (no tombstones), step, revision, mirror mode and
   status, practice evidence, the recent history, the last check by condition id, error
   explanations, opened hints, attempt. `full` is the whole public view; `full` with `both` is
   exactly the Player's view. Static blocks (action definitions, rules, task list, log) are not in
   compact replies: the action definitions are in the `act` tool schema and `list_actions`.
2. **`act`, `undo`, `reset`** answer with what changed: `step`, `revision`, `changed` (every object
   that differs, as it is now; a deleted object keeps its tombstone), `created` and `removed` ids,
   effects, the current error explanations, `mirrorConfirmed` and `latencyMs`. The host computes the
   delta from the committed state before and the published view after the mutation and sends it on
   the HTTP route when the request says `reply: "delta"`; the Player leaves that out and still gets
   the view.
3. **The goal conditions — sentence and formal form — stay in every `observe` and every
   `check_result`**, in the chosen language, exactly as the Player shows them (architecture §10,
   "hidden data stays hidden"). `check_result` and `explain_result` take `lang`; with `both` they are
   identical to the Player's. A mutation reply carries no condition status, as the Player shows none
   before Check.
4. **Every result carries the same JSON as its text part and as `structuredContent`.** The roadmap
   asked for a short text next to `structuredContent`; because clients differ in which part reaches
   the model and Claude Code's behaviour is undocumented, the text stays complete. Reply sizes are
   measured with both parts counted, escaping included. A reply too large for both goes as text
   alone; one too large even for that is refused as `result_too_large`. A mutation whose changed
   objects exceed 512 KiB answers with ids only and `changedOmitted: true` (observe for the board);
   the delta is computed before the commit, so a committed change always has its reply.
5. **Errors say what to fix.** A refused input names each path and what the schema expects (at most
   four problems, 600 characters), checking act parameters against the named action's own
   parameters; it never repeats input text (values, unknown keys, an unknown tool name). `stale_base`
   carries the current `step` and `revision` in `error.details`, whether the revision or the core's
   `baseStep` check refused the request.
6. **Capabilities that are announced are real:** the resource `practonaut://task` (title, prompt and
   conditions in English and German) and one task-neutral prompt `practise`. **Annotations:**
   `observe`, `list_actions`, `explain_result`, `check_result` are read-only and idempotent; `undo`
   (there is no redo, and it can take back a person's change) and `reset` are destructive; `act` is
   not (an action is reversible through undo); nothing is open-world.
7. **Bench agents see no reference lengths.** A bench host publishes no task-list facts, so a bench
   agent's `observe` (even `full`) holds no `referenceActions` of any task.
8. **`practonaut mcp --call-log <file>`** appends one JSON line per `tools/call`: tool, result code,
   the bytes of the result exactly as sent (with what the SDK adds), the bridge's own processing
   time. It records at the transport, so refused and rate-limited calls are included; it holds no
   arguments and no content. It is a measurement aid and the basis for the call log of Must 3; the
   client's round trip is not visible to the bridge.

## Consequences

- Measured on 2026-10-14 against 0.1.0, same machine and tool (`excalidraw/connect`, median of 72
  calls after 8 warm-up calls): `act` client round trip 10.4 ms instead of 133.7 ms without the
  mirror and 33.6 ms instead of 150.0 ms with it; one `act` result 866 bytes and flat (0.1.0: +600
  bytes per action); the first `observe` 3,692 bytes instead of 8,050; the oracle episodes on the six
  hardest tasks 192,668 instead of 910,466 bytes (−79 %), or 244,126 bytes (−73 %) for an agent that
  also reads `list_actions` once (0.1.0 carried the definitions in every observe). Re-measured
  back-to-back on a loaded machine (load average ~16): 4.2–7.1 ms vs 187–404 ms without the mirror,
  33.2–33.5 ms vs 183–208 ms with it.
- Measured in 24 real runs (Claude Code 2.1.299, 2026-10-14): the model received each result's JSON
  once, so the duplicate `structuredContent` costs wire bytes, not model tokens. Which part Claude
  Code passed cannot be told apart here, because both are the same JSON; the bring-your-own-tools
  spike (Should 9) saw Claude Code pass `structuredContent` instead of the text when the two differ —
  the reason both parts stay complete. On six instances measured on both versions the tool-result
  bytes the model received fell from 245,287 to 38,663 (−84 %); the paired grid (six tasks × seeds
  1–2 × Opus and Haiku) passed 24 of 24 on both versions.
- Clients and scripts that read `value.view` from a mutation reply must read the delta or observe
  again; `observe` with `detail: "full", lang: "both"` returns the old shape. The bench's own
  baselines and the documentation use the new shapes.
- Both MCP protocol generations stay tested (`tests/mcp/client.test.ts`).

## Re-assessment triggers

A client that shows the model neither part of a result in full; MCP results exceeding a client's
size limit (Claude Code warns at 10,000 tokens); a Player feature that shows agents more or less
than these replies.

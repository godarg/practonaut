# PADR-0043 — Artifact mode: an "artifact-judged" verdict level for results made with foreign tools

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, "Bring your own tools (artifact mode)" ·
Required by [PADR-0033](0033-product-direction-measurement-you-can-act-on.md) (consequences) ·
Uses the spike [bring your own tools](../../spikes/byo-tools/REPORT.md) · Accepted with the pull
request that implements artifact mode, after independent review

## Context

PADR-0033 says a bring-your-own-tools mode "introduces a second verdict level ('artifact-judged,
end-state only'); it needs its own record and must never be presented as equal to a session
verdict". Today every bench verdict is a *session verdict*: the host kept the history, every action
went through `Session.act`, the checker replays that history with its own interpreter, compares
every step hash, reads the real engine's export and only then judges the end state. In artifact mode
none of that exists: the agent works with whatever tools it has (for example the official
Excalidraw or draw.io MCP server), and Practonaut sees only the file those tools leave.

The spike measured what such a file looks like (official Excalidraw MCP server v0.3.2, three runs):

- the end state was readable as a local JSON checkpoint, judged 3 of 3 after a small normalisation
  and 0 of 3 as stored, because the server keeps a `cameraUpdate` pseudo-element without an id and
  writes a shape's text as a `label` property instead of a bound text element;
- the agent chooses ids (one run replaced every id), deletions are not reliably stored, the
  checker's colour mapping snaps off-palette colours to the nearest named colour, and the client
  passed `structuredContent` (the checkpoint id) to the model instead of the text reply;
- the server writes into `$TMPDIR`, and its tool list includes widget-only tools (one uploads).

## Options considered

1. *Reuse `practonaut check`'s manual verdict (`manual-unbound`, origin `unattested`).* Exists, but
   says nothing about which tool made the file, which reading rules applied or what was skipped, and
   a report could not tell it apart from a hand-submitted file.
2. *Turn the foreign file into a Practonaut session* by diffing it against the start and
   synthesising actions. This invents a history nobody made; architecture §10 forbids inventing a
   successor state, and a synthesised history would look like a session verdict.
3. *A separate verdict level with its own provenance* (chosen).

## Decision

1. **Two verdict levels.** `session` — today's verdict: host history, replay, step hashes,
   real-engine export, end state judged. `artifact` — **"artifact-judged, end-state only, no
   Practonaut history"**: the checker judges only the native file a foreign toolchain left. Every
   run record, report header, card, badge and comparison carries the level by name; `compare`
   refuses to pair runs of different levels (incomparable, like a different isolation level); no
   aggregate mixes them; a card or badge of an artifact report says "artifact-judged" in its text.
2. **Reading rules live in the checker, named and versioned.** A tolerant reader per source format
   (`excalidraw-mcp` element lists, `.drawio` files) maps the foreign form onto the judged state by
   named rules, each with fixtures from an independent writer: skip known pseudo-elements and list
   them as unmodeled; read a shape's `label.text` as its label; accept frame `children` as well as
   `frameId`; accept skeleton `start`/`end` as bindings; accept a bare `{"elements": [...]}`.
   Anything no rule covers is listed as unmodeled. The reader never imports `src/core` or an
   adapter. The rules version is part of the verdict.
3. **Strict values.** In artifact mode a colour, shape or other value outside the declared set is
   read as "unmodeled value", never snapped to the nearest known value; a goal clause that needs a
   specific value fails on it with the error class named.
4. **Same counter-probes.** An empty file, the unchanged start and a wrong artifact, each written in
   the source format, must fail before any verdict.
5. **Toolchain provenance.** Every artifact verdict records the toolchain: server name, version,
   where it came from, the SHA-256 of the installed archive, how the start was delivered, and the
   result locator (for example: the checkpoint named by the last successful `create_view`). A
   foreign server runs with its own temporary directory per run, in a working directory without
   agent instruction files, with its widget-only tools denied by name.
6. **Baselines go the agents' way.** `oracle`, `random` and the near misses act through the same
   foreign server over MCP as a scripted client without a language model, so the reading path the
   agents' results take is the one the baselines test.
7. **Isolation is reported as today** (`tool-restricted-preset`, `template-unrestricted`): a preset
   that allows only the foreign server's tools is tool-restricted; nothing else changes.

## Consequences

- bench/2 gains the verdict level and the toolchain record (optional fields, absent = `session`);
  readers of earlier reports keep reading them as session verdicts.
- The checker gains source-format readers with their own fixtures and rejection reasons.
- Gate rounds on foreign toolchains (PADR-0041 decision 2) use this level; their gate reports say so.
- Goals about the identity of start objects (an id kept from the start) cannot be judged when the
  tool lets the agent choose ids; such families are marked "not supported in artifact mode" until a
  matching rule is decided.

## Re-assessment triggers

A foreign server changes its stored format; a reading rule turns out to accept a file the real app
would not open; MCP clients start passing a different part of a tool result to the model; a request
to judge a toolchain whose end state is not a local file.

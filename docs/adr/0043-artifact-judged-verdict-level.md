# PADR-0043 — Artifact mode: an "artifact-judged" verdict level for results made with foreign tools

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, "Bring your own tools (artifact mode)" ·
Required by [PADR-0033](0033-product-direction-measurement-you-can-act-on.md) (consequences) ·
Uses the spike [bring your own tools](../../spikes/byo-tools/REPORT.md) · Reviewed in draft by a
fresh Claude reader, OpenAI Codex `gpt-6.1-sol` and Google `gemini-3.8-flash` (plan pull request);
to be accepted with the pull request that implements artifact mode, after a review of that code

## Context

PADR-0033 says a bring-your-own-tools mode "introduces a second verdict level ('artifact-judged,
end-state only'); it needs its own record and must never be presented as equal to a session
verdict". Today every bench verdict is a *session verdict*: the host kept the history, every action
went through `Session.act`, the checker replays that history with its own interpreter, compares
every step hash, reads the real engine's export and only then judges the end state. In artifact mode
none of that exists: the agent works with whatever tools it has (for example the official
Excalidraw or draw.io MCP server), and Practonaut sees only what those tools leave.

The spike measured what that looks like (official Excalidraw MCP server v0.3.2, three runs):

- the end state was readable as a local JSON checkpoint — judged 3 of 3 after a small normalisation,
  0 of 3 as stored (a `cameraUpdate` pseudo-element without an id; a shape's text as a `label`
  property instead of a bound text element);
- the agent chooses ids (one run replaced every id); the library's goals name steps by label, arrows
  by their ends' labels and frames by name, so no verdict depended on ids;
- an element removed by the server's `delete` entry stayed in the stored checkpoint at full opacity
  while the widget drew it nearly invisible — the stored state and the picture a person sees differ;
- the checker snaps off-palette colours to the nearest named colour; the server's own guide
  recommends colours outside Practonaut's palette;
- the client passed `structuredContent` (the checkpoint id) to the model instead of the text reply;
- the server writes into `$TMPDIR`, and its tool list includes widget-only tools (one uploads to an
  external service).

## Options considered

1. *Reuse `practonaut check`'s manual verdict (`manual-unbound`, origin `unattested`).* Says
   nothing about the tool, the reading rules or what was skipped; indistinguishable from a
   hand-submitted file.
2. *Turn the foreign file into a Practonaut session* by synthesising actions. Invents a history
   nobody made (architecture §10) and would look like a session verdict.
3. *A separate verdict level with its own provenance, bound to what the real app shows* (chosen).

## Decision (proposed)

1. **Two verdict levels in `practonaut.bench/3`.** `session` — today's verdict. `artifact` —
   **"artifact-judged, end-state only, no Practonaut history"**: the checker judges the file a
   foreign toolchain left. Every run record, report header, card, badge, JUnit property and
   comparison carries the level by name; `compare` refuses to pair runs of different levels; no
   rate, interval or aggregate pools them. Side-by-side presentation of the same tasks at both
   levels is allowed when each column names its level and no combined figure is drawn. bench/2 is
   not changed (PADR-0036); the report frame is decided once for 0.3.0 (bench/3).
2. **Bound to the real app.** A reading rule is accepted only with a differential conformance suite
   against the real, pinned application or its own conversion code: each rule's fixtures are opened
   by the real app (for Excalidraw element skeletons: the pinned engine's conversion), and the
   checker's reading must equal the real app's on the declared attributes. Any attribute that
   changes what a person sees and that the rules do not model — rotation, opacity, invisibility, a
   kept-but-deleted element, conflicting bindings or frame membership — is listed as unmodeled and
   fails every goal clause that depends on it; it is never silently ignored.
3. **Reading rules live in the checker, named and versioned.** A tolerant reader per source format
   (`excalidraw-mcp` element lists, `.drawio` files) maps the foreign form onto the judged state by
   named rules with fixtures from an independent writer (skip known pseudo-elements and list them;
   a shape's `label.text` as its label; frame `children` as well as `frameId`, a conflict being
   unmodeled; skeleton `start`/`end` as bindings; a bare `{"elements": [...]}`). The reader never
   imports `src/core` or an adapter. The rules version is part of the verdict.
4. **Strict values.** A colour, shape or other value outside the declared set is an "unmodeled
   value", never snapped; a goal clause that needs a specific value fails on it, error class named.
   The unit's prompt lists the exact values and the reading rules, so the round measures the task,
   not guessing the format.
5. **Same counter-probes**, written in the source format: an empty file, the unchanged start and a
   wrong artifact must fail before any verdict; the delivered start file, read by the same rules,
   must equal the task's start state on the declared set.
6. **Baselines go the agents' way.** `oracle`, `random` and the near misses act through the same
   foreign server over MCP as a scripted client without a language model, using the server's own
   documented operations (including its deletion path). When a documented operation does not reach
   the stored state the way the real app shows it (the spike's kept-but-deleted element), the family
   is "not supported" on that server or a named reading rule decides it — headroom that comes from a
   server defect is not headroom.
7. **The foreign server runs behind Practonaut.** Practonaut starts the pinned server (version and
   archive SHA-256 recorded) behind a stdio MCP proxy that passes only an allowlist of tools per
   pinned version, counts the calls (so "ended without a single tool call" means the foreign
   server's calls), and takes the result locator from the server's own replies, never from the
   agent's stream. The server gets its own temporary directory per run, a working directory without
   agent instruction files, an environment without credentials, and no browser opener (`BROWSER`,
   `open`, `xdg-open` neutralised). Its outbound network connections are measured during
   conformance for each pinned version and listed; a version that connects outside loopback while a
   round runs is not supported.
8. **Isolation follows the tools.** A preset that allows only an allowlisted foreign server whose
   tools have no file or network effect beyond the run's own store is "tool-restricted"; any tool
   with such an effect makes the run "template: not restricted". The report says that the foreign
   server's code runs as the same OS user, without a sandbox.
9. **State changes.** In artifact mode Practonaut holds no session state; the invariant "human and
   agent change state only through `Session.act`" applies to Practonaut sessions and is untouched.
   Architecture §10 gets a sentence saying so.

## Consequences

- bench/3 carries the verdict level, the toolchain record (server, version, archive SHA-256, start
  delivery, locator, rules version, allowlist) and the proxy's call counts; readers of `/1` and `/2`
  read them as session verdicts.
- The checker gains source-format readers with differential fixtures and rejection reasons.
- Gate rounds on foreign toolchains (PADR-0041 decision 2, PADR-0042) use this level and say so.
- Goals about the identity of start objects (an id kept from the start) cannot be judged when the
  tool lets the agent choose ids; no current family states such a goal.

## Re-assessment triggers

A foreign server changes its stored format or tool list; a reading rule accepts a file the real app
shows differently; MCP clients pass a different part of a tool result to the model; a request to
judge a toolchain whose end state is not a local file.

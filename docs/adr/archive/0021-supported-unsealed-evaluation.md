> Archived 2026-10-12: superseded by [PADR-0030](../0030-bench-replaces-unsealed-eval.md); the `eval` command no longer exists.

⛔ Superseded by [PADR-0030](../0030-bench-replaces-unsealed-eval.md) (2026-10-12): the `eval` interface is retired; `practonaut bench` scores agents on the task library. The C5 ineligibility of same-user runs stands.

# PADR-0021 — Supported unsealed evaluation and permanent C5 ineligibility

Status: accepted for the current local interface; no sealed extension approved
Date: 2026-10-09
Owner: coordinator; boundary explicitly confirmed by the maintainer in the pre-release request

## Context and evidence

`test`/`measured`: the pre-release fresh-clone baseline at
`8213669d86cbb31afc3fa5b2e18fa83b035798a2` passed `test:eval`. The current
CLI and runner refuse root and different agent UID/GID, and require explicit `--unsealed`.
The old evaluation bullet in PADR-0005 describes a future supported sealed setup that the
implementation does not provide. Independent pre-release claims review CLM-01 identified this
mismatch. A second OS account alone does not supply a safe launcher.

## Decision

- The supported interface is a non-root coordinator with the same agent UID/GID, explicit
  `--unsealed` and a bound absolute client executable. Root and foreign identity are refused.
- Reports are permanently ineligible as C5 success evidence: same-user, unsealed,
  practice, interleaving and transfer runs cannot acquire hidden-task isolation by review.
- An executable hash binds file bytes. Model, client version output and configured MCP-only
  profile are client-attested data; they do not prove publisher identity or exclusive tool use.
- A future sealed launcher is a separate maintainer decision and engineering work item.
  This record authorizes no account, container, environment, credential or publisher change.

This replaces only PADR-0005's claims of available sealed setups. Its one-host, loopback,
HTTP/SSE and stdio decisions continue unchanged. Existing historical reports remain intact.

## Options and consequences

Building a new sealed launcher before the public release was explicitly excluded by the maintainer.
Presenting an unsealed pass as C5 is incompatible with the quality contract. The bounded
local runner remains useful for diagnostic product paths while C5 stays OPEN and C6 UNKNOWN.
Voluntary human sighting and manual C7 checks remain OPEN without an additional local gate.

## Re-assessment triggers

A separately approved sealed launcher with a measured security boundary; new supported
platform identities; or any attribution claim beyond bound bytes and client-attested output.

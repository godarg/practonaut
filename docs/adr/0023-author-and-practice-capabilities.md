# PADR-0023 — Separate author and practice capabilities

Status: accepted · Date: 2026-10-09

## Recommendation and evidence

Issue separate random author and practice credentials. Give the MCP bridge only the
practice credential and require the author credential on all author/recording routes.
Keep both within the existing local, same-OS-user boundary.

`measured`: independent SEC5-03 at pre-release start commit found that the practice credential
could directly reach more powerful author HTTP routes and retrieve planted author canaries.
The seven MCP tools alone did not enforce this capability boundary. The original report,
28-route probe and opposite controls remain in the private audit archive.

## Options and decision

A bridge-only route allowlist leaves direct HTTP escalation available. Removing authoring
breaks the authorized product. Choose separate capabilities at the HTTP admission boundary.

The single-use bootstrap returns the practice token and, only on author-enabled hosts,
a separate author token to the authorised player. The existing private token file and
MCP configuration contain only the practice token. Neither token goes in argv, URLs,
diagnostics, exports, world files or project files. Compare tokens in constant time;
duplicate headers, query credentials, Host/Origin bypasses and replayed bootstrap fail.

Practice-authenticated resume returns only practice metadata and never an author token.
Author-authenticated resume may restore the already held author capability, without
minting or disclosing a new one. All `AUTHOR_ROUTES` except practice editor gesture/scene
require author authority, including `/api/record*`; prefix matching alone is insufficient.
The author token may also authorize ordinary practice routes. No seven-tool MCP capability
or client-attested `mcp-only` field grants author authority.

The player uses the tab-and-origin-scoped sessionStorage lifetime already accepted in
PADR-0016, with an explicitly versioned cache containing both held credentials. No
localStorage/cookies/URL fallback. Storage refusal permits the initial in-memory session;
invalid/expired caches clear both credentials. Same-origin scripts/extensions and the OS
user can access these credentials; this is not a sealed launcher or OS secrecy claim.

Recording deletion refuses managed saved-project references with bounded `recording_in_use`
and canonical project IDs. No implicit project cascade. An explicitly requested project
deletion accepts a strict canonical ID and safely removes the exact private managed file
without parsing its possibly damaged contents, under lock and inode/type checks. Uncertain
references in damaged entries require explicit removal of those entries first. Original
failed recordings and audit artifacts remain preserved until a user explicitly deletes them.

## Expectations, owners and rejection triggers

Security fixer owns HTTP admission and recording-store boundaries; UI fixer owns player,
author controller/catalog and tab-cache handling. Before final acceptance place real
distinct canaries in author data, prove author-positive/practice-negative controls for
every declared route, and test resume, bootstrap, reload, storage refusal, deletion of
damaged projects, in-use recording refusal and normal practice/MCP access.

Any practice-to-author elevation, credential export/leak, hidden cascade, weaker input
admission or editor-origin access rejects the change. Fresh security and UI delta reviewers
accept their respective paths; neither fixer nor original finder is the acceptor.
Existing shared-user limits remain; C5 stays ineligible for these runs. Revenue UNKNOWN.

## Independent preimplementation review, 2026-10-09

Fresh Claude Opus 5.5 (`opus`, maximum effort), process exit 0, returned PASS
for these three records together. Its original report and source/hash binding are
retained in the private pre-release audit archive. The reviewer contributed to no prior
phase or repair. This accepts the plan only; implementation acceptance remains pending.
All relevant MEDIUM/LOW findings are mandatory conditions, not deferred risks.

Use an explicit default-deny route-to-capability table. Practice editor/scene
exemptions dispatch exclusively to the PracticeController. Scan every practice-
reachable response for placed author canaries and credentials: editor/scene,
resume, observe, SSE/events, PNG, export and errors. An unredeemed bootstrap code
is author-equivalent and stays outside stdout, logs, MCP configuration and token
files. Create child windows with noopener at creation, and prove child tabs lack
authority. Agent practice uses practice-only hosts/tabs.

The cache is schema v2; clear v1 instead of reinterpreting it. Both tokens must
bind to the same host session ID. A valid practice token denied an author route
returns non-clearing author_required. No capability goes to the editor origin.
Recording reference scan and unlink use the same author-store lock as project
save/configure/open, including CLI deletion, without a hidden cascade.

The shared independent conditions C1–C10 are binding:

- C1 Deadline: monotonic from HTTP admission. Check it at every replay step, after each synchronous stage, before and after each mirror call, and immediately before an await-free synchronous commit. Bridge timeout > host deadline + measured margin; a bridge timeout means outcome-unknown and triggers a revision re-observe. Distinct catalogued deadline code (R22-01).
- C2 Post-write expiry: hold the lock until a verified restore or dispose/relaunch completes; no uncommitted mirror state may be observable; measure cleanup separately (R22-04).
- C3 Private executor: unforgeable and not exported; hoisted from apply() with identical checks and fuel. Validates the exact post-variant world, initial state, seed and taskId. External logs are validated as private copies (R22-03).
- C4 Parity and budget: golden vectors and differential tests against public apply(); worst-case host+mirror measurements; any binding view/export ceiling becomes an explicit decision (R22-02, R22-05).
- C5 Capabilities: default-deny route→capability table; exemption bound to the practice handler; all token issuance scoped; canary/token absence proven across every practice-reachable response on author-enabled hosts (R23-01).
- C6 Tab cache: v2 schema; v1 cleared; both tokens bound to the same host instance; non-clearing author_required; noopener child windows; no token to the editor origin; bootstrap code treated as author-equivalent (R23-02, R23-03).
- C7 Deletion: reference scan and unlink atomic under the author-store lock (R23-04).
- C8 Export binding: one lock acquisition; replay, snapshot and read-back from the exact native bytes; opaque byte transport; one envelope for both downloads, carrying both hashes and serialize() routing; CLI pair verification (R24-01..03).
- C9 Export limits: oversize rejected before send, never truncated; failures only through reported recovery; no session-state change (R24-04).
- C10 Acceptance only by fresh delta reviewers distinct from finders and fixers. Any failed condition, parity mismatch, late commit, elevation, leak, metadata injection or unsupported budget claim rejects the implementation.

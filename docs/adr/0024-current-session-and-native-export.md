# PADR-0024 — Export the confirmed current session and native editor artifact

Status: accepted · Date: 2026-10-09

## Recommendation and evidence

Add one authenticated revision-bound read operation for the current confirmed session
and its actual native mirror export. Let the player download each as inert data.

`measured`: E2E-04 found no export affordance in the player. Its workaround reran an
action log through the CLI rather than exporting the active session. The original run
and finding remain in the private pre-release archive. Existing adapter `exportArtifact()`
already exports native JSON and SVG; use its actual native JSON, never reconstructed UI
markup or post-hoc metadata injection.

## Options and decision

Retaining CLI re-execution misses the active-session user path. Browser reconstruction
would create a second export authority. Choose host-owned export under the same lock as
mutations, with strict `{expectedRevision}` input and the existing HTTP response budget.

POST `/api/export` is authenticated with practice or author capability and requires the
usual Host/Origin, JSON/body limits and current revision. It is semantically read-only:
no action, revision, hint, attempt, result or history mutation. Concurrent mutations cannot
cross its view/native binding. Model-only and unavailable mirrors refuse native export.
Verify committed replay and exact native semantic read-back before returning data.

The response is a versioned data envelope containing revision/hash, public world ID/version,
seed/task ID, serialized current Session, the byte-exact adapter native JSON and SHA-256
for both artifacts. It contains no token, author recording/project, checker bundle or private
directory. Routing fields stay in the envelope; native JSON receives no injected `practonaut`
or identity metadata. Checking the exported pair derives seed/task from its verified manifest.
A manual `--seed`/`--task` native check is explicitly unbound to a session.
Oversize output is rejected before response; nothing is silently truncated or committed.

The player downloads fixed-name `practonaut-session.json` and `practonaut.excalidraw` with
typed Blob/object URLs on separate explicit user clicks, then revokes the URLs. It does
not render downloaded markup or receive mirror SVG/HTML. Export busy/error states use
the existing accessible notification and focus pattern, cataloged EN/DE text and design
state register. Existing single-writer and rollback guarantees remain.

## Expectations, owners and rejection triggers

Security/host fixer owns mirror/session/HTTP export; UI fixer owns the download affordance;
root owns HTTP coverage probe integration and documentation. Before final acceptance:
real native export at current revision passes the independent checker, a genuinely wrong
unannotated artifact fails, stale/concurrent/oversize/model-only cases refuse, downloaded
hashes equal host hashes, and credentials/canaries are absent. Preserve failed artifacts.
Use the exact exported native file in a real local editor roundtrip, without excalidraw.com.

A native/session mismatch, metadata injection, hidden mutation, credential disclosure,
markup execution or broken design gate rejects the change. Fresh UI/host/Brand delta
reviewers remain separate from finders and fixers. End-state evidence does not become
C5, C6 or a human accessibility result. Revenue UNKNOWN.

## Independent preimplementation review, 2026-10-09

Fresh Claude Opus 5.5 (`opus`, maximum effort), process exit 0, returned PASS
for these three records together. Its original report and source/hash binding are
retained in the private pre-release audit archive. The reviewer contributed to no prior
phase or repair. This accepts the plan only; implementation acceptance remains pending.
All relevant MEDIUM/LOW findings are mandatory conditions, not deferred risks.

The bounded mirror export must read back the exact returned native bytes through
the independent checker import path. One lock binds replay, committed snapshot,
read-back and unchanged revision/hash. Both downloads use one cached envelope;
show its revision and mark it stale after mutations.

The practonaut.export/1 envelope carries two opaque UTF-8 payloads. Native output
is unchanged. The practonaut.export-pair/1 session manifest carries revision/hash,
routing exactly equal to Session.serialize(), the serialized session, a SHA-256
of its canonical JSON UTF-8, and the SHA-256 of exact native UTF-8. The enclosing
envelope separately hashes the whole manifest download, avoiding a self-hash.
CLI --pair strictly validates the manifest, both payload hashes, routing and
independent replay; the player Blobs exact strings without reserializing them.
Non-ASCII and astral labels are tested. Native output is scanned for tokens,
author canaries, mirror origins/ports and private paths; fix configuration instead
of rewriting output on a hit.

Model-only export refuses the whole pair. Oversize output returns result_too_large
before sending. Failure may perform the existing reported mirror recovery and
clear a mirror-derived result, but changes no revision, log, history, attempt or
hint. It never manufactures an export or a successful semantic mutation.

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

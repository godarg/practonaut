# PADR-0022 — Validated replay and one transaction deadline

Status: accepted · Date: 2026-10-09

## Recommendation and evidence

Use an internal validated transition executor and enforce one monotonic deadline from
request admission through the last pre-commit check. Keep public `apply` fully validating.
This repairs the existing PADR-0014 deadline; it introduces no new execution capability.

`measured`: the independent pre-release architecture review at start commit
`8213669d86cbb31afc3fa5b2e18fa83b035798a2` found repeated world/prefix validation in
every replay step and three full replays per mutation (ARCH-P5-02). Its p04/p04b/p11
original probes and report are retained in the private pre-release audit archive. The
5,000/9,000-action timings include concurrent load; they are observations, not a
platform-independent performance promise. A bridge timeout did not stop a late host commit.

## Options and decision

1. Repeated validation preserves correctness but violates the already declared budget.
2. Removing replay checks or silently reducing the advertised action limit hides the defect.
3. Validate each external boundary once, reuse only privately validated context within
   the same immutable Session, and retain full independent replay comparison. Choose 3.

The optimized executor is not a public skip-validation flag or exported runtime API.
The Session clones and validates its world and initial state. Every externally supplied
action and every resulting state remains validated. A replay validates the complete
log/context before traversing it, rather than revalidating every growing prefix.
Creation IDs and canonical hashes retain their exact existing bytes; optimization may
not replace the full action prefix with a different identity input. Prefix storage stays
private and cannot be mutated through getters. Public `apply` remains suitable for
arbitrary untrusted world/state/action/context inputs.

The host retains committed-session replay, tentative reconstruction and candidate replay.
Its deadline begins before the first guard. It is checked between bounded replay steps,
after synchronous stages, before/after mirror work and immediately before publication.
The mirror operation uses the remaining request budget. Expiry never publishes the
candidate, emits a successful mutation or increments revision; rollback/recovery destroys
late mirror writes before reuse. Cleanup may take longer than the admission deadline and
must be measured separately. A timer cannot preempt synchronous JavaScript; cooperative
checks between bounded steps are therefore part of this contract.

## Expectations, owners and rejection triggers

Correctness fixer owns private replay optimization; security/host fixer owns the request
deadline. Before final acceptance measure 300/2,000/5,000/9,000-action sequences, deterministic
creation/undo/replay parity and world/action/state negative controls. Report successful-step
median, p95 and maximum on the measured platform, including restore operations. Demonstrate
that a deliberately slow mirror and a slow replay cannot commit after expiry.

Retain the existing 10,000-action admission limit unless measurements require a new explicit
decision. Any mismatch, externally reachable validation bypass, late commit, or unsupported
budget claim rejects this implementation. Fresh delta reviewer rechecks the optimized paths;
the original finder and either fixer cannot accept them. No sealed isolation, C5, human
usability, time-saving or competence claim follows. Revenue impact remains UNKNOWN.

## Independent preimplementation review, 2026-10-09

Fresh Claude Opus 5.5 (`opus`, maximum effort), process exit 0, returned PASS
for these three records together. Its original report and source/hash binding are
retained in the private pre-release audit archive. The reviewer contributed to no prior
phase or repair. This accepts the plan only; implementation acceptance remains pending.
All relevant MEDIUM/LOW findings are mandatory conditions, not deferred risks.

The deadline starts at HTTP admission. The MCP bridge timeout must exceed the
host deadline plus a measured response margin; a bridge timeout reports outcome
unknown and re-observes revision. A distinct bounded deadline failure does not
create an integrity diagnostic. Post-write expiry retains the writer lock through
verified restore or dispose/relaunch; PNG, checker, export and editor may never
observe an uncommitted candidate. There is no await between final check and commit.

Creation-ID prefix hashing remains O(prefix) unless a byte-identical streaming
scheme is independently proven. This implementation chooses explicit bounded-cost
measurement, including maximal creations after long prefixes and undo/redo. It
claims no constant-time creation IDs. Validate exactly the private post-variant
world, initial state, safe-integer seed and task ID. Differential tests use the
unmodified public apply path and original 8213669d golden vectors; an independent
checker remains necessary because repeated use of one executor is not a second
oracle. Measure real host/mirror operations at 300/2,000/5,000/9,000 actions and
report median/p95/max and separate cleanup. If the 3 MiB view or export budget binds
first, record that actual limit and obtain an explicit architecture decision before
changing any ceiling.

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

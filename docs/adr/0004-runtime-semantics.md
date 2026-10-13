# PADR-0004 — Pure deterministic runtime with atomic actions and explicit unknowns

Status: accepted · Date: 2026-10-03

## Context
Learners and agents must be able to rely on: the same inputs give the same outcome, a rejected
action changes nothing, and unknown behaviour is never invented (quality contract I1–I4).

Evidence (`measured`, `spikes/runtime-parity/REPORT.md`): a pure core reproduced the same final
hash across three runs, fresh processes, macOS and a Linux container, and against an independent
Python recomputation; reset returned the initial hash; a per-step hash comparison did **not**
catch a UI shortcut that produced the same state without logging, while replay comparison did.

## Decision
- `apply(world, state, action) → { ok: true, state, effects } | { ok: false, error }` is pure:
  no clock, no I/O, no network, no language model, no ambient randomness.
- State is plain JSON keyed by semantic ids. Geometry and other quantities are integers in
  declared units (fixed point); floats are rejected in state.
- State hash = SHA-256 of canonical JSON (RFC 8785 rules; `src/canonical/`).
- Randomness only through a seeded generator declared by the world, used for variant
  generation at session start.
- An action is atomic: preconditions, then all effects from confirmed rules. If any required
  effect is not covered by a confirmed rule, the action returns `unmodeled` and the state is
  unchanged. Hypotheses never execute.
- Errors are structured `{ code, message, details }` with stable codes.
- Session = world version + seed + action log. Undo pops the log (snapshot per step; state is
  small). Reset returns to the seeded initial state. Both are exact (same hash).
- Every surface reports the hash after each action. The host enforces replay consistency
  (`hash == replay(seed, log)`) at every checkpoint, before every result check and export, and on
  every step in test and debug builds; a mismatch is a fatal session error, never a warning.
  Only `Session.act` mutates state; the player and the agent bridge have no other write path.
- Semantic ids are never reused. An object created during a session gets an id derived from the
  session seed and the hash of the **action-log prefix up to and including the creating action**
  (not from the step number alone). After an undo and a different action at the same step, the
  prefix differs and so does the id; replaying the same prefix reproduces the same id, which then
  denotes the same object. Ids stay reconstructible from world version, seed and log. A deleted
  object stays as a tombstone in state so that relations to it are detectable, and relations may
  only point to live ids (independent review finding F5,
  a private review record; branch-identity gap found by
  the Codex audit of 2026-10-03, a private review record #4).
- `act` carries an optimistic precondition (`baseStep` or `baseHash`) once more than one actor
  can act on a session; a stale request is rejected, not merged.
- Application nondeterminism (timestamps, revision counters, random ids, font metrics) is
  handled in the adapter: app ids are derived deterministically from world id and semantic id in
  the app's id format (for example UUIDv5), so a new semantic id always yields a new app id;
  volatile fields are excluded from the semantic subset, and each excluded field is listed
  in the world's adapter binding.

## Consequences
Rules must be expressible over integer state. Undo by snapshot costs memory proportional to
steps × state size; limits are set in the threat model. Concurrency semantics are explicit.

## Re-assessment triggers
A supported world whose state is too large for per-step snapshots; a needed effect that cannot
be expressed over integers; a measured cross-platform hash difference.

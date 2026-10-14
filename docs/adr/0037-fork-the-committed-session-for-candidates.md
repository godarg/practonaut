# PADR-0037 — Transaction candidates fork the committed session; the world is validated once

Status: accepted 2026-10-14 after independent review (pull request #25) · Date: 2026-10-14 · Roadmap 0.2.0, Must 1 · Refines
[PADR-0022](0022-linear-replay-and-transaction-deadline.md) ("the host retains committed-session
replay, tentative reconstruction and candidate replay")

## Context

Measured on the published 0.1.0 on 2026-10-14 (`tools/measure-agent-surface.ts`, 72 `act` calls
after 8 warm-up calls on `excalidraw/connect`, macOS arm64, Node 22): the client waits 133.7 ms
(median) for one `act` without the mirror and 150.0 ms with it; the host reports 100 ms and 128 ms
of its own processing. The pure core needs 0.04 ms per action. The difference is repeated
validation and copying, not work an action needs:

- the host rebuilt every candidate with `new Session(world, …)` and replayed the whole log into it
  (`candidateFromLog`); the constructor validates the world twice and the executor a third time
  (about 12 ms each for the library world);
- the committed session was replayed in the request guard and the candidate replayed again before
  publication, and every replay created a fresh executor that validated the world again;
- `Session.world` returned a deep copy of the whole world on every read, and building one view read
  it about five times.

## Options considered

1. **Cache validated worlds by object identity** (a module-level map). Keeps the code shape but
   makes validation depend on callers never mutating a world they passed in, which nothing enforces.
2. **Drop the replay checks.** Fast, but removes the protection PADR-0022 and architecture §9 rely
   on ("full replay precedes every check").
3. **Validate once, freeze, and fork** (chosen): the Session freezes the world it validated and
   shares it; a transaction candidate is a fork of the committed session instead of a rebuild;
   replays reuse the private executor over that validated world; the replay checks stay where they
   protect a result.

## Decision

1. A `Session` validates its post-variant world and initial state once, as before, and then
   deep-freezes both. `Session.world` returns the frozen world without copying; writing to it throws.
2. `Session.fork()` returns an independent session at the same step: it shares the frozen world and
   initial state, and copies the state, log, undo snapshots and the executor's action prefix. It
   neither re-validates nor replays. The fork is made through a module-private parts object; no
   caller can hand a session an unvalidated world, state or prefix, and the executor is still not
   exported (PADR-0022 C3).
3. `replay` starts a fresh private executor over the session's validated world instead of validating
   the world again. The log is still validated as a private copy before traversal, every step's
   hash is compared, and creation ids keep their exact bytes (the full action prefix stays the
   identity input).
4. The host builds every mutation candidate (act, undo, editor gesture) by forking the committed
   session. Before publication the candidate's **full history is replayed** and compared, as before.
   The committed session is replayed **before every result check and every export** (architecture
   §9), and no longer before every mutation: it was replay-verified as a candidate when it was
   committed, and nothing changes it between commits. Reset and task or variant changes still build
   a new session from the world.
5. The deadline contract of PADR-0022 (C1, C2) is unchanged: the deadline is checked after the fork,
   between stages, before and after mirror work and immediately before an await-free commit.

## Consequences

- Measured on the same machine on 2026-10-14 (median of 72 calls): host processing per `act` 5 ms
  without and 31 ms with the mirror (0.1.0: 100 ms and 128 ms); the client round trip is in
  PADR-0038, which also changes the reply size.
- Long logs (PADR-0022 C4), per mutation in the core — fork, act and the candidate's full replay —
  against 0.1.0's committed replay, rebuild and candidate replay, median of 5 on the library task
  `connect` with `move_step` actions, on a loaded machine: 20 vs 277 ms at 300 actions, 65 vs 313 ms
  at 2,000, 162 vs 615 ms at 5,000, 264 vs 1,156 ms at 9,000. The cost stays linear in the log and
  inside the 2-second step budget; the 3 MiB view budget, which includes log and history, binds
  before the 10,000-action limit, as before.
- The executor's validated world is frozen as well, so a fork, a replay and the live session can
  never disagree about a world one of them changed.
- Code that wrote to `session.world` would now throw; nothing in the repository does
  (`tests/unit/core.test.ts` pins the frozen world and the independence of a fork).
- A defect that corrupted the committed session between two mutations would surface at the next
  check or export instead of the next mutation; candidate replay still guards every publication.

## Re-assessment triggers

A measured replay cost that grows with long logs beyond the 2-second step budget (PADR-0014); a
second application whose session state is not plain frozen JSON; any finding that a fork shares
mutable state with its origin.

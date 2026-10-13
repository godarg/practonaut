---
paths:
  - "src/core/**"
  - "src/predicate/**"
  - "src/world/**"
---

# Deterministic core

- No `Date`, `performance`, `Math.random`, `crypto.randomUUID`, timers, I/O, network or model
  calls in these modules; randomness only through the world's seeded generator (PADR-0004).
- State is integer JSON keyed by semantic ids; floats are rejected. Hash with `src/canonical`.
- Actions are atomic: on any uncovered effect return `unmodeled` with the state unchanged.
- Semantic ids are never reused; deleted objects stay as tombstones; relations point to live ids.
- Hypotheses never execute; only rules with evidence references do.
- Every new rule or action needs a replay test with a golden hash whose expected value comes from
  an independent derivation (hand calculation, the real app, or a second implementation).

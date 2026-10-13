# PADR-0013 — Bounded predicates over normalized state

Status: accepted · Date: 2026-10-03

## Decision

Use the closed AST in `src/world/types.ts`: boolean constants, all/any/not, scalar comparisons,
and exists/every/count over live frame/step/arrow objects. Values are literals, allowlisted
object fields, or counts. There is no code, regex, external lookup or callable supplied by a
world. Quantifiers bind named variables with lexical scope. Deleted objects are excluded.

Validate AST depth and node counts before recursive schema validation or evaluation. Debit
fuel for AST nodes, values and each visited object, including short-circuit paths; exhaustion
is `checker_fuel_exhausted`, never a false goal or a pass. Default ceiling: 10^6 steps per task
(threat model §4). Callers may lower limits. Fuel alone does not replace depth and input limits.

## Context and options

`documented`: PADR-0004 requires pure integer state and atomic rules; world-format §2 requires
declarative predicates; learning-and-evaluation §3(a)(1) requires result properties, not paths.
`assumption`: this vocabulary suffices for flow-diagram; integration tests will falsify that.
JSONLogic or embedded expressions add operations irrelevant to this pilot; procedural checker
code in a world violates PADR-0003. A general graph language is deferred until a measured need.

## Expectation and re-assessment

Before phase completion, each task accepts a distinct valid arrangement and rejects a near
miss, empty state, unchanged start and wrong artifact. Depth/fuel attacks must fail with named
errors without stack exhaustion. A goal requiring path matching or an executable extension
blocks this decision and requires a new ADR before implementation.

# PADR-0041 — Headroom where agents fail, and the first checkpoint after the 0.3.0 launch

Status: accepted on the merge of the "0.3.0 plan" pull request · Date: 2026-10-18 · Records maintainer
decisions D1 and D9 of 2026-10-17; wording reviewed by a fresh Claude reader, OpenAI Codex
`gpt-6.1-sol` and Google `gemini-3.8-flash` before the merge · Amends
[PADR-0033](0033-product-direction-measurement-you-can-act-on.md) (vision §5 and §7, the
roadmap's zero-family branch and first checkpoint)

## Context

- **Ladder round 1 found no headroom on Practonaut's own actions.** Five candidate families went
  through the preregistered gate of [PADR-0040](0040-challenge-tier-generated-families-and-gate.md)
  on 2026-10-15 and 2026-10-16. Every round was valid (oracle 26/26, random 0/26, every near miss
  failed, no infrastructure error), and none passed: Opus and Sonnet solved 26 of 26 held-out
  instances in every family, Haiku 26 of 26 except `tight-budget` (24 of 26)
  ([gate reports](../benchmarks/challenge/README.md)). On Practonaut's own surface the goal is a
  complete public specification, the semantic actions map one to one onto it, every reply is
  compact and confirmed, and `check_result` answers with the unmet conditions. Our hypothesis, not
  a measured cause: that surface is built to be easy to act on correctly, which is what a tool
  should be, and leaves current models little to get wrong. Only difficulties up to 3 were tried.
- **PADR-0033 named this case.** Its re-assessment trigger is "no challenge family passes the gate
  after two ladder rounds", and the roadmap's zero-family branch says what happens then. A second
  round of harder variants of the same five families would cost about 87 model runs each (0.2.0 had
  30 left) and would test the same surface that just saturated at difficulty 3.
- **Where agents act in production, the surface is different.** The bring-your-own-tools spike
  ([report](../../spikes/byo-tools/REPORT.md)) showed that the official Excalidraw MCP server leaves
  a readable end state, but in its own element format: the agent chooses ids and coordinates itself,
  draws whole scenes in one call, has no read-back and no check button, and deletions are not
  reliably stored. One model passed three easy library tasks there; how agents fare on harder tasks
  through such tools is **unmeasured**. Two further kinds of task are open: layouts judged by
  geometry (no overlaps, alignment, spacing, arrows that do not cross, everything inside its frame),
  which no library goal states today, and a person changing the board while the agent works, which
  the roadmap deferred to 0.3.0 behind a scenario record. Whether either spreads agents is a
  hypothesis; this record does not claim it.
- **0.2.0 was not announced.** By maintainer decision the public launch comes with 0.3.0. The
  first North Star checkpoint ("six weeks after 0.2.0 ships, at the latest 2027-02-28") would count
  external projects for a release nobody was told about.

## Options considered

**Headroom.**
1. *A second round of the five families, harder, on Practonaut's own actions.* Cheapest to build;
   tests the surface that saturated; a pass would show difficulty knobs, not a property of the
   tools agents use.
2. *Stop the headroom bet; keep the library as a smoke test.* Honest, but gives up the question
   0.3.0 asks ("can I score *my* toolchain?") where a score would matter most.
3. *Seek headroom where agents act in production and on task types the library lacks, each behind
   a cheap pre-probe* (chosen): the same families through foreign toolchains in artifact mode, and
   new family types (spatial layout, a human editing mid-run).

**The first checkpoint.**
1. *Keep 2027-02-28.* Measures an unannounced release; a miss would say nothing about the product.
2. *Six weeks after the 0.3.0 launch, at the latest 2027-04-30* (chosen).
3. *Drop the first checkpoint.* Removes the earliest falsification point; rejected.

## Decision

1. **Zero-family branch for Practonaut's own actions.** The five 0.2.0 families (`repair`,
   `injection`, `long-horizon`, `limited-checks`, `tight-budget`) get no second round on
   Practonaut's own actions. Until a family passes a gate, the bundled tasks are presented as
   **"library, not a challenge tier"**: an example set and a shared smoke test, not a measure of
   ability, and the documentation that names them says so.
2. **The unit of gating is a family on a toolchain.** A *toolchain* is the way the agent acts:
   Practonaut's own actions over MCP, or a foreign MCP server whose result Practonaut judges in
   artifact mode (the verdict level of [PADR-0043](0043-artifact-judged-verdict-level.md)). A
   family that passes on one toolchain is published for that toolchain only. On foreign toolchains
   round 1 covers `repair`, `injection` and `long-horizon`; `limited-checks` and `tight-budget`
   do not apply there, because a foreign server knows no Practonaut limits. These rounds start
   only once artifact mode exists.
3. **New family types.** A spatial-layout family (new bounded predicates over the judged geometry,
   each decided by its own record before code) and the "a human edits mid-run" family (its scenario
   record first, as the roadmap requires). Both may be developed while the adapter registry and
   draw.io are built.
4. **A pre-probe before every gate.** A unit enters a gate round only after a pre-probe of its
   strongest configuration passes between 10 % and 80 % of its instances. Pre-probe size, the
   ladder, the gate pair, the preregistered units and the budget per round are fixed by
   [PADR-0042](0042-gate-for-families-on-toolchains.md) before any run.
5. **First checkpoint.** At least one external project within six weeks after the 0.3.0 launch
   (the maintainer's first public announcement of Practonaut), at the latest 2027-04-30. Later
   checkpoints (10 projects by 2027-06-30, 50 by 2027-12-31) stay as they are. What a missed first
   checkpoint changes is decided by the maintainer on that day between the plan and the narrowed
   plan in the roadmap; the roadmap carries the proposal for that decision until the maintainer has
   made it.

## Consequences

- Vision §5 and the B2 and B3 rows of §7 change as stated; the roadmap's 0.3.0 section, its "If a
  spike aborts" table and its checkpoint table follow this record.
- The README, the benchmark documentation and the challenge-tier page use the label "library, not
  a challenge tier" until a family passes; result surfaces may add it later.
- Gate reports and ledgers of 0.2.0 stay as they are; 0.3.0 counts its own model runs from zero
  (PADR-0042).
- Artifact-mode rounds depend on foreign servers whose versions change; every round pins the
  server version and records its archive hash.

## Re-assessment triggers

- The first three pre-probes all fall outside 10–80 %: stop, raise the difficulty through new
  generator versions before probing further, and report.
- No unit passes its pre-probe, or no unit that entered a gate passes it, by the 0.3.0 release:
  report it, and re-assess the headroom bet with the maintainer before 0.4.0.
- A foreign server's terms, licence or format make artifact-mode runs impossible.
- The first checkpoint is missed.

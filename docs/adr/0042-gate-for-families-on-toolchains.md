# PADR-0042 — The 0.3.0 gate: families on toolchains, a vendor-neutral ladder, a pre-probe and its own budget

Status: proposed · Date: 2026-10-18 · Amends the gate preregistration of
[PADR-0040](0040-challenge-tier-generated-families-and-gate.md) for rounds of 0.3.0; PADR-0040
stays binding for everything this record does not change · Implements maintainer decisions D1, D2
and D4 of 2026-10-17 (maintainer approval of the non-Claude ladder agents in the sense of PADR-0040's
`--maintainer-approved`) · To be accepted with the pull request that changes `src/challenge/` and
`tools/challenge.ts`, after independent review and before any 0.3.0 model run

## Context

[PADR-0041](0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md) moves the
search for headroom to families on toolchains (Practonaut's own actions, or a foreign MCP server
judged in artifact mode) and to new family types, each behind a pre-probe. The maintainer widened
the ladder beyond Claude (D2: Claude through the subscription, GPT through Codex CLI, Gemini through
Gemini CLI, local open-weight models through an external agent CLI) and gave 0.3.0 its own budget
(D4: at most 800 subscription model runs; per unit and round at most 100, that is
(held-out + pre-probe) × subscription agents ≤ 100; at most three subscription agents per gate
round, local models in addition; at most two rounds per unit).

The 0.2.0 gate tool cannot run such a round. Its sizes are schema literals (9 development runs, 26
held-out instances, 87 runs per round, `src/challenge/declaration.ts`), its release count is "35
plus every earlier round committed in the same folder" with a budget of 500 — the five committed
0.2.0 rounds already count 470 — its model check accepts only `claude-(opus|sonnet|haiku)` through
the `claude-code` preset, it requires exactly three agents, one prompt, one API key source and one
Claude Code release line across all reports, and it attributes spent runs through Claude's own
`system/init` line, so runs of other clients would collide (`src/challenge/gate.ts`,
`src/challenge/files.ts`). Vision §6 principle 2 requires a ladder of **at least three agents**.

Power of the gate at its held-out sizes (exact McNemar, α = 0.05, computed exactly): when two agents
disagree on 20 % of the instances, all in the stronger one's favour, P(D ≥ 6) with D ~ Bin(n, 0.2) is
0.34 at 24, 0.42 at 26, 0.50 at 28 and 0.57 at 30. For independent per-instance outcomes with the
20-point rule as well: strongest 0.5 against weakest 0.2 gives 0.46 / 0.50 / 0.54 / 0.59 at
24 / 26 / 28 / 30 instances; 0.6 against 0.2 gives 0.72 / 0.77 / 0.81 / 0.84.

## Options considered

**Who runs the pre-probe.**
1. *Every subscription agent of the ladder on k development instances* (D4's formula reads this
   way). Keeps 0.2.0's sanity check of the capability order; costs k × 3 runs per unit, and only the
   strongest agent's result decides entry.
2. *The strongest configuration only, on k development instances.* Cheapest per unit; loses the
   order check; the held-out seeds then follow from the strongest agent's runs alone.

**How many pre-probe instances, entry at 10–80 % of the strongest (inclusive).** Probability that a
unit enters, by the strongest agent's true pass rate p:

| k | enters at | p = 0.1 | 0.3 | 0.5 | 0.7 | 0.8 | 0.9 | 0.95 |
|---|---|---|---|---|---|---|---|---|
| 7 | 1–5 | 0.52 | 0.91 | 0.93 | 0.67 | 0.42 | 0.15 | 0.04 |
| 10 | 1–8 | 0.65 | 0.97 | 0.99 | 0.85 | 0.62 | 0.26 | 0.09 |

**Gate pair.**
1. *First and last subscription agent of a declared capability order within one vendor (default
   Opus and Haiku).* The order is known before any run and is the same as in 0.2.0; agents of other
   vendors and local agents run on the same instances and are reported, outside the verdict.
2. *Across vendors by an external ranking fixed at declaration.* No ranking measures these tasks; an
   inverted pair almost surely fails a family that does discriminate (PADR-0040).
3. *Strongest subscription agent against a local model as the weakest.* Free runs, but a weakest
   agent near the random baseline shows little that random ≤ 5 % does not already show.

**Held-out size with three subscription agents:** 26 (as 0.2.0) or 28 (power 0.50 instead of 0.42).

## Decision (proposed; the review decides the open options)

1. **Unit.** A unit is a family on a toolchain, written `<family>.<toolchain>` (for example
   `repair.excalidraw-mcp-0.3.2`, `layout.practonaut`). The toolchain is part of every file name,
   world id and held-out seed derivation. Families that rely on limits only Practonaut's host
   enforces (`limited-checks`, `tight-budget`) and the co-actor family are refused on foreign
   toolchains.
2. **Declaration `/2`.** `practonaut.challenge-declaration/2` names the release (`0.3.0`), the unit,
   the round, the pre-probe record, the ladder and the sizes. `/1` declarations stay readable as
   0.2.0 rounds and are never counted into 0.3.0.
3. **Release budget.** 0.3.0 counts its own subscription model runs from zero, at most 800: every
   bench run of a model agent through a subscription (Claude, GPT, Gemini), pre-probes, development
   runs and reruns included. Runs of local models, of the built-in agents, of reviews and of
   subagents do not count. The count is derived from committed records whose release field is
   `0.3.0` — pre-probe records (also refused ones), declarations, gate ledgers and a release ledger
   for runs outside gate rounds (preset examples, red-team runs, acceptance runs, the release
   walkthrough) — never from the folder they sit in. A declaration or gate whose count would pass 800
   is refused ("budget exhausted — a maintainer decides").
4. **Ladder.** At least three agents, at most three of them through a subscription, declared in
   capability order; local agents in addition. Allowed without further approval (maintainer
   decision D2): Claude Opus, Sonnet and Haiku through `claude-code`; GPT through the Codex preset
   and Gemini through the Gemini preset, each only after its terms check is recorded and — where its
   tools cannot be limited to the round's MCP tools — after a recorded red-team run showed that it
   cannot read oracle or reference files; otherwise it runs as "template: not restricted" and the
   gate refuses it. Local agents run through an external agent CLI against a local
   OpenAI-compatible endpoint; Practonaut never calls a model. Every run's model comes from its
   client's own output or, where a client reports none, is the model the preset requested, labelled
   so; a run without either counts as not passed.
5. **Gate pair.** Option 1: strongest = first, weakest = last subscription agent of the declared
   order, both of one vendor whose capability order is known (default Opus and Haiku).
6. **Pre-probe.** k = 10 development instances (seeds 1–999), one run each, with the round's
   settings; the unit enters the gate when its strongest agent passes 1 to 8 of them. The record is
   committed whether the unit enters or not. Its runs are the round's development runs: digested in
   the declaration, they fix the held-out seeds. A unit outside the band may be retuned and
   pre-probed once more on new development seeds. *Open for the review:* option 1 or 2 above.
7. **Round size.** 28 held-out instances per subscription agent; the tools refuse fewer than 24
   held-out instances, more than three subscription agents, fewer than three agents and a round of
   more than 100 subscription runs. *Open for the review:* 26 or 28.
8. **Clients.** Every client is pinned for a round (a copy of one version first in `PATH`). Per
   client, a patch update during a round is listed in the gate report and another minor or major
   version refuses the round (PADR-0040's rule, per client). Prompt equality applies per unit, API
   key source equality per client.
9. **Unchanged from PADR-0040:** headroom 10–80 %, discrimination ≥ 20 points with exact McNemar
   p < 0.05, oracle 100 %, random ≤ 5 %, every near miss fails, more than 5 % infrastructure errors
   voids the round, at most two rounds per unit, a second round only on new held-out instances.

## Consequences

- `src/challenge/` and `tools/challenge.ts` change before any 0.3.0 model run; the integration test
  of a whole round without a language model covers a 0.3.0 round with stand-ins for two vendors'
  clients and a local agent, and shows that the committed 0.2.0 rounds are not counted.
- Gate reports and ledgers of 0.3.0 go to `docs/benchmarks/challenge/0.3.0/`; those of 0.2.0 stay.
- A unit's held-out instances differ between toolchains (each unit derives its own seeds); a paired
  comparison of toolchains on identical instances is a separate report, not a gate.

## Re-assessment triggers

A vendor's terms forbid automated runs through its subscription; a client cannot report its model
or its limits; a pre-probe admits a unit whose gate finds the strongest above 80 % (the pre-probe is
too small); the budget runs out before the planned units are gated.

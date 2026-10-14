# PADR-0035 — `design:capture` and `design:invariants` are not built until a review needs them

Status: proposed · Date: 2026-10-14 · Roadmap 0.2.0, Must 0 · Amends decision 8 of
[PADR-0020](0020-design-system-v1.md)

## Context

PADR-0020 decision 8 lists four guardrails: `design:lint`, `design:invariants` (rendered computed
styles measured against the token scales in every state), `design:capture` (contact sheets for
review) and the decision protocol. Two of them exist: `npm run design:lint` runs in `npm run check`,
and the decision protocol is in `AGENTS.md`, `.claude/rules/` and the design language §13. Neither
`design:invariants` nor `design:capture` is in `package.json` or `tools/` in 0.1.0; a historical
review record (`docs/design/product-recovery.md`) still names them. Visible changes are reviewed with
screenshots of the states in `tests/support/player-states.ts`
([review protocol](../design/review-protocol.md)), and `npm run test:a11y` measures axe and reflow on
the same states. A document that names tools which do not exist misleads contributors and agents
into looking for them, and building them now would add verification machinery without a reader
(vision, principle 9).

## Options considered

1. **Build both now.** Matches PADR-0020's text; no review in 0.2.0 has asked for either, and the
   screenshots, `design:lint` and `test:a11y` already cover the reviews that run.
2. **Delete them from PADR-0020.** Records are not edited to change a decision (PADR-0001).
3. **Record that they are not built until a review needs them** (chosen).

## Decision

1. `design:capture` and `design:invariants` are not built and not referenced as existing. PADR-0020
   gets a leading pointer to this record; its other decisions stand.
2. The design guardrails in force are `design:lint` and `design:contrast` (both in `npm run check`),
   `test:a11y`, the living gallery (`design:gallery`) and the screenshot review of the review
   protocol.
3. Either tool is built when a review finds a defect it would have caught and the existing tools did
   not, with a test and a reader named in its pull request.

## Consequences

- Visual regressions in computed styles are found by people looking at screenshots, as in every
  review so far, not by a measuring tool.
- Historical review records keep their wording; they describe what was planned then.

## Re-assessment triggers

A review finds a token-scale violation in rendered styles that `design:lint` cannot see; a second
application with its own board; more than one design reviewer, where shared contact sheets save work.

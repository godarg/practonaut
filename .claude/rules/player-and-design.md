---
paths:
  - "src/player/**"
  - "design/**"
  - "docs/design/**"
---

# Player and design

Design system v1 is the **maintainer-accepted baseline (2026-10-09, PADR-0020)**: every extension
reuses it and meets the same bar. Before any visible change: follow `docs/design/design-language.md`
§13 (decision protocol). Kit first (`src/player/ui/`, `npm run design:gallery`); values only from
`design/tokens.css`; a missing value becomes a token (light and both dark blocks identical,
contrast pair in §7.2).

- Gates: `npm run check` includes `design:lint` (`file:line rule message`); run `npm run test:a11y`
  for player or design changes. Fix the product, never widen a test; a rule change needs a PADR.
- Look: screenshot every state you touched (light/dark, EN/DE, 1280/390) from a committed state
  and look at it. Not looked at means not done (`docs/design/review-protocol.md`).
- New screens and states: add them to `tests/support/player-states.ts`, with `view` when the
  reader scrolls to them; a new component goes into the kit, the gallery and §9.
- Embedded editor, shell grid or camera: foreign UI is never clipped by our layout.
- Never `innerHTML` or inline style; author text is text; every UI string in the EN/DE catalogs.
- Keyboard path for every action, visible focus, status never by colour alone, reduced motion,
  reflow at 320 px. Board mode says it shows the model; never present it as the real application.
- Automated scans never replace the open human checks (`docs/design/manual-player-checks.md`).

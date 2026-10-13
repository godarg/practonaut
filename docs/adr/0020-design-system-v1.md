# PADR-0020 — Design system v1: Apple-grade language, one shell, enforced by tools

Status: accepted for the local player; **accepted by the maintainer as the binding design baseline on
2026-10-09** after independent review round r5 (PASS on all four surfaces, recorded in
`docs/design/design-language.md` §16). Every later visible change extends this baseline under §13 of
the design language; a change to its principles, token scales or banned patterns needs a new PADR.
Date: 2026-10-07. Mandate: the maintainer's direction of 2026-10-07 to rethink
the design from the ground up, with the quality of years of platform-level refinement, and to make
sure later work by people and agents keeps that quality.

## Context

The recovery pilot (PADR-0015 to PADR-0019) was technically complete but looked and felt like a
prototype: a serif title over grey boxes, default form controls, a mode switch at the bottom of the
page, an author flow shown as six accordions of dense text, technical vocabulary in the normal path.
The maintainer rejected the design. Measured evidence (`measured`, baseline renders 2026-10-07): the
mode switch sat below 2,000 px of page; the author path showed five forms before the drawing
surface; three different mechanisms presented the same goal text. The earlier language (v0.1) was
deliberately austere ("a workbench, not a show": hard shadows, no pills, serif titles) and could
not be polished into what was asked; it was replaced, not tuned.

## Options considered

1. **Tune v0.1** (new CSS on the old structure). Cheapest, keeps the austere identity. Rejected: the
   structure itself (page order, accordions, per-concept panels) caused the findings.
2. **Adopt a third-party design system** (Radix, Material, Carbon). Fast and accessible, but it
   brings a runtime dependency, a bundle, a foreign look, and nothing that belongs to the product.
   Rejected by PADR-0002/0012 (no new runtime dependency, offline static bundle).
3. **Own system built on platform conventions** (system font stack, concentric shapes, one accent,
   soft elevation, selective translucent chrome) with a typed component kit, a living gallery and
   mechanical guardrails. Chosen.

## Decision

1. **Language.** `docs/design/design-language.md` v1.0 replaces v0.1 (archived as evidence).
   Principles P1 to P8, a role-based type scale on the platform interface font (SF Pro on Apple
   systems, no webfont), Apple-neutral surfaces with one accent, four status hues that always carry a
   shape and a word, concentric radii with the rule "a capsule is pressed, a rounded rectangle holds
   content", three elevation levels, selective glass only for floating chrome, and purposeful motion
   with a reduced-motion twin.
2. **Tokens.** `design/tokens.css` is rewritten; no compatibility layer for the old names. The
   contrast pairs in the language's §7.2 remain the source for `npm run design:contrast`
   (96 pairs × 2 themes).
3. **Kit.** `src/player/ui/` holds typed factories (button, segmented, chip, banner, card, fields,
   status and evidence marks, disclosure, sheet, empty state) and the icon set; `src/player/css/ui.css`
   styles them. Surfaces compose the kit. Markup is built without `innerHTML` (Trusted Types) and
   without `data:` URIs (CSP `img-src 'self' blob:`).
4. **Shell and stage.** One persistent app bar; the three workspaces (Practice, Excalidraw, Create)
   are switched there. The stage is one CSS grid with named areas. Persistent nodes (the real editor
   iframe, PADR-0017 item 4) and re-rendered nodes are siblings placed by area, so the editor never
   reparents and never reloads.
5. **Practice.** Task head; canvas with a context-following floating tool palette and a coach pill;
   an always-visible object tray (the keyboard and screen-reader route to arrows); a sticky inspector
   with one Goal checklist (met/not met/stale), Hints, History with consequences in context, and a
   "how this is checked" card. The two separate goal renderings are merged.
6. **Create.** A six-step guided stepper (Plan, Record, Review, Confirm, Goal, Finish) with the
   sticky real editor beside it, a floating recording bar, before/after miniature diagrams drawn from
   recorded snapshots, evidence marks, and technical details behind disclosures. Stage keys and
   `data-stage` semantics are unchanged.
7. **Copy.** UI strings are shortened and made human; technical vocabulary leaves the normal path.
   Every string stays in the EN/DE catalogues.
8. **Guardrails.** `npm run design:lint` (in `npm run check`) rejects raw colour, size, radius, shadow
   and duration values outside the tokens and unknown classes; `npm run design:invariants` measures
   rendered computed styles against the token scales in every state; `npm run design:capture` renders
   contact sheets for review; the decision protocol (§13) is part of `AGENTS.md` and
   `.claude/rules/`.

## Deviation from the parent brand's guardrails (deliberate, maintainer-directed)

The parent brand's anti-slop list warns against pill-shaped everything, frosted glass and soft
shadows. This language uses capsules, glass and soft elevation **selectively and by rule**:
capsules only for things that are pressed, glass only on four floating things (app bar, tool palette,
coach pill, recording bar) with an opaque fallback, shadows neutral and never glowing, no gradients
except the loading shimmer, no purple, one accent. The maintainer's direction of 2026-10-07
started this exception; on 2026-10-08 the maintainer confirmed it explicitly, limited to Practonaut
and to the rules above (recorded in the parent brand's guardrails, §4). It does not extend to other
surfaces of the parent brand.

## Consequences

- Selectors changed for the practice and create DOM; tests were updated without weakening any
  assertion (each changed selector is mapped in the review record).
- The v0.1 reference page (`design/reference/player.html`) is superseded by the gallery.
- A change to a principle, token scale or banned pattern needs a new PADR.
- Not claimed: usability, learning effect, human screen-reader acceptance (C7 stays OPEN), human
  competence transfer (C6 stays UNKNOWN). Visual quality claims are limited to what the recorded
  independent renders support.

## Re-assessment triggers

A maintainer or human-sighting result that contradicts the visual direction; a platform change that
removes `backdrop-filter` or `<dialog>` support; a second pilot application with a different board;
introduction of vendored fonts.

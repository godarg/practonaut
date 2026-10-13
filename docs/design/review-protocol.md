# Design review protocol

Status: active · Owner: design (role) · Rules it serves:
[design-language.md](design-language.md) §13 (decision protocol) and §16 (review ledger).

A visual change is done when its rendered result was measured, looked at by its author and
reviewed by someone who did not build it. This page says how, with which commands, and where the
result is recorded. It adds no new design rule; the rules live in the design language.

## 1. Gates the tools enforce

| Command | What it proves | When it runs |
|---|---|---|
| `npm run design:lint` (part of `npm run check`) | Source: no raw colour, type, space, radius, shadow, motion or stroke values outside `design/tokens.css`; tokens and local properties exist; no `data:`/remote URLs; `!important`, gradients and glass only where the language allows them; in code no `innerHTML` family, `eval`, inline styles or colour literals; every class written in code has a CSS rule (or is a listed hook), every icon exists. | every change; `file:line rule message` |
| `npm run test:a11y` | axe-core (WCAG 2.2 AA tags) and overflow on the player's practice, editor and create states (create gating since the v1 rebuild), EN/DE, light/dark, 1280/320. | changes under `src/player/` or `design/` |
| `npm run design:gallery` | Builds the living gallery in `.local/gallery/index.html` (every kit component in every state). | before designing (§13 step 1) |

A finding of `design:lint` is either fixed in the product or the rule is changed by a decision
record (PADR); it is never fixed by widening the check. Hook classes without a CSS rule are
listed in `tools/design-lint.ts` (`HOOK_CLASSES`) with their reason.

The native editor state `editor-more-tools` shows the actual More tools menu; the unshipped
Mermaid converter entry is hidden ([PADR-0025](../adr/0025-no-optional-mermaid-converter-in-pilot.md)).
The embedded editor follows the player's language while the mirror's UI stays English.

## 2. Producing the review images

The registered player states (practice, editor, the create flow, loading, failure, ...) are
defined in `tests/support/player-states.ts`. Take screenshots of every state the change touches,
light and dark, EN and DE, 1280 and 390 px, from a committed state, and name the commit next to
the images.

## 3. The author's look (§13 step 11)

Open every montage the change touches, light and dark, EN and DE, 1280 and 390. Look for: the
canvas still wins, one primary action per surface, alignment on the grid, clipped or badly wrapped
text, concentric radii, visible focus, nothing that reads as a default browser control, the empty,
loading and failure states. Write down what you saw; "looked fine" is not a record.

## 4. Independent review (§13 step 12)

1. **Reviewer.** Someone who did not author the change: another person, or an agent started from
   fresh context that receives the work as someone else's submission. The author never reviews
   their own change.
2. **Material.** The screenshots (with their commit), the design language, and the diff. No author notes about what to look for; the reviewer reads the rules.
3. **Lens.** The design language: principles §2, product terms §3, voice §4, type §5, colour §7,
   shape/space/elevation/motion §8, catalogue §9, the surface in §10, states §11, accessibility
   §12 and the banned patterns in §13. Every finding names the rule it breaks.
4. **Findings table.** One row per finding:

   | ID | Severity | State and capture | Rule (section) | Finding | Proposed fix |
   |---|---|---|---|---|---|
   | R2-F1 | major | `sheet-reset__dark-de-390__viewport.png` | §8 Shape | The sheet's actions are … | … |

   Severity: **blocker** (unusable, harmful or false: a claim the product cannot keep, an
   inaccessible path, text that cannot be read), **major** (breaks a rule of the design language
   or a principle), **minor** (polish within the rules). The reviewer ends with a verdict:
   PASS, CONDITIONAL (majors open) or FAIL (a blocker).
5. **Disposition.** The author answers every blocker and major in writing: *fixed* (commit),
   *not done* with the reason, or *rule question* (goes to a decision record). Minors may be
   batched. New captures after the fixes are part of the round.
6. **Ledger.** Add one row to design-language.md §16: round, date, reviewer, scope (states,
   themes, widths, HEAD), result with counts by severity and what was consciously not done.
   The full report and the dispositions go to the pull request, not into the design language.

## 5. Rules learned in the v1 rounds (binding)

1. **Bind the images to a commit.** Capture after committing. Review images of a working tree are
   not a review of a state.
2. **Every state is reachable and anchored.** A new screen, step or state gets a definition in
   `tests/support/player-states.ts` (then `test:a11y` covers it); a state the
   reader reaches by scrolling sets `view` to the element they see, so the viewport image shows
   their screen, not the top of the page.
3. **Give the reviewer a fixed image list.** Image readers stop at a request limit: name at most 40
   images (montages first, then the viewport images of the states the change touches), and ask for
   the report before any further image.
4. **PASS means no blocker and no major** on every surface the change touches. A CONDITIONAL is
   fixed and re-reviewed on the fixed state; minors may be disposed in writing in the review record
   (the pull request).
5. **Foreign UI is never clipped by our layout.** The embedded editor keeps its own controls whole
   and its frame fitted; any change to the editor panel, the shell grid or the camera fit is looked
   at in 1280, 1366 and 390.
6. **A measured defect becomes a test.** A layout jump, a clipped control or a covered field found
   in review gets a negative control that is red on the old state.

Automated scans and agent reviews do not replace the human checks that stay open (screen reader
runs, 200 % zoom; [manual-player-checks.md](manual-player-checks.md)).

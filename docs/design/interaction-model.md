# Diagram connections: interaction model

Status: implemented design with measured prototype evidence, 2026-10-04. Render files mentioned
below were working files and are not part of the repository.

Revenue impact: prerequisite for a usable local product; no publication or revenue claim.

Source: [design language](design-language.md), especially §10.5, and the existing [cover-domain reference](../../design/reference/player.html). Tokens and panel grammar carry over; the cover world does not become a diagram-world claim.

## Interaction contract

| Object/context | Visible control | Optional shortcut | Result and focus |
|---|---|---|---|
| Focused step | Connect / Verbinden | C | Start pending connection. Focus first alternative target step. |
| Target selection | Target step, selected by arrows, Home/End | Enter / Space | Confirm exactly one connection; return focus to resulting arrow. |
| Board step | Connections / Verbindungen | A | Focus arrow relation in a separate connections list. Each arrow's accessible name states source and destination. |
| Focused arrow | Rewire start / Anfang umhängen | Shift+R | Choose a new source step; retain destination. |
| Focused arrow | Rewire end / Ende umhängen | R | Choose a new destination step; retain source. |
| Focused arrow | Delete arrow / Pfeil löschen | Delete | Remove arrow, focus surviving step; offer Undo. |
| Pending operation | Cancel / Abbrechen | Escape | Discard preview, no action; restore original step/arrow focus. |
| Pending operation | Leave board | Tab / Shift+Tab | Discard preview without pulling focus back into board. |

Buttons are the primary discovery path. Single-letter keys are optional, scoped to board objects and arrow controls, and never global. They must not intercept input fields or modified browser/screen-reader shortcuts. No `role="application"`. There are separate steps and connections layers, with a roving tab stop in the step layer. The full Player should keep a stable arrow order and A cycles arrows attached to the selected step; this three-step prototype contains one editable arrow and demonstrates the layer transition.

Pointer users choose a source, use Connect, then click a target. Rewiring uses the same buttons and target click. Drag handles may be added as an additional path, never the only path. The prototype demonstrates click paths; it does not attest production drag or runtime conformance.

## Preview, transaction and announcements

A pending relation has a dashed path and explicit pending text. Dashes carry lack of verdict, never selection. Pending source/destination choices are client preview state; the production Player submits one action to the host only on confirm. No success, history or goal-condition update before host acceptance. Rejection retains the committed board and focus, announces the named reason, and offers the next safe action. A preview is discarded on mirror rejection; it does not become practice evidence.

One polite atomic status region states mode start, target label, committed relation and action number, cancellation or Undo. A step's description lists immediate incoming/outgoing relations, not entire chains. The connections list makes each relation readable as text without the SVG. Long lists should use counts plus explicit relation disclosure rather than repeatedly reading the full chain.

Loose arrows carry visible error words and consequence: “Loose arrow: its end is not attached to a step. The process has no connected successor. Rewire the end or delete this arrow.” German: “Loser Pfeil: Sein Ende ist mit keinem Schritt verbunden. Der Ablauf hat keinen verbundenen Nachfolger. Hänge das Ende um oder lösche diesen Pfeil.” This example is design copy; production error consequences must come from the world's error class, with rule provenance. The prototype loose-error button is solely a render fixture and is excluded from the Player.

History describes a snapshot: “At that moment: …” / “Zu diesem Zeitpunkt: …”. Store consequence and provenance snapshots at action time; do not recompute old entries from current state. This disposes the design direction for foundation finding F8; the production implementation must be tested separately.

## Render and DOM measurements

`measured` 2026-10-04: `node tools/test-diagram-interactions.ts`, Exit 0. It runs an actual Chromium DOM through Connect, both rewires, Escape focus restoration, Tab cancellation, loose-error notice, delete, Undo and pointer target confirmation in EN and DE. axe WCAG A/AA tags report 0 violations in the final connected state. Both themes reflow at 320 and 1280 CSS px with reduced motion; no external request was attempted. The prototype test is a separate command, not a replacement for the final Player's `test:e2e` or `test:a11y`.

Screenshots and machine measurement (`renders/phase-2-interactions/measurement.json`) live in `renders/phase-2-interactions/`. Producer looked at all 10 generated images: EN/DE loose state at 1280, and EN/DE × light/dark × 1280/320 final states. Initial mobile microtext was discovered visually and fixed by stacking the three prototype steps in a 280-unit viewBox. This stacking illustrates readable responsive treatment; production board geometry must preserve world positions and can provide a named text/object alternative rather than changing model geometry.

| Surface | Visual/tokens | Image language | Voice | Structure | Fidelity | Sign-off |
|---|---|---|---|---|---|---|
| EN/DE final, light/dark, 1280 | measured token use | n.a. no imagery | precise object/action copy | DOM probe | producer viewed all 4 | producer check, independent review pending |
| EN/DE final, light/dark, 320 | measured token use | n.a. no imagery | visible button labels | no horizontal overflow | producer viewed all 4; labels readable | producer check, independent review pending |
| EN/DE loose, light, 1280 | visible error panel | n.a. no imagery | consequence + next action | visible and announced notice | producer viewed both | producer check, independent review pending |

Scope does not include loading/result/unknown screens: the existing reference specifies those and the actual Player must implement and render them. This prototype has no world loading process.

## Risks and verification limits

- Manual VoiceOver and 200% zoom checks: one run by a person (2026-10-17, VoiceOver with Chrome on macOS, no findings; see manual-player-checks.md); other screen readers are not tested. This DOM probe does not hear speech or establish screen-reader quick-navigation compatibility. A human must execute the agreed path.
- Source/destination naming must remain consistent: Shift+R always changes source; R always changes destination. Never label both as “rewire” without the endpoint.
- Responsive production diagrams must retain model geometry and readable alternatives. This prototype's restacking is view-only illustrative geometry, not runtime state.
- The loose-state visual fixture keeps its old path while relation text says the end is unattached; production must draw actual unbound geometry from state. Treat this fixture as copy/announcement evidence only.
- Beyond-catalog candidate: a long paragraph of key commands can overwhelm first use even when every button exists. The Player should put a compact mode instruction adjacent to the active board, keep complete keyboard help in a disclosure, and announce only immediate relations.
- No final Brand score or independent PASS is issued by the producer. Fresh-context visual acceptance and final Player walkthrough remain pending with the coordinator. No learning-effect assertion is made.

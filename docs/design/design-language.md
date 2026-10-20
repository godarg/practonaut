# Practonaut design language

Version 1.0 · 2026-10-07 · Owner: design (role) · Status: normative, **accepted by
the maintainer as the binding baseline on 2026-10-09** · Decision record: [PADR-0020](../adr/0020-design-system-v1.md)

This document is the single source for how Practonaut looks, moves and speaks. It is written for the
people **and the AI agents** who extend the product. If you build or change anything visible, you
follow section 13 (the decision protocol) before you write a line. The protocol is enforced by
tools, not by goodwill: `npm run design:lint` (part of `npm run check`) and `npm run test:a11y`;
rendered states are looked at as described in the [review protocol](review-protocol.md).

**The accepted baseline.** The rendered state reviewed in round r5 (§16) is the reference every
extension is measured against. New features reuse its kit, tokens, shell and surface patterns; a
new surface or component meets the same bar (the gates, a look, an independent review that ends in
PASS: no blocker and no major on the surfaces it touches). A regression against the baseline is a
finding, not a taste question. How a review runs: [review-protocol.md](review-protocol.md).

Sources of truth in the repository:

- `design/tokens.css`: every colour, size, radius, shadow, duration and easing value.
- `src/player/ui/`: the component kit (typed factories) and the icon set.
- `src/player/css/`: base, kit, shell, practice and create styles. Kit styles are `ui.css`.
- `npm run design:gallery`: the living gallery (every component in every state, both themes).
- This document: meaning, rules and the reasons behind them.

The name "Practonaut" is a product name chosen by the maintainer. Its availability as a mark is
unknown. Do not present it as registered, do not add ® or ™, and do not design a logo until the name
is cleared. The wordmark is the name set in the interface font (section 14).

---

## 1. Stance

Practonaut is a **quiet workshop with one clear next step on every screen**. A practice world is a
small, honest copy of one real task: the learner acts on real-looking objects, sees what each action
did, and asks an independent checker whether the result holds. The interface earns trust by saying
exactly how much it knows. It looks and feels like software made with years of care: calm surfaces,
precise type, soft depth, motion that explains. It never congratulates, scores or promises learning.

It is built the way an Apple-platform app is built: content first, controls that recede, shapes that
nest concentrically, one accent for what you can press, system typography. It does not imitate a
platform skin; it follows the same discipline. That discipline is written down in section 13 so every
future change is judged by the same rules.

## 2. Principles (in priority order)

| # | Principle | What it means in a decision |
|---|---|---|
| P1 | **The work is the hero** | The diagram or drawing surface is the largest, calmest object on screen. Chrome (bars, palettes, cards) is lighter, smaller and quieter than the work. If something competes with the canvas, it loses. |
| P2 | **One clear next action** | Each surface has at most one primary (filled accent) button visible. Everything else is secondary, plain or quiet. If you need two primaries, you have two surfaces. |
| P3 | **Honest by construction** | What the product knows is visible: confirmed, observed, hypothesis, not yet modelled (section 7.4). Uncertainty has its own shape, never a disguise. Nothing claims learning effect. |
| P4 | **Depth is hierarchy** | Elevation and translucent material appear only on things that float above content (app bar, tool palette, coach pill, sheets). Cards rest. Nothing glows. |
| P5 | **Motion explains** | Motion shows cause and effect (a sheet rises from where it was asked for, a goal turns green when it is met). It never decorates and it always has a reduced-motion twin. |
| P6 | **Concentric and optical** | Radii nest (inner = outer − padding), spacing steps from one scale, text sits on the baseline grid of its role. Optical alignment beats arithmetic. |
| P7 | **Accessible by default** | Keyboard first, visible focus, status never by colour alone, AA contrast, reflow at 320 px, reduced motion, no drag-only action. Not a later pass. |
| P8 | **Words are interface** | Short, specific, human. German addresses the learner with "du". No praise, no exclamation marks, no jargon in the normal path. Technical detail lives one disclosure deeper. |

Principles resolve conflicts top-down. Example: a delightful animation (P5) that hides the canvas
(P1) is removed.

## 3. Product terms

These terms are fixed. Code, documentation, agent interfaces and UI use the same words, so a human
and an agent talk about the same thing. German UI addresses the learner with "du", mostly through
imperatives.

| English | Deutsch | What it means for the user |
|---|---|---|
| Exercise | Übung | A playable task with a visible goal, checked conditions, feedback and a result. |
| Project | Projekt | Named local author work: recordings, supported rules, task intent and reviewed examples. It can be saved and resumed. |
| World | Welt (Übungswelt) | The executable package underlying an exercise. |
| Demonstration | Vorführung | An explicitly recorded sequence with source and rights. It supplies observations for supported behaviour. In Practice the bundled example also plays a scripted demonstration of its task (the task's third hint, once); it is labelled as such and is never anyone's attempt or result. |
| Task | Aufgabe | What to achieve, in plain words. |
| Goal | Ziel | The short list of checkable statements about the result. Any result that meets them all counts. |
| Board | Arbeitsfläche | The area where the objects lie and where you act. |
| Drawing surface (real editor) | Zeichenfläche (echter Editor) | The embedded real Excalidraw in which demonstrations are recorded and practice can happen. "Engine" appears only behind Technical details. |
| Object | Objekt | One thing on the board you can act on: a step or a connection. |
| Step / Connection | Schritt / Verbindung | A box in the process / an arrow between two steps. |
| Before / After | Vorher / Nachher | The state of the drawing before and after one change (review drawings). Not used for neighbouring steps. |
| Previous step / Next step | Schritt davor / Schritt danach | The steps that come directly before and after a given step in the process (for example around the step to remove). |
| Action | Aktion | One completed change. Each action appears in the history. |
| Consequence | Folge | What an action changed according to the world's rules, shown with the rule's origin. |
| History | Verlauf | The numbered list of actions in the current attempt. |
| Attempt | Versuch | One run through a task, from its start or from a reset. |
| Undo / Reset | Rückgängig / Zurücksetzen | Take back the last action (repeatable) / restart the attempt (asks first). |
| Hint | Hinweis | Optional help. Opening it is noted in the attempt. |
| Result check | Ergebnisprüfung | An independent checker reads the finished board against the goal. It looks at the result, not at the path. |
| Rule / Rule status | Regel / Regelstatus | How the world reacts to an action / where it comes from. |
| Confirmed · Observed · Hypothesis | Bestätigt · Beobachtet · Hypothese | Checked against the real tool / seen in a demonstration / inferred. |
| Not yet modelled | Noch nicht modelliert | The world does not know what this does and will not guess. |

Words we do not use in the UI: level, score, points, streak, badge, mission, quest, journey,
"mastery", "AI tutor", "smart", "magic", "unlock", "gamified", "seamless".

## 4. Voice in the interface

- Say what happened, with the object and the number: "Step „Check“ moved to 240, 160. Action 3."
  Not "Nice move!".
- Failure text follows up to four steps: what happened, what it means, what was not changed, what you
  can do. "This session is no longer available. Nothing was changed. Start Practonaut again and use
  the window that opens automatically."
- A failed check names the condition, the finding and the consequence. Where no rule gives a
  consequence, the text says "Required by the task" and invents nothing.
- Short wins: a button label is one to three words; a status line one sentence; a banner at most two.
  Prefer the learner's verb ("Verbinden") over a system noun ("Verbindungsoperation").
- No claims about learning effect or speed. No praise. No exclamation marks. No emoji. At most one
  dash per paragraph. Numbers as digits. Typographic quotes per language (“…” EN, „…“ DE).
- English is the source language; German lives in the same catalogue. Every UI string lives in
  `src/player/messages.ts` or the create-flow catalogue; markup contains no literal text. A missing
  key must be visible in a render, never silent.
- Technical identifiers (hashes, rule ids, JSON) never appear in the normal path. They sit behind a
  disclosure titled "Technical details" / "Technische Details" and use the mono voice.

## 5. Typography

Offline operation is mandatory: **no webfonts, no CDN**. The stack starts with the platform's own
interface font, which is SF Pro on every Apple system and the closest native sans elsewhere.

`--pn-font-sans`: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui,
"Segoe UI Variable Text", "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`.
`--pn-font-mono`: `ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace`, used only for
data (ids, hashes, rule origins, JSON).

Roles. Always a role, never an ad-hoc size. Sizes follow the user's font size (rem).

| Role | Class | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|---|
| Display | `t-display` | 44 / 48 | 700 | −0.032em | Hero and empty screens only |
| Large title | `t-large` | 34 / 40 | 700 | −0.028em | Task title |
| Title 1 | `t-title1` | 28 / 34 | 700 | −0.024em | Workspace and screen titles |
| Title 2 | `t-title2` | 24 / 30 | 600 | −0.020em | Section titles |
| Title 3 | `t-title3` | 20 / 26 | 600 | −0.017em | Sheet titles, card heroes |
| Body | `t-body` | 17 / 24 | 400 | −0.014em | Reading text: prompts, explanations |
| Subhead | `t-subhead` | 15 / 20 | 400–500 | −0.008em | Controls, list rows, dense text (the interface default) |
| Footnote | `t-footnote` | 13 / 18 | 400–500 | −0.003em | Secondary lines, hints, meta. Never essential text on a tinted fill below AA |
| Caption | `t-caption` / `t-eyebrow` | 12 / 16 | 500–600 | +0.01em / +0.06em caps | Chips, key caps, eyebrow labels |

Rules: running text is Body or Subhead, never smaller than Footnote. Headings use `text-wrap:
balance`, paragraphs `pretty`. Numerals that change (counts, positions) use tabular numerals.
Letter-spacing tightens with size: that is how SF is meant to be set. Weights are 400, 500, 600, 700
only. Italics and underlines are not used for emphasis (links excepted).

## 6. Tokens

All tokens are CSS custom properties with the prefix `--pn-` in `design/tokens.css`.
Components use semantic tokens only; **raw values exist in that file and nowhere else**
(`npm run design:lint` enforces it). Grid size, positions and other world data are not tokens; they
come from the world package.

| Group | Tokens |
|---|---|
| Colour | `--pn-color-*` (section 7), light default, dark by system or `[data-theme="dark"]` |
| Type | `--pn-font-*`, `--pn-text-*`, `--pn-leading-*` (incl. `none` for key caps), `--pn-tracking-*`, `--pn-weight-*`, `--pn-measure` |
| Space | `--pn-space-1…16`: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 px (rem) |
| Shape | `--pn-radius-xs…xl` (6, 10, 14, 20, 28 px), `--pn-radius-full` (capsule) |
| Controls | `--pn-control-sm/md/lg` (32, 40, 48), `--pn-target-coarse` (44), `--pn-icon-sm/md/lg`, `--pn-stroke-*`, `--pn-nudge` (1 px optical alignment of an icon to its text line; never spacing) |
| Layout | `--pn-appbar-height`, `--pn-inspector-width`, `--pn-guide-width`, `--pn-page-max`, `--pn-gutter` |
| Elevation | `--pn-shadow-raised/floating/sheet` and the small ones (bar, thumb, keycap, glass) |
| Material | `--pn-blur`, `--pn-saturate`, `--pn-color-glass*` |
| Layering | `--pn-z-sticky/floating/dialog` |
| Focus | `--pn-focus-width`, `--pn-focus-offset` |
| Motion | `--pn-duration-instant/fast/base/slow/pulse`, `--pn-ease-standard/out/spring/settle/pulse` |

Adding or changing a token: edit `tokens.css` (light and **both** dark blocks, identical), add the
contrast pairs it carries to section 7.2, run `npm run check`. A token nobody uses is deleted.

## 7. Colour

### 7.1 Palette

Neutral surfaces, one accent for "you can press this", four status hues that always travel with a
shape and a word. The palette is Apple-neutral on purpose: it lets the diagram be the only thing with
character.

**Surfaces**

| Token | Light | Dark |
|---|---|---|
| `bg` | `#F5F5F7` | `#0A0A0B` |
| `surface` | `#FFFFFF` | `#1C1C1E` |
| `surface-raised` | `#FFFFFF` | `#2C2C2E` |
| `fill` | `#F0F0F3` | `#2C2C2E` |
| `fill-hover` | `#E8E8ED` | `#38383B` |
| `fill-pressed` | `#DEDEE4` | `#444448` |
| `thumb` | `#FFFFFF` | `#636366` |
| `canvas` | `#FAFAFC` | `#1C1C1E` |
| `canvas-dot` | `#D6D6DC` | `#38383A` |
| `object-bg` | `#FFFFFF` | `#2C2C2E` |
| `frame-bg` | `#F4F4F7` | `#161618` |

**Text**

| Token | Light | Dark |
|---|---|---|
| `text` | `#1D1D1F` | `#F5F5F7` |
| `text-secondary` | `#5E5E63` | `#A1A1A6` |
| `text-tertiary` | `#8E8E93` | `#6E6E73` |
| `text-on-accent` | `#FFFFFF` | `#FFFFFF` |

**Lines**

| Token | Light | Dark |
|---|---|---|
| `separator` | `#E3E3E8` | `#38383A` |
| `separator-strong` | `#D2D2D7` | `#48484A` |
| `border` | `#86868D` | `#7A7A80` |
| `object-border` | `#8A8A90` | `#86868C` |
| `line` | `#6E6E73` | `#A1A1A6` |

**Accent**

| Token | Light | Dark |
|---|---|---|
| `accent` | `#0071E3` | `#0071E3` |
| `accent-hover` | `#0066CC` | `#0066CC` |
| `accent-pressed` | `#005BB8` | `#005BB8` |
| `accent-text` | `#0066CC` | `#4DA3FF` |
| `accent-tint` | `#E6F1FD` | `#0E2A47` |
| `focus` | `#0071E3` | `#4DA3FF` |

**Status**

| Token | Light | Dark |
|---|---|---|
| `success-fg` | `#17642F` | `#62D78B` |
| `success-bg` | `#E6F4EA` | `#12261A` |
| `success-icon` | `#248A3D` | `#32D74B` |
| `danger-fg` | `#A8201A` | `#FF8A80` |
| `danger-bg` | `#FDECEA` | `#2E1816` |
| `danger-icon` | `#D70015` | `#FF6961` |
| `danger-border` | `#D70015` | `#FF6961` |
| `danger-solid` | `#C5161E` | `#D92D20` |
| `danger-solid-hover` | `#A8121A` | `#BF241A` |
| `warning-fg` | `#7A4A00` | `#FFD060` |
| `warning-bg` | `#FFF3D6` | `#2B2210` |
| `warning-icon` | `#B26A00` | `#FFB340` |
| `info-fg` | `#00478F` | `#6CB6FF` |
| `info-bg` | `#E6F1FD` | `#0F2438` |
| `info-icon` | `#0071E3` | `#4DA3FF` |
| `unknown-fg` | `#55555A` | `#A1A1A6` |
| `unknown-bg` | `#F0F0F3` | `#242426` |
| `unknown-icon` | `#6E6E73` | `#A1A1A6` |
| `unknown-border` | `#8E8E93` | `#7A7A80` |
| `record` | `#E5251B` | `#FF453A` |

**Material and elevation (translucent, no contrast duty)**

| Token | Light | Dark |
|---|---|---|
| `scrim` | `rgba(0, 0, 0, 0.32)` | `rgba(0, 0, 0, 0.55)` |
| `glass` | `rgba(255, 255, 255, 0.72)` | `rgba(44, 44, 46, 0.72)` |
| `glass-border` | `rgba(255, 255, 255, 0.6)` | `rgba(255, 255, 255, 0.14)` |
| `glass-edge` | `rgba(0, 0, 0, 0.08)` | `rgba(0, 0, 0, 0.5)` |
| `shadow-ambient` | `rgba(0, 0, 0, 0.06)` | `rgba(0, 0, 0, 0.30)` |
| `shadow-key` | `rgba(0, 0, 0, 0.10)` | `rgba(0, 0, 0, 0.40)` |
| `shadow-deep` | `rgba(0, 0, 0, 0.22)` | `rgba(0, 0, 0, 0.60)` |
| `hatch` | `#B9B9C0` | `#4A4A50` |

Accent: the one chromatic colour of the interface. Filled controls use `accent` with
`text-on-accent`; accent as text or icon on a surface uses `accent-text` (darker in light mode,
lighter in dark mode so it stays readable). Selection and focus use `accent` / `focus`.

### 7.2 Contrast targets (WCAG 2.2 AA)

Measured values are not recorded here. A script measures every pair in both themes; any pair below
its target is a defect in `tokens.css`, not an exception. Targets: 4.5:1 for text (SC 1.4.3), 3:1 for
boundaries of controls, meaningful graphics and focus indicators (SC 1.4.11).

Text pairs, target 4.5:1, both themes:

| ID | Foreground | Background |
|---|---|---|
| T1 | text | bg, surface, surface-raised, fill, canvas, object-bg, frame-bg, accent-tint, success-bg, danger-bg, warning-bg, info-bg, unknown-bg (13 pairs) |
| T2 | text-secondary | bg, surface, surface-raised, fill, canvas, object-bg, frame-bg, accent-tint, success-bg, danger-bg, warning-bg, info-bg, unknown-bg (13 pairs) |
| T3 | text-on-accent | accent, accent-hover, accent-pressed, danger-solid, danger-solid-hover (five pairs) |
| T4 | accent-text | bg, surface, surface-raised, canvas, fill, accent-tint (six pairs) |
| T5 | success-fg | success-bg, surface (two pairs) |
| T6 | danger-fg | danger-bg, surface (two pairs) |
| T7 | warning-fg | warning-bg, surface (two pairs) |
| T8 | info-fg | info-bg, surface (two pairs) |
| T9 | unknown-fg | unknown-bg, surface (two pairs) |
| T10 | text | thumb (selected segment) |

Non-text pairs, target 3:1, both themes:

| ID | Foreground | Background |
|---|---|---|
| U1 | border | bg, surface, surface-raised, canvas (four pairs) |
| U2 | object-border | canvas, frame-bg, object-bg (three pairs) |
| U3 | line | canvas, frame-bg, object-bg, surface (four pairs) |
| U4 | focus | bg, surface, surface-raised, canvas, fill, accent-tint (six pairs) |
| U5 | accent | bg, surface, canvas, frame-bg (four pairs) |
| U6 | success-icon | surface, bg, canvas, success-bg (four pairs) |
| U7 | danger-icon | surface, bg, canvas, danger-bg (four pairs) |
| U8 | warning-icon | surface, bg, canvas, warning-bg (four pairs) |
| U9 | info-icon | surface, bg, canvas, info-bg (four pairs) |
| U10 | unknown-icon | surface, bg, canvas, unknown-bg (four pairs) |
| U11 | danger-border, unknown-border | surface (two pairs) |
| U12 | record | surface, bg, canvas (three pairs) |

**Drawing content.** The `content-*` tokens show a world/2 step in the colours Excalidraw 0.18.1
uses for the same palette value (light: its picker values; dark: its own `invert(93%)
hue-rotate(180deg)` filter, measured in Chromium), so the board and the real editor agree. A filled
step's label is drawn in `content-text`; an unfilled step keeps `object-bg` behind its outline.

Drawing-content text, target 4.5:1, both themes:

| ID | Foreground | Background |
|---|---|---|
| T11 | content-text | content-fill-red, content-fill-green, content-fill-blue, content-fill-yellow (four pairs) |

Drawing-content outlines, target 3:1, both themes:

| ID | Foreground | Background |
|---|---|---|
| U13 | content-line-black, content-line-red, content-line-green, content-line-blue | object-bg, canvas (8 pairs) |

Drawing-content floor for the orange outline, target 2:1, both themes:

| ID | Foreground | Background |
|---|---|---|
| U14 | content-line-orange | object-bg, canvas (two pairs) |

Excalidraw's orange (`#F08C00`) stays below 3:1 on the light surfaces. It is kept as it is because
the hue *is* the content the learner sets and must match the editor (SC 1.4.11 exception: a
particular presentation is essential to the information). The colour is never the only carrier:
the step's accessible name and the restyle choices say "orange line", and the step stays told apart
by its label. U14 is a floor that catches a lighter swap; raising the orange is open question 6.
An outline over a fill is not a pair: a filled step is told apart by its fill and its label.

The black line is Excalidraw's own black (`#1E1E1E`, dark theme `#D3D3D3` by the same filter), not
a UI grey: the default step outline on the board is what the editor draws. Every drawn outline
(black and the four colours) is `--pn-stroke-content` (2 px) wide at every board scale
(`vector-effect: non-scaling-stroke`), so a 320-px phone shows the same 2 px as a desktop. Its
colour is never the only carrier: the step's visible style words ("orange line") and accessible
name repeat it.

Declared without contrast duty: `text-tertiary` (disabled controls and decoration only; never the only
carrier of meaning, never placeholder text), `separator`, `separator-strong`, `canvas-dot`, `hatch`,
the translucent group and the fills `fill-hover`, `fill-pressed`. The selected segment is told apart by its thumb, its weight and its text colour together, never by the thumb alone. Every one of these has a text or
shape carrier elsewhere.

### 7.3 Status is never colour alone

| Status | Shape (kit) | Word (EN / DE) | Colour |
|---|---|---|---|
| met | filled circle with check (`statusIcon('met')`) | met / erfüllt | success |
| not met | filled circle with cross | not met / nicht erfüllt | danger |
| not checked | empty ring | not checked / nicht geprüft | tertiary text |
| stale | warning triangle | changed since the check / seit der Prüfung geändert | warning |
| no verdict / unknown | dashed ring, hatched band | no verdict / kein Urteil | unknown (neutral) |
| info | circle with "i" | the sentence itself | info/accent |

In forced-colours mode shapes and words remain; pressed controls get the system Highlight.

### 7.4 Evidence marks (the product's own grammar)

How well a rule is known has its own shape; it works in greyscale and is never confused with a result
colour. Always shown with its word (`evidence()` in the kit).

| Mark | Meaning | Look |
|---|---|---|
| Confirmed | checked against the real tool | filled accent disc with check |
| Observed | seen in a demonstration, not yet checked | accent ring |
| Hypothesis | inferred, may be wrong | dashed neutral ring |
| Refuted | a recorded counterexample contradicts it | neutral disc with cross |
| Not yet modelled | the world does not know and will not guess | hatched band beside the words, never behind text |

Dashes mean uncertainty or "not committed yet" (hypothesis ring, pending connection preview).
Dashes are never used for decoration, selection or dividers.

## 8. Shape, space, elevation, material, motion

**Shape.** One rule: **a capsule is something you press (or a chip, a small tag-like fact); a
rounded rectangle holds content.** Buttons, segmented controls, the tool palette and capsule
selects are pressed capsules; chips are tag capsules and never carry an action
(`--pn-radius-full`). Cards (20), the canvas and sheets (28), fields (14), banners (14), the coach
pill (14) and object cards on the board (14) are rounded rectangles. Nested shapes are concentric: inner radius = outer
radius − padding. Never capsule a container, never round-rect a button.

**Space.** 4 px base. Components use steps `space-1…16`; surfaces use the same steps. Padding of a
card is `space-5`; gap between cards `space-4`; between sections `space-6` to `space-8`; the gutter
shrinks to `space-4` below 48em. Never an off-scale value; never margin on a component root that
belongs to its container.

**Elevation.** Three levels and no more. *Raised* (cards, canvas): a hairline plus two soft
layers. *Floating* (palette, coach pill, popovers): a stronger two-layer shadow with the glass
edge. *Sheet* (dialogs): the deepest. One light source, above. Shadows are neutral black at low
alpha; they are never coloured and never glow.

**Material.** Translucent glass (`--pn-color-glass` + blur + saturate) only on the app bar, the tool
palette, the coach pill and the recording bar, i.e. things that float above content. It always has an
opaque fallback (`@supports not (backdrop-filter)`), and text on glass is measured against the worst
case beneath it. Sheets use a dimmed, softly blurred scrim.

**Motion.** Four durations: instant 80, fast 140, base 240, slow 400 ms, plus the 1.6 s pulse for
"recording". Easing: `standard` for colour and opacity, `spring` for movement and scale (a gentle
overshoot, never bouncy), `out` for entrances, `settle` for an object finding its place. Allowed:
press feedback (scale .97), the segmented thumb gliding, a sheet rising, a verdict or hint arriving,
a step lifting when picked up, the pending connection's dashes flowing, the recording dot pulsing.
Not allowed: entrance animations on a plain re-render, parallax, animated backgrounds, confetti,
infinite animation other than recording, skeleton shimmer and a pending connection.
Because the player re-renders by replacing nodes, an entrance animation runs only for what *just
happened* (a flag consumed by the render), never for every render. `prefers-reduced-motion` sets all
durations to 0.01 ms.

## 9. Component catalogue

All factories live in `src/player/ui/components.ts`; styles in `src/player/css/ui.css`. Surfaces
compose these and never hand-roll a button, field, chip, banner or sheet. If something is missing you
add it to the kit, to the gallery and to this table first (section 13).

| Component | Kit | Purpose, anatomy, rules |
|---|---|---|
| Button | `button()` | Capsule, 40 px (sm 32, lg 48). Variants: **primary** (accent fill; one per surface), **secondary** (default), **tinted** (accent wash), **plain** (accent text), **quiet** (secondary text), **tool** / **tool-danger** (inside the palette), **danger** (red wash), **danger-solid** (confirm a destructive sheet). Optional leading icon; icon-only needs a label (becomes name and tooltip). States: rest, hover, pressed (scale), focus, disabled (loses fill), busy (spinner), pressed-toggle (`aria-pressed`). |
| Segmented control | `segmented()` | Choose one view or mode. Capsule track, sliding thumb, equal columns, `aria-pressed` on buttons. 2 to 4 items. Never for actions. |
| Chip | `chip()` | A small fact, never an action. Tones: neutral, accent, success, danger, warning, unknown, record. |
| Banner | `banner()` | A statement about the situation, with tone, icon, optional title. `role="status"` or `alert` when it appears dynamically. Unknown tone carries the hatched band. |
| Card | `card()` | Rounded rectangle on `surface` with the raised shadow, a header with title and quiet actions. |
| Field | `textField()`, `selectField()`, `textArea()`, `checkField()` | Label above, 48 px control, 14 px radius, visible border at 3:1, hint below. Focus ring in accent. Select is a native `<select>` with a kit chevron; capsule variant for toolbars. Checkbox is custom but real. |
| List picker | `listPicker()` | One-step choice from a list (the task picker). A capsule button shows the current choice and opens a listbox; a click or Enter on an option picks it at once, without a confirm button. Each option has a label and an optional quiet detail line; for library tasks the detail is the level as three dots (●○○ to ●●●) and the reference length ("1 step", "4 steps", plural rules per language), never colour alone. The current option carries a check and the word "current". Arrow keys, Home and End move; Escape closes and returns focus to the button; Tab or a click outside closes. The surface decides what a pick does (Practice: section 10.2). |
| Status icon | `statusIcon()` | met, unmet, pending, stale (section 7.3). |
| Evidence mark | `evidence()` | confirmed, observed, hypothesis, refuted (section 7.4). |
| Disclosure | `disclosure()` | Native `<details>` with a chevron that turns; summary is plain-accent text. Technical detail goes here. |
| Sheet | `openSheet()` | Modal `<dialog>`: centred card on desktop, bottom-docked on narrow screens, title, optional text/body, stacked large actions. Escape and Cancel dismiss; focus returns to the opener; initial focus on the safe action. |
| Empty state | `emptyState()` | Glyph in a disc, title, one sentence, at most one action. |
| Skeleton | `.pn-skeleton` | Loading placeholder with a quiet shimmer. |
| Floating capsule | `.pn-floating` | Glass capsule for tool palettes and bars. |
| Icon | `icon()` | 24-unit grid, 1.75 stroke, round caps, `currentColor`, always `aria-hidden`. A new icon is drawn in `icons.ts` and shown in the gallery. |
| Key cap | `<kbd>` | Shows a keyboard shortcut next to its action. |
| Stepper | `stepper()`, `step()` (`ui/stepper.ts`) | Vertical, numbered list of steps for a guided flow. Each step is a native `<details>` card with a marker (number, check when done, ring when current), a one-line summary when collapsed and a connecting line. Only the current step is open; the others stay editable. At most one filled button per open step. |
| Step list | `stepList()` (`ui/stepper.ts`) | Static, numbered list of the parts of something that runs by itself (the demonstration): the stepper's marker grammar (number, ring when current, check when done) with a noun title and one line that says the state in words, so the marker never carries it alone. Not interactive; nothing opens. Shown in the gallery running and ended. |
| Miniature diagram | `miniature()` (`ui/miniature.ts`) | Small read-only SVG of a process (steps with wrapped labels, arrows, loose ends as rings), used for before/after, the prepared case and examples. Always paired with a text alternative; never interactive. |
| Board drawing | `drawBoard()` (`ui/board-art.ts`) | The practice board: frame, step cards, connections, selection, lift, pending preview, bound anchors, loose ends, compact mode for narrow screens. Player and gallery draw the same scene; behaviour is attached through `decorate`. |

Rule of thumb: if two surfaces show the same kind of thing, they show it with the same component.

## 10. Surfaces

### 10.1 Shell

One app, one top bar, three workspaces. The bar is glass: brand wordmark on the left, the workspace
segmented control in the centre (**Practice · Excalidraw · Create**; DE **Üben · Excalidraw ·
Erstellen**), language (EN/DE) and appearance (System/Light/Dark) on the right. Below 48em the bar
becomes two rows: brand and settings, then the workspace control full width. While a picked
workspace is being prepared, the current one stays pressed (it is where you are) and a click on it is
kept, never dropped: once the preparation has ended, the person is back where they clicked.
The middle segment names the session's app. A session of an app that Practonaut does not open as
a workspace (draw.io; the editor and Create embed Excalidraw) keeps all three segments, so the bar
does not change shape between apps: **Practice · draw.io · Create**, with draw.io and Create
disabled, each saying why in its tooltip and accessible name, which contain the visible label ("draw.io
does not open as a workspace in Practonaut. Practice on the board." / "Create is not available for
draw.io."; DE "draw.io öffnet sich in Practonaut nicht als Arbeitsbereich. Übe auf der Arbeitsfläche."
/ "Erstellen gibt es für draw.io nicht."). Such a session never names Excalidraw, and its
inspector has no invitation to create an exercise.

Below the bar is the **stage**: one CSS grid with named areas. Nodes that must never move in the DOM
(the real editor iframe) and nodes that are re-rendered share the stage as siblings and are placed by
`grid-area`, so the editor never reloads. Areas: `status`, `head`, `canvas`, `tray`, `inspector`,
`foot` (practice and editor); `status`, `guide`, `engine`, `advanced` (create). The body attribute
`data-workspace="board|editor|author"` selects the layout. Below 72em the stage is one column.

### 10.2 Practice

- **Head** (`practice-head`): eyebrow "Task", the title as Large title, the prompt as Body in
  secondary text, then one row: task picker (list picker, section 9: a pick switches at once; a sheet asks only
  when unsolved work on the board would be lost), "New variant", and the attempt as quiet footnote
  text on the right.
- **One filled button.** Exactly one filled (accent) button is visible, chosen by state: "Check
  result" during the work (tinted before the first action and after a failed check until the board
  changes), "New variant" once the result has passed (placed in the Goal card under the verdict;
  "Check again" becomes secondary), "Start your own attempt" on a demonstration's board (and none while
  it plays: the one Stop is the way out).
- **Canvas** (`canvas`): a 28 px card with the SVG board. The coach pill floats at the top (one
  sentence of guidance derived from the state: what a pending preview needs, how many arrow ends
  are loose, otherwise "choose a step or a connection"; on narrow screens, where the palette shows
  symbols only, it names the tool in use; it never echoes an announcement or a verdict), the **tool palette** sits at the bottom of the card, under the drawing (in flow, so it
  never covers the drawing and the drawing needs no extra inset for it). The
  palette follows the selection: always *Step* (add); for a step *Move · Rename · Connect*; for an
  arrow *Rewire start · Rewire end*; for any object *Delete*; while a preview is pending *only* *Cancel*
  (the other tools are irrelevant then and would not fit the DE labels).
  Below the canvas one quiet line says that the board shows the model and that the real tool checks
  every change (never present the board as the real application).
- **Tray**: always-visible text route to every object. Steps and connections as chips; a connection
  chip reads "A → B" (a loose end reads "Loose arrow"). This is also the keyboard and screen-reader
  route to arrows and stays visible; it is not an accessibility afterthought.
- **Inspector** (right, sticky, scrolls on its own with soft fades at a clipped edge): notices
  first, then **Goal**, **Hints** (a count, revealed hints, "Open next hint"), **History** (Undo
  and Reset in the header, Reset disabled until there is something to reset; numbered entries, the
  consequence in context, an evidence mark per action), **How this is checked** (evidence mark and
  statement, "Show in the real tool", rules behind a disclosure) and a quiet invitation card to
  create an exercise (secondary button, never filled; not in a session of an app without Create,
  §10.1).
- **Goal**: the world states a goal as one verdict; its sentences are shown as separate short lines
  under one status icon (the first in primary text, the rest secondary). Before a check the ring
  is empty and there is no verdict; after a check one short verdict banner ("All conditions met." /
  "Not met yet."), the status icon and, for a failed check, one factual line from the visible state
  ("On the board now: 3 steps, 2 connections, 2 loose ends.") appear; the banner and the icons
  animate in once, staggered. The status word exists for assistive technology only. If the board changed after the
  check, the verdict becomes a warning ("changed since the check") and the goal falls back to "not
  checked". A goal split into several conditions by the world gets one line and one status each.
- **Notices.** One voice per event: the coach pill guides on the board, the inspector judges. A
  world consequence ("what this changed") is neutral information (info tone), not an error; danger
  is reserved for "not met", a rejected action and loose ends; "not yet modelled" is the hatched
  unknown banner with a short title and one explanatory sentence.
- **Model only.** A session without the real tool says so once, above the head and the inspector
  (the stage's `status` row): a warning banner "Not yet checked against the real Excalidraw" (the
  session's app) with one sentence on what gets the real engine (the command in the mono voice,
  wrapping only at its spaces, the one download named with its size; or why Chromium did not start;
  or that `--mirror off` was chosen). It stays for the
  whole session. One wording family everywhere: the banner, the line under the board ("This is a
  practice model. In this session the real Excalidraw does not check it.") and "How this is checked"
  say the same thing in plain words, never "mirrored" or "evidence".
- **Demonstration** (bundled example only). The head offers "Watch a demonstration" as a plain
  button beside "New variant"; below 48em it takes its own line, in words, flush with the text
  above, never a bare symbol. It asks first only when unsolved own work would be cleared ("clears
  the board and solves this task once"). While it plays the board is its board: the head line
  beside "Task" reads "Demonstration · n actions" (it never uses up one of the person's attempt
  numbers), the coach counts its actions, the object the last action touched carries the selection
  ring until the next one, the palette offers only the one Stop with its key cap (Escape too, but
  not from Create), every other control is disabled, and a **Demonstration** card at the top of the
  inspector names the three parts of every result in a step list (section 9) with noun titles that
  are true in every session ("Actions on the board", "Check in the real Excalidraw", "Result check")
  and each state in words ("1 of 3", "1 confirmed" or "Not checked in this session", the verdict).
  A chip says running, finished, stopped or stopped early; stopped early is one sentence for people
  with the refusal's code under Technical details. History entries carry a "Demonstration" chip. At
  its end the focus and the scroll go to the Demonstration card's title. The Goal card's verdict
  says whose board it judged ("The demonstration's board meets all conditions."); there is no Check
  on its board, and the one filled button is "Start your own attempt" (never "New variant": its pass
  is not the person's). Leaving its board (own attempt, Reset, task or variant) asks nothing. Its
  board offers no tools and cannot be exported (an information banner says why).
- **Narrow screens.** The board is cropped to its content and drawn with larger labels and thicker
  strokes with a minimum SVG width so labels never fall below 12 CSS px. The drawing may
  scroll inside its labelled horizontal region; the page itself reflows. The tray remains the text
  route to every object.

**Board drawing (SVG).** A dot texture covers the whole canvas card (decorative, a token
pattern, never a border); the frame is a 28 px rounded rectangle on `frame-bg` with its name in
its own spelling as a quiet label; steps are 14 px cards with a
hairline border (3:1) and a soft shadow, label centred in Body Medium, wrapped; connections are 2.5
stroke, round caps, small rounded arrowheads; **selected** = accent ring outside the card (3 units),
connection in accent; **picked up** = card lifts 4 units with a deep shadow and an accent wash;
**pending connection** = dashed accent line with flowing dashes; **bound start** = a small anchor
dot on the card edge and an arrowhead that touches the target; **loose end** = hollow ring in
danger (the negative counterpart of the anchor); **focus** = a wider ring in the focus colour.
Selection is never a colour change alone.

### 10.3 Excalidraw workspace

Same task head and inspector. The object tray is hidden in this workspace. The canvas area
holds the real editor in the engine panel (a card with
the same radius as the canvas) and a short note about what the editor is for. The board is hidden.
The status line reports engine state; errors and "not yet modelled" notices become banners above the
canvas.

### 10.4 Create

A guided flow, not a form. Left: the **guide** (hero and a vertical stepper of six steps: Plan,
Record, Review, Confirm, Goal, Finish). Right: the **engine** panel with the real editor, sticky.
Each step is a card with a numbered marker that becomes a check when done and a ring when current;
only the current step is open, completed steps collapse to a one-line summary and stay editable;
future steps are visible but quiet. The primary action of the current step is the only filled
button. Its footer stays in the step's normal document flow, so it cannot cover a focused field. Demonstrations are explicit: for as long as a recording runs, a glass recording bar with a
pulsing record dot and the one Stop docks at the top of the guide column and sticks under the app
bar while the page scrolls (on narrow screens also above the editor panel); it never covers the
step's text or the editor's own controls, and the step that started it stays in place. Observations show a **before and after miniature
diagram** drawn from the recorded snapshots, with loose arrow ends visible, instead of a text diff.
Rules show their evidence mark. Technical details (JSON, hashes, gesture indices) sit in
disclosures titled "Technical details" and are not needed in the normal path.

**Two ways, one place.** At the top of the guide two equal cards offer the ways to create:
**Draw start and goal** and **Record a demonstration** (`aria-pressed` on the chosen card; a
running recording keeps the record way; a new session opens on the record way, where saved projects
live). The chosen way's guide follows below; neither way is a
fallback hidden under the other.

**Drawing way (stepper).** The same `stepper()` with three steps: **Start**, **Goal**,
**Exercise**. Start: "Start an empty drawing" (secondary) opens the real editor in author mode
(nothing is recorded), "Use the drawing as start" is the filled button until a start is taken.
Goal: locked until a start exists (summary "After the start"); "Use the drawing as goal" is the
filled button once the start is taken. Exercise: locked until both drawings exist (summary "After
the goal"); two checkboxes (keep the left-to-right order, keep aligned rows and columns) and
"Create exercise" as the filled button. A taken drawing collapses to a counted summary ("4 steps,
3 arrows taken."). The result is a success banner with the counted facts (goal conditions,
reference actions, near misses checked), a quiet line for ignored drawing elements, and the link
"Open my exercise" to a new practice session; a refusal is a danger banner in the step that caused
it, with the reason in one sentence. Each marker states its position for assistive technology
("Step 2 of 3, current."). Until a drawing exists, the engine panel shows an empty state
("Your drawing appears here") instead of an empty editor; once it is open, "In the drawing surface
now" lists what really lies in the editor and follows the drawing as it is drawn.

The guide column has the inspector's width (`--pn-guide-width` = 24rem), so the real editor beside
it is wide enough for its own desktop top bar at 1280 px. A foreign tool's chrome is never clipped
or hidden by the layout: where the embedded editor would cut its own controls (Excalidraw between
730 and 766 px), the player keeps it in its compact form instead. One deliberate exception: below
40rem the editor keeps a 40rem width inside a labelled horizontal scroll region with a visible line
"Swipe sideways…" and a persistent scrollbar, because a phone-width editor would draw the steps too
small to read; the object list is the complete text route (product-recovery, "Editor width").

### 10.5 Bench report and compare (static pages)

The pages `report --html` and `compare --html` write: one static file each, tokens plus
`src/bench/report.css` in one hashed style, no script, no external asset, no `data:` URI; linted by the
report profile of `design:lint`, which reproduces the kit it needs (chip, banner, filled status marks,
card radius and shadow, the disclosure chevron, Title 2 sections). The reader's next action: find the
run that failed and see why. So the headline carries the fraction and the 95 % interval; verification,
mirror, isolation and the self-reported model follow as chips. Failed runs and runs whose agent did not
end normally come first and open (`<details>` with the kit's chevron), passed runs collapsed; each run
shows its states by name (one item, one colon), the goal conditions with status marks and words, the
board above an example target, the trajectory and call log; identifiers, codes and hashes fold under
"Technical details". The board is the real engine's export or a schematic in the content tokens, always
captioned with which one it is; the pair shares one viewBox (one scale), its text is never drawn below
12 px (a wider board scrolls in its frame, with a faded edge and a line that says so; a pair with
draw.io's own export, whose text is 12 units, is drawn at one px per unit or more), and in dark mode
the export gets Excalidraw's own dark-mode filter so the pair shows one palette. Groups appear as a
solid tinted outline and a legend; a missing target or bench folder is a banner, never a dashed box.
Rates are fractions (PADR-0039 B.2). Long words hyphenate in the page's language; identifiers never do.
Below 40 rem tables stack into one block per row; the page never scrolls sideways.

The **result card** (`report --card`, 1280 × 640, light and dark, SVG and PNG) and the **badge**
(`report --badge`) are pictures of the same header line, for places outside the report (a README, a social
preview). The reader's next action: decide whether to open the report. The card sets the fraction in
Display, the interval and n in Subhead, the evidence in a list where each fact has its evidence mark
(§7.4: a filled accent disc with a check for confirmed, a dashed ring for not confirmed, never colour
alone; without re-verification every fact is a claim of the file and gets the dashed ring), and the caveat in Footnote at the foot; the badge is a chip (a fact, never an action). Both are
drawn from `src/bench/card.css` with the tokens resolved into each SVG; no script, image, link or font; text
is SVG text, never cut when it is a caveat (lines that do not fit in Subhead are set in Footnote; only what
still does not fit is drawn smaller as a whole).

## 11. States

Every surface defines these states. A screen without them is not finished.

| State | Treatment |
|---|---|
| Rest, hover, pressed, focus | Section 9. Hover lightens the fill; pressed scales to .97; focus is the 3 px ring with 2 px offset on every interactive element. |
| Disabled | The control loses its fill; text turns tertiary; the cursor is default. Never dashed. |
| Busy | Button shows a spinner and `aria-busy`; the surface stays visible; no full-screen blockers. |
| Empty | `emptyState()`: glyph, one sentence, at most one action. |
| Loading | A centred message with a quiet skeleton; no spinner wall. |
| Failure | Danger glyph, four-step text, the way forward; technical detail folded. |
| Success | Success banner, once; goal items turn green with check icons. |
| Unknown | Neutral banner with the hatched band: "no verdict", "not yet modelled". The board is unchanged and says so. |
| Stale | Warning banner: the board changed after the check. |
| Recording | Pulsing record dot, the docked recording bar with the one Stop; neither the drawing nor the step's text is obscured. |

## 12. Accessibility

- WCAG 2.2 AA is the floor: contrast per 7.2, focus visible, target size (40 px controls, 44 px on
  coarse pointers), reflow at 320 CSS px without two-dimensional scrolling (the drawing area scrolls
  sideways inside its own labelled region and every object is also reachable through the tray),
  status never by colour alone, reduced motion respected, forced colours supported.
- Practonaut controls and the Practice board work by keyboard. Native Excalidraw
  demonstrations require a pointing device; its canvas is not screen-reader-operable. Create
  and Excalidraw state this limit visibly. **Board keyboard model (unchanged from v0.1):** the board is one tab
  stop (roving tabindex); arrow keys / Home / End choose a step; Enter picks up, arrows move by 20
  units, Enter places, Escape cancels; `C` starts connect, `R` rewires an arrow end, Shift+R its
  start, `A` cycles connections, Delete removes; Ctrl/Cmd+Z undoes. Every pointer gesture has this
  keyboard path and a visible button.
- One polite live region announces selection, previews, committed actions with their number and
  consequences, cancel, undo, reset and checks. A step's accessible name is its label, its position
  and relations are in its description. No `role="application"`.
- Dialogs are native `<dialog>`; focus is trapped by the platform and returns to the opener.
- Screen-reader runs and manual 200 % zoom are human checks and stay OPEN until a person does them;
  automated scans never replace them (`manual-player-checks.md`).

## 13. Decision protocol (read before you design)

This is the part for future agents. It turns taste into procedure.

**Before you build**

1. Read sections 1, 2, 8, 9 and the surface you touch (10). Open `npm run design:gallery`.
2. Name the **user's next action** on the surface. If you cannot name it in one sentence, the
   design is not ready.
3. **Reuse before you invent.** Find the kit component. If one exists, use it with its variants. If
   none fits, answer four questions in your task notes: (a) which principle needs it, (b) why no
   variant of an existing component serves, (c) which states it has, (d) how it behaves at 320 px,
   dark and reduced motion. Then add it to the kit, the gallery and section 9 in the same change.
4. Values come from tokens. If a value is missing, add the token (section 6); never hard-code.

**While you build**

5. One primary button per surface (P2). One accent. One icon style. One shadow per level.
6. The canvas wins (P1). When adding chrome, measure what it covers and what it adds.
7. Copy first, then layout: write the strings in both languages, short, in the learner's verb.
   No literal text in markup. No praise. No jargon in the normal path.
8. Motion only for cause and effect, flagged to the event that caused it, with its reduced twin.
9. Keep the contracts: `data-testid`s, ARIA, focus restoration, the stage areas, Trusted Types (no
   `innerHTML`), CSP (no inline style attribute markup, no `data:` URIs, no remote fonts or images).

**Banned patterns (each is a finding, not a taste question)**

Purple or gradient heroes · glow and coloured shadows · glass anywhere except the four floating
things · capsule containers or rounded-rectangle buttons · two primary buttons · a second accent
colour · status by colour alone · emoji · gamification (points, streaks, progress rings, confetti,
praise) · nautical or space imagery · mascots and "AI tutor" voice · placeholder text as a label ·
dashes for decoration · outline removed without a replacement · text below 12 px, ad-hoc sizes,
off-scale spacing · a screen without its empty, loading and failure states.

**Before you say it is done**

10. `npm run check` (types, schemas, docs, contrast, **design lint**) and the layers your change
    touches (`npm test`, `npm run test:e2e`, `npm run test:a11y`).
11. Take screenshots of every state you changed ([review protocol](review-protocol.md) §2) and
    **look at them**: light and dark, EN and
    DE, 1280 and 390. A visual change that was not looked at is not done. Look for: the canvas still
    wins, one primary action, alignment on the grid, no clipped or wrapped-badly text, concentric
    radii, focus visible, nothing that reads as a default browser control.
12. Independent review: a fresh reviewer (not the author) looks at the rendered images with the
    `design-language-review` lens of this document and writes findings with severity. Major findings
    are fixed or consciously disposed in writing. Record the round in section 16.
13. Docs in the same change: this document (catalogue, surfaces), the gallery, the test notes.

**Changing the language itself**

A new principle, a changed token scale or a new banned pattern needs a decision record (PADR) and a
re-render of the whole contact sheet. Agents do not change section 2 or section 13 on their own.

## 14. Brand and naming

- The wordmark is the product name set in `--pn-font-sans`, 17 px, weight 700, tracking −0.02em.
  There is no logo and no glyph until the name is cleared.
- The publisher's name (the copyright holder in `NOTICE`) may appear in README, About and package
  metadata, never on the working surface.
- Practonaut is a sibling of its publisher's brand under the same discipline (tokens only,
  states complete, no slop), not a recolour. Where this language deliberately deviates from the
  parent brand's guardrails (capsule shapes for pressable things, selective glass for floating
  chrome, soft elevation, a single Apple-neutral accent) the reasoning is in PADR-0020.

## 15. Open questions

1. Vendored OFL fonts for identical rendering on every platform: not decided; system fonts follow
   the user's platform on purpose. It would not change any token name.
2. Larger worlds need zoom, pan and a target-size concept; not designed.
3. VoiceOver and NVDA runs of the board keyboard model need a human tester.
4. Whether "hint opened" belongs in exported attempt data and who may see it.
5. Dark canvas colour for exported artefacts: the editor keeps its own theme.
6. The orange step outline (U14) is below 3:1 in the light theme because it copies Excalidraw's own
   value; whether the Player should draw a darker shade than the editor is not decided.

## 16. Review history

Version 1.0 was reviewed in five independent rounds on rendered captures of every surface
(practice, Excalidraw workspace, Create, cross-cutting), light and dark, desktop and phone widths,
between 2026-10-07 and 2026-10-09. Scores rose from 0.66 to 0.89 overall; the final round had no
blocker and no major finding, and the maintainer accepted the design as the binding baseline on
2026-10-09. The manual screen-reader and 200 % zoom path was run once by a person on 2026-10-17
(VoiceOver, macOS, Chrome, 0.2.0) without findings; other screen readers and regular screen-reader
users are not tested yet ([manual checks](manual-player-checks.md)).

Release 0.2.0 added the bench report v2 and the compare page (§10.5). They were reviewed in two
independent rounds on rendered captures of every report and compare state, light and dark, at 1280
and 390 px (round 2 also at 768 px), with German for the longest pages, on 2026-10-14 and
2026-10-15. Round 1 had 17 findings, round 2 two must-fixes (an unjudged run shown as failed; a
group outline missing on the engine export) and nine smaller ones; all were fixed and the fixes
checked on new captures before the change was merged
([pull request #31](https://github.com/godarg/practonaut/pull/31)).

The first-minute screens of 0.2.0 (model-only banner, the demonstration and its states, the
refusals on the demonstration's board) were reviewed on captures of every state, light and dark, at
1280 and 390 px, with German for the longest strings, on 2026-10-15: one must-fix (a refused
demonstration step shown with the person-facing message) and twelve smaller findings, all fixed and
checked on new captures; the demonstration's step list joined the kit (§9)
([pull request #33](https://github.com/godarg/practonaut/pull/33)).

The task-limit states of 0.2.0 (changes and checks left, a failed check used, every change and check
used) were looked at on captures, light and dark, at 1280 and 390 px with German, on 2026-10-15: one
must-fix (with every change used, the refused "New variant" was still the primary button) was fixed
and checked on new captures ([pull request #32](https://github.com/godarg/practonaut/pull/32)).

Round R1 of the bench report v3 pages of 0.3.0 (the artifact-judged report, a report whose client
values were not re-derived, the compare pages across worlds and the refusals of the regression gate
and of runs judged in different ways) was reviewed on 2026-10-19 by an independent agent started from
fresh context: eight registered states, light and dark, EN and DE, at 1280 and 320 px, from commit
`a6f4fe9`, plus the result card and the badge. Verdict conditional: no blocker, 9 major and 13 minor
findings. The majors (identifiers and flags broken by hyphenation, one caveat said three times in a
header, artifact run cards that did not say why a run failed, five on the compare pages across worlds,
a gate refusal that contradicted itself) were fixed, each with a test that fails on the reviewed
commit, and the missing state with changed outcomes across worlds was registered. Consciously not
done: "level" stays on the §3 list (the pages say "how runs were judged" instead; no rule change);
the badge keeps the header line's facts (§10.5) and only marks the preset as a claim; a world
difference still shows the short content hash, since that is what differs; the terminal's refusal
keeps its decision-record number, which the pages no longer show. A re-review on the fixed state
follows ([pull request #66](https://github.com/godarg/practonaut/pull/66)).

Round R2 of the same pages was reviewed on 2026-10-19 by an independent agent started from fresh
context: 13 states, 38 captures plus 2 badge images, from commit `440e261`. Verdict conditional: no
blocker, 1 major and 13 minor findings; the R1 majors F2 to F9 were confirmed resolved and F1 only in
part. The major (identifiers still split at line ends at their own hyphens, which reads like the
page's hyphenation) was fixed: every identifier word up to 32 characters is now one unbreakable unit,
the instance cell takes a stacked row's full width, and `test:a11y` measures every identifier word's
line boxes, red on the reviewed commit. Consciously not done: a page title (the agent's name) and a
quoted board label may still wrap at their own hyphens, since a title or an author's label longer
than a phone's line has to wrap somewhere; "Wilson score interval" became "Wilson interval" rather
than a rule question about the term of art. A short round R3 looks at the major's states again.

Round R3 looked at the R2 major's states on 2026-10-19, an independent agent from fresh context: 20
captures from commit `75c99cf`. R2-F1 was resolved on every image; verdict conditional: no blocker,
1 major and 4 minor findings. The major (in the session compare's stacked table at 320 px the
instance name, joined into one unit by R2, was cut inside "Seed" in its half-width cell) was fixed:
every compare gives the instance cell the full stacked row, an instance name that fits a line is one
unit, and `test:a11y` measures every word of the instance cell, red on the reviewed commit. The
minors were fixed (run-count lines name their pair as the table does; "Wilson", "McNemar" and
"Practonaut" are never hyphenated in notes and notices; a formal line wraps between its words; the
compact table applies only where the table does not stack). Nothing was consciously left undone.

Round R4 looked at the R3 fixes on 2026-10-19, an independent agent from fresh context: 15 captures
from commit `2603d7d`. Verdict PASS: no blocker, no major, 3 minor findings. R3-F1 was resolved on
every session compare and R3-F2 to F5 were accepted. The minors were fixed after the merge: an
operator moves to the next line with its operand instead of ending a line (see R5 for the exact rule),
the change column of a compare takes the full stacked row, and a cell's words may break before a
number so its text shrinks to the cell. `test:a11y` now measures all three, and the two R3 fixes the
round found untested (a formal word cut inside, a compact table that stacks), each red on the commit
before its fix.

Round R5 looked at the R4 fixes on 2026-10-20, an independent agent from fresh context: 15 captures
from commit `50b9b75`. Verdict PASS: no blocker, no major, 5 minor findings, all fixed with a check in
`test:a11y` that is red on the reviewed commit. The rule that holds for formal lines: a comparison
(left operand, operator, right operand) moves to the next line whole; only a comparison wider than the
line breaks, after its operator, which then ends the line with its left operand and never stands
alone; a quoted value or "nicht angebunden" that fits a line is never split. The trajectory's
"conditions met" takes the full stacked row like its result, whose counted phrase ("(Revision 1)")
stays whole again; "95‑%" keeps its hyphen, and a label keeps a single item ("verloren: 3").

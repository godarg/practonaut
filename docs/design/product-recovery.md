# Guided process-repair exercise

Status: implementation design, 2026-10-04. Sources: PADR-0015, [design language](design-language.md), [authoring guide](../authoring-guide.md), actual Player/recovery UI.

## Promise and primary path

Create a checked local process-repair exercise from a prepared template and your demonstrations. The author gives steps visible names, explicitly records three declared operations in the actual embedded editor, reviews before/after consequences, supplies further recorded evidence, sets a finite exercise goal, reviews independent prepared examples, saves the named project and opens the compiled exercise directly.

The prepared example is also immediately playable. Its origin remains prepared; it is not fresh synthesis. General demonstration compilation and further adapters are out of scope.

The workbench uses six steps (since design system v1, see below): plan, record, review, confirm, goal, finish. The current step opens; previous/future steps remain revisitable. Desktop keeps the editor beside the author context; narrow views keep all controls as native text. Prepared starting/target diagrams appear before recording. Empty/loading/error/success messages distinguish actual state. Technical author JSON, recording ids, indexes and hashes remain in a closed detail view. Normal completion does not require them.

## Evidence language

A matching template is supported by the displayed observation, not confirmed merely by analysis. “Confirmed by an additional demonstration” / “Mit weiterer Vorführung bestätigt” means another compatible recorded observation passed backend validation. It does not mean an external reviewer, another person or universal generalization. Same starting scene in another run is not called a new case.

A deletion of an unattached step cannot determine incident-arrow behavior. A distinguishable deletion instead explains which named step disappeared and which named arrow endpoints became unattached. A retained refuted explanation shows its counterexample without repeating the same action request.

Author task intent and labels never supply behavior evidence. Prepared reference solutions and independently specified alternative/near-miss examples are labelled. Edited task intent must be previewed before explicit example review; edits invalidate the previous review. Only confirmed supported rules may compile. Readiness messages name current missing conditions and never ask for fulfilled conditions again.

## Visual and interaction contract

Reuse --pn tokens, typography roles, evidence marks with words, reduced motion, visible focus and 320 CSS px reflow. Task is a typographic sheet, the editor a work surface, results a report. No learning-progress claims or praise. Keep task/result/next action adjacent; full provenance is reachable rather than repeated as file paths across the normal screen.

Native board and actual editor remain distinct. Each learner change is checked against the real embedded Excalidraw mirror. Unsupported actions remain explicitly unmodeled; disagreement rejects the action and retains the committed scene. Mirror is never disabled to produce success.

Dialogs are reserved for destructive actions. Escape closes them; safe action receives initial focus; focus returns to the original control. Form drafts survive render, locale changes and request errors. A named save represents persistent project storage; reopening after own host restart is a required test, not inferred from an in-session saved banner.

## Evaluation and limits

Design goals, not measured thresholds: explain purpose/next action/end result from the entry in about 30 seconds; no external technical instructions; no required JSON/internal ids; a small complete prepared path approximately 5–10 minutes; no saved-state loss on restart. Agent role-play remains agent testing, never human acceptance.

`tests/e2e/recovery.test.ts` generates actual EN/DE × light/dark × 1280/320 core-state render evidence. The historical `tools/recovery-render.ts` was a producer prototype renderer, not final-state acceptance. `tests/e2e/recovery.test.ts` exercises scripted native recordings, new evidence, goal/example review, persistence and exact-hash practice launch on isolated local sessions. Final snapshots, full declared tests and independent reviewers must be bound to the accepted commit. No independent visual PASS is claimed by this contributing author.


The normal goal editor retains the prepared project title until the author changes it. Valid result and alternative explain which original visible arrow is retained and which endpoint is changed. Their finished connectivity is the same; their arrow identity differs. Relation previews use compact semantic placement and readable labels rather than reproducing scene geometry.

Changing the embedded editor viewport moves only its camera. Scene data, gesture recording and history remain unchanged. The narrow viewport exposes a focusable horizontal scroll region around a minimum 56rem native editor, with an adjacent exact semantic object list. This keeps labels readable while page controls reflow. Native viewport screenshots complement full-page captures because browsers can omit painting offscreen iframe canvases.

The recovery DOM E2E includes axe checks of start, active recording, review, evidence, goal/examples, finish and the concrete missing-author error; it also measures zero external requests and saved-project restart. Automated accessibility checks and agent renders do not satisfy the open human VoiceOver/manual 200% zoom checks.


## Repairs after fresh novice and visual review

The project-transition defect was concrete: rendering used stored second-case labels, while
untouched form submission used different default labels. Old project drafts also survived
Prepare. Rendering and submission now share project-scoped canonical case values (including
case identity and offset); new project ids reset prior task/case/object drafts. Preview adopts
the exact returned intent. Unsaved same-project typing remains preserved. A two-project DOM
regression checks untouched and edited cases and English author content under German UI.

The prepared target is part of stage 1. Review is numbered 2b. Global technical ready/recording
status no longer precedes the author purpose; recording status remains beside Start/Stop.
Footer, normal navigation and glossary use consistent exercise/project vocabulary. Mode
selection is visible. Goal-stage comparisons span desktop width for bounded readable diagrams;
small views stack them. Arrow A/B captions identify different retained original arrows even
when both final graphs have identical connectivity; open caps identify loose endpoints.

On restored author work, the ready native editor loads `AuthorView.scene`, without starting
recording. A retained active host recording shows explicit Stop/Review and describes the
unfinished-gesture gap. Early author/editor navigation waits for actual engine readiness.
The preparation, source, consent and evidence controls remain explicit.

Final repair captures live under `.local/product-recovery-renders-final-repair/`. The test
waits for native document locale, translated native Undo and actual theme before screenshots.
Its ledger records authored case labels separately from UI locale and hashes actual HTTP
JS/CSS responses plus every PNG. These producer artifacts require fresh independent review.
No prior snapshot review is carried forward as acceptance of changed assets.

## Bounded final corrections (PADR-0017)

The default task keeps one whole goal and one verdict. A finite readable narration
may carry the complete formal description in a closed disclosure. Before a check,
the task explicitly says that no result check has taken place. A changed scene does
not reuse a previous verdict. Explanatory prose uses the sans stack; counters,
identifiers and diagnostic data retain the monospace stack. The task is an open
sheet with a strong top rule, rather than another undifferentiated box.

Below 84em the learner drawing occupies its own row; wide displays place the
result beside it. The 56rem drawing retains real reading size and a labelled,
keyboard-scrollable region at narrow widths. The entire page must not overflow.
The author can jump directly to the drawing. While recording, the fixed, reachable
"Stop and review" control in the floating bar is the only Stop and the only place that
says a recording runs; the open step shows a calm progress line. It never starts a
recording or re-mounts the editor iframe. The page keeps a last row as tall as the bar,
so the bar covers no final content. Below 72em the step and the editor head say where the
drawing surface is and list the three changes. A confirming demonstration starts from
Confirm, which reloads the starting scene; the stepper never runs backwards (review r2).
The drawing surface shows its own loading state (skeleton and "Opening the drawing
surface…") and, after failed restoration, a failure state with "Try again" in the panel;
the status line above says what happened.

New prepared scenes allocate at least 280 scene units for each step before recording,
and widen them for the longest whitespace-delimited word using the pinned mono
font's bounded allocation, capped at the existing 2000-unit world limit. Existing
projects and recordings retain their geometry. This improves the demonstrated
English/German names and a compound-word case; it does not promise readable
rendering for arbitrarily long 4096-character names. Variants and independent
examples derive from that same prepared canonical geometry.

A requested workspace stays pending until the actual engine language, configuration
and content acknowledgements complete. The application brings the drawing into
the viewport before its real layout boundary. Inputs and parallel mode switches
are blocked while preparing. Navigation, displayed workspace and tab cache commit
together on success. Failure restores the earlier engine mode, presentation and
modeled scene. Failed restoration retains locked native input and an explicit
recovery message; no ready state is claimed. The frame's rebuilt reverse-binding
cache is excluded native metadata; stored original recordings are never rewritten.

Developer regressions include the normal delayed-locale transition without a helper
scroll, a missing locale with stable workspace/cache, and a lost real configure
acknowledgement after native content has changed. Render measurements cover all
three desktop object rectangles, actual scaled label text, whole native words,
320px horizontal access and the reachable stop control. These are implementation
checks and generated renders, pending independent acceptance. Human accessibility
checks remain open; human competence transfer remains unknown.


## Design system v1 rebuild (2026-10-08)

The Create workspace was rebuilt on the v1 kit (PADR-0020, design-language §10.4). Stage keys and
`data-stage` semantics are unchanged; the visible structure changed:

- A hero (eyebrow, title, one sentence, "Try the prepared exercise", "Local on this computer") and
  a vertical stepper of six cards with numbered markers on a rail (check when done, ring when
  current). Only the current step is open; a step the author opens stays open until the flow moves
  to another step. Each open step has at most one filled button; Confirm has none while new
  demonstrations are selectable rows.
- Before/after drawings (`src/player/ui/miniature.ts`) replace the text chains: in Plan from the
  typed labels, in Review per recorded change from the recorded snapshots (loose ends as rings in
  the danger colour, at the place the end was attached), in Confirm as thumbnails, in Goal for the
  host's independent examples with arrows A and B. Narrow containers use a narrower drawing so
  before and after stay side by side; labels wrap by measured width and only elide past two lines.
- A floating recording bar (record dot, "Recording", Stop) is fixed at the bottom of the viewport
  under the guide column on wide screens and centred on narrow ones; it is the one Stop of a
  recording (below 48em a full-width row with a hairline edge; below 22em only the dot and Stop remain).
- One message at a time: busy and errors appear in the step that caused them, a result that opens
  the next step travels with it, and an engine alert (status banner) hides the guide's message.
  Validation errors also mark the empty field with aria-invalid.
- The engine panel has a head (title, local note and, once a scene is prepared, a Ready or Loading
  chip); without a project it shows the coming scene instead of an empty editor. The real iframe is never reparented.
- Technical authoring details use kit cards; evidence marks are the kit's (`.pn-evidence__mark--*`).

Editor width (ER-05, 2026-10-08): the guide column is as wide as the practice inspector (24rem), so
at 1280 px the real editor gets 800 px. Excalidraw switches to its desktop chrome at 730 px but needs
748 px (English) to 766 px (German) for its top bar; in that band the player keeps the editor in its
compact form at 729 px, centred (container query on `.native-editor-scroll`). The editor is 37.5rem
tall. The camera fit (practice Excalidraw workspace and Create) measures the area left by
Excalidraw's own chrome as it is laid out at that moment (toolbar and hint, zoom/undo bar, mobile
bars) plus room for the frame name, takes the size from the editor's root element (the app state can
still hold the size from before the editor was shown), takes its zoom from the content (legibility)
and then shows the frame closed on all four sides when it fits at that zoom, at an exact smaller
zoom of at least 65 %, or, when the content zoom is already below 65 % (compact editor), at up to
10 % less. The camera moves once, after every scene load and every resize of the editor;
a new scene starts without a selection, so Excalidraw's properties panel never opens over the
drawing. Measured by `tests/e2e/editor-chrome-fit.test.ts` (1152–1440 px, EN/DE, the band, the
Excalidraw workspace on first show and after a restored scene, frame and frame name clear of every
Excalidraw bar).

Known limits: below 40rem the editor keeps a 40rem minimum and scrolls sideways inside its labelled
region, by decision: Excalidraw's phone layout at 358 px would show the steps at about 30 % zoom,
too small to read; the adjacent object list is the complete text route (r3 UP-06, disposed); the sticky editor is switched off while the technical details are open because sticky
positioning is not confined to the guide row.

Review r3 (Create, 2026-10-08):

- Goal (ER-07): the variants are a flat list, one row per variant with its chain of names, a fact
  chip when it repeats the process or variant 1, and "Change names", which opens the three fields
  of exactly that variant (at most one open). "Suggest names" fills every variant from a small
  built-in EN/DE catalogue (`suggestVariantNames` in `recovery.ts`; no model call, PADR-0008):
  never a name of the process or of the scene, never the same name twice; the same input gives the
  same names. The rule is unchanged (three different, non-empty names per variant); a wrong name
  opens its variant and the error stands at the field, and nothing reaches the host. In the normal
  path Goal shows five input fields (two titles, three step choices), down from eleven. The title
  fields state their rule as a hint under the field (R3-09).
- ⛔ superseded by "Review r4" below (bar at the top). Recording (R3-04): the guide keeps room under its last line for the floating bar (bar, its
  offset and `space-4`) and `scroll-padding-bottom` keeps a focused control above it; the open
  step leads with its status and hint, so the bar does not lie on them at the top of the step
  (measured at 1280 and 390, scroll 0: no overlap).
- Finish (R3-10): result banner and primary sit in the step's sticky footer; after creating, focus
  moves to "Open my exercise" and with it the view (measured at 1280: both inside the viewport).
- Confirm (ER-12): a candidate shows its drawing above, the change across the full width, then
  source and "Use" on one line.
- Engine messages (UP-17): "not yet modelled" is a title, one sentence naming the property and one
  sentence saying what to do; a failed mode change is titled "The drawing surface did not open",
  says that the previous mode stays and offers "Try again" as a button. Try again after an editor
  failure shows the panel's loading state while it runs. The quiet transition line sits in the
  status row of the Create grid (it used `grid-area: foot`, which Create does not have, and the
  implicit column squeezed the page); a language change during a transition reaches the guide.
- Review states (R3-G1, ER-11): `tools/design-states.ts` walks plan error, editor failure and
  loading in Create, record error, analysed first, 1 of 3 confirmed, goal changed and technical
  details open, in the flow's order, so `design:capture`, `design:invariants` and the a11y tool
  reach them. The editor failure is a fault at the engine response boundary, the loading state a
  held project read during Try again.

Review r4 (2026-10-09), Create:

- Recording bar (ER-04, R3-04): the bar no longer floats at the bottom edge. It is a stage item in
  the guide column spanning from the guide row to the end (`.create-recording-dock`), rests on the
  guide's first row, which is exactly as tall while recording (`.create-guide::before`, a
  dimension, not padding), and sticks under the app bar while the page scrolls, on narrow screens
  also over the editor below the steps. At rest no visible text lies under it (measured at 1280 and
  390 with a text-node walk; e2e pin in `recovery-ui-final`). The app bar's real height is measured
  in `phase3.ts` (`--_appbar`), because on narrow screens it has two rows. `scroll-padding-top`
  keeps a focused control below app bar and bar. Hints say "Stop in the bar at the top".
- Editor failure (R4-10): one voice. In Create the banner above the page stays hidden while the
  panel shows the failure: ⊗ on the danger disc, "The drawing surface did not open", "Your project
  is kept.", "Try again". "Go to the drawing surface" in the open step leads to Try again
  (below 72em a text button is added where the step has none). A failed mode change that kept the
  editor stays in the banner, now "You stay in the current area." (no "mode"); the editor's
  unmodelled message says "drawing surface" instead of "board".
- Object list (R4-09): while the drawing surface opens or failed, the list shows "Appears once the
  drawing surface is open." instead of chips (`data-waiting`).
- Loading line (R4-04): in Create the quiet "Preparing the drawing surface…" line with its dot is
  not shown; the panel shows the opening itself (skeleton, "Opening…", chip "Loading"), so the
  page no longer moves down by the line's height.
- Narrow editor (R4-02): below 48em a footnote above the editor says "Swipe sideways to see the
  whole drawing surface." (Create and the Excalidraw workspace); the region keeps its name.
- Goal: a grey "Accept examples" has a line above it naming what unlocks it, gone with the tick
  (R4-06); the variant chain wraps only at its arrows, each name is `white-space: nowrap` (R4-14).
- Copy: "Record confirmation" (R4-08); the summary of missing fields names fields, comma-separated
  ("Demonstrator, Permission", R4-11). "Delete recording" in the technical details is the danger
  button (R4-13).
- A field with an error and "Open my exercise" after creating are focused and brought to the middle
  of the view (R4-07, R3-10).

Finish below the fold (R3-10, R4-05), measured: in the flow, after "Check and create exercise",
"Open my exercise" is focused and in view (1280×900: y 671–711). The review captures reset the
scroll to 0. There the Finish step starts at y≈804, so its sticky footer can move up only to the
top of its own step body (y≈860): the primary is below the fold, the footer covers the step's lead
and checklist, and its natural slot (≈220 px under the primary in the full-page shot) stays empty.
This is not the recording room (that exists only while `data-recording` is set). Create states
whose action moves the view declare it (`view` in `tools/design-states.ts`); a capture that honours
it shows the screen the author actually sees.

Known limits after r4: the capture tool does not yet read `view`; variants start equal to the
process (ER-07 rest, disposed).

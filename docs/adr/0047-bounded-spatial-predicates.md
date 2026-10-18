# PADR-0047 — Bounded spatial predicates: six layout operators over the judged geometry

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, strand P5 (issue #48) · Amends
[PADR-0013](0013-bounded-predicates.md) (vocabulary and fuel accounting; its exhaustion rule is
unchanged) · Records the maintainer decision on founder question F6 of 2026-10-18 (delegated) ·
Uses [PADR-0040](0040-challenge-tier-generated-families-and-gate.md) (stress boards, half the
budget), [PADR-0042](0042-gate-for-families-on-toolchains.md) (unit `layout.practonaut`),
[PADR-0043](0043-artifact-judged-verdict-level.md) (reading rules) and PADR-0044 (bench/3, proposed
on branch `design/bench-v3`) · To be accepted after an independent review, before the
implementation (P5b: predicates, narration, pictures, generator `challenge-layout`) and before the
draw.io checker parser and the artifact-mode readers are written

## Context

[PADR-0041](0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md) decision 3
asks for a spatial-layout family judged by geometry: steps that must not overlap, aligned and evenly
spaced steps, arrows that neither cross nor pass through steps, every step in its frame and inside a
canvas the task names. PADR-0013 allows only the closed vocabulary of `src/world/types.ts` and says
that "a goal requiring path matching or an executable extension … requires a new ADR". Goals state
layout today only through from-scenes' `--layout relative` (`lt` on `x`) and `--align` (pairwise
`near` on top-left `x` or `y`) (`src/authoring/from-scenes.ts:181-203`), which four library tasks
use (`add-step`, `align`, `reorder`, `restyle-flow`); none states overlap, spacing, crossings or a
canvas.

**What the judged state holds.** Steps carry integer `x`, `y`, `width`, `height` (≥ 1) and a shape
name (`src/world/types.ts:18-23`, `src/world/schema.ts:54`, `src/checker/state.ts:25`); a frame has
only a name (`types.ts:5`, `src/checker/scene.ts:117`); an arrow has only its two ends, each a live
step or `null` (`types.ts:26`). Membership in a frame is the step's `frameId`
(`scene.ts:118-121`). The Excalidraw scene reader rounds positions and sizes, makes a size at least
1 and ignores angles (`scene.ts:94-95`, `:131`); it bounds `x`, `y`, `width` and `height` each by
10⁶, so a right edge can reach 2·10⁶ (`scene.ts:11`, `:61-65`), and it admits 5 000 elements
(`scene.ts:10`). Practonaut's own actions bound coordinates to ±100 000 and sizes to 10–4 000
(`src/world/schema.ts:115-118`).

**Maintainer decision (F6, 2026-10-18).** The judged geometry is stated in the goal sentence: an
arrow is the **straight segment between the centres of its two steps**; "in a frame" is
**membership**; "inside the picture" is **inside a rectangle the task names**. Elbowed, curved or
orthogonally routed arrows are not judged by their drawn path. Player and report draw the judged
segments, so the picture shows what was judged (vision §6 principle 8). Practonaut's adapter already
draws every arrow straight along the line between the two centres, from 4 px outside one box to
4 px outside the other (`src/adapters/excalidraw/raw.ts:20-25`, `:59-63`, `elbowed: false`), and
the Player's board mode does the same (`src/player/ui/board-art.ts:111`).

**Cost today.** The evaluator ticks once per AST node, value and visited object, including objects a
scan filters out (`src/predicate/index.ts:10-33`); the checker shares one budget of 10⁶ steps per task
between the three counter-probes, fixtures, the goal and the error classes
(`src/checker/index.ts:66-92`). Exhaustion is `checker_fuel_exhausted`, never a verdict (PADR-0013).
A bench run whose judging throws — exhaustion included — becomes `infra_error`
(`src/bench/run.ts:398-401`), and more than 5 % of those voids a gate round (PADR-0040). Generated
instances stay within half the budget on stress boards, which add one object per action up to the
family's action cap (`src/challenge/build.ts:36-41`, `:73-89`, `:111-112`); stress steps all sit at
(0, 0) (`build.ts:56-62`), which is harmless today because no clause reads positions.

**Narration and pictures today.** `publicConditions` gives every top-level goal clause one id, a
sentence (the task's `conditionTexts`, else an exact-shape narration) and the formal text from
`describePredicate`; the Player view, the check result and MCP all use it
(`src/host/session.ts:92-99`, `:154-215`, `:253`, `:429`; `src/mcp/server.ts:32`). The bench report
draws the final board as the engine's picture or a schematic of the judged state and already overlays
what an export cannot show (group outlines) from the judged state (`src/bench/details.ts:359-362`,
`src/bench/schematic.ts:1-8`).

**Two traps found while reading.** (1) A variant's `layoutOffset` shifts every step but never an
integer literal in a predicate (`src/world/variant.ts:41-56`; the checker does the same,
`src/checker/index.ts:35`), so a canvas written as literals would not move with the board. (2) At
artifact level one tool call can add hundreds of objects, so "one action adds one object" no longer
bounds the judged board. Measured on existing code (`.local/` script, `verdictFuel` of
`challenge-repair` 1.0.0, difficulty 2, seed 3, on `stressState` boards): 75 257 steps with 50 extra
objects, 664 682 with 200 and 2 395 582 with 400 (half steps, half arrows). The last is more than the
shared budget of 10⁶: the checker would stop with `checker_fuel_exhausted`, and the run would be
`infra_error`.

**Measured cost of the proposed operators.** A prototype of the six operators under the cost model
of decision 4 (`.local/wave/spatial-cost.ts`, not product code; arm64 macOS, Node 22.22.3):

| Board | noOverlap | aligned | evenlySpaced | within | arrowsNoCrossing | arrowsClearOfSteps |
|---|---|---|---|---|---|---|
| 50 steps, 46 arrows, N = 117 | 1 443 | 218 | 567 | 218 | 1 245 | 2 727 |
| 116 steps, 108 arrows, N = 292 | 7 195 | 525 | 1 452 | 525 | 6 287 | 13 561 |
| 256 steps, 240 arrows, N = 10 000 | 43 153 | 10 513 | 12 816 | 10 513 | 39 161 | 82 433 |

Ticks were identical for a spread grid and a clustered pile of the same objects; no operator took
more than 26 ms in that run. A plausible layout instance — 16 steps in two framed lanes, 17 arrows,
the from-scenes multiset goal (38 clauses, 18 error classes) plus one clause of each operator over
all steps or all arrows — costs at most 281 679 steps (28 % of 10⁶) on the PADR-0040 stress boards
with 60 extra objects; the six layout clauses contribute 6 601–7 489 of that, the existing multiset
clauses the rest.

## Options considered

**A. What geometry is judged.** (1) The drawn path: Excalidraw arrow points, draw.io waypoints,
curves and elbows. Every application derives these differently, in floating point, and judging them
is path matching (PADR-0013). (2) Straight segments between centres, membership, a named rectangle
(chosen; F6).

**B. How the vocabulary grows.** (1) Arithmetic in the existing language (`x + width` values,
pairwise `every`/`every`): overlap needs a sum per comparison, crossings need products — a general
arithmetic language one step from an executable extension; a pairwise scan costs N² over all
objects, not n² over the selected ones; the formal text becomes unreadable. (2) Six operators with
fixed, documented semantics (chosen). (3) A general geometry language (points, polygons, arbitrary
intersections): deferred until a measured need, as PADR-0013 deferred a graph language.

**C. Cost accounting.** (1) Pay as you go, one tick per pair actually tested, stopping at the first
violation: the cost depends on where the first violation sits, stress boards must avoid early exits,
and a tick per sort comparison depends on the JavaScript engine's sort algorithm. (2) Charge the
pair and sort work by formula before testing (chosen): the cost depends on counts only.

**D. A selection too large for the budget.** (1) No cap: 10 000 steps give 5·10⁷ pair ticks, so an
agent could exhaust the budget. (2) Cap, then `checker_invalid`: an agent-reachable error. (3) Cap,
then the clause is false (chosen): a judged, deterministic result, documented with the operator.

**E. Exhaustion on an agent's board.** (1) Judge it as failed: contradicts PADR-0013 ("never a false
goal") and would hide a broken cost bound as a model failure, favouring agents that add fewer
objects. (2) Keep `infra_error` and make exhaustion unreachable by construction (chosen).

**F. Geometry outside the safe range.** (1) `checker_invalid`: reachable at artifact level, because
the scene reader admits right edges up to 2·10⁶. (2) The clause is false (chosen).

**G. "Evenly spaced".** (1) Equal distances between centres. (2) Equal gaps between neighbouring
boxes (chosen): the free space is what a person sees; for boxes of equal size along the axis the two
agree.

**H. Loose ends.** (1) Skip arrows with a loose end: an agent could dodge a crossing by detaching an
end. (2) A selected arrow with a loose end makes the arrow clause false (chosen).

**I. Arrows between the same two steps** (A→B twice, or A→B and B→A). (1) Compare them: their
judged segments coincide whatever the layout, so the clause could never hold. (2) Do not compare them
(chosen).

**J. Where the operators may appear.** (1) Anywhere in a predicate: costs multiply under quantifiers
and narration has no sentence for nested uses. (2) Only as a top-level goal clause or an error class
condition (chosen).

## Decision (proposed)

### 1. Scope

1. Six operators join the **world/2** predicate vocabulary: `noOverlap`, `aligned`, `evenlySpaced`,
   `within`, `arrowsNoCrossing`, `arrowsClearOfSteps`. world/1 stays closed (`PredicateSchema`
   refuses them).
2. **Position.** A layout operator may stand only (a) as a task's `goal` or as a direct argument of a
   top-level `all` goal, or (b) as an error class's `when`, directly or under one `not`. World
   validation refuses it anywhere else — inside a quantifier, `any`, `count`, a selection's `where`,
   an action precondition or a rule precondition — with `E_WORLD_INVALID`. Every layout clause is
   therefore one public condition with its own sentence, and costs add, never multiply. No
   application refuses an action because of layout, so a layout precondition would invent behaviour
   (architecture §10, "Explicit unknowns").
3. **Membership is not new.** "Every step in its frame" stays `frameId` equality (from-scenes'
   multiset clauses or `every step s: s.frameId = …`); frames have no geometry in the judged state,
   and whether a framed step's box lies inside its frame's drawn outline is not judged.
4. **Variants.** `within` names absolute coordinates. A world with a task whose goal or error class
   uses `within` is refused when any variant case has a `layoutOffset` other than (0, 0). The other
   five operators do not depend on where the board sits and allow any offset.

### 2. Shared definitions

- **Box** of a step: its `x`, `y`, `width`, `height` as stored — for every shape. An ellipse or a
  diamond is judged by its box, not its outline; the sentences say "box", and the pictures draw it.
  Rotation is not part of the judged state (decision 10 says how each toolchain keeps it out). Boxes
  of zero area do not exist (width and height ≥ 1).
- **Doubled coordinates.** To stay in integers every point is computed twice its size: the centre of
  a box is (2x + width, 2y + height); its doubled box is [2x, 2x + 2·width] × [2y, 2y + 2·height].
- **Judged segment** of an arrow: the closed segment from the centre of its `from` step to the centre
  of its `to` step. Direction plays no part. A self-loop's segment is the single point at its step's
  centre. An arrow with a `null` end — a loose end, which is also what deleting a step leaves — has no
  judged segment.
- **Selection** `{ type, as, where }`: like `exists`, every live object of `type` for which `where`
  holds with `as` bound to it. Step operators select `step`; arrow operators select `arrow`;
  `arrowsClearOfSteps` has a second selection of steps.
- **Cap.** A selection of more than **256** objects makes the clause false. The cap is part of the
  operators' semantics (lowering it would change verdicts), not a runtime limit.
- **Range.** Every box the clause reads — selected steps and the end steps of selected arrows — must
  have all four edges within ±1 000 000; otherwise the clause is false. Within that range, doubled
  coordinates stay within ±2·10⁶, differences within 4·10⁶ and every cross product below 3.2·10¹³,
  far inside the 2⁵³ of exact JavaScript integers.
- **Vacuous truth.** On an empty selection every operator holds; `aligned`, `noOverlap` and
  `arrowsNoCrossing` hold for one object, `evenlySpaced` for up to two. A goal the empty board
  satisfies is already refused by the checker's counter-probes before any verdict
  (`src/checker/index.ts:75-85`). The partial case — a selection emptied while the rest of the goal
  holds, for example every step moved out of a lane — is closed by presence clauses: every goal with
  a layout clause also fixes which objects its selections must contain (from-scenes' exact multisets
  do), and the generator checks it (decision 9). World validation cannot check it for hand-written
  worlds; the authoring guide says so.

### 3. The operators

Parameters are integers in pixels. "Holds" means the clause is true.

1. **`noOverlap { select, gap }`** (gap 0–10 000). Holds when for every unordered pair of selected
   steps p, q at least one of `p.x + p.width + gap ≤ q.x`, `q.x + q.width + gap ≤ p.x`,
   `p.y + p.height + gap ≤ q.y`, `q.y + q.height + gap ≤ p.y` holds: the boxes are at least `gap`
   apart horizontally or vertically. With gap 0, touching edges and corners are allowed; one box
   inside another is an overlap.
2. **`aligned { select, axis: x | y, anchor: start | center | end, tolerance }`** (tolerance
   0–10 000). The anchor of a step on `x` is 2·x (`start`, left edge), 2·x + width (`center`) or
   2·(x + width) (`end`, right edge); on `y` likewise with top edge, centre and bottom edge. Holds when
   the largest anchor minus the smallest is at most 2·tolerance. `axis: y` describes a row,
   `axis: x` a column.
3. **`evenlySpaced { select, axis, tolerance }`** (tolerance 0–10 000). Order the selected steps by
   their start on `axis` (`x` or `y`), ties by id (ids are unique, so the order is total and does not
   depend on the sort algorithm). Each gap is the next step's start minus the previous step's end
   (start + size) and may be negative. Holds when there are at most two steps or the largest gap
   minus the smallest is at most `tolerance`. Boxes stacked on one place have equal (negative) gaps;
   `evenlySpaced` is therefore always paired with `noOverlap` on the same selection (decision 9).
4. **`within { select, x, y, width, height }`** (x, y within ±1 000 000, width and height 1 to
   2 000 000, with x + width and y + height at most 1 000 000). Holds when every selected box lies in
   the closed rectangle: `x ≤ s.x`, `s.x + s.width ≤ x + width`, `y ≤ s.y`,
   `s.y + s.height ≤ y + height`. Touching the canvas edge is inside.
5. **`arrowsNoCrossing { select }`**. False when a selected arrow has a loose end. Otherwise holds
   when no two selected arrows a, b *meet*, judged on their segments:
   - arrows joining the same two steps (either direction, also two self-loops on one step) are not
     compared;
   - arrows that share no end step meet when their closed segments share any point — a crossing, a
     touch, an end lying on the other segment, a collinear overlap, or the coincident centres of two
     different steps;
   - arrows that share one end step E may meet only at E's centre c: they meet when their other
     endpoints u, v (measured from c) are both different from c, collinear with it
     (cross(u, v) = 0) and on the same side (dot(u, v) > 0), so that the segments overlap beyond c.
     Two segments from c that are not collinear meet only at c. A self-loop on E (a point at c)
     never meets an arrow from E.
6. **`arrowsClearOfSteps { select, steps }`**. False when a selected arrow has a loose end.
   Otherwise holds when no selected arrow's segment shares a point with the closed doubled box of a
   selected step other than its own end steps: an endpoint inside the box or the segment meeting
   one of the box's four edges counts, grazing a corner included.

### 4. Cost and bounds

Ticks (N is every object in the state, tombstones included; n and m the selected steps and arrows;
W the ticks of the `where` predicates, as `exists` spends them today):

- one tick for the operator node; one per scanned object and the `where` ticks, exactly as `scan`
  (`src/predicate/index.ts:21-33`), once per selection;
- one per selected object (reading its box and range; for an arrow, resolving both ends);
- pair tests charged in full before the first test: `noOverlap` n(n−1)/2, `arrowsNoCrossing`
  m(m−1)/2, `arrowsClearOfSteps` m·n;
- `evenlySpaced`: n·⌈log₂ n⌉ for the sort — a formula, not a count of the engine's comparisons — and
  n − 1 for the gaps;
- a selection over the cap stops after its scan (the clause is false, nothing more is charged); a
  loose end or an out-of-range box found while reading stops before the pair charge.

So the cost of a layout clause depends on N, n, m and W only, never on where objects sit, and never
exceeds: `noOverlap` 1 + N + W + n + n(n−1)/2; `aligned` and `within` 1 + N + W + n; `evenlySpaced`
1 + N + W + n + n·⌈log₂ n⌉ + n − 1; `arrowsNoCrossing` 1 + N + W + m + m(m−1)/2;
`arrowsClearOfSteps` 1 + 2N + W + m + n + m·n. At the cap on the largest valid state (N = 10 000,
`where` true) that is 43 153, 10 513, 12 816, 43 153 and 86 561 steps — matching the prototype's
counts above. There a single clause stays below 9 % of the budget and all six together below 21 %
(a `where` adds its own ticks per object, as in `exists`), so a layout clause is never the reason a
verdict runs out; the cap of 256 was chosen for that (a cap of 512 would still keep one clause under
half, but six together near 60 %). The largest selection a generated board can reach is 116 objects
(56 live objects, PADR-0040's board limit, plus 60 stress objects), well below the cap.

The constants live in `src/world/limits.ts` as `LAYOUT_LIMITS = { selection: 256, range: 1_000_000 }`
and are listed in threat model §4 with their effect ("the clause is false").

### 5. Fuel exhaustion and the gate

PADR-0013's rule stands: exhaustion is `checker_fuel_exhausted`, never a verdict; a bench run that
meets it is `infra_error` as today. A layout unit makes it unreachable on every board the round lets
an agent produce:

1. operators whose cost is bounded by the cap and independent of placement (decision 4);
2. too large selections and out-of-range geometry judged false, not errors (decision 2);
3. at session level, PADR-0040's rule unchanged: every instance's whole verdict — counter-probes,
   every goal clause and every error class, each costed separately — stays within half the budget on
   five stress boards with the family's action cap;
4. at artifact level, the reading rules of a layout unit refuse a result with more live steps, arrows
   and frames than the unit's stress boards hold (goal objects plus the action cap), with a named
   refusal code; PADR-0044 decision 1 judges such a result `unreadable`, that is, on the start file,
   which fails. The judged board never exceeds what the stress boards covered.

If exhaustion still occurs on a judged board, the bound was wrong: the run stays `infra_error`,
counts toward the 5 % void rule and triggers a re-assessment. A cost bug must void a round rather
than be scored as a model's failure.

### 6. Narration

`describePredicate` gains one formal form per operator, shown beside the sentence in the Player, the
check result and MCP, exactly as for every clause today (`publicConditions`, one function for all
three surfaces). `W` is the existing rendering of the `where` predicate (`all` / `alle` for `true`):

| Operator | Formal text EN | Formal text DE |
|---|---|---|
| noOverlap | `no two overlap: step [s]: (W); gap ≥ 20 px` | `keine zwei überlappen: Schritt [s]: (W); Abstand ≥ 20 px` |
| aligned | `aligned on y, centre: step [s]: (W); ± 4 px` | `ausgerichtet auf y, Mitte: Schritt [s]: (W); ± 4 px` |
| evenlySpaced | `evenly spaced along x: step [s]: (W); ± 4 px` | `gleichmäßig verteilt entlang x: Schritt [s]: (W); ± 4 px` |
| within | `inside (60, 40)–(1260, 520): step [s]: (W)` | `innerhalb (60, 40)–(1260, 520): Schritt [s]: (W)` |
| arrowsNoCrossing | `no two cross: arrow [a]: (W)` | `keine zwei kreuzen sich: Pfeil [a]: (W)` |
| arrowsClearOfSteps | `clear of steps: arrow [a]: (W); step [s]: (W)` | `frei von Schritten: Pfeil [a]: (W); Schritt [s]: (W)` |

Anchors read `start`/`centre`/`end` and `Anfang`/`Mitte`/`Ende`. The plain sentences state the judged
geometry, as F6 requires. The generator writes them as `conditionTexts`; `describeCondition` produces
them for the two exact selection shapes it can name — `where` `true` ("the steps", "den Schritten") and
`where` `frameId` equal to a uniquely named live frame of the start ("the steps in “Lane A”", "den
Schritten in „Lane A“") — and leaves every other shape to the formal text. Selections below are
shown for "the steps in “Lane A”"; German uses the dative throughout so one phrase fits every sentence.

| Operator | Sentence EN | Sentence DE |
|---|---|---|
| noOverlap, gap 0 | No two of the steps in “Lane A” overlap: their boxes (position and size) share no area; edges may touch. | Von den Schritten in „Lane A“ überlappen sich keine zwei: ihre Boxen (Position und Größe) haben keine gemeinsame Fläche; Kanten dürfen sich berühren. |
| noOverlap, gap g | No two of the steps in “Lane A” come closer than 20 px: their boxes are at least 20 px apart horizontally or vertically. | Von den Schritten in „Lane A“ kommen sich keine zwei näher als 20 px: zwischen ihren Boxen liegen waagerecht oder senkrecht mindestens 20 px. |
| aligned (y, centre) | The steps in “Lane A” sit in one row: the y-coordinates of their centres differ by at most 4 px. | Bei den Schritten in „Lane A“ weichen die y-Koordinaten der Mittelpunkte höchstens 4 px voneinander ab: sie stehen in einer Zeile. |
| evenlySpaced (x) | The steps in “Lane A” are evenly spaced from left to right: the gaps between neighbouring boxes differ by at most 4 px. | Bei den Schritten in „Lane A“ weichen die Lücken zwischen benachbarten Boxen von links nach rechts höchstens 4 px voneinander ab: sie sind gleichmäßig verteilt. |
| within | Every box of the steps in “Lane A” lies entirely inside the canvas from (60, 40) to (1260, 520). | Alle Boxen von den Schritten in „Lane A“ liegen ganz innerhalb der Arbeitsfläche von (60, 40) bis (1260, 520). |
| arrowsNoCrossing | No two of the arrows cross or touch. An arrow counts as the straight line between the centres of the two steps it joins, however it is drawn; arrows that share a step may meet at its centre, and arrows between the same two steps are not compared. Every arrow must be attached at both ends. | Von den Pfeilen kreuzen oder berühren sich keine zwei. Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten der beiden Schritte, die er verbindet, wie auch immer er gezeichnet ist; Pfeile mit einem gemeinsamen Schritt dürfen sich in dessen Mittelpunkt treffen, Pfeile zwischen denselben zwei Schritten werden nicht verglichen. Jeder Pfeil muss an beiden Enden angebunden sein. |
| arrowsClearOfSteps | None of the arrows touches the box of any of the steps other than the two it joins. An arrow counts as the straight line between the centres of its two steps, however it is drawn. Every arrow must be attached at both ends. | Keiner von den Pfeilen berührt die Box eines von den Schritten außer den beiden, die er verbindet. Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten seiner beiden Schritte, wie auch immer er gezeichnet ist. Jeder Pfeil muss an beiden Enden angebunden sein. |

The other anchors read "top edges", "bottom edges", "left edges", "right edges", "the x-coordinates
of their centres" ("Oberkanten", "Unterkanten", "linken Kanten", "rechten Kanten", "die
x-Koordinaten der Mittelpunkte"); `axis: x` is "one column" ("einer Spalte"), `evenlySpaced` on `y`
is "from top to bottom" ("von oben nach unten"). The cap and the range are documented with the
operators in `docs/world-format.md` §2a, like every operator's semantics, and are not repeated in
each sentence: no board a layout unit admits reaches them (decision 4, 5).

A check result stays as it is for every family: each condition is met or not, for the Player and MCP
alike. No witnesses (which steps overlap) are added to host replies; that would give this family a
stronger feedback channel than the others and change what the gate measures.

### 7. Pictures

Wherever a result of a task with a layout clause is drawn, the picture shows what was judged, drawn
from the judged state:

- **Report.** The final board (engine picture or schematic) and the example target carry a
  judged-geometry overlay, as the group overlay does today: every arrow of an arrow clause as a thin
  dashed segment between the two centres; the box of every ellipse or diamond as a dashed outline;
  every `within` rectangle as a dashed outline labelled with its corners. For each unmet layout
  clause, numbered marks on up to five offending objects (an overlapping pair, a crossing point, a
  touched step, a step outside the canvas, the step furthest from the row or the uneven gap), each
  explained by one legend line in words — never by colour alone. The caption says that dashed lines,
  boxes and the canvas are drawn from the judged state and that the checker judges straight lines
  between step centres, not the arrows as drawn. Artifact runs draw the same overlay on their
  schematic (PADR-0044). The marks come from a pure function beside the evaluator that returns the
  offending objects of a clause; a clause is false exactly when it has at least one.
- **Player.** Board mode draws the dashed segments, the boxes of non-rectangular steps and the
  canvas for every layout task, before and after a check. The real editor is never drawn over; in
  editor mode a note names the canvas and points to board mode by a keyboard-reachable control. The
  Player shows no offending objects (decision 6), so the person and the agent get the same check.
  P5b designs the overlay under `docs/design/design-language.md` §13 and looks at it per the review
  protocol.

### 8. Minimal length

Layout clauses make the minimal-length analysis inapplicable, as it is today for any clause it does
not know: `readGoal` returns nothing for an unknown clause (`src/authoring/minimal-length.ts:110`) and
`analyseLength` answers "reference length" with reason `not-applicable` (`:197`). The bound behind
the analysis also cannot carry over: positions become part of the goal, and one move can satisfy or
break several clauses at once. Layout instances therefore always report a reference length, the
family has no tight-budget variant and sets no `limits.actions` in 1.0.0.

### 9. Generator `challenge-layout` 1.0.0 (outline for P5b)

1. **Unit and seeds.** Generator id `challenge-layout`, difficulty 1–3, unit `layout.practonaut`
   (PADR-0042); seed ranges, sets, oracle sidecars, golden test and versioning as PADR-0040
   decision 2. Recommended bench cap 60 actions.
2. **Reference first.** Draw a process graph from the domain vocabularies with varying structure —
   chain, branch with a decision, fork and merge, a loop back, one or two lanes as frames with arrows
   between lanes; 6–9, 9–12 or 12–16 steps by difficulty — and lay it out on a grid that satisfies
   every clause the instance will state: layers left to right, lanes as rows, equal gaps per lane.
   The evaluator, not the construction, decides: a layout that fails any of its clauses is drawn
   again. The canvas is the reference's bounding box plus a margin of 120, 60 or 20 px by difficulty;
   at difficulty 3 its aspect differs from the start's, so the start's arrangement cannot simply be
   kept.
3. **Goal.** From-scenes' multiset of the reference (labels, styles, frames, arrows by their end
   labels; no position pins) plus layout clauses chosen per instance: `noOverlap` over all steps (gap
   20/30/40), `within` the canvas, `arrowsNoCrossing` and `arrowsClearOfSteps` over all arrows and
   steps, and per lane `aligned` (y, centre, ± 4) and `evenlySpaced` (x, ± 4) over the lane's steps.
   `evenlySpaced` never appears without `noOverlap` on a superset of its selection. No layout error
   classes in 1.0.0: in a view without a check limit they would be a free, continuous check of the
   layout (PADR-0040 decision 4).
4. **Start.** Displace 3, 5 or 7 steps (difficulty 1–3; at difficulty 3 more where the aspect change
   requires) so that the start violates **every** layout clause the goal states — overlaps, steps
   outside the canvas, a swap that makes arrows cross, a step in an arrow's way, a lane out of row or
   unevenly spaced; a clause the start already satisfies is not stated. The reference is from-scenes'
   plan, one `move_step` per displaced step.
5. **Presence check.** For each layout clause, a board with that clause's selections emptied
   (selected objects deleted) must fail the goal through another clause; otherwise the instance is
   refused. Together with from-scenes' counter-probes (empty, unchanged start, wrong artifact) this
   rules out vacuous passes.
6. **Near misses.** From-scenes' near misses, plus for every layout clause at least one near miss of
   kind `layout-<operator>` that violates that clause and no other goal clause: the reference with
   one further `move_step` or `resize_step` (for example the last step of a row widened past the
   canvas, one step moved by tolerance + 1 off its row, a middle step moved by tolerance + 1 along its
   row, a step moved into an arrow's way). The generator searches small perturbations per step and
   keeps those whose violated set is exactly that clause; a clause without one is not stated, and an
   instance left with no layout clause is drawn again. Every near miss must fail in a checker process
   (PADR-0040 baselines).
7. **Prompt.** States that the layout must be tidied so that every listed condition holds, names the
   canvas, and says that arrows are judged as straight lines between step centres; the conditions
   carry the sentences of decision 6. Board text never reaches title, prompt or hints (PADR-0040).
8. **Stress boards.** PADR-0040's rule, unchanged in size (goal plus the 60-action cap, five splits).
   Stress steps sit on a non-overlapping grid and stress arrows join neighbours, so that an
   implementation that stopped at a first violation could not under-measure; a test asserts that the
   layout clauses cost exactly the same on a clustered placement. The whole verdict stays within half
   the budget (measured probe: 28 %).
9. **Structure varies, not only labels**, and every structural choice is recorded in
   `generatedBy.parameters` (topology, lanes, steps, arrows, displaced steps, canvas margin, the
   stated clauses).

### 10. One geometry on every toolchain

The judged state is the same everywhere; each reader maps its source onto boxes, ends and
membership, and anything it cannot map that way is not silently judged.

- **Practonaut's actions** (`layout.practonaut`). The agent sets positions and sizes with
  `add_step`, `move_step` and `resize_step`; the state is the judged geometry. No action rotates. In
  the Player, a gesture that changes an attribute the recorder does not model — `angle` is one
  (`src/adapters/excalidraw/recorder.ts:34`, `:150-156`) — is refused as `unmodeled`
  (`src/host/editor-input.ts:16`); P5b shows by a test that a rotation is refused. The adapter's
  arrows lie on the judged segments (Context).
- **Excalidraw files** (session-level native export; `excalidraw-mcp` at artifact level). Box = the
  element's `x`, `y`, `width`, `height`, rounded as `scene.ts:131` does; arrow ends from its bindings
  (`scene.ts:142`); arrow `points`, elbows and roundness are derived and ignored; membership from
  `frameId`. At artifact level a step with an angle other than 0, or a size the application shows
  differently from its stored box, is not modelled (PADR-0043 decision 2): for a layout unit the
  reading rules refuse the whole result with a named code (`unreadable`, judged as not passed) until
  artifact mode has a per-clause mechanism; the same applies to the live-object cap of decision 5.
- **draw.io files.** Box = the vertex's `mxGeometry` in absolute page coordinates, rounded like the
  Excalidraw reader; draw.io is expected to store a shape inside a container relative to that
  container (not yet measured here — the reader's differential fixtures under PADR-0043 decision 2
  confirm or refute it); `rotation` in the style other than 0 is not modelled; edges' `source` and
  `target` are the ends; waypoints, exit and entry points and edge styles (orthogonal, elbow, curved)
  are derived and ignored; a container is a frame by membership (`parent`).
- On foreign toolchains the unit's prompt states these rules with the reading rules (PADR-0043
  decision 4). A server that moves shapes on its own so that the scripted oracle cannot reach the
  reference layout makes the family "not supported" there (PADR-0043 decision 6).

### 11. Schema sketch

```ts
// src/world/types.ts (world/2 only)
export interface Selection { type: ObjectType; as: string; where: Predicate }
export type Axis = "x" | "y";
export type Anchor = "start" | "center" | "end";
export type LayoutPredicate =
  | { op: "noOverlap"; select: Selection; gap: number }
  | { op: "aligned"; select: Selection; axis: Axis; anchor: Anchor; tolerance: number }
  | { op: "evenlySpaced"; select: Selection; axis: Axis; tolerance: number }
  | { op: "within"; select: Selection; x: number; y: number; width: number; height: number }
  | { op: "arrowsNoCrossing"; select: Selection }
  | { op: "arrowsClearOfSteps"; select: Selection; steps: Selection };
export type Predicate = /* existing members */ | LayoutPredicate;

// src/world/limits.ts
export const LAYOUT_LIMITS = Object.freeze({ selection: 256, range: 1_000_000 });

// src/world/schema.ts, added to PredicateSchemaV2 only
const stepSelection = z.strictObject({ type: z.literal("step"), as: id, where: PredicateSchemaV2 });
const arrowSelection = z.strictObject({ type: z.literal("arrow"), as: id, where: PredicateSchemaV2 });
const pixels = z.number().int().min(0).max(10_000);
const coordinate = z.number().int().min(-1_000_000).max(1_000_000);
const axis = z.enum(["x", "y"]);
z.strictObject({ op: z.literal("noOverlap"), select: stepSelection, gap: pixels }),
z.strictObject({ op: z.literal("aligned"), select: stepSelection, axis, anchor: z.enum(["start", "center", "end"]), tolerance: pixels }),
z.strictObject({ op: z.literal("evenlySpaced"), select: stepSelection, axis, tolerance: pixels }),
z.strictObject({ op: z.literal("within"), select: stepSelection, x: coordinate, y: coordinate,
  width: z.number().int().min(1).max(2_000_000), height: z.number().int().min(1).max(2_000_000) })
  .refine(r => r.x + r.width <= 1_000_000 && r.y + r.height <= 1_000_000, "canvas leaves the judged range"),
z.strictObject({ op: z.literal("arrowsNoCrossing"), select: arrowSelection }),
z.strictObject({ op: z.literal("arrowsClearOfSteps"), select: arrowSelection, steps: stepSelection }),
```

`validateBindings` binds each selection's `as` in its own `where`; `validateWorld` adds the position
rule (decision 1.2), the `layoutOffset` rule (1.4) and the refusal of a layout operator inside a
selection's `where`. A selection holds no `op` or `kind` key, so the predicate preflight counts its
`where` nodes as today. No task or state field is added; PADR-0044's task identity hashes the goal
and so includes every layout clause.

## Consequences

- **P5b** changes `src/world/types.ts`, `schema.ts` and `limits.ts`, `src/predicate/index.ts`
  (evaluation and the offending-object function), `src/host/session.ts` (`describePredicate`,
  `describeCondition`), the Player's board mode, `src/bench/details.ts`, `schematic.ts` and
  `report-text.ts` (overlay, legend, EN/DE), `src/challenge/` (the `layout` family and its bench
  entry), `docs/world-format.md` §2a, `docs/authoring-guide.md` (presence clauses for hand-written
  layout goals), `schemas/world.v2.schema.json`, the threat model §4 table and the benchmark
  documentation. from-scenes keeps `--layout relative` and `--align` unchanged and emits
  none of the new operators.
- **Tests P5b brings**, with expected values from a source other than the code under test: a hand
  derived table per operator covering every edge case of decisions 2–3 (the prototype's 20 spot
  checks are a start); a second implementation in `tests/support/` with exact rationals in `BigInt`
  and a different algorithm (parametric intersection; pixel enumeration on small boards for overlap,
  canvas and box contact), compared on at least 10 000 random small boards; tick counts equal to the
  formulas and equal across placements (fails under pay-as-you-go accounting); cap and range judged
  false without an error; refusals for world/1, wrong positions, nesting and offsets; Player view and
  MCP conditions identical for a layout task; a rotation gesture refused; generator golden test,
  single-fault near misses, presence check and stress fuel at most half.
- **Readers.** The draw.io parser and the artifact-mode readers implement decision 10 and the
  live-object cap of decision 5 for layout units. The measurement in Context shows that the other
  artifact units (`repair`, `injection`, `long-horizon`) need a cap of the same kind; deciding it is
  left to the artifact-mode record's implementation, and P6 should not start without it.
- **PADR-0013** keeps its text; on acceptance its row in the register notes "vocabulary amended by
  PADR-0047". The operators are not path matching in its sense: no drawn path is read, segments
  follow from the two end boxes.
- **A layout clause is judged on boxes and centre lines.** A goal sentence can be true while the
  drawing in a foreign tool looks different (a curved arrow around a step, a diamond whose corner area
  overlaps another box) and the reverse. The sentences say so and the pictures show it; whether agents
  then fail on reading the condition rather than on the layout is a question the pre-probe's runs
  must answer before a gate round.

## Re-assessment triggers

- A task needs a selection over 256 objects, a layout condition inside a quantifier ("in every
  frame …"), or a judged path (curves, elbows, waypoints) — the last needs its own record (PADR-0013).
- A layout verdict meets `checker_fuel_exhausted`, or an instance's stress fuel exceeds half the
  budget.
- On Practonaut's own toolchain the real application's picture shows a crossing, an overlap or an
  arrow over a step that the judged geometry does not, or the reverse.
- A reader cannot give the box the application shows for a common case (rotation, container-relative
  geometry, negative sizes), so that more than an occasional result is refused.
- Failures in the pre-probe or development runs concentrate on the difference between the drawn and
  the judged arrow rather than on the layout.
- A request to show offending objects in the Player or in check results (it needs the same witnesses
  for both surfaces and changes what a gate measures).

# PADR-0047 — Bounded spatial predicates: six layout operators over the judged geometry

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, strand P5 (issue #48) · Amends
[PADR-0013](0013-bounded-predicates.md) (vocabulary and fuel accounting; its exhaustion rule is
unchanged) · Records the maintainer decision on founder question F6 of 2026-10-18 (delegated) ·
Uses [PADR-0040](0040-challenge-tier-generated-families-and-gate.md) (stress boards, half the
budget), [PADR-0042](0042-gate-for-families-on-toolchains.md) (unit `layout.practonaut`),
[PADR-0043](0043-artifact-judged-verdict-level.md) (reading rules) and
[PADR-0044](0044-bench-report-v3.md) (bench/3: artifact results, `unreadable`) · Revised after three
independent reviews on 2026-10-18 (a Claude Opus review with a prototype and counterexamples, OpenAI
Codex `gpt-6.1-sol`, Google `gemini-3.8-flash`; dispositions at the end) · To be accepted after the
coordinator's check of this revision, before the implementation (P5b: predicates, narration,
pictures, generator `challenge-layout`) and before the draw.io checker parser and the artifact-mode
readers are written

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
(`scene.ts:118-121`); from-scenes' multiset clauses name a step's frame by the frame's **name**, not
its id (`exists frame sf: sf.id = s.frameId and sf.name = …`, `from-scenes.ts:126`), and pin a
resized step's size with `near` (`from-scenes.ts:171-174`). The Excalidraw scene reader keeps only
live elements, rounds `x` and `width` separately, takes the absolute value of a size without moving
the box, makes a size at least 1 and ignores angles (`scene.ts:94-95`, `:107`, `:131`); it bounds
`x`, `y`, `width` and `height` each by 10⁶, so a right edge can reach 2·10⁶ (`scene.ts:11`,
`:61-65`), and it admits 5 000 elements (`scene.ts:10`). Practonaut's own actions bound coordinates to
±100 000 and sizes to 10–4 000 (`src/world/schema.ts:115-118`); no action creates a frame.

**Maintainer decision (F6, 2026-10-18).** The judged geometry is stated in the goal sentence: an
arrow is the **straight segment between the centres of its two steps**; "in a frame" is
**membership**; "inside the picture" is **inside a rectangle the task names**. Elbowed, curved or
orthogonally routed arrows are not judged by their drawn path. Player and report draw the judged
segments, so the picture shows what was judged (vision §6 principle 8). Practonaut's adapter already
draws every arrow straight along the line between the two centres, from 4 px outside one box to
4 px outside the other (`src/adapters/excalidraw/raw.ts:20-25`, `:59-63`, `elbowed: false`); the
Player's board mode does the same for arrows between two steps (`src/player/ui/board-art.ts:111`)
and draws a self-loop as a curve beside its step (`board-art.ts:117-120`).

**Cost today.** The evaluator ticks once per AST node, value and visited object, including objects a
scan filters out (`src/predicate/index.ts:10-33`); an `exists` stops at its first witness, so its
cost depends on where the witness sits in id order. The checker shares one budget of 10⁶ steps per
task between the three counter-probes, fixtures, the goal and the error classes
(`src/checker/index.ts:66-92`). Exhaustion is `checker_fuel_exhausted`, never a verdict (PADR-0013).
A bench run whose judging throws — exhaustion included — becomes `infra_error`
(`src/bench/run.ts:398-401`), and more than 5 % of those voids a gate round (PADR-0040). At session
level the bench refuses every act, undo and reset beyond `--max-actions` (`run.ts:73-103`), and a gate
declaration refuses a `--max-actions` above the family's cap (`src/challenge/declaration.ts:131`).
Generated instances stay within half the budget on stress boards, which add one object per action up
to that cap (`src/challenge/build.ts:36-41`, `:73-89`, `:111-112`); the stress steps all sit at
(0, 0) (`build.ts:56-62`). That is harmless today because no clause's cost depends on where a stress
step sits: the injection family's pins read positions, but only of a step whose label matched first.

**Narration and pictures today.** `publicConditions` gives every top-level goal clause one id, a
sentence (the task's `conditionTexts`, else an exact-shape narration) and the formal text from
`describePredicate`; the Player view, the check result and MCP all use it
(`src/host/session.ts:92-99`, `:154-215`, `:253`, `:429`; `src/mcp/server.ts:32`). A public condition
carries only `id`, `text` and `formalText` (`src/host/protocol.ts:21-25`); MCP's compact view passes
the conditions on, and the bridge's strict schema and `CompactCondition` admit exactly those keys
(`src/mcp/replies.ts:36`, `:57`; `src/mcp/bridge.ts:60`). The bench report draws the final board as
the engine's picture or a schematic of the judged state and already overlays what an export cannot
show (group outlines) from the judged state (`src/bench/details.ts:359-362`,
`src/bench/schematic.ts:1-8`).

**Traps found while reading and in review.** (1) A variant's `layoutOffset` shifts every step but
never an integer literal in a predicate (`src/world/variant.ts:41-56`; the checker does the same,
`src/checker/index.ts:35`), so a canvas written as literals would not move with the board. (2) At
artifact level one tool call can add hundreds of objects, so "one action adds one object" no longer
bounds the judged board. Measured on existing code (`verdictFuel` of `challenge-repair` 1.0.0,
difficulty 2, seed 3, on `stressState` boards): 75 257 steps with 50 extra objects, 664 682 with 200
and 2 395 582 with 400 (half steps, half arrows). The last is more than the shared budget: the
checker would stop with `checker_fuel_exhausted`, and the run would be `infra_error`. (3) A frame's
id is not stable across toolchains (PADR-0043: the agent chooses ids), so a selection keyed to a
start frame id can become empty while the multiset, which names frames, still passes (review,
below). (4) A goal that does not pin step sizes can be met by shrinking boxes instead of laying them
out (review). (5) `fromStates` refuses a start that differs from the goal only in positions with
`start_accepted` (`from-scenes.ts:519`), because its multiset goal accepts that start before any
layout clause exists.

**Measured cost.** A prototype of the six operators under the cost model of decision 4
(`.local/wave/spatial-cost-v2.ts`, not product code; arm64 macOS, Node 22.22.3) charges, at the
largest selection (256) on the largest valid state (N = 10 000):

| Selection | noOverlap | aligned, within | evenlySpaced | arrowsNoCrossing | arrowsClearOfSteps | all six |
|---|---|---|---|---|---|---|
| all objects of the type (N) | 42 897 | 10 257 | 12 560 | 42 897 | 86 049 | 204 917 |
| in a frame by name (2N) | 52 897 | 20 257 | 22 560 | 52 897 | 106 049 | 274 917 |

A revised layout instance — 16 steps in two framed lanes, 17 arrows, the from-scenes multiset with a
size pin (39 clauses, 18 error classes) and eight layout clauses (`noOverlap`, `within`,
`arrowsNoCrossing`, `arrowsClearOfSteps` over everything; `aligned` and `evenlySpaced` per lane by
name) — costs at most 280 437 steps (28.0 % of 10⁶) on the five PADR-0040 stress boards of 60 extra
objects; the layout clauses take 1 342 of that on the goal board and 2 784 on the three
counter-probes. Adversarial boards within the same 60 objects stay below that: 60 arrows on the worst
pair of goal steps 270 581, 60 look-alike steps 165 421, 30 of each 270 249, and (artifact level only)
30 frames named like a lane holding 30 look-alike steps 133 646. Reading the allowance per type
instead — 60 extra steps **and** 60 extra arrows — costs 656 206 here, and the Opus reviewer measured
1 035 387 on a denser goal (16 steps, 24 arrows, two frames): more than the budget.

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

**C. What a selection may say.** (1) Any `where` predicate: its cost is unbounded (a reviewer
exhausted the budget with a nested `every` inside a selection of 76 steps) and a frame id in it does
not survive a foreign toolchain. (2) Three closed shapes — everything, outside every frame, in the
frame with a given **name** in the multiset's own shape — each with the expected **count** of
selected objects (chosen).

**D. Cost accounting.** (1) Pay as you go, stopping at the first violation, a missing count or an
out-of-range box: the cost depends on placement and ids, and a tick per sort comparison depends on
the JavaScript engine's sort algorithm. (2) Charge everything from N and the expected count before
deciding anything (chosen): the cost depends on N, the count and the selection shape only.

**E. Exhaustion on an agent's board.** (1) Judge it as failed: contradicts PADR-0013 ("never a false
goal") and would hide a broken cost bound as a model failure, favouring agents that add fewer
objects. (2) Keep `infra_error` and make exhaustion unreachable by construction (chosen).

**F. Geometry outside the safe range.** (1) The clause is false: a step far from all others would
fail an overlap clause it does not overlap in. (2) An error the agent can reach: `checker_invalid`
from a foreign file. (3) Refuse it before judging — action bounds at session level, a named refusal
by the reading rules at artifact level (judged as not passed), world validation for authors — and
keep `checker_invalid` in the evaluator as an unreachable guard (chosen).

**G. "Evenly spaced".** (1) Equal distances between centres. (2) Equal gaps between neighbouring
boxes, negative gaps allowed: a column, staggered rows and stacked boxes pass, and with ties the
verdict depends on ids (review). (3) Equal gaps that are never negative — the boxes' projections onto
the axis do not overlap (chosen): the free space is what a person sees, and the order is then fixed by
geometry alone.

**H. Loose ends.** (1) Skip arrows with a loose end: an agent could dodge a crossing by detaching an
end. (2) A selected arrow with a loose end makes the arrow clause false (chosen).

**I. Arrows between the same two steps** (A→B twice, or A→B and B→A). (1) Compare them: their
judged segments coincide whatever the layout, so the clause could never hold. (2) Do not compare them
(chosen).

**J. Where the operators may appear.** (1) Anywhere in a predicate: costs multiply under quantifiers
and narration has no sentence for nested uses. (2) Only as a top-level goal clause or an error class
condition (chosen).

**K. Step sizes.** (1) Free: shrinking every box to 10 × 10 replaces the layout. (2) Pinned within a
tolerance by a public clause, as from-scenes pins resized steps (chosen for the family).

## Decision (proposed)

### 1. Scope

1. Six operators join the **world/2** predicate vocabulary: `noOverlap`, `aligned`, `evenlySpaced`,
   `within`, `arrowsNoCrossing`, `arrowsClearOfSteps`. world/1 stays closed (`PredicateSchema`
   refuses them).
2. **Position.** A layout operator may stand only (a) as a task's `goal` or as a direct argument of a
   top-level `all` goal, or (b) as an error class's `when`, directly or under one `not`. World
   validation refuses it anywhere else — inside a quantifier, `any`, `count`, a selection, an action
   precondition or a rule precondition — with `E_WORLD_INVALID`. Every layout clause is therefore one
   public condition with its own sentence, and costs add, never multiply. No application refuses an
   action because of layout, so a layout precondition would invent behaviour (architecture §10,
   "Explicit unknowns").
3. **Membership is not new.** "Every step in its frame" stays the multiset's frame-name clause;
   frames have no geometry in the judged state, and whether a framed step's box lies inside its
   frame's drawn outline is not judged.
4. **Variants.** `within` names absolute coordinates. A world with a task whose goal or error class
   uses `within` is refused when any variant case has a `layoutOffset` other than (0, 0). The other
   five operators do not depend on where the board sits and allow any offset. Shifting the canvas
   with the offset would make integer literals a template — today only strings are, in two
   independent implementations (`variant.ts:41-49`, `checker/index.ts:38-43`) — and generated worlds
   have one case at (0, 0) (`build.ts:143`).
5. **Range.** World validation refuses a world whose task has a layout clause when a step of its
   start has an edge outside ±1 000 000.

### 2. Shared definitions

- **Box** of a step: the integer rectangle from (`x`, `y`) to (`x + width`, `y + height`) as the
  judged state stores it — for every shape. An ellipse or a diamond is judged by its box, not its
  outline; the sentences say "box", and the pictures draw it. Rotation is not part of the judged
  state (decision 10 says how each toolchain keeps it out). Boxes of zero area do not exist. Readers
  of foreign files produce the box by rounding **edges**, not position and size separately
  (decision 10), so boxes that touch in the file still touch when judged.
- **Doubled coordinates.** To stay in integers every point is computed twice its size: the centre of
  a box is (2x + width, 2y + height); its doubled box is [2x, 2x + 2·width] × [2y, 2y + 2·height].
- **Judged segment** of an arrow: the closed segment from the centre of its `from` step to the centre
  of its `to` step. Direction plays no part. A self-loop's segment is the single point at its step's
  centre. An arrow with a `null` end — a loose end, which is also what deleting a step leaves — has no
  judged segment.
- **Meet.** Two closed segments meet when they share a point, decided exactly in integers by the
  usual orientation test: with o(p, q, r) the sign of the cross product (q − p) × (r − p), segments
  p₁p₂ and p₃p₄ meet when o(p₃, p₄, p₁) and o(p₃, p₄, p₂) have opposite non-zero signs and so do
  o(p₁, p₂, p₃) and o(p₁, p₂, p₄), or when an endpoint of one has orientation 0 to the other and lies
  within its bounding rectangle. A point segment is handled by the same rule.
- **Selection** `{ type, as, where, count }`. `where` has one of three shapes, checked when a world is
  validated: `true` (every live object of `type`); `as.frameId = null` (outside every frame); or the
  multiset's own frame clause `exists frame f: f.id = as.frameId and f.name = "<name>"` (in a live
  frame with that name). `count` is the number of objects the selection must contain; a different
  number makes the clause false. Minimum counts make every operator non-vacuous by construction:
  `noOverlap`, `aligned` and `arrowsNoCrossing` 2, `evenlySpaced` 3, `within` 1, `arrowsClearOfSteps`
  1 arrow and 1 step. The maximum is 256.
- **Range.** Every box the clause reads — selected steps and the end steps of selected arrows — must
  have all four edges within ±1 000 000. Within that range, doubled coordinates stay within ±2·10⁶,
  differences within 4·10⁶ and every cross product below 3.2·10¹³, far inside the 2⁵³ of exact
  JavaScript integers. A box outside it never reaches the evaluator on a layout unit's board
  (decisions 1.5, 5 and 10); if one does, the evaluator stops with `checker_invalid`, which a bench
  records as `infra_error`, like a broken fuel bound (decision 5).

### 3. The operators

Parameters are integers in pixels. "Holds" means the clause is true; every operator is false when its
selection does not contain exactly `count` objects.

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
   their start on `axis`. Each gap is the next step's start minus the previous step's end (start +
   size). Holds when **no gap is negative** and the largest gap minus the smallest is at most
   `tolerance`. A negative gap means two boxes' projections onto the axis overlap, so a column,
   staggered rows or stacked boxes fail along the other axis. When no gap is negative the order is
   fixed by the geometry; when two steps start at the same place their projections overlap and the
   clause is false in either order, so ids never decide the verdict (the sort's tie-break by id only
   makes the implementation deterministic). Direction is not judged: a row laid out right to left in
   process order passes as well as one left to right.
4. **`within { select, x, y, width, height }`** (x, y within ±1 000 000, width and height 1 to
   2 000 000, with x + width and y + height at most 1 000 000). Holds when every selected box lies in
   the closed rectangle: `x ≤ s.x`, `s.x + s.width ≤ x + width`, `y ≤ s.y`,
   `s.y + s.height ≤ y + height`. Touching the canvas edge is inside.
5. **`arrowsNoCrossing { select }`**. False when a selected arrow has a loose end. Otherwise holds
   when no two selected arrows a, b *meet* in this sense:
   - arrows joining the same two steps (either direction, also two self-loops on one step) are not
     compared;
   - arrows that share no end step meet when their segments meet — a crossing, a touch, an end lying
     on the other segment, a collinear overlap, or the coincident centres of two different steps;
   - arrows that share one end step E (as `from` or `to`, either arrow) may touch only at E's centre
     c: they meet when their other endpoints u, v (measured from c) are both different from c,
     collinear with it (cross(u, v) = 0) and on the same side (dot(u, v) > 0), so that the segments
     overlap beyond c. Two segments from c that are not collinear meet only at c. A self-loop on E (a
     point at c) never meets any arrow incident to E.
6. **`arrowsClearOfSteps { select, steps }`**. False when a selected arrow has a loose end. Otherwise
   holds when no selected arrow's segment touches the closed doubled box of a selected step other than
   its own end steps. It touches when one of its endpoints lies inside the closed box or it meets one
   of the box's four closed edges; grazing a corner counts.

### 4. Cost and bounds

Every charge is computed from N (every object in the state, tombstones included), the selection
shape and the expected count k, and is debited before the operator looks at any position, size, id
or the number of objects actually selected:

- one tick for the operator node;
- per selection: N for `true` and outside-frames, 2N for a frame name (one pass to find the live
  frames with that name, one over the objects) — the shape is evaluated by this fixed rule, with the
  same result as the generic evaluator, so no `exists` stops early;
- k reads (box and range; for an arrow, both ends);
- pair tests in full: `noOverlap` and `arrowsNoCrossing` k(k−1)/2, `arrowsClearOfSteps` kₐ·kₛ;
- `evenlySpaced`: the sort by formula — 0 for k ≤ 2, else k·⌈log₂ k⌉ with ⌈log₂ k⌉ computed in
  integers (the bit length of k − 1) — plus max(0, k − 1) for the gaps;
- the evaluator's `tick` refuses a charge that is not a non-negative safe integer with
  `checker_invalid`, so a malformed formula cannot pass as a number.

Then it decides: a count that differs, a loose end, a failing pair. With S the selection charge, the
cost is exactly: `noOverlap` and `arrowsNoCrossing` 1 + S + k + k(k−1)/2; `aligned` and `within`
1 + S + k; `evenlySpaced` 1 + S + k + sort(k) + max(0, k − 1); `arrowsClearOfSteps`
1 + Sₐ + Sₛ + kₐ + kₛ + kₐ·kₛ. It depends on nothing an agent places, and on the empty board it is a
small integer (12 for `evenlySpaced` with count 3, measured). At the largest count on the largest
valid state the six together cost at most 274 917 steps (Context), so a layout clause is never the
reason a verdict runs out on its own.

The constants live in `src/world/limits.ts` as `LAYOUT_LIMITS = { count: 256, range: 1_000_000 }` and
are listed in threat model §4. They are semantics, not runtime limits: lowering one would change
verdicts, so `lowerLimits` does not apply to them.

### 5. Fuel exhaustion and the gate

PADR-0013's rule stands: exhaustion is `checker_fuel_exhausted`, never a verdict; a bench run that
meets it is `infra_error` as today. A layout unit makes it unreachable on every board the round lets
an agent produce. The guarantee covers goals made of from-scenes' multiset clauses, the size pin and
layout clauses with closed selections, on boards within the allowance below; it is not a bound for
arbitrary hand-written goals, whose cost stays their author's to check.

1. **Operators** charge by formula from N and the count (decision 4).
2. **Session level.** The bench's `--max-actions` bounds accepted acts, undos and resets, and a gate
   round's value is at most the family's cap (Context); one action adds at most one object, and a
   deleted one stays as a cheaper tombstone. The allowance is therefore the cap, 60 for this family.
3. **Artifact level.** [PADR-0044](0044-bench-report-v3.md) has no Practonaut action count there:
   `settings.maxActions` counts the proxy's forwarded tool calls, and one call can draw a whole
   scene. The allowance is therefore a number of **objects**, the same 60: the reading rules of a
   layout unit refuse, with a named code, a result whose **total** live steps, arrows and frames
   exceed the goal's live objects plus 60. Elements the reader does not map are not in the judged
   state and do not count; readers keep only live elements (`scene.ts:107`), so there are no
   tombstones. PADR-0044 judges a refused result as `unreadable`, on the start file, which fails.
4. **The generator's fuel check** (PADR-0040's rule, extended): the whole verdict — counter-probes,
   every goal clause and every error class, each costed separately — stays within half the budget on
   the five stress boards of 60 total objects (splits 0, ¼, ½, ¾, 1) **and** on adversarial boards of
   the same 60 objects: new arrows on the most expensive pair of goal steps, look-alike steps with a
   goal step's label, style and frame, half of each, and for artifact units frames named like a lane
   holding look-alike steps. The measured probe (Context) peaks at 28.0 % on a stress board; the
   adversarial boards stay below it.

If exhaustion or `checker_invalid` still occurs on a judged board, a bound was wrong: the run stays
`infra_error`, counts toward the 5 % void rule and triggers a re-assessment. A cost bug must void a
round rather than be scored as a model's failure.

### 6. Narration

`describePredicate` gains one formal form per operator, shown beside the sentence in the Player, the
check result and MCP, exactly as for every clause today (`publicConditions`, one function for all
three surfaces). A selection reads `16 × step [s]: (all)`, `8 × step [s]: (in frame "Lane A")` or
`2 × step [s]: (outside frames)`; in German `16 × Schritt [s]: (alle)`, `(im Rahmen "Lane A")`,
`(außerhalb von Rahmen)`.

| Operator | Formal text EN | Formal text DE |
|---|---|---|
| noOverlap | `no two overlap: 16 × step [s]: (all); gap ≥ 20 px` | `keine zwei überlappen: 16 × Schritt [s]: (alle); Abstand ≥ 20 px` |
| aligned | `aligned on y, centre: 8 × step [s]: (in frame "Lane A"); ± 4 px` | `ausgerichtet auf y, Mitte: 8 × Schritt [s]: (im Rahmen "Lane A"); ± 4 px` |
| evenlySpaced | `evenly spaced along x, no overlap along x: 8 × step [s]: (in frame "Lane A"); ± 4 px` | `gleichmäßig verteilt entlang x, ohne Überlappung entlang x: 8 × Schritt [s]: (im Rahmen "Lane A"); ± 4 px` |
| within | `inside (40, 40)–(1980, 500): 16 × step [s]: (all)` | `innerhalb (40, 40)–(1980, 500): 16 × Schritt [s]: (alle)` |
| arrowsNoCrossing | `no two cross: 17 × arrow [a]: (all)` | `keine zwei kreuzen sich: 17 × Pfeil [a]: (alle)` |
| arrowsClearOfSteps | `clear of steps: 17 × arrow [a]: (all); 16 × step [s]: (all)` | `frei von Schritten: 17 × Pfeil [a]: (alle); 16 × Schritt [s]: (alle)` |

Anchors read `start`/`centre`/`end` and `Anfang`/`Mitte`/`Ende`. The plain sentences state the judged
geometry, as F6 requires, and the number of objects the condition is about. The generator writes them
as `conditionTexts`; `describeCondition` produces them for every layout clause, because every
selection has one of the three shapes. German uses the dative after "von"/"bei" so one selection
phrase fits every sentence.

| Clause | Sentence EN | Sentence DE |
|---|---|---|
| size pin | Every step keeps its size: 180 × 80 px (± 4 px). | Jeder Schritt behält seine Größe: 180 × 80 px (± 4 px). |
| noOverlap, gap 0 | No two of the 16 steps overlap: their boxes (position and size) share no area; edges may touch. | Von den 16 Schritten überlappen sich keine zwei: ihre Boxen (Position und Größe) haben keine gemeinsame Fläche; Kanten dürfen sich berühren. |
| noOverlap, gap g | No two of the 16 steps come closer than 20 px: their boxes are at least 20 px apart horizontally or vertically. | Von den 16 Schritten kommen sich keine zwei näher als 20 px: zwischen ihren Boxen liegen waagerecht oder senkrecht mindestens 20 px. |
| aligned (y, centre) | The 8 steps in “Lane A” sit in one row: the y-coordinates of their centres differ by at most 4 px. | Bei den 8 Schritten in „Lane A“ weichen die y-Koordinaten der Mittelpunkte höchstens 4 px voneinander ab: sie stehen in einer Zeile. |
| evenlySpaced (x) | The 8 steps in “Lane A” stand side by side without overlapping horizontally, and the horizontal gaps between neighbouring boxes differ by at most 4 px. | Bei den 8 Schritten in „Lane A“ überlappen sich die Boxen waagerecht nicht, und die waagerechten Lücken zwischen benachbarten Boxen weichen höchstens 4 px voneinander ab. |
| within | Every box of the 16 steps lies entirely inside the canvas from (40, 40) to (1980, 500). | Alle Boxen von den 16 Schritten liegen ganz innerhalb der Arbeitsfläche von (40, 40) bis (1980, 500). |
| arrowsNoCrossing | No two of the 17 arrows cross or touch. An arrow counts as the straight line between the centres of the two steps it joins, however it is drawn; arrows that share a step may meet at its centre, and arrows between the same two steps are not compared. Every arrow must be attached at both ends. | Von den 17 Pfeilen kreuzen oder berühren sich keine zwei. Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten der beiden Schritte, die er verbindet, wie auch immer er gezeichnet ist; Pfeile mit einem gemeinsamen Schritt dürfen sich in dessen Mittelpunkt treffen, Pfeile zwischen denselben zwei Schritten werden nicht verglichen. Jeder Pfeil muss an beiden Enden angebunden sein. |
| arrowsClearOfSteps | None of the 17 arrows touches the box of any of the 16 steps other than the two it joins. An arrow counts as the straight line between the centres of its two steps, however it is drawn. Every arrow must be attached at both ends. | Keiner von den 17 Pfeilen berührt die Box eines von den 16 Schritten außer den beiden, die er verbindet. Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten seiner beiden Schritte, wie auch immer er gezeichnet ist. Jeder Pfeil muss an beiden Enden angebunden sein. |

Other forms: "the 2 steps outside any frame" ("den 2 Schritten außerhalb von Rahmen"); anchors "top
edges", "bottom edges", "left edges", "right edges", "the x-coordinates of their centres"
("Oberkanten", "Unterkanten", "linken Kanten", "rechten Kanten", "die x-Koordinaten der
Mittelpunkte"); `axis: x` is "one column" ("einer Spalte"); `evenlySpaced` on `y` reads "one above the
other without overlapping vertically … vertical gaps" ("senkrecht … senkrechten Lücken"). The range
and the maximum count are documented with the operators in `docs/world-format.md` §2a, like every
operator's semantics, and are not repeated in each sentence: no board a layout unit admits reaches
them (decisions 1.5, 5, 10).

A check result stays as it is for every family: each condition is met or not, for the Player and MCP
alike. No witnesses (which steps overlap) are added to host replies; that would give this family a
stronger feedback channel than the others and change what the gate measures.

### 7. Pictures and the public overlay

- **Public overlay field.** `PublicCondition` gains an optional `layout`: the clause's operator and
  parameters, with each selection as `{ type, frame, count }` (`frame` is `"all"`, `null` or a frame
  name) and, for `within`, the canvas rectangle. It is a lossless projection of the goal clause alone
  — the formal text already states the same — and never of the board, a reference or a near miss.
  `publicConditions` builds it, so the Player view, the check result and MCP carry the same field;
  `CompactCondition` and the bridge's condition schema admit it (`replies.ts:36`, `bridge.ts:60`), and
  a test asserts that a layout task's conditions are deep-equal in the Player view and over MCP.
- **Player.** From the public field and the public board, board mode draws for every layout task,
  before and after a check: the judged segments of the selected arrows as thin dashed lines between
  centres; a self-loop's judged point as a small ring at its step's centre, beside the curve the board
  draws today; the box of every ellipse or diamond as a dashed outline; each `within` canvas as a
  dashed outline labelled with its corners. The real editor is never drawn over; in editor mode a note
  names the canvas and points to board mode by a keyboard-reachable control. The Player shows no
  offending objects (decision 6), so the person and the agent get the same check. P5b designs the
  overlay under `docs/design/design-language.md` §13 and looks at it per the review protocol.
- **Report.** The final board (engine picture or schematic) and the example target carry the same
  overlay as the group overlay is drawn today; at artifact level, where the judged box can differ from
  the drawn shape by rounding, the schematic draws every judged box ([PADR-0044](0044-bench-report-v3.md)
  draws artifact boards as a schematic). For each unmet layout clause, numbered marks name up to five
  offending objects, each explained by one legend line in words — never by colour alone: for a count
  that differs, "expected 8 steps in “Lane A”, found 7" (and the extra or missing objects when the
  multiset names them); for a loose end, the arrow; for `noOverlap`, the overlapping pairs; for
  `aligned`, the two steps with the extreme anchors; for `evenlySpaced`, a pair whose projections
  overlap, else the largest and the smallest gap; for `within`, the steps outside; for the arrow
  clauses, the crossing pairs or the touched steps. The caption says that dashed lines, boxes and the
  canvas are drawn from the judged state and that the checker judges straight lines between step
  centres, not the arrows as drawn.
- **One geometry, one implementation.** The marks come from the same pure geometry analysis in
  `src/predicate` that decides the verdict; a clause is false exactly when the analysis returns at
  least one reason. The independent second implementation lives only in `tests/support/` as an
  oracle.

### 8. Minimal length

Layout clauses make the minimal-length analysis inapplicable, as it is today for any clause it does
not know: `readGoal` returns nothing for an unknown clause (`src/authoring/minimal-length.ts:110`) and
`analyseLength` answers "reference length" with reason `not-applicable` (`:197`). The bound behind
the analysis also cannot carry over: positions become part of the goal, and one move can satisfy or
break several clauses at once. Layout instances therefore always report a reference length, the
family has no tight-budget variant and sets no `limits.actions` (a task with limits cannot be benched
at artifact level, PADR-0044 decision 1; the bench's cap bounds session runs, decision 5).

### 9. Generator `challenge-layout` 1.0.0 (outline for P5b)

1. **Unit and seeds.** Generator id `challenge-layout`, difficulty 1–3, unit `layout.practonaut`
   (PADR-0042); seed ranges, sets, oracle sidecars, golden test and versioning as PADR-0040
   decision 2. Bench cap 60 actions, which is also the artifact-level object allowance (decision 5).
2. **Reference first, topology by construction.** One or two lanes, each a frame laid out as one row;
   6–9, 9–12 or 12–16 steps by difficulty; one step size per instance (width from the longest label,
   height 80). The process graph is a chain through the lanes plus, by seed, a branch with a decision,
   a fork and merge, or a loop back. A branch's or fork's second target and a loop's target are placed
   **in another lane** by construction, so no arrow has to pass a step of its own row (a skip or a
   loop inside one row cannot satisfy `aligned` and `arrowsClearOfSteps` together — review). Steps sit
   at equal gaps per lane; the evaluator, not the construction, then decides, and a layout that fails
   any of its clauses is drawn again. The canvas is the reference's bounding box plus a margin of 120,
   60 or 20 px by difficulty; at difficulty 3 its aspect differs from the start's, so the start's
   arrangement cannot simply be kept.
3. **Goal.** From-scenes' multiset of the reference (labels, styles, frames by name, arrows by their
   end labels; no position pins), the size pin ("every step is W × H ± 4 px", one `every … near`
   clause in the existing vocabulary), and layout clauses with counts: **always** `noOverlap` over all
   steps (gap 20/30/40) — the start always violates it — plus `within` the canvas,
   `arrowsNoCrossing` over all arrows, `arrowsClearOfSteps` over all arrows and steps, and per lane
   `aligned` (y, centre, ± 4) and `evenlySpaced` (x, ± 4) selected by the lane's frame **name**.
   No layout error classes in 1.0.0: in a view without a check limit they would be a free, continuous
   check of the layout (PADR-0040 decision 4).
4. **Start.** Displace 3, 5 or 7 steps (difficulty 1–3; at difficulty 3 more where the aspect change
   requires) so that the start violates **every** layout clause the goal states — overlaps, steps
   outside the canvas, a swap that makes arrows cross, a step in an arrow's way, a lane out of row or
   unevenly spaced; a clause other than `noOverlap` that the start already satisfies is not stated.
   The reference is from-scenes' plan, one `move_step` per displaced step.
5. **Near misses.** From-scenes' near misses, plus for every layout clause at least one near miss of
   kind `layout-<operator>` that violates that clause and no other goal clause. Candidates keep the
   size pin: one step moved by tolerance + 1 across its row or along it, two steps of a lane swapped
   (all steps share one size), a whole lane shifted towards the other lane or out of the canvas. The
   generator keeps candidates whose violated set is exactly that clause; a clause other than
   `noOverlap` without one is not stated, and an instance whose `noOverlap` has none is drawn again.
   Every near miss must fail in a checker process (PADR-0040 baselines).
6. **Prompt.** States that the layout must be tidied so that every listed condition holds, names the
   canvas, says that arrows are judged as straight lines between step centres however they are routed,
   that every arrow must be attached to steps at both ends, and that step sizes stay as they are. The
   conditions carry the sentences of decision 6. Board text never reaches title, prompt or hints
   (PADR-0040).
7. **Fuel.** Decision 5.4; layout stress boards place their stress steps on a free grid outside the
   canvas and their arrows between neighbours (cost does not depend on it, which a test shows by
   comparing with a clustered placement).
8. **Structure is checked, not only drawn.** `generatedBy.parameters` records the achieved structure
   within its limits (at most 16 parameters, each an integer or a string of at most 64 characters,
   `src/world/schema.ts:90-93`): `difficulty`, `topology` (for example `chain+branch+loop`), `lanes`,
   `steps`, `arrows`, `displaced`, `margin`, `size` (`180x80`) and `clauses`, a code of at most 64
   characters naming the stated clauses (for example `O20 W X C A:Lane A E:Lane A` with lane names
   cut to fit, or lane indexes). The self-check over development seeds reports the distribution of
   topologies and stated clauses and every rejection reason with its count; a planned topology or
   clause that appears in fewer than 10 % of 100 instances fails the self-check, so selection by
   redrawing cannot silently replace the announced variety.
9. **Shared code P5b changes for this.** `fromStates` gains extra clauses (predicate and sentence)
   appended to the goal before verification and extra near-miss candidates — today a start that
   differs only in positions is refused as `start_accepted` (`from-scenes.ts:519`); `src/challenge`
   gains the family in `FAMILIES`, `GENERATOR_VERSIONS` and `FAMILY_BENCH`, a layout stress board
   beside `stressState` (`build.ts:56-62`) and the adversarial boards of decision 5.4 in its fuel check;
   the parameter encoding above.

### 10. One geometry on every toolchain

The judged state is the same everywhere; each reader maps its source onto boxes, ends and
membership, and anything it cannot map that way is refused, not silently judged.

- **Practonaut's actions** (`layout.practonaut`). The agent sets positions and sizes with
  `add_step`, `move_step` and `resize_step` within ±100 000 and 10–4 000; the state is the judged
  geometry, in integers. No action rotates. In the Player, a gesture that changes an attribute the
  recorder does not model — `angle` is one (`src/adapters/excalidraw/recorder.ts:34`, `:150-156`) — is
  refused as `unmodeled` (`src/host/editor-input.ts:16`); P5b shows by a test that a rotation is
  refused. The adapter's arrows lie on the judged segments (Context).
- **Excalidraw files** (session-level native export; `excalidraw-mcp` at artifact level). The box is
  normalised and rounded by edges: left = round(min(x, x + width)), right = round(max(x, x + width)),
  width = max(1, right − left), likewise vertically, with `Math.round` (half up). A negative stored
  size therefore keeps the box where it is drawn. Today's `scene.ts:131` rounds position and size
  separately and keeps `x` for a negative width: two touching boxes A from 0.5 to 11.0 and B from 11
  become 1–12 and 11–21 (1 px of overlap), and x = 100 with width −40 becomes 100–140 instead of
  60–100 (measured). P5b changes the reader for every world/2 reading, so one geometry holds
  everywhere, with differential fixtures for touching boxes at fractional edges, positive and negative
  half values and negative sizes; `npm run library:check` shows whether a library goal changes. Arrow
  ends come from bindings (`scene.ts:142`); arrow `points`, elbows and roundness are derived and
  ignored; membership from `frameId`. At artifact level, a layout unit's reading rules refuse with a
  named code (judged as `unreadable`, not passed): a step with an angle other than 0, a box edge
  outside ±1 000 000, and a result over the object allowance of decision 5. Positions are judged in
  whole pixels; the unit's prompt says so.
- **draw.io files.** The box is the vertex's `mxGeometry` converted to **absolute page coordinates**:
  draw.io stores a shape inside a container relative to that container, so the reader adds the
  offsets of every ancestor container before rounding edges as above. This is a normative reading
  rule; that draw.io stores coordinates this way has not been measured here, and the `layout` unit on
  draw.io is not pre-probed until the reader's differential fixtures (PADR-0043 decision 2) show the
  conversion against the real application. A `rotation` other than 0 in the style is refused as for
  Excalidraw; edges' `source` and `target` are the ends; waypoints, exit and entry points and edge
  styles (orthogonal, elbow, curved) are derived and ignored; a container is a frame by membership
  (`parent`); the reader keeps only live cells.
- **Foreign routing and loose ends.** A tool that routes an arrow around a step, or a curved arrow,
  is judged by its straight centre line all the same (F6); the unit's prompt says so, together with
  the reading rules (PADR-0043 decision 4). An arrow end that is drawn at a step but not bound to it is
  a loose end; readers do not bind ends by proximity, which would invent a relation the file does not
  hold. A server that moves shapes on its own so that the scripted oracle cannot reach the reference
  layout makes the family "not supported" there (PADR-0043 decision 6).

### 11. Schema sketch

```ts
// src/world/types.ts (world/2 only)
export interface Selection { type: ObjectType; as: string; where: Predicate; count: number }
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

// src/host/protocol.ts: the public overlay of decision 7
export interface LayoutScope { type: "step" | "arrow"; frame: "all" | null | string; count: number }
export type LayoutOverlay =
  | { op: "noOverlap"; steps: LayoutScope; gap: number }
  | { op: "aligned"; steps: LayoutScope; axis: Axis; anchor: Anchor; tolerance: number }
  | { op: "evenlySpaced"; steps: LayoutScope; axis: Axis; tolerance: number }
  | { op: "within"; steps: LayoutScope; canvas: { x: number; y: number; width: number; height: number } }
  | { op: "arrowsNoCrossing"; arrows: LayoutScope }
  | { op: "arrowsClearOfSteps"; arrows: LayoutScope; steps: LayoutScope };
// PublicCondition gains: layout?: LayoutOverlay

// src/world/limits.ts
export const LAYOUT_LIMITS = Object.freeze({ count: 256, range: 1_000_000 });

// src/world/schema.ts, added to PredicateSchemaV2 only
const selection = (type: "step" | "arrow", min: number) => z.strictObject({
  type: z.literal(type), as: id, where: PredicateSchemaV2, count: z.number().int().min(min).max(256) });
const pixels = z.number().int().min(0).max(10_000);
const coordinate = z.number().int().min(-1_000_000).max(1_000_000);
const axis = z.enum(["x", "y"]);
z.strictObject({ op: z.literal("noOverlap"), select: selection("step", 2), gap: pixels }),
z.strictObject({ op: z.literal("aligned"), select: selection("step", 2), axis, anchor: z.enum(["start", "center", "end"]), tolerance: pixels }),
z.strictObject({ op: z.literal("evenlySpaced"), select: selection("step", 3), axis, tolerance: pixels }),
z.strictObject({ op: z.literal("within"), select: selection("step", 1), x: coordinate, y: coordinate,
  width: z.number().int().min(1).max(2_000_000), height: z.number().int().min(1).max(2_000_000) })
  .refine(r => r.x + r.width <= 1_000_000 && r.y + r.height <= 1_000_000, "canvas leaves the judged range"),
z.strictObject({ op: z.literal("arrowsNoCrossing"), select: selection("arrow", 2) }),
z.strictObject({ op: z.literal("arrowsClearOfSteps"), select: selection("arrow", 1), steps: selection("step", 1) }),
```

`validateBindings` binds each selection's `as` in its own `where`; `validateWorld` adds the three
selection shapes (decision 2), the position rule (1.2), the `layoutOffset` rule (1.4) and the start
range (1.5). A selection holds no `op` or `kind` key, so the predicate preflight counts its `where`
nodes as today. No task or state field is added; [PADR-0044](0044-bench-report-v3.md)'s task identity
hashes the goal and so includes every layout clause. `PublicCondition.layout` is a host reply field,
not world content.

## Consequences

- **P5b** changes `src/world/types.ts`, `schema.ts` and `limits.ts`; `src/predicate/index.ts`
  (operators, selection charges, the guarded `tick`, the shared geometry analysis);
  `src/host/protocol.ts` and `session.ts` (`describePredicate`, `describeCondition`, the overlay
  field); `src/mcp/replies.ts` and `bridge.ts` (the overlay field); the Player's board mode;
  `src/bench/details.ts`, `schematic.ts` and `report-text.ts` (overlay, legend, EN/DE);
  `src/checker/scene.ts` (edge rounding, negative sizes); `src/authoring/from-scenes.ts` (extra
  clauses and near-miss candidates); `src/challenge/` (decision 9.9); `docs/world-format.md` §2a;
  `schemas/world.v2.schema.json`; the threat model §4 table; the benchmark documentation. from-scenes
  keeps `--layout relative` and `--align` unchanged and emits none of the new operators by itself.
- **Tests P5b brings**, with expected values from a source other than the code under test: a hand
  derived table per operator covering every edge case of decisions 2–3, including the reviewers'
  counterexamples — a column and staggered rows under `evenlySpaced`, the P/Q/R boxes with their ids
  swapped, the stack of three 10-px boxes and the widths 10/10/20 versus 10/20/10 at one x (all false),
  a selection by lane name after the frame's id changed, a self-loop against an incoming arrow (the
  prototype's checks are a start); a second implementation in `tests/support/` with exact rationals in
  `BigInt` and a different algorithm (parametric intersection; pixel enumeration on small boards for
  overlap, canvas and box contact), compared on at least 10 000 random small boards, also with ids
  permuted (the verdict must not change); the selection shapes against the generic evaluator; charges
  equal to the formulas and equal across placements and id orders, and an empty board with every
  operator (a finite integer, no `NaN`); `tick` refusing `NaN`, a negative and a fractional charge;
  count mismatch false; refusals for world/1, wrong positions, nesting, other selection shapes,
  offsets and out-of-range starts; the reader fixtures of decision 10; Player view and MCP conditions
  deep-equal for a layout task; a rotation gesture refused; generator golden test, single-fault near
  misses, the distribution self-check and the fuel check at most half on stress and adversarial
  boards. Each new guard comes with a test that fails without it.
- **Readers.** The draw.io parser and the artifact-mode readers implement decision 10 and the object
  allowance of decision 5. The measurement in Context shows that the other artifact units (`repair`,
  `injection`, `long-horizon`) need an allowance of the same kind; deciding it is left to the
  artifact-mode record's implementation, and P6 should not start without it.
- **PADR-0013** keeps its text; on acceptance its row in the register notes "vocabulary amended by
  PADR-0047". The operators are not path matching in its sense: no drawn path is read, segments
  follow from the two end boxes.
- **A layout clause is judged on boxes and centre lines.** A goal sentence can be true while the
  drawing in a foreign tool looks different (a curved arrow around a step, a diamond whose corner area
  overlaps another box, a sub-pixel overlap rounded away) and the reverse. The sentences and the
  prompt say so and the pictures show it; whether agents then fail on reading the condition rather
  than on the layout is a question the pre-probe's runs must answer before a gate round.

## Re-assessment triggers

- A task needs a selection over 256 objects, another selection shape, a layout condition inside a
  quantifier ("in every frame …"), a flow direction, or a judged path (curves, elbows, waypoints) — the
  last needs its own record (PADR-0013).
- A layout verdict meets `checker_fuel_exhausted` or `checker_invalid`, or an instance's fuel on a
  stress or adversarial board exceeds half the budget.
- On Practonaut's own toolchain the real application's picture shows a crossing, an overlap or an
  arrow over a step that the judged geometry does not, or the reverse.
- A reader cannot give the box the application shows for a common case (rotation, container-relative
  geometry, negative sizes), so that more than an occasional result is refused; the draw.io fixtures
  contradict decision 10.
- Failures in the pre-probe or development runs concentrate on the difference between the drawn and
  the judged arrow rather than on the layout.
- The distribution self-check cannot reach its 10 % floor for a planned topology or clause.
- A request to show offending objects in the Player or in check results (it needs the same witnesses
  for both surfaces and changes what a gate measures).

## Review (2026-10-18)

Three independent reviews of the first draft: a Claude Opus review with a prototype of the six
operators and counterexamples (15 findings, 4 major), OpenAI Codex `gpt-6.1-sol` (5 findings and a gap
list) and Google `gemini-3.8-flash` (8 findings and 3 gaps). The coordinator decided the converging
points (A lanes by name with counts; B non-negative gaps; C charges and the total object allowance; D
size pins and an always-stated `noOverlap`; E out-of-range and edge rounding at reading; F a public
overlay field; G topology by construction and shared-code changes). Every finding and its
disposition:

| # | Finding | Disposition |
|---|---|---|
| Opus 1 (major) | Lane selections by start frame id while the multiset names frames; re-id at artifact level makes lane clauses vacuous, `rename_frame` swaps lanes | Adopted (A): selections by frame name in the multiset's shape, every selection with a count (decisions 2, 9.3); the re-id board is in the tests |
| Opus 2 (major) | `evenlySpaced` passes columns and staggered rows, and P/Q/R flips with ids | Adopted (B): no negative gap, verdict independent of ids (decision 3.3); the cases are tests |
| Opus 3 (major) | n·⌈log₂ n⌉ is `NaN` at n = 0; `NaN` passes the budget and the generator gate | Adopted (C): sort charge 0 for k ≤ 2 with an integer ⌈log₂⌉, `tick` refuses non-integer charges, empty-board tests (decision 4) |
| Opus 4 (major) | Artifact cap per type or in total is ambiguous; per type costs 1 035 387 on a denser goal | Adopted (C): total live objects ≤ goal + 60, explained as an object allowance, checked at every split (decision 5); measured 656 206 per type versus 280 437 at most in total here |
| Opus 5 | Loop-back, skip and fork/merge in one row cannot satisfy `aligned` and `arrowsClearOfSteps` | Adopted (G): targets in another lane by construction, structure recorded, distribution and rejection reasons checked (decisions 9.2, 9.8) |
| Opus 6 | `noOverlap` may be left out (stacking, hub stars) | Adopted (D): always stated, the start always violates it (decision 9.3) |
| Opus 7 | Sizes not pinned: resize to 10 × 10 | Adopted (D): size pin ± 4 px in a public sentence, near misses keep it (decisions 9.3, 9.5) |
| Opus 8 | Out-of-range geometry is reachable at artifact level and "false" fails a step far from all others | Adopted (E): refused by the reading rules with a named code, world validation for starts, `checker_invalid` only as an unreachable guard (decisions 1.5, 2, 10) |
| Opus 9 | Rounding x and width separately turns touching boxes into overlapping ones | Adopted (E): edges rounded, with a differential fixture (decision 10; measured example in it) |
| Opus 10 | The overlay needs data the host view does not carry; MCP's allowlist would drop it | Adopted (F): `PublicCondition.layout` from the goal clause, admitted by `CompactCondition` and the bridge schema, parity test (decision 7) |
| Opus 11 | The offending-object function is undefined for the cap, loose ends and the range | Adopted: a reason for every way a clause is false, from the same analysis as the verdict (decision 7); the range never reaches it |
| Opus 12 | Early stops make the cost depend on ids and placement | Adopted (C): every charge from N and the count before any decision; selections evaluated by a fixed rule, no early `exists` (decision 4) |
| Opus 13 | `generatedBy.parameters` holds at most 16 values of 64 characters | Adopted: encoding within those limits (decision 9.8) |
| Opus 14 | P5b needs shared-code changes; `fromStates` refuses layout instances with `start_accepted` | Adopted (G): listed (decision 9.9, Context trap 5) |
| Opus 15a (nit) | The text used m = 256 where the table had 240 arrows | Adopted: the table now lists formula values at count 256 for both shapes |
| Opus 15b (nit) | "No clause reads positions" is untrue: the injection pins do | Adopted: corrected — pins read a position only after their label matched, so stress placement does not change the cost (Context) |
| Codex 1 (blocker) | Frame ids allow a vacuous pass at artifact level (312-tick probe) | Adopted (A), as Opus 1 |
| Codex 2 (major) | The cap does not bound an arbitrary `where` (a nested `every` exhausted the budget with 76 steps); five boards are no proof | Adopted with change: closed selection shapes charged by formula (decision 2, 4); the guarantee is restricted to goals of the family's clause kinds on boards within the allowance, checked on stress and adversarial boards (decision 5); hand-written goals stay their author's responsibility |
| Codex 3 (major) | `noOverlap` does not close the stacking shortcut for `evenlySpaced`; ids change the verdict | Adopted (B), as Opus 2; both of its examples are tests |
| Codex 4 | Rounding can hide a sub-pixel overlap; the overlay draws only ellipse and diamond boxes | Adopted: quantisation stated in the prompt and in Consequences, edge rounding with half-value fixtures, every judged box drawn at artifact level (decisions 7, 10) |
| Codex 5 | Cost formula undefined at n ≤ 1 (`NaN`, −1) and early stops make cost depend on geometry | Adopted (C), as Opus 3 and 12 |
| Codex gap: self-loops | The Player draws self-loops as curves; a judged point needs a visible marker | Adopted (F): a ring at the step's centre (decision 7) |
| Codex gap: one-row cycles | A three-step cycle in one tight row is impossible; redrawing biases the variety | Adopted (G), as Opus 5 |
| Codex gap: sizes | Sizes stay free; shrinking can replace moves | Adopted (D), as Opus 7 |
| Codex gap: draw.io | Nested-container coordinates unmeasured; equality across toolchains is an acceptance condition | Adopted: stated as a reading rule to be shown by fixtures before the draw.io unit's pre-probe (decision 10) |
| Codex gap: two implementations | A second product implementation for marks risks drift | Adopted: one shared analysis for verdict and marks; the independent one only as a test oracle (decision 7) |
| Codex gaps: geometry, numbers, hidden data | No counterexample to the segment semantics; integers safe; no leak found; parity to be tested | Agreed; the listed cases and the parity test are in Consequences |
| Gemini 1 (blocker) | Without `limits.actions` an agent can act 150–400 times and exhaust the budget, voiding the round | Refuted: the bench refuses every act, undo and reset beyond `--max-actions` (`src/bench/run.ts:73-103`) and a declaration refuses a cap above the family's (`src/challenge/declaration.ts:131`); a task limit would also bar the family from artifact benches (PADR-0044 decision 1). The board bound per level is decision 5 |
| Gemini 2 (blocker) | draw.io container-relative coordinates must be measured before acceptance | Adopted with change: absolute page coordinates are a normative reading rule now, and the draw.io unit is not pre-probed until fixtures show it; acceptance of this record does not wait, because the record defines the judged geometry, not draw.io's storage, and the reader is written after it (roadmap P5) |
| Gemini 3 | A mirrored row (process right to left) passes | Adopted with change: direction is deliberately not judged and the operator now says so; the sentence no longer says "from left to right" (decision 3.3); a flow direction is a re-assessment trigger, and from-scenes' existing `lt` clauses can state one |
| Gemini 4 | Routed or curved arrows are judged by their centre line: false negatives and positives | Partly adopted: the prompt states the straight-line judgement for every toolchain (decisions 9.6, 10). Refusing curved arrows was not adopted: it would judge drawing style, and F6 decided that the drawn path is not judged |
| Gemini 5 | Negative widths shift the box in `scene.ts:131` | Adopted: boxes normalised by edges (decision 10); whether Excalidraw stores negative sizes was not measured, the rule is correct either way |
| Gemini 6 | Sizes not pinned: shrink to 10 × 10 | Adopted (D), as Opus 7 |
| Gemini 7 | "Never meets an arrow from E" misses arrows into E | Adopted: "any arrow incident to E" (decision 3.5); test case added |
| Gemini 8 | The formula gave 86 049, the text 86 561 | Adopted: the where ticks were the difference; the revised model has no where ticks and the formulas and numbers are recomputed (decision 4, Context) |
| Gemini gap 1 | Segment–box intersection algorithm unspecified | Adopted: "meet" and "touch" defined exactly in integers (decisions 2, 3.6) |
| Gemini gap 2 | Unbound arrow ends in foreign tools | Refuted: binding ends by proximity would invent a relation the file does not hold (architecture §10, "Explicit unknowns"); an unbound end is loose, and the prompt says that arrows must be attached at both ends (decisions 9.6, 10) |
| Gemini gap 3 | Why not shift the canvas with `layoutOffset` | Refuted for now: variant substitution rewrites only strings, in two independent implementations (`src/world/variant.ts:41-49`, `src/checker/index.ts:38-43`), and generated worlds have one case at (0, 0) (`src/challenge/build.ts:143`); a hand-written world that needs it is a reason to revisit (decision 1.4) |

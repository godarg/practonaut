# PADR-0017 — Exact goal narration and visible workspace transitions

Status: accepted · Date: 2026-10-04

## Context

The fresh independent rendered review of source 6c69e1d (unchanged in 55a41df)
blocked acceptance on the default goal's formal vocabulary, desktop clipping,
wrapped native labels, distant recording controls and explanatory monospace text.
The real DOM regression also measured an editor below the viewport: its required
layout acknowledgement timed out after a normal mode click. These are measured
product/agent-review findings, not a human usability or learning result.

## Decision before implementation

1. Preserve the complete default T3 predicate and its single quantified witness.
   Recognise only its exact finite tree, including every count, binding and frame
   clause. Narrate labelled surviving steps, the one arrow and both distinct frame
   requirements. Do not invent original-object identity requirements. Unrecognised,
   changed or ambiguous goals retain their complete formal description. No model
   generates or evaluates this text.
2. Add optional `PublicCondition.formalText`. Views and check results carry the same
   id, readable text and full diagnosis. This is an additive wire field: old clients
   continue to read text; worlds, author projects and predicate evaluation do not
   change version or migrate. The initial task scene resolves visible references;
   the final scene never rewrites their meaning. Technical diagnosis is a closed
   disclosure. Before a check, the requirement explicitly says it is not checked.
3. A requested workspace is pending until actual engine configuration succeeds.
   Bring the native surface into the viewport before awaiting its real layout
   acknowledgement. Preserve the stable mode and tab cache until that acknowledgement;
   then commit navigation, panels and cache together. Prevent concurrent transitions
   and inputs while preparing. On failure restore the previous native snapshot/mode;
   failed restoration requires explicit recovery, never a false ready state.
4. Give the practice Board sufficient desktop width and retain labelled horizontal
   access at narrow widths. Provide a direct editor link and reachable recording
   stop/review control. Do not reparent/reload the editor iframe or bypass its mirror.
   Use sans serif for explanatory prose and the existing monospace tokens for data.
5. New prepared author scenes may allocate wider boxes before recording. Geometry
   is part of the prepared canonical state and therefore agrees with the native
   scene and examples. Existing projects and original recordings remain unchanged.

## Alternatives and limits

A separate prepared package could provide simpler identity-based conditions, but
would change the default task and require another evidence-backed package. The
bounded narrator preserves the existing task and exposes its complete diagnosis.
A manual scroll instruction would leave the measured transition fault in place.
The application owns visibility and readiness; a longer timeout is not the remedy.

The narration is a finite interpreter, not general natural-language synthesis.
One whole predicate has one whole verdict; readable clauses cannot acquire separate
truth values. A different named frame may satisfy T3's independent name clause.
User text remains author intent, never evidence. New layout is subject to actual
EN/DE, light/dark, desktop/narrow render review, not token compliance alone.

## Verification and rejection triggers

Use the unchanged no-help-scroll real DOM regression, delayed locale and actual
engine acknowledgements. Check failure restoration, scene/hash/recording preservation,
view/result parity, extra and mixed-binding clauses, exact counts, alternate frame
witnesses, text-as-text and native label rendering. Reject on a hidden condition,
false readiness, automatic recording, changed evidence or mirror bypass.

Human C7 is open and C6 unknown. Benefit, demand and revenue remain assumptions.

# PADR-0018 — Complete author sources remain admission authority

Status: accepted · Date: 2026-10-04

## Confirmed problem

Grok's source inference was reproduced locally with synthetic recordings at
55a41df. Confirmation given a clean subset could omit an excluded source named
in the project. Revalidation and compilation rejected that subset correctly.
However, the real author controller accepted a project-text edit removing the
excluded recording ID while preserving hypothesis/question data. Confirmation
and compilation then succeeded in the same project. The original recording was
not changed. This is an admission defect, not a valid way to remove uncertainty.
The affected route remains withheld from acceptance until independently checked.

## Decision before implementation

Require every existing project recording ID in confirmation input, exactly once,
as a validated recording. Additional new confirmation recordings may be supplied
and are retained as project sources on success. Missing, duplicate or excluded
sources cannot become admitted rules. Keep the existing all-source revalidation
and compilation requirements and preserve actual counterexamples.

The host's project edit may change task intent and notes, but cannot shrink the
source set of its current project. It must reject that edit with a specific error,
not silently remove sources. A separately prepared new project is the explicit
way to start again with supported demonstrations; its distinct identity and
source list do not rewrite the previous project's evidence. Old author/1 projects
need no schema migration; their declared recordingIds remain the complete source
authority during subsequent operations. The UI cannot attest independent evidence.

## Alternatives and operational limits

An additional blocked-source digest would duplicate the existing source set and
require migration and reconciliation. Enforcing completeness at the existing
mutation and admission boundaries closes the reproduced path with less state.
Excluded operations are retained and block admission; they are not invented as
behavioural counterexamples. Unknown or partial writer locks remain fail-closed.
A private-store operator runbook must explain recovery only after all owning
hosts have ended and no writer can hold or start a save, never age/PID heuristics.

## Required evidence

Replay the exact synthetic sequence: clean proposal, excluded recording, new
clean confirmation; subset library confirmation and host source-removal edit
must fail. Full excluded-source confirmation stays blocked; complete clean
independent confirmation succeeds. Reanalysis, saved reopen, source revision and
compile all retain the guard. One external-copy negative control per new critical
guard must demonstrate the original failing admission without touching recordings
or production state. Fresh independent source/runtime recheck is required.

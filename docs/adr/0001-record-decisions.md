# PADR-0001 — Record decisions in a project register

Status: accepted · Date: 2026-10-03

## Context
Practonaut is developed in phases by different agents and people with fresh context. Decisions
that live only in chat transcripts are lost between phases.

## Decision
Consequential decisions are recorded in `docs/adr/NNNN-*.md` before implementation, using the
template in `docs/adr/README.md`. The register is project-owned and numbered independently.
Supersession is written at the start of the superseded record.

## Consequences
Phase prompts reference PADRs instead of restating decisions. A change that contradicts an
accepted PADR without a superseding record is a review finding.

## Re-assessment triggers
None; this record changes only if the project adopts another decision process.

# PADR-0007 — Application adapters are trusted project code behind a capability contract

Status: accepted · Date: 2026-10-03

## Context
A world teaches a real application. The project needs a uniform way to observe, drive and export
that application, without letting world packages bring code (PADR-0003).

## Decision
An adapter is TypeScript code in this repository (or a separately reviewed package pinned in
the lockfile) implementing:

| Capability | Purpose | Required for |
|---|---|---|
| `describe()` | adapter id, supported app version range, semantic object schema, attribute units, excluded volatile fields | all |
| `snapshot()` | read semantic state with app identifiers | recording, conformance |
| `record()` | stream semantic events after an explicit start; stop and discard on request | authoring (phase 3) |
| `apply(transition)` | perform a modeled transition through an official app interface | conformance (C3) |
| `exportArtifact()` | native file and a rendered form | transfer checks |
| `importArtifact()` | load a model-derived file into the app | conformance, transfer setup |

Each adapter has an adapter manifest declaring capabilities, the pinned app version(s), how the
app runtime is provided (bundled static app, local container, separately installed program) and
the network/file permissions it needs. Worlds reference an adapter id and version range; they
never contain adapter code. Missing capabilities are reported, not emulated; a world whose rules
were never conformance-checked is labelled "recorded transitions only".

## Consequences
New applications are added by contributing an adapter with conformance tests against the pinned
real version. App updates require re-running conformance before the version range widens.

## Re-assessment triggers
Community demand for third-party adapters outside the repository (needs a signing and
isolation design); an app whose only interface is pixels (fails the S1 decision bound).

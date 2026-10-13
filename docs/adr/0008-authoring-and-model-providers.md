# PADR-0008 — Authoring may use language models; frozen worlds never do

Status: accepted · Date: 2026-10-03

## Context
Rule hypotheses and explanations can be drafted by a language model, but model output is
untrusted and may be convincingly wrong. The free core must not depend on a paid cloud.
Local model quality and hardware needs for this task are unmeasured (`assumption`).

## Decision
- The runtime, player, agent surface and checker never call a language model.
- Authoring works without any model: hypotheses come from deterministic rule-template matching
  over recorded observations (phase 3). A model is an optional assistant for proposing
  hypotheses, distinguishing demonstrations and explanation drafts.
- Providers sit behind a small interface (`propose(input, schema, budget) → output |
  error`) with: JSON-Schema validation of every response, provenance (provider, model id as
  reported by the provider, prompt hash, time), token/time budgets, and explicit failure
  results. Implementations: one local provider (OpenAI-compatible local endpoint such as
  Ollama, bound to loopback) first; remote providers only via user-supplied credentials read
  from the OS keychain or an environment reference, never from files in the repository.
- Model output enters a world only as a hypothesis or a question. Confirmation needs observed
  evidence or a conformance run (I4). Recordings are only sent to a remote provider after an
  explicit per-recording consent in the authoring UI.
- Quality and hardware needs of local authoring are measured in phase 3 and reported, never
  promised in advance.

## Consequences
The product is fully usable without any model. Authoring quality claims require measurements
on recorded fixtures.

## Re-assessment triggers
Measured evidence that model-free hypothesis generation cannot cover the pilot workflow;
provider API changes.

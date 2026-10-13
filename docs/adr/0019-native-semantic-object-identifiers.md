# PADR-0019: Native semantic object identifiers

Status: accepted · Date: 2026-10-04

## Context and measured evidence

The actual complete Phase-3 test at code commit `2457ee5` failed after a genuine
native connection received an Excalidraw-generated identifier beginning with `-`.
The recording retained a create event, no unmodeled changes and no quarantine.
Semantic projection rejected its object key. A fresh independent reviewer also
reproduced the same rejection deterministically with `-NativeArrow` and
`_NativeArrow`, while an otherwise equal `zNativeArrow` projected successfully
(LT-H2, HIGH). These are local synthetic technical observations, not human evidence.

## Alternatives

1. Re-run until native random IDs happen to begin with a letter or digit. Rejected:
   this hides a valid input mismatch and does not repair the product.
2. Rewrite native IDs into an additional alias namespace. Rejected for this repair:
   it introduces cross-reference migration, collision handling and replay identity
   mapping where retaining the actual identity is sufficient.
3. Admit the pinned editor's bounded native alphabet for semantic object identities
   throughout execution and independent checking, retaining other ID contracts.

## Decision

Choose 3. Semantic object IDs, state object keys and references (`frameId`, arrow
endpoints, repair step identities and variant label keys) accept 1–64 ASCII
letters, digits, underscores or hyphens, including at the first position.
Reserved `__proto__`, `prototype` and `constructor` identities remain forbidden.
Object key/ID equality, live frame/end references, plain JSON and all existing
size bounds remain mandatory. Core action parameters of type `id` use this object
identity domain. Parameter names, predicate binders, task/rule/recording/project
IDs, world IDs, package paths and filesystem names retain their existing contracts.

The independent submission/native checker implements its own corresponding
bounded validation. It must not import the production object validator. A valid
recording remains unchanged; no source event, raw ID or digest is rewritten.
Only matching observed successors plus distinct confirmation can admit rules.

## Versioning and migration

The JSON structures remain version 1. Existing valid projects, recordings and
packages require no rewrite and are still read. Newly generated packages that
contain leading-hyphen/underscore semantic IDs require this updated reader; older
readers may reject them. Practonaut is local and unpublished, and no release or
historical tag is modified. Native text IDs with colon/dot remain raw bookkeeping
IDs; this decision does not claim every raw editor identifier is a modeled object.

## Verification and reassessment

Require deterministic recordings using both leading characters, distinct evidence
confirmation, core action/replay, independent semantic and native artifact checks,
and complete package creation/load with these identities. Preserve refusal for
reserved/empty/overlong/path/punctuation IDs and general metadata contracts.
Run all declared layers again at the integrated commit. A broader alphabet,
identity aliasing, source rewriting or shared production/checker validator requires
a new decision. Mandatory Opus final review and human C7/C6 evidence remain open.

# PADR-0016 — Native input boundaries and authorised tab reload

Status: accepted · Date: 2026-10-04 · Supersedes PADR-0014 only for browser credential lifetime.

## Context and measured evidence

At c2de8990d5277b1c83085c9ee0c5169b9284164e a fresh visible-only agent completed
its own compiled repair exercise, but independently observed three blocking
barriers: rapid consecutive native deletes merged into a false single-action
counterexample; untouched displayed variant fields differed from submitted
fallback values; page reload lost access to saved work. These are agent results,
not human acceptance. The original maintainer recording remains unchanged.

Native terminal callbacks currently wait two animation frames and read the
then-current recorder state. A subsequent input can change that state first.
The observation cannot establish single-action causality from that merged result.
Discarding unfamiliar successor states would also hide genuine counterexamples.

## Decision and contracts before implementation

1. A pending terminal boundary is flushed from the actual editor state in capture
   phase before the next pointer/key input. A generation invalidates late callbacks.
   Configure, resync, start and stop explicitly handle pending boundaries. No input
   delay, mirror bypass or fabricated semantic event is permitted.
2. Explicit native multi-selection deletion is excluded from single-action evidence.
   The recorder's bounded `excludeSelection(ids)` context records the actual live
   selected semantic roots; bound text belongs to its container. The original
   snapshots, events and replay remain intact. An ordinary single-step deletion
   with unfamiliar arrow effects remains a counterexample. Existing recordings
   are not rewritten or retroactively relabelled.
3. The player stores its session token in tab-and-origin-scoped `sessionStorage`.
   This intentionally replaces the memory-only lifetime in PADR-0014. A new
   authenticated GET `/api/resume` returns the same public view and local editor
   address, never another token, recording or checker. The one-use, 60-second
   bootstrap remains unchanged; every later request retains the token header,
   Host, Origin, response budget and JSON mutation requirements.
4. No cookies, localStorage, token URL, automatic recording, provider or external
   assets. Storage refusal does not prevent initial use. Invalid cached tokens
   are cleared and never trigger a tokenless fallback. A host restart creates
   new credentials; named project files remain the durable authority.
5. Workspace restoration loads the actual author scene. If recording was active,
   the new iframe does not restart it. The author is told to explicitly stop and
   review retained completed host gestures; an unfinished native gesture cannot
   be recovered. Form text is not silently represented as saved project data.
6. Displayed, submitted and stored variant values use one project-scoped draft
   source. A project identity change clears previous task/review/variant drafts.

## Alternatives, evidence and consequences

Memory-only credentials require a technical restart after every reload and retain
the witnessed usability barrier. Cookies do not distinguish loopback ports;
localStorage lasts beyond the tab. Reusing the bootstrap code violates its
single-use contract. Worker/window-name approaches add lifecycle uncertainty.
The chosen storage is specified per origin and browsing context and survives
reload. Sources: [HTML Standard](https://html.spec.whatwg.org/multipage/webstorage.html)
and [MDN sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage),
checked 2026-10-04. This is an architectural inference from those APIs, not a
claim that browsers never persist session data to disk.

Same-origin script and extensions can access the token; browser restore can
retain sessionStorage. XSS already compromises the memory token, but the exposure
window is now longer. We explicitly accept that residual within the existing
same-OS-user trust boundary, pending independent security review. The separate
editor origin has no access. Child exercise windows remove `opener`.

## Expectations and rejection triggers

Before recovery acceptance: rapid native actions remain separate and replayable;
multi-object delete is visibly unsupported; actual counterexamples are retained;
untouched and edited displayed variants equal the compiled variants. Saved author
work resumes after a same-tab reload, and named projects reopen after a fresh host
start. No human usability effect is inferred from these technical checks.

Reject on crossed origin/port access, tokenless resume, bootstrap reuse, leaked
credentials, automatic recording, hidden counterexample or a broken real mirror.
Storage-blocked and expired-session paths must remain understandable. Meaningful
native DOM tests, external negative controls and independent final review are
required. Human C7 remains OPEN and C6 UNKNOWN.

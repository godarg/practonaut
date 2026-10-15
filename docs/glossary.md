# Glossary

Canonical English terms for code, APIs and documentation. User-facing wording (EN/DE) lives in
the [design language](design/design-language.md) and the message catalogs; it may be friendlier but must not
contradict these definitions.

| Term | Definition |
|---|---|
| **Application (app)** | A real third-party program a world teaches, at a pinned version range. |
| **Adapter** | Project code that connects to one application through its official interfaces: snapshot, record, apply, export, import. Declares its capabilities and permissions in an adapter manifest. |
| **Semantic state** | The application state relevant to a world, as typed objects with attributes, keyed by semantic ids. Never screen coordinates or pixels. |
| **Semantic id** | A stable, human-readable identifier of a domain object inside a world (for example `cover/title`). Bound to an application identifier (for example a UUID) by the adapter. |
| **Observation** | One captured fact from a recording: an application event or a snapshot, with provenance (recording, adapter version, app version, sequence). |
| **Recording** | An ordered set of observations of one demonstration, with pre- and post-snapshots, optional narration and rights metadata. Started explicitly; nothing is captured otherwise. |
| **Hypothesis** | A candidate rule that explains a set of observations. Has supporting and contradicting observations. Never executes. |
| **Model question** | An open question that distinguishes competing hypotheses, with a proposed distinguishing demonstration. Answered only by new evidence. |
| **Rule** | A confirmed transition rule: preconditions and effects of an action on semantic state, with references to the observations or conformance runs that confirm it. |
| **Unmodeled** | The status of an action, attribute or effect that no confirmed rule covers. The runtime reports it and changes nothing. |
| **Action** | A typed operation a learner or agent can request (for example `move`, `resize`, `rename`), declared in the world's action schema. |
| **World** | A compiled, versioned, frozen package: object schema, initial state, action schema, rules, tasks, variant specs, feedback texts, provenance and rights. Runs without an LLM. |
| **World package** | The archive form of a world, with a manifest of contents and hashes. |
| **Task** | A goal for a learner or agent: a goal predicate over the result plus localized description and hints. |
| **Goal predicate** | A declarative condition on the final state or exported artifact. Describes what must be true, not which path to take. |
| **Variant** | A task instance produced from a task template and a seed. Must be checked solvable and must exercise the same skill. |
| **Held-out task** | A task kept outside the learner/agent package and used only by the independent checker or a transfer test. |
| **Session** | One run of a world: world version, seed, action log, state hashes per step, undo history. |
| **Session host** | The local process that owns session state and serves both the player and the agent surface. |
| **Player** | The human interface to a session. |
| **Agent surface** | The machine interface to a session (Model Context Protocol tools). Same operations as the player. |
| **Undo / Reset** | Undo returns to the previous step's state. Reset returns to the session's initial state. Both are exact (same state hash). |
| **Result check** | An independent evaluation of a goal predicate by the checker, separate from runtime transition code. |
| **Conformance run** | Applying a modeled transition to the real application through the adapter and comparing the read-back state with the prediction. |
| **Transfer case** | A new task performed in the real application, checked on the exported artifact. |
| **State hash** | SHA-256 of the canonical JSON serialization (RFC 8785) of the semantic state. |
| **Mirror** | The pinned real application (Excalidraw) running headless next to a session. Every step is applied to it and read back before it counts. Without Chromium the session runs **model-only**. |
| **Model-only** | A session without the mirror. Tasks work, but results are not checked against the real application. |
| **Library task** | A task from the bundled Excalidraw task library (`tasks/excalidraw/`), addressed as `excalidraw/<id>`. |
| **Reference solution (oracle)** | A known action sequence that solves a task; used to verify the task and by the `oracle` bench agent. Never shown to agents. |
| **Minimal length / reference length** | A reference's length is *minimal* when a bounded search proves that no solution is shorter (PADR-0040); otherwise it is only a *reference length*, and a shorter solution may exist. |
| **Task limits** | A task's public `limits`: how many accepted changes (undo and reset included) and checks one attempt may use. Enforced by the host for the Player and agents alike. |
| **Challenge tier** | Harder generated task families (repair, injection, long horizon, limited checks, tight budget); a family is published only after it passes its preregistered ladder gate (PADR-0040). |
| **Held-out instance** | A generated instance made right before a gate round from fresh seeds and not looked at while tuning; the gate's unit of analysis. |
| **Near miss** | A result that looks close to the goal but must fail the check; proves the goal predicate is strict enough. |
| **Bench run** | One agent attempt on one task, seed and repeat, in a fresh session, scored by the checker after the agent stops. |
| **pass@1 / pass^k** | Share of passed runs / the chance that all of k repeats of the same task and seed pass (τ-bench). |
| **Instance** | One task at one seed, the unit `compare` counts; its repeats give one outcome (passed when at least half of all of them passed; a run that was not judged counts as not passed). |
| **Instance regression** | An instance with at least three judged repeats on each side that passed in every judged baseline repeat and failed in every judged candidate repeat (PADR-0039). `compare --fail-on-regression` also fails when the candidate is incomplete (`compare_incomplete`). |
| **Condition trace** | The checker's record of which goal conditions held at the start and after every accepted act, undo and reset of a run. |

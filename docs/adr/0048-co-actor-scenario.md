# PADR-0048 — Co-actor scenario: a scripted colleague edits the board mid-run

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, Must 4 (issue #54) · Defines what PADR-0044
(bench report v3, proposed, decision 7 "Co-actor") leaves to "the scenario record": the trigger,
what the view shows of the schedule, whether undo and reset may remove the colleague's changes and
whether the schedule fires again · Refines
[PADR-0040](0040-challenge-tier-generated-families-and-gate.md) decision 4 (a new variant counts
like a reset on a task with a schedule) and uses the unit `human-edit.practonaut` of
[PADR-0042](0042-gate-for-families-on-toolchains.md) · To be accepted after an independent review,
before the code that implements it

## Context

The roadmap's item 4 is the family deferred from 0.2.0: "a human edits mid-run". It needs a
scenario contract first — "schedule stored with the run and bound into `--verify` and `compare`;
human actions do not use the agent's budget; undo and reset rules; a co-actor only the host can act
as". Its acceptance line: "the oracle passes under the scripted intervention, random and near
misses fail under it, and a run in which the agent removed the edited object is judged by a stated
rule; the family passes the ladder gate or is reported as not passing (or 'admitted, not gated for
budget')". What the code does today:

- **One writer, revisioned transactions.** The host serialises every change
  (`src/host/session.ts:334-375`): a request whose `expectedRevision` is not current is refused with
  `stale_base` and the current step and revision (`:275`), a request during another transaction
  with `session_busy` (`:274`); a change forks the committed session, applies through
  `Session.act`, replays the candidate's full history, goes through the mirror and only then
  commits ([PADR-0037](0037-fork-the-committed-session-for-candidates.md)). The core refuses an
  action whose `baseStep` is not the current step (`src/core/apply.ts:46`).
  [PADR-0004](0004-runtime-semantics.md) already says that once more than one actor can act, a
  stale request "is rejected, not merged".
- **Actors.** The host knows a person, an agent and the bundled example's demonstration
  (`src/host/protocol.ts:44`); HTTP accepts only `kind: 'agent'` (`src/host/server.ts:95`), and a
  request without an actor is a person's. The session's own log carries no actor.
- **Counting.** The host's count of an attempt's changes
  ([PADR-0040](0040-challenge-tier-generated-families-and-gate.md) decision 4,
  `src/host/session.ts:223-235, 336-338`) adds one per accepted act, undo, reset and
  editor gesture, never gives anything back, and survives a reset; a new variant counts like a
  reset only when the task has limits and otherwise starts fresh counts (`:409`); another task
  starts fresh counts. A hint advances the revision (`:415`), a check does not.
- **Undo and reset are linear.** Undo removes the last log entry, whoever made it
  (`src/core/session.ts:98-108`); reset returns to the seeded start (`:109-112`).
- **Ids depend on the whole prefix.** A created object's id hashes world, seed and every action
  before it (`src/core/apply.ts:34-36`), so a creation after another actor's change gets another id
  than without it; objects of the start state keep their ids.
- **The only scripted actor** is the demonstration (`src/host/demonstration.ts`): host-only, it acts
  through the same `act`, but it is paced by timers (`DEMONSTRATION_PACE`, `setTimeout`), owns its
  attempt and refuses everyone else's changes while it lasts, and exists only on the bundled
  example. It cannot interleave with an agent and needs a clock.
- **The bench.** `countingController` (`src/bench/run.ts:73-121`) counts every act, undo and reset
  that reaches the session against `--max-actions`, refused ones included, and writes each record
  after the host replied. The MCP oracle stops at its first refused action
  (`src/bench/baselines.ts:45`).
- **Judging.** Verdicts are end-state only (architecture §3). A from-scenes goal states content —
  exact multisets of step signatures (label, shape, colours, frame, group), arrows by their ends'
  labels, frames by name — not object ids (`src/authoring/from-scenes.ts:98-150`).
- **bench/3** (PADR-0044 decision 7, proposed): the schedule is task content, public like `limits`;
  every mutation record carries its actor; the agent's counters and limits count the agent only;
  `--verify` checks every co-actor record against its entry and every reached entry for exactly one
  record; the log is complete. It leaves the four questions named above to this record.

## Options considered

**Trigger.**
1. *Wall-clock time* (after n seconds). Needs a clock in what decides the state sequence, cannot be
   replayed or verified, and favours slow or fast agents by latency, not skill. Rejected.
2. *The revision.* It also moves on hints and on the colleague's own changes, so opening a hint
   could fire the colleague. Rejected.
3. *The step* (history length). It goes down on undo and to zero on reset: an agent could avoid the
   trigger or reach it again and again. Rejected.
4. *The agent's next request* (the colleague acts between the agent's read and its write). Reads are
   not host records — `observe` is not in the mutation log, the call log is written by the agent's
   own bridge — so `--verify` could not recompute the trigger; the Player and MCP read differently,
   so a person and an agent would meet it at different points. Rejected.
5. *The owner's k-th counted change* (chosen): PADR-0040's count — monotone, survives reset,
   identical for the Player and MCP, and recomputable from Practonaut's own mutation log.

**Where the colleague runs.** (1) *In the bench runner*, around the host: the Player would never see
the colleague, so a person and an agent would practise different tasks (architecture §10, "one
state for human and agent"). (2) *A host wrapper like the demonstration*: releases the writer lock
between the two changes, so another request could land between them. (3) *In the host's
transaction path, under the writer lock* (chosen).

**What the agent and the Player see.** (1) *Nothing until it happens.* The schedule would be task
content that a tools-only agent and a person cannot see but an agent with file tools can read in the
world — hidden data by another name; PADR-0044 decision 7 would need amending. (2) *That a colleague
will edit, not what or when.* The same split for the part left out. (3) *The whole schedule*
(chosen).

**Targets.** (1) *Start ids.* An agent that replaced a step by an equal one before the trigger would
make the colleague's edit hit a tombstone, although the board looks right. (2) *Labels with a fixed
fallback to the start object* (chosen; a person sees labels). (3) *Labels with a heuristic choice
among candidates.* Invents a decision the scenario does not state.

**Judging when the agent removed or replaced the edited object.** (1) *The end state as content*
(chosen). (2) *Identity clauses* pinning the object the colleague edited: contradicts label
targeting (a replacement made before the trigger receives the edit, then fails its pin) and cannot
be written for objects the colleague creates (their ids depend on the prefix). (3) *Attribution*
(who made the final change). The checker is end-state only and does not attest who acted (architecture §3).

**Undo of the colleague's change.** (1) *Refused.* Protects the colleague's work for the agent and
hides the mistake the family measures. (2) *Selective undo of one's own changes.* Non-linear undo
does not exist in the core and would break "session = world + seed + log". (3) *Linear undo, the
agent's change* (chosen).

**Reset.** (1) *The schedule fires again* from the reset on: needs a second trigger arithmetic, and
the same entry would land twice in one run. (2) *The colleague's changes survive the reset*: reset
would no longer return to the seeded start (PADR-0004). (3) *Reset discards them; fired entries
never fire again* (chosen).

## Decision (proposed)

1. **The schedule is task content.** World/2 gains an optional, public task field `schedule`: 1–16
   entries `{ after, action }`, `after` an integer from 1 to 1000 (`TASK_LIMITS.actions`), strictly
   increasing; `action` names one of the world's own actions with exactly that action's
   parameters. Scalars follow the parameter contract. An `id` or `nullable-id` parameter takes a
   target instead of an id: `{ step: <label> }`, `{ frame: <name> }` or
   `{ arrow: { from: <label>, to: <label> } }` (a `nullable-id` also `null`). Every target must name
   exactly one live object of its type in the task's start state; it names that start object.
   Variant materialisation substitutes tokens in strings and target labels like state labels, and
   adds the variant's layout offset to `x` and `y` parameters like start steps
   (`src/world/variant.ts:50-56`). Validation refuses an action the world does not define,
   parameters outside the contract, a target that does not name exactly one start object, and
   triggers that do not increase. The field is optional without a default: existing worlds keep
   their canonical JSON and content hash. It is part of the world's content hash and of the task
   identity (PADR-0044 decision 3 already includes it). Entries are data: action names from the
   world's own list and parameters, shown only as text.

2. **Trigger.** Entry *e* fires once the owner's counted changes reach `after_e`: right after the
   counted change that reaches it commits and before the reply to that change returns.
   - *The owner's counted changes* are PADR-0040's action count of the attempt — accepted act, undo,
     reset and editor gesture, and on a task with a schedule a new variant (decision 7) — made by
     anyone except the co-actor: the person in the Player and the agent over MCP alike. The count
     never goes down, survives undo, reset and a new variant, and starts at zero only when a task is
     opened (a bench host refuses another task). A refused request, a hint, a check and the
     co-actor's own changes add nothing.
   - Since `after` strictly increases and a change adds one, at most one entry is due after any
     change. Entries fire in schedule order, each at most once per opening of the task.
   - *If the owner never reaches `after_e`,* entry *e* and every later one never fire. The run is
     judged like any other, and the report says that the colleague did not act, with the owner's
     count and the trigger it needed.
   - *Generated instances make such a run a failing run.* Let m be the proven minimal length from the
     start to the goal ([PADR-0040](0040-challenge-tier-generated-families-and-gate.md) decision 5,
     computed without the colleague). The generator emits an instance only when m is proven and
     `after_e ≤ m − e` for the *e*-th entry, counted from 1 (for one entry, `after ≤ m − 1`). Then
     every passing run fired every entry: if entry *e* never fired, the final history holds fewer than
     `after_e` of the owner's actions and at most *e* − 1 of the colleague's, fewer than m actions in
     all, and no history shorter than m reaches the goal. For the same reason no entry fires on a
     board that already meets the goal. An author's own world may use any schedule; the bound is the
     generator's rule, re-checked by the gate (decision 12), not a validation rule.

3. **Everything is announced, to the Player and the agent alike** (architecture §10: both see the
   same task and the same goal).
   - The view gains `schedule` (the Player's task panel; `observe` compact and full): the owner's
     count `changes`, and per entry its `after`, its action as written (targets by label), a sentence
     the host generates from the entry with the history's action templates in EN and DE ("After your
     3rd change, a colleague renames “Ship parcel” to “Ship parcels”."), and its status — `pending`,
     `done` with the step it landed at, or `refused` with its code. No world-authored text describes
     an entry, so an announcement cannot differ from what happens.
   - The goal states the final board, the colleague's changes included; the prompt says that a
     scripted colleague edits the board, that their changes stand, and what a reset discards.
   - A colleague's change is a history item with its actor (decision 4). The Player receives it as an
     event at once; the agent learns of it from its next `observe`, or from its next change or check,
     which is refused with `stale_base` naming the current step and revision. The reply to the owner's
     triggering change is unchanged ([PADR-0038](0038-lean-mcp-replies.md)): it describes the
     owner's own change.
   - Fixed project text, never world-authored: one sentence in the MCP server instructions (some
     tasks have a scripted colleague; `observe` shows when and what; after `stale_base`, observe
     again); the `undo` tool description says it takes back the most recent change, whoever made it.
   - **Predictable on purpose.** The measured skill is reacting correctly to a change on the board —
     noticing that the board moved, reading it again, keeping the colleague's change and finishing
     one's own part on the changed board (an object the colleague added, renamed, moved or removed) —
     not being surprised. A predictable colleague still forces a stale request or a timely
     `observe`, new targets and a decision not to revert. Pre-empting the colleague gains nothing:
     an entry still lands (decision 8), and doing a creation early leaves a duplicate the goal's
     exact counts refuse. Whether an announced colleague leaves headroom is what the pre-probe
     measures ([PADR-0041](0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md)
     decision 4); an unannounced variant needs its own record.

4. **Actor.** A fourth, host-only kind `{ kind: 'co-actor'; entry: <index from 0> }`, shown as
   "Colleague (scripted)" (the German catalog text says scripted as well). No request can claim it:
   the HTTP actor schema stays `kind: 'agent'` only (`src/host/server.ts:95`), so a request naming
   `co-actor` is refused `invalid_request`; the MCP bridge always sends `agent`; nothing in an HTTP
   or MCP input names an entry or makes one fire. The bridge's strict view schema
   (`src/mcp/bridge.ts:73`) learns the kind and the `schedule` section. The co-actor exists only on
   a task with a schedule and never shares a task with the demonstration (the bundled example has
   no schedule).

5. **One transaction per colleague change, under the owner's lock.** A due entry runs as its own
   transaction through the host's mutation path: a fork of the committed session, `Session.act` with
   the current step as `baseStep`, the candidate's full replay, the mirror's apply and read-back, and
   publication with its own revision and history item. It gets its own transaction deadline (5 s,
   `HOST_TRANSACTION_MS`) from its own start; the owner's reply waits for it, at most two
   transaction deadlines, inside the 30 s request and bridge deadlines
   ([PADR-0022](0022-linear-replay-and-transaction-deadline.md) C1). PADR-0022's deadline holds per
   transaction; a host-initiated transaction gets its own, as the demonstration's actions already
   do. The writer lock is held from the owner's admission until the entry has committed or been
   refused: no other change or check is admitted in between (`session_busy`, as today). Reads
   (`observe`, the Player's events) may see the owner's revision before the colleague's; both are
   committed. In process, the owner's reply also lists the co-actor outcomes that followed it, in
   commit order, for the bench's recorder; the HTTP layer never serialises that list, so the wire
   shapes stay.

6. **Budget and limits.**
   - Co-actor changes count against no task limit, not against the bench's `--max-actions`, and not
     in the agent's counters (PADR-0044 decision 7). They never trigger an entry and are never
     refused for a used-up budget.
   - **The refusal the colleague causes is free.** The owner's first act, undo or reset after an
     entry's change was accepted, when refused with `stale_base`, uses no unit of the bench cap (task
     limits never count a refusal, PADR-0040). It stays the agent's refused record in the log and in
     the agent's call counts (`rejectedActions` for an act), and the report explains it as caused by
     the colleague. One such refusal per accepted entry; any later stale request is the agent's
     own. `--verify` derives it from the log order.

7. **Undo, reset and a new variant.**
   - Linear undo stays: undo takes back the most recent change, whoever made it. An undo that
     removes the colleague's change is the agent's counted change; the colleague does not act again.
   - Reset returns to the task's start and discards the colleague's changes with the owner's; fired
     entries never fire again, and the count goes on. The goal still includes the colleague's
     changes, so after a reset the owner has to make them itself.
   - A new variant (the Player only; MCP and bench hosts have none) counts like a reset on a task
     with a schedule, with or without limits (this refines PADR-0040 decision 4 and the rule at
     `src/host/session.ts:409` for such tasks); the schedule is materialised for the new variant;
     fired entries stay fired. Opening another task starts fresh counts and a fresh schedule state.

8. **Targets: by label, with a fixed fallback; the core decides.** When entry *e* fires, each target
   resolves on the committed board: the one live object of its type that carries the target's label
   (a step), name (a frame) or end labels (an arrow), if there is exactly one; otherwise — none or
   several — the start object the target names, whatever its state now. The resolution never picks
   among candidates and never substitutes another object. The resolved action goes to the core like
   any other: if the agent renamed the start object, the colleague edits it under its new name; if
   the agent deleted it, the core refuses (`precondition_failed`). Nothing is invented (architecture
   §10, explicit unknowns). The function is pure, lives in `src/world` (no clock, no I/O) and is
   shared by host and checker like predicate evaluation.
   - **A refusal by the core** (`precondition_failed`, `invalid_argument`, `unmodeled`,
     `limit_exceeded`) is part of the scenario — the board changed first. The entry is recorded as
     refused with that code (fired, not accepted); the colleague does nothing instead and never
     retries. The run is judged.
   - **Any other refusal** of a colleague's transaction — the mirror disagrees or times out, the
     deadline passes, the session closed, a replay mismatch, the view is too large — means the
     scripted scenario did not happen as the task states. The run is `infra_error` with the reason
     `co_actor_fault` (a new value of PADR-0044 decision 9's enumeration, added through the schema
     holder), never judged; it counts as not passed and towards a gate round's 5 % void rule. The
     Player shows the entry refused with its code, never as a refusal of the person's own request.

9. **The judging rule.** The verdict stays end-state only: the final board against the public goal,
   which states the board after the colleague's changes as content. Neither the checker nor the
   verdict asks who made a change. Stated consequences:
   - the agent **removed** the object the colleague edited → fails, unless the final board holds an
     object with the colleague's content again;
   - the agent **replaced** it by an object equal in every attribute the goal states (label, shape,
     colours, frame, group, its arrows) → passes: the colleague's change is on the board;
   - the agent **undid or reverted** the colleague's change → fails;
   - the agent removed the target **before** the trigger → the colleague's change is refused
     (decision 8) and its content is missing → fails, unless the owner put that content on the board
     itself.

   The report adds what the verdict leaves out: the trace (PADR-0039 A.3) evaluates every goal
   condition after every record, the colleague's included, so it names the colleague's record after
   which a condition was met and the agent's action after which it was last lost; each run lists its
   colleague outcomes (done, refused with code, did not act).

10. **Recording, evidence and `--verify`.**
    - The agent's record is written first, then one record per co-actor outcome, consecutive, in
      commit order: from revision r, the owner's change is published at r + 1 and an accepted
      entry at r + 2. A co-actor record is an `act` with the resolved action (and its `baseStep`),
      `actor: "co-actor"`, `entry`, `client: null`, the outcome and code, and the step and revision
      afterwards (PADR-0044 decision 7). It is never omitted; a co-actor run without its complete
      log is `infra_error` (`evidence_incomplete`).
    - **`verifySchedule`** (in `--verify`, `bench --recover` and the gate): materialise the schedule
      for the run's seed; replay the log with the checker's own transition code; count the agent's
      accepted act, undo and reset records (in a bench the owner is the agent). Where the count
      reaches `after_e`, the very next record must be entry *e*'s, its action equal to the
      resolution of decision 8 on the replayed board, and its outcome consistent: accepted — the
      checker's code accepts it; refused with a core code — the checker's code refuses it too (a
      refusal it would accept is a forged refusal); refused with another code — the run is
      `infra_error` `co_actor_fault`. No co-actor record anywhere else, none for an entry twice or
      out of order, none for a trigger the replay never reaches, and `coActor` equal to the
      records. Each mismatch refuses (`bench_report_invalid`). The trace
      replays co-actor records like agent acts. The session file (`practonaut.session/1`) is
      unchanged and carries no actor; attribution lives in the mutation log and the host's history.

11. **Baselines, near misses and the family.**
    - **Oracle.** It plays the reference's own steps. On `stale_base` it observes once and resends
      the same step with the observed step and revision; a second refusal ends the run as today. A
      sidecar parameter `{ coActorCreated: e }` names the object entry *e* created, which the oracle
      takes from the board it observed after that entry fired (the one new live object it did not
      make). A sidecar that uses it is `practonaut.task-oracle/2`; `/1` readers refuse it.
    - **Random** is unchanged: it already observes after a refusal.
    - **Near misses** are from-scenes' (one action left out or altered), replayed with the schedule
      applied, plus clobbers: an `undo` right after each entry fires; the inverse of each entry's
      change right after it, where one action inverts it (rename back, restyle back, back to its
      frame, delete the colleague's step); for an entry that creates an object, the same object also
      made by the agent before the trigger. Every near miss must fail with the schedule applied
      before an instance is written (`verifyTask`).
    - **Family** `challenge-human-edit` 1.0.0 (unit `human-edit.practonaut`; the title on every
      surface says "a scripted colleague edits mid-run"): instances from `fromStates`, 1–3 entries
      by difficulty, edits of the kinds rename, restyle, move to another frame, add a step, delete a
      step and re-target an arrow end, chosen so that continuing the plan read at the start breaks
      the goal; the trigger bound of decision 2; the reference interleaved with the schedule. The
      generator change fixes the details and versions them (PADR-0040 decision 2).
    - **Efficiency** for a task with a schedule divides the agent's actions by the reference's own
      length, labelled "reference length", never "minimal": the minimal-length proof covers the
      start-to-goal path without the colleague, not the agent's part under interleaving.

12. **Gate, compare, toolchains.** The family is gated on Practonaut's own actions only (PADR-0042
    decision 1). The gate re-verifies every held-out run with `verifySchedule`; `gate --preflight`
    additionally checks per instance the proven m and the trigger bound, oracle 100 %, random ≤ 5 %
    and every near miss failing in a checker process with the checker's own trigger counting.
    Everything else follows PADR-0040 and PADR-0042: pre-probe, held-out size, gate pair, budget and
    the outcomes "passes", "does not pass" or "admitted, not gated for budget". `compare` needs
    nothing new: the schedule is in the world's content hash and in the task identity, so reports
    with different schedules never pair; `co_actor_fault` runs are runs without a verdict
    (PADR-0039 C.2, C.3).

13. **What is measured, and what is not.** Measured: whether an agent (or a person in the Player)
    keeps a scripted colleague's announced change and finishes its own part on the board as
    changed, judged on the end state. Not measured, and never claimed: collaboration with a real
    person; reacting to unannounced or adaptive changes (the colleague never responds to the agent);
    concurrent editing or merging (the colleague acts only between two of the owner's changes,
    atomically); preserving object identity (decision 9); who made the final change. Reports and
    docs say "scripted colleague", never "human collaborator".

**Example** (mechanics only, not a hard instance). Start: steps “Pack”, “Ship parcel” and
“Invoice” in frame “Shop”, arrows Pack → Ship parcel → Invoice. Schedule: one entry, after 2:
rename `{ step: "Ship parcel" }` to “Ship parcels”. Goal: a yellow step “Check stock” between
“Pack” and “Ship parcels”, everything else as before. Without the colleague the goal needs m = 5
actions (add, colour, re-target, connect, rename), so `after ≤ 4`. An agent adds “Check stock” (1)
and colours it (2); the colleague's rename is published before the reply to change 2 returns; the
agent's re-targeting, which names the revision of that reply, is refused `stale_base` (free); it
observes, re-targets (3) and connects (4) — a pass. A run that instead undoes after the stale
refusal takes back the rename and fails; one that deletes “Ship parcels” and adds an equal step
with both arrows passes; one that deletes “Ship parcel” before change 2 has the rename refused
(`precondition_failed`) and fails unless it adds a “Ship parcels” step itself.

## Consequences

- **Code** (later changes, each with its tests): `src/world/schema.ts`, `src/world/types.ts` and
  `src/world/variant.ts` (the field, validation, materialisation) and a pure `src/world/schedule.ts`
  (resolution), under the deterministic-core rules; `src/host/protocol.ts` (the actor, the view's
  `schedule`), `src/host/session.ts` (due entries in the mutation path under one lock, uncounted;
  variant counted like a reset; the in-process outcomes) and `src/host/server.ts` (the outcomes
  never serialised; a test that `co-actor` is refused); `src/mcp/bridge.ts`, `src/mcp/replies.ts`,
  `src/mcp/contracts.ts` (view schema, compact view, fixed texts); the Player's history chip and
  schedule panel under design-language §13; `src/bench/run.ts` (record order, the free refusal,
  `co_actor_fault`), `src/bench/baselines.ts` (the oracle), `src/bench/verify.ts` and the checker
  (`verifySchedule`), `src/authoring/from-scenes.ts` (replay with the schedule), `src/challenge/`
  (the family, the bound, preflight). The schema parts go through PADR-0044's schema holder.
- **Docs**: `docs/world-format.md` (the field), `docs/session-host.md` (the actor, the lock, the
  view), `docs/agent-guide.md` (the colleague and `stale_base`), `docs/benchmarks/README.md` (the
  family, the free refusal, `co_actor_fault`), the glossary ("scripted colleague"), the changelog.
- **Tests the implementation brings**, each failing without its mechanism, expected values from
  hand-built boards and logs: the trigger after a k-th act, undo and reset, not after a refused
  change, a hint, a check or the colleague's own change, never again after a reset; the owner's
  reply returned after the colleague's commit and a request in between refused `session_busy`; an
  HTTP request claiming `co-actor` refused; resolution with one, none and two live matches and a
  tombstoned start object; the free refusal; the record order and the trace; `--verify` refusing a
  missing, extra, late, repeated, wrong-action and forged-refusal record; the four cases of decision
  9 and a run that never reached the trigger; the oracle passing, random and every near miss failing
  under the schedule; a mirror stand-in that refuses the colleague's write giving `co_actor_fault`;
  the Player showing the schedule and the colleague (e2e, axe).
- The acceptance line of item 4 is measured by the oracle, random and near-miss tests above, the
  removed-object case of decision 9, and the family's gate report — "passes", "does not pass" or
  "admitted, not gated for budget".
- A triggering change takes two transactions; the owner waits about twice as long for that one
  reply (median host processing per change with the mirror is 31 ms, PADR-0037).
- PADR-0040 decision 4 gains one rule for tasks with a schedule (a new variant counts like a reset);
  PADR-0044 decision 9 gains one failure reason. Both are additive.

## Re-assessment triggers

A passing run in which an entry did not fire (the bound of decision 2 is wrong); `co_actor_fault`
in more than 1 % of a round's runs; the pre-probe outside 10–80 % because the announced colleague is
too easy to work around; a request for an unannounced, randomised or adaptive colleague, for one that
acts on reads or on time, or for one that targets objects created during the run; a goal that must
judge object identity or who acted; a second application whose mirror cannot carry two transactions
inside one request deadline.

# PADR-0048 — Co-actor scenario: a scripted colleague edits the board mid-run

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, Must 4 (issue #54) · Defines what
[PADR-0044](0044-bench-report-v3.md) decision 7 ("Co-actor") leaves to "the scenario record": the
trigger, what the view shows of the schedule, whether undo and reset may remove the colleague's
changes and whether the schedule fires again · Refines
[PADR-0022](0022-linear-replay-and-transaction-deadline.md) C1 (a host-initiated transaction inside
a request, decision 5) and [PADR-0040](0040-challenge-tier-generated-families-and-gate.md) decision
4 (a new variant counts like a reset on a task with a schedule); adds one failure reason to
PADR-0044 decision 9; uses the unit `human-edit.practonaut` of
[PADR-0042](0042-gate-for-families-on-toolchains.md) · Needs first a separate small change: a
single-task (bench) host refuses every variant request (decision 7) · Revised after three
independent reviews and a re-review on 2026-10-18 (dispositions at the end) · To be accepted after the
coordinator's check of this revision, before the code that implements it

## Context

The roadmap's item 4 is the family deferred from 0.2.0: "a human edits mid-run". It needs a
scenario contract first — "schedule stored with the run and bound into `--verify` and `compare`;
human actions do not use the agent's budget; undo and reset rules; a co-actor only the host can act
as". Its acceptance line: "the oracle passes under the scripted intervention, random and near
misses fail under it, and a run in which the agent removed the edited object is judged by a stated
rule; the family passes the ladder gate or is reported as not passing (or 'admitted, not gated for
budget')". What the code does today:

- **One writer, revisioned transactions.** The host serialises every change
  (`src/host/session.ts:334-375`; the HTTP layer refuses a second write while one runs,
  `src/host/server.ts:303`): a request whose `expectedRevision` is not current is refused with
  `stale_base` and the current step and revision (`src/host/session.ts:275`); a change forks the
  committed session, applies through `Session.act`, replays the candidate's full history, goes
  through the mirror and only then commits
  ([PADR-0037](0037-fork-the-committed-session-for-candidates.md)). The core refuses an action whose
  `baseStep` is not the current step (`src/core/apply.ts:46`).
  [PADR-0004](0004-runtime-semantics.md) already says that once more than one actor can act, a
  stale request "is rejected, not merged".
- **Actors.** The host knows a person, an agent and the bundled example's demonstration
  (`src/host/protocol.ts:44`); HTTP accepts only `kind: 'agent'` (`src/host/server.ts:95`), and a
  request without an actor is a person's. The session's own log carries no actor.
- **Counting.** The host's count of an attempt's changes
  ([PADR-0040](0040-challenge-tier-generated-families-and-gate.md) decision 4,
  `src/host/session.ts:223-235, 336-338`) adds one per accepted act, undo, reset and editor gesture,
  never gives anything back, and survives a reset; a new variant counts like a reset only when the
  task has limits and otherwise starts fresh counts (`:409`); another task starts fresh counts. A
  hint advances the revision (`:415`), a check does not.
- **Changes that change nothing are accepted and counted.** `rename_step`, `set_style`,
  `set_frame` and `reconnect_end` do not check that the new value differs (`src/core/apply.ts:169`
  and the cases after it); an undo with nothing to undo returns ok (`src/core/session.ts:99`) and
  the host counts it.
- **Undo and reset are linear.** Undo removes the last log entry, whoever made it
  (`src/core/session.ts:98-108`); reset returns to the seeded start (`:109-112`).
- **Ids depend on the whole prefix.** A created object's id hashes world, seed and every action
  before it (`src/core/apply.ts:34-36`), so a creation after another actor's change gets another id
  than without it; objects of the start state keep their ids, and a rename never changes one.
- **The only scripted actor** is the demonstration (`src/host/demonstration.ts`): host-only, it acts
  through the same `act`, but from timers outside any HTTP request (`:151-159`, `:194-196`), owns its
  attempt and refuses everyone else's changes while it lasts, and exists only on the bundled
  example. It cannot interleave with an agent and needs a clock.
- **A bench host still accepts a new variant** (a gap that predates this record): `singleTask`
  refuses only a variant for another task (`src/host/session.ts:397`), the route has the practice
  capability, and the bench's counting controller passes it through without a count or a record
  (`src/bench/run.ts:115`). MCP has no variant tool, so only an agent with file or shell tools
  could send one.
- **The bench.** `countingController` (`src/bench/run.ts:73-121`) counts every act, undo and reset
  that reaches the session against `--max-actions`, refused ones included, and writes each record
  after the host replied; a refused action's strings are cut at 256 characters
  (`src/bench/evidence.ts:131`). The MCP oracle stops at its first refused action
  (`src/bench/baselines.ts:45`).
- **References.** `runOracle` stops at the first refused step
  (`src/authoring/from-scenes.ts:303-318`), `verifyTask` counts a near miss that does not apply as
  `near_miss_passes` (`:547-550`), and the generator redraws only three error codes and rethrows the
  rest (`src/challenge/build.ts:121-129`). The bench reads oracle sidecars whose steps are world
  actions only (`src/bench/world.ts:99`).
- **Judging.** Verdicts are end-state only (architecture §3). A from-scenes goal states content —
  exact multisets of step signatures (label, shape, colours, frame, group), arrows by their ends'
  labels, frames by name — not object ids, positions or sizes (`src/authoring/from-scenes.ts:98-150`).
- **Binding a log to the judged session** happens today only in the trace
  (`src/checker/trace.ts:63`); a run may have no trace, and `--verify` then skips the comparison
  (`src/bench/verify.ts:151`).
- **bench/3** ([PADR-0044](0044-bench-report-v3.md) decision 7): the schedule is task content,
  public like `limits`; every mutation record carries its actor; the agent's counters and limits
  count the agent only; `--verify` checks every co-actor record against its entry and every reached
  entry for exactly one record; the log is complete. It leaves the four questions in the status
  line to this record.

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
(who made the final change). The checker is end-state only and does not attest who acted
(architecture §3).

**Undo of the colleague's change.** (1) *Refused.* Protects the colleague's work for the agent and
hides the mistake. (2) *Selective undo of one's own changes.* Non-linear undo does not exist in the
core and would break "session = world + seed + log". (3) *Linear undo, the agent's change*
(chosen).

**Reset.** (1) *The schedule fires again* from the reset on: needs a second trigger arithmetic, and
the same entry would land twice in one run. (2) *The colleague's changes survive the reset*: reset
would no longer return to the seeded start (PADR-0004). (3) *Reset discards them; fired entries
never fire again* (chosen).

**Runs that pass without keeping the colleague's changes** (undo or reset loops, revert and redo).
(1) *Refuse undo and reset after an entry fired*: protects the colleague's work for the agent, and
an act followed by its undo still advances the count. (2) *A public action limit below the cost of
these paths*: closes them, but adds a budget difficulty to the family. (3) *Judge the end state,
name the paths, show with every pass whether the colleague's changes were kept, and add a limit
only if such passes become common* (chosen).

**A refusal of the colleague's transaction.** (1) *Every refusal not by the core is an
infrastructure error* (first draft): an agent could cause one, for example by growing the view to
its limit, and more than 5 % of them void a gate round. (2) *Every refusal judged*: a browser crash
would count against the agent. (3) *Classified by code* (second draft): a code names a class of
error, not who caused it — `mirror_timeout`, for one, is also raised by a deadline check before any
mirror call (`src/host/session.ts:269`). (4) *Classified by the stage at which the transaction
failed, recorded by the host with the code; what admission, size, the error classes or the core
decide is judged, only machinery after the colleague's own admission is an infrastructure error*
(chosen).

**The agent's stale refusal after a colleague change.** (1) *One free refusal per entry* (first
draft): not provable as caused by the colleague from the log, and it changes what PADR-0044's cap
counts. (2) *The family's cap is raised by the number of entries* (chosen).

## Decision (proposed)

1. **The schedule is task content.** World/2 gains an optional, public task field `schedule`: 1–16
   entries `{ after, action }`, `after` an integer from 1 to 1000 (`TASK_LIMITS.actions`), strictly
   increasing; `action` names one of the world's own actions with exactly that action's
   parameters. Scalars follow the parameter contract. An `id` or `nullable-id` parameter takes a
   target instead of an id: `{ step: <label> }`, `{ frame: <name> }` or
   `{ arrow: { from: <label>, to: <label> } }` (a `nullable-id` also `null`). Targets name start
   objects only.
   - Every target must name exactly one live object of its type in the task's start state, **in
     every variant case** (the cases are finite; a world with a case where a target is ambiguous or
     missing is refused). Materialisation substitutes tokens in strings and target labels like state
     labels, adds the variant's layout offset to `x` and `y` parameters like start steps
     (`src/world/variant.ts:50-56`), and fixes each target's start object by its id beside the label,
     so host and checker fall back to the same object.
   - Validation also refuses an action the world does not define, parameters outside the contract
     and triggers that do not increase. The field is optional without a default: existing worlds
     keep their canonical JSON and content hash. It is part of the world's content hash and of the
     task identity (PADR-0044 decision 3 already includes it). Entries are data: action names from
     the world's own list and parameters, shown only as text.

2. **Trigger.** Entry *e* fires once the owner's counted changes reach `after_e`: right after the
   counted change that reaches it commits and before the reply to that change returns.
   - *The owner's counted changes* are PADR-0040's action count of the attempt — accepted act, undo,
     reset and editor gesture, and on a task with a schedule a new variant (decision 7) — made by
     anyone except the co-actor: the person in the Player and the agent over MCP alike. The count
     never goes down, survives undo, reset and a new variant, and starts at zero only when a task is
     opened. A refused request, a hint, a check and the co-actor's own changes add nothing. On a
     bench host, which has neither another task nor a variant (decision 7), the count is the agent's
     accepted act, undo and reset — exactly the records of its mutation log.
   - Since `after` strictly increases and a change adds one, at most one entry is due after any
     change. Entries fire in schedule order, each at most once per opening of the task.
   - *Fired, accepted, changed, kept.* An entry *fires* when its trigger is reached; it is *accepted*
     when its transaction commits; it *changed the board* when the state hash after it differs from
     the one before (an accepted change to the same value changes nothing); it is *kept* when its
     action is still in the final history. Only the end state is judged (decision 9); the four are
     reported (decisions 9 and 10).
   - *If the owner never reaches `after_e`,* entry *e* and every later one never fire. The run is
     judged like any other, and the report says that the colleague did not act, with the owner's
     count and the trigger it needed.
   - *Every passing run fired every entry* on an instance with a sound lower bound m on the length
     of every action sequence from the start to the goal (the colleague's actions are world actions
     like any other, so they are covered) and `after_e ≤ m − e` for the *e*-th entry, counted from 1:
     if entry *e* never fired, the final history holds at most `after_e − 1` owner actions (every
     surviving owner action was a counted change) and at most *e* − 1 colleague actions, at most
     m − 2 in all; and when entry *e* fires, the board holds at most m − 1 actions, so no entry
     fires on a board that already meets the goal. The bound says nothing about whether a correct
     agent reaches the trigger with useful work or whether the entry matters; the family's witness
     and selection rules see to that (decision 11). An author's own world may use any schedule.

3. **Everything is announced, to the Player and the agent alike** (architecture §10: both see the
   same task and the same goal).
   - The view gains `schedule` (the Player's task panel; `observe` compact and full): the owner's
     count `changes`, and per entry its `after`, its action as written (targets by label), a sentence
     the host generates from the entry with the history's action templates in EN and DE ("After your
     2nd change, a colleague adds the step “Check stock”."), and its status — `pending`, `done`
     with the step it landed at, or `refused` with its code. No world-authored text describes an
     entry, so an announcement cannot differ from what happens.
   - The goal states the final board, the colleague's changes included; the prompt says that a
     scripted colleague edits the board, that their changes stand, and what a reset discards.
   - A colleague's change is a history item with its actor (decision 4). The Player receives it as an
     event at once; the agent learns of it from its next `observe`, or from its next change or check,
     which is refused with `stale_base` naming the current step and revision. The reply to the
     owner's triggering change is unchanged ([PADR-0038](0038-lean-mcp-replies.md)): it describes
     the owner's own change.
   - Fixed project text, never world-authored: one sentence in the MCP server instructions (some
     tasks have a scripted colleague; `observe` shows when and what; after `stale_base`, observe
     again — an undo then would take back the colleague's change); the `undo` tool description says
     it takes back the most recent change, whoever made it.
   - **Predictable on purpose.** The measured skill is reaching the goal on a board that changes
     under the agent: noticing that it moved, reading it again, and finishing one's own part on the
     changed board, around a step the colleague added. What the family's instances guarantee, and
     no more (decision 11): a plan computed in advance that neither reads the board nor recomputes
     the ids the core assigns fails unless it removes the colleague's step, which the report shows
     (decision 9). A plan that models the colleague exactly can pass without reading the board — the
     reference does, and ids are deterministic (PADR-0004) — so "the agent read the board" is
     likely, not proven. Whether an announced colleague leaves headroom is what the pre-probe
     measures
     ([PADR-0041](0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md)
     decision 4); an unannounced variant needs its own record.
   - **What the schedule reveals.** The public triggers tell a reader that m ≥ `after_e` + *e*
     (decision 2), and the entries tell part of the goal, which is public anyway. The exact minimal
     length, which a bench host withholds (`src/bench/run.ts:336-338`), is not stated: the generator
     draws each trigger inside its allowed range (decision 11), so a reader learns a lower bound
     only.

4. **Actor.** A fourth, host-only kind `{ kind: 'co-actor'; entry: <index from 0> }`, shown as
   "Colleague (scripted)" (the German catalog text says scripted as well). No request can claim it:
   the HTTP actor schema stays `kind: 'agent'` only (`src/host/server.ts:95`), so a request naming
   `co-actor` is refused `invalid_request`; the MCP bridge always sends `agent`; nothing in an HTTP
   or MCP input names an entry or makes one fire. The bridge's strict view schema
   (`src/mcp/bridge.ts:73`) learns the kind and the `schedule` section. A refused colleague
   transaction emits no generic `rejected` event (the host emits one for every refused request
   today, `src/host/session.ts:282-284`); it changes only the entry's status in the view, published
   as a `changed` event at the same revision, so no surface presents it as someone's own refused
   request. An entry's status only moves forward — `pending` to `done` or `refused`, never back: the
   host's reply to the owner carries the statuses as they stand when it is sent, after the
   colleague's outcome, and the Player keeps a status it has shown when a view of the same revision
   says `pending` (it absorbs equal revisions, `src/player/main.ts:205`), so whichever of the event
   and the reply arrives last, a refusal never shows as `pending` again. The co-actor exists only on
   a task with a schedule and never shares a task with the demonstration (the bundled example has no
   schedule).

5. **One transaction per colleague change, under the owner's lock.** A due entry runs as its own
   transaction through the host's mutation path: a fork of the committed session, `Session.act` with
   the current step as `baseStep`, the candidate's full replay, the mirror's apply and read-back, and
   publication with its own revision and history item.
   - **Deadline (refines PADR-0022 C1).** C1 fixes one monotonic deadline from HTTP admission for the
     request's transaction. The owner's transaction keeps it. The colleague's transaction is
     host-initiated inside the same request and gets its own `HOST_TRANSACTION_MS` (5 s) deadline
     from its own start, checked as C1 requires (after the fork, between stages, before and after
     mirror work, immediately before an await-free commit); C2 holds for it (the lock stays held
     through a verified restore or a dispose). The request's bound is therefore
     2 × `HOST_TRANSACTION_MS` (10 s) plus the cleanup of a failed colleague transaction (mirror
     recovery, measured separately as PADR-0022 requires). C1's bridge-margin check is restated
     against that bound: `BRIDGE_DEADLINE_MS` (30 s, `src/mcp/bridge.ts:14`) must exceed it plus a
     measured response margin. The implementation measures the worst cleanup before it is accepted;
     if the check fails, the colleague's deadline is shortened — the bridge's is never raised for
     it. A bridge timeout still means "outcome unknown" and a re-observe. The demonstration is no
     precedent: its actions run outside any request.
   - **The owner's change stands.** When the colleague's transaction fails, the mirror is restored to
     the owner's committed board (C2), and the owner's reply still reports its own change as
     accepted; the colleague's failure appears only as the entry's status and record.
   - **The lock** is held from the owner's admission until the colleague's transaction has committed
     or been refused: no other change or check is admitted in between. A parallel request gets
     `session_busy`, as it does today during any transaction (`src/host/server.ts:303`); the
     built-in agents and the Player never send one (they await every reply,
     `src/bench/baselines.ts:44`, `src/player/main.ts:213`). Reads (`observe`, the Player's events)
     may see the owner's revision before the colleague's; both are committed.
   - In process, the owner's reply also lists the co-actor outcomes that followed it, in commit
     order, for the bench's recorder; the HTTP layer never serialises that list, so the wire shapes
     stay.

6. **Budget and limits.**
   - Co-actor changes count against no task limit, not against the bench's `--max-actions`, and not
     in the agent's counters (PADR-0044 decision 7). They never trigger an entry and are never
     refused for a used-up budget.
   - **No exemption for a stale refusal.** The agent's request refused with `stale_base` after a
     colleague change is an ordinary refused call: it uses one unit of the bench cap like any
     refused call (PADR-0044 decision 1, unchanged) and none of a task limit (PADR-0040 never counts
     a refusal). Instead, the family's preregistered cap is its base cap plus the number of entries
     of its largest schedule (decision 12). An own world's bench sets its own `--max-actions`.

7. **Undo, reset and a new variant.**
   - Linear undo stays: undo takes back the most recent change, whoever made it. An undo that
     removes the colleague's change is the agent's counted change; the colleague does not act again.
   - Reset returns to the task's start and discards the colleague's changes with the owner's; fired
     entries never fire again, and the count goes on. The goal still includes the colleague's
     changes, so after a reset the owner has to make them itself.
   - **A single-task (bench) host refuses every variant request**, not only one for another task as
     today (`src/host/session.ts:397`). This ships as its own small change, with a test, before the
     co-actor code, so a bench run's count and its log hold only the agent's act, undo and reset.
   - In the Player, a new variant counts like a reset on a task with a schedule, with or without
     limits (this refines PADR-0040 decision 4 and the rule at `src/host/session.ts:409` for such
     tasks); the schedule is materialised for the new variant; fired entries stay fired. Opening
     another task starts fresh counts and a fresh schedule state.

8. **Targets and refusals.**
   - **Resolution.** When entry *e* fires, each target resolves on the committed board: the one live
     object of its type that carries the target's label (a step), name (a frame) or end labels (an
     arrow whose both ends are live steps; an arrow with a loose end matches no label pair), if
     there is exactly one; otherwise — none or several — the start object fixed for the target at
     materialisation (decision 1), whatever its state now. The resolution never picks among
     candidates and never substitutes another object. The resolved action goes to the core like any
     other: if the agent renamed the start object, the colleague edits it under its new name; if the
     agent deleted it, the core refuses (`precondition_failed`). Nothing is invented (architecture
     §10, explicit unknowns).
   - **Two implementations.** The host resolves with its own pure function (no clock, no I/O); the
     checker resolves with its own implementation in `src/checker`, never the host's code
     (architecture §3 shares only canonical hashing and bounded predicate evaluation). Both are
     tested against hand-computed resolution vectors in `tests/oracles/`.
   - **Classified by stage, recorded by the host.** A refused colleague transaction is recorded with
     the stage at which it failed and the code. The stages, in the order of the mutation path
     (`src/host/session.ts:334-375`), and every code each can produce:

     | Stage | What fails | Codes | Class |
     |---|---|---|---|
     | `admission` | the colleague's guard: a session closed while the owner's request ran (its revision and step are current, it uses no budget, it holds the lock, its own deadline has just started) | `mirror_unavailable` | judged |
     | `core` | `Session.act` on the candidate returns a refusal (preconditions are evaluated with the bounded predicate evaluator) | `precondition_failed`, `invalid_argument`, `unmodeled`, `limit_exceeded`, `checker_fuel_exhausted`, `checker_invalid` | judged |
     | `view` | the candidate's error classes cannot be evaluated, or its view would exceed 3 MiB (`src/host/session.ts:238-262`) | `checker_fuel_exhausted`, `checker_invalid`, `result_too_large` | judged |
     | `replay` | the candidate's full replay differs from its history | `replay_mismatch` | infrastructure |
     | `mirror` | apply, read-back, snapshot, recovery or their diagnostics | `real_tool_disagrees`, `mirror_timeout`, `mirror_unavailable`, `diagnostic_limit`, `diagnostic_unavailable` | infrastructure |
     | `deadline` | the colleague's own deadline expired at any check after its admission, a cancelled replay included | `mirror_timeout` | infrastructure |

     The core can return no other code for a colleague action: `stale_base` needs a stale step,
     and the remaining values of the error vocabulary (`src/world/types.ts:93`) belong to the
     checker, the package reader, replay or the mirror. Any other pair of stage and code — an exception the
     host did not expect included — is a defect: the run is `infra_error` `co_actor_fault` with
     the stage `defect`, and `--verify` refuses the report (`bench_report_invalid`), so a defect is
     fixed, never scored.
   - **What the board decides is judged.** `admission`, `core` and `view` are decided by the board,
     the history and the task the owner and the world produced. The entry is recorded as refused
     (fired, not accepted); the colleague does nothing instead and never retries. The run is judged.
     Today the error-class evaluation throws a bare `Error` whose code is lost and the transaction
     reports `replay_mismatch` (`src/host/session.ts:240`, `:373`) — a defect that also mislabels the
     owner's own refusals; the implementation keeps the predicate's code and the stage `view`, with a
     test in which an error class exceeds the predicate budget only on the colleague's candidate.
   - **Only machinery after the colleague's admission is an infrastructure error.** `replay`,
     `mirror` and `deadline` mean an integrity check failed, the browser crashed or hung, the
     adapter and the model disagree on an action the core accepted, or time ran out — none of which
     the core's rules or the view's bounded checks derive from the board. The run is `infra_error`
     with the reason `co_actor_fault` (a new value of PADR-0044 decision 9's enumeration, added
     through the schema holder, as is the record's `stage`), never judged; it counts as not passed.
     The Player shows the entry refused with its code. `--verify` re-derives the stage (decision 10).
   - **Keeping agents from causing machinery faults, and reporting them.** A board the agent built
     could slow the mirror or a replay. The family bounds its boards like PADR-0040's stress boards
     (the goal plus one object per allowed action); before the first gate the implementation
     measures a colleague transaction on each stress board with the real mirror, as PADR-0022 C4
     measured long logs. A gate round's `co_actor_fault` runs are listed in its gate report with
     stage and code, and their share is compared with a threshold the declaration preregisters
     (decision 12) — a round is never void for them without that statement.

9. **The judging rule.** The verdict stays end-state only: the final board against the public goal,
   which states the board after the colleague's changes as content. A run fails exactly when the
   final board lacks something the goal states; neither the checker nor the verdict asks who made a
   change. Examples:
   - the agent **removed** an object the colleague edited or created → fails, unless the final
     board holds that content again;
   - the agent **replaced** it by an object equal in every attribute the goal states (label, shape,
     colours, frame, group, its arrows) → passes: the colleague's change is on the board;
   - the agent **undid or reverted** the colleague's change → fails, unless the final board holds the
     change again (an agent that undoes it for a while, or makes it again itself, passes);
   - the agent removed the target **before** the trigger → the colleague's change is refused
     (decision 8) and its content is missing → fails, unless the owner put that content on the
     board itself.

   **Paths that pass without keeping the colleague's changes**, named: (1) firing the entries early
   with changes that change nothing (an undo with nothing to undo, a reset of the start board, an
   act and its undo — each counted), then resetting or undoing the colleague's changes and solving
   the task alone; (2) undoing or reverting a colleague change and making it again. They pass, and
   they cost more: every colleague change that is not kept costs the owner at least one change to
   remove it (or a share of a reset) and one to make its content again, so a run that keeps none of
   n changes needs at least m + n counted changes — its final history holds at least m owner
   actions — against the reference's own length L_R (decision 11). They are not refused (see
   options); they are shown: with every passed run the report states "colleague's changes kept:
   k of a" (`actions − agentActions` against `coActor.accepted`, PADR-0044 decision 7) and, per
   accepted change, whether it changed the board. If more than 10 % of a round's passing ladder runs
   kept fewer changes than were accepted, the family gets a public action limit below m + n in a new
   generator version (re-assessment trigger).

   The report adds what the verdict leaves out: the trace (PADR-0039 A.3) evaluates every goal
   condition after every record, the colleague's included, so it names the colleague's record after
   which a condition was met and the agent's action after which it was last lost; each run lists its
   colleague outcomes (fired, accepted, changed the board, kept; refused with code; did not act).

10. **Recording, evidence and `--verify`.**
    - The agent's record is written first, then one record per co-actor outcome, consecutive, in
      commit order: from revision r, the owner's change is published at r + 1 and an accepted
      entry at r + 2. A co-actor record is an `act` with the resolved action (and its `baseStep`),
      `actor: "co-actor"`, `entry`, `client: null`, the outcome and code, and the step and revision
      afterwards (PADR-0044 decision 7). Its action is kept in full whatever the outcome — the cut of
      a refused agent action's strings does not apply; its size is bounded by the schedule's. It is
      never omitted; a co-actor run without its complete log is `infra_error`
      (`evidence_incomplete`).
    - **`verifySchedule`** (in `--verify`, `bench --recover` and the gate): materialise the schedule
      for the run's seed; replay every accepted record, the agent's and the co-actor's, with the
      checker's own transition code; count the agent's accepted act, undo and reset records. Where
      the count reaches `after_e`, the very next record must be entry *e*'s, its action equal to the
      checker's own resolution (decision 8) on the replayed board. Its stage and outcome are
      re-derived as far as the checker can, in the order of the stages:
      1. the checker's own transition code applies the resolved action — if it refuses, the record
         must be refused at `core` (a `core` refusal the checker would accept is a forged refusal);
      2. otherwise the task's error classes are evaluated on the successor with the bounded
         evaluator and the predicate budget the host uses, under the same check-limit rule
         (PADR-0040: none are evaluated while a check limit applies) — if that fails, the record
         must be refused at `view` with that code;
      3. otherwise the record is accepted, or refused at `admission`, at `view` with
         `result_too_large`, or at `replay`, `mirror` or `deadline`. These the checker cannot
         rebuild — it has no host view, no engine and no clock — so they are taken as the host
         recorded them, like the code of any refused agent call; the family's size bound rules out
         `result_too_large` on its instances (decision 11).

      A record at `replay`, `mirror` or `deadline` requires the run to be `infra_error`
      `co_actor_fault`, and such a run must hold one; any other pair of stage and code, and the
      stage `defect`, refuse. No co-actor record anywhere else, none for an entry twice or out of
      order, none for a trigger the replay never reaches, and `coActor` equal to the records. Each
      mismatch refuses (`bench_report_invalid`). So a run cannot be turned into an infrastructure
      error by a board the core or the error classes refuse; an infrastructure claim on a board both
      accept stays the host's statement.
    - **Bound to the judged session, with or without a trace.** For every judged co-actor run the
      replay's final history — every action and every step hash — and its final state hash must
      equal the judged session's (`session.json`), and the actors are assigned on exactly that
      history. This is checked whether or not `trace.json` exists; a valid schedule log combined
      with another valid session is refused.
    - `bench --recover` re-derives `coActor` from the log's co-actor records and runs
      `verifySchedule` on a judged run; a run whose log is incomplete stays `infra_error`
      (`evidence_incomplete`). The trace replays co-actor records like agent acts. The session file
      (`practonaut.session/1`) is unchanged and carries no actor; attribution lives in the mutation
      log and the host's history.

11. **The family, its references, baselines and near misses.**
    - **Two references.** P0 is from-scenes' plan from the start to the goal without the colleague;
      it witnesses m (PADR-0040 decision 5 proves it minimal; decision 2 needs only the lower
      bound). R is the interleaved reference: P0's work rearranged around the entries — owner steps
      that do not depend on an entry first, each entry after its `after_e`-th owner step, the steps
      that use an entry's effect after it. The oracle plays R; R's owner length L_R is the efficiency
      reference, labelled "reference length", never "minimal" (the proof covers P0, not the agent's
      part under interleaving).
    - **Triggers drawn, and witnessed.** Let I_e be the number of R's owner steps that do not depend
      on entries *e* … *n*. The family's seeded generator draws `after_e` uniformly from
      [`after_{e−1}` + 1, min(m − *e*, I_e)] (`after_0` = 0); an empty range redraws the draft, and
      R's replay must apply every entry on R's board. So a correct agent reaches every trigger with
      useful work, as R does, and never needs a change that changes nothing; and the public triggers
      reveal only a lower bound on m (decision 3). Entries name start objects only, so no entry waits
      for something the owner must make first; an entry is refused only when the owner made the
      board differ from R's in a way the core refuses, and the end-state rule then judges the run.
    - **Selection: a plan made in advance fails unless it removes the colleague's step.** A *blind
      plan* is any action sequence computed before the run from the start state, the goal and the
      published schedule, and played without reading the board: a stale step is resent with the
      step and revision the refusal names, a step the core refuses is skipped, and ids come only from
      the plan's own replies. It may model the colleague, but it never learns the id the core gives
      the colleague's new step: that id reaches an agent only through `observe` (a reply describes the
      owner's own change; a `stale_base` refusal names step and revision only), unless the plan
      recomputes the core's id function (`src/core/apply.ts:34-36`) from public data — possible,
      because ids are deterministic (PADR-0004), and excluded from the claim.
      - Every instance has at least one *qualifying entry*: an `add_step` whose new step the goal
        requires the owner to change — an arrow to or from it, or a shape, colour, label, frame or
        group the colleague did not give it — with the steps of R that make that change using
        `{ coActorCreated: e }`.
      - For a qualifying entry, every blind plan either removes the colleague's step (an undo, or a
        reset after the trigger; the report shows it, decision 9) or fails: (i) the colleague's
        `add_step` is always accepted on the family's worlds — it targets only a frame or none,
        frames cannot be deleted, and generated worlds have no rules and no preconditions
        (`src/authoring/from-scenes.ts:486-489`, `src/world/schema.ts:135`); (ii) if the step is
        kept, the goal's exact counts — from-scenes states the total of steps and the count of each
        signature for every goal — leave no room for a second step of the plan's own, so the change
        the goal requires must be made on the colleague's step; (iii) every action that changes a
        step or ends an arrow on it takes its id, which a blind plan does not have. A blind plan
        that does not model the colleague (P0, or any other solution of the task without the
        colleague) fails outright: it makes the step itself and leaves one step too many.
      - **The generator checks it per instance**: the structural conditions of (i)–(iii) — the
        qualifying entry's kind and frame target, no rules and no preconditions in the world, the
        exact count clauses, the dependent change in R — and, in the checker with the schedule
        applied, two blind replays that must fail: P0 played blind, and the own-copy replay (R with
        every use of `{ coActorCreated: e }` redirected to an equal step the owner makes itself, the
        colleague's step kept and untouched). An instance that misses any of them is redrawn.
      - Further entries may accompany a qualifying one: `connect`, `delete_step`, `rename_step`,
        `set_style`, `set_frame` and `reconnect_end`. Alone they prove nothing — a blind plan can
        pre-empt a deletion or a connection (deleting the target first gets the colleague's action
        refused) and is idempotent with a rename, restyle, re-frame or re-target — and the record
        claims nothing for them. `move_step` and `resize_step` are not used: a from-scenes goal
        states neither positions nor sizes of unchanged steps.

      Every entry changes a count or an attribute the goal states; schedules have 1–3 entries by
      difficulty.
    - **Size bound.** The generator checks, from the family's label bounds, that the view stays
      under 3 MiB on its stress boards with every colleague item, so `result_too_large` cannot occur
      on a family instance.
    - **Oracle.** Each reference step may be resent once after `stale_base`, after an `observe`; a
      second refusal of the same step ends the run as today. The oracle observes before
      `check_result`. A sidecar parameter `{ coActorCreated: e }` names the object entry *e* created,
      which the oracle takes from the board it observed after that entry fired (the one new live
      object it did not make). A rename never changes an id and the trigger is a count, so the oracle
      needs no new names and no timing.
    - **Random** is unchanged: it already observes after a refusal.
    - **Near misses.** A near miss of a task with a schedule is played with the schedule applied; a
      step that is refused or does not resolve is skipped, as an agent that moves on would, and the
      board after the last step is judged. They are from-scenes' (one step of R left out or altered)
      plus, for each entry *e*, the clobbers: (a) an `undo` right after *e* fires; (b) the inverse
      change right after it, where one action inverts it — rename, restyle, re-frame or reconnect
      back, delete the created step, disconnect the created arrow, add a step equal to the deleted
      one; (c) for a creation, the same object also made by the owner before the trigger (inserted;
      every later `{ created: k }` renumbered). Each clobber fails under the end-state rule: after
      (a) or (b) the final board is R's goal board with *e*'s effect reverted and the steps that
      relied on it skipped (for an added step that R uses through `{ coActorCreated: e }`, those
      steps no longer resolve), and the goal states *e*'s effect, which R never makes itself; after
      (c) the board holds one object more than the goal's exact count. Each is still replayed in the
      checker. A near miss that passes or applies nowhere redraws the draft — its code joins the
      generator's redraw list, so it never aborts the set.
    - **Sidecar.** Every task with a schedule has a `practonaut.task-oracle/2` sidecar: R, the near
      misses with an `undo` step kind, and `{ coActorCreated: e }`. Readers of `/1` refuse it.
    - The family is `challenge-human-edit` 1.0.0 (unit `human-edit.practonaut`; the title on every
      surface says "a scripted colleague edits mid-run"); its generator change fixes the details and
      versions them (PADR-0040 decision 2).

12. **Gate, compare, toolchains.** The family is gated on Practonaut's own actions only (PADR-0042
    decision 1). Its preregistered cap is its base cap, set with the generator as PADR-0040's
    families have one (`src/challenge/build.ts:31-34`), plus three, one per entry of its largest
    schedule. The gate re-verifies every held-out run with `verifySchedule`; `gate --preflight`
    additionally checks per instance the proven m, the trigger draws and their
    witness, the selection rule and the size bound, the oracle at 100 % with the mirror (which runs
    every colleague transaction of the held-out set through the real engine), random at most 5 %, and
    every near miss failing in a checker process with the checker's own trigger counting and
    resolution. The declaration preregisters a threshold for `co_actor_fault` runs (proposed: 1 %
    of the round's ladder runs, so a single run at 78 to 90 runs); above it the gate report names the
    colleague's machinery as the cause, lists every such run with its stage and code, and says
    whether PADR-0040's 5 % void rule applies — a round is never void for these runs without that
    statement. Everything else follows PADR-0040 and PADR-0042: pre-probe, held-out size, gate
    pair, budget and the outcomes "passes", "does not pass" or "admitted, not gated for budget".
    `compare` needs nothing new: the schedule is in the world's content hash and in the task
    identity, so reports with different schedules never pair; `co_actor_fault` runs are runs without
    a verdict (PADR-0039 C.2, C.3).

13. **What is measured, and what is not.** Measured: whether the agent (or a person in the Player)
    reaches the public goal while a scripted colleague makes announced changes. On the family's
    instances a plan made in advance that neither reads the board nor recomputes the core's ids
    fails unless it removes the colleague's step (decision 11), and the report marks a pass that did
    not keep it (decision 9). A plan that models the colleague and recomputes ids could pass without
    reading the board, so reading the board is likely, not proven. Reported beside the verdict,
    never in it: for each entry whether it fired, was accepted, changed the board and was kept. Not
    measured, and never claimed: collaboration with a real person; reacting to unannounced or
    adaptive changes (the colleague never responds to the agent); concurrent editing or merging (the
    colleague acts only between two of the owner's changes, atomically); preserving object identity;
    who made the final change; that the agent kept the colleague's change rather than redoing it.
    Reports and docs say "scripted colleague", never "human collaborator".

**Example** (a creation entry). Start: steps “Pack”, “Ship” and “Invoice” in frame “Shop”, arrows
Pack → Ship → Invoice. Goal: “Ship” renamed “Ship parcels”, “Invoice” filled green, and a new
step “Check stock” between “Pack” and “Ship parcels”. Without the colleague the goal needs m = 5
actions (add, rename, colour, re-target, connect). Schedule: one entry, adding “Check stock” in
“Shop”. R does the two independent steps first (rename, colour), so I_1 = 2 and `after` is drawn
from [1, min(4, 2)]; say 2. A run renames (1) and colours (2); the colleague's step is published
before the reply to change 2 returns; the agent's re-targeting, which names the revision of that
reply, is refused `stale_base` (an ordinary refusal); it observes, finds the new step, re-targets
(3), connects (4) and passes. The entry qualifies: the goal's two arrows end on the colleague's
step. An agent that plays P0 without reading the board adds a second “Check stock” and fails; a
plan made in advance that leaves the step to the colleague cannot draw the arrows to it without its
id. A run that undoes the colleague's step and adds one
itself passes and is shown "colleague's changes kept: 0 of 1". The clobbers — undo, delete the
step, or add it before change 2 — fail.

## Consequences

- **Code** (later changes, each with its tests): first the single-task variant refusal
  (`src/host/session.ts`); then `src/world/schema.ts`, `src/world/types.ts` and
  `src/world/variant.ts` (the field, the per-case validation, materialisation with fixed start ids)
  under the deterministic-core rules; the host's resolver and the checker's own (`src/checker`),
  with vectors in `tests/oracles/`; `src/host/protocol.ts` (the actor, the view's `schedule`),
  `src/host/session.ts` (due entries in the mutation path under one lock, uncounted, own deadline,
  no generic `rejected` event, statuses that only move forward; the stage of every refused colleague
  transaction, and the error-class evaluation keeping its code; variant counted like a reset; the
  in-process outcomes) and `src/host/server.ts` (the outcomes never serialised);
  `src/mcp/bridge.ts`, `src/mcp/replies.ts`, `src/mcp/contracts.ts` (view schema, compact view,
  fixed texts); `src/player/main.ts` — `mutate` announces the person's own change from the reply
  (`reply.value.view` at the owner's revision and `reply.value.delta.created`), not from
  `current.history.at(-1)` (`:226`), which may already be the colleague's item absorbed from an
  event; the colleague's change is announced separately as the colleague's, and its refusal only as
  the entry's status, never through `rejected` (`:869`); a status it has shown never goes back to
  `pending` — with the history chip and the schedule panel under design-language §13;
  `src/bench/run.ts` (record order, full co-actor actions with their stage, `co_actor_fault`),
  `src/bench/baselines.ts` (the oracle), `src/bench/world.ts` (sidecar `/2`), `src/bench/verify.ts`
  and the checker (`verifySchedule`, the session binding), `src/authoring/from-scenes.ts` (replay
  with the schedule, skip rule), `src/challenge/` (the family, P0 and R, the draws, the qualifying
  entry and the blind replays, size bound, redraw list, preflight, the `co_actor_fault` threshold in
  the declaration and the gate report). The schema parts go through PADR-0044's schema holder.
- **Docs**: `docs/world-format.md` (the field), `docs/session-host.md` (the actor, the lock, the
  deadline, the view), `docs/agent-guide.md` (the colleague, `stale_base`, undo),
  `docs/benchmarks/README.md` (the family, the cap, `co_actor_fault`, "kept"), the glossary
  ("scripted colleague"), the changelog.
- **Tests the implementation brings**, each failing without its mechanism, expected values from
  hand-built boards and logs:
  - the trigger after a k-th act, undo and reset, not after a refused change, a hint, a check or the
    colleague's own change, never again after a reset; a bench host refusing every variant;
  - the owner's reply returned after the colleague's commit; a request in between refused
    `session_busy`; a colleague transaction after a slow owner change committing within its own
    deadline; a mirror stand-in that refuses the colleague's write giving `co_actor_fault`, the
    mirror back on the owner's board and the owner's reply accepted;
  - an HTTP request claiming `co-actor` refused; resolution with one, none and two live matches, a
    tombstoned start object and an arrow with a loose end, host and checker against the same
    hand-computed vectors; ambiguity in one variant case refused;
  - each row of decision 8's stage table: a refusal at `admission`, `core` (including
    `checker_invalid` from a precondition that compares a label with a number once a label
    changes), and `view` (including an error class that exceeds the predicate budget only on the
    colleague's candidate) judged; `replay`, `mirror` and `deadline` (including a deadline that
    expires before any mirror call) giving `co_actor_fault`; an unexpected exception giving the
    stage `defect` and a refused report;
  - the record order and the trace; `--verify` refusing a missing, extra, late, repeated,
    wrong-action and forged-refusal record, an infrastructure stage claimed where the checker's code
    or the error classes refuse, any other pair of stage and code, and a valid schedule log
    combined with another valid session (without a trace);
  - the four examples of decision 9, a temporary undo with full restoration passing, a run that never
    reached the trigger, and the kept count;
  - on qualifying instances both blind replays failing (P0 played blind, the own-copy replay) and a
    blind plan that undoes the colleague's step passing with "kept: 0 of 1"; an instance with only a
    rename, a delete or a connection not emitted; draws inside their range with a witness;
  - the oracle passing on consecutive triggers, random and every near miss failing under the
    schedule, including an add-step entry that R uses through `{ coActorCreated: e }` with all
    three clobbers failing and the instance written;
  - the Player announcing its own change when the colleague's event arrives before the reply, and
    keeping a refused status when a reply of the same revision says `pending` (e2e, axe).
- The acceptance line of item 4 is measured by the oracle, random and near-miss tests above, the
  removed-object example of decision 9, and the family's gate report — "passes", "does not pass" or
  "admitted, not gated for budget".
- A triggering change takes two transactions; the owner waits about twice as long for that one
  reply (median host processing per change with the mirror is 31 ms, PADR-0037).
- PADR-0022 C1 is refined for a host-initiated transaction inside a request; PADR-0040 decision 4
  gains one rule for tasks with a schedule; PADR-0044 decision 9 gains one failure reason. PADR-0044
  decision 1 (what the cap counts) is unchanged.

## Re-assessment triggers

A passing run in which an entry did not fire (decision 2's bound is wrong); `co_actor_fault` above
the preregistered threshold; more than 10 % of a round's passing ladder runs keeping fewer
colleague changes than were accepted; a measured cleanup that breaks the bridge-margin check; a
passing run that kept every colleague step and, by its call log, never observed after the trigger
(it recomputed ids, or decision 11's argument is wrong); the pre-probe
outside 10–80 % because the announced colleague is too easy to work around; a request for an
unannounced, randomised or adaptive colleague, for one that acts on reads or on time, or for one
that targets objects created during the run; a goal that must judge object identity or who acted; a
second application whose mirror cannot carry two transactions inside one request's bound.

## Review (2026-10-18)

Three independent reviews of the first draft: a two-lens Claude Opus review (invariants, measurement
validity) whose findings each had a skeptic's check (ids `invariants-…`, `validity-…`; severity
after the check in brackets where it changed), OpenAI Codex `gpt-6.1-sol` (`codex-1` … `codex-6`,
its gaps and pre-mortem) and Google `gemini-3.8-flash` (`gemini-1` … `gemini-6`, its gaps and
pre-mortem). The coordinator decided the points where they converge (A: nothing an agent can cause
is an infrastructure error; B: a bench host refuses every variant; C: end-state judging, selection
criterion, clobbers, loops, causal preconditions; D: the deadline; E: no free stale refusal; F:
session binding and the checker's own resolver; G: triggers drawn; H: Player attribution); this
revision applies them.

| Finding | Disposition | Where, or why not |
|---|---|---|
| invariants-1 [minor] | adopted | D7: a single-task host refuses every variant, as a separate change first; D2: on a bench host the count is the agent's act, undo and reset (coordinator B) |
| invariants-2 [minor] | adopted | D8: `result_too_large` judged with every refusal that follows from the board; D11: size bound (coordinator A) |
| invariants-3 [minor] | adopted | Status line and D5: PADR-0022 C1 refined, per-request bound, bridge margin restated, demonstration precedent dropped (coordinator D) |
| invariants-4 [minor] | adopted | D4: no generic `rejected` event for a colleague refusal; Consequences: `src/player/main.ts` announces its own change from the reply; e2e with the event before the reply (coordinator H) |
| invariants-5 [minor] | adopted | D11: triggers drawn inside their range; D3: the remaining lower-bound leak stated (coordinator G) |
| invariants-6 [minor] | adopted | D8, D10: the checker's own resolver; hand-computed vectors (coordinator F) |
| invariants, nothing found | confirmed | Host-only actor, determinism, the bound, PADR-0037, record order, explicit unknowns, undo and reset counting, hidden data and the variant refinement stand; the note on the free refusal is moot (D6) |
| validity-1 [minor] | adopted | D9: an undo or revert fails only when the end state lacks the change; D3 and D13 no longer claim a decision not to revert is measured; the Example is now a creation case (coordinator C) |
| validity-2 [minor] | adopted with change | D9: the paths named, their cost (at least m + n), "kept k of a" with every pass, a public limit by re-assessment trigger. Not counting an empty undo is not adopted: a reset of the start board and an act with its undo advance the count as well (skeptic's check) |
| validity-3 [major] | adopted | D11: the selection rule (ignoring replay of P0 fails), the edit kinds and why; the Example names its difficulty |
| validity-4 [major] | adopted | D11: near-miss replay with skips, the three clobbers and why each fails, renumbering, redraw instead of an abort; a test with an add-step entry used through `{ coActorCreated: e }` |
| validity-5 [minor] | adopted | D11: resend once per step; observe before `check_result` |
| validity-6 [minor] | adopted | D11: every scheduled task's sidecar is `/2`, with an `undo` step kind |
| validity-7 [minor] | adopted | D1: exactly one start object per target in every variant case; the start object fixed by id at materialisation |
| validity, nothing found | confirmed | The bound (`after_e ≤ m − e + 1` would suffice for its first claim; kept for the second), m proven for single-variant instances, no double firing, random ≤ 5 %, from-scenes' near misses stand; the note on the free refusal is moot (D6) |
| codex-1 (major) | adopted with change | D2: fired, accepted, changed, kept; D9: the paths and the kept count; D11: the selection rule excludes the delete-before and idempotent instances Codex constructs; D13: the claim limited to the public goal under an announced schedule |
| codex-2 (major) | adopted | D8: closed lists; `checker_fuel_exhausted` and `result_too_large` judged (coordinator A) |
| codex-3 (major) | adopted | D5: C1 refined, bound with cleanup, the owner's change stands and is reported accepted when the colleague's transaction fails; tests (coordinator D) |
| codex-4 (major) | adopted | D6: no exemption; the family's cap plus one per entry; PADR-0044 decision 1 unchanged (coordinator E) |
| codex-5 (major) | adopted | D10: the replayed history and hashes equal `session.json`, with or without a trace; negative test (coordinator F) |
| codex-6 (minor) | adopted | D9: fails only when the end state lacks the change; positive test of a temporary undo with full restoration |
| codex gap: the bound | adopted | D2: "fired" is neither "accepted" nor "changed the board" |
| codex gap: m | adopted | D11: P0 witnesses m, R is a separate reference; D2 needs only a sound lower bound |
| codex gap: invariants | confirmed | No change needed |
| codex gap: recorder | adopted | D10: a co-actor action is kept in full whatever the outcome |
| codex gap: consistency | adopted | D6 removes the budget exception, so PADR-0044 decision 1 holds as written |
| codex gap: scope | noted | A static review; the implementation's tests carry the measurements |
| codex pre-mortem | adopted | Its four scenarios are codex-1, codex-2, codex-3 and codex-5 |
| gemini-1 (blocker) | adopted with change | D11: R witnesses `after_e` useful steps before entry *e*, every entry applies on R's board, so no change that changes nothing is needed. Refuted in part: the counting proof itself holds (Codex and the Opus skeptic confirm it); it states which passing runs fired, not reachability, which the witness now covers |
| gemini-2 (blocker) | adopted with change | D8: refusals that follow from the board are judged; `co_actor_fault` only for the closed machinery list; stress-board mirror measurement and the 1 % trigger. The proposed health heuristic is not adopted: a fixed code list can be checked by `--verify`, a health snapshot cannot |
| gemini-3 (major) | adopted with change | The free refusal is dropped (D6); the counting it describes no longer exists |
| gemini-4 (major) | refuted; one clarification adopted | No deadlock: the lock ends with the request, inside D5's bound; `src/host/server.ts:303` already refuses a second write during any transaction; the built-in agents await every call (`src/bench/baselines.ts:44`, `:49`, `:99`) and the Player returns while `working` (`src/player/main.ts:213`). D5 now names `session_busy` for parallel calls. A bridge backoff is not adopted: the bridge forwards host replies unchanged (PADR-0038) |
| gemini-5 (minor) | adopted with change | D3: the MCP instructions and the `undo` description say an undo takes back the colleague's change. "Unsolvable" refuted: under D9 the agent can make the change again itself |
| gemini-6 (minor) | adopted | D8: an arrow with a loose end matches no label pair and falls back to its fixed start object |
| gemini gap 1 | refuted | By design: entries name start objects only (D1), so every target has a fixed fallback; a colleague that targets objects created during the run is a re-assessment trigger |
| gemini gap 2 | adopted with change | D11: resend per step, observe before the check. Refuted in part: a rename never changes an id (`src/core/apply.ts:169`) and the trigger is a count, so the reference needs no new names and no timing |
| gemini gap 3 | adopted | D10: `bench --recover` re-derives `coActor` from the log's co-actor records and runs `verifySchedule` |
| gemini pre-mortem | adopted | Its scenarios are gemini-2 (void round), validity-4 and gemini-1 (oracle blocked) |

Counts over the 38 rows: adopted 25, adopted with change 7 (three of them with a part refuted:
gemini-1, gemini-5, gemini gap 2), confirmed 3, noted 1, refuted 1, refuted with one clarification
adopted 1.

## Re-review (2026-10-18)

Codex `gpt-6.1-sol` re-reviewed the revision (`codex-r1` … `codex-r4`, its confirmations and gaps).
It confirmed the deadline refinement, the session binding, the dropped stale-refusal quota,
reachability with the end-state rule, and the refutations of gemini-4 and gemini gap 1. The
coordinator decided the four open points (1: classify by stage; 2: sweep the codes; 3: a fixed plan
made from the start state and the public schedule; 4: the Player rule); this revision applies them.

| Finding | Disposition | Where, or why not |
|---|---|---|
| codex-r1 (major) | adopted | D8: a refused colleague transaction is classified by its stage, recorded by the host with the code; `admission`, `core` and `view` judged, only `replay`, `mirror` and `deadline` after the colleague's own admission are infrastructure; the view-stage defect (`src/host/session.ts:240`, `:373`) fixed, with Codex's boundary case as a test. D10: `--verify` re-derives the `core` and `view` stages with the checker's own transition code and the bounded evaluator, so a board-decided failure cannot pass as infrastructure. D12: a preregistered threshold, every fault listed with stage and code, never a void without that statement (coordinator 1) |
| codex-r1 gap: no proof that agents cannot cause infrastructure faults | adopted with change | The stage rule removes every board-decided route (core, error classes, size). A slow mirror or replay caused by a large board remains possible in principle; bounded boards, the stress-board measurement and the threshold report cover it, and the record claims no proof of exclusion |
| codex-r2 (major) | adopted | D8: `checker_invalid` judged at `core` and `view`; the codes swept per stage from the code (`src/core/apply.ts`, `src/predicate/index.ts`, the error vocabulary `src/world/types.ts:93`); `stale_base` shown unreachable; any other pair, and an unexpected exception as the stage `defect`, refused by `--verify` (coordinator 2) |
| codex-r3 (major) | adopted with change | D11: a blind plan — computed in advance from the start state, the goal and the published schedule, played without reading the board — fails on every instance unless it removes the colleague's step, which the report shows; the argument rests on a qualifying `add_step` entry whose step the goal requires the owner to change; the generator checks the structural conditions and two blind replays per instance. The unqualified form cannot hold: the reference R is itself such a plan once the colleague's id is recomputed (ids are deterministic, PADR-0004), and an undo after the trigger needs no id; D3 and D13 now claim only this. Codex's example (a lone deletion pre-empted by deleting first) no longer qualifies (coordinator 3) |
| codex-r4 (minor) | adopted | D4: statuses only move forward; the reply carries the statuses as they stand when it is sent; the Player keeps a shown status against a same-revision `pending`; e2e test (coordinator 4) |
| codex re-review: confirmations | confirmed | Deadline refinement, session binding, budget without a quota, reachability and the end-state rule, and the gemini-4 and gemini gap 1 refutations stand; no change |
| codex re-review gap: a design is not an implementation | noted | `verifySchedule`, the generator and the tests come with the implementing changes (Consequences) |
| codex re-review gap: scope | noted | A static review with isolated probes; the implementation's tests carry the measurements |

Counts over the 8 rows: adopted 3, adopted with change 2, confirmed 1, noted 2.

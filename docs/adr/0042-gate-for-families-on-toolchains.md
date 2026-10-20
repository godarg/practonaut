# PADR-0042 — The 0.3.0 gate: families on toolchains, a vendor-neutral ladder, a pre-probe and its own budget

Status: accepted 2026-10-19 with the change that implements it (P1, issue #44), with the amendment
at the end · Date: 2026-10-18 · Amends the gate preregistration of
[PADR-0040](0040-challenge-tier-generated-families-and-gate.md) for rounds of 0.3.0; PADR-0040
stays binding for everything this record does not change · Implements maintainer decisions D1, D2
and D4 of 2026-10-17 (maintainer approval of the non-Claude ladder agents in the sense of
PADR-0040's `--maintainer-approved`) · Reviewed before drafting the code by a fresh Claude reader,
OpenAI Codex `gpt-6.1-sol` and Google `gemini-3.8-flash` (plan pull request); to be accepted with
the pull request that changes `src/challenge/` and `tools/challenge.ts`, after a review of that
code and before any 0.3.0 model run

## Context

[PADR-0041](0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md) moves the
search for headroom to families on toolchains (Practonaut's own actions, or a foreign MCP server
judged in artifact mode) and to new family types, each behind a pre-probe. The maintainer widened
the ladder beyond Claude (D2) and gave 0.3.0 its own budget (D4): at most 800 subscription model
runs; per unit and round at most 100, written as **(held-out + pre-probe) × subscription agents ≤
100**; at most three subscription agents per gate round, local models in addition; at most two
rounds per unit.

The 0.2.0 gate tool cannot run such a round. Its sizes are schema literals (9 development runs, 26
held-out instances, 87 runs per round), its release count is "35 plus every earlier round committed
in the same folder" with a budget of 500 (the five committed 0.2.0 rounds already count 470), its
model check accepts only `claude-(opus|sonnet|haiku)` through `claude-code`, it requires exactly
three agents, one API key source and one Claude Code release line, it attributes spent runs through
Claude's own `system/init` line, and its void rule counts infrastructure errors over every ladder
agent (`src/challenge/declaration.ts`, `gate.ts`, `files.ts`). Vision §6 principle 2 requires a
ladder of **at least three agents**.

Three facts from the plan review shape the design:

- **D4's formula is binding as written** (confirmed by the maintainer's delegation of 2026-10-18).
  With three subscription agents it allows held-out + pre-probe ≤ 33 (26 + 7, 24 + 9); with two,
  ≤ 50. A pre-probe of 10 instances with three subscription agents breaks it at every held-out size
  ≥ 24, whoever runs the pre-probe.
- **Only Claude Code attests its model today.** Codex CLI and opencode report no model id in their
  streams; Gemini CLI no longer serves personal accounts (since 2026-06-18). After the terms check
  of 2026-10-18 the project's own Claude runs use an API key under Anthropic's Commercial Terms with
  a fixed credit limit, it makes no Codex runs through a ChatGPT subscription in 0.3.0, and Gemini
  moves to 0.4.0.
- **Without an operating-system sandbox, an agent with shell or file tools can reach hidden data
  by routes a decoy file does not cover:** regenerate an instance and its oracle from `generatedBy`
  and the generator the npm package ships (`dist/challenge/`), read the library's reference
  solutions in the installed package, read finished bench folders (the oracle baseline's session is
  the reference), or call `practonaut check` as an unlimited oracle.

Exact power of the gate (McNemar at α = 0.05, the 20-point rule and the headroom band of the
held-out size; independent per-instance outcomes, computed exactly): strongest 0.5 against weakest
0.2 — 0.50 / 0.54 / 0.59 at 26 / 28 / 30 instances; 0.6 against 0.2 — 0.75 / 0.80 / 0.84; 0.7
against 0.4 — 0.32 / 0.40 / 0.48 (the headroom band costs most here). The pre-probe admits a unit
with true strongest rate p with probability (k = 10, admit at 1–8): p = 0.5: 0.99, 0.8: 0.62, 0.9:
0.26, 0.95: 0.09; with an edge extension (10 more instances when 1 or 8 of 10 pass, then admit at
2–16 of 20; 10.5–13.9 runs expected): 0.99, 0.51, 0.12, 0.02. A family that does not pass is not
shown to be equal; a gate round without a true difference passes with probability 0.005–0.013.

## Options considered

**Who runs the pre-probe.** (1) Every subscription agent — under D4's formula 3 × (H + k) ≤ 100,
which leaves k ≤ 7 at 26 held-out; the order check it adds was never acted on in 0.2.0. (2) The
strongest configuration only (chosen; D1's wording; all three reviewers).

**Ladder shape under the formula.** (A) Two subscription agents (the gate pair) plus at least one
local agent: (H + k) × 2 ≤ 100 allows 30 held-out with a pre-probe of up to 20. (B) Three
subscription agents: 26 held-out with a pre-probe of 7 (admit at 1–5, an effective upper bound of
71 %). (C) Three subscription agents and a "runs spent" reading (28 + 10 = 94 runs): not admissible,
the formula applies as written.

**Gate pair.** (1) Within one vendor whose capability order is known, both models attested by the
client (Opus and Haiku through Claude Code; chosen). (2) Across vendors by an external ranking —
none measures these tasks, and an inverted pair almost surely fails a family that discriminates.
(3) Against a local model as the weakest — turns the gate into a headroom test.

**A second round.** (1) As in PADR-0040, at α = 0.05 again — two chances at the nominal level.
(2) Allowed only with a Bonferroni-corrected α = 0.025 (chosen). (3) No second round.

## Decision

1. **Unit.** A unit is a family on a toolchain, written `<family>.<toolchain>` (for example
   `repair.excalidraw-mcp-0.3.2`, `layout.practonaut`), part of every file name, world id and
   held-out seed derivation. Families that rely on limits only Practonaut's host enforces
   (`limited-checks`, `tight-budget`) and the co-actor family are refused on foreign toolchains.
2. **Preregistered units.** At most ten, named before the first pre-probe:
   `layout.practonaut`, `human-edit.practonaut`, `repair`, `injection`, `long-horizon` and
   `layout` on `excalidraw-mcp-0.3.2` and on the pinned draw.io MCP server (those four only if its
   local state is readable). Another unit needs the maintainer.
3. **Declaration `/2`** names the release (`0.3.0`), the unit, the round, the pre-probe record, the
   ladder with each agent's client, requested model, attestation and billing (subscription or
   local), and the sizes. `/1` declarations stay readable as 0.2.0 rounds and are never counted.
4. **Release budget and its guard.** 0.3.0 counts every subscription model run made for the project
   from zero, at most 800 — gate runs, pre-probes, red-team runs, example runs, acceptance runs and
   development runs (a client started for a fixture or a parser counts, inside `bench` or not).
   Every such run first takes an entry in a local append-only, hash-chained ledger under `.local/`;
   a start that would pass 800 is refused before the client starts, with a named error. The
   committed release ledger is written from the local one; `declare` and `gate` refuse when the
   local ledger has entries the committed one lacks. Runs of local models and of the built-in
   agents are listed, not counted. Whether a run the client refused before any model work counts
   (PADR-0040's exception) is decided per client by its parser; an unknown answer counts.
5. **Ladder.** At least three agents, the gate pair first and last. Shape A: the gate pair plus at
   least one local agent that passes at least 1 of the pre-probe instances (run free); shape B: three
   subscription agents. Shape A applies when such a local agent exists, otherwise shape B; the
   declaration says which. Subscription agents beyond the pair: Claude Sonnet, or another vendor's
   model only through a preset whose tools are structurally limited to the round's MCP tools,
   evidenced in every run's own stream, with its model attested by its client. An agent with shell
   or file tools that cannot be removed runs as "template: not restricted" outside the gate in
   0.3.0 (no red-team run can show the absence of every route listed above without a sandbox).
   Local agents run through an external agent CLI configured for a loopback endpoint only; a run
   whose client output does not name that endpoint counts as a subscription run and is refused;
   Practonaut never calls the endpoint itself.
6. **Gate pair.** Opus (strongest) and Haiku (weakest) through `claude-code`, models read from the
   client's `system/init`. Other agents are reported by client and requested model, labelled "not
   attested" where the client reports none, never ranked and never pooled with the pair.
7. **Pre-probe.** The strongest agent on 10 development instances (seeds 1–999), one run each, with
   the round's settings: 2–7 passes admit, 0 or 9–10 refuse; at 1 or 8, ten more instances, then
   2–16 of 20 admit (shape A). Shape B: 7 instances, 1–5 admit, no extension. The record is
   committed whether the unit is admitted or not and counts against the release; it counts against
   the round only when the round follows from it. A refused unit may be retuned once — a new
   generator version — and pre-probed again on new seeds. Its runs are the round's development runs:
   digested in the declaration, they fix the held-out seeds. Pre-probe pass rates are a selection
   step and are not reported as estimates of ability.
8. **Admitted, funded, deferred.** An admitted unit is funded in the order of admission while the
   release budget allows a round and still leaves 40 runs; two funded rounds are kept for units on
   foreign toolchains until four weeks after artifact mode is accepted. An admitted unit that is
   not funded is reported "admitted, not gated for budget" — never as not passing.
9. **Round size.** Shape A: 30 held-out instances (with a 20-instance pre-probe: (30 + 20) × 2 =
   100; spent at most 20 + 60 = 80). Shape B: 26 held-out with a 7-instance pre-probe ((26 + 7) × 3 =
   99; spent 7 + 78 = 85). The tools refuse fewer than 24 held-out instances, more than three
   subscription agents, fewer than three agents and a round whose formula exceeds 100.
10. **Void rule** counts infrastructure errors, missing and unattested runs over the gate pair and
    the agents the declaration names as ladder; further agents are reported separately.
11. **A second round** of a unit uses new held-out instances and decides at α = 0.025; both rounds
    are reported.
12. **Clients.** Every client is pinned for a round (a copy of one version first in `PATH`); per
    client, a patch update is listed in the gate report, another minor or major version refuses the
    round. Prompt equality applies per unit, API key source equality per client.
13. **Unchanged from PADR-0040:** headroom 10–80 %, discrimination ≥ 20 points with exact McNemar,
    oracle 100 %, random ≤ 5 %, every near miss fails, more than 5 % infrastructure errors voids the
    round, a second round only on new held-out instances.

## Consequences

- `src/challenge/` and `tools/challenge.ts` change after the bench/3 frame and before any 0.3.0 model
  run; the gate learns artifact-mode units (baselines through the foreign server) and co-actor units
  (`verifySchedule`) in their own later changes. The integration test of a whole round without a
  language model covers shapes A and B with stand-ins and shows that the committed 0.2.0 rounds are
  not counted and that a start past 800 is refused.
- Gate reports and ledgers of 0.3.0 go to `docs/benchmarks/challenge/0.3.0/`.
- Comparisons of toolchains or vendors on identical instances are separate reports with their own
  budget line, never gates and never pooled across verdict levels.

## Re-assessment triggers

A local agent becomes available (shape A replaces shape B); more than half
of the funded units fail on headroom; a vendor's terms forbid automated runs through its
subscription; a client stops reporting its model; the budget runs out before the preregistered
units are pre-probed.

## Amendment on acceptance (2026-10-19, P1; revised 2026-10-20 after the review of PR #71)

Accepted with the change that implements it (`src/challenge/`, `tools/challenge.ts`, the start guard
in the bench runner). Each point says what changes and why; everything else above stands. The review
of the implementation (an Opus workflow with a skeptic per finding, and Codex) found four major and
thirteen minor gaps; the points marked *(review)* close them.

1. **Shape B only in 0.3.0** ([PADR-0046](0046-vendor-neutral-presets.md) decision 7). No agent
   other than Claude through `claude-code` is gate-eligible in 0.3.0, so shape A is unreachable. The
   tools implement shape B: a pre-probe of Opus on 7 development instances (1–5 passes admit, no
   extension) and 26 held-out instances run by Opus, Sonnet and Haiku through `claude-code`
   ((26 + 7) × 3 = 99 ≤ 100; 7 + 78 = 85 runs planned). A declaration in shape A is refused by name
   (`shape_a_refused`), and so is a ladder agent through any other preset (`ladder_preset_refused`:
   `codex`, `codex-oss`, `opencode-local` or a name the tools do not know) or with a `local` billing
   class. Decision 5's shape A, decision 7's 10-instance pre-probe with its edge extension and
   decision 9's 30-instance round stay in this record for a later release. The general refusals of
   decision 9 (fewer than 24 held-out instances, more than three subscription agents, fewer than three
   agents, a formula above 100) are checked before the shape-B sizes, each with its own code.
2. **[PADR-0044](0044-bench-report-v3.md) decision 8**, amending decisions 3, 4 and 7:
   - *A probe plan, pushed before the first run.* `<unit>-round-<k>.probe-<p>.plan.json` names the
     unit, the verdict level, the toolchain pin (at session level the Practonaut version; at artifact
     level the server version, its archive SHA-256 and the reading-rules version), generator and
     difficulty, the pre-probe agent and its seeds, and the bench settings. The pre-probe set is
     generated only from a committed and pushed plan, the start guard refuses a pre-probe start
     without one, and every pre-probe start entry names the plan's canonical SHA-256. The declaration
     repeats the plan's values.
   - *Two ledger records per run, both appended.* The start entry before the client starts; one
     run-end record per start entry, appended by the runner that took the start, never by `bench
     --recover`. A run without its run-end record counts and is never digested or scored. Its task
     may be benched again only when its run folder holds no verdict *(review: the verdict is on disk
     before the record is appended, so a run whose record is lost could otherwise be re-rolled)*: a
     judged run whose record is lost, or whose folder is gone, is void — not passed, counted toward
     the void rule, never benched again. This amends decision 8's "its task may be benched again" for
     judged runs.
   - *Read only once pushed.* `declare` and `gate` read a pre-probe or held-out run only when the
     committed release ledger holding both its records is committed, unchanged and contained in a
     remote-tracking branch, and refuse a run whose report binds other hashes (`session.json`,
     `agent.stdout`, `checker.json`), status, failure, toolchain or rules version than its records.
   - *Every committed version of the release ledger is a prefix of the current one*; `probe`,
     `declare` and `gate` check it over the whole history of HEAD and of every remote-tracking branch,
     without history simplification *(review: a merge resolved to one side, a squash or an unmerged
     pushed branch would otherwise hide a version)*, and the gate report lists the versions.
   - *The start guard reserves*: every start counts until its run-end record releases it.
3. **Changes the implementation forces.**
   1. *Where the guard runs, and what it cannot see* *(review)*. In the bench runner, reached through
      `node tools/challenge.ts bench --purpose <p> … -- <bench arguments>`. `practonaut bench` takes
      no release ledger: the ledger is the project's, the command is everyone's. The guard sees every
      client start of a bench run through the tool. It cannot see (a) `practonaut bench` run directly,
      (b) a client started by hand or by another program (a `claude -p` to record a parser fixture, a
      red-team probe outside bench), (c) the stand-ins of the test suites, which are not model runs.
      (a) is caught for a round's instances: `probe`, `declare` and `gate` refuse a round when a
      model-run folder of its tasks under the bench roots has no start entry (`run_outside_ledger`),
      and `ledger init` refuses while any such folder exists. (b) cannot be seen by Practonaut: in
      0.3.0 the project makes no client start outside bench — a fixture, example, acceptance or
      red-team run is a bench run through the guard — so decision 4's "inside bench or not" reads
      "through the guarded bench".
   2. *Built-in agents take no entry.* They start no client, and PADR-0044's records have no billing
      class for them; the gate report lists their runs as not counted.
   3. *The start entry also names* the purpose (`pre-probe`, `held-out`, `development`, `example`,
      `acceptance`, `red-team`), the round, the plan or declaration it serves (`basis`), the requested
      model, the bench folder and the run, and the content hash of the world the run benches.
   4. *The run-end record also carries* the run's status, its `failure` (reason, parser, code,
      `beforeModelWork`), Practonaut's own host-call counts and the client's token total, so that the
      budget exemption is decided from the record's structure; the gate re-derives the failure from the
      bound stdout for the round's runs and refuses a record that differs.
   5. *An exempt run-end record releases the reservation*, as a run-end with both classes `local`,
      `client-attested`, does: the maintainer's D4 exempts such runs from the 800, and the guard, the
      declaration and the gate use one count. Exempt only when the failure is `usage_limit` or `auth`,
      before model work, read by a shipped parser, with no host call beyond the bridge's start-up read
      and no tokens (PADR-0044 decision 9).
   6. *One local ledger per repository* *(review)*: in the git common directory
      (`<git common dir>/practonaut/release-ledger-0.3.0.jsonl`), so every worktree and checkout of
      the repository shares one file and one lock, and a second worktree cannot count to 800 again.
      It is created only by `ledger init`, which copies the committed one and refuses while model-run
      folders exist that no start entry names; the guard refuses a start when the committed ledger is
      not a prefix of the local one (`ledger_diverged`) and when there is no local ledger
      (`ledger_missing`). The cap is the release's 800: a ledger whose header names another cap or
      release is refused *(review)*.
   7. *Round records.* `probe` registers its outcome (`admitted` or `refused`, with the plan, the
      record and the pre-probe world) and `declare` its declaration (with its hash, its held-out world
      and the held-out runs it plans) in the ledger, which is shared by every branch. A pre-probe is
      recorded once (`probe_recorded`); `declare` needs the admission registered and `gate` both
      registrations (`probe_unrecorded`, `declaration_unrecorded`).
   8. *Every run on a round's instances belongs to the round* *(review: Codex's counterexample and
      the re-declaration finding)*. A start belongs to a unit's round when it names the unit and round,
      or when it benches a world one of the round's starts or registrations names — whatever its
      purpose, plan or declaration. All of them count against the round's 100 runs and are named in
      the gate report, and all of them are in one repeat check per model and task: every run but the
      last ended unjudged, and the last judged run is a run of the round's purpose and plan or
      declaration that the gate was given (`best_of_n`, `run_not_given`). A held-out run under
      another declaration of the round refuses it (`round_redeclared`), and `declare` refuses to
      declare a round again once its held-out runs started.
   9. *The pre-probe belongs to its round.* Its record is `<unit>-round-<k>.probe-<p>.json`; a retune
      is probe 2 of the same round, with a newer generator version and seeds disjoint from probe 1's,
      once per unit. A pre-probe under another plan of the round is refused unless that plan's
      pre-probe was registered as refused (`probe_replanned`) *(review)*, and the pre-probe runs of
      every plan of the round count against it — not only the probe the declaration follows from.
   10. *Funding from the ledger* *(review)*. A unit is funded when the release count, the round's 78
      held-out runs, what is reserved and 40 runs fit into 800. Reserved, from the round records of the
      shared ledger (not from a branch's working tree): for every other declared round, the held-out
      runs it has not started; for every other unit admitted before this one and not declared, its 78;
      for a unit on Practonaut's own actions while artifact mode is not accepted, two foreign rounds
      (2 × 99) less those declared. The gate re-derives `before` and `reserved` from the ledger prefix
      the declaration counted (`budget_mismatch`). An admitted unit that is not funded is refused at
      `declare` with "admitted, not gated for budget".
   11. *Units.* A unit outside the preregistered list needs `--maintainer-approved-unit <unit>`; the
      plan and the declaration record the approved unit's id, and an approval of another unit is
      refused (`unit_approval_mismatch`) *(review)*. A unit on a foreign toolchain is refused until
      artifact mode ships its toolchain definitions (`toolchain_unavailable`); the draw.io units are
      named when its server is pinned.
   12. *Attestation and exemption from evidence only* (two bench/3 review findings). A run counts as
      attested for the gate pair and the ladder only when a shipped parser re-derived its client
      values from its bound stdout and they name the declared model; otherwise it is not passed and
      counts toward the void rule. A run is exempt from a budget only by the structure above, never
      by note text, tool-call counts or missing tokens.
   13. *A non-run counts against passing* *(review)*. For the difference and the McNemar test, an
      instance the weakest agent has no attested, recorded verdict for (missing, infra_error,
      unattested, unrecorded) counts as passed by the weakest, and such an instance of the strongest
      as failed; headroom and the void share are unchanged. Leaving out the weakest agent's runs can
      therefore never make a pair discordant in the gate's favour. This tightens decision 13's
      "every run counts" for discrimination only.
   14. *Version pin at session level.* The plan pins the Practonaut version; `probe`, `declare`, every
      report of the round and the gate itself use that version *(review)*. The gate regenerates the
      pre-probe set from the plan rather than taking its world from the declaration *(review)*.
   15. *Requested and attested model.* Each ladder agent is declared by preset and model id
      (`--ladder`); its reports must request that model (`ANTHROPIC_MODEL`) and every judged run must
      attest it. The pre-probe gives Opus's attested id.
   16. *The second round's level, stated honestly* *(review)*. Decision 11's second round decides at
      α = 0.025 after a first round at 0.05; over both rounds the false-pass bound is 0.075 (a union
      bound), not a Bonferroni split of 0.05, and the gate report says so.
   17. *Gate report /2*: Markdown and JSON (`practonaut.challenge-gate/2`) in
      `docs/benchmarks/challenge/0.3.0/`; the release ledger `release-ledger.jsonl` there replaces
      0.2.0's per-round ledger files. `/1` declarations and 0.2.0 ledgers stay readable and are never
      counted: 0.3.0 counts its own ledger from zero.

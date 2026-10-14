# Vision

Status: **accepted** 2026-10-14 by the maintainer
([PADR-0033](adr/0033-product-direction-measurement-you-can-act-on.md)); it changes only by a new
PADR. Milestones and exit criteria: [roadmap](roadmap.md). Evidence behind every claim here:
[landscape 2026-10](research/landscape-2026-10.md).

This page says where Practonaut is going and why. It is written for the people and the AI coding
agents who develop Practonaut over the next months and years: read it before you pick work, and
when two good ideas compete, decide by it.

## 1. In one sentence

**Practonaut turns "my agent can do this in that app" from a claim into a measurement you can
reproduce, inspect and act on — and makes every change to an agent, its tools or its instructions
measurable before it ships.**

Short form for the README and talks: *real apps, independent checks, every change measured.*

## 2. Why this matters now

Measured or sourced on 2026-10-14 (details and sources in the [landscape note](research/landscape-2026-10.md)):

- **Agents already act in real apps.** Official MCP servers exist for Excalidraw, draw.io and
  tldraw; the Excalidraw and draw.io ones have more than 5,000 GitHub stars each. "An agent can
  draw" is a commodity. None of them measures whether the agent reached the goal.
- **Most evaluation checks words, not results.** Host-built evals (Claude Code's `plugin eval`),
  promptfoo or Inspect grade transcripts, tool calls, files or a model's judgement. Few grade the
  state a real application ends up in, with a checker that cannot be talked into a pass.
- **Environments are standardising.** MCP for tools, OpenEnv as a connection layer for training,
  Harbor as a task package. Buyers of environments care most about soundness ("high reward must
  mean the task was actually solved") and about headroom (no task that every model passes).
- **Practice with verified feedback helps agents; unverified self-advice can hurt.** Experience
  filtered by execution feedback improved web agents substantially (Agent Workflow Memory,
  ACE playbooks); skills a model writes for itself before solving lowered success by 8–12 points
  in SkillsBench. Someone has to measure, neutrally, what actually helps. That is Practonaut's job.

## 3. Where we stand (0.1.0, measured 2026-10-14)

| Strength | Gap |
|---|---|
| A real, pinned Excalidraw engine confirms every action; a separate checker with counter-probes decides; replay is deterministic; hidden data stays hidden | **No headroom:** 36 of 36 Claude Code runs passed on the six hardest library tasks — Opus 5.5 and Haiku 5.5 alike, both limited to Practonaut's seven tools (no file or shell access). Today `bench` is a smoke test, not a measure of ability; other vendors' agents are not measured yet |
| One `npx`, no Docker, three operating systems in CI | **Only library tasks can be benched.** A task you author yourself can be practised over MCP but not benched or re-verified |
| Tasks from two drawings, checked before they are written | **Expensive for agents:** every `act` reply repeats the whole view; 67 % of reply bytes are static, context grows quadratically with the number of actions |
| Human and agent on one session, with the actor in the history | **Results say "passed?", not "why?":** no trajectory, no picture of the board, no tokens or cost, no comparison of two runs, "1.00" shown at n = 6 without an interval |
| `report --verify` re-judges runs from their artifacts | **One app, own action vocabulary:** scores measure the agent on Practonaut's actions, not on the tools it uses in production. Agents with shell tools could read reference solutions (not sealed) |

## 4. Who it is for

**Primary (next 12 months): people who build or tune agents and MCP tools for real
applications** and need to know whether a change helped — a new model, prompt, skill, tool
description or server version. We start where Practonaut is strongest: diagram tools, Excalidraw first.

**Secondary:** researchers who need deterministic, cheap, hack-resistant environments; maintainers
of applications who want to show that agents can really use their app.

**Not now:** claims about training human skills (unstudied), enterprise procurement, a hosted
service, public rankings before scores are sealed.

## 5. North Star

**External projects that use Practonaut repeatedly.** An *external project* counts when, in public
and outside this project's own accounts, there is (a) a repository whose workflow, configuration or
task pack runs Practonaut on at least two separate dates (visible workflow runs or commits), or (b) a person or team reporting use in at least two separate weeks
(issue, discussion, post), or (c) published reports or task packs, on at least two separate dates,
that `report --verify` or `validate` accepts. Each project counts once. Counted from public evidence only (code search,
issues, discussions), never from telemetry, so every count is a lower bound.

Supporting signals: stars, npm downloads (trend only; mirrors and bots inflate them), issues and
pull requests from people outside the project, external task packs, Practonaut badges in other
READMEs.

Targets are hypotheses, reviewed at the checkpoints in the [roadmap](roadmap.md): the first
external project within six weeks after 0.2.0 ships (at the latest 2027-02-28), 10 by 2027-06-30,
50 by 2027-12-31, 300 by 2028-12-31. A thousand regular users needs several integrations whose users
keep the workflow; it is a direction, not a forecast. If the first checkpoint fails, the roadmap's
narrowed plan applies.

## 6. Product principles

These add to the invariants in [architecture](architecture.md) §10; they do not relax any of them.

1. **The checker is the product.** Verdicts come from the real application's state, a separate
   checker and counter-probes. Never a language-model judge, never the agent's own words.
2. **Headroom or it does not count.** A task family is published only after a preregistered ladder
   of at least three agents passes on at least 24 fresh held-out instances (the instance is the unit,
   not the run): the strongest agent between 10 % and 80 %, a significant gap to the weakest, the
   oracle 100 %, the random agent at most 5 %, every near miss failing (details: roadmap 0.2.0, item 4).
3. **Your task, your tools.** The user's own tasks and toolchain are the main path; the bundled
   library is the example set and the shared yardstick.
4. **Every number carries its n and its limits.** Fractions before rates, intervals at small n,
   verification status, mirror, isolation level ("tool-restricted", "not restricted", "sealed") and
   "self-reported" markers travel with every exported surface — report, card, badge, comparison. A
   comparison says "not distinguishable" when the sample cannot tell.
5. **Lean for agents.** Replies are sized for context windows: compact by default, full on request,
   one language unless asked for two.
6. **One `npx` on the main path.** No Docker, no VM, no account. Containers appear only as optional
   export channels (Harbor, OpenEnv) or as an optional sealed runner.
7. **Local-first, no telemetry.** Nothing leaves the machine except what the user's own agent sends
   to its own provider.
8. **The proof is the picture.** Every result surface shows the work behind the number: the board,
   the sequence, the unmet condition, the confirmation by the real app.
9. **Rigor serves users.** Verification machinery must have a user-visible purpose. The project once
   nearly drowned in its own audit apparatus (relaunch 2026-10-11); a new check needs a reader.

## 7. Strategic bets

| # | Bet | Why now | How it could fail | Cheapest test |
|---|---|---|---|---|
| B1 | **Measurement you can act on:** bench your own tasks, compare two agent configurations with honest statistics, see why a run failed, gate CI on instance regressions (a task that always passed now always fails) | Models, prompts, tool schemas and clients change monthly; developers lack state-based regression checks; agents repeat the same action sequence in most repeats, so instance regressions are meaningful at small n | Developers prefer their existing eval stack; rate differences stay "not distinguishable" at affordable n | One external project uses `compare` to make a change decision on its own task |
| B2 | **Headroom by design:** harder task families (repair, prompt injection in content, long horizon with distractors, limited checks, tight budgets; later a human editing mid-run), a seeded generator with a difficulty knob | The library is saturated; labs retire tasks near 70 % success | New families still do not spread agents; two failed ladder rounds stop the bet | Ladder run on a prototype family before building more |
| B3 | **Same task, any hands:** the same task and checker for Practonaut's actions, for the user's own tools (any MCP server, judged on the native artifact), later for GUI agents | Official app MCP servers exist; nobody compares interfaces on identical tasks | Third-party tools leave no readable state | Judge one official-server run on its exported `.excalidraw` |
| B4 | **Meet agents where they live:** results inside chat clients (MCP Apps), export to Harbor/OpenEnv, verdict files for host evals, a GitHub Actions recipe | MCP Apps render in Claude, ChatGPT, VS Code, Cursor; Harbor and OpenEnv are where trainers look | Maintenance of bridges without demand | One bridge at a time, each with a user |
| B5 | **Proven skills:** measure whether a skill, playbook or tool description helps, on held-out variants, against a same-length placebo | Skills are a cross-vendor format; their effect is mostly unmeasured | Effects are noise at small n | One paired A/B with an interval |
| B6 | **Breadth along the vocabulary, then beyond diagrams:** draw.io next (same diagram vocabulary, so every task runs on two apps), then spreadsheets after an identity spike, then documents or Git — a new domain only after the action-vocabulary decision | "One app" reads as a toy; draw.io has about 4.2 M VS Code installs and an official MCP server, Excalidraw's extension about 0.56 M; spreadsheets are the largest agent demand | The local embed path breaks with an upstream release; diagram authors are a small pool; a new domain costs as much as the first app | Preregistered spikes with hard abort criteria (draw.io in 0.2.0, spreadsheets in 0.4.0) |

## 8. Milestones at a glance

| Version | Theme | The question it answers |
|---|---|---|
| 0.2.0 | **Real signal** | Does a Practonaut score tell two agents apart, and does it say why? |
| 0.3.0 | **Two apps, your tools** | Can I score *my* toolchain, on more than one app, and keep it from regressing? |
| 0.4.0 | **Where agents live** | Can I see results in my chat client, and trust scores of agents with shell access? |
| 0.5.0 | **Beyond diagrams** | Does the approach hold for spreadsheets, and for an MCP server as the app? |
| 0.6.0 | **Practice that transfers** | Does what an agent learned here help on tasks it has not seen? |
| 0.7.0 | **Other hands** | How do API, MCP-tool and GUI agents compare on the same task? |
| 1.0 | **Stable platform** | Can others build on Practonaut for years? |

Details, deliverables, exit criteria and checkpoints: [roadmap](roadmap.md).

## 9. What we will not do

- No language model in the runtime, the checker or the verdict; no LLM-as-judge.
- No telemetry, accounts or hosted service on the main path.
- No public ranking before scores are sealed and every entry is re-verified; no "#1", trophies or
  rates finer than the sample allows.
- No claim that practising here trains people, until a study shows it.
- No pivot to pixels only; GUI mode, when it comes, uses the same tasks and checker.
- No application outside the diagram domain before the action-vocabulary decision; no five
  applications at once; no application that needs Docker or a licence key on the main path (this is
  why Penpot and tldraw are not next).
- No growth in task count for announcements; a task exists because it measures something.
- No verification apparatus without a user (principle 9).
- No breaking world or report formats without a reader for the previous major and a migration note.

## 10. Scenarios and how we respond

| When | Scenario | What Practonaut has ready |
|---|---|---|
| 6 months | Another MCP revision (new `tools/call` result shape, HTTP over stdio) | Official SDK only, tests for both protocol generations, compact structured replies |
| 6–12 months | Agents inside every chat client with embedded UIs | Result cards and board view as an MCP App |
| 12 months | Practice and skill loops become standard | Neutral A/B measurement of skills with placebo and held-out variants |
| 12–24 months | Labs buy environments at scale | Harbor/OpenEnv export, hack-resistant generated families, throughput numbers |
| 12–24 months | Strong local models | A preset for OpenAI-compatible local endpoints; cost-free comparisons |
| 24 months | GUI agents become reliable on short tasks | GUI mode on the same tasks through the existing editor path |
| 24–36 months | Browser-native tools (WebMCP) are common | An adapter path that uses an app's own tools while the checker stays independent |
| 24–36 months | Regulated evaluation of agents | Provenance already in reports (versions, hashes); signed reports if asked for |

## 11. How agents use this document

1. Read order for a new session: [AGENTS.md](../AGENTS.md) → this page → [roadmap](roadmap.md) →
   [architecture](architecture.md) §10 → the decision records your change touches.
2. Pick work from the current milestone in the roadmap, in its listed order, unless a maintainer
   says otherwise. Work outside the current milestone needs a maintainer's go.
3. Every milestone deliverable has an acceptance line. A deliverable is done when that line is
   measured, not when the code exists. Write the measurement into the pull request.
4. A change that contradicts this page or the roadmap needs a decision record first (PADR). The
   vision changes only by a new PADR accepted by a maintainer.
5. Volatile facts (test counts, pass rates, stars, versions) are measured at the source, never
   copied from this page.
6. Re-assess this vision when: a checkpoint in the roadmap is missed by more than one release; a
   bet's cheapest test fails; a platform change (MCP, client, app) removes a premise in section 2.

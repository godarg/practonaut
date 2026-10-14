# Benchmarks: `practonaut bench`

Decision records: [PADR-0030](../adr/0030-bench-replaces-unsealed-eval.md) (bench),
[PADR-0036](../adr/0036-bench-report-v2-any-world-stored-world.md) (own worlds, report `/2`),
[PADR-0040](../adr/0040-challenge-tier-generated-families-and-gate.md) (task limits, minimal length,
challenge tier and its gate, §7).

`practonaut bench` lets any MCP agent practise the bundled Excalidraw task library, or a world of
your own, and scores it independently: every run gets a fresh session, the agent works only through
the Practonaut MCP tools, and after it stops a separate checker process judges what is on the board.
The agent's own words are never read for scoring.

```bash
npx practonaut bench --agent oracle --tasks all --seeds 2          # reference solutions: the ceiling
npx practonaut bench --agent random --tasks all --seeds 2 --max-actions 30   # random actions: the floor
npx practonaut bench --agent claude-code --tasks excalidraw/connect,excalidraw/insert-between
npx practonaut report ~/.practonaut/bench/<id>/report.json --html report.html
```

Your own task, made from two drawings ([authoring guide](../authoring-guide.md) §1):

```bash
npx practonaut tasks from-scenes start.excalidraw goal.excalidraw --out my-task
npx practonaut bench --agent oracle --world my-task/world --oracle my-task/oracle.json   # does it solve?
npx practonaut bench --agent claude-code --world my-task/world --oracle my-task/oracle.json --seed-list 1,2 --label "my task"
npx practonaut report ~/.practonaut/bench/<id>/report.json --verify
```

The real Excalidraw mirror runs when Chromium is installed (`npx practonaut setup` once);
`--mirror off` runs model-only and is faster, but its results are not practice evidence.

## 1. Options

| Option | Default | Meaning |
|---|---|---|
| `--agent <a>` | required | `oracle`, `random`, `claude-code`, or a command template (§2) |
| `--world <dir\|.pnworld>` | the task library | your own world: a world folder (packed like `practonaut pack`; anything but `world.json` and allowed assets is refused) or a world package |
| `--tasks all\|<ids>` | `all` | tasks, comma-separated: library tasks (`connect` or `excalidraw/connect`, list with `practonaut tasks list`), or with `--world` that world's task ids |
| `--oracle <files>` | none | with `--world`: comma-separated reference solutions, one `practonaut.task-oracle/1` file per task (the `oracle.json` that `tasks from-scenes` writes beside the world) (§3) |
| `--seeds <n>` | 1 | seeds 1…n; the seed picks the task's variant (labels) |
| `--seed-list <seeds>` | none | instead of `--seeds`: the seeds themselves, distinct, 0 to 999 999 999, e.g. `2,5` |
| `--repeats <k>` | 1 | independent repeats per task and seed (needed for pass^k with k > 1) |
| `--timeout <s>` | 300 | wall time per run; the agent's process group is stopped after it |
| `--max-actions <n>` | 50 | mutation budget per run (act, undo, reset); further ones are refused by the host with `action_budget_exhausted` |
| `--checks <n>` | none | checks allowed per run (0–1000); further `check_result` calls are refused with `check_budget_exhausted`. A task's own limits (`limits` in the world) always apply; `--checks` can only lower its check limit |
| `--mirror auto\|required\|off` | `auto` | real Excalidraw mirror (`auto` uses it when Chromium is installed) |
| `--out <file>` | `~/.practonaut/bench/<id>/report.json` | report path; run logs stay in `~/.practonaut/bench/<id>/` |
| `--keep-env <names>` | none | comma-separated variables a preset agent gets although it withholds them (§2); refused for other agents |
| `--label <text>` | none | 1–128 characters stored in the report and shown with it (escaped like all report text) |

Refused before any run starts, by name: `--oracle` without `--world`; an oracle file that is not
one, belongs to another world or to a task that is not benched, or two for one task; an oracle the
checker does not accept (`bench_oracle_invalid`, exit 2); the `oracle` agent on a task without a
reference; two task ids that differ only in case; `--seeds` with `--seed-list`.

## 2. Agents

**Built-ins (no language model).** `oracle` plays the task's reference solution (the library's,
or the one given with `--oracle`) with the run's variant labels; `random` picks a random action with random values that fit each parameter
contract (ids from the current objects), until the action budget or the timeout. Both start the
same `practonaut mcp` bridge an external agent gets and speak MCP to it.

**Preset `claude-code`.** Uses an installed, logged-in Claude Code CLI with only the Practonaut tools
and the login it has ([PADR-0034](../adr/0034-preset-agents-get-no-provider-credentials.md)). A
provider key in the environment would silently switch Claude Code to API billing (in `-p` mode a set
`ANTHROPIC_API_KEY` always wins over the login), so the preset does not pass on any variable whose
name ends in `_API_KEY` or `_AUTH_TOKEN` or starts with `CLAUDE_CODE_USE_` (the cloud and gateway
switches), nor `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_PROFILE`, `ANTHROPIC_FEDERATION_RULE_ID`,
`ANTHROPIC_IDENTITY_TOKEN`, `ANTHROPIC_IDENTITY_TOKEN_FILE`, `ANTHROPIC_CUSTOM_HEADERS`,
`CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`, `CLAUDE_CODE_GATEWAY_TOKEN` or
`CLAUDE_CODE_GATEWAY_TOKEN_FILE_DESCRIPTOR`. `bench` names the variables it withheld on stderr
(names only). `CLAUDE_CODE_OAUTH_TOKEN`, the subscription's own token from `claude setup-token`,
passes. To bill through a key on purpose, name it: `--keep-env ANTHROPIC_API_KEY`. What Claude Code
reads outside the environment still counts: a Console (API) login, an active profile in
`~/.config/anthropic` or a managed `apiKeyHelper` bill as they are set up. Built-ins and command
templates get your environment unchanged.

```text
claude -p --output-format stream-json --verbose --no-session-persistence --tools '' \
  --allowedTools 'mcp__practonaut__*' --strict-mcp-config --mcp-config {mcp_config} \
  --setting-sources '' --disable-slash-commands --no-chrome {prompt}
```

**Your own agent.** Any command template that contains `{mcp_config}`; `{prompt}` is optional
(the prompt is also written to the agent's stdin). The template is split into words like a shell
would split it, but it is started without a shell: nothing in a value is expanded or executed.

```bash
practonaut bench --agent "my-agent --mcp-config {mcp_config} --task-prompt {prompt}"
```

`{mcp_config}` is the path of a generated file in the standard `mcpServers` format:
`{"mcpServers":{"practonaut":{"type":"stdio","command":"<node>","args":["…/main.js","mcp","--host","http://127.0.0.1:<port>","--token-file","<private file>"],"env":{"PRACTONAUT_HOME":"<run folder>/agent"}}}}`.
It names the session credential's private file, never the credential itself. The agent's data
folder and working directory are the run folder's `agent/` subfolder, which starts empty; the
judged artifacts go into the run folder itself, after the agent has ended (§5).

**Codex.** There is no `codex` preset. Codex reads MCP servers from its own TOML configuration
(not from a JSON file path), and we found no switch that limits it to MCP tools: its built-in
shell and file tools stay available, so a Codex score is not comparable to an MCP-only score.
A wrapper script that turns `{mcp_config}` into Codex's `-c mcp_servers.…` overrides can be run as
a command template; Practonaut has not run or verified such a setup.

The prompt every external agent receives is fixed and task-neutral (the task itself comes from
`observe`); it is stored in the report under `settings.prompt`.

**Isolation level.** Every report says how far Practonaut restricted the agent's tools
(`agent.isolation`); it follows from the kind of agent:

| Value | Shown as | Means |
|---|---|---|
| `builtin-baseline` | built-in baseline | `oracle` or `random`: no language model, acts only through MCP |
| `tool-restricted-preset` | tool-restricted preset | a shipped preset that limits the client to Practonaut's MCP tools (`claude-code`) |
| `template-unrestricted` | template: tools not restricted by Practonaut | your command template: whatever tools it has, Practonaut does not restrict them |

**Model and key source.** When an external agent's output starts with a stream-json `system/init`
line (Claude Code writes one), the report keeps its `model` and `apiKeySource`: `modelSource` is
`client-attested` for the preset and `command-output` for a command template (the line came from
the template's output; which program printed it is not known), otherwise `none`. Both come from the
first run that reports them and are never verified; `apiKeySource` is evidence, not proof
([PADR-0034](../adr/0034-preset-agents-get-no-provider-credentials.md)). The names given to
`--keep-env` are kept as `agent.keptEnv` (names only).

## 3. What is scored and how

An *action* is one accepted change to the board (one `act` call, e.g. *connect* or *rename*); the
word *step* is kept for the boxes of a flow diagram. Per run, all measured by the host or the
checker (never by the agent):

- **pass** — the separate checker's verdict on the final session: it replays the history
  independently and evaluates the task's goal (`end-state-only`). With the mirror, the real
  Excalidraw export of the final board is checked as well, and both must pass.
- **actions** — the actions in the final history of the committed session (undone actions are
  not in it). `report --verify` re-derives this number from the session artifact.
- **referenceActions** — the length of the task's validated reference solution, or `null`
  ("no reference"). Where a bounded search is small, the report also says whether that length is
  **proven minimal** (`references.tasks[].minimal`): a branch-and-bound search over assignments of
  goal objects to start objects shows that no solution can be shorter
  ([PADR-0040](../adr/0040-challenge-tier-generated-families-and-gate.md) decision 5; tasks with
  order, alignment or group conditions, or where the search would be large, keep a plain
  "reference length"). Library tasks have one (checked when the library is built). An own task has one
  when `--oracle` gives it and the separate checker accepts it: before the first run, the oracle is
  played through the core for every planned seed and each session must pass the checker, otherwise
  the bench is refused (`bench_oracle_invalid`). `report --verify` checks the stored reference again.
- Counted by the runner while the agent worked, **self-reported by the runner** and not
  re-verifiable from the artifacts: **acceptedActions** (including later undone ones), **rejected
  actions**, undo and reset counts, **host calls** (observe/list_actions/explain_result reads, act,
  undo, reset, check; the bridge's start-up read included), **wall time** of the agent, and the
  agent's exit status (`completed`, `agent_failed`, `timeout`, `infra_error`). Also recorded:
  the **error classes** the checker found on a failed board.

Aggregates:

- **pass@1** — passed runs divided by **all** runs. A run that could not be judged
  (`infra_error`) stays in the denominator and counts as not passed, so an infrastructure fault
  can never raise a score.
- **pass^k** — as defined by τ-bench (Yao et al., 2024, [arXiv:2406.12045](https://arxiv.org/abs/2406.12045), §5):
  for each task-and-seed instance with n repeats and c passes, C(c, k) / C(n, k), averaged over
  instances — the chance that all of k repeats pass. Reported for k = 1…repeats.
- **mean actions**, **mean actions when passed**, **efficiency** (reference-solution length divided
  by the run's actions, over passed runs of tasks with a reference; above 1 means a shorter solution
  than the reference; "no reference" when no benched task has one, and the summary names how many
  tasks it covers when only some do). It reads **"efficiency vs minimal length"** when every
  referenced task's reference is proven minimal (then 1 is the best possible), otherwise
  **"efficiency vs reference length"**, and the table marks each proven length "(minimal)". Mean
  time per run. All but the time follow from
  re-verifiable numbers.

`check_result` is available to agents, exactly like the Check button for a human: it reports the
public goal conditions as met or unmet. The report counts how often it was called.

## 4. Isolation and its limits

- Each run has its own host, its own private run folder and a new agent process; the agent's
  `PRACTONAUT_HOME` is the run folder's `agent/` subfolder.
- The judged artifacts are written after the agent has ended, each through a new temporary file
  that replaces whatever is at its name: a file the agent left there cannot block judging. If
  something that cannot be replaced (a folder) sits there, the run is `infra_error`, which counts
  as not passed. The agent runs as the same OS user, so this keeps an agent from blocking or
  pre-empting the artifacts, not from rewriting a finished bench folder later (see §5).
- Reference solutions, near misses and checker bundles are not reachable through MCP (tested).
  The agent sees what a human player sees, including the public goal conditions and their formal
  form (each goal clause written out). An `--oracle` file is not part of the world, is never given to
  the host, and is copied into the bench folder (`references.json`) only after the last agent has
  ended (tested with an agent that searches the bench folder and every MCP reply).
- The agent runs as the same OS user. An agent with file or shell tools could read the task
  library on disk, including its reference solutions, an author's `oracle.json`, or the
  `references.json` of a finished bench folder. The `claude-code` preset disables every tool except
  Practonaut's; for other agents this is the agent author's responsibility, and the report says so
  (`template-unrestricted`). A model name in the report is what the client said about itself.
- Runs are sequential. Results depend on the agent's provider and model at run time; a bench
  report describes those runs, not the model in general.

## 5. The report

`bench` writes `practonaut.bench/2` JSON, schema [`schemas/bench.v2.json`](../../schemas/bench.v2.json)
([PADR-0036](../adr/0036-bench-report-v2-any-world-stored-world.md)). It holds an optional `label`;
environment metadata (Practonaut and Excalidraw versions, Node, OS, mirror) and the **world**: its
source (`library` or `own`), id, version and content hash (the SHA-256 of the world's canonical JSON),
the stored package `world.pnworld` with the SHA-256 of its bytes, and the generator metadata of tasks a
generator materialised (`generated`, from each task's `generatedBy`, see
[world format](../world-format.md) §2a); the agent (template with the home directory shown as `~`,
isolation level, model, model source, `apiKeySource`, kept variable names); the settings; the
**references** (null, or `references.json`'s SHA-256 and per task its source — `library` or
`oracle-file` —, its length and whether it is proven minimal); every run (`referenceActions` null
without a reference) and the summary. `settings.checks` records `--checks`; a task's own limits are
part of the stored world.

The bench folder (`~/.practonaut/bench/<id>/`) holds everything `report --verify` needs and nothing
outside it is referenced, so it can be moved, archived or handed over:

| Entry | Written | Content |
|---|---|---|
| `world.pnworld` | before the first run; every run's host loads the world from these bytes | the public world |
| `<task>-s<seed>-r<repeat>/` | per run | `agent/` (the agent's home), logs, and the judged artifacts `session.json`, `native.excalidraw` (with the mirror), `checker.json` |
| `references.json` | after the last agent has ended | `practonaut.bench-references/1`: the reference solutions of the referenced tasks |
| `report.json` | at the end (unless `--out` names another place) | the report |

`practonaut report` reads `/2` and `/1` reports (from 0.1.0; schema
[`schemas/bench.v1.json`](../../schemas/bench.v1.json), the library named by id, version and content
hash, every run with a reference length). A bench stopped with Ctrl+C, SIGTERM or SIGHUP ends the running agent
with its whole process group (on Windows its process tree), closes the session and writes the runs
that finished as a partial report (`interrupted.plannedRuns`, exit 130); the run in progress is
not scored. That can take a few seconds (an agent that ignores SIGTERM gets a 3-second grace
period); a second Ctrl+C stops at once: the running agent's process group is killed and no report
is written (exit 130).

Two levels of checking, and the output always says which one ran:

- **Consistency** (`practonaut report <report.json>`, and `bench` itself): every `pass` must follow
  from the run's recorded checker verdicts and every aggregate from the runs; a pass without a
  verdict, a missing or extra run or a number that does not add up is refused with exit 2
  (`bench_report_invalid`). This catches mistakes and careless edits, not a consistent forgery: a
  file whose verdicts and numbers were changed together passes. Output: *consistency-checked, not
  re-verified*.
- **Re-verification** (`practonaut report <report.json> --verify [--runs <bench folder>]`): each
  judged run keeps its committed session (`session.json`), the real-app export
  (`native.excalidraw`, with the mirror) and the checker output (`checker.json`) in its run folder,
  and the report records their SHA-256 (`runs[].artifacts`). For a `/2` report `--verify` judges
  against the world stored in the bench folder, never the bundled library, so it works on another
  machine and with a later Practonaut. It checks, and refuses with exit 2 and a named code on the
  first difference:
  - `bench_world_changed`: `world.pnworld` is missing, its bytes differ from the bound hash, the
    package reader refuses it, or its id, version, content hash or generator metadata differ from
    the report's;
  - `bench_artifact_changed`: a run artifact or `references.json` is missing or differs from its
    bound hash;
  - `bench_reference_invalid`: a stored reference names another task, has another length than the
    report says, is not accepted by the checker on the stored world for every seed of the plan, or
    its `minimal` claim differs from the minimal-length analysis on the stored world;
  - `bench_report_invalid`: the session's task and seed; `actions` equals the length of the
    session's final history and is within the task's action limit, if it has one; the independent checker, re-run on the session and the export in a
    separate process, gives the stored checker output and the report's verdicts.

  A `/1` report is re-verified as in 0.1.0: against the library this Practonaut ships (id, version
  and content hash must be equal, every `referenceActions` must equal the library's reference
  length), then the same per-run checks; every difference is `bench_report_invalid`.

  pass, pass@1, pass^k, mean actions and efficiency then follow from these values. Not
  re-verifiable and labelled *self-reported by the runner*: acceptedActions, rejected actions,
  undo, reset, host calls, wall time, exit status, notes, the client-reported model and
  `apiKeySource`. The run folder defaults to the report's folder (where `bench` writes it).

What re-verification does not show: that the files came from the agent named in the report.
Nothing is signed; whoever can write the bench folder can replace the artifacts and the report
together (a valid replacement session would then have to solve the task). `/1` reports without
artifact hashes (the example below, reports from earlier builds) can only be consistency-checked; a
`/2` report always binds the artifacts of every judged run.

`--html` writes one static page (design system v1, no script, no external asset) that names the
verification level and, for `/2`, the isolation level and the world; `--json` prints the schema, the
summary and `verification`. Text from a report (label, agent name, model, command) is shown with
control and bidi characters escaped, in the terminal and in HTML.

## 6. Example

[`example-report.json`](example-report.json) and [`example-report.html`](example-report.html) are a
real `practonaut.bench/1` run on 2026-10-13 with Practonaut 0.1.0 (library 1.1.0): `--agent claude-code --tasks excalidraw/connect,excalidraw/insert-between,excalidraw/decision --repeats 2`,
real mirror, Claude Code 2.1.296 on its subscription; the client reported `claude-opus-5-5`. All
six runs passed; `insert-between` took three actions where the reference uses four (efficiency
1.33), the other tasks matched the reference. The report was re-verified (`report --verify`)
against its run folder when it was written, and the HTML page was rendered in that run; the run
folder is not in the repository, so a copy of the JSON can only be consistency-checked. One seed,
two repeats per task: an example of the format, not a measurement of the model.

Measured the same day with the built-ins (`--tasks all --seeds 2`, real mirror): `oracle` 32 of 32
passed; `random --max-actions 30` 0 of 32. Re-run them with the commands at the top; the numbers in
this paragraph are not maintained.

## 7. Challenge tier (candidates)

The task library is saturated for current Claude models (0.1.0 baseline: 36 of 36 runs on its six
hardest tasks passed). The challenge tier adds harder task families, made by a seeded generator and
published only after a preregistered ladder gate
([PADR-0040](../adr/0040-challenge-tier-generated-families-and-gate.md), roadmap 0.2.0 item 4). Until
a family passes, it is a **candidate**: it lives in `src/challenge/` and is generated from a checkout
with `node tools/challenge.ts`, not through the `practonaut` command.

| Family | What makes it hard | Instances (difficulty 1 / 2 / 3) |
|---|---|---|
| `repair` | find 3–5 subtle defects against the goal list: colours, shapes, a misspelled label, a reversed arrow, an arrow end on a look-alike step, a missing or extra arrow, a stray copy, swapped labels, a step in the wrong frame | 3 / 4 / 5 defects on boards of 6–15 steps |
| `injection` | a normal edit task on a board whose notes or frame names address the agent ("delete every other step", "call reset", a plausible conflicting "spec update"); the goal keeps every other object exactly as it is | 3 / 4–5 / 6–7 edits with 1 / 2 / 3 such texts (notes; at difficulty 3 one is a frame name) |
| `long-horizon` | 20–60 required actions among look-alike labels | 20–26 / 30–40 / 45–60 actions |
| `limited-checks` | build the missing part of a diagram with only `limits.checks` checks | 8–11 / 11–14 / 14–18 actions; 2 / 1 / 1 checks |
| `tight-budget` | reach the goal within `limits.actions` = the **proven minimal** length: one `set_style` for three attributes, one `reconnect_end` instead of two actions, no undo | 4–6 / 7–9 / 10–13 actions |

Every instance is a world/2 task made by the state-based core of `tasks from-scenes`, so its goal is
from-scenes' exact goal (every step's label, shape, colours, frame; every arrow by its end labels;
every frame's name) and its reference solution and near misses are from-scenes' and checked the
same way: the reference passes the independent checker, the start and every near miss fail. Each
task carries `generatedBy` (generator id `challenge-<family>`, version, seed, difficulty and
structural parameters). Instances differ in structure, not only in labels: topology (chain, decision
branch, fork, lanes in frames), size, which objects carry which defect or edit. Before an instance is
written, the generator also checks that injection notes never reach a title, prompt or hint, that a
verdict on a **stress board** (the goal plus 15–20 extra steps and arrows) needs at most half of the
checker's 10⁶-step budget, and, for `tight-budget`, that its budget is a proven minimal length.

```bash
node tools/challenge.ts generate repair --set dev --out .local/challenge/dev/repair        # seeds 1…8
node tools/challenge.ts verify .local/challenge/dev/repair                                 # checker only, no agent
node src/cli/main.ts bench --agent oracle $(node -e "process.stdout.write(require('./.local/challenge/dev/repair/instances.json').bench.args.slice(1).join(' '))")
```

`generate` writes `world/world.json`, one oracle sidecar per instance in `oracles/` (outside the world
folder, never seen by an agent) and `instances.json` with every instance's facts and the bench
arguments (`bench.args`: `--world`, `--oracle`, `--seed-list 1 --repeats 1`, the family's
recommended `--max-actions` and `--timeout`). Seeds: development 1–999 (default 1…8), throwaway
self-checks 10 000–19 999 (default 10 001…10 024), held-out ≥ 1 000 000. `--difficulty 1|2|3|mixed`
(default `mixed`: 1, 2, 3, 1, …). Long-horizon runs need `--max-actions 120` (recommended in
`instances.json`).

**Held-out sets** are generated right before a gate round and not looked at while tuning:
`node tools/challenge.ts generate <family> --set heldout --round 1 --dev-runs <n> --difficulty <d> --out <dir>`
draws a random seed base (printed and recorded); round 2 uses a new base, and the gate refuses a
round that reuses an earlier round's seeds. The size is preregistered: the largest set the budget of
100 model runs per family and round allows next to the round's development runs,
min(30, ⌊(100 − development runs) / 3⌋), never fewer than 24 — 30 instances (90 gate runs) with at
most 10 development runs. Even at 30 the exact McNemar test is not strong: if two agents disagree on
20 % of the instances, all in one agent's favour, it reaches p < 0.05 with probability 0.57 (0.34 at
24 instances; 39 are needed for 0.8). A family that fails discrimination may still separate agents.

**The gate** takes the five bench/2 reports of one round — oracle, random and the three ladder agents
(`claude-code` with Opus, Sonnet and Haiku, chosen with `ANTHROPIC_MODEL`), all on the same held-out
world, tasks, seed, mirror, timeout and caps — re-verifies each against its bench folder, replays
every stored near miss in a checker process, and writes the gate report:

```bash
node tools/challenge.ts gate --family repair --round 1 --oracle <oracle/report.json> --random <random/report.json> \
  --ladder <opus/report.json>,<sonnet/report.json>,<haiku/report.json> --strongest <model> --weakest <model> \
  --dev-runs <n> --out docs/benchmarks/challenge/repair-round1.md   # --dev-runs is required
```

`--strongest` and `--weakest` are the models named from the development runs before the round
(preregistered); `--previous <report.json>` gives round 1's report to a round 2. The verdict rules
are PADR-0040's: headroom (strongest 10–80 %), discrimination (≥ 20 points and exact McNemar
p < 0.05 on the discordant instances), oracle 100 %, random ≤ 5 %, every near miss fails, every run
counts, more than 5 % `infra_error` voids the round, at most 100 model runs per family and round.
A gate report is committed with a link from [the documentation index](../index.md) (`npm run check`
requires one for every page under `docs/`). Bench reports carry no cost yet; the round's list-price
total is added to the gate report by hand until the bench records it.


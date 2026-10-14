# Benchmarks: `practonaut bench`

Decision records: [PADR-0030](../adr/0030-bench-replaces-unsealed-eval.md) (bench),
[PADR-0036](../adr/0036-bench-report-v2-any-world-stored-world.md) (own worlds, report `/2`).

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
| `--mirror auto\|required\|off` | `auto` | real Excalidraw mirror (`auto` uses it when Chromium is installed) |
| `--out <file>` | `~/.practonaut/bench/<id>/report.json` | report path; run logs stay in `~/.practonaut/bench/<id>/` |
| `--keep-env <names>` | none | comma-separated variables a preset agent gets although it withholds them (§2); refused for other agents |
| `--label <text>` | none | 1–128 characters stored in the report and shown with it (escaped like all report text) |

Refused before any run starts, by name: `--oracle` without `--world`; an oracle file that is not
one, belongs to another world or to a task that is not benched, or two for one task; an oracle the
checker does not accept (`bench_oracle_invalid`, exit 2); the `oracle` agent on a task without a
reference; two task ids that differ only in case; `--seeds` with `--seed-list`; references whose
stored form would be larger than the 64 MiB `report --verify` reads (`bench_references_too_large`).

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
  ("no reference"). Library tasks have one (checked when the library is built). An own task has one
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
- **mean actions**, **mean actions when passed**, **efficiency vs reference** (reference-solution
  length divided by the run's actions, over passed runs of tasks with a reference; above 1 means a
  shorter solution than the reference; "no reference" when no benched task has one, and the summary
  names how many tasks it covers when only some do), mean time per run. All but the time follow from
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
  form (each goal clause written out). An `--oracle` file is not part of the world and is never given
  to the host. A bench host lists only the run's own task and refuses a change to another task, so a
  world that holds several instances shows an agent only the one it is on.
- While the agents of a bench run, its folder holds neither the world package nor the references:
  the hosts load the world from bytes kept in memory (hashed before the first run), and
  `world.pnworld` and `references.json` (the action sequences only, no near misses) are written after
  the last agent has ended. Tested with an agent that searches the whole bench folder and every MCP
  reply for the reference solution.
- The agent runs as the same OS user, and a bench is not sealed. An agent with file or shell tools
  could read your own `--world` folder and `oracle.json`, the task library on disk with its
  reference solutions, or the folders of finished benches; one that escapes its process group (for
  example with `setsid`) and outlives its run could read this bench's folder afterwards. Practonaut
  cannot prevent that without a sealed runner. The `claude-code` preset disables every tool except
  Practonaut's, so it cannot read files; for other agents this is the agent author's responsibility,
  and the report says so (`template-unrestricted`). A model name in the report is what the client
  said about itself.
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
`oracle-file` — and length); every run (`referenceActions` null without a reference) and the summary.

The bench folder (`~/.practonaut/bench/<id>/`) holds everything `report --verify` needs and nothing
outside it is referenced, so it can be moved, archived or handed over:

| Entry | Written | Content |
|---|---|---|
| `<task>-s<seed>-r<repeat>/` | per run | `agent/` (the agent's home), logs, and the judged artifacts `session.json`, `native.excalidraw` (with the mirror), `checker.json` |
| `world.pnworld` | after the last agent has ended; the runs' hosts loaded the world from the same bytes, hashed before the first run | the public world |
| `references.json` | after the last agent has ended | `practonaut.bench-references/1`: task, source, world and action sequence of each referenced task |
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
  against the world stored in the bench folder, so a moved folder verifies on another machine and
  with a later Practonaut. It checks, in this order, and refuses with exit 2 and a named code on the
  first difference:
  - `bench_world_changed`: `world.pnworld` is missing, its bytes differ from the bound hash, the
    package reader refuses it, or its id, version, content hash or generator metadata differ from
    the report's; for a library bench whose id and version are those of the library this Practonaut
    ships, its content hash must be that library's;
  - `bench_artifact_changed`: `references.json` or a run artifact is missing, larger than its limit
    or differs from its bound hash;
  - `bench_reference_invalid`: a stored reference names another task, has another length than the
    report says, or is not accepted by the checker on the stored world for a seed a run used;
  - `bench_report_invalid`: the session's task and seed; `actions` equals the length of the
    session's final history; the independent checker, re-run on the session and the export in a
    separate process, gives the stored checker output and the report's verdicts.

  What the stored world is anchored to, `--verify` says: a library bench of this Practonaut's library
  version is this Practonaut's library; a library bench of another version, and every own world,
  only agree with their report. The report output shows the world's content hash (the SHA-256 of
  its canonical JSON); to know that a handed-over folder holds the world you expect, compare it with
  `practonaut validate <world.pnworld> --json` (or `pack --json`) on that world.

  A `/1` report is re-verified as in 0.1.0: against the library this Practonaut ships (id, version
  and content hash must be equal, every `referenceActions` must equal the library's reference
  length), then the same per-run checks; every difference is `bench_report_invalid`. So
  re-verifying a stored `/1` report ends with the first change of the bundled library; its
  consistency check stays.

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
verification level and, for `/2`, the isolation level, the world and its content hash, and where the
model name came from; `--json` prints the schema, the summary and `verification` (for `/2` with the
world's content hash and, for a library bench, whether it is this Practonaut's library). Text from a report (label, agent name, model, command) is shown with
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

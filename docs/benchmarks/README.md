# Benchmarks: `practonaut bench`

Decision records: [PADR-0030](../adr/0030-bench-replaces-unsealed-eval.md) (bench),
[PADR-0036](../adr/0036-bench-report-v2-any-world-stored-world.md) (own worlds, report `/2`),
[PADR-0039](../adr/0039-results-you-can-act-on-evidence-report-compare.md) (run evidence, report v2,
`compare`), [PADR-0040](../adr/0040-challenge-tier-generated-families-and-gate.md) (task limits,
minimal length, challenge tier and its gate, §10).

`practonaut bench` lets any MCP agent practise the bundled Excalidraw task library, or a world of
your own, and scores it independently: every run gets a fresh session, the agent works only through
the Practonaut MCP tools, and after it stops a separate checker process judges what is on the board.
The agent's own words are never read for scoring.

```bash
npx practonaut bench --agent oracle --tasks all --seeds 2          # reference solutions: the score's ceiling
npx practonaut bench --agent random --tasks all --seeds 2 --max-actions 30   # random actions: the floor
npx practonaut bench --agent claude-code --tasks excalidraw/connect,excalidraw/insert-between
npx practonaut report ~/.practonaut/bench/<id>/report.json --html report.html
npx practonaut compare baseline/report.json candidate/report.json --fail-on-regression
```

The built-ins mark the ends of the score; they are not a baseline for `compare`, which pairs only
reports of the same agent kind (§6). The baseline for your agent is a configuration of it that you
trust.

Your own task, made from two drawings ([authoring guide](../authoring-guide.md) §1):

```bash
npx practonaut tasks from-scenes start.excalidraw goal.excalidraw --out my-task
npx practonaut bench --agent oracle --world my-task/world --oracle my-task/oracle.json   # does it solve?
npx practonaut bench --agent claude-code --world my-task/world --oracle my-task/oracle.json --repeats 3 --label "my task"
npx practonaut report ~/.practonaut/bench/<id>/report.json --verify
```

A world from `tasks from-scenes` has one variant, so every seed shows the same board: run it more
often with `--repeats`, not with more seeds. Two seeds of one board would still count as two
instances, and `bench` says so on stderr (`seeds_share_variant`, naming the task and its variants).

The real Excalidraw mirror runs when Chromium is installed (`npx practonaut setup` once);
`--mirror off` runs model-only and is faster, but its results are not practice evidence.

## 1. Options

| Option | Default | Meaning |
|---|---|---|
| `--agent <a>` | required | `oracle`, `random`, `claude-code`, or a command template (§2) |
| `--world <dir\|.pnworld>` | the task library | your own world: a world folder (packed like `practonaut pack`; anything but `world.json` and allowed assets is refused) or a world package |
| `--tasks all\|<ids>` | `all` | tasks, comma-separated: library tasks (`connect` or `excalidraw/connect`, list with `practonaut tasks list`), or with `--world` that world's task ids |
| `--oracle <files>` | none | with `--world`: comma-separated reference solutions, one `practonaut.task-oracle/1` file per task (the `oracle.json` that `tasks from-scenes` writes beside the world) (§3) |
| `--seeds <n>` | 1 | seeds 1…n; the seed picks the task's variant (labels). Seeds that pick the same variant bench the same board and are named on stderr (`seeds_share_variant`); a world with one variant needs one seed and `--repeats` |
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
`{"mcpServers":{"practonaut":{"type":"stdio","command":"<node>","args":["…/main.js","mcp","--host","http://127.0.0.1:<port>","--token-file","<private file>","--call-log","<run folder>/calls.bridge.jsonl"],"env":{"PRACTONAUT_HOME":"<run folder>/agent"}}}}`.
It names the session credential's private file, never the credential itself, and the run's call log,
which lies outside the agent's own folder (§3). The agent's data
folder and working directory are the run folder's `agent/` subfolder, which starts empty; the
judged artifacts go into the run folder itself, after the agent has ended (§5).

Name every file in a template by its absolute path: the agent starts in that empty folder, where a
relative path does not resolve. What the agent prints is kept as `<run folder>/agent.stdout` and
`<run folder>/agent.stderr`. An agent that cannot start (a script not found, a missing module) ends as
`infra_error` "without a single tool call", and only its `agent.stderr` says why. Every template is
reported as the agent `generic` (kind `command`): give each configuration its own `--label`, which the
report shows and `compare` uses to name the two sides.

A minimal agent without a language model,
[`examples/agents/minimal-agent.mjs`](../../examples/agents/minimal-agent.mjs) (in the repository, not
in the npm package), shows the plumbing: it reads `{mcp_config}`, starts `mcpServers.practonaut`
(`command`, `args`, `env`) over stdio with the MCP SDK client, calls `observe`, plays each action with
`act`, passing `baseStep` and `expectedRevision` from the latest reply, and ends with `check_result`.
Its actions come from a plan file; an `oracle.json` has that shape, so on your own task it checks the
wiring (it is handed the reference on purpose: its score says nothing about a model), and
`--mistake` leaves out the last action to show a failed run. A real agent chooses each action from
the replies. `tests/integration/bench-example-agent.test.ts` runs it as a template.

```bash
npm install @modelcontextprotocol/client@2.3.1     # in the folder you copied minimal-agent.mjs to
npx practonaut bench --agent "node '$PWD/minimal-agent.mjs' {mcp_config} '$PWD/my-task/oracle.json'" \
  --world my-task/world --oracle my-task/oracle.json --label "minimal agent"
```

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
  the **error classes** the checker found on a failed board. A run that could not show what the
  model can do is an `infra_error` and is not judged: its client's own stream reports a usage or
  rate limit (a `rate_limit_event` that is not `allowed`, status 429 or a limit named), an
  authentication or billing error (status 401 or 403, an expired login) or a server error (5xx, 529
  included) — in an `is_error` result or an assistant message the client marks as an API error —,
  or the agent ended without completing and without a single tool call (the bridge's start-up read
  counts as one, so this is an agent that never started its MCP server, or a command that could not
  start). An `error_max_turns` result, a context overflow ("prompt is too long", status 400), any
  other 4xx error and every other error of the agent's own stay `agent_failed` and are judged.
  The client's model and Claude Code's version from its init event are recorded per run, and
  `report --verify` checks the model against the agent's own `agent.stdout`.

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

**Run evidence** ([PADR-0039](../adr/0039-results-you-can-act-on-evidence-report-compare.md)). Each
run folder also keeps what explains the verdict, each file bound by its SHA-256 in the report:

| File | Written by | Content |
|---|---|---|
| `calls.bridge.jsonl` | the agent's bridge (`practonaut mcp --call-log`) | as the bridge wrote it; never changed by the runner |
| `calls.jsonl` | the runner, from `calls.bridge.jsonl` | one line per `tools/call`: request id, tool, result code, the full result bytes, the bridge's processing time, and `clientMs`, the round trip measured by Practonaut's own bench client for `oracle` and `random` (null for other clients: "client timing unavailable"). Unreadable lines (`dropped`) and lines beyond 16 MiB or 100,000 lines (`omitted`, counted over at most 256 MiB more and then marked as a lower bound) are counted in the report and stay in the bridge's file. The agent starts the bridge, so an agent can leave no call log; the report then says so. |
| `mutations.jsonl` | the runner, on the host side | every `act`, `undo` and `reset` that reached the session: the action (name, parameters, base step), the MCP client that sent it (as the client named itself, for undo and reset too), accepted or rejected with the host's error code, step and revision afterwards; and every `check_result` as a `check` record (accepted or rejected), from which `--verify` counts a task's check limit (PADR-0040). Refusals for an exhausted budget (of changes, of checks) are kept up to 100 each and counted beyond; a rejected action's strings are cut at 256 characters. |
| `trace.json` | the separate checker process | each goal condition (a top-level clause of the goal, as the Player shows it) at the start and after every accepted mutation, from the checker's own replay of the mutation log, which must end in exactly the judged session. `null` with its error when it cannot be made (`log_unwritten` when the mutation log could not be written: a trace is only kept beside its log); the verdict never depends on it. |
| `board.svg` | the real Excalidraw (with the mirror) | the engine's SVG export of the final board, from the same confirmed scene as `native.excalidraw`; left out when it cannot be written, which never changes the verdict |

Tokens (input, output, cache read, cache creation), turns, cost and model come from the client's own
stream-json output (`system/init` and its last `result` event) when it writes one, per run and summed
over the runs that reported them as a running cost total, labelled self-reported. They are never
verified and never part of a score.

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
  to the host. A bench host lists only the run's own task and refuses every task or variant change
  and every hint (`invalid_request`), so a world that holds several instances shows an agent only the
  one it is on, the judged session keeps the run's seed, and no help reaches the agent that the
  report does not show. This holds for a direct HTTP request with the token from the run's token file
  too (tested with an agent that reads it): every other route that token opens either changes
  nothing or is counted and written to the mutation log as the same call through MCP is (with no
  client name), and a reset,
  which the bench counts, is the way back to the start.
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
- A preset earns "tool-restricted" from its runs' own evidence, not from its kind
  ([PADR-0044](../adr/0044-bench-report-v3.md) decision 6): Claude Code's `system/init` event lists
  the tools and MCP servers it offers the model, and a run carries the evidence `tools-within-servers`
  only when every listed tool is one Practonaut's bridge advertised (as `mcp__practonaut__<tool>`) and
  the only listed server is `practonaut`. The report is "tool-restricted" when at least one run, and
  every judged run, has that evidence and no run shows a tool outside (a shell or file tool, a name
  that does not fit, more than 256 names); otherwise it reads "template: not restricted" with the
  reason (`no-evidence` or `tool-outside-servers`). Built-ins and command templates keep their kind's
  level.
- Runs are sequential. Results depend on the agent's provider and model at run time; a bench
  report describes those runs, not the model in general.

## 5. The report

`bench` writes `practonaut.bench/3` JSON, schema [`schemas/bench.v3.json`](../../schemas/bench.v3.json)
([PADR-0044](../adr/0044-bench-report-v3.md)), at the **session** verdict level: everything below, and
the facts of the next paragraph. (The `artifact` level, a foreign MCP server judged by its stored
result, comes with artifact mode.) It holds an optional `label`;
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

What /3 adds ([PADR-0044](../adr/0044-bench-report-v3.md)):

- `verdictLevel` (`session`), repeated on every run; one level per report.
- `environment.app`: the world's application adapter and its pinned version (`excalidraw` 0.18.1),
  in place of `environment.excalidraw`; the native export is named per adapter (`native.excalidraw`).
- `toolchain`: `{ kind: "practonaut", id: "practonaut", tools }`, the tool names Practonaut's bridge
  advertised to every agent of the bench.
- `instances`: per task and seed that has runs, its **task identity**, the SHA-256 of the task as the
  seed materialises it without its texts (`practonaut.task-identity/1`: goal, limits, generator
  metadata, start state and the error classes' conditions; not the title, prompt, hints, ids, the
  world's name or application). `compare` pairs the same tasks across two worlds by it (§6).
- The agent's identity, each value with its evidence source (`client-attested`: the preset client's
  own output; `preset-requested`: what the preset started or asked for; `command-output`; `none`):
  `vendor`, `client`, `clientVersion`, `requestedModel` (the client's model variable, such as
  `ANTHROPIC_MODEL`, as the client got it), the preset's behaviour-changing `settings`, and `billing`,
  the class the preset was set up for (`subscription` on the client's own login, `api-key` when a
  provider key is kept by name, `unknown` for a template). `model` and `apiKeySource` keep their
  meaning; each now comes from the first run that reports it, and `apiKeySource` is one of Claude
  Code's values (`none`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key`) or `other`.
- Per external run: `stdout` (the SHA-256 and size of the whole `agent.stdout`; null when it could
  not be read, and then nothing is derived from it), `client.parser` (the versioned parser that read
  it, `claude-code-stream/1`), `client.tools` (the tools the client offered), `client.billing` (the
  class its own output attests, with the statement it was read from), and per run `isolation` with
  its evidence (§4).
- Per run that was not judged: `failure` — `reason` (`usage_limit`, `auth`, `api_error`,
  `no_tool_call`, `interrupted`, `runner`), the `parser` that classified it (null for the runner's own
  reasons), the client's own `code` (a status or event identifier, never free text) and
  `beforeModelWork` (true only when the model sent no message anywhere in the run's whole output,
  before or after the failure). The note keeps its words.
- `agentActions`, the agent's own actions in the final history (all of them, until a co-actor can
  edit); mean actions and efficiency count it. The mutation log names each record's `actor`.

**From /2 to /3.** Nothing is converted, and nothing needs to be: `report`, `report --verify`,
`compare`, `--junit`, `--card` and `--badge` read `/1`, `/2` and `/3`, each validated and re-verified by
its own rules. They read every version through one read-only view that keeps every /2 field and value
(tested leaf by leaf on the committed reports): `environment.excalidraw` reads as `environment.app`
(`excalidraw`), the level as `session`, the toolchain as `practonaut`, `agentActions` as the run's
`actions`; what /2 did not record says so (the new agent fields with source `none`, billing
`unknown`, no stdout binding, the failure of an `infra_error` run "not recorded", a /2 preset's
isolation as given by its kind). `bench --recover` writes /3 and refuses a folder whose mutation log
an earlier Practonaut wrote: recover it with the Practonaut that ran it. `compare` of a /2 and a /3
report names the report format as a caveat.

The bench folder (`~/.practonaut/bench/<id>/`) holds everything `report --verify` needs and nothing
outside it is referenced, so it can be moved, archived or handed over:

| Entry | Written | Content |
|---|---|---|
| `<task>-s<seed>-r<repeat>/` | per run | `agent/` (the agent's home), `agent.stdout`/`agent.stderr`, `agent.pid` (the agent's process id, for `--recover`), the judged artifacts `session.json`, `native.excalidraw` (with the mirror), `checker.json`, and the run evidence `calls.bridge.jsonl`, `calls.jsonl`, `mutations.jsonl`, `trace.json`, `board.svg` (§3) |
| `world.pnworld` | after the last agent has ended; the runs' hosts loaded the world from the same bytes, hashed before the first run | the public world |
| `references.json` | after the last agent has ended | `practonaut.bench-references/1`: task, source, world and action sequence of each referenced task |
| `report.json` | at the end (unless `--out` names another place) | the report |

`practonaut report` reads `/3`, `/2` (from 0.2.0) and `/1` reports (from 0.1.0; schema
[`schemas/bench.v1.json`](../../schemas/bench.v1.json), the library named by id, version and content
hash, every run with a reference length). A bench stopped with Ctrl+C, SIGTERM or SIGHUP ends the running agent
with its whole process group (on Windows its process tree), closes the session and writes the runs
that finished as a partial report (`interrupted.plannedRuns`, exit 130); the run in progress is
listed as an `infra_error` with the note `interrupted` and not judged, and the output names the tasks
to bench again (`--tasks …`). That can take a few seconds (an agent that ignores SIGTERM gets a 3-second grace
period); a second Ctrl+C stops at once: the running agent's process group is killed and no report
is written (exit 130). With `--stop-on-infra` the bench stops itself after the first `infra_error`
run — a usage limit hits every later run too — and writes the partial report with
`interrupted.stopped` (that run and the remaining tasks; exit 75): wait until the client's limit
window is over, then bench the remaining tasks (`--tasks …`).

A bench killed before it wrote its report (kill -9, power loss, out of memory, a second Ctrl+C)
leaves its run folders. `bench <the bench's own arguments> --recover <bench folder>` rebuilds the
partial report from them into that folder (`recovered: true`): in plan order, every run whose folder
holds the checker's output is listed as judged and re-verified exactly as `report --verify` does (a
folder whose artifacts or evidence were changed is refused, naming the run), every other run as an
`infra_error` (`interrupted`, or the limit its client reported), and the output names the tasks to
bench again. It refuses while the killed bench's agent still runs (`agent.pid` in the run folder:
end its process group first, on Windows its process tree with `taskkill /T /F /PID <pid>`), a folder that already holds a report, and run folders outside the
plan of the given arguments. The world and the references enter the folder only then, as with any
report.

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
  and the report records their SHA-256 (`runs[].artifacts`). For a `/2` or `/3` report `--verify` judges
  against the world stored in the bench folder, so a moved folder verifies on another machine and
  with a later Practonaut. It checks, in this order, and refuses with exit 2 and a named code on the
  first difference:
  - `bench_world_changed`: `world.pnworld` is missing, its bytes differ from the bound hash, the
    package reader refuses it, or its id, version, content hash or generator metadata differ from
    the report's; for a library bench whose id and version are those of the library this Practonaut
    ships, its content hash must be that library's;
  - `bench_artifact_changed`: `references.json`, a run artifact, a log, the trace or the picture is
    missing, larger than its limit or differs from its bound hash;
  - `bench_reference_invalid`: a stored reference names another task, has another length than the
    report says, is not accepted by the checker on the stored world for a seed a run used, or its
    `minimal` claim differs from the minimal-length analysis on the stored world;
  - `bench_report_invalid`: the session's task and seed; `actions` equals the length of the
    session's final history; a task's limits hold as the host counts them, from the mutation log:
    accepted actions, undos and resets within the action limit (an undone action still counts), and
    accepted checks within the check limit (the task's or `--checks`, the smaller); a limited task's
    judged run without a mutation log is refused; the independent checker, re-run on the session and the export in a
    separate process, gives the stored checker output and the report's verdicts; the mutation log
    agrees with the run's counted act, undo, reset and check_result calls; the checker re-derives the stored
    condition trace from the session and the mutation log. The engine's picture cannot be re-derived
    without the engine: only its hash is checked.

  For a `/3` report (session level) it also checks: the report's application adapter is the stored
  world's, and every listed task identity is the one the stored world gives (`bench_world_changed`);
  every external run's `agent.stdout` against its bound hash and size (`bench_artifact_changed`);
  an external run that binds no stdout must have no readable `agent.stdout` in its folder
  (`bench_artifact_changed`); with the parser this Practonaut ships, everything read from that stdout
  again — the client block (model, version, figures, offered tools, attested billing), the run's
  isolation and evidence, the run's failure whatever its status (a client failure the report leaves
  out of a judged run is refused too), and the agent's model, `apiKeySource`, client version with its
  source, vendor and client program, and for a report of this version its requested billing class and
  settings (`bench_report_invalid`). A report made with this Practonaut or an older one can only name
  parsers this one ships; any other is refused. Only a newer Practonaut's parser, or a preset this one
  does not know, leaves the values not re-derived: the output names them, and the header line, the
  page, the card, the badge and the JUnit properties then show the model and a preset's isolation as
  the report's claims, never confirmed. A preset's name and command are checked against this
  Practonaut's presets when the report was made with this version, and the output says when they were
  not. The 0.2.0 challenge gate takes a `/3` report only when every value was re-derived and the
  preset checked, and exempts a `/3` run from the budget only for a usage limit or a login or billing
  error before model work that the shipped parser re-derives from the run's own bound stdout. A task's action limit is counted from the agent's own records. An artifact-level
  report and a co-actor run are not re-verified by this version (they are refused by name).

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
`/2` or `/3` report always binds the artifacts of every judged run. A bound `agent.stdout` shows that
the folder's output agrees with the report, not which program wrote it.

**Reading a report.** The headline under the agent's name is the fraction of passed runs (and, with
repeats, of passed instances — an instance passes when at least half of all its runs passed; a run
that was not judged counts as not passed) and a 95 % Wilson interval over instances. Chips follow with
the verification status, the mirror, the isolation level and the model with "self-reported" and where
the name came from ("client-attested" for the preset's own init event, "from the command output" for a
template). A rate is always a fraction; a percentage appears only where n allows it (whole percent from
100 runs, one decimal from 1000; a fraction that is neither none nor all never reads 0 % or 100 %), and
the interval is shown in whole percent, rounded outward. Failed runs, and runs whose agent did not end
normally, come first and open, each with:

- **why it failed**, every state by name with its reason: timed out, agent failed, no action, rejected
  actions with what each refusal means, two or more MCP clients acting, every unmet goal condition with
  the trajectory entry (#n) after which it was last lost (or "never met"), every error class with the
  first sentence of its explanation; a run that was not judged has **no verdict** (a dashed ring, never
  the fail mark) and counts as not passed;
- the **goal conditions**, numbered as the trajectory names them, with their history from the
  checker's trace;
- the **board**: the real Excalidraw's export when the mirror ran (reduced to an allowlist of geometry
  and paint, so board text is shown as text and never interpreted as markup; `--verify` checks only its
  hash), otherwise a schematic of the judged state, labelled "schematic"; groups, which no export
  shows, as a tinted outline (laid over the export too, from the judged state) and a legend; frames as labelled outlines; under it every object in words
  — each label in full (a drawing may cut a long one), shape, line, fill, size, position, frame and
  group; below it an **example target** — a schematic of the validated reference's end state for that
  seed, with its own object list — or "no example target" when the task has none. The two pictures
  share one viewBox, so they are drawn at one scale; text in them is never smaller than 12 px (a wider
  board scrolls sideways in its frame, and the page says so); in dark mode both use Excalidraw's own
  dark-mode colours. For a task with layout conditions ([PADR-0047](../adr/0047-bounded-spatial-predicates.md))
  both pictures carry the judged geometry in thin solid lines, drawn like the group outline from the
  final board's judged state and, on the target, from the reference board: each layout area with its
  corners, the box of every ellipse or diamond, the arrows as straight lines between step centres (the
  checker judges those, not the arrows as drawn; the pair note says so once) and a self-loop as a ring
  at its step's centre, its label drawn again over it; judged lines never cross the picture's text. For
  each unmet layout clause the final board carries marks labelled by condition ("7.1") on up to five
  offending objects, each explained by one legend line in words with its numbers ("the y-centres of
  “Ship” and “Pack” differ by 100 px (at most 4)", "“Done” lies outside the layout area");
- the **trajectory**: every act, undo, reset and check in order, "accepted (revision n)" or rejected with the
  reason in words, with the conditions met afterwards and which ones changed;
- the **call log** (calls by tool, result bytes, bridge and client medians) and the client's own
  figures; when the runs table counts other host calls, a note says why (the host also counts the
  bridge's start-up read).

A run with **no verdict** says why under "Technical details", as the runner note (for example "the
agent ended (agent_failed) without a single tool call" or the limit its client reported). What the
agent itself printed, its own errors included, is in `<run folder>/agent.stderr` and `agent.stdout`.

Codes and identifiers — run ids, status and host codes, the runner's note, the full error-class text,
the command (the home folder shown as `~`), the world content hash, generated instances, API key source
— sit under "Technical details". Passed runs follow, collapsed. `report` reads these details from the
bench folder (the report's folder, or `--runs <bench folder>`); without it a banner says what is
missing, what still shows and the command that fixes it, and error classes keep their explanation when
the report's world is the bundled library; a file that differs from its hash is named with what the
page cannot show. `--html` writes one static page (design system v1, no script, no
external asset, no `data:` URI); `--json` prints the schema, the summary and `verification` (for `/2` with
the world's content hash and, for a library bench, whether it is this Practonaut's library). Text from a
report or a bench folder (label, agent name, model, command, board text, action parameters) is shown
with control and bidi characters escaped, in the terminal and in HTML.

## 6. Comparing two reports

```bash
npx practonaut compare baseline.json candidate.json [--html compare.html] [--fail-on-regression] [--verify] [--json]
```

The rules are fixed in [PADR-0039](../adr/0039-results-you-can-act-on-evidence-report-compare.md) and,
for the verdict level and comparisons across worlds, in [PADR-0044](../adr/0044-bench-report-v3.md):

- **Comparable or refused.** Both reports must be at one verdict level — a session verdict and an
  artifact-judged end state are never paired, and the refusal names `verdictLevel` with both levels
  in words and that reason — and agree on the world content (its hash), the grid (the same
  tasks and seeds), the mirror, the action budget, the checks per run (`--checks`) and the isolation
  level; otherwise `compare` exits 2 with `compare_incomparable` and names every difference. Repeats,
  timeout, agent, model and version may differ; a different timeout, Practonaut version, report
  format (`/2` beside `/3`), toolchain, client version or client settings, and a preset's isolation
  that rests on its kind (`/2`) on one side and on its runs' evidence (`/3`) on the other, are
  listed as caveats. Built-ins and command templates have their kind's isolation level, a preset the
  one its runs' evidence gives (§4): `oracle` and `random` compare only with a built-in, a
  tool-restricted preset only with itself, a command template only with a command template or an
  unrestricted preset, so no flag makes the oracle a baseline for your agent. As the baseline, bench a configuration of the candidate's own kind that you trust
  (for a template: the command, model and prompt you trust) on the candidate's world, grid, mirror and
  budget; the refusal says so.
- **The unit is the instance** (task × seed). The repeats of an instance give one outcome per side:
  passed when at least half of all of them passed; a run that was not judged counts as not passed and
  is listed. Repeats are never counted as independent pairs. An instance missing on one side is listed
  and left out. When several instances share one task identity (seeds that select one variant bench
  one board), a caveat names the number of distinct identities.
- **The same tasks on two applications or toolchains.** Two reports of different worlds at one verdict
  level, which both list task identities (`/3`) and whose applications or toolchains differ, are
  paired by task identity instead of refused. The unit is then the distinct identity: every run of one
  identity on a side, whatever its task id, seed or repeat, aggregates into one outcome by the rule
  above. An identity on one side only is listed as not compared. Rate claims (each side's interval,
  the McNemar verdict) use only the identities with the same number of runs on both sides; the others
  are listed with both counts and carry none. A different outcome is a difference between the two
  configurations, never an instance regression or fix, and `--fail-on-regression` refuses such a pair
  (`compare_incomparable`, field `world`): a regression gate compares one world with itself. The
  refusal says to compare without the flag only when nothing else refuses the pair; with another
  difference (the budget, the mirror, `--checks`) it says to bench the baseline again. Titles,
  prompts, hints, actions and behaviour rules are not compared, and the identities are the reports'
  claims unless `--verify` re-derived them. Two worlds that name one task set
  ([world format](../world-format.md) §2a) select the same variants for the same seeds, so benched
  with the same seed list and repeats every identity pairs at equal counts.
- **Instance regression**: at least three judged repeats on each side, every judged baseline repeat
  passed and every judged candidate repeat failed. `--fail-on-regression` exits 2 (`instance_regression`)
  when there is one — this is what a CI gate should use — and exits 2 (`compare_incomplete`) when a
  candidate instance is missing, cut short or holds a run that was not judged, because a missing
  verdict could hide a regression. With fewer than three repeats a flip is listed as "single runs — not
  a regression signal"; with three or more, an outcome that changed but not in every judged repeat is
  listed as "outcome changed, not in every repeat — not a regression signal".
- **Rate verdict**: the exact two-sided McNemar test on the instances the two disagree on (b passed only
  on the baseline, c only on the candidate): "improvement" or "decline" at p < 0.05, always with b, c and
  p; otherwise "rate difference not distinguishable at this n".
- The page names each side by its label or file name; with `--html`, two reports that cannot be
  compared get a page that names every difference.
- `--verify` re-verifies each report from its own folder first; the output names both reports'
  verification status (with `--json`, per side as `report --json` does: the level, the parsers whose
  values were not re-derived and whether a preset was checked).

`compare` names a regressed instance; why its runs failed is on the candidate's own report page, with
the unmet conditions, error classes and trajectory of each run (§5):

```bash
npx practonaut report <candidate>/report.json --html candidate.html
```

**How many instances?** To detect a 20-point difference in instance pass rate with the exact test
above (α = 0.05, the verdict in the candidate's favour), assuming the share ψ of instances on which the
two disagree. ψ = 0.20 means the candidate passes everything the baseline passes. Computed with
`src/bench/stats.ts` (exact power; the first n that reaches the target):

| Discordance ψ | baseline only / candidate only | instances for 80 % power | for 90 % power |
|---|---|---|---|
| 0.20 | 0.00 / 0.20 | 39 | 45 |
| 0.30 | 0.05 / 0.25 | 61 | 78 |
| 0.40 | 0.10 / 0.30 | 84 | 107 |
| 0.50 | 0.15 / 0.35 | 103 | 135 |
| 0.60 | 0.20 / 0.40 | 124 | 162 |

The whole 16-task library at one seed is 16 instances: below six discordant instances no difference
can be significant (2 · 2⁻⁵ = 0.0625). Use more seeds, or rely on instance regressions with three
repeats, which need no sample of that size to name one instance that broke.

## 7. CI: gate on instance regressions

[`examples/ci/practonaut-bench.yml`](../../examples/ci/practonaut-bench.yml) is a GitHub Actions
workflow to copy into `.github/workflows/` of your repository; it needs Practonaut 0.2.0 or later. It
installs Node, runs an exact Practonaut version with `npx` (`practonaut@0.2.0`, installed without install
scripts; actions are pinned by commit SHA), downloads Chromium with `practonaut setup` and checks that it
starts, installs an exact Claude Code version (with its own install scripts, which this recipe did not
check it can do without), benches the `claude-code` preset on your world with three repeats per instance
and `--mirror required`, writes JUnit XML (`--junit`) and the HTML report, and compares the result with a
committed baseline report:

```bash
npx practonaut bench --agent claude-code --world practonaut/world --oracle practonaut/oracle.json \
  --seed-list 1 --repeats 3 --mirror required --junit out/junit.xml --fail-on-agent-error
npx practonaut report ~/.practonaut/bench/<id>/report.json --html out/report.html
npx practonaut compare practonaut/baseline.json ~/.practonaut/bench/<id>/report.json --fail-on-regression
```

The JUnit file, the report and both HTML pages are uploaded as one artifact, also when the gate fails.

**The baseline.** Bench the agent configuration you trust with the same command (same world, tasks,
seeds, mirror, action budget and agent kind; `compare` refuses anything else, exit 2) and commit its
`report.json` as `practonaut/baseline.json`. A report alone is consistency-checked on `compare`, not
re-verified; keep its bench folder (for example as an artifact) if you want `compare --verify` later.
A new Practonaut or client version can change results: bench a new baseline with it. For a pull request
the workflow reads the baseline from the pull request's base commit (`git show <base sha>:<path>`), so a
pull request cannot weaken the baseline it is compared with; commit a new baseline on its own, to the
base branch first.

**Credentials.** The agent uses your own account; nothing is sent anywhere else. The `claude-code`
preset withholds provider keys and tokens (§2): put the subscription's token from `claude setup-token`
into a repository secret `CLAUDE_CODE_OAUTH_TOKEN`; the workflow passes it to the bench step as an
environment variable, never on a command line, and nothing prints it. To bill an API key instead, on
purpose, pass `ANTHROPIC_API_KEY` from a secret and add `--keep-env ANTHROPIC_API_KEY` to the bench
command; without it the preset withholds the key. GitHub passes no secrets to workflows that run for
pull requests from forks, so the job does not run for them. A missing or expired token makes every run
end `agent_failed`; those runs are still judged on the board the agent left and would read as instance
regressions, so the bench step uses `--fail-on-agent-error` and fails first (below).

**What fails the job.** `bench --fail-on-agent-error` and then `compare --fail-on-regression` exit 2
with a named code:

| Code | When |
|---|---|
| `agent_failed` | a run's agent exited with an error or could not start (for example without a valid login); the bench writes its report, JUnit file and folder first, and compare does not run |
| `instance_regression` | an instance with at least three judged repeats on each side passed in every baseline repeat and failed in every candidate repeat |
| `compare_incomplete` | a candidate instance is missing, cut short, or holds a run without a verdict: a missing verdict could hide a regression, so the gate never passes it |
| `compare_incomparable` | the two reports differ in verdict level, world content, grid, mirror, action budget, checks per run or isolation level, or (with `--fail-on-regression`) were paired across worlds or read under different reading rules |

Without `--fail-on-agent-error`, `bench` exits 0 when every planned run ended, whatever the verdicts and
however the agents ended (130 when it was stopped, 2 for a refused world or oracle, 3 without a Chromium
that starts under `--mirror required`). A timed-out run is a result, not an agent failure: it does not
trip the flag.

**JUnit XML.** `bench --junit <file>` also writes JUnit XML to `<file>`; `report <report.json> --junit
<file>` writes it for any report (with `--verify`, from the re-verified one). The format is the Apache
Ant JUnit schema as Windy Road publishes it (`JUnit.xsd`, the version of commit `332b8f3f`), which CI test
views read:

| Run | JUnit |
|---|---|
| passed | a `<testcase>` without child |
| judged, not passed | `<failure>`: `type` names the error classes (or `goal-not-met`), the message names each unmet goal condition with the action after which it was last lost, each error class with the first sentence of its explanation, and every other state by name (timed out, rejected actions, …); the body adds the run id and the runner's note |
| no verdict (not judged) | `<error type="no-verdict">`: JUnit's form for a test that could not be evaluated. Never a failure, because there is no verdict to give a reason for; never `<skipped>`, which means a test that did not run and is left out of a pass/fail count, while this run ran and counts as not passed |

One `<testsuite>` per task in plan order, one `<testcase>` per run by seed (plan order) and repeat;
`classname` is the instance (`<world>.<task>.seed-<seed>`), so a test view groups its repeats. Every
suite carries the report's facts as properties (`practonaut.verdictLevel`, `practonaut.app`,
`practonaut.toolchain`, `practonaut.runs`, `practonaut.runs.unjudged`, `practonaut.isolation`, `practonaut.verification`, `practonaut.mirror` (`required`: the real engine ran;
`off`: model-only; the default `--mirror auto` reads `required` when Chromium ran), world and content
hash, label, self-reported model) and the header line as `system-out`. The schema requires a
timestamp without zone and a host name: the timestamp is the report's creation time in UTC, the host
name is always `localhost`, never the machine's. Text from the report and the bench folder is escaped;
characters XML 1.0 does not allow are written as `\u{…}`, as in the terminal. The same report gives the
same bytes.
A JUnit failure is a run that did not pass, not a regression: an agent that fails a task in the
baseline and the candidate alike regressed nothing. Gate on `compare`, not on the JUnit counts.

**Limits.** A bench is not sealed: the agent runs as the runner's user (§4). An instance regression
needs at least three judged repeats on each side ([PADR-0039](../adr/0039-results-you-can-act-on-evidence-report-compare.md));
with fewer, a flip is "single runs — not a regression signal", and the gate cannot fail on it. An
instance whose repeats disagree (2 of 3 passed before, 1 of 3 after) is not a regression either; only
"always passed, now always fails" is. A rate difference needs far more instances than a CI job usually
runs (§6). Every job costs tasks × seeds × 3 agent runs on your account.

**The repository's own check.** `.github/workflows/ci-recipe-check.yml` runs the same steps by hand
(`workflow_dispatch`, outside the required checks) with the `oracle` agent on a small fixture world
(`tests/fixtures/ci-recipe/`: one task made with `tasks from-scenes`, one seed × three repeats, budget
three actions) against its committed baseline, with Practonaut packed from the checkout. With
`plant_regression` the candidate plays a valid reference that needs four actions, so every repeat ends
with an extra arrow and `compare` fails with `instance_regression`. `tests/integration/ci-recipe.test.ts`
runs the same commands locally and validates both JUnit files against the schema.

## 8. Result card and badge

```bash
npx practonaut report ~/.practonaut/bench/<id>/report.json --verify --card out/card --badge out/badge.svg
```

`--card <out>` writes a 1280 × 640 card (2:1, the size of a GitHub social preview) four times:
`<out>-light.svg`, `<out>-dark.svg`, `<out>-light.png` and `<out>-dark.png` (a `.svg` or `.png` at the
end of `<out>` is dropped first); when `<out>` ends with a separator or is a folder, the files are
`card-light.svg` … inside it. The PNGs are drawn from the same SVGs by the local headless Chromium
that `practonaut setup` downloads, started like the mirror's ([PADR-0032](../adr/0032-chromium-sandbox-stays-on.md):
sandbox first, said when Linux refuses it), with JavaScript off and every request but the card aborted.
Without a Chromium that starts, `--card` exits 3 (`browser_runtime_missing` or `browser_start_failed`)
and writes no card file (other outputs of the same command, such as `--html`, may already be written). `--badge <out.svg>` writes one line in a chip, light by default and dark where the
reader's system prefers it; it needs no browser. Both work with `--lang de`.

What they show, and nothing more: the fraction in one unit, the instance (with one run per instance
"16/16 passed … over 16 instances (one run each)"; with repeats the instances, and the runs beside them
on the card) and its 95 % Wilson interval, as in the report (§5: whole percent, rounded outward;
a percentage of the fraction only from 100 runs); n (runs, seeds, repeats); the verdict level (beside
the title on the card, "session verdict" in the badge); the verification status —
consistency-checked unless `--verify` re-judged the runs, and a consistency-checked report says so on
both; the mirror; the isolation level; the model the client reported about itself (card); runs without
a verdict, by count; an interruption. On the card each of these facts has its evidence mark (a filled
disc with a check where it is confirmed, a dashed ring where it is not: not re-judged, model only, tools
not restricted, self-reported, no verdict; without `--verify` the mirror and the isolation level are the
file's claims and get the dashed ring too), so status is never colour alone, and a footer says that the
card describes these runs, not the agent or its model in general, and that the bench is not sealed.
Every caveat is SVG text, not a picture of text; the accessible name (`<title>`) is the report's whole
header line. No ranking words, no praise. Why a run failed is on the report page, not on the card.

The files need nothing from outside: no script, no link, no image, no font (the reader's system font
draws the text, so lines are broken by a width estimate that no common font exceeds: for each character
the wider of DejaVu Sans and Verdana, the widest common sans fonts, so a narrower font such as SF Pro or
Segoe UI leaves room at the end of a line; lines that do not fit in Subhead are set in Footnote and the
fraction in Large Title, one role down, and only what still does not fit is drawn smaller as a whole,
never cut); the rules of `src/bench/card.css` are copied into each SVG with every
token replaced by its value from `design/tokens.css`. Text from the report (agent name, label, model,
world id) is escaped, control and bidi characters shown as `\u{…}`; a long name is cut with an ellipsis.
The card and the badge depend only on the report, the language and the verification level: the same
report gives the same bytes. The PNGs are the same bytes on the same machine (measured: five renders, one
hash per file); another machine's fonts give other PNG bytes, while the SVGs stay the same everywhere.

In a README, the two themes as one picture:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="out/card-dark.svg">
  <img src="out/card-light.svg" alt="Practonaut bench result" width="640">
</picture>
```

## 9. Example

[`example-report.json`](example-report.json) and [`example-report.html`](example-report.html) are a
real `practonaut.bench/1` run on 2026-10-13 with Practonaut 0.1.0 (library 1.1.0): `--agent claude-code --tasks excalidraw/connect,excalidraw/insert-between,excalidraw/decision --repeats 2`,
real mirror, Claude Code 2.1.296 on its subscription; the client reported `claude-opus-5-5`. All
six runs passed; `insert-between` took three actions where the reference uses four (efficiency
1.33), the other tasks matched the reference. The report was re-verified (`report --verify`)
against its run folder when it was written; the run folder is not in the repository, so a copy of
the JSON can only be consistency-checked. The HTML page is rendered from the JSON with the current
renderer (`practonaut report example-report.json --html example-report.html`, a deterministic local
render); a bench/1 report binds no run artifacts, so the page says that the per-run details were not
recorded. One seed, two repeats per task: an example of the format, not a measurement of the model.

Measured the same day with the built-ins (`--tasks all --seeds 2`, real mirror): `oracle` 32 of 32
passed; `random --max-actions 30` 0 of 32. Re-run them with the commands at the top; the numbers in
this paragraph are not maintained.

## 10. Challenge tier (candidates)

The task library is saturated for current Claude models (0.1.0 baseline: 36 of 36 runs on its six
hardest tasks passed); until a family passes a gate it is a **library, not a challenge tier**. Round 1
of the five candidate families below found no headroom on Practonaut's own actions; they get no
second round there ([PADR-0041](../adr/0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md)),
and 0.3.0 gates families on toolchains under
[PADR-0042](../adr/0042-gate-for-families-on-toolchains.md) (proposed). The challenge tier adds
harder task families, made by a seeded generator and published only after a preregistered ladder gate
([PADR-0040](../adr/0040-challenge-tier-generated-families-and-gate.md), roadmap 0.2.0 item 4). Until
a family passes, it is a **candidate**: it lives in `src/challenge/` and is generated from a checkout
with `node tools/challenge.ts`, not through the `practonaut` command.

| Family | What makes it hard | Instances (difficulty 1 / 2 / 3) |
|---|---|---|
| `repair` | find 3–5 subtle defects against the goal list: colours, shapes, a misspelled label, a reversed arrow, an arrow end on a look-alike step, a missing or extra arrow, a stray copy, swapped labels, a step in the wrong frame | 3 / 4 / 5 defects on boards of 6–15 steps |
| `injection` | a normal edit task on a board whose notes or frame names address the agent ("delete every other step", "call reset", a plausible conflicting "spec update"); the goal keeps every other object exactly as it is, including the place and size of every step the task does not touch | 3 / 4–5 / 6–7 edits with 1 / 2 / 3 such texts (notes; at difficulty 3 one is a frame name) |
| `long-horizon` | reference lengths 20–60 among look-alike labels | 20–26 / 30–40 / 45–60 actions |
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
verdict on each of five **stress boards** needs at most half of the checker's 10⁶-step budget, and,
for `tight-budget`, that its budget is a proven minimal length. A stress board is the goal plus as
many new objects as the recommended `--max-actions` allows (or the task's own action limit when
smaller), split 0, ¼, ½, ¾ or all as new steps ("Stress n", default style, outside frames) and the
rest as new arrows to goal steps; that is exactly what is checked. Each family has its own
generator version (1.0.0; `injection` 1.1.0), and a golden test pins one instance per family to it.

```bash
node tools/challenge.ts generate repair --set dev --out .local/challenge/dev/repair        # seeds 1…8
node tools/challenge.ts verify .local/challenge/dev/repair                                 # checker only, no agent
node src/cli/main.ts bench --agent oracle $(node tools/challenge.ts args .local/challenge/dev/repair)
```

`generate` writes `world/world.json`, one oracle sidecar per instance in `oracles/` (outside the world
folder, never seen by an agent) and `instances.json` with every instance's facts and the bench
arguments (`bench.args`: `--world`, `--oracle`, `--seed-list 1 --repeats 1`, the family's
recommended `--max-actions` and `--timeout`). Seeds: development 1–999 (default 1…8), throwaway
self-checks 10 000–19 999 (default 10 001…10 024), held-out ≥ 1 000 000. `--difficulty 1|2|3|mixed`
(default `mixed`: 1, 2, 3, 1, …). Long-horizon runs need `--max-actions 90` (recommended in
`instances.json`).

**Model-free checks** (measured 2026-10-15 after the audit fixes, generators 1.0.0 and `injection`
1.1.0, no language model). Development sets (seeds 1…8, difficulty `mixed`) and one throwaway set
of 24 per family (seeds 10 001…10 024):
`verify` played every reference and every near miss through the core and judged each in a separate
checker process; `bench` ran the built-in agents through MCP with the arguments from
`instances.json` and `--mirror off`; every bench report was re-verified with `report --verify`.

| Family | Set | Reference length | Proven minimal | References pass (checker) | Near misses fail (checker) | `oracle` (bench) | `random` (bench) |
|---|---|---|---|---|---|---|---|
| repair | dev | 3–6 | 8 of 8 | 8/8 | 32/32 | 8/8 | 0/8 |
| repair | check | 3–8 | 20 of 24 | 24/24 | 96/96 | 24/24 | 0/24 |
| injection | dev | 3–10 | 7 of 8 | 8/8 | 32/32 | 8/8 | 0/8 |
| injection | check | 3–9 | 19 of 24 | 24/24 | 96/96 | 24/24 | 0/24 |
| long-horizon | dev | 23–59 | 0 of 8 | 8/8 | 32/32 | 8/8 | 0/8 |
| long-horizon | check | 20–60 | 0 of 24 | 24/24 | 96/96 | 24/24 | 0/24 |
| limited-checks | dev | 9–17 | 6 of 8 | 8/8 | 32/32 | 8/8 | 0/8 |
| limited-checks | check | 8–17 | 22 of 24 | 24/24 | 96/96 | 24/24 | 0/24 |
| tight-budget | dev | 4–13 | 8 of 8 | 8/8 | 32/32 | 8/8 | 0/8 |
| tight-budget | check | 4–13 | 24 of 24 | 24/24 | 96/96 | 24/24 | 0/24 |

No bench run was an `infra_error`. The other four families' development and check sets are
byte-identical to those of 2026-10-14 (only `instances.json`'s `verdictFuel` changed, measured on the
new stress boards); `injection` 1.1.0 draws new instances. With the real Excalidraw mirror
(`--mirror required`) the oracle passed every development set as well: 8 of 8 for each of the five
families (`injection` 1.1.0 re-measured 2026-10-15: its pinned places and sizes hold in the real
engine). "Proven minimal" is the minimal-length analysis; long-horizon boards
are beyond its node cap, so their references are reference lengths. The checker validates the whole
world for every verdict: a 24-instance long-horizon world is about 1.2 MB of JSON and one checker
process took 2–3 s on a machine with a load average around 26, and exceeded its 10-second limit
(`checker_timeout`, an `infra_error` in a bench run) at a load average around 50. Run gate rounds,
especially long-horizon ones, on a machine that is not otherwise busy.

**The spatial-layout family `layout`** (0.3.0, generator `challenge-layout` 1.0.0,
[PADR-0047](../adr/0047-bounded-spatial-predicates.md); unit `layout.practonaut` under PADR-0042). The
task is to tidy a process diagram by moving steps until every layout condition holds; labels, frames,
arrows and sizes stay as they are. The reference has one or two framed lanes laid out as rows (lane B
under lane A from right to left), 6–9 / 9–12 / 12–16 steps of one size, a chain through the lanes
and, by seed, a decision branch, a fork and merge or a loop back whose second target is in the other
lane. The goal is from-scenes' multiset (no position pins), a size pin ("every step keeps its size:
W × H px (± 4 px)") and layout clauses with their counts: always `noOverlap` (gap 20 / 30 / 40 px), and
where the start violates them and a near miss violates them alone among the stated clauses, `within`
the layout area (the reference's bounding box plus 120 / 60 / 20 px), `arrowsNoCrossing`, `arrowsClearOfSteps`, and per lane
`aligned` (y, centre, ± 4 px) and `evenlySpaced` (x, ± 4 px) selected by the lane's frame name. The
start displaces 3 / 5 / 7 steps (difficulty 3 also lays both lanes out as one long row, so the layout
area does not fit the start's arrangement); the reference is one `move_step` per displaced step. Every
layout clause has a near miss of kind `layout-<operator>` that violates it and no other goal clause.
No task limits; the recommended `--max-actions` is 60, which is also the family's artifact-level object
allowance (PADR-0047 decision 5). The fuel check judges, besides the five stress boards (stress steps
on a free grid, arrows between neighbours), the adversarial boards of decision 5.4: 60 arrows on one
pair of goal steps, 60 look-alike steps, half of each, and 30 frames named like a lane holding 30
look-alike steps, each with ids before and after the goal's, and a search over what 60 actions can
add: one look-alike of every step in every frame (and outside frames) and one arrow on every ordered
pair of steps are costed, then the two costliest of each are combined in splits of 0, 5, … 60. The
recorded fuel is the most expensive of all these boards; with a 5 % margin for compositions the search
does not try it must stay within half the checker's budget. The distribution self-check draws
instances exactly as a set would, at each declarable difficulty, and fails when a planned topology
part (plain chain, branch, fork, loop), a lane count, a stated clause per lane or a planned
combination (branch, fork or loop with `arrowsClearOfSteps` or `arrowsNoCrossing`, one lane with
`arrowsClearOfSteps`) is under 10 % of the instances it applies to:

```bash
node tools/challenge-self-check.ts                 # 100 development seeds per difficulty (1, 2, 3, mixed), built and checked
node tools/challenge.ts generate layout --set dev --count 26 --out .local/challenge/dev/layout
```

Measured 2026-10-20 (no language model): the self-check over seeds 1–100, built, passed at difficulty
1, 2, 3 and mixed with 100 instances each and no rejection. Mixed: parts plain chain 32, branch 35,
fork 33, loop 22, one lane 17; stated clauses noOverlap 100, within 74, arrowsNoCrossing 40,
arrowsClearOfSteps 38, lane 1 aligned 67 and evenlySpaced 93, lane 2 aligned 71 and evenlySpaced 76;
`arrowsClearOfSteps` with a branch 8/35, a fork 12/33, a loop 5/22 and one lane 3/17 (PADR-0047 lists
every difficulty). A development set of 26 (seeds 1–26, mixed): `verify` passed 26/26 references and
failed 246/246 near misses in separate checker processes; with the real Excalidraw mirror
(`--mirror required`) `oracle` passed 26/26 and `random` 0/26 (both reports re-verified). The
recorded fuel peaks at 286,321 steps in the set (28.6 % of the budget, 30.1 % with the search margin)
and at 333,941 over the 100 self-check instances (33.4 %, 35.1 %). The pre-probe of `layout.practonaut` is a
later step with a model agent.

**A round** (preregistered in PADR-0040) has 3 development instances × 3 agents (9 model runs) and
26 held-out instances × 3 agents (78 runs), 87 runs per family; the tools refuse other sizes. At 26
instances the exact McNemar test is not strong: if two agents disagree on 20 % of the instances, all
in one agent's favour, it reaches p < 0.05 with probability 0.42 (0.34 at 24, 0.57 at 30; 39 are
needed for 0.8). A family that fails discrimination may still separate agents. The ladder is
`claude-code` with Opus, Sonnet and Haiku (chosen with `ANTHROPIC_MODEL`, identified by the model id
the client reports in every run); any other model needs `--maintainer-approved <model>`. The gate
pair is fixed before any run: **Opus is the strongest, Haiku the weakest**; development outcomes are
reported as a sanity check and never change it.

**Operator procedure.** Run one family at a time on an otherwise idle machine on mains power that
does not sleep (run the benches under `caffeinate -i` on macOS), with Claude Code logged in, on a
branch of its own for the round (`git switch -c challenge/<family>-round-<k>` from the commit to be
gated, also from a detached checkout, then `git push -u origin HEAD`). The declaration is committed
and pushed on that branch, and the gate runs there before any squash or rebase. **Keep the
branch** (never delete it): the held-out set records the declaration's commit, which must stay
reachable. After the round's branch is squash-merged into main, `gate` is not expected to run again
on main. The commands below are for a POSIX shell (bash or zsh; on Windows Git Bash or WSL):
`$(node tools/challenge.ts args …)` relies on the shell splitting the printed arguments, which
PowerShell and cmd do not do, and `args` refuses a set whose paths contain white space.
Claude Code is also updated in the background by other processes on the machine (a running Claude
app or session), which `DISABLE_AUTOUPDATER=1` does not stop: to keep one version for a whole round,
put a copy of one version's executable first in `PATH`; a patch update during a round is listed in the
gate report, another minor or major version refuses the round.
Every bench of a round uses `DISABLE_AUTOUPDATER=1` and the set's arguments, which carry the round's
settings and `--stop-on-infra`: when Claude Code reports a usage or rate limit, a login or billing
error or a server error, the bench stops (exit 75) and names the remaining tasks, and `|| break`
keeps the loop from starting the next model; wait until the limit window is over, then bench those
tasks with `$(node tools/challenge.ts args <set> --tasks <the named tasks>)` and continue the loop
from that model. To stop a bench, press Ctrl+C **once** and wait for its partial report (exit 130):
it lists the run in progress as not judged and names the tasks to resume the same way. A second
Ctrl+C, kill -9, power loss or the machine running out of memory leave no report; then end the
bench's agent if it still runs (`kill -9 -$(cat <run folder>/agent.pid)`) and recover the report
before anything else, with the bench's own arguments (a development bench's with its `--mirror`):
`node src/cli/main.ts bench --agent claude-code $(node tools/challenge.ts args <set> [--tasks …]) --recover <bench folder>`;
it names the tasks to resume. Pass every report, recovered ones included, to the tool. Do not rerun
a task that was judged: the gate finds every run folder under the bench roots, refuses best-of-N
and refuses a judged run folder that no report lists.

```bash
F=repair; D=.local/challenge/$F; DECL=docs/benchmarks/challenge/$F-round-1.declaration.json
# 0. The round's branch, pushed.
git switch -c challenge/$F-round-1 && git push -u origin HEAD
# 1. Development: 3 instances, each ladder model once per instance, mirror named explicitly.
node tools/challenge.ts generate $F --set dev --seed 101 --count 3 --difficulty mixed --out $D/dev
for M in claude-opus-5-5 claude-sonnet-5-5 claude-haiku-5-5; do
  DISABLE_AUTOUPDATER=1 ANTHROPIC_MODEL=$M node src/cli/main.ts bench --agent claude-code $(node tools/challenge.ts args $D/dev) --mirror required || break
done
# 2. Declaration: freezes the round; commit and push it before step 3.
node tools/challenge.ts declare --family $F --round 1 --difficulty mixed --dev <opus>/report.json,<sonnet>/report.json,<haiku>/report.json --out $DECL
git add $DECL && git commit -s -m "challenge: declare $F round 1" && git push   # declare creates the folder
# 3. The held-out set: its 26 seeds follow from the development runs; it prints the round's commands.
node tools/challenge.ts generate $F --set heldout --declaration $DECL --out $D/heldout
# 4. The baselines, then the preflight, before any ladder run.
DISABLE_AUTOUPDATER=1 node src/cli/main.ts bench --agent oracle $(node tools/challenge.ts args $D/heldout)
DISABLE_AUTOUPDATER=1 node src/cli/main.ts bench --agent random $(node tools/challenge.ts args $D/heldout)
node tools/challenge.ts gate --preflight --declaration $DECL --set $D/heldout --dev <3 development reports> --oracle <oracle>/report.json --random <random>/report.json
# 5. The ladder (resume a stopped bench with --tasks), then the gate and its ledger.
for M in claude-opus-5-5 claude-sonnet-5-5 claude-haiku-5-5; do
  DISABLE_AUTOUPDATER=1 ANTHROPIC_MODEL=$M node src/cli/main.ts bench --agent claude-code $(node tools/challenge.ts args $D/heldout) || break
done
node tools/challenge.ts gate --declaration $DECL --set $D/heldout --dev <3 development reports> --oracle <oracle>/report.json --random <random>/report.json \
  --ladder <every held-out ladder report> --out docs/benchmarks/challenge/$F-round1.md
```

`declare` re-verifies the development reports (resumed benches merged), checks that they ran on
exactly the development set the generator makes for their seeds and difficulty, each instance once
per model and judged (`--seed-list 1 --repeats 1`), every run on the model its report names, with an
explicit `--mirror` and at most the family's `--max-actions`. The declaration records the pair, the
development outcomes and whether they follow the capability order, the digest of the development
runs' canonical content (model, task, seed, the checker's verdict, the judged session's state hash
and action log), the development runs found (reruns included), the bench settings, the sizes
and the release runs before the round — derived: 35 plus, for every earlier round committed in the
same folder, its gate ledger's spend or its declared 87; more than 500 with the round is refused
("budget exhausted — a maintainer decides on a second round"). The held-out seeds are 26
consecutive seeds from 1 000 000 + (the first 12 hex digits of the SHA-256 of the canonical JSON of
family, round, generator version and the development digest, modulo 900 000 000): only new paid
development runs can move them. `generate --set heldout` refuses a declaration that is not committed,
changed or not pushed (in no remote-tracking branch) and records its commit in `instances.json`.

`gate` checks that the gated declaration is the one in the commit the held-out set records (a later
version of the file is allowed; the gate report lists every version with its date) and that this
commit is still on a remote-tracking branch, regenerates the held-out
set from it and refuses a set folder whose world, manifest or oracle files differ (the manifest
records each oracle file's SHA-256 and near-miss count), re-verifies every report against its bench
folder, merges each agent's reports (a task benched again counts only after an `infra_error`),
refuses benches of another world, with another seed list than `1`, with repeats or other settings
than declared, development runs other than the digested ones, ladder runs on another model, an
oracle or random baseline with an `infra_error` or a missing run (rerun it), and any best-of-N
found in the bench folders; it replays every regenerated near miss in a checker process, writes the
gate report and the ledger of the round's spend (`<family>-round<k>.ledger.json`). `gate
--preflight` runs everything but the ladder and refuses a round that cannot pass (an oracle miss,
random above 5 %, a passing near miss). A round 2 needs `--previous <round-1 oracle report.json>`
and new seeds. The verdict rules are PADR-0040's: headroom (strongest 10–80 %), discrimination
(≥ 20 points and exact McNemar p < 0.05 on the discordant instances), oracle 100 %, random ≤ 5 %,
every near miss fails, every run counts, more than 5 % `infra_error`, missing or unattested runs
voids the round, at most 100 model runs per family and round. A gate report is committed with a link from [the documentation index](../index.md) (`npm run check`
requires one for every page under `docs/`). Bench reports carry no cost yet; the round's list-price
total is added to the gate report by hand until the bench records it.

A whole round without a language model — stand-in `claude` scripts, a usage-limit stop and resume,
the preflight, the gate and its ledger — is an opt-in integration test that takes about twenty
minutes, longer than `test:integration` gives a file. Run it on its own, after the engine build:

```bash
npm run engine:build
PN_CHALLENGE_ROUND=1 node --import ./tests/support/test-home.ts --test --test-timeout=3000000 tests/integration/challenge-round.test.ts
```


# Benchmarks: `practonaut bench`

Decision record: [PADR-0030](../adr/0030-bench-replaces-unsealed-eval.md).

`practonaut bench` lets any MCP agent practise the bundled Excalidraw task library and scores it
independently: every run gets a fresh session, the agent works only through the Practonaut MCP
tools, and after it stops a separate checker process judges what is on the board. The agent's own
words are never read for scoring.

```bash
npx practonaut bench --agent oracle --tasks all --seeds 2          # reference solutions: the ceiling
npx practonaut bench --agent random --tasks all --seeds 2 --max-actions 30   # random actions: the floor
npx practonaut bench --agent claude-code --tasks excalidraw/connect,excalidraw/insert-between
npx practonaut report ~/.practonaut/bench/<id>/report.json --html report.html
```

The real Excalidraw mirror runs when Chromium is installed (`npx practonaut setup` once);
`--mirror off` runs model-only and is faster, but its results are not practice evidence.

## 1. Options

| Option | Default | Meaning |
|---|---|---|
| `--agent <a>` | required | `oracle`, `random`, `claude-code`, or a command template (§2) |
| `--tasks all\|<ids>` | `all` | library tasks, comma-separated (`connect` or `excalidraw/connect`); list with `practonaut tasks list` |
| `--seeds <n>` | 1 | seeds 1…n; the seed picks the task's variant (labels) |
| `--repeats <k>` | 1 | independent repeats per task and seed (needed for pass^k with k > 1) |
| `--timeout <s>` | 300 | wall time per run; the agent's process group is stopped after it |
| `--max-actions <n>` | 50 | mutation budget per run (act, undo, reset); further ones are refused by the host with `action_budget_exhausted` |
| `--mirror auto\|required\|off` | `auto` | real Excalidraw mirror (`auto` uses it when Chromium is installed) |
| `--out <file>` | `~/.practonaut/bench/<id>/report.json` | report path; run logs stay in `~/.practonaut/bench/<id>/` |

## 2. Agents

**Built-ins (no language model).** `oracle` plays the library's reference solution with the run's
variant labels; `random` picks a random action with random values that fit each parameter
contract (ids from the current objects), until the action budget or the timeout. Both start the
same `practonaut mcp` bridge an external agent gets and speak MCP to it.

**Preset `claude-code`.** Uses an installed, logged-in Claude Code CLI (its own subscription; no
API key is injected) with only the Practonaut tools:

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

## 3. What is scored and how

An *action* is one accepted change to the board (one `act` call, e.g. *connect* or *rename*); the
word *step* is kept for the boxes of a flow diagram. Per run, all measured by the host or the
checker (never by the agent):

- **pass** — the separate checker's verdict on the final session: it replays the history
  independently and evaluates the task's goal (`end-state-only`). With the mirror, the real
  Excalidraw export of the final board is checked as well, and both must pass.
- **actions** — the actions in the final history of the committed session (undone actions are
  not in it). `report --verify` re-derives this number from the session artifact.
- **referenceActions** — the length of the library's reference solution; `report --verify`
  compares it with the library entry.
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
  length divided by the run's actions, over passed runs; above 1 means a shorter solution than the
  reference), mean time per run. All but the time follow from re-verifiable numbers.

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
  form (each goal clause written out).
- The agent runs as the same OS user. An agent with file or shell tools could read the task
  library on disk, including its reference solutions. The `claude-code` preset disables every
  tool except Practonaut's; for other agents this is the agent author's responsibility. A model
  name in the report is what the client said about itself (`modelSource: client-attested`).
- Runs are sequential. Results depend on the agent's provider and model at run time; a bench
  report describes those runs, not the model in general.

## 5. The report

`practonaut.bench/1` JSON, schema [`schemas/bench.v1.json`](../../schemas/bench.v1.json). It holds
environment metadata (Practonaut and Excalidraw versions, Node, OS, mirror, library id, version
and content hash — the SHA-256 of the library world's canonical JSON), the
agent (template with the home directory shown as `~`, client-attested model if any), the settings,
every run and the summary. A bench stopped with Ctrl+C, SIGTERM or SIGHUP ends the running agent
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
  and the report records their SHA-256 (`runs[].artifacts`). `--verify` checks, and refuses with
  exit 2 on any difference:
  - the library: id, version and content hash equal the library this Practonaut ships;
  - every run's `referenceActions` equals the library's reference length;
  - the artifact hashes; the session's task and seed; `actions` equals the length of the
    session's final history;
  - the independent checker, re-run on the session and the export in a separate process, gives
    the stored checker output and the report's verdicts.

  pass, pass@1, pass^k, mean actions and efficiency then follow from these values. Not
  re-verifiable and labelled *self-reported by the runner*: acceptedActions, rejected actions,
  undo, reset, host calls, wall time, exit status, notes and the client-attested model. The run
  folder defaults to the report's folder (where `bench` writes it).

What re-verification does not show: that the files came from the agent named in the report.
Nothing is signed; whoever can write the bench folder can replace the artifacts and the report
together (a valid replacement session would then have to solve the task). Reports without
artifact hashes (the example below, reports from earlier builds) can only be consistency-checked.

`--html` writes one static page (design system v1, no script, no external asset) that names the
verification level; `--json` prints the summary and `verification`. Text from a report (agent name,
model, command) is shown with control and bidi characters escaped, in the terminal and in HTML.

## 6. Example

[`example-report.json`](example-report.json) and [`example-report.html`](example-report.html) are a
real run on 2026-10-13 with Practonaut 0.1.0 (library 1.1.0): `--agent claude-code --tasks excalidraw/connect,excalidraw/insert-between,excalidraw/decision --repeats 2`,
real mirror, Claude Code 2.1.296 on its subscription; the client reported `claude-opus-5-5`. All
six runs passed; `insert-between` took three actions where the reference uses four (efficiency
1.33), the other tasks matched the reference. The report was re-verified (`report --verify`)
against its run folder when it was written, and the HTML page was rendered in that run; the run
folder is not in the repository, so a copy of the JSON can only be consistency-checked. One seed,
two repeats per task: an example of the format, not a measurement of the model.

Measured the same day with the built-ins (`--tasks all --seeds 2`, real mirror): `oracle` 32 of 32
passed; `random --max-actions 30` 0 of 32. Re-run them with the commands at the top; the numbers in
this paragraph are not maintained.

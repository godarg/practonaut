# Getting started

You need Node.js 22.18 or newer. macOS, Linux and Windows work; everything runs on your machine.

## 1. Open a task in your browser

```bash
npx practonaut
```

This starts a local session on `127.0.0.1` with the bundled example and opens it in your default
browser. The terminal prints:

```text
Practonaut is running: “Build the flow” (world flow-diagram, task T1)
Mode: real-engine
Host origin: http://127.0.0.1:<port>
Token file: <home>/.practonaut/host/session-<pid>-<…>.token
Open: http://127.0.0.1:<port>/#code=<…>
The link works once and expires after 5 minutes. Type o and Enter for a new link; Ctrl+C stops the session.
Connect an agent: npx practonaut mcp --host http://127.0.0.1:<port> --token-file <home>/.practonaut/host/session-<pid>-<…>.token
practonaut: asked your browser to open the session. If no Practonaut page appears (some sandboxed browsers cannot read local files), open this link yourself: http://127.0.0.1:<port>/#code=<…>
```

Without the real engine the second line reads `Mode: model-only (never practice evidence)` (step 2).
`--no-open` prints the same lines without the last one and opens no browser. The token file is the
session's private credential: the `Connect an agent` line names the file, never its content.

Pick a task from the library instead of the example:

```bash
npx practonaut tasks list          # 16 Excalidraw tasks, easy to hard
npx practonaut play connect        # open one
```

The top bar has three views: **Practice** (the task on a diagram board), **Excalidraw** (the same
task in the real editor) and **Create** (make your own task).

**Watch a demonstration** (next to *New variant*, on the bundled example only) solves the current
task once while you watch: each action lands on the board, the real Excalidraw confirms it (or the
card says "model only"), and the result check judges the end. It starts a new attempt, asks first
if that would clear your own unsolved work, and never counts as your result: its board cannot be
continued or exported. Stop or Escape ends it; **Start your own attempt** brings the task back to
its start.

## 2. Turn on the real Excalidraw engine (optional, once)

When the real engine is not installed, `npx practonaut` opens the Player at once, model-only, with
a banner **Not yet checked against the real Excalidraw** that names the command and the one
download it needs. When it is installed, Practonaut first starts Chromium once to check that it
runs ([PADR-0032](adr/0032-chromium-sandbox-stays-on.md)) and then opens with the real engine; if
that start fails it opens model-only and says why. Measured from the command to the first action
of the demonstration on the board (`tools/measure-first-action.ts` at commit df84e38:
`npx --package` of the packed package with a warm cache and npm offline, so no registry lookup; a
fresh browser; the click automated, so no human reaction time; median of 3 on an Apple M4 with a
load average of about 10): 2.1 s model-only and 2.5 s with the real engine. A first `npx` from the
registry adds the package download. Then:

```bash
npx practonaut setup
```

This names the download with its size and then fetches it: Playwright's **Chromium headless
shell** (about 105 MB on Apple silicon Macs, 111 MB on Intel Macs, 126 to 128 MB on Linux and
Windows; nothing is fetched when Playwright's
cache already has it). With it, every step you or an agent take is also
applied to a real, pinned Excalidraw 0.18.1 running in the background and read back before it
counts (the "mirror"). Without it Practonaut runs **model-only**: tasks work, the terminal and the
Player say so, and results are not checked against the real app. `--mirror required` refuses to
start without Chromium; `--mirror off` always runs model-only. `setup` ends by naming the folder the
headless shell went to and its size on disk (213 MB measured on macOS). All sizes here are decimal megabytes (10^6 bytes).

### Chromium does not start

Practonaut launches Chromium once before it uses the mirror (`npx practonaut doctor --adapter`
shows the result as *chromium start*). If it is installed but does not start, a session with the
default `--mirror auto` runs model-only and prints the reason; `--mirror required` stops with
`browser_start_failed`. The sandbox stays on where the system allows it
([PADR-0032](adr/0032-chromium-sandbox-stays-on.md)): when Linux refuses only the sandbox
(Ubuntu 23.10 and later restrict unprivileged user namespaces with AppArmor), Practonaut starts
Chromium once without it, says so in one line, and `doctor` shows "sandbox off". Set
`PRACTONAUT_CHROMIUM_SANDBOX=require` to refuse that instead. On Linux the two usual causes of a
start that still fails are:

- **Missing system libraries** (the reason names a `.so` file or "missing dependencies"):
  `npx playwright install --with-deps chromium` installs them (needs sudo).
- **The sandbox under AppArmor** (the reason says "sandboxing failed" or "No usable sandbox",
  which with the default setting only happens under `PRACTONAUT_CHROMIUM_SANDBOX=require`):
  Ubuntu 23.10 and later restrict unprivileged user namespaces. Follow your distribution's
  documentation for `kernel.apparmor_restrict_unprivileged_userns` or an AppArmor profile for
  Playwright's Chromium, or keep practising model-only.

Elsewhere, run `npx practonaut setup` again to repair a damaged download.

## 3. Let an agent practise

Any MCP client can connect. With Claude Code:

```bash
claude mcp add practonaut -- npx -y practonaut mcp --task excalidraw/connect
```

Then ask it to solve the Practonaut task. `practonaut mcp --task <task>` starts its own session
and prints a one-use link on stderr so you can watch the agent in your browser. Details, other
clients and the seven tools: [agent guide](agent-guide.md).

## 4. Score an agent

```bash
npx practonaut bench --agent oracle --tasks excalidraw/connect       # reference solution, no model
npx practonaut bench --agent claude-code --tasks excalidraw/connect  # Claude Code, Practonaut tools only, its own login
npx practonaut report ~/.practonaut/bench/<id>/report.json --html report.html
```

Each run gets a fresh session; a separate checker scores the final drawing. The `claude-code`
preset does not pass provider API keys from your environment (`--keep-env <name>` passes one on).
Options, metrics and the report format: [benchmarks](benchmarks/README.md).

## 5. Make your own task

Draw the start and the goal in Excalidraw, save both as `.excalidraw`, then:

```bash
npx practonaut tasks from-scenes start.excalidraw goal.excalidraw --out my-task
npx practonaut play my-task/world
```

Or demonstrate a change in the **Create** view. See the [authoring guide](authoring-guide.md).

## Where things are stored

Everything Practonaut writes goes to `~/.practonaut` (or `PRACTONAUT_HOME` when set): the session
credential, recordings, saved projects, compiled tasks and bench runs. Nothing is written to the
current directory unless you name a path there (`--out`, `--html`, `--junit`, `--card`, `--badge`).
Exports from the Player are ordinary browser downloads.

## Help

`practonaut --help` and `practonaut <command> --help` describe every command. Errors print as text;
add `--json` for machine-readable output. Exit codes: 0 success, 1 usage error, 2 rejected input or
failed check, 3 missing environment (for example Chromium with `--mirror required`).
`practonaut doctor` checks the environment.

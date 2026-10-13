# Getting started

You need Node.js 22.18 or newer. macOS, Linux and Windows work; everything runs on your machine.

## 1. Open a task in your browser

```bash
npx practonaut
```

This starts a local session on `127.0.0.1` with the bundled example and opens it in your default
browser. The terminal prints:

```text
Practonaut is running: world …, task …
Mode: real-engine            (or: model-only, see step 2)
Host origin: http://127.0.0.1:<port>
Token file: <private file in ~/.practonaut/host/>
Open: http://127.0.0.1:<port>/#code=…
```

The link works once and expires after five minutes. Type `o` and Enter for a new one, Ctrl+C to
stop. `--no-open` prints the link without opening a browser.

Pick a task from the library instead of the example:

```bash
npx practonaut tasks list          # 16 Excalidraw tasks, easy to hard
npx practonaut play connect        # open one
```

The top bar has three views: **Practice** (the task on a diagram board), **Excalidraw** (the same
task in the real editor) and **Create** (make your own task).

## 2. Turn on the real Excalidraw engine (optional, once)

```bash
npx practonaut setup
```

This downloads Playwright's Chromium once. With it, every step you or an agent take is also
applied to a real, pinned Excalidraw 0.18.1 running in the background and read back before it
counts (the "mirror"). Without it Practonaut runs **model-only**: tasks work, the terminal and the
Player say so, and results are not checked against the real app. `--mirror required` refuses to
start without Chromium; `--mirror off` always runs model-only. `setup` ends by naming the folder the
browser went to and its size (about 550 MB for the browser and its headless shell).

### Chromium does not start

Practonaut launches Chromium once before it uses the mirror (`npx practonaut doctor --adapter`
shows the result as *chromium start*). If it is installed but does not start, a session with the
default `--mirror auto` runs model-only and prints the reason; `--mirror required` stops with
`browser_start_failed`. The sandbox stays on ([PADR-0032](adr/0032-chromium-sandbox-stays-on.md)).
On Linux the two usual causes are:

- **Missing system libraries** (the reason names a `.so` file or "missing dependencies"):
  `npx playwright install --with-deps chromium` installs them (needs sudo).
- **The sandbox under AppArmor** (the reason says "sandboxing failed" or "No usable sandbox"):
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
npx practonaut bench --agent claude-code --tasks excalidraw/connect  # Claude Code, Practonaut tools only
npx practonaut report ~/.practonaut/bench/<id>/report.json --html report.html
```

Each run gets a fresh session; a separate checker scores the final drawing. Options, metrics and
the report format: [benchmarks](benchmarks/README.md).

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
current directory. Exports from the Player are ordinary browser downloads.

## Help

`practonaut --help` and `practonaut <command> --help` describe every command. Errors print as text;
add `--json` for machine-readable output. Exit codes: 0 success, 1 usage error, 2 rejected input or
failed check, 3 missing environment (for example Chromium with `--mirror required`).
`practonaut doctor` checks the environment.

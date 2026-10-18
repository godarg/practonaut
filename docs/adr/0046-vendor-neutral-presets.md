# PADR-0046 — Vendor-neutral presets: one registry, Codex and two loopback presets, client configuration that fails closed, and isolation only from each run's own stream

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, strand P4 (issue #47) · Refines
[PADR-0034](0034-preset-agents-get-no-provider-credentials.md) for every preset after `claude-code` ·
Supplies the parsers and preset values that [PADR-0044](0044-bench-report-v3.md) decision 5 leaves
to P4, and applies its decision 6 and [PADR-0042](0042-gate-for-families-on-toolchains.md)
decision 5 to the new clients · Implements the maintainer's terms decisions of 2026-10-18 · Revised
the same day after three independent reviews (Claude Opus, OpenAI Codex `gpt-6.1-sol`, Google
`gemini-3.8-flash`) and the coordinator's scope decision for 0.3.0 (dispositions at the end) ·
Design only; to be accepted after a check of this revision, before the change that implements it
(P4b) touches `src/bench/`

## Context

**The code today.** `AGENT_PRESETS` holds one argument list, `claude-code`
(`src/bench/agents.ts`). Every preset gets the same environment rule (`agentEnvironment`,
PADR-0034). The runner writes the task-neutral prompt to every external agent's stdin
(`src/bench/run.ts`, `runExternal`), and the `claude-code` arguments carry it as `{prompt}` as
well. The client's model, key source and version come from Claude Code's `system/init` event
(`clientInit`), its failures from Claude Code's stream (`clientFailure`,
`src/bench/evidence.ts`), and its figures from the last `result` event (`clientResult`). The
isolation level follows from the kind of agent (`ISOLATION_OF`, `src/bench/report.ts`).
`--agent codex` is refused with the sentence that Codex has no switch that limits it to MCP tools.

**Decisions this record takes as given** (maintainer, 2026-10-18, after the terms check). The
project's own Claude runs use an API key under Anthropic's Commercial Terms with a fixed credit
limit, not a consumer plan. The project makes no Codex runs through a ChatGPT subscription in 0.3.0:
the `codex` preset is built and tested with stand-ins, for users who run it with their own login.
Gemini moves to 0.4.0, because Gemini CLI no longer serves personal Google accounts (since
2026-06-18). Local open-weight models run through `codex` or opencode against a **loopback**
endpoint only; Practonaut never calls a model and makes no health check of the endpoint.
PADR-0042 and PADR-0044 (both proposed) decide that isolation follows from evidence in each run's own
stream, that a preset whose shell or file tools cannot be removed is "template: not restricted" and
never in the gate, that model evidence is `client-attested` or `preset-requested`, the billing
classes, a parser identifier per run, and that only `usage_limit` and `auth` can be exempt from the
budget.

**The coordinator's scope decision for 0.3.0** (2026-10-18, after the reviews of the first draft).
All three reviewers, independently, found the same two blockers in the first draft: its capture of
real client output had no enforced network block (opencode installs a package from npm into every
fresh configuration folder; Claude Code and Codex have background traffic and telemetry settings),
and its "local" billing class could not be attested (a provider name plus the configuration
Practonaut asked for does not show which endpoint the client used; Ollama serves its cloud models
through the loopback daemon; managed configuration layers can change the provider entry). Codex
proposed a smaller start. The coordinator decided, without dissent among the reviews:

1. Keep the preset registry (with `claude-code` moved into it unchanged), the parser interface and
   PADR-0044's evidence fields.
2. The `codex` preset serves users' own runs only, with the isolation ceiling "template: not
   restricted" and billing guards that fail closed (decision 2).
3. The local presets (`codex-oss` with an explicit provider entry, `opencode-local`) always have
   the billing class `unknown` in 0.3.0 and count against the 800 when the project runs them; no
   "local is free" attestation. Their loopback-only configuration is still enforced, opencode gets
   a read-only configuration folder so that it cannot install anything, and telemetry settings are
   pinned off (decision 3).
4. No capture that starts real clients in 0.3.0. Only model-free probes per installation
   (decision 9); parsers are built from documented formats and these probes and are marked
   experimental until real output is captured under an operating-system network block in a later
   release.
5. No non-Claude agent is gate-eligible in 0.3.0; PADR-0042's shape A is unreachable and the gate
   runs in shape B (decision 7).

**Read-only facts of 2026-10-18** on the maintainer's machine — claude 2.1.302, codex-cli 0.159.2,
opencode 1.4.11, gemini 0.52.0 installed, no local model server. Gathered with `--help`,
`--version`, `codex features list` and by reading names and text in the installed executables
(`strings`); no session was started, nobody logged in, no prompt was sent. Facts from executables
are what the code contains, not measured behaviour. Where a reviewer probed further, it says so.

- *Codex, `codex exec --help`.* "If stdin is piped and a prompt is also provided, stdin is appended
  as a `<stdin>` block." `-c key=value` is "parsed as TOML. If it fails to parse as TOML, the raw
  string is used as a literal." `--ignore-user-config` ("auth still uses `CODEX_HOME`"),
  `--ignore-rules`, `--ephemeral`, `--strict-config` (error on unrecognised fields in
  `config.toml`), `--skip-git-repo-check`, `--json` (JSONL events on stdout), `-s read-only`,
  `--disable <feature>`, `--oss` with `--local-provider lmstudio|ollama`. `codex mcp get <name>
  --json` prints an MCP server's configuration as Codex parsed it.
- *Codex, `codex features list`.* 152 feature switches, 52 of them on — the same with an empty
  `CODEX_HOME` (reviewer's probe), so these are the defaults — among them `shell_tool`,
  `unified_exec`, `view_image`, `browser_use`, `computer_use`, `image_generation`, `multi_agent`,
  `apps`, `plugins`, `hooks`, `skill_search`, `tool_suggest`, `sleep_tool`,
  `unbounded_connection_retries` and `daemon_auto_start`.
- *Codex `-c` keys* (reviewer's probe). An unknown key given with `-c` is ignored without a word,
  and `--strict-config` checks `config.toml` only: a renamed `forced_login_method` would let a
  stored API-key login bill. A known key given a value of the wrong type fails with an error that
  names the key — the *type probe* of decision 2.
- *Codex 0.159.2 executable.* `` `wire_api = "chat"` is no longer supported `` — a custom provider
  must speak the Responses API. The `--json` events are `thread.started` (a thread id),
  `turn.started`, `turn.completed` (usage: input, cached input, cache write, output and reasoning
  output tokens), `turn.failed`, `item.started|updated|completed` (items such as
  `command_execution`, `file_change`, `mcp_tool_call` with server and tool, `web_search`,
  `collab_tool_call`) and `error`; none carries the model, the client version, the provider or the
  offered tools. Its Ollama support for `--oss` contains a model pull (`/api/pull`, "Pulling
  model"). Error identifiers include `usage_limit_reached`, `workspace_owner_usage_limit_reached`,
  `workspace_member_usage_limit_reached`, `rate_limit_reached`, `quota_exceeded`,
  `usage_not_included`, `server_overloaded` and `workspace_*_credits_depleted`. The session record
  (rollout) has `session_meta` with `model_provider` and `cli_version` and `turn_context` with
  `model`. Configuration layers: `/etc/codex/config.toml`, `/etc/codex/requirements.toml`,
  `/etc/codex/managed_config.toml`, device management and cloud-delivered requirements, besides
  the user's and the project's. Environment names: `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
  `OPENAI_ORGANIZATION`, `OPENAI_PROJECT`, `CODEX_API_KEY`, `CODEX_ACCESS_TOKEN`,
  `CODEX_CONNECTORS_TOKEN`, `CODEX_HOME`, `CODEX_SQLITE_HOME`, `CODEX_OSS_BASE_URL`,
  `CODEX_OSS_PORT`, `CODEX_REFRESH_TOKEN_URL_OVERRIDE`, `CODEX_REVOKE_TOKEN_URL_OVERRIDE`,
  `CODEX_AUTHAPI_BASE_URL`, `CODEX_AGENT_IDENTITY_JWKS_BASE_URL`,
  `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, `CODEX_EXEC_SERVER_URL`, `CODEX_CA_CERTIFICATE`, and for its
  Amazon Bedrock provider `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_PROFILE`,
  `AWS_BEARER_TOKEN_BEDROCK`. A reviewer adds: Codex reads a `.env` file from `CODEX_HOME`, and
  global instructions (`AGENTS.md`), skills, hooks, rules and profiles from it.
- *opencode 1.4.11 executable* (bundled JavaScript). `run --format json` writes one line
  `{type, timestamp, sessionID, …}` per `tool_use`, `step_start`, `step_finish` (tokens, cost),
  `text`, `reasoning` and `error`; the assistant message that names the provider and the model is
  printed only in the default format, on the terminal. A piped stdin is appended to the message
  (`if (!process.stdin.isTTY) message += "\n" + stdin`). Without `--title`, the session title is
  derived from the prompt or generated. In `run`, a permission request is auto-rejected and
  announced in a line that is not JSON. A tool is removed from the model's tool list when the last
  permission rule that matches its name has pattern `*` and action `deny` (`Permission.disabled`);
  without a rule the action is `ask`. `OPENCODE_PERMISSION` is merged into the configuration.
  Configuration text may contain `{env:NAME}` and `{file:path}`, which opencode substitutes.
  `enabled_providers` limits the providers. For **every configuration folder** it uses — the
  global one under `XDG_CONFIG_HOME` among them — it starts a background install of
  `@opencode-ai/plugin` (a failure is logged as "background dependency install failed"), after a
  preparation step whose failure ends the start. A managed configuration is read from
  `/Library/Application Support/opencode` (macOS), `%ProgramData%\opencode` (Windows) or
  `/etc/opencode`, and from macOS managed preferences. `@ai-sdk/openai-compatible` (Chat
  Completions) is bundled. `opencode export [sessionID]` writes a session as JSON and has
  `--sanitize` and `--pure`. Environment names include `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`,
  `OPENCODE_CONFIG_DIR`, `OPENCODE_AUTH_CONTENT`, `OPENCODE_API_KEY`, `OPENCODE_CONSOLE_TOKEN`,
  `OPENCODE_PERMISSION`, `OPENCODE_SERVER_PASSWORD`, `OPENCODE_MODELS_URL`,
  `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE`,
  `OPENCODE_DISABLE_EXTERNAL_SKILLS`, `OPENCODE_DISABLE_DEFAULT_PLUGINS`, `OPENCODE_PURE`,
  `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_SHARE` and
  `OPENCODE_DISABLE_LSP_DOWNLOAD`.
- *Gemini CLI 0.52.0, `gemini --help`.* `-p` is "appended to input on stdin (if any)";
  `--output-format stream-json`, `--policy`, `--allowed-mcp-server-names`, `--approval-mode`.
- *Claude Code 2.1.302.* Whether it joins a piped stdin to a `-p` prompt argument is not stated in
  its help and is not settled by reading its executable: **unknown**. The 0.2.0 preset sends both.
- *Installations.* A client on `PATH` can be a shim that finds the real program under `$HOME`
  (version managers such as asdf, mise or volta, and wrapper scripts; one such wrapper is on the
  maintainer's machine): with another `HOME` it finds nothing. macOS keychain entries and
  preference domains (for example `com.openai.codex`) do not follow `HOME`.

Three consequences follow. No client except Claude Code lists the tools it offers in its own
stream, so under PADR-0044 decision 6 no new preset can be "tool-restricted". Neither new client's
stream names its model, version or endpoint, and nothing a client writes shows which endpoint it
really used. And at least Codex, opencode and Gemini CLI join stdin to a prompt argument, so a
preset must deliver its prompt once.

## Options considered

**Registry.** (1) More argument lists in `AGENT_PRESETS` and branches in the runner. Every client
differs in configuration format, environment, prompt channel and stream; branches would spread over
`run.ts`, `evidence.ts` and `report.ts`. (2) One typed definition per preset, with its builder and
parser, read by a client-neutral runner (chosen).

**Where the Codex login comes from.** (1) The user's `CODEX_HOME` with `--ignore-user-config`.
`config.toml` is skipped, but the home also holds `.env`, global instructions, skills, hooks,
rules, profiles and sessions. (2) A per-run home with a copy of the user's `auth.json`: a
credential in the bench folder. (3) A Practonaut-owned client home that holds only what Codex
writes itself, checked before every run (chosen).

**How Codex gets its configuration.** (1) A `config.toml` written into the client home, beside the
credential and shared by every bench. (2) A profile file (`-p`) in the same home. (3) `-c`
overrides from one tested TOML encoder (chosen). Because Codex ignores an unknown `-c` key, the
encoder alone is not enough: every security-relevant key is type-probed and the MCP server read
back before the first run (decision 2).

**Environment of a local preset.** (1) PADR-0034's withholding rule plus more names. Every cloud
credential would need a name or a pattern. (2) An allowlist (chosen). PADR-0034 rejected an
allowlist because logins need platform-specific variables; a local preset has no login.

**Billing class of a local run.** (1) Practonaut relays the model traffic — Practonaut would call a
model (rejected by the maintainer's decision). (2) A health check — rejected by the same decision.
(3) The client's session record naming the preset's provider entry, plus Practonaut's recorded
configuration (the first draft) — refuted by all three reviews: a managed layer can change the
entry under the same name, a loopback server can serve a cloud model, and the agent's own tools can
write the record. (4) `unknown`, counted, in 0.3.0 (chosen).

**Real client output.** (1) Start the clients against a scripted loopback endpoint (the first
draft) — refuted: nothing blocks their other traffic, and opencode installs from npm on every start
with a fresh configuration folder. (2) The same under an operating-system network block — the
right instrument, not available in 0.3.0. (3) Model-free probes only, parsers from documented
formats, marked experimental (chosen).

**Isolation of clients whose stream lists no tools.** (1) Trust the configuration: contradicts
PADR-0044 decision 6. (2) A listing before the run (opencode's `debug agent` prints an agent's
tool map, as its executable shows): a separate process, not the run's own stream. (3) A red-team
result: it can find a route, never show that none exists. (4) "template: not restricted" (chosen).

**Codex against a local server.** (1) `codex --oss`: the endpoint comes from `CODEX_OSS_BASE_URL`,
`CODEX_OSS_PORT` or a provider default, and its Ollama support can pull a model onto the server.
(2) An explicit provider entry whose `base_url` is the parsed loopback URL (chosen).

## Decision (proposed)

1. **One registry.** `src/bench/presets/` holds one definition per preset (sketch below): the
   preset name and version (`codex/1`), the client program (PADR-0044 `agent.client`), the binary
   name, the requested billing class, the vendor mapping, which of `--model` and `--endpoint` it
   needs, its environment rule, its prompt channel, its isolation ceiling, its model-free probes, a
   builder and a parser. `claude-code` moves into the registry with its arguments, environment rule
   and parser unchanged. The runner is client-neutral: it asks the builder for the arguments,
   environment and files of a run, starts the client as today (no shell, own process group,
   deadline), and hands the bound outputs to the parser.
   - **The binary is resolved in the run's own environment.** Before the first run the runner
     resolves the binary on the `PATH` of the environment the preset builds, then runs the
     probes of decision 9 with exactly that environment, a fresh empty working directory like the
     agent's, stdin closed, a 10-second deadline and a 64 KiB output cap. The absolute path found
     is used for every run (shown with `~` in reports). A shim that needs the real `HOME` fails
     here, before any run, with `bench_client_unavailable` and its reason (not found, exit code,
     deadline); the user puts the real program on `PATH`.
   - **Files** the builder asks for are written before the client starts, inside the run folder
     only, directories `0700` (or read-only where decision 3 says so), files `0600`, never over an
     existing file (`wx`).
   - **One prompt channel.** A definition says `stdin` or `argv`; the runner writes the prompt to
     stdin only for `stdin` and otherwise gives the client a stdin that ends at once. Codex takes
     it on stdin (with the positional `-`), opencode on stdin with an empty message. `claude-code`
     keeps its 0.2.0 delivery in 0.3.0, because no client is started to settle the unknown above;
     the question stays open for the later capture. Command templates keep 0.2.0's behaviour. The
     channel is recorded in `agent.settings` (`prompt=stdin`), so `compare` names a difference.
   - **New options.** `--model <id>` reaches the client through its model switch (Codex `-m`,
     opencode `-m <provider>/<id>`) and is PADR-0044's `requestedModel`; `claude-code` keeps reading
     `ANTHROPIC_MODEL` as today and gains `--model` only as a later, separate change.
     `--endpoint <url>` is for the local presets only and is required there, as is `--model`.
   - **Refusals before the first run**, each with a named code in English and German: a local
     preset without `--endpoint` or `--model` (`bench_endpoint_required`, `bench_model_required`);
     an endpoint that is not loopback (`bench_endpoint_not_loopback`); `--endpoint` for any other
     agent (`bench_endpoint_not_applicable`); a model id outside
     `^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$` (`bench_model_invalid`); `--keep-env` of a name
     decision 2 forbids, and any `--keep-env` for a local preset (`bench_keep_env_forbidden`); a
     configuration value the writers of decision 4 refuse
     (`bench_client_config_unencodable`); and the probe failures of decision 9.
   - **Loopback.** The endpoint is parsed with the WHATWG URL parser (`new URL`, as Node implements
     it). It must have the scheme `http:` or `https:`, no user name, password, query or fragment, and
     a host that, as the parser serialises it, is an IPv4 address in `127.0.0.0/8` or `[::1]`;
     `localhost` and any other name are refused, because their resolution is outside Practonaut's
     view. The client gets the parser's serialisation (`href`), never the input text. Practonaut
     never connects to the endpoint and does not check how the server is bound or where it
     forwards.

2. **The `codex` preset — users' own runs, isolation ceiling "template: not restricted".**
   Billing requested: `subscription`. Vendor: `openai`. The project makes no runs with it in 0.3.0.
   - **Client home.** A Practonaut-owned directory `<data directory>/clients/codex/`, never inside a
     bench folder, created `0700` through the private-file rules Practonaut already uses
     (`src/platform/private-fs.ts`: owner, mode, no link, safe ancestors). The user logs in there
     once with the command `bench` prints, for example `CODEX_HOME="<dir>" codex login -c
     cli_auth_credentials_store="file"`; Practonaut never reads the credential. Before **every**
     run `bench` checks the home without reading any file's content: `auth.json` exists as a
     regular file of the user, mode `0600`, one link, not a symbolic link
     (`bench_client_login_missing`, `bench_client_home_unsafe`); and the home holds nothing but the
     names Codex writes itself, a list fixed per covered Codex version — no `.env`, `AGENTS.md` or
     `AGENTS.override.md`, `config.toml` or `*.config.toml`, hooks, rules, or skills beyond Codex's
     own (`bench_client_home_unexpected`, naming the entries). Nothing in it is deleted. The
     directory holds a refresh token at a predictable path, as `~/.codex` does.
   - **Billing guards that fail closed.** Every run passes `forced_login_method="chatgpt"` and
     `cli_auth_credentials_store="file"`, so a stored API-key login is refused by Codex rather than
     billed. The environment loses PADR-0034's set, every name starting with `OPENAI_` and every
     name starting with `CODEX_` except `CODEX_CA_CERTIFICATE`, and `AWS_ACCESS_KEY_ID`,
     `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and `AWS_PROFILE`; the preset then sets
     `CODEX_HOME`. `--keep-env` refuses every one of these names (a kept `CODEX_API_KEY` replaces
     the ChatGPT login); the preset has no API-key mode — API billing through Codex is a command
     template. ChatGPT plans can draw paid credits or spend against a spending cap before Codex
     reports a usage limit; `subscription` therefore does not mean "no charge", and the
     documentation says so. That Codex refuses a stored API-key login under
     `forced_login_method="chatgpt"` is its documented behaviour, not measured in 0.3.0: the type
     probe shows that the key is known, not that it acts.
   - **Arguments** (every `-c` value through decision 4's encoder): `codex exec --json --ephemeral
     --skip-git-repo-check --ignore-user-config --ignore-rules --strict-config -s read-only`, the
     login settings, `approval_policy="never"`, `model_provider="openai"`,
     `project_doc_max_bytes=0`, `project_root_markers=[]`, `check_for_update_on_startup=false`, web
     search off, analytics, feedback and OpenTelemetry export off,
     `shell_environment_policy.inherit="core"`, retries and stream timeouts pinned, the MCP server
     `mcp_servers.practonaut` (command, arguments and environment of the run's bridge, with
     `default_tools_approval_mode="approve"`), `-m` when `--model` is given, and `-` (the prompt on
     stdin). Features: every feature that `codex features list` (decision 9) shows on is disabled
     with `--disable`, except a keep-list fixed per covered version of what `exec` with an MCP
     server needs; a feature a new version adds on is therefore off until it is reviewed. The
     environment adds `GIT_CEILING_DIRECTORIES` set to the run folder, so no project root above it
     is found. These settings reduce what an unattended run can do and make a score more
     comparable; they are not an isolation claim (decision 7).
   - **Probes before the first run** (decision 9, no model): `--version`; a **type probe** for every
     security-relevant key — `forced_login_method`, `cli_auth_credentials_store`,
     `approval_policy`, `model_provider`, `web_search` or the key the version uses,
     `shell_environment_policy`, `project_doc_max_bytes`, `project_root_markers`,
     `check_for_update_on_startup`, the telemetry, retry and timeout keys and
     `mcp_servers.practonaut.default_tools_approval_mode` — which gives the key a value of the wrong
     type and requires Codex to refuse it naming the key; a probe that passes without an error means
     this Codex does not know the key, and the preset is refused (`bench_client_key_unknown`); and
     the **read-back** `codex <every -c of the run> mcp get practonaut --json`, whose command,
     arguments and environment must equal what the preset meant, byte for byte
     (`bench_client_config_mismatch`) — this also catches a `-c` value that fell back to a literal
     string, on every platform.
   - **Evidence.** Model: requested only, labelled "not attested". Observed billing:
     `subscription`, source `preset-requested` (`codex/1:login.forced`); PADR-0044 counts it as a
     subscription agent either way. No client record is read (`--ephemeral`).

3. **The two local presets — billing `unknown`, loopback configuration enforced.** Billing
   requested and observed: `unknown` in 0.3.0, for every run. Vendor: `none`. Model: requested only,
   never attested. A run the project makes with them counts against the release's 800 under
   PADR-0042 decision 4 and PADR-0044 decision 5; nothing about them is "free". A bench of a local
   preset stops at its first `infra_error` (as `--stop-on-infra` does today), so a server that is
   down costs one run, not a bench.
   - **Environment from an allowlist.** The client starts with `PATH`, the locale variables
     (`LANG`, `LC_*`, `TZ`), `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `TMP`, `TEMP` and, on Windows,
     `SYSTEMROOT`, `SYSTEMDRIVE`, `WINDIR`, `COMSPEC`, `PATHEXT`, `NUMBER_OF_PROCESSORS`,
     `PROCESSOR_ARCHITECTURE`, `OS` and `PROGRAMFILES`, plus what the preset sets: `HOME` (and
     `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` on Windows) and `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
     `XDG_STATE_HOME`, `XDG_CACHE_HOME` below the run's client folder `<run folder>/client/` (a
     sibling of `agent/`, outside the agent's working directory), `NO_PROXY` and `no_proxy` set to
     the loopback addresses, `GIT_CEILING_DIRECTORIES` set to the run folder, and `PRACTONAUT_HOME`
     as today. **`--keep-env` is refused for the local presets** (`bench_keep_env_forbidden`): the
     allowlist is the whole environment. A filter by name pattern is not enough, because client
     configuration and credentials also enter through names no pattern catches —
     `OPENCODE_CONFIG_CONTENT` is merged after `OPENCODE_CONFIG` and can give the
     `practonaut-loopback` entry a remote `baseURL` and an `apiKey` under the same name;
     `OPENCODE_CONFIG_DIR` adds a writable configuration folder with its own install;
     `OPENCODE_AUTH_CONTENT`, `OPENCODE_PERMISSION` and `CODEX_*` do the like. A user who needs
     another variable runs the client as a command template, reported as such.
   - **`codex-oss`.** `CODEX_HOME` is `<run folder>/client/codex-home/`, empty before the run. The
     arguments and probes are those of decision 2 without the login settings and with its own
     provider in place of `openai`: `model_providers.practonaut-loopback={name="Practonaut
     loopback", base_url="<parsed endpoint>", wire_api="responses", requires_openai_auth=false}`,
     `model_provider="practonaut-loopback"` and `-m <model>`. No `--oss`. The user must run, on a
     loopback address, a server that implements the OpenAI **Responses API** (`POST
     <endpoint>/responses`, streamed, with function tools) for a model that can call tools.
   - **`opencode-local`.** The configuration file `<run folder>/client/opencode.json` (mode `0400`,
     named by `OPENCODE_CONFIG`) holds: `enabled_providers` with only `practonaut-loopback`; that
     provider with `npm: "@ai-sdk/openai-compatible"`, `options.baseURL` the parsed endpoint and the
     one model; `model` and `small_model` set to it; the MCP server `practonaut` (`type: "local"`,
     the bridge's command, arguments and environment); `permission` with `"*": "deny"` and `allow`
     for **each tool name the bridge advertises**, written out exactly (`practonaut_observe`, …; no
     wildcard); `share: "disabled"`, `autoupdate: false`; no instructions and no plugins. The global
     configuration folder `XDG_CONFIG_HOME/opencode/` is created empty and **read-only** before the
     start, so the plugin install of every start cannot write; if opencode's preparation step then
     ends the start, the preset fails closed (the run is `agent_failed` and counted), and P4b says
     so in the documentation. The environment adds `OPENCODE_DISABLE_PROJECT_CONFIG`,
     `OPENCODE_DISABLE_CLAUDE_CODE`, `OPENCODE_DISABLE_EXTERNAL_SKILLS`,
     `OPENCODE_DISABLE_DEFAULT_PLUGINS`, `OPENCODE_DISABLE_MODELS_FETCH`,
     `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_SHARE`, `OPENCODE_DISABLE_LSP_DOWNLOAD` (each
     `1`). Arguments: `opencode run --pure --format json --title practonaut-bench -m
     practonaut-loopback/<model>`, the prompt on stdin. The user must run, on a loopback address, a
     server that implements the OpenAI **Chat Completions API** (`POST <endpoint>/chat/completions`,
     streamed, with `tools`) for a model that can call tools.
   - **What "loopback" shows.** That the client was configured for a loopback endpoint and nothing
     else Practonaut controls points elsewhere. Not that a local model answered: a loopback server
     can serve a cloud model (Ollama's cloud models are served through its local daemon) or forward
     to a paid API, and a managed configuration layer can change the provider entry.
   - **Not covered** (as PADR-0034 names a managed `apiKeyHelper`): Codex's
     `/etc/codex/config.toml`, `requirements.toml` and `managed_config.toml`, device management and
     cloud-delivered requirements; opencode's managed folders and macOS managed preferences;
     keychain entries and preference domains, which do not follow `HOME`. The per-run `HOME` hides
     the per-user paths the clients look up; it hides nothing from a tool the agent runs.

4. **Configuration writers.**
   - **TOML values for Codex `-c`.** One encoder, `tomlValue`, accepts strings, booleans,
     non-negative safe integers, arrays of one of these, and inline tables whose values are one of
     these; anything else is refused before the client starts. A string is always a TOML basic
     string: `\` and `"` escaped, `\b \t \n \f \r` for those controls, `\uXXXX` for every other
     character in U+0000–U+001F and U+007F, every other character as UTF-8; a string with a lone
     surrogate is refused. A string is never emitted bare, so `true`, `[1]` or `{a=1}` stay
     strings. Keys of `-c` paths are fixed in the preset definitions, never user input; a table key
     that is not `[A-Za-z0-9_-]+` is quoted. Decision 2's read-back checks the result in Codex
     itself.
   - **JSON for opencode.** `JSON.stringify` of an object the builder assembles, after walking it
     recursively and refusing any key or string value that contains `{` or `}` — opencode
     substitutes `{env:…}` and `{file:…}` in the configuration text, and no value the preset writes
     (model ids, URLs, paths, tool names) needs a brace.
   - **Tests** (P4b, unit): hostile values — quotes, backslashes, a Windows path (`C:\Users\a
     b\x.js`), newline, tab, U+0000, U+001F, U+007F, U+2028, an emoji, an empty string, strings that
     read as TOML booleans, arrays and tables — with the expected encodings written by hand from
     the TOML 1.0 specification; refusals for a lone surrogate and a nested array of tables; the
     opencode refusal for braces in a value and in a key, with spaces and in other letter case
     (`{ env:X }`, `{ENV:X}`); the arguments as the Windows spawn path passes them
     (`src/platform/spawnable.ts`).

5. **Parsers — experimental for the new clients.** Each preset names one versioned parser of its
   stdout (PADR-0044 `client.parser`) and, where decision 6 reads one, one of its client record. A
   parser is a pure function of bytes; it returns model, client version, provider, the offered tools
   and servers (or "not listed"), the tools the stream shows the agent using, the client's figures
   (turns, tokens with an optional reasoning count, cost), the failure, the observed billing class
   with its `via`, and **`complete`**: whether every event it needed was read within PADR-0044's
   bounds. Unknown is `null`, never a guess. Lines that are not JSON objects are skipped and
   counted.
   - **Experimental.** The parsers of the new clients have version 0 (`codex-exec-json/0`,
     `opencode-run-json/0`, `codex-rollout/0`, `opencode-export/0`): built from the clients'
     documented formats, the executables' text and decision 9's probes, not from captured output.
     Reports, cards and the JUnit properties say "experimental parser" for a run read by a version-0
     parser. A version-0 parser never grants a budget exemption (its `beforeModelWork` is always
     `null`) and never gives positive isolation evidence. Version 1 needs output captured under an
     operating-system network block (a later release).
   - **Failures.** `usage_limit`, `auth` or `api_error` with `code` — the client's own identifier
     (an error identifier, an HTTP status, an error class name), never free text. Codex:
     `usage_limit_reached`, every `*_usage_limit_reached`, `rate_limit_reached`, `quota_exceeded`,
     `usage_not_included` and 429 are `usage_limit`; 401, 403, a refused or expired login and
     `*_credits_depleted` are `auth`; 5xx, `server_overloaded` and a failed connection to the
     provider are `api_error`; any other 4xx stays the agent's. opencode's `error` lines are
     classified by status code and error name the same way. `claude-code-stream/1` keeps today's
     classes.
   - **`beforeModelWork`** is true only for a failure that the client's own event identifies as a
     refusal of the first model request, with no streamed output, no reasoning, no retry notice and
     no token count before it, and only when `complete`; any started output, any retry, any partial
     stream or an incomplete read makes it false or null. A stand-in sequence "partial answer,
     dropped connection, login error" must give false (decision 10).
   - **Positive claims need `complete`.** A run whose stream was not read completely within the
     bounds carries no `tools-within-servers` evidence and no exemption, whatever the read part
     shows.
   - **Tools used.** A Codex item `command_execution`, `file_change`, `web_search` or
     `collab_tool_call`, an `mcp_tool_call` whose server is not `practonaut` or whose tool the bridge
     did not advertise, or an opencode `tool_use` whose tool is not exactly one of the advertised
     `practonaut_…` names, is evidence `tool-outside-servers` (PADR-0044 decision 6).

6. **Client records — one check, never evidence for billing or isolation.** After the agent has
   ended and the run's host has closed, the runner keeps the local client's own session record in
   the run folder as `client.record.json` (at most 16 MiB, read with bounded memory). It is not a
   report field and adds nothing to the /3 schema. For `codex-oss` it is the rollout under
   `client/codex-home/sessions/` whose name holds the thread id from the stdout's `thread.started`
   (resolved inside that folder only, a regular file, no link followed). For `opencode-local` it is
   the output of `opencode export <sessionID> --sanitize --pure`, run with the run's environment, a
   second configuration file without the `mcp` block (so no MCP server starts), the read-only
   folders of decision 3, a 30-second deadline and the size cap; the session id comes from the
   stdout and must match the shape opencode's own ids have (`ses_` and at most 64 letters and
   digits), otherwise there is no export. The agent's own tools can write these files, so they
   support no billing class, no isolation level, no exemption and no reported value. They serve one
   check: a record that names a provider other than the preset's stops the bench
   (`bench_local_provider_mismatch`, named in the report's stop), because that run did not use the
   configured endpoint — the user's own money may be at stake. A missing or unreadable record gives
   no claim either way.

7. **Isolation in 0.3.0, and the gate.** PADR-0044 decision 6 applies unchanged; per preset:

   | Preset | The stream lists the offered tools | Ceiling | Level |
   |---|---|---|---|
   | `claude-code` | yes (`init.tools`) | tool-restricted | tool-restricted when every run's evidence holds |
   | `codex`, `codex-oss` | no | template: not restricted | template: not restricted |
   | `opencode-local` | no | template: not restricted | template: not restricted |

   The level of the new presets rests on the stream argument: their streams list no offered tools,
   so no run can show "tools within servers". It does not rest on an inventory of switches. (For
   Codex, `shell_tool`, `update_plan` and others have switches; we found none for `apply_patch` or
   the MCP resource tools in the help or the feature list, and the `strings` of an executable do
   not prove that none exists.) opencode's configuration can remove every built-in tool, but no run
   shows that.
   - **The gate.** No non-Claude agent is gate-eligible in 0.3.0: `codex` and `codex-oss` keep tools
     that cannot be shown removed, `opencode-local` has no evidence in its stream, and the local
     presets' billing is `unknown`, so none of them is a local ladder agent in the sense of
     PADR-0042 decision 5. Shape A is unreachable; the 0.3.0 gate runs in shape B (Opus, Sonnet,
     Haiku through `claude-code`). The release's "vendor-neutral" claim rests on presets users can
     run with their own clients, not on the gate. P1 refuses a declaration that names a new preset
     as a ladder agent (decision 11).
   - **The honest statement.** Without an operating-system sandbox, an agent with shell or file
     tools can reach hidden data by routes no decoy covers (PADR-0042: regeneration from
     `generatedBy`, the installed library's references, finished bench folders, `practonaut check`
     as an oracle). Codex's own sandbox (`-s read-only`) is the client's claim; Practonaut cannot
     see it work and claims nothing from it (PADR-0010). Such an agent stays "template: not
     restricted" until a sealed runner (roadmap 0.4.0) exists.

8. **Red-team protocol** (defined now, run in a later release). It applies to a preset that can
   reach "tool-restricted" and tests the evidence channel — that the tools a client lists are all
   the tools it offers and runs — not any agent's level.
   - **Scripted part, no model, under an operating-system network block** that allows only the
     scripted loopback endpoint, with a separate data and login store and no real credential: the
     endpoint records the tools of every model request and answers with tool calls — every offered
     tool once, then every built-in tool name the client's executable contains that the request did
     not offer, with arguments aimed at decoys (a decoy file beside the agent folder, the installed
     library's references, a finished bench folder). It passes when the request offers exactly the
     listed tools, every unoffered name is refused without effect, and no decoy content reaches a
     later request. It shows this for one client version and one configuration.
   - **Model part, only where the scripted part cannot run.** At most 5 model runs per preset and
     client version, prompted to reach each route of decision 7, counted under PADR-0042 decision 4.
     A finding falsifies the restriction; no finding is a sample, not proof.
   - **Counting.** A client started for the scripted part follows PADR-0042 decision 4 as written
     unless a later record amends it.
   - **0.3.0 runs neither.** `claude-code`'s level rests on its per-run `init.tools` evidence
     (PADR-0044 decision 6, re-measured on 465 stored 0.2.0 runs).

9. **Model-free probes per installation** (instead of a capture in 0.3.0). Before the first run of
   every bench, with the run's exact environment, `PATH`, a fresh empty working directory, stdin
   closed, a 10-second deadline and a 64 KiB output cap per probe: `<binary> --version` for every
   preset (recorded as `clientVersion` with the source `preset-requested`, compared with the
   versions the preset's keep-lists and parsers were written for, an unknown version named on
   stderr); for the Codex presets also `codex features list` (input to decision 2's `--disable`
   list), the type probes and the `mcp get --json` read-back of decision 2. opencode gets
   `--version` only, because its other commands load the configuration and would start the plugin
   install. The probes start no session and call no model; they take no ledger entry of their own
   (the runs they precede do). What a client does on the network when it starts — for example to
   check for updates — is the client's, and Practonaut does not observe it. A failed probe refuses
   the bench before its first run with a named code.

10. **Stand-ins.** `tests/support/fake-codex.ts` and `tests/support/fake-opencode.ts`, built like
    `fake-claude.ts` (an executable first on `PATH`, `.cmd` on Windows, the bridge reached by its
    `file:` URL), started by the real presets. They emit lines in the documented formats the
    version-0 parsers read and act as `PN_FAKE_MODE` says: `observe` (one `observe` through the MCP
    server the preset configured), `usage-limit` (each Codex limit identifier), `login-expired`,
    `api-error`, `too-long` (the agent's own 4xx), `agent-error`, `silent-crash`, `tool-outside`,
    `partial-then-auth` (streamed output, a dropped connection, then a login error), and for the
    local presets `provider-mismatch` and `no-record`. The Codex stand-in also answers the probes:
    `--version`, `features list`, a type error for every known key it is given with a wrong type,
    and `mcp get --json` from its arguments; modes `key-unknown` and `literal-fallback` make a probe
    pass silently or return a string where a table was meant. They write to `PN_FAKE_STATE` the
    arguments, the **names** of the variables they received and how often the prompt reached them.
    **What they show is Practonaut's side** — which arguments, variables and files it hands over,
    and how it reads what comes back — not how the real clients behave; the later capture shows
    that. Tests, each failing without its mechanism: the prompt arrives once; no withheld or
    forbidden name arrives and `--keep-env` of one is refused; with a local preset, `--keep-env
    OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG_DIR`, `OPENCODE_AUTH_CONTENT` and a harmless name
    alike are refused before the stand-in starts, and a planted `OPENCODE_CONFIG_CONTENT` in the
    caller's environment does not reach it; `forced_login_method="chatgpt"` is
    passed; a type probe that passes silently refuses the preset; a read-back that differs refuses
    it; an unexpected entry in the Codex home (`.env`, `AGENTS.md`, `config.toml`) refuses it, and a
    symbolic-link `auth.json` too; a shim that fails under the run's `HOME` gives
    `bench_client_unavailable`; each failure mode gives its reason, code and `beforeModelWork`
    (`null` for version-0 parsers); `tool-outside` gives `tool-outside-servers`;
    `provider-mismatch` stops the bench; a session id of the wrong shape gives no export; braces in
    an opencode value are refused; the opencode configuration folder is read-only when the client
    starts; a run folder contains no file named `auth.json`. Expected values are written in the
    tests, not taken from the parsers.

11. **Example reports for P4's acceptance line.** After P3b (the /3 writer) and P1's start guard,
    each run taking its ledger entry:
    - `claude-code` through the API key (`--keep-env ANTHROPIC_API_KEY`, the model through
      `ANTHROPIC_MODEL`), two library tasks, one seed, at most 4 runs counted against the 800;
      billing `api-key`, isolation from its evidence.
    - `codex-oss` and `opencode-local` only if the maintainer runs a local server, at most 2 runs
      each, counted against the 800 (billing `unknown`), marked "experimental parser"; the label
      names the server and the model.
    - Reports go to `docs/benchmarks/examples/0.3.0/<preset>.json`, with a table in
      `docs/benchmarks/README.md` §9: preset, client version, billing class, isolation level and
      reason, parser status, runs — or why there are none: `codex` "no project runs (terms): the
      project makes no Codex runs through a ChatGPT subscription in 0.3.0; tested with stand-ins";
      a local preset without a server "no runs: no local model server installed"; `gemini-cli`
      "moved to 0.4.0: Gemini CLI no longer serves personal Google accounts (since 2026-06-18)".
      They are committed without their bench folders and consistency-checked, like
      `docs/benchmarks/example-report.json`.
    - "Refused by the gate" is shown by P1's tests with stand-ins: a declaration that names
      `codex`, `codex-oss` or `opencode-local` as a ladder agent is refused with a named code.

12. **Gemini CLI.** Not a preset in 0.3.0: `--agent gemini-cli` is refused with that reason, as
    `--agent codex` is today. The registry keeps room for it in 0.4.0 (a parser of its
    `stream-json` output, its policy files, one prompt channel, Google's credential variables
    withheld); 0.4.0 checks the terms first.

### Sketch

```ts
type PresetName = 'claude-code' | 'codex' | 'codex-oss' | 'opencode-local';
type ParserId = string;                         // 'claude-code-stream/1', 'codex-exec-json/0', …

interface PresetDefinition {
  name: PresetName; version: number;            // recorded as agent.settings preset=<name>/<version>
  client: 'claude-code' | 'codex' | 'opencode'; // PADR-0044 agent.client
  binary: string;                               // resolved on the PATH of the run's environment
  billing: 'subscription' | 'unknown';          // requested; claude-code: 'api-key' when --keep-env keeps a provider key
  vendorOf(model: string | null): string;       // 'anthropic' | 'openai' | 'none'
  needs: { model: boolean; endpoint: boolean };
  environment:
    | { mode: 'withhold'; prefixes: string[]; suffixes: string[]; names: string[]; except: string[]; keepForbidden: string[] }
    | { mode: 'allowlist'; names: string[]; prefixes: string[]; keepEnv: 'refused' };
  prompt: 'stdin' | 'argv';
  ceiling: 'tool-restricted-preset' | 'template-unrestricted';
  probes(run: RunContext): Probe[];             // decision 9; each with argv, expectation and refusal code
  build(run: RunContext, probed: ProbeResults): {
    argv: string[]; set: Record<string, string>;            // variables the preset sets
    files: Array<{ path: string; text: string; mode: number }>;  // inside the run folder only
    readOnly: string[];                                      // folders made read-only before the start
    settings: Array<{ name: string; value: string }>;        // PADR-0044 agent.settings
  };
  parser: ClientParser;                                      // reads the bound stdout
  record?: { parser: ClientParser; collect(run: RunContext, stdoutHead: string): Promise<Uint8Array | null> };  // decision 6
}
interface RunContext { runFolder: string; clientDir: string; agentDir: string;
  mcp: { command: string; args: string[]; env: Record<string, string>; tools: string[] };  // tools: names the bridge advertises
  prompt: string; model: string | null; endpoint: URL | null; clientHome: string | null }

interface ClientParser {
  id: ParserId;                                  // version 0: experimental (decision 5)
  read(input: { head: string; tail: string; failures: string; size: number }): {
    complete: boolean;                           // every needed event read within the bounds
    model: string | null; version: string | null; provider: string | null;
    offered: { tools: string[]; servers: string[]; omitted: number } | null;   // null: not listed
    used: string[];                              // tool names the stream shows the agent calling
    figures: { turns: number | null; costUsd: number | null;
      tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; reasoning?: number } | null };
    failure: { reason: 'usage_limit' | 'auth' | 'api_error'; code: string | null; beforeModelWork: boolean | null } | null;
    billing: { class: 'subscription' | 'api-key' | 'local' | 'unknown'; via: string } | null;
    skippedLines: number;                        // lines that are not JSON objects
  };
}
```

## Consequences

- P4b changes `src/bench/agents.ts` (the registry replaces `AGENT_PRESETS`; `agentEnvironment`
  takes the definition), `src/bench/run.ts` (binary resolution, probes, the builder, the prompt
  channel, client records, the local stop), `src/bench/evidence.ts` (parsers behind the interface),
  `src/cli/bench.ts`, `help.ts` and `messages.ts` (`--model`, `--endpoint`, the named codes, English
  and German), the experimental mark in the renderers (read from a parser id with version 0, so the
  /3 schema does not change), and `docs/benchmarks/README.md` §2, §4 and §9, `README.md` and
  `CHANGELOG.md`. It depends on P3b; the example runs depend on P1's guard.
- PADR-0034 stays in force for `claude-code`; this record adds the Codex names, the `--keep-env`
  refusals and the allowlist for local presets. PADR-0034's trigger "a second preset for another
  client" is met by this record.
- PADR-0042: shape A is unreachable in 0.3.0; P1 implements shape B only and refuses new presets as
  ladder agents. PADR-0044 is unchanged: no new field, and its billing class `local` is used by no
  preset in 0.3.0 (the local presets request and observe `unknown`).
- A user who benches Codex logs in once more, into Practonaut's client home, and keeps that home
  free of anything Codex did not write. Codex's own configuration, instructions and sessions of the
  user are not used.
- The new presets are useful to users, not to the gate: their results are "template: not
  restricted", their billing is `subscription` (with possible paid credits) or `unknown`, and their
  parsers are experimental. That is the price of not starting real clients in 0.3.0.
- `claude-code` keeps its 0.2.0 prompt delivery; whether Claude Code reads the prompt twice stays
  open until the later capture.
- Codex and opencode keep doing network traffic of their own where no switch is known; Practonaut
  does not observe it. "Loopback only" describes the model endpoint the client was configured for.

## Re-assessment triggers

Real client output can be captured under an operating-system network block (the parsers move to
version 1, the red-team protocol runs, and the local billing class and Claude Code's prompt
delivery are re-assessed); a client's own stream starts to list the tools it offers; a client
renames a key a type probe covers, or the read-back fails on a new version; a client stops writing
the record decision 6 reads; the maintainer's terms decisions change (Codex runs through a ChatGPT
subscription, paid API use); Gemini CLI serves personal accounts again, or 0.4.0 starts; a sealed
runner exists; a user reports a Codex login that breaks in Practonaut's client home, or a shim that
the run's environment cannot resolve; opencode starts no longer with a read-only configuration
folder.

## Review (2026-10-18)

Three independent reviews of the first draft: Claude Opus (`opus-…`; 1 blocker, 7 major, 10 minor,
and gaps; with probes of its own), OpenAI Codex `gpt-6.1-sol` (`codex-…`; static, no client
started) and Google `gemini-3.8-flash` (`gemini-…`). All three converged on the two blockers (no
enforced network block for the capture; "local" not attestable). The coordinator decided the scope
for 0.3.0 (Context); this revision applies it and every other finding that still matters under it.

| Finding | Disposition | Where, or why not |
|---|---|---|
| opus-1 [blocker] capture network not enforced | adopted | Scope 4: no capture starting real clients in 0.3.0; D8 requires an OS-level network block for the later capture; D9 model-free probes only |
| opus-2 [major] capture counting contradicts PADR-0042 D4 | adopted | D8: a later capture follows PADR-0042 D4 as written; the claim "listed, not counted" is withdrawn |
| opus-3 [major] claude-code capture credential handling | adopted | No capture in 0.3.0; D8 requires a separate data and login store and no real credential |
| opus-4 [major] HOME-relative shims | adopted | D1: binary resolved and `--version` probed in the run's own environment; `bench_client_unavailable`; Context names the shims |
| opus-5 [major] Codex home trusted by one file name | adopted | D2: private-file checks of `auth.json`, refusal of every entry Codex does not write (`.env`, `AGENTS*.md`, `config.toml`, profiles, hooks, rules, extra skills), checked before every run |
| opus-6 [major] unknown `-c` keys ignored; `--strict-config` only for `config.toml` | adopted | D2: type probe of every security-relevant key and `mcp get --json` read-back; Context records the reviewer's probe |
| opus-7 [major] subscription hides paid overage; missing limit ids | adopted | D2: plain statement on credits and spend caps; D5: `*_usage_limit_reached` and `rate_limit_reached` are `usage_limit` |
| opus-8 [major] local attests remote | adopted | Scope 3: billing `unknown`; D3 "What loopback shows" (Ollama cloud models, managed layers); D6: records never billing evidence |
| opus-9 [minor] `update_plan` is removable | adopted | D7: the level rests on the stream argument; the switch inventory is corrected and no longer carries the conclusion |
| opus-10 [minor] hand-picked `--disable` list; retries; MCP approval | adopted | D2: disable every feature the probe shows on except a reviewed keep-list; retries and timeouts pinned; `default_tools_approval_mode="approve"` |
| opus-11 [minor] opencode export | adopted | D6: after the host closed, configuration without `mcp`, read-only folders, `--sanitize --pure`, validated session id, deadline and cap |
| opus-12 [minor] permission wildcard; `--title` | adopted | D3: exact advertised tool names; `--title practonaut-bench` |
| opus-13 [minor] JSON writer keys | adopted | D4: recursive refusal of braces in keys and values |
| opus-14 [minor] TOML encoder sentence about Gemini policies | adopted | Sentence dropped; D12 keeps room for the policy files without naming a writer |
| opus-15 [minor] `client-attested` label for a preset-requested URL | adopted | Moot under scope 3: no local attestation; the label is not used for an endpoint |
| opus-16 [minor] `--keep-env` undefined for new presets | adopted | D2: forbidden names; D3: refused for local presets (after the re-review); `bench_keep_env_forbidden` |
| opus-17 [minor] endpoint parsing | adopted | D1: WHATWG parser, serialised host checked, `href` passed on, `localhost` refused |
| opus-18 [minor] stand-ins circular | adopted | D10: stand-ins show Practonaut's side only; client behaviour waits for the later capture |
| opus gap: cloud-delivered Codex configuration | adopted | D3 "Not covered" |
| opus gap: skills discovery | adopted | D2: extra skills refused in the Codex home; D3: `OPENCODE_DISABLE_EXTERNAL_SKILLS`, `OPENCODE_DISABLE_CLAUDE_CODE` |
| opus gap: project root discovery above the run folder | adopted | D2 and D3: `project_root_markers=[]` (type-probed) and `GIT_CEILING_DIRECTORIES` |
| opus gap: keychain and preference domains do not follow `HOME` | adopted | Context and D3 "Not covered" |
| opus gap: bounded client-record reads | adopted | D6: 16 MiB cap, bounded memory; D5 `complete` |
| opus gap: report validator accepts unknown preset names | refuted | PADR-0044 D5 keeps older reports readable on purpose; `--verify` checks the name and arguments in the Practonaut version that wrote the report |
| opus gap: per-version capture cannot keep pace | adopted | D9: probes per installation on every bench; keep-lists and parsers per version; no capture in 0.3.0 |
| opus gap: Codex preset cost against value | adopted with change | The preset stays (the roadmap names Codex CLI) but small: users' own runs, not gate-eligible, experimental parser |
| codex-1 [blocker] provider name plus requested configuration is no endpoint proof | adopted | Scope 3: billing `unknown`; Options "Billing class of a local run" |
| codex-2 [blocker] capture without enforced network block | adopted | Scope 4; D8; D9 |
| codex-3 [major] new billing evidence outside the ledger anchor | adopted | Moot under scope 3: client records carry no billing and are no report field; `client.request.json` dropped; D6 says what the record is used for |
| codex-4 [major] bounded reads carry no complete negative statements | adopted | D5: `complete`; positive isolation evidence and exemptions only when complete |
| codex-5 [major] `beforeModelWork` and unfinished generation | adopted | D5: true only for an identified refusal of the first request with nothing streamed; `partial-then-auth` stand-in; always null for version 0 |
| codex-6 [major] Codex home weaker than the private-file contract | adopted | D2: `src/platform/private-fs.ts` rules for the home and `auth.json`; unexpected entries refused before every run |
| codex gap: switch inventory from help and `strings` | adopted | D7: the conclusion rests on the stream, not on the inventory |
| codex gap: writers — recursive keys, real round-trips | adopted | D4: recursive refusal; D2: read-back in Codex itself |
| codex gap: other credential sources (`.env`, credential stores) | adopted | D2: `.env` refused in the Codex home; D3 "Not covered" names credential stores; the agent folder starts empty |
| codex gap: extra processes (probe, export) without a contract | adopted | D1 and D9: environment, working directory, deadline, output cap; D6: export contract |
| codex gap: one version does not cover a minor line | adopted | D9: probes on every bench against the installed version |
| codex gap: meaning of `local` | adopted | Scope 3: `unknown` in 0.3.0 |
| codex gap: complexity; smaller start | adopted | Scope 1–5: no capture, no local attestation, experimental parsers |
| gemini-1 [blocker] substitution bypass with spaces or case | adopted | D4: any brace refused, recursively; D1: model id pattern |
| gemini-2 [blocker] agent can forge the rollout | adopted | D6: records are information only, never billing, isolation or exemption evidence |
| gemini-3 [major] capture network contradiction | adopted | Scope 4; D8; D9 |
| gemini-4 [major] a server that is down burns budget | adopted with change | D3: counted (scope 3), but a local bench stops at its first `infra_error`, so a down server costs one run |
| gemini-5 [major] unvalidated session id | adopted | D6: id shape checked; otherwise no export |
| gemini-6 [major] `--keep-env` brings cloud keys into local presets | adopted | D3: `--keep-env` refused for local presets (after the re-review) |
| gemini-7 [minor] `opencode-local` in shape A | adopted | D7: no new preset is gate-eligible; shape B |
| gemini-8 [minor] Windows escaping of `-c` | adopted | D2: read-back on every platform; D4: Windows spawn arguments tested |
| gemini-9 [minor] shared Codex home pollution | adopted with change | D2: checked before every run and refused on unexpected entries; nothing deleted |
| gemini gap 1: IPv6 brackets | adopted | D1: the WHATWG parser's serialisation `[::1]` |
| gemini gap 2: non-JSON lines from opencode | adopted | D5: skipped and counted |
| gemini gap 3: log latency or headers to detect a forwarding server | refuted | Practonaut sees no model traffic and never calls a model; scope 3 makes the class `unknown` instead |
| gemini gap 4: rollout clean-up and thread-id collisions | adopted | Per-run `CODEX_HOME` (D3) holds one session; D6 resolves the file by the stdout's thread id inside that folder |

Counts over the 52 rows: adopted 47, adopted with change 3, refuted 2.

## Re-review (2026-10-18)

Codex `gpt-6.1-sol` re-reviewed the revision (static, no client started). It confirmed the earlier
blockers resolved by the scope decision — no capture; local runs `unknown` and counted; version-0
parsers give `beforeModelWork: null`; client records ground neither billing nor isolation; the
Codex hardening; the new presets outside the gate — and found no remaining path to a run that is
wrongly not counted. One major remained.

| Finding | Disposition | Where, or why not |
|---|---|---|
| codex-r1 [major] `--keep-env OPENCODE_CONFIG_CONTENT` (or `OPENCODE_CONFIG_DIR`) redirects `opencode-local` to a paid API under the same provider name | adopted | D3: `--keep-env` refused for local presets, the allowlist is the whole environment; D10: stand-in tests of the refusal and of a planted `OPENCODE_CONFIG_CONTENT` |
| codex-r gap: the Codex login guard is not confirmed by real client behaviour; unknown versions only named on stderr | adopted with change | D2 states that the refusal of a stored API-key login is documented, not measured; an unknown version stays a named warning for users' own runs (the project makes none), and the probes and home check still apply |

Counts over the 2 rows: adopted 1, adopted with change 1.

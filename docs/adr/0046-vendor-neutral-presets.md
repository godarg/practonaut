# PADR-0046 — Vendor-neutral presets: one registry, Codex and two loopback presets, client configuration that fails closed, and isolation only from each run's own stream

Status: proposed · Date: 2026-10-18 · Roadmap 0.3.0, strand P4 (issue #47) · Refines
[PADR-0034](0034-preset-agents-get-no-provider-credentials.md) for every preset after `claude-code` ·
Supplies the parsers, preset values and billing evidence that
[PADR-0044](0044-bench-report-v3.md) decision 5 leaves to P4, and applies its decision 6 and
[PADR-0042](0042-gate-for-families-on-toolchains.md) decision 5 to the new clients · Implements the
maintainer's terms decisions of 2026-10-18 · Design only; to be accepted after an independent review,
before the change that implements it (P4b) touches `src/bench/`

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

**Read-only facts of 2026-10-18** on the maintainer's machine — claude 2.1.302, codex-cli 0.159.2,
opencode 1.4.11, gemini 0.52.0 installed, no local model server. Gathered with `--help`,
`--version`, `codex features list` and by reading names and text in the installed executables
(`strings`); no session was started, nobody logged in, no prompt was sent. Facts from executables
are what the code contains, not measured behaviour; P4b measures them (decision 10).

- *Codex, `codex exec --help`.* "If stdin is piped and a prompt is also provided, stdin is appended
  as a `<stdin>` block." `-c key=value` is "parsed as TOML. If it fails to parse as TOML, the raw
  string is used as a literal." `--ignore-user-config` ("auth still uses `CODEX_HOME`"),
  `--ignore-rules`, `--ephemeral`, `--strict-config` (error on unrecognised fields in
  `config.toml`), `--skip-git-repo-check`, `--json` (JSONL events on stdout), `-s read-only`,
  `--disable <feature>`, `--oss` with `--local-provider lmstudio|ollama`.
- *Codex, `codex features list`.* 152 feature switches; on this machine's effective configuration
  52 are on, among them `shell_tool`, `unified_exec`, `view_image`, `browser_use`, `computer_use`,
  `image_generation`, `multi_agent`, `apps`, `plugins`, `hooks`, `skill_search`, `tool_suggest`,
  `sleep_tool` and `daemon_auto_start`. Neither the help nor the list shows a switch that removes
  `apply_patch`, `update_plan` or the MCP resource tools (`list_mcp_resources`,
  `read_mcp_resource`), whose names are in the executable.
- *Codex 0.159.2 executable.* `` `wire_api = "chat"` is no longer supported `` — a custom provider
  must speak the Responses API. The `--json` events are `thread.started` (a thread id),
  `turn.started`, `turn.completed` (usage: input, cached input, cache write, output and reasoning
  output tokens), `turn.failed`, `item.started|updated|completed` (items such as
  `command_execution`, `file_change`, `mcp_tool_call` with server and tool, `web_search`,
  `collab_tool_call`) and `error`; none carries the model, the client version, the provider or the
  offered tools. Its Ollama support for `--oss` contains a model pull (`/api/pull`, "Pulling
  model"). Error identifiers include `usage_limit_reached`, `quota_exceeded`,
  `usage_not_included`, `server_overloaded` and `workspace_*_credits_depleted`. The session record
  (rollout) has `session_meta` with `model_provider` and `cli_version` and `turn_context` with
  `model`. Configuration names: `forced_login_method`, `cli_auth_credentials_store`,
  `model_provider`, `model_providers.<id>.{base_url, wire_api, env_key, experimental_bearer_token,
  http_headers, env_http_headers, requires_openai_auth, aws}`, `check_for_update_on_startup`,
  `project_doc_max_bytes`, `shell_environment_policy`. Environment names: `OPENAI_API_KEY`,
  `OPENAI_BASE_URL`, `OPENAI_ORGANIZATION`, `OPENAI_PROJECT`, `CODEX_API_KEY`,
  `CODEX_ACCESS_TOKEN`, `CODEX_CONNECTORS_TOKEN`, `CODEX_HOME`, `CODEX_SQLITE_HOME`,
  `CODEX_OSS_BASE_URL`, `CODEX_OSS_PORT`, `CODEX_REFRESH_TOKEN_URL_OVERRIDE`,
  `CODEX_REVOKE_TOKEN_URL_OVERRIDE`, `CODEX_AUTHAPI_BASE_URL`, `CODEX_AGENT_IDENTITY_JWKS_BASE_URL`,
  `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, `CODEX_EXEC_SERVER_URL`, `CODEX_CA_CERTIFICATE`, and for its
  Amazon Bedrock provider `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_PROFILE`,
  `AWS_BEARER_TOKEN_BEDROCK`.
- *opencode 1.4.11 executable* (bundled JavaScript). `run --format json` writes one line
  `{type, timestamp, sessionID, …}` per `tool_use`, `step_start`, `step_finish` (tokens, cost),
  `text`, `reasoning` and `error`; the assistant message that names the provider and the model is
  printed only in the default format, on the terminal. A piped stdin is appended to the message
  (`if (!process.stdin.isTTY) message += "\n" + stdin`). In `run`, a permission request is
  auto-rejected and announced in a line that is not JSON. A tool is removed from the model's tool
  list when the last permission rule that matches its name has pattern `*` and action `deny`
  (`Permission.disabled`); without a rule the action is `ask`. `tools: {name: false}` becomes such
  a rule; `OPENCODE_PERMISSION` is merged into the configuration. Configuration values may contain
  `{env:NAME}` and `{file:path}`, which opencode substitutes. `enabled_providers` limits the
  providers. A managed configuration is read from `/Library/Application Support/opencode` (macOS),
  `%ProgramData%\opencode` (Windows) or `/etc/opencode`, and from macOS managed preferences.
  `@ai-sdk/openai-compatible` (Chat Completions) is bundled. Environment names include
  `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_CONFIG_DIR`, `OPENCODE_AUTH_CONTENT`,
  `OPENCODE_API_KEY`, `OPENCODE_CONSOLE_TOKEN`, `OPENCODE_PERMISSION`, `OPENCODE_SERVER_PASSWORD`,
  `OPENCODE_MODELS_URL`, `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE`,
  `OPENCODE_DISABLE_EXTERNAL_SKILLS`, `OPENCODE_DISABLE_DEFAULT_PLUGINS`, `OPENCODE_PURE`,
  `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_SHARE` and
  `OPENCODE_DISABLE_LSP_DOWNLOAD`.
- *Gemini CLI 0.52.0, `gemini --help`.* `-p` is "appended to input on stdin (if any)";
  `--output-format stream-json`, `--policy` (policy files), `--allowed-mcp-server-names`,
  `--approval-mode`.
- *Claude Code 2.1.302.* Whether it joins a piped stdin to a `-p` prompt argument is not stated in
  its help and is not settled by reading its executable: **unknown**. The 0.2.0 preset sends both.

Three consequences follow. No client except Claude Code lists the tools it offers in its own
stream, so under PADR-0044 decision 6 no new preset can be "tool-restricted". Neither new client's
stream names its model, version or endpoint, so a local run's billing evidence must come from a
record the client writes besides stdout. And at least Codex, opencode and Gemini CLI join stdin to a
prompt argument, so a preset must deliver its prompt once.

## Options considered

**Registry.** (1) More argument lists in `AGENT_PRESETS` and branches in the runner. Every client
differs in configuration format, environment, prompt channel and stream; branches would spread over
`run.ts`, `evidence.ts` and `report.ts`. (2) One typed definition per preset, with its builder and
parser, read by a client-neutral runner (chosen).

**Where the Codex login comes from.** (1) The user's `CODEX_HOME` with `--ignore-user-config`.
`config.toml` is skipped, but the home also holds global instructions (`AGENTS.md`), skills, hooks,
plugins and sessions, and which of them `--ignore-user-config` skips is not documented. (2) A
per-run home with a copy of the user's `auth.json`: a credential in the bench folder. (3) A
Practonaut-owned client home that holds only the login the user makes there once (chosen).

**How Codex gets its configuration.** (1) A `config.toml` written into the client home: for the
subscription preset that is the home holding the credential, shared by every bench. (2) A profile
file (`-p`) in the same home. (3) `-c` overrides produced by one tested TOML encoder, with
`--strict-config` (chosen): nothing is written beside the credential, one code path serves both
Codex presets, and the literal-string fallback is closed by always quoting strings (decision 4).

**Environment of a local preset.** (1) PADR-0034's withholding rule plus more names. Every cloud
credential would need a name or a pattern, and a missed one could reach a cloud provider. (2) An
allowlist (chosen). PADR-0034 rejected an allowlist because logins need platform-specific variables;
a local preset has no login.

**Evidence that a local run used the loopback endpoint.** (1) Practonaut relays the model traffic and
records it — Practonaut would call a model (rejected by the maintainer's decision). (2) A health
check — rejected by the same decision, and it says nothing about the run. (3) The client's log on
stderr — not a stable interface and not bound. (4) The client's own session record naming the
preset's provider entry, read after the run, plus the preset's recorded configuration that binds
that entry to the loopback URL (chosen). In neither executable did we find a field of the run
output or the session record that holds the URL; the capture of decision 10 checks this.

**Isolation of clients whose stream lists no tools.** (1) Trust the configuration: contradicts
PADR-0044 decision 6. (2) A listing before the run (opencode's `debug agent` prints an agent's
tool map, as its executable shows): a separate process, not the run's own stream. (3) A red-team
result: it can find a route, never show that none exists. (4) "template: not restricted" with the
reason `no-evidence` or `tool-outside-servers` (chosen).

**Codex against a local server.** (1) `codex --oss`: the endpoint then comes from
`CODEX_OSS_BASE_URL`, `CODEX_OSS_PORT` or a provider default, and its Ollama support can pull a model
onto the server (the executable's text; not measured). (2) An explicit provider entry whose
`base_url` is the validated loopback URL (chosen).

**Shapes for stand-ins and parser tests.** (1) Written by hand from documentation. (2) Captured from
the real client against a scripted loopback endpoint and stripped of paths and ids (chosen), with
shapes reconstructed from the executable only as labelled placeholders until the capture exists.

## Decision (proposed)

1. **One registry.** `src/bench/presets/` holds one definition per preset (sketch below): the
   preset name and version (`codex/1`), the client program (PADR-0044 `agent.client`) and the
   binary looked up on `PATH`, the client minor lines its conformance capture covers (decision 10),
   the requested billing class, the vendor mapping, which of `--model` and `--endpoint` it needs,
   its environment rule, its prompt channel, a builder and a parser. The runner is client-neutral:
   it asks the builder for the arguments, environment and files of a run, starts the client as
   today (no shell, own process group, deadline), and hands the bound outputs to the parser.
   - **Before the first run** the runner calls `<binary> --version` once (it starts no session),
     records the version as `clientVersion` with the source `preset-requested` (what Practonaut
     started; a client record that states its version overrides it per run as `client-attested`),
     and names on stderr a minor line the preset's capture does not cover. `bench` does not refuse
     an uncovered minor line; the gate does (PADR-0042 decision 12).
   - **Files** the builder asks for are written before the client starts, inside the run folder
     only, directories `0700`, files `0600`, never over an existing file (`wx`).
   - **One prompt channel.** A definition says `stdin` or `argv`; the runner writes the prompt to
     stdin only for `stdin` and otherwise gives the client a stdin that ends at once (`/dev/null`
     or `NUL`). Codex and opencode take the prompt on stdin (Codex with the positional `-`), so
     neither appends a block. For `claude-code` the capture of decision 10 decides: if Claude Code
     joins stdin to `-p`, its preset moves to `argv` only, as a new preset version, before the
     first 0.3.0 model run. Command templates keep 0.2.0's behaviour (stdin always, `{prompt}`
     optional). The channel is recorded in `agent.settings` (`prompt=stdin`), so `compare` names a
     difference (PADR-0044 decision 5).
   - **New options.** `--model <id>` reaches the client through its model switch (Claude Code
     `--model`, Codex `-m`, opencode `-m <provider>/<id>`) and is PADR-0044's `requestedModel`;
     without it, `claude-code` keeps reading `ANTHROPIC_MODEL` as today. `--endpoint <url>` is for
     the local presets only and is required there, as is `--model`. Refusals before the first run,
     each with a named code (English and German like every CLI text): a local preset without
     `--endpoint` or `--model` (`bench_model_required`, `bench_endpoint_required`), an endpoint that
     is not loopback (`bench_endpoint_not_loopback`), `--endpoint` for any other agent
     (`bench_endpoint_not_applicable`), `--keep-env` of a name the preset sets itself (`CODEX_HOME`,
     `HOME`, `XDG_*`; `bench_keep_env_preset_owned`), and a configuration value the writers of
     decision 4 refuse (`bench_client_config_unencodable`).
   - **Loopback** means an `http:` or `https:` URL whose host is a literal address in `127.0.0.0/8`
     or `::1`, without user, password, query or fragment; `localhost` is refused, because its
     resolution is outside Practonaut's view. Practonaut never connects to the endpoint, and does not
     check how the server is bound or where it forwards (decision 6).

2. **The `codex` preset (ChatGPT login, the user's own runs).** Billing requested: `subscription`.
   Vendor: `openai`.
   - **Client home.** A Practonaut-owned directory `<data directory>/clients/codex/` (`0700`),
     never inside a bench folder. The user logs in there once with the command `bench` prints, for
     example `CODEX_HOME="<dir>" codex login -c cli_auth_credentials_store="file"`; Practonaut never
     handles the credential. `bench` refuses before the first run when `auth.json` is missing there
     (`bench_client_login_missing`; the file's name is checked, never its content).
   - **Fails closed on the login.** Every run passes `forced_login_method="chatgpt"` and
     `cli_auth_credentials_store="file"`: a stored API-key login is refused by Codex rather than
     billed. The preset has no API-key mode; API billing through Codex is a command template.
   - **Arguments** (the `-c` values through decision 4's encoder): `codex exec --json --ephemeral
     --skip-git-repo-check --ignore-user-config --ignore-rules --strict-config -s read-only`, the
     login settings, `approval_policy="never"`, `model_provider="openai"`,
     `project_doc_max_bytes=0`, `check_for_update_on_startup=false`, web search off,
     `shell_environment_policy.inherit="core"`, the MCP server
     `mcp_servers.practonaut` (command, arguments and environment of the run's bridge, as the
     `{mcp_config}` file names them), `--disable` for every built-in capability the covered minor
     line has a switch for (in 0.159: `shell_tool`, `unified_exec`, `view_image`, `browser_use`,
     `browser_use_external`, `computer_use`, `image_generation`, `multi_agent`, `apps`, `plugins`,
     `hooks`, `memories`, `skill_search`, `tool_suggest`, `sleep_tool`, `goals`,
     `daemon_auto_start`, `system_proxy_fallback`, `realtime_conversation`), `-m` when `--model` is
     given, and `-` (the prompt on stdin). The disabled switches, the sandbox and the approval mode
     are recorded in `agent.settings`. They reduce what an unattended run can do on the user's
     machine and make a score more comparable; they are not an isolation claim (decision 7). Key
     names that this record takes from the executable's text (the web-search key among them) are
     fixed by the capture of decision 10 for each covered minor line.
   - **Environment.** PADR-0034's rule, plus every name that starts with `OPENAI_` and every name
     that starts with `CODEX_` except `CODEX_CA_CERTIFICATE`, plus `AWS_ACCESS_KEY_ID`,
     `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` and `AWS_PROFILE`; the preset then sets
     `CODEX_HOME` to the client home. The prefixes cover the next variable of the same family, as
     `CLAUDE_CODE_USE_` does in PADR-0034. `bench` names the withheld variables on stderr as today.
   - **Evidence.** Model: requested only, labelled "not attested" (the stream names none; with
     `--ephemeral` no session record is written). Billing observed: `subscription` with the source
     `preset-requested` (`codex/1:login.forced`); PADR-0044 counts it as a subscription agent either
     way.

3. **The two local presets.** Billing requested: `local`. Vendor: `none`. Model: requested only,
   never attested — the client can state only the name it sent; which weights answered is not
   known (PADR-0042 decision 6).
   - **Environment from an allowlist.** The client starts with `PATH`, the locale variables
     (`LANG`, `LC_*`, `TZ`), `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `TMP`, `TEMP` and, on Windows,
     `SYSTEMROOT`, `SYSTEMDRIVE`, `WINDIR`, `COMSPEC`, `PATHEXT`, `NUMBER_OF_PROCESSORS`,
     `PROCESSOR_ARCHITECTURE`, `OS` and `PROGRAMFILES` — plus names kept with `--keep-env`, plus
     what the preset sets: `HOME` (and `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` on Windows) and
     `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` below the run's client
     directory `<run folder>/client/` (a sibling of the agent's `agent/` folder, outside its working
     directory), `NO_PROXY` and `no_proxy` set to the loopback addresses, and `PRACTONAUT_HOME` as
     today. No cloud credential, proxy, client switch or inline configuration of the user reaches
     the client, whatever its name. `bench` says on stderr that the preset starts from an allowlist
     and, as today, names the variables of PADR-0034's rule it did not pass.
   - **`codex-oss`.** `CODEX_HOME` is `<run folder>/client/codex-home/`, empty before the run. The
     arguments are those of decision 2 without the login settings, without `--ephemeral` and with
     its own provider in place of `openai`:
     `model_providers.practonaut-loopback={name="Practonaut loopback", base_url="<endpoint>",
     wire_api="responses", requires_openai_auth=false}`, `model_provider="practonaut-loopback"` and
     `-m <model>`. No `--oss`. The user must run, on a loopback address, a server that implements the
     OpenAI **Responses API** (`POST <endpoint>/responses`, streamed, with function tools) for a
     model that can call tools; which local servers do so, from which version, is the user's to
     check.
   - **`opencode-local`.** The configuration is a file `<run folder>/client/opencode.json` named by
     `OPENCODE_CONFIG`: `enabled_providers` holding only `practonaut-loopback`; that provider with
     `npm: "@ai-sdk/openai-compatible"`, `options.baseURL` the endpoint, and the one model with tool
     calling; `model` and `small_model` set to it (so no other model is chosen for titles or
     summaries); the MCP server `practonaut` (`type: "local"`, the bridge's command, arguments and
     environment); `permission` `{"*": "deny", "practonaut_*": "allow"}` (every built-in tool
     removed, decision 7); `share: "disabled"`, `autoupdate: false`; no instructions and no plugins.
     The environment adds `OPENCODE_DISABLE_PROJECT_CONFIG`, `OPENCODE_DISABLE_CLAUDE_CODE`,
     `OPENCODE_DISABLE_EXTERNAL_SKILLS`, `OPENCODE_DISABLE_DEFAULT_PLUGINS`,
     `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_SHARE`,
     `OPENCODE_DISABLE_LSP_DOWNLOAD` (each `1`) and `--pure`. Arguments: `opencode run --format json
     -m practonaut-loopback/<model>` with the prompt on stdin. The user must run, on a loopback
     address, a server that implements the OpenAI **Chat Completions API** (`POST
     <endpoint>/chat/completions`, streamed, with `tools`) for a model that can call tools.
   - **Not covered** (as PADR-0034 names a managed `apiKeyHelper`): system-wide and managed
     configuration — Codex's `/etc/codex/config.toml`, `requirements.toml` and `managed_config.toml`
     and its device-management layer, opencode's managed directories and macOS managed preferences
     (all named in the executables) — which the clients apply wherever they run; this holds for the
     `codex` preset too. The per-run `HOME` hides every per-user path the clients look up; it does
     not hide anything from a tool the agent runs (decision 7).

4. **Configuration writers.**
   - **TOML values for Codex `-c`.** One encoder, `tomlValue`, accepts strings, booleans,
     non-negative safe integers, arrays of one of these, and inline tables whose values are one of
     these; anything else is refused before the client starts. A string is always a TOML basic
     string: `\` and `"` escaped, `\b \t \n \f \r` for those controls, `\uXXXX` for every other
     character in U+0000–U+001F and U+007F, every other character as UTF-8; a string with a lone
     surrogate is refused. A string is never emitted bare, so a value such as `true`, `[1]` or
     `{a=1}` stays a string, and no emitted value can fall back to a literal. Keys of `-c` paths are
     fixed in the preset definitions (`mcp_servers.practonaut.args`, …), never user input; a table
     key that is not `[A-Za-z0-9_-]+` is quoted. The same encoder writes Gemini CLI's policy files
     in 0.4.0.
   - **JSON for opencode.** `JSON.stringify` of an object the builder assembles, after refusing any
     string that contains `{env:` or `{file:`, which opencode would substitute — a model id or a
     path must not inline a variable or a file.
   - **Tests** (P4b, unit): a table of hostile values — quotes, backslashes, a Windows path
     (`C:\Users\a b\x.js`), newline, tab, U+0000, U+001F, U+007F, U+2028, an emoji, an empty string,
     strings that read as TOML booleans, arrays and tables — with the expected encodings written by
     hand from the TOML 1.0 specification, not taken from the encoder; refusals for a lone surrogate
     and a nested array of tables; the opencode refusal for both substitution forms. The capture of
     decision 10 shows Codex reading the encoded MCP server back (the bridge starts with exactly its
     arguments).

5. **Parsers.** Each preset names one versioned parser of its stdout (PADR-0044 `client.parser`)
   and, where it reads one, one of its client record. A parser is a pure function of bytes, reads
   only the bounded parts of PADR-0044 decision 5, and returns: model, client version, the offered
   tools and servers (or "not listed"), the tools the stream shows the agent using, the client's
   figures (turns, tokens with an optional reasoning count, cost), the failure, and the observed
   billing class with its `via`. Unknown is `null`, never a guess.
   - **Failures.** `usage_limit`, `auth` or `api_error` with `code` — the client's own identifier
     (an error identifier such as `usage_limit_reached`, an HTTP status, an error class name such as
     opencode's), never free text — and `beforeModelWork`: true when the stream shows no completed
     model output, no tool use and no non-zero token count before the failure; false when it shows
     any; null otherwise. Per client: Codex `usage_limit_reached`, `quota_exceeded`,
     `usage_not_included` and 429 are `usage_limit`; 401, 403, a refused or expired login and
     `*_credits_depleted` are `auth`; 5xx, `server_overloaded` and a failed connection to the
     provider are `api_error`; any other 4xx stays the agent's. opencode's `error` lines are
     classified by their status code and error name in the same way. `claude-code-stream/1` keeps
     today's classes (`clientFailure`).
   - **Identifiers and `via` values.** `claude-code-stream/1` (`init.apiKeySource`, `init.tools`,
     `init.mcp_servers`); `codex-exec-json/1` (stdout; no model, version, tools or billing
     statement); `codex-rollout/1` (`session_meta.model_provider`, `session_meta.cli_version`);
     `opencode-run-json/1` (stdout; no model, version, tools or billing statement);
     `opencode-export/1` (the provider of each assistant message, the session's version).
   - **Tools used.** A Codex item `command_execution`, `file_change`, `web_search` or
     `collab_tool_call`, an `mcp_tool_call` whose server is not `practonaut`, or an opencode
     `tool_use` whose tool is not `practonaut_<tool>` for a tool the bridge advertised, is evidence
     `tool-outside-servers` (PADR-0044 decision 6).

6. **Billing evidence of a local run.**
   - **Client records.** After the agent has ended, the runner copies the client's own session
     record into the run folder as `client.record.*` and binds it like stdout (SHA-256 and size):
     for `codex-oss` the rollout under `client/codex-home/sessions/` whose name holds the thread id
     the stdout's `thread.started` names (resolved inside that directory only, a regular file, no
     link followed); for `opencode-local` the output of `opencode export <sessionID>`, which the
     runner runs once after the agent ended with the run's environment (it reads the run's session
     store and starts no model), the session id taken from the stdout. The configuration the
     preset wrote — its arguments without the prompt, the variables it set (none carries a secret)
     and its files — is kept as `client.request.json` and bound the same way.
   - **The rule.** Observed billing is `local`, source `client-attested`, only when the bound
     client record names the preset's provider entry (`practonaut-loopback`) for every model
     request it lists and the bound `client.request.json` binds that entry to a loopback URL;
     otherwise it is `unknown`. This is how this record reads the maintainer's "the client output
     names the configured loopback endpoint": neither client's run output nor session record has a
     field for the URL (as far as the executables show); the client names the entry, and the
     preset's recorded configuration binds the entry to the URL. Should the capture find a client
     statement of the URL itself, the parser reads that instead.
     A run without a local observation counts as a subscription run (PADR-0044 decision 5), and
     `bench` starts no further run of that preset: the report is written with the remaining tasks as
     not run (`interrupted.stopped`, as `--stop-on-infra` does today) and the stop is named
     (`bench_local_unattested`). PADR-0042 decision 5 refuses such an agent as a local ladder agent.
   - **What `local` shows.** That the client was configured for, and reports using, a provider
     entry whose URL is loopback. Not that a local model answered: a loopback server that forwards
     to a paid API is not detected. The example reports say which server and model the maintainer
     ran.
   - **Schema** (additive under PADR-0044 decision 11, through the schema holder): per run an
     optional `clientRecord: { name, parser, sha256, bytes } | null` and `clientRequest: { sha256,
     bytes }`, an optional `client.tokens.reasoning`, the `via` values of decision 5, and
     `client-attested` defined as "in the run's bound stdout or bound client record". `--verify`
     re-derives every client-attested value from the bound files with the named parser.
   - **A server that is down.** Such a run ends with `api_error` before model work. When its record
     still names the entry (the capture shows whether the clients write it that early), the run is
     observed `local` and its reservation is released; a run that writes no record keeps it.

7. **Isolation in 0.3.0.** PADR-0044 decision 6 applies unchanged; per preset:

   | Preset | The stream lists the offered tools | Built-in tools can be removed | Level |
   |---|---|---|---|
   | `claude-code` | yes (`init.tools`) | yes (`--tools ''`) | tool-restricted when every run's evidence holds |
   | `codex`, `codex-oss` | no | no: `shell_tool` and others have switches; `apply_patch`, `update_plan` and the MCP resource tools have none in 0.159 | template: not restricted |
   | `opencode-local` | no | yes by its permission rules (to be confirmed by the capture) | template: not restricted |

   **No configuration of Codex 0.159.2 reaches "tool-restricted"**: tools remain that no switch
   removes, and its stream lists none. opencode's configuration can remove every built-in tool, but
   no run shows that, so it stays "template: not restricted" with the reason `no-evidence` (or
   `tool-outside-servers` when a run shows one). The registry gives each definition a ceiling:
   only `claude-code` can reach "tool-restricted"; the others cannot, whatever their streams show.
   - **Consequence for PADR-0042 decision 5.** `codex` and `codex-oss` keep tools that cannot be
     removed and stay outside the gate. Whether `opencode-local` may be shape A's local ladder
     agent is P1's decision; this record proposes: only when the capture for its pinned minor line
     shows that the client offers exactly the `practonaut_*` tools and refuses a scripted call of a
     built-in tool, every run of the round shows no tool outside the round's server, and the gate
     report labels it "template: not restricted". Without that, shape B applies.
   - **The honest statement.** Without an operating-system sandbox, an agent with shell or file
     tools can reach hidden data by routes no decoy covers (PADR-0042: regeneration from
     `generatedBy`, the installed library's references, finished bench folders, `practonaut check`
     as an oracle). Codex's own sandbox (`-s read-only`) is the client's claim; Practonaut cannot
     see it work and claims nothing from it (PADR-0010). Such an agent stays "template: not
     restricted" until a sealed runner (roadmap 0.4.0) exists.

8. **Red-team protocol.** It applies to a preset that can reach "tool-restricted" — in 0.3.0 only
   `claude-code` — and to `opencode-local` for the shape-A condition of decision 7. Its job is to
   test the evidence channel (that the tools a client lists are all the tools it offers and runs),
   not to raise any agent's level.
   - **Scripted part, no model, every covered minor line.** Part of the capture (decision 10): the
     scripted endpoint records the tools of every model request and answers with tool calls — every
     offered tool once, then every built-in tool name the client's executable contains that the
     request did not offer, with arguments aimed at decoys (a decoy file beside the agent folder,
     the installed library's references, a finished bench folder). It passes when the request
     offers exactly the listed tools, every unoffered name is refused by the client without effect,
     and no decoy
     content reaches a later request. It shows this for one client version and one configuration;
     it cannot show what a vendor's own endpoint adds, and it says nothing about an agent with a
     shell or file tool.
   - **Model part, only where the scripted part cannot run.** At most 5 model runs per preset and
     client minor line, prompted to reach each route of decision 7, counted against the release's
     800 under PADR-0042 decision 4 unless the model is local. A finding falsifies the preset's
     restriction; no finding is a sample, not proof. 0.3.0 plans none: the scripted part runs for
     every shipped preset.
   - **Per release line.** A gate round names, per client, the capture record of its pinned minor
     line; a round whose client minor line has no passing capture is refused (PADR-0042 decision 12
     already pins the client).

9. **Stand-ins.** `tests/support/fake-codex.ts` and `tests/support/fake-opencode.ts`, built like
   `fake-claude.ts` (an executable first on `PATH`, `.cmd` on Windows, the bridge reached by its
   `file:` URL), started by the real presets. They replay captured lines (decision 10) and act as
   `PN_FAKE_MODE` says: `observe` (one `observe` through the MCP server the preset configured, read
   from the `-c` values or from `opencode.json`), `usage-limit`, `login-expired`, `api-error`,
   `too-long` (the agent's own 4xx), `agent-error`, `silent-crash`, `tool-outside`, and for the
   local presets `provider-mismatch` and `no-record`. They write to `PN_FAKE_STATE` the arguments,
   the **names** of the variables they received, how often the prompt reached them (stdin and
   arguments) and which configuration files they resolved through `CODEX_HOME`, `XDG_*` and `HOME`
   the way the real client looks them up. Tests, each failing without its mechanism: the prompt
   arrives once; no withheld name arrives (a planted `OPENAI_API_KEY`, `CODEX_ACCESS_TOKEN`,
   `OPENCODE_AUTH_CONTENT`, `AWS_SECRET_ACCESS_KEY`); `forced_login_method="chatgpt"` is passed; a
   planted user configuration in the test home (`~/.codex/config.toml`, `~/.codex/AGENTS.md`,
   `~/.config/opencode/opencode.json`, `~/.local/share/opencode/auth.json`) is not resolved; each
   failure mode gives its reason, code and `beforeModelWork`; `tool-outside` gives
   `tool-outside-servers`; `provider-mismatch` and `no-record` give billing `unknown` and stop the
   bench with `bench_local_unattested`; a run folder contains no file named `auth.json`. Expected
   values are written in the tests, not taken from the parsers.

10. **Conformance capture** (P4b's first step, before its code merges). For each preset and the
    installed client: the client is started with the preset's real builder against a scripted
    endpoint on loopback that speaks the client's protocol (Anthropic Messages for Claude Code,
    Responses for Codex, Chat Completions for opencode) — no model, no login, no network beyond
    loopback, a planted user configuration in a throwaway `HOME`. For `claude-code` the endpoint
    comes through `ANTHROPIC_BASE_URL` with a dummy key; for `codex`, through a provider swapped in
    for the capture only, and a second capture with a planted API-key login checks that
    `forced_login_method` refuses it before any request. It records, stripped of paths, ids and
    timestamps, the stdout, the client record and per request the tool names, whether the planted
    instructions or servers appear, and the user message. These become the parser fixtures (with
    the expected values written by hand) and the stand-ins' lines, under
    `tests/fixtures/clients/<client>/<minor>/`. It settles the unknowns above: Claude Code's prompt
    joining, Codex's MCP approval in `exec` and whether its MCP servers run outside its sandbox,
    `--strict-config` on `-c` values, the configuration key names taken from the executable, the
    rollout's place and name, the export's shape, and opencode's removal of denied tools. It
    runs as an opt-in layer (`npm run test:clients`, skipped with a named reason when a client is
    missing), not in CI, by the maintainer once per client minor line. Starting the clients needs
    the maintainer's approval, because this wave's rules forbid it. A capture is not a model run —
    no model answers, no subscription, key or login is used — so it is listed, not counted, like a
    built-in run; PADR-0042 decision 4 counts a client started for a fixture when a real model
    answers it.

11. **Example reports for P4's acceptance line.** After P3b (the /3 writer) and P1's start guard,
    each run taking its ledger entry:
    - `claude-code` through the API key (`--keep-env ANTHROPIC_API_KEY --model <id>`), two library
      tasks, one seed, at most 4 runs counted against the 800; billing `api-key`, isolation from its
      evidence.
    - `codex-oss` and `opencode-local` once the maintainer runs a local server, the same plan, not
      counted when observed `local`; the label names the server and the model.
    - Reports go to `docs/benchmarks/examples/0.3.0/<preset>.json`, with a table in
      `docs/benchmarks/README.md` §9: preset, client version, billing class, isolation level and
      reason, runs — or the reason there are none: `codex` "no project runs (terms): the project
      makes no Codex runs through a ChatGPT subscription in 0.3.0; tested with stand-ins"; a local
      preset without a server "no runs: no local model server installed"; `gemini-cli` "moved to
      0.4.0: Gemini CLI no longer serves personal Google accounts (since 2026-06-18)". Like
      `docs/benchmarks/example-report.json`, they are committed without their bench folders and
      consistency-checked, not re-verified.
    - "Refused by the gate" is shown by P1's tests with stand-ins: a declaration that names `codex`
      as a ladder agent beyond the pair, `codex-oss` as any ladder agent, or a local agent whose runs
      are not observed `local`, is refused with a named code (and `opencode-local` as shape A's local
      agent only under decision 7's condition, if P1 adopts it).

12. **Gemini CLI.** Not a preset in 0.3.0: `--agent gemini-cli` is refused with that reason, as
    `--agent codex` is today. The registry keeps room for it in 0.4.0: a `gemini-stream/1` parser
    of `--output-format stream-json` (whether its first event names the model is checked then), a
    policy file from the
    TOML encoder through `--policy` with `--allowed-mcp-server-names practonaut`, the prompt on one
    channel (`-p` is appended to stdin), and Google's credential variables withheld. 0.4.0 checks
    the terms first.

### Sketch

```ts
type PresetName = 'claude-code' | 'codex' | 'codex-oss' | 'opencode-local';
type ParserId = string;                         // 'claude-code-stream/1', 'codex-exec-json/1', …

interface PresetDefinition {
  name: PresetName; version: number;            // recorded as agent.settings preset=<name>/<version>
  client: 'claude-code' | 'codex' | 'opencode'; // PADR-0044 agent.client
  binary: string;                               // looked up on PATH: 'claude', 'codex', 'opencode'
  coveredMinors: string[];                      // client minor lines with a passing capture, e.g. ['0.159']
  billing: 'subscription' | 'local';            // requested; 'api-key' when --keep-env keeps a provider key
  vendorOf(model: string | null): string;       // 'anthropic' | 'openai' | 'none'
  needs: { model: boolean; endpoint: boolean };
  environment:
    | { mode: 'withhold'; prefixes: string[]; suffixes: string[]; names: string[]; except: string[] }
    | { mode: 'allowlist'; names: string[]; prefixes: string[] };
  prompt: 'stdin' | 'argv';
  ceiling: 'tool-restricted-preset' | 'template-unrestricted';
  build(run: RunContext): {
    argv: string[]; set: Record<string, string>;            // variables the preset sets
    files: Array<{ path: string; text: string }>;            // inside the run folder only
    settings: Array<{ name: string; value: string }>;        // PADR-0044 agent.settings
    request: unknown;                                        // kept as client.request.json
  };
  parser: ClientParser;                                      // reads the bound stdout
  record?: {                                                 // the client's own session record (decision 6)
    parser: ClientParser;
    collect(run: RunContext, stdoutHead: string): Promise<Uint8Array | null>;  // copy (rollout) or export, after the agent ended
  };
}
interface RunContext { runFolder: string; clientDir: string; agentDir: string;
  mcp: { command: string; args: string[]; env: Record<string, string> };
  prompt: string; model: string | null; endpoint: string | null; clientHome: string | null }

interface ClientParser {
  id: ParserId;
  read(input: { head: string; tail: string; failures: string }): {
    model: string | null; version: string | null;
    provider: string | null;                         // the provider entry the client names (decision 6)
    offered: { tools: string[]; servers: string[]; omitted: number } | null;   // null: not listed
    used: string[];                                  // tool names the stream shows the agent calling
    figures: { turns: number | null; costUsd: number | null;
      tokens: { input: number; output: number; cacheRead: number; cacheCreation: number; reasoning?: number } | null };
    failure: { reason: 'usage_limit' | 'auth' | 'api_error'; code: string | null; beforeModelWork: boolean | null } | null;
    billing: { class: 'subscription' | 'api-key' | 'local' | 'unknown'; via: string } | null;
  };
}
```

## Consequences

- P4b changes `src/bench/agents.ts` (the registry replaces `AGENT_PRESETS`; `agentEnvironment`
  takes the definition), `src/bench/run.ts` (the builder, the prompt channel, `--version` before
  the first run, client records, the local stop), `src/bench/evidence.ts` (parsers move behind the
  interface), `src/cli/bench.ts`, `help.ts` and `messages.ts` (`--model`, `--endpoint`, the named
  codes, English and German), the schema additions of decision 6 through the holder, and
  `docs/benchmarks/README.md` §2, §4 and §9, `README.md` and `CHANGELOG.md`. It depends on P3b; the
  example runs depend on P1's guard.
- PADR-0034 stays in force for `claude-code`; this record adds the Codex names and the allowlist
  for local presets. PADR-0034's re-assessment trigger "a second preset for another client" is met
  by this record.
- PADR-0044 gains two optional run fields, a reasoning-token count and a wider definition of
  `client-attested` (stdout or a bound client record); its counting rule and its decision 6 are
  unchanged.
- The `claude-code` preset may change its prompt channel (decision 1), which changes what the model
  reads compared with 0.2.0 reports; `compare` names it through `agent.settings`.
- A user who benches Codex logs in once more, into Practonaut's client home; the user's own Codex
  configuration, instructions and sessions are not used.
- A local preset cannot be run with a provider key, a proxy or the user's client configuration:
  `--keep-env` brings a named variable back on purpose.
- Every capture, example report and stand-in mode is maintenance per client minor line; an
  uncovered minor line still runs outside the gate, named on stderr.
- Codex and opencode keep doing network traffic of their own (update checks, catalogues) where no
  switch is known; Practonaut does not observe it. "Loopback only" describes the model endpoint
  the client was configured for and reports, not every connection of the client.

## Re-assessment triggers

A client's own stream starts to list the tools it offers (opencode's or Codex's — the ceiling of
decision 7 is then re-assessed with the red-team protocol); a client stops writing the record
decision 6 reads, or renames a configuration key or variable this record relies on; a capture
fails for a new minor line; the maintainer's terms decisions change (Codex runs through a ChatGPT
subscription, paid API use); Gemini CLI serves personal accounts again, or 0.4.0 starts; a sealed
runner exists; a user reports a Codex login that breaks in Practonaut's client home; a local
server's API changes (Responses or Chat Completions) in a way the presets rely on.

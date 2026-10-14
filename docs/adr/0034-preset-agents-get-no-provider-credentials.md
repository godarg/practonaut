# PADR-0034 — Preset agents get no provider credentials unless the user keeps them by name

Status: proposed · Date: 2026-10-14 · Roadmap 0.2.0, Must 0 · Refines the agent environment of
[PADR-0030](0030-bench-replaces-unsealed-eval.md)

## Context

`practonaut bench --agent claude-code` started Claude Code with the caller's whole environment
(`src/bench/run.ts`, 0.1.0). The documentation said the preset uses "its own subscription; no API key
is injected" — true for what Practonaut adds, not for what it passed through. Claude Code's
documented authentication order puts cloud-provider switches, `ANTHROPIC_AUTH_TOKEN`,
`ANTHROPIC_API_KEY`, `apiKeyHelper` and `CLAUDE_CODE_OAUTH_TOKEN` above the `/login` subscription, and
in `-p` mode a set `ANTHROPIC_API_KEY` is always used
([authentication](https://code.claude.com/docs/en/authentication#authentication-precedence),
checked 2026-10-14). A developer who has a key exported for other work therefore pays API list price
for every bench run without being told, and a bench result silently depends on which account ran it.

## Options considered

1. **Document it and keep passing everything.** No code; the billing surprise stays.
2. **Start the preset with an allowlisted environment** (PATH, HOME, locale, …). Strongest, but
   every platform, shell setup and Claude Code login method needs different variables (keychain
   access on macOS, `APPDATA` on Windows, proxies, certificates); a missing one breaks the login in
   ways that are hard to diagnose.
3. **Withhold a named set of credential and billing variables, keep everything else, let the user
   keep a named variable on purpose** (chosen).

## Decision

1. A **preset** agent does not receive any environment variable whose name, compared
   case-insensitively, ends in `_API_KEY` or `_AUTH_TOKEN`, or is one of `CLAUDE_CODE_USE_BEDROCK`,
   `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_ANTHROPIC_AWS`,
   `CLAUDE_CODE_USE_MANTLE`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_PROFILE` or
   `ANTHROPIC_FEDERATION_RULE_ID`. These are the variables Claude Code ranks above the subscription
   login, plus provider keys of other vendors (the agent needs none of them to reach Practonaut).
   `CLAUDE_CODE_OAUTH_TOKEN` (the subscription's own token) and model or endpoint choices
   (`ANTHROPIC_MODEL`, `ANTHROPIC_BASE_URL`) pass.
2. `--keep-env <name,…>` passes named variables on anyway. It is refused for built-in agents and
   command templates, which get the environment unchanged: a template is the user's own command and
   brings the credentials it needs.
3. `bench` names the withheld variables on stderr before the first run — names, never values.
4. The rule lives in one function (`agentEnvironment`, `src/bench/agents.ts`) used by the runner;
   a unit test fixes the set from this record and an integration test starts a stand-in `claude`
   through the real CLI, with and without `--keep-env`.

## Consequences

- A user who benches on API billing on purpose adds `--keep-env ANTHROPIC_API_KEY`; the 0.1.0
  behaviour is one flag away.
- `apiKeySource` from Claude Code's `system/init` line goes into `practonaut.bench/2` (Must 2). It is
  evidence, not proof: Claude Code reports `none` for subscription, bearer-token and cloud sessions
  alike.
- Not covered: an `apiKeyHelper` in managed (enterprise) settings, which Claude Code applies wherever
  it runs; whether `--setting-sources ''` excludes a user-level `apiKeyHelper` is not documented. Both
  show in `apiKeySource` once bench/2 records it.

## Re-assessment triggers

Claude Code adds or renames an authentication variable; a second preset for another client; a user
report of a login that breaks because a withheld variable was needed.

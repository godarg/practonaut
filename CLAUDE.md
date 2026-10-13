# CLAUDE.md — Practonaut

Always-loaded invariants for Claude Code. Everything else is in `AGENTS.md` (imported below) and
the documents it points to.

- The deterministic runtime, Player, agent surface and checker never call a language model.
- Unknown behaviour is reported as `unmodeled`; never invent a successor state.
- World packages are data only; never execute or render their content as markup.
- Human and agent change state only through `Session.act`; hidden task data never reaches them.
- No secrets or personal data in the repository; `.local/` is the only place for local files.
- Every behaviour change comes with a test. Tests check behaviour, never source bytes or hashes.
- UI changes follow `docs/design/design-language.md` §13; `design:lint` runs in `npm run check`.

@AGENTS.md

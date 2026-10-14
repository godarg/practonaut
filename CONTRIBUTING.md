# Contributing to Practonaut

Thanks for helping. Bug reports, new tasks, fixes, docs and — especially — a second application
adapter are all welcome. For anything larger than a small fix, open an issue first so we can agree
on the approach.

## Setup (three commands)

Requires Node.js ≥ 22.18, npm and git.

```bash
git clone https://github.com/godarg/practonaut.git && cd practonaut
npm run bootstrap     # locked install without lifecycle scripts, git hook, Chromium, engine + Player build
npm test              # fast offline unit tests
```

`npm run doctor` checks your environment. Install [gitleaks](https://github.com/gitleaks/gitleaks)
if you can; the pre-commit hook then scans what you commit (CI scans anyway).
Run the CLI from source with `node src/cli/main.ts …` or from the build with
`npm run build && node dist/cli/main.js …`.

## Test layers: which to run when

| Change | Run |
|---|---|
| Anything | `npm run check` (types, schemas, docs links, design rules, task library) and `npm test` |
| Core, world format, predicates, checker | + `npm run demo`, `npm run test:integration` |
| Excalidraw adapter or engine build | + `npm run test:adapter` |
| Host, Player, Create flow | + `npm run test:integration`, `npm run test:e2e`, `npm run test:a11y` |
| MCP bridge or bench | + `npm run test:mcp`, `npm run test:integration` |
| Package contents, CLI install path | + `npm run build`, `npm run test:pack` |

The layers after `npm test` need Chromium (installed by `bootstrap`). CI runs all of them; details
in [docs/testing.md](docs/testing.md). Say in your pull request which layers you ran.

## Ground rules

- **Behaviour changes come with tests.** A new safety or correctness check also comes with a test
  that fails without it. Tests check behaviour — never source bytes, file hashes or file lists.
- **Expected values come from somewhere else** than the code under test: a hand calculation, the
  real application, or the separate oracle in `tests/oracles/`.
- **Keep the invariants** in [docs/architecture.md](docs/architecture.md) §10: the core stays
  deterministic, worlds stay data, state changes only through the host, hidden task data never
  reaches the Player or MCP.
- **Visible changes** follow the [design language](docs/design/design-language.md) §13: tokens and
  kit components only (`npm run design:lint` enforces it), EN and DE strings, light and dark,
  keyboard path. Attach screenshots of what you changed.
- **Docs change with the code** they describe. A consequential decision gets a record in
  [docs/adr/](docs/adr/README.md).
- **No secrets, personal data or private recordings** in code, fixtures, logs or screenshots.
  Content you add (tasks, drawings, images) must be your own work or carry a compatible open
  license, declared next to it. Library tasks are CC0-1.0.

## Adding things

**A task to the library.** Create `tasks/excalidraw/sources/<id>/` with `start.excalidraw`,
`goal.excalidraw` (draw them in Excalidraw 0.18.1 or excalidraw.com) and a `task.json` modelled on
an existing one (EN/DE title and prompt, difficulty, options, two label variants). Run
`npm run library:write`. `npm run check` and `tests/unit/library.test.ts` verify every variant
against the checker; `npm run test:adapter` runs the reference solution and near misses through the
real engine. `npx practonaut tasks from-scenes` tells you quickly whether a pair of drawings works.

**A predicate.** Predicates live in `src/predicate/` (bounded language, no regex, no code). Add the
schema in `src/world/schema.ts`, the evaluation with a fuel cost, a counterpart in the checker if
it reads exports, a plain-language rendering for the Player, unit tests with hand-derived results,
and a section in [docs/world-format.md](docs/world-format.md). Run `npm run schema:write` when the
schema changes.

**An action.** Actions are defined in `src/world/` and applied by `src/core/`. A new action needs
the core transition, the checker's own history interpreter (`src/checker/replay.ts`, written
separately), the adapter mapping with read-back in `src/adapters/excalidraw/`, a replay test with an
independently derived golden hash, and a conformance test against the real engine (at least three
repetitions, plus a wrong prediction that must be detected).

**A Playwright update.** `practonaut setup` names the headless-shell download with its size per
platform. After a Playwright bump (Dependabot opens one), run `node tools/measure-headless-shell.ts
--write`: it reads Playwright's own download list for every platform and the CDN's archive sizes
and rewrites the table in `src/cli/chromium-download.ts`. `tests/unit/setup.test.ts` fails until
then and names the command.

**An application adapter.** Read the [adapter guide](docs/adapter-guide.md), then open an
**Adapter request** issue with the answers to its spike questions before writing code.

## Commits and pull requests

- Small, focused commits with a clear message in the imperative, conventional prefix welcome
  (`fix(host): …`, `feat(bench): …`, `docs: …`). Commit only your own paths; no history rewrites
  on shared branches, no `--no-verify`.
- Sign off every commit (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org/). Contributions are accepted
  under the Apache License 2.0.
- Fill in the pull-request template: what changes, how you checked it, which layers you ran.

## Working with AI coding agents

Agents are welcome. [AGENTS.md](AGENTS.md) holds the rules they must follow (and that apply to
people too). You remain responsible for what you submit: read the diff, run the tests.

## Conduct and security

We follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately as described
in [SECURITY.md](SECURITY.md), never in a public issue.

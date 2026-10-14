# Tests and evaluation

How to run the checks and what each one covers. The invariants they protect are listed in
[architecture](architecture.md) §10; [CONTRIBUTING.md](../CONTRIBUTING.md) says which layers to run
for which change. Every behavior change comes with a test; tests check behavior,
never source bytes, file hashes or inventories, so changing a source file or a dependency never
breaks a test by itself.

## Commands

| Command | Needs | Covers |
|---|---|---|
| `npm run doctor` | Node, npm, git | Environment: Node ≥ 22.18, npm, git; optional Docker, gitleaks and Playwright Chromium. |
| `npm run check` | installed deps | `tsc --noEmit`, generated schemas equal committed schemas, documentation links and index, design-token contrast (WCAG 2.2 AA pairs, both themes), design lint. |
| `npm run design:lint` | installed deps | Source rules of the design language for every stylesheet and script under `src/player/`: values only from `design/tokens.css`, known tokens and classes and icons, no `innerHTML` family, inline style, colour literal, `data:` or remote URL. `tests/unit/design-lint.test.ts` holds one red input per rule. |
| `npm run design:gallery` | installed deps | Builds the living design gallery into `.local/gallery/`. |
| `npm test` | installed deps, offline | Unit, property, golden replay against an independent hash oracle, schema, hostile-package, checker, CLI and engine-build tests (`tests/unit/`). |
| `npm run build` | installed deps | Compiles `dist/`, bundles the Excalidraw engine and the offline Player with license notices. |
| `npm run demo` | installed deps, offline | Packs the example world deterministically, validates it, shows the rejection code of every hostile fixture. |
| `npm run test:adapter` | cached Chromium, local engine | Real Excalidraw actions with read-back, wrong prediction, integrity, timeout/abort, hostile imports, render checks, a real UI deletion. |
| `npm run test:integration` | cached Chromium, local engine and Player | Pack, validate, run, adapter apply with read-back, export, checker verdict; host HTTP and security probes; recording → compiled world (`authoring-demo`); native file transfer; recorded Player/MCP parity; evaluation worker; `play <task-id>` from the CLI; `practonaut bench` end to end (oracle with the real mirror, random within the step budget, external command agents, forged report refused; a `tasks from-scenes` task benched with `--world` and `--oracle`, its moved bench folder re-verified, changed world, artifact or reference refused by name, the oracle unreachable for the agent, a stored bench/1 report) and the world/2 native export. |
| `npm run test:e2e` | cached Chromium, local engine and Player | Source/packed serve, full task path, keyboard and pointer actions, real mirror at every step, requested-action oracle with independent hash, replay, XSS and foreign-page CSRF probes, the create and recovery flows, font readiness, native spreadsheet preview. |
| `npm run test:mcp` | cached Chromium, local engine and Player | Official MCP SDK v2 transports, credential and URL handling, output allowlist, limits, Player/MCP interleaving, structured errors, undo/reset; `mcp --task` self-start with the real mirror (observe → act → check_result, no hidden data, watch link on stderr only). |
| `npm run test:a11y` | cached Chromium | axe-core and overflow on actual Player states, EN/DE, light/dark, 1280/320 px, reduced motion, no external requests. Writes ignored `.local/player-a11y/`. |
| `npm run test:pack` | npm registry for dependencies | Tarball file list, `npm install` of the tarball into an empty project, installed CLI pack/validate/run/check, Chromium setup, installed Player and MCP smoke, `npx practonaut mcp --task excalidraw/connect` initialize/tools list, installed `bench --agent oracle` and `report --html`, byte-identical repack. |
| `npm run clean` | — | Removes `dist/`, `coverage/` and `.local/demo/` only; idempotent. |

Supply chain: `npm ci` with `package-lock.json` is the only dependency pin. The engine build
patches the installed Excalidraw by name (each patch must match exactly once) and
`tests/unit/engine-build.test.ts` requires that the bundle contains no CDN URL.

## Independent oracles

Expected values in golden tests come from a source other than the code under test: hand
calculation, the real application, or `tests/oracles/core-hash.ts`, a hash oracle written
separately from `src/canonical` that imports nothing from `src/`.
`tests/fixtures/core/golden-final.json` is hand-authored. `tests/e2e/harness.ts` checks each
accepted DOM-requested action against a separate Session and the oracle hash and replays
every prefix, which detects a host that bypasses the requested transition.

Hostile fixtures are generated at test time by an independent, permissive zip writer
(`tests/support/zipwriter.ts`), so the reader under test never produces its own attack input.

## Platform matrix

| Platform | Status |
|---|---|
| macOS arm64, Node 22 | development target, all layers measured locally |
| Ubuntu, macOS, Windows (Node 22) | CI (`.github/workflows/ci.yml`, required checks `test (<os>)`): check, unit, build, integration, MCP and pack on all three; demo, adapter, e2e and a11y on Ubuntu. Platform branches are also unit-tested with a simulated platform (`tests/unit/platform.test.ts`). Linux and Windows were not tried by hand. |
| Ubuntu, Node 24 and 26 | CI job `node <version> (ubuntu-latest)`, not a required check: check, unit, build, integration, MCP and pack. |

## Evaluator rules for worlds

- Goal predicates check the result, not the path; every task has an alternative valid solution
  and a near miss in the separate checker bundle. The learner world contains neither fixture nor witness.
- Before any verdict, the checker runs counter-probes: empty submission, unchanged start state,
  wrong artifact; all must fail.
- Hints never use hidden data. An agent that can read task data on disk can see reference
  solutions; its bench score is not a sealed result.
- `tools/agent-runs.ts` executes opt-in real agent practice runs; ordinary test suites never call
  a model provider.
- The bundled example's demonstration plays public content only (each task's third hint).
  `tests/e2e/first-minute.test.ts` scans every reply, asset and event the Player receives during it
  for the reference steps and near misses of every library task and the example's held-out task
  (`tests/support/oracle-scan.ts`), with a planted marker as positive control.
- `tools/measure-first-action.ts` measures the time from `npx practonaut` (packed tarball, warm npx
  cache; `--local` for `dist/`) to the first demonstrated action on the board, model-only and with
  the real engine; median of three runs, written to `.local/measure-first-action/`. Budget 30 s.

## Known gaps

- The two timing-sensitive files
  (`tests/e2e/timing/`: initial-module deadline, font readiness; product deadlines of 8–10 s)
  run serially after the concurrent batch: under four parallel browsers they missed their windows.
  One measured product observation stays open: fonts released after the Player's 10 s editor
  deadline do not make the timed-out document ready (one font face stays unloaded; cause not
  isolated). The Player stays failed and Retry builds a working document, which the test pins.

- Screen-reader and 200% zoom checks by a person are not done yet
  ([manual checks](design/manual-player-checks.md)); touch input is not separately tested.
- The native goal verdict is end-state-only. Agents run as the same OS user as the task data.
- No participant study has been conducted; competence transfer is unknown.

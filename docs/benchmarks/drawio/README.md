# draw.io acceptance evidence

The measured acceptance of draw.io as Practonaut's second application
([PADR-0049](../../adr/0049-drawio-adapter.md) decisions 8.4, 8.6 and 8.9; [adapter page](../../adapters/drawio.md)).
draw.io is a registered trademark; Practonaut is not affiliated with, endorsed or sponsored by draw.io Ltd
or draw.io AG. Nothing here is part of the draw.io release; the release is downloaded on request and
never redistributed.

These files were made on commit `43e7416` of the `feat/drawio-adapter` branch, from a clean checkout,
on one machine (macOS 27, Apple M4, Node 22.22.3, Playwright 1.64.0, Chromium 156.0.8078.4), with
draw.io 32.4.1 (`draw.war`, SHA-256 `b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820`).
`tools/drawio-evidence.ts` wrote them, and it checks that the summary was made on that same commit,
from a clean checkout, over every planned sequence, and that the commit and every file outside this
folder were the same after its benches and the compare as before them. Before a release they are made again on the
release commit ([release](../../release.md) step 2).

| File | What it is |
|---|---|
| [`conformance-summary.json`](conformance-summary.json) | The draw.io layer's three runs (`npm run test:drawio`, schema `practonaut.drawio-conformance/2`): commit, Chromium version, the observed sandbox, orders, seeds, per-run totals, per-task counts and every recorded hash. |
| [`excalidraw-oracle/`](excalidraw-oracle/report.json) | `bench --agent oracle --tasks all --seed-list 0,2,4 --mirror required`: the Excalidraw library, bench/3, with its bench folder. |
| [`drawio-oracle/`](drawio-oracle/report.json) | The same on the draw.io library (`--tasks drawio/all`), with its bench folder. |
| [`compare.html`](compare.html), [`compare.json`](compare.json) | `compare excalidraw-oracle/report.json drawio-oracle/report.json --verify`. |

## Three runs agree

Each run is a fresh process with a fresh browser and takes every sequence — for each of the 16 library
tasks in each of 3 variant cases the unchanged start, the reference solution and every near miss, and
for each challenge family (repair, injection, long-horizon, limited-checks, tight-budget) on seeds 1–3 at
difficulty mixed the same three kinds — through `adapter.apply` with every check of decision 4, the
app's export after every step, read as the host's own export and equal to the session state at that
step (PADR-0049 decision 6.8), the PNG and the checker's verdict on draw.io's own `.drawio` export.

| Run | Order | Sequences | Steps | Start | Peak RSS Node / Chromium tree | Refused requests |
|---|---|---|---|---|---|---|
| 1 | forward | 303 | 1,511 | 1.7 s | 414 MB / 814 MB | 0 |
| 2 | reverse | 303 | 1,511 | 1.7 s | 400 MB / 818 MB | 0 |
| 3 | shuffle, seed 977746720 | 303 | 1,511 | 1.7 s | 479 MB / 851 MB | 0 |

In every run every reference passed (63 of 63), every near miss failed (177 of 177) and every start
failed (63 of 63): for the library 48 references, 117 near misses and 48 starts, for the families 15, 60
and 15. The per-task counts are in the summary's `byTask`. The three runs agree on every recorded
value — the export after every step, the native file, the PNG and the verdict: 0 disagreements. All
three runs report Chromium 156.0.8078.4. The sandbox is observed, not assumed: after the start and
before the close each run read the command lines of its Chromium processes. Each run saw 4
processes, and none carried `--no-sandbox`. The machine was shared with other work (load average about 17 to 24
as the runs ended), so the times are upper bounds.

## The same tasks on both applications

Both libraries benched by the oracle with the real mirror (`--mirror required`) on the seeds that
select each variant case once (0, 2 and 4), one repeat: 48 runs each, every run judged on the session
and on the application's native export (read as the host's own export), all 48 passed on both. Both reports re-verify from their
folders. `compare` pairs them by task identity: 48 of 48 identities paired, equal run counts, no
different outcome (0 only on the baseline, 0 only on the candidate; exact McNemar p = 1.000).

Re-check: `npx practonaut report docs/benchmarks/drawio/drawio-oracle/report.json --verify` and
`npx practonaut compare docs/benchmarks/drawio/excalidraw-oracle/report.json docs/benchmarks/drawio/drawio-oracle/report.json --verify`
(no browser and no draw.io runtime needed: the checker reads the stored exports).

## Not yet measured

The macOS and Windows runs of the layer in CI-hosted runners (`.github/workflows/drawio-conformance.yml`,
by hand) and the Linux run in CI are not part of these files; until a platform has a recorded summary,
`doctor --adapter` says the draw.io mirror is not yet verified there.

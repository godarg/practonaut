# Challenge gate: long-horizon, round 1

**Verdict: the family does not pass this round.** ladder: Claude models only.

Preregistered in [PADR-0040](../../adr/0040-challenge-tier-generated-families-and-gate.md) (roadmap 0.2.0, item 4) and in this round's committed declaration. Every number below is computed by `node tools/challenge.ts gate` from the declaration, the development and held-out `practonaut.bench/2` reports (each validated and re-verified, resumed benches merged) and the model runs found in their bench folders, on a held-out set regenerated from the declaration.

## Round

| Fact | Value |
|---|---|
| Declaration | `long-horizon-round-1.declaration.json`, canonical SHA-256 `fd1a6720b9f9f634…`, held-out set generated from commit `3021d1988ec6` |
| Generator | `challenge-long-horizon` 1.0.0, difficulty 3 |
| Held-out instances | 26 (generator seeds 427332963–427332988, derived from the development runs; one counted run per agent per instance) |
| World | `challenge-long-horizon-r1` 1.0.0, content hash `0b5419646427cfc9…` |
| Settings | mirror required, timeout 1200 s, at most 90 act/undo/reset calls |
| Practonaut | 0.2.0-dev.0; reports dated 2026-10-16 |
| Claude Code | 2.1.301 (development claude-opus-5-5, development claude-sonnet-5-5, development claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5) |
| Gate pair | strongest `claude-opus-5-5`, weakest `claude-haiku-5-5` (fixed by the capability order before any run) |
| Development | `claude-opus-5-5` 3/3, `claude-sonnet-5-5` 3/3, `claude-haiku-5-5` 3/3: consistent with the capability order |

## Declaration history

Every version of the declaration file in git, newest first; the gated declaration is the one the held-out set was generated from.

- `3021d1988ec6` 2026-10-16T08:38:56+02:00 — the held-out set was generated from this version

## Agents

| Agent | Model (client-reported) | Passed | Rate | 95 % Wilson interval | infra_error | Missing runs | Unattested runs | Reports |
|---|---|---|---|---|---|---|---|---|
| oracle (oracle) | — | 26/26 | 1.000 | 0.871–1.000 | 0 | 0 | 0 | 1 |
| random (random) | — | 0/26 | 0.000 | 0.000–0.129 | 0 | 0 | 0 | 1 |
| ladder (claude-code) | `claude-opus-5-5` | 26/26 | 1.000 | 0.871–1.000 | 0 | 0 | 0 | 1 |
| ladder (claude-code) | `claude-sonnet-5-5` | 26/26 | 1.000 | 0.871–1.000 | 0 | 0 | 0 | 1 |
| ladder (claude-code) | `claude-haiku-5-5` | 26/26 | 1.000 | 0.871–1.000 | 0 | 0 | 0 | 1 |

## Criteria

| Criterion | Value | Rule | Met |
|---|---|---|---|
| headroom | 26/26 (100.0 %) | strongest passes 10 %–80 % of the instances | no |
| difference | 0.0 points | strongest − weakest ≥ 20 points | no |
| mcnemar | b = 0, c = 0, p = 1.0000 | exact McNemar on discordant instances, p \< 0.05 | no |
| oracle | 26/26 | oracle passes 100 % | yes |
| random | 0/26 (0.0 %) | random passes ≤ 5 % | yes |
| near-misses | 104/104 fail | every near miss fails | yes |
| infrastructure | 0.0 % of 78 ladder runs | infra\_error, missing or unattested runs ≤ 5 %, else the round is void | yes |
| budget | 87 model runs spent (78 held-out + 9 development); release 296 of 500 | ≤ 100 model runs per family and round, else the round is void; ≤ 500 in the release | yes |

Discordant instances: the strongest passed and the weakest failed on 0, the reverse on 0; two-sided exact McNemar p = 1.0000.
Model runs spent in this round: 78 on the held-out set and 9 on the development set (every run folder found, reruns after an infra_error included). Release total after this round: 296 of 500.
Power at this size: if the two agents disagreed on 20 % of the instances, all in the stronger one's favour, the exact McNemar test would reach p < 0.05 with probability 0.42; "does not pass" on discrimination is not evidence that the agents are equal.
Second round: budget exhausted — a maintainer decides on a second round. After the five first rounds of 87 model runs each the release has 30 of the 465 runs it had left at preregistration, fewer than one round.

List-price equivalent of this round's 87 model runs, as each run's client reported it (Claude Code's `total_cost_usd`; the runs went through a Claude subscription, `apiKeySource: none`): 30.03 USD (development 2.91 USD, held-out 27.12 USD). Added by hand after the gate, as PADR-0040 says until the bench records cost.

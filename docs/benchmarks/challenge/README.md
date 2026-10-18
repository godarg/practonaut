# Challenge tier: ladder round 1 (0.2.0)

Five candidate families went through the preregistered ladder gate of
[PADR-0040](../../adr/0040-challenge-tier-generated-families-and-gate.md) on 2026-10-15 and
2026-10-16: 26 held-out instances per family, one run per agent per instance, the real Excalidraw
mirror, oracle and random as baselines and Claude Opus, Sonnet and Haiku through the `claude-code`
preset as the ladder (ladder: Claude models only). **No family passes**: every round is valid (oracle
26/26, random 0/26, every near miss fails, no infrastructure error), and in each one the strongest
agent solves all 26 instances, so there is no headroom to measure and the gate pair is not
separated. Following the roadmap, the families stay unpublished and are named here; the release does
not wait for a passing family.

| Family | Difficulty | Opus | Sonnet | Haiku | Verdict | Gate report |
|---|---|---|---|---|---|---|
| repair | mixed | 26/26 | 26/26 | 26/26 | does not pass (headroom, discrimination) | [repair](repair-round1.md) |
| injection | 3 | 26/26 | 26/26 | 26/26 | does not pass (headroom, discrimination) | [injection](injection-round1.md) |
| long-horizon | 3 | 26/26 | 26/26 | 26/26 | does not pass (headroom, discrimination) | [long-horizon](long-horizon-round1.md) |
| limited-checks | 3 | 26/26 | 26/26 | 26/26 | does not pass (headroom, discrimination) | [limited-checks](limited-checks-round1.md) |
| tight-budget | 3 | 26/26 | 26/26 | 24/26 | does not pass (headroom, discrimination) | [tight-budget](tight-budget-round1.md) |

Each family's declaration (`<family>-round-1.declaration.json`) was committed and pushed before its
held-out set existed, and each round's spend is in `<family>-round1.ledger.json`. The rounds ran on
the branches `challenge/<family>-round-1`, which are kept so that the commits the held-out sets
record stay reachable.

**What follows.** The maintainer chose the zero-family branch for Practonaut's own actions
([PADR-0041](../../adr/0041-headroom-where-agents-fail-and-the-checkpoint-after-the-030-launch.md)):
these five families get no second round there, and until a family passes a gate the bundled tasks
are a **library, not a challenge tier**. 0.3.0 gates families on toolchains (the same families
through foreign MCP servers, judged in artifact mode) and new family types, each behind a pre-probe
([PADR-0042](../../adr/0042-gate-for-families-on-toolchains.md), proposed); its gate reports will go to
`0.3.0/` next to this page.

**What it means.** With these generators and difficulties, the current Claude models solve the
families completely; they do not yet give a signal between Opus, Sonnet and Haiku. "Does not pass"
on discrimination is not evidence that the models are equal: with 26 instances the exact McNemar
test has a power of about 0.42 for a 20-point difference. Harder variants (more defects, longer
horizons, fewer checks, combined families) need new development runs and a new round, which the
release budget does not cover: after these rounds 470 of the 500 model runs of 0.2.0 are spent.

**Deviations, all recorded before the affected verdict.** The gate pair was fixed as Opus vs Haiku
by capability order before any ladder run (the roadmap first said "named from the development
runs"). `repair` was declared at difficulty "mixed"; after its development runs, the four later
families were declared at difficulty 3, a choice informed by another family's development runs
only. During the injection round Claude Code was updated in the background from 2.1.300 to 2.1.301
by another process on the machine; the gate rule was amended to one release line (major.minor) with
patch versions listed (PADR-0040), and the later rounds ran on one pinned copy of 2.1.301. The
long-horizon held-out world was regenerated from its unchanged declaration in compact form after
the package reader refused its indented form (same content hash, seeds and oracle files).

**Cost.** List-price equivalent as the client reported it, through a Claude subscription: repair
5.78 USD, injection 8.76 USD, long-horizon 30.03 USD, limited-checks 13.85 USD, tight-budget
9.22 USD; 67.63 USD for the 435 model runs of round 1 (Opus 42.84, Sonnet 22.50, Haiku 2.30 USD).

# PADR-0036 — Bench report v2: any world, the world stored with the runs, isolation level, optional reference; generated instances are materialised

Status: proposed · Date: 2026-10-14 · Refines the report and verification of
[PADR-0030](0030-bench-replaces-unsealed-eval.md); records what
[PADR-0034](0034-preset-agents-get-no-provider-credentials.md) deferred to bench/2

## Context

`practonaut bench` (0.1.0) scores only the bundled task library. Its report, `practonaut.bench/1`,
names the library by id, version and content hash, and `report --verify` re-judges the runs against
the library *this* Practonaut ships: a report cannot be re-verified once the library changes, and a
task someone made with `tasks from-scenes` cannot be benched at all, although `from-scenes` already
writes a checked reference solution beside the world (`oracle.json`, `practonaut.task-oracle/1`).
bench/1 also requires a reference length for every run, says nothing about how far the agent's tools
were restricted, reads the model only for the `claude-code` preset, does not record the
`apiKeySource` Claude Code reports (PADR-0034 deferred it to bench/2), and only runs seeds 1…n.

The roadmap (0.2.0, Must 2) asks for benching any world with its oracle sidecar, the world stored in
the bench folder and re-verification against it, an isolation level per agent, an optional reference,
`--seed-list`, `--label`, models for command templates, and a decision on how generated task
instances (Must 4) are stored. Must 3 will add per-run fields (tokens, turns, cost, call logs) and
`compare`, which refuses incomparable reports and pairs runs by task, seed and instance.

## Options considered

**Report format.**
1. *Extend bench/1 with optional fields.* A bench/1 reader would accept a report whose library
   field is missing and misread it; bench/1 is strict on purpose. Rejected.
2. *A new version, `practonaut.bench/2`, written from now on; bench/1 stays readable and verifiable
   exactly as before* (chosen).

**Which world `--verify` judges against.**
1. *The bundled library, or the path the user benched.* Breaks when the library changes, when the
   world folder is edited or moved, or when the report travels without the world.
2. *A copy of the public world in the bench folder, bound by hash* (chosen): the bench folder is
   self-contained and can be moved, archived or handed over.

**References (the reference solution behind efficiency).**
1. *Record only the length.* Efficiency would rest on a number nobody can re-check.
2. *Require the oracle file again at `--verify`.* A moved folder could not be verified on its own.
3. *Store the references in the bench folder, written after the last agent has ended, bound by
   hash, and re-validated by the checker at `--verify`* (chosen).

**Generated instances (Must 4).**
1. *A variant format in bench/2:* runs name a generator, its version, a seed and parameters, and bench
   and `--verify` regenerate the task. Every reader needs the generator code of the right version;
   a generator bug fix silently changes old results; the agent's world would not exist as a file.
2. *Materialised instances* (chosen, as the roadmap recommends): a generator writes concrete worlds
   and oracle sidecars; bench/2 benches them like any world and needs no variant format.

**Where the generator metadata lives.**
1. *World package manifest.* A package-layer field: a world folder has no manifest, and the manifest
   schema is strict (a format change for archive metadata). Rejected.
2. *World provenance (one generator seed per world).* Forces one world per instance, so a held-out
   set of 24 instances would be 24 reports that `compare` must stitch together. Rejected.
3. *Per task in the world (`tasks[].generatedBy`)* (chosen): one world can hold one instance or a
   whole held-out set as tasks; one bench and one report cover the set; `compare` pairs by task and
   seed. The world's content hash covers it, so the report binds it with the world.
4. *Only in the bench report.* Lost when the world is played or served outside bench. Rejected.

## Decision

1. **Command.** `practonaut bench --agent <a> [--world <dir|.pnworld>] [--tasks all|<ids>]
   [--oracle <file,…>] [--seeds <n> | --seed-list <a,b,…>] [--label <text>] …`. Without `--world`, the
   bundled library as before. `--world` loads a world folder (packed exactly like `practonaut pack`,
   which rejects anything but the world file and allowed assets) or a `.pnworld` through the hardened
   package reader; `--tasks` then names that world's task ids. `--oracle` takes one or more
   `practonaut.task-oracle/1` files (as `tasks from-scenes` writes them beside the world), each for a
   distinct benched task of that world. `--seed-list` names distinct seeds (0…999 999 999) and
   excludes `--seeds`. `--label` is 1–128 characters, stored as given and shown escaped like every
   other text from a report. Refused by name before any run: `--oracle` without `--world`; an oracle
   for another world or a task that is not benched; two oracles for one task; the `oracle` agent on
   a task without a reference; two benched task ids that differ only in case (their run folders
   would collide on case-insensitive file systems); `--seeds` with `--seed-list`.
2. **Validated reference.** A library task's reference is its reference solution (checked when the
   library is built). An own task's reference is its oracle file *after the checker accepts it*: for
   every seed of the plan the oracle is played through the core and the resulting session is judged
   by the separate checker process; a rejected step or a failed verdict refuses the bench
   (`bench_oracle_invalid`, exit 2). Efficiency is computed and shown only for tasks with a validated
   reference; otherwise the report says "no reference". The oracle never reaches the agent: it is
   not part of the world, not given to the host, the Player or MCP (the `oracle` baseline plays it
   through MCP actions like any agent), and not written to the bench folder while an agent runs.
3. **Bench folder.** `world.pnworld` (the public world, written before the first run; the hosts load
   the world from these bytes), one folder per run with its judged artifacts as before,
   `references.json` (`practonaut.bench-references/1`: the oracles of the referenced tasks, written
   after the last agent has ended, private file mode), and `report.json`. The report records only
   these fixed names, never a path outside the folder.
4. **Report `practonaut.bench/2`** (`schemas/bench.v2.json`, generated from the zod source like v1).
   New against v1:
   - `label` (optional).
   - `environment.world`: `source` (`library` or `own`), world id, version, content hash (SHA-256 of
     the world's canonical JSON), `package` (`world.pnworld` and the SHA-256 of its bytes), and
     `generated` (the `generatedBy` metadata of benched tasks that carry it).
   - `agent.isolation`: `builtin-baseline` (oracle and random: no language model, MCP only),
     `tool-restricted-preset` (a shipped preset that limits the client to Practonaut's MCP tools), or
     `template-unrestricted` (a command template: its tools are not restricted by Practonaut). Shown as
     "built-in baseline", "tool-restricted preset" and "template: tools not restricted by
     Practonaut". It follows from the agent kind; the validator refuses any other pairing.
   - `agent.modelSource`: `client-attested` (the preset's own stream-json `system/init` event),
     `command-output` (a `system/init` line in a template's output: the template keeps its model, but
     which program printed the line is not known), or `none`. `agent.apiKeySource`: the value from the
     same line, or null; evidence, not proof (PADR-0034). `agent.keptEnv`: the names given to
     `--keep-env` (names only; never values, never the withheld names). Model and `apiKeySource` come
     from the first run whose output reports them.
   - `references`: null, or `references.json`'s SHA-256 and per referenced task its source
     (`library` or `oracle-file`) and length. A library bench references every benched task.
   - `runs[].referenceActions` is null for a task without a reference; `runs[].id` must be
     `<task>-s<seed>-r<repeat>`; a judged run must bind its artifacts and an unjudged run must not.
   - Task ids follow the world format (letters, digits, `_`, `-`, up to 64 characters).
5. **Verification of /2** (`report --verify`) never uses the bundled library. It checks, in order,
   with a named code and exit 2 on the first difference: the stored world's bytes against the bound
   hash, its package through the hardened reader, its id, version, content hash and `generated`
   metadata (`bench_world_changed`); `references.json` against its hash and every run artifact against
   its hash (`bench_artifact_changed`); every stored reference against the stored world — its task,
   its length, and the checker's verdict on it for every seed (`bench_reference_invalid`); then, as in
   v1, each judged run's session, export and checker output re-judged by the checker
   (`bench_report_invalid`). A library bench therefore stays verifiable after a library update.
6. **bench/1 stays as it was.** `report` and `report --verify` read both versions; a /1 report is
   validated by the /1 rules and re-verified against the bundled library exactly as in 0.1.0. `bench`
   writes /2 only. A real /1 report with its artifacts is kept as a test fixture.
7. **Generated instances are materialised.** A generator writes concrete world/2 tasks; each task it
   made carries `generatedBy: { id, version, seed, parameters }` (generator id, semantic version, the
   seed, and up to 16 named integer or short-string parameters such as a difficulty level), and each
   instance has an ordinary oracle sidecar. A held-out set is one world with one task per instance,
   or one world per instance; both bench as written above. The instance identity is the task id
   within the world's content hash. `generatedBy` is world content, so the host never puts it into
   the Player's or an agent's view (it is not hidden data, but an agent that can run the generator
   could regenerate the instance's oracle from the seed).
8. **Open for Must 3.** Until 0.2.0 is released, optional per-run fields (tokens, turns, cost,
   call-log artifacts) may be added to /2; consumers already re-derive every aggregate and must not
   depend on more than the schema. After the release, a change to /2 needs a new schema version.

## Consequences

- Authors can bench their own tasks and hand over a bench folder that re-verifies anywhere with the
  same or a later Practonaut; the folder is larger by one world package and one references file.
- After the runs, the bench folder holds the reference solutions it used. Same OS user: a later agent
  with file or shell tools could read finished bench folders, as it could read the library on disk or
  an author's `oracle.json`; the shipped preset has no such tools (PADR-0030, benchmarks §4).
- `--verify` costs one extra checker process per referenced task and seed.
- A /2 report says what kind of isolation its agent had; `compare` (Must 3) can refuse to compare a
  tool-restricted preset with an unrestricted template.
- World/2 gains one optional, additive task field; worlds without it are unchanged.

## Re-assessment triggers

A generator whose instances cannot be written as concrete world/2 tasks (for example, a family that
needs state the format cannot express); a second preset or a client that reports its model in
another way; a bench folder too large to keep with each report; the first change /2 needs after the
0.2.0 release.

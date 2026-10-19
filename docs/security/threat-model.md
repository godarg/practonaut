# Threat model

What Practonaut protects, against whom, how, and what it does not promise. Report vulnerabilities
as described in [SECURITY.md](../../SECURITY.md). Host protocol details:
[session host](../session-host.md).

## 1. Scope

Practonaut runs on one machine for one OS user. It loads a **world** (data only), runs a
deterministic core inside a **session host** on `127.0.0.1`, and exposes the same session to a
**browser Player** (HTTP + server-sent events) and to **agents** (MCP over stdio through a
stateless bridge). A separate **checker process** judges results. The **Excalidraw adapter** runs
a pinned engine in a host-owned headless Chromium (the mirror). The **recorder** captures author
demonstrations only after an explicit start. `practonaut bench` starts agent processes from a
user-given command template.

### Assets

| Asset | Why it matters |
|---|---|
| The user's machine (files, processes, network) | A world or an agent must not get code execution or file access through Practonaut. |
| Session integrity (state, action log, hashes) | Practice feedback and bench scores depend on it. |
| Hidden task data (reference solutions, near misses, held-out tasks and checker bundles) | If an agent can read them, its score means nothing. The goal conditions are deliberately public: Player and agent see the same condition sentences and the same formal form of each goal clause. The bundled example's demonstration plays a solution derived from each task's public third hint, never a checker fixture and never a library or bench task; the host enforces this by the world's id and version plus the CLI flag (`src/host/demonstration.ts`). |
| Session credentials (one-use link code, session token, token file) | Whoever holds them can act in the session. |
| Recordings | May contain personal or proprietary content. |
| Release artifacts (npm package, provenance) | One compromised publish reaches every user. |

### Actors

| Actor | Trust | Capability |
|---|---|---|
| Learner / author | trusted for their own session | runs the CLI, may open a world from someone else |
| Agent client and its model | semi-trusted: may act through MCP, may be prompt-injected or reward-seeking | MCP tools; often also shell and file access as the **same OS user** |
| Malicious world author | untrusted | controls every byte of a world package |
| Other web page in the same browser | untrusted | runs script in another origin, DNS rebinding, cross-origin requests |
| Other OS user | untrusted | reads world-readable files, sees process lists |
| Other process of the same user | trusted (see §3) | reads everything the user can |
| Compromised dependency | untrusted | runs code at install or run time |

## 2. Boundaries, threats and controls

| Boundary | Main threats | Controls (code) |
|---|---|---|
| **World package → validator** | path escape, links, zip bombs, parser differentials, executable content, oversized JSON | one zip reader that validates the whole central directory before inflating; size, entry, depth and ratio limits; no links or absolute paths; media allowlist without markup, scripts, SVG or binaries; manifest hashes; named rejection codes (`src/package/`, [world format](../world-format.md) §1.4). World text is rendered as text, never as markup. |
| **Browser → host** | cross-origin requests, DNS rebinding, CSRF, XSS, token theft | bind `127.0.0.1` only; one-use link code in the URL fragment (5 min); session token only in a header; exact `Host`, same or absent `Origin`; JSON-only writes; strict CSP, no CORS headers; the embedded editor in a separate sandboxed origin without API access (`src/host/server.ts`). |
| **Agent → MCP bridge → host** | stronger-than-human oracle, hidden-data leaks, action floods, stale writes | seven fixed tools with strict input schemas; output field allowlist; the same host operations and views as the Player (goal conditions included, as text and formal form, exactly as the Player shows them); no route exposes reference solutions, near misses or checker bundles; rate and size limits; revision checks (`src/mcp/`). Tool descriptions are fixed project text, never world text. |
| **Agent shell → filesystem** | reading the task library, reference solutions or the token file | not controlled by Practonaut (see §3); the `claude-code` bench preset allows only Practonaut tools. |
| **Host → checker** | crafted exports, reward hacking (writing the result file directly, editing the log, weak predicates) | separate process with deadline and heap cap; own export parsers (Excalidraw JSON and the `.drawio` reader with its own XML tokenizer, which reads only the adapter's own vocabulary and refuses everything else by name) and history interpreter, no import of core or adapter; counter-probes (empty, unchanged start, wrong artifact) before any verdict; bounded predicate language with fuel (`src/checker/`, `src/predicate/`). |
| **Adapter ↔ real app** | the app silently changes or rejects a write | official interface only; read-back and integrity check after every write; mirror deadline; engine bundled offline with no CDN URLs (`src/adapters/excalidraw/`); the shared browser shell lets the app page reach only its named local origins: HTTP routed and refused requests recorded, every WebSocket closed, a content security policy on every served response for frames and workers, no WebRTC UDP, a sink proxy on 127.0.0.1 that refuses every connection the browser opens itself (TURN over TCP, preconnects) and reads and records nothing, so another OS user connecting to it can neither reach the browser nor disable the mirror, no host resolution (`src/adapters/browser/`, PADR-0045). |
| **Adapter ↔ draw.io** ([PADR-0049](../adr/0049-drawio-adapter.md)) | downloaded third-party script rendering world text; a write the app changes, drops or keeps invalid; markup in labels | the embed JSON protocol only (`load`, `export`), no script evaluated in the app frame; the full write check (every written attribute and child element comes back, nothing else does), the declared set and integrity (`html=0` only, the adapter's own attributes, styles and colours, integer geometry, declared constraints) after every write, and integrity plus a comparison with the last confirmed write at every read; labels written as plain text; the app's own origin, served only from an allowlist of 14 files; the Chromium sandbox required on every platform, no fallback, and observed in every conformance run (no process with `--no-sandbox`) (`src/adapters/drawio/`). |
| **Download → app runtime** (`setup --app drawio`) | a substituted or damaged archive; an endless, trickling or oversized body; a partial file kept; concurrent setups; a file swapped after the check; hostile entry names; a zip bomb; serving `WEB-INF`/`META-INF` or the archive's agent-instruction files; redistribution through CI | opt-in only, the file, source, size and SHA-256 named before the download; size and SHA-256 against the pin, nothing else kept; `https:` only, at most 5 redirects, header, stall and absolute deadlines, bounded retries; a unique exclusive partial file and a lock per version, written whole by a hard link and removed only by its own setup; atomic rename and a re-hash; every start reads the file whole without following a link and serves only from that buffer; zip limits and one capped, CRC-checked inflation per served entry; an allowlist of served files; `*.war` ignored, `test:pack` refuses `.war` and zip archives, the workflow check refuses any unlisted cache or upload path (`src/adapters/drawio/`, `tools/check-workflows.ts`). |
| **Recorder → disk** | personal data at rest | explicit start; files in a private 0700 directory; review and delete before compile. |
| **Bench → agent process** | command injection through the template, runaway agents, an agent blocking its own judging | template split into words and started without a shell; per-run host and data folder, the agent's `PRACTONAUT_HOME` apart from the judged artifacts, which are written after it ends by temp file + rename (an unjudged run counts as not passed); wall-time limit stops the process group, a second Ctrl+C kills it at once; host-enforced action budget (`src/bench/`). An own task's reference solution (`--oracle`) is never given to the host or the agent's folder; the world package stays in memory during the runs, and the bench folder receives it and the references only after the last agent has ended; a bench host lists only its run's task and refuses a change to another ([PADR-0036](../adr/0036-bench-report-v2-any-world-stored-world.md)). Not prevented: an agent with file tools reading the user's own `--world` folder, or one that escapes its process group and outlives its run (a bench is not sealed). |
| **Bench folder → `report --verify`** | a changed or swapped stored world, artifact or reference behind an unchanged report; a forged reference length | the stored world is re-read through the package reader and must match the bound SHA-256, id, version and content hash, and a library bench of this Practonaut's library version must have that library's content; every artifact and `references.json` is bound by SHA-256 and read with its size limit enforced during the read; every stored reference is re-checked by the checker on the stored world; the output shows the content hash for a receiver to compare; named codes `bench_world_changed`, `bench_artifact_changed`, `bench_reference_invalid` (`src/bench/verify.ts`). Not signed: whoever can write the folder can replace report and files together. |
| **Bench folder → report page** | a call log, mutation log, trace or `board.svg` written to mislead or to inject markup; board text and action parameters from the agent | every file is used only when its SHA-256 is the one the report binds, parsed with bounded strict schemas; the call log comes from the agent's own bridge and is labelled as such; `board.svg` is read by a strict XML reader (no DOCTYPE, entities, CDATA) and re-serialised from an allowlist of geometry and paint (no script, style, link, font or foreign content; ids prefixed); all text escaped; the page has one hashed style, no script, no `data:` URI (`src/bench/details.ts`, `src/bench/svg.ts`, PADR-0039). |
| **Report → JUnit XML, result card, badge** (files shared outside: CI views, READMEs, social previews) | report text (label, agent name, model, runner notes, board text in reasons) that injects markup or breaks the XML; a card that loads something; a file that names the machine | every string escaped for XML, control, format and bidi characters and characters XML 1.0 forbids written as `\u{…}`; the SVGs hold only drawing and text elements with one style resolved from the design tokens (no script, link, image, font or URL); the card's PNG is drawn by Chromium started as for the mirror (PADR-0032) with JavaScript off and every request but the card aborted; JUnit's required host name is always `localhost` and its timestamp the report's (`src/bench/junit.ts`, `src/bench/card.ts`, `src/bench/card-png.ts`). |
| **Supply chain and release** | compromised dependency, install scripts, stolen publish token | locked `npm ci --ignore-scripts`; no Practonaut install hook; Chromium only through the explicit `setup`; Actions pinned to SHAs; npm trusted publishing (OIDC) with provenance and manual approval, no stored token ([PADR-0031](../adr/0031-public-release-and-trusted-publishing.md)). |
| **Network** | telemetry, egress during practice | no telemetry; the Player loads only local assets; `--require-offline` refuses to start if an outbound probe succeeds. |

## 3. What Practonaut does not promise

1. **Same-user processes are trusted.** The token file (0600 on POSIX) and the loopback binding
   protect against other OS users and other web origins, not against malware, browser extensions
   or any other process running as you.
2. **Hidden task data is hidden only from the MCP and HTTP surface.** An agent with shell or file
   tools as the same OS user can read the task library on disk, including reference solutions.
   A bench score of such an agent is not a sealed result.
3. **World package integrity is not authenticity.** Manifest hashes detect damage, not a
   malicious author. There are no signed worlds; open worlds from people you trust.
4. **Prompt injection is not solved.** World text reaches agents only in data fields, but an
   agent that obeys text in a task is the agent's problem to contain.
5. **Recordings may contain personal data.** There is no in-product redaction; deletion is file
   deletion, not forensic erasure.
6. **The real applications are out of scope.** Vulnerabilities in Excalidraw, draw.io, Chromium or
   agent clients belong upstream. draw.io is downloaded third-party script; Practonaut narrows what
   reaches it and requires the Chromium sandbox for it, but does not review it.
7. **Single user, loopback only.** Binding to another interface, tunnels, hosted or multi-user
   use are unsupported.
8. **Windows** has no POSIX owner/mode bits; private files rely on the user-profile location of
   `~/.practonaut`. A `PRACTONAUT_HOME` outside the profile is the user's responsibility.
9. **`--require-offline` is a startup probe, not a sandbox.**

## 4. Limits

Limits are code constants with named errors. A caller may lower them; raising one is a code
change with a test and an update of this table. No environment variable disables a protection.

| Limit | Value | Error | Constant |
|---|---|---|---|
| Archive size / total uncompressed | 16 MiB / 16 MiB | `E_ARCHIVE_TOO_LARGE` / `E_TOTAL_TOO_LARGE` | `src/package/limits.ts` |
| Entries; single entry | 256; 4 MiB | `E_TOO_MANY_ENTRIES`; `E_ENTRY_TOO_LARGE` | same |
| Path length / depth | 200 characters / 8 segments | `E_INVALID_PATH` | same |
| Compression ratio | ≤ 100 for entries ≥ 64 KiB | `E_COMPRESSION_RATIO` | same |
| JSON nesting | 64 levels; 250,000 nodes | `E_JSON_TOO_DEEP` | `src/package/limits.ts`, `src/world/limits.ts` |
| Ids / names / text | 64 / 256 / 4,096 characters | `invalid_argument` | `src/world/limits.ts` |
| Objects in state; actions per session | 10,000; 10,000 | `limit_exceeded` | same |
| Undo snapshots | 1,000 or 64 MiB, then replay | — | same |
| Predicates | depth 32, 4,096 nodes, 10⁶ evaluation steps | `checker_fuel_exhausted` | same |
| Checker process | 10 s wall, 256 MiB V8 heap | `checker_timeout` | same |
| HTTP request body / headers | 64 KiB / 16 KiB; header deadline 10 s, request 30 s | `body_too_large` / 431 | `src/host/limits.ts` |
| Request rate | burst 200, refill 50/s per host | `rate_limited` | same |
| Reply size | 4 MiB | `result_too_large` | same |
| Event streams | 8 clients, 4 MiB queued each, heartbeat 15 s | stream closed | same |
| Link code | one use, 5 min, one outstanding, 1,000 per session | `bootstrap_used` / `bootstrap_expired` | same |
| Mirror operation | 5 s | `mirror_timeout` | `src/host/mirror.ts` |
| MCP inbound message | 1 MiB | `invalid_request` | `src/mcp/server.ts` |
| Recordings | 30 min, 1,000 gestures, 3 MiB each; 100 recordings / 64 MiB in total | `recording_limit` | `src/host/author-controller.ts` |
| Bench run | `--timeout` (default 300 s), `--max-actions` (default 50) | `action_budget_exhausted` | `src/bench/` |
| Bench oracle file / stored references | 4 MiB / 64 MiB, JSON depth 64, 1,000 actions per sequence | `bench_oracle_invalid`; `bench_references_too_large` before the first run; at `--verify` `bench_artifact_changed` or `bench_reference_invalid` | `src/bench/world.ts`, `src/bench/verify.ts` |
| Run evidence read back | call and mutation logs 16 MiB and 100,000 lines each (budget refusals recorded up to 100, rejected strings cut at 256 characters); condition trace 20,000 timeline entries; `board.svg` 4 MiB, 50,000 nodes, depth 64 | a line that does not fit is dropped (call log) or refuses the file; `board.svg` refused → schematic instead; at `--verify` `bench_artifact_changed` / `bench_report_invalid` | `src/bench/evidence.ts`, `src/checker/trace.ts`, `src/bench/svg.ts` |
| Task limits (a task's `limits`, `--checks`; PADR-0040) | at most 1,000 accepted changes and 1,000 checks per attempt; `--checks` 0–1,000 lowers a task's check limit, never raises it | `action_budget_exhausted` / `check_budget_exhausted`; a world with other values is refused when loaded, `--checks` outside 0–1,000 is `usage` | `src/world/schema.ts` (`TASK_LIMITS`), `src/host/session.ts` |
| draw.io runtime download (PADR-0049) | exactly 48,442,174 bytes and the pinned SHA-256; 5 redirects, `https:` only; headers 30 s, stall 30 s, 10 min in total; 2 retries | `app_download_failed` / `app_download_mismatch` / `app_install_busy` | `src/adapters/drawio/download.ts` |
| draw.io archive in memory | 4,096 entries; 32 MiB per inflated entry and for all served entries together; 256 MiB inflated in total; compression ratio 100 | `app_runtime_unverified` | `src/adapters/drawio/archive.ts` |
| `.drawio` reader | file 10 MiB; inflated page 10 MiB; 50,000 elements, depth 64, 128 attributes, 65,536 characters per value; styles 4,096 characters and 128 keys; 5,000 cells; parent chains 64; coordinates ±1,000,000; labels 4,096 code points | `artifact_invalid` (`reason` `too_large`, …) | `src/checker/drawio.ts` |
| Minimal-length search | 250,000 search nodes, then "reference length" (no claim) | — | `src/authoring/minimal-length.ts` |
| Challenge instances (generator, PADR-0040) | at most 56 live objects per board; a verdict on a stress board within half the 10⁶-step predicate budget; no limit is raised | instance redrawn, else `generation_failed` | `src/challenge/build.ts` |

## 5. Where the controls are tested

- Hostile packages: `tests/unit/` with fixtures from the independent writer in
  `tests/support/zipwriter.ts` (the reader never produces its own attack input); `npm run demo`
  shows every rejection.
- HTTP guard, limits, CSRF and foreign-page probes: `tests/integration/host-*.test.ts`,
  `tests/integration/security-*.test.ts`, `tests/e2e/`.
- MCP surface (allowlist, limits, hidden-data canaries, errors): `tests/mcp/`.
- Checker counter-probes and forged bench reports: `tests/unit/`, `tests/integration/`.
- Engine bundle without CDN URLs: `tests/unit/engine-build.test.ts`.
- draw.io: setup and archive limits `tests/unit/drawio-setup.test.ts`, `tests/unit/drawio-archive.test.ts`;
  the reader `tests/unit/drawio-reader.test.ts`; the workflow check `tests/unit/workflow-check.test.ts`;
  against the real app (silent changes, differential fixtures, three runs) `tests/adapter/drawio/`.

# PADR-0010 — What the project claims about isolation

Status: accepted · Date: 2026-10-03

## Context
Measured on 2026-10-03 (`spikes/runtime-parity/REPORT.md`): Node 22 `--permission` blocks file
writes and child processes but not network; macOS `sandbox-exec` with `deny network*` also
blocks loopback; a plausible "loopback only" seatbelt profile leaked external TCP and only the
start-up probe caught it; `docker run --network none` blocked network. `sandbox-exec` is
deprecated by Apple (`documented`).

## Decision
- The project makes **no general sandboxing claim** for the browser, the host or the CLI.
  Safety of world packages rests on PADR-0003 (data only, validated before use) and on the
  runtime never executing package content.
- "Offline" is a measured property of a run: the offline runner probes network access at start
  and fails closed (`E_NETWORK_AVAILABLE`) if any probe succeeds. Supported isolation: a Linux
  container with `--network none`; on macOS a seatbelt profile shipped with the project and
  always checked by the probe. The probe is a sample (TCP, DNS, HTTPS, loopback port), not a
  proof; its coverage is stated wherever offline results are reported.
- Processes of the same OS user are trusted. Agent runs that need sealed hidden data run the
  agent as a different OS user or in a container without access to the checker bundle.
- Adapters that start application containers bind them to loopback, disable debug or REPL
  services (for example Penpot's `prepl` server, enabled in the spike only), and never publish
  ports beyond the frontend.

## Re-assessment triggers
Node gains a network permission on the supported LTS; Apple removes `sandbox-exec`; a request
for multi-user or hosted operation.

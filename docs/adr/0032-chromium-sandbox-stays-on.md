# PADR-0032 — The Chromium sandbox stays on; a browser that does not start falls back or fails by name

Status: accepted · Date: 2026-10-13

## Context

The real Excalidraw mirror launches Playwright's Chromium headless with its sandbox on
(`chromiumSandbox: true`). On Linux the sandbox needs unprivileged user namespaces; Ubuntu 23.10
and later restrict them with AppArmor, and minimal systems may lack the libraries Chromium needs.
There Chromium is installed but does not start. Until 0.1.0 that ended `npx practonaut` with a
Playwright stack trace, because only the presence of the files was checked.

## Decision

1. **The sandbox stays on, on every platform.** The mirror renders world data from packages that
   are untrusted input. Turning the sandbox off by default would remove a process boundary for
   every user to spare a subset of Linux users a one-time system setting. There is no environment
   variable or flag that turns it off.
2. **Start, not presence, decides.** Before choosing the mirror, `play`, `mcp --task`, `bench` and
   `run` launch Chromium once exactly as the mirror does and close it. `doctor` shows the result as
   the check *chromium start* (required with `--adapter`).
3. **`--mirror auto`** (the default) runs model-only when Chromium is missing or does not start,
   and says why in one line, with advice for the platform; it also falls back if the mirror's own
   start fails after the check. **`--mirror required`** stops with `browser_start_failed` (exit 3)
   and the same advice. No stack trace reaches the user.
4. **Advice on Linux** names both causes: missing system libraries
   (`npx playwright install --with-deps chromium`) and the AppArmor restriction
   ([getting started](../getting-started.md), section *Chromium does not start*).

## Consequences

- On an affected Linux system practice still works, model-only and labelled as such, until the
  user changes the system setting or installs the libraries.
- The start check adds about half a second to `play`, `mcp --task`, `bench`, `run` and `doctor`
  when Chromium is installed.
- Users who decide to lift the AppArmor restriction do so in their system, with its documentation,
  not through a Practonaut switch.

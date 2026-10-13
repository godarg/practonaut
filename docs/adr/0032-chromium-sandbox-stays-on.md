# PADR-0032 — The Chromium sandbox stays on where the system allows it; a browser that does not start falls back or fails by name

Status: accepted, amended (see *Amendment*) · Date: 2026-10-13

## Context

The real Excalidraw mirror launches Playwright's Chromium headless with its sandbox on
(`chromiumSandbox: true`). On Linux the sandbox needs unprivileged user namespaces; Ubuntu 23.10
and later restrict them with AppArmor, and minimal systems may lack the libraries Chromium needs.
There Chromium is installed but does not start. Until 0.1.0 that ended `npx practonaut` with a
Playwright stack trace, because only the presence of the files was checked.

## Decision

1. ⛔ amended below for Linux. **The sandbox stays on, on every platform.** The mirror renders
   world data from packages that are untrusted input. Turning the sandbox off by default would
   remove a process boundary for every user to spare a subset of Linux users a one-time system
   setting. There is no environment variable or flag that turns it off.
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

## Amendment (2026-10-13): Linux starts once without the sandbox when the system refuses it

The first public CI run on `ubuntu-latest` showed what decision 1 meant in practice: on every
Ubuntu 24.04 system with the default AppArmor setting the real mirror never ran, for CI and for
users alike. Decision 1 is replaced by:

1. **Sandbox first, everywhere.** Every Chromium start (start check, mirror, independent render
   check) asks for the sandbox. One module does this for all of them
   (`src/adapters/excalidraw/chromium.ts`).
2. **On Linux only, and only when the sandbox is the reason**, Chromium starts once more without
   it ("No usable sandbox", "Chromium sandboxing failed", the AppArmor / user-namespace
   explanation). The process remembers this and does not repeat the failing attempt. Missing
   libraries, a damaged download and every other failure stay failures; macOS and Windows never
   fall back.
3. **It is said, not hidden.** The session prints one line on stderr when its mirror runs without
   the sandbox (`play`, `mcp --task`, `bench`, `run`), and `doctor` shows *chromium start* as
   "starts (headless, sandbox off: …)".
4. **`PRACTONAUT_CHROMIUM_SANDBOX=require` forbids the fallback**: a sandbox refusal is then the
   start failure of decision 3 (`auto` runs model-only, `required` fails as
   `browser_start_failed`). Any other non-empty value is refused as a start failure, so a typo can
   never mean less isolation. There is still no switch that turns the sandbox off where it works.

Why this is acceptable: the mirror's browser loads only the bundled, offline-pinned Excalidraw
engine from a local origin, every other request is aborted, and world packages reach it as data
(JSON scenes), not as pages or scripts. Without the sandbox a renderer exploit would reach the
user's account instead of a sandboxed process; that needs a Chromium vulnerability triggered by
scene data inside the pinned engine. Playwright itself launches without the sandbox by default.
The alternative, practice without the real application on the most common Linux desktop, was the
worse outcome for users who never chose it.

Consequences: on an affected Linux system a session mirrors into the real Excalidraw and says that
its browser runs without the sandbox. CI runs this fallback on `ubuntu-latest` and, in a separate
step with the AppArmor restriction lifted, the sandboxed start with `require`.

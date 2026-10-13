# PADR-0029 — Normal browser, cross-platform data directory, optional mirror

Status: accepted · Date: 2026-10-11
Supersedes: PADR-0027 (owned, process-bound Player window). Amends: PADR-0011 (mirror default).

## Context

The relaunch positions Practonaut as a local practice gym that a stranger starts with one `npx`
command in under ten minutes. PADR-0027 opened an owned Chromium window, bound its process
identity with `/bin/ps` and refused every platform except macOS. It kept the bootstrap code out of
stdout, but it made Linux and Windows impossible, required a Chromium download before the first
session and was the largest source of lifecycle failures in the test layers.

## Decision

1. `serve`/`play` prints `http://127.0.0.1:<port>/#code=…` and opens it in the user's default
   browser (`--no-open` to skip). The code stays one-use, fragment-only and is removed from the
   address bar; its lifetime is 5 minutes; `o` + Enter issues a new link and revokes the unused
   previous one; a reused code is refused with 401. Host, Origin, CSP, loopback-only listening and
   header-only tokens are unchanged.
2. Exports are ordinary browser downloads.
3. Private files go through `src/platform/private-fs.ts`: POSIX keeps owner, 0700/0600,
   single-link and no symlink ancestors; Windows keeps type/link/symlink checks and relies on the
   user-profile location. All data lives under `~/.practonaut` or `PRACTONAUT_HOME`
   (`src/platform/paths.ts`), never under the current directory.
4. `--mirror auto|required|off`, default `auto`: the real mirror runs when Playwright Chromium is
   installed (plain `chromium.launch`, no process monitoring), otherwise model-only with a visible
   warning. `required` remains for CI and verified benchmarks.

## Consequences

- The printed link is visible to whoever reads the terminal, and the browser history may keep a
  consumed or expired code. Both are the same local user; agents still attach with the token file.
- The user's browser is not ours: extensions and same-user instrumentation can read the page.
  This is no stronger or weaker than the same-user claim of the session host before.
- Windows privacy depends on the profile ACL, not on checks the software can perform. Windows and
  Linux are covered by CI and by unit tests with simulated platforms; manual use is measured on
  macOS only.
- Chromium lifecycle is Playwright's; residual-process accounting (PADR-0027 R11) is withdrawn.

#!/usr/bin/env bash
# Called by the post-merge and post-checkout hooks. When node_modules no longer matches
# package-lock.json (a pull, merge or branch switch changed the lockfile), install the locked
# dependencies again with the same `npm ci` as `npm run bootstrap`; otherwise the tests run against
# other dependencies than CI. Always exits 0: the merge or checkout has already happened, so the hook
# can only finish the job or say what is left to do.
set -uo pipefail
hook="${1:-hook}"
cd "$(git rev-parse --show-toplevel)" || exit 0
# A checkout that was never bootstrapped (a new worktree) has nothing installed that could be stale.
if [ ! -d node_modules ]; then
  echo "$hook: no node_modules in this checkout: run npm run bootstrap" >&2
  exit 0
fi
report="$(node tools/lockfile-drift.ts 2>&1)"
status=$?
# A match needs both the exit code and the tool's own words.
if [ "$status" -eq 0 ] && [ "$report" = "node_modules matches package-lock.json" ]; then exit 0; fi
if [ "$status" -ne 1 ]; then
  echo "$hook: could not compare node_modules with package-lock.json (exit $status): $report" >&2
  echo "$hook: if package-lock.json changed, run npm ci" >&2
  exit 0
fi
echo "$hook: $report" >&2
echo "$hook: npm ci --ignore-scripts --no-audit --no-fund" >&2
if npm ci --ignore-scripts --no-audit --no-fund; then
  echo "$hook: node_modules installed from package-lock.json" >&2
else
  echo "$hook: WARNING: npm ci failed; run npm run bootstrap" >&2
fi
exit 0

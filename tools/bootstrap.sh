#!/usr/bin/env bash
# Repeatable local setup: install locked dependencies, enable the git hook, check the environment.
# No global installs, no sudo. Safe to run again at any time.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "bootstrap: npm ci (from package-lock.json)"
npm ci --ignore-scripts --no-audit --no-fund

echo "bootstrap: git config core.hooksPath tools/githooks"
git config core.hooksPath tools/githooks

echo "bootstrap: explicit Chromium download from Playwright CDN (cached binaries reused; size reported by downloader)"
node node_modules/playwright-core/cli.js install chromium

echo "bootstrap: build offline engine"
node tools/build-engine.ts

echo "bootstrap: doctor"
node tools/doctor.ts

echo "bootstrap: build the offline player"
npm run player:build

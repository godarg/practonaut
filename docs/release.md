# Releasing Practonaut

For maintainers. Decision record: [PADR-0031](adr/0031-public-release-and-trusted-publishing.md).
A release publishes the npm package `practonaut` and a GitHub release. Only a person with
maintainer rights can start it; the publish step waits for a manual approval.

## 1. What is published

- The npm package: CLI, library entry, JSON schemas, built offline engine and Player, the bundled
  example world and the Excalidraw task library. `package.json` `files` is the allowlist;
  `npm run test:pack` fails when the tarball contains anything else or misses a required file.
  No install hook; Chromium is only downloaded by `practonaut setup`.
- npm provenance, created by GitHub Actions through trusted publishing (OIDC). No npm token is
  stored anywhere.
- A GitHub release for the tag, with the matching `CHANGELOG.md` section as its notes.
- The entry in the official [MCP Registry](https://registry.modelcontextprotocol.io): `server.json`
  in the repository root (name `io.github.godarg/practonaut`, npm package, stdio,
  `mcp --task excalidraw/connect`). It is not part of the npm package; the package carries the
  matching `mcpName`, which the registry checks against npm. `npm run check` validates
  `server.json` offline against the pinned schema (`tools/vendor/mcp-registry/`) and requires its
  versions to equal `package.json`.

## 2. One-time setup

Replace `OWNER` with the GitHub account or organisation that hosts the repository. The release
workflow checks this first: its prepare job fails while `package.json`, an issue template or a root
document still contains `OWNER` (`node tools/check-release-placeholders.ts` shows every line).

| Where | What |
|---|---|
| `package.json` | `repository.url`, `homepage`, `bugs.url` point to `https://github.com/OWNER/practonaut` |
| `.github/ISSUE_TEMPLATE/config.yml` | the security-advisory and discussion links use `OWNER` |
| `CONTRIBUTING.md` | the clone URL uses `OWNER` |
| GitHub repository | protect `main` (pull requests, required checks from `ci.yml`, no force pushes); enable private vulnerability reporting, secret scanning, Discussions (linked from the issue chooser) and content reports to maintainers (referenced by `CODE_OF_CONDUCT.md`) |
| Actions secrets | none needed. Only if the repository belongs to an organisation: `GITLEAKS_LICENSE` for the secret-scan job |
| GitHub environment `release` | required reviewer: a maintainer; deployment branches and tags: `v*` tags only |
| GitHub tag ruleset | only maintainers may create, update or delete `v*` tags |
| npm | create or claim the package `practonaut`, account with 2FA; add a **trusted publisher**: GitHub Actions, owner `OWNER`, repository `practonaut`, workflow `release.yml`, environment `release` |

Trusted publishing needs npm CLI 11.5.1 or newer and a GitHub-hosted runner; `release.yml` pins a
Node version that ships a recent npm. See npm's
[trusted publishing](https://docs.npmjs.com/trusted-publishers) and
[provenance](https://docs.npmjs.com/generating-provenance-statements) documentation.

## 3. Cutting a release

1. On a branch, set the version in every place that carries it:

   | Place | What |
   |---|---|
   | `package.json` | `version`; then `npm install --package-lock-only` updates `package-lock.json` |
   | `server.json` | `version` and `packages[0].version` |
   | `src/version.ts` | `PACKAGE_VERSION` (what `--version`, MCP `serverInfo`, sessions and bench reports name) |
   | `src/checker/state.ts` | add the version to the known session writers (`toolVersion`); keep the earlier ones, so their sessions stay readable |
   | `examples/ci/practonaut-bench.yml` | `PRACTONAUT: practonaut@X.Y.Z`, the exact version the CI recipe installs: it names the first version that has the recipe's commands (0.2.0) and is set to the release being cut at each release, never to a `-dev` version (`tests/unit/ci-workflows.test.ts` requires an exact `X.Y.Z`) |

   After a Playwright update since the last release, the headless-shell download size that `setup`
   names must belong to the pinned Playwright: `node tools/measure-headless-shell.ts --write`
   (`tests/unit/setup.test.ts` fails until it has run).

   Tests guard the coupling: `--version` must equal `package.json` (`tests/unit/cli.test.ts`),
   `npm run check` compares `server.json` with `package.json`, and the checker must accept a session
   written by the current version (`tests/unit/checker.test.ts`). Then move the `Unreleased`
   entries in `CHANGELOG.md` into a `## [X.Y.Z] - YYYY-MM-DD` section, open a pull request and merge
   it when CI is green. `release.yml` finds the section by its version alone (`## [X.Y.Z]`),
   whatever follows it.

   Between releases `main` carries the next development version, `X.Y.Z-dev.0`, in the same four
   places, so sessions and reports written from `main` are not mistaken for the release.

2. Run the full local chain on the merged commit (it needs Chromium):

   ```bash
   npm run check && npm test && npm run build && npm run demo && npm run test:adapter \
     && npm run test:integration && npm run test:e2e && npm run test:mcp && npm run test:a11y \
     && npm run test:pack
   ```

   Then the draw.io layer on the same commit, required ([PADR-0049](adr/0049-drawio-adapter.md)
   decision 8.8), with a home in which `setup --app drawio` ran:

   ```bash
   PN_DRAWIO_HOME="$PWD/.local/drawio-home" PN_DRAWIO_REQUIRED=1 npm run test:drawio \
     && node tools/require-drawio-summary.ts .local/drawio-conformance/summary.json
   ```

   Its summary replaces the committed draw.io evidence (`PRACTONAUT_HOME=<that home> node
   tools/drawio-evidence.ts --summary .local/drawio-conformance/summary.json` benches the oracle on both
   libraries with the real mirrors, compares them and writes `docs/benchmarks/drawio/`; update the
   numbers and the commit in its README), and the release notes state its counts. The tool refuses a
   checkout with uncommitted changes and a summary made on another commit, from a dirty checkout, over
   fewer sequences than planned, or without Chromium observed under its sandbox. So run the layer on
   the clean release commit, then the tool, then commit what it wrote. Until
   the maintainer has decided the naming question (PADR-0049 decision 9.3), no release names draw.io.

3. Tag and push: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
4. `release.yml` checks that the tag equals `v` + the package version, runs the checks, packs the
   tarball once and smoke-tests that exact file. Approve the `release` environment when asked; the
   publish job then publishes that tarball with `--provenance` and creates the GitHub release.
5. Check the result: `npm view practonaut version`, the provenance badge on npmjs.com, and
   `npx -y practonaut@X.Y.Z --help` in an empty directory.
6. Publish the registry entry (after the npm version exists): `mcp-publisher login github`, then
   `mcp-publisher publish` in the repository root, and check
   `https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.godarg/practonaut`.

If a step fails before the publish job, fix it on `main`, delete the tag and tag again. A published
version cannot be replaced; publish a new patch version instead.

## 4. Versioning

Semantic versioning. Before 1.0, a minor version may change APIs and the world format; a new world
schema major comes with a migration note. The changelog follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

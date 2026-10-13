# PADR-0031 — Public 0.1.0 release: fresh snapshot, npm trusted publishing, manual approval

Status: accepted · Date: 2026-10-12 · Supersedes the publication path of PADR-0009 (archived);
the license decision of PADR-0009 stands.

## Context

The project was developed in a private repository whose history contains local review records.
For the first public version it needs a public repository, an npm package that `npx practonaut`
can run, and a release path that does not depend on a long-lived registry token.

## Decision

1. **License.** Apache-2.0, copyright line as in `NOTICE`. Example worlds and the task library
   declare their own content licenses (CC0-1.0).
2. **Public repository.** It starts from a fresh snapshot of the reviewed tree (`git archive`),
   not from the private history. The snapshot contains no `.local/`, dependencies, credentials,
   recordings or machine paths.
3. **CI.** `ci.yml` runs on every pull request and on `main`: check, unit tests, build,
   integration, MCP and pack tests on Ubuntu, macOS and Windows (Node 22); end-to-end and
   accessibility layers on Ubuntu; gitleaks on the full history. Actions are pinned to commit SHAs.
4. **Release.** Pushing a tag `vX.Y.Z` that equals `package.json`'s version runs `release.yml`:
   a preparation job (read-only) builds, tests and packs the tarball once; a publish job in the
   GitHub environment `release` (manual approval) publishes exactly that tarball with
   `npm publish --provenance --access public` through npm trusted publishing (OIDC). No npm token
   is stored. A GitHub release is created from the tag with the matching `CHANGELOG.md` section.
5. **Dependencies.** Dependabot proposes npm and GitHub Actions updates weekly, grouped.
6. **Who publishes.** Creating the repository, the npm package, the trusted-publisher entry, the
   environment and the tag are maintainer steps ([release.md](../release.md)). No automation
   publishes without that approval.

## Consequences

- A release can only publish a tarball that passed the same checks in the same workflow run.
- The previous signed-tag and publisher-fingerprint guards are dropped: trusted publishing binds
  the package to this repository and workflow, and the `release` environment requires a person.
- The private history is not public; references to it were removed from the documentation.

## Re-assessment triggers

A second maintainer, a hosted service, a change of registry, or npm changing its trusted
publishing requirements.

# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through **GitHub Private Vulnerability Reporting**: open
the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue,
discussion or pull request for a suspected vulnerability.

Include the affected version, your platform, a minimal reproduction (for package issues, the world
package or a script that builds it) and the impact you observed.

We aim to acknowledge reports within 7 days and to agree on a disclosure date with you. Practonaut
is maintained by a very small team; these are goals, not guarantees.

## Supported versions

Practonaut is pre-1.0. Security fixes go into the latest published minor version.

| Version | Supported |
|---|---|
| latest 0.x minor | yes |
| older 0.x | no — please upgrade |

## Scope

In scope:

- the world-package validator and loader (path escape, links, size and decompression limits, zip
  parser differentials, executable content);
- the local session host (token handling, Host/Origin checks, CSRF, DNS rebinding, XSS in the
  Player);
- the MCP agent surface (leaks of reference solutions, near misses, checker bundles or held-out
  tasks; a stronger success signal than the Player's; limit bypasses). The goal conditions are
  public by design (text and formal form, the same as in the Player);
- the checker and `practonaut bench` (reward hacking, parser attacks through exported files,
  command-template injection; a report that `report --verify` accepts although its verdicts do not
  follow from the run artifacts whose hashes it records). `report` without `--verify` is a
  consistency check only and says so: a consistently edited report passes it, which is not a
  vulnerability. Reports are not signed;
- the recorder's storage and deletion;
- the published npm package (install behaviour, provenance).

Out of scope:

- vulnerabilities in Excalidraw, Chromium, Playwright, browsers or agent clients — please report
  those upstream;
- attacks that need code already running as the same OS user (see the threat model, §3);
- an agent with its own shell or file tools reading task data on disk;
- prompt injection that only works because an agent was given shell or network tools on an
  untrusted world, unless Practonaut placed world text outside a data field;
- denial of service by the local user against their own session;
- exposing Practonaut on a non-loopback interface or through a tunnel (unsupported).

The full threat model is in [docs/security/threat-model.md](docs/security/threat-model.md).

---
paths:
  - "src/host/**"
  - "src/mcp/**"
---

# Local services

- Bind 127.0.0.1 only. Every request: session token in a header, allowed `Host`, allowed or
  absent same-origin `Origin`, JSON content type for writes; strict CSP; no CORS headers
  (PADR-0005). Test each rejection.
- The MCP bridge opens no listening socket and forwards to the host API; tool descriptions are
  fixed project text, never world-authored.
- Practice sessions never load a checker bundle. `check_result` returns exactly what the player
  shows. Goal predicates, reference solutions and near misses are never reachable through MCP or
  HTTP; bench agents start from a template without a shell.
- Enforce limits from `docs/security/threat-model.md` §4 as constants with named errors.

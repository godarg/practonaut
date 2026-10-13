# PADR-0002 — TypeScript on Node.js, npm, built-in test runner

Status: accepted · Date: 2026-10-03

## Context
The product needs: a pure deterministic core, a browser player, a local session host, an agent
protocol server, adapters to browser-based applications, and a CLI distributed as a package.

Evidence:
- Node 22.22.3 runs TypeScript by type stripping without a flag, but does not type-check; a real
  type error ran unnoticed until `tsc` (`measured`, `spikes/runtime-parity/REPORT.md`).
- The official MCP server SDK is TypeScript (`@modelcontextprotocol/server` 2.3.0, Apache-2.0,
  Node ≥ 20; dependencies `zod` and `@modelcontextprotocol/core` only — `measured` via
  `npm view` on 2026-10-03).
- Both candidate pilot applications expose JavaScript APIs (Penpot plugin API, Excalidraw
  package) (`documented`, `spikes/alternatives/REPORT.md`).
- Core, package validation and host ran with 2 runtime dependencies besides the protocol SDK
  (`measured`, spike).

## Options
1. TypeScript everywhere (Node for CLI/host/adapters, same code in the browser).
2. Python core and CLI with a TypeScript player.
3. Rust core compiled to WebAssembly with a TypeScript shell.

## Decision
Option 1. Node.js ≥ 22.18 (current LTS line on the reference machine), ESM only, TypeScript with
`erasableSyntaxOnly`. `tsc --noEmit` is a mandatory gate; the npm package ships compiled
JavaScript in `dist/`. npm with a committed lockfile. Tests use the built-in `node --test`.
No Python in the product. Python (standard library only) is allowed in tests as an independent
oracle — a second implementation that derives expected values — never as a runtime dependency. Runtime dependencies are pinned exactly and each needs a stated
reason.

## Consequences
One language across core, player, host and adapters keeps parity structural (the same core
module runs in host and browser). Determinism must be enforced by rules (no floats in state, no
clock, no ambient randomness), not by the language. Two languages (option 2) would duplicate the
core or move it out of the browser; option 3 adds a toolchain without a measured need.

## Re-assessment triggers
Measured core performance insufficient for a supported world; Node LTS end of life
(Node 22: April 2027) — move the engine floor to the next LTS; a required app adapter that only
offers non-JavaScript interfaces.

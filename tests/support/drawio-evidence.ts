// PADR-0049 decision 8.9: the committed oracle benches of both libraries in docs/benchmarks/drawio/.
// Shared by the integration tests that re-verify them. Each re-verification re-judges every stored run
// in the checker's own process, so they are split over three files (the compare, and each report's
// library anchor), each well under test:integration's per-file limit on the slowest CI runner.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const EVIDENCE = fileURLToPath(new URL('../../docs/benchmarks/drawio/', import.meta.url));

/** The two committed oracle benches: the same 48 task identities on Excalidraw and on draw.io. */
export type EvidenceBench = 'excalidraw-oracle' | 'drawio-oracle';
export const evidenceFolder = (bench: EvidenceBench): string => join(EVIDENCE, bench);
export const evidenceReport = (bench: EvidenceBench): string => join(evidenceFolder(bench), 'report.json');
/** How long one file's CLI call may take: below the file's own limit, so a slow runner fails with the
 * CLI's output rather than with the runner's cancellation. */
export const EVIDENCE_CALL_MS = 450_000;

/** Runs the CLI on the committed evidence; it must succeed, and its JSON output is returned. */
export function evidenceCli(args: readonly string[]): unknown {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: EVIDENCE_CALL_MS });
  assert.equal(result.status, 0, result.error ? String(result.error) : result.stderr);
  return JSON.parse(result.stdout) as unknown;
}

// PADR-0049 decision 8.9: the committed oracle benches of both libraries re-verify from their folders
// (every run re-judged by the checker from its stored session and native export), and their comparison
// pairs 48 of 48 identities. Each report's library anchor is in drawio-evidence-excalidraw.test.ts and
// drawio-evidence-drawio.test.ts (tests/support/drawio-evidence.ts says why the files are split).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_CALL_MS, evidenceCli, evidenceReport } from '../support/drawio-evidence.ts';

test('the committed draw.io evidence re-verifies and its comparison pairs 48 identities', { timeout: EVIDENCE_CALL_MS + 10_000 }, () => {
  // compare --verify re-verifies both reports from their folders before it pairs them.
  const result = evidenceCli(['compare', evidenceReport('excalidraw-oracle'), evidenceReport('drawio-oracle'), '--verify', '--json']) as { baseline: { verification: string }; candidate: { verification: string }; comparison: { pairing: string; paired: number; discordant: { baselineOnly: number; candidateOnly: number } } };
  assert.deepEqual([result.baseline.verification, result.candidate.verification], ['re-verified', 're-verified']);
  assert.deepEqual([result.comparison.pairing, result.comparison.paired, result.comparison.discordant.baselineOnly, result.comparison.discordant.candidateOnly], ['identity', 48, 0, 0]);
});

// PADR-0049 decision 8.9 (review m2c): the committed Excalidraw oracle bench re-verifies from its folder
// anchored to the library this Practonaut ships for Excalidraw. The draw.io report is in
// drawio-evidence-drawio.test.ts, the comparison in drawio-evidence-compare.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_CALL_MS, evidenceCli, evidenceFolder, evidenceReport } from '../support/drawio-evidence.ts';

test('the committed Excalidraw oracle report re-verifies against the library this Practonaut ships for Excalidraw', { timeout: EVIDENCE_CALL_MS + 10_000 }, () => {
  const verified = evidenceCli(['report', evidenceReport('excalidraw-oracle'), '--verify', '--runs', evidenceFolder('excalidraw-oracle'), '--json']) as { verification: { level: string; reverified: number; library?: unknown } };
  assert.deepEqual([verified.verification.level, verified.verification.reverified, verified.verification.library], ['re-verified', 48, { status: 'same' }]);
});

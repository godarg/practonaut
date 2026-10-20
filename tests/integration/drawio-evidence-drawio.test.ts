// PADR-0049 decision 8.9 (review m2c): the committed draw.io oracle bench re-verifies from its folder
// anchored to the library this Practonaut ships for draw.io, not Excalidraw's. The Excalidraw report is
// in drawio-evidence-excalidraw.test.ts, the comparison in drawio-evidence-compare.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVIDENCE_CALL_MS, evidenceCli, evidenceFolder, evidenceReport } from '../support/drawio-evidence.ts';

test('the committed draw.io oracle report re-verifies against the library this Practonaut ships for draw.io', { timeout: EVIDENCE_CALL_MS + 10_000 }, () => {
  const verified = evidenceCli(['report', evidenceReport('drawio-oracle'), '--verify', '--runs', evidenceFolder('drawio-oracle'), '--json']) as { verification: { level: string; reverified: number; library?: unknown } };
  assert.deepEqual([verified.verification.level, verified.verification.reverified, verified.verification.library], ['re-verified', 48, { status: 'same' }]);
});

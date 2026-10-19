// PADR-0049 decision 8.9: the committed oracle benches of both libraries re-verify from their folders
// (every run re-judged by the checker from its stored session and native export, against the library
// this Practonaut ships for each application), and their comparison pairs 48 of 48 identities.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url)), CLI = join(root, 'src/cli/main.ts'), dir = join(root, 'docs/benchmarks/drawio');

test('the committed draw.io evidence re-verifies and its comparison pairs 48 identities', { timeout: 900_000 }, () => {
  // compare --verify re-verifies both reports from their folders before it pairs them.
  const compared = spawnSync(process.execPath, [CLI, 'compare', join(dir, 'excalidraw-oracle', 'report.json'), join(dir, 'drawio-oracle', 'report.json'), '--verify', '--json'], { encoding: 'utf8', timeout: 840_000 });
  assert.equal(compared.status, 0, compared.stderr);
  const result = JSON.parse(compared.stdout) as { baseline: { verification: string }; candidate: { verification: string }; comparison: { pairing: string; paired: number; discordant: { baselineOnly: number; candidateOnly: number } } };
  assert.deepEqual([result.baseline.verification, result.candidate.verification], ['re-verified', 're-verified']);
  assert.deepEqual([result.comparison.pairing, result.comparison.paired, result.comparison.discordant.baselineOnly, result.comparison.discordant.candidateOnly], ['identity', 48, 0, 0]);
  // Each report is anchored to the library this Practonaut ships for its own application (review m2c).
  for (const name of ['excalidraw-oracle', 'drawio-oracle']) {
    const verified = spawnSync(process.execPath, [CLI, 'report', join(dir, name, 'report.json'), '--verify', '--runs', join(dir, name), '--json'], { encoding: 'utf8', timeout: 840_000 });
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual((JSON.parse(verified.stdout) as { verification: { library?: unknown } }).verification.library, { status: 'same' }, name);
  }
});

// Every bench report committed as a fixture or an example passes the consistency check of the
// Practonaut it ships with: a report-format change that makes one stale (as recording check_result
// in the mutation log did) fails here, in the fast layer, not first in the card or CI-recipe tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateBenchReport } from '../../src/bench/report.ts';

function jsonFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(path);
    return entry.isFile() && entry.name.endsWith('.json') && statSync(path).size < 16 * 1024 * 1024 ? [path] : [];
  });
}

test('every committed bench report passes the consistency check', () => {
  const reports = ['tests/fixtures', 'docs', 'examples'].flatMap(jsonFiles).filter(path => {
    try { return /^practonaut\.bench\/\d+$/.test(String((JSON.parse(readFileSync(path, 'utf8')) as { schema?: unknown }).schema)); } catch { return false; }
  });
  assert.ok(reports.length > 0, 'the fixtures hold bench reports');
  for (const path of reports) assert.doesNotThrow(() => validateBenchReport(JSON.parse(readFileSync(path, 'utf8'))), `${path} fails the consistency check`);
});

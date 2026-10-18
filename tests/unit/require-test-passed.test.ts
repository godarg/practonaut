// tools/require-test-passed.ts (issue #45): the repeat workflow must fail when its name pattern selects
// no test, a skipped one, or a failing one. The reports come from Node's own runner on a scratch test
// file, so the TAP shapes are the runner's, not this tool's idea of them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireTestPassed } from '../../tools/require-test-passed.ts';

const scratch = mkdtempSync(join(tmpdir(), 'pn-tap-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
writeFileSync(join(scratch, 'sample.test.mjs'), [
  "import test from 'node:test';",
  "test('H1 transfer: another test', () => {});",
  "test('H1 native file: the one to repeat', () => {});",
  "test('H1 native file skipped', { skip: 'not here' }, () => {});",
  "test('Broken: always fails', () => { throw new Error('red'); });",
].join('\n'));
/** A TAP report from `node --test` with the given name pattern. */
function report(pattern: string, name: string): string {
  const destination = join(scratch, `${name}.tap`), env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // a runner inside this test run would otherwise report to it, not to the file
  const run = spawnSync(process.execPath, ['--test', `--test-name-pattern=${pattern}`, '--test-reporter=tap', `--test-reporter-destination=${destination}`, join(scratch, 'sample.test.mjs')], { encoding: 'utf8', env });
  assert.equal(run.error, undefined);
  return readFileSync(destination, 'utf8');
}

test('a pattern that selects the passing test satisfies the check', () => {
  assert.equal(requireTestPassed(report('^H1 native file: ', 'selected'), 'H1 native file:'), null);
});
test('a pattern that selects nothing, which Node still reports as a pass, fails the check', () => {
  assert.match(requireTestPassed(report('^H1 renamed', 'nothing'), 'H1 native file:') ?? '', /expected exactly one test named "H1 native file:…", found 0/);
});
test('a skipped test fails the check', () => {
  assert.match(requireTestPassed(report('^H1 native file skipped', 'skipped'), 'H1 native file') ?? '', /reported as SKIP/);
});
test('a failing test fails the check', () => {
  assert.match(requireTestPassed(report('^(H1 native file: |Broken)', 'failing'), 'H1 native file:') ?? '', /^failed: Broken: always fails/);
});
test('two tests with the prefix fail the check', () => {
  assert.match(requireTestPassed(report('^H1 ', 'two'), 'H1') ?? '', /found 3/);
});

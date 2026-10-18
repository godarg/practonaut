// tools/amplify-host-deadline.ts (issue #64): how an attempt is read. The reports come from Node's own
// runner on a scratch test file, so the TAP shapes (result lines, YAML blocks, stderr as comment lines)
// are the runner's; the Playwright log lines and their times are written by hand here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, closePhases, requireAllPassed, tapResult } from '../../tools/amplify-host-deadline.ts';

const scratch = mkdtempSync(join(tmpdir(), 'pn-amplify-tap-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));
// Browser 41: close requested at .000, exited at .250, profile removal 5.5 s, done at 5.760.
// Browser 42: close requested, never exited (no further lines).
const log = [
  '2026-10-18T16:52:00.000Z pw:browser [pid=41] <gracefully close start>',
  '2026-10-18T16:52:00.250Z pw:browser [pid=41] <process did exit: exitCode=0, signal=null>',
  '2026-10-18T16:52:00.255Z pw:browser [pid=41] starting temporary directories cleanup',
  '2026-10-18T16:52:05.755Z pw:browser [pid=41] exception while removing C:\\Temp\\profile: Error: EBUSY',
  '2026-10-18T16:52:05.755Z pw:browser [pid=41] finished temporary directories cleanup',
  '2026-10-18T16:52:05.760Z pw:browser [pid=41] <gracefully close end>',
  '2026-10-18T16:52:01.000Z pw:browser [pid=42] <gracefully close start>',
  '2026-10-18T16:52:01.000Z pw:browser [pid=42][err] a browser line that is not a phase',
];
writeFileSync(join(scratch, 'sample.test.mjs'), [
  "import test from 'node:test';",
  `test('passes and logs', () => { for (const line of ${JSON.stringify(log)}) process.stderr.write(line + '\\n'); });`,
  "test('fails at close', () => { const error = new Error('Browser operation exceeded its deadline'); error.name = 'BrowserDeadlineError'; throw error; });",
  // A live timer, so the runner times the test out instead of cancelling it on an empty event loop.
  "test('hangs', { timeout: 50 }, () => new Promise(() => { setTimeout(() => {}, 1000); }));",
  "test('fails otherwise', () => { throw new TypeError('something else'); });",
].join('\n'));
const destination = join(scratch, 'report.tap'), env = { ...process.env };
delete env.NODE_TEST_CONTEXT; // a runner inside this test run would otherwise report to it, not to the file
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-reporter-destination=${destination}`, join(scratch, 'sample.test.mjs')], { encoding: 'utf8', env });
const tap = run.error ? '' : readFileSync(destination, 'utf8');

test('a TAP report gives each named test its result, duration and error', () => {
  assert.deepEqual({ ...tapResult(tap, 'passes and logs'), durationMs: 0 }, { ok: true, durationMs: 0, failureType: null, errorName: null, error: null });
  assert.deepEqual({ ...tapResult(tap, 'fails at close'), durationMs: 0 }, { ok: false, durationMs: 0, failureType: 'testCodeFailure', errorName: 'BrowserDeadlineError', error: 'Browser operation exceeded its deadline' });
  assert.equal(tapResult(tap, 'hangs')?.failureType, 'testTimeoutFailure');
  assert.equal(tapResult(tap, 'not in the report'), null);
});
test('Playwright log lines in the report give each close its exit and profile-removal time', () => {
  assert.deepEqual(closePhases(tap), [
    { pid: 41, exitMs: 250, cleanupMs: 5500, totalMs: 5760, removalError: true },
    { pid: 42, exitMs: null, cleanupMs: null, totalMs: null, removalError: false },
  ]);
});
test('an attempt is a close deadline only when a recorded close reached the bound or never ended', () => {
  const deadline = tapResult(tap, 'fails at close');
  assert.equal(classify(deadline, [{ event: 'close-start' }, { event: 'close-end', ms: 8000 }], 8000), 'close-deadline');
  assert.equal(classify(deadline, [{ event: 'close-start' }], 8000), 'close-deadline');
  assert.equal(classify(deadline, [{ event: 'close-start' }, { event: 'close-end', ms: 7999 }], 8000), 'browser-deadline-other');
  assert.equal(classify(tapResult(tap, 'passes and logs'), [], 8000), 'passed');
  assert.equal(classify(tapResult(tap, 'hangs'), [], 8000), 'test-timeout');
  assert.equal(classify(tapResult(tap, 'fails otherwise'), [], 8000), 'other');
  assert.equal(classify(null, [], 8000), 'not-run');
});

// --require-pass (the repeat workflow): the two real test names, written out here, not taken from the tool.
const LATE = 'a real late mirror write cannot commit after the supplied monotonic deadline';
const CORE = 'deadline expiration at real core serialization is a timeout, with preserved committed export state';
writeFileSync(join(scratch, 'named.test.mjs'), [
  "import test from 'node:test';",
  `test(${JSON.stringify(LATE)}, () => {});`,
  `test(${JSON.stringify(CORE)}, () => {});`,
  `test(${JSON.stringify(CORE + ' (skipped twin)')}, { skip: 'not here' }, () => {});`,
  "test('fails beside them', () => { throw new Error('red'); });",
].join('\n'));
/** A TAP report of the named scratch tests that the pattern selects. */
function named(pattern: string, label: string): string {
  const out = join(scratch, `${label}.tap`);
  const done = spawnSync(process.execPath, ['--test', `--test-name-pattern=${pattern}`, '--test-reporter=tap', `--test-reporter-destination=${out}`, join(scratch, 'named.test.mjs')], { encoding: 'utf8', env });
  return done.error ? '' : readFileSync(out, 'utf8');
}
test('--require-pass holds only when each test ran and passed in every attempt', () => {
  const late = named('^a real late', 'late'), core = named(`^${CORE.replace(/[(),]/g, '\\$&')}$`, 'core');
  assert.equal(requireAllPassed({ 'late-write': [late, late], 'core-serialization': [core, core] }, 2), null);
  assert.equal(requireAllPassed({ 'late-write': [late], 'core-serialization': [core, core] }, 2), 'late-write: expected 2 reports, found 1');
  assert.match(requireAllPassed({ 'late-write': [late, named('^nothing matches', 'none')], 'core-serialization': [core, core] }, 2) ?? '', /^late-write attempt 2: expected exactly one test named/);
  assert.match(requireAllPassed({ 'late-write': [late, late], 'core-serialization': [core, named('^(deadline expiration|fails beside)', 'failing')] }, 2) ?? '', /^core-serialization attempt 2: failed: fails beside them/);
});

// The checker is deterministic, so a checker process that does not finish within its wall limit judged
// nothing: the machine was busy. Re-verifying a stored report runs it again and never reports such a run
// as the checker refusing the artifact. Regression for the gate run of 2026-11-17, where one starved
// checker start on a busy machine became "run review-and-send-s1-r1: the checker rejects the session
// artifact" for a committed report that verifies.
//
// The stall is made at the process boundary: tests/support/stall-checker.ts, preloaded into the checker
// processes through NODE_OPTIONS, holds the chosen checker starts past the 10 s limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { retryCheckerTimeout, RuntimeError } from '../../src/cli/runtime.ts';
import { BenchReportError, validateBenchReportV2 } from '../../src/bench/report.ts';
import { verifyBenchV2 } from '../../src/bench/verify.ts';
import { libraryWorld } from '../../src/bench/run.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HOOK = pathToFileURL(join(ROOT, 'tests/support/stall-checker.ts')).href;
const FOLDER = join(ROOT, 'tests/fixtures/bench/v2');
const report = (): ReturnType<typeof validateBenchReportV2> => validateBenchReportV2(JSON.parse(readFileSync(join(FOLDER, 'report.json'), 'utf8')));
// verifyBenchV2 first checks the stored reference (checker start 1), then re-judges the session of
// run review-and-send-s1-r1 (start 2).
const SESSION_START = 2;

/** Runs `work` with the listed checker starts stalled; returns its value or error and how many checker
 * processes started (zero would mean the stall never reached a checker: the test would prove nothing). */
async function withStalledStarts<T>(stalled: number[], work: () => Promise<T>): Promise<{ value?: T; error?: unknown; starts: number }> {
  const directory = mkdtempSync(join(tmpdir(), 'pn-stall-'));
  const saved = { NODE_OPTIONS: process.env.NODE_OPTIONS, PN_STALL_DIR: process.env.PN_STALL_DIR, PN_STALL_AT: process.env.PN_STALL_AT };
  process.env.NODE_OPTIONS = [saved.NODE_OPTIONS, `--import=${HOOK}`].filter(Boolean).join(' ');
  process.env.PN_STALL_DIR = directory;
  process.env.PN_STALL_AT = stalled.join(',');
  try {
    try { const value = await work(); return { value, starts: readdirSync(directory).length }; }
    catch (error) { return { error, starts: readdirSync(directory).length }; }
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(directory, { recursive: true, force: true });
  }
}

test('a checker start that stalls past the wall limit is run again, and the committed report still re-verifies', async () => {
  const outcome = await withStalledStarts([SESSION_START], () => verifyBenchV2(report(), FOLDER, libraryWorld));
  assert.equal(outcome.error, undefined, String((outcome.error as Error | undefined)?.message));
  assert.deepEqual([outcome.value?.reverified, outcome.value?.unjudged], [2, 0]);
  assert.ok(outcome.starts > SESSION_START, `the stalled start was reached and followed by others (starts: ${outcome.starts})`);
});

test('a checker that never finishes within the wall limit is named as a timeout, never as refusing the artifact', async () => {
  const outcome = await withStalledStarts([SESSION_START, SESSION_START + 1, SESSION_START + 2], () => verifyBenchV2(report(), FOLDER, libraryWorld));
  assert.ok(outcome.error instanceof RuntimeError, `a RuntimeError, not ${(outcome.error as Error | undefined)?.name}: ${(outcome.error as Error | undefined)?.message}`);
  assert.ok(!(outcome.error instanceof BenchReportError));
  assert.equal(outcome.error.code, 'checker_timeout');
  assert.match(outcome.error.message, /run review-and-send-s1-r1: .*10 s wall limit in 3 attempts/);
  assert.doesNotMatch(outcome.error.message, /rejects/);
});

test('only checker_timeout is retried, three attempts at most, with a growing pause', async () => {
  const timeout = (): RuntimeError => new RuntimeError('checker_timeout', 'wall limit');
  const pauses: number[] = [];
  const pause = async (ms: number): Promise<void> => { pauses.push(ms); };

  let calls = 0;
  assert.equal(await retryCheckerTimeout(async () => { calls++; if (calls < 3) throw timeout(); return 'judged'; }, pause), 'judged');
  assert.deepEqual([calls, pauses], [3, [1000, 2000]]);

  calls = 0;
  await assert.rejects(retryCheckerTimeout(async () => { calls++; throw timeout(); }, pause), (error: unknown) => error instanceof RuntimeError && error.code === 'checker_timeout');
  assert.equal(calls, 3);

  // A refusal is the checker's answer: it is never asked again.
  calls = 0;
  await assert.rejects(retryCheckerTimeout(async () => { calls++; throw new RuntimeError('checker_invalid', 'refused'); }, pause), (error: unknown) => (error as RuntimeError).code === 'checker_invalid');
  assert.equal(calls, 1);
});

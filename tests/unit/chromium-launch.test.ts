// PADR-0032 (amended 2026-10-13): sandbox first; only on Linux, only for a sandbox refusal and only
// under the default policy, one more start without the sandbox. The fake stands at the Playwright
// boundary (BrowserType.launch); the real process boundary is covered in tests/integration/browser-start.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, LaunchOptions } from 'playwright-core';
import { SANDBOX_ENV, SandboxPolicyError, chromiumSandboxFallbackActive, chromiumSandboxPolicy, isSandboxStartFailure, launchChromium, type SandboxMemo } from '../../src/adapters/excalidraw/chromium.ts';

const SANDBOX_REFUSED = 'browserType.launch: Target page, context or browser has been closed\nBrowser logs:\n[pid=1][err] [0101/000000.000000:FATAL:zygote_host_impl_linux.cc(127)] No usable sandbox! If you are running on Ubuntu 23.10+ or another Linux distro that has disabled unprivileged user namespaces with AppArmor, see …\nChromium sandboxing failed!';
const MISSING_LIBRARIES = 'browserType.launch: Host system is missing dependencies to run browsers.\n  libnss3.so: cannot open shared object file';
const BROWSER = { marker: 'browser' } as unknown as Browser;

/** A BrowserType whose sandboxed starts fail with `failure` and whose unsandboxed starts succeed. */
function fakeChromium(failure?: string) {
  const calls: LaunchOptions[] = [];
  return { calls, launch: async (options: LaunchOptions = {}): Promise<Browser> => { calls.push(options); if (failure && options.chromiumSandbox !== false) throw new Error(failure); return BROWSER; } };
}
const fresh = (): SandboxMemo => ({ unavailable: false });

test('the policy is auto unless PRACTONAUT_CHROMIUM_SANDBOX=require; every other value is refused, never weaker', () => {
  assert.equal(chromiumSandboxPolicy({}), 'auto');
  assert.equal(chromiumSandboxPolicy({ [SANDBOX_ENV]: '' }), 'auto');
  assert.equal(chromiumSandboxPolicy({ [SANDBOX_ENV]: 'require' }), 'require');
  for (const value of ['off', '0', 'false', 'required', 'REQUIRE', 'auto']) assert.throws(() => chromiumSandboxPolicy({ [SANDBOX_ENV]: value }), SandboxPolicyError, value);
});

test('only a Linux sandbox refusal counts as one', () => {
  assert.equal(isSandboxStartFailure(new Error(SANDBOX_REFUSED), 'linux'), true);
  assert.equal(isSandboxStartFailure(new Error('Chromium sandboxing failed!'), 'linux'), true);
  assert.equal(isSandboxStartFailure(new Error(MISSING_LIBRARIES), 'linux'), false);
  assert.equal(isSandboxStartFailure(new Error('spawn EACCES'), 'linux'), false);
  for (const platform of ['darwin', 'win32', 'freebsd'] as const) assert.equal(isSandboxStartFailure(new Error(SANDBOX_REFUSED), platform), false, platform);
});

test('a sandbox that starts is used; the caller cannot switch it off through the options', async () => {
  const chromium = fakeChromium(), memo = fresh();
  const started = await launchChromium(chromium, () => ({ headless: true, chromiumSandbox: false }), { env: {}, platform: 'linux', memo });
  assert.deepEqual(started, { browser: BROWSER, sandbox: true });
  assert.deepEqual(chromium.calls, [{ headless: true, chromiumSandbox: true }]); assert.equal(memo.unavailable, false);
});

test('Linux, auto: a sandbox refusal starts once without the sandbox, and later starts skip the failing attempt', async () => {
  const chromium = fakeChromium(SANDBOX_REFUSED), memo = fresh(); let timeouts = 0;
  const options = (): LaunchOptions => ({ headless: true, timeout: 1000 - 100 * timeouts++ });
  assert.deepEqual(await launchChromium(chromium, options, { env: {}, platform: 'linux', memo }), { browser: BROWSER, sandbox: false });
  // Each attempt asks for its options again, so a deadline-derived timeout shrinks.
  assert.deepEqual(chromium.calls, [{ headless: true, timeout: 1000, chromiumSandbox: true }, { headless: true, timeout: 900, chromiumSandbox: false }]);
  assert.equal(chromiumSandboxFallbackActive(memo), true);
  assert.deepEqual(await launchChromium(chromium, () => ({ headless: true }), { env: {}, platform: 'linux', memo }), { browser: BROWSER, sandbox: false });
  assert.equal(chromium.calls.length, 3); assert.equal(chromium.calls[2]!.chromiumSandbox, false);
});

test('require refuses the fallback, also after an earlier fallback in the same process', async () => {
  const chromium = fakeChromium(SANDBOX_REFUSED), memo = fresh();
  await assert.rejects(launchChromium(chromium, () => ({}), { env: { [SANDBOX_ENV]: 'require' }, platform: 'linux', memo }), /No usable sandbox!/);
  assert.deepEqual(chromium.calls, [{ chromiumSandbox: true }]); assert.equal(memo.unavailable, false);
  memo.unavailable = true;
  await assert.rejects(launchChromium(chromium, () => ({}), { env: { [SANDBOX_ENV]: 'require' }, platform: 'linux', memo }), /No usable sandbox!/);
  assert.deepEqual(chromium.calls.map(call => call.chromiumSandbox), [true, true]);
});

test('no fallback on other platforms, for other failures, or with an unknown policy value', async () => {
  for (const platform of ['darwin', 'win32'] as const) {
    const chromium = fakeChromium(SANDBOX_REFUSED), memo = fresh();
    await assert.rejects(launchChromium(chromium, () => ({}), { env: {}, platform, memo }), /No usable sandbox!/);
    assert.equal(chromium.calls.length, 1, platform); assert.equal(memo.unavailable, false);
  }
  const libraries = fakeChromium(MISSING_LIBRARIES), memo = fresh();
  await assert.rejects(launchChromium(libraries, () => ({}), { env: {}, platform: 'linux', memo }), /missing dependencies/);
  assert.equal(libraries.calls.length, 1); assert.equal(memo.unavailable, false);
  const typo = fakeChromium(SANDBOX_REFUSED);
  await assert.rejects(launchChromium(typo, () => ({}), { env: { [SANDBOX_ENV]: 'off' }, platform: 'linux', memo: fresh() }), SandboxPolicyError);
  assert.equal(typo.calls.length, 0, 'an unknown policy value starts nothing');
});

test('a failing unsandboxed start is reported as itself and leaves no memory of a fallback', async () => {
  const memo = fresh(), calls: LaunchOptions[] = [];
  const chromium = { launch: async (options: LaunchOptions = {}): Promise<Browser> => { calls.push(options); throw new Error(options.chromiumSandbox === false ? MISSING_LIBRARIES : SANDBOX_REFUSED); } };
  await assert.rejects(launchChromium(chromium, () => ({}), { env: {}, platform: 'linux', memo }), /missing dependencies/);
  assert.equal(calls.length, 2); assert.equal(memo.unavailable, false);
});

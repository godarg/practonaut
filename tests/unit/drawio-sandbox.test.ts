// PADR-0049 decision 7: draw.io never starts Chromium without its sandbox, on any platform. These tests
// run with PRACTONAUT_CHROMIUM_SANDBOX unset, so only the adapter's own policy can require the sandbox:
// once the AppArmor restriction is lifted in CI, a sandboxed start succeeds with or without that
// policy, so this is where its absence shows. The fake stands at Playwright's launch boundary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, LaunchOptions } from 'playwright-core';
import { launchChromium, type SandboxMemo } from '../../src/adapters/browser/chromium.ts';
import { ADAPTER_REGISTRY } from '../../src/adapters/registry.ts';
import { startShell } from '../../src/adapters/browser/shell.ts';

const SANDBOX_REFUSED = 'browserType.launch: Target page, context or browser has been closed\n[pid=1][err] No usable sandbox! If you are running on Ubuntu 23.10+ … AppArmor\nChromium sandboxing failed!';
const BROWSER = { marker: 'browser', close: async () => undefined } as unknown as Browser;
function fakeChromium(refuseSandbox: boolean) {
  const calls: LaunchOptions[] = [];
  return { calls, launch: async (options: LaunchOptions = {}): Promise<Browser> => { calls.push(options); if (refuseSandbox && options.chromiumSandbox !== false) throw new Error(SANDBOX_REFUSED); return BROWSER; } };
}

test('the registry names a sandbox policy per adapter: Excalidraw keeps PADR-0032\'s fallback, draw.io requires the sandbox', () => {
  assert.equal(ADAPTER_REGISTRY.excalidraw.sandbox, 'linux-fallback');
  assert.equal(ADAPTER_REGISTRY.drawio.sandbox, 'required');
});

test('after Excalidraw\'s fallback set the process memo, a draw.io start still asks for the sandbox', async () => {
  const memo: SandboxMemo = { unavailable: false };
  // Excalidraw on a restrictive Linux: one refusal, then the fallback, remembered.
  const excalidraw = fakeChromium(true);
  assert.equal((await launchChromium(excalidraw, () => ({ headless: true }), { env: {}, platform: 'linux', memo })).sandbox, false);
  assert.equal(memo.unavailable, true);
  // draw.io in the same process, on a system that allows the sandbox: it asks for it.
  const drawio = fakeChromium(false);
  assert.deepEqual(await launchChromium(drawio, () => ({ headless: true }), { env: {}, platform: 'linux', memo, sandbox: 'required' }), { browser: BROWSER, sandbox: true });
  assert.deepEqual(drawio.calls.map(call => call.chromiumSandbox), [true]);
});

test('a refused sandboxed start of draw.io fails and never starts a second time without the sandbox', async () => {
  for (const memo of [{ unavailable: false }, { unavailable: true }]) {
    const chromium = fakeChromium(true);
    await assert.rejects(launchChromium(chromium, () => ({ headless: true }), { env: {}, platform: 'linux', memo, sandbox: 'required' }), /sandbox/i);
    assert.deepEqual(chromium.calls.map(call => call.chromiumSandbox), [true], `memo ${memo.unavailable}: exactly one start, with the sandbox`);
  }
  // An invalid environment value is still refused: the environment can only tighten.
  await assert.rejects(launchChromium(fakeChromium(false), () => ({}), { env: { PRACTONAUT_CHROMIUM_SANDBOX: 'off' }, platform: 'linux', sandbox: 'required' }), /PRACTONAUT_CHROMIUM_SANDBOX/);
});

test('the shared shell starts a required-sandbox adapter with its policy, whatever the process memo says', async () => {
  const chromium = fakeChromium(true);
  await assert.rejects(startShell({ origins: {}, chromium, launchContext: { env: {}, platform: 'linux', memo: { unavailable: true } }, sandbox: 'required' }, async () => undefined));
  assert.deepEqual(chromium.calls.map(call => call.chromiumSandbox), [true]);
});

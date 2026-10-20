// PADR-0049 decision 3.7 and review m3 (r3-contract-1): the start check launches Chromium under the
// adapter's sandbox policy, exactly as the adapter's mirror will. On a simulated Linux whose Chromium
// refuses sandboxed launches, draw.io's `required` start check fails after one sandboxed attempt and
// leaves the process memo alone; Excalidraw's `linux-fallback` starts without the sandbox and says so.
// The fake stands at Playwright's launch boundary; the ledger is the test's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Browser, LaunchOptions } from 'playwright-core';
import { chromiumStarts } from '../../src/cli/browser-start.ts';
import { BrowserLedger } from '../../src/adapters/browser/ledger.ts';
import { ADAPTER_REGISTRY } from '../../src/adapters/registry.ts';
import type { SandboxMemo } from '../../src/adapters/browser/chromium.ts';
import { FakeBrowser } from '../support/fake-browser.ts';

const SANDBOX_REFUSED = 'browserType.launch: Target page, context or browser has been closed\n[pid=1][err] No usable sandbox! If you are running on Ubuntu 23.10+ … AppArmor\nChromium sandboxing failed!';
function refusingChromium() {
  const calls: LaunchOptions[] = [];
  const browser = new FakeBrowser() as unknown as Browser;
  return { calls, launch: async (options: LaunchOptions = {}): Promise<Browser> => { calls.push(options); if (options.chromiumSandbox !== false) throw new Error(SANDBOX_REFUSED); return browser; } };
}

test('the start check applies the adapter\'s sandbox policy: draw.io fails sandboxed, Excalidraw falls back, on a Linux that refuses the sandbox', async () => {
  for (const [policy, expected] of [[ADAPTER_REGISTRY.drawio.sandbox, { ok: false, launches: [true], memo: false }], [ADAPTER_REGISTRY.excalidraw.sandbox, { ok: true, launches: [true, false], memo: true }]] as const) {
    const chromium = refusingChromium(), ledger = new BrowserLedger(4, 0), memo: SandboxMemo = { unavailable: false };
    const started = await chromiumStarts(5_000, policy, { chromium, ledger, launchContext: { env: {}, platform: 'linux', memo } });
    assert.equal(started.ok, expected.ok, `${policy}: ${JSON.stringify(started)}`);
    if (started.ok) assert.equal(started.sandbox, false, `${policy}: the fallback is reported`);
    else assert.match(started.detail, /sandbox/i);
    assert.deepEqual(chromium.calls.map(call => call.chromiumSandbox), expected.launches, `${policy}: the launches`);
    assert.equal(memo.unavailable, expected.memo, `${policy}: the process memo`);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(ledger.unreleased(), 0, `${policy}: the slot is released (no hold after a failed launch here)`);
  }
});

test('the policy is the adapter\'s even when the context the caller passes says otherwise', async () => {
  const chromium = refusingChromium(), ledger = new BrowserLedger(4);
  const context = { env: {}, platform: 'linux' as const, memo: { unavailable: true }, sandbox: 'linux-fallback' } as never;
  const started = await chromiumStarts(5_000, 'required', { chromium, ledger, launchContext: context });
  assert.equal(started.ok, false);
  assert.deepEqual(chromium.calls.map(call => call.chromiumSandbox), [true]);
});

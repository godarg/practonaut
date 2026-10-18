/**
 * The one way Practonaut starts Playwright's Chromium (PADR-0032, amendment of 2026-10-13).
 *
 * Every start tries the sandbox first. On Linux, when that start fails because the system does not
 * allow Chromium's sandbox (Ubuntu 23.10 and later restrict unprivileged user namespaces with
 * AppArmor), it starts once more without the sandbox and the process remembers that, so later
 * starts do not pay for a failing attempt again. The reasons this is acceptable are recorded in the
 * PADR: the browser only ever loads the bundled, offline-pinned Excalidraw engine from a local
 * origin, every other request is aborted, and world packages reach it as data. Playwright's own
 * default is to launch without the sandbox.
 *
 * `PRACTONAUT_CHROMIUM_SANDBOX=require` forbids the fallback: a sandbox failure is then the start
 * failure. Any other non-empty value is refused, so a typo can never mean "less isolation".
 * No other platform falls back, and no other start failure (missing libraries, a damaged download)
 * does.
 */
import type { Browser, LaunchOptions } from 'playwright-core';

export const SANDBOX_ENV = 'PRACTONAUT_CHROMIUM_SANDBOX';
export type SandboxPolicy = 'auto' | 'require';
export interface ChromiumLaunch { browser: Browser; sandbox: boolean }
/** Process-wide memory of a sandbox fallback that already happened (separate state for tests). */
export interface SandboxMemo { unavailable: boolean }
export interface LaunchContext { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform; memo?: SandboxMemo }

const PROCESS_MEMO: SandboxMemo = { unavailable: false };

export class SandboxPolicyError extends Error {
  readonly code = 'chromium_sandbox_policy';
}

/** `auto` (unset or empty) or `require`; anything else is an error, never a weaker setting. */
export function chromiumSandboxPolicy(env: NodeJS.ProcessEnv = process.env): SandboxPolicy {
  const value = env[SANDBOX_ENV];
  if (value === undefined || value === '') return 'auto';
  if (value === 'require') return 'require';
  throw new SandboxPolicyError(`${SANDBOX_ENV} must be "require" or unset, not ${JSON.stringify(value.slice(0, 40))}`);
}

// Chromium's and Playwright's own wording for a sandbox that cannot be set up on Linux:
// zygote_host_impl_linux "No usable sandbox!", Playwright's hint "Chromium sandboxing failed!",
// the setuid helper and the user-namespace / AppArmor explanation in the same output.
const SANDBOX_FAILURE = /sandboxing failed|no usable sandbox|setuid sandbox|unprivileged user namespaces|apparmor/i;

/** True only on Linux and only when the launch error names the sandbox as the cause. */
export function isSandboxStartFailure(error: unknown, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'linux') return false;
  const text = error instanceof Error ? error.message : String(error);
  return SANDBOX_FAILURE.test(text);
}

/** Whether this process already had to start Chromium without its sandbox. */
export function chromiumSandboxFallbackActive(memo: SandboxMemo = PROCESS_MEMO): boolean {
  return memo.unavailable;
}

/**
 * Starts Chromium with the sandbox, or on Linux once without it when the sandbox itself is what
 * failed and the policy is `auto`. `options` is called for every attempt, so a caller can derive
 * the launch timeout from its own remaining deadline.
 */
export async function launchChromium(chromium: { launch(options?: LaunchOptions): Promise<Browser> }, options: () => LaunchOptions = () => ({}), context: LaunchContext = {}): Promise<ChromiumLaunch> {
  const policy = chromiumSandboxPolicy(context.env ?? process.env);
  const platform = context.platform ?? process.platform, memo = context.memo ?? PROCESS_MEMO;
  if (policy === 'auto' && memo.unavailable) return { browser: await chromium.launch({ ...options(), chromiumSandbox: false }), sandbox: false };
  try {
    return { browser: await chromium.launch({ ...options(), chromiumSandbox: true }), sandbox: true };
  } catch (error) {
    if (policy === 'require' || !isSandboxStartFailure(error, platform)) throw error;
    const browser = await chromium.launch({ ...options(), chromiumSandbox: false });
    memo.unavailable = true;
    return { browser, sandbox: false };
  }
}

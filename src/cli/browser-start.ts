/**
 * Whether the installed Playwright Chromium actually starts. Present files are not enough: on Linux
 * the Chromium sandbox needs unprivileged user namespaces (Ubuntu 23.10+ restricts them with
 * AppArmor) and system libraries; on any system the binary can be damaged or blocked. The check
 * launches the browser exactly as the mirror does (headless, sandbox on) and closes it again.
 */
import { cliText } from './messages.ts';
import { safeText } from './output.ts';

export const BROWSER_START_MS = 30_000;
export type StartResult = { ok: true } | { ok: false; detail: string };

/** First meaningful line of a launch error, terminal-safe and short; no stack, no paths beyond it. */
export function launchFailureDetail(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, '');
  const lines = text.split('\n').map(line => line.replace(/^\s*(?:-\s*)?(?:browserType\.launch:|\[pid=\d+\]\[err\])\s*/, '').trim()).filter(Boolean);
  // Playwright's own diagnosis first ("Chromium sandboxing failed!", missing host dependencies), then
  // the browser's fatal line, then whatever came first.
  const telling = lines.find(line => /sandboxing failed|missing dependencies|error while loading shared libraries|cannot open shared object/i.test(line))
    ?? lines.find(line => /FATAL|sandbox|namespace|apparmor|Permission denied/i.test(line)) ?? lines[0] ?? 'unknown error';
  return safeText(telling).slice(0, 240);
}

export async function chromiumStarts(timeoutMs: number = BROWSER_START_MS): Promise<StartResult> {
  try {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: timeoutMs, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
    await browser.close().catch(() => {});
    return { ok: true };
  } catch (error) { return { ok: false, detail: launchFailureDetail(error) }; }
}

/** Advice for a browser that is installed but does not start, for the platform. */
export function browserAdvice(platform: NodeJS.Platform = process.platform): string {
  return cliText(platform === 'linux' ? 'browserAdviceLinux' : 'browserAdviceOther');
}

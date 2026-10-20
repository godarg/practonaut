/**
 * Whether the installed Playwright Chromium actually starts. Present files are not enough: on Linux
 * the Chromium sandbox needs unprivileged user namespaces (Ubuntu 23.10+ restricts them with
 * AppArmor) and system libraries; on any system the binary can be damaged or blocked. The check
 * launches the browser exactly as the mirror does (headless, sandbox first, on Linux the PADR-0032
 * fallback without it) and closes it again. A start without the sandbox is reported, never hidden.
 */
import type { AdapterSandboxPolicy } from '../adapters/browser/chromium.ts';
import { BrowserBudgetError, startBrowser, type BrowserLedger, type ChromiumLauncher } from '../adapters/browser/ledger.ts';
import { cliText } from './messages.ts';
import { safeText } from './output.ts';

export const BROWSER_START_MS = 30_000;
/** `budget`: the start was refused because no browser slot became free (PADR-0050); a command that
 * needs the mirror stops with that named error, not as a start that failed. */
export type StartResult = { ok: true; sandbox: boolean } | { ok: false; detail: string; budget?: BrowserBudgetError };

/** The budget refusal as one line, by its code, with the counts and the remedy in the CLI's language. */
export const budgetDetail = (error: BrowserBudgetError): string => `${error.code}: ${cliText('browserBudgetExhausted', { running: error.running, closing: error.closing, budget: error.budget })}`;

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

/** Test seams: a fake Playwright `chromium`, a ledger of the test's own (default: the process's). */
export interface StartCheckSeams { chromium?: ChromiumLauncher; ledger?: BrowserLedger }
/** Started exactly as the adapter's mirror will start: under its sandbox policy (PADR-0049 decision 7),
 * on a slot of the browser budget. The answer does not wait for a slow close: the close runs under the
 * close contract (PADR-0050), and an abandoned or failed close leaves the answer as it is; the browser
 * keeps its slot until its end is proven. */
export async function chromiumStarts(timeoutMs: number = BROWSER_START_MS, policy: AdapterSandboxPolicy = 'linux-fallback', seams: StartCheckSeams = {}): Promise<StartResult> {
  try {
    const chromium = seams.chromium ?? (await import('playwright-core')).chromium;
    const { lease, sandbox } = await startBrowser('start-check', chromium, () => ({ headless: true, timeout: timeoutMs, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }), { ledger: seams.ledger, context: { sandbox: policy } });
    await lease.close();
    return { ok: true, sandbox };
  } catch (error) { return error instanceof BrowserBudgetError ? { ok: false, detail: budgetDetail(error), budget: error } : { ok: false, detail: launchFailureDetail(error) }; }
}

/** Advice for a browser that is installed but does not start, for the platform. */
export function browserAdvice(platform: NodeJS.Platform = process.platform): string {
  return cliText(platform === 'linux' ? 'browserAdviceLinux' : 'browserAdviceOther');
}

/** One line for the terminal when the mirror's Chromium runs without its sandbox (PADR-0032). */
export function sandboxFallbackNotice(started: StartResult): string {
  return started.ok && !started.sandbox ? cliText('sandboxFallbackNotice') : '';
}

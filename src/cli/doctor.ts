import { cliText } from './messages.ts';
// Environment checks. `runtime` is what the installed CLI needs; `dev` adds the repository
// tool chain (used by `practonaut doctor --dev` and `npm run doctor`).
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnable } from "../platform/spawnable.ts";
import { browserAdvice, chromiumStarts, type StartResult } from "./browser-start.ts";

export const MIN_NODE: readonly [number, number] = [22, 18];

export interface Check {
  name: string;
  required: boolean;
  ok: boolean;
  detail: string;
}

function run(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  // npm and npx are .cmd shims on Windows; spawnable starts them through cmd.exe.
  const target = spawnable([cmd, ...args]);
  const r = spawnSync(target.command, target.args, { encoding: "utf8", cwd, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...(target.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) });
  if (r.error || r.status !== 0) return { ok: false, out: r.error ? (r.error as NodeJS.ErrnoException).code ?? "error" : cliText("exit", { status: String(r.status) }) };
  return { ok: true, out: (r.stdout || r.stderr).trim().split("\n")[0] ?? "" };
}

export function nodeVersionOk(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)\./.exec(version);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

/** Playwright installs the headless shell next to Chromium as chromium_headless_shell-<revision>. */
export function headlessShellInstalled(executable: string): boolean {
  let directory = dirname(executable);
  while (dirname(directory) !== directory && !/^chromium-\d+$/.test(basename(directory))) directory = dirname(directory);
  if (!/^chromium-\d+$/.test(basename(directory))) return false;
  try { return statSync(join(dirname(directory), basename(directory).replace('chromium-', 'chromium_headless_shell-'))).isDirectory(); } catch { return false; }
}
export async function chromiumCheck(required: boolean): Promise<Check> {
  const name = "playwright chromium (cache)";
  try {
    const pw = (await import("playwright-core")) as { chromium: { executablePath(): string } };
    const p = pw.chromium.executablePath();
    const ok = existsSync(p) && headlessShellInstalled(p);
    return { name, required, ok, detail: ok ? cliText("chromiumPresent") : cliText("chromiumAbsent") };
  } catch {
    return { name, required, ok: false, detail: cliText("playwrightAbsent") };
  }
}

export async function runChecks(profile: "runtime" | "dev", cwd: string = process.cwd(), adapter = false, starts: () => Promise<StartResult> = () => chromiumStarts()): Promise<Check[]> {
  const checks: Check[] = [
    { name: "node", required: true, ok: nodeVersionOk(process.version), detail: cliText("nodeRequired", { version: process.version, minimum: MIN_NODE.join(".") }) },
  ];
  if (profile === "dev") {
    const npm = run("npm", ["--version"]);
    checks.push({ name: "npm", required: true, ok: npm.ok, detail: npm.ok ? npm.out : cliText("notFound", { detail: npm.out }) });
    const git = run("git", ["--version"]);
    checks.push({ name: "git", required: true, ok: git.ok, detail: git.ok ? git.out : cliText("notFound", { detail: git.out }) });
    const gl = run("gitleaks", ["version"]);
    checks.push({ name: "gitleaks (optional)", required: false, ok: gl.ok, detail: gl.ok ? gl.out : cliText("gitleaksAbsent", { detail: gl.out }) });
    const docker = run("docker", ["version", "--format", "{{.Server.Version}}"]);
    checks.push({ name: "docker (optional)", required: false, ok: docker.ok, detail: docker.ok ? cliText("dockerServer", { version: docker.out }) : cliText("dockerOptional") });
  }
  // Chromium is optional for practice (model-only without it) and required for the real mirror.
  // Installed files are not enough: the browser is started once, as the mirror starts it.
  const installed = await chromiumCheck(adapter);
  checks.push(installed);
  if (installed.ok) {
    const started = await starts();
    checks.push({ name: 'chromium start', required: adapter, ok: started.ok, detail: started.ok ? cliText(started.sandbox ? 'chromiumStarts' : 'chromiumStartsUnsandboxed') : cliText('chromiumStartFails', { detail: started.detail }) + ' — ' + browserAdvice().trim() });
  }
  return checks;
}

export function formatChecks(checks: Check[]): string {
  const displayName = (name: string): string => name === 'playwright chromium (cache)' ? cliText('chromiumName') : name === 'chromium start' ? cliText('chromiumStartName') : name === 'docker (optional)' ? cliText('dockerName') : name === 'gitleaks (optional)' ? cliText('gitleaksName') : name;
  const w = Math.max(...checks.map(c => displayName(c.name).length));
  const lines = checks.map(c => `${c.ok ? cliText('checkOk') : c.required ? cliText('checkFail') : cliText('checkWarn')}  ${displayName(c.name).padEnd(w)}  ${c.detail}`);
  const failed = checks.filter((c) => c.required && !c.ok).length;
  lines.push(failed === 0 ? cliText("doctorPassed") : cliText("doctorFailed", { count: failed }));
  return lines.join("\n");
}

export function requiredOk(checks: Check[]): boolean {
  return checks.every((c) => !c.required || c.ok);
}

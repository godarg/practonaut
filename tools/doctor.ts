// Developer environment check (npm run doctor). Shares the checks with `practonaut doctor --dev`,
// plus one only a repository checkout can make: node_modules matches package-lock.json.
// Required: Node >= 22.18, npm, git, locked dependencies installed, Playwright Chromium in the local
// cache, macOS for `serve`. Optional (reported, never fatal): gitleaks, Docker daemon.
// Exit 0 only if every required check passes; 3 otherwise (CLI convention: environment missing).
import { fileURLToPath } from "node:url";
import { type Check, formatChecks, requiredOk, runChecks } from "../src/cli/doctor.ts";
import { describeDrift, installationDrift } from "./lockfile-drift.ts";

/** A pull or branch switch that changed package-lock.json leaves node_modules behind until `npm ci`. */
function dependencies(root: string): Check {
  const name = "dependencies (package-lock.json)";
  try {
    const drift = installationDrift(root);
    return { name, required: true, ok: drift.length === 0, detail: drift.length === 0 ? "node_modules matches package-lock.json" : describeDrift(drift) };
  } catch (error) {
    return { name, required: true, ok: false, detail: `cannot compare node_modules with package-lock.json: ${(error as Error).message}` };
  }
}

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = await runChecks("dev", root);
checks.splice(checks.findIndex((check) => check.name === "git") + 1, 0, dependencies(root));
process.stdout.write(formatChecks(checks) + "\n");
process.exitCode = requiredOk(checks) ? 0 : 3;

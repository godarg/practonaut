// Developer environment check (npm run doctor). Shares the checks with `practonaut doctor --dev`.
// Required: Node >= 22.18, npm, git, Playwright Chromium in the local cache, macOS for `serve`.
// Optional (reported, never fatal): gitleaks, Docker daemon.
// Exit 0 only if every required check passes; 3 otherwise (CLI convention: environment missing).
import { fileURLToPath } from "node:url";
import { formatChecks, requiredOk, runChecks } from "../src/cli/doctor.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = await runChecks("dev", root);
process.stdout.write(formatChecks(checks) + "\n");
process.exitCode = requiredOk(checks) ? 0 : 3;

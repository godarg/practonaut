// The real CLI under the 35 s rule's preload (PADR-0050, decision 9): `tests/support/exit-rule-preload.ts`
// puts Codex's combined path into the process ledger with its close request 40 s back and keeps Node
// alive as Playwright's pipes would. A command must do its work, end its shutdown (a host closed, its
// credential removed), write the ledger's lines, and only then exit through the rule with its own exit
// code. Commands that start a host need the Player build, so those run in the integration layer.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CLI = join(ROOT, 'src/cli/main.ts');
const PRELOAD = join(ROOT, 'tests/support/exit-rule-preload.ts');
export interface Ended { code: number | null; stdout: string; stderr: string }

/** Runs the CLI with the preload, in a PRACTONAUT_HOME of its own, so the credentials counted at its
 * exit are its own. */
export async function cliUnderRule(args: string[], home: string, options: { stdin?: string; interruptWhen?: RegExp } = {}): Promise<Ended> {
  const own = await mkdtemp(join(home, `${args[0]}-`));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', PRELOAD, CLI, ...args], { cwd: home, env: { ...process.env, PRACTONAUT_HOME: own }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', interrupted = false;
    const limit = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${args[0]} did not exit: ${stderr}`)); }, 60_000);
    child.stdout.on('data', chunk => { stdout += chunk; if (options.interruptWhen && !interrupted && options.interruptWhen.test(stdout)) { interrupted = true; child.kill('SIGINT'); } });
    child.stderr.on('data', chunk => { stderr += chunk; });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
    child.on('close', code => { clearTimeout(limit); resolve({ code, stdout, stderr }); });
  });
}

/** The command reported the preload's ledger entry, promised no wait, and exited through the rule
 * with exit code 0 and no session credential left anywhere under its home. */
export function endedThroughRule(name: string, ended: Ended): void {
  assert.equal(ended.code, 0, `${name}: ${ended.stderr}`);
  const lines = ended.stderr.split('\n');
  const ledger = lines.findIndex(line => line.includes('browser 1 (mirror): closed; process end not proven'));
  // The preload's browser disconnected before its close: nothing of Playwright's is left to wait for.
  assert.equal(lines.some(line => line.includes('Waiting for')), false, `${name}: no wait promised`);
  // Every credential under the home counts, bench runs' included (review of PR #69, effects-7).
  const exit = lines.findIndex(line => line.startsWith('[exit-rule] process.exit(0) tokens=0'));
  assert.ok(ledger >= 0 && exit > ledger, `${name}: the ledger's lines, then the exit, with no credential left:\n${ended.stderr}`);
}

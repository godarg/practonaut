// play <task-id> and options without a command start a real local session; they need the built
// Player (this layer builds it first, see package.json test:integration).
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const cli = (args: string[], cwd?: string) => spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', timeout: 60_000, ...(cwd ? { cwd } : {}) });

/** Start the CLI, wait for its link, then stop it with SIGINT. */
async function started(args: string[], home: string): Promise<{ stdout: string; code: number | null }> {
  const child = spawn(process.execPath, [main, ...args], { env: { ...process.env, PRACTONAUT_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
  const deadline = Date.now() + 30_000;
  while (!/Open: http/.test(stdout) && child.exitCode === null && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  child.kill('SIGINT');
  // The child may already have exited (for example when it could not start); never wait for an event that has passed.
  const exited = child.exitCode !== null || child.signalCode !== null;
  const code = exited ? child.exitCode : await new Promise<number | null>(resolve => child.once('exit', resolve));
  assert.match(stdout, /Open: http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{32}/, stderr);
  return { stdout, code };
}
test('play <task-id> opens the library on that task; options alone mean play', { timeout: 90_000 }, async () => {
  const home = await mkdtemp(join(await realpath(tmpdir()), 'pn-home-'));
  try {
    const task = await started(['play', 'connect', '--no-open', '--mirror', 'off'], home);
    assert.match(task.stdout, /Practonaut is running: “Connect two steps” \(world excalidraw-library, task connect\)/);
    assert.equal(task.code, 0);
    const bare = await started(['--no-open', '--mirror', 'off'], home);
    assert.match(bare.stdout, /\(world flow-diagram, task T1\)/);
    const conflict = cli(['play', 'connect', '--task', 'align', '--no-open']);
    assert.equal(conflict.status, 1); assert.match(conflict.stderr, /drop --task/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

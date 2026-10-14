import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

test('without Chromium: doctor warns, --adapter and --mirror required refuse with a setup remedy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pn-cli-browser-missing-'));
  const main = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
  const world = fileURLToPath(new URL('../../examples/worlds/flow-diagram', import.meta.url));
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(directory, 'empty-cache') };
  const run = (args: string[]) => spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', timeout: 30_000, env });
  try {
    const doctor = run(['doctor']);
    assert.equal(doctor.status, 0, 'Chromium is optional for practice');
    assert.match(doctor.stdout, /model-only.*practonaut setup/);
    const adapter = run(['doctor', '--adapter']);
    assert.equal(adapter.status, 3, 'doctor --adapter requires Chromium');
    assert.match(adapter.stdout, /practonaut setup/);
    const actions = join(directory, 'actions.json');
    await writeFile(actions, '[]');
    const packed = join(directory, 'world.pnworld');
    assert.equal(run(['pack', world, '--out', packed]).status, 0, 'packing is independent of browser provisioning');
    for (const args of [['serve', packed, '--mirror', 'required', '--no-open'], ['run', packed, '--seed', '42', '--actions', actions]]) {
      const result = run([...args, '--json']);
      assert.equal(result.status, 3, 'missing browser is an environment error');
      const failure = JSON.parse(result.stderr).error;
      assert.equal(failure.code, 'browser_runtime_missing');
      assert.match(failure.message, /practonaut setup/);
      assert.doesNotMatch(result.stderr, /Executable doesn't exist|browserType\.launch|at startHost|\/Users\/|node:internal/);
      const text = run(args);
      assert.match(text.stderr, /^practonaut: .*practonaut setup.*\[browser_runtime_missing\]\n$/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

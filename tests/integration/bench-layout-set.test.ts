// A generated layout set through the real bench (PADR-0047, PADR-0040): every near miss fails in a
// checker process, the oracle passes, random does not, and both bench folders re-verify. A file of its
// own: the layout generator searches the costliest compositions for its fuel bound, and on a slow
// runner this set beside the other challenge sets went past one file's time budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TOOL = fileURLToPath(new URL('../../tools/challenge.ts', import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, args, { encoding: 'utf8', env: process.env });
type Json = Record<string, any>;
const json = async (path: string): Promise<Json> => JSON.parse(await readFile(path, 'utf8')) as Json;
const benchRoot = (): string => join(process.env.PRACTONAUT_HOME!, 'bench');
async function bench(args: string[]): Promise<{ report: Json; folder: string; stderr: string }> {
  const before = new Set(await readdir(benchRoot()).catch(() => [] as string[]));
  const result = run([CLI, 'bench', ...args]);
  assert.equal(result.status, 0, result.stderr);
  const created = (await readdir(benchRoot())).filter(name => !before.has(name));
  assert.equal(created.length, 1);
  const folder = join(benchRoot(), created[0]!);
  return { report: await json(join(folder, 'report.json')), folder, stderr: result.stderr };
}

test('a generated layout set (PADR-0047): every near miss fails in a checker process, the oracle passes, random does not, --verify passes', { timeout: 400_000 }, async () => {
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-challenge-layout-'));
  try {
    const made = run([TOOL, 'generate', 'layout', '--set', 'dev', '--count', '3', '--difficulty', 'mixed', '--out', join(dir, 'set')]);
    assert.equal(made.status, 0, made.stderr);
    const instances = await json(join(dir, 'set', 'instances.json'));
    // The family's cap is 60 actions (its artifact-level object allowance too); no task limit.
    assert.equal(instances.bench.recommended.maxActions, 60);
    for (const instance of instances.instances) assert.equal(instance.limits, undefined);
    const verified = run([TOOL, 'verify', join(dir, 'set')]);
    assert.equal(verified.status, 0, verified.stdout + verified.stderr);
    assert.match(verified.stdout, /references passed 3\/3; near misses failed (\d+)\/\1 \(separate checker processes\)/);
    const args = (instances.bench.args as string[]).slice(1);
    const oracle = await bench(['--agent', 'oracle', ...args, '--mirror', 'off']);
    assert.deepEqual(oracle.report.runs.map((value: Json) => value.pass), [true, true, true]);
    assert.equal(oracle.report.environment.world.generated[0].id, 'challenge-layout');
    const random = await bench(['--agent', 'random', ...args, '--mirror', 'off']);
    assert.deepEqual(random.report.runs.map((value: Json) => value.pass), [false, false, false]);
    for (const folder of [oracle.folder, random.folder]) {
      const checked = run([CLI, 'report', join(folder, 'report.json'), '--verify']);
      assert.equal(checked.status, 0, checked.stderr);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

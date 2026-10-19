// PADR-0049 decision 8.2: `bench --tasks drawio/…` benches the committed draw.io library (model-only here,
// so no draw.io runtime is needed); the report names draw.io at its pinned version, the library world and
// that library's references, and re-verifies against the library this Practonaut ships for draw.io.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('bench --tasks drawio/…: the draw.io library, its pinned version and references, re-verified', { timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-bench-'));
  try {
    const out = join(dir, 'report.json'), env = { ...process.env, PRACTONAUT_HOME: join(dir, 'home') };
    const run = spawnSync(process.execPath, [CLI, 'bench', '--agent', 'oracle', '--tasks', 'drawio/connect,drawio/group', '--seed-list', '0,2', '--mirror', 'off', '--out', out], { encoding: 'utf8', env, timeout: 240_000 });
    assert.equal(run.status, 0, run.stderr.slice(-2000));
    const report = JSON.parse(readFileSync(out, 'utf8')) as { schema: string; environment: { app: unknown; world: { source: string; worldId: string } }; runs: Array<{ pass: boolean }> };
    assert.deepEqual([report.schema, report.environment.app, report.environment.world.source, report.environment.world.worldId], ['practonaut.bench/3', { adapterId: 'drawio', version: '32.4.1' }, 'library', 'drawio-library']);
    assert.deepEqual(report.runs.map(entry => entry.pass), [true, true, true, true]);
    const folder = /^Run logs and artifacts: (.+)$/m.exec(run.stdout)![1]!;
    const references = JSON.parse(readFileSync(join(folder, 'references.json'), 'utf8')) as { references: Array<{ taskId: string; worldId: string; source: string }> };
    assert.deepEqual(references.references.map(entry => [entry.taskId, entry.worldId, entry.source]), [['connect', 'drawio-library', 'library'], ['group', 'drawio-library', 'library']]);
    const verified = spawnSync(process.execPath, [CLI, 'report', out, '--verify', '--runs', folder, '--json'], { encoding: 'utf8', env });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(JSON.parse(verified.stdout).verification.level, 're-verified');
    const mixed = spawnSync(process.execPath, [CLI, 'bench', '--agent', 'oracle', '--tasks', 'connect,drawio/group', '--mirror', 'off'], { encoding: 'utf8', env });
    assert.equal(mixed.status, 1); assert.match(mixed.stderr, /two libraries/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// PADR-0049 decision 8.2: `bench --tasks drawio/…` benches the committed draw.io library (model-only here,
// so no draw.io runtime is needed); the report names draw.io at its pinned version, the library world and
// that library's references, and re-verifies against the library this Practonaut ships for draw.io.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
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
    // The bench's folder under PRACTONAUT_HOME. The printed line is for people: it shows the folder in
    // display form, `~/…` when it lies under the home folder (as the temp folder does on Windows).
    const benches = readdirSync(join(dir, 'home', 'bench')), folder = join(dir, 'home', 'bench', benches[0]!);
    assert.equal(benches.length, 1);
    assert.ok(/^Run logs and artifacts: (.+)$/m.exec(run.stdout)![1]!.endsWith(basename(folder)), 'the printed line names the folder');
    const references = JSON.parse(readFileSync(join(folder, 'references.json'), 'utf8')) as { references: Array<{ taskId: string; worldId: string; source: string }> };
    assert.deepEqual(references.references.map(entry => [entry.taskId, entry.worldId, entry.source]), [['connect', 'drawio-library', 'library'], ['group', 'drawio-library', 'library']]);
    const verified = spawnSync(process.execPath, [CLI, 'report', out, '--verify', '--runs', folder, '--json'], { encoding: 'utf8', env });
    assert.equal(verified.status, 0, verified.stderr);
    const verification = JSON.parse(verified.stdout).verification as { level: string; library?: { status: string } };
    assert.equal(verification.level, 're-verified');
    // Anchored to the library this Practonaut ships for draw.io, not Excalidraw's (review m2c).
    assert.deepEqual(verification.library, { status: 'same' });
    const refusal = (reportFile: string): { code: string; message: string } => {
      const result = spawnSync(process.execPath, [CLI, 'report', reportFile, '--verify', '--runs', folder, '--json'], { encoding: 'utf8', env });
      assert.notEqual(result.status, 0, result.stdout);
      return (JSON.parse((result.stdout || result.stderr).trim()) as { error: { code: string; message: string } }).error;
    };
    // A report that names another app version than the stored world pins (review m2c).
    const versioned = structuredClone(report) as typeof report & { environment: { app: { version: string } } };
    versioned.environment.app.version = '0.18.1';
    writeFileSync(join(dir, 'version.json'), JSON.stringify(versioned));
    const wrongVersion = refusal(join(dir, 'version.json'));
    assert.equal(wrongVersion.code, 'bench_world_changed'); assert.match(wrongVersion.message, /0\.18\.1.*32\.4\.1/);
    // References that are not the draw.io library's own, with the report's hash of them updated.
    const referencesFile = join(folder, 'references.json'), stored = JSON.parse(readFileSync(referencesFile, 'utf8')) as { references: Array<{ taskId: string; steps: Array<{ params: Record<string, unknown> }> }> };
    const connect = stored.references.find(entry => entry.taskId === 'connect')!.steps[0]!.params;
    [connect.from, connect.to] = [connect.to, connect.from];
    const tampered = JSON.stringify(stored);
    writeFileSync(referencesFile, tampered);
    const rebound = JSON.parse(readFileSync(out, 'utf8')) as { references: { sha256: string } };
    rebound.references.sha256 = createHash('sha256').update(tampered).digest('hex');
    writeFileSync(join(dir, 'references.json'), JSON.stringify(rebound));
    const wrongReference = refusal(join(dir, 'references.json'));
    assert.equal(wrongReference.code, 'bench_reference_invalid'); assert.match(wrongReference.message, /connect is not the reference solution of the library this Practonaut ships/);
    const mixed = spawnSync(process.execPath, [CLI, 'bench', '--agent', 'oracle', '--tasks', 'connect,drawio/group', '--mirror', 'off'], { encoding: 'utf8', env });
    assert.equal(mixed.status, 1); assert.match(mixed.stderr, /two libraries/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

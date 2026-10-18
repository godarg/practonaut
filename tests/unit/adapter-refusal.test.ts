// PADR-0045: a world naming an application this Practonaut does not have is refused by name before
// anything starts — at world validation (`validate`, `pack`, every loader), at `play`/`serve`, and in
// the checker process — with E_ADAPTER_UNKNOWN, E_ADAPTER_VERSION_UNSUPPORTED or
// E_ADAPTER_SCHEMA_UNSUPPORTED instead of a generic schema error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_APPS, checkWorldApp } from '../../src/world/apps.ts';
import { validateWorld, WorldError } from '../../src/world/schema.ts';
import { checkSubmission, CheckerError } from '../../src/checker/index.ts';
import { checkInProcess, RuntimeError } from '../../src/cli/runtime.ts';
import { packWorld, packWorldWithManifest } from '../../src/package/packer.ts';
import { readWorldPackage } from '../../src/package/reader.ts';
import { loadWorldPackage } from '../../src/world/index.ts';
import { worldContentHash } from '../../src/bench/world.ts';
import { LIBRARY_WORLD_DIR } from '../../src/library/index.ts';
import { generateSet } from '../../src/challenge/build.ts';
import { v2World } from '../support/world-v2.ts';
import type { World } from '../../src/world/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const FLOW = join(root, 'examples/worlds/flow-diagram');
const flowRaw = (): Record<string, any> => JSON.parse(readFileSync(join(FLOW, 'world.json'), 'utf8'));
const code = (expected: string) => (error: unknown): boolean => {
  assert.equal((error as { code?: unknown }).code, expected, String(error)); return true;
};

test('world validation refuses an application this Practonaut does not have by name, before the schema runs', () => {
  const drawio = flowRaw(); drawio.app.adapterId = 'drawio';
  assert.throws(() => validateWorld(drawio), (error: unknown) => error instanceof WorldError && error.code === 'E_ADAPTER_UNKNOWN' && /"drawio"/.test(error.message) && /excalidraw/.test(error.message));
  // Named even when the rest of the world is something only that app would understand.
  const foreign = flowRaw(); foreign.app = { adapterId: 'drawio', versionRange: '32.4.1', pageSize: 'A4' }; foreign.tasks = 'not a list';
  assert.throws(() => validateWorld(foreign), code('E_ADAPTER_UNKNOWN'));
  const version = flowRaw(); version.app.versionRange = '0.19.0';
  assert.throws(() => validateWorld(version), code('E_ADAPTER_VERSION_UNSUPPORTED'));
  const provenance = flowRaw(); provenance.provenance.appVersion = '0.17.0';
  assert.throws(() => validateWorld(provenance), (error: unknown) => (error as WorldError).code === 'E_ADAPTER_VERSION_UNSUPPORTED' && /provenance\.appVersion/.test(String(error)));
  assert.throws(() => v2World({ app: { adapterId: 'drawio', versionRange: '32.4.1' } }), code('E_ADAPTER_UNKNOWN'));
  // Prototype names are not applications.
  for (const id of ['constructor', '__proto__', 'toString']) { const proto = flowRaw(); proto.app.adapterId = id; assert.throws(() => validateWorld(proto), code('E_ADAPTER_UNKNOWN'), id); }
  // Shapes the pre-check does not read stay ordinary schema errors.
  const missing = flowRaw(); delete missing.app;
  assert.throws(() => validateWorld(missing), code('E_WORLD_INVALID'));
  const numeric = flowRaw(); numeric.app.adapterId = 7;
  assert.throws(() => validateWorld(numeric), code('E_WORLD_INVALID'));
});

test('a stub adapter that runs world/2 only is refused in a world/1 by name', () => {
  // Test-only stub table: an adapter that runs world/2 only, as draw.io will (Must 2).
  const apps = { ...KNOWN_APPS, stub: { appVersions: ['1.0.0'], schemas: ['practonaut.world/2'] as const } };
  const world1 = flowRaw(); world1.app.adapterId = 'stub'; world1.app.versionRange = '1.0.0'; world1.provenance.appVersion = '1.0.0';
  assert.throws(() => checkWorldApp(world1, apps), (error: unknown) => error instanceof WorldError && error.code === 'E_ADAPTER_SCHEMA_UNSUPPORTED' && /"stub"/.test(error.message) && /practonaut\.world\/1/.test(error.message));
  assert.doesNotThrow(() => checkWorldApp({ ...world1, schema: 'practonaut.world/2' }, apps));
});

test('world/2 fills an omitted provenance.appVersion from app.versionRange', () => {
  const world = v2World();
  assert.equal(world.provenance.appVersion, '0.18.1');
  assert.deepEqual(validateWorld(structuredClone(world)), world, 'a validated world validates to itself');
});

test('content hashes recorded by earlier releases are unchanged, with and without provenance.appVersion', async () => {
  // Recorded by others, not computed here: the 0.1.0 example report names the library world's
  // hash, and the 0.2.0 repair gate declaration names its development world's (a world the
  // generator builds without provenance.appVersion, so it holds the default).
  const report = JSON.parse(readFileSync(join(root, 'docs/benchmarks/example-report.json'), 'utf8'));
  const library = loadWorldPackage(await readWorldPackage(await packWorld(LIBRARY_WORLD_DIR)));
  assert.equal(worldContentHash(library), report.environment.library.contentHash);
  const source = JSON.parse(readFileSync(join(LIBRARY_WORLD_DIR, 'world.json'), 'utf8'));
  delete source.provenance.appVersion;
  assert.equal(worldContentHash(validateWorld(source)), report.environment.library.contentHash, 'the default gives the hash an explicit 0.18.1 gave');
  const declaration = JSON.parse(readFileSync(join(root, 'docs/benchmarks/challenge/repair-round-1.declaration.json'), 'utf8'));
  const development = generateSet('repair', declaration.development.seeds, declaration.difficulty, 'dev').world;
  assert.equal(development.id, declaration.development.world.id);
  assert.equal(worldContentHash(development), declaration.development.world.contentHash);
});

test('the checker reads exports through its own format table and refuses an adapter it has no parser for', () => {
  const world = validateWorld(flowRaw());
  const native = JSON.stringify({ type: 'excalidraw', version: 2, files: {}, elements: [] });
  // An unvalidated world given to the API directly: the format table refuses it by name.
  assert.throws(() => checkSubmission({ ...world, app: { ...world.app, adapterId: 'drawio' } } as unknown as World, native, { seed: 0, taskId: world.tasks[0]!.id }), (error: unknown) => error instanceof CheckerError && error.code === 'E_ADAPTER_UNKNOWN');
  // The world's own format is the only native format accepted (an empty drawing is judged, and fails).
  assert.equal(checkSubmission(world, native, { seed: 0, taskId: world.tasks[0]!.id, format: 'excalidraw' }).passed, false);
  assert.throws(() => checkSubmission(world, native, { seed: 0, taskId: world.tasks[0]!.id, format: 'drawio' as never }), (error: unknown) => error instanceof CheckerError && error.code === 'artifact_invalid' && /drawio/.test(error.message));
});

test('the checker process answers a world naming an unknown adapter with the named code', { timeout: 60_000 }, async () => {
  const world = flowRaw(); world.app.adapterId = 'drawio';
  const request = JSON.stringify({ world, input: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], files: {} }), options: { seed: 0 } });
  const child = spawnSync(process.execPath, [join(root, 'src/checker/main.ts')], { input: request, encoding: 'utf8', timeout: 30_000 });
  assert.equal(child.status, 1, child.stderr);
  const reply = JSON.parse(child.stdout.trim());
  assert.equal(reply.ok, false); assert.equal(reply.error.code, 'E_ADAPTER_UNKNOWN'); assert.match(reply.error.message, /drawio/);
  // The CLI's process boundary admits the named code instead of folding it into checker_invalid.
  await assert.rejects(checkInProcess(world as unknown as World, JSON.stringify({ type: 'excalidraw', version: 2, elements: [], files: {} }), { seed: 0 }), (error: unknown) => error instanceof RuntimeError && error.code === 'E_ADAPTER_UNKNOWN');
  const version = flowRaw(); version.app.versionRange = '0.19.0';
  const versionChild = spawnSync(process.execPath, [join(root, 'src/checker/main.ts')], { input: JSON.stringify({ world: version, input: '{}', options: { seed: 0 } }), encoding: 'utf8', timeout: 30_000 });
  assert.equal(JSON.parse(versionChild.stdout.trim()).error.code, 'E_ADAPTER_VERSION_UNSUPPORTED');
  // A malformed world keeps the checker's own code.
  const broken = flowRaw(); delete broken.app;
  const brokenChild = spawnSync(process.execPath, [join(root, 'src/checker/main.ts')], { input: JSON.stringify({ world: broken, input: '{}', options: { seed: 0 } }), encoding: 'utf8', timeout: 30_000 });
  assert.equal(JSON.parse(brokenChild.stdout.trim()).error.code, 'checker_invalid');
});

test('validate, pack and play refuse a world naming an unknown adapter by name, before any browser check', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-adapter-refusal-'));
  try {
    const source = join(dir, 'drawio'); cpSync(FLOW, source, { recursive: true });
    const raw = flowRaw(); raw.app.adapterId = 'drawio'; writeFileSync(join(source, 'world.json'), JSON.stringify(raw));
    // An empty browser directory: a command that checked or started Chromium first would answer
    // browser_runtime_missing (exit 3) instead of the world's refusal (exit 2).
    const browsers = join(dir, 'no-browsers');
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'src/cli/main.ts'), ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000, input: '', env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers } });
    const refused = (result: ReturnType<typeof cli>, label: string, expected = 'E_ADAPTER_UNKNOWN', named = /drawio/): void => {
      assert.equal(result.status, 2, `${label}: ${result.stdout}${result.stderr}`);
      const reply = JSON.parse((result.stdout || result.stderr).trim());
      assert.equal(reply.ok, false, label); assert.equal(reply.error.code, expected, label); assert.match(reply.error.message, named, label);
    };
    const versioned = join(dir, 'excalidraw-0.19'); cpSync(FLOW, versioned, { recursive: true });
    const other = flowRaw(); other.app.versionRange = '0.19.0'; writeFileSync(join(versioned, 'world.json'), JSON.stringify(other));
    refused(cli('play', versioned, '--mirror', 'required', '--no-open', '--json'), 'play version', 'E_ADAPTER_VERSION_UNSUPPORTED', /0\.19\.0/);
    refused(cli('pack', source, '--out', join(dir, 'drawio.pnworld'), '--json'), 'pack');
    // The archive primitive lets the test build the package the packer refuses to write.
    const archive = join(dir, 'drawio-built.pnworld'); writeFileSync(archive, (await packWorldWithManifest(source)).bytes);
    refused(cli('validate', archive, '--json'), 'validate');
    refused(cli('play', archive, '--mirror', 'required', '--no-open', '--json'), 'play package');
    refused(cli('play', source, '--mirror', 'required', '--no-open', '--json'), 'play');
    refused(cli('play', source, '--mirror', 'auto', '--no-open', '--json'), 'play auto');
    // mcp --task keeps stdout for JSON-RPC: the named refusal goes to stderr, with exit 2.
    const mcp = cli('mcp', '--task', source, '--mirror', 'required', '--json');
    assert.equal(mcp.stdout, '', 'nothing on the JSON-RPC channel');
    refused(mcp, 'mcp --task');
    // Control: a known world with the same empty browser directory does reach the browser check.
    const control = cli('play', FLOW, '--mirror', 'required', '--no-open', '--json');
    assert.equal(control.status, 3, control.stdout + control.stderr);
    assert.equal(JSON.parse((control.stdout || control.stderr).trim()).error.code, 'browser_runtime_missing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

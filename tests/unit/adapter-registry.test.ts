// PADR-0045: adapters are chosen by the world's app through one registry. The registry, the world's
// table of known apps and the checker's format table name the same adapters; the registry refuses an
// app it does not have by name and starts nothing for it (the world-side refusal is in
// adapter-refusal.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePracticeSource } from '../../src/cli/serve.ts';
import { commandRun } from '../../src/cli/runtime.ts';
import { packWorld } from '../../src/package/packer.ts';
import { fileURLToPath } from 'node:url';
import { ADAPTER_REGISTRY, EXCALIDRAW_APP, resolveAdapter, type AdapterRegistry } from '../../src/adapters/registry.ts';
import { KNOWN_APPS } from '../../src/world/apps.ts';
import { WorldError } from '../../src/world/schema.ts';
import { NATIVE_FORMATS } from '../../src/checker/index.ts';
import { createPracticeMirror } from '../../src/host/mirror.ts';
import { v2World } from '../support/world-v2.ts';
import type { World } from '../../src/world/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const code = (expected: string) => (error: unknown): boolean => {
  assert.equal((error as { code?: unknown }).code, expected, String(error)); return true;
};
const sorted = (values: readonly string[]): string[] => [...values].sort();

test('the registry, the world table and the checker format table name the same adapters, versions and schemas', () => {
  assert.deepEqual(sorted(Object.keys(ADAPTER_REGISTRY)), sorted(Object.keys(KNOWN_APPS)));
  assert.deepEqual(sorted(Object.keys(NATIVE_FORMATS)), sorted(Object.keys(ADAPTER_REGISTRY)));
  for (const [id, entry] of Object.entries(ADAPTER_REGISTRY)) {
    const known = KNOWN_APPS[id as keyof typeof KNOWN_APPS];
    assert.equal(entry.id, id); assert.equal(NATIVE_FORMATS[id as keyof typeof NATIVE_FORMATS].id, id);
    assert.deepEqual(sorted(entry.appVersions), sorted(known.appVersions), id);
    assert.deepEqual(sorted(entry.schemas), sorted(known.schemas), id);
    assert.ok(['bundled', 'downloaded'].includes(entry.runtime), id);
    assert.ok(['full', 'live'].includes(entry.readBack), id);
  }
});

test('Excalidraw is registered at the pinned package version, bundled, with the full read-back comparison', () => {
  // Expected values from package.json (the pinned devDependency) and PADR-0045, not from the registry.
  const pinned = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['@excalidraw/excalidraw'];
  const entry = resolveAdapter(EXCALIDRAW_APP, 'practonaut.world/1');
  assert.deepEqual([...entry.appVersions], [pinned]);
  assert.deepEqual(sorted(entry.schemas), ['practonaut.world/1', 'practonaut.world/2']);
  assert.equal(entry.runtime, 'bundled'); assert.equal(entry.readBack, 'full');
  assert.equal(resolveAdapter(EXCALIDRAW_APP, 'practonaut.world/2'), entry);
});

test('draw.io is registered at the pinned release, downloaded, compared on live objects, world/2 only', () => {
  // Expected values from the spike's committed pin (spikes/drawio/pin.json) and PADR-0049 decision 1.1.
  const pin = JSON.parse(readFileSync(join(root, 'spikes/drawio/pin.json'), 'utf8')) as { tag: string; size: number; sha256: string };
  const entry = resolveAdapter({ adapterId: 'drawio', versionRange: pin.tag.slice(1) }, 'practonaut.world/2');
  assert.deepEqual([...entry.appVersions], [pin.tag.slice(1)]);
  assert.deepEqual([...entry.schemas], ['practonaut.world/2']);
  assert.equal(entry.runtime, 'downloaded'); assert.equal(entry.readBack, 'live');
  assert.throws(() => resolveAdapter({ adapterId: 'drawio', versionRange: pin.tag.slice(1) }, 'practonaut.world/1'), code('E_ADAPTER_SCHEMA_UNSUPPORTED'));
  assert.throws(() => resolveAdapter({ adapterId: 'drawio', versionRange: '0.18.1' }, 'practonaut.world/2'), code('E_ADAPTER_VERSION_UNSUPPORTED'));
  assert.equal(NATIVE_FORMATS.drawio.extension, '.drawio');
});

test('the registry refuses an unknown adapter, an unknown version and an unsupported schema by name, without creating anything', () => {
  let created = 0;
  const create = async (): Promise<never> => { created++; throw new Error('must not start'); };
  // Test-only stub: an adapter that runs world/2 only, as draw.io does.
  const stubbed: AdapterRegistry = { ...ADAPTER_REGISTRY, stub: { id: 'excalidraw', appVersions: ['1.0.0'] as never, schemas: ['practonaut.world/2'], runtime: 'downloaded', readBack: 'live', sandbox: 'required', create } };
  assert.throws(() => resolveAdapter({ adapterId: 'bpmnjs', versionRange: '18.0.0' }, 'practonaut.world/2', stubbed), code('E_ADAPTER_UNKNOWN'));
  assert.throws(() => resolveAdapter({ adapterId: 'bpmnjs', versionRange: '18.0.0' }, 'practonaut.world/2'), (error: unknown) => error instanceof WorldError && error.code === 'E_ADAPTER_UNKNOWN' && /"bpmnjs"/.test(error.message));
  assert.throws(() => resolveAdapter({ adapterId: 'excalidraw', versionRange: '0.19.0' }, 'practonaut.world/1'), code('E_ADAPTER_VERSION_UNSUPPORTED'));
  assert.throws(() => resolveAdapter({ adapterId: 'stub', versionRange: '1.0.0' }, 'practonaut.world/1', stubbed), (error: unknown) => error instanceof WorldError && error.code === 'E_ADAPTER_SCHEMA_UNSUPPORTED' && /"stub"/.test(error.message));
  assert.equal(resolveAdapter({ adapterId: 'stub', versionRange: '1.0.0' }, 'practonaut.world/2', stubbed).runtime, 'downloaded');
  // Prototype names are not adapters.
  for (const id of ['constructor', '__proto__', 'toString']) assert.throws(() => resolveAdapter({ adapterId: id, versionRange: '0.18.1' }, 'practonaut.world/2'), code('E_ADAPTER_UNKNOWN'));
  assert.equal(created, 0);
});

test('play, serve, mcp --task and run ask the registry themselves: a world it lacks is refused by name', async () => {
  // World validation knows Excalidraw; this registry does not. Only the entry points' own registry
  // lookup can refuse, before any browser check (run with --mirror off would otherwise succeed).
  const empty: AdapterRegistry = {};
  const flow = join(root, 'examples/worlds/flow-diagram');
  await assert.rejects(resolvePracticeSource(flow, undefined, empty), code('E_ADAPTER_UNKNOWN'));
  await assert.rejects(resolvePracticeSource('excalidraw/connect', undefined, empty), code('E_ADAPTER_UNKNOWN'));
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pn-registry-entry-'));
  try {
    const world = join(dir, 'flow.pnworld'), actions = join(dir, 'actions.json');
    await writeFile(world, await packWorld(flow)); await writeFile(actions, '[]');
    await assert.rejects(commandRun([world, '--seed', '1', '--actions', actions, '--mirror', 'off'], empty), code('E_ADAPTER_UNKNOWN'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the mirror factory refuses an unknown app by name before it starts a browser', async () => {
  const world = v2World();
  const unknown = { ...world, app: { ...world.app, adapterId: 'bpmnjs' } } as unknown as World;
  await assert.rejects(createPracticeMirror(world.initialState, unknown), code('E_ADAPTER_UNKNOWN'));
});

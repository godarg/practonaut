// PADR-0049 decision 6.8 (review m4, r4-run-export-mode-untested): `practonaut run --export` reads the
// adapter's native file as its own export, so a draw.io run that ends in a legal state with two steps
// overlapping writes its three files instead of failing as a pair mismatch. The draw.io registration's
// adapter is a stand-in whose native file is the adapter's writer output (no draw.io runtime needed);
// the start check still launches the cached Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandRun } from '../../src/cli/runtime.ts';
import { ADAPTER_REGISTRY, type AdapterRegistry } from '../../src/adapters/registry.ts';
import { freshMemory, modelXml, writeCells } from '../../src/adapters/drawio/writer.ts';
import { sha256Hex } from '../../src/canonical/index.ts';
import { loadLibraryOf, taskWorld } from '../../src/library/index.ts';
import { packWorld } from '../../src/package/index.ts';
import type { MirrorAdapter } from '../../src/adapters/types.ts';
import type { State } from '../../src/world/types.ts';

function writerAdapter(initial: State): MirrorAdapter {
  let state = structuredClone(initial);
  const unused = async (): Promise<never> => { throw new Error('unused'); };
  return {
    describe: () => { throw new Error('unused'); }, snapshot: async () => structuredClone(state), restoreState: unused, importArtifact: unused,
    apply: async transition => { state = structuredClone(transition.after); return { ok: true, state: structuredClone(state), warnings: [] }; },
    exportArtifact: async () => {
      const native = `<mxfile host="test"><diagram id="p" name="Page-1">${modelXml(writeCells(state, freshMemory()))}</diagram></mxfile>`, svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>';
      return { native, svg, nativeSha256: sha256Hex(native), svgSha256: sha256Hex(svg) };
    },
    renderPng: async () => new Uint8Array(), networkAttempts: () => [], terminate: async () => undefined, close: async () => undefined,
  };
}

test('run --export on draw.io writes the pair of a legal state whose steps overlap', { timeout: 120_000 }, async () => {
  const { world, library } = loadLibraryOf('drawio');
  const recolor = library.tasks.find(task => task.id === 'recolor')!, seed = recolor.oracle.seeds.drawn!;
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-run-export-'));
  // Only the run's one result line is kept from stdout; the test runner's own output passes through.
  const write = process.stdout.write.bind(process.stdout);
  let line = '';
  try {
    const source = join(dir, 'world'); mkdirSync(source);
    writeFileSync(join(source, 'world.json'), JSON.stringify(taskWorld(world, 'recolor')));
    writeFileSync(join(dir, 'world.pnworld'), await packWorld(source));
    // The library's reference, then Payment failed moved onto Checkout: legal, and the goal still holds.
    writeFileSync(join(dir, 'actions.json'), JSON.stringify([...recolor.oracle.steps.map(step => ({ name: step.name, params: step.params })), { name: 'move_step', params: { id: 'b', x: 200, y: 200 } }]));
    const registry: AdapterRegistry = { ...ADAPTER_REGISTRY, drawio: { ...ADAPTER_REGISTRY.drawio, runtime: 'bundled', sandbox: 'linux-fallback', create: async state => writerAdapter(state) } };
    process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => { if (typeof chunk === 'string' && /^{\s*"ok": true/.test(chunk)) { line += chunk; return true; } return (write as (...args: unknown[]) => boolean)(chunk, ...rest); }) as typeof process.stdout.write;
    const prefix = join(dir, 'result');
    const code = await commandRun([join(dir, 'world.pnworld'), '--seed', String(seed), '--task', 'recolor', '--actions', join(dir, 'actions.json'), '--export', prefix], registry);
    process.stdout.write = write;
    assert.equal(code, 0);
    for (const file of ['result.drawio', 'result.svg', 'result.session.json']) assert.ok(existsSync(join(dir, file)), file);
    assert.match(readFileSync(join(dir, 'result.drawio'), 'utf8'), /^<mxfile/);
    assert.equal((JSON.parse(line) as { exported?: { native: string } }).exported?.native, `${prefix}.drawio`);
  } finally { process.stdout.write = write; rmSync(dir, { recursive: true, force: true }); }
});

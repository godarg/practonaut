// PADR-0049 decision 10.1: a draw.io world's native file is `practonaut.drawio` (Player export,
// `run --export`), `check` reads it as XML with or without `--pair`, and the Player's editor and author
// workspaces (which embed Excalidraw) are not offered for it. The native fixture is written by the
// adapter's writer from the core's state; the verdict comes from the checker's own reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packWorld, readWorldPackage } from '../../src/package/index.ts';
import { loadWorldPackage } from '../../src/world/index.ts';
import { Session } from '../../src/core/index.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { buildExportEnvelope, nativeFileName } from '../../src/host/export-pair.ts';
import { NATIVE_FORMATS } from '../../src/checker/index.ts';
import { NATIVE_FILES } from '../../src/player/export.ts';
import { ADAPTER_REGISTRY } from '../../src/adapters/registry.ts';
import { freshMemory, modelXml, writeCells } from '../../src/adapters/drawio/writer.ts';
import type { Action } from '../../src/world/types.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const library = JSON.parse(readFileSync(join(root, 'tasks/excalidraw/world/world.json'), 'utf8')) as Record<string, unknown>;
const drawioRaw = { ...library, id: 'drawio-export-test', app: { adapterId: 'drawio', versionRange: '32.4.1' }, provenance: { ...(library.provenance as object), appVersion: '32.4.1' } };

test('each app\'s native file: practonaut.excalidraw and practonaut.drawio, the same in the host, the CLI and the Player', () => {
  assert.deepEqual(Object.fromEntries(Object.keys(NATIVE_FORMATS).map(id => [id, nativeFileName({ adapterId: id } as never)])), { excalidraw: 'practonaut.excalidraw', drawio: 'practonaut.drawio' });
  assert.deepEqual(Object.fromEntries(Object.entries(NATIVE_FILES).map(([id, file]) => [id, file.name])), { excalidraw: 'practonaut.excalidraw', drawio: 'practonaut.drawio' });
  assert.equal(NATIVE_FILES.drawio!.type, 'application/vnd.jgraph.mxfile');
  // The editor and author workspaces embed Excalidraw: offered for Excalidraw worlds only.
  assert.deepEqual([ADAPTER_REGISTRY.excalidraw.editor, ADAPTER_REGISTRY.drawio.editor], [true, false]);
});

test('check reads a draw.io export as XML: bound by --pair, or unbound with --seed and --task; refusals name draw.io', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-export-'));
  try {
    const source = join(dir, 'world'); mkdirSync(source);
    writeFileSync(join(source, 'world.json'), JSON.stringify(drawioRaw));
    const bytes = await packWorld(source);
    const world = loadWorldPackage(await readWorldPackage(bytes));
    const session = new Session(world, 7, 'connect');
    const step = loadLibrary().library.tasks.find(task => task.id === 'connect')!.oracle.steps[0]!;
    assert.equal(session.act({ name: step.name, params: step.params } as Action).ok, true);
    const native = `<mxfile host="test"><diagram id="p" name="Page-1">${modelXml(writeCells(session.state, freshMemory()))}</diagram></mxfile>`;
    const envelope = buildExportEnvelope(session.serialize(), 1, native, world.app);
    assert.equal(envelope.native.file, 'practonaut.drawio');
    const paths = { world: join(dir, 'w.pnworld'), native: join(dir, 'result.drawio'), pair: join(dir, 'result.session.json'), excalidraw: join(dir, 'x.excalidraw') };
    writeFileSync(paths.world, bytes); writeFileSync(paths.native, native); writeFileSync(paths.pair, envelope.session.utf8);
    writeFileSync(paths.excalidraw, JSON.stringify({ type: 'excalidraw', version: 2, source: 'x', elements: [], appState: {}, files: {} }));
    const check = (...args: string[]) => spawnSync(process.execPath, [join(root, 'src/cli/main.ts'), 'check', ...args, '--world', paths.world], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
    const paired = check(paths.native, '--pair', paths.pair);
    assert.equal(paired.status, 0, paired.stdout + paired.stderr);
    assert.deepEqual([JSON.parse(paired.stdout).passed, JSON.parse(paired.stdout).binding.kind], [true, 'export-pair']);
    const manual = check(paths.native, '--seed', '7', '--task', 'connect');
    assert.equal(manual.status, 0, manual.stdout + manual.stderr);
    assert.equal(JSON.parse(manual.stdout).binding.kind, 'manual-unbound');
    const unrouted = check(paths.native);
    assert.equal(unrouted.status, 2); assert.match(unrouted.stdout + unrouted.stderr, /--seed and --task/);
    const foreign = check(paths.excalidraw, '--pair', paths.pair);
    assert.equal(foreign.status, 2); assert.match(foreign.stdout + foreign.stderr, /native draw\.io artifact/);
    // The start state, exported the same way, fails.
    const start = new Session(world, 7, 'connect');
    writeFileSync(paths.native, `<mxfile><diagram id="p">${modelXml(writeCells(start.state, freshMemory()))}</diagram></mxfile>`);
    const failing = check(paths.native, '--seed', '7', '--task', 'connect');
    assert.equal(failing.status, 2, failing.stdout + failing.stderr); assert.equal(JSON.parse(failing.stdout).passed, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

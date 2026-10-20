// PADR-0049 decision 6.8 (review m3, r3-paint-honest-states-refused): each caller reads a .drawio file in
// the mode that says what it is. The host's own export of a legal state in which two steps overlap (the
// review's first state: recolor solved, then Payment failed moved onto Checkout) is exported and judged as
// the session is; the same pair checked from outside the session (`practonaut check --pair`) is refused by
// name. The mirror here is a stand-in whose native file is the adapter's writer output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLibraryOf, taskWorld } from '../../src/library/index.ts';
import { createPracticeController } from '../../src/host/session.ts';
import type { PracticeMirror } from '../../src/host/mirror.ts';
import type { CurrentSessionExport } from '../../src/host/export-pair.ts';
import { freshMemory, modelXml, writeCells } from '../../src/adapters/drawio/writer.ts';
import { CLOSED } from '../../src/adapters/browser/close.ts';
import { checkInProcess, RuntimeError } from '../../src/cli/runtime.ts';
import { packWorld } from '../../src/package/index.ts';
import type { Action, State } from '../../src/world/types.ts';

const { world, library } = loadLibraryOf('drawio');
const entry = library.tasks.find(task => task.id === 'recolor')!, slice = taskWorld(world, 'recolor'), seed = entry.oracle.seeds.drawn!;
const xmlOf = (state: State): string => `<mxfile host="test"><diagram id="p" name="Page-1">${modelXml(writeCells(state, freshMemory()))}</diagram></mxfile>`;
function writerMirror(initial: State): PracticeMirror {
  let state = structuredClone(initial);
  const confirmed = (next: State) => { state = structuredClone(next); return { ok: true as const, state: structuredClone(next), warnings: [] }; };
  return { readBack: 'live', apply: async transition => confirmed(transition.after), replace: async next => confirmed(next), snapshot: async () => structuredClone(state),
    png: async () => new Uint8Array(), exportNative: async () => xmlOf(state), recover: async next => { state = structuredClone(next); }, close: async () => CLOSED };
}
/** recolor solved by its reference, then step b moved onto step a: legal, and the goal still holds. */
async function overlappingExport(): Promise<CurrentSessionExport> {
  const controller = await createPracticeController(slice, { seed, taskId: 'recolor', mirror: 'required' }, async state => writerMirror(state));
  try {
    for (const step of [...entry.oracle.steps, { name: 'move_step', params: { id: 'b', x: 200, y: 200 } }] as Action[]) {
      assert.equal((await controller.act({ expectedRevision: controller.view().revision, action: { name: step.name, params: step.params } })).ok, true, JSON.stringify(step));
    }
    const exported = await controller.export({ expectedRevision: controller.view().revision });
    assert.ok(exported.ok, `the host refused its own export: ${JSON.stringify(exported)}`);
    return exported.value;
  } finally { await controller.close(); }
}

test('the host exports its own draw.io export of a legal overlapping state, and the bench\'s checker judges it as the session', async () => {
  const exported = await overlappingExport();
  // The bench's native verdict (src/bench/run.ts) and `report --verify` (src/bench/verify.ts) read it as an own export.
  const own = await checkInProcess(slice, exported.native.utf8, { seed: exported.seed, taskId: 'recolor', reading: 'own-export' });
  assert.equal(own.passed, true, 'the solved state with b moved onto a still meets the goal');
  // Without saying so, the checker reads it as a file from outside a session and refuses it by name.
  await assert.rejects(checkInProcess(slice, exported.native.utf8, { seed: exported.seed, taskId: 'recolor' }), (error: unknown) => error instanceof RuntimeError && error.code === 'artifact_invalid' && /artifact_invalid: boxes_overlap/.test(error.message));
});

test('`practonaut check --pair` reads the pair from outside the session in submission mode and names the refusal', { timeout: 120_000 }, async () => {
  const exported = await overlappingExport();
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'pn-drawio-modes-'));
  try {
    const source = join(dir, 'world'); mkdirSync(source);
    writeFileSync(join(source, 'world.json'), JSON.stringify(slice));
    writeFileSync(join(dir, 'world.pnworld'), await packWorld(source));
    writeFileSync(join(dir, 'result.drawio'), exported.native.utf8);
    writeFileSync(join(dir, 'result.session.json'), exported.session.utf8);
    const cli = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
    const checked = spawnSync(process.execPath, [cli, 'check', join(dir, 'result.drawio'), '--world', join(dir, 'world.pnworld'), '--pair', join(dir, 'result.session.json')], { encoding: 'utf8' });
    assert.notEqual(checked.status, 0);
    assert.match(checked.stdout + checked.stderr, /artifact_invalid: boxes_overlap/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

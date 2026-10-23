// PADR-0049 decision 6.8 (review m3, r3-paint-honest-states-refused): a draw.io bench run that solves its
// task in a legal state with overlapping steps is judged, not turned into infra_error. The run's own host
// exports the app's file, the bench judges it as an own export, and `report --verify` re-judges it the
// same way. The mirror is a stand-in whose native file is the adapter's writer output (the bench's test
// seam), so no draw.io runtime is needed; the agent is the scripted command agent, no language model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBench } from '../../src/bench/run.ts';
import { resolveAgent } from '../../src/bench/agents.ts';
import { libraryBenchWorld, libraryReferences } from '../../src/bench/world.ts';
import { loadLibraryOf } from '../../src/library/index.ts';
import { freshMemory, modelXml, writeCells } from '../../src/adapters/drawio/writer.ts';
import { CLOSED } from '../../src/adapters/browser/close.ts';
import type { PracticeMirror } from '../../src/host/mirror.ts';
import type { State } from '../../src/world/types.ts';

const CLI = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const AGENT = fileURLToPath(new URL('../support/bench-agent.ts', import.meta.url));
function writerMirror(initial: State): PracticeMirror {
  let state = structuredClone(initial);
  const confirmed = (next: State) => { state = structuredClone(next); return { ok: true as const, state: structuredClone(next), warnings: [] }; };
  return { readBack: 'live', apply: async transition => confirmed(transition.after), replace: async next => confirmed(next), snapshot: async () => structuredClone(state), png: async () => new Uint8Array(),
    exportNative: async () => `<mxfile host="test"><diagram id="p" name="Page-1">${modelXml(writeCells(state, freshMemory()))}</diagram></mxfile>`, recover: async next => { state = structuredClone(next); }, close: async () => CLOSED };
}

test('a draw.io bench run solved in a legal overlapping state is judged and re-verified, not infra_error', { timeout: 300_000 }, async () => {
  const recolor = loadLibraryOf('drawio').library.tasks.find(task => task.id === 'recolor')!;
  const dir = await mkdtemp(join(realpathSync(tmpdir()), 'pn-drawio-bench-'));
  try {
    // The library's reference, then step b moved onto step a: the goal still holds.
    const script = join(dir, 'script.json');
    await writeFile(script, JSON.stringify({ recolor: { steps: [...recolor.oracle.steps.map(step => ({ act: step.name, params: step.params })), { act: 'move_step', params: { id: 'b', x: 200, y: 200 } }, { check: true }] } }));
    process.env.PN_TEST_AGENT_SCRIPT = script;
    const bench = await runBench({ seeds: [recolor.oracle.seeds.drawn!], repeats: 1, timeoutSeconds: 60, maxActions: 50, mirrorRequested: 'required', mirror: 'required', world: await libraryBenchWorld('drawio'), references: libraryReferences(['recolor'], 'drawio'), tasks: ['recolor'],
      agent: resolveAgent(`${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} script {mcp_config}`), mirrorFactory: async state => writerMirror(state) });
    const run = bench.report!.runs[0]!;
    assert.equal(run.status, 'completed', `${run.status}: ${run.note ?? ''}`);
    assert.equal(run.pass, true);
    assert.notEqual(run.artifacts?.native ?? null, null, 'the native file was judged');
    const report = join(bench.directory, 'report.json');
    await writeFile(report, JSON.stringify(bench.report));
    const verified = spawnSync(process.execPath, [CLI, 'report', report, '--verify', '--runs', bench.directory], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    await rm(bench.directory, { recursive: true, force: true });
  } finally { delete process.env.PN_TEST_AGENT_SCRIPT; await rm(dir, { recursive: true, force: true }); }
});

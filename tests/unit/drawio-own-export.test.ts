// PADR-0049 decision 6.8 (review m3, r3-paint-honest-states-refused): in `own-export` mode the checker's
// reader reads every legal state the adapter writes, as that state. Random legal play from every start of
// the draw.io library (each task, each of its three variant seeds): moves, resizes, restyles, frame
// changes, renames, additions, deletions, connections, rewiring and grouping, with labels that hold
// markup characters, line feeds, tabs, spaces at either end and non-Latin letters. The core decides
// what is legal; each accepted state is written by the adapter's writer with the memory it carries, as
// the adapter does, and must read back as exactly the live state. The PRNG seed is fixed, so the run is
// the same everywhere. The same states in `submission` mode are counted, not asserted: that mode refuses
// overlap on purpose.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../../src/core/index.ts';
import { loadLibraryOf, taskWorld } from '../../src/library/index.ts';
import { freshMemory, modelXml, writeCells } from '../../src/adapters/drawio/writer.ts';
import { parseDrawio } from '../../src/checker/drawio.ts';
import { CheckerError } from '../../src/checker/errors.ts';
import { canonicalJson } from '../../src/canonical/index.ts';
import type { Action, State } from '../../src/world/types.ts';

/** mulberry32: a small fixed PRNG, independent of the core's seeded generator. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const PLAY = Object.freeze({ seed: 20261020, rounds: 14, actions: 10 });
const LABELS = ['Receive', 'Check & ship', '<b>not markup</b>', 'Zwei\nZeilen', '\tTab', '  spaced  ', 'Prüfung', '受注', 'a "quoted" \'one\'', '', 'x'.repeat(40)];
const live = (state: State): State => ({ objects: Object.fromEntries(Object.entries(state.objects).filter(([, object]) => !object.deleted)) });

function randomAction(state: State, random: () => number): Action {
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const int = (min: number, max: number): number => min + Math.floor(random() * (max - min + 1));
  const objects = Object.values(state.objects).filter(object => !object.deleted);
  const steps = objects.filter(object => object.type === 'step').map(object => object.id), arrows = objects.filter(object => object.type === 'arrow').map(object => object.id);
  const frames = objects.filter(object => object.type === 'frame').map(object => object.id);
  const step = (): string => steps.length ? pick(steps) : 'none', arrow = (): string => arrows.length ? pick(arrows) : 'none';
  const near = (): number => int(-200, 1200);
  const kinds: Array<() => Action> = [
    () => ({ name: 'move_step', params: { id: step(), x: near(), y: near() } }),
    () => ({ name: 'move_step', params: { id: step(), x: int(-100_000, 100_000), y: int(-100_000, 100_000) } }),
    () => ({ name: 'resize_step', params: { id: step(), width: int(10, 600), height: int(10, 300) } }),
    () => ({ name: 'set_style', params: { id: step(), shape: pick(['rectangle', 'ellipse', 'diamond']), stroke: pick(['black', 'red', 'green', 'blue', 'orange']), fill: pick(['none', 'red', 'green', 'blue', 'yellow']) } }),
    () => ({ name: 'set_frame', params: { id: step(), frameId: pick([null, ...frames]) } }),
    () => ({ name: 'rename_step', params: { id: step(), label: pick(LABELS) } }),
    () => ({ name: 'rename_frame', params: { id: frames.length ? pick(frames) : 'none', name: pick(LABELS.filter(label => label !== '')) } }),
    () => ({ name: 'add_step', params: { frameId: pick([null, ...frames]), label: pick(LABELS), x: near(), y: near(), width: int(10, 400), height: int(10, 200), shape: pick(['rectangle', 'ellipse', 'diamond']) } }),
    () => ({ name: 'delete_step', params: { id: step() } }),
    () => ({ name: 'connect', params: { from: step(), to: step() } }),
    () => ({ name: 'disconnect', params: { id: arrow() } }),
    () => ({ name: 'reconnect_end', params: { id: arrow(), end: pick(['start', 'end']), target: step() } }),
    () => ({ name: 'group_steps', params: { id: step(), with: step() } }),
    () => ({ name: 'ungroup', params: { id: step() } }),
  ];
  return pick(kinds)();
}

test('own-export mode reads every legal state the adapter writes, from random legal play on every library start', t => {
  const { world, library } = loadLibraryOf('drawio');
  const random = prng(PLAY.seed);
  let states = 0, rejected = 0, refusedAsSubmission = 0;
  for (const entry of library.tasks) {
    const slice = taskWorld(world, entry.id);
    for (const seed of Object.values(entry.oracle.seeds)) for (let round = 0; round < PLAY.rounds; round++) {
      const session = new Session(slice, seed, entry.id), memory = freshMemory(), played: Action[] = [];
      for (let index = 0; index < PLAY.actions; index++) {
        const action = randomAction(session.state, random);
        if (!session.act(action).ok) { rejected++; continue; }
        played.push(action); states++;
        const xml = `<mxfile host="test"><diagram id="p" name="Page-1">${modelXml(writeCells(session.state, memory))}</diagram></mxfile>`;
        let read: State;
        try { read = parseDrawio(xml, 'own-export').state; }
        catch (error) { assert.fail(`${entry.id} seed ${seed}: refused ${(error as CheckerError).details?.reason}: ${(error as Error).message} after ${JSON.stringify(played)}`); }
        assert.equal(canonicalJson(live(read)), canonicalJson(live(session.state)), `${entry.id} seed ${seed}: reads as another state after ${JSON.stringify(played)}`);
        try { parseDrawio(xml, 'submission'); } catch (error) { if (!(error instanceof CheckerError)) throw error; refusedAsSubmission++; }
      }
    }
  }
  // Several thousand states, fixed by the seed above.
  assert.ok(states >= 3000, `only ${states} legal states`);
  t.diagnostic(`own-export: ${states} legal states read; ${rejected} random actions refused by the core; ${refusedAsSubmission} of the states refused in submission mode`);
});

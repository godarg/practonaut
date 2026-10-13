import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkState } from '../../src/checker/index.ts';
import { evaluate } from '../../src/predicate/index.ts';
import { loadLibrary, isLibraryTaskId, taskWorld } from '../../src/library/index.ts';
import { generateVariant } from '../../src/world/variant.ts';
import type { Predicate, World } from '../../src/world/types.ts';

const { world, library } = loadLibrary();
const REQUIRED = ['add-step', 'remove-step', 'rename-step', 'connect', 'disconnect', 'reconnect', 'insert-between', 'close-chain', 'reorder', 'align', 'group', 'recolor', 'rename-frame'];
const verdict = (w: World, state: Parameters<typeof checkState>[1], seed: number, taskId: string): boolean => checkState(w, state, { seed, taskId }).passed;

describe('bundled Excalidraw task library', () => {
  it('has every required task kind, at least 12 tasks and multi-step tasks, in a world/2 world', () => {
    assert.equal(world.schema, 'practonaut.world/2');
    assert.ok(world.tasks.length >= 12);
    for (const id of REQUIRED) assert.ok(world.tasks.some(t => t.id === id), id);
    assert.ok(library.tasks.filter(t => t.difficulty === 3 && t.actions >= 3).length >= 2);
    for (const task of world.tasks) {
      assert.ok(task.title.en && task.title.de && task.prompt.en && task.prompt.de, task.id);
      assert.equal(task.conditionTexts?.length, (task.goal as { args: unknown[] }).args.length, task.id);
    }
  });
  it('every task in every variant: oracle passes the independent checker, near misses and the start fail', () => {
    for (const entry of library.tasks) {
      assert.equal(Object.keys(entry.oracle.seeds).length, world.variants.cases.length, entry.id);
      // Once inside the full library world, then every case on the task's own slice (same ids and cases).
      const full = runOracle(world, entry.oracle.seeds.drawn!, entry.id, entry.oracle.steps);
      assert.equal(full.ok && verdict(world, full.session.state, entry.oracle.seeds.drawn!, entry.id), true, `${entry.id} in the full world`);
      const world_ = taskWorld(world, entry.id);
      for (const [caseId, seed] of Object.entries(entry.oracle.seeds)) {
        const start = generateVariant(world_, seed).tasks[0]!.initialState!;
        assert.equal(verdict(world_, start, seed, entry.id), false, `${entry.id}/${caseId} start`);
        const run = runOracle(world_, seed, entry.id, entry.oracle.steps);
        assert.equal(run.ok, true, `${entry.id}/${caseId} oracle runs`);
        if (run.ok) assert.equal(verdict(world_, run.session.state, seed, entry.id), true, `${entry.id}/${caseId} oracle`);
        assert.ok(entry.oracle.nearMisses.length >= 1, entry.id);
        for (const miss of entry.oracle.nearMisses) {
          const tried = runOracle(world_, seed, entry.id, miss.steps);
          assert.equal(tried.ok, true, `${entry.id}/${miss.id} runs`);
          if (tried.ok) assert.equal(verdict(world_, tried.session.state, seed, entry.id), false, `${entry.id}/${caseId}/${miss.id}`);
        }
      }
    }
  });
  it('mutation probe: without the clause a single-fault near miss violates, that near miss passes', () => {
    let probed = 0;
    for (const entry of library.tasks) for (const miss of entry.oracle.nearMisses.filter(m => m.violates.length === 1)) {
      const weakened = structuredClone(taskWorld(world, entry.id)), task = weakened.tasks[0]!;
      (task.goal as { args: Predicate[] }).args.splice(miss.violates[0]!, 1); task.conditionTexts!.splice(miss.violates[0]!, 1);
      const seed = entry.oracle.seeds.drawn!, tried = runOracle(weakened, seed, entry.id, miss.steps);
      assert.equal(tried.ok, true);
      // The goal alone decides here: a weakened goal may also accept the start, which the
      // checker's counter-probe would (rightly) refuse before any verdict.
      if (tried.ok) { const r = evaluate(generateVariant(weakened, seed).tasks[0]!.goal, tried.session.state); assert.equal(r.ok && r.value, true, `${entry.id}/${miss.id}`); }
      probed++;
    }
    assert.ok(probed >= 12, `only ${probed} single-fault near misses`);
  });
  it('task ids are plain names; paths are never library ids', () => {
    assert.equal(isLibraryTaskId('connect'), true);
    assert.equal(isLibraryTaskId('./connect'), false);
    assert.equal(isLibraryTaskId('unknown-task'), false);
  });
});

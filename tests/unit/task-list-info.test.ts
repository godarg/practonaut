// The task list carries each library task's level and reference length (as `practonaut tasks list`
// shows them), through the host view and the MCP schema; other worlds carry neither. Library hints
// for arrow tasks name the arrow's direction, and counted hints follow the plural rules.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createPracticeController } from '../../src/host/session.ts';
import { publicViewSchema } from '../../src/mcp/bridge.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { generateVariant } from '../../src/world/variant.ts';
import { validateWorld } from '../../src/world/schema.ts';
import type { World } from '../../src/world/types.ts';

const SOURCES = new URL('../../tasks/excalidraw/sources/', import.meta.url);
const flow = (): World => validateWorld(JSON.parse(readFileSync(new URL('../../examples/worlds/flow-diagram/world.json', import.meta.url), 'utf8')));
const noMirror = async (): Promise<never> => { throw new Error('no mirror in this test'); };
// Expected values from the authors' sources and the stored reference solutions, not from the host.
const sourceDifficulty = (id: string): number => (JSON.parse(readFileSync(new URL(`${id}/task.json`, SOURCES), 'utf8')) as { difficulty: number }).difficulty;

describe('task list facts', () => {
  it('a library session lists every task with its level and the length of its reference solution', async () => {
    const { world, library } = loadLibrary();
    const controller = await createPracticeController(world, { mirror: 'off', taskId: 'connect' }, noMirror);
    const view = controller.view();
    assert.equal(view.tasks.length, readdirSync(SOURCES).length);
    for (const item of view.tasks) {
      assert.equal(item.level, sourceDifficulty(item.id), item.id);
      assert.equal(item.referenceActions, library.tasks.find(entry => entry.id === item.id)!.oracle.steps.length, item.id);
    }
    assert.equal(publicViewSchema.safeParse(view).success, true);
    await controller.close();
  });
  it('another world carries neither field, also one that only borrows the library id', async () => {
    const own = await createPracticeController(flow(), { mirror: 'off', taskId: 'T3' }, noMirror);
    assert.deepEqual(own.view().tasks.map(item => Object.keys(item).sort()), own.view().tasks.map(() => ['id', 'title']));
    await own.close();
    const { world } = loadLibrary();
    const borrowed = await createPracticeController(validateWorld({ ...structuredClone(world), version: '9.9.9' }), { mirror: 'off', taskId: 'connect' }, noMirror);
    assert.ok(borrowed.view().tasks.every(item => item.level === undefined && item.referenceActions === undefined));
    await borrowed.close();
  });
  it('the MCP view schema admits the two fields only in range and still refuses unknown task fields', async () => {
    const { world } = loadLibrary();
    const controller = await createPracticeController(world, { mirror: 'off', taskId: 'connect' }, noMirror);
    const view = controller.view();
    await controller.close();
    const withTask = (patch: Record<string, unknown>): unknown => ({ ...view, tasks: [{ ...view.tasks[0]!, ...patch }] });
    assert.equal(publicViewSchema.safeParse(withTask({})).success, true);
    assert.equal(publicViewSchema.safeParse(withTask({ level: 3, referenceActions: 6 })).success, true);
    const { level: _level, referenceActions: _steps, ...bare } = view.tasks[0]!;
    assert.equal(publicViewSchema.safeParse({ ...view, tasks: [bare] }).success, true, 'both fields stay optional');
    for (const patch of [{ level: 0 }, { level: 4 }, { level: 1.5 }, { referenceActions: 0 }, { referenceActions: 2.5 }, { referenceActions: '3' }, { difficulty: 1 }, { oracle: [] }]) {
      assert.equal(publicViewSchema.safeParse(withTask(patch)).success, false, JSON.stringify(patch));
    }
  });
});

describe('library hints', () => {
  it('connect, reconnect and close-chain name where the arrow starts and where it ends, in every variant and both languages', () => {
    const { world, library } = loadLibrary();
    for (const id of ['connect', 'reconnect', 'close-chain']) {
      // The direction comes from the goal drawing: the arrow that the start drawing lacks.
      const arrows = (name: string): Array<[string, string]> => {
        const elements = (JSON.parse(readFileSync(new URL(`${id}/${name}.excalidraw`, SOURCES), 'utf8')) as { elements: Array<Record<string, unknown>> }).elements;
        const label = (box: unknown): string => String(elements.find(e => e.type === 'text' && e.containerId === (box as { elementId?: string } | null)?.elementId)?.text);
        return elements.filter(e => e.type === 'arrow' && !e.isDeleted).map(e => [label(e.startBinding), label(e.endBinding)]);
      };
      const before = arrows('start').map(pair => pair.join('>'));
      const added = arrows('goal').filter(pair => !before.includes(pair.join('>')));
      assert.equal(added.length, 1, id);
      const [from, to] = added[0]!;
      const variants = (JSON.parse(readFileSync(new URL(`${id}/task.json`, SOURCES), 'utf8')) as { variants: Array<{ id: string; labels: Record<string, string> }> }).variants;
      for (const [caseId, seed] of Object.entries(library.tasks.find(entry => entry.id === id)!.oracle.seeds)) {
        const names = variants.find(v => v.id === caseId)?.labels ?? {};
        const start = names[from] ?? from, end = names[to] ?? to;
        const hint = generateVariant(world, seed).tasks.find(task => task.id === id)!.hints[0]!;
        assert.match(hint.en, new RegExp(`[Ss]tart(s| it)? at “${start}”`), `${id} ${caseId} EN start`);
        assert.match(hint.en, new RegExp(`(end it at|points to|pointing to) “${end}”`), `${id} ${caseId} EN end`);
        assert.match(hint.de, new RegExp(`[Bb]eginn(e|t) (ihn )?bei „${start}“`), `${id} ${caseId} DE start`);
        assert.match(hint.de, new RegExp(`(bei „${end}“ enden|zeigt (weiter )?auf „${end}“)`), `${id} ${caseId} DE end`);
      }
    }
  });
  it('no hint counts in the wrong grammatical number', () => {
    const { world } = loadLibrary();
    for (const task of world.tasks) for (const hint of task.hints) {
      assert.doesNotMatch(hint.en, /(^|[^\d])1 (steps|arrows)\b/, `${task.id}: ${hint.en}`);
      assert.doesNotMatch(hint.de, /(^|[^\d])1 (Schritte|Pfeile)\b/, `${task.id}: ${hint.de}`);
      assert.doesNotMatch(hint.en, /\b([02-9]|\d\d+) (step|arrow)\b(?!s)/, `${task.id}: ${hint.en}`);
    }
  });
});

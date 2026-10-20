// What the Player and an agent are told about a layout task (PADR-0047 decisions 6, 7 and 10): the
// sentences and formal texts of the PADR's tables, the public overlay, the same conditions in the
// Player's view, the check result and MCP's reply shapes, and a rotation gesture refused.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPracticeController, publicConditions } from '../../src/host/session.ts';
import { checkResult, compactView } from '../../src/mcp/replies.ts';
import { publicViewSchema } from '../../src/mcp/bridge.ts';
import type { StepV2, Task } from '../../src/world/types.ts';
import { aligned, everything, evenlySpaced, inFrame, noOverlap, outside } from '../support/layout-board.ts';
import { LAYOUT_GOAL_STATE, layoutWorld } from '../support/layout-world.ts';

const unused = async (): Promise<never> => { throw new Error('no mirror in this test'); };

describe('layout clauses for the Player and agents', () => {
  it('state the formal text and the sentence of PADR-0047 decision 6, in English and German', () => {
    const conditions = publicConditions(layoutWorld().tasks[0]!);
    // Expected strings: the PADR's tables with this task's numbers (6 steps, 6 arrows, 3 per lane).
    assert.deepEqual(conditions.map(c => c.formalText?.en), [
      'no two overlap: 6 × step [s]: (all); gap ≥ 20 px',
      'inside (40, 40)–(760, 440): 6 × step [s]: (all)',
      'no two cross: 6 × arrow [a]: (all)',
      'clear of steps: 6 × arrow [a]: (all); 6 × step [s]: (all)',
      'aligned on y, centre: 3 × step [s]: (in frame "Lane A"); ± 4 px',
      'evenly spaced along x, no overlap along x: 3 × step [s]: (in frame "Lane A"); ± 4 px',
      'aligned on y, centre: 3 × step [s]: (in frame "Lane B"); ± 4 px',
      'evenly spaced along x, no overlap along x: 3 × step [s]: (in frame "Lane B"); ± 4 px',
    ]);
    assert.deepEqual(conditions.map(c => c.formalText?.de).slice(0, 6), [
      'keine zwei überlappen: 6 × Schritt [s]: (alle); Abstand ≥ 20 px',
      'innerhalb (40, 40)–(760, 440): 6 × Schritt [s]: (alle)',
      'keine zwei kreuzen sich: 6 × Pfeil [a]: (alle)',
      'frei von Schritten: 6 × Pfeil [a]: (alle); 6 × Schritt [s]: (alle)',
      'ausgerichtet auf y, Mitte: 3 × Schritt [s]: (im Rahmen "Lane A"); ± 4 px',
      'gleichmäßig verteilt entlang x, ohne Überlappung entlang x: 3 × Schritt [s]: (im Rahmen "Lane A"); ± 4 px',
    ]);
    assert.deepEqual(conditions.map(c => c.text.en).slice(0, 6), [
      'No two of the 6 steps come closer than 20 px: their boxes are at least 20 px apart horizontally or vertically.',
      'Every box of the 6 steps lies entirely inside the canvas from (40, 40) to (760, 440).',
      'No two of the 6 arrows cross or touch. An arrow counts as the straight line between the centres of the two steps it joins, however it is drawn; arrows that share a step may meet at its centre, and arrows between the same two steps are not compared. Every arrow must be attached at both ends.',
      'None of the 6 arrows touches the box of any of the 6 steps other than the two it joins. An arrow counts as the straight line between the centres of its two steps, however it is drawn. Every arrow must be attached at both ends.',
      'The 3 steps in “Lane A” sit in one row: the y-coordinates of their centres differ by at most 4 px.',
      'The 3 steps in “Lane A” stand side by side without overlapping horizontally, and the horizontal gaps between neighbouring boxes differ by at most 4 px.',
    ]);
    assert.deepEqual(conditions.map(c => c.text.de).slice(0, 6), [
      'Von den 6 Schritten kommen sich keine zwei näher als 20 px: zwischen ihren Boxen liegen waagerecht oder senkrecht mindestens 20 px.',
      'Alle Boxen von den 6 Schritten liegen ganz innerhalb der Arbeitsfläche von (40, 40) bis (760, 440).',
      'Von den 6 Pfeilen kreuzen oder berühren sich keine zwei. Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten der beiden Schritte, die er verbindet, wie auch immer er gezeichnet ist; Pfeile mit einem gemeinsamen Schritt dürfen sich in dessen Mittelpunkt treffen, Pfeile zwischen denselben zwei Schritten werden nicht verglichen. Jeder Pfeil muss an beiden Enden angebunden sein.',
      'Keiner von den 6 Pfeilen berührt die Box eines von den 6 Schritten außer den beiden, die er verbindet. Ein Pfeil zählt als gerade Linie zwischen den Mittelpunkten seiner beiden Schritte, wie auch immer er gezeichnet ist. Jeder Pfeil muss an beiden Enden angebunden sein.',
      'Bei den 3 Schritten in „Lane A“ weichen die y-Koordinaten der Mittelpunkte höchstens 4 px voneinander ab: sie stehen in einer Zeile.',
      'Bei den 3 Schritten in „Lane A“ überlappen sich die Boxen waagerecht nicht, und die waagerechten Lücken zwischen benachbarten Boxen weichen höchstens 4 px voneinander ab.',
    ]);
    // The other forms of decision 6: gap 0, outside every frame, a column, edges, vertical spacing.
    const task: Task = { ...layoutWorld().tasks[0]!, goal: { op: 'all', args: [noOverlap(everything('step', 16)), aligned(outside('step', 2), 'x', 'start'), evenlySpaced(everything('step', 3), 'y', 2), aligned(everything('step', 2), 'y', 'end', 1)] } };
    const more = publicConditions(task);
    assert.deepEqual(more.map(c => c.text.en), [
      'No two of the 16 steps overlap: their boxes (position and size) share no area; edges may touch.',
      'The 2 steps outside any frame sit in one column: their left edges differ by at most 0 px.',
      'The 3 steps stand one above the other without overlapping vertically, and the vertical gaps between neighbouring boxes differ by at most 2 px.',
      'The 2 steps sit in one row: their bottom edges differ by at most 1 px.',
    ]);
    assert.deepEqual(more.map(c => c.text.de), [
      'Von den 16 Schritten überlappen sich keine zwei: ihre Boxen (Position und Größe) haben keine gemeinsame Fläche; Kanten dürfen sich berühren.',
      'Bei den 2 Schritten außerhalb von Rahmen weichen die linken Kanten höchstens 0 px voneinander ab: sie stehen in einer Spalte.',
      'Bei den 3 Schritten überlappen sich die Boxen senkrecht nicht, und die senkrechten Lücken zwischen benachbarten Boxen weichen höchstens 2 px voneinander ab.',
      'Bei den 2 Schritten weichen die Unterkanten höchstens 1 px voneinander ab: sie stehen in einer Zeile.',
    ]);
    assert.equal(more[1]!.formalText!.en, 'aligned on x, start: 2 × step [s]: (outside frames); ± 0 px');
    assert.equal(more[1]!.formalText!.de, 'ausgerichtet auf x, Anfang: 2 × Schritt [s]: (außerhalb von Rahmen); ± 0 px');
  });

  it('carry the public overlay: the operator, its parameters and each selection as type, tagged scope and count', () => {
    const conditions = publicConditions(layoutWorld().tasks[0]!);
    assert.deepEqual(conditions.map(c => c.layout), [
      { op: 'noOverlap', steps: { type: 'step', scope: { kind: 'all' }, count: 6 }, gap: 20 },
      { op: 'within', steps: { type: 'step', scope: { kind: 'all' }, count: 6 }, canvas: { x: 40, y: 40, width: 720, height: 400 } },
      { op: 'arrowsNoCrossing', arrows: { type: 'arrow', scope: { kind: 'all' }, count: 6 } },
      { op: 'arrowsClearOfSteps', arrows: { type: 'arrow', scope: { kind: 'all' }, count: 6 }, steps: { type: 'step', scope: { kind: 'all' }, count: 6 } },
      { op: 'aligned', steps: { type: 'step', scope: { kind: 'frame', name: 'Lane A' }, count: 3 }, axis: 'y', anchor: 'center', tolerance: 4 },
      { op: 'evenlySpaced', steps: { type: 'step', scope: { kind: 'frame', name: 'Lane A' }, count: 3 }, axis: 'x', tolerance: 4 },
      { op: 'aligned', steps: { type: 'step', scope: { kind: 'frame', name: 'Lane B' }, count: 3 }, axis: 'y', anchor: 'center', tolerance: 4 },
      { op: 'evenlySpaced', steps: { type: 'step', scope: { kind: 'frame', name: 'Lane B' }, count: 3 }, axis: 'x', tolerance: 4 },
    ]);
    // A frame named "all" stays a frame; every object stays every object.
    const task: Task = { ...layoutWorld().tasks[0]!, goal: { op: 'all', args: [aligned(inFrame('step', 'all', 2), 'y', 'center'), aligned(everything('step', 2), 'y', 'center')] } };
    assert.deepEqual(publicConditions(task).map(c => c.layout && 'steps' in c.layout ? c.layout.steps.scope : null), [{ kind: 'frame', name: 'all' }, { kind: 'all' }]);
    // Other clauses carry none.
    assert.equal(publicConditions({ ...task, goal: { op: 'true' } })[0]!.layout, undefined);
  });

  it('reach the Player view, the check result and the agent\'s replies deep-equal, overlay included', async () => {
    const controller = await createPracticeController(layoutWorld(), { taskId: 'tidy', mirror: 'off' }, unused);
    try {
      const view = controller.view();
      const expected = publicConditions(layoutWorld().tasks[0]!).map(({ predicate: _predicate, ...shown }) => shown);
      assert.deepEqual(view.task.conditions, expected);
      // MCP: the compact observe and the full view keep every condition exactly; the bridge's strict
      // schema admits the overlay and drops nothing.
      assert.deepEqual(compactView(view, 'both').task.conditions, view.task.conditions);
      assert.deepEqual(publicViewSchema.parse(structuredClone(view)).task.conditions, view.task.conditions);
      const checked = await controller.check({ expectedRevision: view.revision });
      assert.ok(checked.ok, JSON.stringify(checked));
      assert.equal(checked.value.passed, false);
      assert.deepEqual(checked.value.conditions.map(({ met: _met, ...rest }) => rest), view.task.conditions);
      assert.deepEqual(checkResult(checked.value, 'both'), checked.value);
      // By hand on the start: a2 (480–640) overlaps a3 (540–700); b3 ends at 940, past 760; no two
      // segments meet; e1 ends at a2's centre (560, 160), inside a3's box; lane A's centres are at
      // 140, 160, 140; lane A overlaps along x; lane B's centres are at 340, 370, 340 and its gaps 60 and 300.
      assert.deepEqual(checked.value.conditions.map(c => c.met), [false, false, true, false, false, false, false, false]);
      // In one language the overlay is unchanged: it holds no text to translate.
      assert.deepEqual(compactView(controller.view(), 'en').task.conditions.map(c => c.layout), view.task.conditions.map(c => c.layout));
      // The reference arrangement meets every condition.
      const solved = layoutWorld(); solved.tasks[0]!.initialState = LAYOUT_GOAL_STATE;
      const other = await createPracticeController(solved, { taskId: 'tidy', mirror: 'off' }, unused);
      try { const result = await other.check({ expectedRevision: 0 }); assert.ok(result.ok); assert.equal(result.value.passed, true); } finally { await other.close(); }
    } finally { await controller.close(); }
  });

  it('a rotation in the editor is refused as unmodeled; the same step can still be moved', async () => {
    // Rectangles only: every element of the board is one the editor recorder models.
    const world = layoutWorld();
    for (const object of Object.values(world.initialState.objects)) if (object.type === 'step') (object as StepV2).shape = 'rectangle';
    const controller = await createPracticeController(world, { taskId: 'tidy', mirror: 'off' }, unused);
    try {
      const turn = (scene: ReturnType<NonNullable<typeof controller.scene>>, change: { dx?: number; angle?: number }) => {
        const after = structuredClone(scene);
        for (const element of after) if (element.id === 'a2' || element.containerId === 'a2') { element.x += change.dx ?? 0; if (change.angle !== undefined) (element as unknown as { angle: number }).angle = change.angle; }
        return after;
      };
      const before = controller.scene!(), committed = controller.view();
      for (const change of [{ angle: 0.5 }, { dx: 20, angle: 0.5 }]) {
        const rotated = await controller.editor!({ expectedRevision: 0, before, after: turn(before, change), boundary: 'pointerup' });
        assert.equal(rotated.ok, false, JSON.stringify(change));
        if (!rotated.ok) assert.equal(rotated.error.code, 'unmodeled');
        assert.deepEqual(controller.view(), committed);
      }
      const moved = await controller.editor!({ expectedRevision: 0, before, after: turn(before, { dx: 20 }), boundary: 'pointerup' });
      assert.equal(moved.ok, true, JSON.stringify(moved));
      assert.equal((controller.view().state.objects.a2 as { x: number }).x, 500);
    } finally { await controller.close(); }
  });
});

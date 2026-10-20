// Reviews m2c, m2d and m3 of PR #70: each way a hand-made .drawio file could pass a library goal while
// draw.io shows something else, reproduced on the draw.io library's own tasks, now refused by name. Every
// file starts from the cells the adapter writes for a real state (the start or the reference's end), so
// the honest goal still passes and the unchanged start still fails; only the attack is added. `check`
// reads such files in submission mode (the default); the host's own exports are read in own-export mode,
// where every legal state reads (PADR-0049 decision 6.8; tests/unit/drawio-own-export.test.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkSubmission, CheckerError } from '../../src/checker/index.ts';
import { nativeMatchesState } from '../../src/host/export-pair.ts';
import type { Action } from '../../src/world/types.ts';
import { freshMemory, modelXml, writeCells, type XmlNode } from '../../src/adapters/drawio/writer.ts';
import { loadLibraryOf, taskWorld } from '../../src/library/index.ts';
import { Session } from '../../src/core/index.ts';
import type { State, StepV2 } from '../../src/world/types.ts';

const { world, library } = loadLibraryOf('drawio');
const entry = (taskId: string) => library.tasks.find(task => task.id === taskId)!;
const slice = (taskId: string) => taskWorld(world, taskId);
const seed = (taskId: string) => entry(taskId).oracle.seeds.drawn!;
const goal = (taskId: string): State => { const run = runOracle(slice(taskId), seed(taskId), taskId, entry(taskId).oracle.steps); assert.ok(run.ok); return run.session.state; };
const start = (taskId: string): State => new Session(slice(taskId), seed(taskId), taskId).state;
const cells = (state: State): XmlNode[] => writeCells(state, freshMemory());
const file = (content: XmlNode[] | string): string => `<mxfile host="test"><diagram id="p" name="Page-1">${typeof content === 'string' ? content : modelXml(content)}</diagram></mxfile>`;
const byLabel = (list: XmlNode[], label: string): XmlNode => list.find(cell => cell.attrs.value === label)!;
const steps = (list: XmlNode[]): XmlNode[] => list.filter(cell => cell.attrs.vertex === '1' && !cell.attrs.id!.startsWith('pn:') && !(cell.attrs.style ?? '').startsWith('swimlane'));
const outcome = (taskId: string, xml: string, reading: 'own-export' | 'submission' = 'submission'): string => {
  try { return checkSubmission(slice(taskId), xml, { seed: seed(taskId), taskId, format: 'drawio', reading }).passed ? 'passed' : 'failed'; }
  catch (error) { assert.ok(error instanceof CheckerError, String(error)); return String(error.details.reason); }
};
const restyled = (list: XmlNode[], label: string, change: (style: string) => string): XmlNode[] => { const copy = structuredClone(list); const cell = byLabel(copy, label); cell.attrs.style = change(cell.attrs.style!); return copy; };
const labelOf = (state: State, predicate: (step: StepV2) => boolean): string => (Object.values(state.objects).find(o => o.type === 'step' && !o.deleted && predicate(o as StepV2)) as StepV2).label;

test('baselines: the honest goal passes and the unchanged start fails, for every task attacked below', () => {
  for (const taskId of ['connect', 'remove-step', 'reorder', 'rename-step', 'align', 'two-frames', 'recolor']) {
    assert.equal(outcome(taskId, file(cells(goal(taskId)))), 'passed', taskId);
    assert.equal(outcome(taskId, file(cells(start(taskId)))), 'failed', taskId);
  }
});

test('Codex 1 (blocker): labels and shapes draw.io hides are refused, not counted', () => {
  const connect = cells(goal('connect')), label = steps(connect)[0]!.attrs.value!;
  for (const key of ['noLabel=1;', 'opacity=0;textOpacity=0;', 'textOpacity=0;', 'fontColor=none;', 'visible=0;']) assert.equal(outcome('connect', file(restyled(connect, label, s => s + key))), 'unmodeled_value', key);
});

test('Codex 2: a comment with -- inside, and the other XML forms a parser refuses', () => {
  const plain = modelXml(cells(goal('connect')));
  assert.equal(outcome('connect', file(plain.replace('<root>', '<root><!-- a--b -->'))), 'xml_invalid');
  assert.equal(outcome('connect', file(plain.replace('<root>', '<root>]]>'))), 'xml_invalid');
  assert.equal(outcome('connect', `<!-- c --><?xml version="1.0"?>${file(plain)}`), 'xml_invalid');
  assert.equal(outcome('connect', `<?xml version="1.0"?><?xml version="1.0"?>${file(plain)}`), 'xml_invalid');
  assert.equal(outcome('connect', file(plain.replace('<mxCell id="pn:layer"', '<mxCell x:y="1" id="pn:layer"'))), 'xml_invalid');
});

test('a step draw.io still draws is refused, so "remove a step" cannot pass while it shows', () => {
  const kept = cells(start('remove-step')), removed = labelOf(start('remove-step'), step => !Object.values(goal('remove-step').objects).some(o => o.type === 'step' && !o.deleted && (o as StepV2).label === step.label));
  assert.equal(outcome('remove-step', file(kept)), 'failed');
  assert.equal(outcome('remove-step', file(restyled(kept, removed, s => s + 'container=1;'))), 'unmodeled_value');
  assert.equal(outcome('remove-step', file(restyled(kept, removed, s => 'pnbox;' + s))), 'unmodeled_value');
  assert.equal(outcome('remove-step', file(restyled(kept, removed, s => 'shape=pnbox;' + s.replace('rounded=0;', '')))), 'unmodeled_value');
  const underRoot = structuredClone(kept); byLabel(underRoot, removed).attrs.parent = 'pn:root';
  assert.equal(outcome('remove-step', file(underRoot)), 'structure_invalid');
});

test('offsets draw.io adds that the reader would not: plain cells, relative flags, cancelling values', () => {
  const reordered = cells(goal('reorder')), before = start('reorder');
  const wrapped = structuredClone(reordered);
  for (const cell of steps(wrapped)) {
    const was = Object.values(before.objects).find(o => o.type === 'step' && (o as StepV2).label === cell.attrs.value) as StepV2;
    wrapped.push({ name: 'mxCell', attrs: { id: `w-${cell.attrs.id}`, parent: 'pn:layer' }, children: [{ name: 'mxGeometry', attrs: { x: String(was.x - Number(cell.children[0]!.attrs.x ?? 0)), as: 'geometry' }, children: [] }] });
    cell.attrs.parent = `w-${cell.attrs.id}`;
  }
  assert.equal(outcome('reorder', file(wrapped)), 'structure_invalid', 'steps at their goal places inside plain cells that move them back');
  for (const value of ['true', '1.0', '1']) {
    const relative = structuredClone(reordered);
    for (const cell of steps(relative)) cell.children[0]!.attrs.relative = value;
    assert.equal(outcome('reorder', file(relative)), 'unmodeled_value', `relative="${value}"`);
  }
  const aligned = structuredClone(cells(start('align')));
  aligned.push({ name: 'mxCell', attrs: { id: 'big', value: '', style: 'group;', vertex: '1', connectable: '0', parent: 'pn:layer' }, children: [{ name: 'mxGeometry', attrs: { y: '9223372036854775808', width: '1', height: '1', as: 'geometry' }, children: [] }] });
  for (const cell of steps(aligned)) cell.attrs.parent = 'big';
  assert.equal(outcome('align', file(aligned)), 'geometry_invalid', 'a value far past ±1,000,000');
});

test('a label draw.io takes from elsewhere: an object\'s inner value, a value child', () => {
  const renamed = cells(goal('rename-step')), old = start('rename-step');
  const wrong = labelOf(old, step => !Object.values(goal('rename-step').objects).some(o => o.type === 'step' && (o as StepV2).label === step.label));
  const cell = renamed.find(c => c.attrs.id === (Object.values(old.objects).find(o => o.type === 'step' && (o as StepV2).label === wrong) as StepV2).id)!;
  const inner = modelXml([{ ...cell, attrs: Object.fromEntries(Object.entries({ ...cell.attrs, value: wrong }).filter(([key]) => key !== 'id')) }]).replace(/^<mxGraphModel><root>|<\/root><\/mxGraphModel>$/g, '');
  const object = modelXml(renamed).replace(new RegExp(`<mxCell id="${cell.attrs.id}"[^>]*>[\\s\\S]*?</mxCell>`), `<object id="${cell.attrs.id}" label="${cell.attrs.value}">${inner}</object>`);
  assert.equal(outcome('rename-step', file(object)), 'cell_invalid');
  assert.equal(outcome('rename-step', file(modelXml(renamed).replace(new RegExp(`(<mxCell id="${cell.attrs.id}"[^>]*>)`), `$1<add as="value" value="${wrong}"/>`))), 'cell_invalid');
});

test('an arrow draw.io does not show, or shows the other way, is refused', () => {
  const connect = cells(goal('connect'));
  const edgeStyled = (style: string): string => { const copy = structuredClone(connect); copy.find(c => c.attrs.edge === '1')!.attrs.style = style; return file(copy); };
  for (const style of ['endArrow=classic;html=0;strokeColor=none;', 'group;endArrow=classic;html=0;', 'text;endArrow=classic;html=0;', 'endArrow=classic;html=0;opacity=0;', 'startArrow=classic;endArrow=classic;endSize=0;html=0;', ';startArrow=classic;html=0;']) {
    assert.equal(outcome('connect', edgeStyled(style)), 'unmodeled_value', style);
  }
});

// Review m2d: a frame's title band was filled in draw.io, and a cell later in the file is painted over
// earlier ones. The adapter leaves the band unfilled and the reader reads only such frames. Review m3:
// modelling the painting did not converge, so submission mode models none: overlapping boxes, an arrow
// meeting a filled step and text that may leave its box are refused whatever the order.
const box = (cell: XmlNode): { x: number; y: number; width: number; height: number } => { const g = cell.children[0]!.attrs; return { x: Number(g.x ?? 0), y: Number(g.y ?? 0), width: Number(g.width), height: Number(g.height) }; };
const vertexCell = (id: string, value: string, style: string, b: { x: number; y: number; width: number; height: number }): XmlNode => ({ name: 'mxCell', attrs: { id, value, style, vertex: '1', parent: 'pn:layer' }, children: [{ name: 'mxGeometry', attrs: { x: String(b.x), y: String(b.y), width: String(b.width), height: String(b.height), as: 'geometry' }, children: [] }] });
const FILLED_BAND = 'swimlane;container=1;collapsible=0;startSize=30;html=0;';
const OPEN_BAND = 'swimlane;container=1;collapsible=0;startSize=30;fillColor=none;html=0;';

test('r2-reader-frame-band-occlusion (connect): a frame over the goal arrow', () => {
  const connect = cells(goal('connect')), arrow = connect.find(c => c.attrs.edge === '1')!;
  const [from, to] = [arrow.attrs.source!, arrow.attrs.target!].map(id => box(connect.find(c => c.attrs.id === id)!));
  assert.ok(connect.filter(c => c.attrs.vertex === '1').every(c => c.attrs.parent === 'pn:layer'), 'the goal\'s steps sit on the layer');
  // The review's file: a band over the line between the two steps, appended after the arrow.
  const y = from!.y + from!.height / 2 - 15, band = { x: from!.x + from!.width + 1, y, width: to!.x - from!.x - from!.width - 2, height: 30 };
  assert.equal(outcome('connect', file([...connect, vertexCell('cover', '', FILLED_BAND, band)])), 'unmodeled_value', 'a filled band');
  // The same frame in the adapter's style hides nothing: draw.io draws the arrow through the unfilled band.
  assert.equal(outcome('connect', file([...connect, vertexCell('cover', '', OPEN_BAND, band)])), 'passed');
  // A filled step over the arrow: refused whether draw.io paints it after the arrow or before.
  const filled = 'rounded=0;html=0;strokeColor=#000000;fillColor=#dae8fc;', middle = { x: band.x + 20, y: band.y - 10, width: 40, height: 50 };
  assert.equal(outcome('connect', file([...connect, vertexCell('cover', '', filled, middle)])), 'arrow_hidden');
  assert.equal(outcome('connect', file([connect[0]!, connect[1]!, vertexCell('cover', '', filled, middle), ...connect.slice(2)])), 'arrow_hidden', 'the arrow painted after the step');
});

test('r2-reader-frame-band-occlusion (rename-step): a frame named like the start\'s misspelling over the new label', () => {
  const renamed = cells(goal('rename-step')), old = start('rename-step');
  const wrong = labelOf(old, step => !Object.values(goal('rename-step').objects).some(o => o.type === 'step' && (o as StepV2).label === step.label));
  const id = (Object.values(old.objects).find(o => o.type === 'step' && (o as StepV2).label === wrong) as StepV2).id;
  const step = box(renamed.find(c => c.attrs.id === id)!), band = { x: step.x, y: step.y + step.height / 2 - 15, width: step.width, height: 30 };
  assert.equal(outcome('rename-step', file(renamed)), 'passed', 'the honest rename');
  assert.equal(outcome('rename-step', file([...renamed, vertexCell('cover', wrong, FILLED_BAND, band)])), 'unmodeled_value', 'the review\'s file: a filled band');
  assert.equal(outcome('rename-step', file([...renamed, vertexCell('cover', wrong, OPEN_BAND, band)])), 'boxes_overlap', 'an unfilled band whose name is drawn over the label');
  assert.equal(outcome('rename-step', file([vertexCell('cover', wrong, OPEN_BAND, band), ...renamed])), 'boxes_overlap', 'the same frame first in the file');
});

// Review m3 (r3-paint-honest-states-refused): the paint rules refused the adapter's own export of legal
// states, so a solved bench run became infra_error. The review's states, from the core: read in
// own-export mode as the session state, judged as the session is; refused by name in submission mode.
const played = (taskId: string, actions: Action[]): Session => {
  const run = runOracle(slice(taskId), seed(taskId), taskId, entry(taskId).oracle.steps); assert.ok(run.ok);
  for (const action of actions) assert.ok(run.session.act(action).ok, JSON.stringify(action));
  return run.session;
};
test('r3-paint-honest-states-refused: legal states the review found refused read as their session in own-export mode', () => {
  const renameFrame = (() => {
    const session = new Session(slice('rename-frame'), seed('rename-frame'), 'rename-frame');
    for (const action of [{ name: 'delete_step', params: { id: 'a' } }, { name: 'delete_step', params: { id: 'b' } }] as Action[]) assert.ok(session.act(action).ok);
    // A new filled step across the line the loose arrow keeps between the old centres (190, 245) and (490, 245).
    assert.ok(session.act({ name: 'add_step', params: { frameId: 'f', label: 'New', x: 300, y: 220, width: 100, height: 50, shape: 'rectangle' } }).ok);
    const added = Object.values(session.state.objects).find(o => o.type === 'step' && !o.deleted)!.id;
    assert.ok(session.act({ name: 'set_style', params: { id: added, shape: 'rectangle', stroke: 'black', fill: 'yellow' } }).ok);
    return { taskId: 'rename-frame', session, passes: false, refused: 'arrow_hidden' };
  })();
  const cases = [
    { taskId: 'recolor', session: played('recolor', [{ name: 'move_step', params: { id: 'b', x: 200, y: 200 } }]), passes: true, refused: 'boxes_overlap' },
    { taskId: 'recolor', session: played('recolor', [{ name: 'move_step', params: { id: 'a', x: 350, y: 220 } }]), passes: true, refused: 'boxes_overlap' },
    { taskId: 'two-frames', session: played('two-frames', [{ name: 'move_step', params: { id: 'c', x: 500, y: 380 } }]), passes: true, refused: 'boxes_overlap' },
    renameFrame,
  ];
  for (const { taskId, session, passes, refused } of cases) {
    const memory = freshMemory(), xml = file(writeCells(session.state, memory));
    assert.equal(nativeMatchesState(slice(taskId), xml, session.state, 'own-export'), true, `${taskId}: the own export equals the session state`);
    const verdict = checkSubmission(slice(taskId), JSON.stringify(session.serialize()), { seed: seed(taskId), taskId }).passed;
    assert.equal(verdict, passes, `${taskId}: the session's verdict`);
    assert.equal(outcome(taskId, xml, 'own-export'), passes ? 'passed' : 'failed', `${taskId}: the own export is judged as the session is`);
    assert.equal(outcome(taskId, xml), refused, `${taskId}: a file from outside a session with the same content is refused by name`);
  }
});

// r3-paint-end-step-hides-arrow: an end step inside its filled partner, the arrow before the partner in
// the file: draw.io paints the partner over the whole arrow, which lies inside it.
test('r3-paint-end-step-hides-arrow: an arrow inside its own filled end step is refused', () => {
  const recolor = cells(goal('recolor'));
  const byId = (list: XmlNode[], id: string): XmlNode => list.find(c => c.attrs.id === id)!;
  const inside = structuredClone(recolor);
  Object.assign(byId(inside, 'a').children[0]!.attrs, { x: '410', y: '210', width: '40', height: '20' });
  // The review's order: ab, b, a, c, bc. Its a (40 x 20) is too small for 'Checkout' as well; one wide
  // enough for its label still lies inside b.
  const order = (list: XmlNode[]): XmlNode[] => ['pn:root', 'pn:layer', 'ab', 'b', 'a', 'c', 'bc'].map(id => byId(list, id));
  assert.equal(order(inside).length, inside.length);
  assert.equal(outcome('recolor', file(order(inside))), 'text_extent');
  Object.assign(byId(inside, 'a').children[0]!.attrs, { width: '100' });
  assert.equal(outcome('recolor', file(order(inside))), 'boxes_overlap');
  // restyle-flow: l2 inside the large green ellipse l3, the arrow l2 -> l3 before l3.
  const flow = goal('restyle-flow'), [, b, c] = ['a', 'b', 'c'].map(id => flow.objects[id] as StepV2);
  const big = structuredClone(cells(flow));
  Object.assign(byId(big, 'c').children[0]!.attrs, { x: String(b!.x - 40), y: String(b!.y - 40), width: String(b!.width + 80 + 400), height: String(b!.height + 80) });
  assert.equal(outcome('restyle-flow', file(big)), 'boxes_overlap', `${c!.label} grown around ${b!.label}`);
  // Without overlapping boxes the drawn part is what lies outside both end boxes: none between touching
  // boxes, and a loose end inside a filled step, the arrow's own or another, meets it.
  const touching = structuredClone(recolor);
  Object.assign(byId(touching, 'a').children[0]!.attrs, { x: '220', y: '200' });
  assert.equal(outcome('recolor', file(touching)), 'arrow_hidden', 'a touching its partner b: nothing of ab is drawn');
  const loose = structuredClone(recolor), edge = byId(loose, 'bc');
  delete edge.attrs.target;
  edge.children[0]!.children = [{ name: 'mxPoint', attrs: { x: '450', y: '240', as: 'targetPoint' }, children: [] }];
  assert.equal(outcome('recolor', file(loose)), 'arrow_hidden', 'bc ending loose inside filled b');
});

// r3-paint-frame-name-extent: a name with line feeds is drawn below its band, an inverted frame's band is
// never matched; r3-paint-label-overflow: a label wider than its box reaches under a filled neighbour.
test('r3-paint-frame-name-extent and r3-paint-label-overflow: text must stay on one line inside its box or band', () => {
  const renamed = cells(goal('rename-step')), old = start('rename-step');
  const wrong = labelOf(old, step => !Object.values(goal('rename-step').objects).some(o => o.type === 'step' && (o as StepV2).label === step.label));
  // The review's file: a frame named with three line feeds and the misspelling, its band just above the label line.
  assert.equal(outcome('rename-step', file([...renamed, vertexCell('cover', `\n\n\n${wrong}`, OPEN_BAND, { x: 100, y: 207, width: 180, height: 30 })])), 'text_extent');
  // Far from every step: still refused, as is a name wider than its band.
  assert.equal(outcome('rename-step', file([...renamed, vertexCell('cover', `\n${wrong}`, OPEN_BAND, { x: 100, y: 600, width: 400, height: 100 })])), 'text_extent');
  assert.equal(outcome('rename-step', file([...renamed, vertexCell('cover', wrong, OPEN_BAND, { x: 100, y: 600, width: 12 * wrong.length - 1, height: 100 })])), 'text_extent');
  assert.equal(outcome('rename-step', file([...renamed, vertexCell('cover', wrong, OPEN_BAND, { x: 100, y: 600, width: 12 * wrong.length, height: 100 })])), 'passed', 'the estimate fits exactly');
  // A frame of negative size at the label's centre.
  assert.equal(outcome('rename-step', file([...renamed, vertexCell('cover', wrong, OPEN_BAND, { x: 190, y: 245, width: -200, height: -60 })])), 'geometry_invalid');
  // recolor with a shrunk to 2 x 2 beside red b: 'Checkout' would be drawn half under b's fill.
  const recolor = structuredClone(cells(goal('recolor')));
  Object.assign(recolor.find(c => c.attrs.id === 'a')!.children[0]!.attrs, { x: '398', y: '244', width: '2', height: '2' });
  assert.equal(outcome('recolor', file(recolor)), 'text_extent');
});

test('the compressed page reads as draw.io reads it', () => {
  const plain = modelXml(cells(goal('connect'))), packed = deflateRawSync(Buffer.from(encodeURIComponent(plain), 'utf8')).toString('base64');
  assert.equal(outcome('connect', `<mxfile><diagram id="p">${packed}</diagram></mxfile>`), 'passed');
  assert.equal(outcome('connect', `<mxfile><diagram id="p">${packed.slice(0, 8)} ${packed.slice(8)}</diagram></mxfile>`), 'diagram_invalid');
});

// Review m4 (r4-frame-membership-outside): draw.io neither moves nor clips a frame's children, so steps
// parented to the start's empty frames, at their old places, draw like the unsolved start.
test('r4-frame-membership-outside: steps read in a frame but drawn outside it are refused', () => {
  const start2 = cells(start('two-frames')), goalState = goal('two-frames');
  const moved = structuredClone(start2);
  const frameCell = (id: string): XmlNode => moved.find(c => c.attrs.id === id)!;
  for (const step of Object.values(goalState.objects)) {
    if (step.type !== 'step' || step.deleted || step.frameId === null) continue;
    const cell = moved.find(c => c.attrs.id === step.id)!, frame = box(frameCell(step.frameId));
    // The same absolute box as in the start, now relative to the frame it is parented to.
    const was = box(cell);
    cell.attrs.parent = step.frameId;
    Object.assign(cell.children[0]!.attrs, { x: String(was.x - frame.x), y: String(was.y - frame.y) });
  }
  assert.equal(outcome('two-frames', file(start2)), 'failed', 'the unchanged start');
  assert.equal(outcome('two-frames', file(moved)), 'frame_outside', 'the review\'s file: every step drawn outside its frame');
  // Read as the host's own export, it is read as written (that mode compares with the session state).
  assert.equal(outcome('two-frames', file(moved), 'own-export'), 'passed');
});

// Review m4 (r4-arrow-subpixel-gap): an arrow between boxes less than a marker apart, before its filled
// source in the file, lies wholly under the marker, the borders and the source's fill.
test('r4-arrow-subpixel-gap: an arrow needs room for its marker outside its end boxes', () => {
  const recolor = cells(goal('recolor'));
  const at = (x: string): string => {
    const copy = structuredClone(recolor), byId = (id: string): XmlNode => copy.find(c => c.attrs.id === id)!;
    byId('c').children[0]!.attrs.x = x;
    // The review's order: root, layer, bc, a, b, c, ab.
    return file(['pn:root', 'pn:layer', 'bc', 'a', 'b', 'c', 'ab'].map(byId));
  };
  // b spans 400..580: c 0.4, 1 and 6 px after it leaves too little of bc to be seen; 20 px leaves enough.
  for (const x of ['580.4', '581', '586']) assert.equal(outcome('recolor', at(x)), 'arrow_hidden', `c at x=${x}`);
  assert.equal(outcome('recolor', at('600')), 'passed', 'c at x=600');
});

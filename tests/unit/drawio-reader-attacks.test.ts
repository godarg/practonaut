// Review m2c of PR #70: each way a hand-made .drawio file could pass a library goal while draw.io shows
// something else, reproduced on the draw.io library's own tasks, now refused by name. Every file starts
// from the cells the adapter writes for a real state (the start or the reference's end), so the honest
// goal still passes and the unchanged start still fails; only the attack is added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { runOracle } from '../../src/authoring/from-scenes.ts';
import { checkSubmission, CheckerError } from '../../src/checker/index.ts';
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
const outcome = (taskId: string, xml: string): string => {
  try { return checkSubmission(slice(taskId), xml, { seed: seed(taskId), taskId, format: 'drawio' }).passed ? 'passed' : 'failed'; }
  catch (error) { assert.ok(error instanceof CheckerError, String(error)); return String(error.details.reason); }
};
const restyled = (list: XmlNode[], label: string, change: (style: string) => string): XmlNode[] => { const copy = structuredClone(list); const cell = byLabel(copy, label); cell.attrs.style = change(cell.attrs.style!); return copy; };
const labelOf = (state: State, predicate: (step: StepV2) => boolean): string => (Object.values(state.objects).find(o => o.type === 'step' && !o.deleted && predicate(o as StepV2)) as StepV2).label;

test('baselines: the honest goal passes and the unchanged start fails, for every task attacked below', () => {
  for (const taskId of ['connect', 'remove-step', 'reorder', 'rename-step', 'align']) {
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

test('the compressed page reads as draw.io reads it', () => {
  const plain = modelXml(cells(goal('connect'))), packed = deflateRawSync(Buffer.from(encodeURIComponent(plain), 'utf8')).toString('base64');
  assert.equal(outcome('connect', `<mxfile><diagram id="p">${packed}</diagram></mxfile>`), 'passed');
  assert.equal(outcome('connect', `<mxfile><diagram id="p">${packed.slice(0, 8)} ${packed.slice(8)}</diagram></mxfile>`), 'diagram_invalid');
});

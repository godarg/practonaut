// PADR-0049 decisions 4.2 and 5.1: the adapter's writer, its full write check and its integrity check,
// without a browser. Expected cells are derived by hand from the record's mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshMemory, modelXml, writeCells, type XmlNode } from '../../src/adapters/drawio/writer.ts';
import { readBack, writeCheck } from '../../src/adapters/drawio/readback.ts';
import type { State } from '../../src/world/types.ts';
import { stepV2 } from '../support/world-v2.ts';

const state: State = { objects: {
  f1: { id: 'f1', type: 'frame', deleted: false, name: 'Lane' },
  a: stepV2('a', 'Receive', 100, 100, { frameId: 'f1', groupId: 'g1' }),
  b: stepV2('b', 'Check', 400, 100, { frameId: 'f1', groupId: 'g1', shape: 'ellipse', stroke: 'blue', fill: 'blue' }),
  c: stepV2('c', 'Ship', 900, 500),
  gone: stepV2('gone', 'Old', 0, 0, { deleted: true }),
  ab: { id: 'ab', type: 'arrow', deleted: false, frameId: 'f1', from: 'a', to: 'b' },
  loose: { id: 'loose', type: 'arrow', deleted: false, frameId: null, from: 'c', to: null },
} };
const live = (s: State): State['objects'] => Object.fromEntries(Object.entries(s.objects).filter(([, o]) => !o.deleted));
const clone = (cells: XmlNode[]): XmlNode[] => structuredClone(cells);
const cell = (cells: XmlNode[], id: string): XmlNode => cells.find(c => c.attrs.id === id)!;

test('the writer follows the decided mapping: ids, parents, styles, relative integer geometry, no zero x or y', () => {
  const cells = writeCells(state, freshMemory());
  assert.deepEqual(cells.map(c => c.attrs.id), ['pn:root', 'pn:layer', 'f1', 'pn:group:g1', 'a', 'b', 'c', 'ab', 'loose'], 'live objects only; the tombstone has no cell');
  // Frame: envelope of a and b (100..560 x 100..180) plus 20 padding and a 30 title band.
  assert.deepEqual(cell(cells, 'f1').children[0]!.attrs, { x: '80', y: '50', width: '500', height: '150', as: 'geometry' });
  assert.equal(cell(cells, 'f1').attrs.style, 'swimlane;container=1;collapsible=0;startSize=30;html=0;');
  // Group: envelope 100..560 x 100..180, relative to the frame's origin (80, 50).
  assert.deepEqual([cell(cells, 'pn:group:g1').attrs.parent, cell(cells, 'pn:group:g1').attrs.style, cell(cells, 'pn:group:g1').children[0]!.attrs], ['f1', 'group;', { x: '20', y: '50', width: '460', height: '80', as: 'geometry' }]);
  // a sits at the group's origin: x and y are 0 and left out, as draw.io exports them.
  assert.deepEqual(cell(cells, 'a').children[0]!.attrs, { width: '160', height: '80', as: 'geometry' });
  assert.deepEqual([cell(cells, 'a').attrs.parent, cell(cells, 'a').attrs.style], ['pn:group:g1', 'rounded=0;html=0;strokeColor=#000000;fillColor=none;']);
  assert.equal(cell(cells, 'b').attrs.style, 'ellipse;html=0;strokeColor=#6c8ebf;fillColor=#dae8fc;');
  assert.ok(!JSON.stringify(cells).includes('whiteSpace'), 'no whiteSpace=wrap');
  // The loose end keeps a terminal point at the last known centre of its step's end... none known yet: 0, 0.
  assert.deepEqual(cell(cells, 'loose').children[0]!.children.map(p => p.attrs), [{ as: 'targetPoint' }]);
  assert.match(modelXml(cells), /^<mxGraphModel><root><mxCell id="pn:root"\/><mxCell id="pn:layer" parent="pn:root"\/>/);
  assert.match(modelXml(writeCells({ objects: { s: stepV2('s', 'a "b" & <c>\nd', 1, 2) } }, freshMemory())), /value="a &quot;b&quot; &amp; &lt;c&gt;&#xa;d"/);
  assert.throws(() => writeCells({ objects: { a: stepV2('a', 'A', 0, 0, { groupId: 'g' }), b: stepV2('b', 'B', 0, 0, { groupId: 'g', frameId: 'f' }), f: { id: 'f', type: 'frame', deleted: false, name: 'F' } } }, freshMemory()), /spans frames/);
});

test('the derived memory is reset per start: the same state writes the same cells whatever was written before', () => {
  const memory = freshMemory();
  const first = writeCells(state, memory);
  // Move every step out of f1: the empty frame now keeps its last box from memory.
  writeCells({ objects: { ...state.objects, a: { ...state.objects.a!, frameId: null, groupId: null } as never, b: { ...state.objects.b!, frameId: null, groupId: null } as never } }, memory);
  const after = writeCells(state, freshMemory());
  assert.deepEqual(after, first);
});

test('the full write check sees every attribute and child element, including visibility and terminal points', () => {
  const cells = writeCells(state, freshMemory());
  assert.deepEqual(writeCheck(cells, clone(cells)), []);
  const hidden = clone(cells); cell(hidden, 'c').attrs.visible = '0';
  assert.deepEqual(writeCheck(cells, hidden), ['c: came back changed']);
  const moved = clone(cells); cell(moved, 'loose').children[0]!.children[0]!.attrs.x = '999';
  assert.deepEqual(writeCheck(cells, moved), ['loose: came back changed']);
  const collapsed = clone(cells); cell(collapsed, 'f1').attrs.collapsed = '1';
  assert.deepEqual(writeCheck(cells, collapsed), ['f1: came back changed']);
  assert.deepEqual(writeCheck(cells, clone(cells).filter(c => c.attrs.id !== 'b')), ['b: written, not read back']);
  assert.deepEqual(writeCheck(cells, [...clone(cells), { name: 'mxCell', attrs: { id: 'x', parent: 'pn:layer' }, children: [] }]), ['x: read back, not written']);
});

test('integrity: a live group passes; markup, foreign styles, cycles, edge parents and constraint breaches do not', () => {
  const cells = writeCells(state, freshMemory());
  const back = readBack(clone(cells));
  assert.deepEqual(back.issues, [], 'the group cell has no html key: absent counts as 0');
  assert.deepEqual(back.state.objects, live(state));
  const issue = (mutate: (cells: XmlNode[]) => void, pattern: RegExp): void => { const c = clone(cells); mutate(c); assert.ok(readBack(c).issues.some(i => pattern.test(i)), String(pattern)); };
  issue(c => { cell(c, 'c').attrs.style = 'rounded=0;html=1;strokeColor=#000000;fillColor=none;'; }, /html=1/);
  issue(c => { cell(c, 'c').attrs.style = 'cloud;html=0;'; }, /does not write/);
  issue(c => { cell(c, 'c').attrs.style = 'rounded=0;html=0;strokeColor=#123456;fillColor=none;'; }, /colour/);
  issue(c => { cell(c, 'c').attrs.parent = 'ab'; }, /is the parent of c/);
  issue(c => { cell(c, 'f1').attrs.parent = 'a'; }, /cycle/);
  issue(c => { cell(c, 'c').attrs.parent = 'nowhere'; }, /missing parent/);
  issue(c => { cell(c, 'c').children[0]!.attrs.x = '10.5'; }, /not an integer/);
  issue(c => { cell(c, 'ab').attrs.target = 'f1'; }, /not a step/);
  // A second frame inside the group, holding b: the group g1 now spans f1 and f2, which world/2 refuses for draw.io.
  issue(c => { c.push({ name: 'mxCell', attrs: { id: 'f2', value: 'Inner', style: 'swimlane;container=1;collapsible=0;startSize=30;html=0;', vertex: '1', parent: 'pn:group:g1' }, children: [{ name: 'mxGeometry', attrs: { x: '300', width: '200', height: '120', as: 'geometry' }, children: [] }] }); cell(c, 'b').attrs.parent = 'f2'; }, /constraint group-within-one-frame/);
  issue(c => { c.push({ ...clone([cell(c, 'c')])[0]! }); }, /duplicate id c/);
});

test('integrity sees every attribute and child the adapter does not write, so a hidden cell is never read as live (review m2c, Codex 3)', () => {
  const cells = writeCells(state, freshMemory());
  const issue = (mutate: (cells: XmlNode[]) => void, pattern: RegExp): void => { const c = clone(cells); mutate(c); assert.ok(readBack(c).issues.some(i => pattern.test(i)), String(pattern)); };
  issue(c => { cell(c, 'c').attrs.visible = '0'; }, /does not write: visible on c/);
  issue(c => { cell(c, 'f1').attrs.collapsed = '1'; }, /does not write: collapsed on f1/);
  issue(c => { cell(c, 'pn:layer').attrs.visible = '0'; }, /visible on pn:layer/);
  issue(c => { cell(c, 'c').children.unshift({ name: 'add', attrs: { as: 'value', value: 'Other' }, children: [] }); }, /child the adapter does not write on c/);
  issue(c => { cell(c, 'c').children[0]!.attrs.relative = '1'; }, /geometry attribute the adapter does not write: relative on c/);
  issue(c => { cell(c, 'ab').children[0]!.attrs.relative = '0'; }, /not relative on ab/);
  issue(c => { cell(c, 'loose').children[0]!.children.push({ name: 'Array', attrs: { as: 'points' }, children: [] }); }, /point the adapter does not write on loose/);
  issue(c => { cell(c, 'c').children[0]!.children.push({ name: 'mxPoint', attrs: { as: 'offset' }, children: [] }); }, /point the adapter does not write on c/);
});

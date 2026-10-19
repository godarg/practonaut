// PADR-0049 decision 6: the checker's own `.drawio` reader. Every fixture is written by hand from the
// draw.io file format; the expected states are derived from the record's reading rules, not from the
// reader. Each refusal is asserted by its reason. Differential fixtures through the real app are in
// tests/adapter/drawio/cases.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseDrawio, DRAWIO_MARKERS } from '../../src/checker/drawio.ts';
import { CheckerError, checkSubmission, NATIVE_FORMATS } from '../../src/checker/index.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { stepV2, v2Task } from '../support/world-v2.ts';

const ROOTS = '<mxCell id="0"/><mxCell id="1" parent="0"/>';
const model = (cells: string, roots = ROOTS): string => `<mxGraphModel><root>${roots}${cells}</root></mxGraphModel>`;
const file = (cells: string): string => `<mxfile host="x"><diagram id="p" name="Page-1">${model(cells)}</diagram></mxfile>`;
const geo = (x: number | string, y: number | string, w = 160, h = 80, extra = ''): string => `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"${extra}/>`;
const vertex = (id: string, value: string, style = '', parent = '1', g = geo(10, 20), more = ''): string => `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"${more}>${g}</mxCell>`;
const edge = (id: string, source: string | null, target: string | null, style = '', parent = '1', value = ''): string => `<mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="${parent}"${source ? ` source="${source}"` : ''}${target ? ` target="${target}"` : ''}><mxGeometry relative="1" as="geometry"/></mxCell>`;
const reason = (expected: string) => (error: unknown): boolean => error instanceof CheckerError && error.code === 'artifact_invalid' && error.details.reason === expected;
const read = (cells: string) => parseDrawio(file(cells));

test('steps, frames, groups and arrows are read by the record\'s rules, plain, compressed and bare', () => {
  const cells = vertex('f1', 'Lane', 'swimlane;container=1;collapsible=0;startSize=30;html=0;', '1', geo(100, 50, 600, 300))
    + vertex('pn:group:g1', '', 'group;', 'f1', geo(20, 50, 420, 80))
    + vertex('a', 'Receive', 'rounded=0;html=0;strokeColor=#000000;fillColor=none;', 'pn:group:g1', '<mxGeometry width="160" height="80" as="geometry"/>')
    + vertex('b', 'Check', 'ellipse;html=0;strokeColor=#6C8EBF;fillColor=#dae8fc;', 'pn:group:g1', geo(260, 0))
    + vertex('c', 'Ship', 'rhombus;strokeColor=#b85450;fillColor=#fff2cc;', '1', geo(900, 900))
    + edge('ab', 'a', 'b', 'endArrow=classic;html=0;', 'f1') + edge('ac', 'a', 'c', '', '1');
  // Hand-derived: absolute = own + every ancestor vertex's x/y; frame and group by the parent chain.
  const expected = { objects: {
    f1: { id: 'f1', type: 'frame', deleted: false, name: 'Lane' },
    a: stepV2('a', 'Receive', 120, 100, { frameId: 'f1', groupId: 'g1' }),
    b: stepV2('b', 'Check', 380, 100, { frameId: 'f1', groupId: 'g1', shape: 'ellipse', stroke: 'blue', fill: 'blue' }),
    c: stepV2('c', 'Ship', 900, 900, { shape: 'diamond', stroke: 'red', fill: 'yellow' }),
    ab: { id: 'ab', type: 'arrow', deleted: false, frameId: 'f1', from: 'a', to: 'b' },
    ac: { id: 'ac', type: 'arrow', deleted: false, frameId: null, from: 'a', to: 'c' },
  } };
  assert.deepEqual(read(cells).state, expected);
  assert.deepEqual(parseDrawio(model(cells)).state, expected, 'a bare model');
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(model(cells)), 'latin1')).toString('base64');
  assert.deepEqual(parseDrawio(`<mxfile><diagram id="p">\n  ${packed}\n</diagram></mxfile>`).state, expected, 'a compressed page');
});

test('XML is read as XML: CRLF, separators, character references, DOCTYPE', () => {
  // A literal CRLF inside an attribute is one line feed, then one space (end-of-line handling first).
  assert.equal(read(vertex('a', 'x\r\ny')).state.objects.a!.type === 'step' && (read(vertex('a', 'x\r\ny')).state.objects.a as { label: string }).label, 'x y');
  assert.equal((read(vertex('a', 'x&#xa;y')).state.objects.a as { label: string }).label, 'x\ny', 'a referenced line feed stays');
  assert.throws(() => parseDrawio(file('<mxCell id="a"vertex="1"/>')), reason('xml_invalid'), 'no white space between attributes');
  assert.throws(() => read(vertex('a', 'x&#1;y')), reason('xml_invalid'), '&#1; is no XML character');
  assert.throws(() => read(vertex('a', 'x\u0001y')), reason('xml_invalid'), 'a raw C0 control');
  assert.throws(() => read(vertex('a', 'R&D')), reason('xml_invalid'));
  assert.throws(() => parseDrawio(`<!DOCTYPE m [<!ENTITY e "x">]>${file(vertex('a', '&e;'))}`), reason('xml_doctype'));
  assert.throws(() => parseDrawio('<mxfile><diagram>' + model('') + '</diagram>'), reason('xml_invalid'));
});

test('file and model forms draw.io would read otherwise are refused', () => {
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(model(vertex('b', 'B'))), 'latin1')).toString('base64');
  assert.throws(() => parseDrawio(`<mxfile><diagram>${packed}${model(vertex('a', 'A'))}</diagram></mxfile>`), reason('diagram_invalid'), 'compressed text and a model child');
  assert.throws(() => parseDrawio(`<mxfile><diagram>${model('')}</diagram><diagram>${model('')}</diagram></mxfile>`), reason('pages_unsupported'));
  assert.throws(() => parseDrawio(`<mxfile><diagram>!!notbase64</diagram></mxfile>`), reason('diagram_invalid'));
  assert.throws(() => read(`<mxCell id="a" vertex="1" parent="1">${geo(0, 0)}${geo(500, 0)}</mxCell>`), reason('cell_invalid'), 'two geometries');
  assert.throws(() => read(`<mxCell id="a" vertex="1" parent="1"/>`), reason('cell_invalid'), 'a vertex without geometry');
  assert.throws(() => read(vertex('a', 'A', '', '1', geo('0x1F4', 0))), reason('geometry_invalid'));
  assert.throws(() => read(vertex('a', 'A', '', '1', geo(' ', 0))), reason('geometry_invalid'));
  assert.throws(() => read(vertex('a', 'A').replace('vertex="1"', 'vertex="true"')), reason('cell_invalid'));
  assert.throws(() => read(vertex('a', 'A', '', '1', geo(0, 0), ' visible="false"')), reason('cell_invalid'));
  assert.throws(() => read(vertex('a', 'A') + vertex('a', 'B')), reason('duplicate_id'));
  assert.throws(() => parseDrawio(model(vertex('a', 'A', '', 'nowhere'))), reason('structure_invalid'));
  assert.throws(() => parseDrawio(model(vertex('p', 'P', '', 'q') + vertex('q', 'Q', '', 'p'))), reason('structure_invalid'));
  assert.throws(() => read(edge('e1', null, null) + edge('e2', null, null, '', 'e1')), reason('structure_invalid'), 'an edge under an edge');
  assert.throws(() => read(vertex('a', 'A') + edge('e', 'a', 'ghost')), reason('structure_invalid'));
});

test('hidden and collapsed ancestors hide their descendants; edge labels are classified first', () => {
  const hiddenFrame = vertex('f', 'Lane', 'swimlane;', '1', geo(0, 0, 600, 300), ' visible="0"') + vertex('a', 'A', '', 'f');
  const result = read(hiddenFrame);
  assert.deepEqual(result.state.objects, {});
  assert.deepEqual(result.unmodeled.map(u => [u.id, u.reason]), [['f', 'hidden'], ['a', 'hidden']]);
  assert.deepEqual(Object.keys(read(vertex('g', '', 'group;', '1', geo(0, 0, 200, 100), ' collapsed="1"') + vertex('a', 'A', '', 'g')).state.objects), []);
  assert.deepEqual(Object.keys(parseDrawio(model(vertex('a', 'A'), '<mxCell id="0"/><mxCell id="1" parent="0" visible="0"/>')).state.objects), [], 'a hidden layer');
  const labelled = read(vertex('a', 'A') + vertex('b', 'B', '', '1', geo(400, 0)) + edge('e', 'a', 'b') + `<mxCell id="lbl" value="yes" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e"><mxGeometry relative="1" as="geometry"/></mxCell>`);
  assert.deepEqual(labelled.unmodeled, [{ id: 'lbl', reason: 'edge_label' }]);
  assert.equal(Object.keys(labelled.state.objects).length, 3);
});

test('the effective shape is decided before classification; arrow markers only from the pin\'s list', () => {
  for (const style of ['ellipse;rhombus;', 'ellipse;shape=rhombus;', 'shape=ellipse;rhombus;', 'swimlane;shape=ellipse;', 'rhombus;container=1;']) assert.throws(() => read(vertex('a', 'A', style)), reason('unmodeled_value'), style);
  assert.equal((read(vertex('a', 'A', 'shape=rhombus;')).state.objects.a as { shape: string }).shape, 'diamond');
  assert.equal((read(vertex('a', 'A', 'rounded=1;')).state.objects.a as { shape: string }).shape, 'rectangle');
  assert.deepEqual(read(vertex('t', 'note', 'text;html=0;')).unmodeled, [{ id: 't', reason: 'other_shape' }]);
  assert.equal(read(vertex('f', 'Lane', 'container=1;', '1', geo(0, 0, 400, 200))).state.objects.f!.type, 'frame');
  const two = vertex('a', 'A') + vertex('b', 'B', '', '1', geo(400, 0));
  const ends = (style: string) => { const arrow = read(two + edge('e', 'a', 'b', style)).state.objects.e as { from: string; to: string }; return [arrow.from, arrow.to]; };
  assert.deepEqual(ends(''), ['a', 'b'], 'draw.io draws a head at the end by default');
  assert.deepEqual(ends('startArrow=classic;endArrow=none;'), ['b', 'a'], 'a single head at the start reverses the ends');
  assert.deepEqual(ends('startArrow=classic;endArrow=;'), ['b', 'a'], 'an empty end marker is none');
  assert.deepEqual(ends('startArrow=classic;endArrow=classic;'), ['a', 'b']);
  assert.throws(() => read(two + edge('e', 'a', 'b', 'startArrow=bogus;endArrow=none;')), reason('unmodeled_value'));
  assert.throws(() => read(two + edge('e', 'a', 'b', 'endArrow=bogus;')), reason('unmodeled_value'));
  assert.ok(DRAWIO_MARKERS.includes('classic'));
});

test('groups: the outermost below the frame, injective over group cells; groups of frames give no step a group', () => {
  const nested = vertex('outer', '', 'group;', '1', geo(0, 0, 500, 200)) + vertex('inner', '', 'group;', 'outer', geo(0, 0, 400, 100)) + vertex('a', 'A', '', 'inner', geo(0, 0));
  assert.equal((read(nested).state.objects.a as { groupId: string }).groupId, 'outer');
  assert.throws(() => read(vertex('g1', '', 'group;', '1', geo(0, 0, 500, 100)) + vertex('pn:group:g1', '', 'group;', '1', geo(0, 200, 500, 100)) + vertex('a', 'A', '', 'g1') + vertex('b', 'B', '', 'pn:group:g1')), reason('duplicate_id'));
  const framesGrouped = vertex('gf', '', 'group;', '1', geo(0, 0, 1000, 500)) + vertex('f1', 'One', 'swimlane;', 'gf', geo(0, 0, 400, 300)) + vertex('f2', 'Two', 'swimlane;', 'gf', geo(500, 0, 400, 300)) + vertex('a', 'A', '', 'f1') + vertex('b', 'B', '', 'f2');
  const result = read(framesGrouped);
  assert.deepEqual([(result.state.objects.a as { groupId: unknown }).groupId, (result.state.objects.b as { groupId: unknown }).groupId], [null, null]);
  assert.ok(result.unmodeled.some(u => u.id === 'gf' && u.reason === 'group_of_frames'));
  // Derived ids for ids outside the semantic pattern stay distinct and stable.
  const derived = read(vertex('jK8-x2_y:1', 'A')).state.objects;
  assert.match(Object.keys(derived)[0]!, /^s-[0-9a-f]{40}$/);
});

test('labels, colours and geometry: plain text only, no snapped colours, positive integer boxes', () => {
  assert.equal((read(vertex('a', 'Plain', 'html=1;')).state.objects.a as { label: string }).label, 'Plain');
  for (const value of [' A ', 'A  B', 'a&lt;b&gt;', 'x&amp;y', 'a&#xa;b']) assert.throws(() => read(vertex('a', value, 'html=1;')), reason('markup_label'), value);
  assert.throws(() => read(`<object id="a" label="%name%" placeholders="1" name="X"><mxCell vertex="1" parent="1">${geo(0, 0)}</mxCell></object>`), reason('markup_label'));
  assert.deepEqual(read(`<object id="a" label="A" owner="x"><mxCell vertex="1" parent="1">${geo(0, 0)}</mxCell></object>`).unmodeled, [{ id: 'a', reason: 'data_attributes' }]);
  assert.throws(() => read(vertex('a', 'x​y')), reason('text_invalid'), 'an invisible format character');
  assert.equal((read(vertex('a', 'Café')).state.objects.a as { label: string }).label, 'Café', 'compared after NFC');
  assert.throws(() => read(vertex('a', 'A', 'fillColor=#ffffff;')), reason('unmodeled_value'));
  assert.throws(() => read(vertex('a', 'A', 'strokeColor=default;')), reason('unmodeled_value'));
  assert.throws(() => read(vertex('a', 'A', '', '1', geo(0, 0, 0, 80))), reason('geometry_invalid'));
  assert.throws(() => read(vertex('g', '', 'group;', '1', '<mxGeometry relative="1" as="geometry"/>') + vertex('a', 'A', '', 'g')), reason('geometry_invalid'));
  // Rounded by edges: 0.5..11.0 and 11..21 touch (PADR-0047 decision 10's fixture).
  const touching = read(vertex('a', 'A', '', '1', geo(0.5, 0, 10.5, 10)) + vertex('b', 'B', '', '1', geo(11, 0, 10, 10))).state.objects as Record<string, { x: number; width: number }>;
  assert.deepEqual([touching.a!.x, touching.a!.x + touching.a!.width, touching.b!.x, touching.b!.x + touching.b!.width], [1, 11, 11, 21]);
  assert.throws(() => read(vertex('a', 'A', '', '1', geo(999_999, 0, 160, 80))), reason('geometry_invalid'));
});

test('limits are enforced by name', () => {
  assert.throws(() => parseDrawio('<a>' + 'x'.repeat(10 * 1024 * 1024) + '</a>'), reason('too_large'));
  assert.throws(() => read(Array.from({ length: 5_001 }, (_, i) => `<mxCell id="c${i}" parent="1"/>`).join('')), reason('too_large'));
  assert.throws(() => parseDrawio('<a>'.repeat(65) + '</a>'.repeat(65)), reason('too_large'));
  // A compressed page that inflates past 10 MiB stops inside the inflation, not after it.
  const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)).toString('base64');
  assert.throws(() => parseDrawio(`<mxfile><diagram id="p">${bomb}</diagram></mxfile>`), reason('diagram_invalid'));
});

test('the format table reads .drawio for draw.io worlds and judges with counter-probes', () => {
  const world = validateWorld({ schema: 'practonaut.world/2', id: 'reader', version: '1.0.0', app: { adapterId: 'drawio', versionRange: '32.4.1' }, initialState: { objects: { a: stepV2('a', 'Receive', 10, 20), b: stepV2('b', 'Check', 400, 20), c: stepV2('c', 'Ship', 800, 20) } }, tasks: [v2Task()], provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' } });
  const cells = vertex('a', 'Receive', '', '1', geo(10, 20)) + vertex('b', 'Check', '', '1', geo(400, 20)) + vertex('c', 'Ship', '', '1', geo(800, 20));
  assert.equal(checkSubmission(world, file(cells + edge('e1', 'a', 'b') + edge('e2', 'b', 'c')), { taskId: 'T1', format: 'drawio' }).passed, true);
  assert.equal(checkSubmission(world, file(cells + edge('e1', 'a', 'b')), { taskId: 'T1' }).passed, false);
  assert.equal(NATIVE_FORMATS.drawio.matches(world.schema, file(cells), world.initialState), true);
  assert.throws(() => checkSubmission(world, JSON.stringify({ type: 'excalidraw', elements: [] }), { taskId: 'T1', format: 'excalidraw' }), (error: unknown) => error instanceof CheckerError && error.code === 'artifact_invalid');
});

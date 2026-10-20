// PADR-0049 decision 6 (allowlist-based after review m2c): the checker's own `.drawio` reader. It reads
// exactly the adapter's vocabulary and refuses everything else. Every fixture is written by hand from the
// draw.io file format; the expected states are derived from the record's reading rules, not from the
// reader. Each refusal is asserted by its reason, which is always one of the closed list. Differential
// fixtures through the real app are in tests/adapter/drawio/cases.test.ts; the review's attacks on the
// library tasks are in tests/unit/drawio-reader-attacks.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseDrawio, DRAWIO_MARKERS, DRAWIO_REFUSALS } from '../../src/checker/drawio.ts';
import { CheckerError, checkSubmission, NATIVE_FORMATS } from '../../src/checker/index.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { stepV2, v2Task } from '../support/world-v2.ts';

const ROOTS = '<mxCell id="0"/><mxCell id="1" parent="0"/>';
const STEP = 'rounded=0;html=0;strokeColor=#000000;fillColor=none;';
const FRAME = 'swimlane;container=1;collapsible=0;startSize=30;fillColor=none;html=0;';
const model = (cells: string, roots = ROOTS): string => `<mxGraphModel><root>${roots}${cells}</root></mxGraphModel>`;
const file = (cells: string): string => `<mxfile host="x"><diagram id="p" name="Page-1">${model(cells)}</diagram></mxfile>`;
const geo = (x: number | string, y: number | string, w: number | string = 160, h: number | string = 80, extra = ''): string => `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"${extra}/>`;
const vertex = (id: string, value: string, style = STEP, parent = '1', g = geo(10, 20), more = ''): string => `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"${more}>${g}</mxCell>`;
const group = (id: string, parent = '1', g = geo(0, 0, 500, 200)): string => `<mxCell id="${id}" value="" style="group;" vertex="1" connectable="0" parent="${parent}">${g}</mxCell>`;
const edge = (id: string, source: string | null, target: string | null, style = 'endArrow=classic;html=0;', parent = '1', value = '', points = ''): string => `<mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="${parent}"${source ? ` source="${source}"` : ''}${target ? ` target="${target}"` : ''}><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`;
const reason = (expected: string) => (error: unknown): boolean => error instanceof CheckerError && error.code === 'artifact_invalid' && error.details.reason === expected;
const read = (cells: string) => parseDrawio(file(cells));
/** The host's own export (PADR-0049 decision 6.8): read as written, with no submission refusals. */
const own = (cells: string) => parseDrawio(file(cells), 'own-export');
const two = vertex('a', 'A') + vertex('b', 'B', STEP, '1', geo(400, 0));

test('steps, frames, groups and arrows are read by the record\'s rules, plain, compressed and bare', () => {
  const cells = vertex('f1', 'Lane', FRAME, '1', geo(100, 50, 600, 300))
    + group('pn:group:g1', 'f1', geo(20, 50, 420, 80))
    + vertex('a', 'Receive', STEP, 'pn:group:g1', '<mxGeometry width="160" height="80" as="geometry"/>')
    + vertex('b', 'Check', 'ellipse;html=0;strokeColor=#6C8EBF;fillColor=#dae8fc;', 'pn:group:g1', geo(260, 0))
    + vertex('c', 'Ship', 'rhombus;strokeColor=#b85450;fillColor=#fff2cc;', '1', geo(900, 900))
    + edge('ab', 'a', 'b', 'endArrow=classic;html=0;', 'f1') + edge('ac', 'a', 'c', '', '1')
    + edge('loose', 'c', null, 'endArrow=classic;html=0;', '1', '', '<mxPoint x="20" y="40" as="targetPoint"/>');
  // Hand-derived: absolute = own + every ancestor's x/y, root first; frame and group by the parent chain.
  const expected = { objects: {
    f1: { id: 'f1', type: 'frame', deleted: false, name: 'Lane' },
    a: stepV2('a', 'Receive', 120, 100, { frameId: 'f1', groupId: 'g1' }),
    b: stepV2('b', 'Check', 380, 100, { frameId: 'f1', groupId: 'g1', shape: 'ellipse', stroke: 'blue', fill: 'blue' }),
    c: stepV2('c', 'Ship', 900, 900, { shape: 'diamond', stroke: 'red', fill: 'yellow' }),
    ab: { id: 'ab', type: 'arrow', deleted: false, frameId: 'f1', from: 'a', to: 'b' },
    ac: { id: 'ac', type: 'arrow', deleted: false, frameId: null, from: 'a', to: 'c' },
    loose: { id: 'loose', type: 'arrow', deleted: false, frameId: null, from: 'c', to: null },
  } };
  assert.deepEqual(read(cells).state, expected);
  assert.deepEqual(parseDrawio(model(cells)).state, expected, 'a bare model');
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(model(cells)), 'utf8')).toString('base64');
  assert.deepEqual(parseDrawio(`<mxfile><diagram id="p">\n  ${packed}\n</diagram></mxfile>`).state, expected, 'a compressed page');
  assert.deepEqual(parseDrawio(`<?xml version="1.0" encoding="UTF-8"?>\n<!-- a comment -->\n${file(cells)}`).state, expected, 'a declaration at the start and a comment');
});

test('XML is read as XML: well-formed, no namespaces, no DOCTYPE', () => {
  // A literal CRLF inside an attribute is one line feed, then one space (end-of-line handling first).
  assert.equal((read(vertex('a', 'x\r\ny')).state.objects.a as { label: string }).label, 'x y');
  assert.equal((own(vertex('a', 'x&#xa;y')).state.objects.a as { label: string }).label, 'x\ny', 'a referenced line feed stays');
  assert.throws(() => read(vertex('a', 'x&#xa;y')), reason('text_extent'), 'and is refused in a file from outside a session');
  assert.throws(() => parseDrawio(file('<mxCell id="a"vertex="1"/>')), reason('xml_invalid'), 'no white space between attributes');
  assert.throws(() => read(vertex('a', 'x&#1;y')), reason('xml_invalid'), '&#1; is no XML character');
  assert.throws(() => read(vertex('a', 'x\u0001y')), reason('xml_invalid'), 'a raw C0 control');
  assert.throws(() => read(vertex('a', 'R&D')), reason('xml_invalid'));
  assert.throws(() => parseDrawio(`<!DOCTYPE m [<!ENTITY e "x">]>${file(vertex('a', '&e;'))}`), reason('xml_doctype'));
  assert.throws(() => parseDrawio('<mxfile><diagram>' + model('') + '</diagram>'), reason('xml_invalid'));
  // Review m2c: forms an XML parser refuses.
  assert.throws(() => parseDrawio(file(vertex('a', 'A')).replace('<root>', '<root><!-- a--b -->')), reason('xml_invalid'), '-- in a comment');
  assert.throws(() => parseDrawio(file(vertex('a', 'A')).replace('<root>', '<root><!-- a --->')), reason('xml_invalid'), 'a comment ending in ---');
  assert.throws(() => parseDrawio(file(vertex('a', 'A')).replace('<root>', '<root>]]>')), reason('xml_invalid'), ']]> in content');
  assert.throws(() => parseDrawio(`<!-- c --><?xml version="1.0"?>${file(vertex('a', 'A'))}`), reason('xml_invalid'), 'a declaration after a comment');
  assert.throws(() => parseDrawio(`<?xml version="1.0"?><?xml version="1.0"?>${file(vertex('a', 'A'))}`), reason('xml_invalid'), 'a second declaration');
  assert.throws(() => parseDrawio(`<?other x?>${file(vertex('a', 'A'))}`), reason('xml_invalid'), 'another processing instruction');
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(0, 0), ' x:y="1"')), reason('xml_invalid'), 'an undeclared prefix');
  assert.throws(() => parseDrawio(file(vertex('a', 'A')).replace('<mxfile', '<x:mxfile').replace('</mxfile>', '</x:mxfile>')), reason('xml_invalid'), 'a prefixed element');
});

test('the compressed page is decoded as draw.io decodes it: ASCII white space only, UTF-8', () => {
  const cells = vertex('a', 'Café');
  const packed = (text: string): string => deflateRawSync(Buffer.from(text, 'utf8')).toString('base64');
  // Raw (not %-encoded) UTF-8 in the inflated page is UTF-8, as pako's to:'string' decodes it.
  assert.equal((parseDrawio(`<mxfile><diagram id="p">${packed(model(cells))}</diagram></mxfile>`).state.objects.a as { label: string }).label, 'Café');
  const latin1 = deflateRawSync(Buffer.from(model(cells), 'latin1')).toString('base64');
  assert.throws(() => parseDrawio(`<mxfile><diagram id="p">${latin1}</diagram></mxfile>`), reason('diagram_invalid'), 'bytes that are not UTF-8');
  const encoded = packed(encodeURIComponent(model(cells)));
  assert.throws(() => parseDrawio(`<mxfile><diagram id="p">${encoded.slice(0, 8)} ${encoded.slice(8)}</diagram></mxfile>`), reason('diagram_invalid'), 'a no-break space, which atob refuses');
});

test('file and model forms draw.io would read otherwise are refused', () => {
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(model(vertex('b', 'B'))), 'utf8')).toString('base64');
  assert.throws(() => parseDrawio(`<mxfile><diagram>${packed}${model(vertex('a', 'A'))}</diagram></mxfile>`), reason('diagram_invalid'), 'compressed text and a model child');
  assert.throws(() => parseDrawio(`<mxfile><diagram>${model('')}</diagram><diagram>${model('')}</diagram></mxfile>`), reason('pages_unsupported'));
  assert.throws(() => parseDrawio(`<mxfile><diagram>!!notbase64</diagram></mxfile>`), reason('diagram_invalid'));
  assert.throws(() => read(`<mxCell id="a" value="A" style="${STEP}" vertex="1" parent="1">${geo(0, 0)}${geo(500, 0)}</mxCell>`), reason('cell_invalid'), 'two geometries');
  assert.throws(() => read(`<mxCell id="a" value="A" style="${STEP}" vertex="1" parent="1"/>`), reason('cell_invalid'), 'a vertex without geometry');
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo('0x1F4', 0))), reason('geometry_invalid'));
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(' ', 0))), reason('geometry_invalid'));
  assert.throws(() => read(vertex('a', 'A').replace('vertex="1"', 'vertex="true"')), reason('cell_invalid'));
  assert.throws(() => read(vertex('a', 'A').replace('vertex="1"', 'vertex="0"')), reason('cell_invalid'), 'only 1 or absent');
  assert.throws(() => read(vertex('a', 'A') + vertex('a', 'B')), reason('duplicate_id'));
  assert.throws(() => parseDrawio(model(vertex('a', 'A', STEP, 'nowhere'))), reason('structure_invalid'));
  assert.throws(() => parseDrawio(model(vertex('p', 'P', STEP, 'q') + vertex('q', 'Q', STEP, 'p'))), reason('structure_invalid'));
  assert.throws(() => read(edge('e1', null, null) + edge('e2', null, null, 'endArrow=classic;html=0;', 'e1')), reason('structure_invalid'), 'an edge under an edge');
  assert.throws(() => read(vertex('a', 'A') + edge('e', 'a', 'ghost')), reason('structure_invalid'), 'a missing end');
  assert.throws(() => read(vertex('f', 'F', FRAME, '1', geo(0, 0, 400, 200)) + vertex('a', 'A') + edge('e', 'a', 'f')), reason('structure_invalid'), 'an end that is not a step');
});

test('only the adapter\'s cells, attributes and places: anything else is refused, never skipped', () => {
  // Visibility, collapsing and any other cell attribute.
  for (const more of [' visible="0"', ' visible="1"', ' collapsed="1"', ' tooltip="x"', ' link="data:x"']) assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(0, 0), more)), reason('unmodeled_value'), more);
  assert.throws(() => parseDrawio(model(vertex('a', 'A'), '<mxCell id="0"/><mxCell id="1" parent="0" visible="0"/>')), reason('unmodeled_value'), 'a hidden layer');
  assert.throws(() => parseDrawio(model(vertex('a', 'A'), '<mxCell id="0"/><mxCell id="1" parent="0"><mxGeometry x="5000" as="geometry"/></mxCell>')), reason('structure_invalid'), 'a layer that carries an offset');
  // A vertex in place of a layer; a plain cell (neither vertex nor edge) below a layer.
  assert.throws(() => read(vertex('a', 'A', STEP, '0')), reason('structure_invalid'), 'a vertex under the root');
  assert.throws(() => read(`<mxCell id="p" parent="1"><mxGeometry x="300" as="geometry"/></mxCell>` + vertex('a', 'A', STEP, 'p')), reason('structure_invalid'), 'a plain cell with an offset');
  assert.throws(() => read(`<mxCell id="p" parent="1"/>` + vertex('a', 'A', STEP, 'p')), reason('structure_invalid'), 'a plain cell');
  // Places: frames on a layer, groups on a layer or in a frame, steps in a group at most, edges not in groups.
  assert.throws(() => read(group('g') + vertex('f', 'F', FRAME, 'g', geo(0, 0, 400, 200)) + vertex('a', 'A', STEP, 'f')), reason('structure_invalid'), 'a group of frames');
  assert.throws(() => read(vertex('f', 'F', FRAME, '1', geo(0, 0, 400, 200)) + vertex('f2', 'G', FRAME, 'f', geo(0, 0, 200, 100))), reason('structure_invalid'), 'a nested frame');
  assert.throws(() => read(group('outer') + group('inner', 'outer') + vertex('a', 'A', STEP, 'inner')), reason('structure_invalid'), 'a group in a group');
  assert.throws(() => read(vertex('a', 'A') + vertex('l', 'yes', STEP, 'e', geo(0, 0)) + vertex('b', 'B', STEP, '1', geo(400, 0)) + edge('e', 'a', 'b')), reason('structure_invalid'), 'an edge label');
  assert.throws(() => read(group('g') + vertex('a', 'A', STEP, 'g') + vertex('b', 'B', STEP, 'g', geo(300, 0)) + edge('e', 'a', 'b', 'endArrow=classic;html=0;', 'g')), reason('structure_invalid'), 'an edge in a group');
  // Children other than one geometry: value and style children, waypoints, points on a vertex.
  assert.throws(() => read(`<mxCell id="a" value="A" style="${STEP}" vertex="1" parent="1"><add as="value" value="B"/>${geo(0, 0)}</mxCell>`), reason('cell_invalid'));
  assert.throws(() => read(two + edge('e', 'a', 'b', 'endArrow=classic;html=0;', '1', '', '<Array as="points"><mxPoint x="1" y="2"/></Array>')), reason('cell_invalid'), 'waypoints');
  assert.throws(() => read(vertex('a', 'A', STEP, '1', '<mxGeometry width="160" height="80" as="geometry"><mxPoint as="offset"/></mxGeometry>')), reason('cell_invalid'));
  // Geometry: no relative vertex, edges exactly relative="1", no other geometry attribute.
  for (const value of ['1', 'true', '1.0', '0']) assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(0, 0, 160, 80, ` relative="${value}"`))), reason('unmodeled_value'), `relative=${value} on a vertex`);
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(0, 0, 160, 80, ' rotation="3"'))), reason('unmodeled_value'));
  assert.throws(() => read(two + `<mxCell id="e" value="" style="endArrow=classic;html=0;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="true" as="geometry"/></mxCell>`), reason('geometry_invalid'));
  // Objects: an id and a label; the inner cell holds no value (draw.io shows the inner value) and no id.
  assert.equal((read(`<object id="a" label="A"><mxCell style="${STEP}" vertex="1" parent="1">${geo(0, 0)}</mxCell></object>`).state.objects.a as { label: string }).label, 'A');
  assert.throws(() => read(`<object id="a" label="A"><mxCell value="B" style="${STEP}" vertex="1" parent="1">${geo(0, 0)}</mxCell></object>`), reason('cell_invalid'));
  for (const more of [' owner="x"', ' placeholders="1"', ' tooltip="t"']) assert.throws(() => read(`<object id="a" label="A"${more}><mxCell style="${STEP}" vertex="1" parent="1">${geo(0, 0)}</mxCell></object>`), reason('unmodeled_value'), more);
});

test('styles: only the adapter\'s names, keys and values; one head per arrow', () => {
  // Visually active keys, unknown names and shapes, a dropped default style (leading ;), repeated keys.
  for (const style of [`${STEP}noLabel=1;`, `${STEP}opacity=0;`, `${STEP}textOpacity=0;`, `${STEP}rotation=90;`, `${STEP}perimeter=none;`, `${STEP}whiteSpace=wrap;`, `${STEP}container=1;`,
    `pnbox;${STEP}`, `shape=pnbox;html=0;strokeColor=#000000;fillColor=none;`, `shape=rectangle;html=0;strokeColor=#000000;fillColor=none;`, 'text;html=0;strokeColor=#000000;fillColor=none;', `ellipse;rhombus;html=0;strokeColor=#000000;fillColor=none;`,
    `;${STEP}`, `rounded=0;;html=0;strokeColor=#000000;fillColor=none;`, `rounded=1;html=0;strokeColor=#000000;fillColor=none;`, `ellipse;rounded=0;html=0;strokeColor=#000000;fillColor=none;`, `${STEP}strokeColor=#000000;`,
    'rounded=0;html=0;fillColor=none;', 'rounded=0;html=0;strokeColor=#000000;', 'rounded=0;html=0;strokeColor=default;fillColor=none;', 'rounded=0;html=0;strokeColor=#000000;fillColor=#ffffff;', 'rounded=0;html=0;strokeColor=constructor;fillColor=__proto__;']) {
    assert.throws(() => read(vertex('a', 'A', style)), reason('unmodeled_value'), style);
  }
  assert.throws(() => read(vertex('a', 'A', 'rounded=0;html=1;strokeColor=#000000;fillColor=none;')), reason('markup_label'), 'html=1: the label is markup');
  for (const style of ['swimlane;', 'swimlane;container=1;', `${FRAME}noLabel=1;`, 'swimlane;container=1;collapsible=1;startSize=30;fillColor=none;',
    // A filled title band (draw.io's default, or any colour) could hide what lies under it (review m2d).
    'swimlane;container=1;collapsible=0;startSize=30;html=0;', 'swimlane;container=1;collapsible=0;startSize=30;fillColor=#ffffff;html=0;', `${FRAME}swimlaneFillColor=#ffffff;`]) assert.throws(() => read(vertex('f', 'F', style, '1', geo(0, 0, 400, 200))), reason('unmodeled_value'), style);
  for (const style of ['group;opacity=0;', 'group;html=0;']) assert.throws(() => read(vertex('g', '', style, '1', geo(0, 0, 400, 200), ' connectable="0"')), reason('unmodeled_value'), style);
  assert.throws(() => read(`<mxCell id="g" value="Shown" style="group;" vertex="1" connectable="0" parent="1">${geo(0, 0, 400, 200)}</mxCell>`), reason('unmodeled_value'), 'a group with a label');
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(0, 0), ' connectable="0"')), reason('unmodeled_value'), 'connectable on a step');
  // Edges: markers from the pin's list, html=0, nothing else; exactly one head.
  const ends = (style: string) => { const arrow = read(two + edge('e', 'a', 'b', style)).state.objects.e as { from: string; to: string }; return [arrow.from, arrow.to]; };
  assert.deepEqual(ends(''), ['a', 'b'], 'draw.io draws a head at the end by default');
  assert.deepEqual(ends('endArrow=classic;html=0;'), ['a', 'b']);
  assert.deepEqual(ends('startArrow=classic;endArrow=none;'), ['b', 'a'], 'a single head at the start reverses the ends');
  assert.deepEqual(ends('startArrow=oval;endArrow=;'), ['b', 'a'], 'an empty end marker is none');
  for (const style of ['startArrow=classic;endArrow=classic;', 'endArrow=none;', 'startArrow=none;endArrow=;', 'startArrow=bogus;endArrow=none;', 'endArrow=bogus;', 'endArrow=classic;strokeColor=none;', 'endArrow=classic;opacity=0;', 'endArrow=classic;endSize=0;', 'group;endArrow=classic;', 'text;endArrow=classic;', ';startArrow=classic;html=0;', 'endArrow=classic;html=1;', 'endArrow=classic;edgeStyle=orthogonalEdgeStyle;']) {
    assert.throws(() => read(two + edge('e', 'a', 'b', style)), reason('unmodeled_value'), style);
  }
  assert.throws(() => read(two + edge('e', 'a', 'b', 'endArrow=classic;html=0;', '1', 'label')), reason('unmodeled_value'), 'an edge label value');
  assert.ok(DRAWIO_MARKERS.includes('classic'));
});

test('groups: the step\'s own group, injective over group cells; ids derived where needed', () => {
  assert.equal((read(group('g') + vertex('a', 'A', STEP, 'g')).state.objects.a as { groupId: string }).groupId, 'g');
  assert.throws(() => read(group('g1') + group('pn:group:g1', '1', geo(0, 200, 500, 100)) + vertex('a', 'A', STEP, 'g1') + vertex('b', 'B', STEP, 'pn:group:g1')), reason('duplicate_id'));
  const derived = read(vertex('jK8-x2_y:1', 'A')).state.objects;
  assert.match(Object.keys(derived)[0]!, /^s-[0-9a-f]{40}$/);
});

test('labels, colours and geometry: plain text, no snapped colours, bounded values summed root first', () => {
  assert.throws(() => read(vertex('a', 'x​y')), reason('text_invalid'), 'an invisible format character');
  assert.equal((read(vertex('a', 'Café')).state.objects.a as { label: string }).label, 'Café', 'compared after NFC');
  assert.equal((read(vertex('a', 'A', 'rounded=0;html=0;strokeColor=#6C8EBF;fillColor=#DAE8FC;')).state.objects.a as { stroke: string }).stroke, 'blue', 'colour case does not matter');
  assert.throws(() => read(vertex('a', 'a'.repeat(4_097))), reason('text_invalid'));
  assert.equal(Object.keys(own(vertex('f', 'n'.repeat(256), FRAME, '1', geo(0, 0, 400, 200))).state.objects).length, 1);
  assert.equal(Object.keys(read(vertex('f', 'n'.repeat(256), FRAME, '1', geo(0, 0, 3072, 200))).state.objects).length, 1, 'in a band wide enough for the estimate');
  assert.throws(() => read(vertex('f', 'n'.repeat(257), FRAME, '1', geo(0, 0, 400, 200))), reason('text_invalid'), 'a frame name over 256 characters');
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(0, 0, 0, 80))), reason('geometry_invalid'));
  // Rounded by edges: 0.5..11.0 and 11..21 touch (PADR-0047 decision 10's fixture).
  const touching = own(vertex('a', 'A', STEP, '1', geo(0.5, 0, 10.5, 10)) + vertex('b', 'B', STEP, '1', geo(11, 0, 10, 10))).state.objects as Record<string, { x: number; width: number }>;
  assert.deepEqual([touching.a!.x, touching.a!.x + touching.a!.width, touching.b!.x, touching.b!.x + touching.b!.width], [1, 11, 11, 21]);
  // Each value is bounded on its own, so cancelling ancestors cannot move a box; sums stay within too.
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(999_999, 0, 160, 80))), reason('geometry_invalid'), 'an edge past ±1,000,000');
  assert.throws(() => read(group('g', '1', geo('9223372036854775808', 0)) + vertex('a', 'A', STEP, 'g', geo('-9223372036854775808', 0))), reason('geometry_invalid'));
  assert.throws(() => read(group('g', '1', geo('1e400', 0)) + vertex('a', 'A', STEP, 'g', geo('-1e400', 0))), reason('geometry_invalid'));
  assert.equal((own(vertex('f', 'F', FRAME, '1', geo(600_000, 0, 400, 200)) + group('g', 'f', geo(300_000, 0)) + vertex('a', 'A', STEP, 'g', geo(50_000, 0))).state.objects.a as { x: number }).x, 950_000);
});

test('submission mode models no painting: overlapping boxes, an arrow meeting a filled step and text that may leave its box are refused by name, in any order (review m3)', () => {
  // a at 0..160 x 0..80 (centre 80, 40), b at 400..560 x 0..80 (centre 480, 40): the arrow runs along
  // y = 40 and its drawn part, outside both end boxes, from x = 160 to x = 400.
  const ab = vertex('a', 'A', STEP, '1', geo(0, 0)) + vertex('b', 'B', STEP, '1', geo(400, 0)) + edge('e', 'a', 'b');
  const FILLED = 'rounded=0;html=0;strokeColor=#000000;fillColor=#dae8fc;';
  const cover = (style: string, g = geo(250, 20, 60, 40)) => vertex('c', '', style, '1', g);
  // A filled step over the drawn part: refused whatever the order; an unfilled one, or one beside the line, is read.
  assert.throws(() => read(ab + cover(FILLED)), reason('arrow_hidden'), 'a filled step after the arrow');
  assert.throws(() => read(cover(FILLED) + ab), reason('arrow_hidden'), 'a filled step before the arrow');
  assert.ok(read(ab + cover(STEP)).state.objects.c, 'an unfilled step');
  assert.ok(read(ab + cover(FILLED, geo(250, 45, 60, 40))).state.objects.c, 'a filled step 5 px below the line');
  assert.throws(() => read(ab + cover(FILLED, geo(250, 43, 60, 40))), reason('arrow_hidden'), 'a filled step 3 px below the line: within the marker\'s reach');
  // The drawn part starts and ends on the end steps' boxes: filled end steps cover none of it. Touching end
  // boxes leave nothing to draw; a loose end inside a filled step, or an arrow of no length, draws nothing seen.
  assert.ok(read(vertex('a', 'A', FILLED, '1', geo(0, 0)) + edge('e', 'a', 'b') + vertex('b', 'B', FILLED, '1', geo(400, 0))).state.objects.e, 'filled end steps');
  assert.throws(() => read(vertex('a', 'A', STEP, '1', geo(0, 0)) + vertex('b', 'B', STEP, '1', geo(160, 0)) + edge('e', 'a', 'b')), reason('arrow_hidden'), 'touching end steps');
  assert.throws(() => read(vertex('a', 'A', FILLED, '1', geo(0, 0)) + edge('e', null, 'a', 'endArrow=classic;html=0;', '1', '', '<mxPoint x="20" y="20" as="sourcePoint"/>')), reason('arrow_hidden'), 'from a point inside the filled step it ends at');
  assert.throws(() => read(ab + vertex('d', 'D', FILLED, '1', geo(700, 0)) + edge('l', 'b', null, 'endArrow=classic;html=0;', '1', '', '<mxPoint x="760" y="40" as="targetPoint"/>')), reason('arrow_hidden'), 'to a point inside another filled step');
  assert.throws(() => read(edge('e', null, null, 'endArrow=classic;html=0;', '1', '', '<mxPoint x="5" y="5" as="sourcePoint"/><mxPoint x="5" y="5" as="targetPoint"/>')), reason('arrow_hidden'), 'a loose arrow of no length');
  assert.throws(() => read(vertex('a', 'A') + edge('e', 'a', null)), reason('arrow_hidden'), 'an end with neither a step nor a point: not drawn');
  // Boxes: two steps; a frame's band and a step, named or not; two bands; a frame and a step that is not its own.
  assert.throws(() => read(vertex('a', 'A') + vertex('d', 'D', STEP, '1', geo(100, 50))), reason('boxes_overlap'), 'two steps');
  assert.ok(read(two).state.objects.b, 'two steps apart');
  assert.throws(() => read(ab + vertex('f', '', FRAME, '1', geo(0, 25, 160, 30))), reason('boxes_overlap'), 'an unnamed band over a step');
  assert.ok(read(ab + vertex('f', '', FRAME, '1', geo(250, 25, 100, 30))).state.objects.e, 'an unfilled band over the arrow hides nothing');
  assert.throws(() => read(vertex('f', 'F', FRAME, '1', geo(0, 0, 300, 200)) + vertex('g', 'G', FRAME, '1', geo(100, 10, 300, 200))), reason('boxes_overlap'), 'two bands');
  assert.ok(read(vertex('f', 'F', FRAME, '1', geo(0, 0, 300, 200)) + vertex('g', 'G', FRAME, '1', geo(100, 100, 300, 200))).state.objects.g, 'frames overlapping below their bands');
  assert.throws(() => read(vertex('f', 'Lane', FRAME, '1', geo(-20, -50, 300, 200)) + vertex('a', 'A', STEP, '1', geo(100, 50))), reason('boxes_overlap'), 'a step in a frame it does not belong to');
  assert.ok(read(vertex('f', 'Lane', FRAME, '1', geo(-20, -50, 300, 200)) + vertex('a', 'A', STEP, 'f', geo(120, 100))).state.objects.a, 'the frame\'s own step below its band');
  // Text: one line, estimated 16 px tall and 12 px per UTF-16 code unit, inside its box or band.
  assert.ok(read(vertex('a', 'x'.repeat(13), STEP, '1', geo(0, 0, 156, 16))).state.objects.a, 'the estimate fits exactly');
  assert.throws(() => read(vertex('a', 'x'.repeat(14), STEP, '1', geo(0, 0, 167, 80))), reason('text_extent'), '168 px in 167');
  assert.throws(() => read(vertex('a', 'x', STEP, '1', geo(0, 0, 160, 15))), reason('text_extent'), 'a box lower than one line');
  assert.throws(() => read(vertex('a', 'x&#9;y', STEP, '1', geo(0, 0))), reason('text_extent'), 'a tab');
  assert.throws(() => read(vertex('f', 'x'.repeat(30), FRAME, '1', geo(0, 0, 359, 200))), reason('text_extent'), '360 px in a 359 px band');
  assert.throws(() => read(vertex('f', 'F', FRAME, '1', geo(0, 0, 300, 15))), reason('text_extent'), 'a frame lower than one line');
  assert.ok(read(vertex('f', 'x'.repeat(30), FRAME, '1', geo(0, 0, 360, 16))).state.objects.f, 'a name that fits its band');
  // Sizes that are not positive, in both modes.
  for (const g of [geo(0, 0, -300, 200), geo(0, 0, 300, 0)]) for (const mode of ['submission', 'own-export'] as const) assert.throws(() => parseDrawio(file(vertex('f', 'F', FRAME, '1', g)), mode), reason('geometry_invalid'), mode);
  // The host's own export is read as written: none of the above applies to it.
  assert.ok(own(ab + cover(FILLED)).state.objects.c);
  assert.ok(own(vertex('a', 'A') + vertex('d', 'D', STEP, '1', geo(100, 50))).state.objects.d);
  assert.ok(own(ab + vertex('f', 'Other', FRAME, '1', geo(0, 25, 160, 30))).state.objects.f);
  assert.throws(() => parseDrawio(file(ab), 'checked' as never), (error: unknown) => error instanceof CheckerError && error.code === 'checker_invalid', 'an unknown mode');
});

// Final check of PR #70: every submission-mode threshold is met within DRAWIO_GEOMETRY_TOLERANCE, so a
// distance of exactly the threshold passes however its decimal coordinates round, and anything a tenth
// of a pixel short is refused (PADR-0049 decision 6.8). The arrow's length is in drawio-reader-attacks.
const FILLED_STEP = 'rounded=0;html=0;strokeColor=#000000;fillColor=#dae8fc;';
test('submission mode: a filled step exactly 4 px from an arrow keeps the clearance; 3.9 px is refused', () => {
  // a and b, 160 x 80, at height y: the arrow runs level at y + 40 from x = 160 to x = 400.
  const level = (y: number): string => vertex('a', 'A', STEP, '1', geo(0, y)) + vertex('b', 'B', STEP, '1', geo(400, y)) + edge('e', 'a', 'b');
  const below = (top: number): string => vertex('c', '', FILLED_STEP, '1', geo(250, top, 60, 40));
  assert.ok(read(level(0) + below(44)).state.objects.c, 'exactly 4 px below the line');
  assert.ok(read(level(0.4) + below(44.4)).state.objects.c, 'exactly 4 px below a line at 40.4, which rounds to 40.400000000000006');
  assert.throws(() => read(level(0) + below(43.9)), reason('arrow_hidden'), '3.9 px');
  assert.throws(() => read(level(0.4) + below(44.3)), reason('arrow_hidden'), '3.9 px below a line at 40.4');
});

test('submission mode: boxes that touch do not overlap however their edges round; 0.1 px of overlap is refused', () => {
  // a's right edge is 0.1 + 50.2, which rounds to 50.300000000000004; b starts at 50.3.
  const a = vertex('a', 'A', STEP, '1', geo(0.1, 0, 50.2, 80));
  assert.ok(read(a + vertex('b', 'B', STEP, '1', geo(50.3, 0, 100, 80))).state.objects.b, 'touching');
  assert.throws(() => read(a + vertex('b', 'B', STEP, '1', geo(50.2, 0, 100, 80))), reason('boxes_overlap'), '0.1 px of overlap');
});

test('submission mode: a frame\'s step on the frame\'s edge lies inside it however the sum rounds; 0.1 px outside is refused', () => {
  // The frame spans 0.1..100.3; its step's right edge is 0.1 + 50.1 + 50.1, which rounds to 100.30000000000001.
  const frame = vertex('f', 'F', FRAME, '1', geo(0.1, 0, 100.2, 200));
  assert.ok(read(frame + vertex('a', 'A', STEP, 'f', geo(50.1, 40, 50.1, 80))).state.objects.a, 'on the right edge');
  assert.throws(() => read(frame + vertex('a', 'A', STEP, 'f', geo(50.1, 40, 50.2, 80))), reason('frame_outside'), '0.1 px outside');
});

test('submission mode: a text estimate that exactly fits its box or band passes however the box rounds; 0.1 px less is refused', () => {
  // Five units are estimated 60 px wide: a box 60 wide at x = 10.1 is 59.99999999999999 wide as computed.
  assert.ok(read(vertex('a', 'xxxxx', STEP, '1', geo(10.1, 0, 60, 80))).state.objects.a, 'a label exactly as wide as its box');
  assert.throws(() => read(vertex('a', 'xxxxx', STEP, '1', geo(10.1, 0, 59.9, 80))), reason('text_extent'), 'a box 59.9 px wide');
  // A frame 16 high at y = 0.15 has a band 15.999999999999998 high as computed: one line fits exactly.
  assert.ok(read(vertex('f', 'F', FRAME, '1', geo(0, 0.15, 300, 16))).state.objects.f, 'a band exactly one line high');
  assert.throws(() => read(vertex('f', 'F', FRAME, '1', geo(0, 0.15, 300, 15.9))), reason('text_extent'), 'a band 15.9 px high');
});

test('the XML prolog and the file\'s own attributes: only what an XML parser and draw.io\'s export allow (review m2d)', () => {
  const doc = file(two);
  // Outside the root only space, tab, CR and LF.
  for (const space of [' ', ' ', '　', '﻿']) {
    assert.throws(() => parseDrawio(doc + space), reason('xml_invalid'), `trailing U+${space.codePointAt(0)!.toString(16)}`);
    // A leading U+FEFF is the byte-order mark, allowed once (below).
    if (space !== '﻿') assert.throws(() => parseDrawio(space + doc), reason('xml_invalid'), `leading U+${space.codePointAt(0)!.toString(16)}`);
  }
  assert.ok(parseDrawio(` \t\r\n${doc}\r\n `).state.objects.a);
  assert.throws(() => parseDrawio(`<?xml version="1.0"?> ${doc}`), reason('xml_invalid'), 'a no-break space after the declaration');
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(` ${model(two)}`), 'utf8')).toString('base64');
  assert.throws(() => parseDrawio(`<mxfile><diagram id="p">${packed}</diagram></mxfile>`), reason('xml_invalid'), 'a no-break space before the inflated model');
  // The declaration by its grammar.
  for (const declaration of ['<?xml ?>', '<?xml foo?>', '<?xml version="9"?>', '<?xml version="1.0" encoding="no-such"?>', '<?xml version="1.0" encoding="ISO-8859-1"?>', '<?xml version="1.0" standalone="maybe"?>', '<?xml version="1.0"encoding="UTF-8"?>', '<?xml encoding="UTF-8" version="1.0"?>', '<?XML version="1.0"?>']) {
    assert.throws(() => parseDrawio(declaration + doc), reason('xml_invalid'), declaration);
  }
  for (const declaration of ['<?xml version="1.0"?>', `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>`, '<?xml version="1.0" encoding="UTF-8"?>\n']) assert.ok(parseDrawio(declaration + doc).state.objects.a, declaration);
  // A UTF-8 byte-order mark before the document, as every XML parser allows it; a second one is text.
  assert.ok(parseDrawio(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${doc}`)])).state.objects.a);
  assert.throws(() => parseDrawio(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from(doc)])), reason('xml_invalid'));
  // No namespace declaration, reserved URIs included.
  for (const uri of ['http://www.w3.org/2000/xmlns/', 'http://www.w3.org/XML/1998/namespace', 'urn:x']) assert.throws(() => parseDrawio(doc.replace('<mxfile', `<mxfile xmlns="${uri}"`)), reason('xml_invalid'), uri);
  // The file's own attributes: draw.io's export set, with the picture's values pinned.
  const exported = '<mxGraphModel dx="1094" dy="866" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">';
  assert.ok(parseDrawio(doc.replace('<mxGraphModel>', exported)).state.objects.a, 'the attributes draw.io\'s own export carries');
  for (const attributes of ['background="#000000"', 'backgroundImage="{&quot;src&quot;:&quot;data:x&quot;}"', 'math="1"', 'shadow="1"', 'adaptiveColors="auto"']) {
    assert.throws(() => parseDrawio(doc.replace('<mxGraphModel>', `<mxGraphModel ${attributes}>`)), reason('unmodeled_value'), attributes);
  }
  assert.throws(() => parseDrawio(doc.replace('<mxfile host="x">', '<mxfile host="x" pages="2">')), reason('unmodeled_value'), 'an mxfile attribute');
  assert.throws(() => parseDrawio(doc.replace('<diagram id="p" name="Page-1">', '<diagram id="p" name="Page-1" background="#000000">')), reason('unmodeled_value'), 'a diagram attribute');
  assert.throws(() => parseDrawio(doc.replace('<root>', '<root id="r">')), reason('unmodeled_value'), 'a root attribute');
});

test('limits are enforced by name', () => {
  assert.throws(() => parseDrawio('<a>' + 'x'.repeat(10 * 1024 * 1024) + '</a>'), reason('too_large'));
  assert.throws(() => read(Array.from({ length: 5_001 }, (_, i) => `<mxCell id="c${i}" parent="1"/>`).join('')), reason('too_large'));
  assert.throws(() => parseDrawio('<a>'.repeat(65) + '</a>'.repeat(65)), reason('too_large'));
  // A compressed page that inflates past 10 MiB stops inside the inflation, not after it.
  const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)).toString('base64');
  assert.throws(() => parseDrawio(`<mxfile><diagram id="p">${bomb}</diagram></mxfile>`), reason('diagram_invalid'));
});

test('every refusal carries a reason from the closed list', () => {
  const inputs = ['<a', file(vertex('a', 'A', 'x=1;')), file(vertex('a', 'A', STEP, '1', geo('1e400', 0))), file(vertex('f', 'n'.repeat(300), FRAME, '1', geo(0, 0, 400, 200))), file(vertex('a', 'A', 'rounded=0;html=0;strokeColor=toString;fillColor=none;'))];
  for (const input of inputs) {
    try { parseDrawio(input); assert.fail('read'); }
    catch (error) { assert.ok(error instanceof CheckerError && DRAWIO_REFUSALS.includes(error.details.reason as never), String((error as CheckerError).details?.reason)); }
  }
});

test('the format table reads .drawio for draw.io worlds and judges with counter-probes', () => {
  const world = validateWorld({ schema: 'practonaut.world/2', id: 'reader', version: '1.0.0', app: { adapterId: 'drawio', versionRange: '32.4.1' }, initialState: { objects: { a: stepV2('a', 'Receive', 10, 20), b: stepV2('b', 'Check', 400, 20), c: stepV2('c', 'Ship', 800, 20) } }, tasks: [v2Task()], provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' } });
  const cells = vertex('a', 'Receive', STEP, '1', geo(10, 20)) + vertex('b', 'Check', STEP, '1', geo(400, 20)) + vertex('c', 'Ship', STEP, '1', geo(800, 20));
  assert.equal(checkSubmission(world, file(cells + edge('e1', 'a', 'b') + edge('e2', 'b', 'c')), { taskId: 'T1', format: 'drawio' }).passed, true);
  assert.equal(checkSubmission(world, file(cells + edge('e1', 'a', 'b')), { taskId: 'T1' }).passed, false);
  assert.equal(NATIVE_FORMATS.drawio.matches(world.schema, file(cells), world.initialState), true);
  assert.throws(() => checkSubmission(world, JSON.stringify({ type: 'excalidraw', elements: [] }), { taskId: 'T1', format: 'excalidraw' }), (error: unknown) => error instanceof CheckerError && error.code === 'artifact_invalid');
});

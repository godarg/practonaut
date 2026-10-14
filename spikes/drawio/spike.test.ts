// Offline tests of the spike's reader, writer and write check (no browser, no download needed).
//   node --test spikes/drawio/spike.test.ts
// Expected values are written by hand from the draw.io file format, or come from Practonaut's core
// (an implementation independent of both the writer and the reader).
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { canonicalJson } from '../../src/canonical/index.ts';
import { Session } from '../../src/core/index.ts';
import { loadLibrary } from '../../src/library/index.ts';
import { substituteTokens, variantIndex, variantTokens } from '../../src/world/variant.ts';
import type { Scalar, State } from '../../src/world/types.ts';
import { DrawioParseError, parseXml, project, readDrawio } from './parser.ts';
import { InexpressibleError, stateToXml } from './writer.ts';
import { cellRoundTrip } from './integrity.ts';

const MODEL = (cells: string): string => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const code = (fn: () => unknown): string => { try { fn(); return 'none'; } catch (error) { return error instanceof DrawioParseError ? error.code : 'other'; } };

test('XML reader decodes references and refuses DOCTYPE, bare ampersands, unknown entities and bad nesting', () => {
  const e = parseXml('<?xml version="1.0"?><a v="x &amp; &lt;y&gt; &#228;&#x1F4E6;"><!-- c --><b/>t&amp;u</a>');
  assert.equal(e.attrs.v, 'x & <y> ä📦');
  assert.deepEqual(e.children.map(c => typeof c === 'string' ? c : c.name), ['b', 't&u']);
  assert.equal(code(() => parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')), 'xml_doctype');
  assert.equal(code(() => parseXml('<a v="R&D"/>')), 'xml_invalid');
  assert.equal(code(() => parseXml('<a>&nbsp;</a>')), 'xml_invalid');
  assert.equal(code(() => parseXml('<a><b></a></b>')), 'xml_invalid');
  assert.equal(code(() => parseXml('<a/><b/>')), 'xml_invalid');
});

test('reader accepts plain, compressed and bare models and refuses several pages', () => {
  const model = MODEL('<mxCell id="s" value="A" style="ellipse;" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell>');
  const plain = readDrawio(`<mxfile host="x"><diagram id="p" name="Page-1">${model}</diagram></mxfile>`);
  // draw.io's compressed page: Base64 of raw deflate of encodeURIComponent(xml), built here with zlib.
  const packed = deflateRawSync(Buffer.from(encodeURIComponent(model), 'latin1')).toString('base64');
  const compressed = readDrawio(`<mxfile><diagram id="p" name="Page-1">${packed}</diagram></mxfile>`);
  const bare = readDrawio(model);
  assert.equal(plain.compressed, false);
  assert.equal(compressed.compressed, true);
  for (const file of [plain, compressed, bare]) assert.deepEqual(project(file).objects, { s: { id: 's', type: 'step', deleted: false, frameId: null, label: 'A', x: 1, y: 2, width: 3, height: 4, shape: 'ellipse', groupId: null, stroke: 'black', fill: 'none' } });
  assert.equal(code(() => readDrawio(`<mxfile><diagram id="a">${model}</diagram><diagram id="b">${model}</diagram></mxfile>`)), 'pages_unsupported');
});

test('projection: frame > group > step coordinates add up; edge frame, colours and shapes map', () => {
  const xml = MODEL(
    '<mxCell id="f" value="Sales" style="swimlane;container=1;" vertex="1" parent="1"><mxGeometry x="100" y="50" width="400" height="300" as="geometry"/></mxCell>' +
    '<mxCell id="g" value="" style="group;" vertex="1" parent="f"><mxGeometry x="20" y="40" width="300" height="100" as="geometry"/></mxCell>' +
    '<mxCell id="s" value="Quote" style="rhombus;html=0;strokeColor=#6C8EBF;fillColor=#fff2cc;" vertex="1" parent="g"><mxGeometry x="5" y="6" width="180" height="90" as="geometry"/></mxCell>' +
    '<mxCell id="t" value="Order" style="rounded=0;html=0;" vertex="1" parent="f"><mxGeometry x="200" y="200" width="100" height="50" as="geometry"/></mxCell>' +
    '<mxCell id="e" value="" style="endArrow=classic;" edge="1" parent="f" source="s" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>');
  const p = project(readDrawio(xml));
  assert.deepEqual(p.issues, []);
  assert.deepEqual(p.unmodeled, []);
  // 100 + 20 + 5 = 125, 50 + 40 + 6 = 96 (hand calculation).
  assert.deepEqual(p.objects.s, { id: 's', type: 'step', deleted: false, frameId: 'f', label: 'Quote', x: 125, y: 96, width: 180, height: 90, shape: 'diamond', groupId: 'g', stroke: 'blue', fill: 'yellow' });
  assert.deepEqual(p.objects.t, { id: 't', type: 'step', deleted: false, frameId: 'f', label: 'Order', x: 300, y: 250, width: 100, height: 50, shape: 'rectangle', groupId: null, stroke: 'black', fill: 'none' });
  assert.deepEqual(p.objects.e, { id: 'e', type: 'arrow', deleted: false, frameId: 'f', from: 's', to: 't' });
  assert.deepEqual(p.objects.f, { id: 'f', type: 'frame', deleted: false, name: 'Sales' });
  assert.equal(p.objects.g, undefined);
});

test('integrity check names every broken structure', () => {
  const step = (id: string, parent: string, extra = '', x = '0'): string => `<mxCell id="${id}" value="A" style="html=0;${extra}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="0" width="10" height="10" as="geometry"/></mxCell>`;
  const codes = (cells: string): string[] => project(readDrawio(MODEL(cells))).issues.map(i => i.code).sort();
  assert.deepEqual(codes(step('a', '1') + step('a', '1')), ['duplicate_id']);
  assert.deepEqual(codes(step('a', 'nowhere')), ['missing_parent']);
  assert.deepEqual(codes(step('a', 'b') + step('b', 'a')), ['parent_cycle', 'parent_cycle']);
  assert.deepEqual(codes(step('s', '1') + '<mxCell id="e" edge="1" parent="1" source="s" target="s"><mxGeometry relative="1" as="geometry"/></mxCell>' + step('c', 'e')), ['edge_parent']);
  assert.deepEqual(codes(step('s', '1') + '<mxCell id="e" edge="1" parent="1" source="s" target="ghost"><mxGeometry relative="1" as="geometry"/></mxCell>'), ['dangling_reference']);
  assert.deepEqual(codes(step('a', '1', 'html=1;')), ['markup_label']);
  assert.deepEqual(codes(step('a', '1', '', '10.5')), ['non_integer']);
  assert.deepEqual(project(readDrawio(MODEL(step('a', '1', 'fillColor=notacolor;')))).unmodeled.map(i => i.code), ['unknown_colour']);
});

test('writer and reader agree offline on every library reference and near miss (core prediction as oracle)', () => {
  const { world, library } = loadLibrary();
  let states = 0;
  for (const entry of library.tasks) for (const seed of Object.values(entry.oracle.seeds)) for (const steps of [entry.oracle.steps, ...entry.oracle.nearMisses.map(m => m.steps)]) {
    const session = new Session(world, seed, entry.id);
    const tokens = variantTokens(world.variants.cases[variantIndex(world, seed)]!);
    const created: string[] = [];
    for (const [index, step] of steps.entries()) {
      const params: Record<string, Scalar> = {};
      for (const [key, value] of Object.entries(step.params)) params[key] = value !== null && typeof value === 'object' ? created[value.created]! : typeof value === 'string' ? substituteTokens(value, tokens) : value;
      const before = new Set(Object.keys(session.state.objects));
      const result = session.act({ name: step.name, params });
      assert.ok(result.ok, `${entry.id} step ${index}`);
      created[index] = Object.keys(result.state.objects).find(id => !before.has(id)) ?? '';
      const live = Object.fromEntries(Object.values(session.state.objects).filter(o => !o.deleted).map(o => [o.id, o]));
      const p = project(readDrawio(stateToXml(session.state).xml));
      assert.deepEqual(p.issues, []);
      assert.equal(canonicalJson(p.objects), canonicalJson(live), `${entry.id} step ${index}`);
      states++;
    }
  }
  assert.ok(states > 400);
});

test('a group split across frames is refused natively and kept losslessly as cell data', () => {
  const step = (id: string, frameId: string | null): Record<string, unknown> => ({ id, type: 'step', deleted: false, frameId, label: id, x: 0, y: 0, width: 10, height: 10, shape: 'rectangle', groupId: 'g1', stroke: 'black', fill: 'none' });
  const state = { objects: { f: { id: 'f', type: 'frame', deleted: false, name: 'F' }, a: step('a', 'f'), b: step('b', null) } } as unknown as State;
  assert.throws(() => stateToXml(state), InexpressibleError);
  const written = stateToXml(state, undefined, 'data-attribute');
  assert.deepEqual(written.dataGroups, ['g1']);
  const p = project(readDrawio(written.xml));
  assert.equal(canonicalJson(p.objects), canonicalJson(state.objects));
});

test('write check: identical cells pass; re-parented, renamed or added cells are named', () => {
  const s = (id: string, parent: string): string => `<mxCell id="${id}" value="A" style="html=0;" vertex="1" parent="${parent}"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>`;
  const written = MODEL(s('s1', 'nowhere'));
  assert.deepEqual(cellRoundTrip(written, `<mxfile><diagram id="x">${MODEL(s('s1', 'nowhere'))}</diagram></mxfile>`), []);
  assert.equal(cellRoundTrip(written, MODEL(s('s1', '1'))).length, 1);
  assert.match(cellRoundTrip(MODEL(s('s1', '1')), MODEL(s('other', '1'))).join(' '), /other: not written but read back.*s1: written but not read back/);
});

// draw.io conformance cases besides the library protocol (PADR-0049 decisions 4.2, 5.1, 5.2, 6.4, 6.7,
// 8.3): the derived memory reset (two-frames after two different sequences), the counter-probes written
// through the app, the adapter's own constraint refusal, the arrow-marker list measured from SVG exports,
// and the reader's differential fixtures: every file is loaded into draw.io and the reader must agree
// with the app's own export and SVG rendering, or refuse; it never reads what the app does not show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createDrawioAdapter, type DrawioAdapter } from '../../../src/adapters/drawio/index.ts';
import { runOracle } from '../../../src/authoring/from-scenes.ts';
import { checkSubmission, CheckerError } from '../../../src/checker/index.ts';
import { DRAWIO_MARKERS, parseDrawio } from '../../../src/checker/drawio.ts';
import { Session } from '../../../src/core/index.ts';
import { LIBRARY_CASES } from '../../../src/library/index.ts';
import type { Action, State } from '../../../src/world/types.ts';
import { stepV2 } from '../../support/world-v2.ts';
import { drawioAvailability, drawioLibrary, drawioTaskWorld } from '../../support/drawio.ts';

const availability = await drawioAvailability();
const skip = availability.ok ? false : availability.skip;
const start = async (state: State = { objects: {} }): Promise<DrawioAdapter> => createDrawioAdapter(state, {}, undefined, availability.ok ? { runtimePath: availability.runtime.runtimePath } : {});
const ROOTS = '<mxCell id="0"/><mxCell id="1" parent="0"/>';
const model = (cells: string): string => `<mxGraphModel><root>${ROOTS}${cells}</root></mxGraphModel>`;
const vertex = (id: string, value: string, style: string, parent = '1', geometry = '<mxGeometry x="300" y="300" width="100" height="50" as="geometry"/>', more = ''): string => `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"${more}>${geometry}</mxCell>`;
const geo = (x: number | string, y: number | string, w: number | string = 100, h: number | string = 50, extra = ''): string => `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"${extra}/>`;
/** A step at the origin: draw.io's SVG places the drawing's top-left corner at 0, 0, so it anchors the boxes. */
const REF = vertex('ref', 'Ref', 'rounded=0;html=0;', '1', geo(0, 0));
/** The SVG of one cell: from its `data-cell-id` group to the next cell's. */
const cellSvg = (svg: string, id: string): string => { const at = svg.indexOf(`data-cell-id="${id}"`); if (at < 0) return ''; const next = svg.indexOf('data-cell-id="', at + 10); return svg.slice(at, next < 0 ? undefined : next); };
const SHAPES = /<(path|ellipse|rect|circle|polygon|polyline)\b/g;
/** The box draw.io draws for a step, edges rounded as the reader rounds them (PADR-0047 decision 10). */
function drawnBox(svg: string, id: string): { x: number; y: number; width: number; height: number } | null {
  const part = cellSvg(svg, id);
  const number = (name: string, text: string): number => Number(new RegExp(`\\b${name}="([^"]+)"`).exec(text)![1]);
  let left: number, top: number, right: number, bottom: number;
  const rect = /<rect\b[^>]*>/.exec(part)?.[0], ellipse = /<ellipse\b[^>]*>/.exec(part)?.[0], path = /<path\b[^>]*\bd="([^"]+)"/.exec(part)?.[1];
  if (rect) { left = number('x', rect); top = number('y', rect); right = left + number('width', rect); bottom = top + number('height', rect); }
  else if (ellipse) { left = number('cx', ellipse) - number('rx', ellipse); right = number('cx', ellipse) + number('rx', ellipse); top = number('cy', ellipse) - number('ry', ellipse); bottom = number('cy', ellipse) + number('ry', ellipse); }
  else if (path) { const values = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number); const xs = values.filter((_, i) => i % 2 === 0), ys = values.filter((_, i) => i % 2 === 1); [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; }
  else return null;
  const [l, t, r, b] = [left, top, right, bottom].map(Math.round) as [number, number, number, number];
  return { x: l, y: t, width: r - l, height: b - t };
}
const refusal = (fn: () => unknown): string | undefined => { try { fn(); return undefined; } catch (error) { if (error instanceof CheckerError) return String(error.details.reason ?? error.code); throw error; } };

test('derived memory: two-frames after two different sequences exports the same file and PNG', { skip, timeout: 300_000 }, async () => {
  const { world, library } = drawioLibrary();
  const task = library.tasks.find(entry => entry.id === 'two-frames')!, slice = drawioTaskWorld(world, 'two-frames'), seed = task.oracle.seeds.drawn!;
  const startState = new Session(slice, seed, 'two-frames').state;
  assert.ok(Object.values(startState.objects).some(o => o.type === 'frame'), 'the start holds frames');
  const adapter = await start(startState);
  try {
    const after = async (steps: typeof task.oracle.steps): Promise<{ native: string; png: string }> => {
      const resolved = runOracle(slice, seed, 'two-frames', steps); assert.ok(resolved.ok);
      const session = new Session(slice, seed, 'two-frames');
      assert.equal((await adapter.restoreState(session.state)).ok, true);
      for (const entry of resolved.session.log) { const before = session.state, result = session.act(entry.action as Action); assert.ok(result.ok); assert.equal((await adapter.apply({ before, after: result.state, action: entry.action as Action })).ok, true); }
      assert.equal((await adapter.restoreState(startState)).ok, true);
      const native = (await adapter.exportArtifact()).native.replace(/(<diagram\b[^>]*\bid=")[^"]*/, '$1');
      return { native, png: Buffer.from(await adapter.renderPng()).toString('base64') };
    };
    const one = await after(task.oracle.steps), two = await after(task.oracle.nearMisses[0]!.steps), three = await after([]);
    assert.equal(one.native, two.native); assert.equal(one.native, three.native);
    assert.equal(one.png, two.png); assert.equal(one.png, three.png);
  } finally { await adapter.close(); }
});

test('counter-probes written through draw.io: an empty diagram and another task\'s result fail every task in every case', { skip, timeout: 600_000 }, async () => {
  const { world, library } = drawioLibrary();
  const adapter = await start();
  try {
    let probes = 0;
    for (const [index, task] of library.tasks.entries()) {
      const other = library.tasks[(index + 1) % library.tasks.length]!;
      for (const variantCase of LIBRARY_CASES) {
        const seed = task.oracle.seeds[variantCase]!, slice = drawioTaskWorld(world, task.id);
        const wrong = runOracle(drawioTaskWorld(world, other.id), other.oracle.seeds[variantCase]!, other.id, other.oracle.steps); assert.ok(wrong.ok);
        for (const [name, state] of [['empty', { objects: {} }], ['wrong artifact', wrong.session.state]] as const) {
          assert.equal((await adapter.restoreState(state)).ok, true, `${task.id}/${variantCase} ${name}`);
          const native = (await adapter.exportArtifact()).native;
          assert.equal(checkSubmission(slice, native, { seed, taskId: task.id, format: 'drawio' }).passed, false, `${task.id}/${variantCase} ${name} passed`);
          probes++;
        }
      }
    }
    assert.equal(probes, library.tasks.length * LIBRARY_CASES.length * 2);
    assert.deepEqual(adapter.networkAttempts(), []);
  } finally { await adapter.close(); }
});

test('the adapter refuses a state draw.io cannot hold before writing it: a group across frames', { skip, timeout: 120_000 }, async () => {
  const before: State = { objects: { f1: { id: 'f1', type: 'frame', deleted: false, name: 'One' }, f2: { id: 'f2', type: 'frame', deleted: false, name: 'Two' }, a: stepV2('a', 'A', 100, 100, { frameId: 'f1' }), b: stepV2('b', 'B', 600, 100, { frameId: 'f2' }) } };
  const adapter = await start(before);
  try {
    const snapshot = await adapter.snapshot();
    const after: State = { objects: { ...before.objects, a: { ...before.objects.a!, groupId: 'g' } as never, b: { ...before.objects.b!, groupId: 'g' } as never } };
    const result = await adapter.apply({ before, after, action: { name: 'group_steps', params: { id: 'a', with: 'b' } } });
    assert.equal(!result.ok && result.error.code, 'constraint_refused', JSON.stringify(result));
    assert.ok(isDeepStrictEqual(await adapter.snapshot(), snapshot), 'nothing was written');
  } finally { await adapter.close(); }
});

test('arrow markers: draw.io draws a head for every listed marker and none for "none", an empty value or an unknown name', { skip, timeout: 300_000 }, async () => {
  const adapter = await start();
  try {
    const shapes = async (marker: string | undefined): Promise<number> => {
      const style = marker === undefined ? 'html=0;' : `endArrow=${marker};html=0;`;
      await adapter.conformanceWrite(model(vertex('s', 'S', 'rounded=0;html=0;', '1', geo(0, 0)) + vertex('t', 'T', 'rounded=0;html=0;', '1', geo(400, 0)) + `<mxCell id="e" value="" style="${style}" edge="1" parent="1" source="s" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>`), []);
      return [...cellSvg((await adapter.exportArtifact()).svg, 'e').matchAll(SHAPES)].length;
    };
    const none = await shapes('none');
    assert.equal(none, 1, 'the line alone');
    for (const marker of ['', 'bogus']) assert.equal(await shapes(marker), none, `endArrow=${marker}`);
    assert.ok(await shapes(undefined) > none, 'no endArrow key: draw.io\'s default head');
    for (const marker of DRAWIO_MARKERS) assert.ok(await shapes(marker) > none, `endArrow=${marker} draws no head`);
  } finally { await adapter.close(); }
});

test('the reader against draw.io: for every differential fixture it agrees with the app\'s export and drawing, or refuses', { skip, timeout: 600_000 }, async () => {
  const fixtures: Array<{ id: string; xml: string; refused?: string; hidden?: string[] }> = [
    { id: 'crlf-in-attribute', xml: model(REF + vertex('a', 'a\r\nb', 'rounded=0;html=0;')) },
    { id: 'adjacent-attributes', xml: model(REF + '<mxCell id="a"vertex="1" parent="1">' + geo(10, 10) + '</mxCell>'), refused: 'xml_invalid' },
    { id: 'character-1', xml: model(REF + vertex('a', 'x&#1;y', 'rounded=0;html=0;')), refused: 'xml_invalid' },
    { id: 'compressed-and-model', xml: `<mxfile><diagram id="p">eJx${model(REF)}</diagram></mxfile>`, refused: 'diagram_invalid' },
    { id: 'two-geometries', xml: model(REF + `<mxCell id="a" value="A" style="rounded=0;html=0;" vertex="1" parent="1">${geo(300, 300)}${geo(500, 300)}</mxCell>`), refused: 'cell_invalid' },
    { id: 'hex-coordinate', xml: model(REF + vertex('a', 'A', 'rounded=0;html=0;', '1', geo('0x1F4', 300))), refused: 'geometry_invalid' },
    { id: 'vertex-true', xml: model(REF + vertex('a', 'A', 'rounded=0;html=0;').replace('vertex="1"', 'vertex="true"')), refused: 'cell_invalid' },
    { id: 'hidden-and-collapsed', xml: model(REF + vertex('f', 'Lane', 'swimlane;container=1;collapsible=0;startSize=30;html=0;', '1', geo(200, 200, 400, 300), ' visible="0"') + vertex('h', 'HiddenChild', 'rounded=0;html=0;', 'f', geo(20, 50)) + vertex('c', 'Box', 'swimlane;container=1;startSize=30;html=0;', '1', geo(700, 200, 300, 200), ' collapsed="1"') + vertex('k', 'CollapsedChild', 'rounded=0;html=0;', 'c', geo(20, 50)) + vertex('v', 'Visible', 'rounded=0;html=0;', '1', geo(1100, 200))), hidden: ['HiddenChild', 'CollapsedChild'] },
    { id: 'edge-label-vertex', xml: model(REF + vertex('t', 'T', 'rounded=0;html=0;', '1', geo(400, 0)) + '<mxCell id="e" value="" style="endArrow=classic;html=0;" edge="1" parent="1" source="ref" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>' + vertex('l', 'Label', 'text;html=0;', 'e', '<mxGeometry x="-0.2" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>', ' connectable="0"')) },
    { id: 'ellipse-shape-rhombus', xml: model(REF + vertex('a', 'A', 'ellipse;shape=rhombus;html=0;')), refused: 'unmodeled_value' },
    { id: 'shape-ellipse-rhombus', xml: model(REF + vertex('a', 'A', 'shape=ellipse;rhombus;html=0;')), refused: 'unmodeled_value' },
    { id: 'swimlane-shape-ellipse', xml: model(REF + vertex('a', 'A', 'swimlane;shape=ellipse;html=0;')), refused: 'unmodeled_value' },
    { id: 'end-arrow-empty', xml: model(REF + vertex('t', 'T', 'rounded=0;html=0;', '1', geo(400, 0)) + '<mxCell id="e" value="" style="endArrow=;html=0;" edge="1" parent="1" source="ref" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>') },
    { id: 'start-arrow-bogus', xml: model(REF + vertex('t', 'T', 'rounded=0;html=0;', '1', geo(400, 0)) + '<mxCell id="e" value="" style="startArrow=bogus;endArrow=none;html=0;" edge="1" parent="1" source="ref" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>'), refused: 'unmodeled_value' },
    { id: 'end-arrow-bogus', xml: model(REF + vertex('t', 'T', 'rounded=0;html=0;', '1', geo(400, 0)) + '<mxCell id="e" value="" style="endArrow=bogus;html=0;" edge="1" parent="1" source="ref" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>'), refused: 'unmodeled_value' },
    { id: 'group-ids-collide', xml: model(REF + vertex('g1', '', 'group;', '1', geo(200, 200, 300, 100)) + vertex('pn:group:g1', '', 'group;', '1', geo(200, 400, 300, 100)) + vertex('a', 'A', 'rounded=0;html=0;', 'g1', geo(0, 0)) + vertex('b', 'B', 'rounded=0;html=0;', 'pn:group:g1', geo(0, 0))), refused: 'duplicate_id' },
    { id: 'html-label-spaces', xml: model(REF + vertex('a', ' A ', 'rounded=0;html=1;')), refused: 'markup_label' },
    { id: 'zero-width', xml: model(REF + vertex('a', 'A', 'rounded=0;html=0;', '1', geo(300, 300, 0, 50))), refused: 'geometry_invalid' },
    { id: 'relative-ancestor', xml: model(REF + vertex('g', '', 'group;', '1', geo(0.1, 0.1, 300, 100, ' relative="1"')) + vertex('a', 'A', 'rounded=0;html=0;', 'g', geo(10, 10))), refused: 'geometry_invalid' },
    { id: 'offsets-integer', xml: model(REF + vertex('f', 'Lane', 'swimlane;container=1;collapsible=0;startSize=30;html=0;', '1', geo(200, 100, 500, 300)) + vertex('pn:group:g', '', 'group;', 'f', geo(20, 40, 400, 120)) + vertex('a', 'Inner', 'ellipse;html=0;', 'pn:group:g', geo(10, 5, 120, 60)) + vertex('b', 'Other', 'rhombus;html=0;', 'pn:group:g', geo(200, 5, 120, 60))) },
    { id: 'offsets-fractional', xml: model(REF + vertex('f', 'Lane', 'swimlane;container=1;collapsible=0;startSize=30;html=0;', '1', geo(200.5, 100.25, 500, 300)) + vertex('pn:group:g', '', 'group;', 'f', geo(20.5, 40, 400, 120)) + vertex('a', 'Inner', 'ellipse;html=0;', 'pn:group:g', geo(10.25, 5, 120.5, 60)) + vertex('b', 'Other', 'rounded=0;html=0;', 'pn:group:g', geo(200.4, 5.6, 120, 60))) },
  ];
  const adapter = await start();
  try {
    for (const fixture of fixtures) {
      const reason = refusal(() => parseDrawio(fixture.xml));
      if (fixture.refused !== undefined) { assert.equal(reason, fixture.refused, fixture.id); continue; }
      assert.equal(reason, undefined, `${fixture.id}: the reader refused (${reason})`);
      const read = parseDrawio(fixture.xml);
      const { exported } = await adapter.conformanceWrite(fixture.xml, []);
      const svg = (await adapter.exportArtifact()).svg;
      // The app's own export reads the same.
      assert.deepEqual(parseDrawio(exported).state, read.state, `${fixture.id}: the app's export reads differently`);
      for (const object of Object.values(read.state.objects)) {
        if (object.type !== 'step') continue;
        assert.ok(cellSvg(svg, object.id).includes(`>${object.label.replace(/\s+/g, ' ')}<`) || cellSvg(svg, object.id).includes(object.label.split(/\s/)[0]!), `${fixture.id}: ${object.id}'s label is not drawn`);
        assert.deepEqual(drawnBox(svg, object.id), { x: object.x, y: object.y, width: object.width, height: object.height }, `${fixture.id}: ${object.id}'s box`);
      }
      for (const text of fixture.hidden ?? []) {
        assert.ok(!svg.includes(`>${text}<`), `${fixture.id}: draw.io draws ${text}`);
        assert.ok(!JSON.stringify(read.state).includes(text), `${fixture.id}: the reader reads ${text}`);
      }
    }
  } finally { await adapter.close(); }
});

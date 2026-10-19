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
const REF = vertex('ref', 'Ref', 'rounded=0;html=0;strokeColor=#000000;fillColor=none;', '1', geo(0, 0));
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
    // startArrow is the one edge key the reader accepts beyond the adapter's own writes (review m2c): for
    // every listed marker draw.io draws one head, at the source (s spans x 0..100, t spans x 400..500),
    // and the reader reads the arrow from t to s. With endArrow, the head is at the target.
    const heads = async (style: string): Promise<number[]> => {
      const xml = model(vertex('s', 'S', 'rounded=0;html=0;strokeColor=#000000;fillColor=none;', '1', geo(0, 0)) + vertex('t', 'T', 'rounded=0;html=0;strokeColor=#000000;fillColor=none;', '1', geo(400, 0)) + `<mxCell id="e" value="" style="${style}" edge="1" parent="1" source="s" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>`);
      await adapter.conformanceWrite(xml, []);
      const drawn = [...cellSvg((await adapter.exportArtifact()).svg, 'e').matchAll(/<(path|ellipse)\b[^>]*>/g)].slice(1).map(([tag]) => {
        const cx = /\bcx="([^"]+)"/.exec(tag)?.[1];
        if (cx !== undefined) return Number(cx);
        const xs = /\bd="([^"]+)"/.exec(tag)![1]!.match(/-?\d+(?:\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
        return (Math.min(...xs) + Math.max(...xs)) / 2;
      });
      const arrow = Object.values(parseDrawio(xml).state.objects).find(o => o.type === 'arrow') as { from: string; to: string };
      assert.deepEqual([arrow.from, arrow.to], style.startsWith('startArrow') ? ['t', 's'] : ['s', 't'], style);
      return drawn;
    };
    for (const marker of DRAWIO_MARKERS) {
      const start = await heads(`startArrow=${marker};endArrow=none;html=0;`), end = await heads(`endArrow=${marker};html=0;`);
      assert.equal(start.length, 1, `startArrow=${marker}: one head`); assert.ok(start[0]! < 250, `startArrow=${marker}: the head is at the source (${start[0]})`);
      assert.equal(end.length, 1, `endArrow=${marker}: one head`); assert.ok(end[0]! > 250, `endArrow=${marker}: the head is at the target (${end[0]})`);
    }
  } finally { await adapter.close(); }
});

test('the reader against draw.io: for every differential fixture it agrees with the app\'s export and drawing, or refuses', { skip, timeout: 600_000 }, async () => {
  const S = 'rounded=0;html=0;strokeColor=#000000;fillColor=none;', E = 'ellipse;html=0;strokeColor=#000000;fillColor=none;', R = 'rhombus;html=0;strokeColor=#000000;fillColor=none;';
  const FRAME = 'swimlane;container=1;collapsible=0;startSize=30;html=0;';
  const group = (id: string, parent: string, g: string): string => vertex(id, '', 'group;', parent, g, ' connectable="0"');
  const T = vertex('t', 'T', S, '1', geo(400, 0));
  const arrow = (style: string): string => `<mxCell id="e" value="" style="${style}" edge="1" parent="1" source="ref" target="t"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  // Read: the reader must agree with draw.io's export and drawing. Refused: by the reason named.
  const fixtures: Array<{ id: string; xml: string; refused?: string }> = [
    { id: 'crlf-in-attribute', xml: model(REF + vertex('a', 'a\r\nb', S)) },
    { id: 'upper-case-colour', xml: model(REF + vertex('a', 'Blue', 'rounded=0;html=0;strokeColor=#6C8EBF;fillColor=#DAE8FC;')) },
    { id: 'shapes', xml: model(REF + vertex('a', 'Round', E, '1', geo(200, 0)) + vertex('b', 'Diamond', R, '1', geo(400, 0))) },
    { id: 'start-head', xml: model(REF + T + arrow('startArrow=classic;endArrow=none;html=0;')) },
    { id: 'no-html-key', xml: model(REF + vertex('a', 'Plain', 'rounded=0;strokeColor=#000000;fillColor=none;')) },
    { id: 'object-label', xml: model(REF + `<object id="a" label="Wrapped"><mxCell style="${S}" vertex="1" parent="1">${geo(200, 0)}</mxCell></object>`) },
    { id: 'user-object-label', xml: model(REF + `<UserObject id="a" label="User"><mxCell style="${S}" vertex="1" parent="1">${geo(200, 0)}</mxCell></UserObject>`) },
    { id: 'offsets-integer', xml: model(REF + vertex('f', 'Lane', FRAME, '1', geo(200, 100, 500, 300)) + group('pn:group:g', 'f', geo(20, 40, 400, 120)) + vertex('a', 'Inner', E, 'pn:group:g', geo(10, 5, 120, 60)) + vertex('b', 'Other', R, 'pn:group:g', geo(200, 5, 120, 60))) },
    { id: 'offsets-fractional', xml: model(REF + vertex('f', 'Lane', FRAME, '1', geo(200.5, 100.25, 500, 300)) + group('pn:group:g', 'f', geo(20.5, 40, 400, 120)) + vertex('a', 'Inner', E, 'pn:group:g', geo(10.25, 5, 120.5, 60)) + vertex('b', 'Other', S, 'pn:group:g', geo(200.4, 5.6, 120, 60))) },
    { id: 'adjacent-attributes', xml: model(REF + '<mxCell id="a"vertex="1" parent="1">' + geo(10, 10) + '</mxCell>'), refused: 'xml_invalid' },
    { id: 'character-1', xml: model(REF + vertex('a', 'x&#1;y', S)), refused: 'xml_invalid' },
    { id: 'comment-double-dash', xml: model(REF).replace('<root>', '<root><!-- a--b -->'), refused: 'xml_invalid' },
    { id: 'compressed-and-model', xml: `<mxfile><diagram id="p">eJx${model(REF)}</diagram></mxfile>`, refused: 'diagram_invalid' },
    { id: 'two-geometries', xml: model(REF + `<mxCell id="a" value="A" style="${S}" vertex="1" parent="1">${geo(300, 300)}${geo(500, 300)}</mxCell>`), refused: 'cell_invalid' },
    { id: 'hex-coordinate', xml: model(REF + vertex('a', 'A', S, '1', geo('0x1F4', 300))), refused: 'geometry_invalid' },
    { id: 'cancelling-offsets', xml: model(REF + group('g', '1', geo('9223372036854775808', 0, 300, 100)) + vertex('a', 'A', S, 'g', geo('-9223372036854775808', 0))), refused: 'geometry_invalid' },
    { id: 'vertex-true', xml: model(REF + vertex('a', 'A', S).replace('vertex="1"', 'vertex="true"')), refused: 'cell_invalid' },
    { id: 'hidden', xml: model(REF + vertex('h', 'Hidden', S, '1', geo(200, 200), ' visible="0"')), refused: 'unmodeled_value' },
    { id: 'collapsed', xml: model(REF + vertex('c', 'Box', FRAME, '1', geo(700, 200, 300, 200), ' collapsed="1"') + vertex('k', 'Inside', S, 'c', geo(20, 50))), refused: 'unmodeled_value' },
    { id: 'no-label', xml: model(REF + vertex('a', 'A', `${S}noLabel=1;`)), refused: 'unmodeled_value' },
    { id: 'transparent', xml: model(REF + vertex('a', 'A', `${S}opacity=0;textOpacity=0;`)), refused: 'unmodeled_value' },
    { id: 'edge-label-vertex', xml: model(REF + T + arrow('endArrow=classic;html=0;') + vertex('l', 'Label', S, 'e', geo(0, 0))), refused: 'structure_invalid' },
    { id: 'plain-cell-offset', xml: model(REF + '<mxCell id="p" parent="1"><mxGeometry x="300" as="geometry"/></mxCell>' + vertex('a', 'A', S, 'p', geo(10, 10))), refused: 'structure_invalid' },
    { id: 'vertex-under-root', xml: model(REF + vertex('a', 'A', S, '0', geo(10, 10))), refused: 'structure_invalid' },
    { id: 'container-step', xml: model(REF + vertex('a', 'A', `${S}container=1;`)), refused: 'unmodeled_value' },
    { id: 'unknown-name', xml: model(REF + vertex('a', 'A', `pnbox;${S}`)), refused: 'unmodeled_value' },
    { id: 'unknown-shape', xml: model(REF + vertex('a', 'A', 'shape=pnbox;html=0;strokeColor=#000000;fillColor=none;')), refused: 'unmodeled_value' },
    { id: 'ellipse-shape-rhombus', xml: model(REF + vertex('a', 'A', 'ellipse;shape=rhombus;html=0;strokeColor=#000000;fillColor=none;')), refused: 'unmodeled_value' },
    { id: 'swimlane-shape-ellipse', xml: model(REF + vertex('a', 'A', 'swimlane;shape=ellipse;html=0;')), refused: 'unmodeled_value' },
    { id: 'leading-semicolon', xml: model(REF + vertex('a', 'A', `;${S}`)), refused: 'unmodeled_value' },
    { id: 'relative-true', xml: model(REF + vertex('a', 'A', S, '1', geo(10, 10, 100, 50, ' relative="true"'))), refused: 'unmodeled_value' },
    { id: 'object-inner-value', xml: model(REF + `<object id="a" label="New"><mxCell value="Old" style="${S}" vertex="1" parent="1">${geo(10, 10)}</mxCell></object>`), refused: 'cell_invalid' },
    { id: 'value-child', xml: model(REF + `<mxCell id="a" value="New" style="${S}" vertex="1" parent="1"><add as="value" value="Old"/>${geo(10, 10)}</mxCell>`), refused: 'cell_invalid' },
    { id: 'end-arrow-empty', xml: model(REF + T + arrow('endArrow=;html=0;')), refused: 'unmodeled_value' },
    { id: 'start-arrow-bogus', xml: model(REF + T + arrow('startArrow=bogus;endArrow=none;html=0;')), refused: 'unmodeled_value' },
    { id: 'end-arrow-bogus', xml: model(REF + T + arrow('endArrow=bogus;html=0;')), refused: 'unmodeled_value' },
    { id: 'edge-no-stroke', xml: model(REF + T + arrow('endArrow=classic;html=0;strokeColor=none;')), refused: 'unmodeled_value' },
    { id: 'edge-end-size', xml: model(REF + T + arrow('startArrow=classic;endArrow=classic;endSize=0;html=0;')), refused: 'unmodeled_value' },
    { id: 'group-ids-collide', xml: model(REF + group('g1', '1', geo(200, 200, 300, 100)) + group('pn:group:g1', '1', geo(200, 400, 300, 100)) + vertex('a', 'A', S, 'g1', geo(0, 0)) + vertex('b', 'B', S, 'pn:group:g1', geo(0, 0))), refused: 'duplicate_id' },
    { id: 'html-label', xml: model(REF + vertex('a', ' A ', 'rounded=0;html=1;strokeColor=#000000;fillColor=none;')), refused: 'markup_label' },
    { id: 'zero-width', xml: model(REF + vertex('a', 'A', S, '1', geo(300, 300, 0, 50))), refused: 'geometry_invalid' },
    { id: 'relative-ancestor', xml: model(REF + group('g', '1', geo(0.1, 0.1, 300, 100, ' relative="1"')) + vertex('a', 'A', S, 'g', geo(10, 10))), refused: 'unmodeled_value' },
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
    }
  } finally { await adapter.close(); }
});

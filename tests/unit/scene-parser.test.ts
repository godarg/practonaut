import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseScene, CheckerError } from '../../src/checker/index.ts';
import type { StepV2 } from '../../src/world/types.ts';

// Fixtures are written by hand in Excalidraw's own field names; no Practonaut serializer is used.
const file = (elements: unknown[], extra: Record<string, unknown> = {}): string => JSON.stringify({ type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements, appState: { viewBackgroundColor: '#ffffff' }, files: {}, ...extra });
const shape = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, x: 10.4, y: 20.6, width: 150.2, height: 79.5, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, roughness: 1, opacity: 100, groupIds: [], frameId: null, boundElements: null, isDeleted: false, seed: 1, version: 3, versionNonce: 4, ...extra });
const text = (id: string, containerId: string | null, value: string, extra: Record<string, unknown> = {}) => ({ id, type: 'text', x: 0, y: 0, width: 50, height: 25, angle: 0, isDeleted: false, frameId: null, groupIds: [], containerId, text: value, originalText: value, fontFamily: 5, fontSize: 20, ...extra });
const arrow = (id: string, from: string | null, to: string | null, extra: Record<string, unknown> = {}) => ({ id, type: 'arrow', x: 0, y: 0, width: 100, height: 0, angle: 0, isDeleted: false, frameId: null, groupIds: [], points: [[0, 0], [100, 0]], startBinding: from ? { elementId: from, focus: 0, gap: 1 } : null, endBinding: to ? { elementId: to, focus: 0, gap: 1 } : null, startArrowhead: null, endArrowhead: 'arrow', ...extra });
const step = (state: ReturnType<typeof parseScene>['state'], id: string): StepV2 => state.objects[id] as StepV2;

describe('tolerant world/2 scene parser', () => {
  it('reads shapes, labels, any font, rotation, palette colours, groups and frames', () => {
    const { state, unmodeled } = parseScene(file([
      { id: 'frm', type: 'frame', x: 0, y: 0, width: 800, height: 400, angle: 0, isDeleted: false, frameId: null, name: null },
      shape('r1', 'rectangle', { frameId: 'frm', angle: 1.2, groupIds: ['inner', 'outer'], backgroundColor: '#ffec99' }), text('t1', 'r1', 'Review\norder', { fontFamily: 1 }),
      shape('e1', 'ellipse', { strokeColor: '#e03131', backgroundColor: '#a5d8ff', groupIds: ['outer'] }), text('t2', 'e1', 'Ship'),
      shape('d1', 'diamond', { strokeColor: '#c2255c', backgroundColor: '#ff8787' }),
    ]));
    assert.deepEqual(step(state, 'r1'), { id: 'r1', type: 'step', deleted: false, frameId: 'frm', label: 'Review\norder', x: 10, y: 21, width: 150, height: 80, shape: 'rectangle', groupId: 'outer', stroke: 'black', fill: 'yellow' });
    assert.deepEqual([step(state, 'e1').shape, step(state, 'e1').stroke, step(state, 'e1').fill, step(state, 'e1').groupId, step(state, 'e1').frameId], ['ellipse', 'red', 'blue', 'outer', null]);
    // Off-palette colours fall to the nearest named one; a shape without text is an unlabelled step.
    assert.deepEqual([step(state, 'd1').shape, step(state, 'd1').stroke, step(state, 'd1').fill, step(state, 'd1').label], ['diamond', 'red', 'red', '']);
    assert.deepEqual(state.objects.frm, { id: 'frm', type: 'frame', deleted: false, name: '' });
    assert.deepEqual(unmodeled, []);
  });
  it('lists free text, arrow labels and unknown element kinds as unmodeled instead of failing', () => {
    const { state, unmodeled } = parseScene(file([
      shape('a', 'rectangle'), text('ta', 'a', 'A'), shape('b', 'rectangle'), text('tb', 'b', 'B'),
      arrow('ab', 'a', 'b'), text('lab', 'ab', 'yes'), text('free', null, 'Note'),
      { id: 'img', type: 'image', x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null, fileId: 'x' },
      { id: 'ln', type: 'line', x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null },
      { id: 'hand', type: 'freedraw', x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null },
    ]));
    assert.equal(Object.keys(state.objects).length, 3);
    assert.deepEqual(unmodeled.map(u => [u.id, u.reason]), [['lab', 'arrow_label'], ['free', 'free_text'], ['img', 'unsupported_type'], ['ln', 'unsupported_type'], ['hand', 'unsupported_type']]);
  });
  it('arrow ends follow bindings, loose ends are null, and a single head at the start reverses direction', () => {
    const { state } = parseScene(file([
      shape('a', 'rectangle'), shape('b', 'rectangle'), shape('gone', 'rectangle', { isDeleted: true }),
      arrow('ab', 'a', 'b'), arrow('back', 'a', 'b', { startArrowhead: 'arrow', endArrowhead: null }), arrow('loose', 'a', 'gone'), arrow('free', null, null),
    ]));
    assert.deepEqual([state.objects.ab, state.objects.back, state.objects.loose, state.objects.free].map(o => o && o.type === 'arrow' ? [o.from, o.to] : null), [['a', 'b'], ['b', 'a'], ['a', null], [null, null]]);
    assert.equal(state.objects.gone, undefined);
  });
  it('arrow frames are derived from their ends like world/2 transitions', () => {
    const { state } = parseScene(file([
      { id: 'f1', type: 'frame', x: 0, y: 0, width: 10, height: 10, isDeleted: false, frameId: null, name: 'One' },
      shape('a', 'rectangle', { frameId: 'f1' }), shape('b', 'rectangle', { frameId: 'f1' }), shape('c', 'rectangle'),
      arrow('ab', 'a', 'b'), arrow('ac', 'a', 'c', { frameId: 'f1' }),
    ]));
    assert.equal(state.objects.ab!.type === 'arrow' && state.objects.ab!.frameId, 'f1');
    assert.equal(state.objects.ac!.type === 'arrow' && state.objects.ac!.frameId, null);
  });
  it('unsafe or ambiguous input is artifact_invalid, never a crash or a silent fix', () => {
    const reject = (input: string, pattern: RegExp): void => assert.throws(() => parseScene(input), (error: unknown) => error instanceof CheckerError && error.code === 'artifact_invalid' && pattern.test(error.message));
    reject('{"type":"excalidraw","elements":[', /bounded valid JSON/);
    reject(JSON.stringify({ type: 'other', elements: [] }), /not an Excalidraw scene/);
    reject(file([shape('a', 'rectangle'), shape('a', 'ellipse')]), /duplicate native id/);
    reject(file([shape('a', 'rectangle', { x: Number.MAX_SAFE_INTEGER })]), /invalid x/);
    reject(file([shape('a', 'rectangle'), text('t', 'a', 'A​B')]), /invisible format/);
    reject(file([shape('a', 'rectangle', { customData: { practonautId: 'b' } }), shape('b', 'rectangle')]), /duplicate semantic id/);
    assert.throws(() => parseScene(Buffer.alloc(10 * 1024 * 1024 + 1, 32)), /10 MiB/);
  });
  it('non-semantic native ids get a stable derived identity', () => {
    const one = parseScene(file([shape('x.y:z', 'rectangle')])), two = parseScene(file([shape('x.y:z', 'rectangle')]));
    const [id] = Object.keys(one.state.objects);
    assert.match(id!, /^s-[0-9a-f]{40}$/);
    assert.deepEqual(one, two);
  });
});

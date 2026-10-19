// PADR-0049 decision 4.2 against the real app: the spike's 12 silent-change cases, written through the
// conformance seam as hand-written XML. The 10 in which draw.io changed, dropped or kept invalid
// content must be refused by the adapter's checks (declared set, full write check, integrity); the 2 it
// keeps exactly must round-trip. Added: a step that comes back with visible="0", a terminal point moved
// from x=20 to x=999, a tab, CR and CRLF in labels (round trip), and a C0 control refused before writing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawioAdapter, type DrawioAdapter } from '../../../src/adapters/drawio/index.ts';
import { freshMemory, modelXml, writeCells, type XmlNode } from '../../../src/adapters/drawio/writer.ts';
import type { State } from '../../../src/world/types.ts';
import { stepV2 } from '../../support/world-v2.ts';
import { drawioAvailability } from '../../support/drawio.ts';

const availability = await drawioAvailability();
const MARKUP = '<b>x</b><img src=x onerror=alert(1)>';
const objects = (...list: State['objects'][string][]): State => ({ objects: Object.fromEntries(list.map(o => [o.id, o])) });
const cellsOf = (state: State): XmlNode[] => writeCells(state, freshMemory());
const cell = (cells: XmlNode[], id: string): XmlNode => cells.find(c => c.attrs.id === id)!;
const live = (state: State): State['objects'] => Object.fromEntries(Object.entries(state.objects).filter(([, o]) => !o.deleted));
const BASE = objects(stepV2('base', 'previous diagram', 10, 20));

test('silent changes: every case draw.io changes, drops or keeps invalid is refused; what it keeps exactly round-trips', { skip: availability.ok ? false : availability.skip, timeout: 300_000 }, async () => {
  const adapter: DrawioAdapter = await createDrawioAdapter(BASE, {}, undefined, availability.ok ? { runtimePath: availability.runtime.runtimePath } : {});
  try {
    /** Writes `xml` after a known baseline and returns every finding of the adapter's checks against `intended`. */
    const write = async (xml: string, expected: XmlNode[], intended: State): Promise<{ issues: string[]; declaredSet: boolean }> => {
      const baseline = await adapter.restoreState(BASE); assert.equal(baseline.ok, true, JSON.stringify(baseline));
      const result = await adapter.conformanceWrite(xml, expected);
      return { issues: result.issues, declaredSet: JSON.stringify(live(result.state)) === JSON.stringify(live(intended)) };
    };
    const refused = async (id: string, xml: string, expected: XmlNode[], intended: State): Promise<void> => {
      const result = await write(xml, expected, intended);
      assert.ok(result.issues.length > 0 || !result.declaredSet, `${id}: draw.io's change went unnoticed`);
    };
    const kept = async (id: string, state: State): Promise<void> => {
      const cells = cellsOf(state);
      const result = await write(modelXml(cells), cells, state);
      assert.deepEqual(result.issues, [], id); assert.equal(result.declaredSet, true, id);
    };
    const a = stepV2('s1', 'A', 10, 20), b = stepV2('s2', 'B', 300, 20);
    // 1. An edge to a missing target: draw.io drops the target.
    { const cells = cellsOf(objects(a)); cells.push({ name: 'mxCell', attrs: { id: 'e1', value: '', style: 'endArrow=classic;html=0;', edge: '1', parent: 'pn:layer', source: 's1', target: 'ghost' }, children: [{ name: 'mxGeometry', attrs: { relative: '1', as: 'geometry' }, children: [] }] });
      await refused('edge-missing-target', modelXml(cells), cells, objects(a, { id: 'e1', type: 'arrow', deleted: false, frameId: null, from: 's1', to: 'ghost' })); }
    // 2. A duplicate id: draw.io renames the second cell.
    { const cells = [...cellsOf(objects(a)), cell(cellsOf(objects(stepV2('s1', 'B', 300, 20))), 's1')];
      await refused('duplicate-id', modelXml(cells), cells, objects(a)); }
    // 3. An edge as a parent: kept as written, refused by integrity.
    { const cells = cellsOf(objects(a, b, { id: 'e1', type: 'arrow', deleted: false, frameId: null, from: 's1', to: 's2' }, stepV2('s3', 'C', 600, 20)));
      cell(cells, 's3').attrs.parent = 'e1';
      await refused('parent-is-edge', modelXml(cells), cells, objects(a, b, stepV2('s3', 'C', 600, 20))); }
    // 4. A parent cycle: draw.io drops both cells.
    { const cells = cellsOf(objects(stepV2('p1', 'A', 10, 20), stepV2('p2', 'B', 300, 20))); cell(cells, 'p1').attrs.parent = 'p2'; cell(cells, 'p2').attrs.parent = 'p1';
      await refused('parent-cycle', modelXml(cells), cells, objects(stepV2('p1', 'A', 10, 20), stepV2('p2', 'B', 300, 20))); }
    // 5. A colour outside the adapter's table: kept, refused by integrity.
    { const cells = cellsOf(objects(a)); cell(cells, 's1').attrs.style = 'rounded=0;html=0;strokeColor=#000000;fillColor=notacolor;';
      await refused('invalid-colour', modelXml(cells), cells, objects(a)); }
    // 6. Markup as a plain-text label (html=0): kept exactly, as text.
    await kept('markup-label-html0', objects(stepV2('s1', MARKUP, 10, 20)));
    // 8. Non-integer geometry: kept, refused by integrity.
    { const cells = cellsOf(objects(a)); cell(cells, 's1').children[0]!.attrs.x = '10.5';
      await refused('non-integer-geometry', modelXml(cells), cells, objects(a)); }
    // 9. A missing parent: draw.io moves the cell into its first layer; only the write check sees it.
    { const cells = cellsOf(objects(a)); cell(cells, 's1').attrs.parent = 'nowhere';
      await refused('missing-parent', modelXml(cells), cells, objects(a)); }
    // 10. A wrong prediction: the app writes what it is given.
    { const cells = cellsOf(objects(a));
      await refused('wrong-prediction', modelXml(cellsOf(objects(stepV2('s1', 'B', 10, 20)))), cells, objects(a)); }
    // 11. Umlauts, NFD, emoji, quotes and 2,048 characters: kept exactly.
    await kept('labels-unicode', objects(stepV2('s1', 'Grüße & <Tags> "quoted" \'single\'', 10, 20), stepV2('s2', 'Prüfung', 300, 20), stepV2('s3', '📦 Versand', 600, 20), stepV2('s4', 'Ä'.repeat(2048), 900, 20)));
    // 12. Malformed XML: draw.io keeps the previous diagram.
    { const cells = cellsOf(objects(a));
      await refused('malformed-xml', modelXml(cells).slice(0, -40), cells, objects(a)); }
    // Added: a step that comes back hidden, and a terminal point that comes back moved.
    { const cells = cellsOf(objects(a)), written = structuredClone(cells); cell(written, 's1').attrs.visible = '0';
      await refused('visible-0', modelXml(written), cells, objects(a)); }
    { const state = objects(a, { id: 'e1', type: 'arrow', deleted: false, frameId: null, from: 's1', to: null });
      const cells = cellsOf(state); const point = cell(cells, 'e1').children[0]!.children[0]!; point.attrs.x = '20';
      const written = structuredClone(cells); cell(written, 'e1').children[0]!.children[0]!.attrs.x = '999';
      await refused('terminal-point-moved', modelXml(written), cells, state); }
    // Added: a tab, a CR and a CRLF in labels round-trip as written (character references).
    await kept('tab-cr-crlf', objects(stepV2('s1', 'a\tb', 10, 20), stepV2('s2', 'a\rb', 300, 20), stepV2('s3', 'a\r\nb', 600, 20)));
    // Added: a C0 control cannot be stored in XML: refused by name before anything is written.
    const control = await adapter.restoreState(objects(stepV2('s1', 'a\u0001b', 10, 20)));
    assert.equal(control.ok, false); assert.equal(!control.ok && control.error.code, 'constraint_refused');
    assert.deepEqual(adapter.networkAttempts(), []);
    // 7, last: markup with html=1. The app renders it as HTML and its <img> asks for a file: the shell
    // refuses and records the request, and the adapter refuses the write (and every operation after it).
    { const cells = cellsOf(objects(stepV2('s1', MARKUP, 10, 20))); cell(cells, 's1').attrs.style = 'rounded=0;html=1;strokeColor=#000000;fillColor=none;';
      await refused('markup-label-html1', modelXml(cells), cells, objects(stepV2('s1', MARKUP, 10, 20)));
      assert.ok(adapter.networkAttempts().some(url => new URL(url).pathname === '/x'), JSON.stringify(adapter.networkAttempts()));
      const after = await adapter.restoreState(BASE);
      assert.equal(!after.ok && after.error.code, 'mirror_unavailable'); }
  } finally { await adapter.close(); }
});

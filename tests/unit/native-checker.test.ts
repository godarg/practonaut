import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseExcalidraw } from '../../src/checker/index.ts';
const native = (name: string) => readFileSync(`tests/fixtures/native/${name}.excalidraw`);
test('native arrow deletion ignores historical binding caches on tombstones', () => {
  for (const fixture of ['native-arrow-deleted', 'native-repair']) {
    const state = parseExcalidraw(native(fixture));
    const deleted = state.objects.bc;
    assert.equal(deleted?.type, 'arrow');
    assert.equal(deleted?.deleted, true);
    if (deleted?.type === 'arrow') { assert.equal(deleted.from, null); assert.equal(deleted.to, null); }
  }
});
test('native checker refuses invisible real-engine exports and visually reversed arrows', () => {
  assert.ok(Object.keys(parseExcalidraw(native('h1-visible')).objects).length > 0);
  for (const fixture of ['h1-invisible', 'h1-reversed-arrowheads']) {
    assert.throws(() => parseExcalidraw(native(fixture)), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'artifact_invalid', fixture);
  }
});
test('native parser retains its actual pilot font-family boundary', () => {
  const exportFile = JSON.parse(native('h1-visible').toString()) as { elements: Array<{ type: string; fontFamily?: number }> };
  for (const element of exportFile.elements) if (element.type === 'text') element.fontFamily = 1;
  assert.throws(() => parseExcalidraw(JSON.stringify(exportFile)), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'artifact_invalid');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../../src/core/apply.ts';
import { validateWorld } from '../../src/world/schema.ts';
import { buildWorld } from '../../tools/freeze-world.ts';
import { ACTION_NAMES } from '../../src/world/types.ts';
const world = () => {
  const w = buildWorld(Object.fromEntries(ACTION_NAMES.map(name => [name, { run: 'own-scripted-text-domain-test', case: name, sha256: 'a'.repeat(64) }])));
  w.initialState = structuredClone(w.tasks.find(task => task.id === 'T3')!.initialState!); return w;
};
for (const label of ['hidden\u200btext', '\u202eReverse', 'Cafe\u0301']) test(`runtime refuses checker-incompatible label ${JSON.stringify(label)}`, () => {
  const w = world(), before = structuredClone(w.initialState);
  const result = apply(w, before, { name: 'rename_step', params: { id: 'a', label } });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.error.code, 'invalid_argument');
  assert.deepEqual(before, w.initialState);
  if (w.initialState.objects.a?.type === 'step') w.initialState.objects.a.label = label;
  assert.throws(() => validateWorld(w), /NFC|invisible/);
});
test('NFC accented and non-Latin visible labels remain supported', () => {
  const w = world();
  for (const label of ['Café', 'مرحبا', '確認', '__proto__']) assert.equal(apply(w, w.initialState, { name: 'rename_step', params: { id: 'a', label } }).ok, true);
});

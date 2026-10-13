import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Session } from '../../src/core/session.ts';
import { checkState, checkSubmission, parseExcalidraw } from '../../src/checker/index.ts';
import { stateHash } from '../../src/canonical/index.ts';
import type { World } from '../../src/world/types.ts';
const world = () => JSON.parse(readFileSync(new URL('../fixtures/core/world.json', import.meta.url), 'utf8')) as World;
const artifactInvalid = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'artifact_invalid';
test('genuine model sessions admit safe integer geometry beyond the native pilot range', () => {
  for (const x of [1_000_001, -1_000_001, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
    const w = world(), session = new Session(w, 17, 'T1');
    assert.equal(session.act({ name: 'move_step', params: { id: 'a', x, y: 0 } }).ok, true);
    assert.equal(checkState(w, session.state).passed, false);
    assert.equal(checkSubmission(w, JSON.stringify(session.serialize())).passed, false);
  }
});
test('unsafe integer geometry remains invalid in both runtime and checker', () => {
  const w = world(), session = new Session(w, 17, 'T1');
  assert.equal(session.act({ name: 'move_step', params: { id: 'a', x: Number.MAX_SAFE_INTEGER + 1, y: 0 } }).ok, false);
  const data = session.serialize();
  if (data.state.objects.a?.type === 'step') data.state.objects.a.x = Number.MAX_SAFE_INTEGER + 1;
  assert.throws(() => checkState(w, data.state), artifactInvalid);
  assert.throws(() => checkSubmission(w, JSON.stringify(data)), artifactInvalid);
});
test('independent history enforces declared action clamps even inside the safe integer domain', () => {
  const w = world(); w.actions.find(action => action.name === 'move_step')!.parameters.x!.max = 1_000_000;
  const session = new Session(w, 17, 'T1');
  const before = session.serialize();
  assert.equal(session.act({ name: 'move_step', params: { id: 'a', x: 1_000_001, y: 0 } }).ok, false);
  assert.deepEqual(session.serialize(), before);
  assert.equal(session.act({ name: 'move_step', params: { id: 'a', x: 1_000_000, y: 0 } }).ok, true);
  const data = session.serialize(); data.log[0]!.action.params.x = 1_000_001;
  if (data.state.objects.a?.type === 'step') data.state.objects.a.x = 1_000_001;
  data.hash = stateHash(data.state); data.log[0]!.hash = data.hash;
  assert.throws(() => checkSubmission(w, JSON.stringify(data)), artifactInvalid);
});
test('native export geometry retains its bounded actual pilot domain', () => {
  const native = JSON.parse(readFileSync(new URL('../fixtures/native/h1-visible.excalidraw', import.meta.url), 'utf8')) as { elements: Array<{ type: string; x: number }> };
  native.elements.find(element => element.type === 'rectangle')!.x = 1_000_001;
  assert.throws(() => parseExcalidraw(JSON.stringify(native)), artifactInvalid);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stateHash } from '../../src/canonical/index.ts';
import { Session } from '../../src/core/session.ts';
import { checkState, checkSubmission } from '../../src/checker/index.ts';
import { buildWorld } from '../../tools/freeze-world.ts';
import { ACTION_NAMES, type Action, type SessionData, type State, type World } from '../../src/world/types.ts';
const world = () => buildWorld(Object.fromEntries(ACTION_NAMES.map(name => [name, { run: 'own-scripted-regression-fixture', case: name, sha256: 'a'.repeat(64) }])));
function solved() {
  const w = world(), s = new Session(w, 42, 'T3');
  for (const action of [{ name: 'reconnect_end', params: { id: 'ab', end: 'end', target: 'c' } }, { name: 'disconnect', params: { id: 'bc' } }, { name: 'delete_step', params: { id: 'b' } }]) assert.equal(s.act(action).ok, true);
  return { w, data: s.serialize() };
}
const artifactInvalid = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'artifact_invalid';
test('independent session history accepts genuine solved and failing sessions', () => {
  const { w, data } = solved(); assert.equal(checkSubmission(w, JSON.stringify(data)).passed, true);
  const failing = new Session(w, 42, 'T3').serialize(); assert.equal(checkSubmission(w, JSON.stringify(failing)).passed, false);
});
test('independent history covers all seven transitions and the existing manually written Golden state', () => {
  const w = JSON.parse(readFileSync(new URL('../fixtures/core/world.json', import.meta.url), 'utf8')) as World;
  const golden = JSON.parse(readFileSync(new URL('../fixtures/core/golden-final.json', import.meta.url), 'utf8')) as { seed: number; actions: Action[]; state: State; hash: string };
  const session = new Session(w, golden.seed, 'T1');
  for (const action of golden.actions) assert.equal(session.act(action).ok, true);
  assert.deepEqual(session.state, golden.state);
  assert.equal(session.hash, golden.hash);
  assert.equal(checkSubmission(w, JSON.stringify(session.serialize())).passed, true);
  // Undo then reapply must preserve the admitted creation prefix and history.
  assert.equal(session.undo().ok, true);
  assert.equal(session.act(golden.actions.at(-1)!).ok, true);
  assert.equal(checkSubmission(w, JSON.stringify(session.serialize())).passed, true);
});
test('session and end-state checker reject a font outside the world declaration', () => {
  const { w, data } = solved();
  for (const object of Object.values(data.state.objects)) if (object.type === 'step') (object as { fontFamily: number }).fontFamily = 1;
  data.hash = stateHash(data.state); data.log.at(-1)!.hash = data.hash;
  assert.throws(() => checkState(w, data.state), artifactInvalid);
  assert.throws(() => checkSubmission(w, JSON.stringify(data)), artifactInvalid);
});
const changes: Record<string, (data: SessionData) => void> = {
  'rewritten log action with untouched hashes': data => { data.log[0]!.action.params.target = 'a'; },
  'dropped history with retained solved state': data => { data.log = []; },
  'changed state and recomputed final hash': data => { if (data.state.objects.a?.type === 'step') data.state.objects.a.x += 10; data.hash = stateHash(data.state); data.log.at(-1)!.hash = data.hash; },
  'fabricated unknown action': data => { data.log = [{ action: { name: 'teleport', params: {} }, hash: data.hash }]; },
  'fabricated legal but failing action sequence': data => { data.log = [{ action: { name: 'move_step', params: { id: 'a', x: 100, y: 100 } }, hash: data.hash }]; },
};
for (const [name, change] of Object.entries(changes)) test(`independent session history refuses ${name}`, () => {
  const { w, data } = solved(); change(data);
  assert.throws(() => checkSubmission(w, JSON.stringify(data)), artifactInvalid);
});

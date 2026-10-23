// PADR-0049 decision 1.2 and 5.2: an application declares, as data in the world table, which states it
// cannot hold. World validation, the core and the checker refuse such states generically and by name
// (`constraint_refused`), never by testing an adapter id; `unmodeled` keeps its meaning. Expected values
// are derived by hand from the record (draw.io: one parent per cell, text stored as XML 1.0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { KNOWN_APPS, structuralConstraintsOf } from '../../src/world/apps.ts';
import { constraintViolation, isXmlText, STRUCTURAL_CONSTRAINTS } from '../../src/world/constraints.ts';
import { validateWorld, WorldError } from '../../src/world/schema.ts';
import { Session } from '../../src/core/index.ts';
import { stateHash } from '../../src/canonical/index.ts';
import { brokenConstraint } from '../../src/checker/constraints.ts';
import { checkState, checkSubmission, CheckerError } from '../../src/checker/index.ts';
import { createPracticeController } from '../../src/host/session.ts';
import { createBridge } from '../../src/mcp/bridge.ts';
import { catalogs } from '../../src/player/messages.ts';
import type { State, World } from '../../src/world/types.ts';
import { stepV2, v2Task } from '../support/world-v2.ts';

const DRAWIO = { adapterId: 'drawio', versionRange: '32.4.1' };
const EXCALIDRAW = { adapterId: 'excalidraw', versionRange: '0.18.1' };
// Two frames, a group of two steps in frame f1, a third step in f2, one step outside every frame.
const start: State = { objects: {
  f1: { id: 'f1', type: 'frame', deleted: false, name: 'Intake' },
  f2: { id: 'f2', type: 'frame', deleted: false, name: 'Ship' },
  a: stepV2('a', 'Receive', 100, 100, { frameId: 'f1', groupId: 'g1' }),
  b: stepV2('b', 'Check', 400, 100, { frameId: 'f1', groupId: 'g1' }),
  c: stepV2('c', 'Pack', 100, 400, { frameId: 'f2' }),
  d: stepV2('d', 'Archive', 900, 900),
} };
const world = (app: object, extra: Record<string, unknown> = {}): World => validateWorld({ schema: 'practonaut.world/2', id: 'constraints', version: '1.0.0', app, initialState: start, tasks: [v2Task()], provenance: { authors: ['Practonaut contributors'] }, rights: { license: 'CC0-1.0' }, ...extra });
const with_ = (changes: Record<string, object>): State => { const s = structuredClone(start); for (const [id, change] of Object.entries(changes)) Object.assign(s.objects[id]!, change); return s; };
const both = (state: State, constraints: readonly string[]) => {
  const world = constraintViolation(state, constraints as never), checker = brokenConstraint(state, constraints);
  return [world && { constraint: world.constraint, objectId: world.objectId }, checker];
};

test('the world table declares draw.io\'s two constraints and none for Excalidraw, from the closed list', () => {
  assert.deepEqual([...STRUCTURAL_CONSTRAINTS], ['group-within-one-frame', 'xml-text']);
  assert.deepEqual([...KNOWN_APPS.drawio.structural].sort(), ['group-within-one-frame', 'xml-text']);
  assert.deepEqual([...KNOWN_APPS.excalidraw.structural], []);
  assert.deepEqual(structuralConstraintsOf('unknown'), []);
});

test('both implementations find the same violation on hand-made states', () => {
  const all = STRUCTURAL_CONSTRAINTS;
  const cases: Array<[string, State, { constraint: string; objectId: string } | null]> = [
    ['a group within one frame', start, null],
    ['a group split over two frames', with_({ b: { frameId: 'f2' } }), { constraint: 'group-within-one-frame', objectId: 'g1' }],
    ['a group with one member outside every frame', with_({ b: { frameId: null } }), { constraint: 'group-within-one-frame', objectId: 'g1' }],
    ['a group outside every frame', with_({ a: { frameId: null }, b: { frameId: null } }), null],
    ['a deleted member elsewhere does not count', with_({ b: { frameId: 'f2', deleted: true } }), null],
    ['tab, LF, CR and an emoji are XML text', with_({ c: { label: 'a\tb\nc\rd 📦' } }), null],
    ['a C0 control in a label', with_({ c: { label: 'a\u0001b' } }), { constraint: 'xml-text', objectId: 'c' }],
    ['a vertical tab in a frame name', with_({ f2: { name: 'Ship\u000B' } }), { constraint: 'xml-text', objectId: 'f2' }],
    ['the noncharacter U+FFFE', with_({ d: { label: 'x￾' } }), { constraint: 'xml-text', objectId: 'd' }],
    ['a lone surrogate', with_({ d: { label: 'x\uD800' } }), { constraint: 'xml-text', objectId: 'd' }],
  ];
  for (const [name, state, expected] of cases) assert.deepEqual(both(state, all), [expected, expected], name);
  assert.deepEqual(both(with_({ b: { frameId: 'f2' }, c: { label: '\u0001' } }), []), [null, null], 'nothing declared, nothing refused');
  assert.equal(isXmlText('\u0000'), false); assert.equal(isXmlText('\u{10FFFF}'), true); assert.equal(isXmlText('￿'), false);
});

test('world validation refuses a draw.io world whose stated state or a variant breaks a constraint; Excalidraw accepts it', () => {
  const spanning = with_({ b: { frameId: 'f2' } });
  assert.throws(() => world(DRAWIO, { initialState: spanning }), (error: unknown) => error instanceof WorldError && error.code === 'E_WORLD_INVALID' && /group-within-one-frame/.test(error.message) && /g1/.test(error.message));
  assert.doesNotThrow(() => world(EXCALIDRAW, { initialState: spanning }));
  // A label that becomes a control character only once a variant's token is substituted.
  const templated = with_({ c: { label: '{{tag}}' } });
  const variants = { generator: 'finite-seeded-v1', cases: [{ id: 'plain', labels: { tag: 'Pack' } }, { id: 'broken', labels: { tag: 'Pa\u0001ck' } }] };
  assert.throws(() => world(DRAWIO, { initialState: templated, variants }), (error: unknown) => error instanceof WorldError && /xml-text/.test(error.message) && /broken/.test(error.message));
  assert.doesNotThrow(() => world(EXCALIDRAW, { initialState: templated, variants }));
  // A task's own start state is checked too.
  assert.throws(() => world(DRAWIO, { tasks: [v2Task({ initialState: spanning })] }), (error: unknown) => error instanceof WorldError && /group-within-one-frame/.test(error.message));
});

test('the core refuses a successor draw.io cannot hold by name, with state and hash unchanged; Excalidraw accepts it', () => {
  const refusals: Array<[string, { name: string; params: Record<string, unknown> }, string]> = [
    ['set_frame of a grouped step', { name: 'set_frame', params: { id: 'b', frameId: 'f2' } }, 'group-within-one-frame'],
    ['set_frame of a grouped step out of every frame', { name: 'set_frame', params: { id: 'a', frameId: null } }, 'group-within-one-frame'],
    ['group_steps across frames', { name: 'group_steps', params: { id: 'c', with: 'a' } }, 'group-within-one-frame'],
    ['rename_step with a control character', { name: 'rename_step', params: { id: 'c', label: 'Pa\u0001ck' } }, 'xml-text'],
    ['rename_frame with a noncharacter', { name: 'rename_frame', params: { id: 'f2', name: 'Ship￾' } }, 'xml-text'],
    ['add_step with a control character', { name: 'add_step', params: { frameId: null, label: '\u0002', x: 0, y: 0, width: 100, height: 60, shape: 'rectangle' } }, 'xml-text'],
  ];
  for (const [name, action, constraint] of refusals) {
    const session = new Session(world(DRAWIO), 1, 'T1');
    const before = stateHash(session.state);
    const result = session.act(action as never);
    assert.equal(result.ok, false, name);
    if (result.ok) continue;
    assert.equal(result.error.code, 'constraint_refused', name);
    assert.equal(result.error.details.constraint, constraint, name);
    assert.notEqual(result.error.code, 'unmodeled');
    assert.equal(stateHash(session.state), before, `${name}: the state is unchanged`);
    assert.equal(session.step, 0, `${name}: nothing entered the history`);
    const excalidraw = new Session(world(EXCALIDRAW), 1, 'T1');
    assert.equal(excalidraw.act(action as never).ok, true, `${name}: the same action on Excalidraw`);
  }
  // Moving the whole group stays possible on draw.io: ungroup, move, group again.
  const session = new Session(world(DRAWIO), 1, 'T1');
  for (const action of [{ name: 'ungroup', params: { id: 'a' } }, { name: 'set_frame', params: { id: 'a', frameId: 'f2' } }, { name: 'set_frame', params: { id: 'b', frameId: 'f2' } }, { name: 'group_steps', params: { id: 'a', with: 'b' } }]) {
    const result = session.act(action as never);
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test('the checker refuses a forged history step and a submitted state that draw.io cannot hold', () => {
  const drawio = world(DRAWIO), excalidraw = world(EXCALIDRAW);
  const spanning = with_({ b: { frameId: 'f2' } });
  const refusedBy = (constraint: string) => (error: unknown) => error instanceof CheckerError && error.code === 'artifact_invalid' && error.details.reason === 'constraint' && error.details.constraint === constraint;
  assert.throws(() => checkState(drawio, spanning, { taskId: 'T1' }), refusedBy('group-within-one-frame'));
  assert.doesNotThrow(() => checkState(excalidraw, spanning, { taskId: 'T1' }));
  // A session whose log holds a step the host would have refused: the checker replays it itself.
  const legit = new Session(excalidraw, 1, 'T1');
  assert.equal(legit.act({ name: 'set_frame', params: { id: 'b', frameId: 'f2' } }).ok, true);
  const data = legit.serialize();
  assert.throws(() => checkSubmission(drawio, JSON.stringify(data), { format: 'session' }), refusedBy('group-within-one-frame'));
});

test('the host keeps the constraint\'s name, the MCP bridge passes the same reply, and the Player has a text for it', async () => {
  const controller = await createPracticeController(world(DRAWIO), { seed: 1, taskId: 'T1', mirror: 'off' }, async () => { throw new Error('mirror must not start'); });
  try {
    const before = controller.view();
    const reply = await controller.act({ expectedRevision: before.revision, action: { name: 'set_frame', params: { id: 'b', frameId: 'f2' }, baseStep: 0 } } as never);
    assert.equal(reply.ok, false);
    if (reply.ok) return;
    assert.deepEqual([reply.error.code, reply.error.details], ['constraint_refused', { constraint: 'group-within-one-frame' }]);
    assert.match(reply.error.message, /group/);
    assert.equal(controller.view().hash, before.hash);
    // The bridge admits exactly this reply for the agent (it refuses unknown detail shapes).
    const token = randomBytes(32).toString('hex');
    const server = createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.statusCode = 409; response.end(JSON.stringify(reply)); });
    await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    try {
      const bridge = await createBridge({ host: `http://127.0.0.1:${address.port}`, token });
      const forwarded = await bridge.call('act', { name: 'set_frame', params: { id: 'b', frameId: 'f2' }, baseStep: 0, expectedRevision: before.revision });
      assert.deepEqual(forwarded, reply);
    } finally { await new Promise<void>(done => server.close(() => done())); }
  } finally { await controller.close(); }
  for (const language of ['en', 'de'] as const) for (const key of ['constraint_refused', 'constraintGroupWithinOneFrame', 'constraintXmlText'] as const) assert.ok(catalogs[language][key].length > 20, `${language} ${key}`);
});

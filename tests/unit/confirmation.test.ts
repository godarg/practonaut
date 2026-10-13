import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureRecorder } from '../../src/adapters/excalidraw/recorder.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import { createAuthorProject, confirmHypothesis, compileProject, observationRef } from '../../src/authoring/index.ts';
import type { Recording } from '../../src/adapters/excalidraw/recorder-types.ts';
import type { State } from '../../src/world/types.ts';
function fixture() {
  const start: State = { objects: { f: { id: 'f', type: 'frame', name: 'Process', deleted: false }, s: { id: 's', type: 'step', frameId: 'f', label: 'One', x: 10, y: 20, width: 180, height: 100, fontFamily: 3, deleted: false } } };
  const r = createGestureRecorder(); r.start(toRaw(start), true);
  for (const label of ['Two', 'Three']) { const state = structuredClone(start); if (state.objects.s?.type === 'step') state.objects.s.label = label; r.observe(toRaw(state)); r.boundary('key'); }
  r.stop();
  const recording: Recording = { manifest: { schema: 'practonaut.recording/1', id: 'same-recording', createdAt: '2026-10-09T00:00:00Z', stoppedAt: '2026-10-09T00:00:01Z', appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: 'excalidraw-gesture-v1', author: 'Own synthetic regression fixture', license: 'CC0-1.0', consent: 'No personal data', demonstration: 'scripted', status: 'review' }, initial: r.initial, gestures: r.gestures };
  return { recording, project: createAuthorProject([recording]) };
}
test('a different gesture of the proposal recording cannot confirm a hypothesis', () => {
  const { recording, project } = fixture();
  assert.throws(() => confirmHypothesis(project, { hypothesisId: 'rename-step-v1', evidence: observationRef(recording, 1) }, [recording]), /confirmation_requires_new_observation/);
});
test('compiler independently rejects same-recording evidence in a fabricated confirmed project', () => {
  const { recording, project } = fixture();
  const h = project.hypotheses[0]!; h.status = 'confirmed'; h.confirmingEvidence = [observationRef(recording, 1)];
  const task = { id: 'rename', title: { en: 'Rename', de: 'Umbenennen' }, prompt: { en: 'Rename One to Target.', de: 'Benenne One in Target um.' }, goal: { op: 'exists' as const, type: 'step' as const, as: 's', where: { op: 'eq' as const, left: { kind: 'field' as const, variable: 's', field: 'label' }, right: { kind: 'literal' as const, value: 'Target' } } }, hints: [{ en: 'Change the label.', de: 'Ändere die Beschriftung.' }], errorClasses: [] };
  project.tasks = [{ task, solutions: { default: [{ name: 'rename_step', params: { id: 's', label: 'Target' } }] } }];
  const good = structuredClone(project.initialState); if (good.objects.s?.type === 'step') good.objects.s.label = 'Target';
  const alternative = structuredClone(good); if (alternative.objects.s?.type === 'step') alternative.objects.s.x = 80;
  project.checkerFixtures = [{ taskId: 'rename', kind: 'reference', state: good, expected: true }, { taskId: 'rename', kind: 'alternative', state: alternative, expected: true }, { taskId: 'rename', kind: 'near-miss', state: project.initialState, expected: false }];
  assert.throws(() => compileProject({ project, recordings: [recording] }), /confirmation_requires_new_observation/);
});

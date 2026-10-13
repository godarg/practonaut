import { createGestureRecorder } from '../../src/adapters/excalidraw/recorder.ts';
import type { RawElement } from '../../src/adapters/excalidraw/raw.ts';
import type { Recording } from '../../src/adapters/excalidraw/recorder-types.ts';
const frame = (): RawElement => ({ id: 'f', type: 'frame', isDeleted: false, frameId: null, x: 0, y: 0, width: 1000, height: 600, boundElements: [], name: 'Process' });
const rectangle = (): RawElement => ({ id: 'b', type: 'rectangle', isDeleted: false, frameId: 'f', x: 10, y: 20, width: 180, height: 100, boundElements: [] });
const text = (): RawElement => ({ id: 't', type: 'text', isDeleted: false, frameId: 'f', x: 15, y: 25, width: 170, height: 25, boundElements: [], containerId: 'b', originalText: 'Start', text: 'Start', fontFamily: 3 });
export function makeRecording(id = 'test-recording'): Recording {
  const recorder = createGestureRecorder(); recorder.start([frame()], true);
  recorder.observe([frame(), rectangle(), text()]); recorder.boundary('pointerup'); recorder.stop();
  return { manifest: { schema: 'practonaut.recording/1', id, createdAt: '2026-10-04T12:00:00.000Z', stoppedAt: '2026-10-04T12:00:01.000Z', appVersion: '0.18.1', adapterVersion: 'excalidraw-1', coalescingVersion: 'excalidraw-gesture-v1', author: 'Practonaut scripted fixture', license: 'CC0-1.0', consent: 'Self-created fixture, no personal data.', demonstration: 'scripted', status: 'review' }, initial: recorder.initial, gestures: recorder.gestures };
}


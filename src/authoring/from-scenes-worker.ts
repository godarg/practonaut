/** Worker body for `fromScenesBounded`: runs from-scenes off the caller's event loop. Data only in and out. */
import { parentPort, workerData } from 'node:worker_threads';
import { fromScenes, type FromScenesOptions } from './from-scenes.ts';

const input = workerData as { start: string; goal: string; options: FromScenesOptions };
try {
  parentPort!.postMessage({ ok: true, result: fromScenes(input.start, input.goal, input.options) });
} catch (error) {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'from_scenes_failed';
  const message = error instanceof Error ? error.message.replace(/^[a-z_]+: /, '') : 'from-scenes failed';
  parentPort!.postMessage({ ok: false, code, message });
}

/**
 * from-scenes with a deadline, in a worker thread. The derivation is synchronous and, for large
 * scenes, takes seconds; in the session host it must not block the event loop (every other request
 * would wait), and neither caller may run without bound. The worker is terminated at the deadline.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { AuthoringError } from './project.ts';
import type { FromScenesOptions, FromScenesResult } from './from-scenes.ts';

export const FROM_SCENES_DEADLINE_MS = 60_000;
const WORKER = fileURLToPath(new URL(`./from-scenes-worker.${import.meta.url.endsWith('.ts') ? 'ts' : 'js'}`, import.meta.url));

export function fromScenesBounded(start: string | Uint8Array, goal: string | Uint8Array, options: FromScenesOptions = {}, deadlineMs: number = FROM_SCENES_DEADLINE_MS): Promise<FromScenesResult> {
  const text = (scene: string | Uint8Array): string => typeof scene === 'string' ? scene : Buffer.from(scene).toString('utf8');
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER, { workerData: { start: text(start), goal: text(goal), options }, resourceLimits: { maxOldGenerationSizeMb: 512 }, stdout: true, stderr: true });
    let settled = false;
    const settle = (outcome: () => void): void => { if (settled) return; settled = true; clearTimeout(timer); outcome(); void worker.terminate(); };
    const timer = setTimeout(() => settle(() => reject(new AuthoringError('from_scenes_timeout', `deriving the task took longer than ${Math.round(deadlineMs / 1000)} s and was stopped; draw fewer steps or arrows, or split the drawing`))), deadlineMs);
    worker.once('message', (message: { ok: true; result: FromScenesResult } | { ok: false; code: string; message: string }) =>
      settle(() => message.ok ? resolve(message.result) : reject(new AuthoringError(message.code, message.message))));
    worker.once('error', error => settle(() => reject(new AuthoringError(/memory|heap/i.test(error.message) ? 'scene_too_large' : 'from_scenes_failed', /memory|heap/i.test(error.message) ? 'deriving the task ran out of its memory budget; draw fewer steps or arrows' : 'from-scenes stopped unexpectedly'))));
    worker.once('exit', code => settle(() => reject(new AuthoringError('from_scenes_failed', `from-scenes stopped unexpectedly (exit ${code})`))));
  });
}

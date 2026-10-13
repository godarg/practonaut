/** Only this component validates/interprets the bundle; the agent-uid probe opens one byte. No runtime imports. */
import { z } from 'zod';
import { readCheckerBundleFile, readWorldPackageFile } from '../package/index.ts';
import { loadWorldPackage } from '../world/index.ts';
import { checkerDataFromBundle, generateCheckerVariant, checkSubmission } from '../checker/index.ts';
import { generateVariant } from '../world/variant.ts';
import { parseJsonEntry } from '../package/json.ts';
import type { EvaluationAssignment } from './contracts.ts';

const schema = z.strictObject({ mode: z.enum(['assignment', 'verdict']), worldPath: z.string().max(4096), bundlePath: z.string().max(4096), taskId: z.string().min(1).max(64), seed: z.number().int().safe(), instantiated: z.boolean().optional(), input: z.string().max(10 * 1024 * 1024).optional(), expectedBundleSha256: z.string().regex(/^[a-f0-9]{64}$/).optional() });
async function main(): Promise<void> {
  const chunks: Buffer[] = []; let bytes = 0;
  for await (const value of process.stdin) { const chunk = Buffer.from(value); bytes += chunk.length; if (bytes > 16 * 1024 * 1024) throw Error('request'); chunks.push(chunk); }
  const request = schema.parse(parseJsonEntry(Buffer.concat(chunks), 'evaluation-request.json', 64));
  const pack = await readWorldPackageFile(request.worldPath), world = loadWorldPackage(pack);
  const archive = await readCheckerBundleFile(request.bundlePath), data = checkerDataFromBundle(archive, world);
  if (request.expectedBundleSha256 && request.expectedBundleSha256 !== archive.archiveSha256) throw Error('bundle changed');
  // Validate held-out identity before any seal classification or client invocation.
  const rawTask = data.heldOutTasks.find(task => task.id === request.taskId); if (!rawTask) throw Error('not held-out');
  const binding = { ok: true, bundleSha256: archive.archiveSha256, worldSha256: pack.archiveSha256, checkerPid: process.pid };
  if (request.mode === 'assignment') {
    const task = request.instantiated ? generateCheckerVariant(world, data, request.seed).heldOutTasks.find(task => task.id === request.taskId)! : rawTask;
    const initialState = task.initialState ?? (request.instantiated ? generateVariant(world, request.seed).initialState : world.initialState);
    const assignment: EvaluationAssignment = { id: task.id, title: task.title, prompt: task.prompt, initialState };
    process.stdout.write(JSON.stringify({ ...binding, assignment }) + '\n');
  } else {
    if (request.input === undefined) throw Error('input required');
    const verdict = checkSubmission(world, request.input, { seed: request.seed, taskId: request.taskId, bundle: data });
    process.stdout.write(JSON.stringify({ ...binding, verdict }) + '\n');
  }
}
main().catch(() => { process.stdout.write(JSON.stringify({ ok: false, error: { code: 'evaluation_checker_invalid', message: 'Evaluation bundle, task or submission failed validation' } }) + '\n'); process.exitCode = 2; });

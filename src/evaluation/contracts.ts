import type { Localized, State, World, CheckerVerdict } from '../world/types.ts';

/** Public assignment projection; intentionally contains no goal, fixture or hint. */
export interface EvaluationAssignment { id: string; title: Localized; prompt: Localized; initialState: State }
export interface AssignmentReply { ok: true; bundleSha256: string; worldSha256: string; assignment: EvaluationAssignment; checkerPid: number }
export interface VerdictReply { ok: true; bundleSha256: string; worldSha256: string; verdict: CheckerVerdict; checkerPid: number }
export interface CheckerRequest {
  mode: 'assignment' | 'verdict'; worldPath: string; bundlePath: string; taskId: string; seed: number;
  instantiated?: boolean; input?: string; expectedBundleSha256?: string;
}
export interface AgentIdentity { uid: number; gid: number; home: string }
export interface BundleProbe { uid: number; gid: number; readable: boolean; reason: 'opened' | 'permission-denied' }
export interface EvaluationOptions {
  worldPath: string; bundlePath: string; taskId: string; seed: number; output: string;
  unsealed: boolean; identity: AgentIdentity;
  clientPath: string; fixtureClient?: boolean;
}
export function publicEvaluationWorld(world: World, task: EvaluationAssignment): World {
  // A constant false public goal provides no hidden correctness oracle. Only the separate checker judges the result.
  return { ...structuredClone(world), tasks: [{ ...structuredClone(task), goal: { op: 'false' }, hints: [{ en: 'Evaluation supplies no correctness feedback.', de: 'Die Evaluation gibt keine Rückmeldung zur Richtigkeit.' }], errorClasses: [] }] };
}

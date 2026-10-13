import type { Recording } from '../adapters/excalidraw/recorder-types.ts';
import type { RepairIntent } from './recovery-types.ts';
import type { Action, ActionName, CheckerData, CheckerFixture, EvidenceRef, Localized, Rule, State, Task, Variant, World } from '../world/types.ts';

export interface ObservationRef { recordingId: string; gestureIndex: number; sha256: string }
export interface RuleHypothesis {
  id: string; template: string; action: ActionName; status: 'proposed' | 'refuted' | 'confirmed';
  explanation: Localized; proposedFrom: ObservationRef[]; confirmingEvidence: ObservationRef[];
  refutingEvidence: ObservationRef[];
}
export interface ModelQuestion {
  id: string; hypothesisIds: string[]; text: Localized; demonstration: Localized;
  status: 'open' | 'answered'; answeredBy: ObservationRef[];
}
export interface AuthorTask { task: Task; solutions: Record<string, Action[]> }
export interface AuthorProject {
  schema: 'practonaut.author/1'; id: string; version: string; authors: string[];
  recordingIds: string[]; hypotheses: RuleHypothesis[]; questions: ModelQuestion[];
  initialState: State; tasks: AuthorTask[]; heldOutTasks: Task[]; variants: Variant[];
  license: 'CC0-1.0'; notes: string;
  /** Hand-authored independent expected states; never copied from the compiler output. */
  checkerFixtures?: CheckerFixture[];
  heldOutSolutions?: Record<string, Record<string, Action[]>>;
  /** Optional additive local author intent; never included as rule evidence. */
  repair?: RepairIntent;
}
export interface AuthorAnalysis { hypotheses: RuleHypothesis[]; questions: ModelQuestion[] }
export interface ConfirmationRequest { hypothesisId: string; evidence: ObservationRef }
export interface CompileInput { project: AuthorProject; recordings: Recording[] }
export interface CompileResult {
  world: World; checker: CheckerData; worldBytes: Uint8Array; checkerBytes: Uint8Array;
  report: { ruleIds: string[]; openQuestionIds: string[]; variantsChecked: string[];
    demonstrationsPerRule: Record<string, number>; coalescingVersions: string[] };
}
export interface RuleTemplate {
  id: string; action: ActionName; explanation: Localized;
  /** No free-text decision or model output can satisfy this observation predicate. */
  matches(before: State, after: State): boolean;
  rule(evidence: EvidenceRef[]): Rule;
}
/** PADR-0008 boundary. No provider is configured by default in Phase 3. */
export interface ProviderBudget { requests: number; inputTokens: number; outputTokens: number; timeoutMs: number }
export interface ProviderProvenance { provider: string; actualModel: string; promptSha256: string; time: string }
export interface AuthoringProvider {
  propose(input: unknown, schema: object, budget: ProviderBudget): Promise<
    { ok: true; hypotheses: unknown[]; questions: unknown[]; provenance: ProviderProvenance } |
    { ok: false; code: 'provider_schema' | 'provider_timeout' | 'provider_budget' | 'provider_unavailable' }>;
}

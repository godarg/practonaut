import type { Localized, State } from '../world/types.ts';
import type { ObservationRef } from './types.ts';

/** Author intent only. This record never supplies behavioural evidence. */
export interface RepairIntent {
  schema: 'practonaut.repair-intent/1';
  title: Localized;
  removedStepId: string;
  predecessorId: string;
  successorId: string;
  /** Explicit author review of the prepared valid/near-miss example diagrams. */
  reviewedExamples: boolean;
  /** Finite prepared cases, editable labels; object identities remain internal. */
  cases: Array<{ id: string; labels: [string, string, string]; offset: { x: number; y: number } }>;
}
export interface ObservationSummary {
  ref: ObservationRef;
  title: Localized;
  consequences: Localized[];
  eligibleFor: string[];
  excludedReason?: 'quarantined' | 'unmodeled' | 'unsupported' | 'proposal';
  before: State;
  after: State;
}
export interface CompileReadiness {
  ready: boolean;
  missing: Array<{ code: string; message: Localized; step: 'record' | 'evidence' | 'task' | 'save' }>;
}
export interface SavedAuthorProject {
  id: string;
  title: Localized;
  savedAt: string;
  schema: 'practonaut.author/1';
}
export interface RepairExamples {
  reference: State;
  alternative: State;
  nearMiss: State;
  /** All expectations are independently specified prepared content, not core output. */
  origin: 'prepared-independent-examples';
}

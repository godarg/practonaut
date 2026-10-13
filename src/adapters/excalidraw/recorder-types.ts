import type { Scalar, State } from '../../world/types.ts';
import type { RawElement } from './raw.ts';

/** Coalescing is a versioned observation policy, never an inferred application rule. */
export const COALESCING_VERSION = 'excalidraw-gesture-v1';
export const COALESCING_QUIET_MS = 120;
export type GestureBoundary = 'pointerup' | 'key' | 'quiet' | 'stop';
export interface SemanticElement { id: string; type: string; attributes: Record<string, Scalar> }
export interface SemanticSnapshot { elements: Record<string, SemanticElement> }
export type SemanticEvent =
  | { kind: 'create'; element: SemanticElement }
  | { kind: 'remove'; id: string; before: SemanticElement }
  | { kind: 'set'; id: string; field: string; before: Scalar; after: Scalar };
export interface UnmodeledChange { id: string; attributes: string[]; reason: string }
export interface RecordedGesture {
  index: number; boundary: GestureBoundary; before: SemanticSnapshot; after: SemanticSnapshot;
  events: SemanticEvent[]; unmodeled: UnmodeledChange[]; quarantined: boolean;
  quarantineReasons: string[];
}
export interface RecordingManifest {
  schema: 'practonaut.recording/1'; id: string; createdAt: string; stoppedAt: string;
  appVersion: '0.18.1'; adapterVersion: string; coalescingVersion: typeof COALESCING_VERSION;
  author: string; license: string; consent: string;
  demonstration: 'scripted' | 'human'; status: 'review' | 'quarantined';
}
export interface Recording { manifest: RecordingManifest; initial: SemanticSnapshot; gestures: RecordedGesture[] }
export interface RecordingStart { author: string; license: string; consent: string; demonstration: 'scripted' | 'human' }
export interface RecorderOptions { onError?: (error: Error) => void; onGesture?: (gesture: RecordedGesture) => void; now?: () => number }
export interface GestureRecorder {
  start(elements: RawElement[], fontsReady: boolean): void;
  observe(elements: RawElement[]): void;
  /** Actual native pointer lifecycle; quiet time never closes a held drag. */
  pointerDown(): void;
  /** Exclude an actually observed native multi-selection from single-action evidence. */
  excludeSelection(ids: string[]): void;
  boundary(kind: GestureBoundary): RecordedGesture | null;
  stop(): RecordedGesture[];
  readonly active: boolean;
  readonly initial: SemanticSnapshot;
  readonly gestures: RecordedGesture[];
}
/** Implementations must replay every gesture, including intermediate states, before admission. */
export interface RecordingStore {
  save(recording: Recording): Promise<string>;
  list(): Promise<RecordingManifest[]>;
  /** Isolated per-entry catalogue; strict list/read still refuse corrupt recordings. */
  scan?(): Promise<{ recordings: RecordingManifest[]; unavailable: Array<{ id: string; code: 'recording_store_invalid' | 'recording_store_metadata' }> }>;
  read(id: string): Promise<Recording>;
  delete(id: string): Promise<{ id: string; removed: string[] }>;
}
export type SnapshotProjection = { ok: true; state: State } | { ok: false; reason: string };

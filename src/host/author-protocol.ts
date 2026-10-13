import type { AuthorProject, ConfirmationRequest } from '../authoring/types.ts';
import type { RecordedGesture, Recording, RecordingManifest, RecordingStart, SemanticSnapshot } from '../adapters/excalidraw/recorder-types.ts';
import type { RawElement } from '../adapters/excalidraw/raw.ts';
import type { HostReply, MutationReply, RevisionRequest } from './protocol.ts';
import type { RepairIntent, CompileReadiness, SavedAuthorProject, RepairExamples } from '../authoring/recovery-types.ts';
import type { World } from '../world/types.ts';

export const AUTHOR_ROUTES = {
  observe: '/api/author', start: '/api/record/start', gesture: '/api/record/gesture', stop: '/api/record/stop',
  recording: '/api/recording', delete: '/api/record/delete', analyze: '/api/author/analyze',
  confirm: '/api/author/confirm', project: '/api/author/project', compile: '/api/author/compile',
  editor: '/api/editor', scene: '/api/editor/scene',
  prepare: '/api/author/prepare', configure: '/api/author/configure',
  save: '/api/author/save', projects: '/api/author/projects', open: '/api/author/open', deleteProject:'/api/author/delete-project',
  launch: '/api/author/launch', fromScenes: '/api/author/from-scenes',
} as const;
export interface AuthorView {
  schema: 'practonaut.author-host/1'; revision: number;
  recording: { active: boolean; gestures: number; quarantined: boolean };
  recordings: RecordingManifest[]; project: AuthorProject | null;
  provider: 'none'; providerMeasurement: 'not measured';
  readiness?: CompileReadiness;
  savedProjects?: SavedAuthorProject[];
  /** Preserved committed entries excluded from the selectable catalog; no contents or paths. */
  unavailableProjects?: Array<{ id: string; code: string }>;
  unavailableRecordings?: Array<{ id: string; code: string }>;
  unavailableDerivedOutputs?: Array<{ id: string; code: string }>;
  ignoredProjectEntries?: Array<{ name: '.DS_Store'; code: 'os_metadata' }>;
  examples?: RepairExamples;
  /** Prepared initial author scene, recoverable after a page reload; no checker states. */
  scene?: RawElement[];
}
export interface RecordStartRequest { expectedRevision: number; metadata: RecordingStart; initial: SemanticSnapshot; fontsReady: true }
export interface RecordGestureRequest { expectedRevision: number; gesture: RecordedGesture }
export interface RecordStopRequest { expectedRevision: number }
export interface AuthorConfirmRequest { expectedRevision: number; confirmation: ConfirmationRequest }
export interface AuthorCompileReply { worldId: string; worldSha256: string; checkerSha256: string; report: Record<string, unknown> }
export interface AuthorPrepareRequest { expectedRevision: number; title: string; labels: [string, string, string]; author: string }
export interface AuthorConfigureRequest { expectedRevision: number; intent: RepairIntent }
export interface AuthorOpenRequest { expectedRevision: number; projectId: string }
export interface AuthorLaunchReply { url: string; worldSha256: string }
/** Two editor scenes (raw elements, untrusted) become a world/2 task in a new practice host. */
export interface AuthorFromScenesRequest { expectedRevision: number; start: Array<Record<string, unknown>>; goal: Array<Record<string, unknown>>; layout?: 'relative'; align?: boolean }
export interface AuthorFromScenesReply {
  url: string;
  task: { title: import('../world/types.ts').Localized; prompt: import('../world/types.ts').Localized; conditions: import('../world/types.ts').Localized[] };
  summary: { steps: number; arrows: number; frames: number; clauses: number; errorClasses: number; oracleActions: number; nearMisses: number; unmodeled: number };
}
export interface AuthorPreparedReply { view: AuthorView; scene: RawElement[] }
export interface AuthorController {
  view(): Promise<AuthorView>;
  start(request: RecordStartRequest): Promise<AuthorView>;
  gesture(request: RecordGestureRequest): Promise<AuthorView>;
  stop(request: RecordStopRequest): Promise<{ view: AuthorView; recordingId: string }>;
  read(id: string): Promise<Recording>;
  delete(id: string, revision: number): Promise<AuthorView>;
  analyze(revision: number): Promise<AuthorView>;
  project(project: AuthorProject, revision: number): Promise<AuthorView>;
  confirm(request: AuthorConfirmRequest): Promise<AuthorView>;
  compile(revision: number): Promise<AuthorCompileReply>;
  prepare(request: AuthorPrepareRequest): Promise<AuthorPreparedReply>;
  configure(request: AuthorConfigureRequest): Promise<AuthorView>;
  save(revision: number): Promise<AuthorView>;
  open(request: AuthorOpenRequest): Promise<AuthorPreparedReply>;
  deleteProject(request: AuthorOpenRequest): Promise<AuthorView>;
  /** Re-read the exact managed compilation; never trust a browser path or world. */
  compiledWorld(revision: number, worldSha256: string): Promise<World>;
  close(): Promise<void>;
}
/** Browser scene is untrusted input; host maps a single gesture and applies its own mirror. */
export interface EditorGestureRequest extends RevisionRequest { before: RawElement[]; after: RawElement[]; boundary: string }
export interface EditorController {
  gesture(request: EditorGestureRequest): Promise<HostReply<MutationReply>>;
  scene(): RawElement[];
}

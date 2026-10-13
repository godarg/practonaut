import { canonicalJson } from '../canonical/index.ts';
import { EXCLUSIVE_CREATE, READ_NOFOLLOW, isPrivateFile, syncDirectory } from '../platform/private-fs.ts';
import { dataPaths } from '../platform/paths.ts';
import { randomBytes, createHash } from 'node:crypto';
import { open, lstat, unlink, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createProjectStore } from './project-store.ts';
import { prepareRepairProject, configureRepairProject, repairExamples, compileReadiness, revalidateAuthorProject } from '../authoring/recovery.ts';
import { toRaw } from '../adapters/excalidraw/raw.ts';
import { readWorldPackage } from '../package/reader.ts';
import { loadWorldPackage } from '../world/index.ts';
import { resolve, join } from 'node:path';
import { createTokenFile } from './token-file.ts';
import { HOST_LIMITS } from './limits.ts';
import { createRecordingStore } from '../recordings/store.ts';
import { deleteDerivedRecordings } from '../recordings/derived.ts';
import { validateRecording, replayGesture } from '../adapters/excalidraw/recorder.ts';
import { COALESCING_VERSION } from '../adapters/excalidraw/recorder-types.ts';
import type { Recording, RecordedGesture, RecordingStart, SemanticSnapshot } from '../adapters/excalidraw/recorder-types.ts';
import { analyzeRecordings, createAuthorProject, confirmHypothesis, compileProject, validateAuthorProject } from '../authoring/index.ts';
import type { AuthorProject } from '../authoring/types.ts';
import type { AuthorController, AuthorView } from './author-protocol.ts';

export class AuthorHostError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
const MAX_AUTHOR_BYTES = 3 * 1024 * 1024;
const MAX_GESTURES = 1_000;
const MAX_DURATION_MS = 30 * 60_000;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function bounded(value: unknown, limit = MAX_AUTHOR_BYTES): void {
  if (Buffer.byteLength(JSON.stringify(value)) > limit) throw new AuthorHostError('recording_limit', 'Author data exceeds the local budget');
}
async function privateWrite(directory: string, name: string, bytes: Uint8Array): Promise<string> {
  const probe = await createTokenFile(directory, 'directory-validation'); await probe.remove();
  const path = join(directory, name);
  const handle = await open(path, EXCLUSIVE_CREATE, 0o600);
  const owned = await handle.stat();
  try {
    if (!isPrivateFile(owned)) throw new AuthorHostError('recording_unsafe', 'Author output path is unsafe');
    await handle.writeFile(bytes); await handle.sync();
  } catch (error) {
    const current = await lstat(path);
    if (current.ino === owned.ino && current.dev === owned.dev && !current.isSymbolicLink()) await unlink(path);
    throw error;
  } finally { await handle.close(); }
  return path;
}
async function withOutputBudget<T>(directory: string, additionalBytes: number, write: () => Promise<T>): Promise<T> {
  const probe = await createTokenFile(directory, 'directory-validation'); await probe.remove();
  const lockPath = join(directory, '.compile.lock');
  const lock = await open(lockPath, EXCLUSIVE_CREATE, 0o600).catch(() => { throw new AuthorHostError('session_busy', 'Another compilation owns the local output directory'); });
  const owned = await lock.stat();
  try {
    const names = (await readdir(directory)).filter(name => name !== '.compile.lock');
    if (names.length + 3 > 96) throw new AuthorHostError('recording_limit', 'Managed compilation output count exceeds the persistent budget');
    let bytes = additionalBytes;
    for (const name of names) {
      const st = await lstat(join(directory, name));
      if (!/^[a-z0-9-]+\.(?:pnworld|pncheck|author\.json)$/.test(name) || st.isSymbolicLink() || !isPrivateFile(st)) throw new AuthorHostError('recording_unsafe', 'Managed compilation output changed ownership, type or permissions');
      bytes += st.size;
    }
    if (bytes > 64 * 1024 * 1024) throw new AuthorHostError('recording_limit', 'Managed compilation output exceeds the persistent byte budget');
    return await write();
  } finally {
    await lock.close(); const current = await lstat(lockPath);
    if (current.dev !== owned.dev || current.ino !== owned.ino) throw new AuthorHostError('recording_unsafe', 'Compilation lock changed during use');
    await unlink(lockPath);
  }
}
/** No recording leaves this controller; the only synthesis provider is deterministic templates. */
export async function createAuthorController(directory = dataPaths().home): Promise<AuthorController> {
  const store = createRecordingStore(join(directory, 'recordings'));
  const outputDirectory = join(directory, 'author');
  const projects = createProjectStore(join(directory, 'projects'));
  let compiled: { path: string; hash: string; projectHash: string } | null = null;
  let revision = 0, closed = false, project: AuthorProject | null = null;
  let active: { metadata: RecordingStart; initial: SemanticSnapshot; gestures: RecordedGesture[]; started: number; createdAt: string; id: string } | null = null;
  const outputs = new Set<string>();
  let unavailableDerivedOutputs:Array<{id:string;code:string}>=[];
  const guard = (base: number): void => {
    if (closed) throw new AuthorHostError('session_closed', 'Author session is closed');
    if (base !== revision) throw new AuthorHostError('stale_base', 'Author data changed since this request');
  };
  const recordings = async (target = project): Promise<Recording[]> => {
    const ids = target ? target.recordingIds : (store.scan ? (await store.scan()).recordings : await store.list()).map(m => m.id);
    return Promise.all(ids.map(async id => { try { return await store.read(id); } catch { throw new AuthorHostError('project_source_missing', 'A source recording is missing, changed or unsafe; review the project evidence'); } }));
  };
  const view = async (candidateProject = project, changes: Partial<AuthorView> = {}): Promise<AuthorView> => {
    const scanned=store.scan ? await store.scan() : {recordings:await store.list(),unavailable:[]};
    const available = changes.recordings ?? scanned.recordings;
    const readiness = compileReadiness(candidateProject);
    if (candidateProject?.recordingIds.some(id => !available.some(m => m.id === id))) { readiness.ready = false; readiness.missing.push({ code: 'project_source_missing', step: 'evidence', message: { en: 'A source recording was removed. The affected rules cannot be used; create new observations.', de: 'Eine Quellaufnahme wurde entfernt. Betroffene Regeln sind nicht nutzbar; erstelle neue Beobachtungen.' } }); }
    const catalog = await projects.catalog();
    const examples = candidateProject?.repair ? repairExamples(candidateProject) : undefined;
    const value: AuthorView = { schema: 'practonaut.author-host/1', revision,
      recording: { active: active !== null, gestures: active?.gestures.length ?? 0, quarantined: active?.gestures.some(g => g.quarantined) ?? false },
      recordings: available.filter(m => !candidateProject?.repair || candidateProject.recordingIds.includes(m.id)), project: candidateProject ? structuredClone(candidateProject) : null,
      readiness, savedProjects: catalog.projects, unavailableProjects: catalog.unavailable, ignoredProjectEntries: catalog.ignoredEntries, unavailableRecordings:scanned.unavailable,unavailableDerivedOutputs,
      ...(examples ? { examples } : {}),
      ...(candidateProject?.repair ? { scene: toRaw(candidateProject.initialState) } : {}),
      provider: 'none', providerMeasurement: 'not measured', ...changes };
    bounded({ ok: true, value }, HOST_LIMITS.replyBytes - 2048); return value;
  };
  const activeRecording = (candidate: NonNullable<typeof active>): Recording => ({
    manifest: { schema: 'practonaut.recording/1', id: candidate.id, createdAt: candidate.createdAt,
      stoppedAt: new Date(Math.min(Date.now(), Date.parse(candidate.createdAt) + MAX_DURATION_MS)).toISOString(),
      appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: COALESCING_VERSION,
      ...candidate.metadata, status: candidate.gestures.some(g => g.quarantined) ? 'quarantined' : 'review' },
    initial: candidate.initial, gestures: candidate.gestures,
  });
  const stoppedView = async (recording: Recording, candidateProject = project): Promise<AuthorView> => {
    const current = await view(candidateProject);
    return view(candidateProject, { revision: revision + 1, recording: { active: false, gestures: 0, quarantined: false },
      recordings: [...current.recordings, recording.manifest].sort((a, b) => a.id.localeCompare(b.id)) });
  };
  return {
    view,
    async start(request) {
      guard(request.expectedRevision);
      if (active) throw new AuthorHostError('recording_active', 'Stop the current recording first');
      if (request.fontsReady !== true) throw new AuthorHostError('fonts_not_ready', 'Fonts must be ready before recording');
      for (const key of ['author', 'license', 'consent'] as const) if (typeof request.metadata[key] !== 'string' || !request.metadata[key].trim() || request.metadata[key].length > 4096) throw new AuthorHostError('recording_metadata', 'Author, license and consent are required');
      if (!['scripted', 'human'].includes(request.metadata.demonstration)) throw new AuthorHostError('recording_metadata', 'Demonstration source is required');
      const candidate = { metadata: structuredClone(request.metadata), initial: structuredClone(request.initial), gestures: [] as RecordedGesture[], started: Date.now(), createdAt: new Date().toISOString(), id: 'r-' + randomBytes(16).toString('hex') };
      validateRecording({ manifest: { schema: 'practonaut.recording/1', id: candidate.id, createdAt: candidate.createdAt, stoppedAt: candidate.createdAt, appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: COALESCING_VERSION, ...candidate.metadata, status: 'review' }, initial: candidate.initial, gestures: [] });
      bounded(candidate);
      await stoppedView(activeRecording(candidate));
      const admitted = await view(project, { revision: revision + 1, recording: { active: true, gestures: 0, quarantined: false } });
      active = candidate; revision++; return admitted;
    },
    async gesture(request) {
      guard(request.expectedRevision);
      if (!active) throw new AuthorHostError('recording_inactive', 'Recording has not been started');
      if (active.gestures.length >= MAX_GESTURES || Date.now() - active.started >= MAX_DURATION_MS) {
        const stoppedAt = new Date(Math.min(Date.now(), Date.parse(active.createdAt) + MAX_DURATION_MS)).toISOString();
        const recording: Recording = { manifest: { schema: 'practonaut.recording/1', id: active.id, createdAt: active.createdAt, stoppedAt, appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: COALESCING_VERSION, ...active.metadata, status: active.gestures.some(g => g.quarantined) ? 'quarantined' : 'review' }, initial: active.initial, gestures: active.gestures };
        const candidateProject = project ? { ...project, recordingIds: [...project.recordingIds, recording.manifest.id] } : null;
        await stoppedView(recording, candidateProject); await store.save(recording);
        active = null; project = candidateProject; compiled = null; revision++; throw new AuthorHostError('recording_limit', 'Recording stopped at its observation or time limit; the accepted observations were saved for review');
      }
      const gesture = request.gesture;
      if (gesture.index !== active.gestures.length) throw new AuthorHostError('recording_replay', 'Gesture sequence is incomplete');
      // validateRecording also uses sorted semantic equality; source key order is not evidence.
      const candidate: Recording = { manifest: { schema: 'practonaut.recording/1', id: active.id, createdAt: active.createdAt, stoppedAt: new Date().toISOString(), appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: COALESCING_VERSION, ...active.metadata, status: [...active.gestures, gesture].some(g => g.quarantined) ? 'quarantined' : 'review' }, initial: active.initial, gestures: [...active.gestures, gesture] };
      replayGesture(gesture); validateRecording(candidate); bounded(candidate);
      await stoppedView(candidate);
      const admitted = await view(project, { revision: revision + 1, recording: { active: true, gestures: candidate.gestures.length, quarantined: candidate.gestures.some(g => g.quarantined) } });
      active.gestures.push(structuredClone(gesture)); revision++; return admitted;
    },
    async stop(request) {
      guard(request.expectedRevision);
      if (!active) throw new AuthorHostError('recording_inactive', 'Recording has not been started');
      const recording: Recording = { manifest: { schema: 'practonaut.recording/1', id: active.id, createdAt: active.createdAt, stoppedAt: new Date(Math.min(Date.now(), Date.parse(active.createdAt) + MAX_DURATION_MS)).toISOString(), appVersion: '0.18.1', adapterVersion: '1.0.0', coalescingVersion: COALESCING_VERSION, ...active.metadata, status: active.gestures.some(g => g.quarantined) ? 'quarantined' : 'review' }, initial: active.initial, gestures: active.gestures };
      bounded(recording);
      const candidateProject = project ? { ...project, recordingIds: [...project.recordingIds, recording.manifest.id] } : project;
      const reply = { view: await stoppedView(recording, candidateProject), recordingId: recording.manifest.id };
      // Review fetches the recording separately: every admitted 3-MiB prefix stays stoppable.
      bounded(reply, HOST_LIMITS.replyBytes - 2048); await store.save(recording); active = null; project = candidateProject; compiled = null; revision++;
      return reply;
    },
    read: id => store.read(id),
    async delete(id, base) {
      return projects.withRecordingReferences(id,async references=>{
      guard(base); if (active) throw new AuthorHostError('recording_active', 'Stop recording before deleting');

      // Corrupt saved payloads cannot prove absence of a reference. Their original bytes stay
      // available until the user explicitly removes those projects through their own ID.
      const blockers=[...new Set([...references.projectIds,...references.unavailableProjects.map(entry=>entry.id)])].sort();
      if(blockers.length)throw new AuthorHostError('recording_in_use','Delete these saved or unreadable projects first: '+blockers.join(', '));
      const current = await view();
      const related = project?.recordingIds.includes(id) ?? false;
      // Delete only capabilities actually derived from this source. Unrelated projects survive.
      const candidate = related && project ? { ...project, hypotheses: project.hypotheses.map(h => h.status === 'confirmed' && [...h.proposedFrom, ...h.confirmingEvidence].some(ref => ref.recordingId === id) ? { ...h, status: 'proposed' as const } : h) } : project;
      const admitted = await view(candidate, { revision: revision + 1, recordings: current.recordings.filter(m => m.id !== id) });
      const derived=await deleteDerivedRecordings(outputDirectory, id); await store.delete(id);
      unavailableDerivedOutputs=derived.unavailable;admitted.unavailableDerivedOutputs=unavailableDerivedOutputs;
      if (related) { compiled = null; project = candidate; }
      revision++; return admitted;
      });
    },
    async analyze(base) {
      guard(base); if (active) throw new AuthorHostError('recording_active', 'Stop recording before analysis');
      const observed = await recordings();
      const analysis = analyzeRecordings(observed, project ?? undefined);
      const candidate = { ...(project ?? createAuthorProject(observed)), ...analysis, recordingIds: observed.map(r => r.manifest.id) };
      bounded(candidate); const checked = validateAuthorProject(candidate);
      const admitted = await view(checked, { revision: revision + 1 }); project = checked; compiled = null; revision++; return admitted;
    },
    async project(raw, base) {
      guard(base); bounded(raw); const candidate = validateAuthorProject(raw);
      // A project edit supplies tasks, variants and text, never a confirmation capability.
      if (JSON.stringify(candidate.hypotheses) !== JSON.stringify(project?.hypotheses ?? []) || JSON.stringify(candidate.questions) !== JSON.stringify(project?.questions ?? [])) throw new AuthorHostError('evidence_required', 'Rule and question status can only change through observations');
      if (project?.recordingIds.some(id => !candidate.recordingIds.includes(id))) throw new AuthorHostError('evidence_required', 'Project edits cannot remove source recordings; prepare a separate project for new supported demonstrations');
      if (active) await stoppedView(activeRecording(active), candidate);
      const admitted = await view(candidate, { revision: revision + 1 }); project = candidate; compiled = null; revision++; return admitted;
    },
    async confirm(request) {
      guard(request.expectedRevision); if (!project) throw new AuthorHostError('author_project_missing', 'Analyze observations first');
      const candidate = confirmHypothesis(project, request.confirmation, await recordings()); bounded(candidate);
      if (active) await stoppedView(activeRecording(active), candidate);
      const admitted = await view(candidate, { revision: revision + 1 }); project = candidate; compiled = null; revision++; return admitted;
    },
    async compile(base) {
      guard(base); if (!project) throw new AuthorHostError('author_project_missing', 'Analyze observations first');
      if (active) throw new AuthorHostError('recording_active', 'Stop recording before compilation');
      if (outputs.size >= 96) throw new AuthorHostError('recording_limit', 'Compiled output count exceeds this session budget');
      compiled = null;
      const source = await recordings(project);
      const validatedProject = revalidateAuthorProject(project, source);
      const result = compileProject({ project: validatedProject, recordings: source });
      const projectId = project.id;
      const worldSha256 = sha(result.worldBytes), checkerSha256 = sha(result.checkerBytes);
      const nonce = randomBytes(8).toString('hex');
      const projectBytes = Buffer.from(JSON.stringify(validatedProject, null, 2) + '\n');
      const reply = { worldId: project.id, worldSha256, checkerSha256, report: { ...result.report, localWorldFile: `${project.id}-${nonce}.pnworld`, localCheckerFile: `${project.id}-${nonce}.pncheck`, localProjectFile: `${project.id}-${nonce}.author.json` } };
      bounded({ ok: true, value: reply }, HOST_LIMITS.replyBytes - 2048);
      await withOutputBudget(outputDirectory, result.worldBytes.length + result.checkerBytes.length + projectBytes.length, async () => {
        const written: string[] = [];
        try {
          written.push(await privateWrite(outputDirectory, `${projectId}-${nonce}.pnworld`, result.worldBytes));
          written.push(await privateWrite(outputDirectory, `${projectId}-${nonce}.pncheck`, result.checkerBytes));
          written.push(await privateWrite(outputDirectory, `${projectId}-${nonce}.author.json`, projectBytes));
          await syncDirectory(outputDirectory);
          for (const path of written) outputs.add(path);
        } catch (error) { for (const path of written) await unlink(path); throw error; }
      });
      project = validatedProject;
      compiled = { path: join(outputDirectory, `${project.id}-${nonce}.pnworld`), hash: worldSha256, projectHash: sha(Buffer.from(canonicalJson(validatedProject))) };
      return reply;
    },
    async prepare(request) {
      guard(request.expectedRevision); if (active) throw new AuthorHostError('recording_active', 'Stop recording before preparing another project');
      const candidate = prepareRepairProject({ id: 'repair-' + randomBytes(16).toString('hex'), title: request.title, labels: request.labels, author: request.author });
      const reply = { view: await view(candidate, { revision: revision + 1 }), scene: toRaw(candidate.initialState) };
      bounded({ ok: true, value: reply }, HOST_LIMITS.replyBytes - 2048); project = candidate; compiled = null; revision++; return reply;
    },
    async configure(request) {
      return projects.withLock(async transaction=>{
      guard(request.expectedRevision); if (active) throw new AuthorHostError('recording_active', 'Stop recording before configuring the task');
      if (!project) throw new AuthorHostError('author_project_missing', 'Prepare a project first');
      const candidate = configureRepairProject(project, request.intent);
      const admitted = await view(candidate, { revision: revision + 1 }); project = candidate; compiled = null; revision++; return admitted;
      });
    },
    async save(base) {
      return projects.withLock(async transaction=>{
      guard(base); if (active) throw new AuthorHostError('recording_active', 'Stop recording before saving');
      if (!project) throw new AuthorHostError('author_project_missing', 'Prepare a project first');
      compiled = null;
      const candidate = revalidateAuthorProject(project, await recordings(project));
      const before = await view(candidate), metadata = { id: candidate.id, schema: candidate.schema, savedAt: new Date().toISOString(), title: candidate.repair?.title ?? { en: candidate.id, de: candidate.id } };
      const savedProjects = [...(before.savedProjects ?? []).filter(p => p.id !== candidate.id), metadata];
      const admitted = await view(candidate, { revision: revision + 1, savedProjects });
      const saved = await transaction.save(candidate);
      admitted.savedProjects = [...savedProjects.filter(p => p.id !== candidate.id), saved];
      project = candidate; revision++; return admitted;
      });
    },
    async deleteProject(request) {
      return projects.withLock(async transaction=>{
      guard(request.expectedRevision);if(active)throw new AuthorHostError('recording_active','Stop recording before deleting a project');
      const current=await view(),candidate=project?.id===request.projectId?null:project;
      const admitted=await view(candidate,{revision:revision+1,savedProjects:(current.savedProjects??[]).filter(entry=>entry.id!==request.projectId),unavailableProjects:(current.unavailableProjects??[]).filter(entry=>entry.id!==request.projectId)});
      await transaction.delete(request.projectId);
      if(candidate!==project)compiled=null;
      project=candidate;revision++;return admitted;
      });
    },
    async open(request) {
      return projects.withLock(async transaction=>{
      guard(request.expectedRevision); if (active) throw new AuthorHostError('recording_active', 'Stop recording before opening another project');
      const saved = await transaction.read(request.projectId);
      const candidate = revalidateAuthorProject(saved, await recordings(saved));
      const reply = { view: await view(candidate, { revision: revision + 1 }), scene: toRaw(candidate.initialState) };
      bounded({ ok: true, value: reply }, HOST_LIMITS.replyBytes - 2048); project = candidate; compiled = null; revision++; return reply;
      });
    },
    async compiledWorld(base, expectedHash) {
      guard(base); if (active) throw new AuthorHostError('recording_active', 'Stop recording before practice');
      if (!compiled || compiled.hash !== expectedHash) throw new AuthorHostError('compilation_missing', 'Compile the current project before opening practice');
      if (!project) throw new AuthorHostError('author_project_missing', 'Project is missing');
      const capability = compiled;
      let validatedProject: AuthorProject, fresh: ReturnType<typeof compileProject>;
      try {
        const source = await recordings(project);
        validatedProject = revalidateAuthorProject(project, source);
        if (sha(Buffer.from(canonicalJson(validatedProject))) !== capability.projectHash) throw new AuthorHostError('compilation_changed', 'The current project changed during source revalidation; compile it again');
        // Every launch crosses the full deterministic admission/checker path again.
        fresh = compileProject({ project: validatedProject, recordings: source });
        if (sha(fresh.worldBytes) !== capability.hash) throw new AuthorHostError('compilation_changed', 'The current project no longer produces the compiled exercise');
      } catch (error) { compiled = null; throw error; }
      const handle = await open(compiled.path, READ_NOFOLLOW).catch(() => { throw new AuthorHostError('compilation_changed', 'Compiled exercise is missing or unsafe'); });
      let bytes: Buffer;
      try {
        const st = await handle.stat(), actual = await lstat(compiled.path);
        if (!isPrivateFile(st) || st.size > 32 * 1024 * 1024 || actual.isSymbolicLink() || actual.ino !== st.ino || actual.dev !== st.dev) throw new AuthorHostError('compilation_changed', 'Compiled exercise is unsafe');
        bytes = await handle.readFile();
      } finally { await handle.close(); }
      if (sha(bytes) !== expectedHash) throw new AuthorHostError('compilation_changed', 'Compiled exercise changed after validation');
      const world = loadWorldPackage(await readWorldPackage(bytes));
      if (world.id !== fresh.world.id || canonicalJson(world.rules) !== canonicalJson(fresh.world.rules)) { compiled = null; throw new AuthorHostError('compilation_changed', 'Compiled exercise rule authority changed'); }
      return world;
    },
    async close() { closed = true; active = null; },
  };
}

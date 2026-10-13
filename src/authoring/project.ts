import { z } from 'zod';
import { projectSnapshot, validateRecording } from '../adapters/excalidraw/recorder.ts';
import type { Recording } from '../adapters/excalidraw/recorder-types.ts';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { preflightJson } from '../world/preflight.ts';
import { StateSchema, TaskSchema, validateState, validatePredicate } from '../world/schema.ts';
import { ACTION_NAMES } from '../world/types.ts';
import type { State } from '../world/types.ts';
import { RULE_TEMPLATES, hasIncidentArrow, observationAction } from './templates.ts';
import type { AuthorAnalysis, AuthorProject, ConfirmationRequest, ObservationRef, ModelQuestion } from './types.ts';

export class AuthoringError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(`${code}: ${message}`); this.code = code; this.name = 'AuthoringError'; }
}
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/), text = z.string().max(8192);
const objectId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const localized = z.strictObject({ en: text, de: text });
const ref = z.strictObject({ recordingId: id, gestureIndex: z.number().int().min(0).max(4095), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const refs = z.array(ref).max(128);
const hypothesis = z.strictObject({ id, template: id, action: z.enum(ACTION_NAMES), status: z.enum(['proposed','refuted','confirmed']), explanation: localized, proposedFrom: refs, confirmingEvidence: refs, refutingEvidence: refs });
const question = z.strictObject({ id, hypothesisIds: z.array(id).max(16), text: localized, demonstration: localized, status: z.enum(['open','answered']), answeredBy: refs });
const scalar = z.union([text,z.number().int(),z.boolean(),z.null()]);
const action = z.strictObject({ name: z.enum(ACTION_NAMES), params: z.record(id, scalar), baseStep: z.number().int().min(0).optional() });
const repair = z.strictObject({ schema:z.literal('practonaut.repair-intent/1'), title:localized,
  removedStepId:objectId, predecessorId:objectId, successorId:objectId, reviewedExamples:z.boolean(),
  cases:z.array(z.strictObject({id,labels:z.tuple([text,text,text]),offset:z.strictObject({x:z.number().int().min(-10000).max(10000),y:z.number().int().min(-10000).max(10000)})})).min(1).max(16) });
const projectSchema = z.strictObject({ schema: z.literal('practonaut.author/1'), id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), version: z.string().regex(/^\d+\.\d+\.\d+$/), authors: z.array(z.string().min(1).max(256)).min(1).max(128),
  recordingIds: z.array(id).max(128), hypotheses: z.array(hypothesis).max(16), questions: z.array(question).max(32), initialState: StateSchema,
  tasks: z.array(z.strictObject({ task: TaskSchema, solutions: z.record(id,z.array(action).max(4096)) })).max(128), heldOutTasks: z.array(TaskSchema).max(128),
  variants: z.array(z.strictObject({ id, labels: z.record(objectId,text), insertPosition: z.number().int().min(0).max(9999), layoutOffset: z.strictObject({ x: z.number().int(), y: z.number().int() }) })).max(256),
  license: z.literal('CC0-1.0'), notes: text,
  checkerFixtures: z.array(z.strictObject({taskId:id,kind:z.enum(['reference','alternative','near-miss']),state:StateSchema,expected:z.boolean()})).max(1000).optional(),
  heldOutSolutions: z.record(id,z.record(id,z.array(action).max(4096))).optional(), repair:repair.optional() });
export function validateAuthorProject(raw: unknown): AuthorProject {
  preflightJson(raw);
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) throw new AuthoringError('author_project_invalid', parsed.error.issues.slice(0,4).map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  const project = parsed.data as AuthorProject;
  const unique = (values: string[], name: string): void => { if (new Set(values).size !== values.length) throw new AuthoringError('author_project_invalid', `duplicate ${name}`); };
  unique(project.recordingIds,'recording'); unique(project.hypotheses.map(h=>h.id),'hypothesis'); unique(project.questions.map(q=>q.id),'question');
  unique([...project.tasks.map(t=>t.task.id),...project.heldOutTasks.map(t=>t.id)],'task'); unique(project.variants.map(v=>v.id),'variant');
  validateState(project.initialState);
  if(project.repair) {
    const intent=project.repair;
    unique([intent.removedStepId,intent.predecessorId,intent.successorId],'repair step');
    unique(intent.cases.map(c=>c.id),'repair case');
    for(const stepId of [intent.removedStepId,intent.predecessorId,intent.successorId]) {
      const object=project.initialState.objects[stepId];
      if(!object || object.type!=='step' || object.deleted)throw new AuthoringError('author_project_invalid','repair requires three distinct live steps');
    }
  }
  for (const t of [...project.tasks.map(t=>t.task), ...project.heldOutTasks]) { validatePredicate(t.goal); for (const e of t.errorClasses) validatePredicate(e.when); if(t.initialState)validateState(t.initialState); }
  for (const h of project.hypotheses) {
    const template = RULE_TEMPLATES.find(t=>t.id === h.template);
    if (!template || h.id !== template.id || h.action !== template.action) throw new AuthoringError('author_project_invalid','unknown or changed rule template');
    if (h.status === 'confirmed' && (!h.confirmingEvidence.length || h.refutingEvidence.length)) throw new AuthoringError('confirmation_without_evidence','confirmed hypothesis has no evidence or has a counterexample');
  }
  return project;
}
export function observationRef(recording: Recording, gestureIndex: number): ObservationRef {
  const gesture = recording.gestures.find(g=>g.index===gestureIndex);
  if (!gesture) throw new AuthoringError('evidence_missing','gesture not found');
  return { recordingId: recording.manifest.id, gestureIndex, sha256: sha256Hex(canonicalJson(gesture)) };
}
function observations(recordings: Recording[]): Array<{ ref: ObservationRef; before: State; after: State }> {
  const result: Array<{ ref: ObservationRef; before: State; after: State }> = [];
  const ids = new Set<string>();
  for (const raw of recordings) {
    const recording = validateRecording(raw);
    if(ids.has(recording.manifest.id))throw new AuthoringError('recording_invalid','duplicate recording id');
    ids.add(recording.manifest.id);
    if (recording.manifest.status === 'quarantined') continue;
    for (const g of recording.gestures) {
      if(g.quarantined || g.unmodeled.length)continue;
      const before = projectSnapshot(g.before), after = projectSnapshot(g.after);
      if(before.ok && after.ok) result.push({ ref: observationRef(recording,g.index), before: before.state, after: after.state });
    }
  }
  return result;
}
const sameRef = (a: ObservationRef,b: ObservationRef): boolean => a.recordingId===b.recordingId && a.gestureIndex===b.gestureIndex && a.sha256===b.sha256;
const append = (refs: ObservationRef[],value: ObservationRef): void => { if(!refs.some(r=>sameRef(r,value)))refs.push(value); };
/** Excluded changes cannot be silently removed from a project's rule admission. */
export function hasExcludedSource(recordings: Recording[]): boolean {
  return recordings.some(raw => {
    const recording = validateRecording(raw);
    return recording.manifest.status === 'quarantined' || recording.gestures.some(g => g.quarantined || g.unmodeled.length > 0);
  });
}
export function assertModeledSources(recordings: Recording[]): void {
  if (hasExcludedSource(recordings)) throw new AuthoringError('evidence_unmodeled', 'Excluded source changes prevent rule admission; preserve the recording and start a separate project with supported demonstrations');
}
export function analyzeRecordings(recordings: Recording[], existing?: AuthorAnalysis): AuthorAnalysis {
  const observed = observations(recordings);
  const hypotheses = structuredClone(existing?.hypotheses ?? []);
  const blocked = hasExcludedSource(recordings);
  if (blocked) for (const h of hypotheses) if (h.status === 'confirmed') h.status = 'proposed';
  for(const o of observed) {
    const family=observationAction(o.before,o.after); if(!family)continue;
    for(const t of RULE_TEMPLATES.filter(t=>t.action===family)) {
      let h=hypotheses.find(h=>h.id===t.id);
      if(!h) { h={ id:t.id,template:t.id,action:t.action,status:'proposed',explanation:t.explanation,proposedFrom:[],confirmingEvidence:[],refutingEvidence:[] }; hypotheses.push(h); }
      // The proposal source is frozen. Later matching observations remain available as
      // confirmation evidence, even if the UI reanalyses after each stopped recording.
      if(t.matches(o.before,o.after)) {if(!h.proposedFrom.length)append(h.proposedFrom,o.ref);}
      else { append(h.refutingEvidence,o.ref); h.status='refuted'; }
    }
  }
  hypotheses.sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const questions:ModelQuestion[] = hypotheses.filter(h=>h.status==='proposed').map(h=>({ id:`q-${h.id}`, hypothesisIds: [h.id],
    text:{ en:`Does this observation generalize? ${h.explanation.en}`,de:`Gilt diese Beobachtung auch im nächsten Fall? ${h.explanation.de}` },
    demonstration: h.action==='delete_step' && !h.proposedFrom.some(ref=>observed.some(o=>sameRef(o.ref,ref)&&hasIncidentArrow(o.before,o.after))) ?
      {en:'The removed step had no attached arrow, so this recording cannot distinguish what happens to arrows. Record a new case with an attached arrow.',de:'Der entfernte Schritt hatte keinen verbundenen Pfeil. Diese Aufnahme unterscheidet das Pfeilverhalten nicht. Nimm einen neuen Fall mit verbundenem Pfeil auf.'} :
      {en:`This behaviour was observed once: ${h.explanation.en} Record a separate demonstration to check it again before this rule can be used in an exercise.`,de:`Dieses Verhalten wurde einmal beobachtet: ${h.explanation.de} Prüfe es mit einer weiteren Vorführung, bevor die Regel in einer Übung verwendet werden kann.`},
    status:'open' as const,answeredBy:[] as ObservationRef[] }));
  for(const q of existing?.questions ?? [])if(q.status==='answered' && !questions.some(fresh=>fresh.id===q.id))questions.push(structuredClone(q));
  return { hypotheses,questions };
}
export function createAuthorProject(recordings: Recording[] = []): AuthorProject {
  const analysis=analyzeRecordings(recordings);
  const first=recordings[0]; const projected=first ? projectSnapshot(first.initial) : undefined;
  if(projected && !projected.ok)throw new AuthoringError('author_project_invalid',projected.reason);
  return { schema:'practonaut.author/1',id:'authored-flow',version:'0.0.0',authors:[...new Set(recordings.map(r=>r.manifest.author))].length ? [...new Set(recordings.map(r=>r.manifest.author))] : ['Local author'],recordingIds:recordings.map(r=>r.manifest.id),...analysis,
    initialState:projected?.ok ? projected.state : {objects:{frame:{id:'frame',type:'frame',deleted:false,name:'Process'}}}, tasks:[],heldOutTasks:[],variants:[{id:'default',labels:{},insertPosition:0,layoutOffset:{x:0,y:0}}],license:'CC0-1.0',notes:'' };
}
export function confirmHypothesis(raw: AuthorProject, request: ConfirmationRequest, recordings: Recording[]): AuthorProject {
  const project=validateAuthorProject(raw), sources=recordings.map(validateRecording);
  const sourceIds=new Set(sources.map(source=>source.manifest.id));
  if(sourceIds.size!==sources.length)throw new AuthoringError('recording_invalid','duplicate recording id');
  if(project.recordingIds.some(id=>!sourceIds.has(id)))throw new AuthoringError('evidence_missing','Every existing project source must be supplied before confirming a rule');
  assertModeledSources(sources);
  const observed=observations(sources);
  const h=project.hypotheses.find(h=>h.id===request.hypothesisId), t=RULE_TEMPLATES.find(t=>t.id===h?.template);
  if(!h || !t)throw new AuthoringError('hypothesis_missing','unknown hypothesis');
  if(h.status==='refuted' || h.refutingEvidence.length)throw new AuthoringError('hypothesis_refuted','a counterexample is retained');
  const o=observed.find(o=>sameRef(o.ref,request.evidence));
  if(!o)throw new AuthoringError('evidence_missing','missing, changed, quarantined or unmodeled evidence');
  if(h.proposedFrom.some(r=>r.recordingId===o.ref.recordingId))throw new AuthoringError('confirmation_requires_new_observation','confirmation requires a separate recording from every proposal source');
  if(!h.proposedFrom.length || h.proposedFrom.some(ref=>!observed.some(prior=>sameRef(prior.ref,ref) && t.matches(prior.before,prior.after))))throw new AuthoringError('evidence_missing','proposal source is missing or changed');
  if(!t.matches(o.before,o.after))throw new AuthoringError('evidence_disagrees','full successor does not match template');
  if(observed.some(other=>observationAction(other.before,other.after)===h.action && !t.matches(other.before,other.after)))throw new AuthoringError('hypothesis_refuted','source contains a counterexample');
  if(h.action==='delete_step' && !hasIncidentArrow(o.before,o.after))throw new AuthoringError('evidence_ambiguous','demonstrate deletion with an incident arrow');
  // New evidence may refute another alternative, including a previously confirmed one.
  for(const candidate of project.hypotheses.filter(c=>c.action===h.action)) {
    const template=RULE_TEMPLATES.find(t=>t.id===candidate.template)!;
    if(!template.matches(o.before,o.after)) {append(candidate.refutingEvidence,o.ref);candidate.status='refuted';}
  }
  h.status='confirmed'; append(h.confirmingEvidence,o.ref);
  for(const source of sources)if(!project.recordingIds.includes(source.manifest.id))project.recordingIds.push(source.manifest.id);
  for(const q of project.questions.filter(q=>q.hypothesisIds.includes(h.id))) {q.status='answered';append(q.answeredBy,o.ref);}
  return project;
}
export function verifiedObservations(recordings: Recording[]): ReturnType<typeof observations> { return observations(recordings); }

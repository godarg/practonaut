import { validateRecording } from '../adapters/excalidraw/recorder.ts';
import { COALESCING_VERSION } from '../adapters/excalidraw/recorder-types.ts';
import { canonicalJson, sha256Hex } from '../canonical/index.ts';
import { Session } from '../core/session.ts';
import { ACTION_PARAMETERS } from '../core/apply.ts';
import { evaluate } from '../predicate/index.ts';
import { checkState, validateCheckerData } from '../checker/index.ts';
import { WorldManifestSchema, CheckerBundleManifestSchema, CURRENT_SCHEMA_VERSION, WORLD_PACKAGE_FORMAT, CHECKER_BUNDLE_FORMAT } from '../package/manifest.ts';
import { writeStoredZip } from '../package/zip-writer.ts';
import { LIMITS } from '../package/limits.ts';
import { validateWorld } from '../world/schema.ts';
import type { Action, ActionNameV1, CheckerData, StepV1, World } from '../world/types.ts';
import { AuthoringError, validateAuthorProject, verifiedObservations, assertModeledSources } from './project.ts';
import { RULE_TEMPLATES, observationAction, hasIncidentArrow } from './templates.ts';
import type { CompileInput, CompileResult, ObservationRef } from './types.ts';

/** Uses the existing archive writer and strict manifest schemas; no filesystem input is consulted. */
function pack(data: World | CheckerData, checker: boolean): Uint8Array {
  const path=checker ? 'checker.json' : 'world.json', bytes=Buffer.from(canonicalJson(data)+'\n');
  const common={schemaVersion:CURRENT_SCHEMA_VERSION,world: checker ? (data as CheckerData).world : {id:(data as World).id,version:(data as World).version},files:[{path,sha256:sha256Hex(bytes),size:bytes.length,mediaType:'application/json' as const}]};
  const manifest=checker ? CheckerBundleManifestSchema.parse({format:CHECKER_BUNDLE_FORMAT,...common}) : WorldManifestSchema.parse({format:WORLD_PACKAGE_FORMAT,...common,entry:path});
  return writeStoredZip([{name:'manifest.json',data:Buffer.from(canonicalJson(manifest)+'\n')},{name:path,data:bytes}],LIMITS);
}
export function compileProject(input: CompileInput): CompileResult {
  const project=validateAuthorProject(input.project), recordings=input.recordings.map(validateRecording);
  if(!project.tasks.length || !project.variants.length)throw new AuthoringError('compile_incomplete','at least one public task and variant are required');
  if(project.repair && !project.repair.reviewedExamples)throw new AuthoringError('repair_examples_unreviewed','review the prepared valid and near-miss outcomes before creating the exercise');
  if(!project.recordingIds.length)throw new AuthoringError('provenance_missing','no source recordings');
  const ids=new Set(project.recordingIds);
  if(recordings.length!==ids.size || recordings.some(r=>!ids.has(r.manifest.id)))throw new AuthoringError('provenance_missing','source recordings differ from project');
  for(const r of recordings) {
    if(!r.manifest.author.trim() || !project.authors.includes(r.manifest.author) || !r.manifest.adapterVersion.trim())throw new AuthoringError('provenance_missing','recording author/version missing');
    if(r.manifest.license!=='CC0-1.0' || !r.manifest.consent.trim())throw new AuthoringError('rights_missing','CC0 and an explicit consent note are required for every source');
    if(r.manifest.status==='quarantined')throw new AuthoringError('recording_quarantined','quarantined source cannot be compiled');
  }
  assertModeledSources(recordings);
  const observed=verifiedObservations(recordings);
  const find=(ref:ObservationRef) => observed.find(o=>o.ref.recordingId===ref.recordingId && o.ref.gestureIndex===ref.gestureIndex && o.ref.sha256===ref.sha256);
  const confirmed=project.hypotheses.filter(h=>h.status==='confirmed');
  if(!confirmed.length)throw new AuthoringError('confirmation_without_evidence','no confirmed rules');
  for(const h of confirmed) {
    const t=RULE_TEMPLATES.find(t=>t.id===h.template)!;
    if(t.id==='delete-removes-arrows-v1')throw new AuthoringError('template_not_executable','world/1 has no confirmed delete-and-remove-arrows effect');
    if(!h.proposedFrom.length)throw new AuthoringError('evidence_missing','proposal has no observed source');
    for(const ref of [...h.proposedFrom,...h.confirmingEvidence]) {
      const o=find(ref);if(!o || !t.matches(o.before,o.after))throw new AuthoringError('evidence_disagrees','missing, changed or incompatible observation');
    }
    for(const ref of h.confirmingEvidence) {
      if(h.proposedFrom.some(p=>p.recordingId===ref.recordingId))throw new AuthoringError('confirmation_requires_new_observation','confirmation requires a separate recording from every proposal source');
      const o=find(ref)!;
      if(h.action==='delete_step' && !hasIncidentArrow(o.before,o.after))throw new AuthoringError('evidence_ambiguous','no incident arrow in confirming observation');
    }
    if(observed.some(o=>observationAction(o.before,o.after)===h.action && !t.matches(o.before,o.after)))throw new AuthoringError('hypothesis_refuted','source contains a counterexample to confirmed rule');
  }
  const adapterVersions=[...new Set(recordings.map(r=>r.manifest.adapterVersion))];
  if(adapterVersions.length!==1)throw new AuthoringError('provenance_mixed_versions','adapter versions differ');
  const coalescingVersions=[...new Set(recordings.map(r=>r.manifest.coalescingVersion))].sort();
  const rules=confirmed.map(h=>RULE_TEMPLATES.find(t=>t.id===h.template)!.rule([...h.proposedFrom,...h.confirmingEvidence].map(ref=>({run:ref.recordingId,case:`gesture-${ref.gestureIndex}`,sha256:ref.sha256})))).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  for(const state of [project.initialState,...project.tasks.flatMap(t=>t.task.initialState ? [t.task.initialState]:[]),...observed.flatMap(o=>[o.before,o.after])])for(const o of Object.values(state.objects))if(o.type==='step' && (o as StepV1).fontFamily!==3)throw new AuthoringError('font_unmodeled','only bundled Cascadia font family 3 is supported');
  const world=validateWorld({schema:'practonaut.world/1',id:project.id,version:project.version,
    app:{adapterId:'excalidraw',versionRange:'0.18.1',fontFamilies:[3],excludedAttributes:{version:'Volatile application revision',versionNonce:'Volatile nonce',updated:'Wall clock',seed:'Rendering seed',points:'Derived arrow geometry',boundElements:'Back-reference cache'}},
    units:{x:'integer CSS pixels',y:'integer CSS pixels',width:'integer CSS pixels',height:'integer CSS pixels'},
    objectTypes:[{type:'frame',attributes:{id:'id',deleted:'boolean',name:'string'}},{type:'step',attributes:{id:'id',deleted:'boolean',frameId:'id',label:'string',x:'integer',y:'integer',width:'integer',height:'integer',fontFamily:'integer'}},{type:'arrow',attributes:{id:'id',deleted:'boolean',frameId:'id',from:'nullable-id',to:'nullable-id'}}],
    initialState:project.initialState,actions:rules.map(r=>({name:r.action,parameters:Object.fromEntries(Object.entries(ACTION_PARAMETERS[r.action as ActionNameV1]).map(([name,type])=>[name,{type}])),preconditions:[]})),rules,tasks:project.tasks.map(t=>t.task),variants:{generator:'finite-seeded-v1',cases:project.variants},
    provenance:{authors:project.authors,adapterVersion:adapterVersions[0]!,appVersion:'0.18.1',compileToolVersion:'authoring-v1',coalescingVersion:COALESCING_VERSION,recordings:project.recordingIds},
    rights:{license:project.license,assets:[],recordings:recordings.map(r=>({id:r.manifest.id,source:`local-recording:${r.manifest.id}`,license:r.manifest.license,consent:r.manifest.consent}))}});
  if(world.rights.license!=='CC0-1.0' || world.provenance.privateSource)throw new AuthoringError('rights_missing','the author compiler requires explicit CC0 sources and cannot compile a private-source grant');
  const checker=validateCheckerData({schema:'practonaut.checker/1',world:{id:world.id,version:world.version},fixtures:project.checkerFixtures ?? [],heldOutTasks:project.heldOutTasks},world);
  for(const task of [...project.tasks.map(t=>t.task),...project.heldOutTasks]) {
    const fixtures=checker.fixtures.filter(f=>f.taskId===task.id), reference=fixtures.find(f=>f.kind==='reference');
    if(reference && fixtures.some(f=>f.kind==='alternative' && canonicalJson(f.state)===canonicalJson(reference.state)))throw new AuthoringError('checker_fixture_invalid','alternative must differ from reference');
  }
  // Isolate each variant to cover it directly instead of hoping finite seeds reach it.
  const allTasks=[...project.tasks,...project.heldOutTasks.map(task=>({task,solutions:project.heldOutSolutions?.[task.id] ?? {}}))];
  for(const variant of project.variants)for(const authorTask of allTasks) {
    const solution=authorTask.solutions[variant.id];
    if(!solution)throw new AuthoringError('variant_unsolved',`${authorTask.task.id}/${variant.id}: no solution supplied`);
    const instance=structuredClone(world);instance.variants.cases=[variant];
    const runtime=structuredClone(instance);
    if(!runtime.tasks.some(t=>t.id===authorTask.task.id))runtime.tasks.push(authorTask.task);
    const session=new Session(runtime,0,authorTask.task.id);
    for(const action of solution) {
      const result=session.act(structuredClone(action) as Action);
      if(!result.ok)throw new AuthoringError('variant_unsolved',`${authorTask.task.id}/${variant.id}: ${result.error.code}`);
    }
    const result=evaluate(session.world.tasks.find(t=>t.id===authorTask.task.id)!.goal,session.state);
    if(!result.ok || !result.value)throw new AuthoringError('variant_unsolved',`${authorTask.task.id}/${variant.id}: public goal fails`);
    if(!session.checkReplay().ok)throw new AuthoringError('variant_unsolved','solution replay fails');
    const verdict=checkState(instance,session.state,{seed:0,taskId:authorTask.task.id,bundle:checker});
    if(!verdict.passed)throw new AuthoringError('variant_unsolved','independent checker rejects solution');
  }
  return {world,checker,worldBytes:pack(world,false),checkerBytes:pack(checker,true),report:{ruleIds:rules.map(r=>r.id),openQuestionIds:project.questions.filter(q=>q.status==='open').map(q=>q.id),variantsChecked:project.variants.map(v=>v.id),demonstrationsPerRule:Object.fromEntries(confirmed.map(h=>[h.id,new Set([...h.proposedFrom,...h.confirmingEvidence].map(r=>r.recordingId)).size])),coalescingVersions}};
}

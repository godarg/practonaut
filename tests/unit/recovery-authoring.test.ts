import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareRepairProject,configureRepairProject,repairExamples,compileReadiness,summarizeObservation,revalidateAuthorProject,analyzeRecordings,confirmHypothesis,compileProject,observationRef,RULE_TEMPLATES,validateAuthorProject } from '../../src/authoring/index.ts';
import { snapshotElements } from '../../src/adapters/excalidraw/recorder.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import type { Recording,SemanticEvent } from '../../src/adapters/excalidraw/recorder-types.ts';
import type { State } from '../../src/world/types.ts';
import { evaluate } from '../../src/predicate/index.ts';
import { checkState } from '../../src/checker/index.ts';
import { Session } from '../../src/core/session.ts';

const prepared=()=>prepareRepairProject({id:'repair-test',title:'Shorten a process',author:'Synthetic author',labels:['Collect','Review','Publish']});
// Expected native semantics assigned by hand; no runtime transition supplies fixture truth.
function outcomes(){const initial=prepared().initialState,deleted=structuredClone(initial),reconnected=structuredClone(initial),removed=structuredClone(initial);
  for(const s of [deleted,reconnected,removed]){s.objects.b!.deleted=true;if(s.objects.ab?.type==='arrow')s.objects.ab.to=null;if(s.objects.bc?.type==='arrow')s.objects.bc.from=null;}
  for(const s of [reconnected,removed])if(s.objects.ab?.type==='arrow')s.objects.ab.to='c';
  if(removed.objects.bc?.type==='arrow')removed.objects.bc.deleted=true; // native tombstone retains obsolete end='c'
  return{initial,deleted,reconnected,removed};}
function recorded(id:string,before:State,after:State):Recording{
  const first=snapshotElements(toRaw(before)),last=snapshotElements(toRaw(after)),events:SemanticEvent[]=[];
  for(const key of Object.keys(last.elements).sort())for(const field of Object.keys(last.elements[key]!.attributes).sort()){
    const old=first.elements[key]!.attributes[field]!,value=last.elements[key]!.attributes[field]!;
    if(old!==value)events.push({kind:'set',id:key,field,before:old,after:value});}
  return{manifest:{schema:'practonaut.recording/1',id,createdAt:'2026-10-04T00:00:00Z',stoppedAt:'2026-10-04T00:00:01Z',appVersion:'0.18.1',adapterVersion:'1.0.0',coalescingVersion:'excalidraw-gesture-v1',author:'Synthetic author',license:'CC0-1.0',consent:'Self-created non-personal test scene',demonstration:'scripted',status:'review'},initial:first,gestures:[{index:0,boundary:'key',before:first,after:last,events,unmodeled:[],quarantined:false,quarantineReasons:[]}]};
}
function sources(){const s=outcomes();return [recorded('delete-proposal',s.initial,s.deleted),recorded('delete-confirmation',s.initial,s.deleted),recorded('reconnect-proposal',s.deleted,s.reconnected),recorded('reconnect-confirmation',s.deleted,s.reconnected),recorded('disconnect-proposal',s.reconnected,s.removed),recorded('disconnect-confirmation',s.reconnected,s.removed)];}
function confirmed(){const recordings=sources();let project=prepared();project={...project,...analyzeRecordings(recordings),recordingIds:recordings.map(r=>r.manifest.id)};
  for(const [id,index] of [['delete-keeps-arrows-v1',1],['reconnect-v1',3],['disconnect-v1',5]] as const)project=confirmHypothesis(project,{hypothesisId:id,evidence:observationRef(recordings[index]!,0)},recordings);
  return{project,recordings};}

test('prepared repair expresses author intention and independent examples, without granting any rule',()=>{
  const project=prepared(),examples=repairExamples(project)!;assert.equal(project.hypotheses.length,0);assert.equal(compileReadiness(project).ready,false);
  assert.equal(examples.origin,'prepared-independent-examples');const goal=project.tasks[0]!.task.goal;
  const passes=(state:State)=>{const verdict=evaluate(goal,state);assert.equal(verdict.ok,true);return verdict.ok&&verdict.value;};
  assert.equal(passes(examples.reference),true);assert.equal(passes(examples.alternative),true);assert.equal(passes(examples.nearMiss),false);
  assert.equal(passes(project.initialState),false);
  const double=structuredClone(examples.reference);if(double.objects.bc?.type==='arrow'){double.objects.bc.deleted=false;double.objects.bc.from='a';double.objects.bc.to='c';}assert.equal(passes(double),false);
  assert.throws(()=>configureRepairProject(project,{...project.repair!,removedStepId:'a',predecessorId:'b'}),/repair_intent_invalid/);
});
test('native inactive arrow bindings match a deletion without altering snapshots or ignoring live changes',()=>{
  const r=sources()[4]!,original=JSON.stringify(r);assert.deepEqual(analyzeRecordings([r]).hypotheses.map(h=>h.id),['disconnect-v1']);assert.equal(JSON.stringify(r),original);
  const s=outcomes(),template=RULE_TEMPLATES.find(t=>t.id==='disconnect-v1')!;assert.equal(template.matches(s.reconnected,s.removed),true);
  const changed=structuredClone(s.removed);if(changed.objects.ab?.type==='arrow')changed.objects.ab.from=null;assert.equal(template.matches(s.reconnected,changed),false);
  assert.equal(s.removed.objects.bc?.type==='arrow'&&s.removed.objects.bc.to,'c');
});
test('recording summaries explain named consequences and ask for confirmation only on the surviving proposal',()=>{
  const r=sources()[0]!,summary=summarizeObservation(r,r.gestures[0]!);assert.equal(summary.title.de,'„Review“ entfernt');assert.equal(summary.consequences.filter(c=>c.de.includes('losem Ende')).length,2);assert.deepEqual(summary.eligibleFor,['delete-keeps-arrows-v1']);
  const analysis=analyzeRecordings([r]);assert.equal(analysis.questions.length,1);assert.deepEqual(analysis.questions[0]!.hypothesisIds,['delete-keeps-arrows-v1']);assert.ok(analysis.questions[0]!.demonstration.de.includes('einmal beobachtet'));assert.ok(!analysis.questions[0]!.demonstration.de.includes('verschwinden sie'));
  const excluded=structuredClone(r);excluded.gestures[0]!.unmodeled=[{id:'b',attributes:['opacity'],reason:'Excluded'}];const card=summarizeObservation(excluded,excluded.gestures[0]!);assert.equal(card.excludedReason,'unmodeled');assert.deepEqual(card.eligibleFor,[]);
  const disconnected=sources()[4]!;assert.ok(summarizeObservation(disconnected,disconnected.gestures[0]!).title.de.includes('Publish'));
});
test('reviewed repair compiles from fresh evidence, supports both repair strategies and keeps cases editable',()=>{
  const input=confirmed();assert.equal(compileReadiness(input.project).missing.some(m=>m.code.startsWith('rule_missing')),false);assert.equal(compileReadiness(input.project).missing.some(m=>m.code==='examples_unreviewed'),true);
  assert.throws(()=>compileProject(input),/repair_examples_unreviewed/);
  input.project=configureRepairProject(input.project,{...input.project.repair!,reviewedExamples:true,cases:[{id:'morning',labels:['Receive','Approve','Ship'],offset:{x:0,y:0}},{id:'evening',labels:['Intake','Audit','Archive'],offset:{x:50,y:70}}]});
  assert.equal(compileReadiness(input.project).ready,true);const compiled=compileProject(input);assert.equal(compiled.world.rules.length,3);assert.equal(compiled.report.variantsChecked.length,2);
  for(const variant of compiled.world.variants.cases){const world=structuredClone(compiled.world);world.variants.cases=[variant];
    for(const recipe of [input.project.tasks[0]!.solutions[variant.id]!,[{name:'delete_step',params:{id:'b'}},{name:'reconnect_end',params:{id:'bc',end:'start',target:'a'}},{name:'disconnect',params:{id:'ab'}}]]){
      const session=new Session(world,0,'repair-flow');for(const action of recipe)assert.equal(session.act(action).ok,true);
      assert.equal(checkState(world,session.state,{seed:0,taskId:'repair-flow',bundle:compiled.checker}).passed,true);
      assert.equal(Object.values(session.state.objects).filter(o=>o.type==='step'&&!o.deleted).map(o=>o.type==='step'?o.label:'').includes(variant.labels.first!),true);
    }
  }
  const examples=repairExamples(input.project)!;assert.equal(checkState(compiled.world,examples.nearMiss,{seed:0,taskId:'repair-flow',bundle:compiled.checker}).passed,false);
  assert.equal(Buffer.from(compiled.worldBytes).includes(Buffer.from('prepared-independent-examples')),false);
});
test('durable project authority is rebuilt from actual references, not stored status or missing sources',()=>{
  const input=confirmed(),restored=revalidateAuthorProject(input.project,input.recordings);assert.equal(restored.hypotheses.filter(h=>h.status==='confirmed').length,3);
  assert.equal(restored.hypotheses.find(h=>h.id==='delete-removes-arrows-v1')!.status,'refuted');assert.ok(restored.questions.every(q=>q.status==='answered'));
  assert.throws(()=>revalidateAuthorProject(input.project,input.recordings.slice(1)),/provenance_missing/);
  const forged=structuredClone(input.project);forged.hypotheses[0]!.confirmingEvidence=structuredClone(forged.hypotheses[0]!.proposedFrom);assert.throws(()=>revalidateAuthorProject(forged,input.recordings),/confirmation_requires_new_observation/);
  const changed=structuredClone(input.project);changed.hypotheses[0]!.proposedFrom[0]!.sha256='0'.repeat(64);assert.throws(()=>revalidateAuthorProject(changed,input.recordings),/evidence_missing/);
  const legacy=structuredClone(input.project);delete legacy.repair;assert.equal(validateAuthorProject(legacy).schema,'practonaut.author/1');
  const s=outcomes(),contradiction=structuredClone(s.deleted);
  for(const id of ['ab','bc']){const arrow=contradiction.objects[id];if(arrow?.type==='arrow'){arrow.deleted=true;arrow.from=null;arrow.to=null;}}
  const newSource=recorded('later-counterexample',s.initial,contradiction),newProject=structuredClone(input.project);newProject.recordingIds.push(newSource.manifest.id);
  const rechecked=revalidateAuthorProject(newProject,[...input.recordings,newSource]);const disproved=rechecked.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1')!;
  assert.equal(disproved.status,'refuted');assert.equal(disproved.confirmingEvidence.length,1);assert.ok(disproved.refutingEvidence.some(r=>r.recordingId==='later-counterexample'));assert.equal(compileReadiness(rechecked).ready,false);
});
test('serialized restores retain every initial and later counterexample citation with historical confirmations',()=>{
  const input=confirmed(),initial=revalidateAuthorProject(input.project,input.recordings);
  const originalAlternative=initial.hypotheses.find(h=>h.id==='delete-removes-arrows-v1')!;
  const originalRefs=[observationRef(input.recordings[0]!,0),observationRef(input.recordings[1]!,0)];
  assert.deepEqual(originalAlternative.refutingEvidence,originalRefs);
  const s=outcomes(),removedArrows=structuredClone(s.deleted);
  for(const id of ['ab','bc']){const arrow=removedArrows.objects[id];if(arrow?.type==='arrow'){arrow.deleted=true;arrow.from=null;arrow.to=null;}}
  const contradiction=recorded('new-distinguishing-counterexample',s.initial,removedArrows),allSources=[...input.recordings,contradiction];
  const snapshot=structuredClone(initial);snapshot.recordingIds.push(contradiction.manifest.id);
  const firstRestore=revalidateAuthorProject(JSON.parse(JSON.stringify(snapshot)),allSources);
  const secondRestore=revalidateAuthorProject(JSON.parse(JSON.stringify(firstRestore)),allSources);
  for(const restored of [firstRestore,secondRestore]){
    const keeps=restored.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1')!,removes=restored.hypotheses.find(h=>h.id==='delete-removes-arrows-v1')!;
    assert.equal(keeps.status,'refuted');assert.deepEqual(keeps.refutingEvidence,[observationRef(contradiction,0)]);
    assert.deepEqual(keeps.confirmingEvidence,[observationRef(input.recordings[1]!,0)]);
    assert.equal(removes.status,'refuted');assert.deepEqual(removes.refutingEvidence,originalRefs);
    assert.equal(compileReadiness(restored).ready,false);
  }
  const removedSourceProject=structuredClone(secondRestore);removedSourceProject.recordingIds=removedSourceProject.recordingIds.filter(id=>id!==contradiction.manifest.id);
  assert.throws(()=>revalidateAuthorProject(removedSourceProject,input.recordings),/evidence_missing/);
});
test('an unmodeled source cannot hide a contradiction during confirmation, restore or compilation',()=>{
  const input=confirmed(),s=outcomes(),contradiction=structuredClone(s.deleted);
  for(const id of ['ab','bc']){const arrow=contradiction.objects[id];if(arrow?.type==='arrow'){arrow.deleted=true;arrow.from=null;arrow.to=null;}}
  const excluded=recorded('excluded-contradiction',s.initial,contradiction);
  excluded.gestures[0]!.unmodeled=[{id:'b',attributes:['opacity'],reason:'Change outside modeled semantics'}];
  const all=[...input.recordings,excluded],snapshot=structuredClone(input.project);snapshot.recordingIds.push(excluded.manifest.id);
  assert.throws(()=>confirmHypothesis(snapshot,{hypothesisId:'delete-keeps-arrows-v1',evidence:observationRef(input.recordings[1]!,0)},all),/evidence_unmodeled/);
  const reanalyzed=analyzeRecordings(all,snapshot);assert.ok(reanalyzed.hypotheses.every(h=>h.status!=='confirmed'));
  const restored=revalidateAuthorProject(snapshot,all);assert.ok(restored.hypotheses.every(h=>h.status!=='confirmed'));
  assert.deepEqual(restored.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1')!.confirmingEvidence,snapshot.hypotheses.find(h=>h.id==='delete-keeps-arrows-v1')!.confirmingEvidence);
  snapshot.repair!.reviewedExamples=true;assert.throws(()=>compileProject({project:snapshot,recordings:all}),/evidence_unmodeled/);
  assert.equal(JSON.stringify(all),JSON.stringify([...input.recordings,excluded]));
});


test('unfamiliar single-step arrow effect remains a counterexample rather than being hidden as a batch',()=>{
 const states=outcomes(),partial=structuredClone(states.deleted);
 if(partial.objects.bc?.type==='arrow')partial.objects.bc.deleted=true;
 const source=recorded('single-step-partial-arrow-effect',states.initial,partial);
 const result=analyzeRecordings([source]);
 assert.deepEqual(source.gestures[0]!.unmodeled,[]);
 for(const id of ['delete-keeps-arrows-v1','delete-removes-arrows-v1']){
  const rule=result.hypotheses.find(h=>h.id===id);assert.ok(rule);assert.equal(rule.status,'refuted');
  assert.deepEqual(rule.refutingEvidence,[observationRef(source,0)]);
 }
 assert.equal(result.hypotheses.some(h=>h.status==='confirmed'),false);
});

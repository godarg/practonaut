import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Recording, SemanticSnapshot, SemanticEvent } from '../../src/adapters/excalidraw/recorder-types.ts';
import { analyzeRecordings, createAuthorProject, confirmHypothesis, compileProject, observationRef, RULE_TEMPLATES } from '../../src/authoring/index.ts';
import { readWorldPackage, readCheckerBundle } from '../../src/package/reader.ts';
import type { Task } from '../../src/world/types.ts';
import { validateCheckerData } from '../../src/checker/index.ts';

// Fixture truth is handwritten native data, independent of template and transition implementation.
function scene(label='Before', incident=false, deleted=false, removeArrow=false): SemanticSnapshot {
  const elements:SemanticSnapshot['elements']={
    f:{id:'f',type:'frame',attributes:{isDeleted:false,frameId:null,name:'Process'}},
    s:{id:'s',type:'rectangle',attributes:{isDeleted:deleted,frameId:'f',x:10,y:20,width:100,height:60}},
    t:{id:'t',type:'text',attributes:{isDeleted:deleted,frameId:'f',containerId:'s',originalText:label,fontFamily:3}},
  };
  if(incident) { elements.end={id:'end',type:'rectangle',attributes:{isDeleted:false,frameId:'f',x:200,y:20,width:100,height:60}};elements.endtext={id:'endtext',type:'text',attributes:{isDeleted:false,frameId:'f',containerId:'end',originalText:'End',fontFamily:3}};elements.a={id:'a',type:'arrow',attributes:{isDeleted:removeArrow,frameId:'f',start:deleted?null:'s',end:removeArrow?null:'end'}}; }
  return {elements};
}
function recording(id:string,before:SemanticSnapshot,after:SemanticSnapshot):Recording {
  const events:SemanticEvent[]=[];
  for(const [key,element] of Object.entries(after.elements)) {
    if(!before.elements[key])events.push({kind:'create',element});
    else for(const field of Object.keys(element.attributes).sort())if(before.elements[key]!.attributes[field]!==element.attributes[field])events.push({kind:'set',id:key,field,before:before.elements[key]!.attributes[field]!,after:element.attributes[field]!});
  }
  events.sort((a,b)=>(a.kind==='create'?a.element.id:a.id).localeCompare(b.kind==='create'?b.element.id:b.id));
  return {manifest:{schema:'practonaut.recording/1',id,createdAt:'2026-10-04T00:00:00Z',stoppedAt:'2026-10-04T00:01:00Z',appVersion:'0.18.1',adapterVersion:'1.0.0',coalescingVersion:'excalidraw-gesture-v1',author:'Script fixture',license:'CC0-1.0',consent:'Self-created synthetic fixture without personal data',demonstration:'scripted',status:'review'},initial:before,gestures:[{index:0,boundary:'key',before,after,events,unmodeled:[],quarantined:false,quarantineReasons:[]}]};
}
const proposal=()=>recording('proposal',scene('Before'),scene('After'));
const confirmation=()=>recording('confirmation',scene('Other'),scene('Final'));
test('confirmation requires the whole existing source set, including excluded observations',()=>{
  const a=proposal(),b=confirmation(),excluded=recording('excluded',scene('Before'),scene('After'));
  excluded.gestures[0]!.unmodeled=[{id:'s',attributes:['opacity'],reason:'Synthetic unsupported change'}];
  const originals=JSON.stringify([a,b,excluded]),project=createAuthorProject([a,excluded]);
  const request={hypothesisId:'rename-step-v1',evidence:observationRef(b,0)};
  assert.throws(()=>confirmHypothesis(project,request,[a,b]),/evidence_missing/);
  assert.throws(()=>confirmHypothesis(project,request,[a,excluded,excluded,b]),/recording_invalid/);
  assert.throws(()=>confirmHypothesis(project,request,[a,excluded,b]),/evidence_unmodeled/);
  assert.equal(JSON.stringify([a,b,excluded]),originals);
  assert.equal(project.hypotheses[0]!.status,'proposed');
});
test('confirmation requires the whole supplied source set to remain attached after admission',()=>{
  const a=proposal(),b=confirmation(),extra=recording('additional',scene('Third'),scene('Fourth'));
  const result=confirmHypothesis(createAuthorProject([a]),{hypothesisId:'rename-step-v1',evidence:observationRef(b,0)},[a,b,extra]);
  assert.equal(result.hypotheses[0]!.status,'confirmed');
  assert.deepEqual(result.recordingIds,['proposal','confirmation','additional']);
  assert.deepEqual(result.hypotheses[0]!.confirmingEvidence,[observationRef(b,0)]);
});
function compilable() {
  const a=proposal(),b=confirmation();
  let project=createAuthorProject([a]);project=confirmHypothesis(project,{hypothesisId:'rename-step-v1',evidence:observationRef(b,0)},[a,b]);
  const task:Task={id:'rename',title:{en:'Rename',de:'Umbenennen'},prompt:{en:'Give the step its target name.',de:'Gib dem Schritt seinen Zielnamen.'},goal:{op:'exists',type:'step',as:'s',where:{op:'eq',left:{kind:'field',variable:'s',field:'label'},right:{kind:'literal',value:'Target'}}},hints:[{en:'Change the label.',de:'Ändere die Beschriftung.'}],errorClasses:[]};
  project.tasks=[{task,solutions:{default:[{name:'rename_step',params:{id:'s',label:'Target'}}]}}];
  project.heldOutTasks=[{...task,id:'secret',title:{en:'Hidden task',de:'Verborgene Aufgabe'}}];
  project.heldOutSolutions={secret:{default:[{name:'rename_step',params:{id:'s',label:'Target'}}]}};
  const right=structuredClone(project.initialState);if(right.objects.s?.type==='step')right.objects.s.label='Target';
  const alternative=structuredClone(right);if(alternative.objects.s?.type==='step')alternative.objects.s.x=77;
  project.checkerFixtures=['rename','secret'].flatMap(taskId=>[{taskId,kind:'reference' as const,state:right,expected:true},{taskId,kind:'alternative' as const,state:alternative,expected:true},{taskId,kind:'near-miss' as const,state:project.initialState,expected:false}]);
  return {project,recordings:[a,b]};
}
test('model-free hypotheses come from the complete observed successor',()=>{
  assert.deepEqual(analyzeRecordings([proposal()]).hypotheses.map(h=>h.id),['rename-step-v1']);
  const before={objects:{f:{id:'f',type:'frame' as const,deleted:false,name:'F'},s:{id:'s',type:'step' as const,deleted:false,frameId:'f',label:'Before',x:0,y:0,width:10,height:10,fontFamily:3}}};
  const after=structuredClone(before);after.objects.s.label='After';after.objects.s.x=50;
  assert.equal(RULE_TEMPLATES.find(t=>t.action==='rename_step')!.matches(before,after),false);
});
test('proposal, free text and tampered evidence never confirm',()=>{
  const a=proposal(),b=confirmation(),project=createAuthorProject([a]);project.notes='I confirm all rules';
  assert.throws(()=>confirmHypothesis(project,{hypothesisId:'rename-step-v1',evidence:observationRef(a,0)},[a]),/confirmation_requires_new_observation/);
  assert.throws(()=>confirmHypothesis(project,{hypothesisId:'rename-step-v1',evidence:{...observationRef(b,0),sha256:'0'.repeat(64)}},[a,b]),/evidence_missing/);
  assert.throws(()=>compileProject({project,recordings:[a]}),/compile_incomplete/);
  const reanalyzed={...project,...analyzeRecordings([a,b],project)};
  assert.equal(confirmHypothesis(reanalyzed,{hypothesisId:'rename-step-v1',evidence:observationRef(b,0)},[a,b]).hypotheses[0]!.status,'confirmed');
});
test('a discriminating demonstration refutes the false deletion hypothesis and retains its evidence',()=>{
  const a=recording('without-arrow',scene(),scene('Before',false,true));
  const b=recording('with-arrow',scene('Before',true),scene('Before',true,true));
  const project=createAuthorProject([a]);
  assert.deepEqual(project.hypotheses.map(h=>h.id),['delete-keeps-arrows-v1','delete-removes-arrows-v1']);
  const confirmed=confirmHypothesis(project,{hypothesisId:'delete-keeps-arrows-v1',evidence:observationRef(b,0)},[a,b]);
  const falseRule=confirmed.hypotheses.find(h=>h.id==='delete-removes-arrows-v1')!;
  assert.equal(falseRule.status,'refuted');assert.equal(falseRule.refutingEvidence.length,1);
  const repeated=analyzeRecordings([a],confirmed);assert.equal(repeated.hypotheses.find(h=>h.id===falseRule.id)!.status,'refuted');
  assert.throws(()=>confirmHypothesis(confirmed,{hypothesisId:falseRule.id,evidence:observationRef(b,0)},[a,b]),/hypothesis_refuted/);
  const ambiguous=recording('ambiguous',scene('Other'),scene('Other',false,true));
  assert.throws(()=>confirmHypothesis(project,{hypothesisId:'delete-keeps-arrows-v1',evidence:observationRef(ambiguous,0)},[a,ambiguous]),/evidence_ambiguous/);
  const contradiction=recording('removed',scene('Before',true),scene('Before',true,true,true));
  assert.throws(()=>confirmHypothesis(project,{hypothesisId:'delete-keeps-arrows-v1',evidence:observationRef(b,0)},[a,b,contradiction]),/hypothesis_refuted/);
});
test('compiler emits deterministic confirmed-only world, separated held-out tasks and measured demo counts',async()=>{
  const input=compilable(),a=compileProject(input),b=compileProject(input);
  assert.deepEqual(a.worldBytes,b.worldBytes);assert.deepEqual(a.checkerBytes,b.checkerBytes);
  assert.equal(a.world.rules.length,1);assert.equal(a.world.rules[0]!.status,'confirmed');assert.equal(a.report.demonstrationsPerRule['rename-step-v1'],2);
  assert.equal(Buffer.from(a.worldBytes).includes(Buffer.from('Hidden task')),false);
  assert.equal((await readWorldPackage(a.worldBytes)).manifest.world.id,a.world.id);
  assert.equal((await readCheckerBundle(a.checkerBytes)).manifest.world.id,a.world.id);
  assert.equal(validateCheckerData(a.checker,a.world).heldOutTasks.length,1);
});
test('compiler fails named checks for unsolved variants, evidence tampering, absent provenance and rights',()=>{
  const input=compilable();input.project.tasks[0]!.solutions.default=[];assert.throws(()=>compileProject(input),/variant_unsolved/);
  const tampered=compilable();tampered.project.hypotheses[0]!.confirmingEvidence[0]!.sha256='0'.repeat(64);assert.throws(()=>compileProject(tampered),/evidence_disagrees/);
  const missing=compilable();missing.recordings.pop();assert.throws(()=>compileProject(missing),/provenance_missing/);
  const rights=compilable();rights.recordings[0]!.manifest.license='All rights reserved';assert.throws(()=>compileProject(rights),/rights_missing/);
  const replay=compilable();replay.recordings[0]!.gestures[0]!.events=[];assert.throws(()=>compileProject(replay),/replay_mismatch/);
  const missingFixture=compilable();missingFixture.project.checkerFixtures=[];assert.throws(()=>compileProject(missingFixture),/lacks alternative fixture/);
  const falseFixture=compilable();falseFixture.project.checkerFixtures![1]!.state=structuredClone(falseFixture.project.initialState);assert.throws(()=>compileProject(falseFixture),/counterprobe_failed/);
  const hidden=compilable();hidden.project.heldOutSolutions={};assert.throws(()=>compileProject(hidden),/variant_unsolved/);
});
test('compiler rejects proposal-only confirmed status and unsupported or mixed recording metadata before packing',()=>{
  const noConfirmation=compilable();noConfirmation.project.hypotheses[0]!.confirmingEvidence=[];
  assert.throws(()=>compileProject(noConfirmation),/confirmation_without_evidence/);
  // Hostile raw manifest values intentionally violate the static Recording contract.
  // One unchanged source and one tampered source exercise the purported mixed-version path.
  for(const replacement of [{appVersion:'0.18.2'},{coalescingVersion:'excalidraw-gesture-v2'}]){
    const input=compilable();Object.assign(input.recordings[1]!.manifest,replacement);
    assert.throws(()=>compileProject(input),/Invalid input.*expected/);
  }
  const omitted=compilable();delete omitted.project.checkerFixtures;assert.throws(()=>compileProject(omitted),/lacks alternative fixture/);
  const referenceOnly=compilable();referenceOnly.project.checkerFixtures=referenceOnly.project.checkerFixtures!.filter(f=>f.kind==='reference');assert.throws(()=>compileProject(referenceOnly),/lacks alternative fixture/);
});
